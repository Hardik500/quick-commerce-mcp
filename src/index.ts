#!/usr/bin/env node
/**
 * MCP Server Entry Point
 * Implements Model Context Protocol for quick commerce aggregation
 */
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { ZeptoPlatform } from './platforms/zepto.js';
import { SwiggyInstamartPlatform } from './platforms/swiggy-instamart.js';
import { BlinkitPlatform } from './platforms/blinkit.js';
import { QuickCommercePlatform, Product, SearchResult } from './platforms/base.js';
import { StealthBrowser } from './engine/stealth-browser.js';
import { sessionPath } from './session-helper.js';
import { relevant, rankByUnitPrice } from './ranking.js';

// All platforms supported by the "all" shorthand in tool inputs.
const ALL_PLATFORMS = ['zepto', 'swiggy-instamart', 'blinkit'];

function resolvePlatforms(list: string | string[]): string[] {
  const names = ([] as string[]).concat(list);
  return names.includes('all') ? ALL_PLATFORMS : names;
}

// Logged-in search on one platform; errors are returned, not thrown.
async function searchOn(platformName: string, query: string): Promise<SearchResult | { platform: string; error: string }> {
  try {
    const platform = await getPlatform(platformName);
    const login = await platform.checkLogin();
    if (!login.loggedIn) return { platform: platformName, error: 'Not logged in' };
    return await platform.search(query);
  } catch (error: any) {
    return { platform: platformName, error: error.message };
  }
}

// Store active platform instances, each with its own browser context so
// sessions (and any bot-detection fallout) stay isolated per platform.
const platforms: Map<string, QuickCommercePlatform> = new Map();
const browsers: Map<string, StealthBrowser> = new Map();

// One-time confirm tokens for place_order (step 2 must present the token from step 1).
const orderTokens: Map<string, { platform: string; total: number; expires: number }> = new Map();

// Payment modes place_order can drive, per platform. Anything else gets a friendly refusal.
const SUPPORTED_PAYMENTS: Record<string, string[]> = {
  blinkit: ['cod', 'upi'],
  zepto: ['cod', 'upi_qr', 'card'],
  swiggy: ['cod'],
  'swiggy-instamart': ['cod'],
};

/** Asked right after login: tells the agent to collect the payment mode (and UPI ID) up front. */
const PAYMENT_PROMPT = '\n\n💳 Before ordering, ask the user how they want to pay and tell them what is supported:\n- Cash on Delivery ("cod"): Blinkit, Zepto, Instamart\n- UPI collect request ("upi", needs their UPI ID like name@bank; approved on their phone): Blinkit only\n- UPI QR (\"upi_qr\", the user scans a QR we send, valid ~3 min): Zepto only\n- Saved card (\"card\", needs the last 4 digits of a saved card; CVV is read from the QC_CVV_<last4> env var on the server): Zepto only\n- New cards, wallets, netbanking, Pay Later: not supported.\nIf they choose UPI, ask for the UPI ID now. If they choose a card, ask which saved card (last 4 digits).';

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'search_products',
    description: 'Search for products across quick commerce platforms (Zepto, Swiggy Instamart, Blinkit). When multiple platforms return results, includes a cheapest-first comparison by unit price. Uses each platform\'s current delivery address (see list_addresses / select_address).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Product name to search for (e.g., "Coke Zero", "Amul Taaza milk")',
        },
        platforms: {
          type: 'array',
          items: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'bigbasket', 'all'] },
          description: 'Platforms to search on. Use "all" to search all supported platforms.',
        },
      },
      required: ['query', 'platforms'],
    },
  },
  {
    name: 'check_login_status',
    description: 'Check if user is logged in to specified platforms. Will prompt for OTP if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        platforms: {
          type: 'array',
          items: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'bigbasket', 'all'] },
          description: 'Platforms to check login status',
        },
      },
      required: ['platforms'],
    },
  },
  {
    name: 'submit_otp',
    description: 'Submit OTP to complete login for a platform. Call this after user provides OTP.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'bigbasket'],
          description: 'Platform to submit OTP for',
        },
        otp: {
          type: 'string',
          description: '6-digit OTP received on phone',
        },
      },
      required: ['platform', 'otp'],
    },
  },
  {
    name: 'add_to_cart',
    description: 'Add products to cart on specified platform. Shows cart preview and asks for confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'bigbasket'],
          description: 'Platform to add items to',
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
              name: { type: 'string' },
              quantity: { type: 'number', minimum: 1 },
            },
            required: ['productId', 'quantity'],
          },
          description: 'Items to add to cart',
        },
        confirm: {
          type: 'boolean',
          description: 'Set to false to preview cart before adding. User must confirm.',
        },
      },
      required: ['platform', 'items'],
    },
  },
  {
    name: 'get_cart_summary',
    description: 'Get current cart contents and total for specified platform.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'bigbasket'],
          description: 'Platform to get cart from',
        },
      },
      required: ['platform'],
    },
  },
  {
    name: 'place_order',
    description: 'Place the current cart as a Cash on Delivery order. Two steps: call without confirm_token to select Cash and get a summary + token (nothing is charged); call again with that token to place the order. ONLY pass the token after the user has explicitly approved the summary.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'], description: 'Platform to order on' },
        payment_method: { type: 'string', description: 'Payment method the user chose: "cod" (all platforms), "upi_qr" (Zepto only; returns a QR image the user scans), "card" (Zepto only; saved card, pass card_last4) or "upi" (Blinkit only; sends a collect request to upi_id that the user approves on their phone). Other modes are refused with the supported list.' },
        upi_id: { type: 'string', description: 'UPI ID (e.g. name@bank); required for payment_method "upi"' },
        card_last4: { type: 'string', description: 'Last 4 digits of the saved card; required for payment_method "card"' },
        confirm_token: { type: 'string', description: 'Token returned by step 1; places the order' },
      },
      required: ['platform', 'payment_method'],
    },
  },
  {
    name: 'get_order_preview',
    description: 'Preview the checkout for the current cart: items, bill, delivery address and available payment options. Does not place an order or charge anything.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'],
          description: 'Platform to preview checkout on',
        },
      },
      required: ['platform'],
    },
  },
  {
    name: 'compare_prices',
    description: 'Compare prices for a shopping list across all platforms. Finds cheapest option and optimal split.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Product name' },
              quantity: { type: 'number', minimum: 1 },
              preferredBrand: { type: 'string', description: 'Optional preferred brand' },
            },
            required: ['name', 'quantity'],
          },
          description: 'Shopping list items',
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'remove_from_cart',
    description: 'Remove one product (all its quantity) from the cart on specified platform. Identify it by name (or a distinctive part of it) as shown in get_cart_summary; search product IDs do not match cart rows.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'bigbasket'],
          description: 'Platform to remove the item from',
        },
        item: { type: 'string', description: 'Item name as shown in get_cart_summary, e.g. "Amul Taaza Toned Milk"' },
      },
      required: ['platform', 'item'],
    },
  },
  {
    name: 'list_addresses',
    description: 'List saved delivery addresses on a platform. Each has an id to pass to select_address.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'], description: 'Platform to query' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'select_address',
    description: 'Switch the delivery address on a platform (changes the live account address, and search results/stock). Use an id from list_addresses.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'], description: 'Platform to change' },
        address_id: { type: 'string', description: 'Address id from list_addresses' },
      },
      required: ['platform', 'address_id'],
    },
  },
  {
    name: 'clear_cart',
    description: 'Clear all items from cart on specified platform.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'bigbasket'],
          description: 'Platform to clear cart',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm cart clear',
        },
      },
      required: ['platform', 'confirm'],
    },
  },
];

// Get or create platform instance, each backed by its own stealth browser
// context restored from that platform's saved session (if any).
async function getPlatform(name: string): Promise<QuickCommercePlatform> {
  if (!platforms.has(name)) {
    let platform: QuickCommercePlatform;

    switch (name) {
      case 'zepto':
        platform = new ZeptoPlatform();
        break;
      case 'swiggy':
      case 'swiggy-instamart':
        platform = new SwiggyInstamartPlatform();
        break;
      case 'blinkit':
        platform = new BlinkitPlatform();
        break;
      default:
        throw new Error(`Platform ${name} not supported`);
    }

    const stealth = new StealthBrowser();
    const context = await stealth.launch({
      headless: true,
      storageStatePath: sessionPath(name),
    });
    browsers.set(name, stealth);

    await platform.initialize(context);
    platforms.set(name, platform);
  }

  return platforms.get(name)!;
}

// Server setup
const server = new Server(
  {
    name: 'quick-commerce-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_products': {
        const { query, platforms: platformList } = args as any;
        const results = [];

        for (const platformName of resolvePlatforms(platformList)) {
          try {
            // Check login first
            const platform = await getPlatform(platformName);
            const loginStatus = await platform.checkLogin();
            
            if (!loginStatus.loggedIn && !loginStatus.otpSent) {
              results.push({
                platform: platformName,
                error: 'Not logged in. Please login first by visiting the platform.',
              });
              continue;
            }

            if (loginStatus.otpSent && loginStatus.phone) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `🔐 OTP required for ${platformName}\nPhone: ${loginStatus.phone}\n\nPlease provide the 6-digit OTP to continue.`,
                  },
                ],
              };
            }

            const searchResult = await platform.search(query);
            results.push(searchResult);
          } catch (error: any) {
            results.push({
              platform: platformName,
              error: error.message,
            });
          }
        }

        // Format results
        let responseText = `🔍 Search results for "${query}":\n\n`;
        
        for (const result of results) {
          if ('error' in result) {
            responseText += `❌ ${result.platform}: ${result.error}\n\n`;
            continue;
          }

          responseText += `📱 **${result.platform.toUpperCase()}** (${result.totalResults} results)\n`;
          
          if (result.products.length === 0) {
            responseText += 'No products found.\n';
          } else {
            for (const product of result.products.slice(0, 5)) {
              const price = product.mrp && product.mrp > product.price
                ? `~~₹${product.mrp}~~ **₹${product.price}**`
                : `**₹${product.price}**`;
              responseText += `- ${product.name} (${product.quantity}): ${price}\n`;
              responseText += `  ID: \`${product.id}\`\n`;
            }
          }
          responseText += '\n';
        }

        const ok = results.filter((r): r is SearchResult => !('error' in r) && r.products.length > 0);
        const ranked = rankByUnitPrice(ok.flatMap(r => relevant(query, r.products)));
        if (ok.length > 1 && ranked.length > 0) {
          responseText += `💰 **Cheapest (by unit price)**\n`;
          for (const { p, u } of ranked.slice(0, 5)) {
            responseText += `- ₹${u.value.toFixed(2)}/${u.label} — ${p.name} (${p.quantity}) ₹${p.price} on ${p.platform}\n`;
          }
        }

        return {
          content: [{ type: 'text', text: responseText }],
        };
      }

      case 'check_login_status': {
        const { platforms: platformList } = args as any;
        const statuses = [];

        for (const platformName of resolvePlatforms(platformList)) {
          try {
            const platform = await getPlatform(platformName);
            const status = await platform.checkLogin();
            statuses.push({ platform: platformName, ...status });
          } catch (error: any) {
            statuses.push({ platform: platformName, error: error.message });
          }
        }

        let responseText = '🔐 Login Status:\n\n';
        
        for (const status of statuses) {
          if ('error' in status) {
            responseText += `❌ ${status.platform}: ${status.error}\n`;
          } else if (status.loggedIn) {
            responseText += `✅ ${status.platform}: Logged in\n`;
          } else if (status.otpSent) {
            responseText += `⏳ ${status.platform}: OTP sent to ${status.phone}\n`;
          } else {
            responseText += `❌ ${status.platform}: Not logged in\n`;
          }
        }
        if (statuses.some(s => 'loggedIn' in s && s.loggedIn)) responseText += PAYMENT_PROMPT;

        return {
          content: [{ type: 'text', text: responseText }],
        };
      }

      case 'submit_otp': {
        const { platform: platformName, otp } = args as any;
        
        try {
          const platform = platforms.get(platformName);
          if (!platform) {
            return {
              content: [{ type: 'text', text: `❌ Platform ${platformName} not initialized. Search first.` }],
            };
          }

          const success = await platform.submitOtp(otp);
          
          if (success) {
            return {
              content: [{ type: 'text', text: `✅ Successfully logged in to ${platformName}${PAYMENT_PROMPT}` }],
            };
          } else {
            return {
              content: [{ type: 'text', text: `❌ Failed to login. Please check OTP and try again.` }],
            };
          }
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `❌ Error: ${error.message}` }],
          };
        }
      }

      case 'add_to_cart': {
        const { platform: platformName, items, confirm } = args as any;

        if (!confirm) {
          // Preview mode
          let previewText = `🛒 Cart Preview for **${platformName.toUpperCase()}**\n\n`;
          let total = 0;

          for (const item of items) {
            previewText += `- ${item.quantity}x ${item.name}\n`;
            // Price would come from cache or search
            total += item.quantity * 40; // Placeholder
          }

          previewText += `\n**Estimated Total: ₹${total}**\n\n`;
          previewText += `⚠️ Set \`confirm: true\` to add these items to cart.`;

          return {
            content: [{ type: 'text', text: previewText }],
          };
        }

        // Actually add to cart
        const platform = platforms.get(platformName);
        if (!platform) {
          return {
            content: [{ type: 'text', text: `❌ Platform not initialized. Search first.` }],
          };
        }

        const results = [];
        for (const item of items) {
          const success = await platform.addToCart(item.productId, item.quantity);
          results.push({ name: item.name ?? item.productId, success });
        }

        let responseText = `✅ Added to cart on **${platformName.toUpperCase()}**:\n\n`;
        for (const result of results) {
          responseText += result.success ? `✓ ${result.name}\n` : `✗ ${result.name} (failed)\n`;
        }

        return {
          content: [{ type: 'text', text: responseText }],
        };
      }

      case 'get_cart_summary': {
        const { platform: platformName } = args as any;
        
        const platform = platforms.get(platformName);
        if (!platform) {
          return {
            content: [{ type: 'text', text: `❌ Platform not initialized. Search first.` }],
          };
        }

        const cart = await platform.getCart();
        
        if (!cart || cart.items.length === 0) {
          return {
            content: [{ type: 'text', text: `🛒 Cart is empty on ${platformName.toUpperCase()}` }],
          };
        }

        let responseText = `🛒 **Cart Summary - ${platformName.toUpperCase()}**\n\n`;
        
        for (const item of cart.items) {
          responseText += `${item.cartQuantity}x ${item.name} - ₹${item.price * item.cartQuantity}\n`;
        }
        
        responseText += `\nSubtotal: ₹${cart.subtotal}\n`;
        responseText += `Delivery: ₹${cart.deliveryFee}\n`;
        responseText += `**Total: ₹${cart.total}**`;

        return {
          content: [{ type: 'text', text: responseText }],
        };
      }

      case 'get_order_preview': {
        const { platform: platformName } = args as any;
        const platform = platforms.get(platformName);
        if (!platform) {
          return { content: [{ type: 'text', text: `❌ Platform not initialized. Search first.` }] };
        }

        const preview = await platform.getOrderPreview();
        if (!preview) {
          return {
            content: [{ type: 'text', text: `❌ Could not build an order preview on ${platformName.toUpperCase()} (empty cart or checkout unavailable).` }],
          };
        }

        const { cart } = preview;
        let responseText = `🧾 **Order Preview - ${platformName.toUpperCase()}** (nothing has been charged)\n\n`;
        for (const item of cart.items) {
          responseText += `${item.cartQuantity}x ${item.name} - ₹${item.price * item.cartQuantity}\n`;
        }
        responseText += `\nSubtotal: ₹${cart.subtotal}\nFees: ₹${cart.deliveryFee}\n**To pay: ₹${cart.total}**\n`;
        responseText += `\n📍 Deliver to: ${preview.address || 'unknown'}\n`;
        responseText += `💳 Payment options: ${preview.paymentMethods.join(', ') || 'none detected'}`;

        return { content: [{ type: 'text', text: responseText }] };
      }

      case 'place_order': {
        const { platform: platformName, payment_method, confirm_token, upi_id, card_last4 } = args as any;
        const platform = platforms.get(platformName);
        if (!platform) return { content: [{ type: 'text', text: `❌ Platform not initialized. Search first.` }] };
        const say = (text: string) => ({ content: [{ type: 'text', text }] });

        const method = String(payment_method ?? '').toLowerCase();
        const allowed = SUPPORTED_PAYMENTS[platformName] ?? [];
        if (!allowed.includes(method)) {
          return say(`❌ "${payment_method}" is not supported on ${platformName}. Supported there: ${allowed.join(', ')}. (UPI collect: Blinkit only; UPI QR: Zepto only; cards, wallets and netbanking are not supported.) Ask the user to pick another mode.`);
        }
        if (method === 'upi' && !upi_id) return say('❌ UPI selected: ask the user for their UPI ID (name@bank) and pass it as upi_id.');

        if (method === 'card' && !card_last4) return say('❌ Card selected: ask the user which saved card (last 4 digits) and pass it as card_last4.');

        if (!confirm_token) {
          const r = await platform.placeOrder(payment_method, false, method === 'card' ? card_last4 : upi_id);
          if (!r.ready) return say(`❌ ${r.message}`);
          const preview = await platform.getCart();
          const token = randomUUID();
          orderTokens.set(token, { platform: platformName, total: r.total!, expires: Date.now() + 5 * 60_000 });
          const items = preview?.items.map(i => `${i.cartQuantity}x ${i.name}`).join(', ') ?? '';
          return say(`🛑 **Ready to place — NOT yet ordered.**\n${items}\n**To pay: ₹${r.total} (${method === 'upi' ? `UPI collect request to ${upi_id}; the user approves it on their phone` : method === 'upi_qr' ? 'UPI QR code; the user scans it with any UPI app' : method === 'card' ? `saved card ending ${card_last4}; may ask the user for a bank OTP` : 'Cash on Delivery'})**\nTo place this order, get the user's explicit approval, then call place_order again with the same payment_method${payment_method === 'upi' ? ' and upi_id' : ''} and confirm_token: ${token} (valid 5 min).`);
        }

        const t = orderTokens.get(confirm_token);
        orderTokens.delete(confirm_token); // one-time
        if (!t || t.platform !== platformName || t.expires < Date.now()) {
          return say('❌ Invalid or expired confirm_token. Run the first step again.');
        }
        const r = await platform.placeOrder(payment_method, true);
        const out: any[] = [{ type: 'text', text: `${r.success ? '✅' : '❌'} ${r.message}` }];
        if (r.image) out.push({ type: 'image', data: r.image.toString('base64'), mimeType: 'image/png' });
        return { content: out };
      }

      case 'compare_prices': {
        const { items } = args as { items: { name: string; quantity: number; preferredBrand?: string }[] };

        // ponytail: sequential, item prices only (delivery/handling fees vary
        // with cart value and aren't known until checkout).
        const basket = new Map<string, number>(ALL_PLATFORMS.map(n => [n, 0]));
        const missing = new Map<string, string[]>(ALL_PLATFORMS.map(n => [n, []]));
        let splitTotal = 0;
        let text = `📊 **Price comparison** (item prices only, fees excluded)\n\n`;

        for (const item of items) {
          const query = item.preferredBrand ? `${item.preferredBrand} ${item.name}` : item.name;
          const found: Product[] = [];
          for (const platformName of ALL_PLATFORMS) {
            const r = await searchOn(platformName, query);
            if (!('error' in r)) found.push(...relevant(query, r.products));
          }
          const ranked = rankByUnitPrice(found);
          text += `**${query}** ×${item.quantity}\n`;
          for (const platformName of ALL_PLATFORMS) {
            const best = ranked.find(x => x.p.platform === platformName);
            if (!best) {
              missing.get(platformName)!.push(query);
              text += `- ${platformName}: not found\n`;
              continue;
            }
            basket.set(platformName, basket.get(platformName)! + best.p.price * item.quantity);
            text += `- ${platformName}: ${best.p.name} (${best.p.quantity}) ₹${best.p.price} — ₹${best.u.value.toFixed(2)}/${best.u.label} — ID \`${best.p.id}\`\n`;
          }
          if (ranked[0]) {
            splitTotal += ranked[0].p.price * item.quantity;
            text += `  ✅ Cheapest: ${ranked[0].p.platform}\n`;
          }
          text += '\n';
        }

        text += `🧺 **Whole basket on one platform**\n`;
        for (const platformName of ALL_PLATFORMS) {
          const miss = missing.get(platformName)!;
          text += `- ${platformName}: ₹${basket.get(platformName)}${miss.length ? ` (missing: ${miss.join(', ')})` : ''}\n`;
        }
        text += `\n🔀 **Cheapest split across platforms**: ₹${splitTotal}\n`;

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'remove_from_cart': {
        const { platform: platformName, item } = args as any;
        const platform = platforms.get(platformName);
        if (!platform) {
          return {
            content: [{ type: 'text', text: `❌ Platform not initialized. Search first.` }],
          };
        }
        const removed = await platform.removeFromCart(item);
        return {
          content: [
            {
              type: 'text',
              text: removed
                ? `✅ Removed "${item}" from ${platformName.toUpperCase()} cart`
                : `❌ Could not remove "${item}" (name not in cart?) on ${platformName.toUpperCase()}`,
            },
          ],
        };
      }

      case 'list_addresses': {
        const { platform: platformName } = args as any;
        const platform = await getPlatform(platformName);
        const addrs = await platform.getAddresses();
        const text = addrs.length
          ? addrs.map((a) => `[${a.id}] ${a.label}: ${a.addressLine1}${a.pincode ? ` (${a.pincode})` : ''}`).join('\n')
          : `❌ No saved addresses found on ${platformName.toUpperCase()} (logged in?)`;
        return { content: [{ type: 'text', text }] };
      }

      case 'select_address': {
        const { platform: platformName, address_id } = args as any;
        const platform = await getPlatform(platformName);
        const ok = await platform.selectAddress(String(address_id));
        return {
          content: [
            {
              type: 'text',
              text: ok
                ? `✅ Delivery address on ${platformName.toUpperCase()} set to #${address_id}`
                : `❌ Could not select address #${address_id} on ${platformName.toUpperCase()} (bad id? run list_addresses)`,
            },
          ],
        };
      }

      case 'clear_cart': {
        const { platform: platformName, confirm } = args as any;
        
        if (!confirm) {
          return {
            content: [
              {
                type: 'text',
                text: `⚠️ This will clear your entire cart on ${platformName.toUpperCase()}.\n\nSet confirm: true to proceed.`,
              },
            ],
          };
        }

        const platform = platforms.get(platformName);
        if (!platform) {
          return {
            content: [{ type: 'text', text: `❌ Platform not initialized.` }],
          };
        }

        const success = await platform.clearCart();
        
        return {
          content: [
            {
              type: 'text',
              text: success 
                ? `✅ Cart cleared on ${platformName.toUpperCase()}`
                : `❌ Failed to clear cart`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `❌ Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Quick Commerce MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * MCP Server Entry Point
 * Implements Model Context Protocol for quick commerce aggregation
 */
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

// All platforms supported by the "all" shorthand in tool inputs.
const ALL_PLATFORMS = ['zepto', 'swiggy-instamart', 'blinkit'];

function resolvePlatforms(list: string | string[]): string[] {
  const names = ([] as string[]).concat(list);
  return names.includes('all') ? ALL_PLATFORMS : names;
}

// Price per 100 ml/g (or per piece) so different pack sizes compare fairly.
// ponytail: handles "450 ml", "1 L", "2 x 500 g", "6 pcs"; anything else is
// ranked by raw price.
function unitPrice(p: Product): { value: number; label: string } {
  const m = p.quantity?.toLowerCase().match(/(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*(ml|l|ltr|litre|g|gm|kg|pc|pcs|pieces?|units?)\b/);
  if (!m) return { value: p.price, label: 'pack' };
  const amount = Number(m[1] || 1) * Number(m[2]);
  const unit = m[3];
  if (unit === 'ml' || unit === 'g' || unit === 'gm') return { value: (p.price / amount) * 100, label: unit === 'ml' ? '100 ml' : '100 g' };
  if (unit === 'kg' || unit.startsWith('l')) return { value: p.price / (amount * 10), label: unit === 'kg' ? '100 g' : '100 ml' };
  return { value: p.price / amount, label: 'pc' };
}

// In-stock products whose name contains every query word.
// ponytail: literal word match ("coke" won't match "Coca-Cola"); add synonyms if it bites.
function relevant(query: string, products: Product[]): Product[] {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/s$/, ''));
  return products.filter(p => p.inStock && words.every(w => p.name.toLowerCase().includes(w)));
}

// Cheapest first by unit price, ranking only the most common unit so ₹/100 ml
// isn't compared against ₹/pc.
function rankByUnitPrice(products: Product[]): { p: Product; u: { value: number; label: string } }[] {
  const priced = products.map(p => ({ p, u: unitPrice(p) }));
  if (priced.length === 0) return [];
  const counts = new Map<string, number>();
  for (const { u } of priced) counts.set(u.label, (counts.get(u.label) || 0) + 1);
  const unit = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  return priced.filter(x => x.u.label === unit).sort((a, b) => a.u.value - b.u.value);
}

// Logged-in search on one platform; errors are returned, not thrown.
async function searchOn(platformName: string, query: string, pincode?: string): Promise<SearchResult | { platform: string; error: string }> {
  try {
    const platform = await getPlatform(platformName);
    const login = await platform.checkLogin();
    if (!login.loggedIn) return { platform: platformName, error: 'Not logged in' };
    return await platform.search(query, pincode);
  } catch (error: any) {
    return { platform: platformName, error: error.message };
  }
}

// Store active platform instances, each with its own browser context so
// sessions (and any bot-detection fallout) stay isolated per platform.
const platforms: Map<string, QuickCommercePlatform> = new Map();
const browsers: Map<string, StealthBrowser> = new Map();

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'search_products',
    description: 'Search for products across quick commerce platforms (Zepto, Swiggy Instamart, Blinkit). When multiple platforms return results, includes a cheapest-first comparison by unit price.',
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
        pincode: {
          type: 'string',
          description: 'Delivery pincode (optional - uses saved address if not provided)',
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
        const { query, platforms: platformList, pincode } = args as any;
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

            const searchResult = await platform.search(query, pincode);
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
              content: [{ type: 'text', text: `✅ Successfully logged in to ${platformName}` }],
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
          results.push({ name: item.name, success });
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

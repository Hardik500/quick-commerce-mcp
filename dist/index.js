#!/usr/bin/env node
/**
 * MCP Server Entry Point
 * Implements Model Context Protocol for quick commerce aggregation
 */
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { ZeptoPlatform } from './platforms/zepto.js';
import { SwiggyInstamartPlatform } from './platforms/swiggy-instamart.js';
import { BlinkitPlatform } from './platforms/blinkit.js';
import { StealthBrowser } from './engine/stealth-browser.js';
import { sessionPath } from './session-helper.js';
import { loadPrefs, savePrefs } from './preferences.js';
import { singleFlight } from './single-flight.js';
import { keyedLock } from './keyed-lock.js';
import { FLOW_STEPS, clearFlow, fingerprint, loadFlows, saveFlow, selfRepair, verifyFlow } from './flows.js';
import * as fs from 'node:fs';
import { relevant, rankByUnitPrice, resolveItem, unitPrice, validateCart } from './ranking.js';
// One line per fee; platforms without itemisation fall back to a lump "Fees" line.
// What the caller should do about a store banner.
function noticeAdvice(notice) {
    return /add address/i.test(notice)
        ? 'No delivery address is active on this session; call list_addresses then select_address, and retry.'
        : 'Checkout is not possible right now; try again later or another platform.';
}
function feeLines(cart) {
    const fees = cart.fees?.length ? cart.fees : cart.deliveryFee ? [{ label: 'Fees', amount: cart.deliveryFee }] : [];
    return fees.map(f => `${f.label}: ₹${f.amount}\n`).join('');
}
// All platforms supported by the "all" shorthand in tool inputs.
const ALL_PLATFORMS = ['zepto', 'swiggy-instamart', 'blinkit'];
function resolvePlatforms(list) {
    const names = [].concat(list);
    return names.includes('all') ? ALL_PLATFORMS : names;
}
// Logged-in search on one platform; errors are returned, not thrown.
async function searchOn(platformName, query) {
    try {
        const platform = await getPlatform(platformName);
        const login = await platform.checkLogin();
        if (!login.loggedIn)
            return { platform: platformName, error: 'Not logged in' };
        return await platform.search(query);
    }
    catch (error) {
        return { platform: platformName, error: error.message };
    }
}
// Store active platform instances, each with its own browser context so
// sessions (and any bot-detection fallout) stay isolated per platform.
const platforms = new Map();
const browsers = new Map();
// One operation per platform at a time - see src/keyed-lock.ts.
const platformLocks = keyedLock();
// One-time confirm tokens for place_order (step 2 must present the token from step 1).
const orderTokens = new Map();
// Payment modes place_order can drive, per platform. Anything else gets a friendly refusal.
const SUPPORTED_PAYMENTS = {
    blinkit: ['cod', 'upi', 'card'],
    zepto: ['cod', 'upi_qr', 'card'],
    swiggy: ['cod'],
    'swiggy-instamart': ['cod'],
};
/** Asked right after login: tells the agent to collect the payment mode (and UPI ID) up front. */
const PAYMENT_PROMPT = '\n\n💳 Before ordering, ask the user how they want to pay and tell them what is supported:\n- Cash on Delivery ("cod"): Blinkit, Zepto, Instamart\n- UPI collect request ("upi", needs their UPI ID like name@bank; approved on their phone): Blinkit only\n- UPI QR (\"upi_qr\", the user scans a QR we send, valid ~3 min): Zepto only\n- Saved card (\"card", needs the last 4 digits of a saved card; CVV is read from the QC_CVV_<last4> env var on the server): Zepto, Blinkit\n- New cards, wallets, netbanking, Pay Later: not supported.\nIf they choose UPI, ask for the UPI ID now. If they choose a card, ask which saved card (last 4 digits).';
/**
 * Part of the same ask, because Blinkit demands a delivery location *before*
 * login and its geolocation is resolved from the request IP - which is wrong
 * behind a VPN or when the machine's location isn't where the user orders from.
 * The pincode is what lets the connector pick the right store.
 */
const PINCODE_ASK = '\n\n📍 Also ask for their 6-digit pincode and save it with set_preferences(pincode: "560001"). ' +
    'Blinkit asks for a delivery location before login, and its automatic location comes from this ' +
    "machine's IP, which is often not where the user actually orders. If they don't give one, login " +
    'will fail with an error saying so - retry with a pincode rather than retrying unchanged.';
// Tool definitions
const TOOLS = [
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
                    items: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'all'] },
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
                    items: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'all'] },
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
                    enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'],
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
        name: 'resolve_items',
        description: 'Resolve shopping-list items (e.g. "high protein paneer", "coke zero") on ONE platform without touching the cart. For each item returns in-stock matches, or, if there is no exact match or it is out of stock, the closest in-stock alternatives. Present the options and let the user choose before add_to_cart.',
        inputSchema: {
            type: 'object',
            properties: {
                platform: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'], description: 'Platform to search' },
                queries: { type: 'array', items: { type: 'string' }, description: 'Items the user wants' },
            },
            required: ['platform', 'queries'],
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
                    enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'],
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
                    enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'],
                    description: 'Platform to get cart from',
                },
            },
            required: ['platform'],
        },
    },
    {
        name: 'place_order',
        description: 'Order the current cart. Two steps: call without confirm_token to get a summary + token (nothing is charged); call again with that token to place the order. ONLY pass the token after the user has explicitly approved the summary. Always pass payment_method explicitly rather than relying on the saved default - the default is one value for every platform, and the same string means different things on different ones (notably "upi" is Blinkit-only, and Zepto needs "upi_qr").',
        inputSchema: {
            type: 'object',
            properties: {
                platform: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'], description: 'Platform to order on' },
                payment_method: {
                    type: 'string',
                    description: 'Required, and always pass it explicitly. "cod" - Cash on Delivery, all platforms. "upi_qr" - Zepto only; returns a payment QR the user scans, valid a few minutes, and leaves the order pending until they pay. "upi" - Blinkit only; sends a collect request to upi_id that the user approves on their phone. "card" - Zepto and Blinkit; saved card, pass card_last4. An unsupported value is refused with the list that platform does support.',
                },
                upi_id: { type: 'string', description: 'UPI ID (e.g. name@bank); required for payment_method "upi"' },
                card_last4: { type: 'string', description: 'Last 4 digits of the saved card; required for payment_method "card"' },
                confirm_token: { type: 'string', description: 'Token returned by step 1; places the order' },
            },
            required: ['platform', 'payment_method'],
        },
    },
    {
        name: 'get_order_status',
        description: 'Show the most recent order (status, items, total) from order history. Read-only. Supported on Blinkit and Zepto (not yet Instamart).',
        inputSchema: {
            type: 'object',
            properties: { platform: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'], description: 'Platform to check' } },
            required: ['platform'],
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
                    enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'],
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
        name: 'request_otp',
        description: 'Start login: enter the phone number on the platform and trigger the OTP SMS. Then call submit_otp. Phone defaults to the saved one (set_preferences). Blinkit also needs a saved pincode, or the request fails on its pre-login location check - ask the user for it and call set_preferences(pincode) if this fails. To switch numbers, call logout first. Supported on Blinkit, Zepto and Instamart.',
        inputSchema: {
            type: 'object',
            properties: {
                platform: { type: 'string', enum: ['zepto', 'swiggy-instamart', 'blinkit'] },
                phone: { type: 'string', description: '10-digit mobile number (optional if saved)' },
            },
            required: ['platform'],
        },
    },
    {
        name: 'logout',
        description: 'Delete the saved session for a platform (e.g. to log in with a different phone number).',
        inputSchema: {
            type: 'object',
            properties: { platform: { type: 'string', enum: ['zepto', 'swiggy-instamart', 'blinkit'] } },
            required: ['platform'],
        },
    },
    {
        name: 'set_preferences',
        description: 'Save defaults used before ordering: phone (for login), pincode (6-digit delivery pincode - Blinkit asks for a location before login and cannot infer the right store from this machine\'s IP), upi_id (name@bank), payment_method (cod/upi/upi_qr/card), open_qr ("true" to open each payment QR in an image viewer - worth suggesting, because this app clips QR images sent inline and they will not scan from the chat). Ask for all of these once during onboarding, then pass an empty string to clear a value. Call with no arguments to just read the saved values.',
        inputSchema: {
            type: 'object',
            properties: {
                phone: { type: 'string' },
                upi_id: { type: 'string' },
                payment_method: { type: 'string' },
                pincode: { type: 'string' },
                open_qr: { type: 'string', description: '"true" opens each payment QR in an image viewer as soon as it is generated. Off by default.' },
            },
        },
    },
    {
        name: 'diagnose_flow',
        description: 'Repair a broken browser flow without a code change or update. Returns every interactive element currently on the page (with the attributes that identify it) so a working selector can be chosen, and can save that selector so all later runs use it. Call this when a flow fails with a selector/timeout error, before asking the user to do anything manual.',
        inputSchema: {
            type: 'object',
            properties: {
                platform: { type: 'string', enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'], description: 'Platform whose flow broke' },
                step: { type: 'string', enum: FLOW_STEPS, description: 'Which step to inspect/repair' },
                selector: { type: 'string', description: 'New CSS selector for that step. Omit to only inspect the page.' },
                apply: { type: 'boolean', description: 'Set true to save the selector (verified against the live page first). Defaults to false so you can review the page fingerprint before committing.' },
                auto: { type: 'boolean', description: 'Set true to let the server repair the step itself: it enumerates the live page, ranks candidates by intent, and adopts one only after performing the step against it and confirming it worked. It refuses to guess when nothing can be proven, so this is safe to try before involving the user.' },
            },
            required: ['platform', 'step'],
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
                    enum: ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit'],
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
//
// singleFlight, not a plain has/set cache: launching a browser is awaited work,
// so two concurrent callers would otherwise each launch their own context for the
// same platform. See src/single-flight.ts for what that cost in practice.
const getPlatform = singleFlight(async (name) => {
    let platform;
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
    return platform;
});
// Server setup
const server = new Server({
    name: 'quick-commerce-mcp',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // Every platform is driven through one shared Playwright page, so two calls
    // touching the same platform would abort each other's navigation and scrape
    // each other's DOM. Serialise per platform; different platforms stay parallel.
    return platformLocks.run(platformKeysOf(args), () => handle(name, args));
});
// Which platforms a call will drive, used to pick the lock keys. "all" expands
// inside the handlers, so it is dropped here and those calls simply don't lock.
function platformKeysOf(args) {
    const keys = [];
    if (typeof args?.platform === 'string')
        keys.push(args.platform);
    if (Array.isArray(args?.platforms)) {
        for (const p of args.platforms)
            if (typeof p === 'string' && p !== 'all')
                keys.push(p);
    }
    return keys;
}
async function handle(name, args) {
    try {
        switch (name) {
            case 'search_products': {
                const { query, platforms: platformList } = args;
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
                        if (loginStatus.otpSent) {
                            return {
                                content: [
                                    {
                                        type: 'text',
                                        text: `🔐 OTP required for ${platformName}${loginStatus.phone ? `\nPhone: ${loginStatus.phone}` : ''}\n\nPlease provide the OTP to continue.`,
                                    },
                                ],
                            };
                        }
                        const searchResult = await platform.search(query);
                        results.push(searchResult);
                    }
                    catch (error) {
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
                    }
                    else {
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
                const ok = results.filter((r) => !('error' in r) && r.products.length > 0);
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
                const { platforms: platformList } = args;
                const statuses = [];
                for (const platformName of resolvePlatforms(platformList)) {
                    try {
                        const platform = await getPlatform(platformName);
                        const status = await platform.checkLogin();
                        statuses.push({ platform: platformName, ...status });
                    }
                    catch (error) {
                        statuses.push({ platform: platformName, error: error.message });
                    }
                }
                let responseText = '🔐 Login Status:\n\n';
                for (const status of statuses) {
                    if ('error' in status) {
                        responseText += `❌ ${status.platform}: ${status.error}\n`;
                    }
                    else if (status.loggedIn) {
                        responseText += `✅ ${status.platform}: Logged in\n`;
                    }
                    else if (status.otpSent) {
                        responseText += `⏳ ${status.platform}: OTP sent${status.phone ? ` to ${status.phone}` : ''}\n`;
                    }
                    else {
                        responseText += `❌ ${status.platform}: Not logged in\n`;
                    }
                }
                if (statuses.some(s => 'loggedIn' in s && s.loggedIn))
                    responseText += PAYMENT_PROMPT;
                // Only nag while it's still missing - repeating it on every later call
                // would just be noise once the user has given it.
                if (!loadPrefs().pincode)
                    responseText += PINCODE_ASK;
                return {
                    content: [{ type: 'text', text: responseText }],
                };
            }
            case 'submit_otp': {
                const { platform: platformName, otp } = args;
                try {
                    const platform = await getPlatform(platformName);
                    if (!platform) {
                        return {
                            content: [{ type: 'text', text: `❌ Platform ${platformName} could not be initialised.` }],
                        };
                    }
                    const success = await platform.submitOtp(otp);
                    if (success) {
                        const pincodeAsk = loadPrefs().pincode ? '' : PINCODE_ASK;
                        return {
                            content: [{ type: 'text', text: `✅ Successfully logged in to ${platformName}${PAYMENT_PROMPT}${pincodeAsk}` }],
                        };
                    }
                    else {
                        // The platform has nothing to add, so don't send the user off to
                        // re-check a code the platform never actually judged.
                        return {
                            content: [{ type: 'text', text: `❌ ${platformName} did not complete the login. Check the OTP screen in the browser; if it is gone, call check_login_status to see whether the session was saved.` }],
                        };
                    }
                }
                catch (error) {
                    return {
                        content: [{ type: 'text', text: `❌ Error: ${error.message}` }],
                    };
                }
            }
            case 'add_to_cart': {
                const { platform: platformName, items, confirm } = args;
                if (!confirm) {
                    // Preview mode
                    let previewText = `🛒 Cart Preview for **${platformName.toUpperCase()}**\n\n`;
                    for (const item of items)
                        previewText += `- ${item.quantity}x ${item.name ?? item.productId}\n`;
                    // No price is shown here: the real prices and fees only exist once items are in the cart.
                    previewText += `\nPrices and fees are shown after adding (nothing is charged by adding to cart).\n`;
                    previewText += `⚠️ Set \`confirm: true\` to add these items to cart.`;
                    return {
                        content: [{ type: 'text', text: previewText }],
                    };
                }
                // Actually add to cart
                const platform = await getPlatform(platformName);
                if (!platform) {
                    return {
                        content: [{ type: 'text', text: `❌ Platform ${platformName} could not be initialised.` }],
                    };
                }
                // search_products establishes login state before searching; add_to_cart has
                // to do the same, because search() refuses to run without it. Skipping
                // this left the search throwing "Not logged in", which the catch below
                // swallowed, so the add then ran against the cart page and reported
                // "Product not found" for an item that was perfectly findable.
                const login = await platform.checkLogin().catch(() => ({ loggedIn: false }));
                if (!login.loggedIn) {
                    return {
                        content: [{ type: 'text', text: `❌ Not logged in on ${platformName}. Call request_otp for ${platformName} first.` }],
                    };
                }
                // Items already in the cart have no ADD button; skip them (validation below flags quantity differences).
                const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
                const existing = (await platform.getCart().catch(() => null))?.items ?? [];
                const results = [];
                for (const item of items) {
                    if (item.name && existing.some(e => norm(e.name) === norm(item.name))) {
                        results.push({ name: item.name, success: true, already: true });
                        continue;
                    }
                    // addToCart clicks the product card on the current page, so bring the
                    // card up first. Product names carry a pack size ("... (750 ml)") that
                    // the site itself omits from card labels, and searching for the full
                    // string can return nothing at all - search on the product itself.
                    if (item.name) {
                        const query = item.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
                        // Don't swallow this: if the lookup fails, say so, rather than
                        // letting addToCart report a misleading "product not found".
                        const found = await platform.search(query || item.name).catch((e) => {
                            results.push({ name: item.name, success: false, already: false, error: e.message.split('\n')[0] });
                            return null;
                        });
                        if (!found)
                            continue;
                    }
                    const success = await platform.addToCart(item.productId, item.quantity);
                    results.push({ name: item.name ?? item.productId, success, already: false });
                }
                const failed = results.filter(r => !r.success).length;
                let responseText = `${failed ? '⚠️' : '✅'} Added to cart on **${platformName.toUpperCase()}**${failed ? ` (${failed} of ${results.length} failed)` : ''}:\n\n`;
                for (const result of results) {
                    const why = result.already ? ' (already in cart, not re-added)' : result.success ? '' : ` (failed${result.error ? `: ${result.error}` : ''})`;
                    responseText += `${result.already ? '✓' : result.success ? '✓' : '✗'} ${result.name}${why}\n`;
                }
                // Verify against the real cart, not just the click results.
                const cart = await platform.getCart();
                if (!cart)
                    responseText += `\n⚠️ Could not read the cart back to verify.\n`;
                else {
                    if (cart.notice)
                        responseText += `\n🚫 **Store notice: ${cart.notice}** - ${noticeAdvice(cart.notice)}\n`;
                    const v = validateCart(items.map((i) => ({ name: i.name ?? '', quantity: i.quantity })).filter((i) => i.name), cart);
                    if (v.missing.length || v.wrongQty.length || !v.billOk) {
                        responseText += `\n⚠️ **Cart validation failed**\n`;
                        v.missing.forEach(m => responseText += `- Not in cart: ${m}\n`);
                        v.wrongQty.forEach(m => responseText += `- Quantity mismatch: ${m}\n`);
                        if (!v.billOk)
                            responseText += `- Items + fees do not add up to the total; re-check before paying\n`;
                        responseText += `Ask the user whether to retry, pick alternatives (resolve_items) or continue.\n`;
                    }
                    else
                        responseText += `\n✅ Cart validated: all items present, bill adds up.\n`;
                    responseText += `\nItems total: ₹${cart.subtotal}\n${feeLines(cart)}**To pay: ₹${cart.total}**\n`;
                }
                return {
                    content: [{ type: 'text', text: responseText }],
                };
            }
            case 'get_cart_summary': {
                const { platform: platformName } = args;
                const platform = await getPlatform(platformName);
                if (!platform) {
                    return {
                        content: [{ type: 'text', text: `❌ Platform ${platformName} could not be initialised.` }],
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
                responseText += feeLines(cart);
                responseText += `**Total: ₹${cart.total}**`;
                return {
                    content: [{ type: 'text', text: responseText }],
                };
            }
            case 'get_order_status': {
                const platform = platforms.get(args.platform);
                if (!platform)
                    return { content: [{ type: 'text', text: `❌ Platform not initialized. Search first.` }] };
                const text = await platform.getLatestOrder();
                return { content: [{ type: 'text', text: text ?? 'No order found (or not supported on this platform yet).' }] };
            }
            case 'get_order_preview': {
                const { platform: platformName } = args;
                const platform = await getPlatform(platformName);
                if (!platform) {
                    return { content: [{ type: 'text', text: `❌ Platform ${platformName} could not be initialised.` }] };
                }
                const preview = await platform.getOrderPreview();
                if (!preview) {
                    const notice = (await platform.getCart().catch(() => null))?.notice;
                    return {
                        content: [{ type: 'text', text: notice
                                    ? `🚫 ${platformName.toUpperCase()} cannot take orders right now: "${notice}". ${noticeAdvice(notice)}`
                                    : `❌ Could not build an order preview on ${platformName.toUpperCase()} (empty cart or checkout unavailable).` }],
                    };
                }
                const { cart } = preview;
                let responseText = `🧾 **Order Preview - ${platformName.toUpperCase()}** (nothing has been charged)\n\n`;
                for (const item of cart.items) {
                    responseText += `${item.cartQuantity}x ${item.name} - ₹${item.price * item.cartQuantity}\n`;
                }
                responseText += `\nItems total: ₹${cart.subtotal}\n${feeLines(cart)}**To pay: ₹${cart.total}**\n`;
                responseText += `\n📍 Deliver to: ${preview.address || 'unknown'}\n`;
                responseText += `💳 Payment options: ${preview.paymentMethods.join(', ') || 'none detected'}`;
                return { content: [{ type: 'text', text: responseText }] };
            }
            case 'request_otp': {
                const { platform: platformName, phone } = args;
                const number = String(phone ?? loadPrefs().phone ?? '').replace(/\D/g, '').slice(-10);
                if (number.length !== 10)
                    return { content: [{ type: 'text', text: '❌ Need a 10-digit phone number (pass phone, or save it with set_preferences).' }] };
                // A pincode on file is what unblocks Blinkit's pre-login location
                // check. Warn before the attempt, but still try: geolocation may resolve
                // it without a pincode.
                const preflight = platformName === 'blinkit' && !loadPrefs().pincode ? PINCODE_ASK + '\n\n' : '';
                try {
                    const ok = await (await getPlatform(platformName)).sendOtp(number);
                    const msg = ok
                        ? `📲 OTP sent to ${number} on ${platformName}. Ask the user for it, then call submit_otp.`
                        : `❌ ${platformName}: OTP screen did not appear. Already logged in? Try check_login_status, or logout first.`;
                    return { content: [{ type: 'text', text: preflight + msg }] };
                }
                catch (e) {
                    return { content: [{ type: 'text', text: `❌ ${e.message}` }] };
                }
            }
            case 'logout': {
                const { platform: platformName } = args;
                await browsers.get(platformName)?.close();
                browsers.delete(platformName);
                platforms.delete(platformName);
                // Forget the memoised instance too, or the next call would hand back the
                // context we just closed.
                getPlatform.invalidate(platformName);
                fs.rmSync(sessionPath(platformName), { force: true });
                return { content: [{ type: 'text', text: `🚪 ${platformName}: session deleted. Use request_otp to log in again.` }] };
            }
            case 'set_preferences': {
                const { phone, upi_id, payment_method, pincode, open_qr } = args;
                const p = savePrefs({ phone, upi_id, payment_method, pincode, open_qr });
                let out = `⚙️ Saved preferences: phone=${p.phone ?? '-'}, pincode=${p.pincode ?? '-'}, upi_id=${p.upi_id ?? '-'}, payment_method=${p.payment_method ?? '-'}, open_qr=${p.open_qr ?? 'false'}`;
                // A pincode that isn't a pincode can't be typed into Blinkit's
                // location search, and it fails much later as a confusing "matched no
                // suggestion" - so reject it here.
                if (p.pincode && !/^\d{6}$/.test(p.pincode)) {
                    out += `\n⚠️ "${p.pincode}" is not a 6-digit pincode; Blinkit's location search will not match it. Re-save with set_preferences(pincode: "560001") or pass '' to clear it.`;
                }
                return { content: [{ type: 'text', text: out }] };
            }
            case 'place_order': {
                const prefs = loadPrefs();
                const a = args;
                const { platform: platformName, confirm_token, card_last4 } = a;
                const payment_method = a.payment_method ?? prefs.payment_method;
                const upi_id = a.upi_id ?? prefs.upi_id;
                const platform = await getPlatform(platformName);
                if (!platform)
                    return { content: [{ type: 'text', text: `❌ Platform ${platformName} could not be initialised.` }] };
                const say = (text) => ({ content: [{ type: 'text', text }] });
                const method = String(payment_method ?? '').toLowerCase();
                const allowed = SUPPORTED_PAYMENTS[platformName] ?? [];
                if (!allowed.includes(method)) {
                    return say(`❌ "${payment_method}" is not supported on ${platformName}. Supported there: ${allowed.join(', ')}. (UPI collect: Blinkit only; UPI QR: Zepto only; saved cards: Zepto and Blinkit; new cards, wallets and netbanking are not supported.) Ask the user to pick another mode.`);
                }
                if (method === 'upi' && !upi_id)
                    return say('❌ UPI selected: ask the user for their UPI ID (name@bank) and pass it as upi_id.');
                if (method === 'card' && !card_last4)
                    return say('❌ Card selected: ask the user which saved card (last 4 digits) and pass it as card_last4.');
                if (!confirm_token) {
                    // Read the cart BEFORE arming: getCart navigates away and would disarm the checkout screen.
                    const preview = await platform.getCart();
                    const r = await platform.placeOrder(payment_method, false, method === 'card' ? card_last4 : upi_id);
                    if (!r.ready)
                        return say(`❌ ${r.message}`);
                    const token = randomUUID();
                    orderTokens.set(token, { platform: platformName, total: r.total, expires: Date.now() + 5 * 60_000 });
                    const items = preview?.items.map(i => `${i.cartQuantity}x ${i.name}`).join(', ') ?? '';
                    return say(`🛑 **Ready to place — NOT yet ordered.**\n${items}\n**To pay: ₹${r.total} (${method === 'upi' ? `UPI collect request to ${upi_id}; the user approves it on their phone` : method === 'upi_qr' ? 'UPI QR code; the user scans it with any UPI app' : method === 'card' ? `saved card ending ${card_last4}; may ask the user for a bank OTP` : 'Cash on Delivery'})**\nTo place this order, get the user's explicit approval, then call place_order again with the same payment_method${payment_method === 'upi' ? ' and upi_id' : ''} and confirm_token: ${token} (valid 5 min).`);
                }
                const t = orderTokens.get(confirm_token);
                orderTokens.delete(confirm_token); // one-time
                if (!t || t.platform !== platformName || t.expires < Date.now()) {
                    return say('❌ Invalid or expired confirm_token. Run the first step again.');
                }
                const r = await platform.placeOrder(payment_method, true);
                const out = [{ type: 'text', text: `${r.success ? '✅' : '❌'} ${r.message}` }];
                // Clients cap tool results at ~1MB and drop anything larger without
                // saying so, so images are captured at CSS scale as JPEG (see
                // SCREENSHOT_OPTS). The mime type has to follow the buffer.
                if (r.image) {
                    const isJpeg = r.image[0] === 0xff && r.image[1] === 0xd8;
                    out.push({ type: 'image', data: r.image.toString('base64'), mimeType: isJpeg ? 'image/jpeg' : 'image/png' });
                }
                return { content: out };
            }
            case 'resolve_items': {
                const { platform: platformName, queries } = args;
                const say = (text) => ({ content: [{ type: 'text', text }] });
                const platform = await getPlatform(platformName);
                const login = await platform.checkLogin();
                if (!login.loggedIn)
                    return say(`❌ Not logged in on ${platformName}.`);
                let text = `🔎 **Item resolution - ${platformName.toUpperCase()}** (nothing added to cart)\n`;
                for (const q of queries) {
                    const res = resolveItem(q, (await platform.search(q)).products);
                    const head = res.status === 'match' ? `✅ "${q}": matches found (pick one)`
                        : res.status === 'alternatives' ? `⚠️ "${q}": ${res.outOfStock ? 'exact match is out of stock' : 'no exact match'}; closest in-stock options (ask the user to choose)`
                            : `❌ "${q}": nothing in stock${res.outOfStock ? ' (exact match is out of stock)' : ''}; ask the user for a different item or platform`;
                    text += `\n${head}\n`;
                    res.options.forEach((p, i) => {
                        const u = unitPrice(p);
                        text += `${i + 1}. ${p.name} (${p.quantity}) - ₹${p.price} (₹${u.value.toFixed(1)}/${u.label}) ID: \`${p.id}\`\n`;
                    });
                }
                return say(text + '\nAdd the user\'s chosen products with add_to_cart, then show get_order_preview.');
            }
            case 'compare_prices': {
                const { items } = args;
                // ponytail: sequential, item prices only (delivery/handling fees vary
                // with cart value and aren't known until checkout).
                const basket = new Map(ALL_PLATFORMS.map(n => [n, 0]));
                const missing = new Map(ALL_PLATFORMS.map(n => [n, []]));
                let splitTotal = 0;
                let text = `📊 **Price comparison** (item prices only, fees excluded)\n\n`;
                for (const item of items) {
                    const query = item.preferredBrand ? `${item.preferredBrand} ${item.name}` : item.name;
                    const found = [];
                    for (const platformName of ALL_PLATFORMS) {
                        const r = await searchOn(platformName, query);
                        if (!('error' in r))
                            found.push(...relevant(query, r.products));
                    }
                    const ranked = rankByUnitPrice(found);
                    text += `**${query}** ×${item.quantity}\n`;
                    for (const platformName of ALL_PLATFORMS) {
                        const best = ranked.find(x => x.p.platform === platformName);
                        if (!best) {
                            missing.get(platformName).push(query);
                            text += `- ${platformName}: not found\n`;
                            continue;
                        }
                        basket.set(platformName, basket.get(platformName) + best.p.price * item.quantity);
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
                    const miss = missing.get(platformName);
                    text += `- ${platformName}: ₹${basket.get(platformName)}${miss.length ? ` (missing: ${miss.join(', ')})` : ''}\n`;
                }
                text += `\n🔀 **Cheapest split across platforms**: ₹${splitTotal}\n`;
                return {
                    content: [{ type: 'text', text }],
                };
            }
            case 'remove_from_cart': {
                const { platform: platformName, item } = args;
                const platform = await getPlatform(platformName);
                if (!platform) {
                    return {
                        content: [{ type: 'text', text: `❌ Platform ${platformName} could not be initialised.` }],
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
                const { platform: platformName } = args;
                const platform = await getPlatform(platformName);
                const addrs = await platform.getAddresses();
                const text = addrs.length
                    ? addrs.map((a) => `[${a.id}] ${a.label}: ${a.addressLine1}${a.pincode ? ` (${a.pincode})` : ''}`).join('\n')
                    : `❌ No saved addresses found on ${platformName.toUpperCase()} (logged in?)`;
                return { content: [{ type: 'text', text }] };
            }
            case 'select_address': {
                const { platform: platformName, address_id } = args;
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
            case 'diagnose_flow': {
                const { platform: platformName, step, selector, apply, auto } = args;
                const say = (text) => ({ content: [{ type: 'text', text }] });
                if (selector === '' || (apply === false && selector === '')) {
                    const cleared = clearFlow(platformName, step);
                    return say(`↩️ ${platformName}.${step} reverted to the built-in selector. Overrides now: ${JSON.stringify(cleared) || 'none'}`);
                }
                let platform;
                try {
                    platform = await getPlatform(platformName);
                }
                catch (e) {
                    return say(`❌ Could not open ${platformName}: ${e.message}`);
                }
                const view = await platform.page;
                if (!view)
                    return say(`❌ ${platformName} has no page loaded.`);
                // Put the page into the state the step lives in, otherwise the diagnosis
                // runs against a screen that never contained the element.
                const prepared = await platform
                    .prepareForStep(step)
                    .then(() => '')
                    .catch((e) => ` (could not reach that screen: ${e.message.split('\n')[0]})`);
                let text = `🔬 ${platformName} · ${step}${prepared}\n`;
                text += `Current overrides: ${JSON.stringify(loadFlows(platformName)) || 'none'}\n\n`;
                text += `Interactive elements on the page now:\n${await fingerprint(view)}\n`;
                if (selector && apply) {
                    // Never persist an unverified selector - one bad entry would wedge
                    // every future run of that step.
                    const ok = await verifyFlow(view, String(selector));
                    if (!ok) {
                        return say(`${text}\n❌ "${selector}" matches nothing on the page, so it was NOT saved. Pick a selector from the list above, or call this again with auto: true to let the server find one itself.`);
                    }
                    const saved = saveFlow(platformName, step, String(selector));
                    return say(`${text}\n✅ Saved ${platformName}.${step} = "${selector}". It will be used ahead of the built-in on every future run, including after an update.\nAll overrides: ${JSON.stringify(saved)}`);
                }
                if (auto || !selector) {
                    // Let the server repair it: enumerate the live DOM, score candidates
                    // by intent, and adopt only the one the step actually works against.
                    const outcome = await selfRepair(view, platformName, step, []);
                    if ('selector' in outcome) {
                        return say(`${text}\n🔧 Repaired itself: ${platformName}.${step} is now "${outcome.selector}" (verified by performing the step against it).`);
                    }
                    return say(`${text}\n🛑 Declined to guess.\n${outcome.blocked}\n` +
                        (outcome.rejected.length ? `\nTried and rejected:\n${outcome.rejected.map(r => '  - ' + r).join('\n')}\n` : '') +
                        'No selector was changed, so the current behaviour is unchanged.');
                }
                return say(text + '\nChoose a selector from the list and re-call with selector: "..." and apply: true - or with auto: true to let the server work it out.');
            }
            case 'clear_cart': {
                const { platform: platformName, confirm } = args;
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
                const platform = await getPlatform(platformName);
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
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `❌ Error: ${error.message}` }],
            isError: true,
        };
    }
}
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
//# sourceMappingURL=index.js.map
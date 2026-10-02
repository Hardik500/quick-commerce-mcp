# 🛒 Quick Commerce MCP

Universal quick commerce aggregation via MCP - compare and order from Zepto, Blinkit, and Swiggy Instamart in one interface.

## ✨ Features

- **Multi-Platform Search**: Find products across all platforms simultaneously
- **Price Comparison**: See which app has the best deal
- **Smart Cart**: Automatically suggest optimal platform split
- **Item Resolution**: `resolve_items` ranks matches per platform; `add_to_cart` validates the cart (items, quantities, bill total) after adding
- **Itemised Bill**: Handling, late-night, GST and other fees listed separately in cart and order preview
- **Addresses**: `list_addresses` / `select_address` (retries once on flaky picker clicks)
- **Store Notices**: Closed/unserviceable stores and "Add address to proceed" are detected and reported with next steps
- **User Control**: Two-step `place_order` (preview token, then confirm); CVV read from `QC_CVV_<last4>`, never logged
- **OTP Handling**: Prompts for OTP when session expires

## 🚀 Quick Start

**Requirements:** Node 18+ and Google Chrome installed (the server drives your Chrome, no browser download).

**1. Log in once per platform** (opens a browser; log in, then press Ctrl+C):

```bash
npx -y -p quick-commerce-mcp quick-commerce-mcp-login zepto   # also: blinkit, swiggy-instamart
```

Sessions are saved to `~/.quick-commerce-mcp/sessions/`.

**2. Add the server to your MCP client** (Claude Desktop, Cursor, Windsurf):

```json
{
  "mcpServers": {
    "quick-commerce": {
      "command": "npx",
      "args": ["-y", "quick-commerce-mcp"]
    }
  }
}
```

Claude Code: `claude mcp add quick-commerce -- npx -y quick-commerce-mcp`

**Setup from chat:** ask your assistant to run `set_preferences` (phone, UPI ID, default payment), `request_otp` then `submit_otp` to log in (Blinkit; other platforms use the CLI above), and `logout` to switch phone numbers. Preferences are saved in `~/.quick-commerce-mcp/preferences.json` and `place_order` uses them as defaults.

**3. Optional, for card payments:** export `QC_CVV_<last4>` in the client's `env` block. UPI needs no secret.

**From source:** `npm install && npm run build`, then point the client at `node /path/to/dist/index.js`.

## 🛠️ Supported Platforms

| Platform | Search | Cart | Order | Notes |
|----------|--------|------|-------|-------|
| Zepto | ✅ | ✅ | 🚧 | Cart, validation, order preview and `get_order_status` (order list) verified live; payment untested |
| Blinkit | ✅ | ✅ | ✅ | Full flow verified live: cart, preview, UPI payment and `get_order_status` (list + latest order detail) |
| Swiggy Instamart | ✅ | ✅ | 🚧 | Cart + validation verified live; order preview success path untested (store was closed/unserviceable); `get_order_status` not supported (orders page unreachable when tested) |
| BigBasket | 🚧 | 🚧 | 🚧 | Coming in v1.1 |

See [AUTHENTICATION.md](AUTHENTICATION.md) for how to log in to a platform and save a session.

## 📝 Usage Examples

### Search for a product
```
"Find Coke Zero 6-pack"
"Where is milk cheapest right now?"
"Search for Maggi noodles on Zepto and Swiggy"
```

### Build a cart
```
"Add to cart: 1L milk, 6 eggs, bread"
"Show me the best platform for these items"
```

### Compare before ordering
```
"Compare prices for my cart"
"What's the cheapest way to get these items?"
```

## 🔐 Security

- **No payment info stored**: We only automate cart building
- **OTP required**: You'll always enter OTP manually
- **Confirm before order**: Preview shown, you confirm final purchase
- **Session isolation**: Each platform login is separate

## 🏗️ Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Claude    │────▶│  MCP Server  │────▶│  Playwright │
│  /Cursor    │◀────│  (this repo) │◀────│  Automation │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                                │
                       ┌─────────┐    ┌─────────┴──────────┐
                       │ SQLite  │    │                    │
                       │  Cache  │    │ Zepto | Swiggy     │
                       └─────────┘    └────────────────────┘
```

## 📋 Roadmap

### v1.0 (Current)
- [x] Zepto automation (login, search, add-to-cart)
- [x] Blinkit automation (login, search, add-to-cart)
- [x] Swiggy Instamart automation (login, search, add-to-cart, cart)
- [x] Price comparison
- [x] Basic cart management (add, get, remove, clear — verified on all 3 platforms)
- [x] Cart validation, itemised bills, store-closed / no-address notices, address selection
- [ ] Payment flows verified live (post-payment/3DS/OTP outcomes still guesses)

### v1.1
- [ ] BigBasket support
- [ ] Scheduled reordering
- [ ] Price alerts

### v1.2
- [ ] Smart recommendations
- [ ] Optimal split calculation
- [ ] Order history tracking

## 🤝 Contributing

This is a personal project. Open to suggestions!

## ⚠️ Disclaimer

This is an unofficial project, not affiliated with Zepto, Blinkit or Swiggy. It automates a real browser logged in as you. Automating these sites may violate their Terms of Service and can get your account rate-limited or blocked; you use it at your own risk.

`place_order` spends real money. It only runs after a two-step confirmation, but always check the order summary your assistant shows you before approving. Sessions (login cookies) are stored unencrypted in `~/.quick-commerce-mcp/sessions/`; keep that folder private.

---

**Created**: 2026-02-12

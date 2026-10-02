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

**Requirements:** Node 18+ and Google Chrome installed (the server drives your Chrome, no browser download). It runs locally over stdio, so it works in local MCP clients (Claude Desktop, Claude Code, Cursor, Windsurf), not hosted web apps.

**1. Add the server to your MCP client.** No install step; `npx` fetches it.

Claude Code:

```bash
claude mcp add quick-commerce -- npx -y quick-commerce-mcp
```

Claude Desktop, Cursor, Windsurf (add to the client's MCP config, then restart it):

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

**2. Set up from chat.** Ask your assistant, for example: "Save my phone 98XXXXXXXX and UPI me@bank, then log me in to Blinkit."

| Tool | What it does |
|------|--------------|
| `set_preferences` | Save phone, pincode, UPI ID, default payment method (`cod`/`upi`/`upi_qr`/`card`). No args = read. Empty string = clear. Stored in `~/.quick-commerce-mcp/preferences.json` |
| `check_login_status` | Is each platform logged in? |
| `request_otp` | Enter the phone number on the platform and send the OTP SMS (phone defaults to the saved one) |
| `submit_otp` | Complete login with the OTP you received |
| `logout` | Delete a platform's saved session (use before switching phone numbers) |
| `diagnose_flow` | Inspect or repair a broken browser flow (e.g. after a site changes its markup) |
| `list_addresses` / `select_address` | Pick the delivery address |

Then shop: `search_products`, `compare_prices`, `resolve_items`, `add_to_cart`, `get_cart_summary`, `get_order_preview`, and finally `place_order` (preview first, then confirm with the token). `place_order` uses your saved UPI ID and payment method unless you override them.

Alternative login from a terminal (opens a browser; log in, then Ctrl+C):

```bash
npx -y -p quick-commerce-mcp quick-commerce-mcp-login zepto   # also: blinkit, swiggy-instamart
```

Sessions are saved to `~/.quick-commerce-mcp/sessions/` and expire eventually; just log in again.

**3. Optional, for card payments:** export `QC_CVV_<last4>` in the client's `env` block. UPI needs no secret.

**From source:** `npm install && npm run build`, then point the client at `node /path/to/dist/index.js`.

## 🛠️ Supported Platforms

| Platform | Search | Cart | Order | Notes |
|----------|--------|------|-------|-------|
| Zepto | ✅ | ✅ | 🚧 | Cart, validation, order preview and `get_order_status` (order list) verified live; payment untested |
| Blinkit | ✅ | ✅ | ✅ | Full flow verified live: cart, preview, UPI payment and `get_order_status` (list + latest order detail) |
| Swiggy Instamart | ✅ | ✅ | 🚧 | Cart + validation verified live; order preview success path untested (store was closed/unserviceable); `get_order_status` not supported (orders page unreachable when tested) |
| BigBasket | 🚧 | 🚧 | 🚧 | Coming in v1.1 |

See [AUTHENTICATION.md](AUTHENTICATION.md) for login troubleshooting - rejected OTPs, missing delivery locations, and how to log in by hand when the automated flow won't cooperate.

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

- **No card data stored**: CVV is read from env only; only phone/UPI ID preferences are saved locally
- **OTP required**: You always supply the OTP yourself
- **Confirm before order**: Preview shown, you confirm final purchase
- **Session isolation**: Each platform login is separate

## 🏗️ Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Claude    │────▶│  MCP Server  │────▶│  Playwright │
│  /Cursor    │◀────│  (this repo) │◀────│  Automation │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                                │
                              ┌─────────┴──────────┐
                              │ Zepto | Blinkit |  │
                              │ Swiggy Instamart   │
                              └────────────────────┘
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

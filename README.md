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

```bash
# Install dependencies
npm install

# Build
npm run build

# Configure MCP in Claude/Cursor
# Add to your MCP settings:
{
  "mcpServers": {
    "quick-commerce": {
      "command": "node",
      "args": ["/path/to/quick-commerce-mcp/dist/index.js"]
    }
  }
}
```

## 🛠️ Supported Platforms

| Platform | Search | Cart | Order | Notes |
|----------|--------|------|-------|-------|
| Zepto | ✅ | ✅ | 🚧 | Cart flow + validation + order preview verified live; payment untested |
| Blinkit | ✅ | ✅ | 🚧 | Cart flow + validation verified live; full re-run and payment pending |
| Swiggy Instamart | ✅ | ✅ | 🚧 | Cart flow + validation verified live; order preview success path untested (store was closed/unserviceable) |
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

This tool automates browser interactions for personal convenience. Use responsibly and in accordance with platform Terms of Service.

---

**Created**: 2026-02-12

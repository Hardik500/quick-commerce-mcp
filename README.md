# 🛒 Quick Commerce MCP

Universal quick commerce aggregation via MCP - compare and order from Zepto, Swiggy Instamart, and BigBasket in one interface.

## ✨ Features

- **Multi-Platform Search**: Find products across all platforms simultaneously
- **Price Comparison**: See which app has the best deal
- **Smart Cart**: Automatically suggest optimal platform split
- **User Control**: You confirm before any order is placed
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
| Zepto | ✅ | ✅ | 🚧 | Login + search + add-to-cart verified end-to-end |
| Swiggy Instamart | 🚧 | 🚧 | 🚧 | Login flow wired up; selectors unverified (no session captured yet) |
| Blinkit | 🚧 | 🚧 | 🚧 | Login flow wired up; selectors unverified (no session captured yet) |
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
- [ ] Swiggy Instamart (selectors unverified)
- [ ] Blinkit (selectors unverified)
- [ ] Price comparison
- [ ] Basic cart management

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

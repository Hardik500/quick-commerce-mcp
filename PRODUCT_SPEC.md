# Quick Commerce MCP - Product Spec

**Product**: Universal Quick Commerce MCP Server  
**Version**: 1.0.0  
**Date**: 2026-02-12  

---

## 🎯 Value Proposition

**Problem**: Users waste time checking 3-4 apps for best prices, availability, and delivery slots.

**Solution**: Single MCP interface that aggregates Zepto, Swiggy Instamart and Blinkit with intelligent recommendations.

**Key Differentiator**: User stays in control - we assemble recommendations, they confirm before any money moves.

---

## 📦 Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| **Zepto** | ✅ Working | Fastest 10-min delivery |
| **Swiggy Instamart** | ✅ Working | Good variety, better in some areas |
| **Blinkit** | ✅ Working | Similar to Zepto |

---

## 🔧 MCP Tools (Capabilities)

18 tools, grouped by what they do. Names below match `src/index.ts` exactly —
that is the authoritative list, since it is what the assistant actually reads.

**Find and compare**
- `search_products` — search one or more platforms, with cheapest-first pricing
- `compare_prices` — price a shopping list across platforms, including the optimal split
- `resolve_items` — rank matches for a loose description on one platform, without touching the cart

**Cart**
- `add_to_cart` — add items, then show a validated cart preview
- `remove_from_cart` — remove all of one product, identified by name
- `get_cart_summary` — current cart contents and total
- `clear_cart` — empty the cart

**Addresses**
- `list_addresses` — saved delivery addresses with their ids
- `select_address` — switch the live delivery address

**Login**
- `check_login_status` — is each platform logged in
- `request_otp` — enter the number and send the SMS
- `submit_otp` — complete login with the code the user received
- `logout` — delete a saved session, e.g. to log in with another number
- `set_preferences` — save phone, pincode, UPI ID, default payment method, `open_qr`

**Ordering**
- `get_order_preview` — items, itemised bill, address and payment options; charges nothing
- `place_order` — two-step, with a confirm token; supports `cod`, `upi_qr` (Zepto), `upi` (Blinkit) and `card`
- `get_order_status` — most recent order on Blinkit or Zepto; read-only

**Repair**
- `diagnose_flow` — inspect and repair a broken selector against the live page,
  with oracle-checked auto-repair, so a site redesign doesn't need a code change

---

## 🧠 Smart Features

> **Not implemented.** These are product ideas, listed so they aren't lost — not
> claims about what the server does today. Nothing below is currently built; see
> [Shipped](#-shipped) for what is.

### Price Cataloguing
- Cache product prices (refresh every 2 hours)
- Track price history per item
- Alert on price drops

### Availability Intelligence
- Flag items "out of stock on Zepto but available on Swiggy"
- Suggest substitutes: "Diet Coke available if Coke Zero out"

### Delivery Optimization
- Compare delivery fees + minimum order values
- Account for surge pricing

### Smart Reordering
- Learn patterns: "User orders Amul Taaza every 3 days"
- Proactive: "Milk running low based on history. Add to cart?"

### Split Order Logic
- "Save ₹50 by ordering groceries from Instamart + snacks from Zepto"
- Consider delivery fees in the calculation

---

## 🔐 User Control & Safety

### OTP Flow
```
1. User: "Add Coke Zero to cart"
2. MCP: "Zepto session expired. OTP sent to +9198765XXXX. Provide code?"
3. User: "123456"
4. MCP: Proceeds with automation
```

### Confirmation Gates
- **Browse mode**: No confirmation needed (just search/view)
- **Cart mode**: Show preview, ask "Add these to cart?"
- **Order mode**: Show final bill, ask "Place order for ₹347?"

### Address Management
```typescript
interface UserProfile {
  saved_addresses: Address[];
  current_location?: Address; // GPS or manual
  preferred_platforms: string[];
  payment_preferences: {
    default: "wallet" | "upi" | "card";
    wallet_balance?: Record<string, number>; // per platform
  };
}
```

---

## 🏗️ Technical Architecture

### Stack
- **Runtime**: Node.js 20+ (MCP SDK)
- **Browser**: Playwright (headless/headed option)
- **Storage**: SQLite (price cache, user profiles, order history)
- **Config**: JSON/YAML for platform selectors

### Project Structure
```
quick-commerce-mcp/
├── src/
│   ├── index.ts              # MCP server entry, tool definitions and handlers
│   ├── flows.ts              # Per-step selectors, fingerprints, oracle-checked repair
│   ├── ranking.ts            # Product match ranking, cart validation, pack-size logic
│   ├── preferences.ts        # ~/.quick-commerce-mcp/preferences.json
│   ├── session-helper.ts     # Sessions, login CLI, QR capture and viewer launch
│   ├── logic.test.ts         # Tests
│   ├── engine/
│   │   ├── stealth-browser.ts     # Installed-Chrome context, permissions, geolocation
│   │   ├── resilient-selector.ts  # Selector fallback and self-repair
│   │   └── stealth-script.ts
│   ├── platforms/
│   │   ├── base.ts           # Abstract base class
│   │   ├── zepto.ts
│   │   ├── blinkit.ts
│   │   └── swiggy-instamart.ts
│   └── api/
│       └── quick-commerce-api.ts
├── dist/                     # Compiled output, committed and published
└── *.md
```

There is no `config/`, `data/` or `prompts/` directory. Selectors that need to be
repaired at runtime live in `~/.quick-commerce-mcp/flows/<platform>.json`, which
is written by `diagnose_flow` and preferred over the built-in ones — deliberately
outside the repo, so a repair survives an npm update.

### MCP Server Config
The server speaks MCP over stdio and holds no config file of its own. Tools are
declared in `src/index.ts`; per-user state lives under `~/.quick-commerce-mcp/`
(`preferences.json`, `sessions/`, `flows/`). The only environment variable that
changes behaviour is `QC_CHROME_PATH`, which points at a Chrome binary when the
`chrome` channel lookup fails. Client-side setup is in
[MCP_SETUP.md](MCP_SETUP.md).

---

## 🎯 Current Scope

### Shipped
- ✅ Zepto, Swiggy Instamart and Blinkit automation (search, cart)
- ✅ Price comparison across platforms
- ✅ OTP login flow with saved sessions
- ✅ User confirmation gates before payment
- ✅ Address selection and management
- ✅ Order history on Blinkit and Zepto
- ✅ UPI QR payment on Zepto, returned as a full-resolution QR cropped from the
  payment sheet (generated and scanned end-to-end), with optional auto-open in an
  image viewer via `set_preferences(open_qr: "true")`

### Not Yet Working
- [ ] Instamart checkout preview
- [ ] Instamart `place_order` exercised against a live payment
- [ ] Payment outcome detection verified against the live pages — a payment is
      confirmed by the user, not read back from the platform

---

## 📊 Success Metrics

| Metric | Target |
|--------|--------|
| Average time to find best price | < 30 seconds |
| User savings vs single-platform | 10-15% |
| Order success rate | > 95% |
| User confirmation rate | > 80% (no accidental orders) |

---

## 🚧 Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Platform blocks automation | Rotate user agents, add delays, fallback to manual mode |
| DOM changes break selectors | Modular selector configs, health checks |
| OTP expiry | Auto-retry once, then prompt user |
| Session timeout | Persistent cookies, auto-refresh |
| Wrong item selection | Exact match priority + user confirmation |

---

## 🔄 Development Phases

### Done
- MCP server scaffold
- Playwright base class
- Zepto, Swiggy Instamart and Blinkit implementations
- Price comparison logic
- Error handling and documentation

---

**Next Step**: Create project repo and start Phase 1? 🚀
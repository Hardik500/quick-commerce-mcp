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

### 1. `search_products`
**Input**: `{ "query": "coke zero", "platforms": ["zepto", "swiggy"], "location_pincode": "400001" }`  
**Output**: Aggregated results with price comparison, availability, delivery time

### 2. `get_cart_summary`
**Input**: `{ "platforms": ["all"], "items": [{"name": "Coke Zero", "quantity": 1}] }`  
**Output**: Best platform recommendation + alternatives

### 3. `add_to_cart`
**Input**: `{ "platform": "zepto", "items": [...], "confirm": false }`  
**Output**: Cart preview with total, savings vs alternatives

### 4. `request_otp` (Helper)
**Output**: "OTP sent to +91XXXXX. Please provide the 6-digit code."

### 5. `confirm_order`
**Input**: `{ "platform": "zepto", "cart_id": "...", "payment_method": "wallet" }`  
**Output**: Order confirmation or failure reason

### 6. `get_order_history`
**Output**: Past orders across all platforms (useful for reorders)

### 7. `compare_prices`
**Input**: Shopping list  
**Output**: Optimal split across platforms for minimum total cost

---

## 🧠 Smart Features

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
│   ├── platforms/
│   │   ├── zepto.ts      # Platform-specific automation
│   │   ├── swiggy.ts
│   │   └── base.ts       # Abstract base class
│   ├── tools/
│   │   ├── search.ts
│   │   ├── cart.ts
│   │   ├── order.ts
│   │   └── compare.ts
│   ├── cache/
│   │   └── price_cache.ts
│   ├── auth/
│   │   └── session_manager.ts
│   └── index.ts          # MCP server entry
├── config/
│   ├── selectors.json    # DOM selectors per platform
│   └── platforms.yaml    # Feature flags
├── data/
│   ├── cache.db          # SQLite price cache
│   └── users/            # Per-user session storage
├── prompts/              # LLM prompts for parsing
└── README.md
```

### MCP Server Config
```json
{
  "name": "quick-commerce",
  "version": "1.0.0",
  "tools": [
    { "name": "search_products", ... },
    { "name": "add_to_cart", ... },
    ...
  ]
}
```

---

## 🎯 Current Scope

### Shipped
- ✅ Zepto, Swiggy Instamart and Blinkit automation (search, cart)
- ✅ Price comparison across platforms
- ✅ OTP login flow with saved sessions
- ✅ User confirmation gates before payment
- ✅ Address selection and management
- ✅ Order history on Blinkit and Zepto

### Not Yet Working
- [ ] Instamart checkout preview
- [ ] Payment outcome detection verified against the live pages

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
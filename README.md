# 🛒 Quick Commerce MCP

Universal quick commerce aggregation via MCP - compare and order from Zepto, Blinkit, and Swiggy Instamart in one interface.

**Current verification scope:** Blinkit and Zepto search/cart flows were checked for
**1.5.1**. Checkout, payments, and order tracking were not reverified; Instamart was
not included in this regression check. See [flow status](#supported-platforms-and-flow-status)
before relying on a feature.

## ✨ Features

- **Multi-Platform Search**: Find products across all platforms simultaneously
- **Price Comparison**: See which app has the best deal
- **Smart Cart**: Automatically suggest optimal platform split
- **Item Resolution**: `resolve_items` ranks matches per platform; `add_to_cart` validates the cart (items, quantities, bill total) after adding
- **Itemised Bill**: Handling, late-night, GST and other fees listed separately in cart and order preview
- **Addresses**: `list_addresses` / `select_address` (retries once on flaky picker clicks)
- **Store Notices**: Closed/unserviceable stores and "Add address to proceed" are detected and reported with next steps
- **User Control (not reverified)**: Two-step `place_order` (preview token, then confirm); CVV read from `QC_CVV_<last4>`, never logged
- **Payment QR (not reverified)**: Zepto UPI QR support is implemented, including full-resolution cropping and an optional image viewer; successful payment is not guaranteed by generating a QR
- **OTP Handling**: Prompts for OTP when session expires

## Demo

[![Watch the MCP demo](https://www.loom.com/v1/videos/174a9a22e5d54e15bf27eb2fb77f837f/thumbnail.gif)](https://www.loom.com/share/174a9a22e5d54e15bf27eb2fb77f837f)


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
| `set_preferences` | Save phone, pincode, UPI ID, default payment method (`cod`/`upi`/`upi_qr`/`card`), `open_qr` (`"true"` opens each payment QR in an image viewer). No args = read. Empty string = clear. Stored in `~/.quick-commerce-mcp/preferences.json` |
| `check_login_status` | Is each platform logged in? |
| `request_otp` | Enter the phone number on the platform and send the OTP SMS (phone defaults to the saved one) |
| `submit_otp` | Complete login with the OTP you received |
| `logout` | Delete a platform's saved session (use before switching phone numbers) |
| `diagnose_flow` | Inspect or repair a broken browser flow (e.g. after a site changes its markup) |
| `list_addresses` / `select_address` | Pick the delivery address |

The verified shopping path for Blinkit and Zepto is `search_products` → `add_to_cart`
→ `get_cart_summary` → `remove_from_cart` / `clear_cart`. `compare_prices` and
`resolve_items` have shared logic test coverage, but their full multi-platform flow
was not reverified. Checkout via `get_order_preview` / `place_order`, and order
tracking via `get_order_status`, are implemented but outside the current verified
path; see [flow status](#supported-platforms-and-flow-status).

**Always pass `payment_method` explicitly to `place_order`.** Your saved default is a single value applied to every platform, and the same string means different things on different ones — `upi` is Blinkit-only, and Zepto needs `upi_qr` for a scannable QR. Relying on the default is the most common reason a payment method comes back unsupported.

Alternative login from a terminal (opens a browser; log in, then Ctrl+C):

```bash
npx -y -p quick-commerce-mcp quick-commerce-mcp-login zepto   # also: blinkit, swiggy-instamart
```

Sessions are saved to `~/.quick-commerce-mcp/sessions/` and expire eventually; just log in again.

**3. Optional, for card payments:** export `QC_CVV_<last4>` in the client's `env` block. UPI needs no secret.

**From source:** `npm install && npm run build`, then point the client at `node /path/to/dist/index.js`.

**Tests:** install the test browser with `npx playwright install chromium`, then run `npm test` and `npm run lint`. To use an existing Chromium executable, set `QC_CHROME_PATH` when running the tests. The browser regression tests use local fixture storefronts; they do not use saved sessions or make live purchases.

## Supported platforms and flow status

Status for **1.5.1**, checked **2026-10-04**. Release verification ran **64 automated
tests** plus live Blinkit/Zepto checks against the packaged build. This is the scope
of those checks, not a guarantee that every product, address, store, or future site
update will behave identically.

- **Live verified**: exercised against the real platform during this release check.
- **Test covered**: exercised by unit tests or controlled browser fixtures, not a
  dedicated live check of that scenario.
- **Not reverified**: implemented or previously reported working, but not checked
  in this release. This does **not** mean it is known broken.
- **Unsupported / previously failed**: an explicit implementation gap or a prior
  failure; a prior failure is not a fresh result for this release.

| Flow | Blinkit | Zepto | Swiggy Instamart |
|------|---------|-------|-----------------|
| Saved-session login | Live verified, including fresh-process restore | Live verified using the saved session | Not reverified |
| Fresh OTP login (`request_otp` → `submit_otp`) | Live verified; saved login survives restart | Not reverified | Not reverified |
| Product search (`search_products`) | Live verified | Live verified | Not reverified |
| ID-only add after cart navigation, with exact quantity (`add_to_cart`) | Live verified + test covered | Live verified + test covered | Not reverified |
| Repeating an add without duplicating the item | Live verified + test covered | Live verified + test covered | Not reverified |
| Cart summary and quantity readback (`get_cart_summary`) | Live verified + test covered | Live verified + test covered | Not reverified |
| Remove an item using its search label (`remove_from_cart`) | Live verified + test covered | Live verified + test covered | Not reverified |
| Clear a cart and confirm it stays empty after reload (`clear_cart`) | Live verified + test covered | Live verified + test covered | Not reverified |
| Out-of-stock handling as an individual item failure | Test covered | Test covered | Not reverified |
| Closed-store dialog dismissal and retained removed rows | Test covered | Not reverified | Not reverified |
| Bill parsing, pack-size matching, and validation helpers | Test covered | Test covered | Bill parsing test covered; live cart not reverified |
| Price-ranking/item-resolution helpers (`compare_prices`, `resolve_items`) | Shared logic test covered; full multi-platform flow not reverified | Shared logic test covered; full multi-platform flow not reverified | Full flow not reverified |
| Saved address listing (`list_addresses`) | Live verified after login and in a fresh process | Not reverified | Not reverified |
| Changing delivery address (`select_address`) | Not reverified | Not reverified | Not reverified |
| Checkout preview (`get_order_preview`) | Not reverified | Not reverified | Previously failed; not reverified |
| Order placement / payment (`place_order`, including COD) | Not reverified | Not reverified | Not reverified |
| Order history/status (`get_order_status`) | Not reverified | Not reverified | Unsupported |
| Live selector diagnosis/repair (`diagnose_flow`) | Not reverified | Not reverified | Not reverified |

### Known limitations and recovery

- **Payments were deliberately excluded from the 1.5.1 regression checks.** Older
  Blinkit UPI and Zepto QR demonstrations do not establish current reliability.
  Do not treat a QR or a returned success message as proof of payment or a confirmed
  order; check the platform's own app/order history.
- **Instamart checkout preview previously failed**, and this release did not retest
  that failure. Instamart order-status retrieval is not implemented. Its older
  search/cart results have not been reverified either.
- **Configured payment modes are not a verification promise:** Blinkit accepts
  `cod`/`upi`/`card`, Zepto `cod`/`upi_qr`/`card`, and Instamart `cod`. Other modes
  (new cards, wallets, netbanking, Pay Later) are unsupported. Platform eligibility
  can still make an accepted mode unavailable for a particular cart.
- **Older incomplete Blinkit sessions need one fresh OTP login.** Version 1.5.1
  waits for authenticated client state before saving; a leftover legacy cookie
  alone no longer counts as a logged-in account.
- **Cart actions require confirmation where prompted.** Repeat adds are treated
  as already present, not as instructions to add the requested quantity again.
  After removal/clearing, read `get_cart_summary` to confirm the result. Live
  verification used only test items and restored both carts to empty.
- **Stock, store hours, and address eligibility remain platform-controlled.** A
  closed/unserviceable notice is not a promise that checkout can proceed. Browser
  markup and bot checks can change; inspect a broken flow with `diagnose_flow`
  rather than assuming an earlier verification still applies.

The automated browser regressions are in
[src/platform-flows.test.ts](src/platform-flows.test.ts); shared logic tests are in
[src/logic.test.ts](src/logic.test.ts). They use fixtures, not live accounts or
purchases. Passing them does not certify checkout or payment flows.

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

### Pay by UPI QR

This feature is implemented but **not reverified for 1.5.1**. The example describes
the intended flow, not a guarantee of payment success.

```
"Pay for my Zepto cart with a UPI QR"
```

The first call previews the order and stops. The second generates the QR,
which is valid for a few minutes. It comes back cropped to the QR itself at full
resolution, and the file path is always included. Run
`set_preferences(open_qr: "true")` once to have it open in an image viewer
automatically — see [below](#why-a-payment-qr-opens-in-a-separate-viewer) for
why that is worth turning on.

> Zepto only: pass `payment_method: "upi_qr"` explicitly. Your saved default is
> used for every platform, and `upi` means something different on Blinkit than
> it does on Zepto.

## 🔐 Security

- **No card data stored**: CVV is read from the `QC_CVV_<last4>` env var only, and is never written anywhere. What *is* written locally, all under `~/.quick-commerce-mcp/`: `preferences.json` (phone, pincode, UPI ID, default payment method, `open_qr`), session cookies in `sessions/`, repaired selectors in `flows/`, and payment QR images in `sessions/`
- **A payment QR is saved to disk**: a UPI QR is a scannable payment instruction — it carries the payee VPA, the amount and a transaction reference. It is written to `sessions/` so you can open it full size, at mode `0600`. Deleting it after you pay is up to you
- **OTP required**: You always supply the OTP yourself
- **Confirm before order**: Preview shown, you confirm final purchase
- **Session isolation**: Each platform login is separate
- **Payment QRs are never auto-opened unless you ask**: `set_preferences(open_qr: "true")` opts in to launching an image viewer when a QR is generated. It is off by default because it starts a process on your machine

### Why a payment QR opens in a separate viewer

MCP clients render tool-result images inside a short container with its own
scrollbar — Claude Desktop's `Place order` block is one — so a QR sent inline is
clipped across the fold and will not scan from the chat. The protocol has no way
for a server to change that layout, so the full-resolution PNG is always written
to `~/.quick-commerce-mcp/sessions/` and its path returned in the message. Set
`open_qr` to `"true"` to have it also launch in your image viewer automatically.

## 🏗️ Architecture

Each platform is driven through a single shared browser page, so tool calls that
touch the **same** platform are serialised automatically — you can fire several at
once and they queue rather than collide. Calls against **different** platforms run
in parallel, so comparing three platforms is still concurrent.

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

## 📋 Status

See the [versioned flow-status table](#supported-platforms-and-flow-status) for the
single source of verification scope and known limitations. Implemented tools and
older demonstrations are not a claim of current end-to-end support.

## 🤝 Contributing

This is a personal project. Open to suggestions!

## ⚠️ Disclaimer

This is an unofficial project, not affiliated with Zepto, Blinkit or Swiggy. It automates a real browser logged in as you. Automating these sites may violate their Terms of Service and can get your account rate-limited or blocked; you use it at your own risk.

`place_order` spends real money. It only runs after a two-step confirmation, but always check the order summary your assistant shows you before approving. Sessions (login cookies) are stored unencrypted in `~/.quick-commerce-mcp/sessions/`; keep that folder private.

---

**Created**: 2026-02-12

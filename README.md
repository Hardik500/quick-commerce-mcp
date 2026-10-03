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
- **Scannable Payment QR**: UPI QR orders return the QR alone, at full resolution, cropped from the payment sheet — optionally opened in an image viewer so it is actually scannable
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

Then shop: `search_products`, `compare_prices`, `resolve_items`, `add_to_cart`, `remove_from_cart`, `get_cart_summary`, `clear_cart`, `get_order_preview`, and finally `place_order` (preview first, then confirm with the token). After ordering, `get_order_status` shows the latest order on Blinkit or Zepto.

**Always pass `payment_method` explicitly to `place_order`.** Your saved default is a single value applied to every platform, and the same string means different things on different ones — `upi` is Blinkit-only, and Zepto needs `upi_qr` for a scannable QR. Relying on the default is the most common reason a payment method comes back unsupported.

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
| Zepto | ✅ | ✅ | 🚧 | Cart, validation, order preview, UPI QR payment and `get_order_status` (order list) verified live. The QR was generated and scanned end-to-end; the post-payment status *string* is not yet confirmed against the orders page |
| Blinkit | ✅ | ✅ | ✅ | Full flow verified live: cart, preview, UPI payment and `get_order_status` (list + latest order detail) |
| Swiggy Instamart | ✅ | ✅ | 🚧 | Cart + validation verified live; order preview not yet working; `get_order_status` not supported (orders page unreachable when tested) |

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

- ✅ Login (OTP + saved session) on all three platforms
- ✅ Search, add to cart, cart summary, clear cart
- ✅ Price comparison, item resolution, cart validation, itemised bills
- ✅ Address selection, store notices
- ✅ UPI QR payment on Zepto (QR generated and scanned; Blinkit payment also verified)
- ⚠️ Instamart checkout preview not yet working
- ⚠️ Payment outcome strings are still unverified against the live pages — a
  payment is confirmed by the user, not read back from the platform
- ⚠️ Instamart `place_order` not yet exercised on a live payment

## 🤝 Contributing

This is a personal project. Open to suggestions!

## ⚠️ Disclaimer

This is an unofficial project, not affiliated with Zepto, Blinkit or Swiggy. It automates a real browser logged in as you. Automating these sites may violate their Terms of Service and can get your account rate-limited or blocked; you use it at your own risk.

`place_order` spends real money. It only runs after a two-step confirmation, but always check the order summary your assistant shows you before approving. Sessions (login cookies) are stored unencrypted in `~/.quick-commerce-mcp/sessions/`; keep that folder private.

---

**Created**: 2026-02-12

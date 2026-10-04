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

### BigBasket development support (2026-10-04)

The working tree adds `bigbasket` to the MCP tools and interactive login helper.
It supports OTP login, search, ID-based cart additions with basket quantity
verification, individual removal, saved-address selection, and checkout preview.
Payment options are read from the Juspay iframe, and the preview reads the actual
payable total, including checkout discounts. Eligible wallet execution uses the
shared wallet controller. UPI QR generation uses a confirmed, one-shot handoff;
other payment execution and bulk clearing remain disabled. Checkout stops if BigBasket requests removal of
unavailable pre-existing items; it does not confirm that removal automatically.

After login, the connector reuses a confirmed address saved per platform. A
pincode selects a saved address only when the match is unique. Otherwise, the
login response lists the available saved addresses and asks the user to choose
with `select_address`; that confirmed choice persists across restarts. If a saved
choice disappears, the connector asks again instead of substituting another home.

Live stdio MCP verification completed OTP login in a dedicated native Windows
Chromium browser, reused the saved Bangalore Home address, increased an existing
biscuits item from one to two packs, and confirmed the persisted quantity by
reloading the basket. The original one-pack quantity was then restored. Checkout
preview returned the delivery address, payment options and actual payable total
of ₹133.94 (items ₹126.50, handling ₹8, checkout discount ₹0.56). No payment or
order was submitted. Live `prepare_payment` opened the UPI category through its
Juspay `article[role=none]` control without submitting anything. Collect/QR
transaction generation and authorization remain untested. Reconnecting a fresh MCP process reused the authenticated
browser and confirmed address without another OTP. Full browser restart login
restoration has not been verified live.

BigBasket's full listing service and product detail pages still return access
refusals in the authenticated native browser. **New-product search and additions
now work through the supported storefront autocomplete UI:** the adapter waits
for the rendered search input, uses the last visible input (the sticky header),
reads native suggestions and clicks their Add controls. It reports that these
are limited suggestions, not exhaustive catalog results. Refine the query when
a desired product is absent. The full listing remains a fallback when suggestions
are unavailable; a refusal is reported without requesting another OTP.

Live fresh stdio MCP verification searched Marie, returned ten variants, added
one Britannia Marie Gold Biscuits 190 g pack (ID 40001610, ₹28.65), and reloaded
the basket to prove it persisted beside the existing biscuits. The two-item
subtotal was ₹155.15. No payment or order was submitted. Search state is restored
after cart reads; new-product Add dispatches once and requires basket proof before
any subsequent quantity increment. Missing optional images never cause a locator
timeout. Fixtures cover autocomplete restoration, rejected writes, restored
basket IDs, unavailable-item protection, checkout authentication, address
extraction, iframe options and actual totals.

Actual MCP verification on 2026-10-04 also found that the already-connected
server was stale: it returned `Platform bigbasket not supported`, while a fresh
stdio connection to `dist/index.js` registered all 16 BigBasket tools. Restart
the MCP connection after building; rebuilding files does not update a running
Node process. `scripts/verify-bigbasket-mcp.mjs` exercises that fresh stdio
connection (newline-delimited tool requests on stdin, `quit` to close).

BigBasket uses native desktop browser APIs and defaults to a visible dedicated
profile (`QC_BIGBASKET_HEADLESS=true` opts into headless). Both headless and
visible WSL browsers failed live login with Access Denied or OTP HTTP 400. The
working development workaround runs only the browser runtime on Windows and
keeps the MCP process, project, preferences and session files in WSL:

```bash
# From WSL, install the Windows browser runtime into the Windows user's home.
WINDOWS_HOME=$(wslpath -u "$(cmd.exe /d /c echo %USERPROFILE% | tr -d '\r')")
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=win64 \
  PLAYWRIGHT_BROWSERS_PATH="$WINDOWS_HOME/.quick-commerce-mcp/browser-runtime" \
  npx playwright install chromium
node scripts/bigbasket-windows-bridge.mjs
```

Keep the bridge running while using MCP. It publishes an owner-only loopback
endpoint registry for automatic attachment, uses an isolated BigBasket profile,
and never logs CDP frames or credentials. Optional `QC_WINDOWS_NODE_PATH` and
`QC_WINDOWS_BROWSER_PATH` specify WSL paths to Windows runtime executables;
the default Node runtime comes from the Codex desktop dependency cache. An
explicit `QC_BIGBASKET_CDP_URL` must be a plain loopback HTTP origin. This is a
development helper in this repository, not a bundled npm installation feature.
MCP disconnect preserves the interactive browser; explicit logout clears its
cookies, origin storage and cached authenticated pages. Saved WSL session files
use owner-only permissions. A browser/runtime failure still requires reconnecting
the MCP client; rebuilding does not refresh an existing client connection.

### Payment routing and user preferences (development)

All four apps share `get_payment_options`, `prepare_payment`, and
`set_payment_preferences`. The default order is UPI collect, UPI QR, wallets,
cards, then COD. A checkout advertising only “UPI” must be inspected to determine
its actual modes; it does not prove collect or QR support. Disabled methods are
excluded. Missing UPI IDs, wallet providers, or saved-card choices are requested
before proceeding. Optional netbanking, Pay Later, and Pluxee options can also be
included in a custom order when advertised by the website.

Examples:
```json
{"order":["upi","wallet","card","cod"],"allow_fallback":true}
{"platform":"bigbasket","order":["wallet","upi_qr","cod"],"wallet_provider":"Amazon Pay"}
{"platform":"blinkit","order":["upi_collect"],"upi_id":"person@bank","allow_fallback":false}
{"platform":"zepto","order":["card","upi_qr"],"card_last4":"1234"}
```
Pass these to `set_payment_preferences`. Omitted methods are excluded from the
priority order. Per-app fields inherit global fields; `reset:true` removes that
scope. Preferences persist across restarts. Full card numbers, CVV, bank
credentials and payment OTPs are never stored in these preferences.

`get_payment_options` returns option IDs, observed availability, prerequisites,
a preferred option, and whether submission has an adapter or needs manual
completion. `prepare_payment` opens a unique safe category tab, heading or
recognized category button and
inspects sub-options. It does not click final payment/provider buttons, initiate
a collect request, generate a transaction QR, debit wallets, authorize cards or
place orders. Ambiguous/unknown controls require choosing in the app. Website
capabilities determine the available flow; app-only options are not fabricated.

Existing automated submission coverage remains:

| App | Adapter submission | Preparation / manual when advertised |
| --- | --- | --- |
| Blinkit | UPI collect, saved card, COD, eligible wallets | QR, unsupported wallets, new cards, other modes |
| Zepto | UPI QR, saved card, COD, eligible wallets | Collect, unsupported wallets, new cards, other modes |
| Instamart | COD, eligible wallets | UPI, unsupported wallets, cards, other modes |
| BigBasket | UPI QR handoff, eligible wallets (fixtures; live submission pending) | UPI collect, unsupported wallets, cards, COD, other modes |

`place_order` accepts `auto` or an omitted method for preference routing, but
only adapter-supported modes can submit. Explicit order approval remains
required; confirmation binds the same platform, method and UPI/card details.
No fallback or retry occurs after submission, failure, timeout or an uncertain
payment outcome. Resolve pending status or ask the user before another attempt.
New routing/preparation is covered by browser fixtures and fresh stdio MCP
integration tests. Live payment submission tests remain pending. BigBasket's
MCP login, existing-cart updates and checkout are verified via the Windows
browser bridge. Full listing-service search remains blocked; native autocomplete
search and new-product addition are verified through fresh stdio MCP.
Live read-only MCP verification reached Instamart's payment screen and returned
UPI, wallet, card, netbanking and pay-on-delivery options at the saved Bangalore
address. Zepto and Blinkit returned checkout-unavailable for their current
sessions/carts. None of these checks submitted a payment or order.

Wallet execution depends on the actual checkout UI. `get_wallet_status` opens
the safe Wallets category and lists native/linked provider balances and bill
coverage. App credit (bbWallet, Zepto Cash, Swiggy Money, Blinkit wallet) and
linked wallets such as Amazon Pay or MobiKwik use the shared controller when
a unique balance and checkbox/radio are visible. Provider-only buttons, missing
balances and linking/login requirements remain manual.

Use `place_order(payment_method: "wallet", wallet_provider: "bbWallet", ...)`
for the normal two-step approval flow. Preparation spends nothing. Confirmation
rechecks cart items, address, total, wallet identity and available balance;
balance equal to the bill is sufficient. Applied wallet credit and zero residual
payable must be observable before a separate final click. Linked-provider
selection can itself initiate payment and is tracked as a possible dispatch.
Authentication/pending/timeout outcomes never trigger retry, top-up, split
payment or fallback. Success requires a new order confirmation and order ID;
a click or balance change alone is insufficient.

Pending wallet attempts are recorded privately beside the platform session and
block another attempt across MCP restarts. An exclusively created `.pending`
marker guards overlapping processes. Reconcile unresolved attempts against
order history before an operator removes their pending journal/marker; logout
does not clear this protection.

Browser fixtures cover wallet success/failure on all four apps, linked balances
and provider authentication. **Actual wallet debits remain untested.** Live
BigBasket MCP inspection found bbWallet ₹0 against a ₹133.94 bill and PayZapp
without a usable linked balance/control. Both were refused for automatic
payment. No real order or wallet debit was submitted.

### Instamart development verification (2026-10-04)

The working-tree Instamart adapter now restores searches for ID-only adds after
cart navigation, includes pack size in product IDs, rejects ambiguous pack
matches, detects out-of-stock items, and proves quantity changes against both
the counter and completed cart writes. Removed rows showing `ADD` are excluded
from the cart. OTP submission waits for authenticated state before saving, and
checkout preview distinguishes `Select Address` from `Proceed to Pay`.

These changes have 13 browser fixture regressions in
[src/instamart-flows.test.ts](src/instamart-flows.test.ts), covering inline and
variant adds, repeat adds, delayed/debounced saves, removal, clearing, rejected
writes, session restoration, and checkout preview. This extends the working
tree's coverage; the **1.5.1 release table above remains historical**.

Live checks restored the saved session, returned 20 search results, read the
cart, and removed a test item while preserving the original cart. Full live
quantity/repeat-add verification was blocked by Instamart's HTTP-200 application
error `User Addresses not found for user`. The adapter now reports that as a
failure with `list_addresses` / `select_address` recovery. Select a valid delivery
address before rerunning the live cart regression; successful full live parity
has **not** been established. Payments and order history remain outside these
checks.

Run `npx tsx scripts/test-instamart-addtocart.ts` for the live cart regression
after configuring the address. It asserts outcomes and restores the original
cart rather than clearing pre-existing items. `QC_INSTAMART_TEST_QUERY` can
override the default test search (`amul milk`).

### Known limitations and recovery

- **Payments were deliberately excluded from the 1.5.1 regression checks.** Older
  Blinkit UPI and Zepto QR demonstrations do not establish current reliability.
  Do not treat a QR or a returned success message as proof of payment or a confirmed
  order; check the platform's own app/order history.
- **Instamart checkout preview previously failed**, and this release did not retest
  that failure. Instamart order-status retrieval is not implemented. Its older
  search/cart results have not been reverified either.
- **Configured payment modes are not a live verification promise:** Blinkit
  accepts `cod`/`upi`/`card`, Zepto `cod`/`upi_qr`/`card`, and Instamart `cod`.
  The working tree also supports eligible native and linked `wallet` checkout
  on Blinkit, Zepto, Instamart and BigBasket through the shared wallet controller.
  Real wallet debits remain untested. New cards, netbanking and Pay Later remain
  manual; platform eligibility can disable a method for a particular cart.
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

Use Node.js 24, run `npm ci`, and install fixture browsers with
`npx playwright install chromium`. Run `npm run setup:hooks` once per checkout.
The pre-commit hook runs `npm run check` (the full test suite, lint, and browser
helper syntax checks, and the high-severity dependency audit), refuses unstaged
code changes, and checks that generated
`dist/` files are staged. GitHub Actions runs the same checks on pushes and pull
requests using the committed dependency lockfile.

Tests cover cart persistence and rejected writes, OTP/session restoration,
saved-address selection, MCP reconnect/handshake and preference persistence,
payment preferences and category navigation, and native
and linked wallet preparation/confirmation across all four platforms. They use
local browser fixtures and never charge a real account. Live payment execution
still requires separate verification; passing fixtures do not establish support
for every current merchant checkout variant.

## ⚠️ Disclaimer

This is an unofficial project, not affiliated with Zepto, Blinkit or Swiggy. It automates a real browser logged in as you. Automating these sites may violate their Terms of Service and can get your account rate-limited or blocked; you use it at your own risk.

`place_order` spends real money. It only runs after a two-step confirmation, but always check the order summary your assistant shows you before approving. Sessions (login cookies) are stored unencrypted in `~/.quick-commerce-mcp/sessions/`; keep that folder private.

---

**Created**: 2026-02-12

### BigBasket UPI QR handoff

The observed BigBasket Juspay desktop UPI screen offers **Generate QR Code**.
It has no UPI-ID/phone input, and the bank handles shown underneath are suggestions,
not a saved UPI account. `prepare_payment` opens this screen without generating a
transaction. `place_order(payment_method: "upi_qr")` prepares a confirmation token;
the confirmed second call generates once and returns the QR image and private file
for scanning with any UPI app. It reports **pending**, never a paid/confirmed order.
A shared wallet/UPI attempt journal prevents duplicate generation or fallback after
an uncertain result, including across MCP restarts. Reconcile the attempt in the
merchant app before clearing that guard. Cart, address and payable amount must
still match the approved preview. Live QR generation was verified on 2026-10-04: Juspay returned a GIF QR,
normalized from native image pixels to PNG and successfully decoded as a UPI payment for
₹162.59 INR to INNOVATIVE RETAIL CONCEPTS PRIVATE LIMITED. The adapter now checks
decodability, exact amount, currency and merchant before returning a QR as ready.
The image and private full-resolution file are returned to the client; no payment
was made. Fixtures include GIF extraction and mismatched/invalid payloads. Actual
payment completion remains untested. UPI collect is not
offered in the observed screen and is not enabled for BigBasket.

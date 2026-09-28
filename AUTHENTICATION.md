# Quick Commerce MCP - Authentication Guide

## The Problem

Quick commerce platforms (Zepto, Swiggy Instamart, Blinkit) use aggressive bot detection via CloudFront/Cloudflare. Running Playwright in headless mode with a fresh, unauthenticated browser results in **403 Forbidden** errors.

The fix is the `StealthBrowser` (`playwright-stealth`) plus a saved, authenticated session — headless requests replaying a real login's cookies/localStorage pass the same bot checks that block a bare headless launch.

## Solutions

### Option 1: Interactive Login (Recommended for personal use)

Use the session helper to log in manually and save the authenticated session:

```bash
# This opens a real browser where you can log in manually
npx tsx src/session-helper.ts login zepto

# Log in (phone + OTP), then press Ctrl+C once you're on the logged-in
# homepage. The session is saved via Playwright's storageState()
# (cookies + localStorage + sessionStorage) to
# ~/.quick-commerce-mcp/sessions/<platform>-session.json.
# The MCP server restores this same storageState for subsequent headless requests.
```

Session persistence is `storageState()`-based, not cookie-only — this matters because
Zepto's auth relies on localStorage tokens in addition to cookies. `StealthBrowser`
launches Chromium with `handleSIGINT: false` / `handleSIGTERM: false` so its own
`SIGINT`/`SIGTERM` handler (in `src/session-helper.ts`) owns shutdown ordering and
reliably writes the session file before the browser closes.

### Option 2: Use a Proxy Service

For production use, integrate a residential proxy:

```bash
# Update your .env or environment
PROXY_URL=http://user:pass@proxy.example.com:8080
```

Recommended proxy services:
- **Bright Data** - Residential proxies that work well with grocery apps
- **ZenRows** - Built specifically for web scraping
- **ScraperAPI** - Affordable option for occasional use

### Option 3: Use a Cloud Browser Service

Services like **Browserless** or **Browserbase** provide managed browsers that can bypass detection:

```typescript
// In your MCP config, connect to a remote browser
const browser = await chromium.connect('wss://cloud.browserless.io?token=YOUR_TOKEN');
```

## Current Status

| Platform | Status | Notes |
|----------|--------|-------|
| Zepto | ✅ Working | Login, `search_products`, and `add_to_cart` verified end-to-end via a real MCP client against a saved session |
| Swiggy Instamart | 🔧 Speculative | Login/save-session flow wired up (`submitOtp` saves session), but selectors are unverified — no authenticated session captured yet |
| Blinkit | 🔧 Speculative | Same as Swiggy Instamart — selectors unverified, `search()` fails with "Search input not found" against the live site |

## How to Use

1. **Check login status:**
   ```
   mcporter call quick-commerce.check_login_status platforms='["zepto"]'
   ```

2. **If not logged in, run interactive login:**
   ```bash
   npx tsx src/session-helper.ts login zepto
   ```

3. **Then use the MCP:**
   ```
   mcporter call quick-commerce.search_products query="milk" platforms='["zepto"]'
   ```

## Key Files

- `src/session-helper.ts` - Interactive login helper; exposes `sessionPath(platform)` and saves `storageState()` on `SIGINT`/`SIGTERM`
- `src/engine/stealth-browser.ts` - Wraps Playwright + `playwright-stealth`; accepts `storageStatePath` to restore a saved session on launch
- `src/platforms/zepto.ts` - Real, verified selectors (search, product cards, add-to-cart)
- `~/.quick-commerce-mcp/sessions/` - Saved browser sessions, one JSON file per platform (outside the repo, so it survives regardless of where/how the server is installed, e.g. via `npx`)

## Debugging Selectors

To inspect the authenticated DOM and re-derive selectors if a platform changes its markup:

```bash
# Requires an existing session file for the platform (see Option 1 above)
npx tsx scripts/inspect-selectors.ts
```

The older `scripts/debug-zepto-*.ts` scripts predate the stealth+session fix and are kept
only as a record of the original CloudFront-blocking investigation.
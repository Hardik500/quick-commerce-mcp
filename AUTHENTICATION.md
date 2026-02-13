# Quick Commerce MCP - Authentication Guide

## The Problem

Quick commerce platforms (Zepto, Swiggy Instamart, Blinkit) use aggressive bot detection via CloudFront/Cloudflare. Running Playwright in headless mode results in **403 Forbidden** errors.

## Solutions

### Option 1: Interactive Login (Recommended for personal use)

Use the session helper to log in manually and save the authenticated session:

```bash
# This opens a real browser where you can log in manually
npx tsx src/session-helper.ts login zepto

# After logging in, the session is saved automatically
# The MCP server will use this saved session for subsequent requests
```

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
| Zepto | ⚠️ Blocked | CloudFront bot detection active |
| Swiggy Instamart | 🔧 TODO | Not yet implemented |
| Blinkit | 🔧 TODO | Not yet implemented |

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

## Files Created

- `src/session-helper.ts` - Interactive login helper
- `src/platforms/zepto.ts` - Updated with session persistence
- `data/sessions/` - Saved browser sessions (gitignored)

## Debug Scripts

Run these to test browser access:

```bash
# Headless with trace (doesn't work due to CloudFront)
npx tsx scripts/debug-zepto-headless.ts

# Stealth mode (still blocked)
npx tsx scripts/debug-zepto-stealth.ts
```

Open trace with:
```bash
npx playwright show-trace trace.zip
```
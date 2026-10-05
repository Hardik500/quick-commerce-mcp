# Quick Commerce MCP - Login & Troubleshooting

Setup is in the [README](README.md). This file covers **getting logged in**, and what
to do when a login doesn't work.

> Everything here works from a plain `npx` install. Commands in this file do **not**
> assume you cloned the repo.

## Logging in

Login is two steps, and you supply the OTP yourself:

1. `request_otp` with the platform name - enters your number and sends the SMS
2. `submit_otp` with the 6-digit code from the SMS

Before the first login, save your number once so it isn't asked for every time:

```
set_preferences  phone="98XXXXXXXX"  pincode="560001"
```

`pincode` matters on **Blinkit**: it asks for a delivery location *before* login, and
the request fails without it. Zepto and Instamart don't need one to log in, but a
saved pincode is still useful later for `list_addresses` / `select_address`.

To log in with a different number, call `logout` for that platform first - otherwise
the old session is restored and the new number is ignored.

## If it doesn't work

### "Zepto rejected the OTP"

The code was sent exactly as you gave it, so it was wrong or already used. The usual
cause: **requesting a new OTP invalidates the previous one**, so if more than one SMS
arrived, only the newest is valid. Wait for the newest code and submit that one.

The connector reports the platform's own rejection message rather than guessing, so
the error you see is the reason the platform gave.

### "OTP screen did not appear"

The number was rejected before any SMS was sent. Check it: Indian mobile numbers start
6-9. Swiggy truncates a number with an invalid prefix to 9 digits rather than showing
an error, and the connector refuses to submit a truncated number - it will not text the
wrong person.

### "Blinkit asks for a delivery location"

Set a pincode with `set_preferences(pincode="560001")`. Blinkit geocodes the pincode
server-side, so no coordinates are needed.

The geolocation permission is already granted by the server. `QC_GEOLOCATION="lat,lon"`
in your MCP client's `env` block is an **optional** override, only useful when the
permission alone doesn't clear the modal. Normally you don't need it.

### "login panel did not open" / a click timed out

Usually a slow first paint or a bot check on a cold start. Retrying once usually works.
If it keeps failing, use the interactive login below.

### "could not confirm the session"

This is deliberately **not** reported as "Not logged in". A bot-check page, a
timeout, or a page that failed to evaluate says nothing about whether you have a
session - so the server tells you to retry rather than sending you into an OTP
round trip that would not fix it.

If it persists across several retries, the session has probably genuinely expired.
Then `logout` and `request_otp` will do the job.

### The assistant keeps guessing, or a flow breaks

Ask your assistant to call `diagnose_flow`. It shows what the page actually looks like,
and can repair a broken step on its own with `auto: true` - it only adopts a selector
after performing the step against it and confirming it worked, so it will decline
rather than guess.

## Interactive login (fallback)

If the automated flow won't cooperate, log in by hand. This opens a real browser:

```bash
npx -y -p quick-commerce-mcp quick-commerce-mcp-login zepto
# also: blinkit, swiggy-instamart
```

Log in with your phone and OTP, then press **Ctrl+C** once you're on the logged-in
homepage. The session is saved on that signal.

If you drive the MCP server as a *local build* rather than via `npx`, the same command
works from the repo with `npm run build && node dist/session-helper.js login zepto`.

## How sessions work

Sessions are Playwright `storageState()` snapshots - cookies **plus** localStorage -
written to:

```
~/.quick-commerce-mcp/sessions/<platform>-session.json
```

That path is under your home directory, not the install location, so sessions survive
updates and work regardless of how the server was installed.

What marks you as logged in, per platform:

| Platform | Signal |
|---|---|
| Zepto | the `user_id` cookie |
| Blinkit | the `gr_1_accessToken` cookie plus authenticated client state |
| Swiggy Instamart | the `_session_tid` cookie |

Note Zepto is **not** identified by its `session_id` cookie - an anonymous visit is
handed one of those too, so it can't be used to tell a session from a fresh browser.

Sessions expire. When they do, log in again; nothing else needs reinstalling.

Blinkit's OTP boxes can disappear before authentication finishes. The connector waits
for authenticated client state before saving, so an incomplete snapshot is not reported
as a successful login. Older incomplete snapshots need one fresh OTP login; then the
saved account can be restored by a new server process.

## When the sites change their markup

Selectors are guesses about live HTML, so they break when a site redeploys. When that
happens, `diagnose_flow` (see above) repairs it without a code change or a version
bump - repaired selectors are stored in `~/.quick-commerce-mcp/flows/<platform>.json`
and preferred over the built-in ones from then on.

Pass `selector: ""` to `diagnose_flow` to drop an override and go back to the built-in
selector.

## A note on bot detection

These sites use aggressive bot detection, which is why this drives a real installed
Chrome with a saved, authenticated session rather than making raw HTTP requests. There
is no proxy option: none is configured or read by the server.

### BigBasket blocked-browser recovery (issue #1)

BigBasket may refuse the default headless browser even with a correct OTP.
Logging in to your normal browser or an incognito window does **not** log MCP
in: it uses a separate profile. Do not keep requesting OTPs on a blocked page.

Install the browser once with `npx playwright install chromium`. **Fully quit
Claude Desktop or stop the MCP server first**, so its headless browser releases
the dedicated profile. Then keep a separate terminal running:

```sh
npx -y --package=quick-commerce-mcp quick-commerce-mcp-bigbasket-browser
```

Reopen Claude Desktop (or reconnect your MCP client) after the helper reports
ready. MCP automatically attaches to that dedicated browser. Ask the assistant
to check BigBasket login, then supply your phone number, pincode and a fresh OTP
only if requested. Keep the terminal running throughout shopping.

On native Windows this command defaults to an invisible isolated desktop.
On macOS/Linux it opens a visible browser; true headless access is not assured.
If a challenge requires manual interaction, stop the helper and rerun it with
`--visible`. Complete the check **in that dedicated browser**, then reconnect MCP.
Use the same OS account and environment for the helper and MCP; a Windows
helper does not publish its endpoint into a WSL home directory. WSL deployments
must use the Windows bridge described in the README. `QC_CHROME_PATH` can select
an installed Chrome executable instead of Playwright Chromium. The background
helper does not require Codex or a Codex-managed Node installation.

This recovery command is available starting with **1.6.1**, or from the
current source checkout (`node scripts/open-bigbasket-browser.mjs`). Do not
assume an older cached `npx` package includes it. Fresh Windows background startup, MCP-compatible browser attachment and the
logged-out BigBasket login button were verified with a temporary profile on
2026-10-05. The isolated desktop now starts on a blank page before MCP navigates,
avoiding the fresh-profile attachment timeout observed when it launched directly
into BigBasket. A clean native Windows installation of the candidate tarball was also tested
with freshly downloaded Chromium, without QC_CHROME_PATH or a custom CDP URL.
MCP sent one OTP, completed login, and returned the saved Bangalore address.
A fresh MCP process preserved the pending OTP screen; after verification, a
complete browser restart plus another fresh MCP process remained logged in
without requesting another OTP. One separate clean run timed out waiting for
login controls, so initial site loading can still fail. These checks apply to
the Windows recovery route, not true headless browsing or all operating systems.
Actual payment submission remains untested in this recovery route.

### Linux and macOS recovery verification (2026-10-05)

A clean candidate tarball installation was checked in Ubuntu 24.04 WSL x86-64
using Node 24 and freshly downloaded native Linux Chromium (Playwright 1.63.0).
No Windows executable, Windows bridge, `QC_CHROME_PATH`, or custom CDP URL was
used. The ordinary headless MCP route was blocked by BigBasket. The recovery
helper on an Xvfb virtual display started successfully, published a private
loopback endpoint, attached through a fresh stdio MCP connection, and reached
the login phone form. Profile permissions were `0700`; endpoint permissions
were `0600`. BigBasket then rejected the single OTP request with HTTP 400 and
did not show an OTP screen. Linux login completion and persistence are therefore
**not verified**. The status alone does not establish why the server rejected it.

On Linux, an Xvfb display keeps headed Chromium off the user desktop:

```sh
# Stop the existing MCP server first. On Ubuntu, install xvfb and xauth if absent.
xvfb-run -a npx -y --package=quick-commerce-mcp quick-commerce-mcp-bigbasket-browser
```

Keep the wrapper running while MCP attaches. This is headed Chromium on a
virtual display; access and login still depend on BigBasket's site checks.
The recovery executable requires **1.6.1 or later**, or a source checkout;
1.6.0 does not expose that executable.

macOS uses the native Playwright Chromium executable and a dedicated visible
browser, without the Windows PowerShell desktop helper. Playwright currently
supports macOS 14 or later; use a supported Node release such as Node 24
([system requirements](https://playwright.dev/docs/intro#system-requirements)).
The validation workflow now runs the build and browser regressions on both
Ubuntu and a native macOS runner. Fixture tests do not establish live BigBasket
login acceptance. A fresh Mac login still needs on-device verification.

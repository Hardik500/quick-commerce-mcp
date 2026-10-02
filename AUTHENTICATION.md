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

Sessions are Playwright `storageState()` snapshots - cookies **plus** localStorage and
sessionStorage - written to:

```
~/.quick-commerce-mcp/sessions/<platform>-session.json
```

That path is under your home directory, not the install location, so sessions survive
updates and work regardless of how the server was installed.

What marks you as logged in, per platform:

| Platform | Signal |
|---|---|
| Zepto | the `user_id` cookie |
| Blinkit | the `gr_1_accessToken` cookie |
| Swiggy Instamart | the `_session_tid` cookie |

Note Zepto is **not** identified by its `session_id` cookie - an anonymous visit is
handed one of those too, so it can't be used to tell a session from a fresh browser.

Sessions expire. When they do, log in again; nothing else needs reinstalling.

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
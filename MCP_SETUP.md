# MCP Configuration Guide

Setup instructions for Claude, Cursor, and other MCP-compatible clients.

---

## 🎯 Supported Clients

| Client | Method | Status |
|--------|--------|--------|
| **Claude Desktop** | Config file | ✅ Ready |
| **Cursor** | Config file | ✅ Ready |
| **Claude Code** | `claude mcp add` | ✅ Ready |
| **Windsurf** | Config file | ✅ Ready |

For Claude Code, one command replaces the config file entirely:

```bash
claude mcp add quick-commerce -- npx -y quick-commerce-mcp
```

---

## 1️⃣ Claude Desktop App

### macOS
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "quick-commerce": {
      "command": "node",
      "args": ["/path/to/quick-commerce-mcp/dist/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### Windows
Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "quick-commerce": {
      "command": "node",
      "args": ["C:\\path\\to\\quick-commerce-mcp\\dist\\index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### Linux
Edit `~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "quick-commerce": {
      "command": "node",
      "args": ["/home/user/quick-commerce-mcp/dist/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**Restart Claude Desktop after saving.**

---

## 2️⃣ Cursor IDE

Edit `~/.cursor/mcp.json` (or project-specific `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "quick-commerce": {
      "command": "node",
      "args": ["/path/to/quick-commerce-mcp/dist/index.js"]
    }
  }
}
```

**Or use Cursor Settings:**
1. Open Cursor → Settings → MCP
2. Click "Add Server"
3. Name: `quick-commerce`
4. Command: `node /path/to/quick-commerce-mcp/dist/index.js`

---

## 3️⃣ Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "quick-commerce": {
      "command": "node",
      "args": ["/path/to/quick-commerce-mcp/dist/index.js"]
    }
  }
}
```

---

## 🛠️ Development Setup

### Using tsx (for development)

```json
{
  "mcpServers": {
    "quick-commerce": {
      "command": "npx",
      "args": ["tsx", "/path/to/quick-commerce-mcp/src/index.ts"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  }
}
```

**Note**: Requires `tsx` installed globally or in project (`npm install -g tsx`)

---

## ✅ Verification

After setup, test with:

```
"Search for Coke Zero on Zepto"
"Where is milk cheapest - Zepto or Swiggy?"
"Check my login status on all platforms"
```

If MCP is connected, you'll see results from the platform searches.

---

## 🐛 Troubleshooting

### "Command not found"
- Ensure `node` is in your PATH
- Use full path to node: `/usr/local/bin/node` (macOS) or `C:\Program Files\nodejs\node.exe` (Windows)

### "Cannot find module"
- Run `npm run build` to compile TypeScript first
- Ensure `dist/index.js` exists

### "Browser automation fails"
- The server uses `QC_CHROME_PATH` when set, otherwise an installed Playwright Chromium build, otherwise system Google Chrome. Install a bundled build with `npx playwright install chromium` when system Chrome is unavailable.
- If Chrome is installed somewhere unusual, point at it explicitly with the `QC_CHROME_PATH` env var in the server config (it takes precedence over the channel lookup):

```json
"env": { "QC_CHROME_PATH": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }
```

- On Linux you may also need browser shared libraries: `npx playwright install-deps chromium`

### Browser visibility with Claude and other clients

Browser automation runs in the local MCP server process, independently of the client UI. Zepto, Blinkit and Instamart normally launch headless browsers. BigBasket currently rejects true headless browsing for the tested account. Its Windows bridge defaults to an invisible background mode: normal Chrome runs on an isolated Windows desktop. This is not true headless, but live saved-login, search, cart and checkout checks work without a browser window on the user desktop. Use `QC_BIGBASKET_BROWSER_MODE=visible` for explicit login recovery, or `headless` for experiments. The bridge is a separate local setup step; it is not automatically launched by Claude. Its scripts are bundled starting with 1.6.0; the portable recovery command described below is added after 1.6.0. A cloud-hosted MCP deployment cannot attach to this local browser. True headless BigBasket tests were blocked; background payment submission remains unverified; clean Windows OTP login and browser/MCP restart persistence were verified on 2026-10-05 as described below. See [AUTHENTICATION.md](AUTHENTICATION.md) for the interactive setup.


### Windows Claude using an outdated checkout

Claude launches exactly the executable and `dist/index.js` named in its config.
Updating Claude does not rebuild or update that MCP server. A Windows copy at
`C:\Users\user\Workspace\Projects\quick-commerce-mcp` can therefore keep running
1.4.1 while this WSL project contains newer fixes. For this workspace, the local
Claude server entry can point directly to the authoritative WSL build:

```json
"quick-commerce": {
  "command": "wsl.exe",
  "args": ["-d", "Ubuntu-24.04", "--", "bash", "-lc",
    "cd /home/hardik/projects/quick-commerce-mcp && exec /home/hardik/.nvm/versions/node/v24.21.0/bin/node dist/index.js"]
}
```

Build in WSL first and fully restart Claude after changing the config. Saved
sessions/preferences are environment-specific; Windows login state is not
silently copied over WSL state. Keep the BigBasket Windows bridge running for
its verified invisible background mode.

New server logs include `mcp_tool_completed` records with tool name, known
platforms, queue time, execution time and outcome. Arguments and results are
excluded. Adapter progress messages go to stderr so stdout remains JSON-RPC.
Claude may omit tool names/arguments from its own protocol log summaries; those
summaries alone cannot identify which tool caused every latency spike.

### MCP not appearing in client
- Restart the client completely
- Check JSON syntax in config file
- Look for errors in client logs

---

## 📁 Project Path Examples

**macOS/Linux:**
```
/Users/hardik/projects/quick-commerce-mcp/dist/index.js
/home/hardik/workspace/quick-commerce-mcp/dist/index.js
```

**Windows:**
```
C:\Users\Hardik\Projects\quick-commerce-mcp\dist\index.js
%USERPROFILE%\projects\quick-commerce-mcp\dist\index.js
```

---

## 🔒 Security Note

The MCP server:
- ✅ Never stores passwords, card numbers or CVV — the CVV is read from the
  `QC_CVV_<last4>` env var at the moment of payment and never written down
- ✅ Requires your OTP for login (sent to your phone)
- ✅ Shows cart preview before any changes
- ✅ Never auto-places orders without confirmation

Locally, under `~/.quick-commerce-mcp/`, it does keep: session cookies, your
saved preferences (phone, pincode, UPI ID, default payment method), any selectors
repaired at runtime, and **payment QR images** — a UPI QR is a scannable payment
instruction carrying the payee VPA and amount, so treat `sessions/` as sensitive.
It never asks for or stores a card number, PIN, or UPI PIN.

---

**Setup complete!** Try asking Claude: "Search for Coke Zero on both Zepto and Swiggy"

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

This recovery command is added after 1.6.0; it requires the next release or the
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
The recovery executable requires the upcoming release or a source checkout;
published 1.6.0 does not expose that executable.

macOS uses the native Playwright Chromium executable and a dedicated visible
browser, without the Windows PowerShell desktop helper. Playwright currently
supports macOS 14 or later; use a supported Node release such as Node 24
([system requirements](https://playwright.dev/docs/intro#system-requirements)).
The validation workflow now runs the build and browser regressions on both
Ubuntu and a native macOS runner. Fixture tests do not establish live BigBasket
login acceptance. A fresh Mac login still needs on-device verification.

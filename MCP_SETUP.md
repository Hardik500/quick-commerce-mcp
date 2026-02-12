# MCP Configuration Guide

Setup instructions for Claude, Cursor, and other MCP-compatible clients.

---

## 🎯 Supported Clients

| Client | Method | Status |
|--------|--------|--------|
| **Claude Desktop** | Config file | ✅ Ready |
| **Cursor** | Config file | ✅ Ready |
| **Claude Code** | Auto-discovery | 🚧 WIP |
| **Windsurf** | Config file | ✅ Ready |

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
- Install Playwright browsers: `npx playwright install chromium`
- Install system deps: `sudo npx playwright install-deps chromium` (Linux)

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
- ✅ Never stores passwords or payment info
- ✅ Requires your OTP for login (sent to your phone)
- ✅ Shows cart preview before any changes
- ✅ Never auto-places orders without confirmation

Your session cookies are stored locally in the MCP's data directory.

---

**Setup complete!** Try asking Claude: "Search for Coke Zero on both Zepto and Swiggy"

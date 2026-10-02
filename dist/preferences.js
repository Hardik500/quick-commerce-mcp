import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const FILE = path.join(os.homedir(), '.quick-commerce-mcp', 'preferences.json');
export function loadPrefs() {
    try {
        return JSON.parse(fs.readFileSync(FILE, 'utf8'));
    }
    catch {
        return {};
    }
}
/** Merge `patch` into saved prefs; an empty string clears that key. */
export function savePrefs(patch) {
    const next = { ...loadPrefs() };
    for (const [k, v] of Object.entries(patch)) {
        if (v === '')
            delete next[k];
        else if (v !== undefined)
            next[k] = v;
    }
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
    return next;
}
//# sourceMappingURL=preferences.js.map
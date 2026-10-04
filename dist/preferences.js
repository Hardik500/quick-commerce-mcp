import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_PAYMENT_ORDER } from './payments.js';
const FILE = path.join(os.homedir(), '.quick-commerce-mcp', 'preferences.json');
export function loadPrefs(file = FILE) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return {};
    }
}
/** True when the user has opted into opening payment QRs in an image viewer. */
export function wantsQrViewer() {
    return loadPrefs().open_qr === 'true';
}
/** Platform overrides inherit unspecified global fields. Aliases share preferences. */
export function paymentPreferencesFor(prefs, platform) {
    const name = platform === 'swiggy' ? 'swiggy-instamart' : platform;
    const legacy = prefs.payment_method === 'upi' ? 'upi' : prefs.payment_method;
    return { order: legacy ? [legacy] : [...DEFAULT_PAYMENT_ORDER], allow_fallback: true,
        ...(prefs.upi_id ? { upi_id: prefs.upi_id } : {}), ...prefs.payment_preferences,
        ...prefs.platform_payment_preferences?.[name] };
}
/** Merge `patch` into saved prefs; an empty string clears that key. */
export function savePrefs(patch, file = FILE) {
    const next = { ...loadPrefs(file) };
    for (const [k, v] of Object.entries(patch)) {
        if (v === '')
            delete next[k];
        else if (v !== undefined)
            next[k] = v;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
    return next;
}
/** A pincode identifies an area, not necessarily one saved home. Never guess
 * between multiple matches, or silently substitute for a saved choice. */
export function preferredAddress(addresses, pincode, saved) {
    const norm = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
    const candidates = saved
        ? addresses.filter(a => norm(a.label) === norm(saved.label) && norm(a.addressLine1) === norm(saved.addressLine1) && (!pincode || a.pincode === pincode))
        : pincode ? addresses.filter(a => a.pincode === pincode) : [];
    return candidates.length === 1 ? candidates[0] : undefined;
}
//# sourceMappingURL=preferences.js.map
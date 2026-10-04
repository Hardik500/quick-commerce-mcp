import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_PAYMENT_ORDER, type PaymentPreferences, type PaymentPreference } from './payments.js';

export interface SavedAddress { label: string; addressLine1: string; pincode: string }

export interface Preferences {
  phone?: string;
  upi_id?: string;
  payment_method?: string;
  payment_preferences?: PaymentPreferences;
  platform_payment_preferences?: Record<string, PaymentPreferences>;
  /** Area / pincode typed into the platform's location search (Blinkit's "Select manually" path). */
  pincode?: string;
  /** Saved by select_address, per platform; text survives picker reordering. */
  selected_addresses?: Record<string, SavedAddress>;
  /**
   * Open a payment QR in the host's image viewer as soon as it is generated.
   * Opt-in ('true'), because it spawns a process on the user's machine.
   *
   * Off by default: Claude Desktop renders tool images in a short, internally
   * scrolled box, so a QR sent inline is clipped and cannot be scanned from the
   * chat. Opening the saved PNG at full size is the only way to get a scannable
   * code on screen, but a published package should not launch a viewer behind
   * the user's back.
   */
  open_qr?: string;
}

const FILE = path.join(os.homedir(), '.quick-commerce-mcp', 'preferences.json');

export function loadPrefs(file = FILE): Preferences {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** True when the user has opted into opening payment QRs in an image viewer. */
export function wantsQrViewer(): boolean {
  return loadPrefs().open_qr === 'true';
}

/** Platform overrides inherit unspecified global fields. Aliases share preferences. */
export function paymentPreferencesFor(prefs: Preferences, platform: string): PaymentPreferences {
  const name = platform === 'swiggy' ? 'swiggy-instamart' : platform;
  const legacy = prefs.payment_method === 'upi' ? 'upi' : prefs.payment_method as PaymentPreference | undefined;
  return { order: legacy ? [legacy] : [...DEFAULT_PAYMENT_ORDER], allow_fallback: true,
    ...(prefs.upi_id ? { upi_id: prefs.upi_id } : {}), ...prefs.payment_preferences,
    ...prefs.platform_payment_preferences?.[name] };
}

/** Merge `patch` into saved prefs; an empty string clears that key. */
export function savePrefs(patch: Preferences, file = FILE): Preferences {
  const next: Record<string, unknown> = { ...loadPrefs(file) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === '') delete next[k];
    else if (v !== undefined) next[k] = v;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next as Preferences;
}

/** A pincode identifies an area, not necessarily one saved home. Never guess
 * between multiple matches, or silently substitute for a saved choice. */
export function preferredAddress<T extends { label: string; addressLine1: string; pincode: string }>(
  addresses: T[], pincode?: string, saved?: SavedAddress,
): T | undefined {
  const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidates = saved
    ? addresses.filter(a => norm(a.label) === norm(saved.label) && norm(a.addressLine1) === norm(saved.addressLine1) && (!pincode || a.pincode === pincode))
    : pincode ? addresses.filter(a => a.pincode === pincode) : [];
  return candidates.length === 1 ? candidates[0] : undefined;
}

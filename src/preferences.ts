import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Preferences {
  phone?: string;
  upi_id?: string;
  payment_method?: string;
  /** Area / pincode typed into the platform's location search (Blinkit's "Select manually" path). */
  pincode?: string;
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

export function loadPrefs(): Preferences {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** True when the user has opted into opening payment QRs in an image viewer. */
export function wantsQrViewer(): boolean {
  return loadPrefs().open_qr === 'true';
}

/** Merge `patch` into saved prefs; an empty string clears that key. */
export function savePrefs(patch: Preferences): Preferences {
  const next: Record<string, string> = { ...loadPrefs() } as any;
  for (const [k, v] of Object.entries(patch)) {
    if (v === '') delete next[k];
    else if (v !== undefined) next[k] = v;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

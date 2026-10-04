import { type PaymentPreferences } from './payments.js';
export interface SavedAddress {
    label: string;
    addressLine1: string;
    pincode: string;
}
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
export declare function loadPrefs(file?: string): Preferences;
/** True when the user has opted into opening payment QRs in an image viewer. */
export declare function wantsQrViewer(): boolean;
/** Platform overrides inherit unspecified global fields. Aliases share preferences. */
export declare function paymentPreferencesFor(prefs: Preferences, platform: string): PaymentPreferences;
/** Merge `patch` into saved prefs; an empty string clears that key. */
export declare function savePrefs(patch: Preferences, file?: string): Preferences;
/** A pincode identifies an area, not necessarily one saved home. Never guess
 * between multiple matches, or silently substitute for a saved choice. */
export declare function preferredAddress<T extends {
    label: string;
    addressLine1: string;
    pincode: string;
}>(addresses: T[], pincode?: string, saved?: SavedAddress): T | undefined;
//# sourceMappingURL=preferences.d.ts.map
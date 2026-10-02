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
export declare function loadPrefs(): Preferences;
/** True when the user has opted into opening payment QRs in an image viewer. */
export declare function wantsQrViewer(): boolean;
/** Merge `patch` into saved prefs; an empty string clears that key. */
export declare function savePrefs(patch: Preferences): Preferences;
//# sourceMappingURL=preferences.d.ts.map
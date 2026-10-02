export interface Preferences {
    phone?: string;
    upi_id?: string;
    payment_method?: string;
    /** Area / pincode typed into the platform's location search (Blinkit's "Select manually" path). */
    pincode?: string;
}
export declare function loadPrefs(): Preferences;
/** Merge `patch` into saved prefs; an empty string clears that key. */
export declare function savePrefs(patch: Preferences): Preferences;
//# sourceMappingURL=preferences.d.ts.map
export declare const PAYMENT_METHODS: readonly ["upi_collect", "upi_qr", "wallet", "card", "cod", "netbanking", "pay_later", "pluxee"];
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export type PaymentPreference = PaymentMethod | 'upi';
export interface PaymentPreferences {
    order?: PaymentPreference[];
    /** Fallback only when a method is absent/disabled, never after submission. */
    allow_fallback?: boolean;
    upi_id?: string;
    wallet_provider?: string;
    card_last4?: string;
}
export declare const DEFAULT_PAYMENT_ORDER: PaymentPreference[];
export declare const EXECUTABLE_PAYMENTS: Record<string, PaymentMethod[]>;
export interface PaymentOption {
    id: string;
    method: PaymentPreference;
    label: string;
    enabled: boolean;
    execution: 'adapter' | 'manual';
    /** Native or linked prepaid credit with an observed checkout balance. */
    balanceVerifiedWallet?: boolean;
}
export interface PaymentPlan {
    preferenceOrder: PaymentPreference[];
    options: PaymentOption[];
    selected?: PaymentOption;
    missing: string[];
    status: 'ready_to_prepare' | 'needs_details' | 'inspect_upi' | 'unavailable';
    message: string;
}
export declare function validatePaymentPreferences(value: unknown): asserts value is PaymentPreferences;
export declare function paymentMethod(label: string): PaymentPreference | undefined;
export declare function paymentOptions(platform: string, labels: Array<string | {
    label: string;
    enabled: boolean;
}>): PaymentOption[];
export declare function planPayment(options: PaymentOption[], prefs?: PaymentPreferences): PaymentPlan;
//# sourceMappingURL=payments.d.ts.map
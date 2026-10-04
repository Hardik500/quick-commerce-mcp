import type { Page, Frame } from 'playwright';
import { type PaymentPlan, type PaymentPreferences, type PaymentOption } from './payments.js';
export declare function paymentRoot(page: Page): Promise<Page | Frame>;
export declare function inspectPayments(page: Page, platform: string, labels: string[]): Promise<PaymentOption[]>;
export interface PaymentPreparation {
    plan: PaymentPlan;
    opened: boolean;
    message: string;
}
export declare function preparePaymentPanel(page: Page, platform: string, labels: string[], prefs: PaymentPreferences, optionId?: string): Promise<PaymentPreparation>;
//# sourceMappingURL=payment-ui.d.ts.map
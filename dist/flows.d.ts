import { Page } from 'playwright';
import type { Locator } from 'playwright';
export type FlowOverrides = Record<string, string>;
/** Steps an override may replace. Anything else is rejected. */
export declare const FLOW_STEPS: readonly ["loginTrigger", "phoneInput", "otpInput", "otpSubmit", "locationModal", "locationSearch", "locationSuggestion", "productCard", "productName", "productPrice", "cartItem", "addToCart"];
export type FlowStep = (typeof FLOW_STEPS)[number];
export declare function loadFlows(platform: string): FlowOverrides;
/** Persist one step's selector. Rejects unknown steps and empty selectors. */
export declare function saveFlow(platform: string, step: string, selector: string): FlowOverrides;
export declare function clearFlow(platform: string, step: string): FlowOverrides;
/**
 * The selector to use for a step: a runtime override if one exists, otherwise
 * the built-in. Keeping this the single entry point is what makes an override
 * take effect everywhere without touching the platform classes.
 */
export declare function selectorFor(platform: string, step: string, builtin: string): string;
/**
 * Resolve a step to a locator, trying the override first and then each built-in
 * candidate in turn. Returns the first that is actually present, so a site that
 * only partially changed keeps working.
 */
export declare function pick(page: Page, platform: string, step: string, builtins: string[], waitMs?: number): Promise<{
    locator: Locator;
    used: string;
} | null>;
/**
 * Everything a human or agent needs to choose a replacement selector, without
 * having to guess at the markup: the interactive elements currently on the page
 * with the attributes that distinguish them.
 */
export declare function fingerprint(page: Page, limit?: number): Promise<string>;
/**
 * Check an override actually resolves on the live page before it is trusted, so
 * a bad one cannot wedge every future run.
 */
export declare function verifyFlow(page: Page, selector: string): Promise<boolean>;
export interface ElementFacts {
    tag: string;
    id: string;
    testIds: string[];
    name: string;
    ariaLabel: string;
    placeholder: string;
    type: string;
    inputMode: string;
    autoComplete: string;
    text: string;
    className: string;
    visible: boolean;
}
/**
 * Try to repair `step` on its own. Returns the adopted selector on success, or a
 * reason it declined. Never adopts without the oracle passing.
 */
export declare function selfRepair(page: Page, platform: string, step: string, builtins: string[]): Promise<{
    selector: string;
    replaced: string;
} | {
    blocked: string;
    rejected: string[];
}>;
//# sourceMappingURL=flows.d.ts.map
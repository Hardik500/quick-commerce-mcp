/**
 * Resilient Selector Engine with AI-powered discovery
 * Uses semantic understanding, multiple fallback strategies, and self-healing
 */
import { Page } from 'playwright';
export interface SelectorResult {
    selector: string;
    confidence: number;
    strategy: string;
    elementCount: number;
}
export interface SemanticMapping {
    elementType: string;
    purpose: 'search' | 'product' | 'cart' | 'login' | 'price' | 'quantity' | 'checkout';
    text?: string;
    attributes?: Record<string, string>;
    location?: 'header' | 'main' | 'sidebar' | 'footer' | 'modal';
}
export declare class ResilientSelectorEngine {
    private page;
    private selectorCache;
    private failedSelectors;
    /**
     * Strategy 1: LLM-Powered Semantic Analysis
     * Use AI to understand page structure and predict selectors
     */
    discoverWithAI(purpose: string): Promise<SelectorResult[]>;
    /**
     * Find elements using semantic HTML5 attributes and ARIA roles
     */
    private findSemanticElements;
    /**
     * Find form elements by input characteristics
     */
    private findFormElements;
    /**
     * Find elements by visual position and hierarchy
     */
    private findVisualElements;
    /**
     * Find elements using heuristics and common patterns
     */
    private findHeuristicElements;
    /**
     * Get page context for LLM analysis
     */
    private getPageContext;
    /**
     * Calculate confidence score based on semantic match
     */
    private calculateSemanticConfidence;
    /**
     * Check if element has relevant attributes for the purpose
     */
    private checkRelevantAttributes;
    /**
     * Self-healing: Try multiple selectors with fallback
     */
    findElementWithFallback(purpose: string, maxAttempts?: number): Promise<{
        element: any;
        selector: string;
    } | null>;
    /**
     * Validate and cache working selector
     */
    validateSelector(purpose: string, selector: string): Promise<boolean>;
    /**
     * Learn from successful interactions
     */
    learnSelector(purpose: string, selector: string): void;
    setPage(page: Page): void;
    getPage(): Page | null;
}
//# sourceMappingURL=resilient-selector.d.ts.map
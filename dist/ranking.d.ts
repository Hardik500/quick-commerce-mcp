import type { Product } from './platforms/base.js';
export declare function unitPrice(p: Product): {
    value: number;
    label: string;
};
export declare function relevant(query: string, products: Product[]): Product[];
export interface Resolution {
    query: string;
    status: 'match' | 'alternatives' | 'none';
    /** match: exact in-stock hits (best first). alternatives: partial in-stock hits. */
    options: Product[];
    /** True when exact matches exist but are all out of stock. */
    outOfStock: boolean;
}
export declare function resolveItem(query: string, products: Product[], max?: number): Resolution;
export declare function rankByUnitPrice(products: Product[]): {
    p: Product;
    u: {
        value: number;
        label: string;
    };
}[];
export declare function storeNotice(pageText: string): string | undefined;
export declare function validateCart(wanted: {
    name: string;
    quantity: number;
}[], cart: {
    items: {
        name: string;
        cartQuantity: number;
    }[];
    subtotal: number;
    total: number;
    fees?: {
        amount: number;
    }[];
}): {
    missing: string[];
    wrongQty: string[];
    billOk: boolean;
};
//# sourceMappingURL=ranking.d.ts.map
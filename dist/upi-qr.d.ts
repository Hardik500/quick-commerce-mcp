/** Decode only local PNG screenshots; never follow URLs from a QR payload. */
export declare function validateUpiQr(image: Buffer, total: number, merchant?: RegExp): {
    amount: number;
    currency: string;
    merchant: string;
    hasReference: boolean;
    width: number;
    height: number;
};
//# sourceMappingURL=upi-qr.d.ts.map
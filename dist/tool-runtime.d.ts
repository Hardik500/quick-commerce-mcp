export declare const ALL_PLATFORMS: string[];
/** Every shared page is locked, including all-platform tools and aliases. */
export declare function platformKeysOf(args: Record<string, unknown> | undefined, name?: string): string[];
/** Diagnostics contain only known tool/platform names and timing, never arguments or output. */
export declare function toolTiming(name: string, knownTools: string[], platforms: string[], queued: number, started: number, ended: number, error: boolean): {
    event: string;
    tool: string;
    platforms: string[];
    queue_ms: number;
    duration_ms: number;
    outcome: string;
};
//# sourceMappingURL=tool-runtime.d.ts.map
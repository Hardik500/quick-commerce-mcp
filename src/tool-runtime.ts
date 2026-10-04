export const ALL_PLATFORMS = ['zepto', 'swiggy-instamart', 'blinkit', 'bigbasket'];

/** Every shared page is locked, including all-platform tools and aliases. */
export function platformKeysOf(args: Record<string, unknown> | undefined, name?: string): string[] {
  const requested = name === 'compare_prices' ? ALL_PLATFORMS : [args?.platform, ...(Array.isArray(args?.platforms) ? args.platforms : [])];
  return [...new Set(requested.flatMap(p => p === 'all' ? ALL_PLATFORMS : typeof p === 'string'
    ? [p === 'swiggy' ? 'swiggy-instamart' : p] : []))].sort();
}

/** Diagnostics contain only known tool/platform names and timing, never arguments or output. */
export function toolTiming(name: string, knownTools: string[], platforms: string[], queued: number, started: number, ended: number, error: boolean) {
  return { event: 'mcp_tool_completed', tool: knownTools.includes(name) ? name : 'unknown_tool',
    platforms: platforms.filter(p => ALL_PLATFORMS.includes(p)),
    queue_ms: Math.max(0, Math.round(started - queued)), duration_ms: Math.max(0, Math.round(ended - started)),
    outcome: error ? 'error' : 'returned' };
}

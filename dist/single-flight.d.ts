/**
 * Run an async factory once per key, and share the result with every caller -
 * including callers that arrive while the first one is still running.
 *
 * The bug this exists to prevent: caching only the *settled* value is not enough
 * when the factory awaits. `if (!map.has(k)) { map.set(k, await work(k)) }` lets
 * two concurrent callers both observe a miss, both start the work, and both
 * write to the map. Callers then get different objects for the same key, and the
 * second write silently discards the first.
 *
 * That is not hypothetical here. `getPlatform` launches a browser, and an
 * assistant batching two tool calls with `Promise.all` - the obvious way to search
 * three platforms at once - made it launch two contexts for one platform. Cart
 * writes landed in one context while reads came from the other, so an empty cart
 * alternated with a full one, `isLoggedIn` disagreed between calls, and the extra
 * page loads drew extra bot challenges, which showed up as searches returning
 * nothing.
 */
export interface SingleFlight<K, V> {
    (key: K): Promise<V>;
    /** True once a value has been produced and not yet invalidated. */
    has(key: K): boolean;
    /**
     * Drop the cached value so the next call runs the factory again. Pass no key to
     * clear everything.
     *
     * A pending call is also forgotten, so a caller that arrives after this returns
     * a fresh result rather than joining a run that is about to be discarded.
     */
    invalidate(key?: K): void;
}
export declare function singleFlight<K, V>(factory: (key: K) => Promise<V>): SingleFlight<K, V>;
//# sourceMappingURL=single-flight.d.ts.map
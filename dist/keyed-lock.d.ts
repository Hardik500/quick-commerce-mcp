/**
 * Serialise work per key, so two operations never touch the same one at once.
 *
 * Each platform is driven through a single Playwright page held on a shared
 * instance, so "one operation per platform" is a real invariant rather than a
 * style preference. Breaking it is not subtle: concurrent `page.goto` calls on
 * one page abort each other (`net::ERR_ABORTED`), and callers then scrape whatever
 * document the last navigation left behind.
 *
 * That is what made a three-platform search look like a flaky site. Firing
 * `search_products` for three queries against Zepto returned results for one
 * query and zero for the other two, every time, because two of the three
 * navigations had been cancelled by the third.
 *
 * Different keys never block each other, so comparing Zepto against Blinkit and
 * Instamart still runs in parallel - only work on the *same* platform queues.
 */
export interface KeyedLock {
    run<T>(keys: readonly string[], job: () => Promise<T>): Promise<T>;
}
export declare function keyedLock(): KeyedLock;
//# sourceMappingURL=keyed-lock.d.ts.map
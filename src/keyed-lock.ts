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

export function keyedLock(): KeyedLock {
  // One tail promise per key: what a caller waits on, and what the next caller
  // will wait on in turn.
  const tails = new Map<string, Promise<void>>();

  async function acquire(key: string): Promise<() => void> {
    const prev = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => {
      release = r;
    });
    // Publish before awaiting, so the next caller queues behind us rather than
    // behind the holder we are waiting on.
    tails.set(key, prev.then(() => mine));
    await prev;
    return release;
  }

  return {
    async run<T>(keys: readonly string[], job: () => Promise<T>): Promise<T> {
      const held = [...new Set(keys)].sort();
      const releases: (() => void)[] = [];
      try {
        // Acquired one at a time in a fixed order. Sorting is what keeps this
        // deadlock-free: every caller takes overlapping keys in the same relative
        // order, so no caller can hold a key another is waiting on.
        for (const k of held) releases.push(await acquire(k));
        return await job();
      } finally {
        for (const r of releases.reverse()) r();
      }
    },
  };
}
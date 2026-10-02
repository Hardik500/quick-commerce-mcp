export function keyedLock() {
    // One tail promise per key: what a caller waits on, and what the next caller
    // will wait on in turn.
    const tails = new Map();
    async function acquire(key) {
        const prev = tails.get(key) ?? Promise.resolve();
        let release;
        const mine = new Promise((r) => {
            release = r;
        });
        // Publish before awaiting, so the next caller queues behind us rather than
        // behind the holder we are waiting on.
        tails.set(key, prev.then(() => mine));
        await prev;
        return release;
    }
    return {
        async run(keys, job) {
            const held = [...new Set(keys)].sort();
            const releases = [];
            try {
                // Acquired one at a time in a fixed order. Sorting is what keeps this
                // deadlock-free: every caller takes overlapping keys in the same relative
                // order, so no caller can hold a key another is waiting on.
                for (const k of held)
                    releases.push(await acquire(k));
                return await job();
            }
            finally {
                for (const r of releases.reverse())
                    r();
            }
        },
    };
}
//# sourceMappingURL=keyed-lock.js.map
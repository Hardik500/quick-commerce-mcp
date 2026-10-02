export function singleFlight(factory) {
    const settled = new Map();
    const inflight = new Map();
    const run = async (key) => {
        if (settled.has(key))
            return settled.get(key);
        let pending = inflight.get(key);
        if (!pending) {
            pending = factory(key).then((value) => {
                settled.set(key, value);
                inflight.delete(key);
                return value;
            }, (err) => {
                // Never cache a failure. A browser that would not launch once should be
                // retried on the next call, not remembered as broken for the process.
                inflight.delete(key);
                throw err;
            });
            inflight.set(key, pending);
        }
        return pending;
    };
    run.has = (key) => settled.has(key);
    run.invalidate = (key) => {
        if (key === undefined) {
            settled.clear();
            inflight.clear();
        }
        else {
            settled.delete(key);
            inflight.delete(key);
        }
    };
    return run;
}
//# sourceMappingURL=single-flight.js.map
/**
 * Click attempts in order. The first covers the ordinary case, including a
 * control that is slow to become stable - Playwright spends that budget
 * waiting for actionability, so it is a real allowance, not a sleep. The second
 * drops those checks, which is the only thing that gets a click through a
 * control the site insists is hidden.
 *
 * Deliberately short, and deliberately only two. The budgets are not "how long
 * to wait for a slow site" - they are "how long to wait before trying
 * something different". A second identical normal click was measured adding
 * ~8s to an overlay-blocked card without ever succeeding, so it is not here:
 * every rung has to be able to do something the previous one could not.
 *
 * A third rung would cost more than it can win. Once a normal click and a
 * forced one have both failed, the control is not merely slow, and `blockedBy`
 * below is what turns that into something the caller can act on instead of a
 * bare failure.
 */
/**
 * Click attempts in order, and what each is for.
 *
 * Only ever used while a click has NOT been dispatched. Once Playwright accepts
 * a click the site may already have added the item, and clicking again is a
 * duplicate rather than a retry - which is how asking for 3 of something put 5
 * in a real cart on a store whose quantity counter never renders. A rung that
 * throws has provably sent nothing, so escalating is safe; that distinction is
 * the whole reason this is a short list.
 *
 * The budgets are not "how long to wait for a slow site" - they are "how long
 * to wait before trying something different". The second drops actionability
 * checks, the only thing that gets a click through a control the site insists
 * is hidden. Nothing further is worth waiting for: by then the page is not in
 * the state the caller asked for, and blockedBy below turns that into something
 * actionable.
 */
export const ADD_RUNGS = [
    { timeout: 5000, force: false },
    { timeout: 3000, force: true },
];
/**
 * What is actually sitting on top of the control, if anything.
 *
 * When every click rung has failed the useful question is not "did it work" -
 * it is "what is in the way". An overlay is a different problem from a missing
 * button, and only one of them is fixable by changing a selector. Reading it
 * costs one bounded DOM hit and turns a dead end into a diagnosis.
 *
 * Returns null when nothing covers the control, or when the answer cannot be
 * read; never throws.
 */
export async function blockedBy(locator) {
    try {
        return await locator.evaluate((el) => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height)
                return 'it has no size on screen';
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight)
                return 'it is outside the viewport';
            const top = document.elementFromPoint(x, y);
            if (!top || el.contains(top) || top.contains(el))
                return null;
            const id = top.id ? `#${top.id}` : '';
            const cls = typeof top.className === 'string' && top.className
                ? `.${top.className.trim().split(/\s+/)[0]}`
                : '';
            const tag = top.tagName.toLowerCase();
            const label = top.getAttribute('aria-label') || (top.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
            return `${tag}${id}${cls}${label ? ` "${label}"` : ''} is covering it`;
        });
    }
    catch {
        // A diagnosis is never worth an exception. This is a best-effort read on an
        // already-failing path, so any problem resolving it returns "unknown".
        return null;
    }
}
/**
 * Decide what to do next about one card. Pure and total: every probe maps to
 * exactly one action, and only a failed click moves the ladder down a rung.
 */
export function nextAddAction(p) {
    // Landing outranks everything. A card already showing a stepper must never be
    // clicked again, or the caller silently gets two of something it asked for
    // once - and an item in the cart is the outcome we wanted anyway.
    if (p.landed)
        return { kind: 'already' };
    // No control in the DOM. A virtualised results list renders cards after the
    // fact, so give it one bounded chance before concluding it is not there.
    if (!p.addPresent)
        return p.waitedForAttach ? { kind: 'absent' } : { kind: 'wait-attach' };
    // Present but not on screen. Scrolling is free and fixes the common mobile
    // case, so it is tried before spending any click budget.
    if (!p.addVisible && !p.scrolled)
        return { kind: 'scroll' };
    const rung = ADD_RUNGS[p.rung];
    if (!rung)
        return { kind: 'failed' };
    return { kind: 'click', timeout: rung.timeout, force: rung.force };
}
//# sourceMappingURL=add-strategy.js.map
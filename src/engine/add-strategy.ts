/**
 * Recovery ladder for "get this product into the cart".
 *
 * A product card is a moving target. Search results are re-rendered while we
 * work, so a control that was on screen when we looked can be detached or
 * zero-sized by the time we click it. One click with a long timeout therefore
 * spends its whole budget proving nothing and then reports a bare failure -
 * which is what made a three-item cart take 110 seconds and change nothing.
 *
 * The policy lives here, apart from the Playwright calls, so it can be tested
 * without a browser. `nextAddAction` is a total function over what can be
 * observed about a card; `addViaCard` in platforms/base.ts is the only thing
 * that touches the page.
 */
import type { Locator } from 'playwright';

/** What an attempt can establish about a single product card. */
export interface CardProbe {
  /** A quantity control is showing: the item is in the cart already. */
  landed: boolean;
  /** An add control exists in the card's DOM. */
  addPresent: boolean;
  /** That add control has a real size and is within the viewport. */
  addVisible: boolean;
  /** Ladder position. Advanced only by a click or proof that did not work. */
  rung: number;
  /** Scrolling the control into view has already been tried. */
  scrolled: boolean;
  /** The card has already been given a bounded chance to render its control. */
  waitedForAttach: boolean;
}

export type AddAction =
  /** Terminal, and a success: the item is in the cart. Do not click again. */
  | { kind: 'already' }
  /** Terminal: this card has no add control at all (out of stock, or the site changed). */
  | { kind: 'absent' }
  /** Terminal: a control was there and nothing we tried made the add take. */
  | { kind: 'failed' }
  /** Non-terminal: wait, bounded, for a card that has not rendered yet. */
  | { kind: 'wait-attach' }
  /** Non-terminal: bring the control on screen before judging it. */
  | { kind: 'scroll' }
  /** Non-terminal: attempt the click at this rung's budget. */
  | { kind: 'click'; timeout: number; force: boolean };

/**
 * How an add ended, for the caller to act on.
 *
 * The distinctions exist because the caller has to treat these differently, and
 * collapsing any two of them costs the user something real:
 *
 * - 'added' / 'already'  - the item is in the cart. Both are successes; 'already'
 *   must never be clicked again.
 * - 'not-found'          - this product's card is not on the page. A fact about
 *   one item (it may be out of stock, or its search may not have surfaced it), so
 *   the caller reports it and carries on with the rest of the list.
 * - 'absent'             - the card IS on the page but offers no add control at
 *   all. A fact about the page, not the item, so the caller stops rather than
 *   repeating a lookup that cannot succeed.
 * - 'failed'             - a control was there and the click did not take. About
 *   this card, so the caller carries on.
 */
export type AddOutcome = 'added' | 'already' | 'not-found' | 'absent' | 'failed';

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
export const ADD_RUNGS = [
  { timeout: 5000, force: false },
  { timeout: 3000, force: true },
] as const;

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
export async function blockedBy(locator: Locator): Promise<string | null> {
  try {
    return await locator.evaluate((el: Element) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return 'it has no size on screen';
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return 'it is outside the viewport';
      const top = document.elementFromPoint(x, y);
      if (!top || el.contains(top) || top.contains(el)) return null;
      const id = top.id ? `#${top.id}` : '';
      const cls = typeof top.className === 'string' && top.className
        ? `.${top.className.trim().split(/\s+/)[0]}`
        : '';
      const tag = top.tagName.toLowerCase();
      const label = top.getAttribute('aria-label') || (top.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
      return `${tag}${id}${cls}${label ? ` "${label}"` : ''} is covering it`;
    });
  } catch {
    // A diagnosis is never worth an exception. This is a best-effort read on an
    // already-failing path, so any problem resolving it returns "unknown".
    return null;
  }
}

/**
 * Decide what to do next about one card. Pure and total: every probe maps to
 * exactly one action, and only a failed click moves the ladder down a rung.
 */
export function nextAddAction(p: CardProbe): AddAction {
  // Landing outranks everything. A card already showing a stepper must never be
  // clicked again, or the caller silently gets two of something it asked for
  // once - and an item in the cart is the outcome we wanted anyway.
  if (p.landed) return { kind: 'already' };

  // No control in the DOM. A virtualised results list renders cards after the
  // fact, so give it one bounded chance before concluding it is not there.
  if (!p.addPresent) return p.waitedForAttach ? { kind: 'absent' } : { kind: 'wait-attach' };

  // Present but not on screen. Scrolling is free and fixes the common mobile
  // case, so it is tried before spending any click budget.
  if (!p.addVisible && !p.scrolled) return { kind: 'scroll' };

  const rung = ADD_RUNGS[p.rung];
  if (!rung) return { kind: 'failed' };
  return { kind: 'click', timeout: rung.timeout, force: rung.force };
}

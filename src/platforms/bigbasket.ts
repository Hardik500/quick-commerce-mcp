import { BrowserContext, Locator } from 'playwright';
import { QuickCommercePlatform, LoginStatus, SearchResult, Product, CartSummary, CartItem, Address, OrderPreview } from './base.js';
import { ensureSessionDir, sessionPath } from '../session-helper.js';
import type { AddOutcome } from '../engine/add-strategy.js';
import { chmodSync } from 'node:fs';

// Observed on BigBasket's desktop storefront and basket, October 2026.
const CARD = '[class*="SKUDeck___StyledDiv"]';
const ROW = 'li[class*="BasketItem___StyledLi"]';
const PLUS = 'button:has(path[d^="M19 11H13V5"])';
const SUGGESTION = 'li:has(a[href*="/pd/"][href*="nc=as"])';

export class BigBasketPlatform extends QuickCommercePlatform {
  private products = new Map<string, Product>();
  private addresses: Address[] = [];
  private suggestionIds = new Set<string>();

  constructor() { super('bigbasket', 'https://www.bigbasket.com'); }

  async initialize(context: BrowserContext): Promise<void> {
    this.context = context;
    // Reattach to an OTP/authenticated tab in the interactive browser. Creating
    // a new page would abandon a pending OTP when the MCP connection restarts.
    this.page = context.pages().filter(page => {
      try { return ['www.bigbasket.com', 'bigbasket.com'].includes(new URL(page.url()).hostname); }
      catch { return false; }
    }).at(-1) ?? await context.newPage();
    if (!this.page.url().startsWith(this.baseUrl)) await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }

  private async assertPage(): Promise<void> {
    if (!this.page) throw new Error('Platform not initialized');
    if (/access denied|verify you are human/i.test(await this.page.locator('body').innerText())) {
      throw new Error('BigBasket blocked this browser. Open the interactive login browser and complete the site check before retrying.');
    }
  }

  async checkLogin(): Promise<LoginStatus> {
    try {
      await this.assertPage();
      const page = this.page!;
      const otp = page.getByText('Enter OTP', { exact: true });
      if (await otp.isVisible()) return { loggedIn: false, otpSent: true };
      // Checkout has no storefront login/basket header. Its account delivery
      // section and payment screen are the authenticated checkout proof.
      if (await page.getByText('Payment Options', { exact: true }).isVisible() &&
        await page.getByText('Delivery Address', { exact: true }).isVisible()) {
        this.isLoggedIn = true;
        return { loggedIn: true };
      }
      const login = page.getByRole('button', { name: 'Login/ Sign Up', exact: true });
      // Authenticated headers expose a basket link; logged-out headers expose Login.
      await login.or(page.locator('a[href^="/basket/"]')).first().waitFor({ timeout: 15000 });
      this.isLoggedIn = !(await login.isVisible());
      return { loggedIn: this.isLoggedIn };
    } catch (e) {
      return { loggedIn: false, indeterminate: true, reason: e instanceof Error ? e.message : 'Page unavailable' };
    }
  }

  async sendOtp(phone: string): Promise<boolean> {
    await this.assertPage();
    const page = this.page!;
    const digits = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!/^\d{10}$/.test(digits)) throw new Error('Use a ten-digit Indian mobile number.');
    const field = page.getByPlaceholder('Enter Phone number/ Email Id', { exact: true });
    if (!(await field.isVisible())) await page.getByRole('button', { name: 'Login/ Sign Up', exact: true }).click();
    await field.fill(digits);
    const response = page.waitForResponse(r => r.url().includes('/member/otp') && r.request().method() === 'POST',
      { timeout: 15000 }).then(r => r.status(), () => undefined);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const sent = await page.getByText('Enter OTP', { exact: true }).waitFor({ timeout: 15000 }).then(() => true, () => false);
    if (!sent) {
      const status = await response;
      throw new Error(`BigBasket did not confirm sending an OTP${status ? ` (login endpoint HTTP ${status})` : ' (no login response observed)'}. No automatic retry was made. Use the interactive login browser to establish a saved session.`);
    }
    return true;
  }

  async submitOtp(otp: string): Promise<boolean> {
    if (!/^\d{6}$/.test(otp)) throw new Error('BigBasket requires a six-digit OTP.');
    await this.assertPage();
    const page = this.page!;
    const inputs = page.locator('input[type="number"]:visible');
    if (await inputs.count() !== 6) return false;
    // The site advances focus on key events; fill() does not drive this flow.
    await inputs.first().focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(otp);
    await page.getByRole('button', { name: 'Verify & Continue', exact: true }).click();
    await page.getByText('Enter OTP', { exact: true }).waitFor({ state: 'hidden', timeout: 20000 });
    if (!(await this.checkLogin()).loggedIn) return false;
    ensureSessionDir();
    await this.context!.storageState({ path: sessionPath(this.name) });
    chmodSync(sessionPath(this.name), 0o600);
    return true;
  }

  async search(query: string): Promise<SearchResult> {
    await this.ensureSession();
    // The storefront's native autocomplete remains usable when full listing
    // and detail pages refuse access. Drive the visible input, never replay APIs.
    await this.page!.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
    await this.assertPage();
    const input = this.page!.locator('input[placeholder="Search for Products..."]:visible').last();
    if (await input.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)) {
      const completed = this.page!.waitForResponse(r => new URL(r.url()).pathname === '/listing-svc/v1/product/term-completion',
        { timeout: 10000 }).then(r => r.status(), () => undefined);
      await input.fill(query);
      const status = await completed;
      if (status === 200) {
        const suggestions = this.page!.locator(SUGGESTION);
        if (await suggestions.first().waitFor({ timeout: 5000 }).then(() => true, () => false)) {
          const products: Product[] = [];
          for (const row of await suggestions.all()) {
            if (!await row.isVisible()) continue;
            const link = row.locator('a[href*="/pd/"]').first();
            const href = await link.getAttribute('href');
            const id = href?.match(/\/pd\/(\d+)\//)?.[1];
            if (!id || products.some(p => p.id === id)) continue;
            const text = await row.innerText();
            const price = text.match(/₹\s*([\d,]+(?:\.\d+)?)/)?.[1];
            if (!price) continue; // Never invent prices for incomplete results.
            const image = row.locator('img').first();
            const product: Product = { id, name: (await link.innerText()).replace(/\s+/g, ' ').trim(),
              quantity: text.match(/\b\d+(?:\.\d+)?\s*(?:x\s*\d+(?:\.\d+)?\s*)?(?:kg|g|ml|l|pcs?|packs?)\b/i)?.[0] ?? '',
              price: Number(price.replace(/,/g, '')), platform: this.name,
              inStock: !/notify me|out of stock/i.test(text), imageUrl: await image.count() ? await image.getAttribute('src') ?? undefined : undefined };
            products.push(product); this.products.set(id, product); this.suggestionIds.add(id);
          }
          if (products.length) {
            this.rememberSearch(query, products);
            return { query, platform: this.name, products, totalResults: products.length,
              information: 'Native search suggestions; limited results, not the full catalog. Refine the query to find other products.' };
          }
        }
      }
    }
    const listing = this.page!.waitForResponse(r => new URL(r.url()).pathname === '/listing-svc/v2/products',
      { timeout: 20000 }).then(r => r.status(), () => undefined);
    await this.page!.goto(`${this.baseUrl}/ps/?q=${encodeURIComponent(query)}&nc=as`, { waitUntil: 'domcontentloaded' });
    await this.assertPage();
    const cards = this.page!.locator(CARD);
    const found = await cards.first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    if (!found) {
      if (await listing === 403) throw new Error('BigBasket refused its product listing service (HTTP 403). The account may still be logged in and the cart usable. Complete any site check in the interactive browser; do not request another OTP or retry cart writes.');
      const text = await this.page!.locator('body').innerText();
      if (/no (?:products|results)|0\s+result/i.test(text)) return { query, platform: this.name, products: [], totalResults: 0 };
      throw new Error('BigBasket search results did not load; check the delivery location and retry.');
    }
    const products: Product[] = [];
    for (const card of await cards.all()) {
      const href = await card.locator('a[href*="/pd/"]').first().getAttribute('href');
      const id = href?.match(/\/pd\/(\d+)\//)?.[1];
      if (!id) continue;
      const title = await card.locator('a h3').first().innerText();
      const brand = await card.locator('[class*="BrandName___StyledLabel"]').first().innerText().catch(() => '');
      const heading = await card.innerText();
      const quantity = heading.match(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|pcs?|set)\b[^\n]*/i)?.[0] ?? '';
      const amounts = [...(await card.innerText()).matchAll(/₹\s*([\d,]+(?:\.\d+)?)/g)].map(m => Number(m[1].replace(/,/g, '')));
      const p: Product = { id, name: `${brand} ${title}`.trim(), brand, quantity, price: amounts[0] ?? 0,
        mrp: amounts[1], platform: this.name, inStock: !(await card.getByRole('button', { name: 'Notify Me', exact: true }).count()),
        imageUrl: await card.locator('img').first().getAttribute('src') ?? undefined };
      products.push(p); this.products.set(id, p); this.suggestionIds.delete(id);
    }
    this.rememberSearch(query, products);
    return { query, platform: this.name, products, totalResults: products.length };
  }

  private async quantity(card: Locator): Promise<number> {
    // Add remains attached below the clipped stepper. A numeric counter is the proof.
    const value = await card.locator(PLUS).first().evaluate(e => e.previousElementSibling?.textContent ?? '').catch(() => '');
    return /^\d+$/.test(value.trim()) ? Number(value.trim()) : 0;
  }

  async addToCart(id: string, quantity: number): Promise<AddOutcome> {
    this.lastAddBlocker = null;
    if (!/^\d+$/.test(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) return 'failed';
    await this.ensureSession();
    // A restored session may have cart items but no cached search. Existing
    // basket controls are the authoritative path for those IDs.
    if (!this.products.has(id) || new URL(this.page!.url()).pathname === '/basket/') {
      const cart = await this.getCart();
      const existing = cart?.items.find(item => item.id === id);
      if (existing) {
        if (existing.cartQuantity > quantity) { this.lastAddBlocker = 'The cart already contains more than the requested quantity'; return 'failed'; }
        if (existing.cartQuantity === quantity) return 'already';
        let current = existing.cartQuantity;
        while (current < quantity) {
          const row = this.page!.locator(ROW).filter({ has: this.page!.locator(`img[src*="/${id}_"]`) });
          const before = current;
          await row.locator('button#increment').click({ timeout: 4000 });
          const confirmed = await this.page!.waitForFunction(({ selector, id, expected }) => {
            const row = [...document.querySelectorAll(selector)].find(e => e.querySelector(`img[src*="/${id}_"]`));
            return Number(row?.querySelector('button#increment')?.previousElementSibling?.textContent) === expected;
          }, { selector: ROW, id, expected: before + 1 }, { timeout: 10000 }).then(() => true, () => false);
          if (!confirmed) { this.lastAddBlocker = 'Basket increment was not confirmed; no duplicate click was attempted'; return 'failed'; }
          const persisted = (await this.getCart())?.items.find(item => item.id === id)?.cartQuantity;
          if (persisted !== before + 1) { this.lastAddBlocker = 'Persisted basket did not confirm the increment'; return 'failed'; }
          current = persisted;
        }
        return 'added';
      }
    }
    await this.restoreProductSearch(id);
    const cards = this.page!.locator(this.suggestionIds.has(id) ? SUGGESTION : CARD).filter({ has: this.page!.locator(`a[href*="/pd/${id}/"]`) });
    if (await cards.count() !== 1) return 'absent';
    const card = cards.first();
    if (await card.getByRole('button', { name: 'Notify Me', exact: true }).count()) { this.lastAddBlocker = 'Product is out of stock'; return 'failed'; }
    if (this.suggestionIds.has(id)) {
      // Suggestion steppers vary from catalog cards. Dispatch at most one
      // Add, then use the persisted basket as the quantity proof.
      const add = card.getByRole('button', { name: 'Add', exact: true });
      if (await add.count() !== 1 || !await add.isVisible()) { this.lastAddBlocker = 'No unique native suggestion Add control; inspect the basket before retrying.'; return 'failed'; }
      await add.click({ timeout: 4000 });
      await this.page!.waitForTimeout(500);
      const persisted = (await this.getCart())?.items.find(item => item.id === id)?.cartQuantity;
      if (persisted !== 1) { this.lastAddBlocker = 'Suggestion Add did not persist exactly one item. No second Add was attempted; inspect the basket.'; return 'failed'; }
      return quantity === 1 ? 'added' : this.addToCart(id, quantity);
    }
    let current = await this.quantity(card);
    if (current >= quantity) {
      if (current !== quantity) { this.lastAddBlocker = 'The cart already contains more than the requested quantity'; return 'failed'; }
      const cart = await this.getCart();
      return cart?.items.find(i => i.id === id)?.cartQuantity === quantity ? 'already' : 'failed';
    }
    while (current < quantity) {
      const before = current;
      if (!current) await card.getByRole('button', { name: 'Add', exact: true }).click({ timeout: 4000 });
      else await card.locator(PLUS).click({ timeout: 4000 });
      const deadline = Date.now() + 10000;
      do { current = await this.quantity(card); if (current === before + 1) break; await this.page!.waitForTimeout(100); } while (Date.now() < deadline);
      if (current !== before + 1) { this.lastAddBlocker = 'Cart change was not proven. Read the basket before retrying to avoid duplicate additions.'; return 'failed'; }
    }
    const cart = await this.getCart();
    if (cart?.items.find(i => i.id === id)?.cartQuantity === quantity) return 'added';
    this.lastAddBlocker = 'The product counter changed but the basket did not confirm the requested quantity';
    return 'failed';
  }

  async getCart(): Promise<CartSummary | null> {
    await this.ensureSession();
    await this.page!.goto(`${this.baseUrl}/basket/`, { waitUntil: 'domcontentloaded' });
    await this.assertPage();
    await this.page!.locator(ROW).first().or(this.page!.getByText("Let's fill the empty", { exact: true })).waitFor({ timeout: 20000 });
    const items: CartItem[] = [];
    for (const row of await this.page!.locator(ROW).all()) {
      const image = await row.locator('img').first().getAttribute('src') ?? '';
      const id = image.match(/\/p\/[a-z]+\/(\d+)_/)?.[1];
      if (!id) throw new Error('BigBasket basket row has no identifiable product ID');
      const name = await row.locator('[class*="BasketDescription___StyledDiv"]').innerText();
      const count = Number(await row.locator('button#increment').evaluate(e => e.previousElementSibling?.textContent ?? ''));
      if (!Number.isInteger(count) || count < 1) throw new Error('BigBasket basket quantity could not be read');
      const price = Number((await row.innerText()).match(/₹\s*([\d.]+)/)?.[1] ?? 0);
      const known = this.products.get(id);
      items.push({ ...known, id, name: known?.name ?? name, quantity: known?.quantity ?? '', price, platform: this.name, inStock: true, cartQuantity: count });
    }
    const subtotal = items.reduce((sum, i) => sum + i.price * i.cartQuantity, 0);
    return { platform: this.name, items, subtotal, deliveryFee: 0, total: subtotal,
      information: 'Delivery and other fees are confirmed at checkout. Unavailable items may be excluded from these basket rows.' };
  }

  async removeFromCart(id: string): Promise<boolean> {
    const cart = await this.getCart();
    const matches = cart?.items.filter(i => i.id === id || i.name.toLowerCase() === id.toLowerCase()) ?? [];
    if (matches.length !== 1) return false;
    const row = this.page!.locator(ROW).filter({ has: this.page!.locator(`img[src*="/${matches[0].id}_"]`) });
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await row.waitFor({ state: 'hidden', timeout: 10000 });
    return !(await this.getCart())?.items.some(i => i.id === matches[0].id);
  }

  async clearCart(): Promise<boolean> {
    throw new Error('BigBasket clear_cart is not enabled: unavailable items may be hidden. Remove individual visible items instead.');
  }

  protected async openAddressPicker(): Promise<Locator> {
    await this.ensureSession();
    const page = this.page!;
    const trigger = page.getByRole('button', { name: /Home:|Select Location|Delivery in/ }).last();
    if (!(await trigger.isVisible())) await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
    await trigger.click();
    const cards = page.locator('[role="menuitem"]').filter({ hasText: /\b\d{6}\b/ });
    await cards.first().waitFor({ timeout: 8000 });
    return cards;
  }

  async getAddresses(): Promise<Address[]> {
    const cards = await this.openAddressPicker();
    this.addresses = (await cards.allInnerTexts()).map((text, i) => {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      return { id: String(i), label: lines[0], addressLine1: lines.slice(1).join(', '), pincode: text.match(/\b\d{6}\b/)?.[0] ?? '', city: '', phone: '' };
    });
    await this.page!.keyboard.press('Escape');
    return this.addresses;
  }

  async selectAddress(id: string): Promise<boolean> {
    const target = this.addresses.find(a => a.id === id) ?? (await this.getAddresses()).find(a => a.id === id);
    if (!target) return false;
    const cards = await this.openAddressPicker();
    const card = cards.filter({ hasText: target.addressLine1.split(',')[0] }).filter({ hasText: target.label });
    if (await card.count() !== 1) return false;
    // The active address has a checkmark, and clicking it again leaves the
    // menu open. Verify selection rather than treating menu closure as proof.
    const selected = card.locator('svg[width="11"][height="8"] path[d^="M4.075"]');
    if (!(await selected.isVisible())) {
      await card.locator('[class*="AddressCard"]').first().click();
      await selected.waitFor({ timeout: 10000 });
    }
    await this.page!.keyboard.press('Escape');
    await cards.first().waitFor({ state: 'hidden', timeout: 10000 });
    this.rememberAddress(target);
    return true;
  }

  async getOrderPreview(): Promise<OrderPreview | null> {
    const cart = await this.getCart();
    if (!cart?.items.length) return null;
    const address = await this.page!.getByRole('button', { name: /Home:|Delivery in/ }).last().innerText();
    await this.page!.getByRole('button', { name: 'Proceed to Checkout', exact: true }).click();
    const unavailable = this.page!.getByText(/Confirm will remove the unavailable items/);
    if (await unavailable.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
      throw new Error('BigBasket requires removing unavailable items before checkout. Ask the user before confirming removal in the app.');
    }
    await this.page!.getByText('Payment Options', { exact: true }).waitFor({ timeout: 20000 });
    const payment = this.page!.frameLocator('iframe[name="HyperServices"]');
    await payment.getByRole('tab').first().waitFor({ timeout: 20000 });
    const methods = (await payment.getByRole('tab').allInnerTexts()).map(t => t.trim()).filter(Boolean);
    const amount = async (label: string) => {
      const text = await this.page!.getByText(label, { exact: true }).evaluate(e => e.parentElement?.textContent ?? '');
      const values = [...text.matchAll(/₹\s*([\d,]+(?:\.\d+)?)/g)].map(m => Number(m[1].replace(/,/g, '')));
      if (!values.length) throw new Error(`BigBasket checkout did not expose ${label}`);
      return values[values.length - 1];
    };
    cart.subtotal = await amount('Basket Value');
    cart.deliveryFee = await amount('Delivery & Handling Charges');
    cart.fees = [{ label: 'Delivery & Handling Charges', amount: cart.deliveryFee }];
    cart.total = await amount('Total Amount Payable');
    cart.notice = undefined;
    cart.information = undefined;
    const delivery = await this.page!.getByText('Delivery Address', { exact: true }).evaluate(element => {
      for (let node: HTMLElement | null = element as HTMLElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
        const text = node.textContent?.trim() ?? '';
        const address = text.replace(/^Delivery Address\s*/, '').replace(/Change\s*$/, '').trim();
        if (address.length > 10 && text.length < 600) return address;
      }
      return '';
    });
    return { cart, address: delivery || address, paymentMethods: methods };
  }

  async placeOrder(paymentMethod = 'auto', confirm = false, provider?: string) {
    if (paymentMethod === 'wallet') return this.placeWalletOrder(confirm, provider);
    return { success: false, message: 'BigBasket payment execution is deferred. Use get_order_preview to inspect checkout; no order was placed.' };
  }
}

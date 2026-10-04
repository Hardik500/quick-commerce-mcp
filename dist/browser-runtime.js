/** Headless is the normal mode; visible login recovery must be explicit. */
export function bigBasketHeadless(value = process.env.QC_BIGBASKET_HEADLESS) {
    if (value === undefined || value === 'true')
        return true;
    if (value === 'false')
        return false;
    throw new Error('QC_BIGBASKET_HEADLESS must be true or false.');
}
export function bigBasketBrowserArgs(profile, headless) {
    return [`--user-data-dir=${profile}`, '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
        ...(headless ? ['--headless=new', '--window-size=1280,900', '--disable-blink-features=AutomationControlled'] : []), 'https://www.bigbasket.com'];
}
export function bigBasketBrowserMode(value = process.env.QC_BIGBASKET_BROWSER_MODE) {
    if (value === undefined)
        return 'background';
    if (value === 'headless' || value === 'background' || value === 'visible')
        return value;
    throw new Error('QC_BIGBASKET_BROWSER_MODE must be headless, background or visible.');
}
//# sourceMappingURL=browser-runtime.js.map
/**
 * Inspect selectors on live sites
 * Run: npx tsx scripts/inspect-selectors.ts
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import { StealthBrowser } from '../src/engine/stealth-browser.js';
import { sessionPath } from '../src/session-helper.js';

async function inspectZepto() {
  console.log('🔍 Inspecting Zepto selectors...\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15',
    viewport: { width: 390, height: 844 },
  });

  const page = await context.newPage();

  try {
    await page.goto('https://www.zeptonow.com', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Screenshot
    await page.screenshot({ path: 'logs/zepto-inspect.png' });
    console.log('📸 Screenshot: logs/zepto-inspect.png');

    // Find search input
    const possibleSelectors = [
      'input[type="search"]',
      'input[placeholder*="Search" i]',
      'input[data-testid*="search" i]',
      '[class*="search"] input',
      'input[name*="search" i]',
      'input[id*="search" i]',
      'header input',
      'nav input',
    ];

    console.log('\n🔍 Finding search input...');
    for (const selector of possibleSelectors) {
      const found = await page.$(selector);
      if (found) {
        const tagName = await found.evaluate(el => el.tagName);
        const placeholder = await found.evaluate(el => (el as HTMLInputElement).placeholder);
        const type = await found.evaluate(el => (el as HTMLInputElement).type);
        console.log(`✅ Found: ${selector}`);
        console.log(`   Tag: ${tagName}, Type: ${type}, Placeholder: "${placeholder}"`);
        
        // Get outer HTML
        const outerHTML = await found.evaluate(el => el.outerHTML.substring(0, 200));
        console.log(`   HTML: ${outerHTML}...\n`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

async function inspectBlinkit() {
  console.log('\n🔍 Inspecting Blinkit selectors...\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15',
    viewport: { width: 390, height: 844 },
  });

  const page = await context.newPage();

  try {
    await page.goto('https://blinkit.com', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Screenshot
    await page.screenshot({ path: 'logs/blinkit-inspect.png' });
    console.log('📸 Screenshot: logs/blinkit-inspect.png');

    // Find search input
    const possibleSelectors = [
      'input[type="search"]',
      'input[placeholder*="Search" i]',
      'input[data-testid*="search" i]',
      '[class*="search"] input',
      'textarea[placeholder*="Search" i]', // Some sites use textarea
      'header input',
    ];

    console.log('\n🔍 Finding search input...');
    for (const selector of possibleSelectors) {
      const found = await page.$(selector);
      if (found) {
        const tagName = await found.evaluate(el => el.tagName);
        const placeholder = await found.evaluate(el => (el as HTMLInputElement).placeholder || (el as HTMLTextAreaElement).placeholder);
        console.log(`✅ Found: ${selector}`);
        console.log(`   Tag: ${tagName}, Placeholder: "${placeholder}"`);
        
        const outerHTML = await found.evaluate(el => el.outerHTML.substring(0, 200));
        console.log(`   HTML: ${outerHTML}...\n`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

async function inspectZeptoAuthenticated() {
  console.log('\n🔍 Inspecting Zepto selectors (authenticated)...\n');

  const savedSession = sessionPath('zepto');
  if (!fs.existsSync(savedSession)) {
    console.error(`❌ No saved session found at ${savedSession}`);
    console.error('   Run: npx tsx src/session-helper.ts login zepto');
    return;
  }

  const stealth = new StealthBrowser();
  const context = await stealth.launch({
    headless: true,
    storageStatePath: savedSession,
  });
  const page = await context.newPage();

  try {
    await page.goto('https://www.zeptonow.com', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'logs/zepto-post-login.png' });
    console.log('📸 Screenshot: logs/zepto-post-login.png');

    const searchInputSelectors = [
      '[data-testid="search-input"]',
      'input[placeholder*="Search" i]',
      'input[role="searchbox"]',
      '[class*="SearchBar"] input',
      'header input',
    ];

    console.log('\n🔍 Finding search input...');
    let searchInput = null;
    for (const selector of searchInputSelectors) {
      const found = await page.$(selector);
      if (found) {
        console.log(`✅ Found: ${selector}`);
        searchInput = found;
        break;
      }
    }

    if (searchInput) {
      await searchInput.click();
      await searchInput.fill('milk');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      await page.screenshot({ path: 'logs/zepto-post-search.png' });
      console.log('📸 Screenshot: logs/zepto-post-search.png');
    } else {
      console.log('❌ No search input found - cannot test search flow');
    }

    const productCardSelectors = [
      '[data-testid="product-card"]',
      '.product-card',
      '[class*="ProductCard"]',
      '[data-sku]',
      '[class*="product"]',
    ];

    console.log('\n🔍 Finding product cards...');
    for (const selector of productCardSelectors) {
      const found = await page.$$(selector);
      if (found.length > 0) {
        console.log(`✅ Found ${found.length} matches: ${selector}`);
        const outerHTML = await found[0].evaluate(el => el.outerHTML.substring(0, 300));
        console.log(`   Sample HTML: ${outerHTML}...\n`);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await stealth.close();
  }
}

(async () => {
  await inspectZepto();
  await inspectZeptoAuthenticated();
  await inspectBlinkit();
  console.log('\n✅ Inspection complete!');
})();

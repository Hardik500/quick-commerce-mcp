/**
 * Inspect selectors on live sites
 * Run: npx tsx scripts/inspect-selectors.ts
 */
import { chromium } from 'playwright';

async function inspectZepto() {
  console.log('🔍 Inspecting Zepto selectors...\n');

  const browser = await chromium.launch({ headless: true });
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

  const browser = await chromium.launch({ headless: true });
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

(async () => {
  await inspectZepto();
  await inspectBlinkit();
  console.log('\n✅ Inspection complete!');
})();

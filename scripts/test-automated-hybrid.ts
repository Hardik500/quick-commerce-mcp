/**
 * Automated hybrid retry system
 * User provides: phone/email. Only OTP is requested live.
 * Strategy: Stealth → API → Manual (with user help)
 */
import { StealthBrowser } from '../src/engine/stealth-browser.js';
import { ZeptoAPIClient } from '../src/api/quick-commerce-api.js';

interface UserCredentials {
  phone: string;
  email?: string;
}

interface SearchRequest {
  query: string;
  platforms: string[];
  credentials: UserCredentials;
}

export class AutomatedHybridSystem {
  private stealthBrowser = new StealthBrowser();
  private apiClient = new ZeptoAPIClient();
  private mode: 'stealth' | 'api' | 'manual' = 'stealth';
  private credentials: UserCredentials | null = null;

  async initialize(credentials: UserCredentials): Promise<{ mode: string; needsOtp: boolean; message: string }> {
    this.credentials = credentials;

    console.log('🤖 Automated Hybrid System initializing...\n');
    console.log(`   Phone: ${credentials.phone}`);
    console.log(`   Email: ${credentials.email || 'N/A'}\n`);

    // Strategy 1: Try Stealth Browser
    console.log('🥷 Attempt 1: Stealth Browser Mode');
    const stealthResult = await this.tryStealth();
    
    if (stealthResult.success) {
      this.mode = 'stealth';
      return {
        mode: 'stealth',
        needsOtp: false,
        message: 'Connected via stealth browser',
      };
    }

    console.log('   ❌ Stealth blocked\n');

    // Strategy 2: Try API-based
    console.log('📡 Attempt 2: API-based Mode');
    const apiResult = await this.tryAPI(credentials.phone);

    if (apiResult.otpSent) {
      this.mode = 'api';
      return {
        mode: 'api',
        needsOtp: true,
        message: `OTP sent to ${credentials.phone}`,
      };
    }

    console.log('   ❌ API mode not ready (needs reverse engineering)\n');

    // Strategy 3: Manual mode
    console.log('👤 Attempt 3: Manual Coordination Mode');
    this.mode = 'manual';
    
    return {
      mode: 'manual',
      needsOtp: false,
      message: 'I\'ll guide you to search and report back prices',
    };
  }

  private async tryStealth(): Promise<{ success: boolean }> {
    try {
      const context = await this.stealthBrowser.launch({ headless: true });
      const page = await context.newPage();
      
      // Test if we can reach real app
      await page.goto('https://www.zeptonow.com', { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);

      const title = await page.title();
      const content = await page.content();
      
      // Check if we got real app or challenge page
      const isRealApp = content.includes('product') || content.includes('search');
      const hasChallenge = content.includes('cf-challenge') || content.includes('captcha');

      await this.stealthBrowser.close();

      return { success: isRealApp && !hasChallenge };
    } catch {
      return { success: false };
    }
  }

  private async tryAPI(phone: string): Promise<{ otpSent: boolean }> {
    const result = await this.apiClient.initialize(phone);
    return { otpSent: result.otpSent };
  }

  async submitOtp(otp: string): Promise<boolean> {
    if (this.mode === 'api' && this.credentials) {
      const result = await this.apiClient.verifyOtp(this.credentials.phone, otp);
      return result.success;
    }
    return false;
  }

  async searchProducts(request: SearchRequest): Promise<any> {
    if (this.mode === 'stealth') {
      return await this.stealthSearch(request);
    }
    
    if (this.mode === 'api') {
      // Currently simulated, would be real when API reversed
      const products = await this.apiClient.searchProducts(request.query);
      return {
        platform: 'zepto',
        mode: 'api',
        products,
      };
    }

    if (this.mode === 'manual') {
      return {
        mode: 'manual',
        instructions: `
Please search for "${request.query}" on these platforms manually:

1. Open https://www.zeptonow.com
2. Search for "${request.query}"
3. Copy the first 3 results (name + price)
4. Repeat for: Blinkit, Swiggy Instamart

Share the results and I'll compare prices for you!
        `,
      };
    }
  }

  private async stealthSearch(request: SearchRequest): Promise<any> {
    // This would use the stealth browser with discovered selectors
    return {
      platform: 'zepto',
      mode: 'stealth',
      message: 'Stealth search would execute here',
      query: request.query,
    };
  }
}

// Self-test
async function testAutomatedSystem() {
  console.log('='.repeat(60));
  console.log('🧪 AUTOMATED HYBRID SYSTEM TEST');
  console.log('='.repeat(60) + '\n');

  const system = new AutomatedHybridSystem();
  
  // Simulate user providing credentials
  const credentials = {
    phone: '+919876543210', // Simulated
    email: 'user@example.com',
  };

  const init = await system.initialize(credentials);
  
  console.log('\n' + '='.repeat(60));
  console.log('RESULT');
  console.log('='.repeat(60));
  console.log(`Mode: ${init.mode.toUpperCase()}`);
  console.log(`Needs OTP: ${init.needsOtp ? '✅ Yes' : '❌ No'}`);
  console.log(`Message: ${init.message}\n`);

  if (init.needsOtp) {
    console.log('User would provide OTP here...');
    console.log('System proceeds after OTP verification\n');
  }

  // Simulate search
  const searchResult = await system.searchProducts({
    query: 'Coke Zero 6 pack',
    platforms: ['zepto'],
    credentials,
  });

  console.log('Search result:');
  console.log(JSON.stringify(searchResult, null, 2));
}

testAutomatedSystem();

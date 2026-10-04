import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('fresh MCP exposes payment routing on every app and persists validated scoped preferences', async () => {
  const home = mkdtempSync(join(tmpdir(), 'qc-payment-mcp-'));
  const client = new Client({ name: 'payment-integration-test', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'],
    env: { ...process.env, HOME: home }, stderr: 'ignore' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const wallet = listed.tools.find(t => t.name === 'get_wallet_status')!;
    const walletSchema = wallet.inputSchema as unknown as { properties: { platform: { enum: string[] } } };
    assert.deepEqual(walletSchema.properties.platform.enum, ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'bigbasket']);
    assert.ok(JSON.stringify(wallet.inputSchema).includes('wallet_provider'));
    assert.ok(JSON.stringify(listed.tools.find(t => t.name === 'place_order')!.inputSchema).includes('wallet_provider'));
    for (const name of ['get_payment_options', 'prepare_payment']) {
      const schema = listed.tools.find(t => t.name === name)!.inputSchema as unknown as { properties: { platform: { enum: string[] } } };
      assert.deepEqual(schema.properties.platform.enum, ['zepto', 'swiggy-instamart', 'blinkit', 'bigbasket']);
    }
    const call = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'set_payment_preferences', arguments: args }) as unknown as
        { isError?: boolean; content: Array<{ type: string; text?: string }> };
      return { error: result.isError, value: result.content[0].type === 'text' ? result.content[0].text ?? '' : '' };
    };
    assert.equal((await call({ order: ['wallet', 'upi_qr'], wallet_provider: 'Amazon Pay' })).error, undefined);
    await call({ platform: 'swiggy', order: ['upi', 'cod'], allow_fallback: false });
    const saved = JSON.parse((await call({ platform: 'swiggy-instamart' })).value);
    assert.deepEqual(saved.preferences.order, ['upi', 'cod']);
    assert.equal(saved.preferences.wallet_provider, 'Amazon Pay');
    assert.equal(saved.preferences.allow_fallback, false);
    assert.equal((await call({ order: ['not-a-method'] })).error, true);
    assert.equal((await call({ cvv: '000' })).error, true);
    await call({ platform: 'swiggy', reset: true });
    assert.deepEqual(JSON.parse((await call({ platform: 'swiggy' })).value).preferences.order, ['wallet', 'upi_qr']);
    await call({ reset: true });
    assert.deepEqual(JSON.parse((await call({})).value).preferences.order, ['upi_collect', 'upi_qr', 'wallet', 'card', 'cod']);
  } finally { await client.close(); rmSync(home, { recursive: true, force: true }); }
});

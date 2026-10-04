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
        assert.ok(listed.tools.some(t => t.name === 'get_payment_status'));
        const status = await client.callTool({ name: 'get_payment_status', arguments: { platform: 'bigbasket', wait_ms: -1 } });
        assert.equal(status.isError, true);
        const wallet = listed.tools.find(t => t.name === 'get_wallet_status');
        const walletSchema = wallet.inputSchema;
        assert.deepEqual(walletSchema.properties.platform.enum, ['zepto', 'swiggy', 'swiggy-instamart', 'blinkit', 'bigbasket']);
        assert.ok(JSON.stringify(wallet.inputSchema).includes('wallet_provider'));
        assert.ok(JSON.stringify(listed.tools.find(t => t.name === 'place_order').inputSchema).includes('wallet_provider'));
        assert.ok(JSON.stringify(listed.tools.find(t => t.name === 'place_order').inputSchema).includes('Zepto/BigBasket'));
        for (const name of ['get_payment_options', 'prepare_payment']) {
            const schema = listed.tools.find(t => t.name === name).inputSchema;
            assert.deepEqual(schema.properties.platform.enum, ['zepto', 'swiggy-instamart', 'blinkit', 'bigbasket']);
        }
        const call = async (args) => {
            const result = await client.callTool({ name: 'set_payment_preferences', arguments: args });
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
    }
    finally {
        await client.close();
        rmSync(home, { recursive: true, force: true });
    }
});
test('MCP process restart preserves preferences and supports a fresh client handshake', async () => {
    const home = mkdtempSync(join(tmpdir(), 'qc-mcp-restart-'));
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            const client = new Client({ name: 'restart-integration-test', version: '1.0.0' }, { capabilities: {} });
            const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'],
                env: { ...process.env, HOME: home }, stderr: 'ignore' });
            try {
                await client.connect(transport);
                assert.equal(client.getServerCapabilities()?.tools !== undefined, true);
                await client.ping();
                assert.ok((await client.listTools()).tools.some(t => t.name === 'get_wallet_status'));
                const result = await client.callTool({ name: 'set_payment_preferences', arguments: attempt === 0
                        ? { platform: 'bigbasket', order: ['wallet', 'upi_qr'], wallet_provider: 'Amazon Pay', allow_fallback: false }
                        : { platform: 'bigbasket' } });
                assert.notEqual(result.isError, true);
                const content = result.content;
                const saved = JSON.parse(content[0].text).preferences;
                assert.deepEqual(saved.order, ['wallet', 'upi_qr']);
                assert.equal(saved.wallet_provider, 'Amazon Pay');
                assert.equal(saved.allow_fallback, false);
                const invalid = await client.callTool({ name: 'nonexistent_tool', arguments: {} });
                assert.equal(invalid.isError, true);
                await client.ping(); // A rejected tool call must not close the transport.
            }
            finally {
                await client.close();
            }
        }
    }
    finally {
        rmSync(home, { recursive: true, force: true });
    }
});
test('MCP stderr diagnostics report tool latency while keeping arguments and unknown names private', async () => {
    const home = mkdtempSync(join(tmpdir(), 'qc-timing-mcp-'));
    const client = new Client({ name: 'timing-test', version: '1' }, { capabilities: {} });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'],
        env: { ...process.env, HOME: home }, stderr: 'pipe' });
    let diagnostics = '';
    try {
        await client.connect(transport);
        transport.stderr?.on('data', chunk => { diagnostics += chunk.toString(); });
        await client.callTool({ name: 'CANARY_unknown_private_tool', arguments: { platform: 'CANARY_private_platform', phone: 'CANARY_private_argument' } });
        await client.callTool({ name: 'get_payment_status', arguments: { platform: 'blinkit', wait_ms: -1 } });
        for (let i = 0; i < 20 && !diagnostics.includes('get_payment_status'); i++)
            await new Promise(resolve => setTimeout(resolve, 20));
        const records = diagnostics.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
        assert.equal(records.find(r => r.tool === 'unknown_tool')?.outcome, 'error');
        const timing = records.find(r => r.tool === 'get_payment_status');
        assert.deepEqual(timing.platforms, ['blinkit']);
        assert.ok(timing.queue_ms >= 0 && timing.duration_ms >= 0);
        assert.ok(!diagnostics.includes('CANARY'));
    }
    finally {
        await client.close();
        rmSync(home, { recursive: true, force: true });
    }
});
//# sourceMappingURL=payment-mcp.test.js.map
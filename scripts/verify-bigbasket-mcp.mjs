import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createInterface } from 'node:readline';

// Exercise the actual stdio MCP protocol against the workspace build.
// Input lines are {name, arguments}; no credentials are logged by this client.
const client = new Client({ name: 'bigbasket-live-verification', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({ command: process.execPath,
  args: ['dist/index.js'], env: { ...process.env }, stderr: 'ignore' });
await client.connect(transport);
const listed = await client.listTools();
console.log(JSON.stringify({ bigbasketRegistered: listed.tools.filter(t =>
  JSON.stringify(t.inputSchema).includes('bigbasket')).map(t => t.name) }));
const lines = createInterface({ input: process.stdin });
// Prevent terminal echo from leaking OTPs supplied over the verification pipe.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
for await (const line of lines) {
  if (line === 'quit') break;
  try {
    const request = JSON.parse(line);
    console.log(JSON.stringify(await client.callTool(request, undefined, { timeout: 120000 })));
  } catch (error) { console.log(JSON.stringify({ error: error.message })); }
}
await client.close();
process.exit(0);

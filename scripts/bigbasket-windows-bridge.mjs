import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { browserProfilePath } from '../dist/session-helper.js';
import { bigBasketBrowserMode } from '../dist/browser-runtime.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = require('playwright-core/lib/utilsBundle');

// Only loopback is exposed. No CDP frames, cookies or credentials are logged.
const windows = path => execFileSync('wslpath', ['-w', path], { encoding: 'utf8' }).trim();
const windowsHome = execFileSync('cmd.exe', ['/d', '/c', 'echo', '%USERPROFILE%'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const home = execFileSync('wslpath', ['-u', windowsHome], { encoding: 'utf8' }).trim();
const runtime = join(home, '.quick-commerce-mcp/browser-runtime');
const revisions = readdirSync(runtime).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
if (!revisions.length) throw new Error('Install the Windows Playwright Chromium runtime first; see README.');
const nodeCandidate = process.env.QC_WINDOWS_NODE_PATH ?? execFileSync('cmd.exe', ['/d', '/c', 'where', 'node.exe'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
if (!nodeCandidate) throw new Error('Install Node.js on Windows or set QC_WINDOWS_NODE_PATH to node.exe.');
const windowsNode = /^[a-z]:/i.test(nodeCandidate) ? execFileSync('wslpath', ['-u', nodeCandidate], { encoding: 'utf8' }).trim() : nodeCandidate;
const executable = process.env.QC_WINDOWS_BROWSER_PATH ?? join(runtime, revisions[0], 'chrome-win64/chrome.exe');
const profile = join(home, '.quick-commerce-mcp/profiles/bigbasket');
const worker = spawn(windowsNode, [windows(fileURLToPath(new URL('./bigbasket-windows-worker.mjs', import.meta.url))),
  windows(executable), windows(profile), bigBasketBrowserMode()], { stdio: ['pipe', 'pipe', 'ignore'] });
const connections = new Map(); let next = 1; let ready;
const started = new Promise(resolve => { ready = resolve; });
const send = message => worker.stdin.write(JSON.stringify(message) + '\n');
createInterface({ input: worker.stdout }).on('line', line => {
  const message = JSON.parse(line);
  if (message.kind === 'ready') {
    if (bigBasketBrowserMode() === 'background' && !message.isolated) throw new Error('Browser did not verify desktop isolation.');
    ready();
  }
  // Diagnostic markers contain no frames or credentials.
  else if (message.kind === 'frame') { const socket = connections.get(message.id); if (socket?.readyState === bundle.ws.OPEN) socket.send(message.data); }
  else if (message.kind === 'close') connections.get(message.id)?.close();
});
worker.once('error', () => { console.error('Windows browser worker failed to start.'); process.exit(1); });
worker.once('exit', code => { clearRegistry(); console.error('Windows browser worker stopped.'); process.exit(code ?? 1); });
await started;
const server = createServer((request, response) => {
  if (request.url !== '/json/version' && request.url !== '/json/version/') { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ Browser: 'Chrome', webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/browser` }));
});
new bundle.wsServer({ server, path: '/devtools/browser' }).on('connection', socket => {
  const id = next++; connections.set(id, socket); send({ kind: 'open', id });
  socket.on('message', data => send({ kind: 'frame', id, data: data.toString() }));
  socket.on('close', () => { connections.delete(id); send({ kind: 'close', id }); });
});
const registry = join(browserProfilePath('bigbasket'), 'interactive-endpoint.json');
let endpoint;
server.listen(0, '127.0.0.1', () => {
  endpoint = `http://127.0.0.1:${server.address().port}`;
  mkdirSync(browserProfilePath('bigbasket'), { recursive: true, mode: 0o700 });
  writeFileSync(registry, JSON.stringify({ endpoint, mode: bigBasketBrowserMode() }), { mode: 0o600 });
  chmodSync(registry, 0o600);
  console.log(`Windows BigBasket ${bigBasketBrowserMode()} browser bridge ready; MCP can attach automatically.`);
});
let stopping = false;
function clearRegistry() {
  try { if (endpoint && JSON.parse(readFileSync(registry, 'utf8')).endpoint === endpoint) rmSync(registry); } catch {}
}
function shutdown() {
  if (stopping) return; stopping = true;
  clearRegistry();
  send({ kind: 'shutdown' }); server.close();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

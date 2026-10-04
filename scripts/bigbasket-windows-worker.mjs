// Browser-runtime worker only. Project/MCP execution and preference files stay
// in WSL. CDP frames travel over private stdio and are never logged.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const [executable, profile] = process.argv.slice(2);
mkdirSync(profile, { recursive: true });
try { rmSync(join(profile, 'DevToolsActivePort')); } catch {}
const chrome = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', 'https://www.bigbasket.com'], { stdio: 'ignore' });
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let version;
for (let attempt = 0; attempt < 150 && !version; attempt++) {
  if (chrome.exitCode !== null) throw new Error('Browser exited before becoming ready.');
  try {
    const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    if (Number.isInteger(port) && port > 0 && port <= 65535) version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  } catch {}
  if (!version) await new Promise(resolve => setTimeout(resolve, 100));
}
if (!version) throw new Error('Browser did not become ready.');
send({ kind: 'ready', browser: version.Browser });
const sockets = new Map();
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.kind === 'open') {
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    const entry = { socket, queue: [] }; sockets.set(message.id, entry);
    socket.addEventListener('open', () => { for (const frame of entry.queue) socket.send(frame); entry.queue = []; });
    socket.addEventListener('message', event => send({ kind: 'frame', id: message.id, data: event.data }));
    socket.addEventListener('close', () => { sockets.delete(message.id); send({ kind: 'close', id: message.id }); });
    socket.addEventListener('error', () => send({ kind: 'close', id: message.id }));
  } else if (message.kind === 'frame') {
    const entry = sockets.get(message.id);
    if (entry?.socket.readyState === WebSocket.OPEN) entry.socket.send(message.data);
    else entry?.queue.push(message.data);
  } else if (message.kind === 'close') sockets.get(message.id)?.socket.close();
  else if (message.kind === 'shutdown') {
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })));
    setTimeout(() => process.exit(0), 3000); break;
  }
}

// Starts `expo start` under the inspector, requests every API route, then 10 times: edits lib/message.ts and requests
// every route again. After each round it forces a GC and prints the heap and the graphs in Metro's IncrementalBundler.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 8199;
const INSPECTOR = 9339;
const ROUNDS = 10;
const ROUTES = ['one', 'two', 'three', 'four'];
const shared = new URL('./lib/message.ts', import.meta.url);
const original = readFileSync(shared, 'utf8');

const server = spawn(
  process.execPath,
  [`--inspect=127.0.0.1:${INSPECTOR}`, 'node_modules/expo/bin/cli', 'start', '--port', String(PORT)],
  // With CI set, Metro does not watch files, so an edit never reaches it.
  { cwd: new URL('.', import.meta.url), env: { ...process.env, CI: 'false' }, stdio: ['ignore', 'ignore', 'inherit'] },
);

try {
  await waitForServer();
  const inspector = await connect();
  console.log('round  heapUsed  graphs');
  await requestRoutes();
  await report(inspector, 0);
  for (let round = 1; round <= ROUNDS; round++) {
    writeFileSync(shared, `${original}// edit ${round}\n`);
    await sleep(1500);
    await requestRoutes();
    await report(inspector, round);
  }
  inspector.close();
} finally {
  writeFileSync(shared, original);
  server.kill();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/one`);
      if (response.ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`no answer from http://127.0.0.1:${PORT}/api/one`);
}

async function requestRoutes() {
  for (const route of ROUTES) {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/${route}`);
    if (!response.ok) throw new Error(`/api/${route}: ${response.status} ${await response.text()}`);
  }
}

async function connect() {
  const [target] = await (await fetch(`http://127.0.0.1:${INSPECTOR}/json/list`)).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message.result);
    pending.delete(message.id);
  };
  await new Promise((resolve) => (socket.onopen = resolve));
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send('Runtime.enable');
  return { send, close: () => socket.close() };
}

async function report({ send }, round) {
  await send('HeapProfiler.collectGarbage');
  await send('HeapProfiler.collectGarbage');
  const heap = await send('Runtime.evaluate', { expression: 'process.memoryUsage().heapUsed', returnByValue: true });
  // IncrementalBundler is not reachable from a global, so find its instance through its prototype.
  const prototype = await send('Runtime.evaluate', {
    expression: `(() => {
      const cache = process.getBuiltinModule('module')._cache;
      const file = Object.keys(cache).find((key) => key.endsWith('metro/src/IncrementalBundler.js'));
      return (cache[file].exports.default ?? cache[file].exports).prototype;
    })()`,
  });
  const instances = await send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId });
  const graphs = await send('Runtime.callFunctionOn', {
    objectId: instances.objects.objectId,
    functionDeclaration: 'function () { return this[0]._deltaBundler._deltaCalculators.size; }',
    returnByValue: true,
  });
  const megabytes = Math.round(heap.result.value / 1024 / 1024);
  console.log(`${String(round).padStart(5)}  ${String(megabytes).padStart(5)} MB  ${String(graphs.result.value).padStart(6)}`);
}

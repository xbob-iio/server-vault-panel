import net from 'node:net';
import { audit } from './audit.js';
import { config } from './config.js';
import { getSetting, q } from './db.js';
import { esc, notify } from './telegram.js';

const HISTORY = 30;
const FAILS_FOR_DOWN = 3;
const CONCURRENCY = 8;

/** id → { online, ms, checkedAt, history: (ms|null)[], fails, alerted } */
const state = new Map();

export function tcpPing(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const socket = net.connect({ host, port });
    const done = (online) => {
      socket.destroy();
      const ms = online ? Number((process.hrtime.bigint() - started) / 1_000_000n) : null;
      resolve({ online, ms });
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function alert(server, down) {
  if (getSetting('down_alerts', '1') !== '1') return;
  const text = down
    ? `🔴 <b>${esc(server.name)}</b> недоступен\n<code>${esc(server.host)}:${server.port}</code> не отвечает`
    : `🟢 <b>${esc(server.name)}</b> снова доступен`;
  try {
    await notify(text);
  } catch (e) {
    console.warn('[monitor] telegram:', e.message);
  }
}

export async function checkServer(server) {
  const result = await tcpPing(server.host, server.port);
  const prev = state.get(server.id) || { history: [], fails: 0, alerted: false };
  const history = [...prev.history, result.ms].slice(-HISTORY);
  const fails = result.online ? 0 : prev.fails + 1;
  let alerted = prev.alerted;
  if (!result.online && fails === FAILS_FOR_DOWN && !alerted) {
    alerted = true;
    audit('server_down', null, server.name);
    alert(server, true);
  } else if (result.online && alerted) {
    alerted = false;
    audit('server_up', null, server.name);
    alert(server, false);
  }
  const entry = { online: result.online, ms: result.ms, checkedAt: Date.now(), history, fails, alerted };
  state.set(server.id, entry);
  return entry;
}

let running = false;
export async function runChecks() {
  if (running) return;
  running = true;
  try {
    const servers = q('SELECT id, name, host, port FROM servers WHERE monitor = 1').all();
    const queue = [...servers];
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) await checkServer(queue.shift());
    }));
    const ids = new Set(servers.map((s) => s.id));
    for (const id of state.keys()) if (!ids.has(id)) state.delete(id);
  } finally {
    running = false;
  }
}

export function statusSnapshot() {
  const out = {};
  for (const [id, s] of state) out[id] = { online: s.online, ms: s.ms, checkedAt: s.checkedAt, history: s.history };
  return out;
}

export const forgetServer = (id) => state.delete(id);

export function startMonitor() {
  setTimeout(() => runChecks().catch((e) => console.warn('[monitor]', e.message)), 2000).unref();
  setInterval(() => runChecks().catch((e) => console.warn('[monitor]', e.message)), config.monitorIntervalMs).unref();
}

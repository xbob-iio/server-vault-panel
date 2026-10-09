import { api, daysUntil } from './lib.js';

export const store = { me: null, servers: [], status: {} };

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit(kind) {
  for (const fn of [...listeners]) fn(kind);
}

const byDate = (a, b) => a.payDate.localeCompare(b.payDate) || a.name.localeCompare(b.name, 'ru');

export async function loadServers() {
  store.servers = (await api('/api/servers')).sort(byDate);
  emit('servers');
}

export async function loadStatus() {
  store.status = await api('/api/status', { background: true });
  emit('status');
}

export function upsertServer(server) {
  const i = store.servers.findIndex((s) => s.id === server.id);
  if (i >= 0) store.servers[i] = server;
  else store.servers.push(server);
  store.servers.sort(byDate);
  emit('servers');
}

export function removeServer(id) {
  store.servers = store.servers.filter((s) => s.id !== id);
  delete store.status[id];
  emit('servers');
}

export function setStatus(id, status) {
  store.status[id] = status;
  emit('status');
}

/** Серверы, по которым пора платить (просроченные и в ближайшие maxDays дней). */
export function dueServers(maxDays = 7) {
  return store.servers.filter((s) => s.remind && daysUntil(s.payDate) <= maxDays).sort(byDate);
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;

function int(value, def, min, max) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

function trustProxy(value) {
  if (!value || value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value; // 'loopback', список IP/подсетей и т.п.
}

export const config = Object.freeze({
  host: env.HOST || '127.0.0.1',
  port: int(env.PORT, 3000, 1, 65535),
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  trustProxy: trustProxy(env.TRUST_PROXY),
  secureCookies: env.SECURE_COOKIES === 'true',
  sessionIdleMs: int(env.SESSION_IDLE_MINUTES, 30, 5, 1440) * 60_000,
  sessionMaxMs: int(env.SESSION_MAX_HOURS, 12, 1, 168) * 3_600_000,
  monitorIntervalMs: int(env.MONITOR_INTERVAL_SECONDS, 60, 15, 3600) * 1000,
});

fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

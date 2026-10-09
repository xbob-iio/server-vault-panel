import { getAppKey, open, seal } from './crypto.js';
import { getSetting, setSetting } from './db.js';

export const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;

export async function tgCall(token, method, body = {}) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    // Не пробрасываем исходную ошибку — в ней может оказаться URL с токеном.
    throw new Error(`Telegram недоступен (${e.cause?.code || e.name})`);
  }
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(`Telegram: ${data?.description || `HTTP ${res.status}`}`);
  return data.result;
}

export function getBotToken() {
  const stored = getSetting('tg_token');
  if (!stored) return null;
  try {
    return open(getAppKey(), Buffer.from(stored, 'base64'), 'tg_token').toString('utf8');
  } catch {
    return null;
  }
}

export function setBotToken(token) {
  setSetting('tg_token', token ? seal(getAppKey(), token, 'tg_token').toString('base64') : null);
}

export const telegramReady = () => Boolean(getBotToken() && getSetting('tg_chat_id'));

export async function notify(html) {
  const token = getBotToken();
  const chatId = getSetting('tg_chat_id');
  if (!token || !chatId) return false;
  await tgCall(token, 'sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  return true;
}

export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

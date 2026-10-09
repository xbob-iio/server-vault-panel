import { q } from './db.js';

const KEEP = 5000;

export function audit(event, req, detail = null) {
  q('INSERT INTO audit (ts, event, ip, ua, detail) VALUES (?, ?, ?, ?, ?)').run(
    Date.now(),
    event,
    req?.ip ?? null,
    req ? String(req.get('user-agent') || '').slice(0, 200) : null,
    detail == null ? null : String(detail).slice(0, 300),
  );
}

export function pruneAudit() {
  q('DELETE FROM audit WHERE id <= (SELECT id FROM audit ORDER BY id DESC LIMIT 1 OFFSET ?)').run(KEEP);
}

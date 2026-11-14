// Metadata-only snapshots. No Gateway credentials, transcripts, titles or real workspace paths.
import { readFileSync, statSync } from 'node:fs';
import type { AgentStatus, SourceInfo } from '../../shared/types';
import type { Office } from '../model/office';
import type { AgentSource } from './source';

const MAX_BYTES = 256 * 1024;
export const OPENCLAW_MAX_AGE = 60_000;
type Session = { id: string; activity: 'active' | 'idle' | 'unknown'; observedAt: number; alias?: string; temporary?: boolean };
type Snapshot = { version: 1; observedAt: number; sessions: Session[] };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const time = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Strict allowlist: never accidentally publish a sessions_list response containing private fields. */
export function parseOpenClawSnapshot(raw: string, now: number): Snapshot {
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('oversized');
  const v: unknown = JSON.parse(raw);
  if (!record(v) || Object.keys(v).some((k) => !['version', 'observedAt', 'sessions'].includes(k)) ||
      v.version !== 1 || !time(v.observedAt) || v.observedAt > now || !Array.isArray(v.sessions) || v.sessions.length > 1000) {
    throw new Error('invalid snapshot');
  }
  const observedAt = v.observedAt;
  const seen = new Set<string>();
  const sessions: Session[] = v.sessions.map((s: unknown) => {
    if (!record(s) || Object.keys(s).some((k) => !['id', 'activity', 'observedAt', 'alias', 'temporary'].includes(k)) ||
        (s.alias !== undefined && (typeof s.alias !== 'string' || !/^(Bơ|Mạch|Bit|Nét|Đất|Số|Kẹp|Nhớ|An|Bi|Thử|Nhịp|Lộc|Khách [a-f0-9]{8})$/.test(s.alias))) ||
        (s.temporary !== undefined && typeof s.temporary !== 'boolean') ||
        typeof s.id !== 'string' || !/^[a-f0-9]{64}$/.test(s.id) || seen.has(s.id) ||
        !['active', 'idle', 'unknown'].includes(String(s.activity)) || !time(s.observedAt) || s.observedAt > observedAt) {
      throw new Error('invalid session');
    }
    seen.add(s.id);
    return { id: s.id, activity: s.activity as Session['activity'], observedAt: s.observedAt, ...(s.alias ? { alias: s.alias as string } : {}), ...(s.temporary !== undefined ? { temporary: s.temporary as boolean } : {}) };
  });
  return { version: 1, observedAt, sessions };
}

export class OpenClawSource implements AgentSource {
  readonly provider = 'openclaw';
  private timer?: ReturnType<typeof setInterval>;
  private ids = new Set<string>();
  private info: SourceInfo = { provider: 'openclaw', label: 'OpenClaw · metadata snapshot', path: '', sessions: 0, ok: false, error: 'Snapshot unavailable' };

  constructor(private readonly office: Office, private readonly file: string, private readonly now = Date.now) {}

  start(): void {
    this.office.beginBoot();
    try { this.poll(); } finally { this.office.endBoot(); }
    this.timer = setInterval(() => this.poll(), 2000);
    this.timer.unref();
  }
  stop(): void { clearInterval(this.timer); }
  sources(): SourceInfo[] { return [{ ...this.info }]; }
  transcriptPathOf(_id: string): undefined { return undefined; }

  poll(): void {
    const now = this.now();
    let snapshot: Snapshot | undefined;
    let error: string | undefined;
    try {
      if (statSync(this.file).size > MAX_BYTES) throw new Error('oversized');
      snapshot = parseOpenClawSnapshot(readFileSync(this.file, 'utf8'), now);
      if (now - snapshot.observedAt > OPENCLAW_MAX_AGE) error = 'Snapshot stale (>60s); activity unknown';
    } catch {
      // Never publish the file path, JSON contents or exception text.
      error = 'Snapshot unavailable or invalid; activity unknown';
    }
    const next = new Set<string>();
    if (snapshot && !error) {
      for (const s of snapshot.sessions) {
        if (now - s.observedAt > OPENCLAW_MAX_AGE || s.activity === 'unknown') continue;
        const id = `openclaw:${s.id}`;
        next.add(id);
        // ponytail: flat roster only; parent hierarchy requires separately sanitized lineage metadata.
        const status: AgentStatus = s.activity === 'active' ? 'working' : 'idle';
        this.office.addMain({ id, provider: 'openclaw', account: 'openclaw', sessionId: s.id,
          cwd: 'OpenClaw', ...(s.alias ? { characterName: s.alias } : {}), role: 'OpenClaw · metadata snapshot', startedAt: s.observedAt, status });
        this.office.addActivity(id, { id: `${id}:snapshot:${s.observedAt}`, kind: 'other', icon: '',
          text: `Snapshot ${s.activity} · ${new Date(s.observedAt).toISOString()}`,
          at: s.observedAt }, true, { feed: false });
      }
    }
    for (const id of this.ids) if (!next.has(id)) this.office.closeMain(id);
    this.ids = next;
    const info: SourceInfo = { provider: 'openclaw', label: 'OpenClaw · metadata snapshot', path: '',
      sessions: next.size, ok: !error, error, observedAt: snapshot?.observedAt };
    if (JSON.stringify(info) !== JSON.stringify(this.info)) { this.info = info; this.office.markDirty(); }
  }
}

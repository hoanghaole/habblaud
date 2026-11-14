import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { OpenClawSource, OPENCLAW_MAX_AGE, parseOpenClawSnapshot } from './openclaw';

describe('OpenClaw metadata snapshots', () => {
  it('allowlists metadata, expires stale activity, rejects invalid input without exposing paths', () => {
    const dir = mkdtempSync(join(process.cwd(), '.openclaw-test-'));
    try {
      let now = 100_000;
      const file = join(dir, 'snapshot.json');
      const office = new Office({ names: new NameStore(join(dir, 'names.json')), version: 'test', startedAt: now,
        accounts: () => [], sources: () => [], accountName: () => undefined, now: () => now });
      const source = new OpenClawSource(office, file, () => now);
      const snapshot = { version: 1, observedAt: now, sessions: [{ id: 'a'.repeat(64), activity: 'active', observedAt: now, alias: 'Bơ', temporary: false }] };
      writeFileSync(file, JSON.stringify(snapshot));
      source.poll();
      expect(office.list()).toMatchObject([{ provider: 'openclaw', status: 'working', roomId: 'OpenClaw', name: 'Bơ' }]);
      expect(source.sources()[0]).toMatchObject({ ok: true, sessions: 1, path: '', observedAt: now });
      expect(source.transcriptPathOf(office.list()[0].id)).toBeUndefined();
      expect(() => parseOpenClawSnapshot(JSON.stringify({ ...snapshot, messages: ['secret'] }), now)).toThrow();
      expect(() => parseOpenClawSnapshot(JSON.stringify({ ...snapshot, observedAt: now + 1 }), now)).toThrow();
      expect(() => parseOpenClawSnapshot(JSON.stringify({ ...snapshot, sessions: [{ ...snapshot.sessions[0], id: '/private/path' }] }), now)).toThrow();
      expect(() => parseOpenClawSnapshot(JSON.stringify({ ...snapshot, sessions: [snapshot.sessions[0], snapshot.sessions[0]] }), now)).toThrow();
      now += OPENCLAW_MAX_AGE + 1;
      source.poll();
      expect(office.list()[0].status).toBe('offline');
      expect(source.sources()[0]).toMatchObject({ ok: false, sessions: 0 });
      snapshot.observedAt = now;
      snapshot.sessions[0] = { ...snapshot.sessions[0], observedAt: now, activity: 'idle' };
      writeFileSync(file, JSON.stringify(snapshot));
      source.poll();
      expect(office.list()[0].status).toBe('idle');
      expect(office.list()[0].name).toBe('Bơ');
      expect(office.list()[0].id).toBe(`openclaw:${'a'.repeat(64)}`);
      writeFileSync(file, '{invalid secret');
      source.poll();
      expect(office.list()[0].status).toBe('offline');
      expect(JSON.stringify(source.sources())).not.toContain(dir);
      expect(JSON.stringify(source.sources())).not.toContain('secret');
      snapshot.sessions[0].activity = 'unknown';
      writeFileSync(file, JSON.stringify(snapshot));
      source.poll();
      expect(source.sources()[0].sessions).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

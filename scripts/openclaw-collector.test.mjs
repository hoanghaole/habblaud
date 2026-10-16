import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { Collector, collectInventory, connectParams, identity, validateAliases, retainIdle, sanitizeRow, validateUrl } from './openclaw-collector.mjs';

const row = { agentId: 'main', key: 'secret-key', sessionId: 'secret-id', snapshotAt: 100,
  title: 'SECRET', lastMessage: 'SECRET', hasActiveRun: true };
const clean = sanitizeRow(row, 200);
assert.deepEqual(Object.keys(clean), ['id', 'alias', 'temporary', 'activity', 'observedAt']);
assert.match(clean.id, /^[a-f0-9]{64}$/);
assert.equal(clean.observedAt, 100);
assert.equal(sanitizeRow({ ...row, sessionId: 'reset' }, 200).id, clean.id);
assert.equal(sanitizeRow(row, 200, validateAliases({ 'secret-key': 'Bơ' })).alias, 'Bơ');
assert.throws(() => validateAliases({ key: 'SECRET' }));
assert.throws(() => validateAliases({ one: 'Bơ', two: 'Bơ' }));
assert.match(clean.alias, /^Khách [a-f0-9]{8}$/);
assert.match(sanitizeRow({ ...row, key: 'constructor' }, 200).alias, /^Khách [a-f0-9]{8}$/);
assert.equal(sanitizeRow({ ...row, key: 'agent:main:subagent:child' }, 200).temporary, true);
assert.equal(sanitizeRow({ ...row, sessionId: 'reset' }, 200).alias, clean.alias);
const temporaryRoster = new Map();
retainIdle(temporaryRoster, { version: 1, observedAt: 200, sessions: [{ ...clean, temporary: true }] });
assert.equal(retainIdle(temporaryRoster, { version: 1, observedAt: 300, sessions: [] }).sessions.length, 0);
assert.equal(JSON.stringify(clean).includes('SECRET'), false);
assert.throws(() => sanitizeRow({ ...row, snapshotAt: 201 }, 200));
assert.throws(() => sanitizeRow({ ...row, agentId: undefined }, 200));
assert.throws(() => validateUrl('ws://example.com'));
assert.throws(() => validateUrl('wss://user:password@example.com'));
const initial = { sessions: [row], hasMore: true, nextOffset: 200, count: 9999 };
const pages = [];
const snapshot = await collectInventory(async (method, params) => {
  pages.push([method, params]);
  return { sessions: [row, { ...row, key: 'next-key', sessionId: 'next', snapshotAt: 150 }], hasMore: false };
}, initial, () => 200, { 'secret-key': 'Bơ', 'next-key': 'Nét' });
assert.equal(snapshot.sessions.length, 2);
assert.equal(pages[0][1].activeOnly, false);
assert.equal(sanitizeRow({ ...row, hasActiveRun: false }, 200).activity, 'idle');
const rosterCheck = await collectInventory(async () => ({ sessions: [row,
  { ...row, key: 'topic', hasActiveRun: false },
  { ...row, key: 'unapproved' },
  { ...row, key: 'agent:main:subagent:ended', hasActiveRun: false },
  { ...row, key: 'agent:main:subagent:running' }], hasMore: false }), undefined, () => 200,
  { 'secret-key': 'Bơ', topic: 'Nét' });
assert.deepEqual(rosterCheck.sessions.map(s => s.activity), ['active', 'idle', 'active']);
assert.equal(new Set(rosterCheck.sessions.map(s => s.id)).size, 3);
assert.equal(pages[0][1].offset, 200);
assert.equal(pages[0][1].includeLastMessage, false);
await assert.rejects(collectInventory(async () => { throw Error('SECRET'); }, initial, () => 200));
await assert.rejects(collectInventory(async () => initial, initial, () => 200));
assert.deepEqual((await collectInventory(async () => ({ sessions: [], hasMore: false }), undefined, () => 200)).sessions, []);

// Only successful complete inventories advance retained idle observations.
const roster = new Map();
assert.equal(retainIdle(roster, { version: 1, observedAt: 200, sessions: [clean] }).sessions[0].activity, 'active');
const idle = retainIdle(roster, { version: 1, observedAt: 300, sessions: [] });
assert.deepEqual(idle.sessions, [{ ...clean, activity: 'idle', observedAt: 300 }]);
assert.equal(retainIdle(roster, { version: 1, observedAt: 400, sessions: [{ ...clean, observedAt: 400 }] }).sessions[0].activity, 'active');
assert.equal(roster.size, 1);

const { privateKey } = generateKeyPairSync('ed25519');
const credentials = { url: 'ws://127.0.0.1:18789/', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), deviceToken: 'dedicated-token' };
const params = connectParams(credentials, { nonce: 'nonce', ts: 200 });
assert.equal(params.client.id, 'cli');
assert.equal(params.client.mode, 'cli');
assert.deepEqual(params.scopes, ['operator.read']);
const payload = ['v3', identity(credentials.privateKeyPem).id, 'cli', 'cli', 'operator', 'operator.read', '200', 'dedicated-token', 'nonce', process.platform, ''].join('|');
assert(verify(null, Buffer.from(payload), createPublicKey(privateKey), Buffer.from(params.device.signature, 'base64url')));
assert.throws(() => connectParams(credentials, { nonce: 'nonce' }));

// Fake wire only: never opens a network connection, never writes credentials.
class FakeSocket extends EventTarget {
  static sockets = [];
  constructor() {
    super(); this.requests = []; this.closed = false; FakeSocket.sockets.push(this);
    queueMicrotask(() => this.event('connect.challenge', { nonce: 'nonce', ts: 200 }));
  }
  frame(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  event(event, payload) { this.frame({ type: 'event', event, payload }); }
  send(raw) {
    const request = JSON.parse(raw); this.requests.push(request);
    let payload;
    if (request.method === 'connect') payload = { type: 'hello-ok', protocol: 4,
      auth: { role: 'operator', scopes: ['operator.read'] },
      features: { methods: ['sessions.list', 'sessions.subscribe'], events: ['sessions.changed'] }, policy: { tickIntervalMs: 15000 } };
    else if (request.method === 'sessions.subscribe') {
      this.event('sessions.changed', { session: { title: 'SECRET' } });
      payload = { subscribed: true, list: { sessions: [row], hasMore: false } };
    } else if (request.method === 'sessions.list') payload = { sessions: [row], hasMore: false };
    else assert.fail('Unexpected method');
    queueMicrotask(() => { if (!this.closed) this.frame({ type: 'res', id: request.id, ok: true, payload }); });
  }
  close() { if (!this.closed) { this.closed = true; this.dispatchEvent(new Event('close')); } }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await pause(2); } assert.fail('Timed out'); }
let now = 200;
const published = [], logs = [];
const collector = new Collector({ credentials, aliases: { 'secret-key': 'Bơ' }, Socket: FakeSocket, now: () => now,
  publish: (s) => published.push(s), status: (s) => logs.push(s),
  debounceMs: 1, reconnectMs: 30, refreshMs: 10000 });
collector.start();
await until(() => published.length >= 2);
assert(FakeSocket.sockets[0].requests.some((r) => r.method === 'sessions.list'));
const count = published.length;
FakeSocket.sockets[0].close();
now += 60_001;
await pause(5);
assert.equal(published.length, count); // Disconnect cannot refresh observation timestamps.
assert(now - published.at(-1).observedAt > 60_000);
await until(() => FakeSocket.sockets.length === 2 && published.length > count);
assert.equal(FakeSocket.sockets[1].requests[0].method, 'connect');
assert.equal(FakeSocket.sockets[1].requests[1].method, 'sessions.subscribe');
assert.equal(published.at(-1).sessions[0].observedAt, 100); // Cached Gateway sample stays expired.
collector.stop();
assert.equal(JSON.stringify(logs).includes('SECRET'), false);
console.log('Collector checks passed: sanitizer, pagination, signature, bootstrap race, disconnect expiry, reconnect');

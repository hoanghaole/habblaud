// Trusted host only. No raw Gateway payloads are persisted or logged.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCOPES = ['operator.read'];
export const LIST_PARAMS = Object.freeze({ activeOnly: false, archived: false, limit: 200,
  includeGlobal: true, includeUnknown: true, includeDerivedTitles: false,
  includeLastMessage: false, includeActivitySummary: false });
const validTime = (v) => Number.isSafeInteger(v) && v > 0;
const digest = (v) => createHash('sha256').update(v).digest('hex');
const fail = () => { throw new Error('Invalid collector input'); };

export function validateUrl(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash ||
      !['ws:', 'wss:'].includes(url.protocol) ||
      (url.protocol === 'ws:' && !['127.0.0.1', '[::1]'].includes(url.hostname))) fail();
  return url.href;
}

export function identity(privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') fail();
  const der = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  if (der.length !== 44 || !der.subarray(0, 12).equals(prefix)) fail();
  const raw = der.subarray(12);
  return { key, id: digest(raw), publicKey: raw.toString('base64url') };
}

export function connectParams(credentials, challenge) {
  if (!challenge || typeof challenge.nonce !== 'string' || !challenge.nonce.trim() ||
      challenge.nonce.length > 4096 || !Number.isSafeInteger(challenge.ts) || challenge.ts < 0) fail();
  const device = identity(credentials.privateKeyPem);
  // Dedicated paired token wins; no implicit reads of OpenClaw auth/config stores.
  const token = credentials.deviceToken || credentials.token;
  const password = credentials.deviceToken ? undefined : credentials.password;
  const platform = process.platform;
  const payload = ['v3', device.id, 'cli', 'cli', 'operator', SCOPES.join(','),
    String(challenge.ts), token || '', challenge.nonce, platform, ''].join('|');
  return { minProtocol: 4, maxProtocol: 4,
    client: { id: 'cli', mode: 'cli', version: 'habblaud-collector-1', platform },
    role: 'operator', scopes: [...SCOPES], caps: [],
    auth: { ...(token ? { token } : {}), ...(password ? { password } : {}) },
    device: { id: device.id, publicKey: device.publicKey,
      signature: sign(null, Buffer.from(payload), device.key).toString('base64url'),
      signedAt: challenge.ts, nonce: challenge.nonce } };
}

const APPROVED_ALIASES = ['Bơ', 'Mạch', 'Bit', 'Nét', 'Đất', 'Số', 'Kẹp', 'Nhớ', 'An', 'Bi', 'Thử', 'Nhịp', 'Lộc'];
export function validateAliases(v) {
  if (!v || Array.isArray(v) || typeof v !== 'object' || Object.keys(v).length > 1000 ||
      Object.entries(v).some(([key, alias]) => !key || key.length > 8192 || !APPROVED_ALIASES.includes(alias)) ||
      new Set(Object.values(v)).size !== Object.keys(v).length) fail();
  return v;
}

export function sanitizeRow(row, completedAt, aliases = {}) {
  if (!row || !['agentId', 'key', 'sessionId'].every((k) =>
    typeof row[k] === 'string' && row[k].length > 0 && row[k].length <= 8192)) fail();
  const sampledAt = row.snapshotAt === undefined ? completedAt : row.snapshotAt;
  if (!validTime(sampledAt) || sampledAt > completedAt) fail();
  return { id: digest(JSON.stringify([row.agentId, row.key])),
    alias: (Object.hasOwn(aliases, row.key) ? aliases[row.key] : undefined) || `Khách ${digest(JSON.stringify([row.agentId, row.key])).slice(0, 8)}`,
    temporary: row.key.includes(':subagent:') || row.key.includes(':cron:'),
    activity: row.hasActiveRun === true ? 'active' : 'idle', observedAt: sampledAt };
}

export async function collectInventory(rpc, initial, now = Date.now, aliases = {}) {
  const rows = new Map();
  let offset = 0;
  let page = initial;
  for (let pages = 0; pages < 100; pages++) {
    if (page === undefined) page = await rpc('sessions.list', { ...LIST_PARAMS, offset });
    const completedAt = now();
    if (!page || !Array.isArray(page.sessions) || typeof page.hasMore !== 'boolean') fail();
    for (const row of page.sessions) {
      const clean = sanitizeRow(row, completedAt, aliases);
      // Export approved permanent conversations; temporary workers only while active.
      if (clean.temporary ? clean.activity !== 'active' : !Object.hasOwn(aliases, row.key)) continue;
      if (!rows.has(clean.id) || rows.get(clean.id).observedAt <= clean.observedAt) rows.set(clean.id, clean);
      if (rows.size > 1000) fail();
    }
    if (!page.hasMore) {
      const snapshot = { version: 1, observedAt: now(), sessions: [...rows.values()] };
      if (!validTime(snapshot.observedAt) || snapshot.sessions.some((r) => r.observedAt > snapshot.observedAt) ||
          Buffer.byteLength(JSON.stringify(snapshot)) > 256 * 1024) fail();
      return snapshot;
    }
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) fail();
    offset = page.nextOffset;
    page = undefined;
  }
  fail();
}

// A complete active-only inventory proves previously seen sessions are no longer busy.
// ponytail: retain this collector's roster only; restart starts a fresh roster (max 1000).
export function retainIdle(roster, snapshot) {
  const next = new Map([...roster].filter(([, row]) => !row.temporary).map(([id, row]) => [id, { ...row, activity: 'idle', observedAt: snapshot.observedAt }]));
  for (const row of snapshot.sessions) next.set(row.id, row);
  if (next.size > 1000) fail();
  roster.clear();
  for (const [id, row] of next) roster.set(id, row);
  return { ...snapshot, sessions: [...next.values()] };
}

export function atomicSnapshot(file, snapshot) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(snapshot), { flag: 'wx', mode: 0o644 });
    renameSync(tmp, file);
  } finally { try { unlinkSync(tmp); } catch {} }
}

// ponytail: canonical refresh only; event enrichment is ignored, never cached/merged.
export class Collector {
  constructor({ credentials, aliases = {}, publish, saveToken = () => {}, status = () => {},
    Socket = WebSocket, now = Date.now, refreshMs = 20_000, debounceMs = 250,
    reconnectMs = 1000, timeoutMs = 15_000 }) {
    this.credentials = credentials;
    this.aliases = aliases;
    this.roster = new Map();
    this.publish = publish;
    this.saveToken = saveToken;
    this.status = status;
    this.Socket = Socket;
    this.now = now;
    this.refreshMs = refreshMs;
    this.debounceMs = debounceMs;
    this.reconnectMs = reconnectMs;
    this.timeoutMs = timeoutMs;
    this.attempt = 0;
    this.stopped = true;
  }
  start() { if (this.stopped) { this.stopped = false; this.open(); } }
  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.connection?.close();
  }
  open() {
    if (this.stopped) return;
    const ws = new this.Socket(validateUrl(this.credentials.url));
    const pending = new Map();
    let ready = false, dead = false, busy = false, dirty = false, challenged = false;
    let refreshTimer, periodic, watchdog;
    const touch = (ms) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => ws.close(), ms);
    };
    const rpc = (method, params) => new Promise((resolveResult, reject) => {
      if (dead) return reject(new Error('Disconnected'));
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error('Request timeout'); error.retryable = true;
        reject(error); ws.close();
      }, this.timeoutMs);
      pending.set(id, { resolve: resolveResult, reject, timer });
      try { ws.send(JSON.stringify({ type: 'req', id, method, params })); }
      catch { clearTimeout(timer); pending.delete(id); reject(new Error('Disconnected')); ws.close(); }
    });
    const refresh = async (initial) => {
      if (!ready || dead) return;
      if (busy) { dirty = true; return; }
      busy = true;
      dirty = false;
      try {
        const clean = await collectInventory(rpc, initial, this.now, this.aliases);
        if (!dead && !this.stopped) this.publish(clean);
      } catch { this.status('Collection unavailable'); }
      finally {
        busy = false;
        if (dirty && !dead) schedule();
      }
    };
    const schedule = () => {
      dirty = true;
      if (!ready || busy || dead || refreshTimer) return;
      refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh(); }, this.debounceMs);
    };
    const close = () => {
      if (dead) return;
      dead = true;
      clearTimeout(watchdog); clearTimeout(refreshTimer); clearInterval(periodic);
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Disconnected')); }
      pending.clear();
      // No republishing cached observations. Existing snapshot expires in <=60s.
      this.status('Disconnected; observations expire');
      if (!this.stopped) {
        const delay = Math.min(30_000, this.reconnectMs * 2 ** Math.min(this.attempt++, 5));
        this.retry = setTimeout(() => this.open(), delay);
      }
    };
    this.connection = ws;
    touch(this.timeoutMs);
    ws.addEventListener('close', close);
    ws.addEventListener('error', () => { ws.close(); close(); });
    ws.addEventListener('message', (event) => {
      if (dead) return;
      let frame;
      try {
        if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > 32 * 1024 * 1024) fail();
        frame = JSON.parse(event.data);
      } catch { ws.close(); return; }
      if (ready) touch(this.livenessMs);
      if (frame.type === 'res') {
        const p = pending.get(frame.id);
        if (!p) return;
        pending.delete(frame.id); clearTimeout(p.timer);
        if (frame.ok === true) p.resolve(frame.payload);
        else {
          // Retain only a closed retry classification. Never surface error text/details.
          const error = new Error('Gateway request rejected');
          error.retryable = frame.error?.code === 'UNAVAILABLE';
          // Only fixed auth classifications; never print server messages or payloads.
          const code = frame.error?.details?.code;
          error.safeCode = ['AUTH_TOKEN_MISMATCH', 'AUTH_TOKEN_MISSING', 'AUTH_SCOPE_MISMATCH', 'PAIRING_REQUIRED', 'DEVICE_AUTH_SIGNATURE_INVALID', 'DEVICE_AUTH_NONCE_REQUIRED'].includes(code) ? code : 'REQUEST_REJECTED';
          p.reject(error);
        }
      } else if (frame.type === 'event') {
        if (frame.event === 'sessions.changed') { schedule(); return; }
        if (frame.event === 'shutdown') { ws.close(); return; }
        if (frame.event !== 'connect.challenge' || challenged || ready) return;
        challenged = true;
        void (async () => {
          try {
            const hello = await rpc('connect', connectParams(this.credentials, frame.payload));
            if (dead || this.stopped) return;
            if (hello?.type !== 'hello-ok' || hello.protocol !== 4 || hello.auth?.role !== 'operator' ||
                !Array.isArray(hello.auth.scopes) || hello.auth.scopes.length !== 1 || hello.auth.scopes[0] !== 'operator.read' ||
                !hello.features?.methods?.includes('sessions.list') ||
                !hello.features.methods.includes('sessions.subscribe') ||
                !hello.features.events?.includes('sessions.changed')) fail();
            if (hello.auth.deviceToken !== undefined) {
              if (typeof hello.auth.deviceToken !== 'string' || !hello.auth.deviceToken) fail();
              this.saveToken(hello.auth.deviceToken);
              this.credentials.deviceToken = hello.auth.deviceToken;
            }
            const tick = hello.policy?.tickIntervalMs;
            if (!Number.isSafeInteger(tick) || tick < 1 || tick > 120_000) fail();
            this.livenessMs = Math.max(this.timeoutMs, tick * 3);
            touch(this.livenessMs);
            // Listener already installed. Subscribe before any roster publication.
            const bootstrap = await rpc('sessions.subscribe', { ...LIST_PARAMS });
            if (dead || this.stopped) return;
            if (bootstrap?.subscribed !== true || !bootstrap.list) fail();
            ready = true;
            this.attempt = 0;
            const changedDuringBootstrap = dirty;
            await refresh(bootstrap.list);
            if (changedDuringBootstrap) schedule();
            if (!dead) periodic = setInterval(schedule, this.refreshMs);
          } catch (error) {
            if (!dead && !this.stopped && error.retryable !== true) {
              this.stopped = true;
              this.status(`Authentication/subscription blocked: ${error.safeCode || 'PROTOCOL_OR_SCOPE_CHECK'}; operator action required`);
            }
            ws.close();
          }
        })();
      }
    });
  }
}

function readPrivate(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o077) || st.uid !== process.getuid() || st.size > 16_384) fail();
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
}
function privateCredentials(v) {
  if (!v || Object.keys(v).some((k) => !['version', 'url', 'privateKeyPem', 'deviceToken'].includes(k)) || v.version !== 1) fail();
  validateUrl(v.url); identity(v.privateKeyPem);
  if (v.deviceToken !== undefined && (typeof v.deviceToken !== 'string' || !v.deviceToken || v.deviceToken.length > 8192)) fail();
  return v;
}

export function main(args) {
  const [mode, privatePath, target] = args;
  if (args.length !== 3 || !['--init', '--run'].includes(mode)) fail();
  const file = resolve(privatePath);
  if (mode === '--init') {
    const url = validateUrl(target);
    const { privateKey } = generateKeyPairSync('ed25519');
    const v = { version: 1, url, privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    // Explicit init only; never overwrite an existing file or OpenClaw identity.
    writeFileSync(file, JSON.stringify(v), { flag: 'wx', mode: 0o600 });
    console.error('Dedicated identity created; no connection made');
    return;
  }
  const output = resolve(target);
  if (dirname(output) === dirname(file)) fail();
  const stored = privateCredentials(readPrivate(file));
  const credentials = { ...stored, token: process.env.HABBLAUD_COLLECTOR_TOKEN,
    password: process.env.HABBLAUD_COLLECTOR_PASSWORD };
  const aliasFile = process.env.HABBLAUD_COLLECTOR_ALIASES;
  const aliases = aliasFile ? validateAliases(readPrivate(resolve(aliasFile))) : {};
  const collector = new Collector({ credentials, aliases, publish: (s) => atomicSnapshot(output, s),
    saveToken: (token) => {
      if (stored.deviceToken === token) return;
      // Verify dedicated file has not been replaced before storing newly issued token.
      const current = privateCredentials(readPrivate(file));
      if (JSON.stringify(current) !== JSON.stringify(stored)) fail();
      const next = { ...stored, deviceToken: token };
      const tmp = `${file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(tmp, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
        renameSync(tmp, file);
        Object.assign(stored, next);
      } finally { try { unlinkSync(tmp); } catch {} }
    }, status: (s) => console.error(s) });
  process.once('SIGINT', () => collector.stop());
  process.once('SIGTERM', () => collector.stop());
  collector.start();
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Collector setup invalid; check private file, URL and output directory'); process.exitCode = 1; }
}

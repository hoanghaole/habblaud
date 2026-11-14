# OpenClaw metadata snapshots (opt-in)

## Local deployment status — 2026-10-15

- Dedicated host collector paired successfully; verified grant is only `operator.read`.
- One-time shared Gateway credential process stopped. Subsequent connection uses only the dedicated device token in owner-only `~/.config/habblaud-collector/device.json` (`0600`), outside container mounts.
- User service `habblaud-collector.service` enabled and active; uses the dedicated token, no bootstrap environment credential. Inspect with `systemctl --user status habblaud-collector.service`; stop with `systemctl --user stop habblaud-collector.service`.
- Public `/api/health` reports a fresh OpenClaw source. Public `/api/stream` assertion verified room `OpenClaw`, one real character with `working` status.
- Collector regression checks pass. Public rendered DOM verified with a sandboxed persistent Chromium profile on the data volume; owner confirmed seeing the character run.
- Idle retention deployed: successful complete active-only inventories retain previously observed characters as `idle` when absent; reappearing rows become `active`. Only session digests remain in process memory. Failed/disconnected collections never republish; observations expire within 60 seconds. Collector restart resets the remembered roster; only characters observed after restart are retained (maximum 1000). This does not claim a session still exists: idle means previously observed, not currently reported busy. Live end-of-run transition still needs acceptance.

The following sections describe the reusable adapter/provisioning procedure, not the current deployment status.

Set `HABBLAUD_OPENCLAW_SNAPSHOT=/openclaw/snapshot.json`. Native `OpenClawSource` polls every 2 seconds. Disabled when unset. Rebuild the image; the existing 0.11.0 image does not contain this adapter.

Mount **only a dedicated sanitized snapshot directory**, read-only, e.g. `./openclaw-snapshots:/openclaw:ro`. Directory mounting is intentional: atomic file replacement remains visible. Preserve all existing mounts, proxy configuration and security flags; keep terminal, messages, permissions and PTY disabled. Never mount `~/.openclaw`, credential directories, the Gateway socket or transcripts. No hooks/plugins required. This change does not deploy anything.

## Snapshot contract

```json
{"version":1,"observedAt":1791990000000,"sessions":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","activity":"active","observedAt":1791990000000}]}
```

Illustrative only; do not publish this example as real activity.

- Epoch milliseconds. Envelope `observedAt` records completion of collection; row `observedAt` records its original sampling time (Gateway `snapshotAt` when available; otherwise tool-call completion time). Never refresh timestamps on cached observations.
- `id`: lowercase SHA-256 hex of `JSON.stringify([agentId, key])`. Only the digest leaves the trusted collector. No raw session keys, user IDs, labels, paths, model names, prompts, summaries, messages or credentials.
- `activity`: `active`, `idle`, `unknown`. Unknown rows are omitted from the office. All input fields are allowlisted; extra fields invalidate the snapshot.
- Whole snapshot or individual rows expire after 60 seconds. Unavailable/invalid/stale snapshots retire previous characters as `offline` (Habblaud's existing departure animation), meaning **observation unavailable**, not proof a session ended. `/api/health` and `meta.sources` report the error. `path` is empty; `observedAt` is available there. Character activity text includes its actual sampling timestamp.
- Characters share synthetic room `OpenClaw`; no filesystem paths. Flat roster only; no transcript/history/messages/permissions, tools or token stats. Names are approved fixed pseudonyms, never copied from chat titles. Unknown conversations receive a deterministic `Khách <8 hex>` alias.

## Refresh through supported tools

Trusted parent/collector uses first-class `sessions_list`:

1. Request `{activeOnly:true, archived:false, limit:200, includeLastMessage:false, includeDerivedTitles:false}`. Keep filters identical across pages; follow `nextOffset` while `hasMore`. Do not infer inventory from `count`. Deduplicate by `[agentId,key]`; session resets must not create another character.
2. An `activeOnly:true` row proves current running **or queued** activity, so export `activity:"active"`. This is observed busy/queued, not proof of currently generating tokens. For ordinary listings use `hasActiveRun === true` for active; `hasActiveRun === false` for idle; missing means unknown. Never infer active from `updatedAt`, recent age, persisted `status`, child activity, or merely existing in the index. The sampled tool response here had `status:"done"` but no `hasActiveRun`; an ordinary response cannot reliably animate current work.
3. Hash each tuple with Node's built-in `createHash('sha256').update(JSON.stringify(tuple)).digest('hex')`; project only the contract fields. Set each row's observation time from the actual collection, not subsequent file writes. Complete all pages before replacing the previous snapshot. Incomplete/error collection: do not republish old data with new timestamps; let it expire.
4. Write JSON to a temporary sibling file, then atomic rename to `snapshot.json`. Export an empty `sessions:[]` only after a successful complete active-only inventory. No automatic collector/scheduler is installed by this patch. A parent refresh is a snapshot, not a continuous live integration. Refresh within 60 seconds if continuous visibility is needed; otherwise expiry is expected.

Pages are live, not transactionally consistent. Preserve per-row sampling times. A session can end during collection; the UI honestly displays observations up to 60 seconds old. Tool visibility limits apply; internal/sessionless runs are absent. Large inventories exceeding 1000 rows or 256 KiB are rejected.

## Trusted host-side live collector (prepared, not provisioned)

Local installed product docs:

- `docs/gateway/protocol/rpc-session-control.md`: `sessions.list`, authoritative `hasActiveRun`, row `snapshotAt`.
- `docs/gateway/protocol/rpc-bootstrap-and-events.md`: `sessions.subscribe` initial roster, `sessions.changed`, trailing refresh, reconnect bootstrap; `activeOnly` uses live runtime owners.
- `docs/gateway/protocol/auth.md`: paired device authentication and scoped authority; no credential-free external read connection is documented.

`scripts/openclaw-collector.mjs` is a standalone Node >=22.12 trusted-host client using native WebSocket and Node crypto; no new dependencies. It is **not started, paired, approved, scheduled or deployed** by this patch. Habblaud receives only its atomic sanitized snapshot directory, never its private file or environment.

Protocol prerequisites, checked against installed docs/source:

- Gateway protocol **4**, `connect.challenge` nonce + integer server timestamp; Ed25519 signature over v3 payload (`deviceId|clientId|clientMode|role|scopes|signedAt|token|nonce|platform|deviceFamily`, prefixed `v3`). Device ID is SHA-256 of raw 32-byte Ed25519 public key; public key/signature use base64url.
- Closed client-ID schema does not allow `habblaud`. Use supported `client.id: "cli"`, `mode: "cli"`, version `habblaud-collector-1`, a **new dedicated device key**, role `operator`, scopes **only `["operator.read"]`**. Never use reserved `gateway-client`/backend helper, existing device keys, implicit auth stores, or a scope-preservation exception.
- Authenticated socket must advertise `sessions.list`, `sessions.subscribe`, `sessions.changed`; hello authority must be exactly `operator.read`. Token/password bootstrap depends on the Gateway's existing auth mode and pairing policy. A shared credential authenticates the first request but does not replace explicit device pairing. Local auto-approval may exist; the operator must inspect policy before authorizing a first connection. No policy/configuration change is proposed.
- Only `connect`, `sessions.subscribe`, `sessions.list` are called. No transcript subscriptions, enrichment requests, pairing mutations, configuration reads, history or write RPCs. Events can nevertheless contain enriched private fields: discard all event payloads; `sessions.changed` merely schedules canonical refresh.

### Provisioning handoff — operator authorization required before execution

1. Prepare a **new** owner-only directory outside this repository and outside every Habblaud/container mount. Use a fresh absolute private-file path. Never point this client at OpenClaw auth/config files. Output goes into a separate dedicated snapshot directory; both directories must already exist.
2. After explicit authorization, initialize locally (no network request):
   ```sh
   node scripts/openclaw-collector.mjs --init /private/habblaud/device.json ws://127.0.0.1:18789/
   ```
   Replace the endpoint with the actual operator-confirmed Gateway address. Plain WS is accepted only for literal loopback addresses; remote connections require normal certificate-verified WSS. No certificate-trust bypass or TLS pin implementation. Do not put secrets in URLs/arguments. Initialization creates a new Ed25519 key file with `0600`/exclusive-create; it refuses an existing file.
3. For first authentication only, operator supplies `HABBLAUD_COLLECTOR_TOKEN` or `HABBLAUD_COLLECTOR_PASSWORD` through a private process environment/secret manager, never chat, shell history or logs. Existing auth mode selects the credential; obtain it through the operator's authorized secret workflow, not by reading existing credential files here. The dedicated JSON accepts only `version`, `url`, `privateKeyPem`, optional `deviceToken`.
4. Only after approval to connect, run manually:
   ```sh
   node scripts/openclaw-collector.mjs --run /private/habblaud/device.json /dedicated/snapshots/snapshot.json
   ```
   A pairing/auth rejection stops automatic retries with a generic operator-action message. Operator inspects the pending request in the authorized Gateway device UI and checks the new device fingerprint, client identity and **only `operator.read`** before approval. This collector never approves itself, prints raw errors/request IDs or widens scopes. After approval, rerun with the same private file. If policy auto-approves local connections, review the resulting device grant instead; do not change policy to make this work.
5. A successful hello saves only the newly issued dedicated device token atomically into that same `0600` file. Remove bootstrap environment credentials for later runs; the dedicated token takes precedence. Keep identity+token together, never mount them into Habblaud. Operator revocation/reapproval remains outside the collector. SIGINT/SIGTERM stop it; no service or scheduler is installed.

The client checks private-file ownership, permissions, size and symlink rejection. Output/private files must have different parent directories. Do not place a symlinked snapshot directory inside a credential directory; mount only the output directory.

Subscription listeners are installed before bootstrap. Subscribe returns the initial first page; further pages follow `nextOffset` with identical filters. Changed events during bootstrap/collection cause trailing canonical refresh. Deduplication uses the hashed exact identity tuple. Active-only rows mean running **or queued**; no status/age/child inference. Sampling time is `snapshotAt`, falling back to each page's completion time. Invalid/incomplete/oversized inventories never replace prior output. Periodic 20s refresh bounds event loss; changes debounce at 250ms. Page limit 100, inventory limit 1000, strict output limit 256KiB.

Disconnected or silent sockets publish nothing: existing observations expire at the source's 60s limit, including cached rows with old `snapshotAt`. Liveness timeout is three Gateway tick intervals (at least 15s). Network reconnect backs off from 1s to 30s, re-signs the fresh challenge, re-subscribes and reboots inventory. Auth/scope/protocol/subscription rejection stops for operator action; Gateway `UNAVAILABLE` retries. No cached snapshot heartbeat, no fake idle/empty inventory on failure. Successful empty inventory alone publishes `sessions:[]`.

Offline verification (fake socket, no Gateway connection, no credential writes):

```sh
node --check scripts/openclaw-collector.mjs
node scripts/openclaw-collector.test.mjs
```

Checks: sanitizer allowlist/no enrichment leakage, tuple hashing, invalid timestamps/identities, safe URLs, pagination/dedup/empty inventory/incomplete failure, Ed25519 v3 signature, exact read scope/client ID, bootstrap-event trailing refresh, disconnect expiry, reconnect subscribe/bootstrap, preservation of stale Gateway sampling times. Live pairing/visibility/rollout remains unverified until separately authorized.

## Verify / deploy (parent)

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test -- server/sources/openclaw.test.ts server/sources/source.test.ts client/src/ui/provider.test.ts
npm run build
```

After approved image rebuild/container rollout with the dedicated read-only mount, publish a freshly collected snapshot. Verify `/api/health`, the `OpenClaw` room, provider `openclaw`, empty source path, no transcript resolution. Stop refreshing for >60 seconds: source unhealthy, characters offline/retired. Existing public hostname/auth policy remains unchanged. Public viewers can see pseudonymous presence/timing; collect only sessions authorized for that disclosure.

## Fixed identities — prepared, not deployed

Collector identities now hash `[agentId,key]`, excluding transient `sessionId`. Resetting a session keeps its character ID, deterministic appearance seed and pseudonym. This changes existing digests once: old characters depart on the next adapter poll; no old-to-new raw identity migration is exported.

Optional `HABBLAUD_COLLECTOR_ALIASES=/private/habblaud/aliases.json` loads a private JSON object mapping exact session keys to approved names: Bơ, Mạch, Bit, Nét, Đất, Số, Kẹp, Nhớ, An, Bi, Thử, Nhịp, Lộc. Duplicate names and unapproved values are rejected. The file must be owner-only, regular, non-symlink, at most 16 KiB. Keep it outside repository and container mounts; never publish keys or real session labels. Restart the collector after editing this mapping. No new Gateway RPC or listing parameter is added.

Snapshot rows may additionally carry `alias` (approved name or `Khách <8 lowercase hex>`) and `temporary` (boolean). Adapter validates these fields and applies aliases only for OpenClaw. Existing snapshots without them remain supported. Permanent characters retain their aliases through active/idle transitions. Missing subagent/cron rows are removed rather than retained idle; normal offline/departure animation still applies. Parent-derived names such as `Bit 2` are not implemented: active-only flat inventory has no sanitized parent lineage. Do not infer parent identity from a child UUID.

A private local alias file has been prepared for eight verified conversations. Five approved topic names remain unmapped pending exact session-key verification. No service environment or deployment was changed for this feature. Rollout requires parent review, adding the alias-file environment variable to the existing service while preserving settings, rebuilding/replacing the Habblaud image, then restarting the collector. Mount only the existing sanitized output directory. Verify fixed names, session-reset identity, active/idle/active, temporary departure and >60s disconnect expiry. Public presence acceptance remains outstanding.

## Current collector behavior (supersedes preparation notes above)

The collector requests the complete non-archived inventory (`activeOnly: false`).
Only permanent conversations explicitly present in the private alias map are exported;
unmapped conversations are excluded. Temporary subagent/cron sessions are exported
only while `hasActiveRun === true`. The authoritative `hasActiveRun` field selects
active versus idle; idle conversations survive collector restarts through a fresh
inventory, not a cached heartbeat. Removed/archived rows disappear from the next
complete inventory. Disconnects still publish nothing and observations expire after
60 seconds. Reset identity remains based on `[agentId,key]`.

Alias changes require restarting the collector. Existing Habblaud characters retain
their in-memory name until the application is restarted; reload the application when
correcting an existing alias. Never commit alias files, device credentials, live
snapshots or deployment-specific Cloudflare configuration.

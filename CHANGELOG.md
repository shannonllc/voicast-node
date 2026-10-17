# Changelog

## 0.5.0 (2026-10-17)

- Voices are chosen by ID: `VoiceName` lists the 30 voice IDs, such as `female-breezy` (default), `female-firm` and `male-calm`. Agents read from the API return these IDs. The `VoiceName` type no longer has the earlier voice names, so code that sets one of them stops type-checking; switch to the ID. The API still accepts the earlier names and saves the matching ID.
- Web: when the voice server refuses the offer, `VoiceSessionError` uses the server's `message` (servers before this change sent only `detail`, which is still read).
- `AgentTool.confirm_message` and `AgentTool.done_message`: for `confirm` tools, voicast now asks the caller with a fixed confirmation message and tells the result in a fixed message. These templates set the messages; `{argument name}` inserts an argument value (dates and times are read as spoken dates).

## 0.4.0 (2026-10-16)

- Transfer on a handoff for SIP: `SipCredential.transfer_to` (always present, `''` for none) is where the PBX transfers the call with SIP REFER when the AI hands off to a person (outcome `handoff`): an extension or number (digits and `*` `#` `+`, up to 32 characters) or a SIP URI (`sip:` / `sips:`, up to 200 characters). `tenants.createSipCredential` takes `transfer_to`.
- `tenants.updateSipCredential(tenantId, credentialId, { name?, agent_id?, transfer_to? })` (`PATCH /v1/tenants/:id/sip-credentials/:credential`, retried like other PATCH requests) changes only the fields given and returns the credentials without the password. `agent_id: null` uses the tenant's agent; `transfer_to: ''` or `null` turns the transfer off. Type `SipCredentialUpdateParams`.

## 0.3.0 (2026-10-16)

- SIP credentials for a PBX that sends calls to `sip.voicast.jp`: `tenants.createSipCredential(tenantId, { name?, agent_id? })` (`POST /v1/tenants/:id/sip-credentials`, returns the password once, not retried on a 5xx or a network error), `tenants.listSipCredentials(tenantId)` and `tenants.deleteSipCredential(tenantId, credentialId)`. Types `SipCredential`, `SipCredentialWithPassword` and `SipCredentialCreateParams`.
- `AgentTool.quiet`: `true` keeps the text the AI writes in a reply that calls this tool from being spoken (only the tool response `say` is spoken).
- `AgentTool.heard`: `true` adds `heard` (what the caller said just before, up to 5 transcripts) to the signed `tool.call` body, so the tool can check the AI did not make up a value.

## 0.2.0 (2026-10-12)

- Web: `setMuted()` sends silence through an `AudioContext` instead of disabling the track, so a short reply right after unmuting is not lost. New option `audioContext` (create it in a user gesture on iOS) and getter `muted`. Falls back to disabling the track when no running `AudioContext` is available.
- Retention period for call records and recordings: `retention.get()` (`GET /v1/retention`) and `retention.update({ retention_days })` (`PATCH /v1/retention`, retried like other PATCH requests). `retention_days` is 1, 7, 14 or 30 (30 by default and the maximum); types `Retention`, `RetentionDays` and `RetentionUpdateParams`.
- `usage.get` takes `channel`, `tenant_id` and `external_id` filters, and `Usage.filter` returns the filters applied.
- `calls.list` takes `outcome` (`in_progress` for calls with no outcome yet), `from` and `to`. `Call.trial` is `true` for calls made with Test in browser in the dashboard.
- `tools.try`: a tool definition must carry its own `auth.value`; the agent's stored API key is used only with a saved tool's name (422 `missing_api_key`).

## 0.1.0 (2026-10-04)

- First release.
- Agent tools for third-party APIs: `AgentTool.method` (`GET` or `POST`), `sign: false` (send the arguments as they are) and `auth: { type: 'api_key', header, value }` (the key is stored encrypted and never returned). `Agent.tool_keys` lists the stored keys (tool name and last 4 characters) on `create`, `get` and `update`.
- `tools.try({ tool, agent_id?, arguments?, tenant_id? })` calls a saved or unsaved tool once and returns `ToolTryResult` (`ok`, `result`, `error`, `status`, `body`, `duration_ms`). Not retried on a 5xx or a network error. `ToolCallRequest.test` is `true` for these requests, `call.channel` is `'test'` and `call.tenant` can be `null`.
- `AgentConnectorEntry.actions` lists action names; `'*'` is no longer accepted.
- Billing with the API key: `billing.get()` (balance, auto-recharge, per-minute price) and `billing.createTopup({ amount_yen })` (Stripe Checkout URL).
- Tools signing secret: `tools.getSecret()` and `tools.rotateSecret()`. `AgentTool.confirm`.
- `Session.ice_servers` (pass to `VoiceSession`'s `iceServers`). `Call.billed_yen` replaces `cost_yen`. `Usage.note`.
- `calls.list` pages with `cursor` / `next_cursor` (calls that started in the same millisecond are no longer skipped); `before` is still accepted for the first page.
- `webhooks.createPortalLink({ locale })`. `connections.create` accepts `tenant_id: null`.
- `new Voicast(apiKey?, { baseUrl?, timeout?, maxRetries?, fetch? })`: API key from the argument or `VOICAST_API_KEY`, default base URL `https://api.voicast.jp`. Retries 429 (honouring `retry-after` and `x-ratelimit-reset`, up to one minute) and, for requests safe to repeat (GET, PATCH, DELETE), 5xx, timeouts and network errors, with exponential backoff and jitter. Every method takes `{ timeout?, maxRetries?, signal? }` as the last argument.
- Agents: `agents.create`, `list`, `get(id, { version? })`, `update`, `versions`, `delete`.
- Tenants: `tenants.create` (returns the connection secret once), `list`, `get`, `update`, `rotateSecret`, `delete`, `listConnections`, `createConnectLink`.
- Calls: `calls.list({ tenant_id?, cursor?, limit? })` (await one page, or `for await` every call), `get`, `getByProvider`, `transcript`.
- Sessions for Web and app voice: `sessions.create({ tenant_id, agent_id?, output? })`.
- Usage: `usage.get({ from?, to?, group_by? })`.
- Connectors and connections: `connectors.list`, `connections.list({ tenant_id? })`, `create`, `get`, `update`, `options`, `delete`.
- Webhook portal: `webhooks.createPortalLink({ frame_origin? })`.
- Typed errors: `AuthenticationError` (401), `PaymentRequiredError` (402), `PermissionError` (403), `NotFoundError` (404), `ConflictError` (409), `ValidationError` (400, 422), `RateLimitError` (429), `ApiError`, `ConnectionError`, `TimeoutError`, all extending `VoicastError` with `status`, `code`, `details` and `requestId`.
- `verifyWebhook(payload, headers, secret)` returns a typed `VoicastEvent` (`call.started`, `call.handoff_requested`, `call.ended`, `call.transcript_ready`, `call.summary_ready`, `connection.needs_reauth`, `billing.*`). `verifyToolCall(payload, headers, secret)` verifies in-call tool requests and returns a typed `ToolCallRequest`. Both take several secrets while you switch to a new one. `Webhook` for lower-level use and `sign()` for tests.
- `voicast/web`: calls the browser's `fetch` as a plain function (calling it as a method of the session failed with `Illegal invocation` in browsers).
- `voicast/web`: `VoiceSessionError` has `status` and `code` (402 `balance_depleted` when new calls are refused for billing; 403 for an invalid, expired or used token).
- `voicast/web`: `startVoiceSession({ clientToken, webrtcUrl })` and `VoiceSession` start a WebRTC voice conversation in the browser (events `ready`, `reply`, `interrupted`, `end`, `user-transcript`, `bot-output`, `track`, `state`, `error`, `closed`). No dependencies.

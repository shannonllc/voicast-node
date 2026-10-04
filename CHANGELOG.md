# Changelog

## 0.1.0 (unreleased)

- First release.
- Agent tools for third-party APIs: `AgentTool.method` (`GET` or `POST`), `sign: false` (send the arguments as they are) and `auth: { type: 'api_key', header, value }` (the key is stored encrypted and never returned). `Agent.tool_keys` lists the stored keys (tool name and last 4 characters) on `create`, `get` and `update`.
- `tools.try({ tool, agent_id?, arguments?, tenant_id? })` calls a saved or unsaved tool once and returns `ToolTryResult` (`ok`, `result`, `error`, `status`, `body`, `duration_ms`). Not retried on a 5xx or a network error. `ToolCallRequest.test` is `true` for these requests, `call.channel` is `'test'` and `call.tenant` can be `null`.
- `AgentConnectorEntry.actions` lists action names; `'*'` is no longer accepted.
- Billing with the API key: `billing.get()` (balance, auto-recharge, per-minute price) and `billing.createTopup({ amount_yen })` (Stripe Checkout URL).
- Tools signing secret: `tools.getSecret()` and `tools.rotateSecret()`. `AgentTool.confirm`.
- `Session.ice_servers` (pass to `VoiceSession`'s `iceServers`). `Call.billed_yen` replaces `cost_yen` (the internal cost is no longer returned). `Usage.note`.
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

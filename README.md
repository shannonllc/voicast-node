# voicast

Node.js / TypeScript SDK for [voicast](https://voicast.jp/), the headless conversational AI platform that handles reception and bookings by phone and on the Web.

- No dependencies. Uses `fetch` and Web Crypto.
- Node.js 18+, Bun, Deno, Cloudflare Workers. `voicast/web` runs in the browser.
- ESM and CommonJS, with TypeScript types.

## Install

```sh
npm install voicast
```

## Quick start

```ts
import { Voicast } from 'voicast';

const voicast = new Voicast('vk_live_...'); // or set VOICAST_API_KEY

// What the AI says and asks
const agent = await voicast.agents.create({
  name: 'Reception',
  config: {
    greeting: 'お電話ありがとうございます。○○歯科です。',
    persona: '丁寧で落ち着いた受付',
    fields: [
      { key: 'name', label: 'お名前', required: true },
      { key: 'phone', label: '電話番号', type: 'phone' },
    ],
    handoff_when: ['急患', '担当者と話したいと言われた'],
    closing: '承りました。担当者から折り返しご連絡します。',
    voice: 'Kore',
  },
});

// The business that takes the calls (your customer)
const tenant = await voicast.tenants.create({ external_id: 'clinic-123', name: '○○歯科', agent_id: agent.id });
// tenant.secret (vts_...) is returned only here: pass it to your Twilio <Stream> as the `secret` parameter
```

Use the API key on your server only. Never ship it to a browser or an app.

## Talk from a browser or an app

Create a session on your server and pass only `client_token`, `webrtc_url` and `ice_servers` to the browser.

```ts
// server
const session = await voicast.sessions.create({ tenant_id: tenant.id }); // output: 'audio' (default) or 'text'
return { client_token: session.client_token, webrtc_url: session.webrtc_url, ice_servers: session.ice_servers };
```

```ts
// browser
import { VoiceSession } from 'voicast/web';

const session = new VoiceSession({ clientToken, webrtcUrl, iceServers }); // iceServers: the session's ice_servers (STUN, and TURN when available)
session.on('user-transcript', ({ text, final }) => showUser(text, final));
session.on('bot-output', ({ text }) => showBot(text)); // what the AI said (output: 'audio')
session.on('closed', ({ reason }) => console.log('closed', reason));
await session.start(); // asks for the microphone, then connects

hangupButton.onclick = () => session.stop();
```

The token expires in 2 minutes and can be used once; create a new session to reconnect. Call `start()` from a click so the browser lets the AI's voice play.

With `output: 'text'` voicast does not speak: each sentence arrives as a `reply` event, so you can give it to an avatar (such as [avacast](https://avacast.jp/)) or show it.

```ts
session.on('reply', ({ text }) => avatar.speak(text));
session.on('interrupted', () => avatar.interrupt()); // the user started talking
session.on('end', ({ outcome }) => console.log('ended', outcome));
```

| Event | Payload | When |
|---|---|---|
| `ready` | `{}` | The AI is ready |
| `reply` | `{ text }` | A sentence of the reply (`output: 'text'`) |
| `interrupted` | `{}` | The user started talking: stop the current reply |
| `end` | `{ outcome }` | The AI ended the conversation |
| `user-transcript` | `{ text, final }` | What the user said |
| `bot-output` | `{ text }` | A sentence the AI spoke (`output: 'audio'`) |
| `bot-started-speaking` / `bot-stopped-speaking` | `{}` | |
| `track` | `{ stream }` | The AI's audio track. Played automatically unless `playAudio: false` |
| `state` | `{ state }` | `RTCPeerConnection.connectionState` changed |
| `message` | RTVI message | Every message from the voice server |
| `error` | `{ error }` | |
| `closed` | `{ reason }` | `ended`, `hangup`, `failed`, `disconnected` or `error`. Emitted once |

Options: `mediaStream` (your own microphone stream), `audioElement`, `playAudio`, `iceServers`, `iceGatheringTimeout`, `disconnectTimeout`, `fetch`. `setMuted(true)` mutes the microphone. `on()` returns a function that removes the listener.

After the call, get the result with `voicast.calls.getByProvider(session.id)`.

## Webhooks

voicast sends `call.ended`, `call.transcript_ready`, `call.summary_ready` and other events to the endpoints you register on the webhook portal (`voicast.webhooks.createPortalLink()`). Verify them with the endpoint's signing secret. Pass the raw request body, not a parsed object.

```ts
import { verifyWebhook } from 'voicast';

const event = await verifyWebhook(rawBody, headers, process.env.VOICAST_WEBHOOK_SECRET!); // whsec_...
switch (event.type) {
  case 'call.ended':
    console.log(event.data.outcome, event.data.fields, event.data.tenant.external_id);
    break;
  case 'call.summary_ready':
    console.log(event.data.summary, event.data.category);
    break;
  case 'billing.balance_low':
    console.log(event.data.balance_yen);
    break;
}
```

`verifyWebhook` throws `WebhookVerificationError` when the signature does not match or the timestamp is more than 5 minutes off (`{ tolerance: 300 }` as the fourth argument). Pass an array of secrets while you switch to a new one.

| Event | `data` |
|---|---|
| `call.started` | `{ call_id, provider_call_id, from, started_at, tenant }` |
| `call.handoff_requested` | `{ call_id, provider_call_id, reason, fields, tenant }` |
| `call.ended` | the `Call` and `tenant` |
| `call.transcript_ready` | `{ call_id, provider_call_id, turns, tenant }` |
| `call.summary_ready` | `{ call_id, provider_call_id, summary, category, fields, tenant }` |
| `connection.needs_reauth` | `{ connection_id, connector, label, status, tenant }` |
| `billing.balance_low` / `billing.balance_depleted` / `billing.recharge_failed` / `billing.cap_reached` | billing details (see the types) |

Express:

```ts
app.post('/webhooks/voicast', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await verifyWebhook(req.body, req.headers, secret);
    // handle event
    res.sendStatus(204);
  } catch {
    res.sendStatus(400);
  }
});
```

Hono or Next.js (App Router):

```ts
const event = await verifyWebhook(await req.text(), req.headers, secret);
```

## Tools the AI uses during a call

An agent's `config.tools` lets the AI call your API during a call (check free slots, look up a customer, make a booking). voicast POSTs a signed request to the tool's `url` and waits up to 8 seconds; reply with 2xx and JSON, which is given to the AI as is.

```ts
import { verifyToolCall } from 'voicast';

app.post('/voicast/tools', express.raw({ type: 'application/json' }), async (req, res) => {
  const call = await verifyToolCall<{ date: string }>(req.body, req.headers, process.env.VOICAST_TOOLS_SECRET!);
  if (call.tool === 'find_free_slots') {
    res.json({ slots: await findSlots(call.arguments.date, call.call.tenant?.external_id) });
  }
});
```

The tools signing secret (`whsec_...`) is per environment: `await voicast.tools.getSecret()` (or the environment settings in the dashboard). `voicast.tools.rotateSecret()` makes a new one; for 24 hours requests are signed with both, so pass both secrets to `verifyToolCall` while you switch. Tools with `confirm: true` are used only after the AI reads out the details and the caller agrees. `call.tool_call_id` (also sent as `idempotency-key`) is unique per tool call: use it so a retried booking is not made twice.

To call a third-party API directly, set `sign: false` (the arguments are sent as they are: the query string for `method: 'GET'`, the JSON body for `POST`) and `auth: { type: 'api_key', header, value }` (for `Authorization` the key is sent as `Bearer <key>`). The key is stored encrypted outside the config and never returned; `agent.tool_keys` shows its last 4 characters, and later updates can leave `value` out.

Test a tool before or after saving it with `tools.try` (not billed, not recorded as a call, up to 30 per minute). Signed requests carry `test: true`, `call.channel: 'test'`, and `call.tenant: null` unless you pass `tenant_id`:

```ts
const r = await voicast.tools.try({ agent_id: agent.id, tool: 'find_free_slots', arguments: { date: '2026-10-05' } });
if (!r.ok) console.log(r.error, r.message, r.status, r.body);
```

## API

| Method | Endpoint |
|---|---|
| `agents.create({ name, config })` | `POST /v1/agents` |
| `agents.list()` | `GET /v1/agents` |
| `agents.get(id, { version? })` | `GET /v1/agents/:id` |
| `agents.update(id, { name?, config })` | `PUT /v1/agents/:id` (adds a version) |
| `agents.versions(id)` | `GET /v1/agents/:id/versions` |
| `agents.delete(id)` | `DELETE /v1/agents/:id` |
| `tenants.create({ external_id, name?, agent_id? })` | `POST /v1/tenants` |
| `tenants.list()` | `GET /v1/tenants` |
| `tenants.get(id)` | `GET /v1/tenants/:id` |
| `tenants.update(id, { name?, agent_id?, status? })` | `PATCH /v1/tenants/:id` |
| `tenants.rotateSecret(id)` | `POST /v1/tenants/:id/secret` |
| `tenants.delete(id)` | `DELETE /v1/tenants/:id` |
| `tenants.listConnections(id)` | `GET /v1/tenants/:id/connections` |
| `tenants.createConnectLink(id, { connectors?, frame_origin? })` | `POST /v1/tenants/:id/connect-links` |
| `calls.list({ tenant_id?, cursor?, limit? })` | `GET /v1/calls` (`before` is still accepted for the first page) |
| `calls.get(id)` | `GET /v1/calls/:id` |
| `calls.getByProvider(providerCallId)` | `GET /v1/calls/by-provider/:providerCallId` |
| `calls.transcript(id)` | `GET /v1/calls/:id/transcript` |
| `sessions.create({ tenant_id, agent_id?, output? })` | `POST /v1/sessions` |
| `usage.get({ from?, to?, group_by? })` | `GET /v1/usage` |
| `connectors.list()` | `GET /v1/connectors` |
| `connections.list({ tenant_id? })` | `GET /v1/connections` |
| `connections.create({ connector, secret, input?, tenant_id? })` | `POST /v1/connections` |
| `connections.get(id)` | `GET /v1/connections/:id` |
| `connections.update(id, { config })` | `PATCH /v1/connections/:id` |
| `connections.options(id, query?)` | `GET /v1/connections/:id/options` |
| `connections.delete(id)` | `DELETE /v1/connections/:id` |
| `webhooks.createPortalLink({ frame_origin?, locale? })` | `POST /v1/webhooks/portal` |
| `billing.get()` | `GET /v1/billing` |
| `billing.createTopup({ amount_yen })` | `POST /v1/billing/topups` |
| `tools.getSecret()` | `GET /v1/tools/secret` |
| `tools.rotateSecret()` | `POST /v1/tools/secret/rotate` |
| `tools.try({ tool, agent_id?, arguments?, tenant_id? })` | `POST /v1/tools/try` |

Every method also takes request options as the last argument: `{ timeout?, maxRetries?, signal? }`.

The call summary and category are on the `Call` (`summary`, `category`), filled in when `call.summary_ready` is sent. `billed_yen` is what the call costs your organization (yen before tax; `null` while the call is in progress).

`billing.get()` returns your organization's balance, auto-recharge settings and per-minute price (shared by the live and test environments). `billing.createTopup({ amount_yen })` returns a Stripe Checkout URL (500 to 300,000 yen before tax) to open in a browser. Auto-recharge, the monthly cap and the card are changed in the dashboard.

The API allows 600 requests per minute per API key. Every response has `x-request-id` (`requestId` on errors); quote it when contacting support.

### Paging through calls

`await` gives one page (`{ data, has_more, next_cursor }`). Pass `next_cursor` as `cursor` for the next page, or let `for await` walk every call, newest first.

```ts
const { data, has_more } = await voicast.calls.list({ tenant_id: 'ten_...', limit: 100 });

for await (const call of voicast.calls.list({ tenant_id: 'ten_...' })) {
  console.log(call.id, call.outcome);
}
```

## Errors

Every error extends `VoicastError` and has `status`, `code` (such as `invalid_request`, `in_use`, `balance_depleted`), `message`, `details` and `requestId`.

| Class | When |
|---|---|
| `AuthenticationError` | 401: the API key is missing, wrong or revoked |
| `PaymentRequiredError` | 402: new calls are refused (`balance_depleted`) |
| `PermissionError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409: duplicate `external_id`, agent `in_use`, `tenant_disabled`, `needs_reauth` |
| `ValidationError` | 400, 422. See `details` |
| `RateLimitError` | 429, after retries. `retryAfter` in seconds |
| `ApiError` | other responses, including 5xx |
| `ConnectionError` / `TimeoutError` | no response, or `timeout` reached |
| `WebhookVerificationError` | `verifyWebhook` or `verifyToolCall` failed |

```ts
import { PaymentRequiredError } from 'voicast';

try {
  await voicast.sessions.create({ tenant_id });
} catch (e) {
  if (e instanceof PaymentRequiredError && e.code === 'balance_depleted') showTopUpNotice();
  else throw e;
}
```

## Retries and timeouts

`new Voicast(key, { timeout: 30_000, maxRetries: 2 })` are the defaults. 429 is retried for every request, waiting `retry-after` (up to one minute). 5xx, timeouts and network errors are retried only for requests safe to repeat (GET, PATCH, DELETE), with exponential backoff from 0.5 s. Creating agents, tenants, sessions and connections, updating an agent and rotating a secret are not retried on those, so they never run twice.

## Links

- voicast: https://voicast.jp/
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- License: MIT

// /v1 の入力と返りの型（docs/api.md と apps/worker/src/resources.ts に合わせる）。時刻は Unix ミリ秒。

/** Options accepted by every method as the last argument. */
export interface RequestOptions {
  /** Milliseconds per attempt. Overrides the client's `timeout`. */
  timeout?: number;
  /** Retries after the first attempt. Overrides the client's `maxRetries`. */
  maxRetries?: number;
  /** Aborts the request (and any wait before a retry). */
  signal?: AbortSignal;
}

/** A list that is not paged. */
export interface List<T> {
  data: T[];
}

/** One page of a paged list (`calls.list`). */
export interface Page<T> {
  data: T[];
  /** `true` when there are more items after this page. */
  has_more: boolean;
  /** Pass as `cursor` to get the next page. `null` when `has_more` is `false`. */
  next_cursor: string | null;
}

// 会話の設定（agent）

export interface AgentField {
  /** Lowercase letters, digits and `_`. */
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'phone';
}

export interface AgentToolParameter {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  enum?: string[];
}

/** An API key sent with a tool's requests. */
export interface AgentToolAuth {
  type: 'api_key';
  /** Header to send the key in. For `Authorization` the key is sent as `Bearer <key>`. */
  header: string;
  /**
   * The key. Sent only: voicast stores it encrypted per agent, outside the config (it is never returned).
   * Leave it out on later updates to keep the stored key (see `Agent.tool_keys`).
   */
  value?: string;
}

/**
 * A tool the AI can use during a call. By default voicast POSTs a signed `tool.call` to `url` (see `verifyToolCall`);
 * with `sign: false` it sends the arguments as they are (for third-party APIs). Up to 10 per agent.
 */
export interface AgentTool {
  /** Lowercase letters, digits and `_`. `finish` is reserved. */
  name: string;
  /** When to use it. The AI reads this to decide. */
  description: string;
  /** Public `https` URL. */
  url: string;
  /** Default `POST`. Signed tools (`sign` not `false`) must use `POST`. */
  method?: 'GET' | 'POST';
  /**
   * Default `true`: a signed `tool.call` request (`{ type, tool, tool_call_id, arguments, call }`).
   * `false`: the arguments as they are, in the query string (`GET`) or as the JSON body (`POST`).
   */
  sign?: boolean;
  /** Sends an API key with every request. */
  auth?: AgentToolAuth;
  parameters?: { properties: Record<string, AgentToolParameter>; required?: string[] };
  /** `true`: the AI reads out the details and uses the tool only after the caller agrees. Use it for tools that book, change or cancel. */
  confirm?: boolean;
}

/**
 * A connector used by the agent. `connector` picks a preset (the tenant's connection, else the environment's);
 * `connection` picks one connection (`con_…`, required for custom connections).
 * `actions` lists the action names the AI may use (there is no wildcard: actions added later are not included).
 */
export type AgentConnectorEntry =
  | { connector: string; actions?: string[]; confirm?: string[] }
  | { connection: string; actions?: string[]; confirm?: string[] };

/** Chirp 3 HD Japanese voice names. Other strings are rejected by the API with 422 `invalid_config`. */
export type VoiceName =
  | 'Aoede'
  | 'Kore'
  | 'Leda'
  | 'Zephyr'
  | 'Autonoe'
  | 'Laomedeia'
  | 'Sulafat'
  | 'Vindemiatrix'
  | 'Achernar'
  | 'Despina'
  | 'Erinome'
  | 'Pulcherrima'
  | 'Gacrux'
  | 'Callirrhoe'
  | 'Charon'
  | 'Puck'
  | 'Orus'
  | 'Alnilam'
  | 'Fenrir'
  | 'Achird'
  | 'Iapetus'
  | 'Umbriel'
  | 'Algieba'
  | 'Algenib'
  | 'Rasalgethi'
  | 'Schedar'
  | 'Zubenelgenubi'
  | 'Sadachbia'
  | 'Sadaltager'
  | 'Enceladus';

/** Allowed `speaking_rate` steps. Default 1.15. */
export type SpeakingRate = 0.85 | 0.9 | 0.95 | 1 | 1.05 | 1.1 | 1.15 | 1.2 | 1.25 | 1.3 | 1.4 | 1.5;

export interface AgentConfig {
  /** The first line, spoken as is. */
  greeting: string;
  /** How the AI talks. */
  persona: string;
  /** What to ask the caller. */
  fields: AgentField[];
  /** When to hand the call over to a person. */
  handoff_when: string[];
  /** Said when every field is collected. */
  closing: string;
  /** Said when an FAQ answered the caller's question. */
  closing_answered?: string;
  faq?: { q: string; a: string }[];
  /** Business domain (speech recognition hint). */
  domain?: string;
  /** Terms (speech recognition hint). */
  vocabulary?: string[];
  /** Default `Aoede`. */
  voice?: VoiceName;
  /** Default 1.15. */
  speaking_rate?: SpeakingRate;
  tools?: AgentTool[];
  connectors?: AgentConnectorEntry[];
}

export interface Agent {
  id: string;
  name: string;
  version: number;
  /** Present on `create`, `get` and `update`; absent in `list`. */
  config?: AgentConfig;
  /** The tools' stored API keys. Present on `create`, `get` and `update`; absent in `list`. */
  tool_keys?: AgentToolKey[];
  created_at: number;
  updated_at: number;
}

/** An API key stored for one of the agent's tools (the key itself is never returned). */
export interface AgentToolKey {
  /** The tool's `name`. */
  name: string;
  /** The last 4 characters of the key; empty for keys shorter than 12 characters. */
  hint: string;
  updated_at: number;
}

export interface AgentWithConfig extends Agent {
  config: AgentConfig;
  tool_keys: AgentToolKey[];
}

export interface AgentCreateParams {
  name: string;
  config: AgentConfig;
}

export interface AgentUpdateParams {
  name?: string;
  config: AgentConfig;
}

export interface AgentVersion {
  version: number;
  created_at: number;
}

// テナント

export type TenantStatus = 'active' | 'disabled';

export interface Tenant {
  id: string;
  /** Your ID for the business. Letters, digits and `. _ : -`, 1 to 100 characters. */
  external_id: string;
  name: string;
  agent_id: string | null;
  status: TenantStatus;
  created_at: number;
}

export interface TenantWithSecret extends Tenant {
  /** Connection secret (`vts_…`) for the phone stream. Returned only here. */
  secret: string;
}

export interface TenantCreateParams {
  external_id: string;
  name?: string;
  agent_id?: string;
}

export interface TenantUpdateParams {
  name?: string;
  agent_id?: string | null;
  status?: TenantStatus;
}

export interface TenantSecret {
  secret: string;
  /** The previous secret keeps working until this time. */
  previous_secret_expires_at: number;
}

// 通話

export type CallOutcome = 'completed' | 'answered' | 'handoff' | 'hangup' | 'error';
export type CallChannel = 'phone' | 'web';
export type CallOutput = 'audio' | 'text';

export interface Call {
  id: string;
  tenant_id: string;
  agent: { id: string; version: number };
  /** Twilio CallSid for phone calls, the session ID for Web calls. */
  provider_call_id: string | null;
  from: string | null;
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  outcome: CallOutcome | null;
  reason: string | null;
  /** The fields collected from the caller. */
  fields: Record<string, string> | null;
  /**
   * What the call costs your organization, in yen before tax (up to 3 decimals). `null` while the call is in progress.
   * The amount taken from the balance (if not yet deducted, seconds × your per-minute price ÷ 60).
   */
  billed_yen: number | null;
  /** Summary written after the call. `null` until `call.summary_ready`. */
  summary: string | null;
  category: string | null;
  has_transcript: boolean;
  channel: CallChannel;
  output: CallOutput;
}

export interface CallListParams {
  tenant_id?: string;
  /** `next_cursor` from the previous page. */
  cursor?: string;
  /**
   * Only calls that started before this time (Unix milliseconds). Kept for compatibility: it can skip calls that started
   * in the same millisecond, so prefer `cursor`. Cannot be combined with `cursor`.
   */
  before?: number;
  /** 1 to 100. Default 50. */
  limit?: number;
}

export interface TranscriptTurn {
  role: 'assistant' | 'user';
  text: string;
}

export interface Transcript {
  call_id: string;
  turns: TranscriptTurn[];
}

// セッション（Web・アプリ）

export interface SessionCreateParams {
  tenant_id: string;
  /** Default: the tenant's agent. */
  agent_id?: string;
  /** `text` returns the replies as text only (no voice). Default `audio`. */
  output?: CallOutput;
}

export interface Session {
  /** Use with `calls.getByProvider(id)` after the call. */
  id: string;
  tenant_id: string;
  agent_id: string;
  output: CallOutput;
  /** `vct_…`. Pass it to the browser or app. Expires in 2 minutes and can be used once. */
  client_token: string;
  expires_at: number;
  /** WebRTC signalling URL (`https://voice.voicast.jp/v1/webrtc/offer`). Pass it to the browser or app. */
  webrtc_url: string;
  /** ICE servers (STUN, and TURN with short-lived credentials when configured) for `RTCPeerConnection`. Pass them to the browser or app. */
  ice_servers: IceServer[];
}

/** Same shape as the browser's `RTCIceServer`. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// 利用

export type UsageGroupBy = 'tenant' | 'day' | 'channel';

export interface UsageParams {
  /** `YYYY-MM-DD` (Japan time, inclusive) or Unix milliseconds. Default: the start of this month (Japan time). */
  from?: string | number;
  /** `YYYY-MM-DD` (Japan time, inclusive) or Unix milliseconds (exclusive). Default: now. Up to 366 days. */
  to?: string | number;
  group_by?: UsageGroupBy;
}

export interface UsageTotals {
  calls: number;
  seconds: number;
  minutes: number;
  /** Estimate before tax: seconds / 60 × `unit_price_yen`. */
  amount_yen: number;
}

export type UsageRow = UsageTotals &
  ({ tenant: { id: string; external_id: string; name: string } } | { day: string } | { channel: CallChannel });

export interface Usage {
  environment: 'live' | 'test';
  from: number;
  to: number;
  group_by: UsageGroupBy | null;
  unit_price_yen: number;
  total: UsageTotals;
  /** Empty when `group_by` is not given. */
  data: UsageRow[];
  /** How the amounts are counted (a sentence in Japanese). */
  note: string;
}

// 請求（組織。本番とテストの環境で共通）

export interface Billing {
  organization_id: string;
  /** This month in Japan time (`YYYY-MM`). */
  month: string;
  contract: { per_minute_yen: number };
  price: { per_minute_yen: number };
  stripe_enabled: boolean;
  has_card: boolean;
  /** Calls that ended this month, live and test environments together. */
  usage: { calls: number; seconds: number; minutes: number };
  /** Taken from the balance this month. Yen before tax. */
  estimate_yen: number;
  /** The prepaid balance. New calls are refused while `depleted`. */
  balance: {
    yen: number;
    milli_yen: number;
    depleted: boolean;
    next_expiry: { yen: number; at: number } | null;
  };
  auto_recharge: {
    enabled: boolean;
    threshold_yen: number;
    amount_yen: number;
    monthly_cap_yen: number | null;
    recharged_this_month_yen: number;
    failures: number;
    max_failures: number;
  };
  topup: { min_yen: number; max_yen: number; quick_yen: number[]; credit_months: number };
  threshold: { min_yen: number; max_yen: number };
  /** Monthly cap on auto-recharge, in yen before tax. `null` = no cap. */
  spending_cap_yen: number | null;
  /** The auto-recharge monthly cap has been reached. */
  cap_reached: boolean;
  tax: 'excluded';
  tax_rate: number;
}

export interface TopupParams {
  /** Yen before tax, an integer from 500 to 300,000. */
  amount_yen: number;
}

export interface Topup {
  /** Stripe Checkout URL. Open it in a browser to pay. */
  url: string;
  amount_yen: number;
  tax_yen: number;
}

// 通話中の道具の署名の鍵

export interface ToolsSecret {
  /** `whsec_…`. Verify tool calls with it (`verifyToolCall`). */
  secret: string;
  /** After a rotation, tool calls are also signed with the previous secret until this time. `null` when not rotating. */
  previous_secret_expires_at: number | null;
}

export interface ToolTryParams {
  /** The tool: the `name` of a tool saved in `agent_id`'s agent, or a tool definition (before saving it). */
  tool: string | AgentTool;
  /**
   * Required when `tool` is a name. With a definition, the agent's stored API key is used when `auth.value` is left out.
   */
  agent_id?: string;
  /** Arguments for the tool. Default `{}`. */
  arguments?: Record<string, unknown>;
  /** Sent as `call.tenant`. Leave it out and `call.tenant` is `null`. */
  tenant_id?: string;
}

/** Why a tool test failed. Other strings may be added. */
export type ToolTryError =
  | 'unauthorized'
  | 'not_found'
  | 'upstream_error'
  | 'timeout'
  | 'invalid_arguments'
  | 'missing_api_key'
  | (string & {});

/** The outcome of `tools.try`. A failing tool is still a 200 response with `ok: false`. */
export interface ToolTryResult {
  /** The tool's `name`. */
  tool: string;
  ok: boolean;
  /** What the AI would get (when `ok`). */
  result?: unknown;
  /** When not `ok`. */
  error?: ToolTryError;
  message?: string;
  /** HTTP status of the tool's response; `null` when it did not respond. */
  status: number | null;
  /** The tool's response body, up to 10,000 characters; `null` when it did not respond. */
  body: string | null;
  /** `true` when `body` was cut at 10,000 characters. */
  truncated: boolean;
  duration_ms: number;
}

// 連携

export interface Connector {
  id: string;
  name: string;
  description: string;
  category: 'scheduling' | 'crm' | 'notify' | 'custom';
  auth: 'oauth2' | 'api_key' | 'webhook_url';
  available: boolean;
  needs_setup: boolean;
  notify: boolean;
  env_only: boolean;
  inputs: { name: string; type: 'text' | 'password' | 'url' | 'number' }[];
  actions: { name: string; tool: string; description: string; confirm: boolean }[];
}

export type ConnectionStatus = 'active' | 'needs_setup' | 'needs_reauth';

export interface Connection {
  id: string;
  connector: string;
  tenant_id: string | null;
  /** The account on the other side, such as `clinic@example.com`. */
  label: string;
  status: ConnectionStatus;
  config: Record<string, unknown>;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface ConnectionListParams {
  /** Omit for every connection, `null` for the environment's connections only, or a tenant ID. */
  tenant_id?: string | null;
}

export interface ConnectionCreateParams {
  /** `teams` or `http` (connectors set up with an API key or webhook URL). */
  connector: string;
  /** API key or webhook URL. Stored encrypted; never returned. */
  secret: string;
  input?: Record<string, string>;
  /** Omit (or `null`) for an environment connection. `http` is environment-only (422 with a tenant). */
  tenant_id?: string | null;
}

export interface ConnectionUpdateParams {
  config: Record<string, unknown>;
}

export interface ConnectLinkParams {
  /** Connectors to show. Default: every connector that is not `env_only`. */
  connectors?: string[];
  /** `https` origin of the page that embeds the link in an iframe. */
  frame_origin?: string;
}

/** A link valid for 15 minutes. */
export interface Link {
  url: string;
  expires_at: number;
}

export interface WebhookPortalParams {
  /** `https` origin of the page that embeds the portal in an iframe. */
  frame_origin?: string;
  /** Portal language. Default `ja`. */
  locale?: 'ja' | 'en';
}

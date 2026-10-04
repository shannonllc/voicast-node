import { VoicastError } from './errors';
import { type Fetch, Http } from './http';
import { Agents } from './resources/agents';
import { Billing } from './resources/billing';
import { Calls } from './resources/calls';
import { Connections, Connectors } from './resources/connections';
import { Sessions } from './resources/sessions';
import { Tenants } from './resources/tenants';
import { Tools } from './resources/tools';
import { Usage } from './resources/usage';
import { Webhooks } from './resources/webhooks';
import { readEnv } from './runtime';

export const DEFAULT_BASE_URL = 'https://api.voicast.jp';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
export const API_KEY_ENV = 'VOICAST_API_KEY';

export interface ClientOptions {
  /** Default `https://api.voicast.jp`. */
  baseUrl?: string;
  /** Milliseconds per attempt. Default 30000. */
  timeout?: number;
  /** Retries after the first attempt. Default 2. `0` disables retries. */
  maxRetries?: number;
  /** Custom `fetch`. Default `globalThis.fetch`. */
  fetch?: Fetch;
}

/** Client for the voicast API (`/v1`). Use it on your server only: never ship the API key to a browser or an app. */
export class Voicast {
  readonly agents: Agents;
  readonly tenants: Tenants;
  readonly calls: Calls;
  readonly sessions: Sessions;
  readonly usage: Usage;
  readonly connectors: Connectors;
  readonly connections: Connections;
  readonly webhooks: Webhooks;
  readonly billing: Billing;
  readonly tools: Tools;
  readonly baseUrl: string;

  /**
   * @param apiKey `vk_live_…` or `vk_test_…`. Defaults to the `VOICAST_API_KEY` environment variable.
   */
  constructor(apiKey?: string, options: ClientOptions = {}) {
    const key = apiKey ?? readEnv(API_KEY_ENV);
    if (!key) throw new VoicastError(`Missing API key. Pass it to new Voicast('vk_…') or set ${API_KEY_ENV}.`);
    const f = options.fetch ?? (globalThis as { fetch?: Fetch }).fetch;
    if (!f) throw new VoicastError('fetch is not available. Use Node.js 18 or later, or pass options.fetch.');
    const http = new Http({
      apiKey: key,
      baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      // 素の fetch を this なしで呼ぶと Workers などで Illegal invocation になる
      fetch: options.fetch ?? ((input, init) => f(input, init)),
    });
    this.baseUrl = http.config.baseUrl;
    this.agents = new Agents(http);
    this.tenants = new Tenants(http);
    this.calls = new Calls(http);
    this.sessions = new Sessions(http);
    this.usage = new Usage(http);
    this.connectors = new Connectors(http);
    this.connections = new Connections(http);
    this.webhooks = new Webhooks(http);
    this.billing = new Billing(http);
    this.tools = new Tools(http);
  }
}

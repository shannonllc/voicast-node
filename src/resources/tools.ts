import type { Http } from '../http';
import type { RequestOptions, ToolsSecret, ToolTryParams, ToolTryResult } from '../types';

/** Agent tools: the secret that signs in-call tool requests (`/v1/tools/secret`, one per environment), and tool tests. */
export class Tools {
  /** @internal */
  constructor(private readonly http: Http) {}

  /** Gets the signing secret (`whsec_…`) for `verifyToolCall`. */
  getSecret(options?: RequestOptions): Promise<ToolsSecret> {
    return this.http.request({ method: 'GET', path: '/v1/tools/secret', idempotent: true }, options);
  }

  /**
   * Creates a new signing secret. For 24 hours tool calls are signed with both the new and the previous secret,
   * so switch your server to the new one within that time. Not retried on a 5xx or a network error.
   */
  rotateSecret(options?: RequestOptions): Promise<ToolsSecret> {
    return this.http.request({ method: 'POST', path: '/v1/tools/secret/rotate', idempotent: false }, options);
  }

  /**
   * Calls an agent tool once, as during a call, and returns what it answered. Not billed and not recorded as a call.
   * Signed requests carry `test: true`, `call.channel: 'test'` and a `try_…` call id. Up to 30 per minute per environment.
   * Not retried on a 5xx or a network error (it calls your API).
   */
  try(params: ToolTryParams, options?: RequestOptions): Promise<ToolTryResult> {
    return this.http.request({ method: 'POST', path: '/v1/tools/try', body: params, idempotent: false }, options);
  }
}

import type { Http } from '../http';
import type { RequestOptions, Session, SessionCreateParams } from '../types';

/** Sessions for talking from a browser or an app over WebRTC (`/v1/sessions`). */
export class Sessions {
  /** @internal */
  constructor(private readonly http: Http) {}

  /**
   * Creates a session on your server. Pass only `client_token`, `webrtc_url` and `ice_servers` to the browser or app, never the API key.
   * The token expires in 2 minutes and can be used once. Throws `PaymentRequiredError` when calls are refused for billing.
   * Not retried on a 5xx or a network error.
   */
  create(params: SessionCreateParams, options?: RequestOptions): Promise<Session> {
    return this.http.request({ method: 'POST', path: '/v1/sessions', body: params, idempotent: false }, options);
  }
}

import type { Http } from '../http';
import type { Link, RequestOptions, WebhookPortalParams } from '../types';

/** Where webhooks (call.ended and others) are sent is set up by you on the webhook portal. */
export class Webhooks {
  /** @internal */
  constructor(private readonly http: Http) {}

  /** Creates a link (valid for 15 minutes) to the webhook portal: endpoints, event types and signing secrets. */
  createPortalLink(params: WebhookPortalParams = {}, options?: RequestOptions): Promise<Link> {
    return this.http.request({ method: 'POST', path: '/v1/webhooks/portal', body: params, idempotent: true }, options);
  }
}

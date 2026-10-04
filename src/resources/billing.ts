import type { Http } from '../http';
import type { Billing as BillingResult, RequestOptions, Topup, TopupParams } from '../types';

/** Your organization's billing (`/v1/billing`): balance, auto-recharge and per-minute price. Shared by live and test. */
export class Billing {
  /** @internal */
  constructor(private readonly http: Http) {}

  get(options?: RequestOptions): Promise<BillingResult> {
    return this.http.request({ method: 'GET', path: '/v1/billing', idempotent: true }, options);
  }

  /**
   * Creates a Stripe Checkout URL to top up the prepaid balance (500 to 300,000 yen before tax).
   * Open the URL in a browser to pay.
   */
  createTopup(params: TopupParams, options?: RequestOptions): Promise<Topup> {
    return this.http.request({ method: 'POST', path: '/v1/billing/topups', body: params, idempotent: false }, options);
  }
}

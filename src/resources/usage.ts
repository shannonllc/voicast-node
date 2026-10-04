import type { Http } from '../http';
import type { RequestOptions, UsageParams, Usage as UsageResult } from '../types';

/** Minutes used, for billing your own customers (`/v1/usage`). */
export class Usage {
  /** @internal */
  constructor(private readonly http: Http) {}

  /** Counts calls that ended in the period. Default: this month (Japan time) until now. */
  get(params: UsageParams = {}, options?: RequestOptions): Promise<UsageResult> {
    return this.http.request({ method: 'GET', path: '/v1/usage', query: { ...params }, idempotent: true }, options);
  }
}

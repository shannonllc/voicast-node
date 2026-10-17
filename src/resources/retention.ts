import type { Http } from '../http';
import type { RequestOptions, Retention as RetentionResult, RetentionUpdateParams } from '../types';

/**
 * How long call records and recordings are kept in the key's environment (`/v1/retention`): 1, 7, 14 or 30 days
 * (30 by default). Call records count from the end of the call, recordings from when they were saved.
 */
export class Retention {
  /** @internal */
  constructor(private readonly http: Http) {}

  get(options?: RequestOptions): Promise<RetentionResult> {
    return this.http.request({ method: 'GET', path: '/v1/retention', idempotent: true }, options);
  }

  /**
   * Changes the retention period (1, 7, 14 or 30 days). When shortened, call records and recordings past the new
   * period are deleted at the next daily cleanup and cannot be restored. Usage and billing do not change.
   */
  update(params: RetentionUpdateParams, options?: RequestOptions): Promise<RetentionResult> {
    return this.http.request({ method: 'PATCH', path: '/v1/retention', body: params, idempotent: true }, options);
  }
}

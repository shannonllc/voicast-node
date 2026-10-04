import type { Http } from '../http';
import { PagePromise } from '../pagination';
import type { Call, CallListParams, Page, RequestOptions, Transcript } from '../types';
import { id } from './path';

/** Calls (`/v1/calls`), newest first. */
export class Calls {
  /** @internal */
  constructor(private readonly http: Http) {}

  /**
   * Lists calls, newest first. `await` it for one page (`{ data, has_more, next_cursor }`),
   * or iterate with `for await` to walk every call (each next page is read with the previous page's `next_cursor`).
   */
  list(params: CallListParams = {}, options?: RequestOptions): PagePromise<Call> {
    return new PagePromise((cursor) =>
      this.http.request<Page<Call>>(
        // 2 ページ目からは cursor だけで読む（before は最初のページだけ）
        { method: 'GET', path: '/v1/calls', query: cursor ? { ...params, before: undefined, cursor } : { ...params }, idempotent: true },
        options,
      ),
    );
  }

  get(callId: string, options?: RequestOptions): Promise<Call> {
    return this.http.request({ method: 'GET', path: `/v1/calls/${id(callId)}`, idempotent: true }, options);
  }

  /** Gets a call by the provider's call ID: Twilio's CallSid, or the session `id` for Web calls. */
  getByProvider(providerCallId: string, options?: RequestOptions): Promise<Call> {
    return this.http.request({ method: 'GET', path: `/v1/calls/by-provider/${id(providerCallId)}`, idempotent: true }, options);
  }

  /** Gets the transcript. Throws `NotFoundError` when the call has none (`has_transcript: false`). */
  transcript(callId: string, options?: RequestOptions): Promise<Transcript> {
    return this.http.request({ method: 'GET', path: `/v1/calls/${id(callId)}/transcript`, idempotent: true }, options);
  }
}

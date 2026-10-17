// 再試行・打ち切り・エラーの種類・ページ送り・設定。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoff, MAX_RATE_LIMIT_WAIT_MS, rateLimitWait } from '../src/http';
import {
  ApiError,
  AuthenticationError,
  ConflictError,
  ConnectionError,
  NotFoundError,
  PagePromise,
  PaymentRequiredError,
  PermissionError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  VERSION,
  Voicast,
  VoicastError,
} from '../src/index';
import { client, empty, fakeFetch, hang, json } from './helpers';

const page = (data: unknown[] = [], has_more = false, next_cursor: string | null = null) => ({ data, has_more, next_cursor });
const call = (id: string, started_at: number) => ({ id, started_at });

/** 偽の時計で p を最後まで進める（再試行の待ちを飛ばす） */
async function settle<T>(p: PromiseLike<T>): Promise<{ value?: T; error?: unknown }> {
  const out = Promise.resolve(p).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return out;
}

describe('client options', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends Authorization, Accept and User-Agent with the SDK version; no body, no content-type on GET', async () => {
    const f = fakeFetch(json(200, page()));
    await client(f.fn).agents.list();
    expect(f.calls[0]!.headers).toEqual({
      authorization: 'Bearer vk_test_abc',
      accept: 'application/json',
      'user-agent': `voicast-node/${VERSION}`,
    });
    expect(f.calls[0]!.body).toBeUndefined();
  });

  it('sends JSON bodies with content-type', async () => {
    const f = fakeFetch(json(201, { id: 'agt_1' }));
    await client(f.fn).agents.create({ name: 'a', config: { greeting: 'g', persona: 'p', fields: [], handoff_when: [], closing: 'c' } });
    expect(f.calls[0]!.headers['content-type']).toBe('application/json');
    expect(f.calls[0]!.body).toMatchObject({ name: 'a' });
  });

  it('reads the API key from VOICAST_API_KEY', async () => {
    vi.stubEnv('VOICAST_API_KEY', 'vk_live_env');
    const f = fakeFetch(json(200, page()));
    await new Voicast(undefined, { fetch: f.fn }).agents.list();
    expect(f.calls[0]!.headers.authorization).toBe('Bearer vk_live_env');
  });

  it('throws without an API key', () => {
    vi.stubEnv('VOICAST_API_KEY', '');
    expect(() => new Voicast()).toThrow(VoicastError);
    expect(() => new Voicast('')).toThrow(/VOICAST_API_KEY/);
  });

  it('default base URL is https://api.voicast.jp, trailing slashes are removed', async () => {
    const f = fakeFetch(json(200, page()));
    const v = new Voicast('vk_test_x', { fetch: f.fn });
    expect(v.baseUrl).toBe('https://api.voicast.jp');
    await v.agents.list();
    expect(f.calls[0]!.url.href).toBe('https://api.voicast.jp/v1/agents');
    expect(new Voicast('vk_test_x', { baseUrl: 'http://localhost:8787//', fetch: f.fn }).baseUrl).toBe('http://localhost:8787');
  });

  it('uses globalThis.fetch by default, called without a this binding', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', function (this: unknown) {
      seen.push(this);
      return Promise.resolve(json(200, page()));
    });
    await new Voicast('vk_test_x').agents.list();
    expect(seen).toEqual([undefined]);
  });

  it('throws when fetch is not available', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => new Voicast('vk_test_x')).toThrow(/fetch is not available/);
  });
});

describe('errors', () => {
  const cases: [number, string, new (...a: never[]) => VoicastError][] = [
    [400, 'bad_json', ValidationError],
    [401, 'unauthorized', AuthenticationError],
    [402, 'balance_depleted', PaymentRequiredError],
    [403, 'forbidden', PermissionError],
    [404, 'not_found', NotFoundError],
    [409, 'in_use', ConflictError],
    [422, 'invalid_request', ValidationError],
    [418, 'teapot', ApiError],
  ];
  for (const [status, code, cls] of cases) {
    it(`${status} → ${cls.name}`, async () => {
      const f = fakeFetch(json(status, { error: code, message: `m ${status}` }, { 'cf-ray': 'ray-1' }));
      const e = (await client(f.fn)
        .calls.get('c')
        .catch((x) => x)) as VoicastError;
      expect(e).toBeInstanceOf(cls);
      expect(e).toBeInstanceOf(VoicastError);
      expect(e.name).toBe(cls.name);
      expect(e).toMatchObject({ status, code, message: `m ${status}`, requestId: 'ray-1', details: undefined });
      expect(f.calls).toHaveLength(1);
    });
  }

  it('422 carries details; x-request-id wins over cf-ray', async () => {
    const details = [{ path: 'config.voice', message: 'voice は声の ID' }];
    const f = fakeFetch(json(422, { error: 'invalid_config', message: 'bad', details }, { 'x-request-id': 'req_1', 'cf-ray': 'r' }));
    const e = (await client(f.fn)
      .tenants.create({ external_id: 'x' })
      .catch((x) => x)) as ValidationError;
    expect(e.details).toEqual(details);
    expect(e.code).toBe('invalid_config');
    expect(e.requestId).toBe('req_1');
  });

  it('a non-JSON error body falls back to HTTP <status>', async () => {
    const f = fakeFetch(new Response('<html>bad gateway</html>', { status: 502 }), new Response('null', { status: 400 }));
    const v = client(f.fn, { maxRetries: 0 });
    const e = (await v.calls.get('c').catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 502, code: undefined, message: 'HTTP 502', requestId: undefined });
    const e2 = (await v.calls.get('c').catch((x) => x)) as ValidationError;
    expect(e2).toMatchObject({ status: 400, message: 'HTTP 400' });
  });

  it('a JSON error body that is not an object, or with a non-string code, is ignored', async () => {
    const f = fakeFetch(new Response('"oops"', { status: 500 }), json(422, { error: 1, message: 2 }));
    const v = client(f.fn, { maxRetries: 0 });
    expect(await v.calls.get('c').catch((x) => x)).toMatchObject({ status: 500, code: undefined, message: 'HTTP 500' });
    expect(await v.calls.get('c').catch((x) => x)).toMatchObject({ status: 422, code: undefined, message: 'HTTP 422' });
  });

  it('invalid JSON in a 2xx response is an ApiError and is not retried', async () => {
    const f = fakeFetch(new Response('{oops', { status: 200, headers: { 'cf-ray': 'r2' } }));
    const e = (await client(f.fn)
      .calls.get('c')
      .catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 200, requestId: 'r2' });
    expect(e.message).toMatch(/Invalid JSON/);
    expect(f.calls).toHaveLength(1);
  });

  it('errors keep the cause', async () => {
    const boom = new TypeError('fetch failed');
    const f = fakeFetch(boom);
    const e = (await client(f.fn, { maxRetries: 0 })
      .calls.get('c')
      .catch((x) => x)) as ConnectionError;
    expect(e).toBeInstanceOf(ConnectionError);
    expect(e.cause).toBe(boom);
    expect(e.message).toBe('Connection error: fetch failed');
    expect(e.status).toBeUndefined();
  });

  it('error classes can be constructed directly', () => {
    const e = new RateLimitError('slow');
    expect(e).toMatchObject({ name: 'RateLimitError', message: 'slow', status: undefined, retryAfter: undefined });
    expect(new VoicastError('x').cause).toBeUndefined();
  });

  it('a non-Error rejection is still a ConnectionError', async () => {
    const f = fakeFetch(() => Promise.reject('down'));
    const e = await client(f.fn, { maxRetries: 0 })
      .calls.get('c')
      .catch((x) => x);
    expect(e).toBeInstanceOf(ConnectionError);
    expect(e.message).toBe('Connection error: down');
  });
});

describe('retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries 5xx with exponential backoff, then succeeds', async () => {
    const f = fakeFetch(json(500, { error: 'internal', message: 'x' }), json(503, {}), json(200, { id: 'call_1' }));
    const r = await settle(client(f.fn).calls.get('call_1'));
    expect(r.value).toEqual({ id: 'call_1' });
    expect(f.calls).toHaveLength(3);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const f = fakeFetch(json(500, { error: 'internal', message: 'down' }));
    const r = await settle(client(f.fn, { maxRetries: 3 }).calls.get('c'));
    expect(r.error).toBeInstanceOf(ApiError);
    expect(f.calls).toHaveLength(4);
  });

  it('a signal that is never aborted does not stop the retries', async () => {
    const f = fakeFetch(json(503, {}), json(200, { id: 'call_1' }));
    const r = await settle(client(f.fn).calls.get('call_1', { signal: new AbortController().signal }));
    expect(r.value).toEqual({ id: 'call_1' });
    expect(f.calls).toHaveLength(2);
  });

  it('maxRetries per request overrides the client', async () => {
    const f = fakeFetch(json(500, {}));
    await settle(client(f.fn, { maxRetries: 5 }).calls.get('c', { maxRetries: 0 }));
    expect(f.calls).toHaveLength(1);
  });

  it('retries network errors for safe requests (GET, PATCH, DELETE)', async () => {
    const f = fakeFetch(
      new TypeError('ECONNRESET'),
      json(200, { id: 'ten_1' }),
      new TypeError('ECONNRESET'),
      json(200, { id: 'sipc_1' }),
      new TypeError('ECONNRESET'),
      empty(204),
    );
    const v = client(f.fn);
    expect((await settle(v.tenants.update('ten_1', { name: 'n' }))).value).toEqual({ id: 'ten_1' });
    expect((await settle(v.tenants.updateSipCredential('ten_1', 'sipc_1', { transfer_to: '200' }))).value).toEqual({ id: 'sipc_1' });
    expect((await settle(v.tenants.delete('ten_1'))).value).toBeUndefined();
    expect(f.calls.map((c) => c.method)).toEqual(['PATCH', 'PATCH', 'PATCH', 'PATCH', 'DELETE', 'DELETE']);
  });

  it('does not retry 5xx or network errors for requests that are not safe to repeat', async () => {
    for (const reply of [json(500, {}), new TypeError('ECONNRESET')]) {
      const f = fakeFetch(reply);
      const v = client(f.fn);
      const config = { greeting: 'g', persona: 'p', fields: [], handoff_when: [], closing: 'c' };
      const ops: (() => Promise<unknown>)[] = [
        () => v.agents.create({ name: 'a', config }),
        () => v.agents.update('agt', { config }),
        () => v.tenants.create({ external_id: 'x' }),
        () => v.tenants.rotateSecret('ten'),
        () => v.tenants.createSipCredential('ten'),
        () => v.tools.try({ agent_id: 'agt', tool: 'find_slots' }),
        () => v.sessions.create({ tenant_id: 'ten' }),
        () => v.connections.create({ connector: 'teams', secret: 's' }),
      ];
      for (const op of ops) expect((await settle(op())).error).toBeInstanceOf(VoicastError);
      expect(f.calls).toHaveLength(ops.length);
    }
  });

  it('does not retry 4xx', async () => {
    for (const s of [400, 401, 402, 403, 404, 409, 422]) {
      const f = fakeFetch(json(s, { error: 'x', message: 'y' }));
      await settle(client(f.fn).calls.get('c'));
      expect(f.calls).toHaveLength(1);
    }
  });

  it('429 is retried for any request, waiting retry-after seconds', async () => {
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'slow down' }, { 'retry-after': '7' }), json(201, { id: 'sess_1' }));
    const p = client(f.fn).sessions.create({ tenant_id: 'ten' });
    await vi.advanceTimersByTimeAsync(6_999);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ id: 'sess_1' });
    expect(f.calls).toHaveLength(2);
  });

  it('429 with an HTTP-date retry-after waits until that time', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const at = new Date(Date.now() + 3000).toUTCString();
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'x' }, { 'retry-after': at }), json(200, { id: 'c' }));
    const p = client(f.fn).calls.get('c');
    await vi.advanceTimersByTimeAsync(2_999);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(f.calls).toHaveLength(2);
  });

  it('429 without retry-after waits until x-ratelimit-reset', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const reset = Math.floor(Date.now() / 1000) + 12;
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'x' }, { 'x-ratelimit-reset': String(reset) }), json(200, { id: 'c' }));
    const p = client(f.fn).calls.get('c');
    await vi.advanceTimersByTimeAsync(11_999);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(f.calls).toHaveLength(2);
  });

  it('429 without either header uses backoff', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'x' }), json(200, { id: 'c' }));
    const p = client(f.fn).calls.get('c');
    await vi.advanceTimersByTimeAsync(499);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(f.calls).toHaveLength(2);
  });

  it('429 is thrown as RateLimitError with retryAfter once retries run out', async () => {
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'x' }, { 'retry-after': '1' }));
    const r = await settle(client(f.fn, { maxRetries: 1 }).calls.get('c'));
    expect(r.error).toBeInstanceOf(RateLimitError);
    expect((r.error as RateLimitError).retryAfter).toBe(1);
    expect(f.calls).toHaveLength(2);
  });

  it('429 asking to wait longer than a minute is thrown at once', async () => {
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'x' }, { 'retry-after': '3600' }));
    const r = await settle(client(f.fn).calls.get('c'));
    expect(r.error).toBeInstanceOf(RateLimitError);
    expect(f.calls).toHaveLength(1);
  });
});

describe('timeout and abort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out each attempt, retries safe requests, then throws TimeoutError', async () => {
    const f = fakeFetch(hang);
    const r = await settle(client(f.fn, { timeout: 1000, maxRetries: 1 }).calls.get('c'));
    expect(r.error).toBeInstanceOf(TimeoutError);
    expect(r.error).toBeInstanceOf(ConnectionError);
    expect((r.error as Error).message).toBe('Request timed out after 1000 ms');
    expect(f.calls).toHaveLength(2);
  });

  it('timeout per request overrides the client; unsafe requests are not retried', async () => {
    const f = fakeFetch(hang);
    const r = await settle(client(f.fn, { timeout: 60_000 }).tenants.rotateSecret('ten', { timeout: 10 }));
    expect(r.error).toBeInstanceOf(TimeoutError);
    expect(f.calls).toHaveLength(1);
  });

  it('a body that stalls also times out', async () => {
    const f = fakeFetch((c) => {
      const body = new ReadableStream({
        start(ctrl) {
          c.signal.addEventListener('abort', () => ctrl.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(body, { status: 200 });
    });
    const r = await settle(client(f.fn, { timeout: 50, maxRetries: 0 }).calls.get('c'));
    expect(r.error).toBeInstanceOf(TimeoutError);
  });

  it('an aborted signal stops the request and is not retried', async () => {
    const f = fakeFetch(hang);
    const ctrl = new AbortController();
    const p = settle(client(f.fn).calls.get('c', { signal: ctrl.signal }));
    await Promise.resolve();
    ctrl.abort();
    const r = await p;
    expect(r.error).toBeInstanceOf(ConnectionError);
    expect(r.error).not.toBeInstanceOf(TimeoutError);
    expect((r.error as Error).message).toBe('Request was aborted');
    expect(f.calls).toHaveLength(1);
  });

  it('a signal aborted before the call never sends', async () => {
    const f = fakeFetch(hang);
    const r = await settle(client(f.fn).calls.get('c', { signal: AbortSignal.abort() }));
    expect((r.error as Error).message).toBe('Request was aborted');
    expect(f.calls).toHaveLength(0);
  });

  it('aborting during the wait between retries stops retrying', async () => {
    const f = fakeFetch(json(503, {}));
    const ctrl = new AbortController();
    const p = client(f.fn)
      .calls.get('c', { signal: ctrl.signal })
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(1);
    ctrl.abort(new Error('stop'));
    const e = await p;
    expect(e).toBeInstanceOf(ConnectionError);
    expect(e.cause).toEqual(new Error('stop'));
    expect(f.calls).toHaveLength(1);
  });

  it('an error after the signal was aborted (without abort reaching fetch) is not retried', async () => {
    const ctrl = new AbortController();
    const f = fakeFetch(() => {
      ctrl.abort();
      return Promise.resolve(json(503, {}));
    });
    const r = await settle(client(f.fn).calls.get('c', { signal: ctrl.signal }));
    expect(r.error).toBeInstanceOf(ApiError);
    expect(f.calls).toHaveLength(1);
  });
});

describe('pagination (calls.list)', () => {
  it('await gives the first page; for await walks every page using next_cursor', async () => {
    const f = fakeFetch(
      json(200, page([call('a', 30), call('b', 20)], true, '20.b')),
      json(200, page([call('c', 10)], true, '10.c')),
      json(200, page([], false)),
    );
    const list = client(f.fn).calls.list({ limit: 2, tenant_id: 'ten_1' });
    expect(list).toBeInstanceOf(PagePromise);
    const ids: string[] = [];
    for await (const c of list) ids.push(c.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(f.calls.map((c) => c.url.search)).toEqual([
      '?limit=2&tenant_id=ten_1',
      '?limit=2&tenant_id=ten_1&cursor=20.b',
      '?limit=2&tenant_id=ten_1&cursor=10.c',
    ]);
    // 1 ページ目はもう取ってあるので、await しても呼ばない
    expect((await list).data).toHaveLength(2);
    expect(f.calls).toHaveLength(3);
  });

  it('stops at has_more: false without another request', async () => {
    const f = fakeFetch(json(200, page([call('a', 5)], false)));
    const ids: string[] = [];
    for await (const c of client(f.fn).calls.list()) ids.push(c.id);
    expect(ids).toEqual(['a']);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url.search).toBe('');
  });

  it('stops on an empty page even if has_more is true (no endless loop)', async () => {
    const f = fakeFetch(json(200, page([], true, '1.x')));
    const ids: string[] = [];
    for await (const c of client(f.fn).calls.list()) ids.push(c.id);
    expect(ids).toEqual([]);
    expect(f.calls).toHaveLength(1);
  });

  it('stops when has_more is true but there is no next_cursor (an older server)', async () => {
    const f = fakeFetch(json(200, { data: [call('a', 5)], has_more: true }));
    const ids: string[] = [];
    for await (const c of client(f.fn).calls.list()) ids.push(c.id);
    expect(ids).toEqual(['a']);
    expect(f.calls).toHaveLength(1);
  });

  it('starts from the given before (then follows next_cursor only); errors reject the iterator', async () => {
    const f = fakeFetch(json(200, page([call('x', 99)], true, '99.x')), json(404, { error: 'not_found', message: 'gone' }));
    const it = client(f.fn, { maxRetries: 0 }).calls.list({ before: 100 });
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const c of it) got.push(c.id);
      })(),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(got).toEqual(['x']);
    expect(f.calls[0]!.url.search).toBe('?before=100');
    expect(f.calls[1]!.url.search).toBe('?cursor=99.x');
  });

  it('starts from the given cursor', async () => {
    const f = fakeFetch(json(200, page([call('y', 1)], false)));
    expect((await client(f.fn).calls.list({ cursor: '5.z', limit: 1 })).data).toHaveLength(1);
    expect(f.calls[0]!.url.search).toBe('?cursor=5.z&limit=1');
  });

  it('catch and finally work like a Promise', async () => {
    const f = fakeFetch(json(404, { error: 'not_found', message: 'no' }), json(200, page([call('a', 1)])));
    const v = client(f.fn);
    let done = 0;
    expect(await v.calls.list().catch((e: Error) => e.name)).toBe('NotFoundError');
    const p = await v.calls.list().finally(() => {
      done++;
    });
    expect(p.data).toEqual([call('a', 1)]);
    expect(done).toBe(1);
  });

  it('then forwards rejection handlers', async () => {
    const f = fakeFetch(json(401, { error: 'unauthorized', message: 'no' }));
    const r = await client(f.fn)
      .calls.list()
      .then(
        () => 'ok',
        (e: unknown) => (e as Error).name,
      );
    expect(r).toBe('AuthenticationError');
  });

  it('does not request anything until awaited or iterated', () => {
    const f = fakeFetch(json(200, page()));
    client(f.fn).calls.list();
    expect(f.calls).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('backoff doubles from 500 ms up to 8 s with ±25% jitter', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => backoff(n, () => 0.5))).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
    expect(backoff(0, () => 0)).toBe(375);
    expect(backoff(0, () => 1)).toBe(625);
    expect(backoff(1)).toBeGreaterThanOrEqual(750);
  });

  it('rateLimitWait', () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(rateLimitWait(h({ 'retry-after': '2' }), 0)).toBe(2000);
    expect(rateLimitWait(h({ 'retry-after': '0.4' }), 0)).toBe(400);
    expect(rateLimitWait(h({ 'retry-after': 'Thu, 01 Jan 1970 00:00:05 GMT' }), 1000)).toBe(4000);
    expect(rateLimitWait(h({ 'retry-after': 'Thu, 01 Jan 1970 00:00:05 GMT' }), 9000)).toBe(0);
    expect(rateLimitWait(h({ 'retry-after': 'soon', 'x-ratelimit-reset': '10' }), 4000)).toBe(6000);
    expect(rateLimitWait(h({ 'retry-after': '-3' }), 0)).toBe(0);
    expect(rateLimitWait(h({ 'x-ratelimit-reset': '1' }), 5000)).toBe(0);
    expect(rateLimitWait(h({ 'x-ratelimit-reset': 'x' }), 0)).toBeUndefined();
    expect(rateLimitWait(h({ 'retry-after': ' ' }))).toBeUndefined();
    expect(rateLimitWait(h({}))).toBeUndefined();
    expect(MAX_RATE_LIMIT_WAIT_MS).toBe(60_000);
  });

  it('empty responses resolve to undefined', async () => {
    const f = fakeFetch(empty(204));
    expect(await client(f.fn).agents.delete('agt')).toBeUndefined();
  });
});

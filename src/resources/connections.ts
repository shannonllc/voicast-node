import type { Http } from '../http';
import type {
  Connection,
  ConnectionCreateParams,
  ConnectionListParams,
  ConnectionUpdateParams,
  Connector,
  List,
  RequestOptions,
} from '../types';
import { id } from './path';

/** Connectors that can be connected (`/v1/connectors`). */
export class Connectors {
  /** @internal */
  constructor(private readonly http: Http) {}

  list(options?: RequestOptions): Promise<List<Connector>> {
    return this.http.request({ method: 'GET', path: '/v1/connectors', idempotent: true }, options);
  }
}

/** Connections to calendars, CRMs and chat (`/v1/connections`). */
export class Connections {
  /** @internal */
  constructor(private readonly http: Http) {}

  /** `tenant_id` omitted: every connection. `null`: the environment's connections only. A tenant ID: that tenant's. */
  list(params: ConnectionListParams = {}, options?: RequestOptions): Promise<List<Connection>> {
    const t = params.tenant_id;
    return this.http.request(
      { method: 'GET', path: '/v1/connections', query: { tenant_id: t === null ? '' : t }, idempotent: true },
      options,
    );
  }

  /**
   * Connects a connector set up with an API key or a webhook URL (`teams`, `http`).
   * OAuth connectors are connected by the business on the page from `tenants.createConnectLink()`. Not retried on a 5xx.
   */
  create(params: ConnectionCreateParams, options?: RequestOptions): Promise<Connection> {
    return this.http.request({ method: 'POST', path: '/v1/connections', body: params, idempotent: false }, options);
  }

  get(connectionId: string, options?: RequestOptions): Promise<Connection> {
    return this.http.request({ method: 'GET', path: `/v1/connections/${id(connectionId)}`, idempotent: true }, options);
  }

  /** Changes only the `config` fields given. A connection waiting for setup becomes `active`. */
  update(connectionId: string, params: ConnectionUpdateParams, options?: RequestOptions): Promise<Connection> {
    return this.http.request({ method: 'PATCH', path: `/v1/connections/${id(connectionId)}`, body: params, idempotent: true }, options);
  }

  /**
   * Reads the choices for the connection's settings from the connected service (calendars, sheets, apps, rooms; empty for http).
   * `query` is passed as is, such as `{ spreadsheet, sheet }` or `{ app }`.
   */
  options(
    connectionId: string,
    query: Record<string, string | undefined> = {},
    options?: RequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.http.request({ method: 'GET', path: `/v1/connections/${id(connectionId)}/options`, query, idempotent: true }, options);
  }

  /** Disconnects: revokes the tokens at the connected service and deletes the stored secret. */
  async delete(connectionId: string, options?: RequestOptions): Promise<void> {
    await this.http.request({ method: 'DELETE', path: `/v1/connections/${id(connectionId)}`, idempotent: true }, options);
  }
}

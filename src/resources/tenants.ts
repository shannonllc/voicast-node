import type { Http } from '../http';
import type {
  Connection,
  ConnectLinkParams,
  Link,
  List,
  RequestOptions,
  Tenant,
  TenantCreateParams,
  TenantSecret,
  TenantUpdateParams,
  TenantWithSecret,
} from '../types';
import { id } from './path';

/** Tenants: the businesses that actually take the calls (`/v1/tenants`). */
export class Tenants {
  /** @internal */
  constructor(private readonly http: Http) {}

  /**
   * Creates a tenant. The connection secret (`vts_…`) is returned only here.
   * Not retried on a 5xx or a network error (a retry would get 409 and lose the secret).
   */
  create(params: TenantCreateParams, options?: RequestOptions): Promise<TenantWithSecret> {
    return this.http.request({ method: 'POST', path: '/v1/tenants', body: params, idempotent: false }, options);
  }

  list(options?: RequestOptions): Promise<List<Tenant>> {
    return this.http.request({ method: 'GET', path: '/v1/tenants', idempotent: true }, options);
  }

  get(tenantId: string, options?: RequestOptions): Promise<Tenant> {
    return this.http.request({ method: 'GET', path: `/v1/tenants/${id(tenantId)}`, idempotent: true }, options);
  }

  /** Changes only the fields given. `agent_id: null` removes the tenant's agent. */
  update(tenantId: string, params: TenantUpdateParams, options?: RequestOptions): Promise<Tenant> {
    return this.http.request({ method: 'PATCH', path: `/v1/tenants/${id(tenantId)}`, body: params, idempotent: true }, options);
  }

  /** Issues a new connection secret. The previous one keeps working for 24 hours. Not retried on a 5xx. */
  rotateSecret(tenantId: string, options?: RequestOptions): Promise<TenantSecret> {
    return this.http.request({ method: 'POST', path: `/v1/tenants/${id(tenantId)}/secret`, idempotent: false }, options);
  }

  /** Deletes a tenant and revokes its connections. Its calls are kept. */
  async delete(tenantId: string, options?: RequestOptions): Promise<void> {
    await this.http.request({ method: 'DELETE', path: `/v1/tenants/${id(tenantId)}`, idempotent: true }, options);
  }

  /** Lists the tenant's connections. */
  listConnections(tenantId: string, options?: RequestOptions): Promise<List<Connection>> {
    return this.http.request({ method: 'GET', path: `/v1/tenants/${id(tenantId)}/connections`, idempotent: true }, options);
  }

  /**
   * Creates a link (valid for 15 minutes) to the page where the business connects its calendar, CRM or chat.
   * Open it in a new tab, or in an iframe on `frame_origin`.
   */
  createConnectLink(tenantId: string, params: ConnectLinkParams = {}, options?: RequestOptions): Promise<Link> {
    return this.http.request(
      { method: 'POST', path: `/v1/tenants/${id(tenantId)}/connect-links`, body: params, idempotent: true },
      options,
    );
  }
}

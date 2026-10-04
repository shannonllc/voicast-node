import type { Http } from '../http';
import type { Agent, AgentCreateParams, AgentUpdateParams, AgentVersion, AgentWithConfig, List, RequestOptions } from '../types';
import { id } from './path';

/** Agents: what the AI says and asks (`/v1/agents`). Every update adds a new version. */
export class Agents {
  /** @internal */
  constructor(private readonly http: Http) {}

  /** Creates an agent. Not retried on a 5xx or a network error (it could create two). */
  create(params: AgentCreateParams, options?: RequestOptions): Promise<AgentWithConfig> {
    return this.http.request({ method: 'POST', path: '/v1/agents', body: params, idempotent: false }, options);
  }

  /** Lists the agents of the environment, without `config`. */
  list(options?: RequestOptions): Promise<List<Agent>> {
    return this.http.request({ method: 'GET', path: '/v1/agents', idempotent: true }, options);
  }

  /** Gets an agent with its `config`. `version` defaults to the current version. */
  get(agentId: string, params: { version?: number } = {}, options?: RequestOptions): Promise<AgentWithConfig> {
    return this.http.request(
      { method: 'GET', path: `/v1/agents/${id(agentId)}`, query: { version: params.version }, idempotent: true },
      options,
    );
  }

  /**
   * Saves a new version. Calls in progress keep the version they started with.
   * Not retried on a 5xx or a network error (each request adds a version).
   */
  update(agentId: string, params: AgentUpdateParams, options?: RequestOptions): Promise<AgentWithConfig> {
    return this.http.request({ method: 'PUT', path: `/v1/agents/${id(agentId)}`, body: params, idempotent: false }, options);
  }

  /** Lists the versions of an agent, newest first. */
  versions(agentId: string, options?: RequestOptions): Promise<List<AgentVersion>> {
    return this.http.request({ method: 'GET', path: `/v1/agents/${id(agentId)}/versions`, idempotent: true }, options);
  }

  /** Deletes an agent. Throws `ConflictError` (`in_use`) while a tenant uses it. */
  async delete(agentId: string, options?: RequestOptions): Promise<void> {
    await this.http.request({ method: 'DELETE', path: `/v1/agents/${id(agentId)}`, idempotent: true }, options);
  }
}

// 各メソッドが API のリファレンスの呼び出し（メソッド・パス・クエリ・本文）になること。
import { describe, expect, it } from 'vitest';
import type { AgentConfig, Voicast } from '../src/index';
import { client, empty, fakeFetch, json } from './helpers';

const config: AgentConfig = {
  greeting: 'お電話ありがとうございます',
  persona: '丁寧に',
  fields: [{ key: 'name', label: 'お名前', required: true }],
  handoff_when: ['怒っている'],
  closing: '承りました',
  voice: 'female-firm',
  speaking_rate: 1.15,
  tools: [
    { name: 'find_slots', description: '空きを探す', url: 'https://tools.example.com/voicast' },
    { name: 'book', description: '予約する', url: 'https://tools.example.com/voicast', confirm: true },
    {
      name: 'lookup',
      description: '顧客を探す',
      url: 'https://api.example.com/customers',
      method: 'GET',
      sign: false,
      auth: { type: 'api_key', header: 'Authorization', value: 'sk_123456789012' },
      parameters: { properties: { phone: { type: 'string' } }, required: ['phone'] },
    },
  ],
  connectors: [
    { connector: 'google_calendar', actions: ['find_free_slots'] },
    { connection: 'con_1', actions: ['search', 'create'] },
  ],
};

type Case = {
  name: string;
  run: (v: Voicast) => Promise<unknown>;
  method: string;
  path: string;
  search?: string;
  body?: unknown;
  status?: number;
};

const cases: Case[] = [
  {
    name: 'agents.create',
    run: (v) => v.agents.create({ name: 'a', config }),
    method: 'POST',
    path: '/v1/agents',
    body: { name: 'a', config },
    status: 201,
  },
  { name: 'agents.list', run: (v) => v.agents.list(), method: 'GET', path: '/v1/agents' },
  { name: 'agents.get', run: (v) => v.agents.get('agt_1'), method: 'GET', path: '/v1/agents/agt_1' },
  {
    name: 'agents.get version',
    run: (v) => v.agents.get('agt_1', { version: 3 }),
    method: 'GET',
    path: '/v1/agents/agt_1',
    search: '?version=3',
  },
  { name: 'agents.update', run: (v) => v.agents.update('agt_1', { config }), method: 'PUT', path: '/v1/agents/agt_1', body: { config } },
  { name: 'agents.versions', run: (v) => v.agents.versions('agt_1'), method: 'GET', path: '/v1/agents/agt_1/versions' },
  { name: 'agents.delete', run: (v) => v.agents.delete('agt_1'), method: 'DELETE', path: '/v1/agents/agt_1', status: 204 },
  {
    name: 'tenants.create',
    run: (v) => v.tenants.create({ external_id: 'clinic-1', name: 'n', agent_id: 'agt_1' }),
    method: 'POST',
    path: '/v1/tenants',
    body: { external_id: 'clinic-1', name: 'n', agent_id: 'agt_1' },
    status: 201,
  },
  { name: 'tenants.list', run: (v) => v.tenants.list(), method: 'GET', path: '/v1/tenants' },
  { name: 'tenants.get', run: (v) => v.tenants.get('ten_1'), method: 'GET', path: '/v1/tenants/ten_1' },
  {
    name: 'tenants.update',
    run: (v) => v.tenants.update('ten_1', { agent_id: null, status: 'disabled' }),
    method: 'PATCH',
    path: '/v1/tenants/ten_1',
    body: { agent_id: null, status: 'disabled' },
  },
  { name: 'tenants.rotateSecret', run: (v) => v.tenants.rotateSecret('ten_1'), method: 'POST', path: '/v1/tenants/ten_1/secret' },
  { name: 'tenants.delete', run: (v) => v.tenants.delete('ten_1'), method: 'DELETE', path: '/v1/tenants/ten_1', status: 204 },
  { name: 'tenants.listConnections', run: (v) => v.tenants.listConnections('ten_1'), method: 'GET', path: '/v1/tenants/ten_1/connections' },
  {
    name: 'tenants.createConnectLink',
    run: (v) => v.tenants.createConnectLink('ten_1', { connectors: ['google_calendar'], frame_origin: 'https://app.example.com' }),
    method: 'POST',
    path: '/v1/tenants/ten_1/connect-links',
    body: { connectors: ['google_calendar'], frame_origin: 'https://app.example.com' },
    status: 201,
  },
  {
    name: 'tenants.createConnectLink (no params)',
    run: (v) => v.tenants.createConnectLink('ten_1'),
    method: 'POST',
    path: '/v1/tenants/ten_1/connect-links',
    body: {},
    status: 201,
  },
  {
    name: 'tenants.createSipCredential',
    run: (v) => v.tenants.createSipCredential('ten_1', { name: '本院の PBX', agent_id: 'agt_1', transfer_to: '200' }),
    method: 'POST',
    path: '/v1/tenants/ten_1/sip-credentials',
    body: { name: '本院の PBX', agent_id: 'agt_1', transfer_to: '200' },
    status: 201,
  },
  {
    name: 'tenants.createSipCredential (no params)',
    run: (v) => v.tenants.createSipCredential('ten_1'),
    method: 'POST',
    path: '/v1/tenants/ten_1/sip-credentials',
    body: {},
    status: 201,
  },
  {
    name: 'tenants.listSipCredentials',
    run: (v) => v.tenants.listSipCredentials('ten_1'),
    method: 'GET',
    path: '/v1/tenants/ten_1/sip-credentials',
  },
  {
    name: 'tenants.updateSipCredential (encoded)',
    run: (v) => v.tenants.updateSipCredential('ten_1', 'sipc/1', { agent_id: null, transfer_to: 'sip:200@pbx.example.com' }),
    method: 'PATCH',
    path: '/v1/tenants/ten_1/sip-credentials/sipc%2F1',
    body: { agent_id: null, transfer_to: 'sip:200@pbx.example.com' },
  },
  {
    name: 'tenants.deleteSipCredential (encoded)',
    run: (v) => v.tenants.deleteSipCredential('ten_1', 'sipc/1'),
    method: 'DELETE',
    path: '/v1/tenants/ten_1/sip-credentials/sipc%2F1',
    status: 204,
  },
  { name: 'calls.get', run: (v) => v.calls.get('call_1'), method: 'GET', path: '/v1/calls/call_1' },
  {
    name: 'calls.getByProvider (encoded)',
    run: (v) => v.calls.getByProvider('CA/1 2'),
    method: 'GET',
    path: '/v1/calls/by-provider/CA%2F1%202',
  },
  { name: 'calls.transcript', run: (v) => v.calls.transcript('call_1'), method: 'GET', path: '/v1/calls/call_1/transcript' },
  {
    name: 'sessions.create',
    run: (v) => v.sessions.create({ tenant_id: 'ten_1', output: 'text' }),
    method: 'POST',
    path: '/v1/sessions',
    body: { tenant_id: 'ten_1', output: 'text' },
    status: 201,
  },
  { name: 'usage.get', run: (v) => v.usage.get(), method: 'GET', path: '/v1/usage', search: '' },
  {
    name: 'usage.get with params',
    run: (v) => v.usage.get({ from: '2026-10-01', to: 1790000000000, group_by: 'tenant' }),
    method: 'GET',
    path: '/v1/usage',
    search: '?from=2026-10-01&to=1790000000000&group_by=tenant',
  },
  {
    name: 'usage.get with filters',
    run: (v) => v.usage.get({ group_by: 'tenant', channel: 'phone', tenant_id: 'ten_1', external_id: 'clinic-1' }),
    method: 'GET',
    path: '/v1/usage',
    search: '?group_by=tenant&channel=phone&tenant_id=ten_1&external_id=clinic-1',
  },
  { name: 'connectors.list', run: (v) => v.connectors.list(), method: 'GET', path: '/v1/connectors' },
  { name: 'connections.list', run: (v) => v.connections.list(), method: 'GET', path: '/v1/connections', search: '' },
  {
    name: 'connections.list environment only',
    run: (v) => v.connections.list({ tenant_id: null }),
    method: 'GET',
    path: '/v1/connections',
    search: '?tenant_id=',
  },
  {
    name: 'connections.list tenant',
    run: (v) => v.connections.list({ tenant_id: 'ten_1' }),
    method: 'GET',
    path: '/v1/connections',
    search: '?tenant_id=ten_1',
  },
  {
    name: 'connections.create',
    run: (v) => v.connections.create({ connector: 'http', secret: 'k', input: { base_url: 'https://x', header: 'X-API-Key' } }),
    method: 'POST',
    path: '/v1/connections',
    body: { connector: 'http', secret: 'k', input: { base_url: 'https://x', header: 'X-API-Key' } },
    status: 201,
  },
  { name: 'connections.get', run: (v) => v.connections.get('con_1'), method: 'GET', path: '/v1/connections/con_1' },
  {
    name: 'connections.update',
    run: (v) => v.connections.update('con_1', { config: { calendar_id: 'primary' } }),
    method: 'PATCH',
    path: '/v1/connections/con_1',
    body: { config: { calendar_id: 'primary' } },
  },
  {
    name: 'connections.options',
    run: (v) => v.connections.options('con_1'),
    method: 'GET',
    path: '/v1/connections/con_1/options',
    search: '',
  },
  {
    name: 'connections.options with query',
    run: (v) => v.connections.options('con_1', { spreadsheet: 's1', sheet: undefined }),
    method: 'GET',
    path: '/v1/connections/con_1/options',
    search: '?spreadsheet=s1',
  },
  { name: 'connections.delete', run: (v) => v.connections.delete('con_1'), method: 'DELETE', path: '/v1/connections/con_1', status: 204 },
  {
    name: 'webhooks.createPortalLink',
    run: (v) => v.webhooks.createPortalLink({ frame_origin: 'https://app.example.com' }),
    method: 'POST',
    path: '/v1/webhooks/portal',
    body: { frame_origin: 'https://app.example.com' },
    status: 201,
  },
  {
    name: 'webhooks.createPortalLink (locale)',
    run: (v) => v.webhooks.createPortalLink({ locale: 'en' }),
    method: 'POST',
    path: '/v1/webhooks/portal',
    body: { locale: 'en' },
    status: 201,
  },
  { name: 'billing.get', run: (v) => v.billing.get(), method: 'GET', path: '/v1/billing' },
  {
    name: 'billing.createTopup',
    run: (v) => v.billing.createTopup({ amount_yen: 3000 }),
    method: 'POST',
    path: '/v1/billing/topups',
    body: { amount_yen: 3000 },
    status: 201,
  },
  { name: 'retention.get', run: (v) => v.retention.get(), method: 'GET', path: '/v1/retention' },
  {
    name: 'retention.update',
    run: (v) => v.retention.update({ retention_days: 7 }),
    method: 'PATCH',
    path: '/v1/retention',
    body: { retention_days: 7 },
  },
  { name: 'tools.getSecret', run: (v) => v.tools.getSecret(), method: 'GET', path: '/v1/tools/secret' },
  { name: 'tools.rotateSecret', run: (v) => v.tools.rotateSecret(), method: 'POST', path: '/v1/tools/secret/rotate' },
  {
    name: 'tools.try (saved tool)',
    run: (v) => v.tools.try({ agent_id: 'agt_1', tool: 'find_slots', arguments: { date: '2026-10-05' }, tenant_id: 'ten_1' }),
    method: 'POST',
    path: '/v1/tools/try',
    body: { agent_id: 'agt_1', tool: 'find_slots', arguments: { date: '2026-10-05' }, tenant_id: 'ten_1' },
  },
  {
    name: 'tools.try (definition)',
    run: (v) => v.tools.try({ tool: config.tools![2]! }),
    method: 'POST',
    path: '/v1/tools/try',
    body: { tool: config.tools![2] },
  },
  {
    name: 'webhooks.createPortalLink (no params)',
    run: (v) => v.webhooks.createPortalLink(),
    method: 'POST',
    path: '/v1/webhooks/portal',
    body: {},
    status: 201,
  },
];

describe('resources', () => {
  for (const c of cases) {
    it(`${c.name} → ${c.method} ${c.path}${c.search ?? ''}`, async () => {
      const reply = c.status === 204 ? empty(204) : json(c.status ?? 200, { ok: c.name });
      const f = fakeFetch(reply);
      const out = await c.run(client(f.fn));
      expect(f.calls).toHaveLength(1);
      const call = f.calls[0]!;
      expect(call.method).toBe(c.method);
      expect(call.url.pathname).toBe(c.path);
      expect(call.url.search).toBe(c.search ?? '');
      expect(call.body).toEqual(c.body);
      expect(out).toEqual(c.status === 204 ? undefined : { ok: c.name });
    });
  }

  it('passes request options through (timeout per call)', async () => {
    const f = fakeFetch(json(200, { data: [] }));
    await client(f.fn).agents.list({ timeout: 5 });
    expect(f.calls).toHaveLength(1);
  });
});

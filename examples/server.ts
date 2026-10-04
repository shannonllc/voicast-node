// サーバーの例（依存なし、node:http）。セッションを作ってブラウザに渡し、Webhook と通話中の道具を受ける。
//   VOICAST_API_KEY=vk_test_... VOICAST_WEBHOOK_SECRET=whsec_... VOICAST_TOOLS_SECRET=whsec_... TENANT_ID=ten_... npx tsx examples/server.ts
// 公開した後は import { ... } from 'voicast' と書く。
import { createServer, type IncomingMessage } from 'node:http';
import { Voicast, verifyToolCall, verifyWebhook, WebhookVerificationError } from '../src/index';

const voicast = new Voicast(); // VOICAST_API_KEY
const env = (name: string) => process.env[name] ?? '';

async function rawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  const send = (status: number, body?: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  try {
    // ブラウザが呼ぶ。client_token・webrtc_url・ice_servers だけを返す（API キーは渡さない）
    if (req.method === 'POST' && req.url === '/session') {
      const s = await voicast.sessions.create({ tenant_id: env('TENANT_ID') });
      return send(200, { client_token: s.client_token, webrtc_url: s.webrtc_url, ice_servers: s.ice_servers, session_id: s.id });
    }
    // 通話後の知らせ
    if (req.method === 'POST' && req.url === '/webhooks/voicast') {
      const event = await verifyWebhook(await rawBody(req), req.headers, env('VOICAST_WEBHOOK_SECRET'));
      if (event.type === 'call.summary_ready') console.log(`[${event.data.tenant.external_id}] ${event.data.summary}`);
      return send(204);
    }
    // 通話中の道具（会話の設定の tools[].url をここに向ける）
    if (req.method === 'POST' && req.url === '/voicast/tools') {
      const call = await verifyToolCall<{ date?: string }>(await rawBody(req), req.headers, env('VOICAST_TOOLS_SECRET'));
      if (call.tool === 'find_free_slots') return send(200, { slots: ['10:00', '14:30'], date: call.arguments.date });
      return send(200, { ok: false, error: `unknown tool ${call.tool}` });
    }
    send(404, { error: 'not_found' });
  } catch (e) {
    if (e instanceof WebhookVerificationError) return send(400, { error: 'invalid_signature' });
    console.error(e);
    send(500, { error: 'internal' });
  }
}).listen(3000, () => console.log('http://localhost:3000'));

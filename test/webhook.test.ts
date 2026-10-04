// Standard Webhooks の検証（voicast の Webhook と、通話中の道具の呼び出し）。
// 署名は node:crypto の HMAC で別に作り（apps/voice/tools.py の sign と同じ手順）、SDK の検証と突き合わせる。
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ToolCallRequest,
  VoicastError,
  type VoicastEvent,
  verifyToolCall,
  verifyWebhook,
  Webhook,
  WebhookVerificationError,
} from '../src/index';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const OTHER = 'whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oD';

/** tools.py の sign と同じ: 鍵ごとに v1,<base64(HMAC-SHA256)> を空白で並べる */
function pySign(secrets: string[], id: string, ts: number, body: string): string {
  return secrets
    .map(
      (s) =>
        `v1,${createHmac('sha256', Buffer.from(s.replace(/^whsec_/, ''), 'base64'))
          .update(`${id}.${ts}.${body}`)
          .digest('base64')}`,
    )
    .join(' ');
}

const now = () => Math.floor(Date.now() / 1000);

function signed(body: string, secrets: string[] = [SECRET], ts = now(), id = 'msg_1') {
  return { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': pySign(secrets, id, ts, body) };
}

const event = JSON.stringify({
  type: 'call.ended',
  timestamp: '2026-10-03T00:00:00.000Z',
  data: { id: 'call_1', outcome: 'completed', tenant: { id: 'ten_1', external_id: 'clinic-1' } },
});

const toolCall = JSON.stringify({
  type: 'tool.call',
  tool: 'find_slots',
  tool_call_id: 'tc_1',
  arguments: { date: '2026-10-04' },
  call: { id: 'call_1', channel: 'phone', provider_call_id: 'CA1', from: '+81312345678', tenant: { id: 'ten_1', external_id: 'clinic-1' } },
});

afterEach(() => {
  vi.useRealTimers();
});

describe('verifyWebhook', () => {
  it('returns the typed event; narrowing on type gives data', async () => {
    const e: VoicastEvent = await verifyWebhook(event, signed(event), SECRET);
    expect(e.type).toBe('call.ended');
    if (e.type === 'call.ended') expect(e.data.tenant.external_id).toBe('clinic-1');
  });

  it('accepts Buffer, Uint8Array, ArrayBuffer and Headers', async () => {
    const h = signed(event);
    const buf = Buffer.from(event);
    expect((await verifyWebhook(buf, h, SECRET)).type).toBe('call.ended');
    expect((await verifyWebhook(new Uint8Array(buf), new Headers(h), SECRET)).type).toBe('call.ended');
    const ab = new TextEncoder().encode(event).buffer as ArrayBuffer;
    expect((await verifyWebhook(ab, h, SECRET)).type).toBe('call.ended');
  });

  it('header names are case-insensitive; array values use the first', async () => {
    const h = signed(event);
    const upper = {
      'Webhook-Id': h['webhook-id'],
      'WEBHOOK-TIMESTAMP': [h['webhook-timestamp'], 'x'],
      'Webhook-Signature': h['webhook-signature'],
    };
    expect((await verifyWebhook(event, upper, SECRET)).type).toBe('call.ended');
  });

  it('a Headers object without the signature headers is rejected', async () => {
    await expect(verifyWebhook(event, new Headers(), SECRET)).rejects.toThrow('Missing required headers');
  });

  it('a body that is not a voicast event is rejected', async () => {
    for (const body of ['[]', '"x"', 'null', '{"type":1,"data":{}}', '{"type":"call.ended"}']) {
      await expect(verifyWebhook(body, signed(body), SECRET)).rejects.toThrow(/not a voicast event/);
    }
  });

  it('accepts several secrets (while switching) and either signature', async () => {
    expect((await verifyWebhook(event, signed(event, [OTHER]), [SECRET, OTHER])).type).toBe('call.ended');
    // 送る側が 2 つの鍵で署名（作り直してから 24 時間）。受ける側はどちらの鍵でも通る
    const both = signed(event, [OTHER, SECRET]);
    expect((await verifyWebhook(event, both, SECRET)).type).toBe('call.ended');
    expect((await verifyWebhook(event, both, OTHER)).type).toBe('call.ended');
  });
});

describe('verifyToolCall', () => {
  it('returns the tool call with typed arguments', async () => {
    const t: ToolCallRequest<{ date: string }> = await verifyToolCall<{ date: string }>(toolCall, signed(toolCall), SECRET);
    expect(t).toMatchObject({ tool: 'find_slots', tool_call_id: 'tc_1', arguments: { date: '2026-10-04' } });
    expect(t.call.tenant?.id).toBe('ten_1');
    expect(t.test).toBeUndefined();
  });

  it('returns a test call (tools.try) with test: true and no tenant', async () => {
    const body = JSON.stringify({
      type: 'tool.call',
      tool: 'find_slots',
      tool_call_id: 'try_1',
      arguments: {},
      call: { id: 'try_1', channel: 'test', provider_call_id: null, from: null, tenant: null },
      test: true,
    });
    const t = await verifyToolCall(body, signed(body), SECRET);
    expect(t.test).toBe(true);
    expect(t.call.channel).toBe('test');
    expect(t.call.tenant).toBeNull();
  });

  it('rejects a body that is not a tool call (such as a webhook event signed with the same secret)', async () => {
    const bodies = [
      event,
      '[]',
      '{"type":"tool.call","tool":1,"call":{}}',
      '{"type":"tool.call","tool":"x","call":null}',
      '{"type":"tool.call","tool":"x"}',
    ];
    for (const body of bodies) {
      await expect(verifyToolCall(body, signed(body), SECRET)).rejects.toThrow(/not a voicast tool call/);
    }
  });

  it('rejects a tool call signed with another secret', async () => {
    await expect(verifyToolCall(toolCall, signed(toolCall, [OTHER]), SECRET)).rejects.toThrow('No matching signature found');
  });
});

describe('Webhook.verify', () => {
  it('sign() produces what tools.py produces, and verify() accepts it', async () => {
    const wh = new Webhook(SECRET);
    const ts = now();
    const sig = await wh.sign('msg_2', ts, toolCall);
    expect(sig).toBe(pySign([SECRET], 'msg_2', ts, toolCall));
    expect(await wh.sign('msg_2', new Date(ts * 1000 + 999), toolCall)).toBe(sig);
    expect(await wh.verify(toolCall, { 'webhook-id': 'msg_2', 'webhook-timestamp': String(ts), 'webhook-signature': sig })).toMatchObject({
      tool: 'find_slots',
    });
  });

  it('secrets without the whsec_ prefix work', async () => {
    const raw = SECRET.slice('whsec_'.length);
    expect(await new Webhook(raw).verify(event, signed(event))).toMatchObject({ type: 'call.ended' });
  });

  it('error messages for malformed headers and signatures', async () => {
    const wh = new Webhook(SECRET);
    const h = signed(event);
    const fail = (headers: Record<string, string>, body = event) => wh.verify(body, headers).catch((e: Error) => e);
    const cases: [Record<string, string>, string][] = [
      [{ ...h, 'webhook-id': '' }, 'Missing required headers'],
      [{ 'webhook-timestamp': h['webhook-timestamp'], 'webhook-signature': h['webhook-signature'] }, 'Missing required headers'],
      [{ ...h, 'webhook-timestamp': '' }, 'Missing required headers'],
      [{ ...h, 'webhook-signature': '' }, 'Missing required headers'],
      [{ ...h, 'webhook-timestamp': '12.5' }, 'Invalid webhook-timestamp header'],
      [{ ...h, 'webhook-timestamp': '-1' }, 'Invalid webhook-timestamp header'],
      [{ ...h, 'webhook-timestamp': '99999999999999999999' }, 'Invalid webhook-timestamp header'],
      [{ ...h, 'webhook-signature': 'v1' }, 'No matching signature found'],
      [{ ...h, 'webhook-signature': 'v1,' }, 'No matching signature found'],
      [{ ...h, 'webhook-signature': 'v2,abc' }, 'No matching signature found'],
      [{ ...h, 'webhook-signature': 'v1,!!!not-base64!!!' }, 'No matching signature found'],
      [{ ...h, 'webhook-signature': `v1a ${h['webhook-signature'].replace('v1,', 'v1,AAAA')}` }, 'No matching signature found'],
      [{ ...h, 'webhook-id': 'msg_other' }, 'No matching signature found'],
    ];
    for (const [headers, msg] of cases) {
      const e = await fail(headers);
      expect(e, msg).toBeInstanceOf(WebhookVerificationError);
      expect(e).toBeInstanceOf(VoicastError);
      expect((e as Error).message).toBe(msg);
    }
    expect(((await fail(h, `${event} `)) as Error).message).toBe('No matching signature found');
  });

  it('a garbage signature before the valid one is skipped', async () => {
    const h = signed(event);
    const headers = { ...h, 'webhook-signature': `v1,!!! v1,AAAA ${h['webhook-signature']}` };
    expect(await new Webhook(SECRET).verify(event, headers)).toMatchObject({ type: 'call.ended' });
  });

  it('a payload that is not the raw body is rejected', async () => {
    const wh = new Webhook(SECRET);
    await expect(wh.verify(JSON.parse(event), signed(event))).rejects.toThrow(/raw request body/);
    await expect(wh.sign('m', 1, {} as never)).rejects.toThrow(WebhookVerificationError);
  });

  it('a signed body that is not JSON', async () => {
    const e = await new Webhook(SECRET).verify('not json', signed('not json')).catch((x: Error) => x);
    expect(e).toBeInstanceOf(WebhookVerificationError);
    expect((e as Error).message).toBe('Payload is not valid JSON');
    expect((e as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it('tolerance defaults to 5 minutes both ways, inclusive, and is configurable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
    const t = now();
    const wh = new Webhook(SECRET);
    await expect(wh.verify(event, signed(event, [SECRET], t - 300))).resolves.toBeTruthy();
    await expect(wh.verify(event, signed(event, [SECRET], t + 300))).resolves.toBeTruthy();
    await expect(wh.verify(event, signed(event, [SECRET], t - 301))).rejects.toThrow('Message timestamp too old');
    await expect(wh.verify(event, signed(event, [SECRET], t + 301))).rejects.toThrow('Message timestamp too new');
    const strict = new Webhook(SECRET, { tolerance: 10 });
    await expect(strict.verify(event, signed(event, [SECRET], t - 11))).rejects.toThrow('too old');
    await expect(verifyWebhook(event, signed(event, [SECRET], t - 1000), SECRET, { tolerance: 3600 })).resolves.toBeTruthy();
    await expect(verifyToolCall(toolCall, signed(toolCall, [SECRET], t - 1000), SECRET, { tolerance: 3600 })).resolves.toBeTruthy();
  });

  it('checks the secret', () => {
    expect(() => new Webhook('')).toThrow('Webhook secret is required');
    expect(() => new Webhook([])).toThrow('Webhook secret is required');
    expect(() => new Webhook(undefined as never)).toThrow('Webhook secret is required');
    expect(() => new Webhook('whsec_***')).toThrow(/not valid base64/);
    expect(() => new Webhook([SECRET, ''])).toThrow(VoicastError);
  });

  it('imports the keys once', async () => {
    const spy = vi.spyOn(crypto.subtle, 'importKey');
    const wh = new Webhook([SECRET, OTHER]);
    await wh.verify(event, signed(event));
    await wh.verify(event, signed(event));
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

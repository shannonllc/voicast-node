// voicast/web: ブラウザの WebRTC（RTCPeerConnection・データチャンネル・マイク・audio）を偽物にして、手順と RTVI の受け方を確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startVoiceSession,
  VoiceSession,
  VoiceSessionError,
  type VoiceSessionEvents,
  type VoiceSessionOptions,
  waitIceGathering,
} from '../src/web';

class FakeTrack {
  enabled = true;
  stop = vi.fn();
  constructor(readonly kind: 'audio' | 'video') {}
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[] = [new FakeTrack('audio')]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}

class FakeDC {
  readyState: RTCDataChannelState = 'connecting';
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  throwOnClose = false;
  constructor(
    readonly label: string,
    readonly init: unknown,
  ) {}
  send(s: string) {
    this.sent.push(s);
  }
  open() {
    this.readyState = 'open';
    this.onopen?.();
  }
  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data) });
  }
  close() {
    this.readyState = 'closed';
    if (this.throwOnClose) throw new Error('already closing');
  }
}

class FakePC {
  static last: FakePC;
  static gathering: RTCIceGatheringState = 'complete';
  static throwOnClose = false;
  transceivers: [unknown, unknown][] = [];
  localDescription: { type: string; sdp: string } | null = null;
  remote: { type: string; sdp?: string }[] = [];
  iceGatheringState: RTCIceGatheringState = FakePC.gathering;
  connectionState: RTCPeerConnectionState = 'new';
  ontrack: ((e: unknown) => void) | null = null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  dc: FakeDC | undefined;
  listeners = new Set<() => void>();
  offers = 0;
  closed = false;
  constructor(readonly config: RTCConfiguration) {
    FakePC.last = this;
  }
  addTransceiver(track: unknown, init: unknown) {
    this.transceivers.push([track, init]);
  }
  createDataChannel(label: string, init: unknown) {
    this.dc = new FakeDC(label, init);
    return this.dc;
  }
  async createOffer() {
    this.offers += 1;
    return { type: 'offer', sdp: `offer-${this.offers}` };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: { type: string; sdp?: string }) {
    this.remote.push(d);
  }
  addEventListener(_: string, fn: () => void) {
    this.listeners.add(fn);
  }
  removeEventListener(_: string, fn: () => void) {
    this.listeners.delete(fn);
  }
  setGathering(s: RTCIceGatheringState) {
    this.iceGatheringState = s;
    for (const l of [...this.listeners]) l();
  }
  setState(s: RTCPeerConnectionState) {
    this.connectionState = s;
    this.onconnectionstatechange?.();
  }
  candidate(c: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null) {
    this.onicecandidate?.({ candidate: c });
  }
  close() {
    this.closed = true;
    if (FakePC.throwOnClose) throw new Error('closing');
  }
}

class FakeAudio {
  static made = 0;
  static playResult: 'resolve' | 'reject' | 'none' = 'resolve';
  autoplay = false;
  srcObject: unknown = null;
  constructor() {
    FakeAudio.made += 1;
  }
  play() {
    if (FakeAudio.playResult === 'none') return undefined;
    return FakeAudio.playResult === 'reject' ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
  }
}

type FetchCall = { url: string; method: string; body: Record<string, unknown> };

function fakeFetch(...replies: (Response | Error)[]) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method as string, body: JSON.parse(init.body as string) });
    const r = init.method === 'PATCH' ? new Response('{"ok":true}') : replies.length > 1 ? replies.shift() : replies[0];
    if (r instanceof Error) throw r;
    return (r as Response).clone();
  });
  return { fn, calls };
}

const answer = (pc_id = 'pc_1') => new Response(JSON.stringify({ sdp: 'answer-sdp', type: 'answer', pc_id }), { status: 200 });

let mic: FakeStream;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakePC.gathering = 'complete';
  FakePC.throwOnClose = false;
  FakeAudio.made = 0;
  FakeAudio.playResult = 'resolve';
  mic = new FakeStream();
  getUserMedia = vi.fn(async () => mic);
  vi.stubGlobal('RTCPeerConnection', FakePC);
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function opts(fetch: ReturnType<typeof fakeFetch>['fn'], extra: Partial<VoiceSessionOptions> = {}): VoiceSessionOptions {
  return { clientToken: 'vct_abc', webrtcUrl: 'https://voice.test/v1/webrtc/offer', fetch, ...extra };
}

/** すべての出来事を記録する */
function record(s: VoiceSession) {
  const seen: [string, unknown][] = [];
  const names: (keyof VoiceSessionEvents)[] = [
    'ready',
    'reply',
    'interrupted',
    'end',
    'user-transcript',
    'bot-output',
    'bot-started-speaking',
    'bot-stopped-speaking',
    'track',
    'state',
    'error',
    'closed',
  ];
  for (const n of names) s.on(n, (e) => seen.push([n, e]));
  return seen;
}

async function started(extra: Partial<VoiceSessionOptions> = {}) {
  const f = fakeFetch(answer());
  const s = new VoiceSession(opts(f.fn, extra));
  const seen = record(s);
  await s.start();
  return { s, f, seen, pc: FakePC.last, dc: FakePC.last.dc as FakeDC };
}

describe('VoiceSession: connecting', () => {
  it('requires clientToken and webrtcUrl', () => {
    expect(() => new VoiceSession({ clientToken: '', webrtcUrl: 'x' })).toThrow(VoiceSessionError);
    expect(() => new VoiceSession({ clientToken: 'x', webrtcUrl: '' })).toThrow('webrtcUrl is required');
    expect(new VoiceSessionError('x')).toMatchObject({ name: 'VoiceSessionError', status: undefined, code: undefined });
  });

  it('asks for the microphone, sets up audio sendrecv + video recvonly + the chat channel, and posts the offer with the token', async () => {
    const { s, f, pc, dc } = await started();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    expect(pc.config).toEqual({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] });
    expect(pc.transceivers).toEqual([
      [mic.tracks[0], { direction: 'sendrecv' }],
      ['video', { direction: 'recvonly' }],
    ]);
    expect(dc.label).toBe('chat');
    expect(dc.init).toEqual({ ordered: true });
    expect(f.calls).toEqual([
      { url: 'https://voice.test/v1/webrtc/offer', method: 'POST', body: { sdp: 'offer-1', type: 'offer', token: 'vct_abc' } },
    ]);
    expect(pc.remote).toEqual([{ type: 'answer', sdp: 'answer-sdp' }]);
    expect(s.pcId).toBe('pc_1');
    expect(s.localStream).toBe(mic);
  });

  it('uses the given iceServers and mediaStream (and does not stop a given stream on close)', async () => {
    const own = new FakeStream();
    const { s, pc } = await started({ iceServers: [{ urls: 'turn:t' }], mediaStream: own as unknown as MediaStream });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(pc.config).toEqual({ iceServers: [{ urls: 'turn:t' }] });
    s.stop();
    expect(own.tracks[0]!.stop).not.toHaveBeenCalled();
  });

  it('uses globalThis.fetch by default', async () => {
    const f = fakeFetch(answer());
    vi.stubGlobal('fetch', f.fn);
    const s = await startVoiceSession({ clientToken: 'vct_x', webrtcUrl: 'https://voice.test/o' });
    expect(s).toBeInstanceOf(VoiceSession);
    expect(f.calls).toHaveLength(1);
  });

  it('calls fetch without binding it to the session (browsers reject fetch called on another object)', async () => {
    const f = fakeFetch(answer());
    // ブラウザーの fetch と同じく、this が globalThis か undefined でなければ失敗する
    function strictFetch(this: unknown, input: string, init: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      return f.fn(input, init);
    }
    vi.stubGlobal('fetch', strictFetch);
    const s = new VoiceSession({ clientToken: 'vct_x', webrtcUrl: 'https://voice.test/o' });
    await s.start();
    expect(f.calls[0]?.method).toBe('POST');
    s.stop();
  });

  it('fails when fetch is not available', async () => {
    vi.stubGlobal('fetch', undefined);
    const s = new VoiceSession({ clientToken: 'vct_x', webrtcUrl: 'https://voice.test/o' });
    const seen = record(s);
    await expect(s.start()).rejects.toThrow('fetch is not available');
    expect(seen.map(([n]) => n)).toEqual(['error', 'closed']);
    expect(seen[1]![1]).toEqual({ reason: 'error' });
  });

  it('a refused offer (403) rejects with status and the server detail, emits error and closes, stopping the microphone', async () => {
    const f = fakeFetch(new Response(JSON.stringify({ detail: '接続できません' }), { status: 403 }));
    const s = new VoiceSession(opts(f.fn));
    const seen = record(s);
    const e = (await s.start().catch((x) => x)) as VoiceSessionError;
    expect(e).toBeInstanceOf(VoiceSessionError);
    expect(e.status).toBe(403);
    expect(e.message).toBe('The voice server refused the connection: 接続できません');
    expect(e.code).toBeUndefined();
    expect(seen.map(([n]) => n)).toEqual(['error', 'closed']);
    expect(mic.tracks[0]!.stop).toHaveBeenCalled();
    expect(FakePC.last.closed).toBe(true);
    expect(s.closed).toBe(true);
  });

  it('a billing refusal (402) carries the error code, as in POST /v1/sessions', async () => {
    const body = { error: 'balance_depleted', message: '残高が無いため', detail: '前の形' };
    const f = fakeFetch(new Response(JSON.stringify(body), { status: 402 }));
    const e = (await new VoiceSession(opts(f.fn)).start().catch((x) => x)) as VoiceSessionError;
    expect(e).toMatchObject({ status: 402, code: 'balance_depleted', message: 'The voice server refused the connection: 残高が無いため' });
  });

  it('a refused offer without a JSON detail uses the HTTP status', async () => {
    for (const body of ['<html>', JSON.stringify({ detail: { x: 1 } })]) {
      const f = fakeFetch(new Response(body, { status: 503 }));
      await expect(new VoiceSession(opts(f.fn)).start()).rejects.toThrow('The voice server refused the connection: HTTP 503');
    }
  });

  it('starting twice throws', async () => {
    const { s } = await started();
    await expect(s.start()).rejects.toThrow('already started');
  });

  it('fails without navigator.mediaDevices (not https), or without navigator at all', async () => {
    vi.stubGlobal('navigator', {});
    await expect(new VoiceSession(opts(fakeFetch(answer()).fn)).start()).rejects.toThrow(/Microphone access is not available/);
    vi.stubGlobal('navigator', undefined);
    await expect(new VoiceSession(opts(fakeFetch(answer()).fn)).start()).rejects.toThrow(/Microphone access is not available/);
  });

  it('fails when the stream has no audio track', async () => {
    const video = new FakeStream([new FakeTrack('video')]);
    await expect(new VoiceSession(opts(fakeFetch(answer()).fn, { mediaStream: video as unknown as MediaStream })).start()).rejects.toThrow(
      'no audio track',
    );
  });

  it('a microphone permission rejected with a non-Error is wrapped', async () => {
    getUserMedia.mockRejectedValueOnce('denied');
    const e = await new VoiceSession(opts(fakeFetch(answer()).fn)).start().catch((x) => x);
    expect(e).toBeInstanceOf(VoiceSessionError);
    expect(e.message).toBe('denied');
  });

  it('stop() while waiting for the microphone: start rejects and nothing connects', async () => {
    let give: (s: FakeStream) => void = () => {};
    getUserMedia.mockReturnValueOnce(new Promise((r) => (give = r)));
    const f = fakeFetch(answer());
    const s = new VoiceSession(opts(f.fn));
    const seen = record(s);
    const p = s.start().catch((x) => x);
    await Promise.resolve();
    s.stop();
    give(mic);
    expect((await p).message).toBe('The session was closed while starting');
    expect(f.calls).toHaveLength(0);
    // closed は 1 回だけ（hangup）
    expect(seen.filter(([n]) => n === 'closed')).toEqual([['closed', { reason: 'hangup' }]]);
  });

  it('stop() while the offer is in flight: the answer is not applied', async () => {
    let reply: (r: Response) => void = () => {};
    const fn = vi.fn(() => new Promise<Response>((r) => (reply = r)));
    const s = new VoiceSession(opts(fn as never));
    const p = s.start();
    await vi.waitFor(() => expect(fn).toHaveBeenCalled());
    s.stop();
    reply(answer());
    await p;
    expect(FakePC.last.remote).toEqual([]);
    expect(s.pcId).toBeUndefined();
  });
});

describe('ICE', () => {
  it('waits for gathering to complete before posting the offer', async () => {
    FakePC.gathering = 'gathering';
    const f = fakeFetch(answer());
    const s = new VoiceSession(opts(f.fn));
    const p = s.start();
    await vi.waitFor(() => expect(FakePC.last.listeners.size).toBe(1));
    FakePC.last.setGathering('gathering'); // まだ
    expect(f.calls).toHaveLength(0);
    FakePC.last.setGathering('complete');
    await p;
    expect(f.calls).toHaveLength(1);
    expect(FakePC.last.listeners.size).toBe(0);
  });

  it('posts the offer after iceGatheringTimeout even if gathering is not complete', async () => {
    vi.useFakeTimers();
    FakePC.gathering = 'gathering';
    const f = fakeFetch(answer());
    const p = new VoiceSession(opts(f.fn, { iceGatheringTimeout: 100 })).start();
    await vi.advanceTimersByTimeAsync(99);
    expect(f.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(f.calls).toHaveLength(1);
    expect(FakePC.last.listeners.size).toBe(0);
  });

  it('waitIceGathering defaults: resolves at once when complete', async () => {
    await expect(waitIceGathering({ iceGatheringState: 'complete' } as RTCPeerConnection, 10)).resolves.toBeUndefined();
  });

  it('candidates in the SDP are not sent; later ones are buffered until the answer, then PATCHed; then sent one by one', async () => {
    FakePC.gathering = 'gathering';
    let reply: (r: Response) => void = () => {};
    const calls: FetchCall[] = [];
    const fn = vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, method: init.method as string, body: JSON.parse(init.body as string) });
      if (init.method === 'PATCH') return Promise.resolve(new Response('{}'));
      return new Promise<Response>((r) => (reply = r));
    });
    const s = new VoiceSession(opts(fn as never));
    const p = s.start();
    await vi.waitFor(() => expect(FakePC.last.listeners.size).toBe(1));
    const pc = FakePC.last;
    pc.candidate({ candidate: 'in-sdp', sdpMid: '0', sdpMLineIndex: 0 });
    pc.setGathering('complete');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    pc.candidate(null);
    pc.candidate({ candidate: 'late-1', sdpMid: '0', sdpMLineIndex: 0 });
    pc.candidate({ candidate: 'late-2', sdpMid: null, sdpMLineIndex: null });
    reply(answer('pc_9'));
    await p;
    pc.candidate({ candidate: 'after', sdpMid: '1', sdpMLineIndex: 1 });
    expect(calls.slice(1)).toEqual([
      {
        url: 'https://voice.test/v1/webrtc/offer',
        method: 'PATCH',
        body: {
          pc_id: 'pc_9',
          candidates: [
            { candidate: 'late-1', sdp_mid: '0', sdp_mline_index: 0 },
            { candidate: 'late-2', sdp_mid: null, sdp_mline_index: null },
          ],
        },
      },
      {
        url: 'https://voice.test/v1/webrtc/offer',
        method: 'PATCH',
        body: { pc_id: 'pc_9', candidates: [{ candidate: 'after', sdp_mid: '1', sdp_mline_index: 1 }] },
      },
    ]);
  });

  it('a failed PATCH is ignored', async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'PATCH') throw new TypeError('network');
      return answer();
    });
    const s = new VoiceSession(opts(f as never));
    const seen = record(s);
    await s.start();
    FakePC.last.candidate({ candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 });
    await new Promise((r) => setTimeout(r, 0));
    expect(f).toHaveBeenCalledTimes(2);
    expect(seen.filter(([n]) => n === 'error')).toEqual([]);
  });
});

describe('data channel', () => {
  it('sends client-ready on open, then a ping every second while open', async () => {
    vi.useFakeTimers();
    const { dc } = await started();
    dc.open();
    expect(JSON.parse(dc.sent[0]!)).toEqual({
      label: 'rtvi-ai',
      type: 'client-ready',
      id: 'voicast-web-1',
      data: { version: '1.0.0', about: { library: 'voicast-web' } },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(dc.sent.slice(1)).toHaveLength(2);
    expect(dc.sent[1]).toMatch(/^ping: \d+$/);
    dc.readyState = 'closing';
    await vi.advanceTimersByTimeAsync(1000);
    expect(dc.sent).toHaveLength(3);
  });

  it('send() writes JSON only while the channel is open', async () => {
    const before = new VoiceSession(opts(fakeFetch(answer()).fn));
    before.send({ a: 1 }); // まだ始めていない
    const { s, dc } = await started();
    s.send({ a: 1 });
    expect(dc.sent).toEqual([]);
    dc.open();
    s.send({ a: 2 });
    expect(dc.sent.at(-1)).toBe('{"a":2}');
  });

  it('renegotiate sends a new offer with pc_id and restart_pc: false', async () => {
    const { f, dc, pc } = await started();
    dc.receive({ type: 'signalling', message: { type: 'renegotiate' } });
    await vi.waitFor(() => expect(pc.remote).toHaveLength(2));
    expect(f.calls[1]!.body).toEqual({ sdp: 'offer-2', type: 'offer', pc_id: 'pc_1', restart_pc: false });
  });

  it('a failed renegotiation is emitted as error', async () => {
    const f = fakeFetch(answer(), new Response('{}', { status: 404 }));
    const s = new VoiceSession(opts(f.fn));
    const seen = record(s);
    await s.start();
    FakePC.last.dc!.receive({ type: 'signalling', message: { type: 'renegotiate' } });
    await vi.waitFor(() => expect(seen.some(([n]) => n === 'error')).toBe(true));
    expect(s.closed).toBe(false);
  });

  it('peerLeft closes the session as ended; other signalling and junk are ignored', async () => {
    const { s, dc, seen } = await started();
    dc.receive({ type: 'signalling' });
    dc.receive({ type: 'signalling', message: { type: 'other' } });
    dc.receive('not json');
    dc.receive('null');
    dc.receive('5');
    dc.receive(new ArrayBuffer(2));
    dc.receive({ label: 'other', type: 'bot-ready' });
    expect(seen).toEqual([]);
    dc.receive({ type: 'signalling', message: { type: 'peerLeft' } });
    expect(seen).toEqual([['closed', { reason: 'ended' }]]);
    expect(s.closed).toBe(true);
  });
});

describe('RTVI messages', () => {
  const rtvi = (type: string, data?: Record<string, unknown>) => ({ label: 'rtvi-ai', type, ...(data ? { data } : {}) });

  it('maps RTVI messages to events', async () => {
    const { s, dc, seen } = await started();
    const raw: unknown[] = [];
    s.on('message', (m) => raw.push(m));
    const msgs = [
      rtvi('bot-ready'),
      rtvi('server-message', { type: 'voicast.reply', text: 'こんにちは' }),
      rtvi('server-message', { type: 'voicast.reply' }),
      rtvi('server-message', { type: 'voicast.interrupted' }),
      rtvi('server-message', { type: 'voicast.end', outcome: 'completed' }),
      rtvi('server-message', { type: 'voicast.end', outcome: 1 }),
      rtvi('server-message', { type: 'something.else' }),
      rtvi('server-message'),
      rtvi('user-transcription', { text: 'よや', final: false }),
      rtvi('user-transcription', { text: '予約したい', final: true }),
      rtvi('bot-output', { text: '前もって', spoken: false }),
      rtvi('bot-output', { text: '途中', spoken: true, spoken_status: 'interrupted' }),
      rtvi('bot-output', { text: '話した', spoken: true, spoken_status: 'completed' }),
      rtvi('bot-output', { text: '古い形' }),
      rtvi('bot-started-speaking'),
      rtvi('bot-stopped-speaking'),
      rtvi('metrics', { x: 1 }),
    ];
    for (const m of msgs) dc.receive(m);
    expect(seen).toEqual([
      ['ready', {}],
      ['reply', { text: 'こんにちは' }],
      ['reply', { text: '' }],
      ['interrupted', {}],
      ['end', { outcome: 'completed' }],
      ['end', { outcome: undefined }],
      ['user-transcript', { text: 'よや', final: false }],
      ['user-transcript', { text: '予約したい', final: true }],
      ['bot-output', { text: '話した' }],
      ['bot-output', { text: '古い形' }],
      ['bot-started-speaking', {}],
      ['bot-stopped-speaking', {}],
    ]);
    expect(raw).toHaveLength(msgs.length);
  });

  it('error and error-response become error events', async () => {
    const { dc, seen } = await started();
    dc.receive(rtvi('error', { error: 'llm failed' }));
    dc.receive(rtvi('error-response', { message: 'bad request' }));
    dc.receive(rtvi('error', { code: 7 }));
    const errors = seen.filter(([n]) => n === 'error').map(([, e]) => (e as { error: Error }).error);
    expect(errors.map((e) => e.message)).toEqual(['llm failed', 'bad request', '{"code":7}']);
    expect(errors[0]).toBeInstanceOf(VoiceSessionError);
  });
});

describe('audio', () => {
  it('plays the audio track on a new Audio element; video tracks are ignored', async () => {
    const { s, pc, seen } = await started();
    pc.ontrack!({ track: new FakeTrack('video'), streams: [] });
    expect(FakeAudio.made).toBe(0);
    const remote = new FakeStream();
    pc.ontrack!({ track: remote.tracks[0], streams: [remote] });
    expect(FakeAudio.made).toBe(1);
    expect(s.remoteStream).toBe(remote);
    expect(seen).toEqual([['track', { stream: remote }]]);
    // 2 本目も同じ要素で鳴らす。streams が無ければ track から作る
    const t = new FakeTrack('audio');
    pc.ontrack!({ track: t, streams: [] });
    expect(FakeAudio.made).toBe(1);
    expect((s.remoteStream as unknown as FakeStream).tracks).toEqual([t]);
    s.stop();
  });

  it('uses the given audioElement; a blocked autoplay is ignored; srcObject is cleared on close', async () => {
    FakeAudio.playResult = 'reject';
    const el = new FakeAudio();
    const { s, pc } = await started({ audioElement: el as unknown as HTMLAudioElement });
    const remote = new FakeStream();
    pc.ontrack!({ track: remote.tracks[0], streams: [remote] });
    expect(el.srcObject).toBe(remote);
    expect(el.autoplay).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    s.stop();
    expect(el.srcObject).toBeNull();
  });

  it('works with play() that returns nothing (old browsers)', async () => {
    FakeAudio.playResult = 'none';
    const { pc } = await started();
    const remote = new FakeStream();
    expect(() => pc.ontrack!({ track: remote.tracks[0], streams: [remote] })).not.toThrow();
  });

  it('playAudio: false only emits track', async () => {
    const { pc, seen } = await started({ playAudio: false });
    const remote = new FakeStream();
    pc.ontrack!({ track: remote.tracks[0], streams: [remote] });
    expect(FakeAudio.made).toBe(0);
    expect(seen).toEqual([['track', { stream: remote }]]);
  });

  it('setMuted toggles the microphone track (no-op before start)', async () => {
    new VoiceSession(opts(fakeFetch(answer()).fn)).setMuted(true);
    const { s } = await started();
    s.setMuted(true);
    expect(mic.tracks[0]!.enabled).toBe(false);
    s.setMuted(false);
    expect(mic.tracks[0]!.enabled).toBe(true);
  });
});

class FakeAudioContext {
  static made = 0;
  static startState: AudioContextState = 'running';
  static throwOnNew = false;
  static closeRejects = false;
  state: AudioContextState = FakeAudioContext.startState;
  currentTime = 1;
  closed = false;
  gain = { gain: { value: 1, setTargetAtTime: vi.fn((v: number) => (this.gain.gain.value = v)) }, connect: vi.fn() };
  out = new FakeStream();
  sources: unknown[] = [];
  constructor() {
    if (FakeAudioContext.throwOnNew) throw new Error('not allowed');
    FakeAudioContext.made += 1;
  }
  createGain() {
    return this.gain;
  }
  createMediaStreamDestination() {
    return { stream: this.out };
  }
  createMediaStreamSource(stream: unknown) {
    this.sources.push(stream);
    return { connect: vi.fn() };
  }
  async close() {
    this.closed = true;
    if (FakeAudioContext.closeRejects) throw new Error('already closed');
  }
}

describe('setMuted with an AudioContext (sends silence instead of disabling the track)', () => {
  beforeEach(() => {
    FakeAudioContext.made = 0;
    FakeAudioContext.startState = 'running';
    FakeAudioContext.throwOnNew = false;
    FakeAudioContext.closeRejects = false;
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });

  it('falls back when the context cannot be created, and ignores a failing close', async () => {
    FakeAudioContext.throwOnNew = true;
    const a = await started();
    expect(a.pc.transceivers[0]![0]).toBe(mic.tracks[0]);
    a.s.stop();
    FakeAudioContext.throwOnNew = false;
    FakeAudioContext.closeRejects = true;
    FakeAudioContext.startState = 'suspended';
    const b = await started(); // 動いていないので閉じる (失敗しても投げない)
    expect(b.pc.transceivers[0]![0]).toBe(mic.tracks[0]);
    FakeAudioContext.startState = 'running';
    const c = await started();
    c.s.stop(); // 自分で作ったものを閉じる (失敗しても投げない)
    await Promise.resolve();
  });

  it('does not use or close a given context that is not running', async () => {
    FakeAudioContext.startState = 'suspended';
    const given = new FakeAudioContext();
    const { pc } = await started({ audioContext: given as unknown as AudioContext });
    expect(pc.transceivers[0]![0]).toBe(mic.tracks[0]);
    expect(given.closed).toBe(false);
  });

  it('sends the gated track and mutes by volume; closes its own context', async () => {
    const pre = new VoiceSession(opts(fakeFetch(answer()).fn));
    pre.setMuted(true); // 始める前に止めておくと、始めたときから無音
    await pre.start();
    const ctx = (pre as unknown as { gate: { ctx: FakeAudioContext } }).gate.ctx;
    expect(FakePC.last.transceivers[0]![0]).toBe(ctx.out.tracks[0]);
    expect(ctx.gain.gain.value).toBe(0);
    expect(pre.muted).toBe(true);
    pre.setMuted(false);
    expect(ctx.gain.gain.value).toBe(1);
    expect(mic.tracks[0]!.enabled).toBe(true); // マイクのトラックは無効にしない
    pre.stop();
    expect(ctx.out.tracks[0]!.stop).toHaveBeenCalled();
    expect(ctx.closed).toBe(true);
  });

  it('uses the given context and does not close it', async () => {
    const given = new FakeAudioContext();
    const { s } = await started({ audioContext: given as unknown as AudioContext });
    expect(given.sources).toEqual([mic]);
    s.setMuted(true);
    expect(given.gain.gain.setTargetAtTime).toHaveBeenCalledWith(0, 1, 0.02);
    s.stop();
    expect(given.closed).toBe(false);
  });

  it('falls back to disabling the track when the context is not running (iOS outside a gesture)', async () => {
    FakeAudioContext.startState = 'suspended';
    const pre = new VoiceSession(opts(fakeFetch(answer()).fn));
    pre.setMuted(true);
    await pre.start();
    expect(FakePC.last.transceivers[0]![0]).toBe(mic.tracks[0]);
    expect(mic.tracks[0]!.enabled).toBe(false);
    pre.setMuted(false);
    expect(mic.tracks[0]!.enabled).toBe(true);
  });
});

describe('connection state and closing', () => {
  it('emits state; failed closes as failed', async () => {
    const { pc, seen } = await started();
    pc.setState('connecting');
    pc.setState('connected');
    pc.setState('failed');
    pc.setState('closed'); // 閉じたあとは何も出さない
    expect(seen).toEqual([
      ['state', { state: 'connecting' }],
      ['state', { state: 'connected' }],
      ['state', { state: 'failed' }],
      ['closed', { reason: 'failed' }],
    ]);
  });

  it('closed closes as ended', async () => {
    const { pc, seen } = await started();
    pc.setState('closed');
    expect(seen.at(-1)).toEqual(['closed', { reason: 'ended' }]);
  });

  it('disconnected closes after disconnectTimeout unless it reconnects', async () => {
    vi.useFakeTimers();
    const { pc, seen } = await started({ disconnectTimeout: 1000 });
    pc.setState('disconnected');
    await vi.advanceTimersByTimeAsync(999);
    pc.setState('connected');
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen.some(([n]) => n === 'closed')).toBe(false);
    pc.setState('disconnected');
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen.at(-1)).toEqual(['closed', { reason: 'disconnected' }]);
  });

  it('disconnected waits 5 seconds by default', async () => {
    vi.useFakeTimers();
    const { pc, seen } = await started();
    pc.setState('disconnected');
    await vi.advanceTimersByTimeAsync(4999);
    expect(seen.some(([n]) => n === 'closed')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.at(-1)).toEqual(['closed', { reason: 'disconnected' }]);
  });

  it('stop() hangs up once: closes the channel and the connection, stops the microphone; errors while closing are ignored', async () => {
    FakePC.throwOnClose = true;
    const { s, dc, pc, seen } = await started();
    dc.throwOnClose = true;
    s.stop();
    s.stop();
    expect(dc.readyState).toBe('closed');
    expect(pc.closed).toBe(true);
    expect(mic.tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([['closed', { reason: 'hangup' }]]);
  });

  it('stop() before start() just marks it closed', () => {
    const s = new VoiceSession(opts(fakeFetch(answer()).fn));
    const seen = record(s);
    s.stop();
    expect(seen).toEqual([['closed', { reason: 'hangup' }]]);
  });

  it('on() returns a function that removes the listener', async () => {
    const { s, dc } = await started();
    const got: string[] = [];
    const off = s.on('reply', ({ text }) => got.push(text));
    dc.receive({ label: 'rtvi-ai', type: 'server-message', data: { type: 'voicast.reply', text: 'a' } });
    off();
    dc.receive({ label: 'rtvi-ai', type: 'server-message', data: { type: 'voicast.reply', text: 'b' } });
    expect(got).toEqual(['a']);
  });
});

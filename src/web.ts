// voicast/web: ブラウザ（と WebView）から WebRTC で voicast と話す。依存なし。
// 手順は apps/demo/index.html・apps/voice/tests/web_session.py と同じ（Pipecat の SmallWebRTC と RTVI）:
//   マイク → RTCPeerConnection（音声 sendrecv・映像 recvonly）→ データチャンネル "chat" → offer を webrtc_url に POST（初回は token）
//   → answer → 後から見つかった ICE の候補は PATCH → データチャンネルで client-ready と 1 秒ごとの ping
//   返事は output が audio なら音声トラック、text なら RTVI の server-message（voicast.reply / voicast.interrupted / voicast.end）。
// voicast/web は単独で読み込む（本体の errors.ts を共有すると tsup が共通の塊に分け、CJS では別のクラスになる）

/**
 * Error from a Web voice session. `status` is set when the voice server refused the offer
 * (403: invalid, expired or used token; 402: new calls are refused for billing, with `code` `balance_depleted` as in `POST /v1/sessions`).
 */
export class VoiceSessionError extends Error {
  override name = 'VoiceSessionError';
  /** HTTP status from the voice server, when it refused the offer. */
  readonly status: number | undefined;
  /** Error code from the voice server, when it sent one (402: `balance_depleted`). */
  readonly code: string | undefined;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.status = options.status;
    this.code = options.code;
  }
}

/** Why the session closed. */
export type CloseReason = 'ended' | 'hangup' | 'failed' | 'disconnected' | 'error';

/** Events emitted by `VoiceSession`. */
export interface VoiceSessionEvents {
  /** The AI is ready (RTVI `bot-ready`). */
  ready: Record<string, never>;
  /** One sentence of the AI's reply, with `output: 'text'` (greeting and closing too). Give it to your avatar or show it. */
  reply: { text: string };
  /** The user started talking: stop speaking the current reply. */
  interrupted: Record<string, never>;
  /** The AI ended the conversation. The connection closes next. */
  end: { outcome: string | undefined };
  /** What the user said. `final: false` is a partial result. */
  'user-transcript': { text: string; final: boolean };
  /** A sentence the AI actually spoke, with `output: 'audio'`. */
  'bot-output': { text: string };
  'bot-started-speaking': Record<string, never>;
  'bot-stopped-speaking': Record<string, never>;
  /** The AI's audio track (with `output: 'audio'`). Played on `audioElement` unless `playAudio: false`. */
  track: { stream: MediaStream };
  /** `RTCPeerConnection.connectionState` changed. */
  state: { state: RTCPeerConnectionState };
  /** Every RTVI message as received. */
  message: RtviMessage;
  error: { error: Error };
  /** The session closed. Emitted once. */
  closed: { reason: CloseReason };
}

export type VoiceSessionEvent = keyof VoiceSessionEvents;

/** An RTVI message from the voice server (`label: 'rtvi-ai'`). */
export interface RtviMessage {
  label: 'rtvi-ai';
  type: string;
  id?: string;
  data?: Record<string, unknown>;
}

export interface VoiceSessionOptions {
  /** `client_token` (`vct_…`) from `voicast.sessions.create()` on your server. */
  clientToken: string;
  /** `webrtc_url` from the same session. */
  webrtcUrl: string;
  /** Microphone stream. Default: `getUserMedia` with echo cancellation, noise suppression and auto gain. Not stopped on close when given. */
  mediaStream?: MediaStream;
  /** Plays the AI's voice. Default: a new `Audio` element. */
  audioElement?: HTMLAudioElement;
  /** `false` leaves playing the `track` to you. Default `true`. */
  playAudio?: boolean;
  /** `ice_servers` from the same session (STUN, and TURN when configured). Default: Google's public STUN server. */
  iceServers?: RTCIceServer[];
  /** Milliseconds to wait for ICE gathering before sending the offer. Default 2500. */
  iceGatheringTimeout?: number;
  /** Milliseconds to wait for a `disconnected` connection to come back before closing. Default 5000. */
  disconnectTimeout?: number;
  /** Custom `fetch`. Default `globalThis.fetch`. */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

type Listener<K extends VoiceSessionEvent> = (event: VoiceSessionEvents[K]) => void;

const DEFAULT_ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];
const PING_MS = 1000; // 音声サーバーは ping が 3 秒途切れると切れたとみなす
const EMPTY = {} as Record<string, never>;

type Candidate = { candidate: string; sdp_mid: string | null; sdp_mline_index: number | null };

/** A voice conversation with voicast over WebRTC. Create with `startVoiceSession()` or `new VoiceSession(options).start()`. */
export class VoiceSession {
  /** The peer connection ID returned by the voice server. */
  pcId: string | undefined;
  /** The microphone stream, once started. */
  localStream: MediaStream | undefined;
  /** The AI's audio, once received. */
  remoteStream: MediaStream | undefined;
  /** `true` after `closed` was emitted. */
  closed = false;

  private readonly listeners = new Map<VoiceSessionEvent, Set<(e: never) => void>>();
  private pc: RTCPeerConnection | undefined;
  private dc: RTCDataChannel | undefined;
  private audio: HTMLAudioElement | undefined;
  private ownStream = false;
  private started = false;
  private sdpTaken = false;
  private late: Candidate[] = [];
  private ping: ReturnType<typeof setInterval> | undefined;
  private dropTimer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 0;

  constructor(private readonly options: VoiceSessionOptions) {
    if (!options.clientToken) throw new VoiceSessionError('clientToken is required');
    if (!options.webrtcUrl) throw new VoiceSessionError('webrtcUrl is required');
  }

  /** Adds a listener. Returns a function that removes it (handy for React's `useEffect`). */
  on<K extends VoiceSessionEvent>(type: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as (e: never) => void);
    return () => {
      set.delete(listener as (e: never) => void);
    };
  }

  private emit<K extends VoiceSessionEvent>(type: K, event: VoiceSessionEvents[K]): void {
    for (const l of this.listeners.get(type) ?? []) (l as Listener<K>)(event);
  }

  private get fetch(): NonNullable<VoiceSessionOptions['fetch']> {
    const f = this.options.fetch ?? (globalThis as { fetch?: VoiceSessionOptions['fetch'] }).fetch;
    if (!f) throw new VoiceSessionError('fetch is not available');
    // 関数として呼ぶ（this.fetch(...) のままだと this が VoiceSession になり、ブラウザーの fetch は Illegal invocation で失敗する）
    return (input, init) => f(input, init);
  }

  /** Asks for the microphone (unless `mediaStream` was given), connects and sends the offer. Resolves once the answer is applied. */
  async start(): Promise<void> {
    if (this.started) throw new VoiceSessionError('The session was already started');
    this.started = true;
    try {
      await this.connect();
    } catch (e) {
      const error = e instanceof Error ? e : new VoiceSessionError(String(e));
      this.emit('error', { error });
      this.close('error');
      throw error;
    }
  }

  private async connect(): Promise<void> {
    const o = this.options;
    if (o.mediaStream) this.localStream = o.mediaStream;
    else {
      const md = (globalThis as { navigator?: Navigator }).navigator?.mediaDevices;
      if (!md) throw new VoiceSessionError('Microphone access is not available (navigator.mediaDevices). Use https or localhost.');
      this.localStream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.ownStream = true;
    }
    // マイクの許可を待つ間に stop() されたとき
    if (this.closed) throw new VoiceSessionError('The session was closed while starting');
    const track = this.localStream.getAudioTracks()[0];
    if (!track) throw new VoiceSessionError('The media stream has no audio track');

    const pc = new RTCPeerConnection({ iceServers: o.iceServers ?? DEFAULT_ICE });
    this.pc = pc;
    pc.addTransceiver(track, { direction: 'sendrecv' });
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.ontrack = (e) => this.onTrack(e);
    pc.onicecandidate = (e) => this.onCandidate(e.candidate);
    pc.onconnectionstatechange = () => this.onState(pc.connectionState);

    const dc = pc.createDataChannel('chat', { ordered: true });
    this.dc = dc;
    dc.onopen = () => {
      this.send({ label: 'rtvi-ai', type: 'client-ready', id: this.id(), data: { version: '1.0.0', about: { library: 'voicast-web' } } });
      this.ping = setInterval(() => dc.readyState === 'open' && dc.send(`ping: ${Date.now()}`), PING_MS);
    };
    dc.onmessage = (e) => this.onData(e.data);

    await this.offer({ token: o.clientToken });
  }

  private id(): string {
    this.nextId += 1;
    return `voicast-web-${this.nextId}`;
  }

  /** Sends a raw message on the data channel (JSON-encoded). Ignored when the channel is not open. */
  send(message: unknown): void {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(message));
  }

  /** Mutes or unmutes the microphone. */
  setMuted(muted: boolean): void {
    for (const t of this.localStream?.getAudioTracks() ?? []) t.enabled = !muted;
  }

  /** Hangs up. */
  stop(): void {
    this.close('hangup');
  }

  private async offer(extra: Record<string, unknown>): Promise<void> {
    const pc = this.pc as RTCPeerConnection;
    await pc.setLocalDescription(await pc.createOffer());
    await waitIceGathering(pc, this.options.iceGatheringTimeout ?? 2500);
    const local = pc.localDescription as RTCSessionDescription;
    this.sdpTaken = true;
    const res = await this.fetch(this.options.webrtcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sdp: local.sdp, type: local.type, ...extra }),
    });
    const answer = (await res.json().catch(() => ({}))) as {
      sdp?: string;
      type?: RTCSdpType;
      pc_id?: string;
      detail?: unknown;
      error?: unknown;
    };
    if (!res.ok) {
      const detail = typeof answer.detail === 'string' ? answer.detail : `HTTP ${res.status}`;
      const code = typeof answer.error === 'string' ? answer.error : undefined;
      throw new VoiceSessionError(`The voice server refused the connection: ${detail}`, { status: res.status, code });
    }
    if (this.closed) return;
    this.pcId = answer.pc_id;
    await pc.setRemoteDescription({ type: answer.type as RTCSdpType, sdp: answer.sdp });
    if (this.late.length) this.patch(this.late.splice(0));
  }

  private patch(candidates: Candidate[]): void {
    this.fetch(this.options.webrtcUrl, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pc_id: this.pcId, candidates }),
    }).catch(() => {
      // 候補を足せなくても、offer の SDP の候補でつながることが多い
    });
  }

  private onCandidate(c: RTCIceCandidate | null): void {
    // SDP を読む前の候補は offer に入っている
    if (!c || !this.sdpTaken) return;
    const candidate = { candidate: c.candidate, sdp_mid: c.sdpMid, sdp_mline_index: c.sdpMLineIndex };
    if (this.pcId) this.patch([candidate]);
    else this.late.push(candidate);
  }

  private onTrack(e: RTCTrackEvent): void {
    if (e.track.kind !== 'audio') return;
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    this.remoteStream = stream;
    this.emit('track', { stream });
    if (this.options.playAudio === false) return;
    this.audio ??= this.options.audioElement ?? new Audio();
    this.audio.autoplay = true;
    this.audio.srcObject = stream;
    this.audio.play()?.catch(() => {
      // 自動再生が止められたとき。ボタンを押したあとに audioElement.play() を呼ぶ
    });
  }

  private onState(state: RTCPeerConnectionState): void {
    if (this.closed) return;
    this.emit('state', { state });
    clearTimeout(this.dropTimer);
    if (state === 'failed') this.close('failed');
    else if (state === 'closed') this.close('ended');
    else if (state === 'disconnected') {
      // 少し待っても戻らなければ切れたとみなす
      this.dropTimer = setTimeout(() => this.close('disconnected'), this.options.disconnectTimeout ?? 5000);
    }
  }

  private onData(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let msg: { label?: unknown; type?: unknown; message?: { type?: unknown }; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    if (msg.type === 'signalling') {
      const t = msg.message?.type;
      if (t === 'renegotiate') {
        this.offer({ pc_id: this.pcId, restart_pc: false }).catch((error: Error) => this.emit('error', { error }));
      } else if (t === 'peerLeft') this.close('ended');
      return;
    }
    if (msg.label === 'rtvi-ai') this.onRtvi(msg as RtviMessage);
  }

  private onRtvi(msg: RtviMessage): void {
    this.emit('message', msg);
    const d = msg.data ?? {};
    const text = typeof d.text === 'string' ? d.text : '';
    switch (msg.type) {
      case 'bot-ready':
        this.emit('ready', EMPTY);
        break;
      case 'server-message':
        if (d.type === 'voicast.reply') this.emit('reply', { text });
        else if (d.type === 'voicast.interrupted') this.emit('interrupted', EMPTY);
        else if (d.type === 'voicast.end') this.emit('end', { outcome: typeof d.outcome === 'string' ? d.outcome : undefined });
        break;
      case 'user-transcription':
        this.emit('user-transcript', { text, final: d.final === true });
        break;
      case 'bot-output':
        // 実際に話した文だけ（話す前の知らせ spoken: false は捨てる）
        if (d.spoken === false || (d.spoken_status !== undefined && d.spoken_status !== 'completed')) break;
        this.emit('bot-output', { text });
        break;
      case 'bot-started-speaking':
        this.emit('bot-started-speaking', EMPTY);
        break;
      case 'bot-stopped-speaking':
        this.emit('bot-stopped-speaking', EMPTY);
        break;
      case 'error':
      case 'error-response': {
        const m = d.error ?? d.message;
        this.emit('error', { error: new VoiceSessionError(typeof m === 'string' ? m : JSON.stringify(d)) });
        break;
      }
    }
  }

  private close(reason: CloseReason): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ping);
    clearTimeout(this.dropTimer);
    try {
      this.dc?.close();
    } catch {
      // 閉じかけのチャンネル
    }
    try {
      this.pc?.close();
    } catch {
      // 閉じかけの接続
    }
    if (this.ownStream) for (const t of (this.localStream as MediaStream).getTracks()) t.stop();
    if (this.audio) this.audio.srcObject = null;
    this.emit('closed', { reason });
  }
}

/** Resolves when ICE gathering completes, or after `ms`. */
export function waitIceGathering(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState !== 'complete') return;
      finish();
    };
    const finish = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    pc.addEventListener('icegatheringstatechange', done);
  });
}

/**
 * Starts a voice conversation in the browser.
 *
 * ```ts
 * const session = await startVoiceSession({ clientToken, webrtcUrl });
 * session.on('reply', ({ text }) => avatar.speak(text)); // output: 'text'
 * session.on('closed', ({ reason }) => console.log(reason));
 * ```
 *
 * Listeners added after it resolves miss events sent while connecting. To catch them, use `new VoiceSession(options)`,
 * add listeners, then `await session.start()`.
 */
export async function startVoiceSession(options: VoiceSessionOptions): Promise<VoiceSession> {
  const s = new VoiceSession(options);
  await s.start();
  return s;
}

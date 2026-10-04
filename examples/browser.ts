// ブラウザの例。サーバー（examples/server.ts）の /session で client_token をもらい、WebRTC で話す。
// バンドラーで import { VoiceSession } from 'voicast/web' と書く。
import { VoiceSession } from '../src/web';

export async function talk(log: (line: string) => void): Promise<VoiceSession> {
  const r = await fetch('/session', { method: 'POST' });
  const { client_token, webrtc_url, ice_servers } = (await r.json()) as {
    client_token: string;
    webrtc_url: string;
    ice_servers: RTCIceServer[];
  };

  const session = new VoiceSession({ clientToken: client_token, webrtcUrl: webrtc_url, iceServers: ice_servers });
  session.on('ready', () => log('connected'));
  session.on('user-transcript', ({ text, final }) => final && log(`you: ${text}`));
  session.on('bot-output', ({ text }) => log(`AI: ${text}`));
  session.on('end', ({ outcome }) => log(`ended (${outcome})`));
  session.on('closed', ({ reason }) => log(`closed: ${reason}`));
  session.on('error', ({ error }) => log(`error: ${error.message}`));
  await session.start(); // ボタンを押したときに呼ぶ（声を鳴らせるように）
  return session;
}

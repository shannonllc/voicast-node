#!/usr/bin/env node
// ビルドした成果物を npm pack し、別のディレクトリに入れて、素の Node（ESM・CJS）・型（node16 の ESM・CJS）・
// Deno（あれば）から使えることを確かめる。pnpm test の最後に流す。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'voicast-sdk-pack-'));
const require = createRequire(join(pkgDir, 'package.json'));

function step(name) {
  console.log(`[pack-check] ${name}`);
}
function fail(msg) {
  console.error(`[pack-check] NG: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

// 受け取った本文と見出しで検証し、API は偽の fetch で 1 回流す。どの実行環境でも同じもの
const SMOKE = `
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  const body = JSON.stringify({ type: 'call.ended', timestamp: new Date().toISOString(), data: { id: 'call_1' } });
  const wh = new Webhook(secret);
  const ts = Math.floor(Date.now() / 1000);
  const headers = { 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': await wh.sign('msg_1', ts, body) };
  const event = await verifyWebhook(body, headers, secret);
  if (event.data.id !== 'call_1') throw new Error('verify returned ' + JSON.stringify(event));
  const tool = JSON.stringify({ type: 'tool.call', tool: 't', tool_call_id: 'tc', arguments: {}, call: { id: 'c', tenant: {} } });
  const th = { 'webhook-id': 'msg_2', 'webhook-timestamp': String(ts), 'webhook-signature': await wh.sign('msg_2', ts, tool) };
  if ((await verifyToolCall(tool, th, secret)).tool !== 't') throw new Error('verifyToolCall');
  let bad = null;
  try { await verifyWebhook(body + ' ', headers, secret); } catch (e) { bad = e; }
  if (!(bad instanceof WebhookVerificationError) || !(bad instanceof VoicastError)) throw new Error('verify accepted a changed body');
  const seen = [];
  const client = new Voicast('vk_test_x', {
    baseUrl: 'https://api.test',
    fetch: async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ id: 'sess_1', client_token: 'vct_x' }), { status: 201, headers: { 'content-type': 'application/json' } });
    },
  });
  const r = await client.sessions.create({ tenant_id: 'ten_1' });
  if (r.client_token !== 'vct_x') throw new Error('create returned ' + JSON.stringify(r));
  const h = seen[0].init.headers;
  if (h['user-agent'] !== 'voicast-node/' + VERSION) throw new Error('user-agent ' + h['user-agent']);
  if (h.authorization !== 'Bearer vk_test_x') throw new Error('authorization ' + h.authorization);
  const nf = new Voicast('vk_test_x', { fetch: async () => new Response('{"error":"not_found","message":"x"}', { status: 404 }) });
  let e404 = null;
  try { await nf.calls.get('c'); } catch (e) { e404 = e; }
  if (!(e404 instanceof NotFoundError)) throw new Error('404 was ' + e404);
  if (typeof VoiceSession !== 'function' || typeof startVoiceSession !== 'function') throw new Error('voicast/web');
`;

const IMPORTS = 'Voicast, Webhook, verifyWebhook, verifyToolCall, VoicastError, WebhookVerificationError, NotFoundError, VERSION';
const WEB_IMPORTS = 'VoiceSession, startVoiceSession';

try {
  step('npm pack');
  const out = execFileSync('npm', ['pack', '--json', '--pack-destination', work], { cwd: pkgDir, encoding: 'utf8' });
  const [info] = JSON.parse(out);
  const files = info.files.map((f) => f.path).sort();
  const expected = [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'dist/index.cjs',
    'dist/index.d.cts',
    'dist/index.d.ts',
    'dist/index.js',
    'dist/web.cjs',
    'dist/web.d.cts',
    'dist/web.d.ts',
    'dist/web.js',
    'package.json',
  ];
  // voicast/web は本体と何も共有しない（共通の塊 chunk-*.js が出ない）
  if (JSON.stringify(files) !== JSON.stringify(expected)) fail(`files in the tarball: ${files.join(', ')}`);
  const tgz = join(work, info.filename);

  step('the tarball has no dependencies and no workspace references');
  const packed = JSON.parse(execFileSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' }));
  for (const k of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (packed[k] && Object.keys(packed[k]).length) fail(`${k} in package.json: ${JSON.stringify(packed[k])}`);
  }
  for (const f of files.filter((x) => x.startsWith('dist/'))) {
    const src = execFileSync('tar', ['-xzOf', tgz, `package/${f}`], { encoding: 'utf8' });
    if (/@voicast\/|workspace:/.test(src)) fail(`${f} refers to a workspace package`);
    if (/from ["']node:|require\(["']node:/.test(src)) fail(`${f} imports a Node built-in statically`);
  }
  // ブラウザ向けの voicast/web は Node の処理系に触れない（動的な import('node:crypto') も含めない）
  for (const f of ['dist/web.js', 'dist/web.cjs']) {
    const src = execFileSync('tar', ['-xzOf', tgz, `package/${f}`], { encoding: 'utf8' });
    if (/node:crypto|process\.env/.test(src)) fail(`${f} touches Node-only APIs`);
  }

  step('install into an empty project');
  const app = join(work, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app', private: true, version: '0.0.0' }));
  run('npm', ['install', tgz, '--offline', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock'], { cwd: app });

  step('Node ESM (import)');
  writeFileSync(
    join(app, 'esm.mjs'),
    `import { ${IMPORTS} } from 'voicast';\nimport { ${WEB_IMPORTS} } from 'voicast/web';\n${SMOKE}\nconsole.log('esm ok ' + VERSION);\n`,
  );
  if (!run(process.execPath, ['esm.mjs'], { cwd: app }).includes(`esm ok ${pkg.version}`)) fail('esm');

  step('Node CJS (require)');
  writeFileSync(
    join(app, 'cjs.cjs'),
    `const { ${IMPORTS} } = require('voicast');\nconst { ${WEB_IMPORTS} } = require('voicast/web');\n(async () => {${SMOKE}\nconsole.log('cjs ok ' + VERSION);\n})().catch((e) => { console.error(e); process.exit(1); });\n`,
  );
  if (!run(process.execPath, ['cjs.cjs'], { cwd: app }).includes(`cjs ok ${pkg.version}`)) fail('cjs');

  // 追加の実行環境（例: PACK_CHECK_RUNTIMES=/path/to/node18,/path/to/bun）でも ESM・CJS を流す
  for (const bin of (process.env.PACK_CHECK_RUNTIMES ?? '').split(',').filter(Boolean)) {
    const v = run(bin, ['--version']).trim();
    step(`${bin} ${v}: ESM and CJS`);
    if (!run(bin, ['esm.mjs'], { cwd: app }).includes('esm ok')) fail(`esm on ${v}`);
    if (!run(bin, ['cjs.cjs'], { cwd: app }).includes('cjs ok')) fail(`cjs on ${v}`);
  }

  step('types under module node16 (ESM and CJS)');
  const typesNode = dirname(require.resolve('@types/node/package.json'));
  const TYPES = `
    const v: Voicast = new Voicast('vk_test_x', { maxRetries: 1, timeout: 1000 });
    async function f(): Promise<void> {
      const s: Session = await v.sessions.create({ tenant_id: 't', output: 'text' });
      const page: Page<Call> = await v.calls.list({ limit: 10 });
      for await (const c of v.calls.list()) c.started_at.toFixed();
      const a: AgentWithConfig = await v.agents.get('agt', { version: 2 });
      const ev: VoicastEvent = await verifyWebhook(Buffer.from(''), {}, 'whsec_x');
      if (ev.type === 'call.summary_ready') ev.data.summary.toUpperCase();
      const t: ToolCallRequest<{ date: string }> = await verifyToolCall<{ date: string }>('', {}, ['whsec_a', 'whsec_b']);
      void [s.client_token, page.has_more, a.config.greeting, t.arguments.date];
      try { await v.calls.get('c'); } catch (e) { if (e instanceof RateLimitError) void e.retryAfter; }
      const session = new VoiceSession({ clientToken: s.client_token, webrtcUrl: s.webrtc_url });
      const off: () => void = session.on('reply', ({ text }) => text.toUpperCase());
      off();
    }
    void f;
  `;
  const imports =
    'Voicast, verifyWebhook, verifyToolCall, RateLimitError, type Session, type Page, type Call, type AgentWithConfig, type VoicastEvent, type ToolCallRequest';
  const header = `import { ${imports} } from 'voicast';\nimport { VoiceSession } from 'voicast/web';\n`;
  writeFileSync(join(app, 'types.mts'), `${header}${TYPES}`);
  writeFileSync(join(app, 'types.cts'), `${header}${TYPES}`);
  writeFileSync(
    join(app, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'node16',
        moduleResolution: 'node16',
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        strict: true,
        noEmit: true,
        typeRoots: [dirname(typesNode)],
        types: ['node'],
      },
      files: ['types.mts', 'types.cts'],
    }),
  );
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: app });

  const deno = spawnSync('deno', ['--version'], { encoding: 'utf8' });
  if (deno.status === 0) {
    step('Deno (no permissions besides reading the package)');
    writeFileSync(
      join(app, 'deno.mjs'),
      `import { ${IMPORTS} } from './node_modules/voicast/dist/index.js';\nimport { ${WEB_IMPORTS} } from './node_modules/voicast/dist/web.js';\n${SMOKE}\nlet missing = null; try { new Voicast(); } catch (e) { missing = e; }\nif (!(missing instanceof VoicastError)) throw new Error('missing key did not throw');\nconsole.log('deno ok ' + VERSION);\n`,
    );
    if (!run('deno', ['run', '--no-prompt', '--allow-read=.', 'deno.mjs'], { cwd: app }).includes('deno ok')) fail('deno');
  } else {
    step('Deno is not installed; skipped');
  }

  console.log('[pack-check] all ok');
} finally {
  rmSync(work, { recursive: true, force: true });
}

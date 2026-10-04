// 実行環境の差を吸収する（Node 18 は Web Crypto が global に無い、Workers には process が無い）。

// 変数にしておくと、バンドラーが node:crypto を解決しようとしない（Workers・Deno では読まれない）
const NODE_CRYPTO = 'node:crypto';

let nodeCrypto: Promise<Crypto> | undefined;

/** Web Crypto. Node 18 falls back to node:crypto's webcrypto. */
export function webCrypto(): Promise<Crypto> {
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (g?.subtle) return Promise.resolve(g);
  nodeCrypto ??= import(/* webpackIgnore: true */ /* @vite-ignore */ NODE_CRYPTO).then((m: { webcrypto: Crypto }) => m.webcrypto);
  return nodeCrypto;
}

/** Reads an environment variable in Node, Bun and Deno. Returns undefined elsewhere. */
export function readEnv(name: string): string | undefined {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get(name: string): string | undefined } };
  };
  try {
    const v = g.process?.env?.[name] ?? g.Deno?.env?.get(name);
    return v?.trim() || undefined;
  } catch {
    // Deno without --allow-env throws
    return undefined;
  }
}

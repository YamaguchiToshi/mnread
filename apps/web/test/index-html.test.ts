/**
 * 配信される index.html が持っていなければならないもの。
 *
 * どちらも「入っていないこと」に画面上の手がかりがない。壊れても誰も気づかない
 * ので、ファイルそのものを読んで固定する。
 */

import { describe, expect, it } from "vitest";

// 配信されるファイルそのものを読む（Vite の ?raw）。
import html from "../index.html?raw";
import { applyWebAnalytics } from "../vite/web-analytics.ts";

// 形だけ合っていればよい（32桁の16進）。実物のサイトトークンではない。
const TOKEN = "0123456789abcdef0123456789abcdef";

/** CSP の meta から content の中身だけを取り出す。 */
function cspOf(source: string): string {
  const match = source.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/);
  if (!match?.[1]) throw new Error("index.html に CSP の meta がない");
  return match[1];
}

describe("index.html", () => {
  it("検索エンジンに載せない指示を持つ（Phase 5 の検証中）", () => {
    // GitHub Pages はヘッダを足せず、/mnread/robots.txt はクローラが読まない
    // （読むのはドメイン直下）。meta が唯一効く手段なので、消えたら気づけるように。
    expect(html).toMatch(/<meta\s+name="robots"\s+content="[^"]*noindex/);
  });

  it("外部接続を禁じる CSP を持つ（患者データを端末外に出さない）", () => {
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'self'");
  });
});

/**
 * アクセス解析（ADR-0017）。
 *
 * 見るのは「穴の大きさ」である。ビーコンを入れる判断は済んでいるが、
 * 開くのはビーコン1本ぶんだけであり、それ以外の外部接続は禁じたままでなければ
 * ならない。ここが緩んでも画面には何も出ないので、ファイルの中身で固定する。
 */
describe("アクセス解析ビーコンの差し込み", () => {
  it("トークンがなければ index.html に一切手を触れない", () => {
    expect(applyWebAnalytics(html, undefined)).toBe(html);
    expect(applyWebAnalytics(html, "")).toBe(html);
  });

  it("トークンがあればビーコンを1本だけ足す", () => {
    const out = applyWebAnalytics(html, TOKEN);

    // Cloudflare が配るスニペットと同じ形（`type="module"`）。
    expect(out).toContain(
      `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${TOKEN}"}'></script>`,
    );
    // 足すのは1本。<script> は本体（main.tsx）とビーコンの2本で全部。
    expect(out.match(/<script/g)).toHaveLength(2);
  });

  it("CSP はビーコンに必要な2ホストだけを開ける", () => {
    const csp = cspOf(applyWebAnalytics(html, TOKEN));

    expect(csp).toContain("script-src 'self' https://static.cloudflareinsights.com;");
    expect(csp).toContain("connect-src https://cloudflareinsights.com;");

    // 開けるのはここまで。土台と、外部への流出経路になりうる残りは動かさない。
    expect(csp).toContain("default-src 'self';");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain("*");

    // CSP に現れる外部オリジンは、ビーコンの2つでちょうど全部であること。
    expect(csp.match(/https?:\/\/[^\s;"]+/g)).toEqual([
      "https://static.cloudflareinsights.com",
      "https://cloudflareinsights.com",
    ]);
  });

  it("検索避けの指示はビーコンを入れても残る", () => {
    expect(applyWebAnalytics(html, TOKEN)).toMatch(/<meta\s+name="robots"\s+content="[^"]*noindex/);
  });

  it("トークンの形が違えばビルドを止める（黙って壊れた計測を配信しない）", () => {
    expect(() => applyWebAnalytics(html, "not-a-token")).toThrow(/サイトトークン/);
    // HTML へ流し込まれると属性を抜け出せる類の値も、同じ関門で落ちる。
    expect(() => applyWebAnalytics(html, `"></script><script>alert(1)</script>`)).toThrow();
  });

  it("差し込み位置の前提が崩れたらビルドを止める", () => {
    // CSP を書き換えた結果 `connect-src 'none'` が消えていれば、
    // 「CSP は開いたのにビーコンがない」形を配信しうる。素通ししない。
    const withoutCsp = html.replace("connect-src 'none';", "connect-src 'self';");
    expect(() => applyWebAnalytics(withoutCsp, TOKEN)).toThrow(/見つからない/);
  });
});

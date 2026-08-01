/**
 * 配信される index.html が持っていなければならないもの。
 *
 * どちらも「入っていないこと」に画面上の手がかりがない。壊れても誰も気づかない
 * ので、ファイルそのものを読んで固定する。
 */

import { describe, expect, it } from "vitest";

// 配信されるファイルそのものを読む（Vite の ?raw）。
import html from "../index.html?raw";

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

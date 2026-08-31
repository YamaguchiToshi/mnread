/**
 * 実物大見本の書体の結線（ADR-0018）。
 *
 * 見本は紙の上で「これが N pt の大きさである」と主張する計測器であり、刷る機械で
 * 大きさが変わってはならない。しかし壊れても画面には何の手がかりも出ない——
 * フォールバックの明朝で、少し違う大きさの見本が黙って刷られるだけである。
 * 50mm 校正バーも助けにならない（バーが検出するのは倍率のズレだけで、字面は動かない）。
 *
 * jsdom は字を組まないので、ここで固定できるのは結線までである。実際の墨の高さは
 * 印刷実機で測る（ADR-0018 の帰結。実測 0.9179 em）。
 *
 * tsconfig の `types` に node が入っているのは、このテストが配信されるファイルを
 * そのまま読むためである（vitest は CSS の `?raw` 取り込みを空文字にする）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** 配信されるファイルそのものを読む（vitest は CSS の取り込みを空にするため fs で読む）。 */
const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const css = readFileSync(at("../src/styles.css"), "utf8");

const FAMILY = "MNREAD Report Mincho";

/** @font-face 宣言そのものを取り出す。 */
const fontFace = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];

describe("実物大見本の書体（ADR-0018）", () => {
  it("見本用の書体を同梱している", () => {
    const declared = fontFace.filter((block) => block.includes(`"${FAMILY}"`));
    expect(declared).toHaveLength(1);
    expect(declared[0]).toContain(".woff2");
  });

  it("同梱書体はバンドルから出す（外部リクエストを増やさない。ADR-0017）", () => {
    // url() が同一オリジンでなければ、CSP `default-src 'self'` に阻まれて
    // 見本だけが黙ってフォールバックに落ちる。
    for (const block of fontFace) {
      expect(block).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
    }
  });

  it("見本の要素が同梱書体を最初に指す", () => {
    const rule = css.match(/\.specimen-text\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    // 先頭でなければ環境のフォントが勝ち、大きさが機械ごとに変わる。
    expect(rule?.[0]).toMatch(new RegExp(`font-family:\\s*"${FAMILY}"\\s*,`));
  });

  it("見本の文字が同梱書体の unicode-range に入っている", () => {
    // ここが食い違うと、字はフォールバックで出て大きさだけ変わる。
    const declared = fontFace.find((block) => block.includes(`"${FAMILY}"`)) ?? "";
    const ranges = [...declared.matchAll(/U\+([0-9a-fA-F]+)/g)].map((m) =>
      Number.parseInt(m[1]!, 16),
    );
    expect(ranges).toContain("読".codePointAt(0));
  });

  it("書体ファイルとライセンス全文が配布物に入っている", () => {
    // OFL 1.1 はライセンス全文の同梱を求める。public/ はビルド成果物へそのまま入る。
    expect(readFileSync(at("../public/OFL-NotoSerifJP.txt"), "utf8")).toContain(
      "SIL OPEN FONT LICENSE",
    );

    // 1文字のサブセットであること。全部入りを取り込むと数MBがバンドルに乗る。
    const font = readFileSync(at("../src/assets/mnread-report-mincho.woff2"));
    expect(font.byteLength).toBeGreaterThan(0);
    expect(font.byteLength).toBeLessThan(20 * 1024);
  });
});

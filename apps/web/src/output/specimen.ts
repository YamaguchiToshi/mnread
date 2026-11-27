/**
 * 実物大見本に刷る文字（SPEC §8.2.2）。対応表のみで、算術は持たない。
 *
 * 見本の文字はチャートの文字種に合わせる。MNREAD-Jk の読み材料はひらがなで
 * 組まれており（SPEC §3）、漢字の見本では患者が検査で読んだ文字と種類が合わない
 * （視能訓練士レビュー 2026-11-27）。
 *
 * **文字を替えても大きさは替えない。** ひらがなは漢字より字面が小さいが、見本の
 * 大きさは em に対して指定する（SPEC §5.7）。ラベルの「N pt」はどちらの文字でも
 * 同じ大きさを指す。
 *
 * ここに文字を足したら、同梱書体のサブセットにも入れること
 * （`scripts/build-specimen-font.py` の `SPECIMEN_CHARS` と `styles.css` の
 * `unicode-range`）。入っていない文字はフォールバックの明朝で黙って刷られ、
 * 大きさが機械ごとに変わる（ADR-0018）。`test/specimen-font.test.ts` が
 * この表の全文字について確かめる。
 */

import type { Variant } from "@mnread/core";

export const SPECIMEN_CHAR: Readonly<Record<Variant, string>> = {
  "MNREAD-J": "読",
  "MNREAD-Jk": "あ",
};

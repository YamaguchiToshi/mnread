/**
 * 紙面の見本を作るための合成データ（**開発ビルド専用**）
 *
 * 目的は組版の基準を1枚、リポジトリに残すことである。jsdom は組版も改ページも
 * 行わないため、紙面の正しさは紙にしか無い。次に紙面へ手を入れる者が「直す前は
 * こうだった」を確かめられるようにしておく。
 *
 * **原典の測定例は使わない。** 数値そのものは `packages/fixtures` に出所つきで
 * 転記済みだが、刷り上がった紙面を公開リポジトリに置くのは、原典 PDF を
 * 再配布しないという判断（`.gitignore`）と同じ線の上にある。見本の用途は
 * 「組版が見えること」であって、原典のデータである必要はない。
 *
 * **公開ビルドには入らない。** 入口は `import.meta.env.DEV` で閉じてあり、
 * Vite の本番ビルドでは定数 false に畳まれて経路ごと消える。見本データと
 * 「SAMPLE」の透かしは同じスイッチから出るので、**透かしのない見本**も
 * **透かしの付いた実検査**も作れない。片方だけを切り替える手段を設けない。
 *
 * 数値は**臨床的にありうる形**にする。教科書的にきれいな曲線は、紙面の見本
 * としては役に立たない。同じ秒数が並ぶプラトーも、誤り 0 のまま 0 cpm に落ちる
 * 小文字側も、実際の記録には出てこない。ここでは次を満たすように置いた。
 *
 *   - プラトーの速度はばらつく（240〜261 cpm、同じ値を並べない）
 *   - 小さくなるにつれて速度が落ち、**誤りが混じり始める**
 *   - 読めなくなる手前で 0 cpm に達し、そこで打ち切る
 *   - 視距離 20cm。低視力例の実際の測り方であり、かつ標準の 30cm と値が
 *     食い違うので、併記の段組——紙面でいちばん混む形——が見本に写る
 *
 * この形で CPS は補正後 1.18 logMAR あたりに来る。推奨サイズが 28pt / 35pt
 * となり、**見本の文字が実際の症例と同じ大きさで刷られる**。プラトーが小さい
 * 文字まで伸びる曲線を置くと、推奨サイズが 10pt 前後になり、実物大の見本が
 * 見本として機能しない。
 */

import { createSession, type SessionDraft } from "../session/state.js";

/**
 * 大きい側から順の記録（秒・誤り字数）。`null` は「提示したが1字も読めなかった」。
 *
 * 添字で並べるのは、チャート logMAR が 0.1 刻みの計算値で、
 * 0.7000000000000001 のような値と等値比較できないためである。
 * 表に無い行（これより小さい側）は未提示のまま残す＝そこで検査を打ち切った。
 */
const RECORD_BY_ROW: readonly (readonly [seconds: number, errors: number] | null)[] = [
  [7.2, 0], // 1.3  250 cpm
  [6.9, 0], // 1.2  261
  [7.1, 0], // 1.1  254
  [7.5, 0], // 1.0  240 ← ここまでがプラトー
  [8.9, 1], // 0.9  196
  [12.4, 1], // 0.8  140
  [21.0, 2], // 0.7   80
  null, // 0.6  0 cpm。ここで打ち切る
];

/**
 * 開発ビルドで `?sample` が付いているときだけ true。
 *
 * 公開ビルドでは `import.meta.env.DEV` が false に畳まれ、この関数は常に
 * false を返す（呼び出し側の分岐ごと消える）。
 */
export function sampleRequested(search: string = window.location.search): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).has("sample");
}

/**
 * 見本用のセッション。
 *
 * 検査条件は「紙面に出る欄が埋まっていること」を優先して選んである。ID は
 * 実在の記録と取り違えようのない文字列にする。
 */
export function sampleSession(): SessionDraft {
  const base = createSession("MNREAD-J");
  return {
    ...base,
    chartVersion: "SAMPLE",
    distanceText: "20",
    polarity: "black_on_white",
    eye: "right",
    sequenceDirection: "large_to_small",
    subjectId: "SAMPLE",
    testDate: "2026-04-01",
    rows: base.rows.map((row, i) => {
      const record = RECORD_BY_ROW[i];
      if (record === undefined) return row; // 未提示（打ち切り後）
      if (record === null) return { ...row, status: "attempted_unread" as const };
      const [seconds, errors] = record;
      return {
        ...row,
        status: "read" as const,
        timeText: String(seconds),
        errorText: String(errors),
      };
    }),
  };
}

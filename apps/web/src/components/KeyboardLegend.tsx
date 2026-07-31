/**
 * キー操作の凡例（Phase 3）
 *
 * 常時表示にしている。検者は検査中に画面から目を離すため、覚えていない操作を
 * 探しに行く余裕がない。ヘルプを開かせない。
 */

import type { JSX } from "react";

import { STATUS_LABEL, STATUS_ORDER } from "../session/state.js";

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["0–9 .", "数値を入力"],
  ["Enter", "確定して次の行の時間へ"],
  ["+", "同じ行の誤り数欄へ"],
  ["−", "1つ前の欄へ戻る"],
  ["*", "この行を「不読（0 cpm）」に"],
  ["/", "状態メニューを開く"],
  ["↑ ↓", "上下の行の同じ欄へ"],
  ["Backspace", "空欄なら前の行へ戻る"],
  ["Ctrl+Z", "取り消し"],
  ["Ctrl+Shift+Z", "やり直し"],
];

export function KeyboardLegend(): JSX.Element {
  return (
    <section className="legend" data-testid="keyboard-legend">
      <h2>キー操作</h2>
      <dl className="legend-list">
        {KEYS.map(([key, description]) => (
          <div key={key} className="legend-row">
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>

      <h3>状態メニュー（/ を押してから）</h3>
      <ol className="legend-statuses">
        {STATUS_ORDER.map((status, i) => (
          <li key={status}>
            <kbd>{i + 1}</kbd> {STATUS_LABEL[status]}
          </li>
        ))}
      </ol>
      <p className="legend-note">誤り数は既定 0 なので、通常は時間と Enter だけで進みます。</p>
    </section>
  );
}

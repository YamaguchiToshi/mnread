/**
 * セッション条件の入力（Phase 3）
 *
 * 氏名欄は設けない（SPEC §4.1）。識別は ID のみとする。
 */

import type { Eye, Polarity, SequenceDirection, Variant } from "@mnread/core";
import type { JSX } from "react";

import type { Action } from "../session/reducer.js";
import type { SessionDraft } from "../session/state.js";

export interface SessionHeaderProps {
  readonly draft: SessionDraft;
  readonly dispatch: (action: Action) => void;
}

export function SessionHeader({ draft, dispatch }: SessionHeaderProps): JSX.Element {
  return (
    <section className="session-header card" data-testid="session-header">
      <div className="card-head">
        <h2>検査条件</h2>
        <span className="detail">視距離は全行の補正後 logMAR を動かします</span>
      </div>

      <div className="field-grid">
        {/* 距離補正の入り口。ここが違うと19行すべての値がずれる */}
        <label className="field-strong">
          視距離（cm）
          <input
            type="text"
            inputMode="decimal"
            value={draft.distanceText}
            aria-label="視距離（cm）"
            onChange={(e) => dispatch({ type: "setDistance", text: e.target.value })}
          />
        </label>

        <label>
          チャート
          <select
            value={draft.variant}
            onChange={(e) =>
              dispatch({ type: "setVariant", variant: e.target.value as Variant })
            }
          >
            <option value="MNREAD-J">MNREAD-J（30文字）</option>
            <option value="MNREAD-Jk">MNREAD-Jk（24文字）</option>
          </select>
        </label>

        <label>
          チャート版
          <input
            type="text"
            value={draft.chartVersion}
            onChange={(e) => dispatch({ type: "setChartVersion", text: e.target.value })}
          />
        </label>

        <label>
          極性
          <select
            value={draft.polarity}
            onChange={(e) =>
              dispatch({ type: "setPolarity", polarity: e.target.value as Polarity })
            }
          >
            <option value="black_on_white">白地に黒</option>
            <option value="white_on_black">黒地に白</option>
          </select>
        </label>

        <label>
          眼
          <select
            value={draft.eye}
            onChange={(e) => dispatch({ type: "setEye", eye: e.target.value as Eye })}
          >
            <option value="both">両眼</option>
            <option value="right">右眼</option>
            <option value="left">左眼</option>
          </select>
        </label>

        <label>
          実施順
          <select
            value={draft.sequenceDirection}
            onChange={(e) =>
              dispatch({
                type: "setSequenceDirection",
                direction: e.target.value as SequenceDirection,
              })
            }
          >
            <option value="large_to_small">大→小（標準）</option>
            <option value="small_to_large">小→大</option>
          </select>
        </label>

        <label>
          被検者ID
          <input
            type="text"
            value={draft.subjectId}
            onChange={(e) => dispatch({ type: "setSubjectId", text: e.target.value })}
          />
        </label>

        <label>
          年齢
          <input
            type="text"
            inputMode="numeric"
            value={draft.ageText}
            onChange={(e) => dispatch({ type: "setAge", text: e.target.value })}
          />
        </label>

        <label>
          検査日
          <input
            type="date"
            value={draft.testDate}
            onChange={(e) => dispatch({ type: "setTestDate", text: e.target.value })}
          />
        </label>
      </div>

      <p className="no-name-note">
        氏名欄は設けません。データは端末に保存されず、明示的な書き出しでのみ外に出ます。
      </p>

      <label className="inline-toggle">
        <input
          type="checkbox"
          checked={draft.perRowDistance}
          onChange={() => dispatch({ type: "togglePerRowDistance" })}
        />
        行ごとに視距離を変えた
      </label>

      {draft.sequenceDirection === "small_to_large" && (
        <p className="notice" data-testid="reverse-order-notice">
          小→大の順で実施しています。解析時は文字サイズで整列するため結果は同じですが、
          記録用紙と並びが異なる点に注意してください。
        </p>
      )}
    </section>
  );
}

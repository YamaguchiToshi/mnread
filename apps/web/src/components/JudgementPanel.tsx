/**
 * 判定パネル（Phase 4）
 *
 * 検者の目視判定を確定させ、その由来を残すための画面（SPEC §8.4）。
 *
 * 規則:
 *   - 受け取る入力はプラトー点の集合だけ（ADR-0012）。CPS・MRS の欄は設けない
 *   - 値には必ず算出法 ID を添える（ADR-0006）
 *   - MRS は3方式すべてを出す（ADR-0005）
 *   - 自動値と異なる判定には理由を残させる。理由がなければ core が
 *     `OVERRIDE_REASON_MISSING` を立て、それがここに表示される
 *   - 外れ値は「削除」ではなく「除外として記録」する
 */

import type { Dispatch, JSX } from "react";

import { formatCpm, formatLogMAR } from "../format.js";
import { CPS_METHOD_LABEL, MRS_METHOD_LABEL, QUALITY_FLAG_LABEL } from "../labels.js";
import type { SessionView } from "../session/derive.js";
import type { Action } from "../session/reducer.js";
import type { SessionDraft } from "../session/state.js";

export interface JudgementPanelProps {
  readonly draft: SessionDraft;
  readonly view: SessionView;
  readonly dispatch: Dispatch<Action>;
}

export function JudgementPanel({
  draft,
  view,
  dispatch,
}: JudgementPanelProps): JSX.Element {
  if (!view.outcome.ok) {
    return (
      <section className="judgement judgement-blocked card" data-testid="judgement-panel">
        <div className="card-head">
          <h2>判定</h2>
        </div>
        <p className="blocked-note">
          入力エラーがあるため判定できません。入力画面で該当行を修正してください。
        </p>
      </section>
    );
  }

  const result = view.outcome.result;
  const { selection } = result;
  const judged = view.manualPlateauRows !== null;
  const manualEstimate = result.cps.find((e) => e.method === "manual_visual_2002");
  const autoEstimate = result.cps.find((e) => e.method === "plateau_sdev_v1");

  const curveRows = view.rows.filter((r) => r.speedCpm !== null && r.correctedLogMAR !== null);

  return (
    <section className="judgement card" data-testid="judgement-panel">
      <div className="card-head">
        <h2>判定</h2>
        <span className="detail">入力はプラトー点の選択だけ（ADR-0012）</span>
      </div>

      <p className="judgement-state" data-testid="judgement-state" data-judged={judged}>
        {judged ? (
          <>
            検者の目視判定が主値です（{CPS_METHOD_LABEL.manual_visual_2002}）。
          </>
        ) : (
          <>
            <strong>まだ検者の判定がありません。</strong>
            表示中の値は暫定的に自動値（{CPS_METHOD_LABEL[selection.cpsMethod]}）を
            主値としたものです。グラフの点を選ぶか、下の「自動値を採用」で確定してください。
          </>
        )}
      </p>

      <div className="judgement-actions">
        <button
          type="button"
          className={judged ? "btn" : "btn btn-primary"}
          data-testid="adopt-automatic"
          disabled={view.automaticPlateauRows.length === 0}
          onClick={() => dispatch({ type: "setPlateau", rows: view.automaticPlateauRows })}
        >
          自動値（SDev法 v1）をこの判定として採用
        </button>
        <button
          type="button"
          className="btn"
          data-testid="clear-judgement"
          disabled={!judged}
          onClick={() => dispatch({ type: "setPlateau", rows: null })}
        >
          判定を取り消す（未判定に戻す）
        </button>
      </div>

      {/* --- CPS：全算出法を併記。値だけの行を作らない（ADR-0006） --- */}
      <h3>臨界文字サイズ CPS</h3>
      <ul className="method-list" data-testid="judgement-cps">
        {result.cps.map((estimate) => (
          <li
            key={estimate.method}
            data-testid="cps-estimate"
            data-method={estimate.method}
            data-selected={estimate.method === selection.cpsMethod}
          >
            <span className="method-id">
              {CPS_METHOD_LABEL[estimate.method]}
              {estimate.method === selection.cpsMethod && (
                <span className="badge">主値</span>
              )}
              {estimate.estimable && (
                <span className="detail">
                  プラトー {estimate.plateauItemIndices.length} 点
                </span>
              )}
            </span>
            {estimate.estimable ? (
              <>
                <span className="method-value">
                  {formatLogMAR(estimate.cpsCorrectedLogMAR)}
                  {" "}
                  <span className="readout-unit">logMAR</span>
                </span>
                {estimate.extrapolated && (
                  <span className="detail warn">外挿推定（通常値として扱わない）</span>
                )}
              </>
            ) : (
              <span className="method-value-none">
                推定不能：{estimate.notEstimableReason ?? "理由不明"}
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* --- MRS：3方式すべて（ADR-0005） --- */}
      <h3>最大読書速度 MRS</h3>
      <ul className="method-list" data-testid="judgement-mrs">
        {result.mrs.map((mrs) => (
          <li key={mrs.method} data-testid="mrs-result" data-method={mrs.method}>
            <span className="method-id">
              {MRS_METHOD_LABEL[mrs.method]}
              {mrs.valueCpm !== null && (
                <span className="detail">
                  n={mrs.n}
                  {mrs.sdCpm === null ? "" : `、SD=${formatCpm(mrs.sdCpm)}`}
                </span>
              )}
            </span>
            {mrs.valueCpm === null ? (
              <span className="method-value-none">
                算出せず：{mrs.notApplicableReason ?? "理由不明"}
              </span>
            ) : (
              <span className="method-value">
                {formatCpm(mrs.valueCpm)}
                {" "}
                <span className="readout-unit">cpm</span>
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* --- 上書きの記録（SPEC §8.4） --- */}
      <h3>自動値との関係</h3>
      <p className="detail" data-testid="override-state" data-overrides={selection.overridesAutomatic}>
        {selection.overridesAutomatic
          ? "検者の判定は自動値と異なるプラトーを指しています。理由を記録してください。"
          : judged
            ? "検者の判定は自動値と同じプラトーを指しています。"
            : "検者の判定がないため、上書きは発生していません。"}
        {manualEstimate?.estimable === true && autoEstimate?.estimable === true && (
          <>
            {" "}
            （目視 {formatLogMAR(manualEstimate.cpsCorrectedLogMAR)} / 自動{" "}
            {formatLogMAR(autoEstimate.cpsCorrectedLogMAR)} logMAR）
          </>
        )}
      </p>
      <label className="override-reason">
        上書きの理由（出力に残ります）
        <textarea
          data-testid="override-reason"
          rows={2}
          value={draft.judgement.overrideReason}
          disabled={!selection.overridesAutomatic}
          onChange={(e) =>
            dispatch({ type: "setOverrideReason", text: e.currentTarget.value })
          }
        />
      </label>

      {/* --- 外れ値の除外（削除ではなく記録） --- */}
      <details className="exclusions">
        <summary>外れ値の除外（{draft.judgement.excludedRowIndices.length} 件）</summary>
        <p className="detail">
          点は消しません。除外として記録し、理由を出力に残します。除外した点は
          プラトーに含まれません。
        </p>
        <ul className="exclusion-list">
          {curveRows.map((row) => {
            const excluded = draft.judgement.excludedRowIndices.includes(row.rowIndex);
            return (
              <li key={row.rowIndex} data-testid="exclusion-row" data-row-index={row.rowIndex}>
                <label>
                  <input
                    type="checkbox"
                    checked={excluded}
                    onChange={(e) =>
                      dispatch(
                        e.currentTarget.checked
                          ? { type: "setExclusion", row: row.rowIndex, reason: "" }
                          : { type: "clearExclusion", row: row.rowIndex },
                      )
                    }
                  />
                  {formatLogMAR(row.correctedLogMAR)} logMAR / {formatCpm(row.speedCpm)} cpm
                </label>
                {excluded && (
                  <input
                    type="text"
                    className="exclusion-reason"
                    data-testid="exclusion-reason"
                    placeholder="除外の理由"
                    value={draft.judgement.exclusionReasons[row.rowIndex] ?? ""}
                    onChange={(e) =>
                      dispatch({
                        type: "setExclusion",
                        row: row.rowIndex,
                        reason: e.currentTarget.value,
                      })
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      </details>

      {result.requiresReview && (
        <div className="review-flag" data-testid="judgement-flags">
          <p>目視確認が必要です。</p>
          <ul>
            {result.qualityFlags.map((flag) => (
              <li key={flag} data-testid="quality-flag" data-flag={flag}>
                {QUALITY_FLAG_LABEL[flag]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * 検査中に見える自動参考値（Phase 3 — 読み取り専用）
 *
 * 目的は「その場で再測定を判断できること」であり、判定はしない。臨床の主値は
 * 検者の目視判定（`manual_visual_2002`）であり、その選択 UI は Phase 4 に入る。
 *
 * 規則:
 *   - 値には必ず算出法 ID を添える。「CPS 0.6 logMAR」単独を出さない（ADR-0006）
 *   - 入力エラーが1件でもある間は、部分的な結果を一切出さない（ADR-0004）
 *   - 数値はすべて core の返り値。桁を落とすのは表示直前だけ（ADR-0003 / SPEC §9）
 */

import type { JSX } from "react";

import { formatCpm, formatLogMAR, formatSignedLogMAR } from "../format.js";
import { CPS_METHOD_LABEL, MRS_METHOD_LABEL, QUALITY_FLAG_LABEL } from "../labels.js";
import type { SessionView } from "../session/derive.js";

export function LiveSummary({ view }: { readonly view: SessionView }): JSX.Element {
  if (!view.outcome.ok) {
    return (
      <section className="summary summary-blocked" data-testid="live-summary">
        <h2>自動参考値</h2>
        <p className="blocked-note">
          入力エラーがあるため、解析結果を表示しません。該当行を修正してください。
        </p>
      </section>
    );
  }

  const result = view.outcome.result;
  const ra = result.readingAcuity;

  return (
    <section className="summary" data-testid="live-summary">
      <h2>自動参考値</h2>
      <p className="summary-caveat">
        臨床の主値は検者の目視判定です。以下は検査中の目安であり、判定ではありません。
      </p>

      <dl className="summary-list">
        <dt>読書視力 RA</dt>
        <dd data-testid="summary-ra">
          {ra === null ? (
            "—"
          ) : (
            <>
              {ra.censored ? "≦ " : ""}
              {formatLogMAR(ra.raCorrectedLogMAR)} logMAR
              <span className="detail">
                （補正前 {formatLogMAR(ra.raChartLogMAR)}、距離補正{" "}
                {formatSignedLogMAR(ra.distanceCorrectionLogMAR)}、N={ra.attemptedItemCount}、E=
                {ra.cumulativeErrors}）
              </span>
              {ra.censored && (
                <span className="detail warn">
                  全く読めない行まで到達していないため下限値です。
                </span>
              )}
            </>
          )}
        </dd>

        <dt>臨界文字サイズ CPS</dt>
        <dd data-testid="summary-cps">
          {result.cps.length === 0 ? (
            "—"
          ) : (
            <ul className="method-list">
              {result.cps.map((estimate) => (
                <li key={estimate.method} data-testid="cps-estimate" data-method={estimate.method}>
                  <span className="method-id">{CPS_METHOD_LABEL[estimate.method]}</span>
                  {estimate.estimable ? (
                    <>
                      {formatLogMAR(estimate.cpsCorrectedLogMAR)} logMAR
                      {estimate.extrapolated && (
                        <span className="detail warn">外挿推定（通常値として扱わない）</span>
                      )}
                    </>
                  ) : (
                    <span className="detail">
                      推定不能：{estimate.notEstimableReason ?? "理由不明"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </dd>

        <dt>最大読書速度 MRS</dt>
        <dd data-testid="summary-mrs">
          <ul className="method-list">
            {result.mrs.map((mrs) => (
              <li key={mrs.method} data-testid="mrs-result" data-method={mrs.method}>
                <span className="method-id">{MRS_METHOD_LABEL[mrs.method]}</span>
                {mrs.valueCpm === null ? (
                  <span className="detail">
                    算出せず：{mrs.notApplicableReason ?? "理由不明"}
                  </span>
                ) : (
                  <>
                    {formatCpm(mrs.valueCpm)} cpm
                    <span className="detail">
                      n={mrs.n}
                      {mrs.sdCpm === null ? "" : `、SD=${formatCpm(mrs.sdCpm)}`}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </dd>
      </dl>

      {result.requiresReview && (
        <div className="review-flag" data-testid="review-flag">
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

      <p className="version-note">
        アルゴリズム版 {result.algorithmVersion} / 仕様版 {result.specVersion}
        （実測検証は Phase 5 で実施予定）
      </p>
    </section>
  );
}

/**
 * A4 患者・支援者向けレポート（SPEC §8.2.2）
 *
 * 規則:
 *   - 判読3ゾーン（SPEC §5.8）。境界は logMAR と MNREAD-J 相当ポイントの両方で示す
 *   - 推奨文字サイズ範囲は**ゾーンとは別枠**（ADR-0013）。CPS は「快適さの保証値」
 *     ではなく「最大速度を支える最小サイズ」であるため、両者を1つの数字に混ぜない
 *   - **氏名を入れない。** 患者に渡す紙であり、ID・実施日・測定距離までとする
 *   - 参考値であって診断ではない旨と、ポイント値がフォント依存である旨を必ず載せる
 *   - CPS の算出法 ID を必ず併記する（ADR-0006）
 *
 * 印刷は `window.print()` と `@media print` による。SVG がベクタのまま出るため、
 * ラスタ化を伴う手段は用いない（PLAN §2）。
 */

import type { AnalysisResult, ReadingZone } from "@mnread/core";
import type { JSX } from "react";

import { SpeedCurve } from "../components/SpeedCurve.js";
import { formatFixed, formatLogMAR } from "../format.js";
import { CPS_METHOD_LABEL, CPS_METHOD_SHORT, EYE_LABEL, ZONE_LABEL, ZONE_SHORT } from "../labels.js";
import type { RowView } from "../session/derive.js";

export interface PatientReportProps {
  readonly result: AnalysisResult;
  readonly rows: readonly RowView[];
  /** グラフに重ねるプラトー（rows の添字） */
  readonly plateauRows: readonly number[];
}

export function PatientReport({
  result,
  rows,
  plateauRows,
}: PatientReportProps): JSX.Element {
  const input = result.input;
  const zones = result.zones;
  const support = result.supportRange;
  const selected = result.cps.find((e) => e.method === result.selection.cpsMethod);

  return (
    <article className="report" data-testid="patient-report">
      <header className="report-header">
        <h1>読書の評価結果</h1>
        <p className="report-meta" data-testid="report-meta">
          {input.variant}
          {input.subject?.subjectId === undefined
            ? ""
            : ` / ID ${input.subject.subjectId}`}
          {input.subject?.testDate === undefined
            ? ""
            : ` / ${input.subject.testDate}`}
          {` / ${EYE_LABEL[input.eye]} / 測定距離 ${formatFixed(input.viewingDistanceCm, 0)} cm`}
        </p>
        <p className="report-noname">
          このシートに氏名は記載していません。ID でご確認ください。
        </p>
      </header>

      {/* --- 判読ゾーン --- */}
      <section className="report-section">
        <h2>文字の大きさと読みやすさ</h2>
        {zones === null ? (
          <p data-testid="zones-unavailable">
            今回の測定では、最も速く読める文字サイズ（臨界文字サイズ）を確定できませんでした。
            そのため、大きさごとの目安はお出ししていません。
          </p>
        ) : (
          <>
            <table className="zone-table" data-testid="zone-table">
              <thead>
                <tr>
                  <th scope="col">区分</th>
                  <th scope="col">読みやすさ</th>
                  <th scope="col">文字の大きさ（MNREAD-J相当）</th>
                  <th scope="col">logMAR</th>
                </tr>
              </thead>
              <tbody>
                {zones.zones.map((zone) => (
                  <tr
                    key={zone.id}
                    className={`zone-row zone-${zone.id}`}
                    data-testid="zone-row"
                    data-zone={zone.id}
                    data-empty={zone.empty}
                  >
                    <th scope="row">{ZONE_SHORT[zone.id]}</th>
                    <td>{ZONE_LABEL[zone.id]}</td>
                    <td>{pointRange(zone)}</td>
                    <td>{logMARRange(zone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="report-note">
              区切りは、読める限界の大きさ（読書視力{" "}
              {formatLogMAR(zones.raCorrectedLogMAR)} logMAR
              {zones.raCensored ? "、これより小さい字は未確認" : ""}）と、
              最も速く読める最小の大きさ（臨界文字サイズ{" "}
              {formatLogMAR(zones.cpsCorrectedLogMAR)} logMAR、
              {CPS_METHOD_LABEL[zones.cpsMethod]}による）です。
            </p>
            {zones.raAboveCps && (
              <p className="report-warn" data-testid="zone-degenerate">
                今回は読み間違いが多く、区分どおりに分かれない結果でした。担当者と一緒にご確認ください。
              </p>
            )}
          </>
        )}
      </section>

      {/* --- 推奨サイズ：ゾーンとは別枠（ADR-0013） --- */}
      {support !== null && (
        <section className="report-section" data-testid="support-range">
          <h2>用意するとよい文字の大きさ</h2>
          <dl className="support-list">
            <dt>下限</dt>
            <dd>
              <strong>{formatFixed(support.lowerPoint, 0)} ポイント</strong>
              <span className="detail">
                いちばん速く読める大きさの下限です。これより小さいと読む速さが落ちます。
              </span>
            </dd>
            <dt>ゆとりを見る場合</dt>
            <dd>
              <strong>{formatFixed(support.upperPoint, 0)} ポイント</strong>
              <span className="detail">
                下限の約 {formatFixed(support.marginRatio, 2)} 倍。長く読むときや、
                照明・体調が変わる場面ではこちらを目安にしてください。
              </span>
            </dd>
          </dl>
          {result.cpsConversion !== null && (
            <p className="report-note" data-testid="magnification">
              新聞の文字（1M）を基準にすると、およそ{" "}
              {formatFixed(result.cpsConversion.mValue, 1)} 倍の大きさにあたります。
            </p>
          )}
        </section>
      )}

      {/* --- グラフ --- */}
      <section className="report-section report-figure">
        <h2>文字の大きさと読む速さ</h2>
        <SpeedCurve
          rows={rows}
          focusedRowIndex={null}
          overlay={{
            plateauRows,
            manual: result.selection.cpsMethod === "manual_visual_2002",
            cpsMethodLabel: CPS_METHOD_SHORT[result.selection.cpsMethod],
            cpsCorrectedLogMAR: selected?.estimable === true ? selected.cpsCorrectedLogMAR : null,
            mrsCpm: result.mrs.find((m) => m.method === "arithmetic")?.valueCpm ?? null,
            excludedRows: [],
          }}
        />
      </section>

      <footer className="report-footer">
        <p>
          この結果は、読書に必要な文字の大きさを見積もるための<strong>参考値</strong>です。
          診断ではありません。
        </p>
        <p>
          ポイント（pt）の値は MNREAD-J のチャートの文字設計に対応した相当値です。
          書体（フォント）によって同じポイント数でも見え方が変わるため、実物で確かめてください。
        </p>
        <p className="report-version">
          仕様 {result.specVersion} / アルゴリズム {result.algorithmVersion}
          （院内ツール。実測による検証は継続中）
        </p>
      </footer>
    </article>
  );
}

/* ---------------------------------------------------------- */

function pointRange(zone: ReadingZone): string {
  const min = zone.minPoint;
  const max = zone.maxPoint;
  if (min === null && max !== null) return `${formatFixed(max, 0)} pt より小さい`;
  if (min !== null && max === null) return `${formatFixed(min, 0)} pt 以上`;
  if (min === null || max === null) return "—";
  if (zone.empty) return "該当なし";
  return `${formatFixed(min, 0)} 〜 ${formatFixed(max, 0)} pt`;
}

function logMARRange(zone: ReadingZone): string {
  const min = zone.minCorrectedLogMAR;
  const max = zone.maxCorrectedLogMAR;
  if (min === null && max !== null) return `< ${formatLogMAR(max)}`;
  if (min !== null && max === null) return `≧ ${formatLogMAR(min)}`;
  if (min === null || max === null) return "—";
  if (zone.empty) return "該当なし";
  return `${formatLogMAR(min)} 〜 ${formatLogMAR(max)}`;
}

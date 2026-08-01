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
 * 紙面の設計:
 *   - **上端はレターヘッド用紙と院印のために空ける。** 施設名の欄は設けない。
 *   - 検査条件は文章に流さず表にする。診療記録へ転記する側が拾えることを優先する。
 *   - **推奨サイズは実物大の見本を添える。** 「35 ポイント」という数字は、患者にも
 *     支援者にも大きさとして伝わらない。pt は物理単位なので、印刷倍率さえ 100% なら
 *     紙の上で正しい大きさになる——その前提が崩れていないことを受け取った側が
 *     確かめられるよう、50 mm の校正目盛りを併せて刷る。
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
        <p className="report-lede">
          MNREAD 読書チャートで、文字の大きさごとに読む速さを測った結果です。
        </p>
      </header>

      {/* 検査条件。文章にすると転記のときに拾い落とすので、表で持たせる */}
      <dl className="report-meta" data-testid="report-meta">
        <div>
          <dt>実施日</dt>
          <dd>{input.subject?.testDate ?? "—"}</dd>
        </div>
        <div>
          <dt>ID</dt>
          <dd>{input.subject?.subjectId ?? "—"}</dd>
        </div>
        <div>
          <dt>眼</dt>
          <dd>{EYE_LABEL[input.eye]}</dd>
        </div>
        <div>
          <dt>チャート</dt>
          <dd>{input.variant}</dd>
        </div>
        <div>
          <dt>チャート版</dt>
          <dd>{input.chartVersion === "" ? "—" : input.chartVersion}</dd>
        </div>
        <div>
          <dt>測定距離</dt>
          <dd>{formatFixed(input.viewingDistanceCm, 0)} cm</dd>
        </div>
      </dl>
      <p className="report-noname">
        このシートに氏名は記載していません。ID でご確認ください。
      </p>

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
                    <td className="zone-num">{pointRange(zone)}</td>
                    <td className="zone-num">{logMARRange(zone)}</td>
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

      {/*
        紙面の下半分を2段に割る。

        1段組では推奨サイズ・実物大見本・曲線が A4 に収まらず、曲線だけが2枚目へ
        送られていた（患者に渡す紙が2枚になり、しかも2枚目はほぼ空く）。曲線は
        SPEC §8.2.2 の必須項目なので落とせない。「どの大きさを用意するか」と
        「その根拠になった測定」を左右に並べるのは、読み手にとっても自然である。
      */}
      <div className="report-columns">
      {/* --- 推奨サイズ：ゾーンとは別枠（ADR-0013） --- */}
      {support !== null && (
        <section className="report-section" data-testid="support-range">
          <h2>用意するとよい文字の大きさ</h2>
          <dl className="support-list">
            <div className="support-item">
              <dt>下限</dt>
              <dd>
                <strong>{formatFixed(support.lowerPoint, 0)}</strong>
                <span className="support-unit">ポイント</span>
                <span className="detail">
                  いちばん速く読める大きさの下限です。これより小さいと読む速さが落ちます。
                </span>
              </dd>
            </div>
            <div className="support-item">
              <dt>ゆとりを見る場合</dt>
              <dd>
                <strong>{formatFixed(support.upperPoint, 0)}</strong>
                <span className="support-unit">ポイント</span>
                <span className="detail">
                  下限の約 {formatFixed(support.marginRatio, 2)} 倍。長く読むときや、
                  照明・体調が変わる場面ではこちらを目安にしてください。
                </span>
              </dd>
            </div>
          </dl>

          {/*
            実物大の見本。フォントサイズには core が返した値をそのまま渡す
            （丸めるのは横のラベルだけ。ADR-0003）。
          */}
          <div className="specimen" data-testid="specimen">
            <p className="specimen-head">実物大の見本（この紙を 100% で印刷した場合）</p>
            <div className="specimen-rows">
              {/*
                見本は1文字にする。推奨サイズが大きい患者ほど文字を並べたときの
                幅が効いてきて、2文字だと紙幅を越えて切れる。大きさを判断するには
                1文字で足りる。
              */}
              <span className="specimen-item">
                <span className="specimen-label">
                  下限
                  <b>{formatFixed(support.lowerPoint, 0)} pt</b>
                </span>
                <span
                  className="specimen-text"
                  style={{ fontSize: `${String(support.lowerPoint)}pt` }}
                  aria-hidden="true"
                >
                  読
                </span>
              </span>
              <span className="specimen-item">
                <span className="specimen-label">
                  ゆとり
                  <b>{formatFixed(support.upperPoint, 0)} pt</b>
                </span>
                <span
                  className="specimen-text"
                  style={{ fontSize: `${String(support.upperPoint)}pt` }}
                  aria-hidden="true"
                >
                  読
                </span>
              </span>
            </div>
            <div className="specimen-scale">
              <span className="specimen-ruler" aria-hidden="true" />
              <p className="specimen-scale-note">
                目盛りの全長が 50 mm なら実物大です。短ければ、倍率 100% で刷り直してください。
              </p>
            </div>
          </div>

          {result.cpsConversion !== null && (
            <p className="report-note" data-testid="magnification">
              新聞の文字（1M）を基準にすると、およそ{" "}
              {formatFixed(result.cpsConversion.mValue, 1)} 倍の大きさにあたります。
            </p>
          )}
        </section>
      )}

      {/* --- グラフ（SPEC §8.2.2 の必須項目。ベクタのまま刷る） --- */}
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
      </div>

      <footer className="report-footer">
        <p>
          この結果は、読書に必要な文字の大きさを見積もるための<strong>参考値</strong>です。
          診断ではありません。
        </p>
        <p>
          ポイント（pt）の値は MNREAD-J のチャートの文字設計に対応した相当値です。
          {/* 見本が出ていない検査で「見本は明朝体」と書くと、ない紙面を指すことになる */}
          {support !== null && "見本は検査と同じ明朝体で刷っています。"}
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

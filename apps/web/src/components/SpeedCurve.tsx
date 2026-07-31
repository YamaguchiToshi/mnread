/**
 * 読書速度曲線（Phase 3 — 読み取り専用）
 *
 * 軸は SPEC §8.3 / ADR-0011: 横軸 = 距離補正後 logMAR、
 * 縦軸 = 読書速度 cpm（**常用対数目盛**）。目盛は対数のみとし、線形は用意しない。
 *
 * 対数目盛は、公式マニュアル図4・ミネソタ大学の原著論文と MNREAD アプリ・
 * 曲線フィットが行われる空間、のいずれとも一致する唯一の選択である。検者は
 * この形を見慣れており、目視判定が臨床の主値である以上（ADR-0006）、見慣れた
 * 形を提示することそのものに価値がある。
 *
 * **0 cpm は捨てない。** 対数目盛は 0 を載せられないので、軸を分断した専用の帯を
 * 下段に設けて描く。原典の図4 は 0.5 logMAR の 0 cpm 点を落としており（それが
 * この患者の読書視力を決めた境界である）、帯はその欠落だけを埋める。
 *
 * ライブラリを使わず SVG を自前で描くのは、外部依存をゼロにしてオフラインを担保し、
 * 印刷時にベクタのまま出すためである（PLAN §2）。
 *
 * **描くのは測定値だけである。** CPS・MRS の線は算出結果であり、入力エラーがある
 * 間は表示しない（ADR-0004）。プラトーのクリック選択とドラッグ調整は Phase 4。
 */

import type { JSX } from "react";

import { formatCpm, formatLogMAR } from "../format.js";
import type { RowView } from "../session/derive.js";

const WIDTH = 640;
const HEIGHT = 400;
const MARGIN = { top: 16, right: 16, bottom: 48, left: 56 } as const;

const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

/** 0 cpm の帯の高さと、対数領域から切り離す隙間。 */
const ZERO_ROW_HEIGHT = 22;
const AXIS_BREAK_GAP = 14;

/** 対数目盛の上端の桁。原典 図4 に合わせ 10^3 = 1000 cpm を既定とする。 */
const DEFAULT_TOP_EXPONENT = 3;

export interface SpeedCurveProps {
  readonly rows: readonly RowView[];
  /** 強調表示する行（入力中の行）。null なら強調しない */
  readonly focusedRowIndex: number | null;
}

interface PlottedRow {
  readonly rowIndex: number;
  readonly logMAR: number;
  readonly speedCpm: number;
}

export function SpeedCurve({ rows, focusedRowIndex }: SpeedCurveProps): JSX.Element {
  // 横軸は全19段を常に覆う。点が増えるたびに軸が動くと形の変化が読めない。
  const logMARs = rows
    .map((r) => r.correctedLogMAR)
    .filter((v): v is number => v !== null);
  const xMin = logMARs.length === 0 ? -0.5 : Math.min(...logMARs);
  const xMax = logMARs.length === 0 ? 1.3 : Math.max(...logMARs);
  const xSpan = xMax - xMin || 1;
  const toX = (logMAR: number): number =>
    MARGIN.left + ((logMAR - xMin) / xSpan) * PLOT_WIDTH;

  const plotted: readonly PlottedRow[] = rows
    .filter(
      (r): r is RowView & { correctedLogMAR: number; speedCpm: number } =>
        r.correctedLogMAR !== null && r.speedCpm !== null,
    )
    .map((r) => ({
      rowIndex: r.rowIndex,
      logMAR: r.correctedLogMAR,
      speedCpm: r.speedCpm,
    }))
    .sort((a, b) => a.logMAR - b.logMAR);

  const positives = plotted.filter((p) => p.speedCpm > 0);
  const zeros = plotted.filter((p) => p.speedCpm <= 0);

  /* ---- 縦軸 ---- */

  // 目盛の桁範囲。実測が 1 cpm を下回るときは下へ桁を延ばす。
  // 目盛の外へ点を丸め込まない（ADR-0011）。
  const speeds = positives.map((p) => p.speedCpm);
  const topExponent =
    speeds.length === 0
      ? DEFAULT_TOP_EXPONENT
      : Math.max(DEFAULT_TOP_EXPONENT, Math.ceil(Math.log10(Math.max(...speeds))));
  const bottomExponent =
    speeds.length === 0 ? 0 : Math.min(0, Math.floor(Math.log10(Math.min(...speeds))));

  const logTop = MARGIN.top;
  const logBottom = MARGIN.top + PLOT_HEIGHT - ZERO_ROW_HEIGHT - AXIS_BREAK_GAP;
  const zeroY = MARGIN.top + PLOT_HEIGHT - ZERO_ROW_HEIGHT / 2;

  const toY = (cpm: number): number => {
    if (cpm <= 0) return zeroY;
    const ratio = (Math.log10(cpm) - bottomExponent) / (topExponent - bottomExponent);
    return logBottom - ratio * (logBottom - logTop);
  };

  const yTicks = Array.from({ length: topExponent - bottomExponent + 1 }, (_, i) =>
    10 ** (bottomExponent + i),
  );

  /* ---- 折れ線 ---- */

  // 0 cpm の点は線に含めない。対数領域と帯をまたぐ線分は傾きに意味を持たない
  // ため（ADR-0011）。点そのものは描く。
  const path = positives
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.logMAR)} ${toY(p.speedCpm)}`)
    .join(" ");

  const xTicks = rows
    .filter((r) => r.correctedLogMAR !== null)
    .filter((_, i) => i % 2 === 0)
    .map((r) => ({ logMAR: r.correctedLogMAR as number, chart: r.chartLogMAR }));

  return (
    <figure className="curve">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="読書速度曲線"
        data-testid="speed-curve"
        data-point-count={plotted.length}
        data-zero-count={zeros.length}
        data-x-min={xMin}
        data-x-max={xMax}
        data-y-bottom-exponent={bottomExponent}
        data-y-top-exponent={topExponent}
      >
        {yTicks.map((cpm) => (
          <g key={cpm}>
            <line
              className="grid"
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_WIDTH}
              y1={toY(cpm)}
              y2={toY(cpm)}
            />
            <text
              className="tick"
              x={MARGIN.left - 8}
              y={toY(cpm)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {cpm}
            </text>
          </g>
        ))}

        <g data-testid="zero-band">
          {/* 0 の帯。対数領域と切り離してあることが一目でわかるようにする */}
          <line
            className="grid"
            x1={MARGIN.left}
            x2={MARGIN.left + PLOT_WIDTH}
            y1={zeroY}
            y2={zeroY}
          />
          <text
            className="tick"
            x={MARGIN.left - 8}
            y={zeroY}
            textAnchor="end"
            dominantBaseline="middle"
          >
            0
          </text>
          {/* 軸の分断記号 */}
          <path
            className="axis-break"
            d={`M${MARGIN.left - 5} ${logBottom + 4} l10 -4 M${MARGIN.left - 5} ${logBottom + 10} l10 -4`}
            fill="none"
          />
        </g>

        <line
          className="axis"
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_WIDTH}
          y1={logBottom}
          y2={logBottom}
        />
        <line
          className="axis"
          x1={MARGIN.left}
          x2={MARGIN.left}
          y1={MARGIN.top}
          y2={logBottom}
        />
        <line
          className="axis"
          x1={MARGIN.left}
          x2={MARGIN.left}
          y1={zeroY - ZERO_ROW_HEIGHT / 2}
          y2={zeroY + ZERO_ROW_HEIGHT / 2}
        />

        {xTicks.map((tick) => (
          <text
            key={tick.chart}
            className="tick"
            x={toX(tick.logMAR)}
            y={MARGIN.top + PLOT_HEIGHT + 18}
            textAnchor="middle"
          >
            {formatLogMAR(tick.logMAR)}
          </text>
        ))}

        {positives.length >= 2 && <path className="curve-line" d={path} fill="none" />}

        {plotted.map((p) => (
          <circle
            key={p.rowIndex}
            className={
              p.speedCpm === 0
                ? "point point-zero"
                : p.rowIndex === focusedRowIndex
                  ? "point point-focused"
                  : "point"
            }
            cx={toX(p.logMAR)}
            cy={toY(p.speedCpm)}
            r={p.rowIndex === focusedRowIndex ? 6 : 4}
            data-testid="curve-point"
            data-row-index={p.rowIndex}
            data-logmar={p.logMAR}
            data-cpm={p.speedCpm}
            data-zero={p.speedCpm === 0}
          >
            <title>{`${formatLogMAR(p.logMAR)} logMAR / ${formatCpm(p.speedCpm)} cpm`}</title>
          </circle>
        ))}

        <text
          className="axis-label"
          x={MARGIN.left + PLOT_WIDTH / 2}
          y={HEIGHT - 8}
          textAnchor="middle"
        >
          文字サイズ（距離補正後 logMAR、右ほど大きい）
        </text>
        <text
          className="axis-label"
          transform={`translate(14 ${MARGIN.top + PLOT_HEIGHT / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          読書速度（cpm）
        </text>
      </svg>

      <figcaption>
        描画するのは測定値のみ。欠測は描かない。0 cpm（不読）は対数目盛に載らないため、
        軸を分けて下段に描いている。CPS・MRS の判定線は Phase 4 で加える。
      </figcaption>
    </figure>
  );
}

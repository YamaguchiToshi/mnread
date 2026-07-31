/**
 * 読書時間の副グラフ（SPEC §8.3.1、原典 図3）
 *
 * 横軸 = 距離補正後 logMAR、縦軸 = 読書時間（秒、常用対数目盛）。
 *
 * **記録した量そのものを見るための図である。** 読書速度は $60(n_0-e)/t$ で導いた量で
 * あり、原典が図3 で時間軸の用紙を用意しているのは、検者が書き取った値の形を
 * そのまま確認できるようにするためである。転記誤り（桁違い・行のずれ）は、速度に
 * 変換したあとより時間のまま見たほうが気づきやすい。
 *
 * 判定線（CPS・MRS）は引かない。判定は主グラフで行う。
 *
 * 時間を持たない行は描かない。0 cpm の行は「全く読めなかった」記録であって
 * 読書時間の測定値ではないため、この図には現れない（主グラフの 0 帯にのみ出る）。
 */

import type { JSX } from "react";

import { formatLogMAR, formatSeconds } from "../format.js";
import type { RowView } from "../session/derive.js";

const WIDTH = 640;
const HEIGHT = 240;
const MARGIN = { top: 12, right: 16, bottom: 40, left: 56 } as const;

const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

/**
 * 目盛の既定の桁範囲。原典 図3 の用紙は 1.0〜120 秒であり、
 * 10^0〜10^2 がこれを覆う。実測がこれを外れたら桁単位で延ばす。
 */
const DEFAULT_BOTTOM_EXPONENT = 0;
const DEFAULT_TOP_EXPONENT = 2;

export interface TimeCurveProps {
  readonly rows: readonly RowView[];
  readonly focusedRowIndex?: number | null;
}

interface PlottedTime {
  readonly rowIndex: number;
  readonly logMAR: number;
  readonly timeSec: number;
}

export function TimeCurve({ rows, focusedRowIndex = null }: TimeCurveProps): JSX.Element {
  const logMARs = rows
    .map((r) => r.correctedLogMAR)
    .filter((v): v is number => v !== null);
  const xMin = logMARs.length === 0 ? -0.5 : Math.min(...logMARs);
  const xMax = logMARs.length === 0 ? 1.3 : Math.max(...logMARs);
  const xSpan = xMax - xMin || 1;
  const toX = (logMAR: number): number =>
    MARGIN.left + ((logMAR - xMin) / xSpan) * PLOT_WIDTH;

  // 「読んだ」行の時間だけを描く。行にエラーがあるあいだは描かない
  // （速度と同じく、検証を通っていない値を図に載せない）。
  const plotted: readonly PlottedTime[] = rows
    .filter(
      (r): r is RowView & { correctedLogMAR: number; timeSec: number } =>
        r.correctedLogMAR !== null && r.timeSec !== null && r.timeSec > 0,
    )
    .map((r) => ({
      rowIndex: r.rowIndex,
      logMAR: r.correctedLogMAR,
      timeSec: r.timeSec,
    }))
    .sort((a, b) => a.logMAR - b.logMAR);

  const times = plotted.map((p) => p.timeSec);
  const bottomExponent =
    times.length === 0
      ? DEFAULT_BOTTOM_EXPONENT
      : Math.min(DEFAULT_BOTTOM_EXPONENT, Math.floor(Math.log10(Math.min(...times))));
  const topExponent =
    times.length === 0
      ? DEFAULT_TOP_EXPONENT
      : Math.max(DEFAULT_TOP_EXPONENT, Math.ceil(Math.log10(Math.max(...times))));

  const toY = (sec: number): number => {
    const ratio = (Math.log10(sec) - bottomExponent) / (topExponent - bottomExponent);
    return MARGIN.top + PLOT_HEIGHT - ratio * PLOT_HEIGHT;
  };

  const yTicks = Array.from({ length: topExponent - bottomExponent + 1 }, (_, i) =>
    10 ** (bottomExponent + i),
  );

  const path = plotted
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.logMAR)} ${toY(p.timeSec)}`)
    .join(" ");

  const xTicks = rows
    .filter((r) => r.correctedLogMAR !== null)
    .filter((_, i) => i % 2 === 0)
    .map((r) => ({ logMAR: r.correctedLogMAR as number, chart: r.chartLogMAR }));

  return (
    <figure className="curve curve-secondary">
      <figcaption className="curve-title">読書時間（副表示・原典 図3）</figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="読書時間曲線"
        data-testid="time-curve"
        data-point-count={plotted.length}
        data-y-bottom-exponent={bottomExponent}
        data-y-top-exponent={topExponent}
      >
        {yTicks.map((sec) => (
          <g key={sec}>
            <line
              className="grid"
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_WIDTH}
              y1={toY(sec)}
              y2={toY(sec)}
            />
            <text
              className="tick"
              x={MARGIN.left - 8}
              y={toY(sec)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {sec}
            </text>
          </g>
        ))}

        <line
          className="axis"
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_WIDTH}
          y1={MARGIN.top + PLOT_HEIGHT}
          y2={MARGIN.top + PLOT_HEIGHT}
        />
        <line
          className="axis"
          x1={MARGIN.left}
          x2={MARGIN.left}
          y1={MARGIN.top}
          y2={MARGIN.top + PLOT_HEIGHT}
        />

        {xTicks.map((tick) => (
          <text
            key={tick.chart}
            className="tick"
            x={toX(tick.logMAR)}
            y={MARGIN.top + PLOT_HEIGHT + 16}
            textAnchor="middle"
          >
            {formatLogMAR(tick.logMAR)}
          </text>
        ))}

        {plotted.length >= 2 && <path className="curve-line" d={path} fill="none" />}

        {plotted.map((p) => (
          <circle
            key={p.rowIndex}
            className={p.rowIndex === focusedRowIndex ? "point point-focused" : "point"}
            cx={toX(p.logMAR)}
            cy={toY(p.timeSec)}
            r={p.rowIndex === focusedRowIndex ? 6 : 4}
            data-testid="time-point"
            data-row-index={p.rowIndex}
            data-logmar={p.logMAR}
            data-seconds={p.timeSec}
          >
            <title>{`${formatLogMAR(p.logMAR)} logMAR / ${formatSeconds(p.timeSec)} 秒`}</title>
          </circle>
        ))}

        <text
          className="axis-label"
          x={MARGIN.left + PLOT_WIDTH / 2}
          y={HEIGHT - 6}
          textAnchor="middle"
        >
          文字サイズ（距離補正後 logMAR）
        </text>
        <text
          className="axis-label"
          transform={`translate(14 ${MARGIN.top + PLOT_HEIGHT / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          読書時間（秒）
        </text>
      </svg>

      <figcaption>
        記録した読書時間そのもの。速度に直す前の形を確認するための図で、判定線は引かない。
        全く読めなかった行（0 cpm）は読書時間の測定値を持たないため現れない。
      </figcaption>
    </figure>
  );
}

/**
 * 読書速度曲線（主グラフ）
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
 * **判定線は overlay として渡されたときだけ描く。** CPS・MRS は算出結果であり、
 * 入力エラーがある間は表示しない（ADR-0004）。入力画面は overlay を渡さず、
 * 測定値だけを描く。
 *
 * **対話はプラトー点の選択だけである（ADR-0012）。** CPS 境界のドラッグも、
 * 「どの実測サイズからプラトーとみなすか」を指す操作として P に写す。MRS の線に
 * ハンドルはない。P の平均そのものであり、独立に動かせてはならない。
 */

import {
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { formatCpm, formatLogMAR } from "../format.js";
import type { RowView } from "../session/derive.js";

const WIDTH = 640;
const HEIGHT = 400;
/*
 * 左余白は縦軸の目盛（最大 "1000"）と軸名を並べて置ける幅。A4 レポートでは図が
 * 段幅（約85mm）まで縮み、文字を読める大きさに拡大する必要がある。56 では
 * 拡大した目盛が軸名に重なった。
 */
const MARGIN = { top: 16, right: 24, bottom: 48, left: 70 } as const;

const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

/** 0 cpm の帯の高さと、対数領域から切り離す隙間。 */
const ZERO_ROW_HEIGHT = 22;
const AXIS_BREAK_GAP = 14;

/** 対数目盛の上端の桁。原典 図4 に合わせ 10^3 = 1000 cpm を既定とする。 */
const DEFAULT_TOP_EXPONENT = 3;

/**
 * 判定結果の重ね描き。数値はすべて core の返り値であり、この層では計算しない
 * （ADR-0010）。
 */
export interface CurveOverlay {
  /** プラトーに含まれる行（rows の添字） */
  readonly plateauRows: readonly number[];
  /** 検者の判定によるものか。false なら自動値の暫定表示 */
  readonly manual: boolean;
  /** 凡例に出す算出法。値だけを出さないための必須項目（ADR-0006） */
  readonly cpsMethodLabel: string;
  readonly cpsCorrectedLogMAR: number | null;
  /** プラトー内速度の算術平均（標準値）。他2方式は判定パネルに併記する */
  readonly mrsCpm: number | null;
  /** 外れ値として除外された行 */
  readonly excludedRows: readonly number[];
}

/** 対話。渡さなければ読み取り専用。 */
export interface CurveInteraction {
  /** 点をプラトーに出し入れする */
  readonly onTogglePoint: (rowIndex: number) => void;
  /** CPS 境界をこの行の文字サイズへ移す */
  readonly onMoveBoundary: (rowIndex: number) => void;
}

export interface SpeedCurveProps {
  readonly rows: readonly RowView[];
  /** 強調表示する行（入力中の行）。null なら強調しない */
  readonly focusedRowIndex: number | null;
  readonly overlay?: CurveOverlay | null;
  readonly interaction?: CurveInteraction | null;
}

interface PlottedRow {
  readonly rowIndex: number;
  readonly logMAR: number;
  readonly speedCpm: number;
}

/** 凡例の印。図中の点と同じクラスで描き、見た目がずれないようにする。 */
function Swatch({ className }: { readonly className: string }): JSX.Element {
  return (
    <svg className="legend-swatch" viewBox="0 0 18 18" aria-hidden="true">
      <circle className={className} cx={9} cy={9} r={6} />
    </svg>
  );
}

export function SpeedCurve({
  rows,
  focusedRowIndex,
  overlay = null,
  interaction = null,
}: SpeedCurveProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);

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

  /*
   * 補助目盛（各桁の 2〜9）。
   *
   * 主目盛だけの対数軸は、点が桁のどのあたりにいるのかを目測させる。プラトーが
   * 「揃っている」かどうかは、まさにその目測で判断される。線は主目盛より薄くし、
   * 形の読み取りを助ける以上には出しゃばらせない。
   */
  const yMinorTicks: number[] = [];
  for (let e = bottomExponent; e < topExponent; e += 1) {
    for (let m = 2; m <= 9; m += 1) yMinorTicks.push(m * 10 ** e);
  }

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

  /* ---- 判定の重ね描き ---- */

  const plateauSet = new Set(overlay?.plateauRows ?? []);
  const excludedSet = new Set(overlay?.excludedRows ?? []);
  const plateauPoints = plotted.filter((p) => plateauSet.has(p.rowIndex));
  const cpsX =
    overlay?.cpsCorrectedLogMAR === null || overlay?.cpsCorrectedLogMAR === undefined
      ? null
      : toX(overlay.cpsCorrectedLogMAR);
  // MRS の線はプラトーの範囲にだけ引く。全域に延ばすと「どのサイズでもこの速度」
  // と読めてしまうが、MRS はプラトー内の平均である（SPEC §8.3）。
  const mrsY = overlay?.mrsCpm === null || overlay?.mrsCpm === undefined ? null : toY(overlay.mrsCpm);
  const mrsSpan =
    plateauPoints.length === 0
      ? null
      : {
          x1: toX(Math.min(...plateauPoints.map((p) => p.logMAR))),
          x2: toX(Math.max(...plateauPoints.map((p) => p.logMAR))),
        };

  /* ---- CPS 境界の操作 ---- */

  /**
   * ポインタ位置に最も近い実測点へスナップする。
   *
   * 画素 → logMAR の逆変換を書かず、各点の描画位置（順変換の結果）との距離で
   * 選ぶ。UI が持つのは自前の座標系だけで、値の解釈は行なわない。
   */
  const snapToNearest = (clientX: number): PlottedRow | null => {
    const svg = svgRef.current;
    if (svg === null || plotted.length === 0) return null;
    const box = svg.getBoundingClientRect();
    if (box.width === 0) return null;
    const viewX = ((clientX - box.left) / box.width) * WIDTH;
    return plotted.reduce((best, p) =>
      Math.abs(toX(p.logMAR) - viewX) < Math.abs(toX(best.logMAR) - viewX) ? p : best,
    );
  };

  const moveBoundaryBySteps = (steps: number): void => {
    if (interaction === null || overlay?.cpsCorrectedLogMAR == null) return;
    const index = plotted.findIndex(
      (p) => Math.abs(p.logMAR - overlay.cpsCorrectedLogMAR!) < 1e-9,
    );
    if (index < 0) return;
    const next = plotted[Math.min(Math.max(index + steps, 0), plotted.length - 1)];
    if (next === undefined || next.rowIndex === plotted[index]!.rowIndex) return;
    interaction.onMoveBoundary(next.rowIndex);
  };

  const onHandlePointerDown = (event: ReactPointerEvent<SVGRectElement>): void => {
    if (interaction === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onHandlePointerMove = (event: ReactPointerEvent<SVGRectElement>): void => {
    if (!dragging || interaction === null) return;
    const target = snapToNearest(event.clientX);
    if (target !== null) interaction.onMoveBoundary(target.rowIndex);
  };

  const endDrag = (event: ReactPointerEvent<SVGRectElement>): void => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const interactive = interaction !== null;

  /** 右寄りの線のラベルは内側（左）へ出す。描画域からはみ出させない。 */
  const labelOnLeft = (x: number): boolean => x > MARGIN.left + PLOT_WIDTH * 0.6;

  /**
   * MRS の札を、プラトー区間のどちら端から書き出すか。
   *
   * 文字幅で位置を決めると、A4 レポートで図中の字を拡大した瞬間に破綻する
   * （中央寄せ＋固定の余白では、拡大した札が右端からはみ出した）。
   * 「区間の内側に向かって伸ばす」なら字の大きさに依存しない。
   */
  const mrsLabelAtRightEnd = mrsSpan !== null && labelOnLeft(mrsSpan.x1);

  return (
    <figure className="curve">
      <svg
        ref={svgRef}
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
        data-plateau-count={plateauPoints.length}
        data-interactive={interactive}
      >
        {yMinorTicks.map((cpm) => (
          <line
            key={`minor-${cpm}`}
            className="grid-minor"
            x1={MARGIN.left}
            x2={MARGIN.left + PLOT_WIDTH}
            y1={toY(cpm)}
            y2={toY(cpm)}
          />
        ))}

        {/* 縦の目盛線。どの実測サイズの上に点があるのかを追えるようにする */}
        {xTicks.map((tick) => (
          <line
            key={`v-${tick.chart}`}
            className="grid-vertical"
            x1={toX(tick.logMAR)}
            x2={toX(tick.logMAR)}
            y1={MARGIN.top}
            y2={logBottom}
          />
        ))}

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
              className="tick tick-major"
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
          <rect
            className="zero-band"
            x={MARGIN.left}
            y={zeroY - ZERO_ROW_HEIGHT / 2}
            width={PLOT_WIDTH}
            height={ZERO_ROW_HEIGHT}
          />
          <text
            className="tick tick-major"
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

        {/* 快適側（CPS 以上）の帯。判定の対象がどこかを面で示す */}
        {cpsX !== null && (
          <rect
            className={overlay?.manual === true ? "cps-region" : "cps-region cps-region-auto"}
            x={cpsX}
            y={MARGIN.top}
            width={Math.max(0, MARGIN.left + PLOT_WIDTH - cpsX)}
            height={logBottom - MARGIN.top}
            data-testid="cps-region"
          />
        )}

        {positives.length >= 2 && <path className="curve-line" d={path} fill="none" />}

        {/*
          判定線のラベル。プラトーは図の右端に寄ることが多く、線の右へ素直に
          置くと文字が描画域からはみ出す。線の位置に応じて内側へ寄せる。

          MRS の札は線の**下**、プラトー区間の中央に置く。以前は線の左端の上に
          出していたが、プラトーが右上に寄る典型例では CPS の札とちょうど
          重なって両方読めなくなっていた。上（CPS）と下（MRS）に分ければ、
          プラトーがどこにあっても衝突しない。
        */}

        {/* MRS の水平線。プラトーの範囲にのみ引く */}
        {mrsY !== null && mrsSpan !== null && (
          <g data-testid="mrs-line" data-cpm={overlay?.mrsCpm ?? undefined}>
            <line className="mrs-line" x1={mrsSpan.x1} x2={mrsSpan.x2} y1={mrsY} y2={mrsY} />
            <text
              className="overlay-label overlay-label-mrs"
              x={mrsLabelAtRightEnd ? mrsSpan.x2 : mrsSpan.x1}
              y={mrsY + 25}
              textAnchor={mrsLabelAtRightEnd ? "end" : "start"}
            >
              MRS {formatCpm(overlay?.mrsCpm ?? null)} cpm
            </text>
          </g>
        )}

        {/* CPS の縦線。算出法 ID を必ず添える（ADR-0006） */}
        {cpsX !== null && (
          <g
            data-testid="cps-line"
            data-logmar={overlay?.cpsCorrectedLogMAR ?? undefined}
            data-manual={overlay?.manual === true}
          >
            <line className="cps-line" x1={cpsX} x2={cpsX} y1={MARGIN.top} y2={logBottom} />
            <text
              className="overlay-label"
              x={labelOnLeft(cpsX) ? cpsX - 4 : cpsX + 4}
              y={MARGIN.top + 12}
              textAnchor={labelOnLeft(cpsX) ? "end" : "start"}
            >
              CPS {formatLogMAR(overlay?.cpsCorrectedLogMAR ?? null)}（
              {overlay?.cpsMethodLabel}）
            </text>
          </g>
        )}

        {/*
          CPS 境界のつまみ。値ではなく「どの実測サイズからか」を動かす（ADR-0012）。

          **点より先に描く。** SVG の当たり判定は描画順で決まるため、つまみを後に
          置くと境界上の点（＝検者がいちばん触りたい点）がつまみに覆われて
          クリックできなくなる。つまみは縦に長いので、点と重なる部分を譲っても
          掴む場所は十分に残る。
        */}
        {interactive && cpsX !== null && (
          <rect
            className="cps-handle"
            x={cpsX - 7}
            y={MARGIN.top}
            width={14}
            height={logBottom - MARGIN.top}
            role="slider"
            tabIndex={0}
            aria-label="CPS 境界（プラトーの小文字側の端）"
            aria-valuenow={overlay?.cpsCorrectedLogMAR ?? undefined}
            aria-valuetext={`${formatLogMAR(overlay?.cpsCorrectedLogMAR ?? null)} logMAR`}
            data-testid="cps-handle"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveBoundaryBySteps(-1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                moveBoundaryBySteps(1);
              }
            }}
          />
        )}

        {plotted.map((p) => {
          const inPlateau = plateauSet.has(p.rowIndex);
          const excluded = excludedSet.has(p.rowIndex);
          const classes = ["point"];
          if (p.speedCpm === 0) classes.push("point-zero");
          // 判定線が出ているときだけ、採用/不採用を塗りの有無で描き分ける。
          // 大きさの差だけでは、どれを選んでいるのかがひと目で読めない。
          if (overlay !== null) classes.push(inPlateau ? "point-plateau" : "point-outside");
          if (excluded) classes.push("point-excluded");
          if (p.rowIndex === focusedRowIndex) classes.push("point-focused");
          return (
            <circle
              key={p.rowIndex}
              className={classes.join(" ")}
              cx={toX(p.logMAR)}
              cy={toY(p.speedCpm)}
              r={p.rowIndex === focusedRowIndex ? 6 : inPlateau ? 7 : 4}
              data-testid="curve-point"
              data-row-index={p.rowIndex}
              data-logmar={p.logMAR}
              data-cpm={p.speedCpm}
              data-zero={p.speedCpm === 0}
              data-plateau={inPlateau}
              data-excluded={excluded}
              {...(interactive
                ? {
                    role: "checkbox" as const,
                    "aria-checked": inPlateau,
                    "aria-label": `${formatLogMAR(p.logMAR)} logMAR / ${formatCpm(p.speedCpm)} cpm をプラトーに含める`,
                    tabIndex: 0,
                    onClick: () => interaction.onTogglePoint(p.rowIndex),
                    onKeyDown: (event: ReactKeyboardEvent<SVGCircleElement>) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      interaction.onTogglePoint(p.rowIndex);
                    },
                  }
                : {})}
            >
              <title>{`${formatLogMAR(p.logMAR)} logMAR / ${formatCpm(p.speedCpm)} cpm`}</title>
            </circle>
          );
        })}

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
          transform={`translate(13 ${MARGIN.top + PLOT_HEIGHT / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          読書速度（cpm）
        </text>
      </svg>

      {/*
        凡例。塗りの有無が何を意味するかを図のそばに置く。判定画面では
        「採用したか」、レポートでは「最も速く読める範囲か」と読み替えられる
        書き方にしてある。
      */}
      {overlay !== null && (
        <ul className="curve-legend" data-testid="curve-legend">
          <li>
            <Swatch className="point point-plateau" />
            {interactive ? "プラトーに採用した点" : "最も速く読める範囲の点"}
          </li>
          <li>
            <Swatch className="point point-outside" />
            {interactive ? "採用していない測定点" : "それ以外の測定点"}
          </li>
          {interactive && (
            <li>
              <Swatch className="point point-excluded" />
              除外として記録した点
            </li>
          )}
          {zeros.length > 0 && (
            <li>
              <Swatch className="point point-zero point-outside" />0 cpm（読めなかった）
            </li>
          )}
        </ul>
      )}

      {/*
        説明文は「操作できるか」で切り替える。判定画面と患者向けレポートは
        同じ図を使うが、レポートは読み取り専用であり、操作の説明を載せると
        患者の手元で意味をなさない。
      */}
      <figcaption>
        {interactive ? (
          <>
            点をクリックするとプラトーに出し入れできる。CPS の線は「どの文字サイズから
            プラトーとみなすか」を指すつまみで、動かすと MRS も連動する。MRS の線に
            つまみはない（プラトー内速度の平均そのものであるため）。
            {overlay?.manual === false &&
              "　いまの線は自動値の暫定表示であり、検者の判定ではない。"}
          </>
        ) : overlay === null ? (
          <>
            描画するのは測定値のみ。欠測は描かない。0 cpm（不読）は対数目盛に載らないため、
            軸を分けて下段に描いている。
          </>
        ) : (
          <>
            横軸は文字の大きさ（右ほど大きい）、縦軸は読む速さです。縦の線から右が
            「最も速く読める」範囲にあたります。
          </>
        )}
      </figcaption>
    </figure>
  );
}

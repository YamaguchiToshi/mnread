/**
 * 速度曲線の MRS の札をどこに置くか（Issue #4）
 *
 * 札は **MRS の線に寄り添わせる**。線から離れた空き地へ飛ばすと、どの線の札
 * なのかが読めなくなる。そこで、動かしてよい範囲を「線のすぐ上か下、札2枚分の
 * 高さまで」に限り、その中で点・折れ線・CPS の線と札に重ならない位置を選ぶ。
 * 重なりと線からの距離は天秤にかける（重さ1 ＝ 札1枚分の距離）。空きがなければ
 * 重なりの軽い位置で妥協する。重ならないことを守るために札を
 * 線から引き離したり、図を崩したりはしない（Issue #4 は「できるだけ」）。
 *
 * **書き出す基準点は文字幅に依存させない。** 札はプラトー区間の端から内側へ
 * 伸ばす。文字幅を使うのは、内側へ伸ばす候補の中から選ぶときだけである。
 * 以前、文字幅を見積もって中央寄せ＋固定の余白で置いたところ、レポートで
 * 図中の字を拡大した瞬間に札が図の外へはみ出した。ここで使う幅は見積もりでは
 * なく、ブラウザが実際に描いた札の寸法（SVG の座標系）である。寸法が無いとき
 * （初回描画前、jsdom）は内側へ伸ばす既定の位置に置き、はみ出しはしない。
 *
 * 画面上の配置だけを決める関数であり、臨床の数値は扱わない（ADR-0010 の対象外）。
 */

export interface Box {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** ブラウザが描いた札の寸法。上下は基線からの距離。 */
export interface LabelSize {
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
}

export interface Circle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface MrsLabelInput {
  /** MRS の線の高さ */
  readonly lineY: number;
  /** MRS の線の左右端（プラトー区間） */
  readonly spanX1: number;
  readonly spanX2: number;
  /** 札が収まるべき範囲（対数の描画域） */
  readonly plot: Box;
  /** 内側へ伸ばす向き。区間の右端から左へ伸ばすなら "end" */
  readonly inward: "start" | "end";
  readonly points: readonly Circle[];
  readonly segments: readonly Segment[];
  readonly cpsX: number | null;
  readonly cpsLabel: Box | null;
}

export interface MrsLabelPlacement {
  /** 基線の位置 */
  readonly x: number;
  readonly y: number;
  readonly anchor: "start" | "end";
}

/** 寸法が無いときの既定。線の下、区間の端から内側へ。 */
const FALLBACK_OFFSET = 25;
/** 線と札の間に空ける距離 */
const GAP = 3;
/** 障害物との間に残す余白 */
const PAD = 2;

/*
 * 重なりの重さ。点と折れ線は図そのものであり、札に隠れると曲線の形が読めなく
 * なる。CPS の札も文字どうしの重なりで両方読めなくなる。CPS の線は破線で、
 * 札がまたいでも線も札も読める。区間が札より狭いとき（プラトーが2〜3点）は
 * 内側へ伸ばす限り CPS の線をまたぐしかなく、それを避けて札を線から引き離す
 * よりは、またぐほうがよい。
 */
const COST_POINT = 4;
const COST_SEGMENT = 3;
const COST_CPS_LABEL = 4;
const COST_CPS_LINE = 1;

export function fallbackMrsLabelPlacement(
  input: Pick<MrsLabelInput, "lineY" | "spanX1" | "spanX2" | "inward">,
): MrsLabelPlacement {
  return {
    x: input.inward === "end" ? input.spanX2 : input.spanX1,
    y: input.lineY + FALLBACK_OFFSET,
    anchor: input.inward,
  };
}

function circleHitsBox(c: Circle, b: Box): boolean {
  const nx = Math.min(Math.max(c.x, b.x1), b.x2);
  const ny = Math.min(Math.max(c.y, b.y1), b.y2);
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r ** 2;
}

/** 線分と矩形の交差（Liang–Barsky の切り取り）。 */
function segmentHitsBox(s: Segment, b: Box): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, s.x1 - b.x1) &&
    clip(dx, b.x2 - s.x1) &&
    clip(-dy, s.y1 - b.y1) &&
    clip(dy, b.y2 - s.y1) &&
    t0 <= t1
  );
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

/** 線から離してよい距離（札の高さの倍数） */
const MAX_DRIFT_IN_HEIGHTS = 2;

/** 札の矩形に重なるものの重さの合計。0 なら何にも重ならない。 */
export function collisionCost(label: Box, input: MrsLabelInput): number {
  const b = { x1: label.x1 - PAD, y1: label.y1 - PAD, x2: label.x2 + PAD, y2: label.y2 + PAD };
  let cost = 0;
  for (const p of input.points) if (circleHitsBox(p, b)) cost += COST_POINT;
  for (const s of input.segments) if (segmentHitsBox(s, b)) cost += COST_SEGMENT;
  if (input.cpsLabel !== null && boxesOverlap(input.cpsLabel, b)) cost += COST_CPS_LABEL;
  if (input.cpsX !== null && input.cpsX > b.x1 && input.cpsX < b.x2) cost += COST_CPS_LINE;
  return cost;
}

interface Candidate {
  readonly placement: MrsLabelPlacement;
  readonly score: number;
  readonly order: number;
}

/**
 * 札の位置を決める。
 *
 * 候補は「区間のどちらの端から内側へ伸ばすか」×「線の上か下か」×「線からの
 * 距離（0〜札2枚分の高さ）」。描画域に収まらない候補は捨てる。残りから
 * 「重なりの重さ × 札の高さ ＋ 線からの距離」が最小のものを選ぶ。点や折れ線
 * （重さ3〜4）を避けるためなら範囲いっぱいまで離す。CPS の線は描画域の上下
 * いっぱいに引かれているので、上下に動かしても避けられない。避けられないとき
 * は、線のそばでまたぐ。同点なら上、内側へ伸ばす既定の向きの順。
 */
export function placeMrsLabel(
  input: MrsLabelInput,
  size: LabelSize | null,
): MrsLabelPlacement {
  if (size === null || !(size.width > 0)) return fallbackMrsLabelPlacement(input);

  const height = size.ascent + size.descent;
  const maxDrift = Math.ceil(height * MAX_DRIFT_IN_HEIGHTS);
  const anchors: readonly ("start" | "end")[] =
    input.inward === "end" ? ["end", "start"] : ["start", "end"];
  const sides = ["above", "below"] as const;

  let best: Candidate | null = null;
  anchors.forEach((anchor, anchorIndex) => {
    const x = anchor === "end" ? input.spanX2 : input.spanX1;
    const x1 = anchor === "end" ? x - size.width : x;
    const x2 = x1 + size.width;
    if (x1 < input.plot.x1 || x2 > input.plot.x2) return;

    sides.forEach((side, sideIndex) => {
      for (let drift = 0; drift <= maxDrift; drift += 1) {
        const top =
          side === "below" ? input.lineY + GAP + drift : input.lineY - GAP - drift - height;
        const bottom = top + height;
        if (top < input.plot.y1 || bottom > input.plot.y2) break;
        const cost = collisionCost({ x1, y1: top, x2, y2: bottom }, input);
        const candidate: Candidate = {
          placement: { x, y: top + size.ascent, anchor },
          score: cost * height + drift,
          order: sideIndex * 2 + anchorIndex,
        };
        if (
          best === null ||
          candidate.score < best.score ||
          (candidate.score === best.score && candidate.order < best.order)
        ) {
          best = candidate;
        }
        // この向きで重ならない位置が見つかれば、それより遠くは点が悪くなるだけ
        if (cost === 0) break;
      }
    });
  });

  return best === null ? fallbackMrsLabelPlacement(input) : (best as Candidate).placement;
}

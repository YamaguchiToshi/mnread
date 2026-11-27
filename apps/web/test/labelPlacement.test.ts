/**
 * MRS の札の配置（Issue #4）
 *
 * 札を「線に寄り添わせたまま、点・折れ線・CPS の線と札をできるだけ避ける」
 * ことを、寸法を与えた純粋関数で確かめる。実際の字幅での見え方は実ブラウザで
 * 確かめる（jsdom は字を組まない）。
 */

import { describe, expect, it } from "vitest";

import {
  collisionCost,
  fallbackMrsLabelPlacement,
  placeMrsLabel,
  type Box,
  type LabelSize,
  type MrsLabelInput,
  type MrsLabelPlacement,
} from "../src/components/labelPlacement.js";

const PLOT: Box = { x1: 70, y1: 16, x2: 616, y2: 316 };
const SIZE: LabelSize = { width: 80, ascent: 11, descent: 3 };
const HEIGHT = SIZE.ascent + SIZE.descent;

function base(overrides: Partial<MrsLabelInput> = {}): MrsLabelInput {
  return {
    lineY: 150,
    spanX1: 400,
    spanX2: 600,
    plot: PLOT,
    inward: "end",
    points: [],
    segments: [],
    cpsX: null,
    cpsLabel: null,
    ...overrides,
  };
}

/** 置いた札の矩形 */
function boxOf(p: MrsLabelPlacement, size: LabelSize = SIZE): Box {
  const x1 = p.anchor === "end" ? p.x - size.width : p.x;
  return { x1, y1: p.y - size.ascent, x2: x1 + size.width, y2: p.y + size.descent };
}

/** 線からの距離（札の近い側の辺まで） */
function distanceFromLine(p: MrsLabelPlacement, lineY: number): number {
  const b = boxOf(p);
  return b.y1 >= lineY ? b.y1 - lineY : lineY - b.y2;
}

/** プラトーの点を線の上に並べる（典型的な形） */
function plateauOnLine(input: MrsLabelInput, n = 5): MrsLabelInput["points"] {
  return Array.from({ length: n }, (_, i) => ({
    x: input.spanX1 + ((input.spanX2 - input.spanX1) * i) / (n - 1),
    y: input.lineY,
    r: 7,
  }));
}

describe("寸法が無いとき", () => {
  it("区間の内側へ向かって、線の下の既定の位置に置く（以前と同じ）", () => {
    const input = base();
    expect(placeMrsLabel(input, null)).toEqual({ x: 600, y: 175, anchor: "end" });
    expect(placeMrsLabel({ ...input, inward: "start" }, null)).toEqual({
      x: 400,
      y: 175,
      anchor: "start",
    });
    expect(fallbackMrsLabelPlacement(input)).toEqual(placeMrsLabel(input, null));
  });

  it("幅 0（表示されていない要素を測った）も寸法なしとして扱う", () => {
    expect(placeMrsLabel(base(), { width: 0, ascent: 0, descent: 0 })).toEqual(
      fallbackMrsLabelPlacement(base()),
    );
  });
});

describe("書き出しの基準点", () => {
  it("基準点は区間の端で、札は内側へ伸ばす（文字幅で基準点を動かさない）", () => {
    const input = base();
    for (const width of [40, 80, 160]) {
      const p = placeMrsLabel(input, { ...SIZE, width });
      expect([input.spanX1, input.spanX2]).toContain(p.x);
      const b = boxOf(p, { ...SIZE, width });
      // 区間の端から内側（区間のある側）へ伸びている
      if (p.anchor === "end") expect(b.x2).toBe(input.spanX2);
      else expect(b.x1).toBe(input.spanX1);
    }
  });

  it("札は描画域からはみ出さない", () => {
    const cases: MrsLabelInput[] = [
      base({ spanX1: 590, spanX2: 616, inward: "end" }),
      base({ spanX1: 70, spanX2: 100, inward: "start" }),
      base({ lineY: 20 }),
      base({ lineY: 312 }),
    ];
    for (const input of cases) {
      const b = boxOf(placeMrsLabel(input, SIZE));
      expect(b.x1).toBeGreaterThanOrEqual(PLOT.x1);
      expect(b.x2).toBeLessThanOrEqual(PLOT.x2);
      expect(b.y1).toBeGreaterThanOrEqual(PLOT.y1);
      expect(b.y2).toBeLessThanOrEqual(PLOT.y2);
    }
  });

  it("内側へ伸ばすと収まらないときは、反対の端から伸ばす", () => {
    // 区間が左端に寄っていて、右端から左へ伸ばすと描画域の左を越える
    const input = base({ spanX1: 72, spanX2: 120, inward: "end" });
    const p = placeMrsLabel(input, SIZE);
    expect(p).toMatchObject({ x: 72, anchor: "start" });
  });
});

describe("重なりを避ける", () => {
  it("線の上に並んだプラトーの点に札をかぶせない", () => {
    const input = base();
    const withPoints = { ...input, points: plateauOnLine(input) };
    const p = placeMrsLabel(withPoints, SIZE);
    expect(collisionCost(boxOf(p), withPoints)).toBe(0);
  });

  it("空いていれば線のすぐ上に置く（線から離さない）", () => {
    const input = base();
    const p = placeMrsLabel(input, SIZE);
    expect(boxOf(p).y2).toBeLessThan(input.lineY);
    expect(distanceFromLine(p, input.lineY)).toBeLessThanOrEqual(4);
  });

  it("上が CPS の札で塞がっていれば、下に置く", () => {
    const input = base();
    const cpsLabel: Box = { x1: 300, y1: 100, x2: 616, y2: 147 };
    const p = placeMrsLabel({ ...input, cpsLabel }, SIZE);
    expect(boxOf(p).y1).toBeGreaterThan(input.lineY);
  });

  it("立ち上がりの折れ線が札の位置を横切るなら、避けられる側へ移る", () => {
    const input = base();
    // 区間の左端の下から、札の下側を斜めに横切る線分
    const segments = [{ x1: 500, y1: 175, x2: 560, y2: 150 }];
    const withSeg = { ...input, segments };
    expect(collisionCost(boxOf(fallbackMrsLabelPlacement(input)), withSeg)).toBeGreaterThan(0);
    const p = placeMrsLabel(withSeg, SIZE);
    expect(collisionCost(boxOf(p), withSeg)).toBe(0);
  });

  it("CPS の線をまたぐのが避けられないなら、札を線から引き離さない", () => {
    // 区間が札より狭い。上も下も線のすぐそばでは CPS の線をまたぐ
    const input = base({ spanX1: 560, spanX2: 600, cpsX: 560 });
    const p = placeMrsLabel(input, SIZE);
    // 区間の左端（= CPS の線）より左へは伸びるしかないので、またぐのは避けられない
    expect(collisionCost(boxOf(p), input)).toBe(1);
    // 避けられない重なりのために、札を線から引き離さない
    expect(distanceFromLine(p, input.lineY)).toBeLessThanOrEqual(4);
  });
});

describe("できるだけ（線から引き離してまでは避けない）", () => {
  it("CPS の線を避けるためだけに、札1枚分より遠くへは動かさない", () => {
    // 右端から伸ばすと CPS の線をまたぐ。左端から伸ばせばまたがないが、
    // そちらは線のそばに点があり、札1.5枚分離さないと空かない
    const input = base({ spanX1: 450, spanX2: 600, cpsX: 540, inward: "end" });
    const points = [
      { x: 470, y: input.lineY - 1.4 * HEIGHT, r: 4 },
      { x: 470, y: input.lineY + 1.4 * HEIGHT, r: 4 },
      { x: 500, y: input.lineY - 0.6 * HEIGHT, r: 4 },
      { x: 500, y: input.lineY + 0.6 * HEIGHT, r: 4 },
    ];
    const p = placeMrsLabel({ ...input, points }, SIZE);
    expect(p.anchor).toBe("end");
    expect(collisionCost(boxOf(p), { ...input, points })).toBe(1);
    expect(distanceFromLine(p, input.lineY)).toBeLessThanOrEqual(4);
  });

  it("札2枚分より遠くでしか空かないなら、近くで重なりを受け入れる", () => {
    const input = base();
    // 線の上下とも、札3枚分の高さまで線分の帯が並ぶ
    const segments = Array.from({ length: 12 }, (_, i) => {
      const y = input.lineY - 3 * HEIGHT + (i * 6 * HEIGHT) / 11;
      return { x1: 380, y1: y, x2: 616, y2: y };
    });
    const p = placeMrsLabel({ ...input, segments }, SIZE);
    expect(distanceFromLine(p, input.lineY)).toBeLessThanOrEqual(2 * HEIGHT + 4);
  });

  it("重い重なり（点）は札2枚分の範囲いっぱいまで使って避ける", () => {
    const input = base();
    // 線の上は描画域の上端で塞がる。下には札1.5枚分まで点が並ぶ
    const tight = { ...input, lineY: PLOT.y1 + 6 };
    // どちらの端から伸ばしても札の幅にかかる位置に並べる
    const points = [440, 560].flatMap((x) =>
      [0, 0.5, 1, 1.5].map((k) => ({ x, y: tight.lineY + k * HEIGHT, r: 4 })),
    );
    const p = placeMrsLabel({ ...tight, points }, SIZE);
    expect(collisionCost(boxOf(p), { ...tight, points })).toBe(0);
    expect(boxOf(p).y1).toBeGreaterThan(tight.lineY + 1.5 * HEIGHT);
  });
});

/**
 * MRS の札：測った寸法で置き直すこと（Issue #4）
 *
 * jsdom は字を組まないので getBBox を持たない。寸法が無ければ札は既定の位置
 * （線の下、区間の端から内側へ）に置かれる。寸法を与えると、点を避けた位置へ
 * 置き直される。配置そのものの規則は labelPlacement.test.ts で確かめる。
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SpeedCurve, type CurveOverlay } from "../src/components/SpeedCurve.js";
import type { RowView } from "../src/session/derive.js";

/** 1.3 logMAR から順の速度。プラトー（先頭4点）は MRS の線の上に並ぶ */
const SPEEDS = [250, 261, 254, 240, 196, 140, 80, 0];

function rows(speeds: readonly (number | null)[] = SPEEDS): RowView[] {
  return Array.from({ length: 19 }, (_, i) => {
    const chart = Math.round((1.3 - 0.1 * i) * 10) / 10;
    return {
      rowIndex: i,
      itemIndex: i,
      chartLogMAR: chart,
      correctedLogMAR: chart,
      speedCpm: speeds[i] ?? null,
      timeSec: null,
      issues: [],
      hasError: false,
      touched: true,
    } as unknown as RowView;
  });
}

const OVERLAY: CurveOverlay = {
  plateauRows: [0, 1, 2, 3],
  manual: true,
  cpsMethodLabel: "目視",
  cpsCorrectedLogMAR: 1.0,
  mrsCpm: 251.25,
  excludedRows: [],
};

const LABEL = { width: 110, ascent: 16, descent: 5 };

type BBoxFn = (this: SVGGraphicsElement) => DOMRect;
const proto = SVGElement.prototype as unknown as { getBBox?: BBoxFn };
const original = proto.getBBox;

/** 札の寸法を与える。text-anchor に従って矩形を返す */
function stubTextBBox(): void {
  proto.getBBox = function (this: SVGGraphicsElement): DOMRect {
    if (this.tagName !== "text") return { x: 0, y: 0, width: 0, height: 0 } as DOMRect;
    const x = Number(this.getAttribute("x"));
    const y = Number(this.getAttribute("y"));
    const anchor = this.getAttribute("text-anchor");
    const left = anchor === "end" ? x - LABEL.width : x;
    return {
      x: left,
      y: y - LABEL.ascent,
      width: LABEL.width,
      height: LABEL.ascent + LABEL.descent,
    } as DOMRect;
  };
}

afterEach(() => {
  if (original === undefined) delete proto.getBBox;
  else proto.getBBox = original;
});

function labelBox(): { x1: number; y1: number; x2: number; y2: number } {
  const label = screen.getByTestId("mrs-label");
  const x = Number(label.getAttribute("x"));
  const y = Number(label.getAttribute("y"));
  const x1 = label.getAttribute("text-anchor") === "end" ? x - LABEL.width : x;
  return { x1, y1: y - LABEL.ascent, x2: x1 + LABEL.width, y2: y + LABEL.descent };
}

function mrsLineY(): number {
  return Number(screen.getByTestId("mrs-line").querySelector("line")!.getAttribute("y1"));
}

type Rect = { x1: number; y1: number; x2: number; y2: number };

function circleHits(c: { x: number; y: number; r: number }, b: Rect): boolean {
  const nx = Math.min(Math.max(c.x, b.x1), b.x2);
  const ny = Math.min(Math.max(c.y, b.y1), b.y2);
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r ** 2;
}

/** 線分を細かく刻んで、矩形に入る点があるか */
function segmentHits(a: [number, number], z: [number, number], b: Rect): boolean {
  for (let t = 0; t <= 1; t += 0.005) {
    const x = a[0] + (z[0] - a[0]) * t;
    const y = a[1] + (z[1] - a[1]) * t;
    if (x > b.x1 && x < b.x2 && y > b.y1 && y < b.y2) return true;
  }
  return false;
}

describe("MRS の札の位置", () => {
  it("寸法が測れなければ、線の下・区間の端から内側へ（既定の位置）", () => {
    delete proto.getBBox;
    render(<SpeedCurve rows={rows()} focusedRowIndex={null} overlay={OVERLAY} />);
    const label = screen.getByTestId("mrs-label");
    expect(Number(label.getAttribute("y"))).toBeCloseTo(mrsLineY() + 25, 6);
    expect(label).toHaveAttribute("text-anchor", "end");
  });

  it("測った寸法で、プラトーの点にかからない位置へ置き直す", () => {
    stubTextBBox();
    render(<SpeedCurve rows={rows()} focusedRowIndex={null} overlay={OVERLAY} />);

    const box = labelBox();
    const circles = screen
      .getAllByTestId("curve-point")
      .map((c) => ({
        x: Number(c.getAttribute("cx")),
        y: Number(c.getAttribute("cy")),
        r: Number(c.getAttribute("r")),
      }));
    for (const c of circles) {
      const nx = Math.min(Math.max(c.x, box.x1), box.x2);
      const ny = Math.min(Math.max(c.y, box.y1), box.y2);
      expect((c.x - nx) ** 2 + (c.y - ny) ** 2).toBeGreaterThanOrEqual(c.r ** 2);
    }
    expect(circles.some((c) => circleHits(c, box))).toBe(false);
    // 線から離れすぎない（札2枚分以内）
    const lineY = mrsLineY();
    const gap = box.y1 >= lineY ? box.y1 - lineY : lineY - box.y2;
    expect(gap).toBeLessThanOrEqual(2 * (LABEL.ascent + LABEL.descent) + 4);
  });

  it("上は CPS の札、下は立ち上がりの線で塞がる形でも、どちらにもかけない", () => {
    // MRS の線が図の上寄りにあり、線の上に出すと CPS の札に、すぐ下に出すと
    // CPS の線の手前で立ち上がる折れ線にかかる
    stubTextBBox();
    render(
      <SpeedCurve
        rows={rows([407, 407, 407, 407, 196, 140, 80, 0])}
        focusedRowIndex={null}
        overlay={{ ...OVERLAY, mrsCpm: 407 }}
      />,
    );

    const box = labelBox();
    const cps = screen.getByTestId("cps-line").querySelector("text")!;
    const cx = Number(cps.getAttribute("x"));
    const cy = Number(cps.getAttribute("y"));
    const cx1 = cps.getAttribute("text-anchor") === "end" ? cx - LABEL.width : cx;
    const cpsBox = { x1: cx1, y1: cy - LABEL.ascent, x2: cx1 + LABEL.width, y2: cy + LABEL.descent };
    const overlaps =
      box.x1 < cpsBox.x2 && cpsBox.x1 < box.x2 && box.y1 < cpsBox.y2 && cpsBox.y1 < box.y2;
    expect(overlaps).toBe(false);

    const d = document.querySelector(".curve-line")!.getAttribute("d")!;
    const vertices = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as [number, number],
    );
    expect(vertices.length).toBeGreaterThan(2);
    for (let i = 1; i < vertices.length; i += 1) {
      expect(segmentHits(vertices[i - 1]!, vertices[i]!, box)).toBe(false);
    }
  });
});

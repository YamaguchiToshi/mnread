/**
 * 原典の測定例を、検者と同じ打鍵で再現する（Phase 3）
 *
 * 公式マニュアル §4 の測定例（患者HK、31歳、両眼、15cm、MNREAD-J1-1）を
 * テンキー操作だけで入力し、画面に出る値が原典の記載値と一致することを確かめる。
 *
 * core 側の同じ検証は packages/core/test/worked-example.test.ts が行っている。
 * ここで見たいのは「入力UIを通しても同じ値に着地するか」——つまり打鍵の途中で
 * 値が落ちたり、状態が取り違えられたりしないかである。
 *
 * 出典: oda.lab/MNREAD-J-JkMan020518.pdf 図2（p.6）、§4.0〜§4.5（pp.8-9）
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";

/** 原典 図2 のスコアシートの記載そのまま。1.3 から 0.6 まで読み、0.5 で不読。 */
const KEYSTROKES = [
  "4.45{Enter}",
  "4.12{Enter}",
  "4.56{Enter}",
  "10.13{Enter}",
  "9.12{Enter}",
  "11.05+7{Enter}",
  "19.43+23{Enter}",
  "16.18+29{Enter}",
  "*", // 0.5 logMAR は1文字も読めなかった
].join("");

async function enterWorkedExample(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const distance = screen.getByLabelText("視距離（cm）");
  await user.clear(distance);
  await user.type(distance, "15");

  await user.click(screen.getByLabelText("1.30 logMAR の読書時間（秒）"));
  await user.keyboard(KEYSTROKES);
}

describe("公式マニュアル §4 の測定例", () => {
  it("打鍵だけで19行を入力し終えられる", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterWorkedExample(user);

    // 読んだ8行 + 不読1行 = 9点
    expect(screen.queryAllByTestId("curve-point")).toHaveLength(9);
    // 検査を打ち切った 0.4 logMAR 以下は未提示のまま
    expect(screen.getAllByTestId("score-row")[9]).toHaveAttribute(
      "data-status",
      "unpresented_after_stop",
    );
    expect(screen.queryByTestId("error-list")).toBeNull();
  });

  it("読書視力が原典の 1.1 logMAR に一致する", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterWorkedExample(user);

    const ra = screen.getByTestId("summary-ra");
    expect(ra).toHaveTextContent("1.10 logMAR");
    // 原典は N=8・E=59（0.5 logMAR の不読行を数えない）と書くが、本実装は数えて
    // N=9・E=89 となる。RA は SPEC §5.3.3 の不変性によりどちらでも厳密に一致する
    // （ΔRA = −0.1 + 0.1·n0/n0 = 0）。PLAN §1 の訂正はこの点を指している。
    expect(ra).toHaveTextContent("N=9");
    expect(ra).toHaveTextContent("E=89");
    // 15cm での距離補正は +0.30 logMAR（原典 表A）
    expect(ra).toHaveTextContent("+0.30");
    // 0.5 logMAR で全文字を読み損じているため、下限には達している
    expect(ra).not.toHaveTextContent("≦");
  });

  it("臨界文字サイズが原典の 1.4 logMAR に一致し、算出法IDを伴う", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterWorkedExample(user);

    const estimates = screen.getAllByTestId("cps-estimate");
    const sdev = estimates.find((e) => e.getAttribute("data-method") === "plateau_sdev_v1")!;
    expect(sdev).toHaveTextContent("1.40 logMAR");
    // 値だけの「CPS 1.40」を出さない（ADR-0006）
    expect(sdev).toHaveTextContent("SDev法");

    // 検者の目視判定は Phase 4。まだ主値が確定していないことが画面に出る
    const manual = estimates.find(
      (e) => e.getAttribute("data-method") === "manual_visual_2002",
    )!;
    expect(manual).toHaveTextContent("推定不能");
  });

  it("最大読書速度を3方式とも出し、どちらかに寄せない（ADR-0005）", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterWorkedExample(user);

    const results = screen.getAllByTestId("mrs-result");
    expect(results).toHaveLength(3);

    const byMethod = (method: string): HTMLElement =>
      results.find((r) => r.getAttribute("data-method") === method)!;

    // 原典 §3.3 の定義本文（プラトー内速度の平均）
    expect(byMethod("arithmetic")).toHaveTextContent("412 cpm");
    // 原典 §4.4 の計算例（平均読書時間 4.38 秒から換算し 411 cpm と記載）
    expect(byMethod("legacy_mean_time")).toHaveTextContent("411 cpm");
    // 両者が一致しないことこそが、実装が一方を選んではならない理由である
    expect(byMethod("arithmetic")).not.toHaveTextContent("411 cpm");
    expect(byMethod("pooled")).toHaveTextContent("411 cpm");
  });

  it("行ごとの cpm が原典の速度と一致する", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterWorkedExample(user);

    // 原典から算出したフル精度値を表示桁（整数 cpm）に丸めたもの
    const expected = ["404", "437", "395", "178", "197", "125", "22", "4", "0"];
    const cells = screen.getAllByTestId("cpm-cell").slice(0, expected.length);
    expect(cells.map((c) => c.textContent)).toEqual(expected);
  });
});

/**
 * 利用上の注意と既知の限界（PLAN Phase 6、「公開時の注意」）
 *
 * 検証状況の表示は「あってもよい飾り」ではない。臨床検証が済んでいない値を
 * 医療者が見ている以上、その事実が画面から消えないことが要件である。
 * したがってここでは「出ていること」「閉じられないこと」「操作しても
 * 検査の入力が壊れないこと」を固定する。
 */

import { ALGORITHM_VERSION, SPEC_VERSION } from "@mnread/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "../src/App.js";

describe("検証状況の帯", () => {
  it("起動直後から出ており、仕様版とアルゴリズム版を伴う", () => {
    render(<App />);

    const banner = screen.getByTestId("usage-banner");
    expect(banner).toHaveTextContent("実測記録による検証は未完了です");
    expect(banner).toHaveTextContent("診断・治療の判断には用いません");
    expect(screen.getByTestId("usage-versions")).toHaveTextContent(
      `仕様版 ${SPEC_VERSION} / アルゴリズム版 ${ALGORITHM_VERSION}`,
    );
  });

  it("画面を切り替えても消えない", async () => {
    const user = userEvent.setup();
    render(<App />);

    for (const tab of ["tab-judge", "tab-output", "tab-input"]) {
      await user.click(screen.getByTestId(tab));
      expect(screen.getByTestId("usage-banner")).toBeInTheDocument();
    }
  });

  it("帯を閉じる手段を持たない（詳細だけが開閉する）", async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggle = screen.getByTestId("usage-notes-toggle");
    await user.click(toggle);
    await user.click(toggle);

    expect(screen.getByTestId("usage-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("usage-notes-detail")).not.toBeInTheDocument();
  });
});

describe("既知の限界の詳細", () => {
  it("既定では畳まれている（検査中の画面を占有しない）", () => {
    render(<App />);

    expect(screen.queryByTestId("usage-notes-detail")).not.toBeInTheDocument();
    expect(screen.getByTestId("usage-notes-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("開くと PLAN Phase 6 が挙げる3つの限界がいずれも書かれている", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId("usage-notes-toggle"));
    const detail = screen.getByTestId("usage-notes-detail");

    // pt 換算はフォント依存（SPEC §5.7）
    expect(detail).toHaveTextContent("ポイント値は書体によって実寸が変わります");
    expect(detail).toHaveTextContent("明朝体");
    // Jk → 漢字かな交じり文の外挿（SPEC §5.7）
    expect(detail).toHaveTextContent("MNREAD-Jk の値は、漢字かな交じり文の値ではありません");
    expect(detail).toHaveTextContent("0.1 logMAR");
    // ACC の正規化定数が日本語版に存在しない（SPEC §5.6、ADR-0001）
    expect(detail).toHaveTextContent("読書アクセシビリティ指標に日本語版の基準値がありません");
    expect(detail).toHaveTextContent("英語版 ACC");
  });

  it("原典に規定がない裁定と、暫定の閾値であることを明示する", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId("usage-notes-toggle"));
    const detail = screen.getByTestId("usage-notes-detail");

    // OPEN-7（判読3ゾーン）・OPEN-2（大文字側が読めない例）
    expect(detail).toHaveTextContent("判読3ゾーンの区分は、本ツールの裁定です");
    expect(detail).toHaveTextContent("大きい文字が読めない例の扱いは、原典の想定外です");
    // OPEN-4 / OPEN-6（閾値が合成データ由来の暫定値であること）
    expect(detail).toHaveTextContent("合成曲線で決めた暫定値");
    // ADR-0005（MRS 3方式）・ADR-0006（算出法を伴わない CPS は結果ではない）
    expect(detail).toHaveTextContent("最大読書速度は3方式を併記します");
    expect(detail).toHaveTextContent("算出法を伴わない数値は結果として扱えません");
  });

  it("患者データを保存も送信もしないことを書いてある", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId("usage-notes-toggle"));
    const detail = screen.getByTestId("usage-notes-detail");

    expect(detail).toHaveTextContent("端末にもサーバにも保存されません");
    expect(detail).toHaveTextContent("外部への通信は行いません");
  });

  /**
   * アクセス解析を入れたビルドでは、上の「外部への通信は行いません」が嘘になる
   * （ADR-0017）。文言はビーコンの有無と同じ変数から出しているので、
   * 実際に入れ替わることを確かめる。ここが固まっていないと、
   * 医療者に見せている説明と配信物が静かに食い違う。
   */
  it("アクセス解析を入れたビルドでは、何を送るかへ文言が入れ替わる", async () => {
    vi.stubEnv("VITE_CF_BEACON_TOKEN", "0123456789abcdef0123456789abcdef");
    vi.resetModules();
    const { App: AppWithAnalytics } = await import("../src/App.js");

    const user = userEvent.setup();
    render(<AppWithAnalytics />);

    await user.click(screen.getByTestId("usage-notes-toggle"));
    const note = screen.getByTestId("usage-analytics-note");

    expect(note).toHaveTextContent("入力した値が外部へ送られることはありません");
    expect(note).toHaveTextContent("Cookie は置かず");
    expect(note).not.toHaveTextContent("外部への通信は行いません");

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("開閉しても入力済みの測定値は失われない", async () => {
    const user = userEvent.setup();
    render(<App />);

    const cell = screen.getByLabelText("1.30 logMAR の読書時間（秒）") as HTMLInputElement;
    await user.click(cell);
    await user.keyboard("6.0");

    await user.click(screen.getByTestId("usage-notes-toggle"));
    await user.click(screen.getByTestId("usage-notes-toggle"));

    expect(
      (screen.getByLabelText("1.30 logMAR の読書時間（秒）") as HTMLInputElement).value,
    ).toBe("6.0");
  });
});

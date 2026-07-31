/**
 * 画面の組み立て
 *
 * 3面構成にする。
 *   入力 — 検査をしながら打つ（Phase 3）
 *   判定 — プラトーを選び、CPS・MRS を確定させる（Phase 4、ADR-0012）
 *   出力 — 電子カルテ文・A4レポート・生データ（Phase 4、SPEC §8.2）
 *
 * 面を分けるのは、検査中に出力の体裁が視界に入る必要がないためである。一方で
 * 曲線は入力中も見え続ける（形が見えることが臨床上の最大の価値。PLAN Phase 3）。
 */

import { useCallback, useEffect, useMemo, useReducer, useState, type JSX } from "react";

import { IssueList } from "./components/IssueList.js";
import { JudgementPanel } from "./components/JudgementPanel.js";
import { KeyboardLegend } from "./components/KeyboardLegend.js";
import { LiveSummary } from "./components/LiveSummary.js";
import { OutputPanel } from "./components/OutputPanel.js";
import { ScoreSheet } from "./components/ScoreSheet.js";
import { SessionHeader } from "./components/SessionHeader.js";
import { SessionImport } from "./components/SessionImport.js";
import { SpeedCurve, type CurveOverlay } from "./components/SpeedCurve.js";
import { TimeCurve } from "./components/TimeCurve.js";
import { UsageNotes } from "./components/UsageNotes.js";
import { CPS_METHOD_SHORT } from "./labels.js";
import {
  deriveSessionView,
  plateauRowsFromBoundary,
  togglePlateauRow,
} from "./session/derive.js";
import { createHistory, reduce } from "./session/reducer.js";
import { entryOrder, hasEnteredData } from "./session/state.js";

type Screen = "input" | "judge" | "output";

const SCREEN_LABEL: Readonly<Record<Screen, string>> = {
  input: "入力",
  judge: "判定",
  output: "出力",
};

export function App(): JSX.Element {
  const [history, dispatch] = useReducer(reduce, undefined, () => createHistory());
  const [openStatusMenuFor, setOpenStatusMenuFor] = useState<number | null>(null);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [screen, setScreen] = useState<Screen>("input");

  const draft = history.present;
  const view = useMemo(() => deriveSessionView(draft), [draft]);
  const displayOrder = useMemo(() => entryOrder(draft), [draft]);
  const dirty = hasEnteredData(draft);

  // Undo / Redo は入力欄の中でも効く必要があるため、window で受ける。
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: "undo" });
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // データは端末に保存しない設計のため、再読み込みは即座に測定値を失う。
  // 保存で守れない以上、離脱を確認するしかない。
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const resetSession = useCallback(() => {
    if (dirty && !window.confirm("入力内容を破棄して新しい検査を始めますか？")) return;
    dispatch({ type: "resetSession" });
    setFocusedRowIndex(null);
    setOpenStatusMenuFor(null);
    setPaused(false);
    setScreen("input");
  }, [dirty]);

  /**
   * 判定画面のグラフに重ねる値。
   *
   * すべて core の返り値であり、ここでは選び出すだけである（ADR-0010）。
   * CPS の線は「主値として選ばれた算出法」の値を描き、その算出法名を必ず添える
   * （ADR-0006）。
   */
  const overlay = useMemo<CurveOverlay | null>(() => {
    if (!view.outcome.ok) return null;
    const result = view.outcome.result;
    const selected = result.cps.find((e) => e.method === result.selection.cpsMethod);
    return {
      plateauRows: view.selectedPlateauRows,
      manual: view.manualPlateauRows !== null,
      cpsMethodLabel: CPS_METHOD_SHORT[result.selection.cpsMethod],
      cpsCorrectedLogMAR:
        selected?.estimable === true ? selected.cpsCorrectedLogMAR : null,
      mrsCpm: result.mrs.find((m) => m.method === "arithmetic")?.valueCpm ?? null,
      excludedRows: draft.judgement.excludedRowIndices,
    };
  }, [view, draft.judgement.excludedRowIndices]);

  return (
    <div className="app">
      <header className="app-header no-print">
        <h1>MNREAD-J / Jk 解析</h1>
        <div className="app-actions">
          <button type="button" onClick={() => dispatch({ type: "undo" })} disabled={history.past.length === 0}>
            取り消し
          </button>
          <button type="button" onClick={() => dispatch({ type: "redo" })} disabled={history.future.length === 0}>
            やり直し
          </button>
          <button type="button" onClick={() => setPaused((p) => !p)} data-testid="pause-toggle">
            {paused ? "検査を再開" : "検査を中断"}
          </button>
          <SessionImport
            dispatch={dispatch}
            dirty={dirty}
            onLoaded={() => {
              setFocusedRowIndex(null);
              setOpenStatusMenuFor(null);
              setPaused(false);
              setScreen("input");
            }}
          />
          <button type="button" onClick={resetSession}>
            新しい検査
          </button>
        </div>
      </header>

      <nav className="app-tabs no-print" aria-label="画面">
        {(Object.keys(SCREEN_LABEL) as Screen[]).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`tab-${id}`}
            aria-current={screen === id}
            className={screen === id ? "tab tab-active" : "tab"}
            onClick={() => setScreen(id)}
          >
            {SCREEN_LABEL[id]}
          </button>
        ))}
      </nav>

      {/* 検証状況は画面のどこかに常時出ている必要がある（PLAN「公開時の注意」） */}
      <UsageNotes />

      {paused && (
        <p className="paused-banner no-print" data-testid="paused-banner">
          検査を中断しています。入力内容はこのタブが開いているあいだ保持されます
          （端末には保存されません）。
        </p>
      )}

      {screen === "input" && (
        <main className="app-body no-print">
          <div className="column column-input">
            <SessionHeader draft={draft} dispatch={dispatch} />
            <ScoreSheet
              draft={draft}
              rows={view.rows}
              displayOrder={displayOrder}
              dispatch={dispatch}
              openStatusMenuFor={openStatusMenuFor}
              setOpenStatusMenuFor={setOpenStatusMenuFor}
              focusedRowIndex={focusedRowIndex}
              setFocusedRowIndex={setFocusedRowIndex}
            />
          </div>

          <div className="column column-view">
            <SpeedCurve rows={view.rows} focusedRowIndex={focusedRowIndex} />
            <IssueList draft={draft} view={view} />
            <LiveSummary view={view} />
            <KeyboardLegend />
          </div>
        </main>
      )}

      {screen === "judge" && (
        <main className="app-body no-print">
          <div className="column column-view">
            <SpeedCurve
              rows={view.rows}
              focusedRowIndex={null}
              overlay={overlay}
              interaction={{
                onTogglePoint: (rowIndex) =>
                  dispatch({ type: "setPlateau", rows: togglePlateauRow(view, rowIndex) }),
                onMoveBoundary: (rowIndex) =>
                  dispatch({
                    type: "setPlateau",
                    rows: plateauRowsFromBoundary(view, rowIndex),
                  }),
              }}
            />
            <TimeCurve rows={view.rows} />
          </div>
          <div className="column column-input">
            <JudgementPanel draft={draft} view={view} dispatch={dispatch} />
          </div>
        </main>
      )}

      {screen === "output" && (
        <main className="app-body app-body-single">
          <OutputPanel view={view} />
        </main>
      )}
    </div>
  );
}

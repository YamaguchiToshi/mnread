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

const SCREEN_ORDER: readonly Screen[] = ["input", "judge", "output"];

const SCREEN_LABEL: Readonly<Record<Screen, string>> = {
  input: "入力",
  judge: "判定",
  output: "出力",
};

/**
 * 工程の見出しに添える一言。
 *
 * 3面は順番に進む作業であり、いま何が済んでいて次に何が要るのかは、面を
 * 開かずに分かる必要がある。表示するのは `view` が既に持っている真偽値だけで、
 * ここで数え上げや算術は行わない（ADR-0010）。
 */
type StepTone = "plain" | "warn" | "error";

function stepState(
  screen: Screen,
  { dirty, hasError, judged, requiresReview }: {
    dirty: boolean;
    hasError: boolean;
    judged: boolean;
    requiresReview: boolean;
  },
): readonly [string, StepTone] {
  switch (screen) {
    case "input":
      if (hasError) return ["要修正", "error"];
      return dirty ? ["記録中", "plain"] : ["未入力", "plain"];
    case "judge":
      if (hasError) return ["入力エラー", "error"];
      return judged ? ["目視判定あり", "plain"] : ["未判定", "warn"];
    case "output":
      if (hasError) return ["作成できません", "error"];
      if (requiresReview) return ["要確認", "warn"];
      return ["作成できます", "plain"];
  }
}

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

  const stepFacts = {
    dirty,
    hasError: view.hasError,
    judged: view.manualPlateauRows !== null,
    requiresReview: view.outcome.ok && view.outcome.result.requiresReview,
  };

  return (
    <div className="app">
      <div className="app-topbar no-print">
        <header className="app-header">
          <div className="app-title">
            <h1>MNREAD-J / Jk 解析</h1>
            <span className="app-subtitle">読書チャート解析（院内ツール）</span>
          </div>
          <div className="app-actions">
            <span className="btn-group">
              <button
                type="button"
                className="btn"
                onClick={() => dispatch({ type: "undo" })}
                disabled={history.past.length === 0}
              >
                取り消し
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => dispatch({ type: "redo" })}
                disabled={history.future.length === 0}
              >
                やり直し
              </button>
            </span>
            <button
              type="button"
              className={paused ? "btn btn-on" : "btn"}
              onClick={() => setPaused((p) => !p)}
              data-testid="pause-toggle"
            >
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
            <button type="button" className="btn btn-danger" onClick={resetSession}>
              新しい検査
            </button>
          </div>
        </header>

        <nav className="app-steps" aria-label="検査の工程">
          {SCREEN_ORDER.map((id, i) => {
            const [state, tone] = stepState(id, stepFacts);
            return (
              <button
                key={id}
                type="button"
                data-testid={`tab-${id}`}
                aria-current={screen === id}
                className={screen === id ? "step step-active" : "step"}
                onClick={() => setScreen(id)}
              >
                <span className="step-index" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="step-text">
                  <span className="step-name">{SCREEN_LABEL[id]}</span>
                  <span className="step-state" data-tone={tone}>
                    {state}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>

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
            <div className="card">
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
          </div>

          <div className="column column-view">
            <div className="card">
              <div className="card-head">
                <h2>読書速度曲線</h2>
                <span className="detail">検査中も形が伸びていきます</span>
              </div>
              <SpeedCurve rows={view.rows} focusedRowIndex={focusedRowIndex} />
            </div>
            <IssueList draft={draft} view={view} />
            <LiveSummary view={view} />
            <KeyboardLegend />
          </div>
        </main>
      )}

      {screen === "judge" && (
        <main className="app-body no-print">
          <div className="column column-view">
            <div className="card">
              <div className="card-head">
                <h2>読書速度曲線</h2>
                <span className="detail">プラトーを選ぶ図</span>
              </div>
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
            </div>
            <div className="card">
              <TimeCurve rows={view.rows} />
            </div>
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

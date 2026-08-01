/**
 * 検証結果の一覧（Phase 3）
 *
 * 最初の1件で打ち切らず、全行のエラーを同時に出す（ADR-0004）。core が返した
 * メッセージをそのまま見せる。UI 側で言い換えを持つと、文言が二重管理になり
 * 実装と食い違う。
 */

import type { ValidationIssue } from "@mnread/core";
import type { JSX } from "react";

import { formatLogMAR } from "../format.js";
import type { SessionView } from "../session/derive.js";
import type { SessionDraft } from "../session/state.js";
import { itemIndexToRowIndex } from "../session/state.js";

export interface IssueListProps {
  readonly draft: SessionDraft;
  readonly view: SessionView;
}

export function IssueList({ draft, view }: IssueListProps): JSX.Element | null {
  const errors = view.allIssues.filter((i) => i.severity === "error");
  const warnings = view.outcome.ok
    ? view.outcome.result.warnings
    : view.allIssues.filter((i) => i.severity === "warning");

  if (errors.length === 0 && warnings.length === 0) return null;

  const describe = (issue: ValidationIssue): string => {
    if (issue.itemIndex === null) return issue.message;
    const rowIndex = itemIndexToRowIndex(draft, issue.itemIndex);
    const logMAR = draft.rows[rowIndex]?.chartLogMAR;
    const where = logMAR === undefined ? "" : `${formatLogMAR(logMAR)} logMAR の行: `;
    return `${where}${issue.message}`;
  };

  return (
    <section className="issues" data-testid="issue-list">
      {errors.length > 0 && (
        <div className="issue-block issue-block-error">
          <h2 className="issues-error-title">入力エラー（{errors.length}件）</h2>
          <ul className="issue-list issue-list-error" data-testid="error-list">
            {errors.map((issue, i) => (
              <li key={`${issue.code}:${String(issue.itemIndex)}:${i}`}>{describe(issue)}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="issue-block issue-block-warn">
          <h2 className="issues-warn-title">注意（{warnings.length}件）</h2>
          <ul className="issue-list issue-list-warn" data-testid="warning-list">
            {warnings.map((issue, i) => (
              <li key={`${issue.code}:${String(issue.itemIndex)}:${i}`}>{describe(issue)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

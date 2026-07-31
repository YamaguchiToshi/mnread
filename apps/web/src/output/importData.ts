/**
 * 生データの読み込み（SPEC §8.2.3）
 *
 * 書き出した JSON を読み戻し、**編集・再解析できる状態**に復元する。値だけを
 * 表示し直すのではなく、検者の判定（プラトー選択・除外・上書き理由）まで戻す。
 * 戻らなければ「後から再解析する」目的を果たさない。
 *
 * 規則:
 *   - 読み込みは検者の明示操作でのみ発生する。自動読み込みを実装しない
 *   - **壊れたファイルは拒否する。読める部分だけ入れない**（ADR-0004 と同じ姿勢）。
 *     半分だけ入った検査は、入力途中の検査と見分けがつかない
 *   - 値の妥当性判定は core の `validateSession()` に委ねる。ここが行うのは
 *     「このファイルは本アプリの書き出しか」「行がチャートに載るか」までである
 *   - 版が違うファイルは読むが、**警告する**。算出法が変わっていれば表示される
 *     値も変わりうる（SPEC §10）
 */

import {
  ALGORITHM_VERSION,
  chartLogMARLevels,
  SPEC_VERSION,
  VARIANT_SPECS,
  type ItemStatus,
  type SessionInput,
  type Variant,
} from "@mnread/core";

import {
  createSession,
  emptyRow,
  EMPTY_JUDGEMENT,
  type JudgementDraft,
  type RowDraft,
  type SessionDraft,
} from "../session/state.js";

/** 書き出し側 (`exportData.ts`) が付ける識別子。 */
const FORMAT = "mnread-j-analysis";
const SUPPORTED_FORMAT_VERSION = 1;

export type ImportOutcome =
  | {
      readonly ok: true;
      readonly draft: SessionDraft;
      /** 読み込めたが検者に伝えるべきこと。空なら何もない */
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly error: string };

export function parseExportedSession(text: string): ImportOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON として読み取れないファイルです。" };
  }

  const envelope = parsed as Record<string, unknown>;
  if (envelope?.format !== FORMAT) {
    return {
      ok: false,
      error: "本アプリが書き出したファイルではありません（format が一致しない）。",
    };
  }
  if (
    typeof envelope.formatVersion !== "number" ||
    envelope.formatVersion > SUPPORTED_FORMAT_VERSION
  ) {
    return {
      ok: false,
      error: `対応していないファイル版です（formatVersion=${String(envelope.formatVersion)}）。`,
    };
  }

  const result = envelope.result as Record<string, unknown> | undefined;
  const input = result?.input as SessionInput | undefined;
  if (input === undefined || !Array.isArray(input.items)) {
    return { ok: false, error: "解析結果（result.input）が入っていません。" };
  }
  if (!(input.variant in VARIANT_SPECS)) {
    return {
      ok: false,
      error: `未知のチャート種別です: ${String(input.variant)}`,
    };
  }

  const built = buildRows(input);
  if (!built.ok) return built;

  const warnings: string[] = [];
  // 版が違えば算出法が変わっている可能性がある。黙って読み替えない。
  if (envelope.specVersion !== SPEC_VERSION) {
    warnings.push(
      `仕様版が異なります（ファイル ${String(envelope.specVersion)} / 現在 ${SPEC_VERSION}）。` +
        "表示される値がファイル書き出し時と変わることがあります。",
    );
  }
  if (envelope.algorithmVersion !== ALGORITHM_VERSION) {
    warnings.push(
      `アルゴリズム版が異なります（ファイル ${String(envelope.algorithmVersion)} / 現在 ${ALGORITHM_VERSION}）。` +
        "自動推定の値が変わることがあります。",
    );
  }

  const judgement = buildJudgement(result, built.rowIndexOfItem);
  if (judgement.lostSelection) {
    warnings.push(
      "このファイルには検者の目視判定が記録されていません。判定タブでやり直してください。",
    );
  }

  return {
    ok: true,
    draft: {
      ...createSession(input.variant as Variant),
      variant: input.variant as Variant,
      chartVersion: input.chartVersion ?? "",
      distanceText: numberText(input.viewingDistanceCm),
      polarity: input.polarity,
      eye: input.eye,
      sequenceDirection: input.sequenceDirection,
      subjectId: input.subject?.subjectId ?? "",
      ageText: input.subject?.age === undefined ? "" : String(input.subject.age),
      sex: input.subject?.sex ?? "",
      testDate: input.subject?.testDate ?? "",
      perRowDistance: built.rows.some((r) => r.distanceText !== ""),
      rows: built.rows,
      judgement: judgement.draft,
    },
    warnings,
  };
}

/* ---------------------------------------------------------- */

interface BuiltRows {
  readonly ok: true;
  readonly rows: readonly RowDraft[];
  /** items の添字 → rows の添字 */
  readonly rowIndexOfItem: ReadonlyMap<number, number>;
}

/**
 * items をチャート順の行へ戻す。
 *
 * `items` は**実施順**で並んでおり、`rows` は常にチャート順（大→小）である。
 * 添字ではなく `chartLogMAR` の値で突き合わせるのは、小→大で実施した記録を
 * 読んでも同じ行に着地させるためである。段の値は 0.1 刻みの二進小数なので、
 * 整数キーに直してから照合する。
 */
function buildRows(input: SessionInput): BuiltRows | { ok: false; error: string } {
  const spec = VARIANT_SPECS[input.variant];
  const levels = chartLogMARLevels(spec);
  const rowOfLevel = new Map(levels.map((logMAR, i) => [levelKey(logMAR), i]));

  const rows: RowDraft[] = levels.map(emptyRow);
  const rowIndexOfItem = new Map<number, number>();

  for (const [itemIndex, item] of input.items.entries()) {
    const rowIndex = rowOfLevel.get(levelKey(item.chartLogMAR));
    if (rowIndex === undefined) {
      return {
        ok: false,
        error: `チャートにない文字サイズが含まれています: ${String(item.chartLogMAR)} logMAR`,
      };
    }
    rowIndexOfItem.set(itemIndex, rowIndex);
    rows[rowIndex] = {
      chartLogMAR: levels[rowIndex]!,
      status: item.status as ItemStatus,
      timeText: numberText(item.timeSec),
      errorText: numberText(item.errorCount),
      distanceText: numberText(item.viewingDistanceCm),
      note: item.note ?? "",
    };
  }

  return { ok: true, rows, rowIndexOfItem };
}

interface BuiltJudgement {
  readonly draft: JudgementDraft;
  /** 判定が記録されていないファイルだったか */
  readonly lostSelection: boolean;
}

function buildJudgement(
  result: Record<string, unknown> | undefined,
  rowIndexOfItem: ReadonlyMap<number, number>,
): BuiltJudgement {
  const selection = result?.manualPlateau as
    | {
        plateauItemIndices?: readonly number[];
        excludedItemIndices?: readonly number[];
        exclusionReasons?: Record<string, string>;
      }
    | null
    | undefined;
  const overrideReason =
    (result?.selection as { overrideReason?: string | null } | undefined)
      ?.overrideReason ?? "";

  if (selection == null || !Array.isArray(selection.plateauItemIndices)) {
    return {
      draft: { ...EMPTY_JUDGEMENT, overrideReason },
      lostSelection: true,
    };
  }

  const toRow = (itemIndex: number): number => rowIndexOfItem.get(itemIndex) ?? -1;
  const reasons: Record<number, string> = {};
  for (const [itemIndex, reason] of Object.entries(selection.exclusionReasons ?? {})) {
    const row = toRow(Number(itemIndex));
    if (row >= 0) reasons[row] = reason;
  }

  return {
    draft: {
      plateauRowIndices: selection.plateauItemIndices
        .map(toRow)
        .filter((r) => r >= 0)
        .sort((a, b) => a - b),
      excludedRowIndices: (selection.excludedItemIndices ?? [])
        .map(toRow)
        .filter((r) => r >= 0)
        .sort((a, b) => a - b),
      exclusionReasons: reasons,
      overrideReason,
    },
    lostSelection: false,
  };
}

/** 0.1 刻みの段を整数キーにする。二進小数のまま照合すると取りこぼす。 */
function levelKey(logMAR: number): number {
  return Math.round(logMAR * 10);
}

/** 数値 → 入力欄のテキスト。欠測は空欄（0 と混同しない。ADR-0002）。 */
function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

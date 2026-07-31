/**
 * Levenberg–Marquardt 非線形最小二乗（内部ユーティリティ）
 *
 * `core` を依存なしに保つため自前実装とする（ADR-0010 の趣旨に加え、
 * オフライン配布と版固定の要件による）。パラメータ数が3、データ点が20点未満
 * という小さな問題に限って用いる。
 *
 * ヤコビアンは中心差分による数値微分。解析微分にしないのは、モデルを
 * 差し替えたときに微分側の更新漏れで静かに壊れることを避けるため。
 */

export interface LmOptions {
  readonly maxIterations: number;
  /** 相対 SSE 減少がこれを下回ったら収束とみなす */
  readonly tolerance: number;
  /** 数値微分の刻み（パラメータの絶対値に対する相対量） */
  readonly stepRelative: number;
  readonly initialLambda: number;
}

export const DEFAULT_LM_OPTIONS: LmOptions = {
  maxIterations: 200,
  tolerance: 1e-12,
  stepRelative: 1e-6,
  initialLambda: 1e-2,
};

export interface LmResult {
  readonly parameters: readonly number[];
  readonly converged: boolean;
  readonly iterations: number;
  /** 残差平方和 */
  readonly sse: number;
  readonly rmse: number;
}

export type Model = (x: number, params: readonly number[]) => number;

/**
 * 収束したかは `converged` で判断すること。反復上限に達した場合も
 * パラメータは返すが、その値を通常値として扱ってはならない。
 */
export function levenbergMarquardt(
  xs: readonly number[],
  ys: readonly number[],
  initial: readonly number[],
  model: Model,
  options: LmOptions = DEFAULT_LM_OPTIONS,
): LmResult {
  const n = xs.length;
  const p = initial.length;

  let params = [...initial];
  let lambda = options.initialLambda;
  let sse = sumSquares(xs, ys, params, model);
  let converged = false;
  let iterations = 0;

  for (let iter = 0; iter < options.maxIterations; iter += 1) {
    iterations = iter + 1;

    const residuals = xs.map((x, i) => ys[i]! - model(x, params));
    const jacobian = numericJacobian(xs, params, model, options.stepRelative);

    // JᵀJ と Jᵀr
    const jtj = zeros(p, p);
    const jtr = new Array<number>(p).fill(0);
    for (let i = 0; i < n; i += 1) {
      const row = jacobian[i]!;
      for (let a = 0; a < p; a += 1) {
        jtr[a]! += row[a]! * residuals[i]!;
        for (let b = 0; b < p; b += 1) {
          jtj[a]![b]! += row[a]! * row[b]!;
        }
      }
    }

    let improved = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const augmented = jtj.map((row, a) =>
        row.map((v, b) => (a === b ? v * (1 + lambda) : v)),
      );
      const delta = solve(augmented, jtr);
      if (delta === null) {
        lambda *= 10;
        continue;
      }

      const next = params.map((v, i) => v + delta[i]!);
      if (next.some((v) => !Number.isFinite(v))) {
        lambda *= 10;
        continue;
      }

      const nextSse = sumSquares(xs, ys, next, model);
      if (Number.isFinite(nextSse) && nextSse < sse) {
        const relative = (sse - nextSse) / Math.max(sse, Number.EPSILON);
        params = next;
        sse = nextSse;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (relative < options.tolerance) converged = true;
        break;
      }
      lambda *= 10;
    }

    if (!improved) {
      // これ以上 SSE を下げられない。局所最小に達したとみなす。
      converged = true;
      break;
    }
    if (converged) break;
  }

  return {
    parameters: params,
    converged,
    iterations,
    sse,
    rmse: Math.sqrt(sse / n),
  };
}

function sumSquares(
  xs: readonly number[],
  ys: readonly number[],
  params: readonly number[],
  model: Model,
): number {
  let total = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const r = ys[i]! - model(xs[i]!, params);
    if (!Number.isFinite(r)) return Number.POSITIVE_INFINITY;
    total += r * r;
  }
  return total;
}

function numericJacobian(
  xs: readonly number[],
  params: readonly number[],
  model: Model,
  stepRelative: number,
): number[][] {
  const p = params.length;
  return xs.map((x) => {
    const row = new Array<number>(p).fill(0);
    for (let a = 0; a < p; a += 1) {
      const h = Math.max(Math.abs(params[a]!) * stepRelative, 1e-8);
      const up = [...params];
      const down = [...params];
      up[a] = params[a]! + h;
      down[a] = params[a]! - h;
      const d = (model(x, up) - model(x, down)) / (2 * h);
      row[a] = Number.isFinite(d) ? d : 0;
    }
    return row;
  });
}

function zeros(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

/** ガウスの消去法（部分ピボット選択）。特異なら null。 */
function solve(a: readonly number[][], b: readonly number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-14) return null;
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    const pv = m[col]![col]!;
    for (let r = col + 1; r < n; r += 1) {
      const factor = m[r]![col]! / pv;
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) m[r]![c]! -= factor * m[col]![c]!;
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = m[row]![n]!;
    for (let c = row + 1; c < n; c += 1) sum -= m[row]![c]! * x[c]!;
    x[row] = sum / m[row]![row]!;
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

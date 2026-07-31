"use strict";

/* =========================================================
   Constants (from MNREAD-J_Web_App_Specification.md, section 2.2)
   ========================================================= */

const SIZES = Array.from({ length: 19 }, (_, i) => ({
  index: i,
  logMAR: Math.round((1.3 - i * 0.1) * 10) / 10,
}));

const MAX_CHARS = { J: 30, Jk: 24 };
const ERR_DENOM = { J: 300, Jk: 240 };
const PLATEAU_RATIO = 0.9; // rows within 90% of peak cpm are considered "plateau" for MRS
const CPS_DROP_RATIO = 0.85; // CPS = last size before speed falls below 85% of MRS
const EYE_LABEL = { both: "両眼", right: "右眼", left: "左眼" };

/* =========================================================
   State
   ========================================================= */

const state = {
  settings: {
    chartType: "J",
    polarity: "normal",
    eye: "both",
    distance: 30,
    subjectId: "",
    age: "",
    sex: "",
    date: "",
  },
  rows: SIZES.map(() => ({ time: null, errors: null, unread: false })),
  overrides: { mrs: null, cpsX: null }, // manual drag overrides
};

/* =========================================================
   Small numeric helpers
   ========================================================= */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const logMARtoM = (l) => Math.pow(10, l);
const logMARtoDecimal = (l) => Math.pow(10, -l);
const fmtM = (v) => (v >= 1 ? v.toFixed(1) : v.toFixed(2));
const fmtDecimal = (v) => v.toFixed(2);
const fmtSigned = (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));

/* =========================================================
   Core calculation
   ========================================================= */

function computeAll() {
  const { chartType, distance } = state.settings;
  const maxChars = MAX_CHARS[chartType];
  const errDenom = ERR_DENOM[chartType];
  const delta = Math.log10(30 / Number(distance || 30));

  // find first row with any entered data
  let startIndex = null;
  state.rows.forEach((r, i) => {
    if (startIndex === null && (r.time != null || r.errors != null || r.unread)) {
      startIndex = i;
    }
  });

  const rowResults = state.rows.map((r, i) => {
    const nominalLogMAR = SIZES[i].logMAR;
    const adjustedLogMAR = Math.round((nominalLogMAR + delta) * 100) / 100;

    if (startIndex === null) return { status: "empty", nominalLogMAR, adjustedLogMAR };
    if (i < startIndex) return { status: "auto", nominalLogMAR, adjustedLogMAR, errors: 0 };
    if (r.unread) return { status: "unread", nominalLogMAR, adjustedLogMAR };
    if (r.time != null && r.time > 0) {
      const errors = r.errors != null ? r.errors : 0;
      const cpm = ((maxChars - errors) / r.time) * 60;
      return { status: "measured", nominalLogMAR, adjustedLogMAR, errors, cpm: Math.max(0, cpm) };
    }
    return { status: "empty", nominalLogMAR, adjustedLogMAR };
  });

  const counted = rowResults.filter((r) => r.status === "auto" || r.status === "measured");
  const sentencesCompleted = counted.length;
  const totalErrors = counted.reduce((s, r) => s + (r.errors || 0), 0);

  const measured = rowResults.filter((r) => r.status === "measured");

  let autoMRS = null;
  let autoCPSAdjustedLogMAR = null;

  if (measured.length > 0) {
    const maxCpm = Math.max(...measured.map((r) => r.cpm));
    const plateau = measured.filter((r) => r.cpm >= PLATEAU_RATIO * maxCpm);
    autoMRS = plateau.reduce((s, r) => s + r.cpm, 0) / plateau.length;

    const threshold = CPS_DROP_RATIO * autoMRS;
    let lastAtOrAbove = measured[0];
    let dropFound = false;
    for (const r of measured) {
      if (r.cpm >= threshold) {
        lastAtOrAbove = r;
      } else {
        dropFound = true;
        break;
      }
    }
    autoCPSAdjustedLogMAR = dropFound ? lastAtOrAbove.adjustedLogMAR : measured[measured.length - 1].adjustedLogMAR;
  }

  const mrsValue = state.overrides.mrs != null ? state.overrides.mrs : autoMRS;
  const cpsAdjustedLogMAR = state.overrides.cpsX != null ? state.overrides.cpsX : autoCPSAdjustedLogMAR;

  let RA = null;
  if (startIndex !== null) {
    RA = 1.4 - sentencesCompleted * 0.1 + totalErrors / errDenom + delta;
    RA = Math.round(RA * 100) / 100;
  }

  return {
    delta,
    startIndex,
    rowResults,
    sentencesCompleted,
    totalErrors,
    measured,
    autoMRS,
    autoCPSAdjustedLogMAR,
    mrsValue,
    cpsAdjustedLogMAR,
    RA,
    maxChars,
    errDenom,
  };
}

/* =========================================================
   Rendering: score table
   ========================================================= */

const tbody = document.getElementById("scoreTableBody");

function buildTable() {
  tbody.innerHTML = "";
  SIZES.forEach((sz, i) => {
    const tr = document.createElement("tr");
    tr.id = `row-${i}`;

    const refM = logMARtoM(sz.logMAR);
    const refDec = logMARtoDecimal(sz.logMAR);

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${sz.logMAR.toFixed(1)}</td>
      <td class="ref-cell">${fmtM(refM)}M / ${fmtDecimal(refDec)}</td>
      <td><input type="number" step="0.1" min="0" class="time-input" data-i="${i}" aria-label="読破時間(秒) 段${i + 1}"></td>
      <td><input type="number" step="1" min="0" class="err-input" data-i="${i}" aria-label="エラー数 段${i + 1}"></td>
      <td><input type="checkbox" class="unread-input" data-i="${i}" aria-label="不読 段${i + 1}"></td>
      <td class="cpm-cell" id="cpm-${i}">–</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".time-input").forEach((el) => {
    el.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.i);
      const v = parseFloat(e.target.value);
      state.rows[i].time = Number.isFinite(v) ? v : null;
      recomputeAndRender();
    });
  });
  tbody.querySelectorAll(".err-input").forEach((el) => {
    el.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.i);
      const v = parseInt(e.target.value, 10);
      state.rows[i].errors = Number.isFinite(v) ? v : null;
      recomputeAndRender();
    });
  });
  tbody.querySelectorAll(".unread-input").forEach((el) => {
    el.addEventListener("change", (e) => {
      const i = Number(e.target.dataset.i);
      state.rows[i].unread = e.target.checked;
      recomputeAndRender();
    });
  });
}

function syncTableInputs() {
  state.rows.forEach((r, i) => {
    const timeEl = tbody.querySelector(`.time-input[data-i="${i}"]`);
    const errEl = tbody.querySelector(`.err-input[data-i="${i}"]`);
    const unreadEl = tbody.querySelector(`.unread-input[data-i="${i}"]`);
    timeEl.value = r.time != null ? r.time : "";
    errEl.value = r.errors != null ? r.errors : "";
    unreadEl.checked = !!r.unread;
  });
}

function renderTableResults(result) {
  result.rowResults.forEach((rr, i) => {
    const tr = document.getElementById(`row-${i}`);
    const cpmCell = document.getElementById(`cpm-${i}`);
    tr.classList.remove("row-auto", "row-unread", "row-active");
    if (rr.status === "auto") {
      tr.classList.add("row-auto");
      cpmCell.textContent = "(全問正解)";
    } else if (rr.status === "unread") {
      tr.classList.add("row-unread");
      cpmCell.textContent = "不読 (0 cpm)";
    } else if (rr.status === "measured") {
      tr.classList.add("row-active");
      cpmCell.textContent = rr.cpm.toFixed(0);
    } else {
      cpmCell.textContent = "–";
    }
  });
}

/* =========================================================
   Rendering: results cards
   ========================================================= */

function renderResultCards(result) {
  const { chartType } = state.settings;

  document.getElementById("outRA").textContent = result.RA != null ? `${result.RA.toFixed(2)} logMAR` : "–";
  document.getElementById("outRASub").textContent =
    result.RA != null ? `小数視力換算: ${fmtDecimal(logMARtoDecimal(result.RA))}` : "";

  document.getElementById("outMRS").textContent = result.mrsValue != null ? `${result.mrsValue.toFixed(0)} cpm` : "–";

  document.getElementById("outCPS").textContent =
    result.cpsAdjustedLogMAR != null ? `${result.cpsAdjustedLogMAR.toFixed(2)} logMAR` : "–";
  document.getElementById("outCPSSub").textContent =
    result.cpsAdjustedLogMAR != null
      ? `${fmtM(logMARtoM(result.cpsAdjustedLogMAR))}M / ${fmtDecimal(logMARtoDecimal(result.cpsAdjustedLogMAR))}相当`
      : "自動検出値。グラフ上の縦線をドラッグして手動調整可能";

  document.getElementById("outDelta").textContent = `${fmtSigned(result.delta)} logMAR`;
  document.getElementById("outDeltaSub").textContent = `測定距離 ${state.settings.distance}cm（基準30cm）`;
}

/* =========================================================
   Recommendations / findings text
   ========================================================= */

function buildRecommendations(result) {
  if (result.cpsAdjustedLogMAR == null) {
    return { magLow: null, magHigh: null, fontPt: null, findings: "" };
  }
  const mCPS = logMARtoM(result.cpsAdjustedLogMAR);
  const magLow = Math.round(mCPS * 10) / 10;
  const magHigh = Math.round(mCPS * 1.25 * 10) / 10;
  // Rough heuristic (not a clinical formula from the spec): 1M ~ 10pt at typical
  // near-viewing distance. Flagged as an approximate estimate in the UI.
  const fontPt = Math.round(mCPS * 10);

  let findings = `${result.cpsAdjustedLogMAR.toFixed(1)} logMAR 以下で読書速度が急速に低下します。`;
  findings += ` 新聞・書籍等の通常印刷物には約${magLow}〜${magHigh}倍の拡大鏡・拡大読書器の使用、`;
  findings += `またはタブレット/PC利用時は${fontPt}pt以上の文字サイズでの表示を推奨します。`;
  if (result.RA != null && result.RA >= 1.0) {
    findings += " 読書視力の低下が大きく、拡大読書器の導入検討を推奨します。";
  }
  return { magLow, magHigh, fontPt, findings };
}

/* =========================================================
   EMR text
   ========================================================= */

function renderEMRText(result, reco) {
  const s = state.settings;
  const dateLabel = s.date || "(未入力)";
  const eyeLabel = EYE_LABEL[s.eye] || s.eye;

  const lines = [];
  lines.push(`【MNREAD-${s.chartType} 読書能力評価】`);
  lines.push(
    `測定日: ${dateLabel} | 検査眼: ${eyeLabel} | 距離: ${s.distance}cm (補正: ${fmtSigned(result.delta)} logMAR)`
  );
  lines.push(`・最大読書速度 (MRS): ${result.mrsValue != null ? result.mrsValue.toFixed(0) : "–"} cpm`);
  if (result.cpsAdjustedLogMAR != null) {
    lines.push(
      `・臨界文字サイズ (CPS): ${result.cpsAdjustedLogMAR.toFixed(2)} logMAR (${fmtM(
        logMARtoM(result.cpsAdjustedLogMAR)
      )}M / ${fmtDecimal(logMARtoDecimal(result.cpsAdjustedLogMAR))}相当) [新聞(1M)に対し約${reco.magLow}倍〜${reco.magHigh}倍拡大]`
    );
  } else {
    lines.push(`・臨界文字サイズ (CPS): –`);
  }
  lines.push(`・読書視力 (RA): ${result.RA != null ? result.RA.toFixed(2) : "–"} logMAR (${result.RA != null ? fmtDecimal(logMARtoDecimal(result.RA)) : "–"}相当)`);
  lines.push(`・所見: ${reco.findings || "(測定データを入力してください)"}`);

  document.getElementById("emrText").value = lines.join("\n");
}

/* =========================================================
   Printable report
   ========================================================= */

function renderReport(result, reco) {
  const s = state.settings;
  document.getElementById("reportMeta").textContent =
    `測定日: ${s.date || "-"} ｜ 検査眼: ${EYE_LABEL[s.eye] || s.eye} ｜ 距離: ${s.distance}cm ｜ ` +
    `チャート: MNREAD-${s.chartType}` +
    (s.subjectId ? ` ｜ ID: ${s.subjectId}` : "");

  document.getElementById("rpRA").textContent =
    result.RA != null ? `${result.RA.toFixed(2)} logMAR (${fmtDecimal(logMARtoDecimal(result.RA))}相当)` : "–";
  document.getElementById("rpMRS").textContent = result.mrsValue != null ? `${result.mrsValue.toFixed(0)} cpm` : "–";
  document.getElementById("rpCPS").textContent =
    result.cpsAdjustedLogMAR != null
      ? `${result.cpsAdjustedLogMAR.toFixed(2)} logMAR (${fmtM(logMARtoM(result.cpsAdjustedLogMAR))}M相当)`
      : "–";

  document.getElementById("rpMag").textContent =
    reco.magLow != null ? `約 ${reco.magLow} 〜 ${reco.magHigh} 倍` : "–";
  document.getElementById("rpFont").textContent = reco.fontPt != null ? `約 ${reco.fontPt} pt 以上（目安）` : "–";
  document.getElementById("rpFindings").textContent = reco.findings || "測定データを入力してください。";
}

/* =========================================================
   Chart
   ========================================================= */

let mainChart = null;
let reportChart = null;

function zoneBackgroundPlugin(getResult) {
  return {
    id: "zoneBackground",
    beforeDatasetsDraw(chart) {
      const result = getResult();
      if (!result || result.RA == null || result.cpsAdjustedLogMAR == null) return;
      const { ctx, chartArea, scales } = chart;
      const x = scales.x;
      const xMinVal = Math.min(x.min, x.max);
      const xMaxVal = Math.max(x.min, x.max);

      const zones = [
        { from: result.cpsAdjustedLogMAR, to: xMaxVal, color: "rgba(30,138,76,0.12)" }, // comfortable (large sizes)
        { from: result.RA, to: result.cpsAdjustedLogMAR, color: "rgba(184,134,11,0.12)" }, // effortful
        { from: xMinVal, to: result.RA, color: "rgba(192,57,43,0.10)" }, // unreadable
      ];

      ctx.save();
      zones.forEach((z) => {
        const from = clamp(z.from, xMinVal, xMaxVal);
        const to = clamp(z.to, xMinVal, xMaxVal);
        if (from === to) return;
        const px1 = x.getPixelForValue(from);
        const px2 = x.getPixelForValue(to);
        const left = Math.min(px1, px2);
        const right = Math.max(px1, px2);
        ctx.fillStyle = z.color;
        ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
      });
      ctx.restore();
    },
  };
}

function mrsCpsLinesPlugin(getResult) {
  return {
    id: "mrsCpsLines",
    afterDraw(chart) {
      const result = getResult();
      if (!result) return;
      const { ctx, chartArea, scales } = chart;
      ctx.save();

      if (result.mrsValue != null) {
        const y = scales.yCpm.getPixelForValue(result.mrsValue);
        ctx.strokeStyle = "#1e8a4c";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#1e8a4c";
        ctx.font = "11px sans-serif";
        ctx.fillText(`MRS ${result.mrsValue.toFixed(0)} cpm`, chartArea.left + 4, y - 4);
      }

      if (result.cpsAdjustedLogMAR != null) {
        const x = scales.x.getPixelForValue(result.cpsAdjustedLogMAR);
        ctx.strokeStyle = "#1a6fa0";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#1a6fa0";
        ctx.font = "11px sans-serif";
        ctx.save();
        ctx.translate(x + 4, chartArea.top + 12);
        ctx.fillText(`CPS ${result.cpsAdjustedLogMAR.toFixed(2)}`, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    },
  };
}

function computeAxisRange() {
  const delta = Math.log10(30 / Number(state.settings.distance || 30));
  const values = SIZES.map((s) => s.logMAR + delta);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 0.15;
  return { min: min - pad, max: max + pad };
}

function buildDatasets(result) {
  const timePoints = [];
  const cpmPoints = [];
  const unreadPoints = [];

  result.rowResults.forEach((r, i) => {
    if (r.status === "measured") {
      timePoints.push({ x: r.adjustedLogMAR, y: state.rows[i].time });
      cpmPoints.push({ x: r.adjustedLogMAR, y: r.cpm });
    } else if (r.status === "unread") {
      unreadPoints.push({ x: r.adjustedLogMAR, y: 5 });
    }
  });

  return { timePoints, cpmPoints, unreadPoints };
}

function buildChartConfig(result, { interactive }) {
  const { timePoints, cpmPoints, unreadPoints } = buildDatasets(result);
  const range = computeAxisRange();

  const plugins = interactive
    ? [mrsCpsLinesPlugin(() => currentResult)]
    : [zoneBackgroundPlugin(() => currentResult), mrsCpsLinesPlugin(() => currentResult)];

  return {
    type: "line",
    data: {
      datasets: [
        {
          label: "読破時間 (秒)",
          data: timePoints,
          borderColor: "#c0392b",
          backgroundColor: "#c0392b",
          yAxisID: "ySec",
          spanGaps: false,
          tension: 0.15,
        },
        {
          label: "読書速度 (cpm)",
          data: cpmPoints,
          borderColor: "#1a6fa0",
          backgroundColor: "#1a6fa0",
          yAxisID: "yCpm",
          spanGaps: false,
          tension: 0.15,
        },
        {
          label: "不読",
          data: unreadPoints,
          showLine: false,
          pointStyle: "crossRot",
          radius: 6,
          borderColor: "#c0392b",
          backgroundColor: "#c0392b",
          yAxisID: "yCpm",
        },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: {
          type: "linear",
          reverse: false,
          min: range.min,
          max: range.max,
          title: { display: true, text: "文字サイズ logMAR（測定距離補正済み）" },
        },
        ySec: {
          type: "logarithmic",
          position: "right",
          title: { display: true, text: "読破時間 (秒)" },
          grid: { drawOnChartArea: false },
        },
        yCpm: {
          type: "logarithmic",
          position: "left",
          min: 1,
          title: { display: true, text: "読書速度 (cpm)" },
        },
      },
      plugins: {
        legend: { position: "bottom" },
      },
    },
    plugins,
  };
}

let currentResult = null;

function renderChart(result) {
  currentResult = result;

  const mainCanvas = document.getElementById("mainChart");
  if (mainChart) {
    mainChart.destroy();
  }
  mainChart = new Chart(mainCanvas, buildChartConfig(result, { interactive: true }));
  attachDragHandlers(mainCanvas);

  // The report canvas lives off-screen (see .print-only in style.css), not in a
  // display:none container, so it always has real layout dimensions and Chart.js
  // can size it correctly -- including for print, with no special print-time step.
  const reportCanvas = document.getElementById("reportChart");
  if (reportChart) {
    reportChart.destroy();
  }
  reportChart = new Chart(reportCanvas, buildChartConfig(result, { interactive: false }));
}

/* ---- drag interaction for MRS / CPS lines on the interactive chart ---- */

let dragTarget = null;

function attachDragHandlers(canvas) {
  canvas.onmousedown = (e) => startDrag(canvas, e.clientX, e.clientY);
  window.onmousemove = (e) => {
    if (!dragTarget) {
      hoverCursor(canvas, e.clientX, e.clientY);
      return;
    }
    moveDrag(canvas, e.clientX, e.clientY);
  };
  window.onmouseup = () => {
    dragTarget = null;
  };

  canvas.ontouchstart = (e) => {
    const t = e.touches[0];
    startDrag(canvas, t.clientX, t.clientY);
  };
  canvas.ontouchmove = (e) => {
    if (!dragTarget) return;
    e.preventDefault();
    const t = e.touches[0];
    moveDrag(canvas, t.clientX, t.clientY);
  };
  canvas.ontouchend = () => {
    dragTarget = null;
  };
}

function hitTest(canvas, clientX, clientY) {
  if (!currentResult) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const scales = mainChart.scales;

  if (currentResult.mrsValue != null) {
    const py = scales.yCpm.getPixelForValue(currentResult.mrsValue);
    if (Math.abs(y - py) < 8 && x >= scales.x.left && x <= scales.x.right) return "mrs";
  }
  if (currentResult.cpsAdjustedLogMAR != null) {
    const px = scales.x.getPixelForValue(currentResult.cpsAdjustedLogMAR);
    if (Math.abs(x - px) < 8 && y >= scales.yCpm.top && y <= scales.yCpm.bottom) return "cps";
  }
  return null;
}

function startDrag(canvas, clientX, clientY) {
  const hit = hitTest(canvas, clientX, clientY);
  if (hit) dragTarget = hit;
}

function hoverCursor(canvas, clientX, clientY) {
  const hit = hitTest(canvas, clientX, clientY);
  canvas.style.cursor = hit === "mrs" ? "ns-resize" : hit === "cps" ? "ew-resize" : "default";
}

function moveDrag(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const scales = mainChart.scales;

  if (dragTarget === "mrs") {
    const v = clamp(scales.yCpm.getValueForPixel(y), 1, 2000);
    state.overrides.mrs = Math.round(v);
  } else if (dragTarget === "cps") {
    const range = computeAxisRange();
    const v = clamp(scales.x.getValueForPixel(x), range.min, range.max);
    state.overrides.cpsX = Math.round(v * 100) / 100;
  }
  recomputeAndRender({ skipTableRebuild: true });
}

/* =========================================================
   Top-level recompute / render
   ========================================================= */

function recomputeAndRender() {
  const result = computeAll();
  renderTableResults(result);
  renderResultCards(result);
  const reco = buildRecommendations(result);
  renderEMRText(result, reco);
  renderReport(result, reco);
  renderChart(result);
}

/* =========================================================
   Settings panel wiring
   ========================================================= */

function readSettingsFromDOM() {
  state.settings.chartType = document.getElementById("chartType").value;
  state.settings.polarity = document.getElementById("polarity").value;
  state.settings.eye = document.getElementById("eye").value;
  state.settings.distance = Number(document.getElementById("distance").value) || 30;
  state.settings.subjectId = document.getElementById("subjectId").value;
  state.settings.age = document.getElementById("subjectAge").value;
  state.settings.sex = document.getElementById("subjectSex").value;
  state.settings.date = document.getElementById("examDate").value;
}

function wireSettings() {
  [
    "chartType",
    "polarity",
    "eye",
    "distance",
    "subjectId",
    "subjectAge",
    "subjectSex",
    "examDate",
  ].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      readSettingsFromDOM();
      recomputeAndRender();
    });
  });
}

/* =========================================================
   Buttons
   ========================================================= */

function loadSampleData() {
  document.getElementById("examDate").value = new Date().toISOString().slice(0, 10);
  document.getElementById("distance").value = 30;
  document.getElementById("chartType").value = "J";
  readSettingsFromDOM();

  const sample = {
    3: { time: 6.0, errors: 0 },
    4: { time: 5.5, errors: 0 },
    5: { time: 5.0, errors: 0 },
    6: { time: 5.0, errors: 1 },
    7: { time: 5.2, errors: 0 },
    8: { time: 5.5, errors: 1 },
    9: { time: 6.0, errors: 2 },
    10: { time: 8.0, errors: 2 },
    11: { time: 11.0, errors: 3 },
    12: { time: 16.0, errors: 5 },
    13: { time: 22.0, errors: 8 },
  };

  state.rows = SIZES.map(() => ({ time: null, errors: null, unread: false }));
  Object.entries(sample).forEach(([i, v]) => {
    state.rows[i].time = v.time;
    state.rows[i].errors = v.errors;
  });
  state.rows[14].unread = true;

  state.overrides = { mrs: null, cpsX: null };
  syncTableInputs();
  recomputeAndRender();
}

function resetAll() {
  state.rows = SIZES.map(() => ({ time: null, errors: null, unread: false }));
  state.overrides = { mrs: null, cpsX: null };
  syncTableInputs();
  recomputeAndRender();
}

function wireButtons() {
  document.getElementById("btnSample").addEventListener("click", loadSampleData);
  document.getElementById("btnReset").addEventListener("click", resetAll);
  document.getElementById("btnResetOverride").addEventListener("click", () => {
    state.overrides = { mrs: null, cpsX: null };
    recomputeAndRender();
  });
  document.getElementById("btnPrint").addEventListener("click", () => window.print());
  document.getElementById("btnCopy").addEventListener("click", async () => {
    const text = document.getElementById("emrText").value;
    const statusEl = document.getElementById("copyStatus");
    try {
      await navigator.clipboard.writeText(text);
      statusEl.textContent = "コピーしました";
    } catch (err) {
      statusEl.textContent = "コピーに失敗しました（手動で選択してください）";
    }
    setTimeout(() => (statusEl.textContent = ""), 2500);
  });
}

/* =========================================================
   Init
   ========================================================= */

function init() {
  document.getElementById("examDate").value = new Date().toISOString().slice(0, 10);
  readSettingsFromDOM();
  buildTable();
  wireSettings();
  wireButtons();
  recomputeAndRender();
}

document.addEventListener("DOMContentLoaded", init);

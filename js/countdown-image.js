(() => {
  "use strict";

  const CANVAS_WIDTH = 1080;
  const CANVAS_HEIGHT = 1350;
  const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

  const state = {
    targetDate: "",
    eventName: "",
    hideExpired: false,
    seriesDays: 0,
    background: null,
    loadToken: 0,
    files: []
  };

  const $ = id => document.getElementById(id);
  const canvas = $("previewCanvas");
  const ctx = canvas.getContext("2d");
  const controls = {
    targetDate: $("targetDate"),
    eventName: $("eventName"),
    expiredHide: $("expiredHide"),
    seriesCount: $("seriesCount"),
    bgInput: $("bgInput"),
    clearBgBtn: $("clearBgBtn"),
    generateBtn: $("generateBtn"),
    zipBtn: $("zipBtn"),
    genStatus: $("genStatus"),
    status: $("status")
  };

  function fontOf(size, weight) {
    return weight + " " + size + "px " + FONT_STACK;
  }

  function todayStr() {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  /* daysUntil 保证自然日差；batch 时把“模拟今天”固定为目标日往前推 N 天。 */
  function daysFromNow(targetDateStr) {
    return CanvasUtils.daysUntil(targetDateStr);
  }

  function daysFromSimulated(targetDateStr, offsetDaysBefore) {
    const parts = targetDateStr.split("-").map(Number);
    const target = new Date(parts[0], parts[1] - 1, parts[2]);
    const simulatedToday = new Date(target);
    simulatedToday.setDate(simulatedToday.getDate() - offsetDaysBefore);
    return CanvasUtils.daysUntil(targetDateStr, simulatedToday);
  }

  function countdownCopy(days) {
    if (days > 0) return { main: String(days), label: "还有 " + days + " 天", unit: "天", mode: "counting" };
    if (days === 0) return { main: "0", label: "就是今天！", unit: "天", mode: "today" };
    if (state.hideExpired) return { main: "", label: "", unit: "", mode: "hidden" };
    return { main: "", label: "已结束", unit: "", mode: "ended" };
  }

  function drawBackground(targetCtx) {
    if (state.background) {
      CanvasUtils.drawCover(targetCtx, state.background.image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      const veil = targetCtx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      veil.addColorStop(0, "rgba(16,41,31,.32)");
      veil.addColorStop(1, "rgba(16,41,31,.58)");
      targetCtx.fillStyle = veil;
      targetCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return;
    }
    const gradient = targetCtx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, "#236b4f");
    gradient.addColorStop(0.55, "#174c38");
    gradient.addColorStop(1, "#10291f");
    targetCtx.fillStyle = gradient;
    targetCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  function drawCountdown(targetCtx, copy) {
    targetCtx.textAlign = "center";
    targetCtx.textBaseline = "middle";

    if (state.eventName.trim()) {
      const nameSize = CanvasUtils.fitFontSize(targetCtx, state.eventName.trim(), CANVAS_WIDTH * 0.8, { maxFontSize: 64, minFontSize: 30, fontFamily: FONT_STACK, weight: "700" });
      targetCtx.font = fontOf(nameSize, "700");
      targetCtx.fillStyle = "rgba(255,255,255,.9)";
      targetCtx.fillText(state.eventName.trim(), CANVAS_WIDTH / 2, 210);
    }

    if (copy.mode === "counting" || copy.mode === "today") {
      const numberText = copy.mode === "today" ? "今天" : copy.main;
      const numberSize = CanvasUtils.fitFontSize(targetCtx, numberText, CANVAS_WIDTH * 0.78, { maxFontSize: 480, minFontSize: 120, fontFamily: FONT_STACK, weight: "800" });
      targetCtx.font = fontOf(numberSize, "800");
      targetCtx.fillStyle = "#ffffff";
      targetCtx.fillText(numberText, CANVAS_WIDTH / 2, 620);
      if (copy.mode === "counting") {
        targetCtx.font = fontOf(90, "700");
        targetCtx.fillStyle = "rgba(255,255,255,.75)";
        targetCtx.fillText("天", CANVAS_WIDTH / 2, 940);
      }
      targetCtx.font = fontOf(52, "700");
      targetCtx.fillStyle = "rgba(255,255,255,.92)";
      targetCtx.fillText(copy.label, CANVAS_WIDTH / 2, copy.mode === "counting" ? 1060 : 940);
    } else if (copy.mode === "ended") {
      targetCtx.font = fontOf(160, "800");
      targetCtx.fillStyle = "rgba(255,255,255,.9)";
      targetCtx.fillText("已结束", CANVAS_WIDTH / 2, 700);
    }

    // 日期落款。
    if (state.targetDate) {
      targetCtx.font = fontOf(34, "600");
      targetCtx.fillStyle = "rgba(255,255,255,.6)";
      targetCtx.fillText(state.targetDate.replace(/-/g, " / "), CANVAS_WIDTH / 2, CANVAS_HEIGHT - 110);
    }
  }

  function renderPreview(copy) {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawBackground(ctx);
    drawCountdown(ctx, copy);
  }

  function buildBatchPlan() {
    const offsets = [];
    for (let i = state.seriesDays; i >= 0; i--) offsets.push(i);
    return offsets.map(offset => {
      const days = state.seriesDays > 0 ? daysFromSimulated(state.targetDate, offset) : daysFromNow(state.targetDate);
      return { offset, days };
    });
  }

  async function generate() {
    if (!state.targetDate) {
      controls.genStatus.textContent = "请先选择目标日期。";
      return;
    }
    const plan = buildBatchPlan();
    const firstCopy = countdownCopy(plan[0].days);
    renderPreview(firstCopy);

    if (state.seriesDays === 0) {
      state.files = [];
      controls.zipBtn.disabled = true;
      controls.genStatus.textContent = firstCopy.mode === "counting"
        ? "距目标日还有 " + plan[0].days + " 天，预览已更新。"
        : firstCopy.mode === "today" ? "就是今天！预览已更新。" : "目标日期已过期，预览已更新。";
      return;
    }

    controls.zipBtn.disabled = true;
    state.files = [];
    const work = document.createElement("canvas");
    work.width = CANVAS_WIDTH;
    work.height = CANVAS_HEIGHT;
    const workCtx = work.getContext("2d");

    await CanvasUtils.processBatch(plan, async entry => {
      const copy = countdownCopy(entry.days);
      workCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      drawBackground(workCtx);
      drawCountdown(workCtx, copy);
      const blob = await CanvasUtils.canvasToBlob(work, "image/png");
      const suffix = entry.days > 0 ? entry.days + "days" : entry.days === 0 ? "today" : "ended";
      state.files.push({ name: "countdown-" + suffix + ".png", blob });
    }, {
      chunkSize: 4,
      onProgress: (done, total) => {
        controls.genStatus.textContent = "正在生成第 " + done + " / " + total + " 张";
      }
    });

    work.width = 1;
    work.height = 1;
    controls.zipBtn.disabled = false;
    controls.genStatus.textContent = "已生成 " + state.files.length + " 张系列图，可以打包下载。";
  }

  controls.targetDate.addEventListener("change", () => {
    state.targetDate = controls.targetDate.value;
    if (state.targetDate) generate().catch(() => {});
  });
  controls.eventName.addEventListener("input", () => {
    state.eventName = controls.eventName.value;
    if (state.targetDate) renderPreview(countdownCopy(state.seriesDays > 0 ? daysFromSimulated(state.targetDate, state.seriesDays) : daysFromNow(state.targetDate)));
  });
  controls.expiredHide.addEventListener("change", () => {
    state.hideExpired = controls.expiredHide.checked;
    if (state.targetDate) generate().catch(() => {});
  });
  controls.seriesCount.addEventListener("change", () => {
    let value = parseInt(controls.seriesCount.value, 10);
    if (Number.isNaN(value)) value = 0;
    value = Math.min(14, Math.max(0, value));
    controls.seriesCount.value = value;
    state.seriesDays = value;
    if (state.targetDate) generate().catch(() => {});
  });

  controls.bgInput.addEventListener("change", event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    OnlyBoxUI.openImage(file, () => ++state.loadToken, "", controls.status).then(result => {
      if (state.background) state.background.release();
      state.background = { image: result.image, release: result.release };
      if (state.targetDate) generate().catch(() => {});
    }).catch(() => {});
  });

  controls.clearBgBtn.addEventListener("click", () => {
    if (state.background) state.background.release();
    state.background = null;
    controls.bgInput.value = "";
    if (state.targetDate) generate().catch(() => {});
  });

  controls.generateBtn.addEventListener("click", () => {
    generate().catch(() => {
      controls.genStatus.textContent = "生成失败，可能是手机内存不足，请减小批量范围后重试。";
    });
  });

  controls.zipBtn.addEventListener("click", () => {
    OnlyBoxUI.downloadZip(controls.zipBtn, state.files, "countdown-series.zip", controls.status);
  });

  window.addEventListener("beforeunload", () => {
    if (state.background) state.background.release();
  });

  // 默认目标日期 = 明天，保证首屏即有内容。
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  controls.targetDate.value = tomorrow.getFullYear() + "-" + String(tomorrow.getMonth() + 1).padStart(2, "0") + "-" + String(tomorrow.getDate()).padStart(2, "0");
  state.targetDate = controls.targetDate.value;
  renderPreview(countdownCopy(1));
})();

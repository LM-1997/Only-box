(() => {
  "use strict";

  const CANVAS_WIDTH = 1000;
  const CANVAS_HEIGHT = 1400;
  const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  const THEMES = {
    green: { bg: "#236b4f", number: "#ffffff", name: "#dff0e6", header: "rgba(255,255,255,.82)" },
    dark: { bg: "#17231d", number: "#ffffff", name: "#cfd8d1", header: "rgba(255,255,255,.66)" },
    light: { bg: "#fbfaf5", number: "#236b4f", name: "#657069", header: "rgba(35,107,79,.6)" }
  };
  /* 有主视觉背景图时文字统一用白色系，保证任何画面上可读。 */
  const PHOTO_TONE = { number: "#ffffff", name: "rgba(255,255,255,.88)", header: "rgba(255,255,255,.92)" };

  const state = {
    theme: "green",
    header: "",
    logo: null,           // { image, release }
    background: null,     // { image, release }
    overlayOpacity: 35,
    logoLoadToken: 0,
    bgLoadToken: 0,
    items: [],
    files: [],
    renderTimer: 0
  };

  const $ = id => document.getElementById(id);
  const canvas = $("previewCanvas");
  const ctx = canvas.getContext("2d");
  const controls = {
    signList: $("signList"),
    headerInput: $("headerInput"),
    logoInput: $("logoInput"),
    clearLogoBtn: $("clearLogoBtn"),
    bgInput: $("bgInput"),
    clearBgBtn: $("clearBgBtn"),
    overlayRange: $("overlayRange"),
    overlayValue: $("overlayValue"),
    generateBtn: $("generateBtn"),
    zipBtn: $("zipBtn"),
    genStatus: $("genStatus"),
    status: $("status")
  };

  function fontOf(size, weight) {
    return weight + " " + size + "px " + FONT_STACK;
  }

  function drawSign(targetCtx, item) {
    const tone = state.background ? PHOTO_TONE : THEMES[state.theme];

    /* 背景：主视觉铺满（居中裁切）+ 深色遮罩；否则主题纯色。 */
    if (state.background) {
      CanvasUtils.drawCover(targetCtx, state.background.image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      if (state.overlayOpacity > 0) {
        targetCtx.fillStyle = "rgba(16,25,21," + (state.overlayOpacity / 100) + ")";
        targetCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
    } else {
      targetCtx.fillStyle = THEMES[state.theme].bg;
      targetCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    /* 顶部区：有 Logo 时 Logo 占据顶部（等比不裁切），无 Logo 时用 "BOOTH" 小字。 */
    if (state.logo) {
      const logoBox = 230;
      CanvasUtils.drawContain(targetCtx, state.logo.image, (CANVAS_WIDTH - logoBox) / 2, 52, logoBox, logoBox);
      if (state.header.trim()) {
        targetCtx.font = fontOf(38, "700");
        targetCtx.fillStyle = tone.header;
        targetCtx.textAlign = "center";
        targetCtx.textBaseline = "middle";
        targetCtx.fillText(state.header.trim(), CANVAS_WIDTH / 2, 340);
      }
    } else {
      targetCtx.font = fontOf(26, "600");
      targetCtx.fillStyle = tone.name;
      targetCtx.textAlign = "center";
      targetCtx.textBaseline = "middle";
      targetCtx.fillText("BOOTH", CANVAS_WIDTH / 2, 90);
      if (state.header.trim()) {
        targetCtx.font = fontOf(38, "700");
        targetCtx.fillStyle = tone.header;
        targetCtx.fillText(state.header.trim(), CANVAS_WIDTH / 2, 140);
      }
    }

    /* 摊位号是视觉重心：字号二分自适应，宽度不超过画布 80%；有 Logo 时整体下移。 */
    const centerY = state.logo ? 700 : 620;
    const codeSize = CanvasUtils.fitFontSize(targetCtx, item.code, CANVAS_WIDTH * 0.8, { maxFontSize: 420, minFontSize: 60, fontFamily: FONT_STACK, weight: "800" });
    targetCtx.font = fontOf(codeSize, "800");
    targetCtx.fillStyle = tone.number;
    targetCtx.textAlign = "center";
    targetCtx.textBaseline = "middle";
    targetCtx.fillText(item.code, CANVAS_WIDTH / 2, centerY);

    // 装饰分隔线。
    const lineY = state.logo ? 990 : 940;
    targetCtx.strokeStyle = tone.name;
    targetCtx.lineWidth = 4;
    targetCtx.setLineDash([18, 14]);
    targetCtx.beginPath();
    targetCtx.moveTo(CANVAS_WIDTH * 0.2, lineY);
    targetCtx.lineTo(CANVAS_WIDTH * 0.8, lineY);
    targetCtx.stroke();
    targetCtx.setLineDash([]);

    if (item.name) {
      const nameSize = CanvasUtils.fitFontSize(targetCtx, item.name, CANVAS_WIDTH * 0.84, { maxFontSize: 120, minFontSize: 30, fontFamily: FONT_STACK, weight: "700" });
      targetCtx.font = fontOf(nameSize, "700");
      targetCtx.fillStyle = tone.name;
      targetCtx.fillText(item.name, CANVAS_WIDTH / 2, state.logo ? 1130 : 1100);
    }
  }

  function renderPreview() {
    if (!state.items.length) return;
    drawSign(ctx, state.items[0]);
  }

  async function generate() {
    state.items = CanvasUtils.parseSignLines(controls.signList.value);
    if (!state.items.length) {
      controls.genStatus.textContent = "没有可生成的条目，请检查清单格式：每行一个“摊位号,名称”。";
      controls.zipBtn.disabled = true;
      return;
    }
    renderPreview();
    controls.zipBtn.disabled = true;
    controls.genStatus.textContent = "正在生成 " + state.items.length + " 张号牌……";
    state.files = [];
    const work = document.createElement("canvas");
    work.width = CANVAS_WIDTH;
    work.height = CANVAS_HEIGHT;
    const workCtx = work.getContext("2d");
    const usedNames = new Map();

    await CanvasUtils.processBatch(state.items, async (item, index) => {
      drawSign(workCtx, item);
      const blob = await CanvasUtils.canvasToBlob(work, "image/png");
      const base = CanvasUtils.sanitizeFilename("号牌-" + item.code + (item.name ? "-" + item.name : ""), "booth-" + index);
      state.files.push({ name: CanvasUtils.uniqueFilename(base, usedNames), blob });
    }, {
      chunkSize: 6,
      onProgress: (done, total) => {
        controls.genStatus.textContent = "正在生成第 " + done + " / " + total + " 张";
      }
    });

    work.width = 1;
    work.height = 1;
    controls.zipBtn.disabled = false;
    controls.genStatus.textContent = "已生成 " + state.items.length + " 张号牌，可以打包下载。";
  }

  /* 通用图片载入（Logo / 背景图）：loadToken 防竞态，替换旧图先释放。 */
  async function loadImage(file, kind) {
    const tokenKey = kind === "logo" ? "logoLoadToken" : "bgLoadToken";
    const token = ++state[tokenKey];
    let opened = null;
    controls.status.textContent = kind === "logo" ? "正在读取 Logo……" : "正在读取背景图……";
    try {
      opened = await MobileImageUpload.open(file);
      if (token !== state[tokenKey]) {
        opened.release();
        return;
      }
      if (state[kind]) state[kind].release();
      state[kind] = { image: opened.image, release: opened.release };
      opened = null;
      controls.status.textContent = kind === "logo" ? "Logo 已载入，显示在牌面顶部居中。" : "主视觉背景已载入，文字已切换为白色并叠加遮罩。";
      renderPreview();
    } catch (error) {
      if (opened) opened.release();
      controls.status.textContent = MobileImageUpload.errorMessage(error);
    }
  }

  controls.generateBtn.addEventListener("click", () => {
    clearTimeout(state.renderTimer);
    generate().catch(() => {
      controls.genStatus.textContent = "生成失败，可能是手机内存不足，请减少单批数量后重试。";
    });
  });

  controls.signList.addEventListener("input", () => {
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(() => {
      state.items = CanvasUtils.parseSignLines(controls.signList.value);
      renderPreview();
    }, 150);
  });

  controls.headerInput.addEventListener("input", () => {
    state.header = controls.headerInput.value;
    renderPreview();
  });

  controls.logoInput.addEventListener("change", event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) loadImage(file, "logo");
  });
  controls.clearLogoBtn.addEventListener("click", () => {
    if (state.logo) state.logo.release();
    state.logo = null;
    controls.logoInput.value = "";
    controls.status.textContent = "已清除 Logo。";
    renderPreview();
  });

  controls.bgInput.addEventListener("change", event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) loadImage(file, "background");
  });
  controls.clearBgBtn.addEventListener("click", () => {
    if (state.background) state.background.release();
    state.background = null;
    controls.bgInput.value = "";
    controls.status.textContent = "已恢复主题纯色背景。";
    renderPreview();
  });

  controls.overlayRange.addEventListener("input", () => {
    state.overlayOpacity = Number(controls.overlayRange.value);
    controls.overlayValue.textContent = state.overlayOpacity + "%";
    renderPreview();
  });

  document.querySelectorAll("[data-theme]").forEach(button => {
    button.addEventListener("click", () => {
      state.theme = button.dataset.theme;
      document.querySelectorAll("[data-theme]").forEach(other => {
        const active = other === button;
        other.classList.toggle("active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      renderPreview();
    });
  });

  controls.zipBtn.addEventListener("click", async () => {
    if (!state.files.length) return;
    controls.zipBtn.disabled = true;
    controls.status.textContent = "正在加载打包组件……";
    try {
      await CanvasUtils.exportZip(state.files, "booth-signs.zip");
      controls.status.textContent = "ZIP 已下载。";
    } catch (error) {
      controls.status.textContent = "打包失败，请检查网络后重试。";
    } finally {
      controls.zipBtn.disabled = false;
    }
  });

  window.addEventListener("beforeunload", () => {
    clearTimeout(state.renderTimer);
    if (state.logo) state.logo.release();
    if (state.background) state.background.release();
  });

  generate().catch(() => {});
})();

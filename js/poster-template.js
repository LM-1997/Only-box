(() => {
  "use strict";

  const CANVAS_WIDTH = 1080;
  const CANVAS_HEIGHT = 1440;
  const PADDING = 72;
  const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

  /* 三套模板只是文字块几何参数不同，绘制函数共用一份。 */
  const TEMPLATES = {
    bottom: { blockY: CANVAS_HEIGHT - 420, blockH: 340, align: "left", titleMax: 96, subMax: 44 },
    center: { blockY: CANVAS_HEIGHT / 2 - 240, blockH: 480, align: "center", titleMax: 150, subMax: 48 },
    top: { blockY: 120, blockH: 340, align: "left", titleMax: 96, subMax: 44 }
  };
  const TONES = {
    dark: { overlay: "rgba(0,0,0,0.35)", title: "#ffffff", subtitle: "rgba(255,255,255,.85)" },
    light: { overlay: "rgba(255,255,255,0.55)", title: "#17231d", subtitle: "rgba(23,35,29,.72)" }
  };

  const state = {
    title: "夏日Only展",
    subtitle: "8 月 30 日 · 展馆 B 区",
    template: "bottom",
    tone: "dark",
    background: null,   // { image, release }
    loadToken: 0,
    renderTimer: 0
  };

  const $ = id => document.getElementById(id);
  const canvas = $("posterCanvas");
  const ctx = canvas.getContext("2d");
  const controls = {
    titleInput: $("titleInput"),
    subtitleInput: $("subtitleInput"),
    bgInput: $("bgInput"),
    clearBgBtn: $("clearBgBtn"),
    downloadBtn: $("downloadBtn"),
    status: $("status")
  };

  function fontOf(size, weight) {
    return weight + " " + size + "px " + FONT_STACK;
  }

  function scheduleRender() {
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(render, 150);
  }

  function drawBackground() {
    if (state.background) {
      CanvasUtils.drawCover(ctx, state.background.image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return;
    }
    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, "#236b4f");
    gradient.addColorStop(0.55, "#174c38");
    gradient.addColorStop(1, "#10291f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  function render() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawBackground();

    const template = TEMPLATES[state.template];
    const tone = TONES[state.tone];
    const blockW = template.align === "center" ? CANVAS_WIDTH : CANVAS_WIDTH - PADDING * 2;
    const blockX = template.align === "center" ? 0 : PADDING;

    // 半透明遮罩条：先画条，再画文字。
    ctx.fillStyle = tone.overlay;
    ctx.fillRect(template.align === "center" ? 0 : PADDING - 28, template.blockY - 30, template.align === "center" ? CANVAS_WIDTH : blockW + 56, template.blockH + 60);

    // 主标题：字号自适应；缩到下限仍溢出时允许两行。
    const title = state.title.trim() || "未命名活动";
    const titleSize = CanvasUtils.fitFontSize(ctx, title, blockW, { maxFontSize: template.titleMax, minFontSize: 40, fontFamily: FONT_STACK, weight: "800" });
    ctx.font = fontOf(Math.max(titleSize, 40), "800");
    const titleLines = CanvasUtils.wrapTextWithLimit(ctx, title, blockW, 2);
    const titleLineHeight = Math.max(titleSize, 40) * 1.18;
    const titleBlockH = titleLines.length * titleLineHeight;

    // 副标题：字号自适应，单行。
    const subtitle = state.subtitle.trim();
    let subtitleSize = 0;
    if (subtitle) {
      subtitleSize = CanvasUtils.fitFontSize(ctx, subtitle, blockW, { maxFontSize: template.subMax, minFontSize: 22, fontFamily: FONT_STACK, weight: "600" });
    }

    // 文字块整体在模板区域内垂直居中。
    const textBlockH = titleBlockH + (subtitle ? subtitleSize * 1.4 + 22 : 0);
    let y = template.blockY + (template.blockH - textBlockH) / 2;
    y += titleLineHeight / 2;

    ctx.textAlign = template.align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = tone.title;
    titleLines.forEach((line, index) => {
      ctx.fillText(line, template.align === "center" ? CANVAS_WIDTH / 2 : PADDING, y + index * titleLineHeight);
    });
    y += titleLines.length * titleLineHeight;

    if (subtitle) {
      ctx.font = fontOf(subtitleSize, "600");
      ctx.fillStyle = tone.subtitle;
      ctx.fillText(subtitle, template.align === "center" ? CANVAS_WIDTH / 2 : PADDING, y + subtitleSize * 0.4);
    }
  }

  controls.titleInput.addEventListener("input", () => {
    state.title = controls.titleInput.value;
    scheduleRender();
  });
  controls.subtitleInput.addEventListener("input", () => {
    state.subtitle = controls.subtitleInput.value;
    scheduleRender();
  });

  document.querySelectorAll("[data-template]").forEach(button => {
    button.addEventListener("click", () => {
      state.template = button.dataset.template;
      document.querySelectorAll("[data-template]").forEach(other => {
        const active = other === button;
        other.classList.toggle("active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      render();
    });
  });

  document.querySelectorAll("[data-tone]").forEach(button => {
    button.addEventListener("click", () => {
      state.tone = button.dataset.tone;
      document.querySelectorAll("[data-tone]").forEach(other => {
        const active = other === button;
        other.classList.toggle("active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      render();
    });
  });

  controls.bgInput.addEventListener("change", async event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const token = ++state.loadToken;
    let opened = null;
    controls.status.textContent = "正在读取背景图……";
    try {
      opened = await MobileImageUpload.open(file);
      if (token !== state.loadToken) {
        opened.release();
        return;
      }
      if (state.background) state.background.release();
      state.background = { image: opened.image, release: opened.release };
      opened = null;
      controls.status.textContent = "背景图已载入并居中裁切铺满。";
      render();
    } catch (error) {
      if (opened) opened.release();
      controls.status.textContent = MobileImageUpload.errorMessage(error);
    }
  });

  controls.clearBgBtn.addEventListener("click", () => {
    if (state.background) state.background.release();
    state.background = null;
    controls.bgInput.value = "";
    controls.status.textContent = "已恢复品牌绿渐变背景。";
    render();
  });

  controls.downloadBtn.addEventListener("click", () => {
    canvas.toBlob(blob => {
      if (!blob) {
        controls.status.textContent = "生成失败，请重试。";
        return;
      }
      CanvasUtils.downloadBlob(blob, CanvasUtils.sanitizeFilename(state.title.trim() || "海报") + "-poster.png");
      controls.status.textContent = "高清 PNG 已下载。";
    }, "image/png");
  });

  window.addEventListener("beforeunload", () => {
    clearTimeout(state.renderTimer);
    if (state.background) state.background.release();
  });

  render();
})();

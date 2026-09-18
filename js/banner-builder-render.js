/* ================================================================
   banner-builder-render.js — Canvas 绘制层（Stage 3）
   从 js/banner-builder.js 拆出的导出画质渲染系统：
   15 类板块按「预览模板」还原成 canvas 绘制（主题色系、卡片
   底色/边框/圆角、图文排版），供分屏/全部/连续长图导出共用。

   分层归属（零构建 IIFE，单一全局命名空间）：
   - 跨层依赖 C/R/M/U/F 从 global.BannerBuilder* 读取；
   - 主脚本私有辅助（state、text、imageSrc、docBackgroundOf 等）
     通过 setContext 注入，保持单一状态源；
   - 对外仅暴露 BannerBuilderRender 与导出侧需要的画布绘制原语。
   ================================================================ */
(function (global) {
  "use strict";

  var C = global.BannerBuilderConstants;
  var R = global.BannerBuilderRegistry;
  var M = global.BannerBuilderModel;
  var U = global.BannerBuilderUtils;
  var F = global.BannerBuilderFont;

  var state = null;
  var ctx = {};

  function setState(s) { state = s; }
  function setContext(c) { ctx = c || {}; }

  function BG() { return global.BannerBuilderBackgrounds; }

  /* ===== 跨层依赖转发（保持本层内调用点与原文一致） ===== */
  function pageSize() { return C.pageSize(state.doc.ratio); }
  function docFontFamily() { return F.docFontFamily(); }
  function collectPageText(page) { return F.collectPageText(page); }
  function readyFontForText(key, text) { return F.readyFontForText(key, text); }
  function readyFontsForPage(page) { return F.readyFontsForPage(page); }
  function hexToRgba(value, alpha) { return U.hexToRgba(value, alpha); }
  // alphaColor / capText 已在下方提取的源码块中定义（均为 U 桥接）
  function wrapLines(c, value, maxWidth) { return U.wrapLines(c, value, maxWidth); }
  function text(value, fallback) { return ctx.text(value, fallback); }
  function moduleTitle(module, def) { return ctx.moduleTitle(module, def); }
  function imageSrc(value) { return ctx.imageSrc(value); }
  function dataImageFit(data) { return ctx.dataImageFit(data); }
  function imageSizeOf(data, key, min, max, step) { return ctx.imageSizeOf(data, key, min, max, step); }
  function effectiveBackgroundColor(page) { return ctx.effectiveBackgroundColor(page); }
  function backgroundPatternActive(page) { return ctx.backgroundPatternActive(page); }
  function docBackgroundOf(target) { return ctx.docBackgroundOf(target); }

  function loadImage(value) { return new Promise(function (resolve) { if (!imageSrc(value)) return resolve(null); const image = new Image(); image.onload = function () { resolve(image); }; image.onerror = function () { resolve(null); }; image.src = imageSrc(value); }); }

  /* ================================================================
     导出画质：15 类板块按「预览模板」还原成 canvas 绘制（主题色系、
     卡片底色/边框/圆角、图文排版），供分屏 / 全部 / 连续长图导出共用。
     ================================================================ */

  /* 主题色：与 DOM 预览同源（C.THEMES[theme]），保证导出观感随主题变化。
     themeOverrides（设置步骤「微调主题」）在此叠加：用户手动覆盖的字段优先，未覆盖回退预设。 */
  function artTheme() {
    const base = C.themeStyleForDoc ? C.themeStyleForDoc(state.doc) : C.themeStyle(state.doc.theme);
    const ov = state.doc.themeOverrides || {};
    const merged = Object.assign({}, base);
    Object.keys(ov).forEach(function (k) {
      const v = ov[k];
      if (v !== null && v !== undefined && v !== "") merged[k] = v;
    });
    return merged;
  }

  /* ===== 主题风格绘制辅助（卡片骨架/形状/底纹），DOM 与 Canvas 双侧共用同名概念 ===== */
  let pageBgColorForHoles = "#ffffff";
  let noiseCanvas = null;
  function noisePattern(ctx) {
    if (!noiseCanvas) {
      noiseCanvas = document.createElement("canvas"); noiseCanvas.width = 64; noiseCanvas.height = 64;
      const nc = noiseCanvas.getContext("2d");
      const img = nc.createImageData(64, 64);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 110 + Math.floor(Math.random() * 130);
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      nc.putImageData(img, 0, 0);
    }
    return ctx.createPattern(noiseCanvas, "repeat");
  }
  function cardRadius(data, st) {
    const user = Number(data.radius);
    const base = (user === 13 || !Number.isFinite(user)) ? (st.radius != null ? st.radius : 27) : user;
    return Math.max(0, Math.round(base));
  }
  function cardRadiusDom(data, st) {
    return cardRadius(data, st);
  }
  function styleCardPad(base, st) {
    if (st.cardStyle === "ticket") return base + 20;
    if (st.cardStyle === "panel") return base + 2;
    return base;
  }
  function cardBaseFill(st, data, opacity) {
    if (data.blockBgColor) return hexToRgba(data.blockBgColor, opacity) || data.blockBgColor;
    switch (st.cardStyle) {
      case "glass": return alphaColor("#ffffff", Math.min(0.62, opacity * 0.66));
      case "ink": return alphaColor(st.soft, 0.97);
      case "panel": return alphaColor("#ffffff", 0.94);
      case "ticket": return alphaColor("#ffffff", 0.97);
      case "sticker": return alphaColor("#ffffff", 0.96);
      default: return cardFillStyle(data, "#ffffff");
    }
  }
  function drawCardBase(ctx, x, y, w, h, r, st, data, opacity) {
    ctx.save();
    if (st.shadow === "hard") {
      ctx.fillStyle = alphaColor(st.primaryDark, 0.85);
      roundRectPath(ctx, x + 6, y + 7, w, h, r); ctx.fill();
    } else if (st.shadow === "glow") {
      ctx.shadowColor = alphaColor(st.primary, 0.5); ctx.shadowBlur = 22; ctx.shadowOffsetY = 4;
    } else if (st.shadow === "soft") {
      ctx.shadowColor = "rgba(38,65,51,.15)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 12;
    }
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = cardBaseFill(st, data, opacity);
    ctx.fill();
    ctx.restore();
  }
  function drawCardBorder(ctx, x, y, w, h, r, st, data) {
    ctx.save();
    const userColor = data.blockBorderColor || "";
    if (st.cardStyle === "panel") {
      ctx.strokeStyle = userColor || st.primaryDark; ctx.lineWidth = 2.5;
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
    } else if (st.cardStyle === "glass") {
      ctx.strokeStyle = userColor || alphaColor("#ffffff", 0.7); ctx.lineWidth = 1.5;
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
      ctx.strokeStyle = alphaColor(st.primary, 0.35); ctx.lineWidth = 1;
      roundRectPath(ctx, x + 2, y + 2, w - 4, h - 4, Math.max(1, r - 2)); ctx.stroke();
    } else if (st.cardStyle === "ink") {
      ctx.strokeStyle = userColor || alphaColor(st.primaryDark, 0.75); ctx.lineWidth = 2;
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
      ctx.strokeStyle = alphaColor(st.primary, 0.5); ctx.lineWidth = 1;
      roundRectPath(ctx, x + 8, y + 8, w - 16, h - 16, Math.max(1, r - 7)); ctx.stroke();
    } else if (st.cardStyle === "ticket") {
      ctx.strokeStyle = userColor || alphaColor(st.primary, 0.45); ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 7]);
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
      ctx.setLineDash([]);
    } else if (st.cardStyle === "sticker") {
      ctx.strokeStyle = userColor || alphaColor(st.primary, 0.9); ctx.lineWidth = 7;
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
      roundRectPath(ctx, x + 5, y + 5, w - 10, h - 10, Math.max(1, r - 4)); ctx.stroke();
    } else {
      ctx.strokeStyle = userColor || alphaColor(st.primary, 0.16); ctx.lineWidth = 2;
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
    }
    ctx.restore();
  }
  function drawCardDecor(ctx, x, y, w, h, r, st) {
    ctx.save();
    if (st.cardStyle === "panel") {
      roundRectPath(ctx, x, y, w, h, r); ctx.clip();
      ctx.fillStyle = st.accent; ctx.fillRect(x, y, 26, 26);
      ctx.restore(); ctx.save();
    }
    if (st.cardStyle === "ticket") {
      const r0 = 13;
      const holes = [{ cx: x, cy: y + h / 2 }, { cx: x + w, cy: y + h / 2 }];
      holes.forEach(function (pos) {
        ctx.beginPath(); ctx.arc(pos.cx, pos.cy, r0, 0, Math.PI * 2);
        ctx.fillStyle = pageBgColorForHoles || "#ffffff"; ctx.fill();
        ctx.strokeStyle = alphaColor(st.primary, 0.4); ctx.lineWidth = 1.5; ctx.stroke();
      });
    }
    ctx.restore();
  }
  function drawPatternOverlay(ctx, w, h, st) {
    ctx.save();
    if (st.pattern === "grid") {
      ctx.globalAlpha = 0.05; ctx.strokeStyle = st.primaryDark; ctx.lineWidth = 1;
      for (let gx = 0; gx <= w; gx += 48) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (let gy = 0; gy <= h; gy += 48) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
    } else if (st.pattern === "dots") {
      ctx.globalAlpha = 0.06; ctx.fillStyle = st.primary;
      for (let gy = 18; gy < h; gy += 36) for (let gx = 18; gx < w; gx += 36) { ctx.beginPath(); ctx.arc(gx, gy, 2, 0, Math.PI * 2); ctx.fill(); }
    } else if (st.pattern === "stripes") {
      ctx.globalAlpha = 0.04; ctx.strokeStyle = st.primary; ctx.lineWidth = 5;
      for (let gx = -h; gx < w; gx += 56) { ctx.beginPath(); ctx.moveTo(gx, h); ctx.lineTo(gx + h, 0); ctx.stroke(); }
    } else if (st.pattern === "noise") {
      const nz = noisePattern(ctx);
      if (nz) { ctx.globalAlpha = 0.04; ctx.fillStyle = nz; ctx.fillRect(0, 0, w, h); }
    } else if (st.pattern === "paper") {
      ctx.globalAlpha = 0.035; ctx.strokeStyle = st.primaryDark; ctx.lineWidth = 1;
      for (let gx = -h; gx < w; gx += 90) { ctx.beginPath(); ctx.moveTo(gx, h); ctx.lineTo(gx + h, 0); ctx.stroke(); }
    }
    ctx.restore();
  }
  function chipPath(ctx, x, y, bw, bh, size, shape) {
    if (shape === "tag") {
      const sl = Math.round(bh * 0.35);
      ctx.beginPath();
      ctx.moveTo(x + sl, y);
      ctx.lineTo(x + bw, y);
      ctx.lineTo(x + bw - sl, y + bh);
      ctx.lineTo(x, y + bh);
      ctx.closePath();
    } else {
      roundRectPath(ctx, x, y, bw, bh, shape === "squared" ? Math.round(size * 0.18) : Math.round(bh / 2));
    }
  }
  /* 750 设计宽度空间：导出坐标与预览 CSS px 同一单位（px2 保留为兼容别名）。 */
  function px2(v) {
    return Math.max(1, Math.round((Number(v) || 0) * 2.08));
  }
  /* canvas 只认 100 一档的 numeric font-weight，floor 到最接近允许档位（含 700，避免跳档）。 */
  function artWeight(v) {
    const bins = [400, 500, 600, 700, 800, 900];
    if (v >= 900) return 900;
    let best = 400;
    for (let i = 0; i < bins.length; i += 1) {
      if (bins[i] <= v) best = bins[i];
      else break;
    }
    return best;
  }
  /* 字重整体偏置：标题类以 800、正文类以 400 为基准平移，保留局部字重差异（700 vs 800），
     同时允许主题通过 headingWeight / bodyWeight 整体加粗或减细。 */
  function artAdjustedWeight(weight, scope) {
    const base = artWeight(weight || 400);
    const st = artTheme();
    const nominal = scope === "body" ? 400 : 800;
    const target = scope === "body"
      ? (Number(st.bodyWeight) != null ? Number(st.bodyWeight) : 400)
      : (Number(st.headingWeight) != null ? Number(st.headingWeight) : 800);
    const delta = artWeight(target || nominal) - nominal;
    return artWeight(base + delta);
  }
  /* 逐层字号归类：按当前字面量字号归到 5 档，供「逐层缩放」自动命中（无需改各调用点）。 */
  const TYPE_LEVEL_BANDS = [
    { key: "h1", min: 60 }, { key: "h2", min: 44 }, { key: "h3", min: 32 },
    { key: "body", min: 26 }, { key: "caption", min: 0 },
  ];
  function typeLevelKeyFor(size) {
    for (let i = 0; i < TYPE_LEVEL_BANDS.length; i += 1) { if (size >= TYPE_LEVEL_BANDS[i].min) return TYPE_LEVEL_BANDS[i].key; }
    return "caption";
  }
  /* 全局字号缩放 × 逐层缩放：所有文字字号（PNG 与 PSD）统一经这里，保证画布观感与导出一致。 */
  function artTypeScale() {
    const v = Number(artTheme().typeScale);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }
  function artSize(size) {
    const s = Number(size) || 0;
    if (s <= 0) return s;
    const st = artTheme();
    const perLevel = Number(st[typeLevelKeyFor(s) + "Scale"] != null ? st[typeLevelKeyFor(s) + "Scale"] : 1) || 1;
    const global = artTypeScale();
    return Math.max(1, Math.round(s * global * (perLevel || 1)));
  }
  /* 全局行距缩放（主题 lineHeight），与各调用点自带行距倍数相乘。 */
  function artLineHeight() {
    const v = Number(artTheme().lineHeight);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }
  /* 基础字体设置（字重调整 + 字距），不复算字号——供已知缩放后字号的布局点（如 chips）使用。 */
  function artFontRaw(ctx, finalSize, weight, scope) {
    const key = scope === "body"
      ? (state.doc.bodyFont || state.doc.headingFont || state.doc.fontFamily || "sans")
      : (state.doc.headingFont || state.doc.fontFamily || "sans");
    /* 方案 §2.2：吸附到字体实际档位（修 F1/F2 渲染侧）——预览与导出同函数 */
    const snapped = C.snapWeight(C.FONTS[key] || C.FONTS.sans, artAdjustedWeight(weight, scope));
    ctx.font = snapped + " " + finalSize + "px " + C.fontStack(key);
    try {
      const ls = Number(artTheme().letterSpacing) || 0;
      ctx.letterSpacing = ls + "px";
    } catch (error) { /* 不支持则忽略 */ }
  }
  function artFont(ctx, size, weight, scope) {
    artFontRaw(ctx, artSize(size), weight, scope);
  }
  function artInk() {
    const v = artTheme().ink;
    return (v && /^#[0-9a-f]{6}$/i.test(v)) ? v : "#20251f";
  }
  function artMuted() {
    const v = artTheme().muted;
    return (v && /^#[0-9a-f]{6}$/i.test(v)) ? v : "#6a706c";
  }
  function alphaColor(value, alpha) {
    return U.alphaColor(value, alpha);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }
  function coverDraw(ctx, image, x, y, w, h) {
    if (!image || !w || !h) return;
    const ir = image.width / image.height;
    const tr = w / h;
    let sw = image.width, sh = image.height, sx = 0, sy = 0;
    if (ir > tr) { sw = image.height * tr; sx = (image.width - sw) / 2; }
    else { sh = image.width / tr; sy = (image.height - sh) / 2; }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }
  function containDraw(ctx, image, x, y, w, h) {
    if (!image || !w || !h) return;
    const ir = image.width / image.height;
    const tr = w / h;
    let dw = w, dh = h, dx = 0, dy = 0;
    if (ir > tr) { dw = w; dh = w / ir; dy = (h - dh) / 2; }
    else { dh = h; dw = h * ir; dx = (w - dw) / 2; }
    ctx.drawImage(image, dx, dy, dw, dh);
  }
  /* 取图片应显示比例：模块级 imageRatio 优先，其次原图自然比例，缺省 1:1。 */
  function artImageRatio(data, image) {
    const raw = (data && data.imageRatio) || "auto";
    if (raw && raw !== "auto") {
      const m = String(raw).replace(/\s+/g, "").match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/);
      if (m && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]);
    }
    if (image && image.width && image.height) return image.width / image.height;
    return 1;
  }
  function artImageHeight(data, image, w) {
    return Math.round(w / artImageRatio(data, image));
  }
  /* 当前模块的卡片底色：没有自定义底色时 = 半透明白（与 DOM 默认一致）。 */
  function cardFillStyle(data, ink) {
    const opacity = Number.isFinite(Number(data.blockOpacity)) ? Number(data.blockOpacity) / 100 : 0.94;
    if (data.blockBgColor) { const raw = hexToRgba(data.blockBgColor, opacity); return raw || data.blockBgColor; }
    return alphaColor(ink || "#ffffff", opacity);
  }

  /* 文本排版：支持 左/中/右；返回用尽后(含行距)的 y。
     与旧 drawText 同构但显式携带字号/字重/行距倍数。 */
  function drawRich(ctx, value, x, y, maxWidth, size, weight, color, align, lineMul, scope) {
    ctx.save();
    artFont(ctx, size, weight, scope);
    ctx.fillStyle = color || artInk();
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    const finalSize = artSize(size);
    const step = Math.round(finalSize * (lineMul || 1.45) * artLineHeight());
    const lines = wrapLines(ctx, String(value || ""), Math.max(10, maxWidth));
    lines.forEach(function (line, index) { ctx.fillText(line, x, y + index * step); });
    ctx.restore();
    return y + Math.max(1, lines.length) * step;
  }
  /* 只测高度的排版辅助：行数 × 步进，供「先铺底、后写字」的内衬面板计算高度。 */
  function textBlockInfo(ctx, value, maxWidth, size, weight, lineMul, scope) {
    ctx.save();
    artFont(ctx, size, weight || 400, scope);
    const finalSize = artSize(size);
    const step = Math.round(finalSize * (lineMul || 1.45) * artLineHeight());
    const count = wrapLines(ctx, String(value || ""), Math.max(10, maxWidth)).length;
    ctx.restore();
    return { count: count, step: step, height: Math.max(1, count) * step };
  }
  /* 从 bottom 界向上排版一个文本块（供封面沉浸底部锚定），返回块顶(可作为上方块的新 bottom)。 */
  function paintUpText(ctx, value, x, bottom, maxWidth, size, weight, color, align, lineMul, scope) {
    const info = textBlockInfo(ctx, value, maxWidth, size, weight, lineMul, scope);
    const step = info.step;
    const count = info.count;
    const finalSize = artSize(size);
    const yStart = bottom - (count - 1) * step - Math.round(finalSize * 0.3);
    ctx.save();
    artFont(ctx, size, weight, scope);
    ctx.fillStyle = color || artInk();
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    const lines = wrapLines(ctx, String(value || ""), Math.max(10, maxWidth));
    lines.forEach(function (line, index) { ctx.fillText(line, x, yStart + index * step); });
    ctx.restore();
    return yStart - Math.round(finalSize * 0.78);
  }
  /* 圆角胶囊 chips：自动换行；返回下一行起始 y。布局尺寸随主题字号缩放同步放大，避免字体变大框不变。 */
  function drawChips(ctx, items, x, y, maxWidth, opt) {
    if (!items || !items.length) return y;
    const o = opt || {};
    const shape = o.shape || artTheme().chips || "pill";
    const size = artSize(o.size || 23);
    const gap = Math.round(size * 0.6);
    const padX = Math.round(size * 0.95);
    const lh = Math.round(size * 1.85);
    ctx.save();
    artFontRaw(ctx, size, o.weight || 500, o.scope);
    ctx.textAlign = "left";
    const measure = function (label) { return { label: label, bw: ctx.measureText(label).width + padX * 2 }; };
    const rowsLayout = [];
    let row = []; let rowW = 0;
    (items || []).forEach(function (item) {
      const label = String(item || "");
      if (!label) return;
      const chip = measure(label);
      if (row.length && rowW + chip.bw + gap > maxWidth) { rowsLayout.push({ row: row, width: rowW }); row = []; rowW = 0; }
      row.push(chip); rowW += chip.bw + (row.length > 1 ? gap : 0);
    });
    if (row.length) rowsLayout.push({ row: row, width: rowW });
    const padTop = Math.round(size * 0.72);
    let cy = y;
    if (o.center) {
      rowsLayout.forEach(function (line) {
        let sx = x - line.width / 2;
        line.row.forEach(function (chip) {
          if (o.fill) { ctx.fillStyle = o.fill; chipPath(ctx, sx, cy - padTop, chip.bw, Math.round(size * 1.5), size, shape); ctx.fill(); }
          if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = o.lw || 2; chipPath(ctx, sx, cy - padTop, chip.bw, Math.round(size * 1.5), size, shape); ctx.stroke(); }
          ctx.fillStyle = o.color || artInk();
          ctx.fillText(chip.label, sx + padX, cy + Math.round(size * 0.32));
          sx += chip.bw + gap;
        });
        cy += lh;
      });
    } else {
      let cx = x;
      rowsLayout.forEach(function (line) {
        line.row.forEach(function (chip) {
          if (o.fill) { ctx.fillStyle = o.fill; chipPath(ctx, cx, cy - padTop, chip.bw, Math.round(size * 1.5), size, shape); ctx.fill(); }
          if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = o.lw || 2; chipPath(ctx, cx, cy - padTop, chip.bw, Math.round(size * 1.5), size, shape); ctx.stroke(); }
          ctx.fillStyle = o.color || artInk();
          ctx.fillText(chip.label, cx + padX, cy + Math.round(size * 0.32));
          cx += chip.bw + gap;
        });
        cy += lh;
        cx = x;
      });
    }
    ctx.restore();
    return cy;
  }
  /* 只量 chips 高度（行数 × 行高），供「先铺底、后排版」的布局预估。 */
  function chipRowCount(ctx, items, maxWidth, size, scope) {
    const finalSize = artSize(size);
    const gap = Math.round(finalSize * 0.6);
    const padX = Math.round(finalSize * 0.95);
    ctx.save();
    artFontRaw(ctx, finalSize, 500, scope);
    let rows = 1; let rowW = 0;
    (items || []).forEach(function (item) {
      const label = String(item || "");
      if (!label) return;
      const bw = ctx.measureText(label).width + padX * 2;
      if (rowW > 0 && rowW + bw + gap > maxWidth) { rows += 1; rowW = bw; }
      else rowW += bw + (rowW > 0 ? gap : 0);
    });
    ctx.restore();
    if (!items || !items.filter(function (i) { return String(i || ""); }).length) return 0;
    return rows * Math.round(finalSize * 1.85);
  }
  function drawDividerShape(ctx, data, x, y, w, color) {
    const themeDiv = artTheme().divider || "wave";
    const raw = (data.template === "wave" && themeDiv !== "wave") ? themeDiv : (data.template || themeDiv);
    const style = ["dots", "line", "glitch", "thread", "dashed"].indexOf(raw) >= 0 ? raw : "wave";
    ctx.save();
    const cy = y + Math.round(19);
    if (style === "glitch") {
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, cy - 4); ctx.lineTo(x + Math.round(w * 0.72), cy - 4); ctx.stroke();
      ctx.strokeStyle = alphaColor(artTheme().accent, 0.9); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + Math.round(w * 0.28), cy + 4); ctx.lineTo(x + w, cy + 4); ctx.stroke();
      ctx.fillStyle = color; ctx.fillRect(x + Math.round(w * 0.4), cy - 2, 10, 10);
    } else if (style === "thread") {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([10, 7]);
      ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillRect(x + Math.round(w * 0.5) - 5, cy - 5, 10, 10);
    } else if (style === "dashed") {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([11, 9]);
      ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke();
      ctx.setLineDash([]);
    } else if (style === "line") {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke();
    } else if (style === "dots") {
      ctx.fillStyle = color; const d = 6; const gap = Math.round(16);
      const count = Math.max(1, Math.floor((w - d) / (d + gap)));
      const start = x + (w - (count * d + (count - 1) * gap)) / 2;
      for (let i = 0; i < count; i += 1) { ctx.beginPath(); ctx.arc(start + i * (d + gap) + d / 2, cy, d / 2, 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath();
      const seg = Math.max(1, Math.floor(w / 40));
      const amp = 8;
      for (let i = 0; i <= seg; i += 1) {
        const px = x + (w * i) / seg;
        const py = cy + (i % 2 === 0 ? -amp : amp);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawLine(ctx, x1, y1, x2, y2, color, width) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }
  function drawGradientOverlay(ctx, x, y, w, h, color, from, to) {
    ctx.save();
    const gradient = ctx.createLinearGradient(0, y, 0, y + h);
    gradient.addColorStop(0, alphaColor(color, from || 0));
    gradient.addColorStop(1, alphaColor(color, to == null ? 0.84 : to));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  function capText(value, limit) {
    return U.capText(value, limit);
  }

  /* ===== 各模块类型的内容绘制器：ctx 为模块临时画布，x0/y0 为内容区原点（已含卡片内边距），
        宽 w 为内容宽；返回内容底部的 y（供卡片定高）。所有绘制在坐标 y0 起、逐块向下排版。 ===== */
  async function paintCover(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const img = await loadImage(data.mainImage);
    const tpl = data.template || "immersive";
    const title = text(data.title, "活动主标题");
    const subtitle = data.subtitle;
    const infoLines = (data.infoLines || []).slice(0, 6).filter(Boolean);
    const qqText = data.qqGroupNumber ? "QQ 群：" + data.qqGroupNumber : "";
    const chipPlain = { size: 23, color: ink, border: alphaColor(P.primary, 0.35), fill: "#ffffff", lw: 2 };
    const chipCenter = { size: 23, color: P.primaryDark, border: alphaColor(P.primary, 0.4), fill: "#ffffff", lw: 2, center: true };
    const drawInfoCopy = function (yy, centered) {
      let c = yy;
      c = drawRich(ctx, title, centered ? x0 + w / 2 : x0, c, w, 65, 900, P.primaryDark, centered ? "center" : "left", 1.2) + 19;
      if (subtitle) c = drawRich(ctx, subtitle, centered ? x0 + w / 2 : x0, c, w, 29, 500, artMuted(), centered ? "center" : "left", null, "body") + 17;
      c = drawChips(ctx, infoLines, centered ? x0 + w / 2 : x0, c + 4, w, Object.assign({}, centered ? chipCenter : chipPlain, { scope: "body" }));
      if (qqText) c = drawRich(ctx, qqText, centered ? x0 + w / 2 : x0, c + 13, w, 23, 500, artMuted(), centered ? "center" : "left", null, "body") + 10;
      return c;
    };
    if (tpl === "info") {
      let y = y0;
      if (img) { const h = imageSizeOf(data, "imageSize", 0, 1000, 4) || Math.min(Math.round(w * 0.6), 1000); ctx.save(); roundRectPath(ctx, x0, y, w, h, 21); ctx.clip(); coverDraw(ctx, img, x0, y, w, h); ctx.restore(); y += h + 71; }
      return drawInfoCopy(y, false);
    }
    if (tpl === "minimal") {
      return drawInfoCopy(y0, true);
    }
    if (tpl === "split") {
      let y = y0;
      if (img) { const h = imageSizeOf(data, "imageSize", 0, 1000, 4) || Math.min(Math.round(w * 0.64), 1000); ctx.save(); roundRectPath(ctx, x0, y, w, h, 21); ctx.clip(); coverDraw(ctx, img, x0, y, w, h); ctx.restore(); y += h + 75; }
      else { ctx.save(); roundRectPath(ctx, x0, y, w, 354, 21); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore(); y += 400; }
      return drawInfoCopy(y, false);
    }
    /* immersive 沉浸封面：主图整幅 + 底部渐变信息带（从下往上锚定）。 */
    const heroH = img ? Math.round(w * 0.85) : Math.round(w * 0.6);
    if (img) { ctx.save(); roundRectPath(ctx, x0, y0, w, heroH, 26); ctx.clip(); coverDraw(ctx, img, x0, y0, w, heroH); ctx.restore(); }
    else { ctx.save(); roundRectPath(ctx, x0, y0, w, heroH, 26); ctx.fillStyle = P.primaryDark; ctx.fill(); ctx.restore(); }
    drawGradientOverlay(ctx, x0, y0 + Math.round(heroH * 0.42), w, heroH - Math.round(heroH * 0.42), P.primaryDark, 0.05, 0.88);
    const cx = x0 + w / 2;
    const cw = w - 40;
    let bottom = y0 + heroH - 26;
    const infoShown = infoLines.slice(0, 3);
    for (let i = infoShown.length - 1; i >= 0; i -= 1) {
      if (!infoShown[i]) continue;
      bottom = paintUpText(ctx, infoShown[i], cx, bottom - 4, cw, 23, 500, "rgba(255,255,255,.85)", "center", 1.55, "body");
      bottom -= 10;
    }
    if (subtitle) { bottom = paintUpText(ctx, subtitle, cx, bottom - 8, cw, 29, 600, "rgba(255,255,255,.96)", "center", 1.45, "body"); bottom -= 25; }
    paintUpText(ctx, title, cx, bottom - 6, cw, 65, 900, "#ffffff", "center", 1.22);
    let y = y0 + heroH;
    if (qqText) y = drawRich(ctx, qqText, cx, y + 33, w, 23, 500, artMuted(), "center", null, "body") + 13;
    return y;
  }

  async function paintAnnouncement(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const tpl = data.template || "notice";
    const bodyValue = data.body || "在这里填写活动公告、入场须知或情报说明。";
    const heading = data.heading || "";
    const align = data.bodyAlign === "right" ? "right" : data.bodyAlign === "center" ? "center" : "left";
    const bodySize = 29; const bodyMul = 1.7; const headSize = 29;
    const anchor = function (leftX, width) {
      return { x: align === "center" ? leftX + width / 2 : align === "right" ? leftX + width : leftX };
    };
    if (tpl === "plain") {
      let y = y0;
      const a = anchor(x0, w);
      if (heading) y = drawRich(ctx, heading, a.x, y, w, headSize, 800, P.primaryDark, align, 1.35) + 10;
      y = drawRich(ctx, bodyValue, a.x, y, w, bodySize, 400, ink, align, bodyMul, "body");
      return y;
    }
    const padX = 30;
    const innerLeft = x0 + padX;
    const innerW = Math.max(60, w - padX * 2);
    const a = anchor(innerLeft, innerW);
    const headInfo = heading ? textBlockInfo(ctx, heading, innerW, headSize, 800, 1.35) : { height: 0 };
    const bodyInfo = textBlockInfo(ctx, bodyValue, innerW, bodySize, 400, bodyMul, "body");
    if (tpl === "boxed") {
      const padY = 20;
      const paneH = padY * 2 + headInfo.height + (heading ? 12 : 0) + bodyInfo.height;
      let y = y0 + padY + Math.round(headSize * 0.2);
      if (heading) y = drawRich(ctx, heading, a.x, y, innerW, headSize, 800, P.primaryDark, align, 1.35) + 13;
      drawRich(ctx, bodyValue, a.x, y, innerW, bodySize, 400, ink, align, bodyMul, "body");
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 24); ctx.strokeStyle = alphaColor(P.primary, 0.42); ctx.lineWidth = 3; ctx.setLineDash([2, 16]); ctx.stroke(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 24); ctx.strokeStyle = alphaColor(P.accent, 0.9); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      return y0 + paneH;
    }
    /* notice / quote：内衬面板 */
    let innerH = bodyInfo.height;
    if (heading) innerH += headInfo.height + 7;
    if (tpl === "quote") innerH = Math.max(innerH, 100);
    const padTop = 30; const padBottom = 30;
    const paneH = padTop + innerH + padBottom;
    let bodyLeft = innerLeft;
    let bodyTopPad = 0;
    if (tpl === "quote") {
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 24); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore();
      ctx.save(); artFont(ctx, 71, 900); ctx.fillStyle = P.accent; ctx.textAlign = "left"; ctx.fillText("“", x0 + 18, y0 + padTop + 78); ctx.restore();
      bodyLeft = x0 + 66;
      bodyTopPad = 4;
    } else {
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 24); ctx.fillStyle = alphaColor(P.primary, 0.07); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0, y0 + 6, 9, paneH - 12, 4); ctx.fillStyle = P.accent; ctx.fill(); ctx.restore();
      bodyLeft = innerLeft + 10;
      bodyTopPad = 0;
    }
    const bodyW = Math.max(60, w - (bodyLeft - x0) - padX);
    const ba = anchor(bodyLeft, bodyW);
    let y = y0 + padTop + Math.round(headSize * 0.2);
    if (heading && tpl !== "quote") {
      const headLeft = x0 + padX;
      const ha = anchor(headLeft, bodyW);
      y = drawRich(ctx, heading, ha.x, y, bodyW, headSize, 800, P.primaryDark, align, 1.35) + 13;
    }
    y = y0 + padTop + Math.round(bodySize * 0.2) + (heading && tpl !== "quote" ? headInfo.height + 13 : 0) + bodyTopPad;
    if (tpl === "quote") {
      drawRich(ctx, bodyValue, ba.x, y, bodyW, bodySize, 700, "#20251f", align, bodyMul, "body");
      if (heading) drawRich(ctx, heading, x0 + w - padX, y0 + paneH - padBottom + 12, innerW, 23, 600, P.primaryDark, "right", 1.4);
    } else {
      drawRich(ctx, bodyValue, ba.x, y, bodyW, bodySize, 400, ink, align, bodyMul, "body");
    }
    return y0 + paneH;
  }

  function paintQrGridPx(ctx, list, imgs, x0, y, gridW, cols, qrSize, P, ink) {
    /* 多平台二维码网格画板绘制（与 paintMaterials icon-grid 同构）。
       二维码必须 contain 不裁切（裁变形会损坏扫码）；列超宽时自适应缩小单元格。 */
    const gap = 20;
    const cw = (gridW - gap * (cols - 1)) / cols;
    const box = Math.max(48, Math.min(qrSize, cw - 16 > 0 ? cw - 16 : cw));
    const cellH = box + 50;
    const count = list.length;
    for (let i = 0; i < count; i += 1) {
      const item = list[i] || {};
      const cx = x0 + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (cellH + gap);
      ctx.save(); roundRectPath(ctx, cx, cy, cw, cellH, 18); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, cx, cy, cw, cellH, 18); ctx.strokeStyle = alphaColor(P.primary, 0.14); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      const img = imgs[i];
      if (img) {
        const qx = cx + (cw - box) / 2, qy = cy + 12;
        ctx.save(); roundRectPath(ctx, qx, qy, box, box, 12); ctx.clip(); containDraw(ctx, img, qx, qy, box, box); ctx.restore();
      }
      if (item.label) drawRich(ctx, text(item.label, "平台"), cx + cw / 2, cy + cellH - 16, Math.max(cw - 12, 30), 21, 600, ink, "center", 1);
    }
    return y + Math.ceil(count / cols) * (cellH + gap) - gap;
  }

  async function paintTicket(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk(); let y = y0;
    const tiers = (data.tiers || []).filter(function (t) { return t && (t.label || t.price); });
    const tpl = data.template || "qr-side";
    const qrSize = imageSizeOf(data, "qrSize", 120, 320, 4) || Math.round(w * 0.32);
    /* 多平台二维码（物料同款网格）：向后兼容旧草稿单一 qrImage → 首条 */
    const qrList = (Array.isArray(data.qrItems) && data.qrItems.length)
      ? data.qrItems
      : (data.qrImage && data.qrImage.url ? [{ icon: data.qrImage, label: "" }] : []);
    const qrImgs = qrList.length ? await Promise.all(qrList.map(function (it) { return it && it.icon && it.icon.url ? loadImage(it.icon) : Promise.resolve(null); })) : [];
    const qrCols = Math.max(1, Math.min(4, Number(data.qrColumns) || 2));
    function qrGridAt(x, gridW) {
      if (!qrList.length) return y;
      const by = paintQrGridPx(ctx, qrList, qrImgs, x, y + 16, gridW, qrCols, qrSize, P, ink);
      return by + 4;
    }
    if (tpl === "ticket-focus" || tpl === "ticket-hero") {
      const first = tiers[0];
      const bandH = Math.round(w * 0.42);
      ctx.save(); roundRectPath(ctx, x0, y, w, bandH, 30); const g = ctx.createLinearGradient(x0, y, x0 + w, y + bandH); g.addColorStop(0, P.primary); g.addColorStop(1, P.primaryDark); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      if (first) {
        ctx.fillStyle = "#ffffff"; ctx.textAlign = "left";
        y = drawRich(ctx, text(first.price, "价格"), x0 + 18, y + Math.round(bandH * 0.34), w * 0.72, 71, 900, "#ffffff", "left", 1) + 6;
        if (first.label) y = drawRich(ctx, first.label, x0 + 18, y + 8, w * 0.72, 27, 600, "rgba(255,255,255,.9)", "left") + 8;
      } else y = drawRich(ctx, "价格", x0 + 18, y + Math.round(bandH * 0.4), w * 0.72, 71, 900, "#ffffff", "left") + 6;
      y += Math.round(bandH * 0.18);
      const rest = tiers.slice(1);
      if (rest.length) y = drawChips(ctx, rest.map(function (t) { return [t.label, t.price].filter(Boolean).join("　"); }), x0, y + 14, w, { size: 25, color: ink, border: alphaColor(P.primary, 0.4), fill: "#ffffff", lw: 2 });
      /* 多平台二维码：价格横幅下方整宽网格（原单张二维码改为多条网格） */
      if (qrList.length) y = qrGridAt(x0, w);
      if (data.note) y = drawRich(ctx, data.note, x0, y + 15, w, 23, 500, artMuted(), "left", 1.5, "body") + 10;
      return y;
    }
    if (tpl === "ticket-cards") {
      const cols = Math.max(1, Math.min(3, Math.ceil(tiers.length / 2)));
      const gap = 22;
      const cw = (w - gap * (cols - 1)) / cols;
      const ch = Math.round(cw * 0.9);
      tiers.slice(0, 6).forEach(function (tier, index) {
        const col = index % cols; const row = Math.floor(index / cols);
        const cx = x0 + col * (cw + gap); const cy = y + row * (ch + gap);
        ctx.save(); roundRectPath(ctx, cx, cy, cw, ch, 24); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, cx, cy, cw, ch, 24); ctx.strokeStyle = alphaColor(P.primary, 0.22); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        drawRich(ctx, text(tier.price, "价格"), cx + cw / 2, cy + Math.round(ch * 0.4), cw - 20, 46, 900, P.accent, "center", 1);
        drawRich(ctx, text(tier.label, "票档"), cx + cw / 2, cy + Math.round(ch * 0.4) + 48, cw - 20, 23, 600, artMuted(), "center", 1);
      });
      if (!tiers.length) { ctx.save(); roundRectPath(ctx, x0, y, w, 140, 24); ctx.fillStyle = P.soft; ctx.fill(); ctx.restore(); drawRich(ctx, "暂无票档", x0 + w / 2, y + 30, w, 27, 600, artMuted(), "center", 1); y += 60; }
      else y += Math.ceil(Math.min(tiers.length, 6) / cols) * (ch + gap) - gap;
      if (data.note) y = drawRich(ctx, data.note, x0, y + 21, w, 23, 500, artMuted(), "left", 1.5, "body") + 14;
      if (qrList.length) y = qrGridAt(x0, w);
      return y;
    }
    /* 默认 qr-side / 其余：左侧票档行 + 右侧二维码网格 */
    const splitGap = 30;
    const sideW = qrList.length ? Math.min(qrSize + 44, Math.round(w * 0.45)) : 0;
    const leftW = sideW ? w - sideW - splitGap : w;
    let ly = y;
    if (!tiers.length) { drawRich(ctx, "暂无票档", x0, ly + 8, leftW, 27, 600, artMuted(), "left", 1); ly += 50; }
    tiers.slice(0, 8).forEach(function (tier) {
      const rowY = ly + 8;
      drawRich(ctx, text(tier.label, "票档"), x0, rowY, leftW * 0.62, 27, 600, ink, "left", 1);
      drawRich(ctx, text(tier.price, "价格"), x0 + leftW, rowY, leftW * 0.38, 27, 900, P.accent, "right", 1);
      ly += 63;
      drawLine(ctx, x0, ly, x0 + leftW, ly, alphaColor(P.primary, 0.14), 2);
    });
    let qrBottom = y;
    if (qrList.length) qrBottom = paintQrGridPx(ctx, qrList, qrImgs, x0 + leftW + splitGap, y + 16, sideW, qrCols, qrSize, P, ink);
    y = Math.max(ly, qrBottom);
    if (data.note) y = drawRich(ctx, data.note, x0, y + 19, w, 23, 500, artMuted(), "left", 1.5, "body") + 10;
    return y;
  }

  async function paintMaterials(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const items = data.items || [];
    const note = data.note;
    const tpl = data.template || "icon-grid";
    const list = items.length ? items : [{}];
    let y = y0;
    if (tpl === "checklist") {
      for (const item of list) {
        drawRich(ctx, "✓", x0 + 17, y + 36, 40, 27, 900, P.accent, "left", 1);
        drawRich(ctx, text(item.label, "物料条目"), x0 + 54, y + 30, w - 54, 27, 500, ink, "left", 1, "body");
        y += 71;
      }
      if (!items.length) y -= 29;
      if (note) y = drawRich(ctx, note, x0, y + 17, w, 23, 500, artMuted(), "left", 1.5, "body") + 12;
      return y;
    }
    if (tpl === "notice-strip") {
      const stripH = 64;
      list.forEach(function (item, index) {
        ctx.save(); roundRectPath(ctx, x0, y, w, stripH, 18); ctx.fillStyle = index % 2 === 0 ? P.accent : P.primary; ctx.fill(); ctx.restore();
        drawRich(ctx, text(item.label, "物料条目"), x0 + w / 2, y + stripH - 22, w - 30, 25, 700, "#ffffff", "center", 1, "body");
        y += stripH + 16;
      });
      if (!items.length) y -= 50;
      if (note) y = drawRich(ctx, note, x0, y + 7, w, 11, 500, artMuted(), "left", 1.5, "body") + 5;
      return y;
    }
    /* icon-grid：图标圆角块 + 说明文字；iconSize 与 DOM 预览/PSD 同源（画布坐标系 px）。
       上限放宽到 400（接近板块容器宽），图标按列宽自适应防溢出，大图标时文字行下移避让。 */
    const icons = await Promise.all(items.map(function (it) { return it && it.icon && it.icon.url ? loadImage(it.icon) : Promise.resolve(null); }));
    const cols = Math.max(1, Math.min(4, Number(data.columns) || 2));
    const gap = 20;
    const cw = (w - gap * (cols - 1)) / cols;
    const iconSize = Math.round(Math.min(600, Math.max(48, Number(data.iconSize) || 104)));
    const iconBox = Math.min(iconSize, cw - 8 > 0 ? cw - 8 : cw);
    const cellH = Math.max(iconBox + 74, Math.round(cw * 1.15));
    const count = Math.max(1, items.length);
    for (let i = 0; i < count; i += 1) {
      const item = items[i] || {};
      const cx = x0 + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (cellH + gap);
      ctx.save(); roundRectPath(ctx, cx, cy, cw, cellH, 22); ctx.fillStyle = alphaColor("#ffffff", 0.78); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, cx, cy, cw, cellH, 22); ctx.strokeStyle = alphaColor(P.primary, 0.14); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      const img = icons[i];
      if (img) {
        /* 大图标时图标顶部占满卡片上沿（不再 16% 内边距），文字固定在底部避让 */
        const iconTop = iconBox > cw * 0.9 ? cy + 10 : cy + Math.round(cellH * 0.16);
        ctx.save(); roundRectPath(ctx, cx + (cw - iconBox) / 2, iconTop, iconBox, iconBox, 24); ctx.clip(); coverDraw(ctx, img, cx + (cw - iconBox) / 2, iconTop, iconBox, iconBox); ctx.restore();
      }
      drawRich(ctx, text(item.label, "物料条目"), cx + cw / 2, cy + cellH - 34, cw - 16, 25, 600, ink, "center", 1.35, "body");
    }
    y += Math.ceil(count / cols) * (cellH + gap) - gap;
    if (note) y = drawRich(ctx, note, x0, y + 19, w, 23, 500, artMuted(), "left", 1.5, "body") + 10;
    return y;
  }

  async function paintCrossPromo(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const icon = await loadImage(data.icon);
    const tpl = data.template || "promo-card";
    const value = data.text || "联动推广文案";
    const padY = 24;
    let innerH = 0;
    /* iconSize：联动图标边长（px，画布坐标系），未设置走历史公式 */
    const promoIconPx = imageSizeOf(data, "iconSize", 60, 220, 4);
    if (tpl === "promo-centered") {
      const info = textBlockInfo(ctx, value, w - 60, 29, 600, 1.7, "body");
      const iconSide = promoIconPx || Math.round(w * 0.24);
      innerH = (icon ? iconSide + 38 : 0) + info.height + padY * 2 - 30;
      ctx.save(); roundRectPath(ctx, x0, y0, w, innerH, 26); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore();
      let y = y0 + 36;
      if (icon) {
        const iw = Math.min(iconSide, Math.round(w * 0.22)); const ih = iw;
        const ix = x0 + (w - iw) / 2;
        ctx.save(); roundRectPath(ctx, ix, y, iw, ih, 26); ctx.clip(); coverDraw(ctx, icon, ix, y, iw, ih); ctx.restore();
        y += ih + 33;
      }
      y = drawRich(ctx, value, x0 + w / 2, y, w - 60, 29, 600, ink, "center", 1.7, "body");
      return y0 + innerH;
    }
    const side = icon ? Math.min(163, Math.round(w * 0.26)) : 0;
    const textInfo = textBlockInfo(ctx, value, w - side - (icon ? 60 : 0), 29, 600, 1.68, "body");
    const bandH = Math.max(100, padY * 2 + textInfo.height);
    ctx.save(); roundRectPath(ctx, x0, y0, w, bandH, 26); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore();
    if (icon) {
      const iw = Math.min(promoIconPx || 104, side); const ih = iw;
      const ix = x0 + (side - iw) / 2; const iy = y0 + (bandH - ih) / 2;
      ctx.save(); roundRectPath(ctx, ix, iy, iw, ih, 26); ctx.clip(); coverDraw(ctx, icon, ix, iy, iw, ih); ctx.restore();
      drawRich(ctx, value, x0 + side + 19, y0 + (bandH - textInfo.height) / 2 + 20, w - side - 40, 29, 600, ink, "left", 1.68, "body");
    } else {
      drawRich(ctx, value, x0 + w / 2, y0 + (bandH - textInfo.height) / 2 + 20, w - 60, 29, 600, ink, "center", 1.68, "body");
    }
    return y0 + bandH;
  }

  async function paintSchedule(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk(); let y = y0;
    const groups = data.groups || [];
    const tpl = data.template || "timeline";
    for (const group of groups) {
      const rows = group.rows || [];
      if (!rows.length) continue;
      if (tpl === "schedule-table") {
        const headH = 84;
        ctx.save(); roundRectPath(ctx, x0, y, w, headH, 18); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore();
        drawRich(ctx, text(group.groupName, "活动时间"), x0 + 22, y + 52, w - 44, 33, 800, P.primaryDark, "left", 1);
        y += headH;
        rows.forEach(function (row, ri) {
          if (ri > 0) drawLine(ctx, x0, y, x0 + w, y, P.line, 2);
          drawRich(ctx, text(row.time, "00:00"), x0 + 22, y + 40, w * 0.22, 25, 700, P.accent, "left", 1);
          drawRich(ctx, text(row.name, "环节"), x0 + w * 0.22 + 22, y + 40, w * 0.72, 27, 500, ink, "left", 1);
          y += 92;
        });
        y += 25;
      } else if (tpl === "schedule-cards") {
        ctx.save(); roundRectPath(ctx, x0, y, w, 84, 21); ctx.fillStyle = alphaColor("#ffffff", 0.78); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, x0, y, w, 96, 24); ctx.strokeStyle = alphaColor(P.primary, 0.2); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        drawRich(ctx, text(group.groupName, "活动时间"), x0 + 22, y + 52, w - 44, 33, 800, P.primaryDark, "left", 1);
        y += 84;
        rows.forEach(function (row, ri) {
          if (ri > 0) drawLine(ctx, x0 + 20, y - 6, x0 + w - 20, y - 6, alphaColor(P.primary, 0.12), 2);
          drawRich(ctx, text(row.name, "环节"), x0 + 22, y + 40, w * 0.62, 27, 500, ink, "left", 1);
          drawRich(ctx, text(row.time, "00:00"), x0 + w - 22, y + 40, w * 0.3, 25, 800, P.accent, "right", 1);
          y += 61;
        });
        y += 25;
      } else {
        drawRich(ctx, text(group.groupName, "活动时间"), x0, y, w, 33, 800, P.primaryDark, "left", 1.35);
        y += 25;
        rows.forEach(function (row) {
          ctx.save(); ctx.fillStyle = P.accent; ctx.beginPath(); ctx.arc(x0 + 13, y + 20, 7, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          drawRich(ctx, text(row.time, "00:00"), x0 + 42, y + 22, w * 0.2, 25, 700, P.accent, "left", 1);
          drawRich(ctx, text(row.name, "环节"), x0 + 42 + w * 0.2 + 17, y + 22, w * 0.72, 27, 500, ink, "left", 1.7);
          y += 59;
        });
        y += 14;
      }
    }
    if (!groups.length || !groups.some(function (g) { return (g.rows || []).length; })) {
      drawRich(ctx, "暂无时间安排", x0 + w / 2, y + 32, w, 27, 600, artMuted(), "center", 1);
      y += 66;
    }
    return y;
  }

  async function paintVenue(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const tags = (data.tags || []).filter(Boolean);
    const img = await loadImage(data.photo);
    const tpl = data.template || "venue-side";
    const chipsOpt = { size: 23, color: P.primaryDark, border: alphaColor(P.primary, 0.3), fill: P.primarySoft, lw: 2 };
    if (tpl === "venue-focus") {
      let y = y0;
      if (img) { const h = Math.min(396, Math.round(w * 0.5)); ctx.save(); roundRectPath(ctx, x0, y, w, h, 21); ctx.clip(); coverDraw(ctx, img, x0, y, w, h); ctx.restore(); y += h + 44; }
      y = drawRich(ctx, data.description || "场地描述", x0, y, w, 29, 400, ink, "left", 1.68, "body") + 10;
      if (tags.length) y = drawChips(ctx, tags, x0, y, w, chipsOpt) + 8;
      return y;
    }
    if (tpl === "venue-map") {
      const pad = 25;
      const textH = textBlockInfo(ctx, data.description || "场地描述", w - pad * 2, 29, 400, 1.68, "body").height;
      const chipsH = tags.length ? chipRowCount(ctx, tags, w - pad * 2, 23) : 0;
      const paneH = pad + textH + 24 + (tags.length ? chipsH + 14 : 0) + pad - 20;
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 26); ctx.fillStyle = alphaColor("#ffffff", 0.7); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 26); ctx.strokeStyle = alphaColor(P.accent, 0.75); ctx.lineWidth = 3; ctx.setLineDash([14, 14]); ctx.stroke(); ctx.restore();
      let y = y0 + pad - 8;
      y = drawRich(ctx, data.description || "场地描述", x0 + pad, y, w - pad * 2, 29, 400, ink, "left", 1.68, "body") + 10;
      if (tags.length) drawChips(ctx, tags, x0 + pad, y, w - pad * 2, chipsOpt);
      return y0 + paneH;
    }
    /* venue-side：左描述 + 右侧场地照片；photoSize 控制照片边长（px，画布坐标系） */
    const side = img ? Math.min(imageSizeOf(data, "photoSize", 100, 400, 4) || 163, Math.round(w * 0.4)) : 0;
    const textW = side ? w - side - 34 : w;
    const textH = textBlockInfo(ctx, data.description || "场地描述", textW, 29, 400, 1.68, "body").height;
    const chipsH = tags.length ? chipRowCount(ctx, tags, textW, 23) : 0;
    const copyH = textH + (tags.length ? chipsH + 16 : 0);
    const imgH = Math.max(Math.round(w * 0.48), copyH + 20);
    if (img) { ctx.save(); roundRectPath(ctx, x0 + textW + 19, y0, side, imgH, 21); ctx.clip(); coverDraw(ctx, img, x0 + textW + 19, y0, side, imgH); ctx.restore(); }
    let y = y0;
    y = drawRich(ctx, data.description || "场地描述", x0, y, textW, 29, 400, ink, "left", 1.68, "body") + 10;
    if (tags.length) y = drawChips(ctx, tags, x0, y, textW, chipsOpt);
    return Math.max(y + 12, img ? y0 + imgH : y + 12);
  }

  async function paintRoute(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const lines = (data.lines || []).filter(Boolean);
    const tpl = data.template || "steps";
    let y = y0;
    if (tpl === "route-focus") {
      if (lines[0]) {
        ctx.save(); roundRectPath(ctx, x0, y, w, 100, 21); ctx.fillStyle = P.primary; ctx.fill(); ctx.restore();
        drawRich(ctx, lines[0], x0 + w / 2, y + 60, w - 44, 29, 700, "#ffffff", "center", 1.5, "body");
        y += 100 + 21;
      }
      for (const line of lines.slice(1)) {
        drawRich(ctx, "›", x0, y + 34, 40, 28, 900, P.accent, "left", 1);
        drawRich(ctx, line, x0 + 48, y + 30, w - 48, 27, 500, ink, "left", 1.6, "body");
        y += 92;
      }
      if (!lines.length) { drawRich(ctx, "暂无路线", x0, y + 34, w, 27, 600, artMuted(), "left", 1); y += 60; }
      return y;
    }
    const showLines = lines.length ? lines : [""];
    for (let i = 0; i < showLines.length; i += 1) {
      const line = showLines[i];
      if (tpl === "route-list") {
        ctx.save(); roundRectPath(ctx, x0, y, w, 62, 17); ctx.fillStyle = alphaColor("#ffffff", 0.7); ctx.fill(); ctx.restore();
        drawRich(ctx, "›", x0 + 20, y + 40, 30, 28, 900, P.accent, "left", 1);
        drawRich(ctx, line, x0 + 46, y + 38, w - 62, 27, 500, ink, "left", 1, "body");
        y += 78;
      } else {
        const num = String(i + 1).padStart(2, "0");
        drawRich(ctx, num, x0, y + 34, 76, 30, 900, P.accent, "left", 1);
        drawRich(ctx, line, x0 + 86, y + 34, w - 86, 27, 600, ink, "left", 1.35, "body");
        y += 92;
      }
    }
    if (!lines.length) y -= 26;
    return y;
  }

  async function paintProgram(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const items = data.items || [];
    const tpl = data.template || "program-list";
    let y = y0;
    if (tpl === "program-cards") {
      const cols = Math.max(1, Math.min(3, Math.ceil(Math.max(items.length, 1) / 2)));
      const gap = 24;
      const cw = (w - gap * (cols - 1)) / cols;
      const imgH = Math.round(cw * 0.9);
      const cardH = imgH + Math.round(cw * 0.48);
      const count = Math.max(1, items.length);
      for (let i = 0; i < count; i += 1) {
        const item = items[i] || {};
        const cx = x0 + (i % cols) * (cw + gap);
        const cy = y + Math.floor(i / cols) * (cardH + gap);
        ctx.save(); roundRectPath(ctx, cx, cy, cw, cardH, 22); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, cx, cy, cw, cardH, 22); ctx.strokeStyle = alphaColor(P.primary, 0.18); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        const itemImg = item.image && item.image.url ? await loadImage(item.image) : null;
        if (itemImg) { ctx.save(); roundRectPath(ctx, cx, cy, cw, imgH, 22); ctx.clip(); coverDraw(ctx, itemImg, cx, cy, cw, imgH); ctx.restore(); }
        else { ctx.save(); roundRectPath(ctx, cx, cy, cw, imgH, 22); ctx.fillStyle = P.soft; ctx.fill(); ctx.restore(); }
        if (item.tag) drawRich(ctx, item.tag, cx + 14, cy + imgH + 30, cw - 26, 21, 800, P.accent, "left", 1);
        drawRich(ctx, text(item.title, "节目标题"), cx + 14, cy + imgH + 58, cw - 26, 27, 700, ink, "left", 1.35);
        if (item.subtitle) drawRich(ctx, item.subtitle, cx + 14, cy + imgH + 88, cw - 26, 23, 500, artMuted(), "left", 1.3, "body");
      }
      y += Math.ceil(count / cols) * (cardH + gap) - gap;
      return y;
    }
    if (tpl === "program-compact") {
      const cols = 2; const gap = 17; const cw = (w - gap) / 2; const ch = 100;
      const list = items.length ? items : [{ tag: "", title: "" }];
      list.forEach(function (item, index) {
        const cx = x0 + (index % cols) * (cw + gap);
        const cy = y + Math.floor(index / cols) * (ch + gap);
        ctx.save(); roundRectPath(ctx, cx, cy, cw, ch, 20); ctx.fillStyle = alphaColor("#ffffff", 0.75); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, cx, cy, cw, ch, 20); ctx.strokeStyle = alphaColor(P.primary, 0.16); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        if (item.tag) drawRich(ctx, item.tag, cx + 14, cy + 36, cw - 26, 21, 800, P.accent, "left", 1);
        drawRich(ctx, text(item.title, "节目标题"), cx + 14, cy + 66, cw - 26, 27, 700, ink, "left", 1.2);
      });
      y += Math.ceil(Math.max(items.length, 1) / cols) * (ch + gap) - gap;
      return y;
    }
    /* program-list 默认列表；thumbWidth 控制配图宽度（px，画布坐标系） */
    const itemsShown = items.length ? items : [{}];
    const pgThumb = imageSizeOf(data, "thumbWidth", 80, 300, 4) || Math.round(w * 0.28);
    for (const item of itemsShown) {
      const img = item.image && item.image.url ? await loadImage(item.image) : null;
      if (img) {
        const thumb = pgThumb;
        const th = Math.min(200, Math.round(thumb * 0.74));
        const ix = item.mediaSide === "left" ? x0 : x0 + w - thumb;
        ctx.save(); roundRectPath(ctx, ix, y + 8, thumb, th, 18); ctx.clip(); coverDraw(ctx, img, ix, y + 8, thumb, th); ctx.restore();
        const textX = item.mediaSide === "left" ? x0 + thumb + 30 : x0;
        const textW = w - thumb - 30;
        let cy = y + 28;
        if (item.tag) cy = drawRich(ctx, item.tag, textX, cy, textW, 21, 800, P.accent, "left", 1) + 10;
        cy = drawRich(ctx, text(item.title, "节目标题"), textX, cy, textW, 27, 700, ink, "left", 1.3) + 8;
        if (item.subtitle) cy = drawRich(ctx, item.subtitle, textX, cy, textW, 23, 500, artMuted(), "left", 1.4, "body");
        y += Math.max(th + 24, cy - y + 17);
      } else {
        let cy = y + 28;
        if (item.tag) cy = drawRich(ctx, item.tag, x0, cy, w, 21, 800, P.accent, "left", 1) + 10;
        cy = drawRich(ctx, text(item.title, "节目标题"), x0, cy, w, 27, 700, ink, "left", 1.3) + 8;
        if (item.subtitle) cy = drawRich(ctx, item.subtitle, x0, cy, w, 23, 500, artMuted(), "left", 1.4, "body");
        y = cy + 19;
      }
      drawLine(ctx, x0, y - 10, x0 + w, y - 10, alphaColor(P.primary, 0.12), 2);
    }
    if (!items.length) { drawRich(ctx, "暂无节目", x0 + w / 2, y + 34, w, 27, 600, artMuted(), "center", 1); y += 60; }
    return y;
  }

  async function paintPerformer(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const tpl = data.template || "cast-list";
    const cast = data.cast || [];
    const avatarDims = function (ratio) {
      const aw = imageSizeOf(data, "avatarWidth", 80, 260, 4) || 150;
      if (ratio === "3:4") return { w: aw, h: Math.round(aw * 4 / 3) };
      if (ratio === "1:1.4") return { w: aw, h: Math.round(aw * 1.4) };
      return { w: aw, h: aw };
    };
    const drawMember = async function (member, mx, my, mw) {
      const img = member.avatar && member.avatar.url ? await loadImage(member.avatar) : null;
      const dims = avatarDims(member.avatarRatio || "1:1");
      const avatarStyle = P.avatarStyle || "none";
      let cy = my;
      const leftW = img ? dims.w + 25 : 0;
      if (img) {
        if (avatarStyle === "polaroid") {
          ctx.save(); ctx.fillStyle = "#ffffff"; roundRectPath(ctx, mx - 8, my - 8, dims.w + 16, dims.h + 26, 4); ctx.fill();
          ctx.restore();
          ctx.save(); roundRectPath(ctx, mx, my, dims.w, dims.h, 3); ctx.clip(); coverDraw(ctx, img, mx, my, dims.w, dims.h); ctx.restore();
        } else {
          ctx.save(); roundRectPath(ctx, mx, my, dims.w, dims.h, 14); ctx.clip(); coverDraw(ctx, img, mx, my, dims.w, dims.h); ctx.restore();
        }
        if (avatarStyle === "ring" || avatarStyle === "frame") {
          roundRectPath(ctx, mx, my, dims.w, dims.h, avatarStyle === "frame" ? 3 : 14);
          ctx.strokeStyle = P.primary; ctx.lineWidth = avatarStyle === "frame" ? 5 : 3; ctx.stroke();
          if (avatarStyle === "frame") { roundRectPath(ctx, mx - 4, my - 4, dims.w + 8, dims.h + 8, 5); ctx.strokeStyle = P.accent; ctx.lineWidth = 1.5; ctx.stroke(); }
        } else if (avatarStyle === "glow") {
          ctx.save(); ctx.shadowColor = alphaColor(P.primary, 0.65); ctx.shadowBlur = 24; roundRectPath(ctx, mx, my, dims.w, dims.h, 14); ctx.strokeStyle = alphaColor(P.accent, 0.7); ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
        } else if (avatarStyle === "badge") {
          ctx.save(); ctx.fillStyle = P.accent; roundRectPath(ctx, mx + dims.w - 20, my + dims.h - 20, 16, 16, 4); ctx.fill();
          ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx + dims.w - 12, my + dims.h - 12, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
        }
      }
      const tx = mx + leftW;
      const tw = mw - leftW;
      let headY = cy;
      const name = text(member.name, "");
      if (name) { headY = drawRich(ctx, name, tx, headY, tw, 33, 800, P.primaryDark, "left", 1.3); }
      if (member.role || member.time) {
        headY = name ? headY + 8 : headY;
        const tag = [R.castRoleLabel(member.role), member.time].filter(Boolean).join("  ·  ");
        headY = drawRich(ctx, tag, tx, headY, tw, 21, 700, P.accent, "left", 1);
      }
      if (member.bio) { headY = drawRich(ctx, member.bio, tx, headY + 8, tw, 23, 400, ink, "left", 1.5, "body"); }
      cy = headY + 10;
      const setlist = (member.setlist || []).filter(function (s) { return s && (s.song || s.coverBy); });
      if (setlist.length) {
        cy = cy + 14;
        drawRich(ctx, "歌单", tx, cy, tw, 19, 800, artMuted(), "left", 1);
        cy += 30;
        const hasCover = setlist.some(function (s) { return s.coverBy; });
        for (const s of setlist) {
          if (hasCover) {
            drawRich(ctx, s.song || "", tx, cy, Math.round(tw * 0.62), 23, 600, ink, "left", 1.2, "body");
            drawRich(ctx, s.coverBy || "", tx + Math.round(tw * 0.62), cy, Math.round(tw * 0.38), 19, 500, artMuted(), "right", 1.2, "body");
          } else {
            drawRich(ctx, s.song || "", tx, cy, tw, 23, 600, ink, "left", 1.2, "body");
          }
          cy += 30;
        }
      }
      return cy;
    };
    const gap = 25;
    if (tpl === "cast-cards") {
      /* 卡片列数随头像宽度自适应：大头像时减少列数，保证文字列至少 ~120px */
      const aw = imageSizeOf(data, "avatarWidth", 80, 260, 4) || 150;
      const cols = Math.max(1, Math.floor(w / Math.max(260, aw + 150)));
      const cw = Math.floor((w - gap * (cols - 1)) / cols);
      const rows = Math.ceil(Math.max(cast.length, 1) / cols);
      const ch = 340;
      for (let i = 0; i < Math.max(cast.length, 1); i += 1) {
        const col = i % cols; const row = Math.floor(i / cols);
        const member = cast[i] || {};
        const cx = x0 + col * (cw + gap);
        const cy0 = y0 + row * (ch + gap);
        ctx.save(); roundRectPath(ctx, cx, cy0, cw, ch, 17); ctx.fillStyle = alphaColor("#ffffff", 0.72); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, cx, cy0, cw, ch, 17); ctx.strokeStyle = alphaColor(P.primary, 0.16); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        await drawMember(member, cx + 16, cy0 + 16, cw - 32);
      }
      return y0 + rows * (ch + gap) - gap;
    }
    let y = y0;
    const shown = cast.length ? cast : [{}];
    for (const member of shown) {
      y = await drawMember(member, x0, y, w);
      if (cast.length) y += gap;
    }
    return cast.length ? y - gap : y;
  }

  async function paintBooth(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const items = data.items || [];
    const tpl = data.template || "booth-grid";
    let y = y0;
    /* imageWidth：摊位图边长（px，画布坐标系），未设置走历史公式 */
    const boothImgPx = imageSizeOf(data, "imageWidth", 80, 260, 4);
    if (tpl === "booth-cards") {
      const list = items.length ? items : [{}];
      for (const item of list) {
        const img = item.image && item.image.url ? await loadImage(item.image) : null;
        const imgW = boothImgPx || Math.min(150, Math.round(w * 0.2));
        const rowH = Math.max(130, imgW + 48);
        if (img) { ctx.save(); roundRectPath(ctx, x0 + 20, y + 24, imgW, imgW, 20); ctx.clip(); coverDraw(ctx, img, x0 + 20, y + 24, imgW, imgW); ctx.restore(); }
        else { ctx.save(); roundRectPath(ctx, x0 + 20, y + 24, imgW, imgW, 20); ctx.fillStyle = P.soft; ctx.fill(); ctx.restore(); }
        drawRich(ctx, text(item.name, "摊位"), x0 + imgW + 23, y + 58, w - imgW - 40, 27, 800, ink, "left", 1);
        if (item.desc) drawRich(ctx, item.desc, x0 + imgW + 23, y + 96, w - imgW - 40, 23, 500, artMuted(), "left", 1.5, "body");
        ctx.save(); roundRectPath(ctx, x0, y, w, rowH, 22); ctx.strokeStyle = alphaColor(P.primary, 0.16); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        y += rowH + 21;
      }
      if (!items.length) y -= 50;
      return y;
    }
    if (tpl === "booth-list") {
      const list = items.length ? items : [{}];
      for (const item of list) {
        drawRich(ctx, text(item.name, "摊位"), x0, y + 42, w * 0.52, 27, 700, ink, "left", 1);
        if (item.desc) drawRich(ctx, item.desc, x0 + w * 0.5, y + 39, w * 0.5, 23, 500, artMuted(), "right", 1, "body");
        y += 68;
        drawLine(ctx, x0, y - 8, x0 + w, y - 8, alphaColor(P.primary, 0.14), 2);
      }
      if (!items.length) { drawRich(ctx, "暂无摊位", x0 + w / 2, y + 30, w, 27, 600, artMuted(), "center", 1); y += 62; }
      return y;
    }
    /* booth-grid 默认：摊位名/简介网格（有图则图上文下） */
    const cols = Math.max(1, Math.min(4, Number(data.columns) || 2));
    const gap = 20;
    const cw = (w - gap * (cols - 1)) / cols;
    const cellH = Math.round(cw * 1.35);
    const count = Math.max(1, items.length);
    const imgs = await Promise.all(items.map(function (it) { return it && it.image && it.image.url ? loadImage(it.image) : Promise.resolve(null); }));
    for (let i = 0; i < count; i += 1) {
      const item = items[i] || {};
      const cx = x0 + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (cellH + gap);
      ctx.save(); roundRectPath(ctx, cx, cy, cw, cellH, 22); ctx.fillStyle = alphaColor("#ffffff", 0.8); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, cx, cy, cw, cellH, 22); ctx.strokeStyle = alphaColor(P.primary, 0.15); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      const img = imgs[i];
      const hasImg = img || (item.image && item.image.url);
      if (hasImg) {
        const imgH = boothImgPx ? Math.min(boothImgPx, Math.round(cw * 0.9)) : Math.round(cw * 0.52);
        if (img) { ctx.save(); roundRectPath(ctx, cx, cy, cw, imgH, 22); ctx.clip(); coverDraw(ctx, img, cx, cy, cw, imgH); ctx.restore(); }
        else { ctx.save(); roundRectPath(ctx, cx, cy, cw, imgH, 22); ctx.fillStyle = P.soft; ctx.fill(); ctx.restore(); }
        drawRich(ctx, text(item.name, "摊位"), cx + 12, cy + imgH + 36, cw - 22, 27, 700, ink, "left", 1.3);
        if (item.desc) drawRich(ctx, capText(item.desc, 26), cx + 12, cy + imgH + 66, cw - 22, 23, 500, artMuted(), "left", 1.35, "body");
      } else {
        drawRich(ctx, text(item.name, "摊位"), cx + cw / 2, cy + 54, cw - 24, 30, 700, ink, "center", 1.3);
        if (item.desc) drawRich(ctx, capText(item.desc, 30), cx + cw / 2, cy + 102, cw - 24, 25, 500, artMuted(), "center", 1.35, "body");
      }
    }
    y += Math.ceil(count / cols) * (cellH + gap) - gap;
    return y;
  }
  function paintDivider(ctx, data, x0, y0, w) {
    const P = artTheme();
    drawDividerShape(ctx, data, x0, y0 + 26, w, alphaColor(P.primary, 0.75));
    return y0 + 80;
  }

  function paintFooter(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const lines = (data.lines || []).filter(Boolean);
    const tpl = data.template || "footer-simple";
    let y = y0;
    if (tpl === "footer-banner") {
      const items = lines.length ? lines : ["主办：Only-box 企划"];
      const size = 25; const gap = 21; const rowH = 52;
      ctx.save(); artFont(ctx, size, 600, "body");
      let rows = 1; let rowW = 0;
      const widths = items.map(function (line) { const tw = ctx.measureText(String(line)).width; return { line: line, tw: tw }; });
      const fitted = [];
      let current = []; let cw2 = 0;
      widths.forEach(function (it) {
        if (current.length && cw2 + it.tw + gap > w - 58) { fitted.push(current); current = []; cw2 = 0; }
        current.push(it); cw2 += it.tw + (current.length > 1 ? gap : 0);
      });
      if (current.length) fitted.push(current);
      ctx.restore();
      const boxH = 40 + fitted.length * rowH + 24;
      ctx.save(); roundRectPath(ctx, x0, y, w, boxH, 21); ctx.fillStyle = P.primaryDark; ctx.fill(); ctx.restore();
      let by = y + 44;
      fitted.forEach(function (rowItems) {
        let cx = x0 + w / 2 - (rowItems.reduce(function (s, it) { return s + it.tw; }, 0) + (rowItems.length - 1) * gap) / 2;
        rowItems.forEach(function (it) {
          drawRich(ctx, it.line, cx, by, it.tw + 6, size, 600, "#ffffff", "left", 1, "body");
          cx += it.tw + gap;
        });
        by += rowH;
      });
      return y + boxH;
    }
    if (tpl === "footer-center") {
      (lines.length ? lines : ["微博 @XXX"]).forEach(function (line) {
        y = drawRich(ctx, line, x0 + w / 2, y, w, 23, 500, artMuted(), "center", 1.6, "body") + 8;
      });
      return y;
    }
    if (tpl === "footer-pills") {
      const items = lines.length ? lines : ["主办：Only-box 企划"];
      y = drawChips(ctx, items, x0 + w / 2, y, w, { size: 23, color: P.primaryDark, border: alphaColor(P.primary, 0.35), fill: P.primarySoft, lw: 2, center: true, scope: "body" });
      return y + 10;
    }
    (lines.length ? lines : ["微博 @XXX"]).forEach(function (line) {
      y = drawRich(ctx, line, x0, y, w, 23, 500, ink, "left", 1.5, "body") + 6;
    });
    return y;
  }

  function paintFreeText(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const level = data.level || "body";
    const size = C.fontSizePx(level, 750);
    const align = data.align === "center" ? "center" : data.align === "right" ? "right" : "left";
    const tx = align === "center" ? x0 + w / 2 : align === "right" ? x0 + w : x0;
    const tpl = data.template || "text-basic";
    const value = data.text || "自由文本";
    const drawTxt = function (y, sizePx, weight, color, mul, maxW) {
      return drawRich(ctx, value, tx, y, maxW || w, sizePx, weight, color || ink, align, mul || 1.66, "body");
    };
    if (tpl === "text-highlight") {
      const padX = 31; const padY = 27;
      const innerW = w - padX * 2 - 18;
      const info = textBlockInfo(ctx, value, innerW, size, 600, 1.7, "body");
      const paneH = padY * 2 + info.height;
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 24); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0 + 13, y0 + 13, 9, paneH - 26, 5); ctx.fillStyle = P.accent; ctx.fill(); ctx.restore();
      drawTxt(y0 + padY + Math.round(size * 0.2), size, 600, ink, 1.7, innerW);
      return y0 + paneH;
    }
    if (tpl === "text-card") {
      const padX = 33; const padY = 29;
      const info = textBlockInfo(ctx, value, w - padX * 2, size, 500, 1.66, "body");
      const paneH = padY * 2 + info.height;
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 26); ctx.fillStyle = alphaColor("#ffffff", 0.82); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 26); ctx.strokeStyle = alphaColor(P.primary, 0.2); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      drawTxt(y0 + padY + Math.round(size * 0.2), size, 500, ink, 1.66, w - padX * 2);
      return y0 + paneH;
    }
    if (tpl === "text-note") return drawTxt(y0, 23, 400, artMuted(), 1.75);
    const weight = level === "h1" || level === "h2" ? 800 : level === "h3" ? 700 : 400;
    return drawTxt(y0, size, weight, ink, 1.66);
  }

  function ratioNumber(raw) {
    const m = String(raw || "").replace(/\s+/g, "").match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/);
    return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : 0;
  }

  async function paintFreeImage(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const img = await loadImage(data.image);
    const tpl = data.template || "image-focus";
    const fit = dataImageFit(data);
    const isCard = tpl === "image-card";
    const defaultRadius = isCard ? 21 : Math.max(0, Math.round(px2(Number(data.radius) != null ? Number(data.radius) : 0)));
    const ratio = data.ratio && data.ratio !== "auto" ? ratioNumber(data.ratio) : 0;
    let y = y0;
    let h = 0;
    if (img) h = ratio > 0 ? Math.round(w / ratio) : artImageHeight(data, img, w);
    h = Math.max(220, Math.min(h || Math.round(w * 0.6), 1200));
    if (!img) h = Math.round(w * 0.56);
    const radius = Math.min(isCard ? 24 : defaultRadius, 100);
    if (isCard) {
      ctx.save(); roundRectPath(ctx, x0, y0, w, h + 40, 26); ctx.fillStyle = alphaColor("#ffffff", 0.85); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0, y0, w, h + 40, 26); ctx.strokeStyle = alphaColor(P.primary, 0.16); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      y += 20;
    }
    ctx.save(); roundRectPath(ctx, x0, y, w, h, radius); ctx.clip();
    if (img) { if (fit === "contain") containDraw(ctx, img, x0, y, w, h); else coverDraw(ctx, img, x0, y, w, h); }
    else { ctx.fillStyle = P.soft; ctx.fillRect(x0, y, w, h); }
    ctx.restore();
    y += h;
    if (isCard) y += 20;
    if (data.caption) { y += 12; y = drawRich(ctx, data.caption, x0, y, w, 27, 500, artMuted(), "left", 1.5, "body"); }
    return y;
  }

  async function paintModuleBody(ctx, module, x0, y0, w) {
    const data = module.data || {};
    switch (module.type) {
      case "cover": return paintCover(ctx, data, x0, y0, w);
      case "announcement": return paintAnnouncement(ctx, data, x0, y0, w);
      case "ticketInfo": return paintTicket(ctx, data, x0, y0, w);
      case "materials": return paintMaterials(ctx, data, x0, y0, w);
      case "crossPromo": return paintCrossPromo(ctx, data, x0, y0, w);
      case "schedule": return paintSchedule(ctx, data, x0, y0, w);
      case "venueInfo": return paintVenue(ctx, data, x0, y0, w);
      case "routeText": return paintRoute(ctx, data, x0, y0, w);
      case "programList": return paintProgram(ctx, data, x0, y0, w);
      case "castList":
      case "castCards":
        return paintPerformer(ctx, data, x0, y0, w);
      case "boothList": return paintBooth(ctx, data, x0, y0, w);
      case "divider": return paintDivider(ctx, data, x0, y0, w);
      case "footer": return paintFooter(ctx, data, x0, y0, w);
      case "freeText": return paintFreeText(ctx, data, x0, y0, w);
      case "freeImageBox": return paintFreeImage(ctx, data, x0, y0, w);
      default: return drawRich(ctx, R.typeLabel(module.type), x0, y0 + 20, w, 40, 800, artInk(), "left", 1.4);
    }
  }

  /* 板块标题头（序号 + 大标题），返回含头间距后的 y。 */
  function paintModuleHead(ctx, module, def, x0, y0, w, serial) {
    const P = artTheme();
    const rawTitle = moduleTitle(module, def);
    const title = P.titleDecor === "bracket" ? "「" + rawTitle + "」" : rawTitle;
    const kickerText = P.titleDecor === "kicker" ? "/ " + String(serial).padStart(2, "0") : String(serial).padStart(2, "0");
    /* 标题基线需下移一个「字身顶部」的高度，否则 58px 大标题的上半截会被卡片顶边裁掉。
       基线 = y0 + 0.92 * size，使字形顶(≈基线-0.88*size)恰好落在卡片 y0 附近。 */
    const headBaseline = y0 + Math.round(54 * 0.92);
    ctx.save(); artFont(ctx, 23, 900); ctx.fillStyle = P.accent; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(kickerText, x0, y0 + 26);
    ctx.restore();
    if (P.titleDecor === "bar") {
      ctx.save(); ctx.fillStyle = P.accent;
      ctx.fillRect(x0 - 12, y0 + 2, 6, 62);
      ctx.restore();
    }
    const y = drawRich(ctx, title, x0 + w / 2, headBaseline, w - 60, 54, 800, P.primaryDark, "center", 1.22);
    if (P.titleDecor === "stitch") {
      ctx.save(); ctx.strokeStyle = alphaColor(P.accent, 0.75); ctx.lineWidth = 2; ctx.setLineDash([9, 7]);
      ctx.beginPath(); ctx.moveTo(x0, y + 2); ctx.lineTo(x0 + w, y + 2); ctx.stroke();
      ctx.restore();
    }
    return y + 20;
  }

  /* 公共辅助：把模块内容渲染到临时 scratch canvas 并返回布局参数。
     供 drawModuleCard 和 measureCardLayout 共用，消除 ~60 行重复代码。 */
  async function _renderScratch(module, w, serial) {
    const def = R.getDef(module.type);
    const data = module.data || {};
    const pad = styleCardPad(Math.min(80, Math.max(17, px2(Number(data.padding) != null ? Number(data.padding) : 16))), artTheme());
    let scratch = document.createElement("canvas");
    scratch.width = Math.max(1, Math.round(w));
    scratch.height = 3400;
    let sctx = scratch.getContext("2d");
    let cursor = pad;
    let headBaseline = pad;
    if (module.type !== "divider" || data.sectionTitle) {
      headBaseline = pad + Math.round(54 * 0.92);
      cursor = await paintModuleHead(sctx, module, def, pad, pad, w - pad * 2, serial);
    }
    let contentEnd = await paintModuleBody(sctx, module, pad, cursor, w - pad * 2);
    if (contentEnd + pad > 3400) {
      scratch = document.createElement("canvas");
      scratch.width = Math.max(1, Math.round(w));
      scratch.height = Math.ceil(contentEnd + pad + 64);
      sctx = scratch.getContext("2d");
      cursor = pad;
      headBaseline = pad;
      if (module.type !== "divider" || data.sectionTitle) {
        headBaseline = pad + Math.round(54 * 0.92);
        cursor = await paintModuleHead(sctx, module, def, pad, pad, w - pad * 2, serial);
      }
      contentEnd = await paintModuleBody(sctx, module, pad, cursor, w - pad * 2);
    }
    const usedH = Math.max(pad * 2 + 48, contentEnd + pad);
    return { scratch: scratch, usedH: usedH, pad: pad, headBaseline: headBaseline };
  }

  async function drawModuleCard(ctx, module, area, serial) {
    const data = module.data || {};
    const st = artTheme();
    const w = area.w;
    const r = await _renderScratch(module, w, serial);
    const usedH = r.usedH;
    const radius = cardRadius(data, st);
    const opacity = Number.isFinite(Number(data.blockOpacity)) ? Number(data.blockOpacity) / 100 : 0.94;
    const silence = [];
    const bg = data.blockBgImage && data.blockBgImage.url ? await loadImage(data.blockBgImage) : null;
    if (!bg && data.blockBgImage && data.blockBgImage.url) silence.push({ type: "block-image", module: (data.sectionTitle || (R.getDef(module.type) && R.getDef(module.type).label) || "未知板块") });
    const P = artTheme();
    const rot = st.cardStyle === "sticker" ? 0.013 : 0;
    ctx.save();
    if (rot) { const cx0 = area.x + w / 2, cy0 = area.y + usedH / 2; ctx.translate(cx0, cy0); ctx.rotate(rot); ctx.translate(-cx0, -cy0); }
    drawCardBase(ctx, area.x, area.y, w, usedH, radius, st, data, opacity);
    ctx.save();
    roundRectPath(ctx, area.x, area.y, w, usedH, radius);
    ctx.clip();
    if (bg) {
      ctx.fillStyle = data.blockBgColor ? (hexToRgba(data.blockBgColor, 1) || data.blockBgColor) : "#ffffff";
      ctx.fillRect(area.x, area.y, w, usedH);
      coverDraw(ctx, bg, area.x, area.y, w, usedH);
      if (opacity < 0.98) { ctx.fillStyle = alphaColor("#ffffff", 1 - opacity); ctx.fillRect(area.x, area.y, w, usedH); }
    } else if (st.cardStyle === "ink") {
      const nz = noisePattern(ctx);
      if (nz) { ctx.save(); ctx.globalAlpha = 0.05; ctx.fillStyle = nz; ctx.fillRect(area.x, area.y, w, usedH); ctx.restore(); }
    }
    ctx.drawImage(r.scratch, 0, 0, r.scratch.width, usedH, area.x, area.y, w, usedH);
    ctx.restore();
    drawCardBorder(ctx, area.x, area.y, w, usedH, radius, st, data);
    drawCardDecor(ctx, area.x, area.y, w, usedH, radius, st);
    ctx.restore();
    return { h: usedH, silence: silence };
  }

  /* 测量单个模块卡片的真实高度与「标题基线」相对卡片顶的偏移，供排版与 PSD 对齐共用。
     与 drawModuleCard 同款：先画到 scratch 量出 contentEnd → usedH；headBaseline 即 H2 标题基线
     相对卡片顶的像素偏移（0.92*58 的字身顶部下移 + pad）。 */
  async function measureCardLayout(module, w, serial) {
    const r = await _renderScratch(module, w, serial);
    return { h: r.usedH, pad: r.pad, headBaseline: r.headBaseline, w: w };
  }

  /* 计算整页模块的真实排版位置（含 offsetY），供导出与 PSD 对齐共用同一套坐标。 */
  async function measurePageLayout(page, offsetY) {
    const size = pageSize();
    const x = 50;
    const w = size.pageWidth - 100;
    let y = 46 + (offsetY || 0);
    const out = [];
    const rows = M.packModuleRows(page.modules);
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      const list = row.modules.filter(function (m) { return m.visible !== false; });
      if (!list.length) continue;
      if (row.kind === "pair" && list.length === 2) {
        const gap = 14;
        const halfW = (w - gap) / 2;
        const left = await measureCardLayout(list[0], halfW, page.modules.indexOf(list[0]) + 1);
        const right = await measureCardLayout(list[1], halfW, page.modules.indexOf(list[1]) + 1);
        out.push({ module: list[0], x: x, y: y, w: halfW, serial: page.modules.indexOf(list[0]) + 1, head: left.headBaseline, h: left.h });
        out.push({ module: list[1], x: x + halfW + gap, y: y, w: halfW, serial: page.modules.indexOf(list[1]) + 1, head: right.headBaseline, h: right.h });
        const mb = Math.max(px2(Number(list[0].data && list[0].data.marginBottom) || 18), px2(Number(list[1].data && list[1].data.marginBottom) || 18));
        y += Math.max(left.h, right.h) + Math.max(mb, 24);
      } else {
        const module = list[0];
        const meas = await measureCardLayout(module, w, page.modules.indexOf(module) + 1);
        out.push({ module: module, x: x, y: y, w: w, serial: page.modules.indexOf(module) + 1, head: meas.headBaseline, h: meas.h });
        const mb = px2(Number(module.data && module.data.marginBottom) || 18);
        y += meas.h + Math.max(mb, 24);
      }
    }
    return out;
  }

  async function drawModuleStack(ctx, page, offsetY, preLayout) {
    const layout = preLayout || await measurePageLayout(page, offsetY);
    const silence = [];
    for (let i = 0; i < layout.length; i += 1) {
      const item = layout[i];
      const card = await drawModuleCard(ctx, item.module, { x: item.x, y: item.y, w: item.w }, item.serial);
      if (card && card.silence && card.silence.length) silence.push.apply(silence, card.silence);
    }
    return silence;
  }


  /* 导出统一走「实测排版高度」：画布高度 = max(屏高, 内容总高 + 底距)。
     内容超屏时导出画布自动加高，不再静默截断（审计 P1）。
     背景图统一 coverDraw 等比裁切（与预览 background-size:cover 一致，审计 P3）；
     连续长图的整条背景向下锚定，保证跨屏衔接连续。 */
  function auditSilence(silence, pageLabel) {
    if (!silence || !silence.length) return;
    const lines = silence.slice(0, 8).map(function (row) {
      const kind = row.type === "page-background" ? "本屏背景" : row.type === "doc-background" ? "整条背景" : "板块配图";
      const where = row.page ? "第 " + row.page + " 屏 " : (pageLabel || "");
      return where + "「" + (row.module || "未知板块") + "」的" + kind + "引用已失效，该处按占位底色导出";
    });
    if (silence.length > 8) lines.push("……等共 " + silence.length + " 处");
    if (global.alert) global.alert("导出完成，但以下图片未能加载（刷新后旧图片引用会过期）：\n" + lines.join("\n") + "\n\n重新插入图片后再次导出即可还原。");
  }

  /* 整条背景（连续长图）：等比 cover、水平居中、顶对齐向下延展。 */
  function coverDownDraw(ctx, image, x, y, w, h) {
    if (!image || !w || !h) return;
    const scale = Math.max(w / image.width, h / image.height);
    ctx.drawImage(image, x + (w - image.width * scale) / 2, y, image.width * scale, image.height * scale);
  }

  async function drawPageToCanvas(page, opts) {
    const options = opts || {};
    const size = pageSize();
    U.clearWrapCache();
    const layout = await measurePageLayout(page, 0);
    const contentBottom = layout.reduce(function (max, item) { return Math.max(max, item.y + (item.h || 0)); }, 0);
    const height = Math.max(size.pageHeight, Math.ceil(contentBottom + 46));
    const canvas = document.createElement("canvas"); canvas.width = size.pageWidth; canvas.height = height; const ctx = canvas.getContext("2d");
    await readyFontForText(docFontFamily(), collectPageText(page));
    await readyFontsForPage(page);
    const silence = [];
    /* 图案背景（Task #18）：底色 + 图案整层绘制；场空间按设计页高，
       画布加高（内容溢出）时图案不漂移。 */
    const paramBgRef = docBackgroundOf(page) || docBackgroundOf(state.doc);
    if (options.forStrip) {
      if (page.backgroundColor) { ctx.fillStyle = page.backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      if (!paramBgRef && page.backgroundImage && page.backgroundImage.url) {
        const pageBg = await loadImage(page.backgroundImage);
        if (pageBg) coverDraw(ctx, pageBg, 0, 0, canvas.width, canvas.height);
        else silence.push({ type: "page-background", module: "本屏背景", page: (state.doc.pages || []).indexOf(page) + 1 });
      }
    } else {
      ctx.fillStyle = effectiveBackgroundColor(page); ctx.fillRect(0, 0, canvas.width, canvas.height);
      const bgRef = backgroundPatternActive(page) ? null : (page.backgroundImage || state.doc.backgroundImage);
      const background = await loadImage(bgRef);
      if (background) coverDraw(ctx, background, 0, 0, canvas.width, canvas.height);
      else if (imageSrc(bgRef)) silence.push({ type: page.backgroundImage ? "page-background" : "doc-background", module: page.backgroundImage ? "本屏背景" : "整条背景" });
    }
    if (paramBgRef && BG()) {
      try {
        /* 图案背景的 params.bg 即最终底色（冲突消解规则），不再被 backgroundColor 覆写 */
        const bgParams = Object.assign({}, paramBgRef.params);
        BG().renderToCanvas(bgParams, { canvas: canvas, width: canvas.width, height: canvas.height, fieldHeight: size.pageHeight });
      } catch (error) { /* 引擎异常按原底色继续 */ }
    }
    pageBgColorForHoles = effectiveBackgroundColor(page);
    const pst = artTheme();
    if (pst.pattern && pst.pattern !== "none") drawPatternOverlay(ctx, canvas.width, canvas.height, pst);
    silence.push.apply(silence, await drawModuleStack(ctx, page, 0, layout));
    return { canvas: canvas, layout: layout, silence: silence, contentHeight: height };
  }

  global.BannerBuilderRender = {
    setState: setState,
    setContext: setContext,

    // Canvas image helpers（渲染 + 导出共用）
    loadImage: loadImage,
    coverDraw: coverDraw,
    containDraw: containDraw,
    coverDownDraw: coverDownDraw,
    artImageRatio: artImageRatio,
    artImageHeight: artImageHeight,

    // 主题/排版辅助（DOM 预览也调用，通过 main 里包装转发）
    artTheme: artTheme,
    artInk: artInk,
    artMuted: artMuted,
    artLineHeight: artLineHeight,
    artWeight: artWeight,
    artAdjustedWeight: artAdjustedWeight,
    artTypeScale: artTypeScale,
    artSize: artSize,
    artFontRaw: artFontRaw,
    artFont: artFont,
    typeLevelKeyFor: typeLevelKeyFor,

    // 卡片样式辅助（DOM 预览也调用）
    styleCardPad: styleCardPad,
    cardRadius: cardRadius,
    cardRadiusDom: cardRadiusDom,
    cardBaseFill: cardBaseFill,
    cardFillStyle: cardFillStyle,
    roundRectPath: roundRectPath,
    chipPath: chipPath,
    px2: px2,

    // U 桥接包装
    alphaColor: alphaColor,
    hexToRgba: hexToRgba,
    capText: capText,
    ratioNumber: ratioNumber,
    // wrapLines 内部通过 U.wrapLines 直调，不导出

    // Canvas 绘制原语
    noisePattern: noisePattern,
    drawPatternOverlay: drawPatternOverlay,
    drawCardBase: drawCardBase,
    drawCardBorder: drawCardBorder,
    drawCardDecor: drawCardDecor,
    drawRich: drawRich,
    textBlockInfo: textBlockInfo,
    paintUpText: paintUpText,
    drawChips: drawChips,
    chipRowCount: chipRowCount,
    drawDividerShape: drawDividerShape,
    drawLine: drawLine,
    drawGradientOverlay: drawGradientOverlay,

    // 板块绘制
    paintCover: paintCover,
    paintAnnouncement: paintAnnouncement,
    paintQrGridPx: paintQrGridPx,
    paintTicket: paintTicket,
    paintMaterials: paintMaterials,
    paintCrossPromo: paintCrossPromo,
    paintSchedule: paintSchedule,
    paintVenue: paintVenue,
    paintRoute: paintRoute,
    paintProgram: paintProgram,
    paintPerformer: paintPerformer,
    paintBooth: paintBooth,
    paintDivider: paintDivider,
    paintFooter: paintFooter,
    paintFreeText: paintFreeText,
    paintFreeImage: paintFreeImage,
    paintModuleBody: paintModuleBody,
    paintModuleHead: paintModuleHead,

    // 布局与组装
    _renderScratch: _renderScratch,
    measureCardLayout: measureCardLayout,
    measurePageLayout: measurePageLayout,
    drawModuleCard: drawModuleCard,
    drawModuleStack: drawModuleStack,
    auditSilence: auditSilence,
    drawPageToCanvas: drawPageToCanvas,
  };
})(window);

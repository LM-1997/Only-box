/* ================================================================
   banner-builder-legacy-export.js  Stage 9：Legacy 导出回退管线
   从 js/banner-builder.js 拆出 PSD/PNG/长图的历史导出引擎，
   作为 BannerBuilderExport（DOM-serialize 新管线）的回退层。

   分层归属（零构建 IIFE，单一全局命名空间）：
   - 跨层依赖 C/R/M/F/U 从 global.BannerBuilder* 读取；
   - 主脚本私有辅助（activePage、downloadBlob、docBackgroundOf 等）
     在本模块内直接实现，state 通过 setState 注入，保持单一状态源；
   - 对外提供 BannerBuilderLegacy（导出 API）与 BannerBuilderLegacyExport（注入接口）。
   依赖：banner-builder-render.js / banner-builder-scene-model.js 先行加载。
   加载序：在 banner-builder.js 之前加载。
   ================================================================ */
(function (global) {
  "use strict";

  var C = global.BannerBuilderConstants;
  var R = global.BannerBuilderRegistry;
  var M = global.BannerBuilderModel;
  var F = global.BannerBuilderFont;
  var U = global.BannerBuilderUtils;

  var state = null;
  var ctx = {};

  function setState(s) { state = s; }
  function setContext(c) { ctx = c || {}; }

  /* ===== 模块私有辅助（从 banner-builder.js 复制，状态通过 setState 注入） ===== */

  function pageSize() { return C.pageSize(state.doc.ratio); }

  function artTheme() { return global.BannerBuilderRender.artTheme(); }

  function activePage() {
    return M.findPage(state.doc, state.activePageId) || state.doc.pages[state.doc.pages.length - 1];
  }
  function activePageIndex() { return state.doc.pages.indexOf(activePage()); }

  function downloadBlob(blob, name) { return U.downloadBlob(blob, name); }

  function auditSilence(rows, prefix) { return global.BannerBuilderRender.auditSilence(rows, prefix); }

  function imageSrc(value) { return value && value.url ? value.url : ""; }

  /* 背景辅助 */
  function BG() { return global.BannerBuilderBackgrounds; }

  function docBackgroundOf(target) {
    const bg = target && target.background;
    return (bg && bg.type === "parametric" && bg.params && typeof bg.params === "object") ? bg : null;
  }

  function parametricBackgroundColor(bgRecord) {
    const engine = BG();
    if (!engine || !bgRecord) return "";
    try { return engine.normalize(bgRecord.params).bg; } catch (error) { return ""; }
  }

  function effectiveBackgroundColor(page) {
    const target = page || state.doc;
    const paramBg = docBackgroundOf(target) || (target !== state.doc ? docBackgroundOf(state.doc) : null);
    if (paramBg) {
      const fromPattern = parametricBackgroundColor(paramBg);
      if (fromPattern) return fromPattern;
    }
    return (page && page.backgroundColor) || state.doc.backgroundColor || "#ffffff";
  }

  function readyFontForText(key, text) { return F.readyFontForText(key, text); }
  function docFontFamily() { return F.docFontFamily(); }
  function collectPageText(page) { return F.collectPageText(page); }

  /* 导出倍率（1x = 750 设计宽；默认 2x = 1500 高清） */
  function exportScale() { return Number(state.doc.exportScale) || 2; }

  /* ===== PSD 图层桥接函数 ===== */

  /* PSD 文字层字体名：标题层用标题字体，正文层用正文字体 */
  function psFontNameFor(scope) { return F.psFontNameFor(scope); }

  /* 圆角矩形 → PS 矢量蒙版 paths（8 锚点闭合子路径，贝塞尔圆角） */
  function psdRoundRect(x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    const k = radius * 0.5522847498;
    const knot = function (cbx, cby, ax, ay, cax, cay) { return { linked: true, points: [cbx, cby, ax, ay, cax, cay] }; };
    return [{ open: false, fillRule: "non-zero", knots: [
      knot(x, y + radius, x, y + radius, x, y + radius - k),
      knot(x + radius - k, y, x + radius, y, x + radius, y),
      knot(x + w - radius, y, x + w - radius, y, x + w - radius + k, y),
      knot(x + w, y + radius - k, x + w, y + radius, x + w, y + radius),
      knot(x + w, y + h - radius, x + w, y + h - radius, x + w, y + h - radius + k),
      knot(x + w - radius + k, y + h, x + w - radius, y + h, x + w - radius, y + h),
      knot(x + radius, y + h, x + radius, y + h, x + radius - k, y + h),
      knot(x, y + h - radius + k, x, y + h - radius, x, y + h - radius),
    ] }];
  }

  /* scene image → canvas（供 PSD 图片层使用） */
  function sceneImageToCanvas(imageRef, x, y, w, h, fit) {
    return global.BannerBuilderRender.loadImage(imageRef).then(function (img) {
      if (!img || !w || !h) return null;
      const c = document.createElement("canvas");
      c.width = pageSize().pageWidth; c.height = pageSize().pageHeight;
      const cx = c.getContext("2d");
      if (fit === "contain") global.BannerBuilderRender.containDraw(cx, img, x, y, w, h);
      else global.BannerBuilderRender.coverDraw(cx, img, x, y, w, h);
      return c;
    });
  }

  /* scene element → ag-psd layer；返回 null 表示跳过（image 走异步通道）。
     ctx：当前次导出的字体上下文（scene.fonts / 多字重族标记），由调用方传入——
     BB-R04：禁止模块级共享可变状态，并发导出时互不干扰。 */
  function sceneElementToPsdLayer(el, ctx) {
    if (el.kind === "shape") {
      return { name: el.name, vectorMask: { paths: psdRoundRect(el.x, el.y, el.w, el.h, el.radius), invert: false, notLink: false, disable: false }, vectorFill: { type: "color", color: { r: el.fill.r, g: el.fill.g, b: el.fill.b } } };
    }
    if (el.kind === "text") {
      return { name: el.name, text: { text: el.text, transform: [1, 0, 0, 1, el.x, el.y], style: { font: { name: sceneFontPsWithWeight(el, ctx) }, fontSize: el.size, fillColor: { r: el.color.r, g: el.color.g, b: el.color.b } }, paragraphStyle: { justification: el.align === "center" ? "center" : el.align === "right" ? "right" : "left" } } };
    }
    return null;
  }

  /* 文字层字体名：与预览同 family（去空格）；多字重族带 wght 后缀帮助 PS 选对档位 */
  function sceneFontPsWithWeight(el, ctx) {
    const fonts = (ctx && ctx.fonts) || [];
    const hit = fonts.filter(function (f) { return f.role === (el.scope === "body" ? "body" : "heading"); })[0] || fonts[0];
    const family = hit ? hit.psName : psFontNameFor(el.scope);
    const w = Number(el.weight) || 400;
    const multi = ctx && ctx.multiWeightFamilies && ctx.multiWeightFamilies.indexOf(family) >= 0;
    return multi && w !== 400 ? family + "-" + w + "wght" : family;
  }

  /* ===== Legacy 导出函数 ===== */

  var sceneCtx = null;

  async function legacyExportPng(allPages) {
    const pages = allPages ? state.doc.pages : [activePage()];
    const allSilence = [];
    const scale = exportScale();
    const pageNo = function (page) { return String(state.doc.pages.indexOf(page) + 1).padStart(2, "0"); };
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      const result = await global.BannerBuilderRender.drawPageToCanvas(page);
      const outCanvas = document.createElement("canvas");
      outCanvas.width = result.canvas.width * scale;
      outCanvas.height = result.canvas.height * scale;
      const outCtx = outCanvas.getContext("2d");
      outCtx.scale(scale, scale);
      outCtx.drawImage(result.canvas, 0, 0);
      await new Promise(function (resolve) {
        outCanvas.toBlob(function (blob) {
          if (blob) downloadBlob(blob, "only-box-banner-" + pageNo(page) + ".png");
          else if (global.alert) global.alert("导出失败：PNG 编码返回空（画布可能过大，请尝试减少板块内容）。");
          resolve();
        }, "image/png");
      });
      result.silence.forEach(function (row) { allSilence.push({ type: row.type, module: row.module, page: state.doc.pages.indexOf(page) + 1 }); });
      if (i < pages.length - 1) await new Promise(function (resolve) { setTimeout(resolve, 320); });
    }
    auditSilence(allSilence);
    return { pages: pages.length };
  }

  /* 连续长图：逐屏按实测高度渲染后纵向拼接；整条背景 cover 向下锚定跨屏连续。 */
  async function legacyExportStripPng() {
    const pages = state.doc.pages || []; if (!pages.length) return null;
    const size = pageSize(); const width = size.pageWidth;
    await readyFontForText(docFontFamily(), pages.map(collectPageText).join(" "));
    const rendered = [];
    let total = 0;
    for (let i = 0; i < pages.length; i += 1) {
      const one = await global.BannerBuilderRender.drawPageToCanvas(pages[i], { forStrip: true });
      rendered.push(one); total += one.canvas.height;
    }
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = total; const ctx = canvas.getContext("2d");
    ctx.fillStyle = state.doc.backgroundColor || "#ffffff"; ctx.fillRect(0, 0, width, total);
    const stripDocParamBg = docBackgroundOf(state.doc);
    const docImage = stripDocParamBg ? null : await global.BannerBuilderRender.loadImage(state.doc.backgroundImage);
    if (docImage) global.BannerBuilderRender.coverDownDraw(ctx, docImage, 0, 0, width, total);
    else if (!stripDocParamBg && imageSrc(state.doc.backgroundImage)) auditSilence([{ type: "doc-background", module: "整条背景" }], "连续长图 ");
    let y0 = 0; const silence = [];
    for (let i = 0; i < rendered.length; i += 1) {
      const h = rendered[i].canvas.height;
      ctx.save(); ctx.beginPath(); ctx.rect(0, y0, width, h); ctx.clip();
      ctx.drawImage(rendered[i].canvas, 0, y0);
      ctx.restore();
      rendered[i].silence.forEach(function (row) { silence.push({ page: i + 1, type: row.type, module: row.module }); });
      y0 += h;
    }
    auditSilence(silence);
    const scale = exportScale();
    const outCanvas = document.createElement("canvas");
    outCanvas.width = canvas.width * scale;
    outCanvas.height = canvas.height * scale;
    const outCtx = outCanvas.getContext("2d");
    outCtx.scale(scale, scale);
    outCtx.drawImage(canvas, 0, 0);
    outCanvas.toBlob(function (blob) { if (blob) downloadBlob(blob, "only-box-banner-continuous.png"); else if (global.alert) global.alert("长图导出失败：PNG 编码返回空（内容可能过大）。"); }, "image/png");
    return { width: outCanvas.width, height: outCanvas.height, pages: rendered.length, silence: silence.length };
  }

  async function legacyExportPsd(opts) {
    if (!global.agPsd || typeof global.agPsd.writePsd !== "function") { global.alert("PSD 引擎尚未加载，请刷新页面后重试。"); return null; }
    const page = activePage(); const size = pageSize();
    const full = await global.BannerBuilderRender.drawPageToCanvas(page);
    const layout = full.layout;
    const silence = full.silence || [];
    const pageHeight = full.canvas.height;
    const SM = global.BannerBuilderSceneModel;
    const scene = SM.buildScene({ page: page, layout: layout, doc: state.doc, pageHeight: pageHeight, pageSize: size, registry: R, theme: artTheme(), fonts: SM.fontsOf(state.doc) });
    sceneCtx = { fonts: scene.fonts, multiWeightFamilies: (scene.fonts || []).filter(function (f) { const meta = C.FONTS[f.key]; return meta && Array.isArray(meta.weights) && meta.weights.length > 1; }).map(function (f) { return f.psName; }) };
    const children = [];
    /* 背景层：铺页面底色 */
    children.push({ name: "背景底色", canvas: (function () {
      const c = document.createElement("canvas"); c.width = size.pageWidth; c.height = pageHeight;
      const cx = c.getContext("2d");
      cx.fillStyle = effectiveBackgroundColor(page);
      cx.fillRect(0, 0, c.width, c.height);
      return c;
    })() });

    /* 图案背景层 */
    const paramBgRef = docBackgroundOf(page) || docBackgroundOf(state.doc);
    if (paramBgRef && BG()) {
      try {
        const engine = BG();
        const bgParams = Object.assign({}, paramBgRef.params, {
          width: size.pageWidth, height: pageHeight, fieldHeight: size.pageHeight,
        });
        const vec = engine.sceneElements(bgParams);
        if (vec.kind === "vector" && vec.elements && vec.elements.length) {
          const group = { name: "背景图案 · 矢量（" + vec.count + " 单元）", children: [], opened: false };
          for (let vi = 0; vi < vec.elements.length; vi += 1) {
            const el = vec.elements[vi];
            const layer = sceneElementToPsdLayer(el, null);
            if (layer) group.children.push(layer);
          }
          if (group.children.length) children.push(group);
        } else {
          const rasterCanvas = engine.renderToCanvas(bgParams);
          children.push({ name: "背景图案 · 栅格（" + (vec.reason === "count" ? "单元过多" : "形状不支持矢量") + "）", canvas: rasterCanvas });
        }
      } catch (error) { /* 图案背景层失败不阻断导出 */ }
    }

    /* 每板块一组：scene module → ag-psd group */
    for (let idx = 0; idx < scene.modules.length; idx += 1) {
      const mod = scene.modules[idx];
      const group = { name: "板块 " + (idx + 1) + " · " + mod.label, children: [], opened: true };
      for (let ei = 0; ei < mod.elements.length; ei += 1) {
        const el = mod.elements[ei];
        if (el.kind === "image") {
          const layer = await sceneImageToCanvas(el.image, el.x, el.y, el.w, el.h, el.fit).then(function (canvas) {
            return canvas ? { name: el.name, canvas: canvas } : null;
          });
          if (layer) group.children.push(layer);
        } else {
          const layer = sceneElementToPsdLayer(el, sceneCtx);
          if (layer) group.children.push(layer);
        }
      }
      children.push(group);
    }
    if (opts && opts.childrenOnly) return { width: size.pageWidth, height: pageHeight, children: children, silence: silence };
    try {
      const buffer = global.agPsd.writePsd({ width: size.pageWidth, height: pageHeight, children: children }, { generateThumbnail: true });
      downloadBlob(new Blob([buffer], { type: "application/octet-stream" }), "only-box-banner-page-" + (activePageIndex() + 1) + ".psd");
      auditSilence(silence, "PSD 第 " + (activePageIndex() + 1) + " 屏 ");
      return { layers: children.length, silence: silence.length };
    } catch (error) { global.alert("PSD 导出失败：" + error.message); return null; }
  }

  /* ===== 对外命名空间 ===== */
  global.BannerBuilderLegacy = {
    exportPng: function (a) { return legacyExportPng(a); },
    exportStripPng: function () { return legacyExportStripPng(); },
    exportPsd: function () { return legacyExportPsd(); },
    buildPsdChildren: function () { return legacyExportPsd({ childrenOnly: true }); },
    measurePageLayout: function (page, offsetY) { return global.BannerBuilderRender.measurePageLayout(page, offsetY); },
    drawPageToCanvas: function (page, opts) { return global.BannerBuilderRender.drawPageToCanvas(page, opts); },
    activePage: function () { return activePage(); }
  };

  global.BannerBuilderLegacyExport = {
    setState: setState,
    setContext: setContext
  };
})(window);
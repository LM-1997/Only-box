(function (global) {
  "use strict";

  const C = global.BannerBuilderConstants;
  const R = global.BannerBuilderRegistry;
  const M = global.BannerBuilderModel;
  const MI = global.BannerBuilderModuleImporter;
  const U = global.BannerBuilderUtils;
  const F = global.BannerBuilderFont;
  const state = {
    doc: M.createDoc(C.DEFAULT_RATIO),
    activePageId: null,
    selectedModuleId: null,
    zoom: 0.46,
    /* BB-R18：用户手动调过缩放后为 true，自动适配不再抢占 */
    zoomManual: false,
    step: "theme-bg",
    sideView: "library",
    /* AI 整份生成的应用前内存快照：只存内存，不写 localStorage，不进入草稿文件；撤销一次后清空 */
    aiUndoSnapshot: null,
  };
  const els = {};
  let initialized = false;
  let framePending = false;
  function ensureFont(key) {
    return F.ensureFont(key);
  }

  function showFontFallbackNotice(family) {
    return F.showFontFallbackNotice(family);
  }

  async function readyFontForText(key, text) {
    return F.readyFontForText(key, text);
  }

  /* 导出字体门禁：标题/正文两种角色的 webfont 全部就绪（含中文分片按需命中）才开始导出。 */
  async function readyFontsForPage(page) {
    return F.readyFontsForPage(page);
  }

  /* 方案 §6.1：默认字体预载——消除首次点选字体的秒级等待（只预载默认 sans，不预载 43 款） */
  function preloadDefaultFont() {
    return F.preloadDefaultFont();
  }

  function collectPageText(page) {
    return F.collectPageText(page);
  }

  function docFontFamily() {
    return F.docFontFamily();
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function activePage() {
    return M.findPage(state.doc, state.activePageId) || state.doc.pages[state.doc.pages.length - 1];
  }

  function activePageIndex() {
    return state.doc.pages.indexOf(activePage());
  }

  function pageSize() {
    return C.pageSize(state.doc.ratio);
  }

  function continuousMode() {
    return (state.doc.screenMode || "split") === "continuous";
  }

  /* 主题变量内联写入（单一数据源 = C.THEMES）。
     旧实现依赖 [data-theme=...] CSS 规则，新增主题没写规则时会回落站点默认色（切主题失效）。
     现在所有主题一律走这里，CSS 规则保留仅为兜底。 */
  function applyThemeVars(rootEl) {
    if (!rootEl || !rootEl.style) return;
    const theme = artTheme();
    rootEl.style.setProperty("--ob-primary", theme.primary);
    rootEl.style.setProperty("--ob-primary-dark", theme.primaryDark);
    rootEl.style.setProperty("--ob-primary-soft", theme.primarySoft);
    rootEl.style.setProperty("--ob-accent", theme.accent);
    rootEl.style.setProperty("--ob-accent-soft", theme.accentSoft);
    rootEl.style.setProperty("--bb-line", theme.line);
    rootEl.style.setProperty("--bb-soft", theme.soft);
    rootEl.style.setProperty("--ob-ink", artInk());
    rootEl.style.setProperty("--ob-muted", artMuted());
    /* 排版变量：让 DOM 预览与 Canvas/PSD 导出同源，拖动排版微调时画布实时变化 */
    const num = function (v, fallback) { const n = Number(v); return (Number.isFinite(n) && n > 0) ? n : fallback; };
    rootEl.style.setProperty("--ob-ts", num(theme.typeScale, 1));
    rootEl.style.setProperty("--ob-h1s", num(theme.h1Scale, 1));
    rootEl.style.setProperty("--ob-h2s", num(theme.h2Scale, 1));
    rootEl.style.setProperty("--ob-h3s", num(theme.h3Scale, 1));
    rootEl.style.setProperty("--ob-bodys", num(theme.bodyScale, 1));
    rootEl.style.setProperty("--ob-caps", num(theme.captionScale, 1));
    rootEl.style.setProperty("--ob-lh", num(artLineHeight(), 1));
    rootEl.style.setProperty("--ob-ls", (Number(theme.letterSpacing) || 0) + "px");
    /* 字重偏置（与导出侧 artAdjustedWeight 同语义）：标题以 800、正文以 400 为基准的平移量 */
    const hwTarget = artWeight(Number(theme.headingWeight) != null ? Number(theme.headingWeight) : 800);
    const bwTarget = artWeight(Number(theme.bodyWeight) != null ? Number(theme.bodyWeight) : 400);
    rootEl.style.setProperty("--ob-hwo", hwTarget - 800);
    rootEl.style.setProperty("--ob-bwo", bwTarget - 400);
  }

  function docBackgroundStyle(value) {
    if (!value || !value.url) return "";
    return "linear-gradient(rgba(255,255,255,.18),rgba(255,255,255,.18)),url(\"" + value.url + "\")";
  }

  /* ===== 图案背景（Task #18）：三管线共用的渲染辅助 =====
     doc.background = { type:"parametric", params:{...}, presetId? }
     - DOM 预览：parametricBackgroundDataUrl() 生成 dataURL 缓存，作 backgroundImage 铺底；
     - PNG/PSD/PDF：drawPageToCanvas / legacyExportPsd / scene-model 消费同一引擎；
     - 旧文档（无 background 字段）零影响，backgroundColor/backgroundImage/pattern 语义保留。 */
  const BG = function () { return global.BannerBuilderBackgrounds; };

  function docBackgroundOf(target) {
    const bg = target && target.background;
    return (bg && bg.type === "parametric" && bg.params && typeof bg.params === "object") ? bg : null;
  }

  /* 图案背景 → dataURL（带缓存；参数指纹变化才重算）。width/height 按目标尺寸覆写。 */
  const _bgRenderCache = { key: "", url: "" };
  function parametricBackgroundDataUrl(bgRecord, width, height) {
    const engine = BG();
    if (!engine || !bgRecord) return "";
    const params = Object.assign({}, bgRecord.params, { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) });
    const key = JSON.stringify(params);
    if (_bgRenderCache.key === key) return _bgRenderCache.url;
    try {
      const canvas = engine.renderToCanvas(params);
      const url = canvas.toDataURL("image/png");
      _bgRenderCache.key = key; _bgRenderCache.url = url;
      return url;
    } catch (error) { return ""; }
  }
  function invalidateBackgroundRenderCache() { _bgRenderCache.key = ""; _bgRenderCache.url = ""; }

  /* 图案背景的底色（params.bg）：DOM/导出在无图案时也用它铺底 */
  function parametricBackgroundColor(bgRecord) {
    const engine = BG();
    if (!engine || !bgRecord) return "";
    try { return engine.normalize(bgRecord.params).bg; } catch (error) { return ""; }
  }

  /* ===== 背景冲突消解（图案背景 vs 底色/底图）=====
     规则：图案背景（doc.background）激活时，其 params.bg 即最终底色——
     底色字段（backgroundColor）仅作为图案底色的初始值与移除图案后的回退；
     底图（backgroundImage）在图案背景激活期间被忽略（图案自带底色铺底）。
     各管线（DOM/PNG/PSD/长图）统一走 effectiveBackgroundColor()，不再各自为政。 */
  function effectiveBackgroundColor(page) {
    const target = page || state.doc;
    const paramBg = docBackgroundOf(target) || (target !== state.doc ? docBackgroundOf(state.doc) : null);
    if (paramBg) {
      const fromPattern = parametricBackgroundColor(paramBg);
      if (fromPattern) return fromPattern;
    }
    return (page && page.backgroundColor) || state.doc.backgroundColor || "#ffffff";
  }
  function backgroundPatternActive(page) {
    const target = page || state.doc;
    return !!(docBackgroundOf(target) || (target !== state.doc ? docBackgroundOf(state.doc) : null));
  }

  /* ===== 主题跟随背景（Task #15）：切换主题时，未锁定颜色的背景预设重新取主题色 =====
     themeLocked = true 表示用户在「微调背景图案」里显式改过 fg/bg，此后不再跟随主题；
     未锁定 + 预设 colorMode 为 theme → 换主题即用新主题的 soft/primary 重新着色。 */
  function rethemeParametricBackground() {
    const engine = BG();
    const bg = docBackgroundOf(state.doc);
    if (!engine || !bg || bg.themeLocked === true) return;
    const preset = engine.presetById(bg.presetId);
    if (!preset || preset.colorMode !== "theme") return;
    const st = artTheme();
    const colored = engine.applyThemeColors(bg.params, st);
    /* 保留用户已调过的非颜色参数，仅换 fg/bg */
    bg.params.fg = colored.fg;
    bg.params.bg = colored.bg;
    /* 底色跟随主题时同步整条底色（冲突消解：移除图案后的回退色与所见一致） */
    if (colored.bg) state.doc.backgroundColor = colored.bg;
  }


  function imageSrc(value) {
    return value && value.url ? value.url : "";
  }

  function dataImageFit(data) {
    return data && data.imageFit === "contain" ? "contain" : "cover";
  }

  /* 主题字段拼进 class 名前的清理：枚举外/含空格的值回退默认，防 DOMException 与 class 语义破坏 */
  function safeClassSuffix(value, fallback) {
    return U.safeClassSuffix(value, fallback);
  }

  /* ===== Blob URL 生命周期管理 =====
     图片记录使用 blob: URL；被替换/删除的旧图需要释放，否则长会话内存持续增长。
     但撤销快照（aiUndoSnapshot）与草稿恢复流程仍可能引用旧 URL，直接 revoke 会让
     撤销后的图片失效。保护集合 = 当前文档 + 撤销快照中的全部 blob URL；
     释放前先刷新保护集合，凡被引用的一律不释放。 */
  const protectedBlobUrls = new Set();
  function collectBlobUrls(value, set) {
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i += 1) collectBlobUrls(value[i], set); return; }
    if (!value || typeof value !== "object") return;
    if (typeof value.url === "string" && value.url.indexOf("blob:") === 0) set.add(value.url);
    Object.keys(value).forEach(function (key) { collectBlobUrls(value[key], set); });
  }
  function refreshProtectedBlobUrls() {
    protectedBlobUrls.clear();
    collectBlobUrls(state.doc, protectedBlobUrls);
    if (state.aiUndoSnapshot) collectBlobUrls(state.aiUndoSnapshot, protectedBlobUrls);
  }
  function revokeBlobUrl(url) {
    try { URL.revokeObjectURL(url); } catch (error) { /* ignore */ }
  }
  function releaseImageRecord(value) {
    if (!value || typeof value !== "object" || typeof value.url !== "string") return;
    if (value.url.indexOf("blob:") !== 0) return;
    if (protectedBlobUrls.has(value.url)) return;
    revokeBlobUrl(value.url);
  }
  /* 替换/清除图片记录：先更新文档，再刷新保护集合，最后释放不再被引用的旧记录 */
  function replaceImageRecord(holder, key, next) {
    const old = holder ? holder[key] : null;
    if (holder) holder[key] = next;
    refreshProtectedBlobUrls();
    releaseImageRecord(old);
  }
  /* 整份文档被替换时（AI 生成/草稿恢复/撤销）：释放旧文档独占的 blob URL */
  function releaseDocBlobs(oldDoc) {
    if (!oldDoc) return;
    const urls = new Set();
    collectBlobUrls(oldDoc, urls);
    refreshProtectedBlobUrls();
    urls.forEach(function (url) { if (!protectedBlobUrls.has(url)) revokeBlobUrl(url); });
  }

  function hexToRgba(value, alpha) {
    return U.hexToRgba(value, alpha);
  }

  /* ===== 图片裁剪 / 表单字段构件已迁至 banner-builder-ui.js =====
     由 BannerBuilderUi 提供（buildField / buildFontSelectField / imageField 等），
     init 中注入 setContext 后使用。 */

  function text(value, fallback) { return String(value || fallback || ""); }
  function moduleTitle(module, def) { return module.data.sectionTitle || def.label; }

  function visualImage(src, cls, alt) {
    if (!src) return null;
    const img = el("img", cls || "bb-art-image"); img.src = src; img.alt = alt || ""; return img;
  }

  /* 板块图片大小统一读取：data[key] 未设置（undefined/null/空）→ 返回 0 表示「走模板默认」，
     渲染端各自按历史公式取默认；设置 → clamp 到 [min,max] 并按 step 收敛。
     与 PNG 导出（paint*）、场景模型（scene-model）三处同源。 */
  function imageSizeOf(data, key, min, max, step) {
    const raw = data[key];
    if (raw == null || raw === "" || !Number.isFinite(Number(raw))) return 0;
    const st = Number(step) > 0 ? Number(step) : 1;
    let v = Math.round(Number(raw) / st) * st;
    v = Math.min(max, Math.max(min, v));
    return v;
  }


  /* ===== Stage 10 包装转发 —— WYSIWYG DOM 预览已搬至 js/banner-builder-preview.js ===== */
  function renderCanvas() { return BannerBuilderPreview.renderCanvas(); }

  function renderToolbar() {
    const size = pageSize(); if (els.sizeReadout) els.sizeReadout.textContent = size.pageWidth + " × " + size.pageHeight + " px";
    if (els.ratioGroup) Array.prototype.forEach.call(els.ratioGroup.querySelectorAll("[data-ratio]"), function (button) { const active = button.dataset.ratio === state.doc.ratio; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", active ? "true" : "false"); });
    els.zoomValue.textContent = Math.round(state.zoom * 100) + "%"; els.stats.textContent = state.doc.pages.length + " 屏 · " + M.countModules(state.doc) + " 个板块";
    if (els.screenModeGroup) Array.prototype.forEach.call(els.screenModeGroup.querySelectorAll("[data-screen]"), function (button) { const active = button.dataset.screen === (state.doc.screenMode || "split"); button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", active ? "true" : "false"); });
    const scale = Number(state.doc.exportScale) || 2;
    if (els.exportScaleGroup) Array.prototype.forEach.call(els.exportScaleGroup.querySelectorAll("[data-scale]"), function (button) { const active = Number(button.dataset.scale) === scale; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", active ? "true" : "false"); });
    if (els.exportSizeReadout) els.exportSizeReadout.textContent = (size.pageWidth * scale) + " × " + (size.pageHeight * scale) + " px";
    syncStep();
  }

  /* ===== 三步向导：同步步骤条、对应工具栏显隐、工作区库栏显隐、属性面板 ===== */
  function syncStep() {
    /* AI 撤销条属于编辑/设置流程提示，导出步骤隐藏以减少干扰 */
    const undoBar = document.getElementById("bb-ai-undo-bar");
    if (undoBar) undoBar.style.display = state.step === "export" ? "none" : "";
    if (!els.stepBar) return;
    Array.prototype.forEach.call(els.stepBar.querySelectorAll(".bb-step"), function (button) {
      const active = button.dataset.step === state.step;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    ["theme-bg", "setup", "edit", "export"].forEach(function (key) {
      const bar = els.stepToolbars[key];
      if (bar) bar.hidden = key !== state.step;
    });
    /* 左侧栏三步均保留：导出前常需要回查板块内容，不再隐藏 */
    if (els.workbench) els.workbench.classList.remove("hide-library");
  }

  function renderLibrary() {
    els.libraryList.textContent = ""; const frag = document.createDocumentFragment();
    R.MODULE_ORDER.forEach(function (type) { const button = el("button", "bb-lib-item"); button.type = "button"; button.dataset.action = "lib-add"; button.dataset.type = type; button.appendChild(el("span", "bb-lib-text", R.getDef(type).label)); button.appendChild(el("span", "bb-lib-plus", "+")); frag.appendChild(button); });
    if (MI) {
      MI.loadAll().forEach(function (record) {
        const button = el("button", "bb-lib-item bb-lib-custom"); button.type = "button"; button.dataset.action = "lib-add-custom"; button.dataset.customId = record.id;
        button.appendChild(el("span", "bb-lib-text", "★ " + record.label)); button.appendChild(el("span", "bb-lib-plus", "+"));
        if (record.description) button.title = record.description;
        /* BB-R23：自定义模块删除能力接入——持久化失败明确报错，不伪成功 */
        const rm = el("span", "bb-mytpl-del", "×"); rm.title = "删除此自定义模块（不影响已放进画布的板块）";
        rm.addEventListener("click", function (event) {
          event.stopPropagation();
          if (!global.confirm("删除自定义模块「" + record.label + "」？已放进画布的板块不受影响。")) return;
          try {
            const removed = MI.remove(record.id);
            if (removed === false) { if (global.alert) global.alert("未找到该模块（可能已被删除），列表将刷新。"); }
            renderLibrary();
          } catch (error) {
            if (global.alert) global.alert("模块删除失败（浏览器本地存储写入失败，未删除）：" + ((error && error.message) || error));
          }
        });
        button.appendChild(rm);
        frag.appendChild(button);
      });
    }
    els.libraryList.appendChild(frag); els.libraryHint.textContent = "点击板块，添加到第 " + (activePageIndex() + 1) + " 屏";
  }

  /* ===== 左侧图层视图：屏 → 板块 层级树，支持选中/上下移/删除，方便选中与排序 ===== */
  function renderLayerTree() {
    const tree = els.layerTree; if (!tree) return;
    tree.textContent = ""; const frag = document.createDocumentFragment();
    state.doc.pages.forEach(function (page, pIndex) {
      const pageCard = el("div", "bb-layer-page" + (page.id === state.activePageId ? " is-active" : ""));
      const head = el("div", "bb-layer-page-head");
      head.dataset.action = "layer-page-pick"; head.dataset.pageId = page.id;
      head.title = "选中第 " + (pIndex + 1) + " 屏";
      /* BB-R19：键盘可访问——页面头可 Tab 聚焦，Enter/Space 选中 */
      head.tabIndex = 0;
      head.setAttribute("role", "button");
      head.setAttribute("aria-current", page.id === state.activePageId ? "true" : "false");
      head.appendChild(el("span", "bb-layer-page-name", "第 " + (pIndex + 1) + " 屏"));
      head.appendChild(el("span", "bb-layer-page-count", page.modules.length + " 个板块"));
      const del = el("button", "bb-layer-page-del", "×"); del.type = "button"; del.title = "删除本屏"; del.dataset.action = "layer-page-del"; del.dataset.pageId = page.id;
      head.appendChild(del); pageCard.appendChild(head);
      const list = el("div", "bb-layer-modules");
      list.dataset.dropTarget = "page"; list.dataset.pageId = page.id;
      if (!page.modules.length) list.appendChild(el("div", "bb-layer-empty", "暂无板块，切换左侧「板块库」添加"));
      else page.modules.forEach(function (module, mIndex) {
        const def = R.getDef(module.type);
        const row = el("div", "bb-layer-module" + (module.id === state.selectedModuleId ? " is-active" : ""));
        row.dataset.action = "layer-module-pick"; row.dataset.moduleId = module.id; row.dataset.pageId = page.id;
        row.title = "选中编辑：第 " + (pIndex + 1) + " 屏 · " + moduleTitle(module, def) + "（可拖拽跨屏移动；聚焦后可用 ↑↓ 排序、PageUp/PageDown 跨屏移动）";
        row.draggable = true;
        row.dataset.dragModule = module.id;
        /* BB-R19：键盘可访问——模块行可 Tab 聚焦，Enter/Space 选中，
           ↑/↓ 上移/下移，PageUp/PageDown 移至上一屏/下一屏（拖拽的键盘替代） */
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.setAttribute("aria-selected", module.id === state.selectedModuleId ? "true" : "false");
        row.appendChild(el("span", "bb-layer-module-no", "0" + (mIndex + 1)));
        row.appendChild(el("span", "bb-layer-module-name", moduleTitle(module, def)));
        const ops = el("div", "bb-layer-module-ops");
        const up = el("button", null, "↑"); up.type = "button"; up.title = "上移"; up.disabled = mIndex === 0; up.dataset.action = "layer-module-up"; up.dataset.moduleId = module.id;
        const down = el("button", null, "↓"); down.type = "button"; down.title = "下移"; down.disabled = mIndex === page.modules.length - 1; down.dataset.action = "layer-module-down"; down.dataset.moduleId = module.id;
        const rm = el("button", "danger", "×"); rm.type = "button"; rm.title = "删除板块"; rm.dataset.action = "layer-module-del"; rm.dataset.moduleId = module.id;
        ops.appendChild(up); ops.appendChild(down); ops.appendChild(rm); row.appendChild(ops); list.appendChild(row);
      });
      pageCard.appendChild(list); frag.appendChild(pageCard);
    });
    tree.appendChild(frag);
  }

  /* ===== 左侧栏：板块库 / 图层 双视图显隐与标签高亮 ===== */
  function syncSideTabs() {
    if (!els.sideTabs) return;
    Array.prototype.forEach.call(els.sideTabs.querySelectorAll("[data-side]"), function (button) {
      const active = button.dataset.side === state.sideView;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (els.libraryPane) els.libraryPane.hidden = state.sideView !== "library";
    if (els.layerPane) els.layerPane.hidden = state.sideView !== "layers";
  }

  /* ===== 我的模板（IndexedDB 本地持久化）===== */
  async function renderMyTemplates() {
    els.myTplArea.hidden = true; els.myTplList.textContent = "";
    if (!global.BannerBuilderMyTemplates || !global.BannerBuilderMyTemplates.isAvailable()) return;
    let rows;
    try { rows = await global.BannerBuilderMyTemplates.listTemplates(); } catch (error) { return; }
    if (!rows || !rows.length) return;
    els.myTplArea.hidden = false; els.myTplCount.textContent = rows.length + " 个";
    rows.forEach(function (row) {
      const def = R.getDef(row.type) || R.getDef(migrateLegacyModuleType(row.type, row.data));
      /* BB-R19：我的模板条目键盘可访问（Tab 聚焦 + Enter/Space 添加） */
      const item = el("div", "bb-lib-item bb-mytpl-item"); item.dataset.action = "tpl-add"; item.dataset.tplId = row.id; item.title = "点击把整个板块（含文字与图片）加入当前屏";
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.appendChild(el("span", "bb-lib-text", "★ " + row.name));
      item.appendChild(el("span", "bb-mytpl-type", def ? def.label : row.type));
      const del = el("button", "bb-mytpl-del", "×"); del.type = "button"; del.title = "删除此模板"; del.dataset.action = "tpl-del"; del.dataset.tplId = row.id;
      item.appendChild(del); els.myTplList.appendChild(item);
    });
  }

  async function saveSelectedModuleAsTemplate() {
    const hit = M.findModule(state.doc, state.selectedModuleId);
    if (!hit.module || !global.BannerBuilderMyTemplates) return;
    const def = R.getDef(hit.module.type);
    const suggested = def.label + " 模板";
    let name = suggested;
    if (global.prompt) { const raw = global.prompt("给我的模板起个名字（留空用默认）", suggested); if (raw === null) return; name = (raw || "").trim() || suggested; }
    try {
      const data = await global.BannerBuilderMyTemplates.snapshotData(hit.module.data);
      await global.BannerBuilderMyTemplates.saveTemplate({ id: C.uid(), type: hit.module.type, name: name, createdAt: Date.now(), data: data });
      renderMyTemplates();
    } catch (error) { if (global.alert) global.alert("模板保存失败（浏览器可能不支持本地存储）：" + ((error && error.message) || error)); }
  }

  function addCustomModuleToPage(customId) {
    if (!MI) return;
    const record = MI.loadAll().filter(function (item) { return item.id === customId; })[0];
    if (!record) return;
    const module = M.addModule(state.doc, activePage().id, migrateLegacyModuleType(record.type, record.data));
    if (!module) return;
    module.data = Object.assign({}, module.data, JSON.parse(JSON.stringify(record.data || {})));
    migrateModuleData(module);
    afterAddModule(module);
  }

  /* 添加板块后统一刷新：立即选中并展示编辑字段——
     用户加板块的下一步就是填内容，无论当前处于哪个步骤。 */
  function afterAddModule(module) {
    state.selectedModuleId = module.id;
    renderAll();
    if (continuousMode()) scrollSelectedIntoView();
  }

  function showModuleImportModal() {
    if (!MI) return;
    const existing = document.getElementById("bb-module-modal"); if (existing) existing.remove();
    const mask = document.createElement("div"); mask.className = "bb-modal-mask"; mask.id = "bb-module-modal";
    const modal = document.createElement("div"); modal.className = "bb-modal";
    const title = document.createElement("h3"); title.textContent = "导入板块模块"; title.id = "bb-module-modal-title"; modal.appendChild(title);
    /* BB-R20：弹窗焦点管理 */
    const closeA11y = openModalA11y(mask, modal, { titleId: "bb-module-modal-title" });
    const intro = document.createElement("p"); intro.textContent = "复制提示词给其他 AI，让 AI 输出 JSON；导入后会出现在板块库的自定义模块区域。"; modal.appendChild(intro);
    const promptArea = document.createElement("textarea"); promptArea.className = "bb-input bb-modal-textarea"; promptArea.readOnly = true; promptArea.value = MI.promptText; modal.appendChild(promptArea);
    const inputArea = document.createElement("textarea"); inputArea.className = "bb-input bb-modal-textarea"; inputArea.placeholder = "把 AI 返回的 JSON 粘贴到这里"; modal.appendChild(inputArea);
    const msg = document.createElement("div"); modal.appendChild(msg);
    const actions = document.createElement("div"); actions.className = "bb-modal-actions";
    const copyBtn = document.createElement("button"); copyBtn.className = "bb-btn ghost"; copyBtn.type = "button"; copyBtn.textContent = "复制提示词";
    copyBtn.addEventListener("click", function () { copyTextToClipboard(promptArea.value).then(function (ok) { msg.className = ok ? "bb-modal-success" : "bb-modal-error"; msg.textContent = ok ? "提示词已复制" : "自动复制失败，请手动复制上方提示词"; }); });
    const importBtn = document.createElement("button"); importBtn.className = "bb-btn primary"; importBtn.type = "button"; importBtn.textContent = "导入模块";
    importBtn.addEventListener("click", function () { const obj = MI.extractJson(inputArea.value); if (!obj) { msg.className = "bb-modal-error"; msg.textContent = "JSON 格式解析失败"; return; } const errors = MI.validate(obj); if (errors.length) { msg.className = "bb-modal-error"; msg.textContent = "校验不通过：" + errors.join("；"); return; } try { MI.add(obj); renderLibrary(); msg.className = "bb-modal-success"; msg.textContent = "板块模块「" + obj.label + "」已导入"; } catch (error) { msg.className = "bb-modal-error"; msg.textContent = "保存失败：" + error.message; } });
    const closeBtn = document.createElement("button"); closeBtn.className = "bb-btn ghost"; closeBtn.type = "button"; closeBtn.textContent = "关闭"; closeBtn.addEventListener("click", function () { closeA11y(); mask.remove(); });
    actions.appendChild(copyBtn); actions.appendChild(importBtn); actions.appendChild(closeBtn); modal.appendChild(actions); mask.appendChild(modal); document.body.appendChild(mask);
    mask.addEventListener("click", function (e) { if (e.target === mask) { closeA11y(); mask.remove(); } });
  }

  /* ===== AI 生成整份长条 =====
     流程：复制提示词 → 用户在外部 AI 中附上活动资料（可选参考图）→ 粘贴 JSON →
     BannerBuilderAiDocument 解析/校验/规范化/构造候选文档 → 原子替换 state.doc → 一次撤销。
     全程无网络请求；粘贴内容只存在弹窗内存中，关闭即丢弃。 */

  /* 通用复制 helper：优先 navigator.clipboard，失败回退隐藏 textarea + execCommand；
     返回 Promise<boolean>，绝不吞掉失败。 */
  function legacyCopyText(text) {
    return U.legacyCopyText(text);
  }
  function copyTextToClipboard(text) {
    return U.copyTextToClipboard(text);
  }

  function ensureDocFonts(doc) {
    return F.ensureDocFonts(doc);
  }

  function removeAiUndoNotice() {
    const bar = document.getElementById("bb-ai-undo-bar");
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }
  function showAiUndoNotice(pages, modules, emptyPages) {
    removeAiUndoNotice();
    const bar = el("div");
    bar.id = "bb-ai-undo-bar";
    bar.setAttribute("role", "status");
    bar.style.cssText = "width:min(var(--ob-content),calc(100% - 40px));margin:10px auto 0;padding:9px 13px;border:1px solid var(--bb-line);border-radius:9px;background:var(--ob-primary-soft);color:var(--ob-primary-dark);font-size:12px;font-weight:700;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap";
    let text = "已生成 " + pages + " 屏、" + modules + " 个板块，已进入编辑步骤。";
    if (Array.isArray(emptyPages) && emptyPages.length) {
      text += " 注意：第 " + emptyPages.join("、") + " 屏还没有板块内容，可回编辑步骤补充或删除空屏。";
    }
    bar.appendChild(el("span", null, text));
    const undoBtn = el("button", "bb-btn ghost", "撤销本次生成");
    undoBtn.type = "button";
    undoBtn.title = "恢复到 AI 生成前的内容；生成之后的手动修改也会一并丢弃";
    undoBtn.addEventListener("click", undoAiGeneration);
    bar.appendChild(undoBtn);
    const shell = document.querySelector(".bb-shell");
    if (shell && shell.parentNode) shell.parentNode.insertBefore(bar, shell);
  }
  function isRestorableDoc(doc) {
    return !!doc && typeof doc === "object" && Array.isArray(doc.pages) && doc.pages.length > 0 && !!doc.pages[0] && !!doc.pages[0].id;
  }
  function undoAiGeneration() {
    const snapshot = state.aiUndoSnapshot;
    removeAiUndoNotice();
    state.aiUndoSnapshot = null;
    if (!isRestorableDoc(snapshot)) { renderAll(); return; }
    state.doc = snapshot;
    state.activePageId = snapshot.pages[0].id;
    state.selectedModuleId = null;
    ensureDocFonts(state.doc);
    refreshProtectedBlobUrls();
    renderAll();
  }

  function formatAiProblem(outcome) {
    if (outcome.phase === "parse") return outcome.message || "JSON 解析失败";
    if (outcome.phase === "build") return "候选文档构造失败：" + (outcome.message || "");
    if (Array.isArray(outcome.errors) && outcome.errors.length) {
      const AD = global.BannerBuilderAiDocument;
      const limit = (AD && AD.LIMITS && AD.LIMITS.maxShownErrors) || 50;
      const lines = outcome.errors.slice(0, limit).map(function (item) { return (item.path ? item.path + "：" : "") + item.message; });
      if (outcome.errors.length > limit) lines.push("……其余 " + (outcome.errors.length - limit) + " 处问题未展示，请修正后重新校验。");
      let text = "发现 " + outcome.errors.length + " 处问题：\n" + lines.join("\n");
      if (outcome.errors.some(function (item) { return item.code === "theme_not_allowed" || item.code === "theme_required"; })) {
        text += "\n\n提示：「同时生成主题」勾选状态可能与复制提示词时不一致，请按当前勾选状态重新复制提示词后再粘贴。";
      }
      return text;
    }
    return "校验未通过，请检查粘贴内容。";
  }

  /* 会话内记住上次选择的活动类型（仅内存，不写 localStorage，刷新重置） */
  let aiModalEventType = "mixed";

  function aiPromptContext(includeTheme, eventType) {
    const themeStyle = (C.themeStyleForDoc ? C.themeStyleForDoc(state.doc) : C.themeStyle(state.doc.theme)) || {};
    return {
      ratio: state.doc.ratio,
      screenMode: state.doc.screenMode || "split",
      themeId: state.doc.theme,
      themeLabel: themeStyle.label || state.doc.theme,
      fontFamily: state.doc.fontFamily || "sans",
      headingFont: state.doc.headingFont || "",
      bodyFont: state.doc.bodyFont || "",
      includeTheme: !!includeTheme,
      eventType: eventType || "mixed",
    };
  }

  /* 应用入口：纯数据层完成解析→校验→规范化→候选构造（失败绝不触碰 state），
     通过可注入 replace/render 钩子原子替换并渲染，渲染失败回滚快照。 */
  function applyAiDocumentFromText(rawText, includeTheme, hooks) {
    const AD = global.BannerBuilderAiDocument;
    if (!AD) return;
    const prev = { activePageId: state.activePageId, selectedModuleId: state.selectedModuleId, step: state.step, sideView: state.sideView };
    const outcome = AD.applyPipeline(rawText, {
      includeTheme: includeTheme,
      currentDoc: state.doc,
      replace: function (doc, undoSnapshot) {
        const oldDoc = state.doc;
        state.doc = doc;
        state.activePageId = doc.pages[0].id;
        state.selectedModuleId = null;
        state.step = "edit";
        state.sideView = "layers";
        ensureDocFonts(doc);
        /* 先让撤销快照接管 blob 保护，再释放旧文档独占的图片，撤销恢复不丢图 */
        if (undoSnapshot) state.aiUndoSnapshot = undoSnapshot;
        refreshProtectedBlobUrls();
        releaseDocBlobs(oldDoc);
      },
      render: renderAllStrict,
    });
    if (!outcome.ok) {
      if (outcome.phase === "render") {
        state.activePageId = prev.activePageId;
        state.selectedModuleId = prev.selectedModuleId;
        state.step = prev.step;
        state.sideView = prev.sideView;
        state.aiUndoSnapshot = null;
        refreshProtectedBlobUrls();
        renderAll();
        hooks.show("error", "应用失败，已恢复原内容：" + (outcome.message || "渲染异常"));
        return;
      }
      hooks.show("error", formatAiProblem(outcome));
      return;
    }
    hooks.close();
    const emptyPages = outcome.doc.pages
      .map(function (page, index) { return (page.modules || []).length ? 0 : index + 1; })
      .filter(function (n) { return n; });
    showAiUndoNotice(outcome.stats.pages, outcome.stats.modules, emptyPages);
  }

  function showAiDocumentModal() {
    const AD = global.BannerBuilderAiDocument;
    if (!AD) return;
    const existing = document.getElementById("bb-ai-doc-modal");
    if (existing) existing.parentNode.removeChild(existing);

    const mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-ai-doc-modal";
    const modal = document.createElement("div");
    modal.className = "bb-modal";

    modal.appendChild(el("h3", null, "AI 生成整份长条"));
    modal.appendChild(el("p", null, "复制提示词，与您的活动资料一起发给常用 AI；如果使用支持看图的 AI，也可以同时附上参考图片。再把 AI 返回的 JSON 粘贴回来。"));
    modal.appendChild(el("p", null, "隐私说明：Only-box 不连接 AI 服务，不读取外部对话，不上传活动资料或参考图片；粘贴内容不会被保存。"));

    const eventRow = el("div");
    eventRow.style.cssText = "display:flex;align-items:center;gap:8px;margin:12px 0 0";
    const eventLabel = el("label", "bb-field-label", "活动类型");
    eventLabel.htmlFor = "bb-ai-event-type";
    eventLabel.style.cssText = "flex:0 0 auto;margin:0";
    const eventTypeSelect = el("select", "bb-input");
    eventTypeSelect.id = "bb-ai-event-type";
    eventTypeSelect.style.cssText = "width:auto;min-height:28px;padding:0 6px;font-size:11px;font-weight:700";
    [["mixed", "综合活动（演出 + 摊位等多种形式）"], ["live", "Live 演出活动"], ["booth", "摊位活动（市集 / Only 展销）"]].forEach(function (pair) {
      const option = el("option", null, pair[1]);
      option.value = pair[0];
      eventTypeSelect.appendChild(option);
    });
    eventRow.appendChild(eventLabel);
    eventRow.appendChild(eventTypeSelect);
    modal.appendChild(eventRow);

    const themeCheckLabel = el("label");
    themeCheckLabel.style.cssText = "display:flex;align-items:center;gap:7px;margin:10px 0 0;font-size:12px;font-weight:750;color:var(--ob-ink);cursor:pointer";
    const themeCheck = document.createElement("input");
    themeCheck.type = "checkbox";
    themeCheck.id = "bb-ai-include-theme";
    themeCheck.style.accentColor = "var(--ob-primary)";
    themeCheckLabel.appendChild(themeCheck);
    themeCheckLabel.appendChild(document.createTextNode("同时生成主题"));
    modal.appendChild(themeCheckLabel);
    modal.appendChild(el("p", null, "勾选后 AI 会额外输出当前主题的配色与风格微调参数，并可从背景预设目录中选择整条图案背景（适合支持看图的 AI 配合参考图使用）；默认不勾选，沿用当前主题与已有微调。"));

    const promptHead = el("div");
    promptHead.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:14px 0 5px";
    const promptLabel = el("label", "bb-field-label", "提示词（只读，复制后与活动资料一起发给 AI）");
    promptLabel.htmlFor = "bb-ai-prompt";
    promptLabel.style.margin = "0";
    const promptCount = el("span", "bb-count", "");
    promptHead.appendChild(promptLabel);
    promptHead.appendChild(promptCount);
    modal.appendChild(promptHead);
    const promptArea = document.createElement("textarea");
    promptArea.className = "bb-input bb-modal-textarea";
    promptArea.id = "bb-ai-prompt";
    promptArea.readOnly = true;
    promptArea.style.minHeight = "180px";
    modal.appendChild(promptArea);
    function rebuildPrompt() {
      promptArea.value = AD.buildPrompt(aiPromptContext(themeCheck.checked, eventTypeSelect.value));
      promptCount.textContent = promptArea.value.length + " 字符";
    }
    rebuildPrompt();
    eventTypeSelect.value = ["mixed", "live", "booth"].indexOf(aiModalEventType) >= 0 ? aiModalEventType : "mixed";
    themeCheck.addEventListener("change", function () { rebuildPrompt(); schedulePreflight(); });
    eventTypeSelect.addEventListener("change", function () { aiModalEventType = eventTypeSelect.value; rebuildPrompt(); });

    const copyRow = el("div", "bb-modal-actions");
    copyRow.style.marginTop = "10px";
    const copyBtn = el("button", "bb-btn primary", "复制提示词");
    copyBtn.type = "button";
    const copyMsg = el("span");
    copyMsg.style.cssText = "align-self:center;font-size:11px;font-weight:700;color:var(--ob-muted)";
    copyBtn.addEventListener("click", function () {
      copyBtn.disabled = true;
      copyTextToClipboard(promptArea.value).then(function (ok) {
        copyBtn.disabled = false;
        copyMsg.textContent = ok ? "已复制，请粘贴到外部 AI 对话中并附上活动资料" : "自动复制失败，请点击上方文本框全选手动复制";
        if (ok) setTimeout(function () { if (copyMsg.textContent.indexOf("已复制") === 0) copyMsg.textContent = ""; }, 6000);
      });
    });
    copyRow.appendChild(copyBtn);
    copyRow.appendChild(copyMsg);
    modal.appendChild(copyRow);

    const resultLabel = el("label", "bb-field-label", "AI 返回的 JSON（整份长条）");
    resultLabel.htmlFor = "bb-ai-result";
    resultLabel.style.cssText = "display:block;margin:14px 0 5px";
    modal.appendChild(resultLabel);
    const resultArea = document.createElement("textarea");
    resultArea.className = "bb-input bb-modal-textarea";
    resultArea.id = "bb-ai-result";
    resultArea.placeholder = "把 AI 返回的 JSON 粘贴到这里（支持带 Markdown 代码块围栏）";
    resultArea.style.minHeight = "150px";
    modal.appendChild(resultArea);

    /* 粘贴预检：输入停顿后做只读解析+校验，提前反馈屏数/板块数或问题数量（正式校验仍由「校验并应用」执行） */
    const preflight = el("div");
    preflight.id = "bb-ai-preflight";
    preflight.style.cssText = "display:none;margin:8px 0 0;font-size:11px;font-weight:700;line-height:1.6";
    modal.appendChild(preflight);
    let preflightTimer = null;
    function runPreflight() {
      const AD = global.BannerBuilderAiDocument;
      if (!AD) return;
      const text = resultArea.value;
      if (!text.trim()) { preflight.style.display = "none"; preflight.textContent = ""; return; }
      const parsed = AD.extractJson(text);
      if (!parsed.ok) {
        preflight.style.display = "block";
        preflight.style.color = "#b54a35";
        preflight.textContent = "预检：还不是合法 JSON —— " + parsed.message + "。可在与 AI 的对话中要求它重新输出：只输出纯 JSON，不带注释、解释文字和尾逗号。";
        return;
      }
      const check = AD.validate(parsed.value, { includeTheme: themeCheck.checked });
      if (!check.valid) {
        preflight.style.display = "block";
        preflight.style.color = "#b54a35";
        preflight.textContent = "预检发现 " + check.errors.length + " 处问题，点击「校验并应用」查看具体路径与原因。";
        return;
      }
      let moduleCount = 0;
      const typeCounts = {};
      parsed.value.pages.forEach(function (page) {
        (page.modules || []).forEach(function (module) {
          moduleCount += 1;
          const label = R.typeLabel(module.type);
          typeCounts[label] = (typeCounts[label] || 0) + 1;
        });
      });
      const breakdown = Object.keys(typeCounts).map(function (label) { return label + "×" + typeCounts[label]; }).join("、");
      preflight.style.display = "block";
      preflight.style.color = "var(--ob-primary-dark)";
      preflight.textContent = "预检通过：" + parsed.value.pages.length + " 屏、" + moduleCount + " 个板块（" + breakdown + "），点击「校验并应用」生效。";
    }
    function schedulePreflight() {
      if (preflightTimer) clearTimeout(preflightTimer);
      preflightTimer = setTimeout(function () { preflightTimer = null; runPreflight(); }, 250);
    }
    resultArea.addEventListener("input", schedulePreflight);

    const msg = el("div");
    msg.setAttribute("aria-live", "polite");
    msg.style.cssText = "display:none;margin:10px 0 0;padding:9px 12px;border-radius:9px;font-size:11px;font-weight:700;white-space:pre-wrap;max-height:240px;overflow:auto";
    modal.appendChild(msg);
    function showMsg(type, text) {
      msg.style.display = "block";
      msg.className = type === "error" ? "bb-modal-error" : "bb-modal-success";
      msg.textContent = text;
      msg.scrollTop = 0;
    }

    function closeAiDocumentModal() {
      document.removeEventListener("keydown", onKeydown, true);
      if (preflightTimer) { clearTimeout(preflightTimer); preflightTimer = null; }
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      const opener = els.generateAiDocumentBtn;
      if (opener && typeof opener.focus === "function") { try { opener.focus(); } catch (e) { /* ignore */ } }
    }
    function onKeydown(event) {
      if (event.key === "Escape") { event.stopPropagation(); closeAiDocumentModal(); }
    }
    mask.addEventListener("click", function (event) {
      if (event.target !== mask) return;
      if (resultArea.value.trim() && !global.confirm("有未应用的 AI 结果，确定关闭吗？")) return;
      closeAiDocumentModal();
    });

    const actionRow = el("div", "bb-modal-actions");
    const applyBtn = el("button", "bb-btn primary", "校验并应用");
    applyBtn.type = "button";
    applyBtn.addEventListener("click", function () {
      showMsg("success", "正在解析与校验…");
      const includeTheme = themeCheck.checked;
      applyBtn.disabled = true;
      setTimeout(function () {
        try {
          applyAiDocumentFromText(resultArea.value, includeTheme, { show: showMsg, close: closeAiDocumentModal });
        } finally { applyBtn.disabled = false; }
      }, 30);
    });
    const closeBtn = el("button", "bb-btn ghost", "关闭");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", closeAiDocumentModal);
    actionRow.appendChild(applyBtn);
    actionRow.appendChild(closeBtn);
    modal.appendChild(actionRow);

    mask.appendChild(modal);
    document.body.appendChild(mask);
    document.addEventListener("keydown", onKeydown, true);
    try { copyBtn.focus(); } catch (e) { /* ignore */ }
  }

  async function addTemplateToPage(tplId) {
    if (!global.BannerBuilderMyTemplates) return;
    let rows = [];
    try { rows = await global.BannerBuilderMyTemplates.listTemplates(); } catch (error) { return; }
    const row = rows.filter(function (record) { return record.id === tplId; })[0];
    if (!row) { renderMyTemplates(); return; }
    const module = M.addModule(state.doc, activePage().id, migrateLegacyModuleType(row.type, row.data));
    if (!module) return;
    module.data = Object.assign({}, module.data, global.BannerBuilderMyTemplates.cloneTemplateData(row.data));
    migrateModuleData(module);
    afterAddModule(module);
  }

  function deleteMyTemplate(tplId) {
    if (!global.BannerBuilderMyTemplates) return;
    if (!global.confirm("删除这个「我的模板」？不会影响已放进画布的板块。")) return;
    global.BannerBuilderMyTemplates.removeTemplate(tplId).then(renderMyTemplates, function () {});
  }

  /* ===== 右侧属性面板：上下文驱动 =====
     无选中（setup 步骤）→ 文档设置（主题/字体/背景/比例/屏幕模式）
     无选中（edit 步骤）→ 当前屏设置 + 文档设置入口
     选中板块 → 板块编辑
     export 步骤 → 导出面板（buildExportPanel） */
  /* ===== 第 0 步「主题与背景」面板：可视化主题选择 + 背景预设库（Task #15/#16） =====
     - 主题：色卡网格直接点选（19 内置 + 用户导入主题），切换逻辑与文档设置面板下拉一致（字体跟随规则）；
     - 背景：16 个图案预设缩略图（主题取色预设随当前主题实时换色）+ 纯色/无背景；
     - 选中预设写入 doc.background（type:"parametric"），三管线（DOM/PNG/PSD-PDF）自动消费；
     - 空文档时画布显示 throwaway 预览（buildPage 空屏提示已有），真实文档直接预览真实内容。 */
  function buildThemeBgPanel() {
    const wrap = el("div");
    wrap.appendChild(el("div", "bb-panel-divider", "主题配色"));
    wrap.appendChild(buildThemeCardGrid());

    wrap.appendChild(el("div", "bb-panel-divider", "整条背景"));
    wrap.appendChild(buildBackgroundPresetGrid());
    return wrap;
  }

  /* 主题色卡网格：每张卡显示主题 5 色条 + 名称，点选即切换（含 AI 导入的自定义主题） */
  function buildThemeCardGrid() {
    const wrap = el("div", "bb-tbg-theme-grid");
    const themeImporter = global.BannerBuilderThemeImporter;
    const options = C.getThemeOptions();
    options.forEach(function (option) {
      const st = C.themeStyle(option.value);
      const isCustom = themeImporter && themeImporter.isCustom(option.value);
      const card = el("button", "bb-tbg-theme-card" + (option.value === state.doc.theme ? " is-active" : ""));
      card.type = "button";
      card.title = (isCustom ? "已导入主题 · " : "") + (st.label || option.label);
      card.setAttribute("aria-pressed", option.value === state.doc.theme ? "true" : "false");
      const swatch = el("span", "bb-tbg-theme-swatch");
      [st.primary, st.primaryDark, st.primarySoft, st.accent, st.soft].forEach(function (color, i) {
        const chip = el("span", "bb-tbg-theme-chip");
        chip.style.background = /^#[0-9a-f]{6}$/i.test(String(color)) ? color : "#ffffff";
        if (i === 0) chip.classList.add("is-primary");
        swatch.appendChild(chip);
      });
      card.appendChild(swatch);
      card.appendChild(el("span", "bb-tbg-theme-name", (isCustom ? "★ " : "") + option.label));
      card.addEventListener("click", function () { applyThemeChoice(option.value); });
      wrap.appendChild(card);
    });
    return wrap;
  }

  /* 主题切换统一入口：与文档设置面板下拉完全同语义（字体跟随 + themeDefinition 清理） */
  function applyThemeChoice(themeId) {
    if (themeId === state.doc.theme) return;
    const prev = state.doc.theme;
    state.doc.theme = themeId;
    state.doc.themeDefinition = null;
    const nextSt = C.themeStyle(themeId);
    const prevSt = C.themeStyle(prev);
    if (state.doc.fontManual === true) {
      if (prevSt.headingFont && state.doc.headingFont === prevSt.headingFont) state.doc.headingFont = nextSt.headingFont || "";
      if (prevSt.bodyFont && state.doc.bodyFont === prevSt.bodyFont) state.doc.bodyFont = nextSt.bodyFont || "";
    } else {
      state.doc.headingFont = nextSt.headingFont || "";
      state.doc.bodyFont = nextSt.bodyFont || "";
    }
    if (state.doc.headingFont) ensureFont(state.doc.headingFont);
    if (state.doc.bodyFont) ensureFont(state.doc.bodyFont);
    rethemeParametricBackground();
    invalidateBackgroundRenderCache();
    renderAll();
  }

  /* 背景预设网格：无背景 / 纯色 / 16 个图案预设（canvas 缩略图实时渲染，主题取色预设跟随当前主题） */
  function buildBackgroundPresetGrid() {
    const wrap = el("div");
    const engine = BG();
    const docBg = docBackgroundOf(state.doc);

    /* 当前背景状态行 */
    const status = el("p", "bb-tbg-bg-status");
    if (docBg) {
      const preset = engine && engine.presetById(docBg.presetId);
      status.textContent = "当前背景：" + (preset ? preset.label : "自定义图案");
    } else if (state.doc.backgroundImage && state.doc.backgroundImage.url) {
      status.textContent = "当前背景：自定义底图（在编辑步骤可调整）";
    } else {
      status.textContent = "当前背景：纯色 " + (state.doc.backgroundColor || "#ffffff");
    }
    wrap.appendChild(status);

    const grid = el("div", "bb-tbg-bg-grid");
    const size = pageSize();

    /* 无背景（清除图案背景与底图，回退底色） */
    grid.appendChild(buildBgPresetCard("none", "无背景", "纯色底", null, !docBg && !(state.doc.backgroundImage && state.doc.backgroundImage.url)));

    /* 图案预设 */
    if (engine) {
      engine.PRESETS.forEach(function (preset) {
        const active = !!(docBg && docBg.presetId === preset.id);
        grid.appendChild(buildBgPresetCard(preset.id, preset.label, preset.hint, preset, active));
      });
    }
    wrap.appendChild(grid);

    /* 预设参数微调入口（选中图案背景后可用） */
    const tuneRow = el("div", "bb-field");
    const tuneBtn = el("button", "bb-btn ghost", "微调背景图案");
    tuneBtn.type = "button";
    tuneBtn.style.cssText = "width:100%";
    tuneBtn.disabled = !docBg;
    if (!docBg) tuneBtn.title = "先从上方选择一个图案背景，再微调参数";
    else tuneBtn.title = "调整图案的密度、尺寸、透明度、颜色与形状";
    tuneBtn.addEventListener("click", function () { if (docBackgroundOf(state.doc)) BannerBuilderModals.showBackgroundTweakModal(); });
    tuneRow.appendChild(tuneBtn);
    wrap.appendChild(tuneRow);

    /* 缩略图渲染：预设 → 小 canvas（延迟到插入 DOM 后批量执行，避免阻塞面板构建） */
    requestAnimationFrame(function () { renderBgPresetThumbnails(grid, size); });
    return wrap;
  }

  /* 单个背景预设卡片（缩略图占位 + 文案），data-preset-id 供批量渲染定位 */
  function buildBgPresetCard(presetId, label, hint, preset, active) {
    const card = el("button", "bb-tbg-bg-card" + (active ? " is-active" : ""));
    card.type = "button";
    card.dataset.presetId = presetId;
    card.setAttribute("aria-pressed", active ? "true" : "false");
    const thumb = el("span", "bb-tbg-bg-thumb");
    const canvas = document.createElement("canvas");
    canvas.width = 132; canvas.height = 176;
    thumb.appendChild(canvas);
    card.appendChild(thumb);
    const meta = el("span", "bb-tbg-bg-meta");
    meta.appendChild(el("strong", null, label));
    meta.appendChild(el("small", null, hint));
    card.appendChild(meta);
    card.addEventListener("click", function () { applyBackgroundPreset(presetId, preset); });
    return card;
  }

  /* 网格内全部缩略图 canvas 渲染（一次 rAF 批处理；主题取色预设用当前主题实时配色） */
  function renderBgPresetThumbnails(grid, size) {
    const engine = BG();
    if (!engine) return;
    const st = artTheme();
    const cards = grid.querySelectorAll(".bb-tbg-bg-card[data-preset-id]");
    Array.prototype.forEach.call(cards, function (card) {
      const presetId = card.dataset.presetId;
      const canvas = card.querySelector("canvas");
      if (!canvas) return;
      if (presetId === "none") {
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = state.doc.backgroundColor || "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = "rgba(0,0,0,.08)";
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(4.5, 4.5, canvas.width - 9, canvas.height - 9);
        return;
      }
      const preset = engine.presetById(presetId);
      if (!preset) return;
      try {
        const params = engine.presetToParams(preset, st, {
          width: canvas.width,
          height: canvas.height,
          fieldHeight: canvas.height,
          fieldWidth: canvas.width,
        });
        engine.renderToCanvas(params, { canvas: canvas, width: canvas.width, height: canvas.height });
      } catch (error) { /* 单个缩略图失败不阻塞其余 */ }
    });
  }

  /* 背景预设应用：none 清除；preset 写入 doc.background（type:"parametric"，带 presetId） */
  function applyBackgroundPreset(presetId, preset) {
    const engine = BG();
    if (presetId === "none" || !preset || !engine) {
      state.doc.background = null;
      state.doc.backgroundImage = null;
      invalidateBackgroundRenderCache();
      renderAll();
      return;
    }
    const st = artTheme();
    const size = pageSize();
    const params = engine.presetToParams(preset, st, {
      width: size.pageWidth,
      height: size.pageHeight,
      fieldHeight: size.pageHeight,
      fieldWidth: size.pageWidth,
    });
    state.doc.background = { type: "parametric", params: params, presetId: preset.id };
    /* 冲突消解：图案底色同步写回整条底色，保证移除图案后回退色与所见一致 */
    if (params.bg) state.doc.backgroundColor = params.bg;
    invalidateBackgroundRenderCache();
    renderAll();
  }

  function buildDocSettingsPanel() {
    const wrap = el("div");
    wrap.appendChild(el("div", "bb-panel-divider", "文档设置"));
    wrap.appendChild(BannerBuilderUi.buildField({ key: "name", label: "草稿名称", type: "text" }, state.doc));
    /* 画布比例（与顶部工具栏同一数据源，双入口同步） */
    const ratioRow = el("div", "bb-field");
    ratioRow.appendChild(el("label", "bb-field-label", "画布比例"));
    const ratioSeg = el("div", "bb-seg");
    ratioSeg.style.cssText = "display:flex;width:100%";
    R.RATIO_OPTIONS.forEach(function (option) {
      const b = el("button", "bb-ratio-btn");
      b.type = "button";
      b.style.flex = "1";
      const dims = String(option.value).split(":");
      const box = el("span", "bb-ratio-box");
      box.style.setProperty("--bb-ratio-w", dims[0]);
      box.style.setProperty("--bb-ratio-h", dims[1]);
      b.appendChild(box);
      b.appendChild(document.createTextNode(option.label));
      if (option.value === state.doc.ratio) { b.classList.add("is-active"); b.setAttribute("aria-pressed", "true"); } else b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { state.doc.ratio = option.value; renderAll(); });
      ratioSeg.appendChild(b);
    });
    ratioRow.appendChild(ratioSeg);
    wrap.appendChild(ratioRow);
    /* 屏幕衔接 */
    const screenRow = el("div", "bb-field");
    screenRow.appendChild(el("label", "bb-field-label", "屏幕衔接"));
    const screenSeg = el("div", "bb-seg");
    screenSeg.style.cssText = "display:flex;width:100%";
    [["split", "分屏"], ["continuous", "连续"]].forEach(function (pair) {
      const b = el("button", null, pair[1]);
      b.type = "button";
      b.style.flex = "1";
      if ((state.doc.screenMode || "split") === pair[0]) { b.classList.add("is-active"); b.setAttribute("aria-pressed", "true"); } else b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { state.doc.screenMode = pair[0]; renderAll(); });
      screenSeg.appendChild(b);
    });
    screenRow.appendChild(screenSeg);
    wrap.appendChild(screenRow);
    /* 主题 */
    wrap.appendChild(el("div", "bb-panel-divider", "主题与排版"));
    const themeRow = el("div", "bb-field");
    themeRow.appendChild(el("label", "bb-field-label", "主题配色"));
    const themeSel = el("select", "bb-input");
    const themeOpts = C.getThemeOptions();
    const themeImporter = global.BannerBuilderThemeImporter;
    themeOpts.forEach(function (o) {
      const option = el("option", null, (themeImporter && themeImporter.isCustom(o.value) ? "★ " : "") + o.label);
      option.value = o.value;
      themeSel.appendChild(option);
    });
    themeSel.value = themeOpts.some(function (o) { return o.value === state.doc.theme; }) ? state.doc.theme : (themeOpts[0] ? themeOpts[0].value : "forest");
    themeSel.addEventListener("change", function () {
      const prev = state.doc.theme;
      state.doc.theme = this.value;
      state.doc.themeDefinition = null;
      const nextSt = C.themeStyle(state.doc.theme);
      const prevSt = C.themeStyle(prev);
      if (state.doc.fontManual === true) {
        if (prevSt.headingFont && state.doc.headingFont === prevSt.headingFont) state.doc.headingFont = nextSt.headingFont || "";
        if (prevSt.bodyFont && state.doc.bodyFont === prevSt.bodyFont) state.doc.bodyFont = nextSt.bodyFont || "";
      } else {
        state.doc.headingFont = nextSt.headingFont || "";
        state.doc.bodyFont = nextSt.bodyFont || "";
      }
      if (state.doc.headingFont) ensureFont(state.doc.headingFont);
      if (state.doc.bodyFont) ensureFont(state.doc.bodyFont);
      rethemeParametricBackground();
      invalidateBackgroundRenderCache();
      renderAll();
    });
    themeRow.appendChild(themeSel);
    wrap.appendChild(themeRow);
    const tweakRow = el("div", "bb-field");
    tweakRow.style.cssText = "display:flex;gap:6px";
    const tweakBtn = el("button", "bb-btn ghost", "微调主题");
    tweakBtn.type = "button";
    tweakBtn.style.flex = "1";
    tweakBtn.title = "在预设主题基础上手动微调 7 项颜色与 8 项风格";
    tweakBtn.addEventListener("click", BannerBuilderModals.showThemeTweakModal);
    tweakRow.appendChild(tweakBtn);
    const typeBtn = el("button", "bb-btn ghost", "排版微调");
    typeBtn.type = "button";
    typeBtn.style.flex = "1";
    typeBtn.title = "手动微调字号缩放、字重、行距、字距与文字颜色";
    typeBtn.addEventListener("click", BannerBuilderModals.showTypeTweakModal);
    tweakRow.appendChild(typeBtn);
    wrap.appendChild(tweakRow);
    /* 字体 */
    wrap.appendChild(el("div", "bb-panel-divider", "字体"));
    const fontWrap = el("div");
    fontWrap.appendChild(BannerBuilderUi.buildFontSelectField("全局字体（标题正文未单独设置时生效）", C.getFontOptions(), state.doc.fontFamily || "sans", function (value) { state.doc.fontFamily = value || "sans"; state.doc.fontManual = true; ensureFont(state.doc.fontFamily); renderAll(); }, "跟随主题推荐"));
    fontWrap.appendChild(BannerBuilderUi.buildFontSelectField("标题字体（主标题/板块标题）", C.getFontOptions(), state.doc.headingFont || "", function (value) { state.doc.headingFont = value; state.doc.fontManual = true; if (value) ensureFont(value); renderAll(); }, "跟随全局字体"));
    fontWrap.appendChild(BannerBuilderUi.buildFontSelectField("正文字体（正文/说明/图注）", C.getFontOptions(), state.doc.bodyFont || "", function (value) { state.doc.bodyFont = value; state.doc.fontManual = true; if (value) ensureFont(value); renderAll(); }, "跟随标题字体"));
    const importFontBtn = el("button", "bb-btn ghost", "导入本地字体");
    importFontBtn.type = "button";
    importFontBtn.style.cssText = "width:100%;margin-bottom:12px";
    importFontBtn.title = "导入本地字体文件（.ttf/.otf/.woff/.woff2），导入后可在字体下拉中选用";
    importFontBtn.addEventListener("click", BannerBuilderModals.showFontImportModal);
    fontWrap.appendChild(importFontBtn);
    wrap.appendChild(fontWrap);
    /* 背景 */
    wrap.appendChild(el("div", "bb-panel-divider", "整条背景"));
    /* 图案背景：状态 + 快捷操作（完整预设库在第 0 步） */
    const paramBg = docBackgroundOf(state.doc);
    const bgQuick = el("div", "bb-field");
    if (paramBg) {
      const engine = BG();
      const preset = engine && engine.presetById(paramBg.presetId);
      bgQuick.appendChild(el("label", "bb-field-label", "图案背景：" + (preset ? preset.label : "自定义图案")));
      const bgBtnRow = el("div");
      bgBtnRow.style.cssText = "display:flex;gap:6px";
      const tweakBgBtn = el("button", "bb-btn ghost", "微调图案");
      tweakBgBtn.type = "button";
      tweakBgBtn.style.flex = "1";
      tweakBgBtn.addEventListener("click", BannerBuilderModals.showBackgroundTweakModal);
      bgBtnRow.appendChild(tweakBgBtn);
      const clearBgBtn = el("button", "bb-btn ghost", "移除");
      clearBgBtn.type = "button";
      clearBgBtn.title = "移除图案背景，回退到底色/底图";
      clearBgBtn.addEventListener("click", function () {
        state.doc.background = null;
        invalidateBackgroundRenderCache();
        renderAll();
      });
      bgBtnRow.appendChild(clearBgBtn);
      bgQuick.appendChild(bgBtnRow);
    } else {
      bgQuick.appendChild(el("label", "bb-field-label", "图案背景：无（可到第 0 步选预设）"));
      const goStep0Btn = el("button", "bb-btn ghost", "去第 0 步选背景");
      goStep0Btn.type = "button";
      goStep0Btn.style.cssText = "width:100%";
      goStep0Btn.addEventListener("click", function () {
        state.step = "theme-bg";
        state.selectedModuleId = null;
        state.sideView = "library";
        renderAll();
      });
      bgQuick.appendChild(goStep0Btn);
    }
    wrap.appendChild(bgQuick);
    /* 图案背景激活时底色/底图由图案承载，禁用两个控件并说明（冲突消解规则的可视化） */
    const patternActive = !!paramBg;
    const baseColorField = BannerBuilderUi.buildField({ key: "backgroundColor", label: "整条底色", type: "color", fallback: "#ffffff" }, state.doc);
    const baseImageField = BannerBuilderUi.buildField({ key: "backgroundImage", label: "整条底图", type: "image" }, state.doc);
    if (patternActive) {
      [baseColorField, baseImageField].forEach(function (fieldWrap) {
        fieldWrap.style.opacity = ".45";
        fieldWrap.title = "当前已启用图案背景，底色/底图由图案承载；移除图案后可编辑";
        fieldWrap.querySelectorAll("input,button,select").forEach(function (ctrl) { ctrl.disabled = true; });
      });
      const hint = el("p", "bb-hint", "图案背景启用中：底色与底图暂不生效（移除图案后恢复）");
      wrap.appendChild(hint);
    }
    wrap.appendChild(baseColorField);
    wrap.appendChild(baseImageField);
    return wrap;
  }

  function buildSurfacePanel() {
    const wrap = el("div");
    /* edit 步骤：先显示当前屏设置，文档设置折叠在下方 */
    const page = activePage();
    if (page) {
      wrap.appendChild(el("div", "bb-panel-divider", "当前第 " + (activePageIndex() + 1) + " 屏"));
      wrap.appendChild(BannerBuilderUi.buildField({ key: "backgroundColor", label: "本屏底色", type: "color", fallback: state.doc.backgroundColor || "#ffffff", optional: true }, page));
      wrap.appendChild(BannerBuilderUi.buildField({ key: "backgroundImage", label: "本屏底图", type: "image" }, page));
    }
    wrap.appendChild(buildDocSettingsPanel());
    return wrap;
  }

  function renderPanel() {
    els.panelBody.textContent = "";
    if (state.step === "theme-bg") { els.panelTitle.textContent = "主题与背景"; els.panelSub.textContent = "先定基调：主题配色 + 图案背景，画布实时预览"; els.panelBody.appendChild(buildThemeBgPanel()); return; }
    if (state.step === "export") { els.panelTitle.textContent = "导出与备份"; els.panelSub.textContent = "选择输出方式，导出高清图片或可编辑文件"; els.panelBody.appendChild(buildExportPanel()); return; }
    const hit = M.findModule(state.doc, state.selectedModuleId);
    if (!hit.module) {
      if (state.step === "setup") { els.panelTitle.textContent = "文档设置"; els.panelSub.textContent = "主题 · 字体 · 背景 · 画布，从左侧添加板块开始制作"; els.panelBody.appendChild(buildDocSettingsPanel()); return; }
      els.panelTitle.textContent = "整条 / 当前屏"; els.panelSub.textContent = "点板块编辑内容 · 点空白选中该屏 · 下方可调文档设置"; els.panelBody.appendChild(buildSurfacePanel()); return;
    }
    const def = R.getDef(hit.module.type); els.panelTitle.textContent = def.label; els.panelSub.textContent = "第 " + (hit.pageIndex + 1) + " 屏 · 可编辑文字、图片与版式";
    const saveRow = el("div", "bb-field"); const saveBtn = el("button", "bb-file-btn", "☆ 存为我的模板"); saveBtn.type = "button"; saveBtn.dataset.action = "save-tpl"; saveBtn.title = "把当前这整个板块（含文字、配色、图片与版式）存成「我的模板」，浏览器本地保存，刷新后仍在"; saveRow.appendChild(saveBtn); els.panelBody.appendChild(saveRow);
    (def.fields || []).forEach(function (field) { els.panelBody.appendChild(BannerBuilderUi.buildField(field, hit.module.data, hit.module.type, hit.module.data)); });
  }

  /* ===== 第三步导出面板（右侧属性栏），与顶部导出按钮共用同一批导出函数 ===== */
  function buildExportPanel() {
    const wrap = el("div", "bb-export-panel");
    const size = pageSize();
    const scale = Number(state.doc.exportScale) || 2;
    const hint = el("p", "bb-export-hint");
    hint.innerHTML = "";
    hint.appendChild(document.createTextNode("当前输出倍率 " + scale + "x，单屏导出为 " + (size.pageWidth * scale) + " × " + (size.pageHeight * scale) + " 像素。倍率越高越清晰、文件越大。"));
    wrap.appendChild(hint);

    const main = el("div", "bb-export-main");
    function btn(cls, label, sub, handler, primary) {
      const b = el("button", cls + (primary ? " primary" : ""), label);
      b.type = "button";
      if (sub) b.appendChild(el("small", null, sub));
      b.addEventListener("click", function () { handler(); });
      main.appendChild(b);
    }
    main.appendChild(el("div", "bb-panel-divider", "图片导出"));
    btn("bb-export-btn", "导出当前屏", "PNG · " + (size.pageWidth * scale) + "×" + (size.pageHeight * scale), function () {
      runExclusiveExport("导出当前屏 PNG", function () { return exportPng(false); }).catch(function (error) { showExportError("导出当前屏 PNG", error); });
    }, true);
    btn("bb-export-btn", "导出全部屏", "多屏逐个下载 PNG", function () {
      runExclusiveExport("导出全部屏 PNG", function () { return exportPng(true); }).catch(function (error) { showExportError("导出全部屏 PNG", error); });
    });
    btn("bb-export-btn", "导出连续长图", "全部屏拼成一张 PNG（需连续模式）", function () {
      runExclusiveExport("导出连续长图", function () { return exportStripPng(); }).catch(function (error) { showExportError("导出连续长图", error); });
    });
    main.appendChild(el("div", "bb-panel-divider", "可编辑文件"));
    btn("bb-export-btn", "导出 PSD", "分层可编辑（勾选顶部「打包字体」一并导出字体）", function () {
      runExclusiveExport("导出 PSD", function () {
        return exportPsd().then(function (result) {
          if (result && els.packFontsToggle && els.packFontsToggle.checked) {
            return packFontsZip();
          }
          return result;
        });
      }).catch(function (error) { showExportError("导出 PSD", error); });
    });
    btn("bb-export-btn", "导出 PDF（PDF/A-3b）", "Illustrator 可编辑：字体完整嵌入 + 板块图层（首次使用需下载字体，耗时较长）", function () {
      runExclusiveExport("导出 PDF", function () { return exportPdf(); }).catch(function (error) { showExportError("导出 PDF", error); });
    });
    main.appendChild(el("div", "bb-panel-divider", "草稿"));
    btn("bb-export-btn", "备份草稿", "含图片，跨会话不丢", saveDraft);
    wrap.appendChild(main);
    return wrap;
  }

  /* ===== 统一导出入口（BB-R04 / BB-R16）=====
     互斥锁：同一时刻只允许一个导出任务，防止并发导出互相破坏 zoom 恢复与 DOM 状态。
     busy 状态：导出期间禁用全部导出按钮并显示任务名，失败/成功都恢复。
     统一错误显示：操作名称 + 失败原因 + 是否改动文档 + 建议下一步。 */
  let exportTask = null;
  function setExportBusy(busy, label) {
    document.querySelectorAll(".bb-export-btn").forEach(function (button) {
      if (busy) { button.dataset.prevDisabled = String(button.disabled); button.disabled = true; }
      else { button.disabled = button.dataset.prevDisabled === "true"; delete button.dataset.prevDisabled; }
    });
    const body = document.body;
    if (!body) return;
    let banner = document.getElementById("bb-export-busy-banner");
    if (busy) {
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "bb-export-busy-banner";
        banner.className = "bb-dom-only";
        banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#1e2b3a;color:#fff;padding:8px 16px;font-size:13px;text-align:center;";
        document.body.appendChild(banner);
      }
      banner.textContent = "正在" + (label || "导出") + "…请勿关闭或刷新页面";
    } else if (banner && banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }
  }
  function showExportError(action, error) {
    const message = (error && error.message) || String(error);
    if (global.console && global.console.error) global.console.error("导出失败 [" + action + "]:", error);
    global.alert("「" + action + "」导出失败：\n\n" + message + "\n\n当前文档内容未被修改。若反复失败，建议先「备份草稿」再重试。");
  }
  async function runExclusiveExport(label, task) {
    if (exportTask) {
      if (global.alert) global.alert("已有导出任务正在进行（" + exportTask.label + "），请等待完成后再试。");
      throw new Error("已有导出任务正在进行（" + exportTask.label + "）");
    }
    setExportBusy(true, label);
    const entry = { label: label };
    exportTask = entry;
    try {
      entry.promise = Promise.resolve().then(task);
      return await entry.promise;
    } finally {
      exportTask = null;
      setExportBusy(false);
    }
  }

  /* 严格渲染：任何一步异常都主动抛出，供事务性操作（草稿恢复 / AI 整份应用）回滚判断。
     普通交互渲染仍走 renderAll() 兜底展示错误占位，不中断用户操作。 */
  function renderAllStrict() {
    renderToolbar(); renderLibrary(); renderLayerTree(); renderCanvas(); renderPanel(); syncSideTabs();
  }
  function renderAll() {
    try {
      renderAllStrict();
    } catch (error) {
      try {
        els.canvasBody.textContent = "";
        const bug = el("div", "bb-page-empty", "界面渲染出现异常：" + (error && error.message || error) + "。请刷新页面重试；若反复出现请导出草稿反馈。");
        bug.classList.add("bb-dom-only");
        els.canvasBody.appendChild(bug);
      } catch (_) {}
      if (global.console && global.console.error) global.console.error("renderAll error:", error);
    }
  }
  /* 连续模式跟随：新增屏后让新屏顶部对齐可视区上沿（新屏在最下）。 */
  function scrollCanvasToBottom() {
    const target = document.querySelector("#canvasBody .bb-page-canvas.is-active") || document.querySelector(".bb-strip");
    if (!target) return;
    if (typeof target.scrollIntoView === "function") {
      try { target.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (error) { target.scrollIntoView(); }
      return;
    }
    if (!els.canvasBody) return;
    try { els.canvasBody.scrollTo({ top: els.canvasBody.scrollHeight, behavior: "smooth" }); } catch (error) { els.canvasBody.scrollTop = els.canvasBody.scrollHeight; }
  }
  function scrollSelectedIntoView() {
    const node = document.querySelector("#canvasBody .bb-art-module.is-selected");
    if (!node || typeof node.scrollIntoView !== "function") return;
    try { node.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (error) { node.scrollIntoView(); }
  }
  function scheduleCanvas() { if (framePending) return; framePending = true; global.requestAnimationFrame(function () { framePending = false; renderCanvas(); renderToolbar(); }); }

  function downloadBlob(blob, name) { return U.downloadBlob(blob, name); }
  function downloadText(content, name) { return U.downloadText(content, name); }
  function dataUrlToBlob(dataUrl) {
    return U.dataUrlToBlob(dataUrl);
  }

  function wrapLines(ctx, value, maxWidth) {
    return U.wrapLines(ctx, value, maxWidth);
  }


  /* ===== Stage 3 包装转发 —— 绘制实现已搬至 js/banner-builder-render.js ===== */
  function artTheme() { return BannerBuilderRender.artTheme(); }
  function artInk() { return BannerBuilderRender.artInk(); }
  function artMuted() { return BannerBuilderRender.artMuted(); }
  function artLineHeight() { return BannerBuilderRender.artLineHeight(); }
  function artWeight(v) { return BannerBuilderRender.artWeight(v); }
  function styleCardPad(base, st) { return BannerBuilderRender.styleCardPad(base, st); }
  function cardRadius(data, st) { return BannerBuilderRender.cardRadius(data, st); }
  function cardBaseFill(st, data, opacity) { return BannerBuilderRender.cardBaseFill(st, data, opacity); }
  function px2(v) { return BannerBuilderRender.px2(v); }
  function alphaColor(value, alpha) { return BannerBuilderRender.alphaColor(value, alpha); }
  function auditSilence(rows, prefix) { return BannerBuilderRender.auditSilence(rows, prefix); }


  async function exportPng(allPages) {
    if (global.BannerBuilderExport && global.BannerBuilderExport.exportPng) return global.BannerBuilderExport.exportPng({ allPages: allPages });
    return global.BannerBuilderLegacy.exportPng(allPages);
  }
  async function exportStripPng() {
    if (global.BannerBuilderExport && global.BannerBuilderExport.exportStripPng) return global.BannerBuilderExport.exportStripPng();
    return global.BannerBuilderLegacy.exportStripPng();
  }
  async function exportPsd() {
    if (global.BannerBuilderExport && global.BannerBuilderExport.exportPsd) return global.BannerBuilderExport.exportPsd();
    return global.BannerBuilderLegacy.exportPsd();
  }

  /* ===== 打包字体：把所用字体的桌面文件(.ttf/.otf)下载并打包 ZIP，便于在 PS 中正确渲染文字图层 ===== */
  const _libScriptPromises = {};
  function loadLibScript(url, globalName) {
    if (globalName && global[globalName]) return Promise.resolve(global[globalName]);
    if (_libScriptPromises[url]) return _libScriptPromises[url];
    _libScriptPromises[url] = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = url; s.async = true;
      s.onload = function () { resolve(globalName ? global[globalName] : undefined); };
      s.onerror = function () { reject(new Error("依赖加载失败：" + url)); };
      document.head.appendChild(s);
    });
    return _libScriptPromises[url];
  }
  async function ensureZip() {
    const JSZip = await loadLibScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "JSZip");
    if (typeof JSZip !== "function") throw new Error("JSZip 加载失败");
    return JSZip;
  }
  async function packFontsZip() {
    const headingKey = state.doc.headingFont || state.doc.fontFamily || "sans";
    const bodyKey = state.doc.bodyFont || headingKey;
    const keys = [headingKey, bodyKey].filter(function (key, index, arr) { return arr.indexOf(key) === index; });
    const JSZip = await ensureZip();
    const zip = new JSZip();
    const ok = []; const fail = [];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const dl = C.FONT_DOWNLOADS[key];
      if (!dl) continue;
      const label = C.FONTS[key] ? C.FONTS[key].label : key;
      /* 用户导入字体：dataURL 直存，直接还原打包 */
      if (dl.dataUrl) {
        zip.file("fonts/" + dl.name, dataUrlToBlob(dl.dataUrl));
        ok.push(label);
        continue;
      }
      /* 无直链的字体：无法自动下载，提示手动获取（清单内字体均有直链，此为防御分支） */
      if (!dl.url) { fail.push(label + "（未能自动下载，请从字体官网获取后安装）"); continue; }
      try {
        const resp = await fetch(dl.url, { mode: "cors" });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const blob = await resp.blob();
        zip.file("fonts/" + dl.name, blob);
        ok.push(label);
      } catch (error) { fail.push(label); }
    }
    if (!ok.length) throw new Error("没有可打包的字体文件（可能网络受限）");
    const lines = ["Only-box 长条排版 · 字体安装说明", "", "已打包字体（位于 fonts/ 目录）："];
    ok.forEach(function (name) { lines.push("  - " + name); });
    if (fail.length) {
      lines.push(""); lines.push("以下字体未能自动下载，请手动下载安装：");
      fail.forEach(function (name) { lines.push("  - " + name); });
    }
    lines.push("");
    lines.push("安装方法：双击 .ttf/.otf 文件点击「安装」，或将字体文件复制到系统字体目录后重启 Photoshop。");
    zip.file("字体安装说明.txt", lines.join("\r\n"));
    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, "only-box-banner-fonts.zip");
    return { ok: ok, fail: fail };
  }
  /* ===== Legacy 导出回退管线桥接（Stage 9）=====
     原 legacyExportPng / legacyExportStripPng / legacyExportPsd 及
     PSD 图层桥接函数已迁至 js/banner-builder-legacy-export.js。
     BannerBuilderLegacy 命名空间由新模块在加载时创建；
     init() 内通过 BannerBuilderLegacyExport.setState 注入。 */

  /* （已迁出）legacyExportStripPng / psdRoundRect / sceneImageToCanvas /
     sceneElementToPsdLayer / sceneFontPsWithWeight / legacyExportPsd
     见 js/banner-builder-legacy-export.js */


  /* 草稿图片持久化（审计 P6）：保存前用「我的模板」同款 snapshotData 把所有 blob: 引用
     转成 dataURL 写进 JSON；恢复时再把 dataURL 还原为 blob:，会话内行为与手选图片一致。
     还原只处理 <32MB 的 dataURL，超大的保留原样（canvas 可直接加载 data:）。 */
  /* ===== 草稿层桥接（实现已迁至 banner-builder-draft.js）=====
     主脚本仅保留编排（saveDraft / loadDraft）；showMissingFontMapper 已迁至 banner-builder-modals.js。
     纯数据变换（构造/校验/迁移/规范化/图片还原）统一走 BannerBuilderDraft。 */
  const DRAFT_LIMITS = global.BannerBuilderDraft.DRAFT_LIMITS;
  function buildDraftPayload(doc) { return global.BannerBuilderDraft.buildDraftPayload(doc); }
  function restoreDraftImages(value) { return global.BannerBuilderDraft.restoreDraftImages(value); }
  function assertNoBlobUrls(value, path, findings) { return global.BannerBuilderDraft.assertNoBlobUrls(value, path, findings); }
  function collectDraftImageSizes(value, path, out) { return global.BannerBuilderDraft.collectDraftImageSizes(value, path, out); }
  function formatBytes(bytes) { return global.BannerBuilderDraft.formatBytes(bytes); }
  function buildDraftCandidate(parsed) { return global.BannerBuilderDraft.buildDraftCandidate(parsed); }
  function migrateLegacyModuleType(type, data) { return global.BannerBuilderDraft.migrateLegacyModuleType(type, data); }
  function migrateModuleData(module) { return global.BannerBuilderDraft.migrateModuleData(module); }
  async function saveDraft() {
    const tpl = global.BannerBuilderMyTemplates;
    const draft = buildDraftPayload(state.doc);
    if (!tpl || typeof tpl.snapshotData !== "function") { downloadText(JSON.stringify(draft, null, 2), "only-box-banner-draft.json"); return; }
    let snap;
    try {
      /* BB-R03：任一图片 blob→dataURL 转换失败都会抛错（带字段路径），不再静默保留 blob: */
      snap = await tpl.snapshotData(draft);
    } catch (error) { global.alert("草稿保存失败：" + ((error && error.message) || error)); return; }
    /* BB-R03：保存前断言快照中无残留 blob:（防御性兜底，正常不应触发） */
    const blobFindings = [];
    assertNoBlobUrls(snap, "draft", blobFindings);
    if (blobFindings.length) {
      global.alert("草稿保存失败：以下图片未能完成内嵌转换，已中止保存（当前内容未改动）：\n" + blobFindings.slice(0, 5).map(function (f) { return "· " + f.path; }).join("\n"));
      return;
    }
    /* BB-R02：按最终 JSON 的实际 UTF-8 字节数校验，与导入端共用 DRAFT_LIMITS.maxFileSize */
    const json = JSON.stringify(snap, null, 2);
    let byteLength;
    try { byteLength = new TextEncoder().encode(json).length; }
    catch (error) { byteLength = json.length; /* 极老浏览器降级：按字符数近似 */ }
    if (byteLength > DRAFT_LIMITS.maxFileSize) {
      const images = [];
      collectDraftImageSizes(snap, "draft", images);
      images.sort(function (a, b) { return b.bytes - a.bytes; });
      const top = images.slice(0, 5).map(function (img) { return "· " + (img.name || "未命名图片") + "（" + formatBytes(img.bytes) + "，" + img.path + "）"; }).join("\n");
      global.alert("草稿保存失败：当前草稿 " + formatBytes(byteLength) + "，超过可重新导入上限 " + Math.round(DRAFT_LIMITS.maxFileSize / 1024 / 1024) + "MB。\n\n体积主要来自内嵌图片（前 5 大）：\n" + (top || "（未发现内嵌图片）") + "\n\n建议：压缩或删除部分大图后再保存。当前内容未改动。");
      return;
    }
    downloadText(json, "only-box-banner-draft.json");
  }
  function loadDraft(file) {
    if (file && file.size > DRAFT_LIMITS.maxFileSize) {
      global.alert("草稿文件超过 " + Math.round(DRAFT_LIMITS.maxFileSize / 1024 / 1024) + "MB，疑似不是正常导出的草稿，已拒绝读取。当前内容未改动。");
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      let parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (error) { global.alert("草稿读取失败：文件不是合法 JSON。当前内容未改动。"); return; }
      /* BB-R12：先在纯 data: 形态上完成结构校验，校验通过后再转 blob——
         避免校验失败的候选文档产生孤儿 Blob URL。 */
      let candidate;
      try { candidate = buildDraftCandidate(parsed); }
      catch (error) { global.alert("草稿校验失败：" + ((error && error.message) || error) + " 当前内容未改动。"); return; }
      try { restoreDraftImages(candidate); } catch (error) { /* 图片还原失败不阻断结构恢复 */ }
      const oldDoc = state.doc;
      const snapshot = M.toJSON(oldDoc);
      const prev = { activePageId: state.activePageId, selectedModuleId: state.selectedModuleId, step: state.step, sideView: state.sideView };
      /* 快照临时接管 blob 保护：应用失败回滚时，旧图片的 blob URL 仍然有效 */
      state.aiUndoSnapshot = snapshot;
      state.doc = candidate;
      state.activePageId = candidate.pages[0].id;
      state.selectedModuleId = null;
      state.step = "edit";
      state.sideView = "layers";
      ensureDocFonts(candidate);
      refreshProtectedBlobUrls();
      releaseDocBlobs(oldDoc);
      try { renderAllStrict(); }
      catch (error) {
        state.doc = snapshot;
        state.activePageId = prev.activePageId;
        state.selectedModuleId = prev.selectedModuleId;
        state.step = prev.step;
        state.sideView = prev.sideView;
        refreshProtectedBlobUrls();
        state.aiUndoSnapshot = null;
        try { renderAll(); } catch (_) { /* ignore */ }
        global.alert("草稿应用失败，已恢复原内容：" + ((error && error.message) || error));
        return;
      }
      state.aiUndoSnapshot = null;
      removeAiUndoNotice();
      /* 仅旧版草稿可能缺少主题定义；新版草稿自带完整主题，不依赖当前浏览器。 */
      if (candidate.__themeKnown === false) {
        const near = C.getThemeOptions();
        const suggest = near.slice(0, 4).map(function (o) { return o.label; }).join("、");
        global.alert("提示：这份草稿使用的主题「" + candidate.theme + "」在当前浏览器中不存在。\n\n原因：自定义主题保存在浏览器本地（localStorage），草稿 JSON 只记录主题名称不包含配色定义，换浏览器或清除缓存后即丢失。\n\n当前表现：卡片/标题等主题色已回退为默认主题，板块内设置的颜色（如本稿的紫色背景 #3b2b88、各板块底色）不受影响。\n\n恢复方式：① 若你还留有当时的主题定义 JSON，用「导入主题」重新导入一次即可完整还原；② 或在「微调主题」里手工调整后另存为主题。常用内置主题：" + suggest);
      }
      delete candidate.__themeKnown;
      /* BB-R13：草稿应用成功后检测缺失字体（等待 IndexedDB 字体 bootstrap），
         缺失时展示映射弹窗让用户选择替代字体；主题配色已恢复，不受字体影响。 */
      BannerBuilderModals.showMissingFontMapper(candidate);
    };
    reader.onerror = function () { global.alert("草稿读取失败：无法读取所选文件。"); };
    reader.readAsText(file);
  }
  /* ===== 缺失字体映射 / 主题导入 / 微调弹窗 / 字体导入已迁至 banner-builder-modals.js =====
     由 BannerBuilderModals 提供，init 中注入 setState + setContext 后使用。 */
  /* 供自动化测试使用的内部纯函数（不属于公开 UI API） */
  global.BannerBuilderDraftTools = Object.freeze({ buildDraftPayload: buildDraftPayload, buildDraftCandidate: buildDraftCandidate });

  /* 导出 PDF/A-3b：字体完整嵌入 + OCG 板块图层 + 场景 JSON 附件（引擎在 banner-builder-pdf-export.js） */
  async function exportPdf() {
    if (global.BannerBuilderPdfExport && global.BannerBuilderPdfExport.exportPdf) return global.BannerBuilderPdfExport.exportPdf();
    if (global.alert) global.alert("PDF 导出模块尚未加载，请刷新页面后重试。");
    return null;
  }

  /* ===== BB-R18：小屏自动适配 =====
     computeFitZoom：按画布容器宽度计算适配缩放（与「适配」按钮一致口径）。
     autoFitZoom：仅用户尚未手动调过缩放时自动应用；用户点过缩放按钮后（state.zoomManual）
     不再抢占其选择。横竖屏切换由 ResizeObserver 触发重新判断。 */
  function computeFitZoom() {
    const avail = ((els.canvasBody && els.canvasBody.clientWidth) || 560) - 48;
    return Math.min(1.5, Math.max(.15, avail / pageSize().pageWidth));
  }
  function autoFitZoom() {
    if (state.zoomManual) return;
    state.zoom = computeFitZoom();
  }
  function setupZoomAutoFit() {
    if (typeof ResizeObserver !== "function" || !els.canvasBody) return;
    let frame = null;
    const observer = new ResizeObserver(function () {
      /* 渲染本身会改画布尺寸，用 rAF 合并避免观察-渲染循环 */
      if (frame) return;
      frame = global.requestAnimationFrame ? global.requestAnimationFrame(function () { frame = null; autoFitZoom(); renderToolbar(); renderCanvas(); }) : null;
      if (frame === null) { frame = 0; setTimeout(function () { frame = null; autoFitZoom(); renderToolbar(); renderCanvas(); }, 100); }
    });
    observer.observe(els.canvasBody);
  }

  /* ===== 事件绑定已迁至 banner-builder-events.js =====
     由 BannerBuilderEvents.bindEvents() 提供；init 中注入 state 与 context 后调用。
     openModalA11y 已迁至 banner-builder-modals.js（其内部桥接 EVENTS.openModalA11y） */

  /* ===== 弹窗/微调/字体导入已迁至 banner-builder-modals.js =====
     BannerBuilderModals 提供：showThemeImportModal / showThemeTweakModal /
     showBackgroundTweakModal / showTypeTweakModal / showFontImportModal /
     showMissingFontMapper / refreshFontSelects / rebuildThemeSelect。
     同一模块内含 THEME_COLOR_FIELDS / BG_TWEAK_FIELDS / TYPE_* 等配置常量及
     hexToColor / themeOverride / arrayBufferFromDataUrl 等工具函数。
     init 中通过 BannerBuilderModals.setState(state) + setContext({…}) 注入后使用。 */
  function init() { if (initialized) return; initialized = true; F.setState(state); BannerBuilderModals.setState(state); global.BannerBuilderLegacyExport.setState(state); BannerBuilderModals.setContext({ el: el, imageSrc: imageSrc, renderAll: renderAll, renderPanel: renderPanel, docBackgroundOf: docBackgroundOf, ensureDocFonts: ensureDocFonts, invalidateBackgroundRenderCache: invalidateBackgroundRenderCache, BG: BG, copyTextToClipboard: copyTextToClipboard }); BannerBuilderRender.setState(state); BannerBuilderRender.setContext({ text: text, moduleTitle: moduleTitle, imageSrc: imageSrc, dataImageFit: dataImageFit, imageSizeOf: imageSizeOf, effectiveBackgroundColor: effectiveBackgroundColor, backgroundPatternActive: backgroundPatternActive, docBackgroundOf: docBackgroundOf }); BannerBuilderPreview.setState(state); BannerBuilderPreview.setContext({ el: el, text: text, moduleTitle: moduleTitle, visualImage: visualImage, imageSrc: imageSrc, imageSizeOf: imageSizeOf, dataImageFit: dataImageFit, safeClassSuffix: safeClassSuffix, pageSize: pageSize, continuousMode: continuousMode, applyThemeVars: applyThemeVars, docBackgroundStyle: docBackgroundStyle, docBackgroundOf: docBackgroundOf, parametricBackgroundDataUrl: parametricBackgroundDataUrl, effectiveBackgroundColor: effectiveBackgroundColor, backgroundPatternActive: backgroundPatternActive, els: els }); BannerBuilderUi.setContext({ el: el, imageSrc: imageSrc, renderAll: renderAll, scheduleCanvas: scheduleCanvas, replaceImageRecord: replaceImageRecord, releaseImageRecord: releaseImageRecord, refreshProtectedBlobUrls: refreshProtectedBlobUrls, pageSize: pageSize, ratioNumber: BannerBuilderRender.ratioNumber }); els.ratioGroup = document.getElementById("ratioGroup"); els.screenModeGroup = document.getElementById("screenModeGroup"); els.sizeReadout = document.getElementById("sizeReadout"); els.addPageBtn = document.getElementById("addPageBtn"); els.stats = document.getElementById("docStats"); els.importThemeBtn = document.getElementById("importThemeBtn"); els.importModuleBtn = document.getElementById("importModuleBtn"); els.generateAiDocumentBtn = document.getElementById("generateAiDocumentBtn"); els.libraryList = document.getElementById("libraryList"); els.libraryHint = document.getElementById("libraryHint"); els.myTplArea = document.getElementById("myTplArea"); els.myTplCount = document.getElementById("myTplCount"); els.myTplList = document.getElementById("myTplList"); els.zoomOutBtn = document.getElementById("zoomOutBtn"); els.zoomInBtn = document.getElementById("zoomInBtn"); els.zoomFitBtn = document.getElementById("zoomFitBtn"); els.zoomValue = document.getElementById("zoomValue"); els.packFontsToggle = document.getElementById("packFontsToggle"); els.saveDraftBtn = document.getElementById("saveDraftBtn"); els.loadDraftInput = document.getElementById("loadDraftInput"); els.libraryList = document.getElementById("libraryList"); els.libraryHint = document.getElementById("libraryHint"); els.myTplArea = document.getElementById("myTplArea"); els.myTplList = document.getElementById("myTplList"); els.myTplCount = document.getElementById("myTplCount"); els.canvasBody = document.getElementById("canvasBody"); els.panelTitle = document.getElementById("panelTitle"); els.panelSub = document.getElementById("panelSub"); els.panelBody = document.getElementById("panelBody"); els.stepBar = document.getElementById("stepBar"); els.sideTabs = document.getElementById("sideTabs"); els.libraryPane = document.getElementById("libraryPane"); els.layerPane = document.getElementById("layerPane"); els.layerTree = document.getElementById("layerTree"); els.addPageBtnSide = document.getElementById("addPageBtnSide"); els.workbench = document.getElementById("workbench"); els.exportScaleGroup = document.getElementById("exportScaleGroup"); els.exportSizeReadout = document.getElementById("exportSizeReadout"); els.stepToolbars = { "theme-bg": document.querySelector(".bb-toolbar-theme-bg"), setup: document.querySelector(".bb-toolbar-setup"), edit: document.querySelector(".bb-toolbar-edit"), export: document.querySelector(".bb-toolbar-export") }; state.activePageId = state.doc.pages[0].id; BannerBuilderModals.refreshFontSelects(); ensureFont(docFontFamily()); BannerBuilderEvents.setState(state); BannerBuilderEvents.setContext({ els: els, renderAll: renderAll, renderToolbar: renderToolbar, renderCanvas: renderCanvas, renderPanel: renderPanel, saveDraft: saveDraft, loadDraft: loadDraft, addCustomModuleToPage: addCustomModuleToPage, afterAddModule: afterAddModule, deleteMyTemplate: deleteMyTemplate, addTemplateToPage: addTemplateToPage, saveSelectedModuleAsTemplate: saveSelectedModuleAsTemplate, showThemeImportModal: BannerBuilderModals.showThemeImportModal, showModuleImportModal: showModuleImportModal, showAiDocumentModal: showAiDocumentModal, computeFitZoom: computeFitZoom, continuousMode: continuousMode, scrollCanvasToBottom: scrollCanvasToBottom, scrollSelectedIntoView: scrollSelectedIntoView, activePage: activePage, collectBlobUrls: collectBlobUrls, refreshProtectedBlobUrls: refreshProtectedBlobUrls, revokeBlobUrl: revokeBlobUrl, isProtectedBlobUrl: function (url) { return protectedBlobUrls.has(url); } }); BannerBuilderEvents.bindEvents(); preloadDefaultFont(); renderAll(); renderMyTemplates(); bootstrapUserFonts(); setupZoomAutoFit(); global.bannerBuilder = { state: state, get doc() { return state.doc; }, toJSON: function () { return M.toJSON(state.doc); }, exportPng: exportPng, exportStripPng: exportStripPng, exportPsd: exportPsd, setZoom: function (z) { state.zoomManual = true; state.zoom = z; renderToolbar(); renderCanvas(); }, renderAll: renderAll }; }
  /* 启动时载入用户已导入的字体（IndexedDB），注入 Constants 并刷新三个字体下拉。 */
  function bootstrapUserFonts() {
    return F.bootstrapUserFonts();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
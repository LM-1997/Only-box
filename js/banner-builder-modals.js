/* banner-builder-modals.js
   模态弹窗子系统：缺失字体映射 + 主题/背景/排版微调弹窗 + 主题/字体导入弹窗。
   包含与之紧耦合的配置常量（THEME_COLOR_FIELDS / BG_TWEAK_FIELDS 等）和
   工具函数（hexToColor / themeOverride / arrayBufferFromDataUrl）。
   依赖经 setState / setContext 注入。导出：global.BannerBuilderModals */

(function (global) {
  "use strict";

  const C = global.BannerBuilderConstants;
  const R = global.BannerBuilderRegistry;
  const U = global.BannerBuilderUtils;
  const F = global.BannerBuilderFont;
  const UI = global.BannerBuilderUi;
  const EVENTS = global.BannerBuilderEvents;

  let state = {};
  let ctx = {};

  function setState(s) { state = s || {}; }
  function setContext(context) { ctx = context || {}; }

  /* 依赖转发包装（保持被搬移函数体内原样调用名不变） */
  function el(tag, cls, text) { return ctx.el(tag, cls, text); }
  function renderAll() { ctx.renderAll(); }
  function renderPanel() { ctx.renderPanel(); }
  function docBackgroundOf(target) { return ctx.docBackgroundOf(target); }
  function ensureDocFonts(doc) { ctx.ensureDocFonts(doc); }
  function invalidateBackgroundRenderCache() { ctx.invalidateBackgroundRenderCache(); }
  function bgProvider() { return ctx.BG(); }
  function copyTextToClipboard(text) { return ctx.copyTextToClipboard(text); }

  /* openModalA11y 桥接（原主文件通过 BannerBuilderEvents.openModalA11y 调用） */
  function openModalA11y(mask, modal, opts) { return (EVENTS && EVENTS.openModalA11y ? EVENTS.openModalA11y(mask, modal, opts) : function () {}); }

  /* ===== BB-R13：缺失字体检测与替代映射 =====
     草稿只携带字体 key，自定义字体文件存在原作者浏览器的 IndexedDB。换浏览器后：
     1. 等 bootstrapUserFonts 完成（IndexedDB 异步）再检测，避免误报；
     2. 检测 doc 三级字体 + 主题定义推荐字体是否在当前 C.FONTS 中；
     3. 缺失时弹映射 UI（每个缺失字体一个下拉，可选现有任意字体或保持缺失）；
     4. 主题配色照常恢复，绝不因字体缺失拒绝整份草稿。 */
  function showMissingFontMapper(doc) {
    const importer = global.BannerBuilderFontImporter;
    const detect = function () {
      /* 草稿自带的依赖声明（v3 起导出时写入），用于显示原始字体名 */
      const declared = {};
      if (Array.isArray(doc.fontDependencies)) {
        doc.fontDependencies.forEach(function (dep) {
          if (dep && typeof dep.key === "string") declared[dep.key] = dep.label || dep.key;
        });
      }
      const missing = [];
      const seen = {};
      const roles = { fontFamily: "全局", headingFont: "标题", bodyFont: "正文" };
      Object.keys(roles).forEach(function (key) {
        const fontKey = doc[key];
        if (typeof fontKey !== "string" || !fontKey || seen[fontKey]) return;
        if (C.FONTS[fontKey]) return;
        seen[fontKey] = true;
        missing.push({ key: fontKey, label: declared[fontKey] || fontKey, role: roles[key], targets: [key] });
      });
      const def = doc.themeDefinition;
      if (def && typeof def === "object") {
        ["headingFont", "bodyFont"].forEach(function (key) {
          const fontKey = def[key];
          if (typeof fontKey !== "string" || !fontKey || seen[fontKey]) return;
          if (C.FONTS[fontKey]) return;
          seen[fontKey] = true;
          missing.push({ key: fontKey, label: declared[fontKey] || fontKey, role: "主题推荐", targets: [] });
        });
      }
      return missing;
    };
    const run = function () {
      let missing;
      try { missing = detect(); } catch (error) { return; }
      if (!missing.length) return;
      buildMissingFontModal(missing, doc);
    };
    if (importer && typeof importer.refresh === "function" && importer.isAvailable && importer.isAvailable()) {
      importer.refresh().then(function (rows) {
        if (rows && rows.length) { importer.applyToConstants(); refreshFontSelects(); }
        run();
      }, run);
    } else run();
  }
  function buildMissingFontModal(missing, doc) {
    const existing = document.getElementById("bb-font-map-modal");
    if (existing) existing.parentNode.removeChild(existing);
    const mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-font-map-modal";
    mask.setAttribute("role", "dialog");
    mask.setAttribute("aria-modal", "true");
    mask.setAttribute("aria-labelledby", "bb-font-map-title");
    const modal = document.createElement("div");
    modal.className = "bb-modal";
    const title = el("h3", null, "草稿字体缺失");
    title.id = "bb-font-map-title";
    modal.appendChild(title);
    modal.appendChild(el("p", null, "以下字体是原电脑上导入的自定义字体，字体文件不会随草稿携带，当前浏览器中没有。主题配色与内容已完整恢复；你可以为每个缺失字体选择现有字体替代（含内置字体），或保持现状（预览和导出会回退近似字体）。"));
    const rows = [];
    missing.forEach(function (item) {
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", (item.label || item.key) + "（" + item.role + "）"));
      const sel = el("select", "bb-tweak-select");
      const keep = el("option", null, "保持缺失（回退近似字体）");
      keep.value = "";
      sel.appendChild(keep);
      C.getFontOptions().forEach(function (opt) {
        const option = el("option", null, opt.label);
        option.value = opt.value;
        sel.appendChild(option);
      });
      row.appendChild(sel);
      modal.appendChild(row);
      rows.push({ item: item, sel: sel });
    });
    const actions = el("div", "bb-modal-actions");
    const applyBtn = el("button", "bb-btn primary", "应用映射");
    applyBtn.type = "button";
    applyBtn.addEventListener("click", function () {
      rows.forEach(function (entry) {
        const target = entry.sel.value;
        if (!target) return;
        /* doc 三级字体：直接替换 */
        entry.item.targets.forEach(function (docKey) { doc[docKey] = target; });
        /* 主题定义推荐字体：同步替换，保证主题快照一致 */
        const def = doc.themeDefinition;
        if (def && typeof def === "object" && (def.headingFont === entry.item.key || def.bodyFont === entry.item.key)) {
          if (def.headingFont === entry.item.key) def.headingFont = target;
          if (def.bodyFont === entry.item.key) def.bodyFont = target;
        }
      });
      ensureDocFonts(doc);
      mask.parentNode.removeChild(mask);
      renderAll();
    });
    const closeBtn = el("button", "bb-btn ghost", "保持现状");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () { mask.parentNode.removeChild(mask); });
    actions.appendChild(applyBtn);
    actions.appendChild(closeBtn);
    modal.appendChild(actions);
    mask.appendChild(modal);
    mask.addEventListener("click", function (e) { if (e.target === mask) mask.parentNode.removeChild(mask); });
    document.body.appendChild(mask);
    try { applyBtn.focus(); } catch (e) { /* ignore */ }
  }

  /* ===== 主题导入弹窗 ===== */
  /* 主题下拉已迁入右侧文档设置面板：导入新主题后重渲染面板即可见 */
  function rebuildThemeSelect() {
    renderPanel();
  }

  function showThemeImportModal() {
    var existing = document.getElementById("bb-theme-modal");
    if (existing) { existing.parentNode.removeChild(existing); }

    var mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-theme-modal";

    var modal = document.createElement("div");
    modal.className = "bb-modal";

    var h3 = el("h3", null, "导入 AI 生成的主题");
    h3.id = "bb-theme-modal-title";
    modal.appendChild(h3);
    /* BB-R20：弹窗焦点管理（Escape/Tab 约束/关闭恢复焦点） */
    var closeA11y = openModalA11y(mask, modal, { titleId: "bb-theme-modal-title" });
    modal.appendChild(el("p", null, "复制下方 AI 提示词发给 ChatGPT / Claude 等 AI → 把生成的 JSON 粘贴回来 → 点击导入"));

    var promptArea = document.createElement("textarea");
    promptArea.className = "bb-input bb-modal-textarea";
    promptArea.readOnly = true;
    promptArea.style.height = "80px";
    promptArea.value = (global.BannerBuilderThemeImporter && global.BannerBuilderThemeImporter.promptText) || "";
    modal.appendChild(promptArea);

    var copyRow = document.createElement("div");
    copyRow.className = "bb-modal-actions";
    var copyBtn = el("button", "bb-btn ghost", "📋 复制 AI 提示词");
    copyBtn.type = "button";
    copyBtn.addEventListener("click", function () {
      copyTextToClipboard(promptArea.value).then(function (ok) {
        copyBtn.textContent = ok ? "✓ 已复制" : "✗ 复制失败，请手动全选复制";
        setTimeout(function () { copyBtn.textContent = "📋 复制 AI 提示词"; }, 2400);
      });
    });
    copyRow.appendChild(copyBtn);
    modal.appendChild(copyRow);

    var inputLabel = el("p", null, "▼ 将 AI 生成的 JSON 粘贴到下方（支持带 markdown 代码块）");
    inputLabel.style.marginTop = "16px";
    modal.appendChild(inputLabel);

    var inputArea = document.createElement("textarea");
    inputArea.className = "bb-input bb-modal-textarea";
    inputArea.placeholder = "粘贴 AI 生成的 JSON 主题代码...";
    modal.appendChild(inputArea);

    var msgArea = el("div");
    msgArea.style.display = "none";
    modal.appendChild(msgArea);

    var actionRow = document.createElement("div");
    actionRow.className = "bb-modal-actions";
    var importBtn = el("button", "bb-btn primary", "导入主题");
    importBtn.type = "button";
    importBtn.addEventListener("click", function () {
      var raw = inputArea.value.trim();
      if (!raw) { showMsg("error", "请先粘贴 JSON 代码"); return; }
      var obj = global.BannerBuilderThemeImporter.extractJson(raw);
      if (!obj) { showMsg("error", "JSON 格式解析失败，请确认粘贴内容"); return; }
      var errors = global.BannerBuilderThemeImporter.validate(obj);
      if (errors.length) { showMsg("error", "校验不通过：\n" + errors.join("\n")); return; }
      try {
        global.BannerBuilderThemeImporter.add(obj);
        rebuildThemeSelect();
        showMsg("success", "✓ 主题「" + obj.label + "」已导入，可在主题下拉菜单中选用");
      } catch (e) {
        showMsg("error", "保存失败：" + (e && e.message || e));
      }
    });
    actionRow.appendChild(importBtn);

    var cancelBtn = el("button", "bb-btn ghost", "关闭");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", function () { closeA11y(); mask.parentNode.removeChild(mask); });
    actionRow.appendChild(cancelBtn);

    modal.appendChild(actionRow);
    mask.appendChild(modal);

    mask.addEventListener("click", function (e) { if (e.target === mask) { closeA11y(); mask.parentNode.removeChild(mask); } });
    document.body.appendChild(mask);

    function showMsg(type, text) {
      msgArea.style.display = "block";
      msgArea.className = type === "error" ? "bb-modal-error" : "bb-modal-success";
      msgArea.textContent = text;
    }
  }

  /* ===== 微调主题：在当前预设主题基础上手动覆盖颜色与风格字段（写入 doc.themeOverrides） ===== */
  const THEME_COLOR_FIELDS = [
    { key: "primary", label: "主色" },
    { key: "primaryDark", label: "深主色" },
    { key: "primarySoft", label: "浅底" },
    { key: "accent", label: "强调色" },
    { key: "accentSoft", label: "强调浅底" },
    { key: "line", label: "线色 / 描边" },
    { key: "soft", label: "软底 / 卡片空底" },
  ];
  const THEME_STYLE_FIELDS = [
    { key: "cardStyle", label: "卡片骨架", options: [["card", "细边框白底"], ["panel", "深色硬边"], ["glass", "磨砂玻璃"], ["ticket", "打孔票据"], ["sticker", "白底粗描边贴纸"], ["ink", "双层描边纸感"]] },
    { key: "radius", label: "圆角 (px)", type: "number" },
    { key: "shadow", label: "阴影", options: [["soft", "柔和"], ["hard", "硬偏移"], ["glow", "霓虹光晕"], ["none", "无"]] },
    { key: "divider", label: "分割线", options: [["wave", "波浪"], ["dots", "圆点"], ["line", "直线"], ["glitch", "故障线"], ["thread", "缝线"], ["dashed", "虚线"]] },
    { key: "chips", label: "标签块形状", options: [["pill", "胶囊"], ["squared", "方角"], ["tag", "单边缺角"]] },
    { key: "titleDecor", label: "大标题装饰", options: [["none", "无"], ["bar", "色条"], ["bracket", "括号"], ["stitch", "缝线"], ["kicker", "斜杠序号"]] },
    { key: "pattern", label: "页面底纹", options: [["none", "无"], ["grid", "网格"], ["dots", "圆点"], ["stripes", "斜条纹"], ["paper", "纸纹"], ["noise", "噪点"]] },
    { key: "avatarStyle", label: "头像装饰", options: [["none", "无"], ["ring", "描边圈"], ["glow", "光晕"], ["badge", "角标"], ["frame", "相框"], ["polaroid", "拍立得"]] },
  ];
  function hexToColor(value) {
    return U.hexToColor(value);
  }
  function themeOverride(key) {
    const ov = state.doc.themeOverrides || {};
    return ov[key] == null || ov[key] === "" ? null : ov[key];
  }
  function showThemeTweakModal() {
    const existing = document.getElementById("bb-tweak-modal");
    if (existing) existing.parentNode.removeChild(existing);
    const base = C.themeStyleForDoc ? C.themeStyleForDoc(state.doc) : C.themeStyle(state.doc.theme);

    const mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-tweak-modal";
    const modal = document.createElement("div");
    modal.className = "bb-modal";
    const tweakTitle = el("h3", null, "微调主题「" + (base.label || state.doc.theme) + "」");
    tweakTitle.id = "bb-tweak-modal-title";
    modal.appendChild(tweakTitle);
    /* BB-R20：弹窗焦点管理 */
    const closeA11y = openModalA11y(mask, modal, { titleId: "bb-tweak-modal-title" });
    modal.appendChild(el("p", null, "在预设主题基础上手动覆盖颜色与风格。未覆盖的项显示为「继承预设」，恢复默认即清除该项覆盖。改动实时反映到画布与导出。"));

    const body = el("div");
    body.style.marginTop = "6px";

    function section(title) {
      const d = el("div", "bb-tweak-section", title);
      body.appendChild(d);
    }

    /* 颜色覆盖 */
    section("颜色覆盖");
    THEME_COLOR_FIELDS.forEach(function (field) {
      const cur = themeOverride(field.key);
      const preset = base[field.key] || "#ffffff";
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", field.label));
      const colorInput = el("input", "bb-tweak-input");
      colorInput.type = "color";
      colorInput.value = hexToColor(cur != null ? cur : preset);
      const hex = el("input", "bb-tweak-hex");
      hex.value = cur != null ? cur : preset;
      hex.readOnly = cur == null;
      hex.style.opacity = cur == null ? "0.55" : "1";
      const flag = el("span", "bb-tweak-inherit");
      flag.textContent = cur == null ? "继承预设" : "已覆盖";
      const clear = el("a", "bb-tweak-clear", "恢复默认");
      clear.style.display = cur == null ? "none" : "inline";
      clear.title = "清除该颜色覆盖，回退到预设主题";
      function applyHex() {
        const value = hexToColor(hex.value);
        state.doc.themeOverrides = state.doc.themeOverrides || {};
        state.doc.themeOverrides[field.key] = value;
        colorInput.value = value;
        hex.value = value;
        flag.textContent = "已覆盖";
        clear.style.display = "inline";
        renderAll();
      }
      colorInput.addEventListener("input", function () { hex.value = colorInput.value; applyHex(); });
      hex.addEventListener("change", applyHex);
      clear.addEventListener("click", function () {
        if (state.doc.themeOverrides) delete state.doc.themeOverrides[field.key];
        renderAll(); maskRemove();
      });
      row.appendChild(colorInput); row.appendChild(hex); row.appendChild(flag); row.appendChild(clear);
      body.appendChild(row);
    });

    /* 风格覆盖 */
    section("风格覆盖");
    THEME_STYLE_FIELDS.forEach(function (field) {
      const cur = themeOverride(field.key);
      const preset = field.type === "number" ? (base[field.key] != null ? base[field.key] : 13) : (base[field.key] || (field.options && field.options[0][0]));
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", field.label));
      let input;
      if (field.type === "number") {
        input = el("input", "bb-tweak-num");
        input.type = "number"; input.min = "0"; input.max = "100"; input.step = "1";
        input.value = cur != null ? cur : preset;
      } else {
        input = el("select", "bb-tweak-select");
        field.options.forEach(function (pair) {
          const opt = el("option", null, pair[1]); opt.value = pair[0]; input.appendChild(opt);
        });
        UI.ensureSelectValue(input, cur != null ? cur : preset);
      }
      const flag = el("span", "bb-tweak-inherit");
      flag.textContent = cur == null ? "继承预设" : "已覆盖";
      const clear = el("a", "bb-tweak-clear", "恢复默认");
      clear.style.display = cur == null ? "none" : "inline";
      function applyValue() {
        state.doc.themeOverrides = state.doc.themeOverrides || {};
        state.doc.themeOverrides[field.key] = field.type === "number" ? (Number(input.value) || 0) : input.value;
        flag.textContent = "已覆盖";
        clear.style.display = "inline";
        renderAll();
      }
      input.addEventListener(field.type === "number" ? "input" : "change", applyValue);
      clear.addEventListener("click", function () {
        if (state.doc.themeOverrides) delete state.doc.themeOverrides[field.key];
        renderAll(); maskRemove();
      });
      row.appendChild(input); row.appendChild(flag); row.appendChild(clear);
      body.appendChild(row);
    });

    /* 背景段（Task #15）：显示当前图案背景状态，提供微调入口 */
    section("整条背景");
    const paramBg = docBackgroundOf(state.doc);
    const bgRow = el("div", "bb-tweak-row");
    if (paramBg) {
      const engine = bgProvider();
      const preset = engine && engine.presetById(paramBg.presetId);
      bgRow.appendChild(el("span", "bb-tweak-label", "图案背景：" + (preset ? preset.label : "自定义")));
      const bgBtn = el("button", "bb-btn ghost", "微调图案");
      bgBtn.type = "button";
      bgBtn.style.cssText = "padding:4px 12px;font-size:11px";
      bgBtn.addEventListener("click", function () { maskRemove(); showBackgroundTweakModal(); });
      bgRow.appendChild(bgBtn);
    } else {
      bgRow.appendChild(el("span", "bb-tweak-label", "图案背景：无"));
      const goBtn = el("button", "bb-btn ghost", "去第 0 步选择");
      goBtn.type = "button";
      goBtn.style.cssText = "padding:4px 12px;font-size:11px";
      goBtn.addEventListener("click", function () {
        maskRemove();
        state.step = "theme-bg";
        state.selectedModuleId = null;
        state.sideView = "library";
        renderAll();
      });
      bgRow.appendChild(goBtn);
    }
    body.appendChild(bgRow);
    modal.appendChild(body);

    const actionRow = el("div", "bb-modal-actions");
    const resetAll = el("button", "bb-btn ghost", "全部恢复预设");
    resetAll.type = "button";
    resetAll.addEventListener("click", function () { state.doc.themeOverrides = {}; renderAll(); maskRemove(); });
    const closeBtn = el("button", "bb-btn primary", "完成");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () { maskRemove(); });
    actionRow.appendChild(resetAll);
    actionRow.appendChild(closeBtn);
    modal.appendChild(actionRow);
    mask.appendChild(modal);
    mask.addEventListener("click", function (e) { if (e.target === mask) maskRemove(); });
    document.body.appendChild(mask);

    function maskRemove() {
      closeA11y();
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
    }
  }

  /* ===== 背景图案微调（Task #15）：图案背景的密度/尺寸/透明度/颜色/形状编辑 =====
     直接编辑 doc.background.params（引擎 normalize 后回写），档位按钮 + 数值输入（与 Task #17 同交互范式）。
     颜色随主题的预设（colorMode:"theme"）改色后转为固定色，不再跟随主题（用户显式覆盖优先）。 */
  const BG_TWEAK_FIELDS = [
    { key: "spacing", label: "点间距", type: "number", min: 6, max: 400, step: 2, tiers: [20, 28, 34, 44, 60, 90] },
    { key: "maxSize", label: "最大尺寸", type: "number", min: 1, max: 60, step: 1, tiers: [4, 8, 12, 18, 26] },
    { key: "minSize", label: "最小尺寸", type: "number", min: 0, max: 40, step: 0.5, tiers: [0, 1, 2, 4, 8] },
    { key: "opacity", label: "不透明度", type: "number", min: 0, max: 100, step: 5, tiers: [50, 65, 80, 90, 100] },
    { key: "jitter", label: "位置抖动", type: "number", min: 0, max: 100, step: 5, tiers: [0, 15, 30, 50] },
    { key: "rotation", label: "整体旋转", type: "number", min: -180, max: 180, step: 15, tiers: [-45, 0, 45, 90] },
  ];
  function showBackgroundTweakModal() {
    const engine = bgProvider();
    const bgRecord = docBackgroundOf(state.doc);
    if (!engine || !bgRecord) return;
    const existing = document.getElementById("bb-bg-tweak-modal");
    if (existing) existing.parentNode.removeChild(existing);

    const preset = engine.presetById(bgRecord.presetId);
    const mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-bg-tweak-modal";
    const modal = document.createElement("div");
    modal.className = "bb-modal";
    const title = el("h3", null, "微调背景图案" + (preset ? "「" + preset.label + "」" : ""));
    title.id = "bb-bg-tweak-modal-title";
    modal.appendChild(title);
    const closeA11y = openModalA11y(mask, modal, { titleId: "bb-bg-tweak-modal-title" });
    modal.appendChild(el("p", null, "调整图案的密度、尺寸与颜色，改动实时反映到画布与导出。"));

    const body = el("div");
    body.style.marginTop = "6px";

    /* 颜色：底色 + 图案色（改色后预设不再跟随主题） */
    const colorSection = el("div", "bb-tweak-section", "颜色");
    body.appendChild(colorSection);
    [["bg", "底色"], ["fg", "图案色"]].forEach(function (pair) {
      const key = pair[0], label = pair[1];
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", label));
      const colorInput = el("input", "bb-tweak-input");
      colorInput.type = "color";
      colorInput.value = hexToColor(bgRecord.params[key]);
      colorInput.addEventListener("input", function () {
        bgRecord.params[key] = colorInput.value;
        bgRecord.themeLocked = true; /* 显式改色后不再跟随主题（Task #15 决策） */
        /* 底色改动同步回写整条底色，保证移除图案后回退色与所见一致 */
        if (key === "bg") state.doc.backgroundColor = colorInput.value;
        invalidateBackgroundRenderCache();
        renderAll();
      });
      row.appendChild(colorInput);
      body.appendChild(row);
    });

    /* 形状 */
    const shapeSection = el("div", "bb-tweak-section", "形状");
    body.appendChild(shapeSection);
    const shapeRow = el("div", "bb-tweak-row");
    shapeRow.appendChild(el("span", "bb-tweak-label", "图案形状"));
    const shapeSel = el("select", "bb-tweak-input");
    [["circle", "圆点"], ["square", "方点"], ["diamond", "菱形"], ["triangle", "三角"], ["polygon", "多边形"]].forEach(function (pair) {
      const opt = el("option", null, pair[1]);
      opt.value = pair[0];
      shapeSel.appendChild(opt);
    });
    UI.ensureSelectValue(shapeSel, bgRecord.params.shape || "circle");
    shapeSel.addEventListener("change", function () {
      bgRecord.params.shape = shapeSel.value;
      invalidateBackgroundRenderCache();
      renderAll();
    });
    shapeRow.appendChild(shapeSel);
    body.appendChild(shapeRow);

    /* 数值档位 */
    const numSection = el("div", "bb-tweak-section", "密度与尺寸");
    body.appendChild(numSection);
    BG_TWEAK_FIELDS.forEach(function (field) {
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", field.label));
      const tierGroup = el("div", "bb-tier-group");
      const numInput = el("input", "bb-tier-num");
      numInput.type = "number";
      numInput.min = String(field.min);
      numInput.max = String(field.max);
      numInput.step = String(field.step);
      numInput.value = bgRecord.params[field.key];
      function applyValue(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        const clamped = Math.max(field.min, Math.min(field.max, n));
        bgRecord.params[field.key] = clamped;
        numInput.value = String(clamped);
        Array.prototype.forEach.call(tierGroup.querySelectorAll(".bb-tier-btn"), function (btn) {
          btn.classList.toggle("is-active", Number(btn.dataset.value) === clamped);
        });
        invalidateBackgroundRenderCache();
        renderAll();
      }
      (field.tiers || []).forEach(function (tier) {
        const btn = el("button", "bb-tier-btn" + (Number(bgRecord.params[field.key]) === tier ? " is-active" : ""), String(tier));
        btn.type = "button";
        btn.dataset.value = String(tier);
        btn.addEventListener("click", function () { applyValue(tier); });
        tierGroup.appendChild(btn);
      });
      numInput.addEventListener("change", function () { applyValue(numInput.value); });
      tierGroup.appendChild(numInput);
      row.appendChild(tierGroup);
      body.appendChild(row);
    });
    modal.appendChild(body);

    const actionRow = el("div", "bb-modal-actions");
    const removeBtn = el("button", "bb-btn ghost", "移除背景图案");
    removeBtn.type = "button";
    removeBtn.addEventListener("click", function () {
      state.doc.background = null;
      invalidateBackgroundRenderCache();
      renderAll(); maskRemove();
    });
    const closeBtn = el("button", "bb-btn primary", "完成");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () { maskRemove(); });
    actionRow.appendChild(removeBtn);
    actionRow.appendChild(closeBtn);
    modal.appendChild(actionRow);
    mask.appendChild(modal);
    mask.addEventListener("click", function (e) { if (e.target === mask) maskRemove(); });
    document.body.appendChild(mask);

    function maskRemove() {
      closeA11y();
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
    }
  }

  /* ===== 排版微调：字号缩放 / 字重 / 行距 / 字距 / 文字颜色（写入 doc.themeOverrides） =====
     Task #17：数值类字段不再使用滑块（用户决策「档位按钮+数值输入」）——
     每个字段给 4~5 个常用档位按钮，点按即达；精确值用右侧数值输入框直接键入。 */
  const TYPE_SCALE_FIELDS = [
    { key: "typeScale", label: "全局字号缩放", min: 0.7, max: 1.5, step: 0.05, tiers: [0.8, 0.9, 1, 1.1, 1.25] },
    { key: "h1Scale", label: "主标题 H1", min: 0.7, max: 1.3, step: 0.05, tiers: [0.8, 0.9, 1, 1.1, 1.2] },
    { key: "h2Scale", label: "板块标题 H2", min: 0.7, max: 1.3, step: 0.05, tiers: [0.8, 0.9, 1, 1.1, 1.2] },
  ];
  const TYPE_WEIGHT_FIELDS = [
    { key: "headingWeight", label: "标题字重", options: [["400", "400 Regular"], ["500", "500 Medium"], ["600", "600 SemiBold"], ["700", "700 Bold"], ["800", "800 ExtraBold"], ["900", "900 Black"]] },
    { key: "bodyWeight", label: "正文字重", options: [["300", "300 Light"], ["400", "400 Regular"], ["500", "500 Medium"], ["600", "600 SemiBold"], ["700", "700 Bold"]] },
  ];
  const TYPE_SPACING_FIELDS = [
    { key: "lineHeight", label: "行距系数", min: 1.1, max: 2.0, step: 0.05, tiers: [1.15, 1.25, 1.4, 1.55, 1.7] },
    { key: "letterSpacing", label: "字距", min: -1, max: 4, step: 0.2, tiers: [0, 0.5, 1, 2] },
  ];
  const TYPE_COLOR_FIELDS = [
    { key: "headingColor", label: "标题文字色" },
    { key: "bodyColor", label: "正文文字色" },
    { key: "mutedColor", label: "注释/标签文字色" },
  ];
  const WEIGHT_OPTIONS = ["400", "500", "600", "700", "800", "900"];
  function showTypeTweakModal() {
    const existing = document.getElementById("bb-type-tweak-modal");
    if (existing) existing.parentNode.removeChild(existing);
    const base = typeof C.themeStyleForDoc === "function" ? C.themeStyleForDoc(state.doc) : C.themeStyle(state.doc.theme);
    if (!base) return;

    const mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-type-tweak-modal";
    const modal = document.createElement("div");
    modal.className = "bb-modal";
    const title = el("h3", null, "排版微调");
    title.id = "bb-type-tweak-modal-title";
    modal.appendChild(title);
    const closeA11y = openModalA11y(mask, modal, { titleId: "bb-type-tweak-modal-title" });
    modal.appendChild(el("p", null, "全局调整排版参数（字号、行距、字距、字重），直接覆盖主题预设值（不修改原主题数据）。"));

    const body = el("div");
    body.style.marginTop = "6px";
    function section(title) {
      const d = el("div", "bb-tweak-section", title);
      body.appendChild(d);
    }

    section("字号缩放（倍率）");
    TYPE_SCALE_FIELDS.forEach(function (field) {
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", field.label));
      const tierGroup = el("div", "bb-tier-group");
      const cur = themeOverride(field.key);
      const preset = field.key === "typeScale" ? 1 : 1;
      const initialValue = cur != null ? Number(cur) : preset;
      const numInput = el("input", "bb-tier-num");
      numInput.type = "number";
      numInput.min = String(field.min);
      numInput.max = String(field.max);
      numInput.step = String(field.step);
      numInput.value = String(initialValue);
      function applyValue(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        const clamped = Math.max(field.min, Math.min(field.max, n));
        numInput.value = String(clamped);
        state.doc.themeOverrides = state.doc.themeOverrides || {};
        state.doc.themeOverrides[field.key] = clamped;
        Array.prototype.forEach.call(tierGroup.querySelectorAll(".bb-tier-btn"), function (btn) {
          btn.classList.toggle("is-active", Number(btn.dataset.value) === clamped);
        });
        if (field.key === "typeScale") {
          /* 清除子字段覆盖时直接回退到主题预设 */
          ["h1Scale", "h2Scale"].forEach(function (k) {
            tierGroup.querySelectorAll(".bb-tier-btn[data-field='" + k + "']").forEach(function (b) {
              b.classList.toggle("is-active", b.dataset.value === "1");
            });
          });
        }
        renderAll();
      }
      (field.tiers || []).forEach(function (tier) {
        const btn = el("button", "bb-tier-btn" + (initialValue === tier ? " is-active" : ""), String(tier));
        btn.type = "button";
        btn.dataset.value = String(tier);
        btn.addEventListener("click", function () { applyValue(tier); });
        tierGroup.appendChild(btn);
      });
      numInput.addEventListener("change", function () { applyValue(numInput.value); });
      tierGroup.appendChild(numInput);
      if (cur == null && field.key !== "typeScale") {
        const resetAnchor = el("a", "bb-tweak-clear", "恢复默认");
        resetAnchor.addEventListener("click", function () {
          if (state.doc.themeOverrides) delete state.doc.themeOverrides[field.key];
          renderAll(); maskRemove();
        });
        tierGroup.appendChild(resetAnchor);
      }
      row.appendChild(tierGroup);
      body.appendChild(row);
    });

    section("字重");
    TYPE_WEIGHT_FIELDS.forEach(function (field) {
      const cur = themeOverride(field.key);
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", field.label));
      const sel = el("select", "bb-tweak-select");
      WEIGHT_OPTIONS.forEach(function (w) {
        const opt = el("option", null, w);
        opt.value = w;
        sel.appendChild(opt);
      });
      UI.ensureSelectValue(sel, cur != null ? cur : (base[field.key] || "700"));
      sel.addEventListener("change", function () {
        state.doc.themeOverrides = state.doc.themeOverrides || {};
        state.doc.themeOverrides[field.key] = sel.value;
        renderAll();
      });
      row.appendChild(sel);
      body.appendChild(row);
    });

    section("间距");
    TYPE_SPACING_FIELDS.forEach(function (field) {
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", field.label));
      const tierGroup = el("div", "bb-tier-group");
      const cur = themeOverride(field.key);
      const preset = field.key === "lineHeight" ? 1.35 : 0;
      const initialValue = cur != null ? Number(cur) : (base[field.key] != null ? Number(base[field.key]) : preset);
      const numInput = el("input", "bb-tier-num");
      numInput.type = "number";
      numInput.min = String(field.min);
      numInput.max = String(field.max);
      numInput.step = String(field.step);
      numInput.value = String(initialValue);
      function applyValue(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        const clamped = Math.max(field.min, Math.min(field.max, n));
        numInput.value = String(clamped);
        state.doc.themeOverrides = state.doc.themeOverrides || {};
        state.doc.themeOverrides[field.key] = clamped;
        Array.prototype.forEach.call(tierGroup.querySelectorAll(".bb-tier-btn"), function (btn) {
          btn.classList.toggle("is-active", Number(btn.dataset.value) === clamped);
        });
        renderAll();
      }
      (field.tiers || []).forEach(function (tier) {
        const btn = el("button", "bb-tier-btn" + (initialValue === tier ? " is-active" : ""), String(tier));
        btn.type = "button";
        btn.dataset.value = String(tier);
        btn.addEventListener("click", function () { applyValue(tier); });
        tierGroup.appendChild(btn);
      });
      numInput.addEventListener("change", function () { applyValue(numInput.value); });
      tierGroup.appendChild(numInput);
      row.appendChild(tierGroup);
      body.appendChild(row);
    });

    section("颜色");
    TYPE_COLOR_FIELDS.forEach(function (field) {
      const cur = themeOverride(field.key);
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", field.label));
      const colorInput = el("input", "bb-tweak-input");
      colorInput.type = "color";
      colorInput.value = hexToColor(cur != null ? cur : (base[field.key] || "#333333"));
      colorInput.addEventListener("input", function () {
        state.doc.themeOverrides = state.doc.themeOverrides || {};
        state.doc.themeOverrides[field.key] = colorInput.value;
        renderAll();
      });
      row.appendChild(colorInput);
      if (cur != null) {
        const clear = el("a", "bb-tweak-clear", "恢复默认");
        clear.addEventListener("click", function () {
          if (state.doc.themeOverrides) delete state.doc.themeOverrides[field.key];
          renderAll(); maskRemove();
        });
        row.appendChild(clear);
      }
      body.appendChild(row);
    });

    modal.appendChild(body);
    const actionRow = el("div", "bb-modal-actions");
    const resetAll = el("button", "bb-btn ghost", "全部恢复默认");
    resetAll.type = "button";
    resetAll.addEventListener("click", function () {
      /* 保留 themeOverrides 中非排版的 key（如果有） */
      const keepKeys = ["primary", "primaryDark", "primarySoft", "accent", "accentSoft", "line", "soft",
        "cardStyle", "radius", "shadow", "divider", "chips", "titleDecor", "pattern", "avatarStyle"];
      const newOverrides = {};
      Object.keys(state.doc.themeOverrides || {}).forEach(function (k) {
        if (keepKeys.indexOf(k) >= 0) newOverrides[k] = state.doc.themeOverrides[k];
      });
      state.doc.themeOverrides = newOverrides;
      renderAll(); maskRemove();
    });
    const closeBtn = el("button", "bb-btn primary", "完成");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () { maskRemove(); });
    actionRow.appendChild(resetAll);
    actionRow.appendChild(closeBtn);
    modal.appendChild(actionRow);
    mask.appendChild(modal);
    mask.addEventListener("click", function (e) { if (e.target === mask) maskRemove(); });
    document.body.appendChild(mask);

    function maskRemove() {
      closeA11y();
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
    }
  }

  function refreshFontSelects() {
    if (F && F.refreshFontSelects) F.refreshFontSelects();
  }

  /* ===== 字体导入弹窗 ===== */
  function showFontImportModal() {
    var importer = global.BannerBuilderFontImporter;
    var existing = document.getElementById("bb-font-import-modal");
    if (existing) { existing.parentNode.removeChild(existing); }

    var mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-font-import-modal";
    var modal = document.createElement("div");
    modal.className = "bb-modal";
    var title = el("h3", null, "导入自定义字体");
    modal.appendChild(title);
    var note = el("p", null, "支持常见计算机字体格式（TTF/OTF/WOFF/WOFF2）；会离线存储在本浏览器，不在线传输。");
    modal.appendChild(note);

    if (!importer || !importer.isAvailable || !importer.isAvailable()) {
      var errorBox = el("div", "bb-modal-error", "字体导入组件未加载，请刷新页面后重试。");
      modal.appendChild(errorBox);
      var closeBtnOnly = el("div", "bb-modal-actions");
      var onlyClose = el("button", "bb-btn primary", "关闭");
      onlyClose.type = "button";
      onlyClose.addEventListener("click", function () { mask.parentNode.removeChild(mask); });
      closeBtnOnly.appendChild(onlyClose);
      modal.appendChild(closeBtnOnly);
      mask.appendChild(modal);
      mask.addEventListener("click", function (e) { if (e.target === mask) mask.parentNode.removeChild(mask); });
      document.body.appendChild(mask);
      return;
    }

    /* BB-R14：字体导入前校验（格式白名单 + 在线字体 URL 不存储 Blob）
       参考 BannerBuilderFontImporter.isSupported 的 MIME 表，
       在线字体 URL 的标准格式是字体的原始 CDN 链接（如 Google Fonts .woff2），
       不应该转换为 blob 重新编码存储。
       MIME 白名单 + 在线 URL 短路校验在 UI 层做一道防御。 */
    var infoDiv = el("div");
    infoDiv.style.cssText = "margin-bottom:10px;font-size:11px;color:#888";
    var fileCountSpan = el("span", null, "等待选择...");
    infoDiv.appendChild(fileCountSpan);
    modal.appendChild(infoDiv);

    /* 表头 */
    var table = el("div", "bb-font-table");
    var headerRow = el("div", "bb-font-header");
    headerRow.appendChild(el("span", "bb-font-col", "字体名"));
    headerRow.appendChild(el("span", "bb-font-col", "状态"));
    headerRow.appendChild(el("span", "bb-font-col", "操作"));
    table.appendChild(headerRow);
    modal.appendChild(table);

    var pendingRows = [];

    /* 池化 sendRow 批量写入，降低 DOM 突变频率 */
    var _pool = [];

    function sendRow(span, label, value) {
      _pool.push({ span: span, label: label, value: value });
    }

    var update = function () {
      /* 大字体表优先检查基准长度 —— 避免不必要的对象创建 */
      if (!_pool.length) { return; }
      var entries = _pool;
      _pool = [];

      if (!entries.length) { return; }

      if (importer && typeof importer.send === "function") {
        importer.send(entries, function (allDone) {
          var entriesDone = Array.isArray(allDone) ? allDone : [];
          var doneByKey = {};
          entriesDone.forEach(function (d) { doneByKey[d.key] = d; });

          /* 逐行回写 —— 写入完成后统一更新数据源+刷新 UI */
          pendingRows.forEach(function (entry, _index) {
            var row = entry.row; var file = entry.file;
            if (!row || !file) return;
            var d = doneByKey[file.name];
            if (!d) {
              row.status.textContent = "写入失败";
              row.status.style.color = "#c0392b";
              return;
            }
            if (d.errors && d.errors.length) {
              row.status.textContent = "校验不通过：" + d.errors.join("；");
              row.status.style.color = "#c0392b";
              return;
            }
            row.status.textContent = "完成";
            row.status.style.color = "#27ae60";
          });

          /* 刷新字体常数池 + 字体下拉 */
          importer.applyToConstants();
          refreshFontSelects();
        });
        return;
      }

      /* Fallback：无 importer.send 回退逐文件 send */
      entries.forEach(function (entry) {
        if (importer && typeof importer.send === "function") {
          importer.send(entry);
        }
      });
    };

    var fileHandler = function (files) {
      Array.from(files).forEach(function (file) {
        var row = el("div", "bb-font-row");
        var nameSpan = el("span", "bb-font-col", file.name);
        row.appendChild(nameSpan);

        var statusSpan = el("span", "bb-font-col", "就绪");
        row.appendChild(statusSpan);

        var actionSpan = el("span", "bb-font-col");
        var importBtn = el("button", "bb-mini-btn", "导入");
        importBtn.type = "button";
        importBtn.addEventListener("click", function () {
          statusSpan.textContent = "写入中...";
          statusSpan.style.color = "#f39c12";
          entry.sent = true;
          var buffer = null;
          var reader = new FileReader();
          reader.onload = function () {
            buffer = reader.result;
            /* 在线字体 URL 空 Blob 兜底：若无数据且文件名含 http，标记为空 URL 防死循环 */
            if (buffer && buffer.byteLength > 0) {
              sendRow(statusSpan, file.name, buffer);
              return;
            }
            if (/^https?:\/\//i.test(file.name || "")) {
              statusSpan.textContent = "在线字体请直接粘贴网址";
              statusSpan.style.color = "#c0392b";
              return;
            }
            statusSpan.textContent = "文件为空";
            statusSpan.style.color = "#c0392b";
          };
          reader.onerror = function () {
            statusSpan.textContent = "读取失败";
            statusSpan.style.color = "#c0392b";
          };
          reader.readAsArrayBuffer(file);
        });
        actionSpan.appendChild(importBtn);

        var removeBtn = el("button", "bb-icon-btn danger", "×");
        removeBtn.type = "button";
        removeBtn.title = "移除";
        removeBtn.addEventListener("click", function () {
          var idx = pendingRows.indexOf(entry);
          if (idx >= 0) pendingRows.splice(idx, 1);
          row.parentNode && row.parentNode.removeChild(row);
          fileCountSpan.textContent = "已选择 " + pendingRows.length + " 个文件";
        });
        actionSpan.appendChild(removeBtn);

        row.appendChild(actionSpan);
        table.appendChild(row);

        var entry = { file: file, row: { row: row, status: statusSpan }, sent: false };
        pendingRows.push(entry);
      });
      fileCountSpan.textContent = "已选择 " + pendingRows.length + " 个文件";
      if (!_importTimer) {
        _importTimer = setTimeout(function () { _importTimer = null; update(); }, 400);
      }
      input.value = "";
    };

    var _importTimer = null;
    var dropZone = el("div", "bb-drop-zone", "点击选择文件 或 拖放字体文件到此处\n（TTF/OTF/WOFF/WOFF2）");
    var input = el("input");
    input.type = "file";
    input.accept = ".ttf,.otf,.woff,.woff2";
    input.multiple = true;
    input.className = "bb-file-input";
    input.addEventListener("change", function () { fileHandler(input.files); });
    dropZone.appendChild(input);
    dropZone.addEventListener("dragover", function (e) { e.preventDefault(); dropZone.classList.add("dragover"); });
    dropZone.addEventListener("dragleave", function () { dropZone.classList.remove("dragover"); });
    dropZone.addEventListener("drop", function (e) { e.preventDefault(); dropZone.classList.remove("dragover"); if (e.dataTransfer && e.dataTransfer.files) fileHandler(e.dataTransfer.files); });
    dropZone.addEventListener("click", function (e) { if (e.target !== input) input.click(); });
    modal.insertBefore(dropZone, modal.querySelector(".bb-font-table"));

    /* 在线字体链接面板 */
    var urlPanel = el("div");
    urlPanel.style.cssText = "margin-top:12px;padding:10px;background:#f8f9fa;border-radius:6px";
    var urlTitle = el("p", null, "在线字体链接");
    urlTitle.style.cssText = "margin:0 0 8px;font-size:12px;color:#555";
    urlPanel.appendChild(urlTitle);
    var urlRow = el("div");
    urlRow.style.cssText = "display:flex;gap:8px";
    var urlInput = el("input", "bb-input");
    urlInput.placeholder = "粘贴在线字体 .woff2 URL（如 Google Fonts）";
    urlInput.style.cssText = "flex:1";
    urlRow.appendChild(urlInput);
    var urlBtn = el("button", "bb-btn primary", "注册在线字体");
    urlBtn.type = "button";
    urlBtn.addEventListener("click", function () {
      var raw = urlInput.value.trim();
      if (!raw) return;
      var decoded = null;
      try { decoded = decodeURIComponent(raw); } catch (e) { /* use raw */ }
      var url = decoded || raw;
      /* BB-R14：在线字体 URL 验证 —— 正则放行已知 CDN 与服务商域名 */
      var onlineUrl = /^https:\/\/fonts\.(googleapis|gstatic)\.com\/|\.woff2(\?|$)|\.ttf(\?|$)|\.otf(\?|$)|\.woff(\?|$)/i.test(url);
      if (!onlineUrl) {
        if (global.alert) global.alert("在线字体 URL 格式不支持，请确认是 .woff2 / .ttf / .otf / .woff 的完整链接。");
        return;
      }
      if (importer && typeof importer.send === "function") {
        var label = url.split("/").pop().split("?")[0] || url;
        importer.send([{ label: label, url: url, type: "online" }]).then(function () {
          importer.applyToConstants();
          refreshFontSelects();
          urlInput.value = "";
          if (global.alert) global.alert("在线字体已注册。");
        }).catch(function () {
          if (global.alert) global.alert("注册失败，请检查链接是否可访问。");
        });
      } else {
        if (global.alert) global.alert("字体组件未就绪，请刷新重试。");
      }
    });
    urlBtn.style.cssText = "flex-shrink:0";
    urlRow.appendChild(urlBtn);
    urlPanel.appendChild(urlRow);
    modal.appendChild(urlPanel);

    var actionRow = el("div", "bb-modal-actions");
    var doneBtn = el("button", "bb-btn primary", "完成");
    doneBtn.type = "button";
    doneBtn.addEventListener("click", function () { mask.parentNode.removeChild(mask); });
    actionRow.appendChild(doneBtn);
    modal.appendChild(actionRow);
    mask.appendChild(modal);
    mask.addEventListener("click", function (e) { if (e.target === mask) mask.parentNode.removeChild(mask); });
    document.body.appendChild(mask);
  }

  function arrayBufferFromDataUrl(dataUrl) {
    if (typeof dataUrl !== "string" || dataUrl.indexOf(",") < 0) { return null; }
    try {
      var raw = atob(dataUrl.split(",", 2)[1]);
      var buf = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) { buf[i] = raw.charCodeAt(i); }
      return buf.buffer;
    } catch (e) { return null; }
  }

  global.BannerBuilderModals = {
    setState: setState,
    setContext: setContext,
    showMissingFontMapper: showMissingFontMapper,
    showThemeImportModal: showThemeImportModal,
    showThemeTweakModal: showThemeTweakModal,
    showBackgroundTweakModal: showBackgroundTweakModal,
    showTypeTweakModal: showTypeTweakModal,
    showFontImportModal: showFontImportModal,
    refreshFontSelects: refreshFontSelects,
    rebuildThemeSelect: rebuildThemeSelect,
  };
})(window);

/* BannerBuilder Events & Interaction Layer
 * 依赖：BannerBuilderModel（M），以及通过 setContext 注入的回调。
 * 暴露：BannerBuilderEvents.bindEvents, .openModalA11y
 */
(function (global) {
  "use strict";

  var M  = global.BannerBuilderModel;
  var state  = null;
  var els    = {};
  var ctx    = {};

  /* ─── 注入：main 调用 setState / setContext 后 bindEvents 才可用 ─── */
  function setState(s)    { state = s; }
  function setContext(c)  { ctx = c || {}; els = ctx.els || {}; }

  /* ─── 转发辅助（让 bindEvents 内原始调用点原样保留，便于 diff）────── */
  function renderAll()                     { return ctx.renderAll(); }
  function renderToolbar()                 { return ctx.renderToolbar(); }
  function renderCanvas()                  { return ctx.renderCanvas(); }
  function renderPanel()                   { return ctx.renderPanel(); }
  function saveDraft()                     { return ctx.saveDraft(); }
  function loadDraft(file)                 { return ctx.loadDraft(file); }
  function addCustomModuleToPage(id)       { return ctx.addCustomModuleToPage(id); }
  function afterAddModule(module)          { return ctx.afterAddModule(module); }
  function deleteMyTemplate(id)            { return ctx.deleteMyTemplate(id); }
  function addTemplateToPage(id)           { return ctx.addTemplateToPage(id); }
  function saveSelectedModuleAsTemplate()  { return ctx.saveSelectedModuleAsTemplate(); }
  function showThemeImportModal()          { return ctx.showThemeImportModal(); }
  function showModuleImportModal()         { return ctx.showModuleImportModal(); }
  function showAiDocumentModal()           { return ctx.showAiDocumentModal(); }
  function computeFitZoom()                { return ctx.computeFitZoom(); }
  function continuousMode()                { return ctx.continuousMode(); }
  function scrollCanvasToBottom()          { return ctx.scrollCanvasToBottom(); }
  function scrollSelectedIntoView()        { return ctx.scrollSelectedIntoView(); }
  function activePage()                    { return ctx.activePage(); }
  function collectBlobUrls(v, s)           { return ctx.collectBlobUrls(v, s); }
  function refreshProtectedBlobUrls()      { return ctx.refreshProtectedBlobUrls(); }
  function revokeBlobUrl(url)              { return ctx.revokeBlobUrl(url); }
  function isProtectedBlobUrl(url)         { return ctx.isProtectedBlobUrl(url); }

  /* ===== 主事件绑定 ===== */
  function bindEvents() {    if (els.ratioGroup) els.ratioGroup.addEventListener("click", function (event) { const button = event.target.closest("[data-ratio]"); if (!button) return; state.doc.ratio = button.dataset.ratio; renderAll(); });
    if (els.screenModeGroup) els.screenModeGroup.addEventListener("click", function (event) { const button = event.target.closest("[data-screen]"); if (!button) return; state.doc.screenMode = button.dataset.screen; renderAll(); });
    els.addPageBtn.addEventListener("click", function () {
      const page = M.addPage(state.doc); state.activePageId = page.id; state.selectedModuleId = null; renderAll();
      if (continuousMode()) scrollCanvasToBottom();
    });
    els.saveDraftBtn.addEventListener("click", saveDraft);
    els.zoomOutBtn.addEventListener("click", function () { state.zoomManual = true; state.zoom = Math.max(.15, state.zoom - .05); renderToolbar(); renderCanvas(); });
    els.zoomInBtn.addEventListener("click", function () { state.zoomManual = true; state.zoom = Math.min(1.5, state.zoom + .05); renderToolbar(); renderCanvas(); });
    els.zoomFitBtn.addEventListener("click", function () { state.zoomManual = true; state.zoom = computeFitZoom(); renderToolbar(); renderCanvas(); });
    els.loadDraftInput.addEventListener("change", function () { if (this.files && this.files[0]) loadDraft(this.files[0]); this.value = ""; });
    els.libraryList.addEventListener("click", function (event) { const custom = event.target.closest("[data-action='lib-add-custom']"); if (custom) { addCustomModuleToPage(custom.dataset.customId); return; } const button = event.target.closest("[data-action='lib-add']"); if (!button) return; const module = M.addModule(state.doc, activePage().id, button.dataset.type); if (!module) return; afterAddModule(module); });
    els.myTplList.addEventListener("click", function (event) { const del = event.target.closest("[data-action='tpl-del']"); if (del) { deleteMyTemplate(del.dataset.tplId); return; } const add = event.target.closest("[data-action='tpl-add']"); if (add) addTemplateToPage(add.dataset.tplId); });
    /* BB-R19：我的模板键盘操作（Enter/Space 触发添加） */
    els.myTplList.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const add = event.target.closest("[data-action='tpl-add']");
      if (!add) return;
      event.preventDefault();
      addTemplateToPage(add.dataset.tplId);
    });
    els.panelBody.addEventListener("click", function (event) { const target = event.target.closest("[data-action='save-tpl']"); if (target) saveSelectedModuleAsTemplate(); });
    els.canvasBody.addEventListener("click", function (event) { const target = event.target.closest("[data-action]"); if (!target) return; const action = target.dataset.action; const moduleId = target.dataset.moduleId; const pageId = target.dataset.pageId; if (action === "page-pick") { state.activePageId = pageId; state.selectedModuleId = null; renderAll(); return; } if (action === "module-pick") { state.selectedModuleId = moduleId; state.activePageId = M.findModule(state.doc, moduleId).page.id; renderAll(); return; } if (action === "page-del") { const page = M.findPage(state.doc, pageId); if (page.modules.length && !global.confirm("这一屏还有内容，确定删除吗？")) return; M.removePage(state.doc, pageId); state.activePageId = activePage().id; state.selectedModuleId = null; renderAll(); return; } if (action === "module-up" || action === "module-down") { event.stopPropagation(); M.moveModule(state.doc, moduleId, action === "module-up" ? -1 : 1); renderAll(); return; } if (action === "module-del") { event.stopPropagation(); M.removeModule(state.doc, moduleId); state.selectedModuleId = null; renderAll(); } });
    if (els.importThemeBtn) els.importThemeBtn.addEventListener("click", showThemeImportModal);
    if (els.importModuleBtn) els.importModuleBtn.addEventListener("click", showModuleImportModal);
    if (els.generateAiDocumentBtn) els.generateAiDocumentBtn.addEventListener("click", showAiDocumentModal);
    /* ===== 三步向导切换 ===== */
    if (els.stepBar) els.stepBar.addEventListener("click", function (event) {
      const button = event.target.closest(".bb-step[data-step]");
      if (!button) return;
      const next = button.dataset.step;
      if (next === state.step) return;
      state.step = next;
      /* 进入非编辑步骤清除选中，避免属性栏在库栏隐藏时残留孤板块面板 */
      if (next !== "edit") state.selectedModuleId = null;
      /* 步骤 0 主题背景 / 步骤 1 设置默认「板块库」，步骤 2 编辑默认「图层」（多图层树，方便选中与排序） */
      if (next === "theme-bg") state.sideView = "library";
      if (next === "setup") state.sideView = "library";
      if (next === "edit") state.sideView = "layers";
      renderAll();
    });
    /* ===== 导出倍率 ===== */
    if (els.exportScaleGroup) els.exportScaleGroup.addEventListener("click", function (event) {
      const button = event.target.closest("[data-scale]");
      if (!button) return;
      state.doc.exportScale = Number(button.dataset.scale);
      renderToolbar(); renderPanel();
    });
    /* ===== 左侧栏：板块库 / 图层 切换 ===== */
    if (els.sideTabs) els.sideTabs.addEventListener("click", function (event) {
      const button = event.target.closest("[data-side]");
      if (!button || button.dataset.side === state.sideView) return;
      state.sideView = button.dataset.side;
      renderAll();
    });
    /* ===== BB-R20：tablist 键盘规范（roving tabindex + 左右方向键 + Home/End） =====
       适用于步骤条（stepBar）与左侧视图切换（sideTabs）两个 tablist。 */
    function bindTablistKeyboard(container, selector) {
      if (!container) return;
      const buttons = function () { return Array.prototype.slice.call(container.querySelectorAll(selector)); };
      /* roving tabindex：仅激活 tab 可 Tab 聚焦，其余 tabindex=-1 */
      const syncRoving = function () {
        buttons().forEach(function (button) {
          const selected = button.getAttribute("aria-selected") === "true";
          button.tabIndex = selected ? 0 : -1;
        });
      };
      syncRoving();
      /* renderAll 重建 DOM 后重新同步：MutationObserver 免引入，直接在每次键盘/点击后同步 */
      container.addEventListener("click", function () { setTimeout(syncRoving, 0); });
      container.addEventListener("keydown", function (event) {
        const current = event.target.closest(selector);
        if (!current) return;
        const all = buttons();
        const index = all.indexOf(current);
        let next = -1;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % all.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + all.length) % all.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = all.length - 1;
        if (next < 0) return;
        event.preventDefault();
        all[next].focus();
        all[next].click();
      });
    }
    bindTablistKeyboard(els.stepBar, ".bb-step[data-step]");
    bindTablistKeyboard(els.sideTabs, "[data-side]");
    /* ===== 图层树操作：选中屏 / 选中板块 / 删除屏 / 排序 / 删除板块 ===== */
    if (els.layerTree) els.layerTree.addEventListener("click", function (event) {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action; const moduleId = target.dataset.moduleId; const pageId = target.dataset.pageId;
      if (action === "layer-page-pick") { state.activePageId = pageId; state.selectedModuleId = null; renderAll(); return; }
      if (action === "layer-page-del") {
        const page = M.findPage(state.doc, pageId);
        if (page.modules.length && !global.confirm("这一屏还有内容，确定删除吗？")) return;
        /* BB-R12：删除前收集该屏全部 blob URL，删除后刷新保护集合，释放不再被引用的图片 */
        const doomed = new Set();
        collectBlobUrls(page, doomed);
        M.removePage(state.doc, pageId);
        state.activePageId = activePage().id;
        state.selectedModuleId = null;
        refreshProtectedBlobUrls();
        doomed.forEach(function (url) { if (!isProtectedBlobUrl(url)) revokeBlobUrl(url); });
        renderAll();
        return;
      }
      if (action === "layer-module-pick") { state.selectedModuleId = moduleId; state.activePageId = M.findModule(state.doc, moduleId).page.id; if (state.step === "setup") state.step = "edit"; renderAll(); if (continuousMode()) scrollSelectedIntoView(); return; }
      if (action === "layer-module-up" || action === "layer-module-down") { event.stopPropagation(); M.moveModule(state.doc, moduleId, action === "layer-module-up" ? -1 : 1); renderAll(); return; }
      if (action === "layer-module-del") {
        event.stopPropagation();
        /* BB-R12：删除板块前收集其 blob URL，删除后释放（同一图被其他板块复用时保护集合会拦截） */
        const hit = M.findModule(state.doc, moduleId);
        const doomed = new Set();
        if (hit && hit.module) collectBlobUrls(hit.module, doomed);
        M.removeModule(state.doc, moduleId);
        state.selectedModuleId = null;
        refreshProtectedBlobUrls();
        doomed.forEach(function (url) { if (!isProtectedBlobUrl(url)) revokeBlobUrl(url); });
        renderAll();
      }
    });
    /* ===== BB-R19：图层树键盘操作（Enter/Space 选中、↑↓ 排序、PageUp/PageDown 跨屏） ===== */
    if (els.layerTree) els.layerTree.addEventListener("keydown", function (event) {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      const moduleId = target.dataset.moduleId;
      const pageId = target.dataset.pageId;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (action === "layer-page-pick") { state.activePageId = pageId; state.selectedModuleId = null; renderAll(); }
        else if (action === "layer-module-pick") { state.selectedModuleId = moduleId; state.activePageId = M.findModule(state.doc, moduleId).page.id; if (state.step === "setup") state.step = "edit"; renderAll(); if (continuousMode()) scrollSelectedIntoView(); }
        return;
      }
      if (action !== "layer-module-pick") return;
      if (event.key === "ArrowUp") { event.preventDefault(); M.moveModule(state.doc, moduleId, -1); renderAll(); refocusLayerRow(moduleId); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); M.moveModule(state.doc, moduleId, 1); renderAll(); refocusLayerRow(moduleId); return; }
      /* 拖拽跨屏的键盘替代：PageUp 移至上一屏末尾 / PageDown 移至下一屏开头 */
      if (event.key === "PageUp" || event.key === "PageDown") {
        event.preventDefault();
        const hit = M.findModule(state.doc, moduleId);
        if (!hit || !hit.page) return;
        const pages = state.doc.pages;
        const currentIndex = pages.indexOf(hit.page);
        const targetIndex = currentIndex + (event.key === "PageUp" ? -1 : 1);
        if (targetIndex < 0 || targetIndex >= pages.length) return;
        M.moveModuleAcross(state.doc, moduleId, pages[targetIndex].id, null);
        state.selectedModuleId = moduleId;
        state.activePageId = pages[targetIndex].id;
        if (state.step === "setup") state.step = "edit";
        renderAll();
        refocusLayerRow(moduleId);
      }
    });
    /* 键盘操作后把焦点还给同一模块行（renderAll 重建了 DOM） */
    function refocusLayerRow(moduleId) {
      const row = els.layerTree && els.layerTree.querySelector(".bb-layer-module[data-module-id='" + moduleId + "']");
      if (row) { try { row.focus(); } catch (e) { /* ignore */ } }
    }
    /* ===== 图层树跨屏拖拽：板块行可拖到任意屏的模块列表（目标屏），实现跨屏移动 ===== */
    if (els.layerTree) {
      let dragModuleId = null;
      els.layerTree.addEventListener("dragstart", function (event) {
        const row = event.target.closest("[data-drag-module]");
        if (!row) return;
        dragModuleId = row.dataset.dragModule;
        try { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", dragModuleId); } catch (e) { /* ignore */ }
        row.classList.add("is-dragging");
      });
      els.layerTree.addEventListener("dragend", function (event) {
        [].slice.call(els.layerTree.querySelectorAll(".is-dragging")).forEach(function (n) { n.classList.remove("is-dragging"); });
        [].slice.call(els.layerTree.querySelectorAll(".bb-drop-over")).forEach(function (n) { n.classList.remove("bb-drop-over"); });
        dragModuleId = null;
      });
      els.layerTree.addEventListener("dragover", function (event) {
        if (!dragModuleId) return;
        const list = event.target.closest("[data-drop-target='page']");
        if (!list) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        [].slice.call(els.layerTree.querySelectorAll(".bb-drop-over")).forEach(function (n) { if (n !== list) n.classList.remove("bb-drop-over"); });
        list.classList.add("bb-drop-over");
      });
      els.layerTree.addEventListener("drop", function (event) {
        const list = event.target.closest("[data-drop-target='page']");
        if (!list || !dragModuleId) return;
        event.preventDefault();
        const targetPageId = list.dataset.pageId;
        /* 计算目标下标：落在某模块行上半部 → 插到该行之前；下半部 → 之后；空列表 → 末尾 */
        let targetIndex = -1;
        const rowUnder = event.target.closest("[data-drag-module]");
        if (rowUnder) {
          const hostPage = list.dataset.pageId;
          const hit = M.findModule(state.doc, rowUnder.dataset.dragModule);
          if (hit.module && hit.page.id === hostPage) {
            const rect = rowUnder.getBoundingClientRect();
            const before = (event.clientY - rect.top) < rect.height / 2;
            targetIndex = hit.index + (before ? 0 : 1);
          }
        }
        M.moveModuleAcross(state.doc, dragModuleId, targetPageId, targetIndex < 0 ? null : targetIndex);
        state.selectedModuleId = dragModuleId;
        state.activePageId = targetPageId;
        if (state.step === "setup") state.step = "edit";
        renderAll();
      });
    }
    /* 图层视图里新增屏（与顶部「新增屏」一致） */
    if (els.addPageBtnSide) els.addPageBtnSide.addEventListener("click", function () {
      const page = M.addPage(state.doc); state.activePageId = page.id; state.selectedModuleId = null; renderAll();
      if (continuousMode()) scrollCanvasToBottom();
    });
  }

  /* ===== BB-R20：弹窗统一焦点管理 =====
     openModalA11y(mask, modal, opts)：
     - 补 role=dialog / aria-modal / aria-labelledby（标题元素需有 id）；
     - 打开时记录当前焦点，聚焦首个关键控件（默认 modal 内第一个 button/select/input）；
     - Escape 关闭（走 opts.close）；
     - Tab 循环约束在弹窗内；
     - 关闭时恢复原焦点。
     返回 cleanup 函数，关闭弹窗时必须调用。 */
  function openModalA11y(mask, modal, opts) {
    mask.setAttribute("role", "dialog");
    mask.setAttribute("aria-modal", "true");
    if (opts && opts.titleId) {
      if (!document.getElementById(opts.titleId)) { /* 标题无 id 时补挂 */ }
      modal.setAttribute("aria-labelledby", opts.titleId);
    }
    const opener = document.activeElement;
    const close = (opts && opts.close) || function () { if (mask.parentNode) mask.parentNode.removeChild(mask); };
    const focusables = function () {
      return Array.prototype.slice.call(modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter(function (node) {
        return !node.disabled && node.offsetParent !== null;
      });
    };
    const onKeydown = function (event) {
      if (event.key === "Escape") { event.stopPropagation(); cleanup(); close(); return; }
      if (event.key === "Tab") {
        const all = focusables();
        if (!all.length) return;
        const first = all[0]; const last = all[all.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        else if (modal.indexOf && modal.contains && !modal.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeydown, true);
    function cleanup() {
      document.removeEventListener("keydown", onKeydown, true);
      if (opener && typeof opener.focus === "function") { try { opener.focus(); } catch (e) { /* ignore */ } }
    }
    /* 打开即聚焦首个控件（textarea 类粘贴区不抢焦点，聚焦第一个按钮/输入） */
    const initial = focusables().filter(function (node) { return node.tagName !== "TEXTAREA"; })[0];
    if (initial) { try { initial.focus(); } catch (e) { /* ignore */ } }
    return cleanup;
  }

  global.BannerBuilderEvents = {
    setState: setState,
    setContext: setContext,
    bindEvents: bindEvents,
    openModalA11y: openModalA11y,
  };
})(window);
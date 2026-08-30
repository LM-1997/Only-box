// 向导式分步显示模块（追加，不修改原逻辑）
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const steps = [
    { key: "template", panel: $("templatePanel"), nav: $("stepTemplate"), prev: null, next: $("wizardNextTemplate") },
    { key: "import", panel: $("importPanel"), nav: $("stepImport"), prev: $("wizardBackImport"), next: $("wizardNextImport") },
    { key: "export", panel: $("exportPanel"), nav: $("stepExport"), prev: $("wizardBackExport"), next: null }
  ];
  if (!steps[0].panel || steps.some(s => s.panel == null)) return;

  const chips = { template: null, import: null, export: null };
  const itemsWrap = $("itemsWrap");
  const current = { key: "template" };

  function apply(key, focusPanelHead) {
    current.key = key;
    steps.forEach(s => {
      if (!s.panel) return;
      const active = s.key === key;
      s.panel.hidden = !active;
      s.panel.classList.toggle("wizard-active", active);
      if (s.nav) s.nav.classList.toggle("wizard-nav-current", active);
      if (chips[s.key]) chips[s.key].hidden = !active;
    });
    if (itemsWrap) itemsWrap.hidden = key !== "export";
    const step = steps.find(s => s.key === key);
    if (step && step.panel && focusPanelHead) {
      try { step.panel.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { }
    }
  }

  steps.forEach(step => {
    if (step.next) step.next.addEventListener("click", () => {
      const idx = steps.indexOf(step);
      const target = steps[idx + 1];
      if (!target) return;
      if (step.key === "template" && !window.__badgeHasBackground) {
        const stage = document.getElementById("templateStage");
        if (stage) { stage.classList.add("wizard-shake"); setTimeout(() => stage.classList.remove("wizard-shake"), 600); }
      }
      apply(target.key, true);
    });
    if (step.prev) step.prev.addEventListener("click", () => {
      const idx = steps.indexOf(step);
      const target = steps[idx - 1];
      if (target) apply(target.key, true);
    });
    if (step.nav) step.nav.addEventListener("click", () => apply(step.key, true));
  });

  // 背景图状态：JS setBackground/clearBackground 只切 has-background 类，这里用轮询保持零侵入
  const stage = document.getElementById("templateStage");
  if (stage) {
    let last = null;
    setInterval(() => {
      const has = stage.classList.contains("has-background");
      if (has !== last) {
        last = has;
        window.__badgeHasBackground = has;
        steps.forEach(s => { if (s.next && s.key === "template") s.next.disabled = !has; });
      }
    }, 400);
  }

  apply("template", false);

  // 字体设置方式切换：选择默认字体 / 上传字体文件（主脚本的上传处理逻辑不变）
  const fontSegButtons = Array.from(document.querySelectorAll(".font-seg button"));
  const fontPickPane = $("fontPickPane");
  const fontUploadPane = $("fontUploadPane");
  if (fontSegButtons.length >= 2 && fontPickPane && fontUploadPane) {
    fontSegButtons.forEach((btn, idx) => btn.addEventListener("click", () => {
      const showUpload = idx === 1;
      fontPickPane.hidden = showUpload;
      fontUploadPane.hidden = !showUpload;
      fontSegButtons.forEach((other, k) => {
        const active = k === idx;
        other.classList.toggle("active", active);
        other.setAttribute("aria-selected", String(active));
      });
    }));
  }

  // 画布滚轮缩放：悬停画布滚动滚轮 → 缩放当前选中框（与拖拽移动互补）
  const stages = [
    { el: $("templateStage"), mode: "template" },
    { el: $("editorStage"), mode: "editor" }
  ];
  stages.forEach(({ el, mode }) => {
    if (!el) return;
    el.addEventListener("wheel", event => {
      if (!el.classList.contains("has-background") && mode === "template") return;
      const avatarZone = mode === "template" ? $("templateAvatarZone") : $("editorAvatarZone");
      const nameZone = mode === "template" ? $("templateNameZone") : $("editorNameZone");
      const target = avatarZone && avatarZone.classList.contains("selected") ? "avatar"
        : nameZone && nameZone.classList.contains("selected") ? "name" : null;
      if (!target) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.05 : 1 / 1.05;
      const rect = el.getBoundingClientRect();
      const relX = (event.clientX - rect.left) / rect.width;
      const relY = (event.clientY - rect.top) / rect.height;
      window.__badgeWheelScale && window.__badgeWheelScale(mode, target, factor, relX, relY);
    }, { passive: false });
  });
})();

// 在线字体按需加载模块（追加，不改主逻辑）
// 选中非本地字体 → 从 Google Fonts 拉取 CSS + woff2 → document.fonts 就绪后触发重绘
(function () {
  "use strict";
  const LOCAL = new Set(["Noto Sans SC", "Noto Sans", "Noto Sans JP", "NotoSansCJKsc"]);
  const loaded = new Map(); // family -> Promise<boolean>
  const statusEl = () => document.getElementById("webfontStatus");

  function setStatus(text, show) {
    const el = statusEl();
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !show;
  }

  function cssUrl(family) {
    const q = family.replace(/ /g, "+");
    return "https://fonts.googleapis.com/css2?family=" + q + ":wght@400;700&display=swap";
  }

  function mirrorUrl(family) {
    // googlefonts 在大陆不可达时的同源镜像（字体文件由 loli 镜像分发）
    const q = family.replace(/ /g, "+");
    return "https://fonts.loli.net/css2?family=" + q + ":wght@400;700&display=swap";
  }

  function injectCss(href) {
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.crossOrigin = "anonymous";
      link.onload = () => resolve(true);
      link.onerror = () => { link.remove(); reject(new Error("CSS_LOAD_FAILED")); };
      document.head.appendChild(link);
    });
  }

  async function waitFont(family) {
    try { await document.fonts.load("700 48px \"" + family + "\"", "永Aあ"); } catch (e) { }
    try { await document.fonts.load("400 48px \"" + family + "\"", "永Aあ"); } catch (e) { }
    return document.fonts.check("700 48px \"" + family + "\"", "永Aあ") || document.fonts.check("400 48px \"" + family + "\"", "永Aあ");
  }

  function ensureFont(family) {
    if (LOCAL.has(family)) return Promise.resolve(true);
    if (loaded.has(family)) return loaded.get(family);
    const task = (async () => {
      setStatus("正在加载在线字体：" + family + " ……", true);
      const attempts = [cssUrl(family), mirrorUrl(family)];
      for (const url of attempts) {
        try {
          await injectCss(url);
          const ok = await waitFont(family);
          if (ok) { setStatus("在线字体已就绪：" + family, true); setTimeout(() => setStatus("", false), 2500); return true; }
        } catch (e) { /* 尝试下一个源 */ }
      }
      setStatus("字体 " + family + " 加载失败（网络原因），将回退为默认字体渲染。", true);
      return false;
    })();
    loaded.set(family, task);
    return task;
  }

  function hookSelect(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", async () => {
      const family = el.value;
      const ok = await ensureFont(family);
      // 字体就绪/失败后重绘全部预览（模板画布 + 当前编辑器 + 缩略图）
      if (ok) {
        if (typeof window.__badgeRerenderAll === "function") window.__badgeRerenderAll();
      }
    });
  }

  ["fontFamilyZh", "fontFamilyEn", "fontFamilyJa", "editorFontFamilyZh", "editorFontFamilyEn", "editorFontFamilyJa"].forEach(hookSelect);
})();

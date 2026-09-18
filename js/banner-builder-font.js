(function (global) {
  "use strict";

  var C = global.BannerBuilderConstants;
  var fontLinks = {};
  var _state = null;

  function doc() { return _state ? _state.doc : null; }

  function ensureFont(key) {
    var f = C.FONTS[key] || C.FONTS.sans;
    (f.css || []).forEach(function (url) {
      if (fontLinks[url]) return;
      fontLinks[url] = true;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      /* crossorigin 必须声明：CDN 样式表（jsDelivr 等）虽返回 ACAO:*，但未声明 crossorigin 的
         跨源 <link> 会被浏览器封锁 cssRules（SecurityError）。导出链路 buildFontCss() 依赖
         cssRules 提取 @font-face 内联进位图化沙箱；缺失时导出位图回退系统字体，
         字宽/行高与预览不一致 → 换行点漂移 → 文字重叠（2026-09-14 CDN 化后引入）。 */
      link.crossOrigin = "anonymous";
      link.href = url;
      document.head.appendChild(link);
    });
    /* 单字体文件源（用户追加 / 本地字体）：无 @fontsource css 可引，改由 C.fontFaceFor
       合成 @font-face 内联注入，按 family 去重（同族只注入一次）。 */
    if (Array.isArray(f.src) && f.src.length) {
      var faceKey = "faceref:" + f.family;
      if (fontLinks[faceKey]) return;
      fontLinks[faceKey] = true;
      var css = C.fontFaceFor(f);
      if (!css) return;
      var style = document.createElement("style");
      style.id = "bb-font-face-" + key;
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  function showFontFallbackNotice(family) {
    if (document.getElementById("bb-font-notice")) return;
    var bar = document.createElement("div");
    bar.id = "bb-font-notice";
    bar.style.cssText = "margin:10px 0 0;padding:9px 13px;border:1px solid #e0c07a;border-radius:9px;background:#faf3df;color:#715b1e;font-size:12px;font-weight:700";
    bar.textContent = "\u5728\u7ebf\u5b57\u4f53\uff08" + family + "\uff09\u52a0\u8f7d\u5931\u8d25\uff0c\u5df2\u56de\u9000\u7cfb\u7edf\u8fd1\u4f3c\u5b57\u4f53\uff0c\u5bfc\u51fa\u6548\u679c\u53ef\u80fd\u4e0e\u9009\u62e9\u4e0d\u7b26\u3002";
    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "\u91cd\u8bd5\u52a0\u8f7d";
    retry.style.cssText = "margin-left:10px;padding:3px 10px;border:1px solid #715b1e;border-radius:6px;background:#fff8e1;color:#715b1e;font-size:12px;font-weight:700;cursor:pointer";
    retry.addEventListener("click", function () {
      Object.keys(fontLinks).forEach(function (k) { if (k.indexOf("faceref:") < 0) delete fontLinks[k]; });
      document.querySelectorAll("link[rel=stylesheet]").forEach(function (link) {
        if ((link.href || "").indexOf("fontsource") >= 0 || (link.href || "").indexOf("cn-fontsource") >= 0) link.remove();
      });
      Object.keys(C.FONTS).forEach(function (k) { ensureFont(k); });
      readyFontForText(docFontFamily(), "");
      bar.remove();
    });
    bar.appendChild(retry);
    var shell = document.querySelector(".bb-shell");
    if (shell && shell.parentNode) shell.parentNode.insertBefore(bar, shell);
  }

  async function readyFontForText(key, text) {
    var f = C.FONTS[key] || C.FONTS.sans;
    ensureFont(key);
    if (!document.fonts || typeof document.fonts.load !== "function") return;
    var payload = String(text || "Only-box \u6d3b\u52a8\u5ba3\u4f20\u957f\u6761 0123456789");
    try {
      /* 方案 \u00a72.2/\u00a76\uff1a\u6309\u5b57\u4f53\u5b9e\u9645\u6863\u4f4d\u5438\u9644\u540e\u7cbe\u51c6\u52a0\u8f7d\uff0c\u4e0d\u518d\u8bf7\u6c42\u6ce8\u5b9a\u4e0d\u5b58\u5728\u7684 700/900 \u6863\uff08\u4fee F1\uff09 */
      var w400 = C.snapWeight(f, 400), w700 = C.snapWeight(f, 700), w900 = C.snapWeight(f, 900);
      var wanted = [w400, w700, w900].filter(function (w, i, arr) { return arr.indexOf(w) === i; });
      var loaded = null;
      for (var wi = 0; wi < wanted.length; wi += 1) {
        var got = await document.fonts.load(wanted[wi] + ' 24px "' + f.family + '"', payload);
        if (wi === 0) loaded = got;
      }
      /* 方案 \u00a76.1\uff1acss \u7f13\u5b58\u547d\u4e2d\u65f6 load() \u4e0d\u629b\u9519\u4f46\u5b57\u4f53\u6587\u4ef6\u53ef\u80fd\u672a\u5230\u624b\u2014\u2014\u4ee5\u300c\u8be5 family \u5b58\u5728 loaded \u6001 face\u300d\u4e3a\u51c6 */
      var hasLoadedFace = (function () {
        var hit = false;
        if (document.fonts && document.fonts.forEach) {
          document.fonts.forEach(function (face) {
            if (hit) return;
            if (face.family === f.family && face.status === "loaded") hit = true;
          });
        }
        return hit;
      })();
      if ((!loaded || !loaded.length) && !hasLoadedFace) showFontFallbackNotice(f.family);
    } catch (error) {
      /* 字体加载失败（如断网）：使用回退字体渲染并提示（方案 \u00a76.1） */
      showFontFallbackNotice(f.family);
    }
  }

  /* 导出字体门禁：标题/正文两种角色的 webfont 全部就绪（含中文分片按需命中）才开始导出。 */
  async function readyFontsForPage(page) {
    if (!document.fonts || typeof document.fonts.load !== "function") return;
    var headingKey = (doc() ? doc().headingFont : null) || (doc() ? doc().fontFamily : null) || "sans";
    var bodyKey = (doc() ? doc().bodyFont : null) || headingKey;
    var payload = (((doc() ? doc().pages : null) || []).map(collectPageText).join(" ") + " " + collectPageText(page) + " 0123456789").slice(0, 4000);
    var jobs = [];
    [headingKey, bodyKey].forEach(function (key) {
      var f = C.FONTS[key];
      if (!f) return;
      ensureFont(key);
      /* 方案 \u00a76：吸附档位去重后加载（修 F1 加载侧） */
      var wanted = [C.snapWeight(f, 400), C.snapWeight(f, 700), C.snapWeight(f, 900)].filter(function (w, i, arr) { return arr.indexOf(w) === i; });
      wanted.forEach(function (weight) {
        try { jobs.push(document.fonts.load(weight + ' 24px "' + f.family + '"', payload)); } catch (error) { /* 忽略单档失败 */ }
      });
    });
    try { await Promise.all(jobs); if (document.fonts.ready) await document.fonts.ready; } catch (error) { /* 超时/失败时按已就绪字体导出 */ }
  }

  /* 方案 \u00a76.1：默认字体预载——消除首次点选字体的秒级等待（只预载默认 sans，不预载 43 款） */
  function preloadDefaultFont() {
    setTimeout(function () {
      try {
        var f = C.FONTS.sans;
        if (!f || !document.fonts || typeof document.fonts.load !== "function") return;
        [C.snapWeight(f, 400), C.snapWeight(f, 700)].forEach(function (w) {
          document.fonts.load(w + ' 24px "' + f.family + '"', "Only-box \u6d3b\u52a8\u5ba3\u4f20\u957f\u6761 0123456789");
        });
      } catch (error) { /* 预载失败不影响功能 */ }
    }, 2000);
  }

  function collectPageText(page) {
    var parts = [];
    (page.modules || []).forEach(function (module) {
      var data = module.data || {};
      Object.keys(data).forEach(function (key) {
        var value = data[key];
        if (typeof value === "string") parts.push(value);
        else if (Array.isArray(value)) value.forEach(function (item) {
          if (typeof item === "string") parts.push(item);
          else if (item) Object.keys(item).forEach(function (k) { if (typeof item[k] === "string") parts.push(item[k]); });
        });
      });
    });
    return parts.join(" ");
  }

  function docFontFamily() {
    return (doc() ? doc().fontFamily : null) || "sans";
  }

  function ensureDocFonts(d) {
    if (!d) return;
    if (d.headingFont) ensureFont(d.headingFont);
    if (d.bodyFont) ensureFont(d.bodyFont);
    if (d.fontFamily) ensureFont(d.fontFamily);
  }

  /* PSD 文字层字体名：标题层用标题字体，正文层用正文字体（分角色设置同步到 PS）。 */
  function psFontNameFor(scope) {
    var key = scope === "body"
      ? ((doc() ? doc().bodyFont : null) || (doc() ? doc().headingFont : null) || (doc() ? doc().fontFamily : null) || "sans")
      : ((doc() ? doc().headingFont : null) || (doc() ? doc().fontFamily : null) || "sans");
    var f = C.FONTS[key] || C.FONTS.sans;
    return f.family.replace(/ /g, "");
  }

  /* ===== 字体下拉重建（内置字体 + 用户导入字体） ===== */
  function refreshFontSelects() {
    /* 字体下拉已迁入右侧文档设置面板（renderPanel 每次重建），此处无需再同步顶部控件。
       保留函数供 bootstrapUserFonts / 字体导入流程调用，仅刷新 Constants 数据源。 */
  }

  /* 启动时载入用户已导入的字体（IndexedDB），注入 Constants 并刷新三个字体下拉。 */
  function bootstrapUserFonts() {
    var importer = global.BannerBuilderFontImporter;
    if (!importer || !importer.isAvailable() || typeof importer.refresh !== "function") return;
    importer.refresh().then(function (rows) {
      if (!rows || !rows.length) return;
      importer.applyToConstants();
      refreshFontSelects();
    });
  }

  global.BannerBuilderFont = {
    setState: function (s) { _state = s; },
    ensureFont: ensureFont,
    showFontFallbackNotice: showFontFallbackNotice,
    readyFontForText: readyFontForText,
    readyFontsForPage: readyFontsForPage,
    preloadDefaultFont: preloadDefaultFont,
    collectPageText: collectPageText,
    docFontFamily: docFontFamily,
    ensureDocFonts: ensureDocFonts,
    psFontNameFor: psFontNameFor,
    refreshFontSelects: refreshFontSelects,
    bootstrapUserFonts: bootstrapUserFonts,
  };
})(window);
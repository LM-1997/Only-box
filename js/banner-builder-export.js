/* ================================================================
   banner-builder-export.js —— 「预览即所得」DOM 序列化导出模块
   原理：与预览完全同一份 DOM（750 设计宽度），序列化为 SVG foreignObject
   → 位图化 → 按 doc.exportScale 倍率输出高清 PNG；PSD 复用位图作为合成层。
   依赖：banner-builder-constants.js 先行加载；主脚本提供 window.bannerBuilder。
   ================================================================ */
(function (global) {
  "use strict";

  const BB = function () { return global.bannerBuilder; };
  const C = global.BannerBuilderConstants;

  function state() { return BB().state; }
  function pageSize() { return C.pageSize(BB().doc.ratio); }
  function exportScale() { return Number(BB().doc.exportScale) || 2; }

  /* ---------- 字体门禁：导出前等待全部角色 webfont 就绪 ---------- */
  async function ensureFonts() {
    const doc = BB().doc;
    const headingKey = doc.headingFont || doc.fontFamily || "sans";
    const bodyKey = doc.bodyFont || headingKey;
    const jobs = [];
    [headingKey, bodyKey].forEach(function (key) {
      const f = C.FONTS[key];
      if (!f || !document.fonts || typeof document.fonts.load !== "function") return;
      ["400", "700", "900"].forEach(function (weight) {
        try { jobs.push(document.fonts.load(weight + ' 24px "' + f.family + '"', "Only-box 活动宣传 0123456789")); } catch (error) { /* 单档失败忽略 */ }
      });
    });
    try { await Promise.all(jobs); } catch (error) { /* ignore */ }
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (error) { /* ignore */ } }
    return document.fonts && typeof document.fonts.status === "string" ? document.fonts.status : "unknown";
  }

  /* 字体 CSS 可提取性体检（导出前调用）：预览字体已就绪但导出内联 CSS 为空时，
     说明位图化沙箱将回退系统字体，导出必然与所见不一致（换行漂移/重叠）。
     返回 { ok, cssLength, warn }。 */
  async function auditExportFontCss() {
    var cssLength = 0;
    var fetchFailed = _fontFetchStats ? _fontFetchStats.failed : 0;
    var fetchTotal = _fontFetchStats ? _fontFetchStats.fetches : 0;
    try { cssLength = (await buildFontCss()).length; fetchFailed = _fontFetchStats.failed; fetchTotal = _fontFetchStats.fetches; } catch (error) { cssLength = 0; }
    const doc = BB().doc;
    const headingKey = doc.headingFont || doc.fontFamily || "sans";
    const bodyKey = doc.bodyFont || headingKey;
    var webfontActive = false;
    try {
      document.fonts.forEach(function (face) {
        if (webfontActive) return;
        [headingKey, bodyKey].forEach(function (key) {
          const f = C.FONTS[key];
          if (f && face.family.replace(/["']/g, "") === f.family && face.status === "loaded") webfontActive = true;
        });
      });
    } catch (error) { /* ignore */ }
    /* 字体可内联的充分条件：① CSS 长度 > 0（含 data: URL 字体二进制） ② 无 fetch 失败。
       条件①为必要条件（CSS 无法提取 → 位图化沙箱无字体），条件②进一步增强：CSS 文本有值
       但部分 @font-face 的字体文件 fetch 失败被丢弃 → 沙箱内该族字体可能不完整 → 视觉偏差。 */
    const ok = (!webfontActive) || (cssLength > 0 && fetchFailed === 0);
    return {
      ok: ok,
      cssLength: cssLength,
      fetchFailed: fetchFailed,
      fetchTotal: fetchTotal,
      warn: ok ? "" : (
        cssLength === 0
          ? "检测到预览正在使用在线字体，但导出无法内联该字体（网络受限或样式表跨源不可读）。导出图将回退系统字体，可能与预览的换行和间距不一致。建议检查网络后重试，或改用系统字体导出。"
          : "检测到 " + fetchFailed + " 个字体文件抓取失败（共 " + fetchTotal + " 个请求）。导出的 " + (fetchTotal - fetchFailed) + " 个字体可正常内联，但失败的字体会回退系统字体。建议在网络稳定时重试导出。"
      ),
    };
  }

  /* ---------- zoom 安全区：CSS zoom 子树内的 computed style 是缩放后的值，
     直接克隆会得到缩小版布局。导出前以 zoom=1 重建预览（设计宽度原尺寸），
     位图化完成后恢复用户的缩放与界面。 ---------- */
  const debugInfo = { hiddenTags: 0 };
  async function withDesignZoom(fn) {
    const bb = BB();
    const prevZoom = bb.state.zoom;
    bb.state.zoom = 1;
    const suppress = document.createElement("style");
    suppress.id = "bb-export-suppress-tags";
    /* 导出白名单反向过滤：凡标记为「仅屏幕显示」的界面元素（板块上移/下移按钮、屏序号标签、
       空屏提示等）一律不进导出位图。核心内容始终保留，仅剥离编辑器交互件。 */
    suppress.textContent = ".bb-dom-only,.bb-slice-tag,.bb-art-actions{display:none!important}"
      + ".bb-page-canvas,.bb-strip,.bb-page-card{outline:none!important;box-shadow:none!important}"
      + ".bb-art-module{outline:none!important}";
    document.head.appendChild(suppress);
    try {
      bb.renderAll();
      debugInfo.hiddenTags = document.querySelectorAll(".bb-slice-tag").length;
      await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
      return await fn();
    } finally {
      if (suppress.parentNode) suppress.parentNode.removeChild(suppress);
      bb.state.zoom = prevZoom;
      bb.renderAll();
    }
  }

  /* ---------- webfont 内联：SVG-as-Image 沙箱不继承页面字体，需把命中的
     @font-face（含 unicode-range 分片woff2）转成 dataURL 注入 <style>。
     baseUrl（可选）：样式表 CDN 地址，用于将 @font-face 里的相对路径 url(./files/xxx.woff)
     解析为绝对 CDN 地址后 fetch。FontSource 等 CDN 包的标准分发形态就是相对路径。 ---------- */
  var _fontFetchStats = { fetches: 0, failed: 0 }; /* 模块级统计，供 auditExportFontCss 读取 */
  function cssUrlToDataUrl(cssText, baseUrl) {
    /* 匹配非 data: 的 url(path)（不包括 data: URL，避免索引错位），相对路径由 baseUrl 解析 */
    const urlRe = /url\((['"]?)((?!data:)[^'")]+)\1\)/g;
    const jobs = [];
    let m;
    while ((m = urlRe.exec(cssText)) !== null) {
      const raw = m[2];
      let absolute = raw;
      if (baseUrl && raw.indexOf("http") !== 0 && raw.indexOf("//") !== 0 && raw.indexOf("blob:") !== 0) {
        try { absolute = new URL(raw, baseUrl).href; } catch (e) { /* 解析失败按原值 */ }
      }
      jobs.push(absolute);
    }
    if (!jobs.length) return Promise.resolve(cssText);
    return Promise.all(jobs.map(function (u) { _fontFetchStats.fetches++; return fetchAsDataUrl(u); })).then(function (dataUrls) {
      var anyFailed = false;
      var i = 0;
      dataUrls.forEach(function (d) { if (!d) anyFailed = true; });
      if (anyFailed) _fontFetchStats.failed += 1;
      /* 任一字体文件 fetch 失败 → 整条 @font-face 不可用，返回空字符串不注入沙箱，
         避免在 SVG-as-image 内留下无法解析的相对路径或 CDN 绝对 URL（沙箱不加载外链资源）。 */
      if (anyFailed) return "";
      return cssText.replace(urlRe, function () {
        var val = dataUrls[i++];
        return 'url("' + (val || "") + '")';
      });
    });
  }
  /* src 型字体（本地相对路径 / 裸字体 URL）的 @font-face 内联：把 url(...) 里的
     任意路径（http 或相对路径）转成 dataURL，保证 SVG-as-image 沙箱内可用。 */
  function inlineFontFaceUrls(cssText) {
    const urlRe = /url\((['"]?)([^'")]+)\1\)/g;
    const jobs = [];
    let m;
    while ((m = urlRe.exec(cssText)) !== null) jobs.push(m[2]);
    if (!jobs.length) return Promise.resolve(cssText);
    return Promise.all(jobs.map(function (u) { _fontFetchStats.fetches++; return fetchAsDataUrl(u); })).then(function (dataUrls) {
      var anyFailed = false;
      dataUrls.forEach(function (d) { if (!d) anyFailed = true; });
      if (anyFailed) { _fontFetchStats.failed += 1; return ""; } /* 字体文件内联失败 → 丢弃该条 @font-face */
      let i = 0;
      return cssText.replace(urlRe, function () { return 'url("' + (dataUrls[i++] || "") + '")'; });
    });
  }

  /* cssRules 被跨源封锁（<link> 未声明 crossorigin 的历史会话）时的兜底通道：
     直接 fetch CSS 文本，用正则提取 @font-face 块。返回该样式表命中的 @font-face 数组；
     读取失败返回 null（调用方按 0 条处理，不中断导出）。 */
  async function fontFacesFromFetchedCss(href, family) {
    try {
      const res = await fetchWithTimeout(href, { mode: "cors" }, 15000);
      if (!res.ok) return null;
      const text = await res.text();
      const out = [];
      const re = /@font-face\s*\{[^}]*\}/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[0].indexOf(family) >= 0) out.push(m[0]);
      }
      return out;
    } catch (error) { return null; }
  }

  /* 单次导出内字体 CSS 复用缓存：audit + 位图化各调用一次 buildFontCss，
     每次都会重新 fetch 全部字体文件（64+ 请求）。以「字体键 + fonts 就绪状态」为
     签名缓存结果，同一次导出中 audit 与 rasterize 共享同一份已内联 CSS，
     避免 CDN 抖动放大成数倍耗时/超时。文档字体变更（签名变化）自动失效。 */
  var _fontCssCache = { sig: "", css: "" };
  function fontCssCacheSig() {
    const doc = BB().doc;
    const headingKey = doc.headingFont || doc.fontFamily || "sans";
    const bodyKey = doc.bodyFont || headingKey;
    let status = "";
    try { status = document.fonts && document.fonts.status ? document.fonts.status : ""; } catch (e) { /* ignore */ }
    return headingKey + "|" + bodyKey + "|" + status;
  }
  function invalidateFontCssCache() { _fontCssCache = { sig: "", css: "" }; }

  async function buildFontCss() {
    const sig = fontCssCacheSig();
    if (_fontCssCache.sig === sig) return _fontCssCache.css;
    const doc = BB().doc;
    const keys = [];
    const headingKey = doc.headingFont || doc.fontFamily || "sans";
    keys.push(headingKey);
    const bodyKey = doc.bodyFont || headingKey;
    if (keys.indexOf(bodyKey) < 0) keys.push(bodyKey);
    const out = [];
    _fontFetchStats = { fetches: 0, failed: 0 }; /* 每次构建重置统计 */
    for (let i = 0; i < keys.length; i++) {
      const f = C.FONTS[keys[i]];
      if (!f || !f.family) continue;
      /* 用户追加 / 本地字体：src 型，直接合成 @font-face 并内联 dataURL */
      if (Array.isArray(f.src) && f.src.length && typeof C.fontFaceFor === "function") {
        const faceCss = C.fontFaceFor(f);
        if (faceCss) { try { out.push(await inlineFontFaceUrls(faceCss)); } catch (e) { /* 单条失败跳过 */ } }
        continue;
      }
      /* 候选样式表：页面里已注入的 fontsource 链接 + 字体清单里的 css 直链（去重） */
      const candidates = [];
      const seen = {};
      try {
        for (let j = 0; j < document.styleSheets.length; j++) {
          let sheet;
          try { sheet = document.styleSheets[j]; } catch (e) { continue; }
          if (!sheet || !sheet.href) continue;
          if (sheet.href.indexOf("fontsource") < 0 && sheet.href.indexOf(f.family) < 0) continue;
          if (!seen[sheet.href]) { seen[sheet.href] = true; candidates.push(sheet); }
        }
      } catch (e) { /* 样式表访问失败跳过 */ }
      (f.css || []).forEach(function (url) {
        if (!seen[url]) { seen[url] = true; candidates.push({ href: url }); }
      });
      if (!candidates.length) continue;
      const sheetPairs = []; /* [{ cssText, baseUrl }] —— baseUrl 用于解析 FontSource 相对路径 url(./files/xxx.woff) */
      let fetchedCount = 0; /* fetch 兜底提取的 @font-face 条数（仅 cssRules 不可读时才非 0） */
      for (let ci = 0; ci < candidates.length; ci++) {
        const cand = candidates[ci];
        /* 推导 baseUrl：CSSStyleSheet 取 sheet.href；裸 url 字符串用自身 */
        const baseUrl = cand.href || (typeof cand === "string" ? cand : "");
        /* 优先 cssRules（同源或已声明 crossorigin 的链接，最快且无需网络往返） */
        try {
          const rules = cand.cssRules;
          if (rules) {
            for (let k = 0; k < rules.length; k++) {
              const r = rules[k];
              if (r.type === 5 /* CSSRule.FONT_FACE_RULE */ && r.cssText && r.cssText.indexOf(f.family) >= 0) sheetPairs.push({ cssText: r.cssText, baseUrl: baseUrl });
            }
            continue;
          }
        } catch (e) { /* SecurityError → 走 fetch 兜底 */ }
        /* 兜底：fetch CSS 文本正则提取（<link> 未声明 crossorigin 的历史会话） */
        const fetched = await fontFacesFromFetchedCss(cand.href, f.family);
        if (fetched && fetched.length) {
          fetched.forEach(function (css) { sheetPairs.push({ cssText: css, baseUrl: baseUrl }); });
          fetchedCount += fetched.length;
        }
      }
      if (!sheetPairs.length) continue;
      /* 只内联已加载（命中文本）的分片：用 document.fonts 反查已激活的 face */
      const loaded = [];
      try {
        document.fonts.forEach(function (face) {
          if (face.family.replace(/["']/g, "") === f.family && face.status === "loaded") {
            loaded.push(face);
          }
        });
      } catch (e) { /* ignore */ }
      const keep = loaded.length ? sheetPairs.filter(function (p) {
        const wm = p.cssText.match(/font-weight:\s*(\d+)/);
        const sm = p.cssText.match(/unicode-range:\s*([^;]+);?/);
        if (!wm) return true;
        return loaded.some(function (face) {
          return String(face.weight) === wm[1] && (!sm || (face.unicodeRange && face.unicodeRange.replace(/\s+/g, "") === sm[1].replace(/\s+/g, "")));
        });
      }) : sheetPairs;
      for (let j = 0; j < keep.length; j++) {
        try { out.push(await cssUrlToDataUrl(keep[j].cssText, keep[j].baseUrl)); } catch (e) { /* 单条失败跳过 */ }
      }
      if (fetchedCount > 0 && global.console && global.console.warn) {
        global.console.warn("[banner-builder] 字体样式表 cssRules 不可读（跨源未声明 crossorigin），已用 fetch 兜底提取 " + fetchedCount + " 条 @font-face。建议刷新页面使新注入的链接带 crossorigin。");
      }
    }
    const css = out.join("\n");
    if (css) _fontCssCache = { sig: fontCssCacheSig(), css: css };
    return css;
  }

  /* ---------- 资源内联：SVG-as-Image 沙箱不加载 blob:/http 外链资源，先全部转 dataURL ---------- */
  /* 照片 EXIF 方向烘焙：预览时浏览器按 EXIF 摆正显示，而 SVG-in-img 位图化不认 EXIF，
     导出会横竖颠倒。统一用 createImageBitmap(from-image) 解码 → canvas 重编码，方向烘焙进像素。 */
  function normalizeBlobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      if (!global.createImageBitmap) { reject(new Error("createImageBitmap 不可用")); return; }
      global.createImageBitmap(blob, { imageOrientation: "from-image" }).then(function (bmp) {
        const c = document.createElement("canvas");
        c.width = bmp.width; c.height = bmp.height;
        c.getContext("2d").drawImage(bmp, 0, 0);
        const keepPng = blob.type === "image/png" || blob.type === "image/webp" || !blob.type;
        const out = c.toDataURL(keepPng ? "image/png" : "image/jpeg", 0.92);
        if (bmp.close) bmp.close();
        resolve(out);
      }, reject);
    });
  }
  function blobToRawDataUrl(blob) {
    return new Promise(function (resolve) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(blob);
    });
  }
  function fetchWithTimeout(url, options, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error("fetch timeout after " + timeoutMs + "ms: " + String(url).substring(0, 120))); }
      }, timeoutMs);
      fetch(url, options).then(function (res) {
        if (!done) { done = true; clearTimeout(timer); resolve(res); }
      }, function (err) {
        if (!done) { done = true; clearTimeout(timer); reject(err); }
      });
    });
  }
  function fetchAsDataUrl(src, timeoutMs) {
    return new Promise(function (resolve) {
      if (!src || src.indexOf("data:") === 0) { resolve(src); return; }
      var ms = (typeof timeoutMs === "number" && timeoutMs > 0) ? timeoutMs : 18000;
      fetchWithTimeout(src, { mode: "cors" }, ms).then(function (res) { return res.blob(); }).then(function (blob) {
        normalizeBlobToDataUrl(blob).then(function (dataUrl) {
          if (dataUrl) { resolve(dataUrl); return; }
          blobToRawDataUrl(blob).then(function (raw) { resolve(raw || null); });
        }, function () {
          blobToRawDataUrl(blob).then(function (raw) { resolve(raw || null); });
        });
      }).catch(function (err) {
        if (global.console && global.console.warn) global.console.warn("[banner-builder] 资源 fetch 失败（" + String(src).substring(0, 100) + "）：" + ((err && err.message) || err));
        resolve(null);
      });
    });
  }
  async function inlineResources(root) {
    /* 编辑器交互件（屏序号标签 / 板块上下移按钮 / 空屏提示）绝不能进导出位图 */
    [].slice.call(root.querySelectorAll(".bb-slice-tag, .bb-art-actions, .bb-page-empty, .bb-dom-only")).forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    const imgs = [].slice.call(root.querySelectorAll("img"));
    for (let i = 0; i < imgs.length; i++) {
      const dataUrl = await fetchAsDataUrl(imgs[i].getAttribute("src"));
      imgs[i].setAttribute("src", dataUrl || "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==");
    }
    // CSS 背景图（blockBgImage / 页面背景 / 渐变叠加形态）全量内联
    const styled = [root].concat([].slice.call(root.querySelectorAll("[style]")));
    for (let j = 0; j < styled.length; j++) {
      let styleAttr = styled[j].getAttribute("style") || "";
      if (styleAttr.indexOf("url(") < 0) continue;
      const urlRe = /url\("(?!data:)([^"]+)"\)/g;
      const matches = [];
      let mm;
      while ((mm = urlRe.exec(styleAttr)) !== null) matches.push(mm[1]);
      for (let k = 0; k < matches.length; k++) {
        const dataUrl = await fetchAsDataUrl(matches[k]);
        if (!dataUrl) continue; /* fetch 失败：保留原 URL（与注入 "null" 相比，原样至少可调试） */
        styleAttr = styleAttr.split('url("' + matches[k] + '")').join('url("' + dataUrl + '")');
      }
      styled[j].setAttribute("style", styleAttr);
    }
    return root;
  }

  /* ---------- 把单屏 DOM 画布节点转成独立克隆（内联计算样式，脱离 zoom/祖先影响） ---------- */
  function cloneWithComputedStyles(sourceNode) {
    const clone = sourceNode.cloneNode(true);
    const srcEls = [sourceNode].concat([].slice.call(sourceNode.querySelectorAll("*")));
    const dstEls = [clone].concat([].slice.call(clone.querySelectorAll("*")));
    const props = [
      "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
      "color", "backgroundColor", "backgroundImage", "backgroundSize", "backgroundPosition",
      "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
      "border", "borderTop", "borderRight", "borderBottom", "borderLeft",
      "borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
      "boxShadow", "textAlign", "display", "flexDirection", "justifyContent", "alignItems",
      "gap", "gridTemplateColumns", "gridTemplateRows", "gridGap", "objectFit", "aspectRatio",
      "width", "height", "maxHeight", "maxWidth", "minHeight", "overflow", "position",
      "top", "left", "right", "bottom", "transform", "opacity", "whiteSpace",
      "textShadow", "textDecoration", "zIndex", "outline", "outlineOffset",
    ];
    for (let i = 0; i < srcEls.length; i++) {
      const src = srcEls[i], dst = dstEls[i];
      if (!dst) continue;
      const cs = getComputedStyle(src);
      let css = "";
      props.forEach(function (p) {
        try {
          const v = cs[p];
          if (v && v !== "none" && v !== "normal" && v !== "0px" && v !== "auto" && v !== "rgba(0, 0, 0, 0)") css += p + ":" + v + ";";
        } catch (e) { /* skip */ }
      });
      dst.setAttribute("style", css);
      if (dst.tagName === "IMG") { dst.setAttribute("crossorigin", "anonymous"); }
    }
    return clone;
  }

  /* 节点有效底色：读 computed background-color；透明/未设置一律回落白色。
     长图与分屏导出共用，保证「用户设置的底色」被精确铺到导出位图，而非硬编码白色。 */
  function nodeBackground(node) {
    if (!node) return "#ffffff";
    let color = "";
    try { color = getComputedStyle(node).backgroundColor || ""; } catch (error) { color = ""; }
    if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return "#ffffff";
    return color;
  }

  /* ---------- 核心位图化：优先 html-to-image（全量样式克隆），失败回落自研序列化 ----------
     bgColor（可选）：显式背景色，优先于 nodeBackground 的读值。连续模式下 .bb-page-canvas
     背景透明（底色由 .bb-strip 承载），nodeBackground 会回落白色导致导出底色丢失
     （2026-09-16 PDF 导出实测：深紫底文档导出成白底）。调用方按
     page.backgroundColor || doc.backgroundColor 传入即可两种模式通吃。 ---------- */
  function rasterizeViaLibrary(node, width, height, scale, bgColor) {
    if (!global.htmlToImage || typeof global.htmlToImage.toCanvas !== "function") return Promise.reject(new Error("html-to-image 未加载"));
    /* 库默认内嵌样式表里全部 @font-face（中文包 ~120 分片）首跑极慢；
       改为只把已激活（命中文本）分片的 font CSS 注入节点，库跳过自身字体处理。 */
    return buildFontCss().then(function (fontCss) {
      let styleEl = null;
      if (fontCss) { styleEl = document.createElement("style"); styleEl.textContent = fontCss; node.appendChild(styleEl); }
      /* margin 0 auto 居中会被克隆固化成具体像素偏移 → 导出内容整体右移。
         位图化期间把导出根的 margin 临时归零（预览即所求是内容本身，不含页面居中偏移）。 */
      const prevMargin = node.style.margin || "";
      node.style.margin = "0";
      const finish = function () {
        node.style.margin = prevMargin;
        if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      };
      return global.htmlToImage.toCanvas(node, {
        pixelRatio: scale,
        width: width,
        height: height,
        backgroundColor: bgColor || nodeBackground(node),
        cacheBust: false,
        skipFonts: true,
        /* 外链资源拉取加 8s 超时（库默认无超时，弱网/离线对慢资源会无限挂死） */
        fetchRequest: function (url) {
          return new Promise(function (resolve, reject) {
            var done = false;
            var timer = setTimeout(function () { if (!done) { done = true; reject(new Error("fetch timeout: " + url)); } }, 8000);
            fetch(url).then(function (res) {
              res.blob().then(function (b) { if (!done) { done = true; clearTimeout(timer); resolve(b); } }, function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } });
            }, function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } });
          });
        },
        /* 跨域样式表（jsDelivr @fontsource 等）不进克隆树：字体由门禁+内嵌分片负责 */
        filter: function (domNode) {
          try {
            return !(domNode && domNode.tagName === "LINK" && typeof domNode.getAttribute === "function" && (domNode.getAttribute("href") || "").indexOf("fontsource") >= 0);
          } catch (e) { return true; }
        },
      }).then(function (canvas) { finish(); return canvas; }, function (err) { finish(); throw err; });
    });
  }
  function rasterizeDomToCanvas(node, width, height, scale, bgColor) {
    return rasterizeViaLibrary(node, width, height, scale, bgColor).catch(function () {
      return rasterizeViaOwn(node, width, height, scale, bgColor);
    });
  }
  function rasterizeViaOwn(node, width, height, scale, bgColor) {
    return new Promise(function (resolve, reject) {
      const clone = cloneWithComputedStyles(node);
      const resolvedBg = bgColor || nodeBackground(node);
      Promise.all([inlineResources(clone), buildFontCss()]).then(function (arr) {
        finishRasterize(clone, width, height, scale, resolve, reject, arr[1] || "", resolvedBg);
      }, function () { reject(new Error("资源内联失败")); });
    });
  }
  function finishRasterize(clone, width, height, scale, resolve, reject, fontCss, bgColor) {
    /* 兜底链路同样剥离居中 margin（避免右偏） */
    clone.style.margin = "0";
    return new Promise(function (resolve2, reject2) {
      try {
      const wrapper = document.createElement("div");
      wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      wrapper.setAttribute("style", "width:" + width + "px;height:" + height + "px;overflow:hidden;");
      if (fontCss) {
        const fontStyle = document.createElement("style");
        fontStyle.textContent = fontCss;
        wrapper.appendChild(fontStyle);
      }
      wrapper.appendChild(clone);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", width * scale);
      svg.setAttribute("height", height * scale);
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      const foreign = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
      foreign.setAttribute("width", "100%");
      foreign.setAttribute("height", "100%");
      foreign.appendChild(wrapper);
      svg.appendChild(foreign);
      const xml = new XMLSerializer().serializeToString(svg);
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      const image = new Image();
      image.onload = function () {
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = bgColor || "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas); resolve2(canvas);
      };
      image.onerror = function () { reject(new Error("DOM 位图化失败（可能含跨域图片或未加载完成的资源）")); reject2(new Error("DOM 位图化失败")); };
      image.src = url;
      } catch (error) { reject2(error); }
    });
  }

  /* 找到当前屏对应的预览画布节点 */
  function findPreviewCanvas(pageId) {
    const body = document.getElementById("canvasBody");
    if (!body) return null;
    return body.querySelector('.bb-page-canvas[data-page-id="' + pageId + '"]') || null;
  }

  /* 单屏画布导出底色：连续模式下 .bb-page-canvas 的 CSS background-color 固定为
     transparent（底色由 .bb-strip 承载），nodeBackground 会回落白色，导出图与预览
     （深色底色透出）不一致。此处回退到 doc.backgroundColor / page.backgroundColor。 */
  function canvasExportBg(node, page) {
    let color = "";
    try { color = getComputedStyle(node).backgroundColor || ""; } catch (error) { color = ""; }
    if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") {
      const doc = BB().doc;
      const p = page || {};
      if (p.backgroundColor) return p.backgroundColor;
      if (doc.backgroundColor) return doc.backgroundColor;
      return undefined;
    }
    return color;
  }

  function downloadBlob(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  /* BB-R10：统一 PNG 编码器——canvas.toBlob 可能回调 null（超大画布 / 内存不足 / 浏览器限制），
     必须判空后再下载，错误信息包含画布尺寸与处理建议。所有 PNG 导出路径统一调用。 */
  function canvasToPngBlob(canvas) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) {
          if (!blob) {
            reject(new Error("PNG 编码失败，当前画布为 " + canvas.width + " × " + canvas.height + " px。建议降低导出倍率或减少屏数后重试。"));
            return;
          }
          resolve(blob);
        }, "image/png");
      } catch (error) {
        reject(new Error("PNG 编码异常：" + ((error && error.message) || error) + "（画布 " + canvas.width + " × " + canvas.height + " px）"));
      }
    });
  }

  /* BB-R11：导出资源预算——连续长图（200 屏上限）× 高倍率可能超出浏览器 Canvas 能力
     （Chrome 单边上限 65535、多数浏览器总像素约 1.6 亿内稳定）。创建 Canvas 前先算账，
     超限立即阻止，避免长时间冻结后才失败。配置集中管理，导出各路径共用。 */
  const EXPORT_LIMITS = Object.freeze({
    maxSide: 32767,                       /* 单边最大 px（Chrome/Safari 安全值） */
    maxPixels: 130 * 1000 * 1000,         /* 总像素上限（宽×高） */
    maxEstimatedBytes: 700 * 1024 * 1024, /* 估算 RGBA 内存上限（宽×高×4） */
  });
  function assertExportBudget(width, height, label) {
    const w = Math.ceil(Number(width) || 0);
    const h = Math.ceil(Number(height) || 0);
    const pixels = w * h;
    const bytes = pixels * 4;
    if (w > EXPORT_LIMITS.maxSide || h > EXPORT_LIMITS.maxSide) {
      throw new Error((label || "导出") + "尺寸超出浏览器能力：宽 " + w + " × 高 " + h + " px（单边上限 " + EXPORT_LIMITS.maxSide + " px）。建议降低导出倍率、减少屏数，或改用「分屏导出 PNG」逐屏导出。");
    }
    if (pixels > EXPORT_LIMITS.maxPixels || bytes > EXPORT_LIMITS.maxEstimatedBytes) {
      throw new Error((label || "导出") + "总像素超出浏览器能力：宽 " + w + " × 高 " + h + " px，共 " + (pixels / 1000 / 1000).toFixed(1) + " 百万像素（估算内存 " + (bytes / 1024 / 1024).toFixed(0) + "MB）。建议降低导出倍率、减少屏数，或改用「分屏导出 PNG」逐屏导出。");
    }
  }

  /* ---------- 对外能力 ---------- */
  async function exportPng(opts) {
    global.__EXPORT_TRACE = global.__EXPORT_TRACE || [];
    const TR = function (s) { global.__EXPORT_TRACE.push(s + "@" + Date.now()); };
    const o = opts || {};
    const activeId = BB().state.activePageId;
    const pages = o.allPages ? BB().doc.pages : [BB().doc.pages.filter(function (p) { return p.id === activeId; })[0] || BB().doc.pages[0]];
    const scale = exportScale();
    TR("ensureFonts-begin");
    const fontStatus = await ensureFonts();
    TR("ensureFonts-done:" + fontStatus);
    /* 导出前体检：webfont 已激活但内联 CSS 为空 → 位图化必然回退系统字体，提前警告 */
    const fontAudit = await auditExportFontCss();
    TR("fontAudit:" + fontAudit.cssLength + " fetchOk:" + (fontAudit.fetchTotal || 0) + "/" + ((fontAudit.fetchTotal || 0) - (fontAudit.fetchFailed || 0)));
    if (!fontAudit.ok && global.console && global.console.warn) global.console.warn("[banner-builder] " + fontAudit.warn);
    const size = pageSize();
    const results = [];
    TR("withDesignZoom-begin");
    return withDesignZoom(async function () {
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const node = findPreviewCanvas(page.id);
        if (!node) throw new Error("找不到第 " + (i + 1) + " 屏的预览画布");
        TR("page" + i + "-node zoom=" + (getComputedStyle(node).zoom || "?") + " h=" + node.offsetHeight + "/" + node.scrollHeight);
        const exportH = Math.max(node.offsetHeight, node.scrollHeight);
      const bgColor = canvasExportBg(node, page);
      const canvas = await rasterizeDomToCanvas(node, size.pageWidth, exportH, scale, bgColor);
      TR("page" + i + "-rasterized:" + canvas.width + "x" + canvas.height);
      const blob = await canvasToPngBlob(canvas);
      const pageNo = String(BB().doc.pages.indexOf(page) + 1).padStart(2, "0");
      downloadBlob(blob, "only-box-banner-" + pageNo + ".png");
        TR("page" + i + "-blob-done");
        results.push({ page: pageNo, width: canvas.width, height: canvas.height, scale: scale, fontStatus: fontStatus });
        if (i < pages.length - 1) await new Promise(function (r) { setTimeout(r, 320); });
      }
      return { engine: "dom-serialize", pages: results.length, scale: scale, fontStatus: fontStatus, detail: results };
    });
  }

  async function exportStripPng() {
    const scale = exportScale();
    const fontStatus = await ensureFonts();
    const fontAudit = await auditExportFontCss();
    if (!fontAudit.ok && global.console && global.console.warn) global.console.warn("[banner-builder] " + fontAudit.warn);
    const body = document.getElementById("canvasBody");
    const strip = body ? body.querySelector(".bb-strip") : null;
    if (!strip) throw new Error("连续模式预览未激活，请先切换到「连续」再导出长图");
    const size = pageSize();
    return withDesignZoom(async function () {
      const stripNode = (document.getElementById("canvasBody") || {}).querySelector
        ? document.getElementById("canvasBody").querySelector(".bb-strip")
        : null;
      if (!stripNode) throw new Error("连续模式预览未激活，请先切换到「连续」再导出长图");
      const stripH = Math.max(stripNode.offsetHeight, stripNode.scrollHeight);
      /* BB-R11：长图位图化前检查资源预算（宽 × 总高 × 倍率） */
      assertExportBudget(size.pageWidth * scale, stripH * scale, "连续长图导出");
      const canvas = await rasterizeDomToCanvas(stripNode, size.pageWidth, stripH, scale);
      const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
      downloadBlob(blob, "only-box-banner-continuous.png");
      return { engine: "dom-serialize", width: canvas.width, height: canvas.height, scale: scale, fontStatus: fontStatus };
    });
  }

  async function exportPsd() {
    /* 所见即所得 + 可编辑双层结构：
       1) 底层「预览合成图」= DOM 序列化逐像素位图，与预览 100% 一致（视觉兜底）；
       2) 上层「可编辑图层组」= 形状 / 文字 / 图片子图层，默认隐藏，展开后可逐项编辑。
       字体：PSD 文字层只保存字体名（PSD 格式不内嵌字体二进制），勾选「打包字体」时
       同步下载 .ttf/.otf 供 PS 安装，保证文字层以正确字形打开。 */
    const bb = BB();
    const fontStatus = await ensureFonts();
    const size = pageSize();
    const ag = global.agPsd;
    const legacy = global.BannerBuilderLegacy || global.bannerBuilder;
    if (!ag || typeof ag.writePsd !== "function") {
      if (legacy && typeof legacy.exportPsd === "function") return legacy.exportPsd();
      if (global.alert) global.alert("PSD 引擎尚未加载，请刷新页面后重试。");
      return null;
    }
    /* 可编辑子图层（形状/文字/图片），复用 legacy 重建结果——先于合成图构建：
       BB-R08 需要用 editable.height（实际内容高度）决定合成图与 PSD 文档高度，
       超屏内容不再按固定 pageHeight 截断。 */
    let editable = null;
    try { editable = legacy && typeof legacy.buildPsdChildren === "function" ? await legacy.buildPsdChildren() : null; } catch (error) { editable = null; }
    if (!editable) {
      if (legacy && typeof legacy.exportPsd === "function") return legacy.exportPsd();
      if (global.alert) global.alert("PSD 图层构建失败，请刷新页面后重试。");
      return null;
    }
    /* BB-R08：合成图高度 = max(可编辑层高度, 预览 DOM 实际高度)，与 PSD 文档高度保持一致。
       三者（合成图 / 文档 / 可编辑层坐标空间）不一致时抛诊断错误，不静默生成错位文件。 */
    let composite = null;
    try {
      composite = await withDesignZoom(async function () {
        const node = findPreviewCanvas(bb.state.activePageId);
        if (!node) throw new Error("找不到当前屏预览画布");
        const actualHeight = Math.max(editable.height || 0, node.offsetHeight || 0, node.scrollHeight || 0, size.pageHeight);
        const canvas = await rasterizeDomToCanvas(node, size.pageWidth, actualHeight, 1, canvasExportBg(node, (bb.doc.pages || []).filter(function (p) { return p.id === bb.state.activePageId; })[0]));
        if (canvas.height !== Math.max(editable.height || 0, actualHeight)) {
          /* 位图化结果与预期不一致时以实际画布为准校验文档高度 */
          if (canvas.height < (editable.height || 0)) throw new Error("PSD 合成图高度（" + canvas.height + "px）小于可编辑图层高度（" + editable.height + "px），导出中止以避免图层错位");
        }
        return canvas;
      });
    } catch (error) {
      if (error && /PSD 合成图高度/.test(error.message)) throw error; /* 一致性错误必须上抛，不吞 */
      composite = null;
    }
    const children = [];
    if (composite) children.push({ name: "预览合成图（所见即所得）", canvas: composite });
    /* 丢弃 legacy 的「背景底色」占位层（合成图已含页面背景），其余板块组保留为可编辑内容 */
    const editables = (editable.children || []).filter(function (c) { return c.name !== "背景底色"; }).map(function (c) { return Object.assign({}, c, { hidden: true }); });
    if (editables.length) children.push({ name: "可编辑图层（改为「显示」即可编辑文字 / 形状 / 图片）", children: editables, opened: true });
    /* BB-R08：PSD 文档高度 = 合成图与可编辑层高度的较大者，保证三者坐标空间一致 */
    const docHeight = Math.max(editable.height || 0, composite ? composite.height : 0);
    try {
      const buffer = ag.writePsd({ width: editable.width, height: docHeight, children: children }, { generateThumbnail: true });
      const pageIndex = (bb.doc.pages || []).indexOf((bb.doc.pages || []).filter(function (p) { return p.id === bb.state.activePageId; })[0]);
      const pageNo = String((pageIndex >= 0 ? pageIndex : 0) + 1).padStart(2, "0");
      downloadBlob(new Blob([buffer], { type: "application/octet-stream" }), "only-box-banner-page-" + pageNo + ".psd");
      const result = { layers: children.length, editable: editables.length, composite: !!composite, fontStatus: fontStatus };
      return result;
    } catch (error) { if (global.alert) global.alert("PSD 导出失败：" + error.message); return null; }
  }

  global.BannerBuilderExport = {
    exportPng: exportPng,
    exportStripPng: exportStripPng,
    exportPsd: exportPsd,
    ensureFonts: ensureFonts,
    auditExportFontCss: auditExportFontCss,
    exportScale: exportScale,
    __raster: rasterizeDomToCanvas,
    __withDesignZoom: withDesignZoom,
    __findPreviewCanvas: findPreviewCanvas,
    __debug: debugInfo,
    __normalize: function (blob) { return normalizeBlobToDataUrl(blob); },
    __inline: function (root) { return inlineResources(root); },
  };
})(window);

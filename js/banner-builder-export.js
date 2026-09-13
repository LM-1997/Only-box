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
     @font-face（含 unicode-range 分片woff2）转成 dataURL 注入 <style>。 ---------- */
  function cssUrlToDataUrl(cssText) {
    const urlRe = /url\((['"]?)(https?:\/\/[^'")]+|blob:[^'")]+)\1\)/g;
    const jobs = [];
    let m;
    while ((m = urlRe.exec(cssText)) !== null) jobs.push(m[2]);
    if (!jobs.length) return Promise.resolve(cssText);
    return Promise.all(jobs.map(function (u) { return fetchAsDataUrl(u); })).then(function (dataUrls) {
      let i = 0;
      return cssText.replace(urlRe, function () { return 'url("' + (dataUrls[i++] || "") + '")'; });
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
    return Promise.all(jobs.map(function (u) { return fetchAsDataUrl(u); })).then(function (dataUrls) {
      let i = 0;
      return cssText.replace(urlRe, function () { return 'url("' + (dataUrls[i++] || "") + '")'; });
    });
  }

  async function buildFontCss() {
    const doc = BB().doc;
    const keys = [];
    const headingKey = doc.headingFont || doc.fontFamily || "sans";
    keys.push(headingKey);
    const bodyKey = doc.bodyFont || headingKey;
    if (keys.indexOf(bodyKey) < 0) keys.push(bodyKey);
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      const f = C.FONTS[keys[i]];
      if (!f || !f.family) continue;
      /* 用户追加 / 本地字体：src 型，直接合成 @font-face 并内联 dataURL */
      if (Array.isArray(f.src) && f.src.length && typeof C.fontFaceFor === "function") {
        const faceCss = C.fontFaceFor(f);
        if (faceCss) { try { out.push(await inlineFontFaceUrls(faceCss)); } catch (e) { /* 单条失败跳过 */ } }
        continue;
      }
      const sheets = [];
      try {
        for (let j = 0; j < document.styleSheets.length; j++) {
          let sheet;
          try { sheet = document.styleSheets[j]; } catch (e) { continue; }
          if (!sheet || !sheet.href) continue;
          if (sheet.href.indexOf("fontsource") < 0 && sheet.href.indexOf(f.family) < 0) continue;
          let rules;
          try { rules = sheet.cssRules; } catch (e) { continue; }
          if (!rules) continue;
          for (let k = 0; k < rules.length; k++) {
            const r = rules[k];
            if (r.type === 5 /* CSSRule.FONT_FACE_RULE */ && r.cssText && r.cssText.indexOf(f.family) >= 0) sheets.push(r.cssText);
          }
        }
      } catch (e) { /* 样式表访问失败跳过 */ }
      if (!sheets.length) continue;
      /* 只内联已加载（命中文本）的分片：用 document.fonts 反查已激活的 face */
      const loaded = [];
      try {
        document.fonts.forEach(function (face) {
          if (face.family.replace(/["']/g, "") === f.family && face.status === "loaded") {
            loaded.push(face);
          }
        });
      } catch (e) { /* ignore */ }
      const keep = loaded.length ? sheets.filter(function (css) {
        const wm = css.match(/font-weight:\s*(\d+)/);
        const sm = css.match(/unicode-range:\s*([^;]+);?/);
        if (!wm) return true;
        return loaded.some(function (face) {
          return String(face.weight) === wm[1] && (!sm || (face.unicodeRange && face.unicodeRange.replace(/\s+/g, "") === sm[1].replace(/\s+/g, "")));
        });
      }) : sheets;
      for (let j = 0; j < keep.length; j++) {
        try { out.push(await cssUrlToDataUrl(keep[j])); } catch (e) { /* 单条失败跳过 */ }
      }
    }
    return out.join("\n");
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
  function fetchAsDataUrl(src) {
    return new Promise(function (resolve) {
      if (!src || src.indexOf("data:") === 0) { resolve(src); return; }
      fetch(src, { mode: "cors" }).then(function (res) { return res.blob(); }).then(function (blob) {
        normalizeBlobToDataUrl(blob).then(function (dataUrl) {
          if (dataUrl) { resolve(dataUrl); return; }
          blobToRawDataUrl(blob).then(function (raw) { resolve(raw || src); });
        }, function () {
          blobToRawDataUrl(blob).then(function (raw) { resolve(raw || src); });
        });
      }).catch(function () { resolve(src); });
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

  /* ---------- 核心位图化：优先 html-to-image（全量样式克隆），失败回落自研序列化 ---------- */
  function rasterizeViaLibrary(node, width, height, scale) {
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
        backgroundColor: nodeBackground(node),
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
  function rasterizeDomToCanvas(node, width, height, scale) {
    return rasterizeViaLibrary(node, width, height, scale).catch(function () {
      return rasterizeViaOwn(node, width, height, scale);
    });
  }
  function rasterizeViaOwn(node, width, height, scale) {
    return new Promise(function (resolve, reject) {
      const clone = cloneWithComputedStyles(node);
      const bgColor = nodeBackground(node);
      Promise.all([inlineResources(clone), buildFontCss()]).then(function (arr) {
        finishRasterize(clone, width, height, scale, resolve, reject, arr[1] || "", bgColor);
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

  function downloadBlob(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
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
      const canvas = await rasterizeDomToCanvas(node, size.pageWidth, exportH, scale);
      TR("page" + i + "-rasterized:" + canvas.width + "x" + canvas.height);
      const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
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
    const body = document.getElementById("canvasBody");
    const strip = body ? body.querySelector(".bb-strip") : null;
    if (!strip) throw new Error("连续模式预览未激活，请先切换到「连续」再导出长图");
    const size = pageSize();
    return withDesignZoom(async function () {
      const stripNode = (document.getElementById("canvasBody") || {}).querySelector
        ? document.getElementById("canvasBody").querySelector(".bb-strip")
        : null;
      if (!stripNode) throw new Error("连续模式预览未激活，请先切换到「连续」再导出长图");
      const canvas = await rasterizeDomToCanvas(stripNode, size.pageWidth, Math.max(stripNode.offsetHeight, stripNode.scrollHeight), scale);
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
    /* 合成位图：以设计宽度 1x 位图化当前屏 DOM（坐标与可编辑图层同一坐标系）。
       高度固定为设计画布高 pageHeight，保证与可编辑图层坐标、PSD 文档尺寸完全一致。 */
    let composite = null;
    try {
      composite = await withDesignZoom(async function () {
        const node = findPreviewCanvas(bb.state.activePageId);
        if (!node) throw new Error("找不到当前屏预览画布");
        return await rasterizeDomToCanvas(node, size.pageWidth, size.pageHeight, 1);
      });
    } catch (error) { composite = null; }
    /* 可编辑子图层（形状/文字/图片），复用 legacy 重建结果 */
    let editable = null;
    try { editable = legacy && typeof legacy.buildPsdChildren === "function" ? await legacy.buildPsdChildren() : null; } catch (error) { editable = null; }
    if (!editable) {
      if (legacy && typeof legacy.exportPsd === "function") return legacy.exportPsd();
      if (global.alert) global.alert("PSD 图层构建失败，请刷新页面后重试。");
      return null;
    }
    const children = [];
    if (composite) children.push({ name: "预览合成图（所见即所得）", canvas: composite });
    /* 丢弃 legacy 的「背景底色」占位层（合成图已含页面背景），其余板块组保留为可编辑内容 */
    const editables = (editable.children || []).filter(function (c) { return c.name !== "背景底色"; }).map(function (c) { return Object.assign({}, c, { hidden: true }); });
    if (editables.length) children.push({ name: "可编辑图层（改为「显示」即可编辑文字 / 形状 / 图片）", children: editables, opened: true });
    try {
      const buffer = ag.writePsd({ width: editable.width, height: editable.height, children: children }, { generateThumbnail: true });
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
    exportScale: exportScale,
    __raster: rasterizeDomToCanvas,
    __debug: debugInfo,
    __normalize: function (blob) { return normalizeBlobToDataUrl(blob); },
    __inline: function (root) { return inlineResources(root); },
  };
})(window);

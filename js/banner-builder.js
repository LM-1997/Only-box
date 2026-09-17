(function (global) {
  "use strict";

  const C = global.BannerBuilderConstants;
  const R = global.BannerBuilderRegistry;
  const M = global.BannerBuilderModel;
  const MI = global.BannerBuilderModuleImporter;
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
  let inputId = 0;
  let initialized = false;
  let framePending = false;
  const fontLinks = {};

  function ensureFont(key) {
    const f = C.FONTS[key] || C.FONTS.sans;
    (f.css || []).forEach(function (url) {
      if (fontLinks[url]) return;
      fontLinks[url] = true;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      document.head.appendChild(link);
    });
    /* 单字体文件源（用户追加 / 本地字体）：无 @fontsource css 可引，改由 C.fontFaceFor
       合成 @font-face 内联注入，按 family 去重（同族只注入一次）。 */
    if (Array.isArray(f.src) && f.src.length) {
      const faceKey = "faceref:" + f.family;
      if (fontLinks[faceKey]) return;
      fontLinks[faceKey] = true;
      const css = C.fontFaceFor(f);
      if (!css) return;
      const style = document.createElement("style");
      style.id = "bb-font-face-" + key;
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  function showFontFallbackNotice(family) {
    if (document.getElementById("bb-font-notice")) return;
    const bar = document.createElement("div");
    bar.id = "bb-font-notice";
    bar.style.cssText = "margin:10px 0 0;padding:9px 13px;border:1px solid #e0c07a;border-radius:9px;background:#faf3df;color:#715b1e;font-size:12px;font-weight:700";
    bar.textContent = "在线字体（" + family + "）加载失败，已回退系统近似字体，导出效果可能与选择不符。";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "重试加载";
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
    const shell = document.querySelector(".bb-shell");
    if (shell && shell.parentNode) shell.parentNode.insertBefore(bar, shell);
  }

  async function readyFontForText(key, text) {
    const f = C.FONTS[key] || C.FONTS.sans;
    ensureFont(key);
    if (!document.fonts || typeof document.fonts.load !== "function") return;
    const payload = String(text || "Only-box 活动宣传长条 0123456789");
    try {
      /* 方案 §2.2/§6：按字体实际档位吸附后精准加载，不再请求注定不存在的 700/900 档（修 F1） */
      const w400 = C.snapWeight(f, 400), w700 = C.snapWeight(f, 700), w900 = C.snapWeight(f, 900);
      const wanted = [w400, w700, w900].filter(function (w, i, arr) { return arr.indexOf(w) === i; });
      let loaded = null;
      for (let wi = 0; wi < wanted.length; wi += 1) {
        const got = await document.fonts.load(wanted[wi] + ' 24px "' + f.family + '"', payload);
        if (wi === 0) loaded = got;
      }
      /* 方案 §6.1：css 缓存命中时 load() 不抛错但字体文件可能未到手——以「该 family 存在 loaded 态 face」为准 */
      const hasLoadedFace = (function () {
        let hit = false;
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
      /* 字体加载失败（如断网）：使用回退字体渲染并提示（方案 §6.1） */
      showFontFallbackNotice(f.family);
    }
  }

  /* 导出字体门禁：标题/正文两种角色的 webfont 全部就绪（含中文分片按需命中）才开始导出。 */
  async function readyFontsForPage(page) {
    if (!document.fonts || typeof document.fonts.load !== "function") return;
    const headingKey = state.doc.headingFont || state.doc.fontFamily || "sans";
    const bodyKey = state.doc.bodyFont || headingKey;
    const payload = ((state.doc.pages || []).map(collectPageText).join(" ") + " " + collectPageText(page) + " 0123456789").slice(0, 4000);
    const jobs = [];
    [headingKey, bodyKey].forEach(function (key) {
      const f = C.FONTS[key];
      if (!f) return;
      ensureFont(key);
      /* 方案 §6：吸附档位去重后加载（修 F1 加载侧） */
      const wanted = [C.snapWeight(f, 400), C.snapWeight(f, 700), C.snapWeight(f, 900)].filter(function (w, i, arr) { return arr.indexOf(w) === i; });
      wanted.forEach(function (weight) {
        try { jobs.push(document.fonts.load(weight + ' 24px "' + f.family + '"', payload)); } catch (error) { /* 忽略单档失败 */ }
      });
    });
    try { await Promise.all(jobs); if (document.fonts.ready) await document.fonts.ready; } catch (error) { /* 超时/失败时按已就绪字体导出 */ }
  }

  /* 方案 §6.1：默认字体预载——消除首次点选字体的秒级等待（只预载默认 sans，不预载 43 款） */
  function preloadDefaultFont() {
    setTimeout(function () {
      try {
        const f = C.FONTS.sans;
        if (!f || !document.fonts || typeof document.fonts.load !== "function") return;
        [C.snapWeight(f, 400), C.snapWeight(f, 700)].forEach(function (w) {
          document.fonts.load(w + ' 24px "' + f.family + '"', "Only-box 活动宣传长条 0123456789");
        });
      } catch (error) { /* 预载失败不影响功能 */ }
    }, 2000);
  }

  function collectPageText(page) {
    const parts = [];
    (page.modules || []).forEach(function (module) {
      const data = module.data || {};
      Object.keys(data).forEach(function (key) {
        const value = data[key];
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
    return state.doc.fontFamily || "sans";
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
    const token = C.safeCssToken(value);
    return /^[a-z0-9_-]+$/i.test(token) ? token : fallback;
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
    const raw = String(value || "").trim().replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(raw)) return "";
    const number = parseInt(raw, 16);
    return "rgba(" + ((number >> 16) & 255) + "," + ((number >> 8) & 255) + "," + (number & 255) + "," + Math.max(0, Math.min(1, alpha)) + ")";
  }

  /* ===== 图片裁剪：复用全局 MobileImageUpload + Cropper.js，与站内其他工具一致的裁剪能力。
     上传图片后先进入裁剪弹窗，确认后回写 {url,name,type}；取消则忽略本次选择。 ===== */
  let cropModal = null; let cropCropper = null; let cropOpened = null; let cropDone = null; let cropFileName = "";
  function closeCropModal() {
    if (cropCropper) { try { cropCropper.destroy(); } catch (e) { /* ignore */ } cropCropper = null; }
    if (cropOpened && cropOpened.release) { try { cropOpened.release(); } catch (e) { /* ignore */ } cropOpened = null; }
    if (cropModal && cropModal.parentNode) cropModal.parentNode.removeChild(cropModal);
    cropModal = null; cropDone = null;
  }
  function buildCropModal(imageSrc) {
    if (cropModal) closeCropModal();
    cropModal = document.createElement("div");
    cropModal.className = "bb-crop-modal";
    const box = document.createElement("div");
    box.className = "bb-crop-box"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
    box.appendChild(el("h3", null, "裁剪图片"));
    const wrap = el("div", "bb-crop-wrap");
    const img = document.createElement("img"); img.alt = "图片裁剪预览"; img.src = imageSrc;
    wrap.appendChild(img); box.appendChild(wrap);
    const actions = el("div", "bb-crop-actions");
    const cancel = el("button", "bb-btn ghost", "取消"); cancel.type = "button";
    cancel.addEventListener("click", function () { const done = cropDone; closeCropModal(); if (done) done(null); });
    const save = el("button", "bb-btn primary", "应用裁剪"); save.type = "button";
    save.addEventListener("click", async function () {
      /* 先捕获回调再关闭弹窗：closeCropModal 会把 cropDone 置空，若后取则永远拿不到回调 */
      const done = cropDone;
      let blob = cropOpened ? cropOpened.blob : null;
      let mime = (blob && blob.type) || "image/png";
      let name = cropFileName || "image.png";
      let type = mime;
      if (cropCropper) {
        try {
          mime = /jpe?g/i.test(mime) ? "image/jpeg" : "image/png";
          const cropped = cropCropper.getCroppedCanvas({ maxWidth: 4000, maxHeight: 4000 });
          if (!cropped) throw new Error("裁剪结果为空");
          blob = await new Promise(function (resolve) { cropped.toBlob(resolve, mime, mime === "image/jpeg" ? 0.92 : undefined); });
          if (!blob) throw new Error("裁剪结果编码失败");
          type = mime;
        } catch (e) { /* 裁剪失败回退原图 */ }
      }
      /* BB-R21：裁剪器加载失败时不能静默回退原图（用户会误以为已按框裁剪）——
         明确提示并中止本次选择，网络恢复后重试仍可用（loadScript 失败已不缓存） */
      if (!cropCropper) {
        closeCropModal();
        if (done) done(null);
        if (global.alert) global.alert("裁剪组件加载失败，本次未执行裁剪（图片未被修改）。请检查网络后重试，或刷新页面。");
        return;
      }
      closeCropModal();
      if (done && blob) done({ url: URL.createObjectURL(blob), name: name, type: type });
      else if (done) done(null);
    });
    actions.appendChild(cancel); actions.appendChild(save); box.appendChild(actions);
    cropModal.appendChild(box);
    cropModal.addEventListener("click", function (e) { if (e.target === cropModal) { const done = cropDone; closeCropModal(); if (done) done(null); } });
    document.body.appendChild(cropModal);
    return img;
  }
  function openImageWithCrop(file, done, aspectRatio) {
    const MUI = global.MobileImageUpload;
    /* 无裁剪组件或文件非法时降级为「直选不裁」，保证基本功能可用 */
    if (!MUI || typeof MUI.open !== "function" || typeof MUI.ensureCropper !== "function") {
      done({ url: URL.createObjectURL(file), name: file.name, type: file.type });
      return;
    }
    cropDone = done; cropFileName = file.name;
    MUI.open(file).then(function (opened) {
      cropOpened = opened;
      const img = buildCropModal(opened.src);
      MUI.ensureCropper().then(function (Cropper) {
        if (!cropModal || !global.Cropper) return;
        /* 锁定展示比例进行裁剪：目标宽高比来自板块图片字段设置；未指定比例时自由裁剪 */
        const options = { viewMode: 1, autoCropArea: 1, dragMode: "move" };
        if (aspectRatio && aspectRatio > 0) options.aspectRatio = aspectRatio;
        cropCropper = new global.Cropper(img, options);
      }).catch(function () { cropCropper = null; });
    }).catch(function (error) {
      cropOpened = null;
      if (global.alert) global.alert(MUI.errorMessage ? MUI.errorMessage(error) : "图片读取失败，请换一张图片重试。");
      if (cropDone) { const cb = cropDone; cropDone = null; cb(null); }
    });
  }

  /* 根据图片字段语义推断裁剪目标比例（宽/高，0 表示自由裁剪）：
     - qrImage：二维码正方形语义，不锁比例（裁变形会损坏扫码）
     - avatar：头像字段，取成员对象自带的 avatarRatio
     - image：自由图片框主图，取对象自带的 ratio（"auto" 视为自由）
     - 其余统一回落到模块级 imageRatio（LAYOUT_FIELDS 的图片比例）；模块级数据经 fallbackData 传入，
       以覆盖 objectList 嵌套图片（obj 是子条目、本身不带 imageRatio 的情况，渲染层会统一套用模块 imageRatio） */
  function cropAspectForField(field, obj, fallbackData) {
    const key = field ? field.key : "";
    if (!obj || !key) return 0;
    if (key === "qrImage") return 0;
    if (key === "avatar" && obj.avatarRatio) return ratioNumber(obj.avatarRatio);
    if (key === "image" && obj.ratio && obj.ratio !== "auto") return ratioNumber(obj.ratio);
    const src = (obj.imageRatio && obj.imageRatio !== "auto") ? obj : (fallbackData && fallbackData.imageRatio && fallbackData.imageRatio !== "auto" ? fallbackData : null);
    if (src) return ratioNumber(src.imageRatio);
    return 0;
  }

  function imageField(field, obj, id, moduleData) {
    const wrap = el("div", "bb-image-field");
    const preview = el("div", "bb-image-preview");
    const current = obj[field.key];
    if (imageSrc(current)) {
      const img = el("img", "bb-image-thumb");
      img.src = current.url;
      img.alt = current.name || "已选图片";
      preview.appendChild(img);
    } else preview.appendChild(el("span", "bb-image-empty", "未选择"));
    const actions = el("div", "bb-image-actions");
    const pick = el("label", "bb-file-btn", "选择图片");
    pick.htmlFor = id;
    const input = el("input");
    input.type = "file";
    input.id = id;
    input.accept = "image/*";
    input.className = "bb-file-input";
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (!file) return;
      openImageWithCrop(file, function (value) {
        if (value) { replaceImageRecord(obj, field.key, value); renderAll(); }
      }, cropAspectForField(field, obj, moduleData));
      input.value = "";
    });
    pick.appendChild(input);
    actions.appendChild(pick);
    if (current && current.url) {
      const clear = el("button", "bb-mini-btn", "移除");
      clear.type = "button";
      clear.addEventListener("click", function () { replaceImageRecord(obj, field.key, null); renderAll(); });
      actions.appendChild(clear);
    }
    actions.appendChild(el("span", "bb-image-name", current && current.name ? current.name : "仅在浏览器本地处理"));
    wrap.appendChild(preview);
    wrap.appendChild(actions);
    return wrap;
  }

  function defaultFor(field) {
    if (field.type === "select") return field.options && field.options[0] ? field.options[0].value : "";
    if (field.type === "number") return 0;
    if (field.type === "image" || field.type === "imageList") return field.type === "imageList" ? [] : null;
    if (field.type === "stringList" || field.type === "objectList") return [];
    return "";
  }

  function newEntry(field) {
    const value = {};
    (field.fields || []).forEach(function (sub) { value[sub.key] = defaultFor(sub); });
    return value;
  }

  function buildField(field, obj, moduleType, moduleData) {
    const wrap = el("div", "bb-field");
    const id = "bb-input-" + (++inputId);
    if (field.dynamicOptions === "templates") {
      field = Object.assign({}, field, { options: R.templateOptions(moduleType) });
    }
    if (field.type === "image") return imageField(field, obj, id, moduleData);
    if (field.type === "stringList") return buildStringList(field, obj, wrap);
    if (field.type === "objectList") return buildObjectList(field, obj, wrap, moduleType, moduleData);
    if (field.type === "imageList") return buildImageList(field, obj, wrap, moduleData);

    const label = el("label", "bb-field-label", field.label);
    label.htmlFor = id;
    wrap.appendChild(label);
    let input;
    if (field.type === "textarea") {
      input = el("textarea", "bb-input");
      input.rows = field.rows || 4;
    } else if (field.type === "select") {
      input = el("select", "bb-input");
      if (field.dynamicOptions === "templates") input.dataset.templateField = "1";
      (field.options || []).forEach(function (option) {
        const item = el("option", null, option.label);
        item.value = option.value;
        input.appendChild(item);
      });
    } else if (field.type === "color") {
      input = el("input", "bb-input bb-color-input");
      input.type = "color";
    } else if (field.type === "range") {
      input = el("input", "bb-input bb-range-input");
      input.type = "range";
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;
    } else {
      input = el("input", "bb-input");
      input.type = field.type === "number" ? "number" : "text";
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;
    }
    input.id = id;
    input.value = obj[field.key] == null ? "" : String(obj[field.key]);
    if (field.type === "color" && !input.value) input.value = field.fallback || "#ffffff";
    if (field.type === "range" && (obj[field.key] == null || obj[field.key] === "")) input.value = String(field.fallback != null ? field.fallback : field.min != null ? field.min : 0);
    if (field.placeholder) input.placeholder = field.placeholder;
    input.addEventListener(field.type === "select" ? "change" : "input", function () {
      obj[field.key] = (field.type === "number" || field.type === "range") ? Number(input.value) || 0 : input.value;
      if (field.type === "select") renderAll(); else scheduleCanvas();
    });
    wrap.appendChild(input);
    /* range 类型：滑块 + 数值输入复合控件（可拖动、也可直接键入 px 数值）。
       键入过程中不回写输入框（避免打断输入），失焦/回车时收敛到合法范围。 */
    if (field.type === "range") {
      const rMin = Number(field.min != null ? field.min : 0);
      const rMax = Number(field.max != null ? field.max : rMin + 100);
      const rStep = Number(field.step) > 0 ? Number(field.step) : 1;
      const clampToStep = function (v) {
        let n = Math.round(v / rStep) * rStep;
        n = Math.min(rMax, Math.max(rMin, n));
        return n;
      };
      const row = el("div", "bb-range-row");
      input.classList.add("bb-range-slider");
      row.appendChild(input);
      const num = el("input", "bb-input bb-range-number");
      num.type = "number";
      num.min = rMin; num.max = rMax; num.step = rStep;
      num.value = input.value;
      num.title = "直接输入 " + rMin + "-" + rMax + " px";
      num.addEventListener("input", function () {
        const v = Number(num.value);
        if (num.value === "" || !Number.isFinite(v)) return; /* 键入中间态不回写 */
        const clamped = clampToStep(v);
        obj[field.key] = clamped;
        input.value = String(clamped);
        scheduleCanvas();
      });
      const settle = function () {
        const raw = num.value;
        const v = Number(raw);
        const base = raw === "" || !Number.isFinite(v) ? (field.fallback != null ? field.fallback : rMin) : v;
        const clamped = clampToStep(base);
        num.value = String(clamped);
        input.value = String(clamped);
        obj[field.key] = clamped;
        scheduleCanvas();
      };
      num.addEventListener("change", settle);
      num.addEventListener("blur", settle);
      input.addEventListener("input", function () { num.value = input.value; });
      row.appendChild(num);
      const unit = el("span", "bb-range-unit", "px");
      row.appendChild(unit);
      wrap.appendChild(row);
    }
    if (field.type === "color" && field.optional) {
      const clear = el("button", "bb-mini-btn", "跟随默认");
      clear.type = "button";
      clear.title = "清除本屏底色，跟随整条背景";
      clear.addEventListener("click", function () { obj[field.key] = ""; renderAll(); });
      wrap.appendChild(clear);
    }
    if (field.options === R.LEVEL_OPTIONS) {
      const warning = C.captionWarning(obj[field.key], pageSize().pageWidth);
      wrap.appendChild(el("p", "bb-hint" + (warning ? " warn" : ""), warning || "字号按画布宽度比例保存"));
    }
    return wrap;
  }

  function buildStringList(field, obj, wrap) {
    const list = Array.isArray(obj[field.key]) ? obj[field.key] : (obj[field.key] = []);
    const head = el("div", "bb-field-head");
    head.appendChild(el("span", "bb-field-label", field.label));
    head.appendChild(el("span", "bb-count", list.length + " 项"));
    const add = el("button", "bb-add-btn", "＋ 添加" + (field.itemLabel || "一行"));
    add.type = "button";
    add.addEventListener("click", function () { list.push(""); renderAll(); });
    head.appendChild(add);
    wrap.appendChild(head);
    const body = el("div", "bb-list");
    list.forEach(function (value, index) {
      const row = el("div", "bb-list-row");
      const input = el("input", "bb-input");
      input.value = value || "";
      input.placeholder = field.placeholder || "请输入内容";
      input.addEventListener("input", function () { list[index] = input.value; scheduleCanvas(); });
      const del = el("button", "bb-icon-btn danger", "×");
      del.type = "button";
      del.title = "删除这一项";
      del.addEventListener("click", function () { list.splice(index, 1); renderAll(); });
      row.appendChild(input); row.appendChild(del); body.appendChild(row);
    });
    if (!list.length) body.appendChild(el("p", "bb-hint", "还没有内容，点击添加。"));
    wrap.appendChild(body);
    return wrap;
  }

  function buildObjectList(field, obj, wrap, moduleType, moduleData) {
    const list = Array.isArray(obj[field.key]) ? obj[field.key] : (obj[field.key] = []);
    const head = el("div", "bb-field-head");
    head.appendChild(el("span", "bb-field-label", field.label));
    head.appendChild(el("span", "bb-count", list.length + " 项"));
    const add = el("button", "bb-add-btn", "＋ 添加" + (field.itemLabel || "一条"));
    add.type = "button";
    add.addEventListener("click", function () { list.push(newEntry(field)); renderAll(); });
    head.appendChild(add); wrap.appendChild(head);
    list.forEach(function (entry, index) {
      const card = el("div", "bb-entry");
      const title = el("div", "bb-entry-head");
      title.appendChild(el("span", "bb-entry-title", (field.itemLabel || "条目") + " " + (index + 1)));
      const del = el("button", "bb-icon-btn danger", "×");
      del.type = "button";
      del.title = "删除这一项";
      del.addEventListener("click", function () { list.splice(index, 1); renderAll(); });
      title.appendChild(del); card.appendChild(title);
      const body = el("div", "bb-entry-body");
      (field.fields || []).forEach(function (sub) { body.appendChild(buildField(sub, entry, moduleType, moduleData)); });
      card.appendChild(body); wrap.appendChild(card);
    });
    if (!list.length) wrap.appendChild(el("p", "bb-hint", "还没有内容，点击添加。"));
    return wrap;
  }

  function buildImageList(field, obj, wrap, moduleData) {
    const list = Array.isArray(obj[field.key]) ? obj[field.key] : (obj[field.key] = []);
    const head = el("div", "bb-field-head");
    head.appendChild(el("span", "bb-field-label", field.label));
    head.appendChild(el("span", "bb-count", list.length + " / " + (field.max || 4)));
    const id = "bb-input-" + (++inputId);
    const add = el("label", "bb-add-btn", "＋ 添加图片");
    add.htmlFor = id;
    const input = el("input");
    input.id = id; input.type = "file"; input.accept = "image/*"; input.className = "bb-file-input";
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (!file || list.length >= (field.max || 4)) return;
      openImageWithCrop(file, function (value) {
        if (value) { list.push(value); renderAll(); }
      }, cropAspectForField(field, obj, moduleData));
      input.value = "";
    });
    add.appendChild(input); head.appendChild(add); wrap.appendChild(head);
    const grid = el("div", "bb-image-grid");
    list.forEach(function (item, index) {
      const cell = el("div", "bb-image-cell");
      const img = el("img", "bb-image-thumb"); img.src = item.url; img.alt = item.name || "已选图片";
      const del = el("button", "bb-icon-btn danger", "×"); del.type = "button"; del.title = "移除这张图片";
      del.addEventListener("click", function () { const removed = list.splice(index, 1)[0]; refreshProtectedBlobUrls(); releaseImageRecord(removed); renderAll(); });
      cell.appendChild(img); cell.appendChild(del); grid.appendChild(cell);
    });
    if (list.length) wrap.appendChild(grid); else wrap.appendChild(el("p", "bb-hint", "还没有图片，点击添加。"));
    return wrap;
  }

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

  function addVisualBody(box, module) {
    const data = module.data;
    const tpl = data.template || "";
    switch (module.type) {
      case "cover": renderCover(box, data, tpl); break;
      case "announcement": renderAnnouncement(box, data, tpl); break;
      case "ticketInfo": renderTicket(box, data, tpl); break;
      case "materials": renderMaterials(box, data, tpl); break;
      case "crossPromo": renderCrossPromo(box, data, tpl); break;
      case "schedule": renderSchedule(box, data, tpl); break;
      case "venueInfo": renderVenue(box, data, tpl); break;
      case "routeText": renderRoute(box, data, tpl); break;
      case "programList": renderProgram(box, data, tpl); break;
      case "castList":
      case "castCards":
        renderPerformer(box, data, tpl); break;
      case "boothList": renderBooth(box, data, tpl); break;
      case "divider": renderDivider(box, data, tpl); break;
      case "footer": renderFooter(box, data, tpl); break;
      case "freeText": renderFreeText(box, data, tpl); break;
      case "freeImageBox": renderFreeImage(box, data, tpl); break;
      default: box.appendChild(el("p", "bb-art-body", "内容模块"));
    }
  }

  function renderCover(box, data, tpl) {
    const img = visualImage(imageSrc(data.mainImage), "bb-art-cover-image", "主视觉图");
    /* imageSize：主视觉高度（0=模板默认）；info/split 模板生效，immersive/minimal 不受影响 */
    const userH = imageSizeOf(data, "imageSize", 0, 1000, 4);
    if (userH > 0 && img) img.style.maxHeight = userH + "px";
    if (tpl === "info") {
      if (img) { const figure = el("div", "bb-cover-figure"); figure.appendChild(img); box.appendChild(figure); }
      const copy = el("div", "bb-cover-info-copy");
      copy.appendChild(el("strong", "bb-art-h1", text(data.title, "活动主标题")));
      if (data.subtitle) copy.appendChild(el("span", "bb-art-subtitle", data.subtitle));
      const lines = (data.infoLines || []).slice(0, 4);
      if (lines.length) { const ul = el("div", "bb-cover-info-lines"); lines.forEach(function (line) { ul.appendChild(el("div", "bb-cover-info-line", line)); }); copy.appendChild(ul); }
      if (data.qqGroupNumber) copy.appendChild(el("div", "bb-cover-qq", "QQ 群：" + data.qqGroupNumber));
      box.appendChild(copy); return;
    }
    if (tpl === "minimal") {
      const copy = el("div", "bb-cover-minimal");
      copy.appendChild(el("strong", "bb-art-h1", text(data.title, "活动主标题")));
      if (data.subtitle) copy.appendChild(el("span", "bb-art-subtitle", data.subtitle));
      const lines = (data.infoLines || []).slice(0, 4);
      if (lines.length) { const ul = el("div", "bb-cover-info-lines"); lines.forEach(function (line) { ul.appendChild(el("div", "bb-cover-info-line", line)); }); copy.appendChild(ul); }
      if (data.qqGroupNumber) copy.appendChild(el("div", "bb-cover-qq", "QQ 群：" + data.qqGroupNumber));
      box.appendChild(copy); return;
    }
    if (tpl === "split") {
      if (img) { const figure = el("div", "bb-cover-figure"); figure.appendChild(img); box.appendChild(figure); }
      const panel = el("div", "bb-cover-panel");
      panel.appendChild(el("strong", "bb-art-h1", text(data.title, "活动主标题")));
      if (data.subtitle) panel.appendChild(el("span", "bb-art-subtitle", data.subtitle));
      const lines = (data.infoLines || []).slice(0, 4);
      if (lines.length) { const ul = el("div", "bb-cover-info-lines"); lines.forEach(function (line) { ul.appendChild(el("div", "bb-cover-info-line", line)); }); panel.appendChild(ul); }
      if (data.qqGroupNumber) panel.appendChild(el("div", "bb-cover-qq", "QQ 群：" + data.qqGroupNumber));
      box.appendChild(panel); return;
    }
    const hero = el("div", "bb-art-cover");
    if (img) hero.appendChild(img);
    const overlay = el("div", "bb-art-cover-copy");
    overlay.appendChild(el("strong", "bb-art-h1", text(data.title, "活动主标题")));
    if (data.subtitle) overlay.appendChild(el("span", "bb-art-subtitle", data.subtitle));
    (data.infoLines || []).slice(0, 3).forEach(function (line) { overlay.appendChild(el("span", "bb-art-info", line)); });
    hero.appendChild(overlay); box.appendChild(hero);
  }

  function renderAnnouncement(box, data, tpl) {
    if (tpl === "quote") {
      const quote = el("div", "bb-announce-quote");
      quote.appendChild(el("span", "bb-quote-mark", "“"));
      quote.appendChild(el("p", "bb-art-body", text(data.body, "重点引语内容")));
      if (data.heading) quote.appendChild(el("span", "bb-quote-source", data.heading));
      box.appendChild(quote); return;
    }
    if (tpl === "plain") {
      if (data.heading) box.appendChild(el("strong", "bb-art-h3", data.heading));
      box.appendChild(el("p", "bb-art-body", text(data.body, "在这里填写活动公告、入场须知或情报说明。"))); return;
    }
    if (tpl === "boxed") {
      const boxed = el("div", "bb-announce-box");
      if (data.heading) boxed.appendChild(el("strong", "bb-art-h3", data.heading));
      boxed.appendChild(el("p", "bb-art-body", text(data.body, "在这里填写活动公告、入场须知或情报说明。")));
      box.appendChild(boxed); return;
    }
    const card = el("div", "bb-announce-notice");
    if (data.heading) card.appendChild(el("strong", "bb-announce-notice-title", data.heading));
    card.appendChild(el("p", "bb-art-body", text(data.body, "在这里填写活动公告、入场须知或情报说明。")));
    box.appendChild(card);
  }

  function renderTicket(box, data, tpl) {
    const qr = visualImage(imageSrc(data.qrImage), "bb-art-qr", "购票二维码");
    /* qrSize：二维码边长（px，画布坐标系），未设置走 CSS 默认 208 */
    const qrPx = imageSizeOf(data, "qrSize", 120, 320, 4);
    if (qrPx && qr) { qr.style.width = qrPx + "px"; qr.style.height = qrPx + "px"; }
    const tiers = data.tiers || [];
    if (tpl === "ticket-cards") {
      const grid = el("div", "bb-ticket-cards");
      tiers.forEach(function (tier) { const card = el("div", "bb-ticket-card"); card.appendChild(el("span", "bb-ticket-card-label", text(tier.label, "票档"))); card.appendChild(el("strong", "bb-ticket-card-price", text(tier.price, "价格"))); grid.appendChild(card); });
      if (!tiers.length) grid.appendChild(el("p", "bb-art-caption", "暂无票档"));
      box.appendChild(grid);
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note));
      if (qr) box.appendChild(el("div", "bb-ticket-qr-wrap", qr)); return;
    }
    if (tpl === "ticket-focus") {
      const focus = el("div", "bb-ticket-focus");
      const first = tiers[0];
      if (first) { focus.appendChild(el("strong", "bb-ticket-focus-price", text(first.price, "价格"))); focus.appendChild(el("span", "bb-ticket-focus-label", text(first.label, "票档"))); }
      if (qr) focus.appendChild(qr);
      box.appendChild(focus);
      const rest = tiers.slice(1);
      if (rest.length) { const list = el("div", "bb-ticket-rest"); rest.forEach(function (t) { list.appendChild(el("div", "bb-ticket-rest-item", text(t.label, "") + "　" + text(t.price, ""))); }); box.appendChild(list); }
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note)); return;
    }
    if (tpl === "ticket-hero") {
      const first = tiers[0];
      const hero = el("div", "bb-ticket-hero");
      hero.appendChild(el("strong", "bb-ticket-hero-price", text(first ? first.price : "价格", "价格")));
      hero.appendChild(el("span", "bb-ticket-hero-label", text(first ? first.label : "票档", "票档")));
      box.appendChild(hero);
      const rest = tiers.slice(1);
      if (rest.length) { const list = el("div", "bb-ticket-rest"); rest.forEach(function (t) { list.appendChild(el("div", "bb-ticket-rest-item", text(t.label, "") + "　" + text(t.price, ""))); }); box.appendChild(list); }
      if (qr) box.appendChild(el("div", "bb-ticket-qr-wrap", qr));
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note)); return;
    }
    const row = el("div", "bb-art-split");
    const copy = el("div");
    tiers.forEach(function (tier) { const p = el("div", "bb-art-ticket"); p.appendChild(el("b", null, text(tier.label, "票档"))); p.appendChild(el("span", null, text(tier.price, "价格"))); copy.appendChild(p); });
    if (!tiers.length) copy.appendChild(el("p", "bb-art-caption", "暂无票档"));
    if (data.note) copy.appendChild(el("p", "bb-art-caption", data.note));
    row.appendChild(copy); if (qr) row.appendChild(qr); box.appendChild(row);
  }

  function renderMaterials(box, data, tpl) {
    const items = data.items || [];
    if (tpl === "checklist") {
      const list = el("div", "bb-materials-checklist");
      items.forEach(function (item) { list.appendChild(el("div", "bb-checklist-item", text(item.label, "物料条目"))); });
      if (!items.length) list.appendChild(el("p", "bb-art-caption", "暂无条目"));
      box.appendChild(list);
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note)); return;
    }
    if (tpl === "notice-strip") {
      const list = el("div", "bb-materials-strip");
      items.forEach(function (item) { list.appendChild(el("div", "bb-strip-item", text(item.label, "物料条目"))); });
      if (!items.length) list.appendChild(el("p", "bb-art-caption", "暂无条目"));
      box.appendChild(list);
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note)); return;
    }
    /* iconSize：整板块统一图标大小（px，画布坐标系），DOM 预览与导出同源；上限放宽到接近板块容器宽 */
    const size = Math.round(Math.min(600, Math.max(48, Number(data.iconSize) || 104)));
    box.style.setProperty("--bb-mat-icon-size", size + "px");
    addGrid(box, items, data.columns, "icon", "label", "物料条目");
    if (data.note) box.appendChild(el("p", "bb-art-caption", data.note));
  }

  function renderCrossPromo(box, data, tpl) {
    const img = visualImage(imageSrc(data.icon), "bb-art-icon", "联动方图标");
    /* iconSize：联动图标边长（px，画布坐标系），未设置走 CSS 默认 104 */
    const iconPx = imageSizeOf(data, "iconSize", 60, 220, 4);
    if (iconPx && img) { img.style.width = iconPx + "px"; img.style.height = iconPx + "px"; }
    if (tpl === "promo-strip") {
      const strip = el("div", "bb-promo-strip");
      if (img) strip.appendChild(img);
      strip.appendChild(el("p", "bb-art-body", text(data.text, "联动推广文案")));
      box.appendChild(strip); return;
    }
    if (tpl === "promo-centered") {
      const center = el("div", "bb-promo-centered");
      if (img) center.appendChild(img);
      center.appendChild(el("p", "bb-art-body", text(data.text, "联动推广文案")));
      box.appendChild(center); return;
    }
    const row = el("div", "bb-art-split");
    if (img) row.appendChild(img);
    row.appendChild(el("p", "bb-art-body", text(data.text, "联动推广文案")));
    box.appendChild(row);
  }

  function renderSchedule(box, data, tpl) {
    const groups = data.groups || [];
    if (tpl === "schedule-table") {
      groups.forEach(function (group) {
        const tbl = el("div", "bb-schedule-table");
        tbl.appendChild(el("strong", "bb-art-h3", text(group.groupName, "活动时间")));
        (group.rows || []).forEach(function (item) { const r = el("div", "bb-schedule-table-row"); r.appendChild(el("b", null, text(item.time, "00:00"))); r.appendChild(el("span", null, text(item.name, "环节"))); tbl.appendChild(r); });
        box.appendChild(tbl);
      });
      if (!groups.length) box.appendChild(el("p", "bb-art-caption", "暂无时间安排")); return;
    }
    if (tpl === "schedule-cards") {
      groups.forEach(function (group) {
        const card = el("div", "bb-schedule-card");
        card.appendChild(el("strong", "bb-art-h3", text(group.groupName, "活动时间")));
        (group.rows || []).forEach(function (item) { const r = el("div", "bb-schedule-card-row"); r.appendChild(el("span", null, text(item.name, "环节"))); r.appendChild(el("b", null, text(item.time, "00:00"))); card.appendChild(r); });
        box.appendChild(card);
      });
      if (!groups.length) box.appendChild(el("p", "bb-art-caption", "暂无时间安排")); return;
    }
    groups.forEach(function (group) {
      const g = el("div", "bb-art-timeline-group");
      g.appendChild(el("strong", "bb-art-h3", text(group.groupName, "活动时间")));
      (group.rows || []).forEach(function (item) { const r = el("div", "bb-art-time-row"); r.appendChild(el("b", null, text(item.time, "00:00"))); r.appendChild(el("span", null, text(item.name, "环节"))); g.appendChild(r); });
      box.appendChild(g);
    });
    if (!groups.length) box.appendChild(el("p", "bb-art-caption", "暂无时间安排"));
  }

  function renderVenue(box, data, tpl) {
    const img = visualImage(imageSrc(data.photo), "bb-art-side-image", "场地照片");
    /* photoSize：venue-side 模板右侧照片边长（px，画布坐标系），未设置走 CSS 默认 162 */
    const photoPx = imageSizeOf(data, "photoSize", 100, 400, 4);
    if (photoPx && img && tpl !== "venue-focus" && tpl !== "venue-map") { img.style.width = photoPx + "px"; img.style.height = photoPx + "px"; }
    const tags = data.tags || [];
    function buildTags() { const chips = el("div", "bb-venue-tags"); tags.forEach(function (t) { chips.appendChild(el("span", "bb-venue-tag", t)); }); return chips; }
    if (tpl === "venue-focus") {
      if (img) { const figure = el("div", "bb-venue-focus-figure"); figure.appendChild(img); box.appendChild(figure); }
      box.appendChild(el("p", "bb-art-body", text(data.description, "场地描述")));
      if (tags.length) box.appendChild(buildTags()); return;
    }
    if (tpl === "venue-map") {
      const map = el("div", "bb-venue-map");
      map.appendChild(el("p", "bb-art-body", text(data.description, "场地描述")));
      if (tags.length) map.appendChild(buildTags());
      box.appendChild(map); return;
    }
    const row = el("div", "bb-art-split");
    const copy = el("div");
    copy.appendChild(el("p", "bb-art-body", text(data.description, "场地描述")));
    if (tags.length) copy.appendChild(buildTags());
    row.appendChild(copy);
    if (img) row.appendChild(img);
    box.appendChild(row);
  }

  function renderRoute(box, data, tpl) {
    const lines = data.lines || [];
    if (tpl === "route-list") {
      const list = el("div", "bb-route-list");
      lines.forEach(function (line) { list.appendChild(el("div", "bb-route-list-item", line)); });
      if (!lines.length) list.appendChild(el("p", "bb-art-caption", "暂无路线"));
      box.appendChild(list); return;
    }
    if (tpl === "route-focus") {
      const first = lines[0];
      if (first) box.appendChild(el("div", "bb-route-focus", first));
      const rest = lines.slice(1);
      if (rest.length) { const list = el("div", "bb-route-list"); rest.forEach(function (line) { list.appendChild(el("div", "bb-route-list-item", line)); }); box.appendChild(list); }
      if (!lines.length) box.appendChild(el("p", "bb-art-caption", "暂无路线")); return;
    }
    lines.forEach(function (line, index) { const r = el("div", "bb-art-route-row"); r.appendChild(el("b", null, String(index + 1).padStart(2, "0"))); r.appendChild(el("span", null, line)); box.appendChild(r); });
    if (!lines.length) box.appendChild(el("p", "bb-art-caption", "暂无路线"));
  }

  function renderProgram(box, data, tpl) {
    const items = data.items || [];
    if (tpl === "program-cards") {
      const grid = el("div", "bb-program-cards");
      items.forEach(function (item) {
        const card = el("div", "bb-program-card");
        const img = visualImage(imageSrc(item.image), "bb-program-card-image", "节目配图");
        if (img) card.appendChild(img);
        const c = el("div");
        if (item.tag) c.appendChild(el("span", "bb-program-card-tag", item.tag));
        c.appendChild(el("strong", null, text(item.title, "节目标题")));
        if (item.subtitle) c.appendChild(el("span", null, item.subtitle));
        card.appendChild(c); grid.appendChild(card);
      });
      if (!items.length) grid.appendChild(el("p", "bb-art-caption", "暂无节目"));
      box.appendChild(grid); return;
    }
    if (tpl === "program-compact") {
      const grid = el("div", "bb-program-compact");
      items.forEach(function (item) { const cell = el("div", "bb-program-compact-item"); cell.appendChild(el("b", null, text(item.tag, "节目"))); cell.appendChild(el("strong", null, text(item.title, "节目标题"))); grid.appendChild(cell); });
      if (!items.length) grid.appendChild(el("p", "bb-art-caption", "暂无节目"));
      box.appendChild(grid); return;
    }
    items.forEach(function (item) {
      const r = el("div", "bb-art-program-row");
      const img = visualImage(imageSrc(item.image), "bb-art-program-image", "节目配图");
      /* thumbWidth：节目列表配图宽度（px，画布坐标系），未设置走 CSS 默认 162；高度同宽（正方形） */
      const tw = imageSizeOf(data, "thumbWidth", 80, 300, 4);
      if (tw && img) { img.style.width = tw + "px"; img.style.height = tw + "px"; }
      if (item.mediaSide === "left" && img) r.appendChild(img);
      const c = el("div");
      if (item.tag) c.appendChild(el("b", null, text(item.tag, "节目")));
      c.appendChild(el("strong", null, text(item.title, "节目标题")));
      if (item.subtitle) c.appendChild(el("span", null, item.subtitle));
      r.appendChild(c);
      if (item.mediaSide !== "left" && img) r.appendChild(img);
      box.appendChild(r);
    });
    if (!items.length) box.appendChild(el("p", "bb-art-caption", "暂无节目"));
  }

  function renderPerformer(box, data, tpl) {
    const cast = data.cast || [];
    /* 头像尺寸（按比例换算高度，宽度 = avatarWidth 或默认 150） */
    const avatarW = imageSizeOf(data, "avatarWidth", 80, 260, 4) || 150;
    function avatarSize(ratio) {
      const w = avatarW;
      switch (ratio) {
        case "1:1": return { w: w, h: Math.round(w) };
        case "3:4": return { w: w, h: Math.round(w * 4 / 3) };
        case "1:1.4": return { w: w, h: Math.round(w * 1.4) };
        default: return { w: w, h: Math.round(w) };
      }
    }
    function buildAvatar(member) {
      const style = safeClassSuffix(artTheme().avatarStyle, "none");
      const media = el("div", "bb-cast-media " + style);
      const size = avatarSize(member.avatarRatio || "1:1");
      const img = visualImage(imageSrc(member.avatar), "bb-cast-avatar", "头像");
      if (img) { img.style.width = size.w + "px"; img.style.height = size.h + "px"; media.appendChild(img); }
      else { const ph = el("div", "bb-cast-avatar placeholder"); ph.style.width = size.w + "px"; ph.style.height = size.h + "px"; ph.textContent = "未设头像"; media.appendChild(ph); }
      return media;
    }
    function buildSetlist(member) {
      const list = (member.setlist || []).filter(function (s) { return s && (s.song || s.coverBy); });
      if (!list.length) return null;
      const hasCover = list.some(function (s) { return s.coverBy; });
      const wrap = el("div", "bb-setlist" + (hasCover ? "" : " single"));
      const head = el("div", "bb-setlist-head");
      head.appendChild(el("span", null, "歌单"));
      if (hasCover) head.appendChild(el("span", null, "原唱 / Cover"));
      wrap.appendChild(head);
      list.forEach(function (s) {
        const row = el("div", "bb-setlist-row");
        row.appendChild(el("span", "bb-setlist-song", s.song || ""));
        if (hasCover) row.appendChild(el("span", "bb-setlist-cover", s.coverBy || ""));
        wrap.appendChild(row);
      });
      return wrap;
    }
    function buildCopy(member) {
      const c = el("div", "bb-cast-info");
      const head = el("div", "bb-cast-head");
      head.appendChild(el("strong", "bb-art-h3", text(member.name, "成员名称")));
      if (member.role) head.appendChild(el("span", "bb-cast-role", R.castRoleLabel(member.role)));
      if (member.time) head.appendChild(el("span", "bb-cast-time", member.time));
      c.appendChild(head);
      if (member.bio) c.appendChild(el("p", "bb-cast-bio", member.bio));
      const sl = buildSetlist(member);
      if (sl) c.appendChild(sl);
      return c;
    }
    if (tpl === "cast-cards") {
      const grid = el("div", "bb-cast-cards");
      cast.forEach(function (member) {
        const card = el("div", "bb-cast-card");
        card.appendChild(buildAvatar(member));
        card.appendChild(buildCopy(member));
        grid.appendChild(card);
      });
      if (!cast.length) grid.appendChild(el("p", "bb-art-caption", "暂无阵容"));
      box.appendChild(grid); return;
    }
    const list = el("div", "bb-cast-list");
    cast.forEach(function (member) {
      const row = el("div", "bb-cast-member");
      row.appendChild(buildAvatar(member));
      row.appendChild(buildCopy(member));
      list.appendChild(row);
    });
    if (!cast.length) list.appendChild(el("p", "bb-art-caption", "暂无阵容"));
    box.appendChild(list);
  }

  function renderBooth(box, data, tpl) {
    const items = data.items || [];
    /* imageWidth：摊位卡片图边长（px，画布坐标系），未设置走 CSS 默认 150 */
    const boothImgPx = imageSizeOf(data, "imageWidth", 80, 260, 4);
    if (tpl === "booth-cards") {
      const list = el("div", "bb-booth-cards");
      items.forEach(function (item) {
        const card = el("div", "bb-booth-card");
        const img = visualImage(imageSrc(item.image), "bb-booth-card-image", "摊位图");
        if (boothImgPx && img) { img.style.width = boothImgPx + "px"; img.style.height = boothImgPx + "px"; }
        if (img) card.appendChild(img);
        const c = el("div");
        c.appendChild(el("strong", null, text(item.name, "摊位")));
        if (item.desc) c.appendChild(el("span", null, item.desc));
        card.appendChild(c); list.appendChild(card);
      });
      if (!items.length) list.appendChild(el("p", "bb-art-caption", "暂无摊位"));
      box.appendChild(list); return;
    }
    if (tpl === "booth-list") {
      const list = el("div", "bb-booth-list");
      items.forEach(function (item) { const row = el("div", "bb-booth-list-item"); row.appendChild(el("strong", null, text(item.name, "摊位"))); if (item.desc) row.appendChild(el("span", null, item.desc)); list.appendChild(row); });
      if (!items.length) list.appendChild(el("p", "bb-art-caption", "暂无摊位"));
      box.appendChild(list); return;
    }
    /* booth-grid：网格图高度 = imageWidth（px，画布坐标系），未设置走 CSS 默认 187 */
    if (boothImgPx) box.style.setProperty("--bb-mat-icon-size", boothImgPx + "px");
    addGrid(box, items, data.columns, "image", "name", "摊位条目", "desc");
  }

  function renderDivider(box, data, tpl) {
    const themeDiv = artTheme().divider || "wave";
    const raw = (tpl === "wave" && themeDiv !== "wave") ? themeDiv : (tpl || themeDiv);
    const style = ["dots", "line", "glitch", "thread", "dashed"].indexOf(raw) >= 0 ? raw : "wave";
    box.appendChild(el("div", "bb-art-divider " + style, ""));
  }

  function renderFooter(box, data, tpl) {
    const lines = data.lines || [];
    if (tpl === "footer-banner") {
      const banner = el("div", "bb-footer-banner");
      lines.forEach(function (line) { banner.appendChild(el("span", "bb-footer-banner-item", line)); });
      if (!lines.length) banner.appendChild(el("span", "bb-footer-banner-item", "微博 @XXX"));
      box.appendChild(banner); return;
    }
    if (tpl === "footer-center") {
      lines.forEach(function (line) { box.appendChild(el("p", "bb-art-caption bb-caption-center", line)); });
      if (!lines.length) box.appendChild(el("p", "bb-art-caption bb-caption-center", "微博 @XXX")); return;
    }
    if (tpl === "footer-pills") {
      const wrap = el("div", "bb-footer-pills");
      const items = lines.length ? lines : ["主办：Only-box 企划"];
      items.forEach(function (line) { wrap.appendChild(el("span", null, line)); });
      box.appendChild(wrap); return;
    }
    lines.forEach(function (line) { box.appendChild(el("p", "bb-art-caption", line)); });
    if (!lines.length) box.appendChild(el("p", "bb-art-caption", "微博 @XXX"));
  }

  function renderFreeText(box, data, tpl) {
    const cls = "bb-art-free-text " + text(data.level, "body") + " align-" + text(data.align, "left");
    if (tpl === "text-highlight") {
      const hl = el("div", "bb-free-text-highlight");
      hl.appendChild(el("p", cls, text(data.text, "自由文本")));
      box.appendChild(hl); return;
    }
    if (tpl === "text-note") {
      box.appendChild(el("p", "bb-art-free-text bb-free-text-note", text(data.text, "自由文本"))); return;
    }
    if (tpl === "text-card") {
      const card = el("div", "bb-text-card");
      card.appendChild(el("p", cls, text(data.text, "自由文本")));
      box.appendChild(card); return;
    }
    box.appendChild(el("p", cls, text(data.text, "自由文本")));
  }

  function renderFreeImage(box, data, tpl) {
    const img = visualImage(imageSrc(data.image), "bb-art-free-image", "自由图片");
    if (tpl === "image-card") {
      const card = el("div", "bb-free-image-card");
      if (img) card.appendChild(img);
      if (data.caption) card.appendChild(el("p", "bb-art-caption", data.caption));
      box.appendChild(card); return;
    }
    if (img) box.appendChild(img);
    if (data.caption) box.appendChild(el("p", "bb-art-caption", data.caption));
  }

  function addGrid(box, list, columns, imageKey, titleKey, emptyText, descKey) {
    const grid = el("div", "bb-art-grid cols-" + text(columns, "2"));
    (list || []).forEach(function (item) { const cell = el("div", "bb-art-grid-item"); const img = visualImage(imageSrc(item[imageKey]), "bb-art-grid-image", ""); if (img) cell.appendChild(img); cell.appendChild(el("strong", null, text(item[titleKey], emptyText))); if (descKey && item[descKey]) cell.appendChild(el("span", null, item[descKey])); grid.appendChild(cell); });
    if (!list || !list.length) grid.appendChild(el("p", "bb-art-caption", "暂无" + emptyText)); box.appendChild(grid);
  }

  function applyBlockSurface(box, data) {
    const opacity = Number.isFinite(Number(data.blockOpacity)) ? Number(data.blockOpacity) / 100 : .94;
    const st = artTheme();
    box.style.padding = styleCardPad(Math.min(80, Math.max(17, px2(Number(data.padding) != null ? Number(data.padding) : 16))), st) + "px";
    box.style.marginBottom = Math.max(px2(Number(data.marginBottom) || 18), 24) + "px";
    box.style.borderRadius = cardRadius(data, st) + "px";
    box.style.textAlign = data.contentAlign || "left";
    box.style.backgroundColor = cardBaseFill(st, data, opacity);
    box.style.borderStyle = st.cardStyle === "ticket" ? "dashed" : "solid";
    box.style.borderWidth = (st.cardStyle === "panel" ? 2.5 : st.cardStyle === "sticker" ? 7 : st.cardStyle === "glass" ? 1.5 : st.cardStyle === "ink" ? 2 : 2) + "px";
    box.style.borderColor = data.blockBorderColor || (st.cardStyle === "panel" ? st.primaryDark : st.cardStyle === "sticker" ? alphaColor(st.primary, 0.9) : st.cardStyle === "glass" ? alphaColor("#ffffff", 0.7) : st.cardStyle === "ink" ? alphaColor(st.primaryDark, 0.75) : st.cardStyle === "ticket" ? alphaColor(st.primary, 0.45) : alphaColor(st.primary, 0.16));
    let domShadow = st.shadow === "hard" ? "6px 7px 0 " + alphaColor(st.primaryDark, 0.85)
      : st.shadow === "glow" ? "0 4px 22px " + alphaColor(st.primary, 0.5)
      : st.shadow === "none" ? "none"
      : "0 12px 26px rgba(38,65,51,.15)";
    if (st.cardStyle === "sticker") domShadow += ", inset 0 0 0 3px #ffffff";
    if (st.cardStyle === "ink") domShadow += ", inset 0 0 0 1px " + alphaColor(st.primary, 0.35);
    box.style.boxShadow = domShadow;
    box.classList.remove("bb-card-card", "bb-card-panel", "bb-card-glass", "bb-card-ink", "bb-card-ticket", "bb-card-sticker");
    box.classList.add("bb-card-" + safeClassSuffix(st.cardStyle, "card"));
    if (data.blockBgImage && data.blockBgImage.url) { box.style.backgroundImage = "url(\"" + data.blockBgImage.url + "\")"; box.style.backgroundSize = "cover"; box.style.backgroundPosition = "center"; }
    box.dataset.imageRatio = data.imageRatio || "auto";
    box.dataset.imageFit = data.imageFit || "cover";
  }

  function applyBodyFontScope(rootEl) {
    if (!rootEl) return;
    rootEl.style.fontFamily = C.bodyFontStack(state.doc);
  }

  function buildModule(page, module, index) {
    const def = R.getDef(module.type);
    const tpl = module.data.template || "";
    const box = el("article", "bb-art-module width-" + text(module.data.width, "full") + " bb-tpl-" + module.type + "-" + (tpl || "default"));
    box.dataset.action = "module-pick"; box.dataset.moduleId = module.id; box.dataset.template = tpl;
    if (module.id === state.selectedModuleId) box.classList.add("is-selected");
    applyBlockSurface(box, module.data);
    const head = el("div", "bb-art-module-head");
    const title = el("div", "bb-art-module-title");
    title.appendChild(el("span", "bb-art-kicker", "0" + (index + 1)));
    title.appendChild(el("strong", "bb-art-h2", moduleTitle(module, def)));
    head.appendChild(title);
    const actions = el("div", "bb-art-actions");
    actions.style.setProperty("--bb-btn-comp", String(1 / Math.max(0.05, state.zoom || 1)));
    const up = el("button", "bb-icon-btn", "↑"); up.type = "button"; up.title = "上移"; up.disabled = index === 0; up.dataset.action = "module-up"; up.dataset.moduleId = module.id;
    const down = el("button", "bb-icon-btn", "↓"); down.type = "button"; down.title = "下移"; down.disabled = index === page.modules.length - 1; down.dataset.action = "module-down"; down.dataset.moduleId = module.id;
    const remove = el("button", "bb-icon-btn danger", "×"); remove.type = "button"; remove.title = "删除模块"; remove.dataset.action = "module-del"; remove.dataset.moduleId = module.id;
    actions.appendChild(up); actions.appendChild(down); actions.appendChild(remove); head.appendChild(actions); box.appendChild(head);
    addVisualBody(box, module);
    box.querySelectorAll(".bb-art-body,.bb-art-caption,.bb-setlist-item,.bb-setlist-song,.bb-setlist-cover,.bb-cast-bio,.bb-cover-qq,.bb-quote-source,.bb-art-free-text,.bb-art-info,.bb-art-subtitle").forEach(applyBodyFontScope);
    box.querySelectorAll("img").forEach(function (image) {
      image.style.objectFit = dataImageFit(module.data);
      if (module.data.imageRatio && module.data.imageRatio !== "auto") image.style.aspectRatio = module.data.imageRatio.replace(":", " / ");
    });
    const bodyAlign = module.data.bodyAlign;
    if (bodyAlign === "left" || bodyAlign === "center" || bodyAlign === "right") {
      box.querySelectorAll(".bb-art-body,.bb-art-caption,.bb-art-free-text,.bb-announce-notice-title,.bb-cover-qq,.bb-quote-source").forEach(function (node) { node.classList.add("bb-txt-" + bodyAlign); });
    }
    return box;
  }

  /* ===== 第 0 步 throwaway 预览卡（Task #16）：空文档时的主题/背景观感演示 =====
     纯 DOM 展示（bb-dom-only，不进导出），全部取色走主题 CSS 变量，
     切主题/换背景/微调颜色实时反映。不写入 doc，进入步骤 1 后自然消失。 */
  function buildThemeBgPreviewCard() {
    const wrap = el("div", "bb-tbg-preview bb-dom-only");
    const tag = el("div", "bb-tbg-preview-tag", "预览示意");
    tag.title = "这是空文档时的临时预览，仅用于查看主题与背景效果，不会保存或导出";
    wrap.appendChild(tag);

    const hero = el("div", "bb-tbg-preview-hero");
    hero.appendChild(el("div", "bb-tbg-preview-kicker", "ONLY BOX · LIVE"));
    hero.appendChild(el("div", "bb-tbg-preview-title", "主题预览标题"));
    hero.appendChild(el("div", "bb-tbg-preview-sub", "这是当前主题的标题与正文观感"));
    wrap.appendChild(hero);

    const card = el("div", "bb-tbg-preview-card");
    card.appendChild(el("div", "bb-tbg-preview-card-title", "板块卡片样式"));
    const lines = el("div", "bb-tbg-preview-lines");
    ["正文行示例：当前主题的正文颜色与行距", "强调信息用主题强调色高亮显示"].forEach(function (text) {
      lines.appendChild(el("span", null, text));
    });
    card.appendChild(lines);
    const chips = el("div", "bb-tbg-preview-chips");
    ["标签一", "标签二", "标签三"].forEach(function (text) {
      chips.appendChild(el("span", "bb-tbg-preview-chip", text));
    });
    card.appendChild(chips);
    wrap.appendChild(card);

    const btn = el("div", "bb-tbg-preview-btn", "主题按钮色");
    wrap.appendChild(btn);
    return wrap;
  }

  function buildPage(page, index, continuous) {
    const card = el("section", "bb-page-card"); card.dataset.pageId = page.id;
    const isActive = page.id === state.activePageId;
    if (!continuous && isActive) card.classList.add("is-active");
    if (!continuous) {
      const head = el("header", "bb-page-head"); const title = el("div", "bb-page-title"); title.appendChild(el("strong", "bb-page-index", "第 " + (index + 1) + " 屏")); title.appendChild(el("span", "bb-page-meta", page.modules.length + " 个板块 · " + pageSize().pageWidth + " × " + pageSize().pageHeight)); head.appendChild(title);
      const del = el("button", "bb-text-btn danger", "删除本屏"); del.type = "button"; del.dataset.action = "page-del"; del.dataset.pageId = page.id; head.appendChild(del); card.appendChild(head);
    }
    const canvas = el("div", "bb-page-canvas"); canvas.dataset.action = "page-pick"; canvas.dataset.pageId = page.id; canvas.style.aspectRatio = pageSize().pageWidth + " / " + pageSize().pageHeight;
    if (continuous) { if (isActive) canvas.classList.add("is-active"); canvas.style.width = "100%"; }
    else { canvas.style.width = pageSize().pageWidth + "px"; canvas.style.zoom = state.zoom; }
    canvas.dataset.theme = state.doc.theme || "forest";
    canvas.style.fontFamily = C.headingFontStack(state.doc);
    applyThemeVars(canvas);
    canvas.style.setProperty("--bb-font-heading", C.headingFontStack(state.doc));
  /* 方案 §2.2：DOM 预览字重吸附——标题基准 800 吸附到当前标题字体实际档位 */
  canvas.style.setProperty("--bb-weight-heading", String(C.snapWeight(C.FONTS[state.doc.headingFont || state.doc.fontFamily || "sans"] || C.FONTS.sans, 800)));
    canvas.style.setProperty("--bb-font-body", C.bodyFontStack(state.doc));
    canvas.style.setProperty("--bb-page-bg", effectiveBackgroundColor(page));
    canvas.classList.add("bb-pattern-" + safeClassSuffix(artTheme().pattern, "none"));
    if (continuous) {
      if (page.backgroundColor) canvas.style.backgroundColor = page.backgroundColor;
      const pageParamBg = docBackgroundOf(page);
      if (pageParamBg) {
        const url = parametricBackgroundDataUrl(pageParamBg, pageSize().pageWidth, pageSize().pageHeight);
        if (url) { canvas.style.backgroundImage = "url(\"" + url + "\")"; canvas.style.backgroundSize = "100% 100%"; }
      }
    } else {
      const pageColor = effectiveBackgroundColor(page);
      canvas.style.backgroundColor = pageColor;
      const pageImage = backgroundPatternActive(page) ? null : (page.backgroundImage || state.doc.backgroundImage);
      if (pageImage && pageImage.url) { canvas.style.backgroundImage = docBackgroundStyle(pageImage); canvas.style.backgroundSize = "cover"; }
      const pageParamBg = docBackgroundOf(page);
      const docParamBg = docBackgroundOf(state.doc);
      const paramBg = pageParamBg || docParamBg;
      if (paramBg) {
        const url = parametricBackgroundDataUrl(paramBg, pageSize().pageWidth, pageSize().pageHeight);
        if (url) { canvas.style.backgroundImage = "url(\"" + url + "\")"; canvas.style.backgroundSize = "100% 100%"; }
      }
    }
    if (!page.modules.length) {
      if (state.step === "theme-bg") {
        /* 第 0 步空文档：throwaway 预览（纯 DOM 演示卡，不入文档不导出），
           让用户在选主题/背景时看到真实观感；进入后续步骤自动消失。 */
        canvas.appendChild(buildThemeBgPreviewCard());
      } else if (continuous) {
        /* 连续模式空屏：不显示「添加第一个板块」提示，仅留轻量可点选占位；导出时整块隐藏不占高度 */
        canvas.classList.add("bb-empty-screen", "bb-dom-only");
      } else {
        canvas.appendChild(el("div", "bb-page-empty bb-dom-only", "从左侧「板块库」添加第一个板块，即可预览主题效果。"));
      }
    }
    else {
      const rows = M.packModuleRows(page.modules);
      rows.forEach(function (row) {
        if (row.kind === "pair") {
          const pair = el("div", "bb-art-module-row");
          row.modules.forEach(function (module) {
            if (module.visible !== false) pair.appendChild(buildModule(page, module, page.modules.indexOf(module)));
          });
          canvas.appendChild(pair);
        } else if (row.modules[0].visible !== false) {
          canvas.appendChild(buildModule(page, row.modules[0], page.modules.indexOf(row.modules[0])));
        }
      });
    }
    if (continuous) {
      const tag = el("div", "bb-slice-tag"); tag.dataset.action = "page-pick"; tag.dataset.pageId = page.id; tag.title = "选择第 " + (index + 1) + " 屏";
      tag.appendChild(el("span", null, "第 " + (index + 1) + " 屏"));
      const del = el("button", null, "×"); del.type = "button"; del.title = "删除本屏"; del.dataset.action = "page-del"; del.dataset.pageId = page.id;
      tag.appendChild(del); canvas.appendChild(tag);
    }
    card.appendChild(canvas); return card;
  }

  function renderCanvas() {
    const keep = els.canvasBody.scrollTop; const frag = document.createDocumentFragment();
    if (continuousMode()) {
      const strip = el("div", "bb-strip");
      strip.style.width = pageSize().pageWidth + "px"; strip.style.zoom = state.zoom;
      strip.style.backgroundColor = state.doc.backgroundColor || "#ffffff";
      /* 图案背景激活时忽略整条底图（图案自带底色铺底），避免双层背景冲突 */
      const stripParamBg = docBackgroundOf(state.doc);
      if (!stripParamBg && state.doc.backgroundImage && state.doc.backgroundImage.url) { strip.style.backgroundImage = docBackgroundStyle(state.doc.backgroundImage); strip.style.backgroundSize = "cover"; }
      state.doc.pages.forEach(function (page, index) { strip.appendChild(buildPage(page, index, true)); });
      strip.style.fontFamily = C.headingFontStack(state.doc);
      applyThemeVars(strip);
      strip.classList.add("bb-pattern-" + safeClassSuffix(artTheme().pattern, "none"));
      frag.appendChild(strip);
    } else {
      state.doc.pages.forEach(function (page, index) { frag.appendChild(buildPage(page, index, false)); });
    }
    els.canvasBody.style.setProperty("--bb-view-zoom", String(state.zoom || 1));
    els.canvasBody.classList.toggle("bb-continuous", continuousMode());
    els.canvasBody.textContent = ""; els.canvasBody.appendChild(frag); els.canvasBody.scrollTop = keep;
  }

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
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return !!ok;
    } catch (error) { return false; }
  }
  function copyTextToClipboard(text) {
    return new Promise(function (resolve) {
      const value = String(text == null ? "" : text);
      if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === "function") {
        global.navigator.clipboard.writeText(value).then(function () { resolve(true); }, function () { resolve(legacyCopyText(value)); });
        return;
      }
      resolve(legacyCopyText(value));
    });
  }

  function ensureDocFonts(doc) {
    if (!doc) return;
    if (doc.headingFont) ensureFont(doc.headingFont);
    if (doc.bodyFont) ensureFont(doc.bodyFont);
    if (doc.fontFamily) ensureFont(doc.fontFamily);
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
    tuneBtn.addEventListener("click", function () { if (docBackgroundOf(state.doc)) showBackgroundTweakModal(); });
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
    wrap.appendChild(buildField({ key: "name", label: "草稿名称", type: "text" }, state.doc));
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
    tweakBtn.addEventListener("click", showThemeTweakModal);
    tweakRow.appendChild(tweakBtn);
    const typeBtn = el("button", "bb-btn ghost", "排版微调");
    typeBtn.type = "button";
    typeBtn.style.flex = "1";
    typeBtn.title = "手动微调字号缩放、字重、行距、字距与文字颜色";
    typeBtn.addEventListener("click", showTypeTweakModal);
    tweakRow.appendChild(typeBtn);
    wrap.appendChild(tweakRow);
    /* 字体 */
    wrap.appendChild(el("div", "bb-panel-divider", "字体"));
    const fontWrap = el("div");
    fontWrap.appendChild(buildFontSelectField("全局字体（标题正文未单独设置时生效）", C.getFontOptions(), state.doc.fontFamily || "sans", function (value) { state.doc.fontFamily = value || "sans"; state.doc.fontManual = true; ensureFont(state.doc.fontFamily); renderAll(); }, "跟随主题推荐"));
    fontWrap.appendChild(buildFontSelectField("标题字体（主标题/板块标题）", C.getFontOptions(), state.doc.headingFont || "", function (value) { state.doc.headingFont = value; state.doc.fontManual = true; if (value) ensureFont(value); renderAll(); }, "跟随全局字体"));
    fontWrap.appendChild(buildFontSelectField("正文字体（正文/说明/图注）", C.getFontOptions(), state.doc.bodyFont || "", function (value) { state.doc.bodyFont = value; state.doc.fontManual = true; if (value) ensureFont(value); renderAll(); }, "跟随标题字体"));
    const importFontBtn = el("button", "bb-btn ghost", "导入本地字体");
    importFontBtn.type = "button";
    importFontBtn.style.cssText = "width:100%;margin-bottom:12px";
    importFontBtn.title = "导入本地字体文件（.ttf/.otf/.woff/.woff2），导入后可在字体下拉中选用";
    importFontBtn.addEventListener("click", showFontImportModal);
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
      tweakBgBtn.addEventListener("click", showBackgroundTweakModal);
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
    const baseColorField = buildField({ key: "backgroundColor", label: "整条底色", type: "color", fallback: "#ffffff" }, state.doc);
    const baseImageField = buildField({ key: "backgroundImage", label: "整条底图", type: "image" }, state.doc);
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

  /* 字体下拉字段（右侧面板用，替代原顶部三个下拉） */
  function buildFontSelectField(labelText, options, value, onChange, firstOptionLabel) {
    const row = el("div", "bb-field");
    row.appendChild(el("label", "bb-field-label", labelText));
    const sel = el("select", "bb-input");
    if (firstOptionLabel) {
      const first = el("option", null, firstOptionLabel);
      first.value = "";
      sel.appendChild(first);
    }
    options.forEach(function (o) {
      const option = el("option", null, o.label);
      option.value = o.value;
      sel.appendChild(option);
    });
    sel.value = value;
    if (sel.selectedIndex < 0 && value) {
      const option = el("option", null, value);
      option.value = value;
      sel.appendChild(option);
      sel.value = value;
    }
    sel.addEventListener("change", function () { onChange(this.value); });
    row.appendChild(sel);
    return row;
  }

  function buildSurfacePanel() {
    const wrap = el("div");
    /* edit 步骤：先显示当前屏设置，文档设置折叠在下方 */
    const page = activePage();
    if (page) {
      wrap.appendChild(el("div", "bb-panel-divider", "当前第 " + (activePageIndex() + 1) + " 屏"));
      wrap.appendChild(buildField({ key: "backgroundColor", label: "本屏底色", type: "color", fallback: state.doc.backgroundColor || "#ffffff", optional: true }, page));
      wrap.appendChild(buildField({ key: "backgroundImage", label: "本屏底图", type: "image" }, page));
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
    (def.fields || []).forEach(function (field) { els.panelBody.appendChild(buildField(field, hit.module.data, hit.module.type, hit.module.data)); });
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

  function downloadBlob(blob, name) { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000); }
  function downloadText(content, name) { downloadBlob(new Blob([content], { type: "application/json;charset=utf-8" }), name); }
  function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) throw new Error("数据格式错误");
    const meta = dataUrl.slice(0, comma).match(/^data:([^;]+)/);
    const mime = meta ? meta[1] : "application/octet-stream";
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  const wrapCache = new Map();
  function wrapLines(ctx, value, maxWidth) {
    const key = ctx.font + "|" + Math.round(maxWidth) + "|" + value;
    const hit = wrapCache.get(key);
    if (hit) return hit;
    const result = []; String(value || "").split("\n").forEach(function (line) { let current = ""; Array.from(line).forEach(function (char) { const next = current + char; if (ctx.measureText(next).width > maxWidth && current) { result.push(current); current = char; } else current = next; }); result.push(current); });
    if (wrapCache.size > 4000) wrapCache.clear();
    wrapCache.set(key, result);
    return result;
  }

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
    const raw = hexToRgba(value, alpha);
    return raw || value || "";
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
    const out = String(value || "").trim();
    return out.length > limit ? out.slice(0, limit) + "…" : out;
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

  async function paintTicket(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk(); let y = y0;
    const tiers = (data.tiers || []).filter(function (t) { return t && (t.label || t.price); });
    const qr = await loadImage(data.qrImage);
    const tpl = data.template || "qr-side";
    /* qrSize：二维码边长（px，画布坐标系），未设置走历史默认 round(w*0.32) */
    const qrSize = imageSizeOf(data, "qrSize", 120, 320, 4) || Math.round(w * 0.32);
    if (tpl === "ticket-focus" || tpl === "ticket-hero") {
      const first = tiers[0];
      const bandH = Math.round(w * 0.42);
      ctx.save(); roundRectPath(ctx, x0, y, w, bandH, 30); const g = ctx.createLinearGradient(x0, y, x0 + w, y + bandH); g.addColorStop(0, P.primary); g.addColorStop(1, P.primaryDark); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      if (qr && tpl === "ticket-focus") {
        ctx.save(); ctx.fillStyle = "#ffffff"; roundRectPath(ctx, x0 + w - qrSize - 26, y + (bandH - qrSize) / 2, qrSize, qrSize, 18); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, x0 + w - qrSize - 26, y + (bandH - qrSize) / 2, qrSize, qrSize, 18); ctx.clip(); containDraw(ctx, qr, x0 + w - qrSize - 26, y + (bandH - qrSize) / 2, qrSize, qrSize); ctx.restore();
      }
      if (first) {
        ctx.fillStyle = "#ffffff"; ctx.textAlign = "left";
        y = drawRich(ctx, text(first.price, "价格"), x0 + 22, y + Math.round(bandH * 0.34), w * 0.6, 71, 900, "#ffffff", "left", 1) + 6;
        if (first.label) y = drawRich(ctx, first.label, x0 + 22, y + 8, w * 0.6, 27, 600, "rgba(255,255,255,.9)", "left") + 8;
      } else y = drawRich(ctx, "价格", x0 + 22, y + Math.round(bandH * 0.4), w * 0.6, 71, 900, "#ffffff", "left") + 6;
      y += Math.round(bandH * 0.18);
      const rest = tiers.slice(1);
      if (rest.length) y = drawChips(ctx, rest.map(function (t) { return [t.label, t.price].filter(Boolean).join("　"); }), x0, y + 14, w, { size: 25, color: ink, border: alphaColor(P.primary, 0.4), fill: "#ffffff", lw: 2 });
      if (qr && tpl === "ticket-hero") {
        y += 24;
        const qw = qrSize + 24; const qh = qrSize + 24;
        ctx.save(); ctx.fillStyle = "#ffffff"; roundRectPath(ctx, x0 + (w - qw) / 2, y, qw, qh, 20); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, x0 + (w - qw) / 2, y, qw, qh, 20); ctx.clip(); containDraw(ctx, qr, x0 + (w - qw) / 2 + 12, y + 12, qrSize, qrSize); ctx.restore();
        y += qh + 8;
      }
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
      if (qr) {
        y += 18; const qw = qrSize + 32; const qh = qrSize + 32;
        ctx.save(); ctx.fillStyle = "#ffffff"; roundRectPath(ctx, x0 + (w - qw) / 2, y, qw, qh, 22); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, x0 + (w - qw) / 2, y, qw, qh, 22); ctx.clip(); containDraw(ctx, qr, x0 + (w - qw) / 2 + 16, y + 16, qrSize, qrSize); ctx.restore();
        y += qh + 6;
      }
      return y;
    }
    /* 默认 qr-side / 其余：左侧票档行 + 右侧二维码 */
    const splitGap = 30;
    const qrSide = qr ? qrSize + 40 : 0;
    const leftW = qrSide ? w - qrSide - splitGap : w;
    let ly = y;
    if (!tiers.length) { drawRich(ctx, "暂无票档", x0, ly + 8, leftW, 27, 600, artMuted(), "left", 1); ly += 50; }
    tiers.slice(0, 8).forEach(function (tier) {
      const rowY = ly + 8;
      drawRich(ctx, text(tier.label, "票档"), x0, rowY, leftW * 0.62, 27, 600, ink, "left", 1);
      drawRich(ctx, text(tier.price, "价格"), x0 + leftW, rowY, leftW * 0.38, 27, 900, P.accent, "right", 1);
      ly += 63;
      drawLine(ctx, x0, ly, x0 + leftW, ly, alphaColor(P.primary, 0.14), 2);
    });
    if (qr) {
      const qx = x0 + leftW + splitGap;
      ctx.save(); ctx.fillStyle = "#ffffff"; roundRectPath(ctx, qx, y, qrSide, qrSide, 20); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, qx, y, qrSide, qrSide, 20); ctx.clip(); containDraw(ctx, qr, qx + 20, y + 20, qrSize, qrSize); ctx.restore();
    }
    y = Math.max(ly, qr ? y + qrSide : ly);
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
    wrapCache.clear();
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

  async function exportPng(allPages) {
    if (global.BannerBuilderExport && global.BannerBuilderExport.exportPng) return global.BannerBuilderExport.exportPng({ allPages: allPages });
    return legacyExportPng(allPages);
  }
  async function exportStripPng() {
    if (global.BannerBuilderExport && global.BannerBuilderExport.exportStripPng) return global.BannerBuilderExport.exportStripPng();
    return legacyExportStripPng();
  }
  async function exportPsd() {
    if (global.BannerBuilderExport && global.BannerBuilderExport.exportPsd) return global.BannerBuilderExport.exportPsd();
    return legacyExportPsd();
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
  global.BannerBuilderLegacy = { exportPng: function (a) { return legacyExportPng(a); }, exportStripPng: function () { return legacyExportStripPng(); }, exportPsd: function () { return legacyExportPsd(); }, buildPsdChildren: function () { return legacyExportPsd({ childrenOnly: true }); }, measurePageLayout: function (page, offsetY) { return measurePageLayout(page, offsetY); }, drawPageToCanvas: function (page, opts) { return drawPageToCanvas(page, opts); }, activePage: function () { return activePage(); } };
  /* 导出倍率（1x = 750 设计宽；默认 2x = 1500 高清），文档级可配 doc.exportScale */
  function exportScale() { return Number(state.doc.exportScale) || 2; }

  async function legacyExportPng(allPages) {
    const pages = allPages ? state.doc.pages : [activePage()];
    const allSilence = [];
    const scale = exportScale();
    const pageNo = function (page) { return String(state.doc.pages.indexOf(page) + 1).padStart(2, "0"); };
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      const result = await drawPageToCanvas(page);
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
      /* 多屏连下需要间隔，避免被浏览器「多文件下载」策略拦截（审计 P4）。 */
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
      const one = await drawPageToCanvas(pages[i], { forStrip: true });
      rendered.push(one); total += one.canvas.height;
    }
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = total; const ctx = canvas.getContext("2d");
    ctx.fillStyle = state.doc.backgroundColor || "#ffffff"; ctx.fillRect(0, 0, width, total);
    /* 图案背景激活时忽略整条底图（各屏图案自带底色），避免双层背景冲突 */
    const stripDocParamBg = docBackgroundOf(state.doc);
    const docImage = stripDocParamBg ? null : await loadImage(state.doc.backgroundImage);
    if (docImage) coverDownDraw(ctx, docImage, 0, 0, width, total);
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

  /* PSD 文字层字体名：标题层用标题字体，正文层用正文字体（分角色设置同步到 PS）。 */
  function psFontNameFor(scope) {
    const key = scope === "body"
      ? (state.doc.bodyFont || state.doc.headingFont || state.doc.fontFamily || "sans")
      : (state.doc.headingFont || state.doc.fontFamily || "sans");
    const f = C.FONTS[key] || C.FONTS.sans;
    return f.family.replace(/ /g, "");
  }

  /* 圆角矩形 → PS 矢量蒙版 paths（8 锚点闭合子路径，逆…顺时钟贝塞尔圆角） */
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

  /* ===== PSD 图层源数据：格式无关场景模型（scene）→ ag-psd children 转换 =====
     板块→元素的提取逻辑已移入 js/banner-builder-scene-model.js（buildScene），
     PSD 与 PDF 两个导出器消费同一份场景数据（需求 brief 第 6 节）。
     此处仅做 scene → ag-psd 的落地：shape→vectorMask、image→canvas、text→text layer。 */
  function sceneImageToCanvas(imageRef, x, y, w, h, fit) {
    return loadImage(imageRef).then(function (img) {
      if (!img || !w || !h) return null;
      const c = document.createElement("canvas");
      c.width = pageSize().pageWidth; c.height = pageSize().pageHeight;
      const cx = c.getContext("2d");
      if (fit === "contain") containDraw(cx, img, x, y, w, h);
      else coverDraw(cx, img, x, y, w, h);
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

  async function legacyExportPsd(opts) {
    if (!global.agPsd || typeof global.agPsd.writePsd !== "function") { global.alert("PSD 引擎尚未加载，请刷新页面后重试。"); return null; }
    const page = activePage(); const size = pageSize();
    const full = await drawPageToCanvas(page);
    const layout = full.layout;
    const silence = full.silence || [];
    const pageHeight = full.canvas.height;
    const SM = global.BannerBuilderSceneModel;
    const scene = SM.buildScene({ page: page, layout: layout, doc: state.doc, pageHeight: pageHeight, pageSize: size, registry: R, theme: artTheme(), fonts: SM.fontsOf(state.doc) });
    sceneCtx = { fonts: scene.fonts, multiWeightFamilies: (scene.fonts || []).filter(function (f) { const meta = C.FONTS[f.key]; return meta && Array.isArray(meta.weights) && meta.weights.length > 1; }).map(function (f) { return f.psName; }) };
    const children = [];
    /* 背景层：铺页面底色，便于在 PS 里改背景（图案背景激活时取图案底色，冲突消解规则） */
    children.push({ name: "背景底色", canvas: (function () {
      const c = document.createElement("canvas"); c.width = size.pageWidth; c.height = pageHeight;
      const cx = c.getContext("2d");
      cx.fillStyle = effectiveBackgroundColor(page);
      cx.fillRect(0, 0, c.width, c.height);
      return c;
    })() });

    /* 图案背景层（Task #18，用户决策「PSD 需矢量」）：
       - circle/square 且点数 ≤800：输出矢量形状组（逐点圆角矩形，透明度预混合进底色）；
       - 其余形状或超量：整层栅格 canvas（与预览像素一致）。
       params.bg 即最终底色，不再被 backgroundColor 覆写。 */
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

    /* 每板块一组：scene module → ag-psd group（形状/图片/文字） */
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
          const layer = sceneElementToPsdLayer(el, psdFontCtx);
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


  /* 草稿图片持久化（审计 P6）：保存前用「我的模板」同款 snapshotData 把所有 blob: 引用
     转成 dataURL 写进 JSON；恢复时再把 dataURL 还原为 blob:，会话内行为与手选图片一致。
     还原只处理 <32MB 的 dataURL，超大的保留原样（canvas 可直接加载 data:）。 */
  function dataUrlToBlobRecord(value) {
    try {
      const parts = String(value.url).split(",");
      if (!parts[1] || parts[1].length > 32000000) return value;
      const meta = parts[0].match(/^data:([^;]+)/);
      const mime = meta ? meta[1] : "image/png";
      const bin = atob(parts[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return { url: URL.createObjectURL(new Blob([bytes], { type: mime })), name: value.name, type: mime };
    } catch (error) { return value; }
  }
  function restoreDraftImages(value) {
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i += 1) value[i] = restoreDraftImages(value[i]); return value; }
    if (!value || typeof value !== "object") return value;
    if (typeof value.url === "string" && value.url.indexOf("data:") === 0 && typeof value.name === "string") return dataUrlToBlobRecord(value);
    Object.keys(value).forEach(function (key) { value[key] = restoreDraftImages(value[key]); });
    return value;
  }
  function buildDraftPayload(doc) {
    const draft = M.toJSON(doc);
    draft.version = Math.max(3, Number(draft.version) || 0);
    const importer = global.BannerBuilderThemeImporter;
    let definition = draft.themeDefinition;
    if (!definition && importer && typeof importer.loadAll === "function") {
      definition = importer.loadAll().filter(function (theme) { return theme && theme.id === draft.theme; })[0] || null;
    }
    /* 所有主题均写入完整基础定义：自定义主题可跨浏览器恢复，内置主题也不受后续预设改版影响。 */
    if (!definition && C.themeStyle) {
      definition = C.themeStyle(draft.theme);
      if (definition) definition.id = draft.theme;
    }
    draft.themeDefinition = definition ? JSON.parse(JSON.stringify(definition)) : null;
    /* BB-R13：字体依赖声明——草稿只存字体 key，自定义字体文件在本机 IndexedDB。
       导出时声明文档实际引用的字体（含主题推荐与手动选择），导入端据此检测缺失并让用户映射替代，
       字体缺失不拒绝主题配色恢复。 */
    draft.fontDependencies = collectFontDependencies(draft);
    return draft;
  }
  /* 收集草稿实际引用的字体依赖：doc 三级字体 + 主题定义内嵌推荐字体。
     只声明「当前环境里属于用户导入字体」的 key（内置字体随工具分发，不存在跨浏览器缺失）。 */
  function collectFontDependencies(draft) {
    const fontImporter = global.BannerBuilderFontImporter;
    let userFontIds = [];
    if (fontImporter && typeof fontImporter.listFonts === "function") {
      try { userFontIds = fontImporter.listFonts().map(function (row) { return row && row.id; }).filter(Boolean); } catch (error) { userFontIds = []; }
    }
    const deps = [];
    const roles = { fontFamily: "global", headingFont: "heading", bodyFont: "body" };
    Object.keys(roles).forEach(function (key) {
      const fontKey = draft[key];
      if (typeof fontKey !== "string" || !fontKey) return;
      if (userFontIds.indexOf(fontKey) < 0) return; /* 内置字体不声明 */
      const meta = C.FONTS[fontKey];
      if (deps.some(function (d) { return d.key === fontKey; })) return;
      deps.push({ key: fontKey, label: (meta && meta.label) || fontKey, role: [roles[key]] });
    });
    /* 主题定义中的推荐字体（headingFont/bodyFont）同样声明，role 标记为 theme */
    const def = draft.themeDefinition;
    if (def && typeof def === "object") {
      ["headingFont", "bodyFont"].forEach(function (key) {
        const fontKey = def[key];
        if (typeof fontKey !== "string" || !fontKey) return;
        if (userFontIds.indexOf(fontKey) < 0) return;
        const existing = deps.filter(function (d) { return d.key === fontKey; })[0];
        if (existing) { if (existing.role.indexOf("theme") < 0) existing.role.push("theme"); return; }
        const meta = C.FONTS[fontKey];
        deps.push({ key: fontKey, label: (meta && meta.label) || fontKey, role: ["theme"] });
      });
    }
    return deps;
  }
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
  /* 旧类型 key 迁移：performerCard 拆分为 castList / castCards 后，历史数据按模板落位。
     存储记录（草稿/自定义板块/我的模板）创建模块前必须先过这个函数。 */
  function migrateLegacyModuleType(type, data) {
    if (type === "performerCard") {
      return data && data.template === "cast-cards" ? "castCards" : "castList";
    }
    return type;
  }
  function migrateModuleData(module) {
    if (!module || !module.data) return module;
    /* 旧「嘉宾卡」单嘉宾结构（name/bio/setlist/images）→ 新「演出阵容」列表结构（cast） */
    const isPerformer = module.type === "performerCard" || module.type === "castList" || module.type === "castCards";
    if (isPerformer && !Array.isArray(module.data.cast)) {
      const legacy = module.data;
      const setlist = (legacy.setlist || []).map(function (song) {
        return { song: String(song).replace(/^♪\s*/, ""), coverBy: "" };
      });
      module.data.cast = [{
        role: "",
        name: legacy.name || "",
        avatar: (legacy.images && legacy.images[0]) || null,
        avatarRatio: "1:1",
        time: "",
        bio: legacy.bio || "",
        setlist: setlist,
      }];
    }
    /* performerCard 拆分落位：卡片模板 → castCards，其余 → castList */
    if (module.type === "performerCard") {
      module.type = migrateLegacyModuleType(module.type, module.data);
    }
    return module;
  }
  /* 草稿恢复：解析 → 结构校验/规范化 → 构造候选文档 → 原子替换。
     任何一步失败都不修改当前 state.doc（修复旧实现 pages:[] 部分覆盖当前状态的缺陷）。
     草稿是用户自己的备份，data 字段保持宽容（保留历史内部字段），但页面/模块结构必须完整、
     板块类型必须可识别；缺失的 ID 本地补齐，旧「嘉宾卡」结构自动迁移。 */
  /* 草稿资源上限：草稿 JSON 会在社区互传，属于不可信输入。
     上限远超正常使用（正常长条 ≤ 20 屏 / ≤ 120 板块），只为阻断恶意超大草稿导致浏览器冻结。 */
  const DRAFT_LIMITS = Object.freeze({
    maxFileSize: 64 * 1024 * 1024,
    maxPages: 200,
    maxModulesPerPage: 300,
    maxModulesTotal: 3000,
    maxStringLength: 50000,
    maxDataUrlLength: 32 * 1024 * 1024,
    maxDepth: 64,
  });
  /* BB-R02：保存端与导入端共用同一常量（上方 DRAFT_LIMITS），保存前按最终 JSON 字节数校验，
     确保工具导出的每一份草稿都能被同版本工具重新导入（导入端 loadDraft 用同一 maxFileSize 拒收）。 */
  function assertNoBlobUrls(value, path, findings) {
    if (typeof value === "string") {
      if (value.indexOf("blob:") === 0) findings.push({ path: path, url: value });
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) assertNoBlobUrls(value[i], path + "[" + i + "]", findings);
      return;
    }
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) { assertNoBlobUrls(value[key], path + "." + key, findings); });
    }
  }
  /* 按体积降序收集草稿内嵌图片资源（超限提示用：显示主要超限资源清单） */
  function collectDraftImageSizes(value, path, out) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) collectDraftImageSizes(value[i], path + "[" + i + "]", out);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.url === "string" && value.url.indexOf("data:") === 0 && typeof value.name === "string") {
      out.push({ path: path, name: value.name || "未命名图片", bytes: value.url.length });
      return;
    }
    Object.keys(value).forEach(function (key) { collectDraftImageSizes(value[key], path + "." + key, out); });
  }
  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + "MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + "KB";
    return bytes + "B";
  }
  function assertDraftLimits(value, depth, parentKey) {
    if (depth > DRAFT_LIMITS.maxDepth) throw new Error("草稿数据嵌套过深");
    if (typeof value === "string") {
      /* data: URL 是草稿导出时的图片内嵌载荷（「我的模板」snapshotData 同款格式），
         正常头像/照片单条可达数 MB，不属于异常文本；只对 url 字段豁免，其余仍严格限长 */
      if (parentKey === "url" && value.indexOf("data:") === 0) {
        if (value.length > DRAFT_LIMITS.maxDataUrlLength) throw new Error("草稿包含异常大的内嵌图片（超过 " + Math.round(DRAFT_LIMITS.maxDataUrlLength / 1024 / 1024) + "MB），疑似损坏或恶意文件");
        return;
      }
      if (value.length > DRAFT_LIMITS.maxStringLength) throw new Error("草稿包含异常长的文本（超过 " + DRAFT_LIMITS.maxStringLength + " 字），疑似损坏或恶意文件");
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) assertDraftLimits(value[i], depth + 1, parentKey);
      return;
    }
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) { assertDraftLimits(value[key], depth + 1, key); });
    }
  }
  function validateDraftThemeDefinition(definition, themeId) {
    if (definition == null) return null;
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("草稿主题定义必须是 JSON 对象");
    if (!themeId || definition.id !== themeId) throw new Error("草稿主题定义与当前主题 ID 不一致");
    const importer = global.BannerBuilderThemeImporter;
    if (importer && typeof importer.validate === "function") {
      const errors = importer.validate(definition);
      if (errors.length) throw new Error("草稿主题定义无效：" + errors.join("；"));
    } else {
      ["label", "primary", "primaryDark", "primarySoft", "accent", "accentSoft", "line", "soft"].forEach(function (key) {
        if (typeof definition[key] !== "string" || !definition[key]) throw new Error("草稿主题定义缺少字段：" + key);
      });
    }
    return JSON.parse(JSON.stringify(definition));
  }
  /* ===== 草稿版本门禁与显式迁移（BB-R06） =====
     CURRENT_DRAFT_VERSION：当前导出的草稿结构版本；MIN_SUPPORTED_DRAFT_VERSION：仍可恢复的最老版本。
     未来版本（> 当前）与非法版本（非整数 / 负数 / 0）一律拒绝，不做猜测式降级。 */
  const CURRENT_DRAFT_VERSION = 3;
  const MIN_SUPPORTED_DRAFT_VERSION = 1;
  function assertDraftVersion(version) {
    if (typeof version !== "number" || !Number.isInteger(version)) throw new Error("草稿版本号必须是整数（收到：" + String(version) + "）");
    if (version <= 0) throw new Error("草稿版本号必须是正整数（收到：" + version + "）");
    if (version > CURRENT_DRAFT_VERSION) throw new Error("草稿来自更新版本的工具（版本 " + version + " > 当前支持 " + CURRENT_DRAFT_VERSION + "），请升级本工具后再导入");
  }
  /* v1 → v2：v1 草稿没有 version 字段（按 1 处理），结构上与 v2 相同（pages/modules），
     差异仅在旧类型 key（performerCard），由 migrateLegacyModuleType 在模块构造时迁移。 */
  function migrateDraftV1ToV2(draft) {
    draft.version = 2;
    return draft;
  }
  /* v2 → v3：v3 起草稿内嵌完整主题定义 themeDefinition，v2 只有主题 ID。
     主题定义缺失时按当前浏览器主题清单补齐（复制后改 id，不突变共享主题对象）；
     主题不存在或无主题时保持 null（沿用既有降级提示路径）。 */
  function migrateDraftV2ToV3(draft) {
    if (draft.themeDefinition == null) {
      const importer = global.BannerBuilderThemeImporter;
      let definition = null;
      if (typeof draft.theme === "string" && draft.theme) {
        if (importer && typeof importer.loadAll === "function") {
          definition = importer.loadAll().filter(function (theme) { return theme && theme.id === draft.theme; })[0] || null;
        }
        if (!definition && C.themeStyle) {
          const style = C.themeStyle(draft.theme);
          if (style) {
            definition = JSON.parse(JSON.stringify(style));
            definition.id = draft.theme;
          }
        }
      }
      draft.themeDefinition = definition;
    }
    draft.version = 3;
    return draft;
  }
  function migrateDraft(parsed) {
    let draft = parsed;
    const version = draft.version == null ? 1 : draft.version;
    assertDraftVersion(version);
    if (version < MIN_SUPPORTED_DRAFT_VERSION) throw new Error("草稿版本过老（" + version + "），低于最低支持版本 " + MIN_SUPPORTED_DRAFT_VERSION);
    if (version === 1) draft = migrateDraftV1ToV2(draft);
    if (draft.version === 2) draft = migrateDraftV2ToV3(draft);
    if (draft.version !== CURRENT_DRAFT_VERSION) throw new Error("草稿迁移后版本异常（" + String(draft.version) + "）");
    return draft;
  }
  /* ===== themeOverrides 白名单校验（BB-R05）：与 AI 整份主题 / 手动微调共用同一 schema =====
     schema 唯一来源是 BannerBuilderAiDocument 的主题字段表；草稿导入复用同一规则。
     注意语义差异：AI 协议的 themeOverrides 是完整主题（基础色必填），草稿的
     themeOverrides 是增量覆盖（只存用户手动改过的字段）。因此这里做「部分覆盖校验」：
     只校验存在的键（hex 格式 / 枚举值 / 数值范围步进 / 字重档位），不要求必填；
     白名单复制而不是深拷贝原对象，杜绝 __proto__ / prototype / constructor / 未知字段。 */
  /* ===== 图案背景记录白名单校验（Task #18）：草稿/AI 共用 =====
     合法形态：{ type:"parametric", params:{引擎 normalize 可接受的任意子集}, presetId? }。
     params 经引擎 normalize 全量归一化（数值钳制/枚举回退/颜色规整），任何异常返回 null
     （草稿宽容策略：背景记录非法不拒绝整份草稿，仅丢弃背景）。 */
  function sanitizeDraftBackground(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (raw.type !== "parametric" || !raw.params || typeof raw.params !== "object" || Array.isArray(raw.params)) return null;
    const engine = BG();
    if (!engine) return null;
    try {
      const params = engine.normalize(raw.params);
      const out = { type: "parametric", params: params };
      if (typeof raw.presetId === "string" && raw.presetId) out.presetId = raw.presetId;
      if (raw.themeLocked === true) out.themeLocked = true;
      return out;
    } catch (error) { return null; }
  }

  function sanitizeThemeOverrides(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const AD = global.BannerBuilderAiDocument;
    const schema = AD && AD.THEME_OVERRIDE_SCHEMA;
    const out = {};
    if (!schema) return out; /* schema 未加载时保守返回空覆盖（不应发生：ai-document 先于本文件加载） */
    Object.keys(raw).forEach(function (key) {
      if (schema.allowedKeys.indexOf(key) < 0) return; /* 未知/危险键直接丢弃，不报错（宽容恢复） */
      const value = raw[key];
      if (schema.baseColors.indexOf(key) >= 0 || schema.extraColors.indexOf(key) >= 0) {
        if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) out[key] = value.trim().toLowerCase();
        return;
      }
      if (schema.enums[key]) {
        if (typeof value === "string" && schema.enums[key].indexOf(value) >= 0) out[key] = value;
        return;
      }
      const spec = schema.numbers[key];
      if (spec) {
        if (typeof value === "number" && isFinite(value) && value >= spec.min && value <= spec.max) out[key] = value;
        return;
      }
      if (key === "headingWeight" || key === "bodyWeight") {
        if (schema.weights.indexOf(value) >= 0) out[key] = value;
      }
    });
    return out;
  }
  /* ===== 模块数据 schema 校验 + 规范化（BB-R01）：草稿宽容策略 =====
     草稿是用户自己的备份，允许保留历史内部字段（如 padding），因此：
     - 已知字段：按 Registry schema 严格校验类型/范围/枚举/数组形状，不合格即拒绝；
     - 未知字段：保留（历史内部字段），但同样受 DRAFT_LIMITS 深度/长度约束；
     - 图片字段：接受 {url, name, type} 记录（url 限 data:/blob:），拒绝远程 URL。
     与社区模块导入（严格拒绝未知字段）策略不同，两者不要混用。 */
  function normalizeDraftModuleData(def, typeKey, rawData, where) {
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
      throw new Error(where + "：data 必须是对象");
    }
    const AD = global.BannerBuilderAiDocument;
    if (AD && typeof AD.validateDataFields === "function") {
      const errors = [];
      const err = function (path, code, message) { errors.push({ path: path, code: code, message: message }); };
      AD.validateDataFields(def, typeKey, rawData, where, err, 0, { allowUnknownFields: true, allowImageRecords: true });
      if (errors.length) throw new Error(errors[0].path + "：" + errors[0].message);
    }
    return rawData;
  }
  function buildDraftCandidate(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("草稿必须是 JSON 对对象");
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) throw new Error("草稿缺少页面数据（pages 必须是非空数组）");
    if (parsed.pages.length > DRAFT_LIMITS.maxPages) throw new Error("草稿屏数超过 " + DRAFT_LIMITS.maxPages + " 屏，疑似损坏或恶意文件");
    if (parsed.name != null && (typeof parsed.name !== "string" || parsed.name.length > 200)) throw new Error("草稿名称异常");
    try { assertDraftLimits(parsed, 0, ""); } catch (error) { throw new Error((error && error.message) || error); }
    /* BB-R06：版本门禁 + 显式迁移（v1→v2→v3），迁移在结构校验前完成 */
    const draft = migrateDraft(parsed);
    const embeddedTheme = validateDraftThemeDefinition(draft.themeDefinition, draft.theme);
    /* v1/v2 旧草稿没有主题定义时仍按当前主题清单判定；v3 自带定义时可独立恢复。 */
    const themeKeys = C.getThemeOptions().map(function (o) { return o.value; });
    const themeKnown = !!embeddedTheme || !draft.theme || themeKeys.indexOf(draft.theme) >= 0;
    const candidate = M.createDoc(C.CANVAS_PRESETS[draft.ratio] ? draft.ratio : C.DEFAULT_RATIO);
    if (typeof draft.name === "string" && draft.name.trim()) candidate.name = draft.name;
    if (draft.screenMode === "continuous" || draft.screenMode === "split") candidate.screenMode = draft.screenMode;
    if (typeof draft.theme === "string" && draft.theme) candidate.theme = draft.theme;
    candidate.themeDefinition = embeddedTheme;
    candidate.version = CURRENT_DRAFT_VERSION;
    ["fontFamily", "headingFont", "bodyFont"].forEach(function (key) {
      if (typeof draft[key] === "string") candidate[key] = draft[key];
    });
    if (draft.fontManual === true) candidate.fontManual = true;
    /* BB-R13：字体缺失不拒绝草稿——字体 key 只要求是字符串；是否缺失在应用成功后
       由 showMissingFontMapper 检测（等待 IndexedDB bootstrap 完成），用户可映射替代字体。
       主题定义中的推荐字体同样不参与拒绝（validateDraftThemeDefinition 不校验字体 key）。 */
    if (typeof draft.backgroundColor === "string" && draft.backgroundColor) candidate.backgroundColor = draft.backgroundColor;
    if (draft.backgroundImage && typeof draft.backgroundImage === "object" && typeof draft.backgroundImage.url === "string") {
      candidate.backgroundImage = { url: draft.backgroundImage.url, name: draft.backgroundImage.name || "", type: draft.backgroundImage.type || "" };
    }
    /* Task #18：图案背景记录（type/params/presetId）经引擎 normalize 白名单化后恢复 */
    candidate.background = sanitizeDraftBackground(draft.background);
    candidate.exportScale = draft.exportScale === 1 || draft.exportScale === 3 ? draft.exportScale : 2;
    candidate.__themeKnown = themeKnown;
    /* BB-R05：themeOverrides 白名单校验 + 规范化复制（拒绝 __proto__/未知字段/超范围数值） */
    candidate.themeOverrides = sanitizeThemeOverrides(draft.themeOverrides);
    /* BB-R07：页面/模块 ID 全局唯一。缺失 ID 自动补齐（历史草稿常见），显式重复 ID 拒绝（疑似损坏）。 */
    const usedIds = new Set();
    const claimId = function (rawId, fallback, where) {
      if (typeof rawId === "string" && rawId) {
        if (usedIds.has(rawId)) throw new Error(where + " 的 ID「" + rawId + "」与其他页面或板块重复，疑似损坏草稿");
        usedIds.add(rawId);
        return rawId;
      }
      let id = fallback;
      while (usedIds.has(id)) id = C.uid();
      usedIds.add(id);
      return id;
    };
    candidate.pages = draft.pages.map(function (rawPage, pi) {
      if (!rawPage || typeof rawPage !== "object" || Array.isArray(rawPage)) throw new Error("第 " + (pi + 1) + " 屏数据不正确");
      const page = M.createPage();
      page.id = claimId(rawPage.id, C.uid(), "第 " + (pi + 1) + " 屏");
      if (typeof rawPage.name === "string" && rawPage.name) page.name = rawPage.name;
      if (typeof rawPage.backgroundColor === "string") page.backgroundColor = rawPage.backgroundColor;
      if (rawPage.backgroundImage && typeof rawPage.backgroundImage === "object" && typeof rawPage.backgroundImage.url === "string") {
        page.backgroundImage = { url: rawPage.backgroundImage.url, name: rawPage.backgroundImage.name || "", type: rawPage.backgroundImage.type || "" };
      }
      page.background = sanitizeDraftBackground(rawPage.background);
      if (!Array.isArray(rawPage.modules)) throw new Error("第 " + (pi + 1) + " 屏缺少板块数组");
      if (rawPage.modules.length > DRAFT_LIMITS.maxModulesPerPage) throw new Error("第 " + (pi + 1) + " 屏板块数超过 " + DRAFT_LIMITS.maxModulesPerPage + " 个，疑似损坏或恶意文件");
      page.modules = rawPage.modules.map(function (rawModule, mi) {
        if (!rawModule || typeof rawModule !== "object") throw new Error("第 " + (pi + 1) + " 屏第 " + (mi + 1) + " 个板块数据不正确");
        const typeKey = migrateLegacyModuleType(rawModule.type, rawModule.data);
        if (!typeKey || !R.getDef(typeKey)) throw new Error("第 " + (pi + 1) + " 屏第 " + (mi + 1) + " 个板块类型无效：" + String(rawModule.type));
        const module = M.createModule(typeKey);
        module.id = claimId(rawModule.id, C.uid(), "第 " + (pi + 1) + " 屏第 " + (mi + 1) + " 个板块");
        module.visible = rawModule.visible === false ? false : true;
        /* BB-R01：先迁移旧结构，再按 schema 校验已知字段形状（宽容保留历史内部字段） */
        if (rawModule.data && typeof rawModule.data === "object" && !Array.isArray(rawModule.data)) module.data = rawModule.data;
        migrateModuleData(module);
        normalizeDraftModuleData(R.getDef(module.type), module.type, module.data, "第 " + (pi + 1) + " 屏第 " + (mi + 1) + " 个板块");
        return module;
      });
      return page;
    });
    if (candidate.pages.reduce(function (sum, page) { return sum + page.modules.length; }, 0) > DRAFT_LIMITS.maxModulesTotal) {
      throw new Error("草稿板块总数超过 " + DRAFT_LIMITS.maxModulesTotal + " 个，疑似损坏或恶意文件");
    }
    return candidate;
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
      showMissingFontMapper(candidate);
    };
    reader.onerror = function () { global.alert("草稿读取失败：无法读取所选文件。"); };
    reader.readAsText(file);
  }
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
        doomed.forEach(function (url) { if (!protectedBlobUrls.has(url)) revokeBlobUrl(url); });
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
        doomed.forEach(function (url) { if (!protectedBlobUrls.has(url)) revokeBlobUrl(url); });
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

  /* ===== 主题导入弹窗 ===== */
  /* 主题下拉已迁入右侧文档设置面板：导入新主题后重渲染面板即可见 */
  function rebuildThemeSelect() {
    renderPanel();
  }

  /* ===== BB-R20：弹窗统一焦点管理 =====
     openModalA11y(mask, modal, opts)：
     - 补 role=dialog / aria-modal / aria-labelledby（标题元素需有 id）；
     - 打开时记录当前焦点，聚焦首个关键控件（默认 modal 内第一个 button/select/input）；
     - Escape 关闭（走 opts.close）；
     - Tab 循环约束在弹窗内；
     - 关闭时恢复原焦点。
     返回 cleanup 函数（移除 keydown 监听），关闭弹窗时必须调用。 */
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
    return String(value || "").match(/^#[0-9a-f]{6}$/i) ? value.toLowerCase() : "#000000";
  }
  function themeOverride(key) {
    const ov = state.doc.themeOverrides || {};
    return ov[key] == null || ov[key] === "" ? null : ov[key];
  }
  /* select 赋值兜底：预设/草稿里的值可能不在选项列表（如 AI 主题字重 750），不补项会显示空白 */
  function ensureSelectValue(select, value) {
    select.value = String(value);
    if (select.selectedIndex < 0) {
      const opt = el("option", null, String(value));
      opt.value = String(value);
      select.appendChild(opt);
      select.value = String(value);
    }
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
        ensureSelectValue(input, cur != null ? cur : preset);
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
      const engine = BG();
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
    const engine = BG();
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
    ensureSelectValue(shapeSel, bgRecord.params.shape || "circle");
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
    { key: "h3Scale", label: "小标题 H3", min: 0.7, max: 1.3, step: 0.05, tiers: [0.8, 0.9, 1, 1.1, 1.2] },
    { key: "bodyScale", label: "正文", min: 0.7, max: 1.3, step: 0.05, tiers: [0.8, 0.9, 1, 1.1, 1.2] },
    { key: "captionScale", label: "图注", min: 0.7, max: 1.3, step: 0.05, tiers: [0.8, 0.9, 1, 1.1, 1.2] },
  ];
  const TYPE_WEIGHT_FIELDS = [
    { key: "headingWeight", label: "标题字重" },
    { key: "bodyWeight", label: "正文字重" },
  ];
  const TYPE_SPACING_FIELDS = [
    { key: "lineHeight", label: "行距倍率", min: 0.8, max: 2.0, step: 0.05, tiers: [1, 1.15, 1.3, 1.5, 1.75] },
    { key: "letterSpacing", label: "字距 (px)", min: -2, max: 8, step: 0.5, tiers: [0, 1, 2, 4, 6] },
  ];
  const TYPE_COLOR_FIELDS = [
    { key: "ink", label: "正文墨色" },
    { key: "muted", label: "弱化说明色" },
  ];
  const WEIGHT_OPTIONS = [400, 500, 600, 700, 800, 900];
  function showTypeTweakModal() {
    const existing = document.getElementById("bb-type-tweak-modal");
    if (existing) existing.parentNode.removeChild(existing);
    const base = C.themeStyleForDoc ? C.themeStyleForDoc(state.doc) : C.themeStyle(state.doc.theme);

    const mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-type-tweak-modal";
    const modal = document.createElement("div");
    modal.className = "bb-modal";
    const typeTweakTitle = el("h3", null, "排版微调「" + (base.label || state.doc.theme) + "」");
    typeTweakTitle.id = "bb-type-tweak-modal-title";
    modal.appendChild(typeTweakTitle);
    /* BB-R20：弹窗焦点管理 */
    const closeA11y = openModalA11y(mask, modal, { titleId: "bb-type-tweak-modal-title" });
    modal.appendChild(el("p", null, "手动覆盖字号缩放、字重、行距、字距与文字颜色。继承预设项显示原值，改动实时反映到画布与 PNG / PSD 导出；恢复默认即清除该项覆盖。"));

    const body = el("div");
    body.style.marginTop = "6px";

    function section(title) {
      const d = el("div", "bb-tweak-section", title);
      body.appendChild(d);
    }

    function overrideOf(key) { return themeOverride(key); }
    function setOverride(key, value) {
      state.doc.themeOverrides = state.doc.themeOverrides || {};
      state.doc.themeOverrides[key] = value;
      renderAll();
    }
    function clearOverride(key) {
      if (state.doc.themeOverrides) delete state.doc.themeOverrides[key];
      renderAll();
      maskRemove();
    }
    function appendInherit(row, cur) {
      const flag = el("span", "bb-tweak-inherit");
      flag.textContent = cur == null ? "继承预设" : "已覆盖";
      const clear = el("a", "bb-tweak-clear", "恢复默认");
      clear.style.display = cur == null ? "none" : "inline";
      row.appendChild(flag); row.appendChild(clear);
      return { flag: flag, clear: clear };
    }

    /* 数值字段（缩放 / 行距 / 字距）：档位按钮 + 数值输入（Task #17 替换滑块） */
    function renderRangeField(fields) {
      fields.forEach(function (field) {
        const cur = overrideOf(field.key);
        const preset = base[field.key] != null ? base[field.key] : 1;
        const value = cur != null ? cur : preset;
        const row = el("div", "bb-tweak-row");
        row.appendChild(el("span", "bb-tweak-label", field.label));
        /* 档位按钮组：点按即设值；当前值与某档位一致时高亮该档 */
        const tierGroup = el("div", "bb-tier-group");
        tierGroup.setAttribute("role", "group");
        tierGroup.setAttribute("aria-label", field.label + " 档位");
        const num = el("input", "bb-tweak-val");
        num.type = "number"; num.min = String(field.min); num.max = String(field.max); num.step = String(field.step);
        num.value = String(value);
        const parts = appendInherit(row, cur);
        const formatTier = function (v) {
          const r = Math.round(v * 100) / 100;
          return String(r);
        };
        function refreshTierActive() {
          const buttons = tierGroup.querySelectorAll("button");
          for (let bi = 0; bi < buttons.length; bi += 1) {
            const bv = Number(buttons[bi].dataset.value);
            buttons[bi].classList.toggle("is-active", Math.abs(bv - Number(num.value)) < 1e-9);
          }
        }
        function applyValue(v, fromTier) {
          const clamped = Number.isFinite(v) ? Math.min(field.max, Math.max(field.min, v)) : field.min;
          /* 按 step 收敛，避免档位与输入框出现 1.23456 之类长尾 */
          const snapped = field.step > 0 ? Math.round(clamped / field.step) * field.step : clamped;
          const finalV = Math.round(Math.min(field.max, Math.max(field.min, snapped)) * 100) / 100;
          num.value = String(finalV);
          setOverride(field.key, finalV);
          parts.flag.textContent = "已覆盖"; parts.clear.style.display = "inline";
          refreshTierActive();
          if (!fromTier) num.focus();
        }
        (field.tiers || []).forEach(function (tv) {
          const btn = el("button", "bb-tier-btn", formatTier(tv));
          btn.type = "button";
          btn.dataset.value = String(tv);
          btn.title = field.label + " " + formatTier(tv);
          btn.addEventListener("click", function () { applyValue(tv, true); });
          tierGroup.appendChild(btn);
        });
        num.addEventListener("change", function () { applyValue(Number(num.value), false); });
        parts.clear.addEventListener("click", function () { clearOverride(field.key); });
        row.appendChild(tierGroup); row.appendChild(num);
        body.appendChild(row);
        refreshTierActive();
      });
    }

    /* 字重字段（档位下拉） */
    function renderWeightField(fields) {
      fields.forEach(function (field) {
        const cur = overrideOf(field.key);
        const preset = base[field.key] != null ? base[field.key] : (field.key === "headingWeight" ? 800 : 400);
        const value = cur != null ? cur : preset;
        const row = el("div", "bb-tweak-row");
        row.appendChild(el("span", "bb-tweak-label", field.label));
        const sel = el("select", "bb-tweak-select");
        WEIGHT_OPTIONS.forEach(function (w) { const o = el("option", null, String(w)); o.value = String(w); sel.appendChild(o); });
        ensureSelectValue(sel, value);
        const parts = appendInherit(row, cur);
        sel.addEventListener("change", function () {
          setOverride(field.key, Number(sel.value));
          parts.flag.textContent = "已覆盖"; parts.clear.style.display = "inline";
        });
        parts.clear.addEventListener("click", function () { clearOverride(field.key); });
        row.appendChild(sel);
        body.appendChild(row);
      });
    }

    /* 文字颜色字段 */
    function renderColorField(fields) {
      fields.forEach(function (field) {
        const cur = overrideOf(field.key);
        const preset = base[field.key] || "#20251f";
        const row = el("div", "bb-tweak-row");
        row.appendChild(el("span", "bb-tweak-label", field.label));
        const colorInput = el("input", "bb-tweak-input");
        colorInput.type = "color";
        colorInput.value = hexToColor(cur != null ? cur : preset);
        const hex = el("input", "bb-tweak-hex");
        hex.value = cur != null ? cur : preset;
        hex.readOnly = cur == null;
        hex.style.opacity = cur == null ? "0.55" : "1";
        const parts = appendInherit(row, cur);
        function applyHex() {
          const value = hexToColor(hex.value);
          setOverride(field.key, value);
          colorInput.value = value; hex.value = value;
          parts.flag.textContent = "已覆盖"; parts.clear.style.display = "inline";
        }
        colorInput.addEventListener("input", function () { hex.value = colorInput.value; applyHex(); });
        hex.addEventListener("change", applyHex);
        parts.clear.addEventListener("click", function () { clearOverride(field.key); });
        row.appendChild(colorInput); row.appendChild(hex);
        body.appendChild(row);
      });
    }

    section("字号缩放");
    renderRangeField(TYPE_SCALE_FIELDS);
    section("字重");
    renderWeightField(TYPE_WEIGHT_FIELDS);
    section("行距与字距");
    renderRangeField(TYPE_SPACING_FIELDS);
    section("文字颜色");
    renderColorField(TYPE_COLOR_FIELDS);
    modal.appendChild(body);

    const actionRow = el("div", "bb-modal-actions");
    const TYPE_KEYS = TYPE_SCALE_FIELDS.concat(TYPE_WEIGHT_FIELDS, TYPE_SPACING_FIELDS, TYPE_COLOR_FIELDS).map(function (f) { return f.key; });
    const resetAll = el("button", "bb-btn ghost", "全部恢复预设");
    resetAll.type = "button";
    resetAll.addEventListener("click", function () {
      TYPE_KEYS.forEach(function (key) { if (state.doc.themeOverrides) delete state.doc.themeOverrides[key]; });
      renderAll(); maskRemove();
    });
    resetAll.title = "清空本面板全部排版覆盖，回退到预设主题";
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

  /* ===== 字体下拉重建（内置字体 + 用户导入字体） ===== */
  function refreshFontSelects() {
    /* 字体下拉已迁入右侧文档设置面板（renderPanel 每次重建），此处无需再同步顶部控件。
       保留函数供 bootstrapUserFonts / 字体导入流程调用，仅刷新 Constants 数据源。 */
  }

  /* ===== 用户导入字体弹窗（BB-R23：接入已导入字体的删除能力） ===== */
  function showFontImportModal() {
    var importer = global.BannerBuilderFontImporter;
    if (!importer || !importer.isAvailable()) {
      if (global.alert) global.alert("当前浏览器不支持 IndexedDB，无法保存导入字体。");
      return;
    }
    var existing = document.getElementById("bb-font-modal");
    if (existing) existing.parentNode.removeChild(existing);

    var mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-font-modal";
    var modal = document.createElement("div");
    modal.className = "bb-modal";

    var fontModalTitle = el("h3", null, "导入本地字体");
    fontModalTitle.id = "bb-font-modal-title";
    modal.appendChild(fontModalTitle);
    /* BB-R20：弹窗焦点管理 */
    var closeA11y = openModalA11y(mask, modal, { titleId: "bb-font-modal-title" });
    modal.appendChild(el("p", null, "选择一个 .ttf / .otf / .woff / .woff2 字体文件，工具会读取字体家族名、保存到浏览器本地，并立即加入上方的「全局 / 标题 / 正文」字体下拉。"));

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";
    fileInput.style.cssText = "margin:14px 0;display:block";
    modal.appendChild(fileInput);

    var msgArea = el("div");
    msgArea.style.display = "none";
    modal.appendChild(msgArea);

    function showMsg(type, text) {
      msgArea.style.display = "block";
      msgArea.className = type === "error" ? "bb-modal-error" : "bb-modal-success";
      msgArea.textContent = text;
    }

    fileInput.addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || "";
      if (["ttf", "otf", "woff", "woff2"].indexOf(String(ext).toLowerCase()) < 0) {
        showMsg("error", "不支持的文件类型，请选择 .ttf / .otf / .woff / .woff2 字体文件。");
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result);
        try {
          var meta = importer.parseFontMeta(arrayBufferFromDataUrl(dataUrl));
          var family = meta.family || file.name.replace(/\.[a-z0-9]+$/i, "");
          var record = importer.buildRecord({
            label: family,
            family: family,
            format: meta.format || "truetype",
            fileName: file.name,
            dataUrl: dataUrl,
          });
          importer.addFont(record).then(function () {
            return importer.refresh().then(function () {
              importer.applyToConstants();
              refreshFontSelects();
              showMsg("success", "✓ 已导入字体「" + family + "」（" + file.name + "），可在字体下拉中选用。");
              fileInput.value = "";
            });
          }).catch(function (e) {
            showMsg("error", "导入失败：" + (e && e.message || e));
          });
        } catch (e) {
          showMsg("error", "解析字体失败：" + (e && e.message || e));
        }
      };
      reader.onerror = function () { showMsg("error", "读取字体文件失败。"); };
      reader.readAsDataURL(file);
    });

    var actionRow = document.createElement("div");
    actionRow.className = "bb-modal-actions";
    var closeBtn = el("button", "bb-btn ghost", "关闭");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () { closeA11y(); mask.parentNode.removeChild(mask); });
    actionRow.appendChild(closeBtn);
    modal.appendChild(actionRow);

    /* BB-R23：已导入字体管理——列出本机 IndexedDB 中的自定义字体，支持删除。
       删除持久化失败必须明确报错，不返回伪成功。 */
    var manageArea = el("div");
    manageArea.style.marginTop = "14px";
    var manageTitle = el("p", null, "▼ 已导入字体（本机保存，删除后不可恢复）");
    manageTitle.style.marginTop = "12px";
    manageArea.appendChild(manageTitle);
    var fontList = el("div");
    manageArea.appendChild(fontList);
    modal.appendChild(manageArea);

    function renderFontManageList() {
      fontList.textContent = "";
      /* refresh() 异步刷新内部缓存后返回字体清单 */
      importer.refresh().then(function (list) {
        list = list || [];
        if (!list.length) { fontList.appendChild(el("p", null, "（暂无已导入字体）")); return; }
        list.forEach(function (row) {
          var item = el("div", "bb-tweak-row");
          item.appendChild(el("span", "bb-tweak-label", (row.label || row.family || row.id) + "（" + (row.fileName || row.format || "") + "）"));
          var delBtn = el("button", "bb-btn ghost", "删除");
          delBtn.type = "button";
          delBtn.style.cssText = "color:#b54a35;border-color:#e8c4ba";
          delBtn.addEventListener("click", function () {
            if (!global.confirm("删除字体「" + (row.label || row.id) + "」？正在使用该字体的文档会回退默认字体。")) return;
            importer.removeFont(row.id).then(function () {
              /* 从 Constants 撤销注入，避免下拉里残留已删除字体 */
              if (C.FONTS[row.id]) delete C.FONTS[row.id];
              if (C.FONT_DOWNLOADS && C.FONT_DOWNLOADS[row.id]) delete C.FONT_DOWNLOADS[row.id];
              refreshFontSelects();
              renderFontManageList();
            }).catch(function (e) {
              if (global.alert) global.alert("字体删除失败（未写入存储）：" + ((e && e.message) || e));
            });
          });
          item.appendChild(delBtn);
          fontList.appendChild(item);
        });
      }).catch(function () {
        fontList.appendChild(el("p", null, "（字体库读取失败）"));
      });
    }
    renderFontManageList();

    mask.appendChild(modal);
    mask.addEventListener("click", function (e) { if (e.target === mask) { closeA11y(); mask.parentNode.removeChild(mask); } });
    document.body.appendChild(mask);
  }

  function arrayBufferFromDataUrl(dataUrl) {
    var comma = dataUrl.indexOf(",");
    if (comma < 0) throw new Error("字体数据格式错误");
    var b64 = dataUrl.slice(comma + 1);
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function init() { if (initialized) return; initialized = true; els.ratioGroup = document.getElementById("ratioGroup"); els.screenModeGroup = document.getElementById("screenModeGroup"); els.sizeReadout = document.getElementById("sizeReadout"); els.addPageBtn = document.getElementById("addPageBtn"); els.stats = document.getElementById("docStats"); els.importThemeBtn = document.getElementById("importThemeBtn"); els.importModuleBtn = document.getElementById("importModuleBtn"); els.generateAiDocumentBtn = document.getElementById("generateAiDocumentBtn"); els.libraryList = document.getElementById("libraryList"); els.libraryHint = document.getElementById("libraryHint"); els.myTplArea = document.getElementById("myTplArea"); els.myTplCount = document.getElementById("myTplCount"); els.myTplList = document.getElementById("myTplList"); els.zoomOutBtn = document.getElementById("zoomOutBtn"); els.zoomInBtn = document.getElementById("zoomInBtn"); els.zoomFitBtn = document.getElementById("zoomFitBtn"); els.zoomValue = document.getElementById("zoomValue"); els.packFontsToggle = document.getElementById("packFontsToggle"); els.saveDraftBtn = document.getElementById("saveDraftBtn"); els.loadDraftInput = document.getElementById("loadDraftInput"); els.libraryList = document.getElementById("libraryList"); els.libraryHint = document.getElementById("libraryHint"); els.myTplArea = document.getElementById("myTplArea"); els.myTplList = document.getElementById("myTplList"); els.myTplCount = document.getElementById("myTplCount"); els.canvasBody = document.getElementById("canvasBody"); els.panelTitle = document.getElementById("panelTitle"); els.panelSub = document.getElementById("panelSub"); els.panelBody = document.getElementById("panelBody"); els.stepBar = document.getElementById("stepBar"); els.sideTabs = document.getElementById("sideTabs"); els.libraryPane = document.getElementById("libraryPane"); els.layerPane = document.getElementById("layerPane"); els.layerTree = document.getElementById("layerTree"); els.addPageBtnSide = document.getElementById("addPageBtnSide"); els.workbench = document.getElementById("workbench"); els.exportScaleGroup = document.getElementById("exportScaleGroup"); els.exportSizeReadout = document.getElementById("exportSizeReadout"); els.stepToolbars = { "theme-bg": document.querySelector(".bb-toolbar-theme-bg"), setup: document.querySelector(".bb-toolbar-setup"), edit: document.querySelector(".bb-toolbar-edit"), export: document.querySelector(".bb-toolbar-export") }; state.activePageId = state.doc.pages[0].id; refreshFontSelects(); ensureFont(docFontFamily()); bindEvents(); preloadDefaultFont(); renderAll(); renderMyTemplates(); bootstrapUserFonts(); setupZoomAutoFit(); global.bannerBuilder = { state: state, get doc() { return state.doc; }, toJSON: function () { return M.toJSON(state.doc); }, exportPng: exportPng, exportStripPng: exportStripPng, exportPsd: exportPsd, setZoom: function (z) { state.zoomManual = true; state.zoom = z; renderToolbar(); renderCanvas(); }, renderAll: renderAll }; }
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
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);

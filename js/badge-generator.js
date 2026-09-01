(function () {
  "use strict";

  const U = window.CanvasUtils;
  const M = window.MobileImageUpload;
  const E = window.BadgeEdgeDetect;
  const state = {
    template: null,
    items: [],
    mode: "folder",
    folderFiles: [],
    currentId: null,
    cropper: null,
    cropTarget: null,
    customFonts: new Map(),
    selectedTarget: "avatar",
    layoutImported: false,
    idSeed: 0
  };

  const $ = id => document.getElementById(id);
  const els = {
    listView: $("listView"), editorView: $("editorView"), backgroundInput: $("backgroundInput"), clearBackgroundBtn: $("clearBackgroundBtn"), templateStage: $("templateStage"), templateImage: $("templateImage"), templateEmpty: $("templateEmpty"), stageHintTemplate: $("stageHintTemplate"), templateAvatarZone: $("templateAvatarZone"), templateNameZone: $("templateNameZone"), nameEnabled: $("nameEnabled"), nameControls: $("nameControls"), nameColor: $("nameColor"), avatarRadius: $("avatarRadius"), avatarBorder: $("avatarBorder"), avatarAspect: $("avatarAspect"), sampleAvatarInput: $("sampleAvatarInput"), cropSampleBtn: $("cropSampleBtn"), removeSampleAvatarBtn: $("removeSampleAvatarBtn"), fontFamily: $("fontFamily"), fontFamilyZh: $("fontFamilyZh"), fontFamilyEn: $("fontFamilyEn"), fontFamilyJa: $("fontFamilyJa"), fontSize: $("fontSize"), nameAlign: $("nameAlign"), nameVertical: $("nameVertical"), letterSpacing: $("letterSpacing"), fontInputZh: $("fontInputZh"), fontInputEn: $("fontInputEn"), fontInputJa: $("fontInputJa"), fontStatus: $("fontStatus"), xlsxInput: $("xlsxInput"), folderInput: $("folderInput"), xlsxField: $("xlsxField"), folderField: $("folderField"), embeddedField: $("embeddedField"), foldernameField: $("foldernameField"), filenameSeparator: $("filenameSeparator"), separatorSide: $("separatorSide"), modeDescription: $("modeDescription"), importPanel: $("importPanel"), exportPanel: $("exportPanel"), stepTemplate: $("stepTemplate"), stepImport: $("stepImport"), stepExport: $("stepExport"), importBtn: $("importBtn"), xlsxStatus: $("xlsxStatus"), folderStatus: $("folderStatus"), importStatus: $("importStatus"), itemsGrid: $("itemsGrid"), itemsCount: $("itemsCount"), filenamePrefix: $("filenamePrefix"), exportBtn: $("exportBtn"), exportStatus: $("exportStatus"), exportProgress: $("exportProgress"), backToListBtn: $("backToListBtn"), editorTitle: $("editorTitle"), editorStatus: $("editorStatus"), editorStage: $("editorStage"), editorImage: $("editorImage"), editorAvatarZone: $("editorAvatarZone"), editorNameZone: $("editorNameZone"),  editorNameInput: $("editorNameInput"), editorRemarkInput: $("editorRemarkInput"), editorAvatarInput: $("editorAvatarInput"), editorAvatarStatus: $("editorAvatarStatus"), removeEditorAvatarBtn: $("removeEditorAvatarBtn"), cropEditorBtn: $("cropEditorBtn"), editorFontFamily: $("editorFontFamily"), editorFontFamilyZh: $("editorFontFamilyZh"), editorFontFamilyEn: $("editorFontFamilyEn"), editorFontFamilyJa: $("editorFontFamilyJa"), editorFontSize: $("editorFontSize"), editorNameColor: $("editorNameColor"), editorNameAlign: $("editorNameAlign"), editorNameVertical: $("editorNameVertical"), resetItemBtn: $("resetItemBtn"), setGlobalBtn: $("setGlobalBtn"), downloadCurrentBtn: $("downloadCurrentBtn"), cropDialog: $("cropDialog"), cropImage: $("cropImage"), cancelCropBtn: $("cancelCropBtn"), saveCropBtn: $("saveCropBtn")
  };

  els.avatarBorderColor = $("avatarBorderColor");
  els.avatarBaseEnabled = $("avatarBaseEnabled");
  els.avatarBaseColor = $("avatarBaseColor");
  els.avatarOutlineWidth = $("avatarOutlineWidth");
  els.avatarOutlineGap = $("avatarOutlineGap");
  els.avatarOutlineColor = $("avatarOutlineColor");
  els.saveTemplateBtn = $("saveTemplateBtn");
  els.loadTemplateInput = $("loadTemplateInput");
  els.editorAvatarAspect = $("editorAvatarAspect");
  els.editorAvatarRadius = $("editorAvatarRadius");
  els.editorAvatarBorder = $("editorAvatarBorder");
  els.editorAvatarBorderColor = $("editorAvatarBorderColor");
  els.editorAvatarBaseEnabled = $("editorAvatarBaseEnabled");
  els.editorAvatarBaseColor = $("editorAvatarBaseColor");
  els.editorAvatarOutlineWidth = $("editorAvatarOutlineWidth");
  els.editorAvatarOutlineGap = $("editorAvatarOutlineGap");
  els.editorAvatarOutlineColor = $("editorAvatarOutlineColor");
  function id() { state.idSeed += 1; return "badge-" + Date.now().toString(36) + "-" + state.idSeed; }
  function number(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function normalizeName(value) { return String(value || "").trim().replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/　/g, " "); }
  function extless(value) { return normalizeName(String(value || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "")); }
  function escapeXml(value) { return String(value || "").replace(/[<>&'\"]/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" }[ch])); }
  function errorText(error) { return M && M.errorMessage ? M.errorMessage(error) : "文件读取失败，请重试。"; }

  function defaultTemplate() {
    return {
      backgroundImage: null, backgroundWidth: 1000, backgroundHeight: 1400,
      avatarBox: { x: 300, y: 260, width: 400, height: 400, cropAspectRatio: 1, borderRadius: 24, borderWidth: 0, borderColor: "#ffffff", baseEnabled: false, baseColor: "#ffffff", outlineWidth: 0, outlineGap: 0, outlineColor: "#000000" },
      nameBlock: { enabled: true, x: 180, y: 760, width: 640, height: 120, fontId: "NotoSansCJKsc", cssFontFamily: "Noto Sans CJK SC", fontFamilies: { zh: "Noto Sans SC", en: "Noto Sans", ja: "Noto Sans JP" }, fontSize: "", fontSizeRange: { min: 24, max: 72 }, color: "#18221d", align: "center", verticalAlign: "middle", letterSpacing: 0 }
    };
  }
  state.template = defaultTemplate();

  function mergedBox(item) { const box = Object.assign({}, state.template.avatarBox, item && item.avatarOverride ? item.avatarOverride : {}); return constrainBox(box, box.cropAspectRatio); }
  function mergedName(item) { const block = Object.assign({}, state.template.nameBlock, item && item.nameOverride ? item.nameOverride : {}); return constrainBox(block, 0); }
  function stageMetrics(stage) {
    const image = stage.querySelector("img");
    const backgroundWidth = state.template.backgroundWidth;
    const backgroundHeight = state.template.backgroundHeight;
    if (!image || !backgroundWidth || !backgroundHeight) return null;
    const stageRect = stage.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const imageWidth = imageRect.width || image.clientWidth || stageRect.width;
    const imageHeight = imageRect.height || image.clientHeight || Math.round(imageWidth * backgroundHeight / backgroundWidth);
    const left = imageRect.width ? imageRect.left - stageRect.left : 0;
    const top = imageRect.height ? imageRect.top - stageRect.top : 0;
    return { left, top, width: imageWidth, height: imageHeight, scaleX: imageWidth / backgroundWidth, scaleY: imageHeight / backgroundHeight, scale: imageWidth / backgroundWidth };
  }
  function syncZone(zone, box, stage) {
    const metrics = stageMetrics(stage);
    if (!state.template.backgroundImage || !metrics) return;
    zone.style.left = (metrics.left + box.x * metrics.scaleX) + "px";
    zone.style.top = (metrics.top + box.y * metrics.scaleY) + "px";
    zone.style.width = Math.max(30, box.width * metrics.scaleX) + "px";
    zone.style.height = Math.max(30, box.height * metrics.scaleY) + "px";
  }
  function selectZone(target) {
    state.selectedTarget = target;
    els.templateAvatarZone.classList.toggle("selected", target === "avatar");
    els.templateNameZone.classList.toggle("selected", target === "name");
    els.editorAvatarZone.classList.toggle("selected", target === "avatar");
    els.editorNameZone.classList.toggle("selected", target === "name");
  }
  function updateTemplateZones() {
    const hasImage = Boolean(state.template.backgroundImage);
    els.templateAvatarZone.classList.toggle("active", hasImage);
    els.templateNameZone.classList.toggle("active", hasImage && state.template.nameBlock.enabled);
    syncZone(els.templateAvatarZone, state.template.avatarBox, els.templateStage);
    syncZone(els.templateNameZone, state.template.nameBlock, els.templateStage);
    selectZone(state.selectedTarget);
  }
  function clamp(value, min, max) { return Math.min(Math.max(min, value), Math.max(min, max)); }
  function constrainBox(box, keepAspect) {
    const maxWidth = Math.max(20, state.template.backgroundWidth); const maxHeight = Math.max(20, state.template.backgroundHeight); const ratio = keepAspect > 0 ? keepAspect : 0;
    box.width = clamp(Math.round(number(box.width, 20)), 20, maxWidth); box.height = clamp(Math.round(number(box.height, 20)), 20, maxHeight);
    if (ratio > 0) {
      box.height = Math.max(20, Math.round(box.width / ratio));
      if (box.height > maxHeight) { box.height = maxHeight; box.width = Math.max(20, Math.round(box.height * ratio)); }
      if (box.width > maxWidth) { box.width = maxWidth; box.height = Math.max(20, Math.round(box.width / ratio)); }
    }
    box.x = clamp(Math.round(number(box.x, 0)), 0, maxWidth - box.width); box.y = clamp(Math.round(number(box.y, 0)), 0, maxHeight - box.height);
    return box;
  }
  let templatePreviewFrame = 0;
  function scheduleTemplatePreview() {
    if (!state.template.backgroundImage) return;
    if (templatePreviewFrame) cancelAnimationFrame(templatePreviewFrame);
    templatePreviewFrame = requestAnimationFrame(() => { templatePreviewFrame = 0; updateTemplatePreview(); });
  }
    function updateTemplateInputs() {
    const a = state.template.avatarBox; const n = state.template.nameBlock;
    els.avatarRadius.value = a.borderRadius; els.avatarBorder.value = a.borderWidth; els.avatarAspect.value = String(a.cropAspectRatio); els.avatarBorderColor.value = a.borderColor || "#ffffff"; els.avatarBaseEnabled.checked = Boolean(a.baseEnabled); els.avatarBaseColor.value = a.baseColor || "#ffffff"; els.avatarOutlineWidth.value = a.outlineWidth || 0; els.avatarOutlineGap.value = a.outlineGap || 0; els.avatarOutlineColor.value = a.outlineColor || "#000000";
    els.nameEnabled.checked = Boolean(n.enabled); els.nameControls.hidden = !n.enabled;
    els.fontFamily.value = n.cssFontFamily || "Noto Sans SC"; els.fontFamilyZh.value = n.fontFamilies && n.fontFamilies.zh || "Noto Sans SC"; els.fontFamilyEn.value = n.fontFamilies && n.fontFamilies.en || "Noto Sans"; els.fontFamilyJa.value = n.fontFamilies && n.fontFamilies.ja || "Noto Sans JP"; els.fontSize.value = n.fontSize == null ? "" : n.fontSize; els.nameColor.value = n.color; els.nameAlign.value = n.align; els.nameVertical.value = n.verticalAlign; els.letterSpacing.value = n.letterSpacing || 0;
    updateTemplateZones(); scheduleTemplatePreview(); updateStepIndicator();
  }

  function readTemplateInputs() {
    const a = state.template.avatarBox; const n = state.template.nameBlock; const ratio = number(els.avatarAspect.value, a.cropAspectRatio);
    a.cropAspectRatio = ratio; a.borderRadius = Math.max(0, number(els.avatarRadius.value, a.borderRadius)); a.borderWidth = Math.max(0, number(els.avatarBorder.value, a.borderWidth)); a.borderColor = els.avatarBorderColor.value || "#ffffff"; a.baseEnabled = els.avatarBaseEnabled.checked; a.baseColor = els.avatarBaseColor.value || "#ffffff"; a.outlineWidth = Math.max(0, number(els.avatarOutlineWidth.value, a.outlineWidth || 0)); a.outlineGap = Math.max(0, number(els.avatarOutlineGap.value, a.outlineGap || 0)); a.outlineColor = els.avatarOutlineColor.value || "#000000"; constrainBox(a, ratio);
    n.enabled = els.nameEnabled.checked; n.fontFamilies = { zh: els.fontFamilyZh.value, en: els.fontFamilyEn.value, ja: els.fontFamilyJa.value }; n.cssFontFamily = n.fontFamilies.zh; n.fontId = n.fontFamilies.zh; const fontSizeValue = String(els.fontSize.value || "").trim(); n.fontSize = fontSizeValue && Number(fontSizeValue) > 0 ? Math.max(8, Number(fontSizeValue)) : ""; n.color = els.nameColor.value; n.align = els.nameAlign.value; n.verticalAlign = els.nameVertical.value; n.letterSpacing = Math.max(0, number(els.letterSpacing.value, 0)); constrainBox(n, 0);
    updateTemplateInputs();
    if (!els.editorView.hidden && currentItem()) { updateEditorInputs(); updateEditorPreview(); }
    if (state.items.length) refreshThumbnails();
  }

  function scaleBoxCoordinates(box, scaleX, scaleY, keepAspect) {
    if (!box) return null;
    const next = Object.assign({}, box, { x: Math.round(box.x * scaleX), y: Math.round(box.y * scaleY), width: Math.round(box.width * scaleX), height: Math.round(box.height * scaleY) });
    return constrainBox(next, keepAspect ? Number(next.cropAspectRatio) || 0 : 0);
  }
  function migrateBackgroundCoordinates(oldWidth, oldHeight, newWidth, newHeight) {
    if (!oldWidth || !oldHeight) return;
    const scaleX = newWidth / oldWidth; const scaleY = newHeight / oldHeight;
    state.template.avatarBox = scaleBoxCoordinates(state.template.avatarBox, scaleX, scaleY, true);
    state.template.nameBlock = scaleBoxCoordinates(state.template.nameBlock, scaleX, scaleY, false);
    state.items.forEach(item => {
      if (item.avatarOverride) item.avatarOverride = scaleBoxCoordinates(item.avatarOverride, scaleX, scaleY, true);
      if (item.nameOverride) item.nameOverride = scaleBoxCoordinates(item.nameOverride, scaleX, scaleY, false);
    });
  }
  function detectAvatarFrame(image) {
    if (!E) return null;
    const data = E.imageToRgba(image, 800);
    if (!data) return null;
    const frame = E.avatarFrameFromRgba(data.rgba, data.width, data.height);
    if (!frame) return null;
    const scaleX = (image.naturalWidth || image.width) / data.width;
    const scaleY = (image.naturalHeight || image.height) / data.height;
    return { x: Math.round(frame.x * scaleX), y: Math.round(frame.y * scaleY), width: Math.round(frame.width * scaleX), height: Math.round(frame.height * scaleY) };
  }
  /* 计算顶部对齐的初始裁剪框（相对图片自然像素坐标）：自由比例铺满整图，固定比例取最大且上边贴顶、水平居中。 */
  function topAlignedCropData(image, ratio) {
    const W = image.naturalWidth || image.width;
    const H = image.naturalHeight || image.height;
    if (!W || !H) return null;
    if (!Number.isFinite(ratio) || ratio <= 0) return { x: 0, y: 0, width: W, height: H };
    let w = W; let h = Math.round(w / ratio);
    if (h > H) { h = H; w = Math.round(h * ratio); }
    return { x: Math.round((W - w) / 2), y: 0, width: w, height: h };
  }
  const STAGE_HINT_DEFAULT = "点击左侧画布上的虚线框切换选中对象，拖动即可移动";
  let stageHintTimer = 0;
  function setStageHint(text, sticky) {
    if (!els.stageHintTemplate) return;
    els.stageHintTemplate.textContent = text;
    if (stageHintTimer) { clearTimeout(stageHintTimer); stageHintTimer = 0; }
    if (!sticky) stageHintTimer = setTimeout(() => { els.stageHintTemplate.textContent = STAGE_HINT_DEFAULT; }, 4000);
  }
  function setBackground(opened) {
    const previousImage = state.template.backgroundImage; const hasLayout = Boolean(previousImage) || state.layoutImported; const oldWidth = hasLayout ? state.template.backgroundWidth : 0; const oldHeight = hasLayout ? state.template.backgroundHeight : 0;
    state.template.backgroundImage = opened;
    state.template.backgroundWidth = opened.image.naturalWidth; state.template.backgroundHeight = opened.image.naturalHeight;
    if (hasLayout) { if (oldWidth && oldHeight) migrateBackgroundCoordinates(oldWidth, oldHeight, state.template.backgroundWidth, state.template.backgroundHeight); if (previousImage) previousImage.release(); }
    else {
      const frame = detectAvatarFrame(opened.image);
      if (frame) {
        state.template.avatarBox.x = frame.x; state.template.avatarBox.y = frame.y; state.template.avatarBox.width = frame.width; state.template.avatarBox.height = frame.height;
        state.template.avatarBox.cropAspectRatio = 0;
        constrainBox(state.template.avatarBox, 0);
        setStageHint("已自动对齐到证件头像框边框内边缘，可拖动微调。");
      } else {
        constrainBox(state.template.avatarBox, state.template.avatarBox.cropAspectRatio); state.template.avatarBox.x = Math.round((state.template.backgroundWidth - state.template.avatarBox.width) / 2); state.template.avatarBox.y = Math.round(state.template.backgroundHeight * .18); constrainBox(state.template.avatarBox, state.template.avatarBox.cropAspectRatio);
        setStageHint("未检测到证件头像框边框，请手动拖动头像框对齐边框位置。");
      }
      state.template.nameBlock.x = Math.round((state.template.backgroundWidth - state.template.nameBlock.width) / 2); state.template.nameBlock.y = Math.round(state.template.backgroundHeight * .62); constrainBox(state.template.nameBlock, 0); }
    state.layoutImported = false;
    const stageAr = (state.template.backgroundWidth / Math.max(1, state.template.backgroundHeight)).toFixed(4); els.templateStage.style.setProperty("--badge-stage-ratio", state.template.backgroundWidth + " / " + state.template.backgroundHeight); els.editorStage.style.setProperty("--badge-stage-ratio", state.template.backgroundWidth + " / " + state.template.backgroundHeight); els.templateStage.style.setProperty("--badge-stage-ar", stageAr); els.editorStage.style.setProperty("--badge-stage-ar", stageAr);
    els.templateStage.classList.add("has-background"); els.editorStage.classList.add("has-background");
    els.templateImage.hidden = false; els.templateEmpty.hidden = true;
    updateTemplateInputs(); if (state.items.length) refreshThumbnails();
  }

  function drawRoundRect(ctx, x, y, w, h, radius) {
    const r = Math.min(Math.max(0, radius), Math.min(w, h) / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  async function imageElementFromBlob(blob) { return M.open(blob); }
  function sourceSize(image) { return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }; }
  function imageMime(path) { const ext = String(path || "").split(".").pop().toLowerCase(); return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" })[ext] || "application/octet-stream"; }
  function drawAvatar(ctx, image, box, alpha) {
    if (!image) return;
    const source = sourceSize(image); const targetRatio = box.cropAspectRatio > 0 ? box.cropAspectRatio : box.width / box.height; const sourceRatio = source.width / source.height;
    let sx = 0; let sy = 0; let sw = source.width; let sh = source.height;
    let dx = box.x, dy = box.y, dw = box.width, dh = box.height;
    if (sourceRatio > targetRatio) { dw = box.width; dh = box.width / sourceRatio; dy = box.y + (box.height - dh) / 2; } else { sh = source.width / targetRatio; sy = 0; }
    const a = alpha == null ? 1 : alpha;
    ctx.save(); ctx.globalAlpha = a;
    if (box.baseEnabled) { drawRoundRect(ctx, box.x, box.y, box.width, box.height, box.borderRadius); ctx.fillStyle = box.baseColor || "#ffffff"; ctx.fill(); }
    drawRoundRect(ctx, box.x, box.y, box.width, box.height, box.borderRadius); ctx.clip(); ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh); ctx.restore();
    if (box.borderWidth > 0) { ctx.save(); drawRoundRect(ctx, box.x, box.y, box.width, box.height, box.borderRadius); ctx.strokeStyle = box.borderColor || "#fff"; ctx.lineWidth = box.borderWidth; ctx.stroke(); ctx.restore(); }
    if (box.outlineWidth > 0) { const gap = Math.max(0, number(box.outlineGap, 0)); ctx.save(); drawRoundRect(ctx, box.x - gap, box.y - gap, box.width + gap * 2, box.height + gap * 2, box.borderRadius + gap); ctx.strokeStyle = box.outlineColor || "#000"; ctx.lineWidth = box.outlineWidth; ctx.stroke(); ctx.restore(); }
  }
  function drawSpacedText(ctx, text, x, baseline, spacing) {
    if (!spacing) { ctx.fillText(text, x, baseline); return; }
    let cursor = x; for (const ch of String(text)) { ctx.fillText(ch, cursor, baseline); cursor += ctx.measureText(ch).width + spacing; }
  }
  function fontFamilyForChar(ch, block) {
    const families = block.fontFamilies || {};
    if (/^[\x00-\x7f]$/.test(ch)) return families.en || block.cssFontFamily || "Noto Sans";
    if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(ch)) return families.ja || block.cssFontFamily || "Noto Sans JP";
    return families.zh || block.cssFontFamily || "Noto Sans SC";
  }
  function measureName(ctx, text, block, size) {
    let width = 0;
    for (const ch of String(text)) { ctx.font = "700 " + size + "px " + fontFamilyForChar(ch, block); width += ctx.measureText(ch).width; }
    return width + Math.max(0, String(text).length - 1) * (block.letterSpacing || 0);
  }
  function drawNameCharacters(ctx, text, block, x, baseline, size) {
    let cursor = x;
    for (const ch of String(text)) { ctx.font = "700 " + size + "px " + fontFamilyForChar(ch, block); ctx.fillText(ch, cursor, baseline); cursor += ctx.measureText(ch).width + (block.letterSpacing || 0); }
  }
  function drawName(ctx, text, block) {
    if (!block.enabled || !text) return;
    const requestedSize = Number(block.fontSize); let size = requestedSize > 0 ? requestedSize : 48; const min = block.fontSizeRange ? block.fontSizeRange.min : 18; const max = block.fontSizeRange ? block.fontSizeRange.max : 72;
    if (!(requestedSize > 0)) { let lo = min; let hi = max; while (lo <= hi) { const mid = Math.floor((lo + hi) / 2); if (measureName(ctx, text, block, mid) <= block.width) { size = mid; lo = mid + 1; } else hi = mid - 1; } }
    ctx.save(); ctx.fillStyle = block.color || "#18221d"; ctx.textBaseline = "alphabetic";
    const textWidth = measureName(ctx, text, block, size); let x = block.x; if (block.align === "center") x += (block.width - textWidth) / 2; if (block.align === "right") x += block.width - textWidth;
    const lineHeight = size * 1.2; let baseline = block.y + size; if (block.verticalAlign === "middle") baseline = block.y + (block.height - lineHeight) / 2 + size; if (block.verticalAlign === "bottom") baseline = block.y + block.height - (block.height - lineHeight) / 2;
    drawNameCharacters(ctx, text, block, x, baseline, size); ctx.restore();
  }
  async function renderItem(item, scale, opts) {
    if (!state.template.backgroundImage) throw new Error("NO_BACKGROUND");
    const width = Math.max(1, Math.round(state.template.backgroundWidth * scale)); const height = Math.max(1, Math.round(state.template.backgroundHeight * scale)); const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d");
    ctx.drawImage(state.template.backgroundImage.image, 0, 0, width, height); ctx.save(); ctx.scale(scale, scale);
    const avatarAlpha = opts && opts.avatarAlpha != null ? opts.avatarAlpha : 1;
    let avatarHandle = null; if (item.avatarSource) avatarHandle = await imageElementFromBlob(item.avatarSource); drawAvatar(ctx, avatarHandle && avatarHandle.image, mergedBox(item), avatarAlpha); drawName(ctx, item.name, mergedName(item)); if (avatarHandle) avatarHandle.release(); ctx.restore(); return canvas;
  }
  async function thumbnail(item) { const canvas = await renderItem(item, Math.min(1, 200 / state.template.backgroundWidth)); const out = document.createElement("canvas"); out.width = canvas.width; out.height = canvas.height; const octx = out.getContext("2d"); octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, out.width, out.height); octx.drawImage(canvas, 0, 0); return out.toDataURL("image/jpeg", .82); }
  async function updateTemplatePreview() {
    if (!state.template.backgroundImage) return;
    const fakeItem = { avatarSource: state.template.sampleAvatar || null, name: "示例姓名", avatarOverride: null, nameOverride: null };
    const canvas = await renderItem(fakeItem, Math.min(1, 760 / state.template.backgroundWidth), { avatarAlpha: 0.5 });
    els.templateImage.src = canvas.toDataURL("image/png");
  }
  function updateSampleAvatarButtons() {
    const has = Boolean(state.template.sampleAvatar);
    els.cropSampleBtn.disabled = !has;
    els.removeSampleAvatarBtn.disabled = !has;
  }

  function setStatus(target, text) { target.textContent = text || ""; }
  function setStepState(element, stateName) { element.classList.remove("done", "current", "locked"); element.classList.add(stateName); }
  function updateStepIndicator() {
    const hasTemplate = Boolean(state.template.backgroundImage); const hasItems = state.items.length > 0;
    setStepState(els.stepTemplate, hasTemplate ? "done" : "current"); setStepState(els.stepImport, hasTemplate ? (hasItems ? "done" : "current") : "locked"); setStepState(els.stepExport, hasItems ? "current" : "locked");
    els.importPanel.classList.toggle("disabled-panel", !hasTemplate); els.exportPanel.classList.toggle("disabled-panel", !hasItems);
    els.importBtn.textContent = hasItems ? "重新导入（将替换现有 " + state.items.length + " 条记录）" : "导入并生成缩略图";
  }
  function renderItems() {
    els.itemsCount.textContent = state.items.length ? state.items.length + " 条记录" : "尚未导入数据"; els.exportBtn.disabled = !state.items.length; updateStepIndicator();
    if (!state.items.length) { els.itemsGrid.innerHTML = '<div class="empty-items">导入表格后，这里会生成每条记录的模板缩略图。</div>'; return; }
    els.itemsGrid.innerHTML = state.items.map(item => '<article class="item-card ' + (item.status === "missing-avatar" ? "missing" : "") + '" data-id="' + item.id + '"><button class="card-open" type="button"><div class="thumb-wrap"><img alt="' + safeAttr(item.name) + '缩略图" src="' + item.thumbnail + '">' + (item.status === "missing-avatar" ? '<span class="missing-mark">缺少头像</span>' : "") + '</div><div class="item-info"><strong>' + safeHtml(item.name || "未命名") + '</strong><span>' + (item.avatarSource ? "有头像" : "无头像") + " · " + safeHtml(item.remark || "无备注") + '</span></div></button><div class="item-actions">' + (item.status === "missing-avatar" ? '<label class="btn secondary file-button">补传头像<input class="quick-avatar" type="file" accept="image/*"></label>' : '<span></span>') + '<button class="btn secondary card-edit" type="button">编辑</button></div></article>').join("");
  }
  function safeHtml(value) { return String(value || "").replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch])); }
  function safeAttr(value) { return safeHtml(value).replace(/'/g, "&#39;"); }
  async function refreshThumbnails() { for (let i = 0; i < state.items.length; i += 1) { state.items[i].thumbnail = await thumbnail(state.items[i]); if (i % 5 === 4) await new Promise(resolve => setTimeout(resolve, 0)); } renderItems(); }

  async function downsample(blob) {
    const opened = await M.open(blob); const maxEdge = Math.max(900, Math.max(state.template.avatarBox.width, state.template.avatarBox.height) * 2); const scale = Math.min(1, maxEdge / Math.max(opened.image.naturalWidth, opened.image.naturalHeight));
    if (scale >= 1) { opened.release(); return blob; }
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(opened.image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(opened.image.naturalHeight * scale)); canvas.getContext("2d").drawImage(opened.image, 0, 0, canvas.width, canvas.height); opened.release(); const mime = /jpe?g/i.test(blob.type || "") ? "image/jpeg" : "image/png"; return U.canvasToBlob(canvas, mime);
  }
  async function readAvatar(blob) { return downsample(blob); }

  function xmlDoc(buffer) { return new DOMParser().parseFromString(new TextDecoder().decode(buffer), "application/xml"); }
  function localNodes(doc, name) { return Array.from(doc.getElementsByTagNameNS("*", name)); }
  function cellRef(cell) { const match = (cell.getAttribute("r") || "").match(/^([A-Z]+)(\d+)$/i); if (!match) return null; let col = 0; for (const ch of match[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64; return { row: Number(match[2]), col: col - 1 }; }
  function parseSharedStrings(doc) { return localNodes(doc, "si").map(si => Array.from(si.getElementsByTagNameNS("*", "t")).map(t => t.textContent).join("")); }
  function cellValue(cell, shared) { const type = cell.getAttribute("t"); const v = localNodes(cell, "v")[0]; if (type === "inlineStr") return Array.from(cell.getElementsByTagNameNS("*", "t")).map(t => t.textContent).join(""); if (!v) return ""; if (type === "s") return shared[Number(v.textContent)] || ""; return v.textContent || ""; }
  function zipPath(basePath, target) {
    if (!target) return "";
    const parts = (target.charAt(0) === "/" ? target.slice(1) : basePath.slice(0, basePath.lastIndexOf("/") + 1) + target).split("/");
    const output = [];
    parts.forEach(part => { if (!part || part === ".") return; if (part === "..") output.pop(); else output.push(part); });
    return output.join("/");
  }
  function relationships(doc, sourcePath) { const map = new Map(); localNodes(doc, "Relationship").forEach(node => map.set(node.getAttribute("Id"), zipPath(sourcePath, node.getAttribute("Target") || ""))); return map; }
  function rowImages(drawingDoc, relDoc, drawingPath, media) {
    if (!drawingDoc || !relDoc) return new Map(); const rel = relationships(relDoc, drawingPath); const output = new Map(); localNodes(drawingDoc, "twoCellAnchor").concat(localNodes(drawingDoc, "oneCellAnchor")).forEach(anchor => { const from = localNodes(anchor, "from")[0]; const row = from && localNodes(from, "row")[0]; const blip = localNodes(anchor, "blip")[0]; const rid = blip && (blip.getAttribute("r:embed") || blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed")); const target = rid && rel.get(rid); if (!row || !target) return; const file = media.get(target); if (file) output.set(Number(row.textContent) + 1, { file, path: target }); }); return output;
  }
  async function parseXlsx(file, includeImages) {
    const JSZip = await M.ensureZip(); const zip = await JSZip.loadAsync(file); const files = zip.files; const read = async path => files[path] ? files[path].async("arraybuffer") : null; const sharedDoc = await read("xl/sharedStrings.xml"); const shared = sharedDoc ? parseSharedStrings(xmlDoc(sharedDoc)) : [];
    const sheetPath = "xl/worksheets/sheet1.xml"; const sheetBuffer = await read(sheetPath); if (!sheetBuffer) throw new Error("XLSX_SHEET_MISSING"); const sheet = xmlDoc(sheetBuffer); const rows = new Map(); localNodes(sheet, "row").forEach(row => { const cells = {}; localNodes(row, "c").forEach(cell => { const ref = cellRef(cell); if (ref) cells[ref.col] = cellValue(cell, shared); }); const rowNumber = Number(row.getAttribute("r")); if (rowNumber) rows.set(rowNumber, cells); });
    const media = new Map(); Object.keys(files).filter(path => /^xl\/media\//i.test(path)).forEach(path => media.set(path, files[path])); let rowToImage = new Map(); if (includeImages) { const sheetRelPath = "xl/worksheets/_rels/sheet1.xml.rels"; const relBuffer = await read(sheetRelPath); if (relBuffer) { const sheetRel = relationships(xmlDoc(relBuffer), sheetPath); const drawingNode = localNodes(sheet, "drawing")[0]; const drawingRid = drawingNode && (drawingNode.getAttribute("r:id") || drawingNode.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")); const drawingPath = drawingRid && sheetRel.get(drawingRid); if (drawingPath) { const drawingBuffer = await read(drawingPath); const drawingRelPath = drawingPath.slice(0, drawingPath.lastIndexOf("/") + 1) + "_rels/" + drawingPath.slice(drawingPath.lastIndexOf("/") + 1) + ".rels"; const drawingRelBuffer = await read(drawingRelPath); if (drawingBuffer && drawingRelBuffer) rowToImage = rowImages(xmlDoc(drawingBuffer), xmlDoc(drawingRelBuffer), drawingPath, media); } } }
    const records = []; for (const [rowNumber, cells] of rows) { if (rowNumber === 1 && /姓名|name/i.test(cells[0] || "")) continue; const name = normalizeName(cells[0]); const fileName = normalizeName(cells[1] || ""); const remark = String(cells[2] || "").trim(); if (!name && !fileName && !remark) continue; let avatar = null; if (includeImages && rowToImage.has(rowNumber)) { const image = rowToImage.get(rowNumber); if (/\.(?:emf|wmf)$/i.test(image.path)) throw new Error("XLSX_VECTOR_IMAGE"); avatar = await readAvatar(new Blob([await image.file.async("arraybuffer")], { type: imageMime(image.path) })); } records.push({ rowNumber, name, fileName, remark, avatar }); }
    if (!records.length) throw new Error("XLSX_EMPTY"); return records;
  }

  function nameFromFilename(fileName, separator, side) {
    const base = normalizeName(String(fileName || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, ""));
    if (!separator) return base;
    const idx = base.indexOf(separator);
    if (idx < 0) return base;
    return side === "after" ? base.slice(idx + separator.length) : base.slice(0, idx);
  }
  async function importRecords() {
    if (!state.template.backgroundImage) { setStatus(els.importStatus, "请先设置背景图。"); return; }
    const isFoldername = state.mode === "foldername";
    if (!isFoldername && !els.xlsxInput.files[0]) { setStatus(els.importStatus, "请先选择 XLSX 表格。"); return; }
    if (isFoldername && !state.folderFiles.length) { setStatus(els.importStatus, "请先选择头像文件夹。"); return; }
    if (state.items.length && !window.confirm("重新导入将清空当前已生成的 " + state.items.length + " 条证件记录（包括已单独调整过的头像位置、裁剪和姓名设置），确定要继续吗？")) return;
    els.importBtn.disabled = true; setStatus(els.importStatus, isFoldername ? "正在按文件名生成姓名..." : "正在读取表格...");
    try {
      let records; let unused = 0;
      if (isFoldername) {
        const separator = els.filenameSeparator.value;
        const side = els.separatorSide.value;
        const files = state.folderFiles.filter(file => M.isImageFile(file)).sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
        if (!files.length) { els.importBtn.disabled = false; setStatus(els.importStatus, "文件夹里没有可用的图片文件。"); return; }
        records = files.map(file => ({ name: nameFromFilename(file.name, separator, side), fileName: "", remark: "", avatar: null, file }));
      } else {
        records = await parseXlsx(els.xlsxInput.files[0], state.mode === "embedded");
      }
      const matched = new Set(); const folderMap = new Map();
      if (state.mode !== "embedded") { state.folderFiles.forEach(file => { if (M.isImageFile(file)) folderMap.set(extless(file.name), file); }); }
      const nextItems = []; let failedAvatars = 0;
      for (const record of records) {
        let avatar = record.avatar; let ok = Boolean(avatar);
        try {
          if (state.mode === "folder") { const matchKey = record.fileName ? extless(record.fileName) : normalizeName(record.name); const file = matchKey ? folderMap.get(matchKey) : null; if (file) { avatar = await readAvatar(file); matched.add(file); ok = true; } else ok = false; }
          else if (state.mode === "foldername") { if (record.file) { avatar = await readAvatar(record.file); matched.add(record.file); ok = true; } }
        } catch (error) { avatar = null; ok = false; failedAvatars += 1; }
        const item = { id: id(), name: record.name || record.fileName || (record.file ? extless(record.file.name) : "未命名"), remark: record.remark, avatarSource: avatar, avatarOverride: null, nameOverride: null, matched: ok, status: ok ? "ready" : "missing-avatar" };
        try { item.thumbnail = await thumbnail(item); } catch (error) { item.thumbnail = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="; }
        nextItems.push(item);
      }
      if (state.mode === "folder") unused = state.folderFiles.filter(file => M.isImageFile(file) && !matched.has(file)).length;
      const missingCount = nextItems.filter(item => item.status === "missing-avatar").length;
      let importMsg = "已导入 " + nextItems.length + " 条记录";
      if (unused) importMsg += "，有 " + unused + " 个头像文件未被使用";
      if (missingCount) importMsg += "，有 " + missingCount + " 条缺少头像（已标记）";
      if (failedAvatars) importMsg += "，其中 " + failedAvatars + " 张图片读取失败";
      importMsg += "。";
      state.items = nextItems; renderItems(); els.importBtn.disabled = false; setStatus(els.importStatus, importMsg);
    } catch (error) {
      els.importBtn.disabled = false; const message = error.message === "XLSX_VECTOR_IMAGE" || error.message === "XLSX_SHEET_MISSING" ? "该表格暂不支持自动提取头像，请改用“表格 + 文件夹匹配”模式。" : error.message === "XLSX_EMPTY" ? "表格中没有可导入的记录。" : "表格解析失败，请检查文件或改用“表格 + 文件夹匹配”模式。"; setStatus(els.importStatus, message);
    }
  }

  function alignBox(box, axis) {
    if (axis === "centerX") box.x = (state.template.backgroundWidth - box.width) / 2;
    if (axis === "centerY") box.y = (state.template.backgroundHeight - box.height) / 2;
    return constrainBox(box, Number(box.cropAspectRatio) > 0 ? Number(box.cropAspectRatio) : 0);
  }
  function applyAlignment(target, axis, editorMode) {
    selectZone(target);
    if (editorMode) {
      const item = currentItem();
      if (!item) return;
      const box = target === "avatar" ? editorBox(item) : editorName(item);
      alignBox(box, axis);
      const key = target === "avatar" ? "avatarOverride" : "nameOverride";
      item[key] = Object.assign({}, item[key] || {}, box);
      updateEditorZones();
      updateEditorPreview();
      thumbnail(item).then(data => { item.thumbnail = data; renderItems(); });
      return;
    }
    const box = target === "avatar" ? state.template.avatarBox : state.template.nameBlock;
    alignBox(box, axis);
    updateTemplateInputs();
  }
  function startDrag(zone, getBox, onChange, stage, target) { let moving = null; zone.addEventListener("pointerdown", event => { selectZone(target || (zone.classList.contains("zone-name") ? "name" : "avatar")); if (event.target.classList.contains("resize-handle")) return; event.preventDefault(); zone.setPointerCapture(event.pointerId); const metrics = stageMetrics(stage); const box = getBox(); if (!metrics || !box) return; moving = { startX: event.clientX, startY: event.clientY, x: box.x, y: box.y, scaleX: 1 / metrics.scaleX, scaleY: 1 / metrics.scaleY }; const move = e => { if (!moving) return; const next = Object.assign({}, getBox()); next.x = Math.max(0, Math.round(moving.x + (e.clientX - moving.startX) * moving.scaleX)); next.y = Math.max(0, Math.round(moving.y + (e.clientY - moving.startY) * moving.scaleY)); constrainBox(next, Number(next.cropAspectRatio) > 0 ? Number(next.cropAspectRatio) : 0); onChange(next); }; const end = () => { moving = null; zone.releasePointerCapture(event.pointerId); zone.removeEventListener("pointermove", move); zone.removeEventListener("pointerup", end); }; zone.addEventListener("pointermove", move); zone.addEventListener("pointerup", end); }); zone.querySelector(".resize-handle").addEventListener("pointerdown", event => { event.stopPropagation(); event.preventDefault(); zone.setPointerCapture(event.pointerId); const metrics = stageMetrics(stage); const box = getBox(); const start = { x: event.clientX, y: event.clientY, w: box.width, h: box.height, scaleX: 1 / metrics.scaleX, scaleY: 1 / metrics.scaleY }; const move = e => { const next = Object.assign({}, getBox()); const ratio = Number(next.cropAspectRatio) > 0 ? Number(next.cropAspectRatio) : 0; next.width = Math.max(20, Math.round(start.w + (e.clientX - start.x) * start.scaleX)); next.height = ratio > 0 ? Math.max(20, Math.round(next.width / ratio)) : Math.max(20, Math.round(start.h + (e.clientY - start.y) * start.scaleY)); constrainBox(next, ratio); onChange(next); }; const end = () => { zone.releasePointerCapture(event.pointerId); zone.removeEventListener("pointermove", move); zone.removeEventListener("pointerup", end); }; zone.addEventListener("pointermove", move); zone.addEventListener("pointerup", end); }); }
  function connectTemplateZones() { startDrag(els.templateAvatarZone, () => state.template.avatarBox, next => { state.template.avatarBox = next; updateTemplateInputs(); }, els.templateStage); startDrag(els.templateNameZone, () => state.template.nameBlock, next => { state.template.nameBlock = next; updateTemplateInputs(); }, els.templateStage); }

  function currentItem() { return state.items.find(item => item.id === state.currentId); }
  function editorBox(item) { return mergedBox(item); }
  function editorName(item) { return mergedName(item); }
  function updateEditorZones() { const item = currentItem(); if (!item || !state.template.backgroundImage) return; const n = editorName(item); els.editorNameZone.classList.toggle("active", Boolean(n.enabled)); syncZone(els.editorAvatarZone, editorBox(item), els.editorStage); syncZone(els.editorNameZone, n, els.editorStage); }
  function updateEditorInputs() { const item = currentItem(); if (!item) return; const a = editorBox(item); const n = editorName(item); const fonts = n.fontFamilies || {}; els.editorTitle.textContent = "编辑：" + (item.name || "未命名"); els.editorNameInput.value = item.name; els.editorRemarkInput.value = item.remark; els.editorAvatarAspect.value = String(a.cropAspectRatio || 0); els.editorAvatarRadius.value = a.borderRadius; els.editorAvatarBorder.value = a.borderWidth; els.editorAvatarBorderColor.value = a.borderColor || "#ffffff"; els.editorAvatarBaseEnabled.checked = Boolean(a.baseEnabled); els.editorAvatarBaseColor.value = a.baseColor || "#ffffff"; els.editorAvatarOutlineWidth.value = a.outlineWidth || 0; els.editorAvatarOutlineGap.value = a.outlineGap || 0; els.editorAvatarOutlineColor.value = a.outlineColor || "#000000"; els.editorFontFamily.value = n.cssFontFamily || "Noto Sans SC"; els.editorFontFamilyZh.value = fonts.zh || "Noto Sans SC"; els.editorFontFamilyEn.value = fonts.en || "Noto Sans"; els.editorFontFamilyJa.value = fonts.ja || "Noto Sans JP"; els.editorFontSize.value = n.fontSize; els.editorNameColor.value = n.color; els.editorNameAlign.value = n.align; els.editorNameVertical.value = n.verticalAlign; els.cropEditorBtn.disabled = !item.avatarSource; els.removeEditorAvatarBtn.disabled = !item.avatarSource; els.editorAvatarStatus.innerHTML = item.avatarSource ? "<strong>有头像</strong><span>头像已绑定到画布头像框；拖动或缩放头像框即可调整头像位置和大小。</span>" : "<strong>无头像</strong><span>当前证件不会绘制头像；补传后头像会绑定到画布头像框。</span>"; updateEditorZones(); }
  async function updateEditorPreview() { const item = currentItem(); if (!item) return; const canvas = await renderItem(item, Math.min(1, 760 / state.template.backgroundWidth)); els.editorImage.src = canvas.toDataURL("image/png"); }
  async function openEditor(item) { state.currentId = item.id; els.listView.hidden = true; els.editorView.hidden = false; updateEditorInputs(); await new Promise(resolve => requestAnimationFrame(resolve)); updateEditorZones(); await updateEditorPreview(); }
  function closeEditor() { state.currentId = null; els.editorView.hidden = true; els.listView.hidden = false; }
  function applyEditorInputs() { const item = currentItem(); if (!item) return; const n = mergedName(item); const fontSizeValue = String(els.editorFontSize.value || "").trim(); item.name = els.editorNameInput.value; item.remark = els.editorRemarkInput.value; item.nameOverride = Object.assign({}, item.nameOverride || {}, { cssFontFamily: els.editorFontFamilyZh.value, fontId: els.editorFontFamilyZh.value, fontFamilies: { zh: els.editorFontFamilyZh.value, en: els.editorFontFamilyEn.value, ja: els.editorFontFamilyJa.value }, fontSize: fontSizeValue && Number(fontSizeValue) > 0 ? Math.max(8, Number(fontSizeValue)) : "", color: els.editorNameColor.value, align: els.editorNameAlign.value, verticalAlign: els.editorNameVertical.value }); updateEditorInputs(); thumbnail(item).then(data => { item.thumbnail = data; renderItems(); }); updateEditorPreview(); }
  function applyEditorAvatarInputs() { const item = currentItem(); if (!item) return; const a = editorBox(item); a.cropAspectRatio = number(els.editorAvatarAspect.value, a.cropAspectRatio); a.borderRadius = Math.max(0, number(els.editorAvatarRadius.value, a.borderRadius)); a.borderWidth = Math.max(0, number(els.editorAvatarBorder.value, a.borderWidth)); a.borderColor = els.editorAvatarBorderColor.value || "#ffffff"; a.baseEnabled = els.editorAvatarBaseEnabled.checked; a.baseColor = els.editorAvatarBaseColor.value || "#ffffff"; a.outlineWidth = Math.max(0, number(els.editorAvatarOutlineWidth.value, a.outlineWidth || 0)); a.outlineGap = Math.max(0, number(els.editorAvatarOutlineGap.value, a.outlineGap || 0)); a.outlineColor = els.editorAvatarOutlineColor.value || "#000000"; item.avatarOverride = constrainBox(Object.assign({}, item.avatarOverride || {}, a), a.cropAspectRatio); updateEditorZones(); updateEditorPreview(); thumbnail(item).then(data => { item.thumbnail = data; renderItems(); }); }
  async function refreshCurrentAndItems() { const item = currentItem(); if (item) item.thumbnail = await thumbnail(item); await refreshThumbnails(); }
  function resetItem() { const item = currentItem(); if (!item) return; item.avatarOverride = null; item.nameOverride = null; updateEditorInputs(); refreshCurrentAndItems(); }
  function setGlobal() { const item = currentItem(); if (!item) return; state.template.avatarBox = Object.assign({}, state.template.avatarBox, item.avatarOverride || {}); state.template.nameBlock = Object.assign({}, state.template.nameBlock, item.nameOverride || {}); item.avatarOverride = null; item.nameOverride = null; updateTemplateInputs(); updateEditorInputs(); refreshCurrentAndItems(); setStatus(els.editorStatus, "已设为新的全局默认；当前条目已恢复跟随全局默认，其他条目会按新的默认重新生成预览。"); }

  function templateConfigSnapshot() {
    return {
      version: 1,
      backgroundWidth: state.template.backgroundWidth,
      backgroundHeight: state.template.backgroundHeight,
      avatarBox: clone(state.template.avatarBox),
      nameBlock: clone(state.template.nameBlock),
      filenamePrefix: els.filenamePrefix.value || ""
    };
  }
  function downloadTemplateConfig() {
    const blob = new Blob([JSON.stringify(templateConfigSnapshot(), null, 2)], { type: "application/json" });
    U.downloadBlob(blob, "证件模板配置.json");
    setStatus(els.importStatus, "已下载模板配置，下次可通过「导入配置」恢复布局与外观。");
  }
  async function importTemplateConfig(file) {
    if (!file) return;
    try {
      const cfg = JSON.parse(await file.text());
      if (!cfg || typeof cfg !== "object") throw new Error("bad");
      const hasBg = Boolean(state.template.backgroundImage);
      const savedW = number(cfg.backgroundWidth, 0); const savedH = number(cfg.backgroundHeight, 0);
      const curW = state.template.backgroundWidth; const curH = state.template.backgroundHeight;
      if (!hasBg && savedW && savedH) { state.template.backgroundWidth = savedW; state.template.backgroundHeight = savedH; }
      const scaleX = (hasBg && savedW && curW && curW !== savedW) ? curW / savedW : 1;
      const scaleY = (hasBg && savedH && curH && curH !== savedH) ? curH / savedH : 1;
      if (cfg.avatarBox && typeof cfg.avatarBox === "object") {
        const box = Object.assign({}, cfg.avatarBox);
        if (scaleX !== 1 || scaleY !== 1) { box.x = Math.round(box.x * scaleX); box.y = Math.round(box.y * scaleY); box.width = Math.round(box.width * scaleX); box.height = Math.round(box.height * scaleY); }
        const ratio = number(box.cropAspectRatio, state.template.avatarBox.cropAspectRatio);
        state.template.avatarBox = constrainBox(Object.assign({}, state.template.avatarBox, box), ratio > 0 ? ratio : 0);
      }
      if (cfg.nameBlock && typeof cfg.nameBlock === "object") {
        const block = Object.assign({}, cfg.nameBlock);
        if (scaleX !== 1 || scaleY !== 1) { block.x = Math.round(block.x * scaleX); block.y = Math.round(block.y * scaleY); block.width = Math.round(block.width * scaleX); block.height = Math.round(block.height * scaleY); }
        state.template.nameBlock = constrainBox(Object.assign({}, state.template.nameBlock, block), 0);
      }
      if (cfg.filenamePrefix != null) els.filenamePrefix.value = String(cfg.filenamePrefix);
      state.layoutImported = !hasBg;
      updateTemplateInputs();
      if (state.items.length) refreshThumbnails();
      const migrated = hasBg && savedW && savedH && (savedW !== curW || savedH !== curH);
      setStatus(els.importStatus, "已导入模板配置。" + (migrated ? " 画布尺寸与当前背景不同，头像/姓名框已按比例迁移。" : ""));
    } catch (error) {
      setStatus(els.importStatus, "模板配置导入失败：请确认是之前「保存配置」导出的 JSON 文件。");
    }
  }

  async function cropFile(file, target) {
    const opened = await M.open(file);
    els.cropImage.src = opened.src;
    els.cropDialog.hidden = false;
    state.cropTarget = { target, opened };
    const ratio = target === "template" ? state.template.avatarBox.cropAspectRatio || NaN : editorBox(currentItem()).cropAspectRatio || NaN;
    const initialData = topAlignedCropData(opened.image, ratio);
    try {
      await M.ensureCropper();
      state.cropper = new window.Cropper(els.cropImage, {
        viewMode: 1,
        autoCropArea: 1,
        aspectRatio: ratio,
        ready() {
          if (initialData) {
            try { this.setData({ x: initialData.x, y: initialData.y, width: initialData.width, height: initialData.height }); } catch (e) { /* 顶部对齐设置失败时保持默认铺满 */ }
          }
        }
      });
    } catch (error) { state.cropper = null; setStatus(els.editorStatus, "裁剪组件加载失败，将使用居中裁剪。"); }
  }
  async function saveCrop() { if (!state.cropTarget) return; const { target, opened } = state.cropTarget; let blob; if (state.cropper) { const mime = /jpe?g/i.test((opened.blob && opened.blob.type) || "") ? "image/jpeg" : "image/png"; const cropped = state.cropper.getCroppedCanvas({ maxWidth: 1200, maxHeight: 1200 }); blob = await new Promise(resolve => cropped.toBlob(resolve, mime, mime === "image/jpeg" ? .9 : undefined)); } else blob = await readAvatar(opened.blob); opened.release(); if (target === "template") { state.template.sampleAvatar = await readAvatar(blob); updateSampleAvatarButtons(); updateTemplatePreview(); } else { const item = currentItem(); item.avatarSource = await readAvatar(blob); item.matched = true; item.status = "ready"; item.thumbnail = await thumbnail(item); renderItems(); updateEditorInputs(); await updateEditorPreview(); } if (state.cropper) state.cropper.destroy(); state.cropper = null; state.cropTarget = null; els.cropDialog.hidden = true; }

  async function exportOne(item) { const canvas = await renderItem(item, 1); return U.canvasToBlob(canvas, "image/png"); }
  async function exportAll() { if (!state.items.length) return; els.exportBtn.disabled = true; els.exportProgress.style.width = "0%"; const files = []; const failed = []; const used = new Map(); for (let i = 0; i < state.items.length; i += 1) { const item = state.items[i]; setStatus(els.exportStatus, "正在生成 " + (i + 1) + "/" + state.items.length + "..."); try { const name = U.sanitizeFilename((els.filenamePrefix.value || "") + (item.name || "未命名") + (item.remark ? "_" + item.remark : ""), "未命名"); files.push({ name: U.uniqueFilename(name, used), blob: await exportOne(item) }); } catch (error) { failed.push(item.name || "未命名（第 " + (i + 1) + " 条）"); } els.exportProgress.style.width = Math.round((i + 1) / state.items.length * 100) + "%"; await new Promise(resolve => setTimeout(resolve, 0)); }
    if (files.length) { try { await U.exportZip(files, "证件批量导出.zip"); setStatus(els.exportStatus, "成功导出 " + files.length + " 条" + (failed.length ? "，" + failed.length + " 条失败：" + failed.join("、") : "，已下载 ZIP。")); } catch (error) { setStatus(els.exportStatus, "ZIP 打包失败：" + errorText(error)); } } else setStatus(els.exportStatus, "没有可导出的证件。失败 " + failed.length + " 条：" + failed.join("、"));
    els.exportBtn.disabled = false; }
  async function downloadCurrent() { const item = currentItem(); if (!item) return; applyEditorInputs(); setStatus(els.editorStatus, "正在生成当前证件..."); try { const blob = await exportOne(item); const name = U.sanitizeFilename((els.filenamePrefix.value || "") + (item.name || "未命名") + (item.remark ? "_" + item.remark : ""), "未命名") + ".png"; U.downloadBlob(blob, name); setStatus(els.editorStatus, "已下载当前证件。"); } catch (error) { setStatus(els.editorStatus, "下载失败：" + errorText(error)); } }

  els.backgroundInput.addEventListener("change", async () => { const file = els.backgroundInput.files[0]; if (!file) return; if (state.template.backgroundImage && !window.confirm("更换背景后，已导入证件中单独调整过的头像/姓名位置会按新旧画布比例自动迁移。仍建议逐条检查，确定要继续吗？")) { els.backgroundInput.value = ""; return; } try { setBackground(await M.open(file)); } catch (error) { setStatus(els.importStatus, errorText(error)); } });
  els.clearBackgroundBtn.addEventListener("click", () => { if (!state.template.backgroundImage) return; if ((state.items.length || state.template.backgroundImage) && !window.confirm("清除背景后，已导入的证件记录里单独调整过的头像/姓名位置可能因后续背景变化而错位，建议清除后重新检查每条记录。确定要继续吗？")) return; state.template.backgroundImage.release(); state.template.backgroundImage = null; state.template.sampleAvatar = null; updateSampleAvatarButtons(); els.templateStage.classList.remove("has-background"); els.editorStage.classList.remove("has-background"); els.templateImage.hidden = true; els.templateEmpty.hidden = false; updateTemplateZones(); updateStepIndicator(); });
  els.sampleAvatarInput.addEventListener("change", () => { const file = els.sampleAvatarInput.files[0]; if (file) cropFile(file, "template"); });
  els.cropSampleBtn.addEventListener("click", () => { if (state.template.sampleAvatar) cropFile(state.template.sampleAvatar, "template"); });
  els.removeSampleAvatarBtn.addEventListener("click", () => { state.template.sampleAvatar = null; updateSampleAvatarButtons(); updateTemplatePreview(); setStatus(els.editorStatus, "已移除示例头像。"); });
  [els.avatarRadius, els.avatarBorder, els.avatarBorderColor, els.avatarBaseEnabled, els.avatarBaseColor, els.avatarOutlineWidth, els.avatarOutlineGap, els.avatarOutlineColor, els.avatarAspect, els.nameEnabled, els.fontFamilyZh, els.fontFamilyEn, els.fontFamilyJa, els.fontSize, els.nameColor, els.nameAlign, els.nameVertical, els.letterSpacing].forEach(el => el.addEventListener("input", readTemplateInputs));
  els.avatarAspect.addEventListener("change", readTemplateInputs);
    const CUSTOM_FONT_SELECTS = { zh: els.fontFamilyZh, en: els.fontFamilyEn, ja: els.fontFamilyJa };
    const CUSTOM_FONT_EDITOR_SELECTS = { zh: els.editorFontFamilyZh, en: els.editorFontFamilyEn, ja: els.editorFontFamilyJa };
    const CUSTOM_FONT_DEFAULTS = { zh: "Noto Sans SC", en: "Noto Sans", ja: "Noto Sans JP" };
    const CUSTOM_FONT_LABELS = { zh: "中文", en: "英文", ja: "日文" };
    async function registerFont(file, language) {
      if (!file) return;
      const family = "OnlyCustom_" + language + "_" + id();
      try {
        const face = new FontFace(family, "url(" + URL.createObjectURL(file) + ")");
        await face.load();
        document.fonts.add(face);
        state.customFonts.set(family, { id: family, language, fileName: file.name, fileBlob: file });
        const option = document.createElement("option");
        option.value = family;
        option.textContent = file.name + "（自定义）";
        // 同步到全部六个下拉（模板 中/英/日 + 编辑器 中/英/日），保证单字体可被任意语言类型复用
        Object.values(CUSTOM_FONT_SELECTS).concat(Object.values(CUSTOM_FONT_EDITOR_SELECTS)).forEach(sel => {
          if (!Array.from(sel.options).some(o => o.value === family)) sel.appendChild(option.cloneNode(true));
        });
        applyCustomFontSelection();
        setStatus(els.fontStatus, "已注册" + CUSTOM_FONT_LABELS[language] + "字体：" + file.name + "。");
      } catch (error) {
        setStatus(els.fontStatus, "字体加载失败，请确认文件为 ttf、otf、woff 或 woff2。");
      }
    }
    /* 上传字体后的自动分配：仅上传一个字体时三套语言共用它；上传多个字体时各语言用各自上传的字体，未上传的回到默认。 */
    function applyCustomFontSelection() {
      const customByLang = { zh: null, en: null, ja: null };
      state.customFonts.forEach((info, family) => { if (info && info.language && customByLang.hasOwnProperty(info.language)) customByLang[info.language] = family; });
      const uploaded = Object.values(customByLang).filter(Boolean);
      const single = uploaded.length === 1 ? uploaded[0] : null;
      Object.keys(CUSTOM_FONT_SELECTS).forEach(lang => {
        const family = single || customByLang[lang] || CUSTOM_FONT_DEFAULTS[lang];
        CUSTOM_FONT_SELECTS[lang].value = family;
        CUSTOM_FONT_EDITOR_SELECTS[lang].value = family;
      });
      readTemplateInputs();
    }
  [[els.fontInputZh, "zh"], [els.fontInputEn, "en"], [els.fontInputJa, "ja"]].forEach(([input, language]) => input.addEventListener("change", () => registerFont(input.files[0], language)));
  document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => { state.mode = button.dataset.mode; document.querySelectorAll("[data-mode]").forEach(other => { other.classList.toggle("active", other === button); other.setAttribute("aria-selected", other === button ? "true" : "false"); }); const isFolder = state.mode === "folder"; const isEmbedded = state.mode === "embedded"; const isFoldername = state.mode === "foldername"; els.xlsxField.hidden = isFoldername; els.folderField.hidden = !(isFolder || isFoldername); els.embeddedField.hidden = !isEmbedded; els.foldernameField.hidden = !isFoldername; els.modeDescription.textContent = isFolder ? "上传姓名第一列、文件名第二列、备注第三列的 xlsx，再选择头像文件夹，优先按文件名去扩展名匹配，无文件名时用姓名匹配。" : isEmbedded ? "上传第二列带内嵌头像的 xlsx。程序会尽力读取标准图片锚点；解析失败时请改用文件夹匹配。" : "无需表格：直接选择头像文件夹（含子文件夹），按文件名去扩展名生成姓名，可设置分隔符取前/后段。"; }));
  els.folderInput.addEventListener("change", () => { state.folderFiles = Array.from(els.folderInput.files || []); els.folderStatus.textContent = "已选择 " + state.folderFiles.length + " 个文件。"; });
  els.xlsxInput.addEventListener("change", () => { els.xlsxStatus.textContent = els.xlsxInput.files[0] ? "已选择：" + els.xlsxInput.files[0].name : "尚未选择表格。"; });
  els.importBtn.addEventListener("click", importRecords); els.exportBtn.addEventListener("click", exportAll);
  els.saveTemplateBtn.addEventListener("click", downloadTemplateConfig); els.loadTemplateInput.addEventListener("change", () => { importTemplateConfig(els.loadTemplateInput.files[0]); els.loadTemplateInput.value = ""; });
  els.itemsGrid.addEventListener("click", async event => { const card = event.target.closest(".item-card"); if (!card) return; const item = state.items.find(entry => entry.id === card.dataset.id); if (!item) return; if (event.target.closest(".quick-avatar")) return; if (event.target.closest(".card-edit") || event.target.closest(".card-open")) await openEditor(item); });
  els.itemsGrid.addEventListener("change", async event => { if (!event.target.classList.contains("quick-avatar")) return; const card = event.target.closest(".item-card"); const item = state.items.find(entry => entry.id === card.dataset.id); const file = event.target.files[0]; if (!item || !file) return; try { item.avatarSource = await readAvatar(file); item.matched = true; item.status = "ready"; item.thumbnail = await thumbnail(item); renderItems(); } catch (error) { setStatus(els.importStatus, errorText(error)); } });
    els.backToListBtn.addEventListener("click", () => { applyEditorInputs(); closeEditor(); }); els.editorNameInput.addEventListener("input", applyEditorInputs); els.editorRemarkInput.addEventListener("input", applyEditorInputs); [els.editorFontFamilyZh, els.editorFontFamilyEn, els.editorFontFamilyJa, els.editorFontSize, els.editorNameColor, els.editorNameAlign, els.editorNameVertical].forEach(el => el.addEventListener("input", applyEditorInputs)); [els.editorAvatarAspect, els.editorAvatarRadius, els.editorAvatarBorder, els.editorAvatarBorderColor, els.editorAvatarBaseEnabled, els.editorAvatarBaseColor, els.editorAvatarOutlineWidth, els.editorAvatarOutlineGap, els.editorAvatarOutlineColor].forEach(el => el.addEventListener("input", applyEditorAvatarInputs)); els.editorAvatarAspect.addEventListener("change", applyEditorAvatarInputs);
  els.resetItemBtn.addEventListener("click", resetItem); els.setGlobalBtn.addEventListener("click", setGlobal); els.downloadCurrentBtn.addEventListener("click", downloadCurrent);
  els.editorAvatarInput.addEventListener("change", async () => { const file = els.editorAvatarInput.files[0]; if (!file || !currentItem()) return; try { currentItem().avatarSource = await readAvatar(file); currentItem().matched = true; currentItem().status = "ready"; updateEditorInputs(); await updateEditorPreview(); renderItems(); } catch (error) { setStatus(els.editorStatus, errorText(error)); } });
  els.removeEditorAvatarBtn.addEventListener("click", async () => { const item = currentItem(); if (!item) return; item.avatarSource = null; item.matched = false; item.status = "missing-avatar"; updateEditorInputs(); await updateEditorPreview(); renderItems(); setStatus(els.editorStatus, "已设为无头像。头像框仍保留在画布上，之后可随时补传。"); });
  els.cropEditorBtn.addEventListener("click", () => { const item = currentItem(); if (item && item.avatarSource) cropFile(item.avatarSource, "editor"); }); els.cancelCropBtn.addEventListener("click", () => { if (state.cropTarget && state.cropTarget.opened) state.cropTarget.opened.release(); if (state.cropper) state.cropper.destroy(); state.cropper = null; state.cropTarget = null; els.cropDialog.hidden = true; }); els.saveCropBtn.addEventListener("click", saveCrop);
  document.querySelectorAll(".align-button").forEach(button => button.addEventListener("click", () => { const editorMode = !els.editorView.hidden; applyAlignment(button.dataset.alignTarget, button.dataset.alignAxis, editorMode); }));
  [els.templateAvatarZone, els.templateNameZone, els.editorAvatarZone, els.editorNameZone].forEach(zone => zone.addEventListener("click", () => selectZone(zone.classList.contains("zone-name") ? "name" : "avatar")));
  startDrag(els.templateAvatarZone, () => state.template.avatarBox, next => { state.template.avatarBox = next; updateTemplateInputs(); }, els.templateStage, "avatar"); startDrag(els.templateNameZone, () => state.template.nameBlock, next => { state.template.nameBlock = next; updateTemplateInputs(); }, els.templateStage, "name");
  startDrag(els.editorAvatarZone, () => editorBox(currentItem()), next => { const item = currentItem(); item.avatarOverride = Object.assign({}, item.avatarOverride || {}, next); updateEditorZones(); updateEditorPreview(); }, els.editorStage, "avatar"); startDrag(els.editorNameZone, () => editorName(currentItem()), next => { const item = currentItem(); item.nameOverride = Object.assign({}, item.nameOverride || {}, next); updateEditorZones(); updateEditorPreview(); }, els.editorStage, "name");
  // 滚轮缩放钩子：由 badge-wizard.js 的画布 wheel 事件调用；行为与拖拽/缩放手势一致
  window.__badgeWheelScale = function (mode, target, factor, relX, relY) {
    const keepRatio = box => (Number(box.cropAspectRatio) > 0 ? Number(box.cropAspectRatio) : 0);
    const applyTo = (getBox, setBox, ratio) => {
      const box = getBox();
      const anchorX = box.x + box.width * relX;
      const anchorY = box.y + box.height * relY;
      const next = Object.assign({}, box, { width: Math.max(20, Math.round(box.width * factor)), height: Math.max(20, Math.round(box.height * factor)) });
      next.x = Math.round(anchorX - next.width * relX);
      next.y = Math.round(anchorY - next.height * relY);
      constrainBox(next, ratio);
      setBox(next);
    };
    if (mode === "template") {
      if (target === "avatar") applyTo(() => state.template.avatarBox, next => { state.template.avatarBox = next; updateTemplateInputs(); }, keepRatio(state.template.avatarBox));
      else applyTo(() => state.template.nameBlock, next => { state.template.nameBlock = next; updateTemplateInputs(); }, 0);
    } else {
      const item = currentItem();
      if (!item) return;
      if (target === "avatar") applyTo(() => editorBox(item), next => { item.avatarOverride = Object.assign({}, item.avatarOverride || {}, next); updateEditorZones(); updateEditorPreview(); }, keepRatio(editorBox(item)));
      else applyTo(() => editorName(item), next => { item.nameOverride = Object.assign({}, item.nameOverride || {}, next); updateEditorZones(); updateEditorPreview(); }, 0);
    }
  };
  // 在线字体就绪后的全量重绘钩子：模板预览 + 当前编辑器 + 缩略图
  window.__badgeRerenderAll = async function () {
    try {
      if (typeof scheduleTemplatePreview === "function") scheduleTemplatePreview();
      if (state.items.length) refreshThumbnails();
      if (!els.editorView.hidden) { await updateEditorPreview(); }
    } catch (e) { }
  };
  const leaveMessage = "当前证件、头像、表格和字体只在浏览器中处理，不会保存。确认要离开吗？";
  window.addEventListener("beforeunload", event => { if (!els.editorView.hidden || state.template.backgroundImage || state.items.length) { event.preventDefault(); event.returnValue = leaveMessage; return leaveMessage; } });
  document.querySelectorAll("a[href]").forEach(link => link.addEventListener("click", event => { const href = link.getAttribute("href") || ""; if (href.startsWith("#") || href.startsWith("javascript:")) return; if (!window.confirm(leaveMessage)) event.preventDefault(); }));
  window.addEventListener("resize", () => { updateTemplateZones(); updateEditorZones(); }); updateTemplateInputs();
})();

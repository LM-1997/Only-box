/* ================================================================
   tests/banner-builder-modules.test.js —— 拆分后各模块的加载契约测试

   背景：banner-builder 主脚本被拆成 utils / font / render / ui / draft /
   events / modals / legacy-export / preview 等多个子模块。拆分最容易出三类
   静默故障，本文件逐一守住：
     1) 新模块文件没被写进 tools/banner-builder.html（线上永远不加载）
     2) <script> 顺序不满足依赖方向（下层引用上层 → 加载期 undefined）
     3) 命名空间没挂载 / 对外 API 被误删（主脚本调用到不存在的函数）

   另外校验单一全局挂载点红线：加载完全部脚本后 window 上不得出现
   白名单之外的全局变量。
   ================================================================ */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const HTML_PATH = "tools/banner-builder.html";
const html = fs.readFileSync(HTML_PATH, "utf8");

/* ============ 1) HTML 脚本清单解析 ============ */

const SCRIPT_RE = /<script\s+src="([^"]+)"\s*><\/script>/g;
const srcs = [];
{
  let m;
  while ((m = SCRIPT_RE.exec(html)) !== null) srcs.push(m[1]);
}
assert.ok(srcs.length >= 20, "banner-builder.html 至少引入 20 个脚本（实测 " + srcs.length + "）");

/* 相对 HTML 定位到仓库根路径，并区分 vendor / 业务脚本 */
const scripts = srcs.map(function (raw) {
  const clean = raw.split("?")[0];
  return {
    raw: raw,
    rel: clean.replace(/^\.\.\//, ""),
    version: (raw.split("?v=")[1] || ""),
    isVendor: /^js\/vendor\//.test(clean.replace(/^\.\.\//, "")),
  };
});

scripts.forEach(function (s) {
  assert.ok(fs.existsSync(s.rel), "脚本文件存在：" + s.rel);
  assert.ok(!s.isVendor || true, "");
  /* 缓存版本号红线：所有业务脚本必须带 ?v=YYYYMMDD-NN */
  assert.match(s.version, /^\d{8}-\d{2}$/, s.rel + " 带当天缓存版本号 ?v=YYYYMMDD-NN（实测 " + s.raw + "）");
});

/* ============ 2) 孤儿模块检测：磁盘上的 banner-builder*.js 必须都被 HTML 引入 ============ */

const diskModules = fs.readdirSync("js")
  .filter(function (f) { return /^banner-builder-.*\.js$/.test(f); })
  .map(function (f) { return "js/" + f; });

const referenced = scripts.map(function (s) { return s.rel; });
diskModules.forEach(function (file) {
  assert.ok(referenced.indexOf(file) >= 0, "拆分模块 " + file + " 已被 tools/banner-builder.html 引入（漏引入等于线上不生效）");
});

/* ============ 3) 依赖方向：HTML 顺序必须是拓扑序 ============ */

/* 命名空间 → 定义它的文件（扫描赋值语句 global.Xxx = / window.Xxx =） */
const ownerOf = {};
diskModules.concat(["js/banner-builder.js"]).forEach(function (file) {
  const code = fs.readFileSync(file, "utf8");
  const re = /\b(?:global|window)\.(BannerBuilder[A-Za-z0-9_]*)\s*=/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (!ownerOf[m[1]]) ownerOf[m[1]] = file; /* 同名多处赋值时取首个定义处 */
  }
});

/* 本文件自身定义的命名空间（用于剔除自引用） */
function ownsOf(file) {
  return Object.keys(ownerOf).filter(function (ns) { return ownerOf[ns] === file; });
}

/* 加载期依赖：只看 IIFE 顶层语句（缩进恰好 2 空格）。
   函数体内（4+ 空格）的 global.Xxx 是运行时延迟调用，不构成加载期依赖，
   不应约束 <script> 顺序——否则 constants 里的 lazy importer 会被误判。 */
function depsOf(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const own = ownsOf(file);
  const out = {};
  lines.forEach(function (line) {
    if (!/^ {2}\S/.test(line)) return;
    const re = /(?:global|window)\.(BannerBuilder[A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (own.indexOf(m[1]) < 0) out[m[1]] = true;
    }
  });
  return Object.keys(out);
}

const order = {};
scripts.forEach(function (s, i) { if (!order[s.rel]) order[s.rel] = i; });

/* 主脚本 banner-builder.js 是编排层，允许引用所有下层；其余模块不得反向依赖它 */
const MAIN = "js/banner-builder.js";

scripts.filter(function (s) { return !s.isVendor && s.rel !== MAIN; }).forEach(function (s) {
  depsOf(s.rel).forEach(function (ns) {
    const owner = ownerOf[ns];
    if (!owner || owner === s.rel) return;
    if (owner === MAIN) {
      assert.fail("下层模块 " + s.rel + " 反向引用主脚本 " + ns + "（违反单向依赖，会造成循环依赖）");
    }
    if (order[owner] == null) return; /* 定义在未引入文件里，由孤儿检测覆盖 */
    assert.ok(
      order[owner] < order[s.rel],
      s.rel + " 依赖的 " + ns + " 定义在 " + owner + "，但它在 HTML 中排在后面（脚本顺序即依赖声明）"
    );
  });
});

/* 子模块之间不得成环（主脚本除外） */
{
  const graph = {};
  diskModules.forEach(function (file) {
    graph[file] = depsOf(file)
      .map(function (ns) { return ownerOf[ns]; })
      .filter(function (owner) { return owner && owner !== file && owner !== MAIN; });
  });
  const state = {};
  function visit(file, stack) {
    if (state[file] === "done") return;
    assert.notEqual(state[file], "visiting", "模块循环依赖：" + stack.concat([file]).join(" → "));
    state[file] = "visiting";
    (graph[file] || []).forEach(function (dep) { visit(dep, stack.concat([file])); });
    state[file] = "done";
  }
  Object.keys(graph).forEach(function (file) { visit(file, []); });
}

/* ============ 4) 真实加载：按 HTML 顺序跑一遍全部业务脚本 ============ */

function makeElement(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    style: { cssText: "", setProperty: function () {}, removeProperty: function () {} },
    dataset: {},
    children: [],
    textContent: "",
    innerHTML: "",
    value: "",
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    appendChild: function (c) { node.children.push(c); return c; },
    insertBefore: function (c) { node.children.push(c); return c; },
    removeChild: function () {},
    remove: function () {},
    setAttribute: function () {},
    getAttribute: function () { return null; },
    removeAttribute: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    getContext: function () { return null; },
    focus: function () {},
    click: function () {},
  };
  return node;
}

const documentStub = {
  readyState: "loading", /* loading + 空 addEventListener → 主脚本加载但不启动 UI */
  head: makeElement("head"),
  body: makeElement("body"),
  documentElement: makeElement("html"),
  createElement: makeElement,
  createElementNS: makeElement,
  createTextNode: function (t) { return { textContent: t }; },
  getElementById: function () { return null; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  removeEventListener: function () {},
  execCommand: function () { return true; },
};

const window = {};
const storage = {};
const ctx = vm.createContext({
  window: window,
  console: console,
  document: documentStub,
  navigator: { userAgent: "node", clipboard: null, maxTouchPoints: 0 },
  location: { href: "http://localhost/tools/banner-builder.html", origin: "http://localhost", protocol: "http:" },
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem: function (k, v) { storage[k] = String(v); },
    removeItem: function (k) { delete storage[k]; },
  },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  Promise: Promise,
  Date: Date,
  Math: Math,
  JSON: JSON,
  fetch: function () { return Promise.reject(new Error("offline")); },
  Blob: function () {},
  URL: { createObjectURL: function () { return "blob:stub"; }, revokeObjectURL: function () {} },
  Image: function () {},
  atob: function (s) { return Buffer.from(s, "base64").toString("binary"); },
  btoa: function (s) { return Buffer.from(s, "binary").toString("base64"); },
  alert: function () {},
  requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
});

scripts.filter(function (s) { return !s.isVendor; }).forEach(function (s) {
  vm.runInContext(fs.readFileSync(s.rel, "utf8"), ctx, { filename: s.rel });
});

/* ============ 5) 命名空间与对外 API 契约 ============ */

const API = {
  "js/banner-builder-utils.js": ["BannerBuilderUtils", [
    "safeClassSuffix", "hexToRgba", "alphaColor", "legacyCopyText", "copyTextToClipboard",
    "downloadBlob", "downloadText", "dataUrlToBlob", "wrapLines", "clearWrapCache",
    "capText", "dataUrlToBlobRecord", "formatBytes", "hexToColor",
  ]],
  "js/banner-builder-font.js": ["BannerBuilderFont", [
    "setState", "ensureFont", "showFontFallbackNotice", "readyFontForText", "readyFontsForPage",
    "preloadDefaultFont", "collectPageText", "docFontFamily", "ensureDocFonts", "psFontNameFor",
    "refreshFontSelects", "bootstrapUserFonts",
  ]],
  "js/banner-builder-render.js": ["BannerBuilderRender", [
    "setState", "setContext", "loadImage", "coverDraw", "containDraw", "coverDownDraw",
    "artImageRatio", "artImageHeight", "artTheme", "artInk", "artMuted", "artLineHeight",
    "artWeight", "artAdjustedWeight", "artTypeScale", "artSize", "artFontRaw", "artFont",
    "typeLevelKeyFor", "styleCardPad", "cardRadius", "cardRadiusDom", "cardBaseFill",
    "cardFillStyle", "roundRectPath", "chipPath", "px2", "alphaColor", "hexToRgba",
    "capText", "ratioNumber", "noisePattern", "drawPatternOverlay", "drawCardBase",
    "drawCardBorder", "drawCardDecor", "drawRich", "textBlockInfo", "paintUpText",
    "drawChips", "chipRowCount", "drawDividerShape", "drawLine", "drawGradientOverlay",
    "paintCover", "paintAnnouncement", "paintQrGridPx", "paintTicket", "paintMaterials",
    "paintCrossPromo", "paintSchedule", "paintVenue", "paintRoute", "paintProgram",
    "paintPerformer", "paintBooth", "paintDivider", "paintFooter", "paintFreeText",
    "paintFreeImage", "paintModuleBody", "paintModuleHead", "measureCardLayout",
    "measurePageLayout", "drawModuleCard", "drawModuleStack", "auditSilence", "drawPageToCanvas",
  ]],
  "js/banner-builder-ui.js": ["BannerBuilderUi", [
    "setContext", "buildField", "buildStringList", "buildObjectList", "buildImageList",
    "buildFontSelectField", "ensureSelectValue", "imageField", "openImageWithCrop",
    "cropAspectForField", "closeCropModal",
  ]],
  "js/banner-builder-events.js": ["BannerBuilderEvents", ["setState", "setContext", "bindEvents", "openModalA11y"]],
  "js/banner-builder-modals.js": ["BannerBuilderModals", [
    "setState", "setContext", "showMissingFontMapper", "showThemeImportModal",
    "showThemeTweakModal", "showBackgroundTweakModal", "showTypeTweakModal",
    "showFontImportModal", "refreshFontSelects", "rebuildThemeSelect",
  ]],
  "js/banner-builder-legacy-export.js": ["BannerBuilderLegacy", [
    "exportPng", "exportStripPng", "exportPsd", "buildPsdChildren",
    "measurePageLayout", "drawPageToCanvas", "activePage",
  ]],
  "js/banner-builder-preview.js": ["BannerBuilderPreview", ["setState", "setContext", "renderCanvas"]],
  "js/banner-builder-draft.js": ["BannerBuilderDraft", [
    "buildDraftPayload", "buildDraftCandidate", "collectFontDependencies", "restoreDraftImages",
    "dataUrlToBlobRecord", "migrateLegacyModuleType", "migrateModuleData", "assertDraftVersion",
    "assertDraftLimits", "assertNoBlobUrls", "collectDraftImageSizes",
    "validateDraftThemeDefinition", "sanitizeDraftBackground", "sanitizeThemeOverrides",
    "normalizeDraftModuleData", "migrateDraftV1ToV2", "migrateDraftV2ToV3", "migrateDraft",
    "formatBytes",
  ]],
};

Object.keys(API).forEach(function (file) {
  const nsName = API[file][0];
  const keys = API[file][1];
  const ns = window[nsName];
  assert.ok(ns && typeof ns === "object", file + " 挂载了命名空间 " + nsName);
  keys.forEach(function (key) {
    assert.equal(typeof ns[key], "function", nsName + "." + key + " 对外可用");
  });
});

/* 拆分时最容易漏的：legacy-export 除了 BannerBuilderLegacy 还要给主脚本注入口 */
assert.ok(window.BannerBuilderLegacyExport, "BannerBuilderLegacyExport 命名空间存在（主脚本注入 state 用）");
assert.equal(typeof window.BannerBuilderLegacyExport.setState, "function", "BannerBuilderLegacyExport.setState");
assert.equal(typeof window.BannerBuilderLegacyExport.setContext, "function", "BannerBuilderLegacyExport.setContext");

/* 主脚本 init 依赖的下游命名空间都必须就位，否则 init 一开始就 ReferenceError */
[
  "BannerBuilderConstants", "BannerBuilderRegistry", "BannerBuilderModel", "BannerBuilderMyTemplates",
  "BannerBuilderThemeImporter", "BannerBuilderFontImporter", "BannerBuilderModuleImporter",
  "BannerBuilderAiDocument", "BannerBuilderSceneModel", "BannerBuilderBackgrounds",
  "BannerBuilderUtils", "BannerBuilderFont", "BannerBuilderRender", "BannerBuilderUi",
  "BannerBuilderDraft", "BannerBuilderEvents", "BannerBuilderModals", "BannerBuilderPreview",
  "BannerBuilderLegacy", "BannerBuilderLegacyExport", "BannerBuilderExport", "BannerBuilderPdfExport",
].forEach(function (ns) {
  assert.ok(window[ns] && typeof window[ns] === "object", "init 依赖的 " + ns + " 已挂载");
});

/* ============ 6) 单一全局挂载点：window 上不得出现白名单外的全局变量 ============ */

const ALLOWED = [
  "BannerBuilderBuiltinThemes", "BannerBuilderConstants", "BannerBuilderRegistry",
  "BannerBuilderModel", "BannerBuilderMyTemplates", "BannerBuilderThemeImporter",
  "BannerBuilderFontImporter", "BannerBuilderModuleImporter", "BannerBuilderAiDocument",
  "BannerBuilderSceneModel", "BannerBuilderBackgrounds", "BannerBuilderUtils",
  "BannerBuilderFont", "BannerBuilderRender", "BannerBuilderUi", "BannerBuilderDraft",
  "BannerBuilderEvents", "BannerBuilderModals", "BannerBuilderPreview", "BannerBuilderLegacy",
  "BannerBuilderLegacyExport", "BannerBuilderExport", "BannerBuilderPdfExport",
  "BannerBuilderDraftTools", "MobileImageUpload", "FontCatalog", "FontsCatalog",
  "OnlyBoxFonts", /* data/fonts.js 的字体清单挂载点 */
];
const leaked = Object.keys(window).filter(function (k) { return ALLOWED.indexOf(k) < 0; });
assert.deepEqual(leaked, [], "无白名单外的全局变量泄漏（实测：" + leaked.join(", ") + "）");

/* ============ 7) 拆分模块的功能冒烟 ============ */

const U = window.BannerBuilderUtils;
const F = window.BannerBuilderFont;
const R = window.BannerBuilderRender;
const Draft = window.BannerBuilderDraft;

/* utils：颜色与文本工具（渲染/导出共用，改动会同时影响预览与导出） */
assert.equal(U.hexToRgba("#236b4f", 0.5), "rgba(35,107,79,0.5)", "hexToRgba 6 位十六进制");
assert.equal(U.hexToRgba("236b4f", 0.5), "rgba(35,107,79,0.5)", "hexToRgba 容忍无 # 前缀");
assert.equal(U.hexToRgba("#fff", 0.5), "", "hexToRgba 简写/非法值返回空串，不产生脏色值");
assert.equal(U.alphaColor("#236b4f", 0.5), "rgba(35,107,79,0.5)", "alphaColor 走 rgba");
assert.equal(U.alphaColor("#fff", 0.5), "#fff", "alphaColor 无法转换时原样返回");
assert.equal(U.hexToColor("#ABCDEF"), "#abcdef", "hexToColor 统一小写");
assert.equal(U.hexToColor("red"), "#000000", "hexToColor 非法值回落黑色");
assert.equal(U.capText("十二个字十二个字十二个字", 5), "十二个字十…", "capText 保留 limit 个字符后加省略号");
assert.equal(U.capText("  短  ", 5), "短", "capText 先 trim");
assert.equal(U.formatBytes(512), "512B", "formatBytes 字节");
assert.equal(U.formatBytes(2048), "2KB", "formatBytes KB");
assert.equal(U.formatBytes(3 * 1024 * 1024), "3.0MB", "formatBytes MB");
assert.equal(U.safeClassSuffix("dark forest", "default"), "default", "含空格的主题值回退默认，避免 DOMException");
assert.equal(U.safeClassSuffix("forest", "default"), "forest", "合法 token 保留");

/* wrapLines：逐字符贪心换行 + 缓存 */
{
  const mock = {
    font: "20px sans",
    measureText: function (t) { return { width: Array.from(t).length * 20 }; },
  };
  /* 跨 vm 上下文数组原型不同，deepEqual 会失败：统一 join 成字符串比对 */
  const lines = U.wrapLines(mock, "一二三四五六", 60);
  assert.equal(lines.join("|"), "一二三|四五六", "wrapLines 按 maxWidth 断行");
  /* 缓存命中：同样入参返回同一内容 */
  const again = U.wrapLines(mock, "一二三四五六", 60);
  assert.equal(again.join("|"), "一二三|四五六", "wrapLines 缓存命中结果一致");
  U.clearWrapCache();
  assert.equal(U.wrapLines(mock, "一二三四五六", 60).join("|"), "一二三|四五六", "清缓存后仍正确");
  assert.equal(U.wrapLines(mock, "一行\n另一行", 60).join("|"), "一行|另一行", "wrapLines 保留显式换行");
}

/* font：PSD 字体名按 scope 取标题/正文字体，去掉空格 */
{
  const C = window.BannerBuilderConstants;
  const familyOf = function (key) { return (C.FONTS[key] || C.FONTS.sans).family.replace(/ /g, ""); };
  F.setState({ doc: { headingFont: "serif", bodyFont: "lxgw-marker-gothic", fontFamily: "sans" } });
  assert.equal(F.psFontNameFor("heading"), familyOf("serif"), "标题层用标题字体");
  assert.equal(F.psFontNameFor("body"), familyOf("lxgw-marker-gothic"), "正文层用正文字体");
  assert.equal(F.psFontNameFor("heading").indexOf(" ") < 0, true, "psFontNameFor 去掉空格（PS 字体名约束）");
  /* 未单独设置正文字体时回落标题字体 */
  F.setState({ doc: { headingFont: "serif", bodyFont: "", fontFamily: "sans" } });
  assert.equal(F.psFontNameFor("body"), familyOf("serif"), "正文未设置时回落标题字体");
  F.setState({ doc: { headingFont: "", bodyFont: "", fontFamily: "" } });
  assert.ok(F.psFontNameFor("body").length > 0, "全空时回落默认字体而非空串");
}

/* render：无 DOM 依赖的纯几何/桥接工具 */
/* px2：750 设计宽度 → CSS px 换算（导出坐标与预览同一单位口径） */
assert.equal(R.px2(13.333), 28, "px2 按设计宽度换算（13.333 × 2.08 取整）");
assert.equal(R.px2(0), 1, "px2 有 1px 保底，不产生 0");
assert.equal(R.ratioNumber("9:16"), 0.5625, "ratioNumber 9:16");
assert.equal(R.ratioNumber("3:4"), 0.75, "ratioNumber 3:4");
assert.equal(R.ratioNumber("bad"), 0, "ratioNumber 非法值回落 0");
/* cardRadius：13 是"跟随主题"哨兵值，须回落到主题 radius */
assert.equal(R.cardRadius({ radius: 13 }, { radius: 27 }), 27, "radius=13 时取主题值");
assert.equal(R.cardRadius({ radius: 40 }, { radius: 27 }), 40, "自定义 radius 优先");
assert.equal(R.cardRadiusDom({ radius: 13 }, { radius: 27 }), 27, "DOM 圆角与 canvas 同源");
assert.equal(R.hexToRgba("#000000", 0.2), "rgba(0,0,0,0.2)", "render 的 hexToRgba 桥接到 utils");
assert.equal(R.capText("abcdef", 3), "abc…", "render 的 capText 桥接到 utils");

/* render/draft/preview 的状态注入点必须可用且不抛错 */
R.setState({ doc: { ratio: "9:16" } });
R.setContext({ text: function (v) { return v; } });
assert.equal(R.ratioNumber("9:16"), 0.5625, "注入状态后纯工具仍稳定");

/* draft：版本常量与限额守卫 */
assert.equal(typeof Draft.CURRENT_DRAFT_VERSION, "number", "草稿当前版本号");
assert.ok(Draft.MIN_SUPPORTED_DRAFT_VERSION <= Draft.CURRENT_DRAFT_VERSION, "最低支持版本不高于当前版本");
assert.ok(Draft.DRAFT_LIMITS && Draft.DRAFT_LIMITS.maxModulesTotal > 0, "草稿限额已定义");
assert.equal(typeof Draft.migrateDraft, "function", "草稿版本迁移入口");

console.log("banner-builder 拆分模块加载契约测试全部通过（" + diskModules.length + " 个模块，脚本 " + srcs.length + " 个）");

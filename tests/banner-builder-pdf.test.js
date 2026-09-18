/* ================================================================
   tests/banner-builder-pdf.test.js —— 场景模型 + PDF/A-3b 导出器测试
   两部分：
     A) 场景模型单测（vm 加载，与现有测试同款；字体路径用清单默认值）
     B) PDF 结构断言（node 直跑 assemblePdf 真实装配：
        解压内容流查 /OC BDC/EMC/圆角算子，raw 查 pdfaid/AFRelationship/FontFile）
   运行：node --test（仓库根目录）
   ================================================================ */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const documentStub = { readyState: "loading", addEventListener: function () {}, removeEventListener: function () {} };
const ctx = vm.createContext({ window, console, document: documentStub, Date, Uint8Array, ArrayBuffer, Array, Object });
["data/fonts.js", "js/banner-builder-themes.js", "js/banner-builder-constants.js", "js/banner-builder-registry.js", "js/banner-builder-model.js", "js/banner-builder-scene-model.js"].forEach(function (file) {
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
});

const C = window.BannerBuilderConstants;
const R = window.BannerBuilderRegistry;
const SM = window.BannerBuilderSceneModel;

/* ============ A) 场景模型 ============ */

assert.equal(SM.SCHEMA, "only-box-scene-model/1", "schema 标识");

/* 跨 vm 原型不同，deepStrictEqual 会失败 —— 对象统一 JSON 序列化后比较 */
assert.equal(JSON.stringify(SM.parseColor("#20251f")), '{"r":32,"g":37,"b":31}', "hex 解析");
assert.equal(JSON.stringify(SM.parseColor("#fff")), '{"r":255,"g":255,"b":255}', "#rgb 解析");
assert.equal(JSON.stringify(SM.parseColor("rgba(255,255,255,0.94)")), '{"r":255,"g":255,"b":255,"a":0.94}', "rgba 含透明度");
assert.equal(JSON.stringify(SM.parseColor("rgb(1, 2, 3)")), '{"r":1,"g":2,"b":3}', "rgb 解析");
assert.equal(SM.parseColor("not-a-color"), null, "非法颜色返回 null");

/* 字号缩放与字重偏置 */
{
  const st = C.themeStyle("forest");
  const st2 = Object.assign({}, st, { typeScale: 1.2, h1Scale: 1.1 });
  assert.equal(SM.scaledSize(65, st), 65, "无缩放主题字号不变");
  assert.equal(SM.scaledSize(65, st2), 86, "全局 1.2 × h1 1.1 → 86（65*1.32 取整）");
  assert.equal(SM.scaledSize(0, st2), 0, "0 字号原样返回");
  const stW = Object.assign({}, st, { headingWeight: 700, bodyWeight: 500 });
  assert.equal(SM.adjustedWeight(800, "heading", stW), 700, "标题基准 800→主题 700");
  assert.equal(SM.adjustedWeight(400, "body", stW), 500, "正文基准 400→主题 500");
  assert.equal(SM.adjustedWeight(700, "heading", st), 700, "标题 700×700 偏置 → 700");
  assert.equal(SM.adjustedWeight(900, "heading", stW), 800, "标题 900×700 偏置 → 800（负偏置下移，与原版一致）");
}

/* buildScene：以 announcement + freeText 为例验证元素抽取（legacyExportPsd 同源） */
{
  const doc = Object.assign({}, C.STYLE_DEFAULTS, {
    theme: "forest", themeOverrides: {}, fontFamily: "sans", headingFont: "", bodyFont: "",
    backgroundColor: "#faf7f2", ratio: "9:16",
  });
  const module = { id: "m-ann", type: "announcement", visible: true, data: { heading: "小标题", body: "正文内容", bodyAlign: "left" } };
  const page = { id: "p1", backgroundColor: "", backgroundImage: null, modules: [module] };
  const layout = [{ module: module, x: 50, y: 46, w: 650, serial: 1, head: 80, h: 300 }];
  const scene = SM.buildScene({
    page: page, layout: layout, doc: doc, pageHeight: 1334,
    pageSize: { pageWidth: 750, pageHeight: 1334 }, registry: R, theme: C.themeStyle("forest"),
  });
  assert.equal(scene.schema, "only-box-scene-model/1");
  assert.equal(scene.page.width, 750);
  assert.equal(scene.page.height, 1334);
  assert.deepEqual(scene.page.background.color, "#faf7f2", "背景色取 doc 值");
  assert.equal(scene.modules.length, 1, "一个板块");
  const mod = scene.modules[0];
  assert.equal(mod.label, R.getDef("announcement").label, "板块 label");
  assert.equal(JSON.stringify(mod.rect), JSON.stringify({ x: 50, y: 46, w: 650, h: 300 }), "板块矩形");
  assert.ok(mod.elements.some(function (el) { return el.kind === "shape" && el.name.indexOf("背景") >= 0; }), "卡片背景 shape");
  const serial = mod.elements.filter(function (el) { return el.name === "序号"; })[0];
  assert.ok(serial && serial.text === "01", "序号 01");
  const title = mod.elements.filter(function (el) { return el.name === "板块标题"; })[0];
  assert.ok(title && title.text === R.getDef("announcement").label && title.scope === "heading", "板块标题取 def.label 且走 heading scope");
  const body = mod.elements.filter(function (el) { return el.name === "正文"; })[0];
  assert.ok(body && body.text === "正文内容" && body.scope === "body", "正文走 body scope");
  assert.ok(mod.elements.some(function (el) { return el.name === "小标题" && el.text === "小标题"; }), "小标题");
  assert.ok(scene.fonts.length >= 1 && scene.fonts[0].role === "heading", "字体角色清单");
}

/* cover 模块：图片引用 + 无图主视觉底形状 */
{
  const doc = { theme: "forest", themeOverrides: {}, fontFamily: "sans", headingFont: "", bodyFont: "", backgroundColor: "#ffffff", ratio: "9:16" };
  const cover = { id: "m-cover", type: "cover", visible: true, data: { template: "card", title: "主标题", subtitle: "副标题", mainImage: { url: "blob:x", name: "a.png" }, infoLines: ["行1"], qqGroupNumber: "" } };
  const layout = [{ module: cover, x: 50, y: 46, w: 650, serial: 1, head: 80, h: 900 }];
  const scene = SM.buildScene({ page: { id: "p", modules: [cover] }, layout: layout, doc: doc, pageHeight: 1334, pageSize: { pageWidth: 750, pageHeight: 1334 }, registry: R, theme: C.themeStyle("forest") });
  const mod = scene.modules[0];
  const img = mod.elements.filter(function (el) { return el.kind === "image"; })[0];
  assert.ok(img && img.name === "主视觉图" && img.fit === "cover" && img.image.url === "blob:x", "主视觉图引用保留");
  assert.ok(mod.elements.some(function (el) { return el.name === "主标题"; }), "主标题");
  assert.ok(mod.elements.some(function (el) { return el.name === "信息行 1"; }), "信息行");
  assert.ok(!mod.elements.some(function (el) { return el.name === "QQ 群号"; }), "空 QQ 群号跳过");
}

/* selfContained：无 snapshotData 时应返回结构拷贝并带附件说明 */
SM.selfContained({ schema: "x", page: { background: {} }, modules: [] }, null).then(function (out) {
  assert.equal(out.schema, "only-box-scene-model/1", "selfContained 修正 schema");
  assert.ok(out.attachment && out.attachment.kind === "only-box-scene", "附件说明");
});

/* ============ B) PDF/A-3b 结构断言（node 直跑 assemblePdf） ============ */

const PDFLib = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

/* B 部分在宿主 realm 用 eval 加载导出链（vm 跨 realm 数组无法过宿主 pdf-lib 的
   Array 检验；浏览器单 realm 无此问题，测试用同构的宿主 realm 等价验证）。 */
global.window = global;
["data/fonts.js", "js/banner-builder-themes.js", "js/banner-builder-constants.js", "js/banner-builder-registry.js", "js/banner-builder-model.js", "js/banner-builder-scene-model.js", "js/banner-builder-pdf-export.js"].forEach(function (file) {
  (0, eval)(fs.readFileSync(file, "utf8"));
});
const PdfExport = global.BannerBuilderPdfExport;

const FONT_PATH = ".tmp-verapdf/fonts/NotoSansSC-Regular.otf";
/* 字体文件由外部准备（不入库）。缺失时导出器回落到 PDF 标准字体，
   此时不会有 /FontFile 流——字体相关的字节断言要跟着降级，否则误报。 */
const FONT_AVAILABLE = fs.existsSync(FONT_PATH);

async function buildTestPdf() {
  const fontPath = FONT_PATH;
  const hasFont = fs.existsSync(fontPath);
  const fontBytes = hasFont ? new Uint8Array(fs.readFileSync(fontPath)) : null;
  const iccPath = ".tmp-verapdf/icc/sRGB-v2-magic.icc";
  const iccBytes = fs.existsSync(iccPath) ? new Uint8Array(fs.readFileSync(iccPath)) : null;
  const scene = {
    schema: "only-box-scene-model/1", generatedAt: new Date().toISOString(), tool: "test",
    page: { width: 750, height: 1334, designHeight: 1334, background: { color: "#ffffff", image: null } },
    fonts: [], theme: { key: "forest" },
    modules: [{
      id: "m1", type: "announcement", label: "公告", serial: 1,
      rect: { x: 50, y: 46, w: 650, h: 300 }, radius: 13, background: { fill: { r: 255, g: 255, b: 255 } },
      elements: [
        { kind: "shape", name: "公告 背景", x: 50, y: 46, w: 650, h: 300, radius: 13, fill: { r: 250, g: 247, b: 242 } },
        { kind: "text", name: "板块标题", text: hasFont ? "冒烟测试标题" : "Title", x: 375, y: 92, size: 54, weight: 800, color: { r: 26, g: 58, b: 42 }, align: "center", scope: "heading" },
        { kind: "text", name: "正文", text: hasFont ? "PDF/A-3b 冒烟正文 0123" : "Body 0123", x: 68, y: 207, size: 29, weight: 400, color: { r: 32, g: 37, b: 31 }, align: "left", scope: "body" },
      ],
    }],
  };
  return PdfExport.assemblePdf({
    PDFLib: PDFLib, fontkit: hasFont ? fontkit : null,
    scene: scene, sceneJson: JSON.stringify(scene, null, 2),
    compositePngBytes: null, iccBytes: iccBytes,
    resolveFont: hasFont ? async function () { return { bytes: fontBytes, name: "NotoSansSC-Regular.otf", vfDefault: null, cacheKey: "NotoSansSC-Regular" }; } : null,
    title: "测试",
  });
}

(async function () {
  const out = await buildTestPdf();
  const buf = Buffer.from(out.bytes);
  fs.mkdirSync(".tmp-verapdf", { recursive: true });
  fs.writeFileSync(".tmp-verapdf/test-export.pdf", buf);
  const s = buf.toString("latin1");

  /* 原始字节断言：PDF/A-3b 结构要素 */
  assert.equal(out.bytes[0] === 0x25 && out.bytes[1] === 0x50 && out.bytes[2] === 0x44 && out.bytes[3] === 0x46, true, "%PDF 魔数");
  assert.ok(s.indexOf("pdfaid:part>3") > 0, "XMP pdfaid:part=3");
  assert.ok(s.indexOf("pdfaid:conformance>B") > 0, "XMP pdfaid:conformance=B");
  assert.ok(s.indexOf("GTS_PDFA1") > 0, "OutputIntent GTS_PDFA1（ICC 提供）");
  assert.ok(s.indexOf("/AFRelationship") > 0 && s.indexOf("/Source") > 0, "附件 AFRelationship=/Source");
  assert.ok(s.indexOf("/EmbeddedFile") > 0 && (s.indexOf("application/json") > 0 || s.indexOf("application#2Fjson") > 0), "EmbeddedFile JSON 附件");
  assert.ok(s.indexOf("/OCProperties") > 0 && s.indexOf("/OCGs") > 0, "OCProperties/OCGs");
  assert.ok(s.indexOf("/FontFile") > 0 || !FONT_AVAILABLE, "字体可用时必须嵌入 FontFile 流");
  if (!FONT_AVAILABLE) {
    console.warn("[提示] 未找到 " + FONT_PATH + "，本次导出回落到 PDF 标准字体，字体嵌入断言已跳过");
  }

  /* 内容流解压断言：OC 包裹 + 圆角算子 + 空流防护 */
  const zlib = require("node:zlib");
  const re = /(\d+) 0 obj\s*<<([^>]*\/Length[^>]*>>)\s*stream\r?\n?/g;
  let m, ocBDC = 0, emc = 0, hasCurve = false, hasFill = false, emptyStream = false;
  while ((m = re.exec(s)) !== null) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) continue;
    const raw = buf.subarray(start, end);
    let txt;
    try { txt = zlib.inflateSync(raw).toString("latin1"); } catch (e) { continue; }
    if (/\/Length 8\b/.test(m[2]) && txt.trim() === "") emptyStream = true;
    ocBDC += (txt.match(/\/OC \/MC\d+ BDC/g) || []).length;
    emc += (txt.match(/EMC/g) || []).length;
    if (/ c[\r\n]/.test(txt)) hasCurve = true;
    if (/\bf[\r\n]/.test(txt)) hasFill = true;
  }
  assert.equal(emptyStream, false, "PDFOperator 第一参数字符串（无空 stream 陷阱）");
  assert.ok(ocBDC >= 2, "合成层+板块层 OC BDC 包裹（实测 " + ocBDC + "）");
  assert.ok(emc >= 2, "EMC 闭合");
  assert.ok(hasFill, "圆角矩形填充算子存在");
  assert.ok(ocBDC === emc, "OC 开闭配对");

  /* 字体嵌入登记：同一 cacheKey 只嵌一次（去重）；无 cacheKey 时才用 scope#weight 键 */
  assert.ok(out.embeddedKeys.length >= 1, "字体嵌入登记非空");
  assert.ok(out.embeddedKeys.indexOf("NotoSansSC-Regular") >= 0 || out.embeddedKeys.indexOf("heading#800") >= 0, "嵌入键包含 cacheKey 或 scope#weight");
  const pdfDoc = await PDFLib.PDFDocument.load(buf);
  assert.equal(pdfDoc.getPageCount(), 1, "单页");
  const p0 = pdfDoc.getPage(0);
  assert.equal(p0.getSize().width, 750, "页宽 750pt");
  assert.equal(p0.getSize().height, 1334, "页高 1334pt");
})().then(function () { console.log("banner-builder-pdf.test.js done"); }, function (error) { console.error(error); process.exit(1); });

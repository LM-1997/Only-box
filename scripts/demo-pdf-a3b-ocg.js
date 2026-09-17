/* ================================================================
   demo-pdf-a3b-ocg.js —— PDF/A-3b + OCG（可选内容组/图层）最小可行性 demo
   用途：在铺开完整导出功能前，验证两条高不确定性技术路径：
     1) pdf-lib 底层 API 手工构造 OCG 字典，图层能否被正确挂载到页面与目录；
     2) PDF/A-3b 合规结构（XMP 元数据 / ICC OutputIntent / AF+附件 Source / 字体完整嵌入）。
   运行：node scripts/demo-pdf-a3b-ocg.js [字体路径]
   产物：_archive/verapdf/demo-ocg.pdf（普通带图层 PDF）
         _archive/verapdf/demo-a3b.pdf（PDF/A-3b 结构 + 附件）
   ================================================================ */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString, PDFNumber, PDFBool, StandardFonts, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "_archive", "verapdf");
const ICC_PATH = path.join(OUT_DIR, "icc", "sRGB-v2-magic.icc");

function xmpTimestamp(date) {
  const pad = (n, l) => String(n).padStart(l || 2, "0");
  return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate())
    + "T" + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes()) + ":" + pad(date.getUTCSeconds())
    + "Z";
}

/* PDF/A-3b 要求的 XMP：pdfaid 声明 + 基本标识字段；xpacket 头尾必须完整 */
function buildXmp(now) {
  const created = xmpTimestamp(now);
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Only-box banner PDF/A-3b demo</rdf:li></rdf:Alt></dc:title>
      <dc:format>application/pdf</dc:format>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreateDate>${created}</xmp:CreateDate>
      <xmp:ModifyDate>${created}</xmp:ModifyDate>
      <xmp:CreatorTool>Only-box banner-builder</xmp:CreatorTool>
      <xmp:MetadataDate>${created}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>Only-box banner-builder (pdf-lib)</pdf:Producer>
      <pdf:PDFVersion>1.7</pdf:PDFVersion>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/* 把文档目录挂上 XMP（PDF/A 要求 Metadata 流不得过滤压缩） */
function attachXmp(pdfDoc, xmp) {
  const stream = pdfDoc.context.stream(xmp, { Type: "Metadata", Subtype: "XML" });
  pdfDoc.catalog.set(PDFName.of("Metadata"), pdfDoc.context.register(stream));
}

/* OutputIntent：嵌入 ICC 描述文件，声明 sRGB 输出（DeviceRGB 内容由其兜底） */
function attachOutputIntent(pdfDoc, iccBytes) {
  const iccStream = pdfDoc.context.stream(iccBytes, { N: 3 });
  const iccRef = pdfDoc.context.register(iccStream);
  const intent = pdfDoc.context.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
    RegistryName: PDFString.of("http://www.color.org"),
    DestOutputProfile: iccRef,
  });
  pdfDoc.catalog.set(PDFName.of("OutputIntents"), pdfDoc.context.obj([intent]));
}

/* 构造一个 OCG 字典并登记到 catalog /OCProperties，返回页面 Properties 引用用的 tag */
function makeOcg(pdfDoc, name, options) {
  const opts = options || {};
  const ocgDict = pdfDoc.context.obj({
    Type: "OCG",
    /* 中文名必须用 UTF-16BE 的十六进制字符串（PDFString 会按 PDFDocEncoding 解出乱码） */
    Name: PDFHexString.fromText(name),
    Intent: pdfDoc.context.obj([PDFName.of("View"), PDFName.of("Design")]),
    Usage: pdfDoc.context.obj({ CreatorInfo: { Creator: PDFString.of("Only-box banner-builder"), Subtype: PDFName.of("Artwork") } }),
  });
  const ref = pdfDoc.context.register(ocgDict);
  const ocprops = pdfDoc.catalog.lookupMaybe(PDFName.of("OCProperties"), PDFDict) || pdfDoc.context.obj({});
  const ocgs = ocprops.lookupMaybe(PDFName.of("OCGs"), PDFArray) || pdfDoc.context.obj([]);
  ocgs.push(ref);
  ocprops.set(PDFName.of("OCGs"), ocgs);
  if (opts.off) {
    const off = ocprops.lookupMaybe(PDFName.of("OFF"), PDFArray) || pdfDoc.context.obj([]);
    off.push(ref);
    ocprops.set(PDFName.of("OFF"), off);
  }
  const order = ocprops.lookupMaybe(PDFName.of("Order"), PDFArray) || pdfDoc.context.obj([]);
  order.push(ref);
  ocprops.set(PDFName.of("Order"), order);
  ocprops.set(PDFName.of("Locked"), pdfDoc.context.obj([]));
  pdfDoc.catalog.set(PDFName.of("OCProperties"), ocprops);
  return { ref, tag: "MC" + (++makeOcg._seq) };
}
makeOcg._seq = 0;

/* 页面内容流包一层 /OC BDC ... EMC：把操作挂到指定 OCG */

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  /* 默认优先静态 OTF：可变字体 NotoSansSC[wght].ttf 的字宽表与 veraPDF 校验不一致（Widths 缺口），
     且默认实例为 Thin；静态 Regular 字重正确、合规通过 */
  const staticFont = path.join(OUT_DIR, "fonts", "NotoSansSC-Regular.otf");
  const fontPath = process.argv[2] || (fs.existsSync(staticFont) ? staticFont : path.join(OUT_DIR, "fonts", "NotoSansSC.ttf"));
  let fontBytes = null;
  let fontLabel = "Helvetica(标准字体，仅结构验证)";
  if (fs.existsSync(fontPath)) {
    fontBytes = fs.readFileSync(fontPath);
    fontLabel = path.basename(fontPath) + " " + (fontBytes.length / 1024 / 1024).toFixed(1) + "MB";
  }

  const now = new Date();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  /* trailer /ID：PDF/A 硬性要求（veraPDF 规则 6.1.3），两个 16 字节 hex 串 */
  const hex16 = function () { let out = ""; for (let i = 0; i < 16; i += 1) out += Math.floor(Math.random() * 256).toString(16).padStart(2, "0"); return out; };
  const idHex = hex16();
  pdfDoc.context.trailerInfo.ID = pdfDoc.context.obj([PDFHexString.of(idHex), PDFHexString.of(idHex)]);
  /* 字体完整嵌入（subset:false）；同时镜像 Info 字典日期/作者，满足 veraPDF 6.7.3 一致性规则 */
  const font = fontBytes ? await pdfDoc.embedFont(fontBytes, { subset: false }) : await pdfDoc.embedFont(StandardFonts.Helvetica, {});
  pdfDoc.setProducer("Only-box banner-builder (pdf-lib)");
  pdfDoc.setCreator("Only-box banner-builder");
  pdfDoc.setCreationDate(now);
  pdfDoc.setModificationDate(now);

  attachXmp(pdfDoc, buildXmp(now));
  attachOutputIntent(pdfDoc, fs.readFileSync(ICC_PATH));

  const page = pdfDoc.addPage([750, 1334]);

  /* 三个 OCG：合成图层（开）、板块图层 1/2（关） */
  const composite = makeOcg(pdfDoc, "预览合成图（所见即所得）");
  const module1 = makeOcg(pdfDoc, "板块 1 · 标题", { off: true });
  const module2 = makeOcg(pdfDoc, "板块 2 · 正文", { off: true });

  /* 页面 Resources /Properties 登记图层名 → OCG 引用 */
  const propsDict = pdfDoc.context.obj({});
  propsDict.set(PDFName.of(composite.tag), composite.ref);
  propsDict.set(PDFName.of(module1.tag), module1.ref);
  propsDict.set(PDFName.of(module2.tag), module2.ref);
  page.node.set(PDFName.of("Properties"), propsDict);

  /* 内容：每块 wrapped in /OC BDC ... EMC（用 pushOperators 注入原始操作符。
     注意 PDFOperator.of 第一参数是操作符名字符串，传 PDFName 会因 sizeInBytes=NaN 丢失内容） */
  const { PDFOperator } = require("pdf-lib");
  const wrap = async function (layerTag, fn) {
    page.pushOperators(PDFOperator.of("BDC", [PDFName.of("OC"), PDFName.of(layerTag)]));
    await fn();
    page.pushOperators(PDFOperator.of("EMC", []));
  };

  await wrap(composite.tag, async function () {
    page.drawRectangle({ x: 50, y: 1100, width: 650, height: 180, color: rgb(0.92, 0.96, 0.93) });
    page.drawText("Only-box PDF/A-3b + OCG demo", { x: 70, y: 1200, size: 36, font, color: rgb(0.1, 0.2, 0.15) });
  });
  await wrap(module1.tag, async function () {
    page.drawText("板块一：这是可编辑文字（图层默认隐藏）", { x: 70, y: 1000, size: 28, font, color: rgb(0.1, 0.1, 0.4) });
  });
  await wrap(module2.tag, async function () {
    page.drawText("板块二：Illustrator 图层面板应能看到 3 个图层", { x: 70, y: 900, size: 24, font, color: rgb(0.4, 0.1, 0.1) });
  });

  /* PDF/A-3 附件：结构化 JSON，AFRelationship=Source，未压缩存储 */
  const sceneJson = JSON.stringify({ schema: "only-box-scene-model/demo", note: "demo attachment", page: { width: 750, height: 1334 } }, null, 2);
  await attachEmbeddedJson(pdfDoc, sceneJson, "only-box-scene.json");

  /* W 数组补档（双 pass）：pdf-lib 的 CIDFont 字典在 save() 时才生成，save 前改不到；
     先 save 触发字典生成，load 回来补全 gid 覆盖的 W，再 save（与导出器同源方案） */
  const pass1 = await pdfDoc.save({ useObjectStreams: false });
  const bytes = await patchFontWidthsDoublePass(pass1, fontBytes);
  fs.writeFileSync(path.join(OUT_DIR, "demo-a3b.pdf"), bytes);
  console.log("demo-a3b.pdf:", bytes.length, "bytes; font:", fontLabel);
  console.log("OCG tags:", composite.tag, module1.tag, module2.tag);
}

/* 附件四件套：Filespec（F/UF/Desc/AFRelationship=Source）+ EmbeddedFile 流（无过滤器）
   + catalog /AF 数组 + /Names /EmbeddedFiles 命名树 */
async function attachEmbeddedJson(pdfDoc, jsonText, filename) {
  const now = new Date();
  const fileStream = pdfDoc.context.stream(jsonText, {
    Type: "EmbeddedFile",
    Subtype: "application/json",
    Params: { Size: jsonText.length, CreationDate: now, ModDate: now },
  });
  const fileRef = pdfDoc.context.register(fileStream);
  const filespec = pdfDoc.context.obj({
    Type: "Filespec",
    F: PDFString.of(filename),
    UF: PDFHexString.fromText(filename),
    Desc: PDFHexString.fromText("生成此 PDF 的原始结构化场景数据（无损再导入用）"),
    AFRelationship: PDFName.of("Source"),
    EF: { F: fileRef, UF: fileRef },
  });
  const specRef = pdfDoc.context.register(filespec);
  const af = pdfDoc.catalog.lookupMaybe(PDFName.of("AF"), PDFArray) || pdfDoc.context.obj([]);
  af.push(specRef);
  pdfDoc.catalog.set(PDFName.of("AF"), af);
  const names = pdfDoc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict) || pdfDoc.context.obj({});
  names.set(PDFName.of("EmbeddedFiles"), pdfDoc.context.obj({
    Names: pdfDoc.context.obj([PDFHexString.fromText(filename), specRef]),
  }));
  pdfDoc.catalog.set(PDFName.of("Names"), names);
}


/* W 数组补档（双 pass）：pass1 产物 load 后把每个 CIDFont 的 W 重写为全 gid 覆盖
   （连续段内同宽用 c1 c2 w 三元组、异宽用 c1 c2 [w...] 数组），再 save 返回新字节 */
async function patchFontWidthsDoublePass(bytes1, fontBytes) {
  const { PDFName, PDFNumber } = require("pdf-lib");
  const d2 = await PDFDocument.load(bytes1);
  const fkFont = fontkit.create(fontBytes);
  const upem = fkFont.unitsPerEm || 1000;
  const widths = {};
  /* 全 gid 覆盖：characterSet 之外被内容流引用的字形（如多行文本的 U+000A 占位 gid）也要补齐 */
  const total = fkFont.numGlyphs || 0;
  for (let gid = 0; gid < total; gid += 1) {
    try {
      const glyph = fkFont.getGlyph ? fkFont.getGlyph(gid) : null;
      if (!glyph || glyph.id == null) continue;
      widths[gid] = Math.round(glyph.advanceWidth * 1000 / upem);
    } catch (e) { /* 个别 gid 读取失败跳过 */ }
  }
  const gids = Object.keys(widths).map(Number).sort(function (a, b) { return a - b; });
  const ctx = d2.context;
  let touched = 0;
  for (const entry of ctx.enumerateIndirectObjects()) {
    const object = entry[1];
    let sub = null;
    try { sub = object.get ? object.get(PDFName.of("Subtype")) : null; } catch (e) { continue; }
    if (!sub || (String(sub) !== "/CIDFontType0" && String(sub) !== "/CIDFontType2")) continue;
    const W = ctx.obj([]);
    let i = 0;
    while (i < gids.length) {
      let j = i;
      while (j + 1 < gids.length && gids[j + 1] === gids[j] + 1) j += 1;
      const same = widths[gids[i]];
      let uniform = true;
      for (let k = i + 1; k <= j; k += 1) { if (widths[gids[k]] !== same) { uniform = false; break; } }
      if (uniform) {
        /* 规范形态：区间同宽 → 三个平铺数字 c_first c_last w */
        W.push(PDFNumber.of(gids[i]));
        W.push(PDFNumber.of(gids[j]));
        W.push(PDFNumber.of(same));
      } else {
        /* 规范形态：单 CID 起始 + 宽度数组（veraPDF 接受，pdf-lib 原生 W 同款） */
        const arr = ctx.obj([]);
        for (let k = i; k <= j; k += 1) arr.push(PDFNumber.of(widths[gids[k]]));
        W.push(PDFNumber.of(gids[i]));
        W.push(arr);
      }
      i = j + 1;
    }
    object.set(PDFName.of("W"), W);
    object.set(PDFName.of("DW"), PDFNumber.of(1000));
    touched += 1;
  }
  if (!touched) return bytes1;
  return await d2.save({ useObjectStreams: false });
}

main().catch(function (error) { console.error(error); process.exit(1); });

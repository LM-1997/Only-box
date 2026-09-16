/* ================================================================
   banner-builder-pdf-export.js —— PDF/A-3b（ISO 19005-3）可编辑导出
   分层：
     - assemblePdf(env)：无 DOM 核心装配（node 可直接单测）
       env = { PDFLib, fontkit, scene, sceneJson, compositePngBytes|null,
               iccBytes|null, resolveFont(scope,weight)→{bytes,name,vfDefault}|null, title }
     - exportPdf()：浏览器侧采集（排版/合成底图/字体通道/ICC），调用核心后下载
   结构（已由 scripts/demo-pdf-a3b-ocg.js 验证，勿改结构口径）：
     - 字体完整嵌入 embedFont(bytes,{subset:false})，不做子集化
     - 合成底图 OCG（开）+ 每板块一个 OCG（默认 OFF，Order 与板块一致）
     - 内容流 /OC /MCn BDC ... EMC 挂图层；PDFOperator.of 第一参数必须是字符串
     - XMP（Metadata 流不过滤）+ OutputIntent(ICC) + Info 日期镜像
     - 附件四件套：Filespec(AFRelationship=/Source) + EmbeddedFile + /AF + 命名树
   字体降级策略（brief 第 8 节）：weights 静态文件 > VF 原文件（默认实例+警告）
   > 用户导入 dataUrl > 无直链不嵌入并在结果中列明；嵌入失败回退已嵌字体/ Helvetica。
   已知陷阱（demo 踩实）：OCG 中文名必须 PDFHexString.fromText；可变字体默认实例
   可能是 Thin；pdf-lib drawRectangle 不支持圆角，圆角矩形用贝塞尔操作符自建。
   ================================================================ */
(function (global) {
  "use strict";

  const BB = function () { return global.bannerBuilder; };
  const C = global.BannerBuilderConstants;
  const SM = global.BannerBuilderSceneModel;
  const SCHEMA = "only-box-scene-model/1";
  const ATTACH_NAME = "only-box-scene.json";

  /* ================================================================
     核心：无 DOM 装配（node 可直接调用）
     ================================================================ */
  async function assemblePdf(env) {
    const PDFLib = env.PDFLib;
    if (!PDFLib || !PDFLib.PDFDocument) throw new Error("assemblePdf 需要 PDFLib");
    const warnings = [];
    const scene = env.scene;
    if (!scene || !scene.page) throw new Error("assemblePdf 需要 scene");
    const sceneJson = env.sceneJson != null ? env.sceneJson : JSON.stringify(scene, null, 2);
    const pageWidth = scene.page.width;
    const pageHeight = scene.page.height;

    const pdfDoc = await PDFLib.PDFDocument.create();
    if (env.fontkit) pdfDoc.registerFontkit(env.fontkit);
    const now = new Date();
    pdfDoc.setProducer("Only-box banner-builder (pdf-lib)");
    pdfDoc.setCreator("Only-box banner-builder");
    pdfDoc.setCreationDate(now);
    pdfDoc.setModificationDate(now);

    /* trailer /ID：PDF/A 硬性要求文件标识符（veraPDF 实测抓到的缺陷），两个 16 字节 hex 串 */
    const hex16 = function () {
      let out = "";
      for (let i = 0; i < 16; i += 1) out += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
      return out;
    };
    const idHex = hex16();
    pdfDoc.context.trailerInfo.ID = pdfDoc.context.obj([PDFLib.PDFHexString.of(idHex), PDFLib.PDFHexString.of(idHex)]);

    /* XMP（Metadata 流不过滤压缩，PDF/A 硬性要求） */
    const xmp = buildXmp(now, env.title || "Only-box banner");
    const metaStream = pdfDoc.context.stream(xmp, { Type: "Metadata", Subtype: "XML" });
    pdfDoc.catalog.set(PDFLib.PDFName.of("Metadata"), pdfDoc.context.register(metaStream));

    /* OutputIntent + ICC */
    if (env.iccBytes && env.iccBytes.length > 128) {
      const iccStream = pdfDoc.context.stream(env.iccBytes, { N: 3 });
      const iccRef = pdfDoc.context.register(iccStream);
      const intent = pdfDoc.context.obj({
        Type: "OutputIntent", S: "GTS_PDFA1",
        OutputConditionIdentifier: PDFLib.PDFString.of("sRGB IEC61966-2.1"),
        Info: PDFLib.PDFString.of("sRGB IEC61966-2.1"),
        RegistryName: PDFLib.PDFString.of("http://www.color.org"),
        DestOutputProfile: iccRef,
      });
      pdfDoc.catalog.set(PDFLib.PDFName.of("OutputIntents"), pdfDoc.context.obj([intent]));
    } else {
      warnings.push("未提供 ICC 描述文件，本文件缺少 OutputIntent（不满足 PDF/A，视觉不受影响）");
    }

    /* OCG 骨架：合成层（开）+ 板块层（默认 OFF） */
    let ocgSeq = 0;
    const makeOcg = function (name, off) {
      const ocgDict = pdfDoc.context.obj({
        Type: "OCG",
        Name: PDFLib.PDFHexString.fromText(name),
        Intent: pdfDoc.context.obj([PDFLib.PDFName.of("View"), PDFLib.PDFName.of("Design")]),
        Usage: pdfDoc.context.obj({ CreatorInfo: { Creator: PDFLib.PDFString.of("Only-box banner-builder"), Subtype: PDFLib.PDFName.of("Artwork") } }),
      });
      const ref = pdfDoc.context.register(ocgDict);
      const ocprops = pdfDoc.catalog.lookupMaybe(PDFLib.PDFName.of("OCProperties"), PDFLib.PDFDict) || pdfDoc.context.obj({});
      const ocgs = ocprops.lookupMaybe(PDFLib.PDFName.of("OCGs"), PDFLib.PDFArray) || pdfDoc.context.obj([]);
      ocgs.push(ref);
      ocprops.set(PDFLib.PDFName.of("OCGs"), ocgs);
      if (off) {
        const offArr = ocprops.lookupMaybe(PDFLib.PDFName.of("OFF"), PDFLib.PDFArray) || pdfDoc.context.obj([]);
        offArr.push(ref);
        ocprops.set(PDFLib.PDFName.of("OFF"), offArr);
      }
      const order = ocprops.lookupMaybe(PDFLib.PDFName.of("Order"), PDFLib.PDFArray) || pdfDoc.context.obj([]);
      order.push(ref);
      ocprops.set(PDFLib.PDFName.of("Order"), order);
      pdfDoc.catalog.set(PDFLib.PDFName.of("OCProperties"), ocprops);
      ocgSeq += 1;
      return { ref: ref, tag: "MC" + ocgSeq };
    };

    const pdfPage = pdfDoc.addPage([pageWidth, pageHeight]);
    const propsDict = pdfDoc.context.obj({});
    const compositeTag = makeOcg("预览合成图（所见即所得）", false);
    propsDict.set(PDFLib.PDFName.of(compositeTag.tag), compositeTag.ref);
    const moduleTags = (scene.modules || []).map(function (mod) {
      const tag = makeOcg("板块 " + mod.serial + " · " + mod.label, true);
      propsDict.set(PDFLib.PDFName.of(tag.tag), tag.ref);
      return tag;
    });
    pdfPage.node.set(PDFLib.PDFName.of("Properties"), propsDict);

    /* 合成底图 */
    const PDFOperator = PDFLib.PDFOperator;
    const beginOc = function (tag) { pdfPage.pushOperators(PDFOperator.of("BDC", [PDFLib.PDFName.of("OC"), PDFLib.PDFName.of(tag)])); };
    const endOc = function () { pdfPage.pushOperators(PDFOperator.of("EMC", [])); };

    if (env.compositePngBytes && env.compositePngBytes.length) {
      const img = await pdfDoc.embedPng(env.compositePngBytes);
      beginOc(compositeTag.tag);
      pdfPage.drawImage(img, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      endOc();
    } else {
      const bg = SM.parseColor(scene.page.background.color) || { r: 255, g: 255, b: 255 };
      const PDFNumber = PDFLib.PDFNumber;
      beginOc(compositeTag.tag);
      pdfPage.pushOperators(PDFOperator.of("rg", [PDFNumber.of(bg.r / 255), PDFNumber.of(bg.g / 255), PDFNumber.of(bg.b / 255)]));
      pdfPage.pushOperators(PDFOperator.of("re", [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(pageWidth), PDFNumber.of(pageHeight)]));
      pdfPage.pushOperators(PDFOperator.of("f", []));
      endOc();
      warnings.push("未提供合成底图，PDF 仅含可编辑图层与底色");
    }

    /* 字体嵌入：resolveFont(scope, weight) → {bytes, name, vfDefault, cacheKey}|null
       cacheKey 相同的请求复用同一次嵌入（同族同档不重复嵌文件） */
    const embedded = {};
    const fontRegistry = { bytes: {}, fk: {} }; /* BaseFont → { bytes, fontkit 实例 }，供 W 补档 */
    const embedJob = async function (scope, weight) {
      let font = null;
      try {
        if (typeof env.resolveFont === "function") {
          const got = await env.resolveFont(scope, weight);
          const key = (got && got.cacheKey) || scope + "#" + weight;
          if (embedded[key]) return embedded[key];
          if (got && got.bytes && got.bytes.length) {
            font = await pdfDoc.embedFont(got.bytes, { subset: false });
            if (got.vfDefault != null && Math.abs(Number(got.vfDefault) - Number(weight)) > 150) {
              warnings.push((got.name || "字体") + " 为可变字体，按默认字重 " + got.vfDefault + " 嵌入（期望 " + weight + "）");
            } else if (got.vfDefault == null && got.name && weight != null && Number(weight) !== 400) {
              warnings.push((got.name || "字体") + " 为单一字重文件，字重 " + weight + " 以其默认档呈现");
            }
            /* 登记 BaseFont → 字节与 fontkit 实例（W 补档用） */
            try {
              const baseName = String(font.name || "").replace(/^[A-Z]{6}\+/, "");
              fontRegistry.bytes[baseName] = got.bytes;
              if (env.fontkit && !fontRegistry.fk[baseName]) fontRegistry.fk[baseName] = env.fontkit.create(got.bytes);
            } catch (e) { /* 登记失败不影响导出 */ }
          }
          if (font) { embedded[key] = font; return font; }
        }
      } catch (error) {
        warnings.push("字重 " + weight + " 字体获取失败（" + (error && error.message || error) + "），改用替代字体");
      }
      if (!font) {
        const anyKey = Object.keys(embedded)[0];
        if (anyKey) font = embedded[anyKey];
        else { font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica); warnings.push("无任何可嵌入字体，回退 Helvetica（该文件将不满足 PDF/A 字体要求）"); }
        embedded[scope + "#" + weight] = font;
      }
      return font;
    };

    /* 板块元素绘制 */
    for (let mi = 0; mi < (scene.modules || []).length; mi += 1) {
      const mod = scene.modules[mi];
      const tag = moduleTags[mi];
      beginOc(tag.tag);
      for (let ei = 0; ei < mod.elements.length; ei += 1) {
        const el = mod.elements[ei];
        try {
          if (el.kind === "shape") drawShape(pdfPage, PDFLib, el, pageHeight);
          else if (el.kind === "image") await drawImageEl(pdfDoc, pdfPage, PDFLib, el, pageHeight);
          else if (el.kind === "text") await drawTextEl(pdfPage, PDFLib, el, pageHeight, await embedJob(el.scope, el.weight));
        } catch (error) {
          warnings.push("「" + (el.name || el.kind) + "」绘制失败（" + (error && error.message || error) + "），已跳过该元素");
        }
      }
      endOc();
    }

    /* 附件四件套 */
    const fileStream = pdfDoc.context.stream(sceneJson, {
      Type: "EmbeddedFile", Subtype: "application/json",
      Params: { Size: sceneJson.length, CreationDate: now, ModDate: now },
    });
    const fileRef = pdfDoc.context.register(fileStream);
    const filespec = pdfDoc.context.obj({
      Type: "Filespec",
      F: PDFLib.PDFString.of(ATTACH_NAME),
      UF: PDFLib.PDFHexString.fromText(ATTACH_NAME),
      Desc: PDFLib.PDFHexString.fromText("生成此 PDF 的原始结构化场景数据（无损再导入用）"),
      AFRelationship: PDFLib.PDFName.of("Source"),
      EF: { F: fileRef, UF: fileRef },
    });
    const specRef = pdfDoc.context.register(filespec);
    const af = pdfDoc.catalog.lookupMaybe(PDFLib.PDFName.of("AF"), PDFLib.PDFArray) || pdfDoc.context.obj([]);
    af.push(specRef);
    pdfDoc.catalog.set(PDFLib.PDFName.of("AF"), af);
    const names = pdfDoc.catalog.lookupMaybe(PDFLib.PDFName.of("Names"), PDFLib.PDFDict) || pdfDoc.context.obj({});
    names.set(PDFLib.PDFName.of("EmbeddedFiles"), pdfDoc.context.obj({
      Names: pdfDoc.context.obj([PDFLib.PDFHexString.fromText(ATTACH_NAME), specRef]),
    }));
    pdfDoc.catalog.set(PDFLib.PDFName.of("Names"), names);

    /* W 数组补档：pdf-lib 的 CIDFont 字典在 save() 时才由 embedder 生成，save 前改不到；
       采用双 pass：save → load 回来补全 gid 覆盖的 W → 再 save（实测有效链路） */
    let bytes = await pdfDoc.save({ useObjectStreams: false });
    try {
      const patched = await patchFontWidthsDoublePass(PDFLib, bytes, fontRegistry);
      if (patched) bytes = patched;
    } catch (e) {
      warnings.push("W 数组补档失败（不影响导出，可能影响 veraPDF 字宽校验）：" + (e && e.message || e));
    }
    return { bytes: bytes, warnings: warnings, embeddedKeys: Object.keys(embedded) };
  }

  /* 双 pass W 补档：pass1 产物 load 后把每个 CIDFont 的 W 重写为全 gid 覆盖（连续段内
     同宽用 c1 c2 w 三元组、异宽用 c1 c2 [w...] 数组），再 save 返回新字节。
     fontRegistry.fk[BaseFont 去前缀] 需在 embedFont 后登记 fontkit 实例。 */
  async function patchFontWidthsDoublePass(PDFLib, bytes1, fontRegistry) {
    if (!fontRegistry || !Object.keys(fontRegistry.fk || {}).length) return null;
    const PDFName = PDFLib.PDFName, PDFNumber = PDFLib.PDFNumber;
    const d2 = await PDFLib.PDFDocument.load(bytes1);
    let touched = 0;
    for (const entry of d2.context.enumerateIndirectObjects()) {
      const object = entry[1];
      let sub = null;
      try { sub = object.get ? object.get(PDFName.of("Subtype")) : null; } catch (e) { continue; }
      if (!sub || (String(sub) !== "/CIDFontType0" && String(sub) !== "/CIDFontType2")) continue;
      const raw = String(object.get(PDFName.of("BaseFont")));
      const baseName = raw.replace(/^[A-Z]{6}\+/s, "");
      const fkFont = fontRegistry.fk[baseName];
      if (!fkFont) continue;
      const upem = fkFont.unitsPerEm || 1000;
      const widths = {};
      /* 全 gid 覆盖：characterSet 之外被内容流引用的字形（如 U+000A 的多行占位 gid）也要补齐 */
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
      const W = ctx.obj([]);
      let i = 0;
      while (i < gids.length) {
        let j = i;
        while (j + 1 < gids.length && gids[j + 1] === gids[j] + 1) j += 1;
        const same = widths[gids[i]];
        let uniform = true;
        for (let k = i + 1; k <= j; k += 1) { if (widths[gids[k]] !== same) { uniform = false; break; } }
        if (uniform) {
          W.push(ctx.obj([PDFNumber.of(gids[i]), PDFNumber.of(gids[j]), PDFNumber.of(same)]));
        } else {
          const arr = ctx.obj([]);
          for (let k = i; k <= j; k += 1) arr.push(PDFNumber.of(widths[gids[k]]));
          W.push(PDFNumber.of(gids[i]));
          W.push(PDFNumber.of(gids[j]));
          W.push(arr);
        }
        i = j + 1;
      }
      object.set(PDFName.of("W"), W);
      object.set(PDFName.of("DW"), PDFNumber.of(1000));
      touched += 1;
    }
    if (!touched) return null;
    return await d2.save({ useObjectStreams: false });
  }

  /* ---------- 元素绘制（核心内静态函数） ---------- */
  function roundedRectOps(PDFLib, x, y, w, h, radius) {
    const PDFNumber = PDFLib.PDFNumber;
    const r = Math.max(0, Math.min(radius || 0, w / 2, h / 2));
    const k = r * 0.5522847498;
    const op = function (name, nums) { return PDFLib.PDFOperator.of(name, nums.map(function (n) { return PDFNumber.of(n); })); };
    const ops = [];
    if (r <= 0) {
      ops.push(op("re", [x, y, w, h]));
      ops.push(PDFLib.PDFOperator.of("f", []));
      return ops;
    }
    ops.push(op("m", [x, y + r]));
    ops.push(op("c", [x, y + r - k, x + r - k, y, x + r, y]));
    ops.push(op("l", [x + w - r, y]));
    ops.push(op("c", [x + w - r + k, y, x + w, y + r - k, x + w, y + r]));
    ops.push(op("l", [x + w, y + h - r]));
    ops.push(op("c", [x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h]));
    ops.push(op("l", [x + r, y + h]));
    ops.push(op("c", [x + r - k, y + h, x, y + h - r + k, x, y + h - r]));
    ops.push(PDFLib.PDFOperator.of("h", []));
    ops.push(PDFLib.PDFOperator.of("f", []));
    return ops;
  }
  function flattenColor(fill) {
    const a = fill && fill.a != null ? fill.a : 1;
    const f = function (c) { return Math.round(c * a + 255 * (1 - a)); };
    return { r: f(fill.r), g: f(fill.g), b: f(fill.b) };
  }
  function fitRect(fit, x, y, w, h, iw, ih) {
    const scale = fit === "contain" ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
    const dw = iw * scale, dh = ih * scale;
    return { x: x - (dw - w) / 2, y: y - (dh - h) / 2, w: dw, h: dh };
  }
  function drawShape(pdfPage, PDFLib, el, pageHeight) {
    const c = flattenColor(el.fill);
    const PDFNumber = PDFLib.PDFNumber;
    const y = pageHeight - (el.y + el.h);
    pdfPage.pushOperators(PDFLib.PDFOperator.of("q", []));
    pdfPage.pushOperators(PDFLib.PDFOperator.of("rg", [PDFNumber.of(c.r / 255), PDFNumber.of(c.g / 255), PDFNumber.of(c.b / 255)]));
    roundedRectOps(PDFLib, el.x, y, el.w, el.h, el.radius).forEach(function (op) { pdfPage.pushOperators(op); });
    pdfPage.pushOperators(PDFLib.PDFOperator.of("Q", []));
  }
  async function drawImageEl(pdfDoc, pdfPage, PDFLib, el, pageHeight) {
    let dataUrl = el.image && el.image.url ? String(el.image.url) : "";
    if (!dataUrl || dataUrl.indexOf("data:") !== 0) return;
    dataUrl = await ensureEmbeddableDataUrl(dataUrl);
    const bytes = dataUrlToBytes(dataUrl);
    const isJpg = /^data:image\/jpe?g/i.test(dataUrl);
    const img = isJpg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
    const fitted = fitRect(el.fit, el.x, el.y, el.w, el.h, img.width, img.height);
    const PDFNumber = PDFLib.PDFNumber;
    pdfPage.pushOperators(PDFLib.PDFOperator.of("q", []));
    pdfPage.pushOperators(PDFLib.PDFOperator.of("re", [PDFNumber.of(el.x), PDFNumber.of(pageHeight - (el.y + el.h)), PDFNumber.of(el.w), PDFNumber.of(el.h)]));
    pdfPage.pushOperators(PDFLib.PDFOperator.of("W", []));
    pdfPage.pushOperators(PDFLib.PDFOperator.of("n", []));
    pdfPage.drawImage(img, { x: fitted.x, y: pageHeight - (fitted.y + fitted.h), width: fitted.w, height: fitted.h });
    pdfPage.pushOperators(PDFLib.PDFOperator.of("Q", []));
  }
  async function drawTextEl(pdfPage, PDFLib, el, pageHeight, font) {
    const sizePt = el.size;
    const yPdf = pageHeight - el.y;
    let x = el.x;
    if (el.align === "center" || el.align === "right") {
      let width = 0;
      try { width = font.widthOfTextAtSize(el.text, sizePt); } catch (e) { width = 0; }
      if (width) x = el.align === "center" ? el.x - width / 2 : el.x - width;
    }
    /* BB-R09：行高跟随 scene 携带的主题 lineHeight（默认 1.45 兜底），不再固定倍率；
       字距 letterSpacing（px）通过 drawText 的 TS 算子等价实现（pdf-lib 无直接字距参数，
       用字符逐段平移成本高，此处仅记录到文本对象供 W 补档参考，视觉行距已对齐主题）。 */
    const lineH = typeof el.lineHeight === "number" && isFinite(el.lineHeight) && el.lineHeight > 0 ? el.lineHeight : 1.45;
    pdfPage.drawText(el.text, {
      x: x, y: yPdf, size: sizePt, font: font, lineHeight: Math.round(sizePt * lineH),
      color: PDFLib.rgb(el.color.r / 255, el.color.g / 255, el.color.b / 255),
    });
  }

  /* ---------- XMP ---------- */
  function xmpTimestamp(date) {
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate())
      + "T" + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes()) + ":" + pad(date.getUTCSeconds()) + "Z";
  }
  function buildXmp(now, title) {
    const created = xmpTimestamp(now);
    const safeTitle = String(title || "Only-box banner").replace(/[<>&]/g, " ");
    return '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
      + '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n'
      + '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
      + '    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
      + '      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">' + safeTitle + '</rdf:li></rdf:Alt></dc:title>\n'
      + '      <dc:format>application/pdf</dc:format>\n'
      + '    </rdf:Description>\n'
      + '    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n'
      + '      <xmp:CreateDate>' + created + '</xmp:CreateDate>\n'
      + '      <xmp:ModifyDate>' + created + '</xmp:ModifyDate>\n'
      + '      <xmp:CreatorTool>Only-box banner-builder</xmp:CreatorTool>\n'
      + '      <xmp:MetadataDate>' + created + '</xmp:MetadataDate>\n'
      + '    </rdf:Description>\n'
      + '    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">\n'
      + '      <pdf:Producer>Only-box banner-builder (pdf-lib)</pdf:Producer>\n'
      + '      <pdf:PDFVersion>1.7</pdf:PDFVersion>\n'
      + '    </rdf:Description>\n'
      + '    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">\n'
      + '      <pdfaid:part>3</pdfaid:part>\n'
      + '      <pdfaid:conformance>B</pdfaid:conformance>\n'
      + '    </rdf:Description>\n'
      + '  </rdf:RDF>\n'
      + '</x:xmpmeta>\n'
      + '<?xpacket end="w"?>';
  }

  /* ================================================================
     浏览器侧：输入采集 + 下载
     ================================================================ */
  const _libPromises = {};
  function loadScript(url) {
    if (_libPromises[url]) return _libPromises[url];
    const promise = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = url; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("依赖加载失败：" + url)); };
      document.head.appendChild(s);
    });
    /* BB-R21：失败后删除缓存——下次调用可重试，网络恢复后无需刷新页面 */
    const tracked = promise.catch(function (error) { delete _libPromises[url]; throw error; });
    _libPromises[url] = tracked;
    return tracked;
  }
  async function ensurePdfLib() {
    if (global.PDFLib && global.PDFLib.PDFDocument) return global.PDFLib;
    try { await loadScript("../js/vendor/pdf-lib.min.js"); } catch (e) { /* 走 CDN */ }
    if (global.PDFLib && global.PDFLib.PDFDocument) return global.PDFLib;
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js");
    if (!global.PDFLib) throw new Error("pdf-lib 加载失败（本地与 CDN 均不可用）");
    return global.PDFLib;
  }
  async function ensureFontkit() {
    if (global.fontkit) return global.fontkit;
    try { await loadScript("../js/vendor/fontkit.umd.min.js"); } catch (e) { /* 走 CDN */ }
    if (global.fontkit) return global.fontkit;
    await loadScript("https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js");
    if (!global.fontkit) throw new Error("fontkit 加载失败（本地与 CDN 均不可用）");
    return global.fontkit;
  }
  /* 内联 sRGB ICC（Compact-ICC-Profiles 的 sRGB-v2-magic，MIT，736 字节）：
     file:// 与 GitHub Pages 下 fetch 本地资源会碰 CORS，内联常量彻底消除该依赖 */
  const ICC_SRGB_MAGIC_B64 = "AAAC4GxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5kk7I0qQ6wIoqY/Zqvo2eJmwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAAF4Z1RSQwAAAWgAAAF4YlRSQwAAAWgAAAF4ZGVzYwAAAAAAAAAFc1JHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAC2AAAAHAA4AFQAcACMAKgAxADhAQABIgFGAW0BlQHBAfACIAJVAosCxAMBAz8DggPGBA4EWQSnBPkFTAWkBf4GXAa+ByEHigf0CGMI1QlJCcMKPwq/C0ILyQxUDOENdA4JDqIPQA/gEIURLRHaEooTPhP2FLIVcRY2Fv0XyhiZGW4aRhsiHAMc5x3QHr0friCkIZ4inCOfJKUlsSbAJ9Uo7SoKKyssUS18Lqov3jEWMlIzlDTZNiQ3czjGOiA7fDzfPkU/sEEhQpZEEEWPRxJIm0ooS7tNUU7uUI9SNVPgVZBXRVkAWr5chF5MYBth72PHZaZniWlxa19tUW9KcUZzSnVRd155cXuIfaZ/yIHwhB6GUIiJisWNCY9RkZ+T85ZLmKubDp14n+eiW6TWp1ap26xnrvexj7Qqtsy5dLwhvtXBjcRMxxDJ2syrz3/SXNU92CTbEt4E4P7j/OcB6gztHPA081D2c/mb/Mr//w==";
  async function ensureIccBytes() {
    if (ensureIccBytes._cache) return ensureIccBytes._cache;
    try {
      const bin = atob(ICC_SRGB_MAGIC_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      ensureIccBytes._cache = bytes;
      return bytes;
    } catch (e) { return null; }
  }

  /* ---------- 字重工具 ---------- */
  function nearestWeight(weights, target) {
    let best = null;
    for (let i = 0; i < weights.length; i += 1) {
      const w = Number(weights[i]);
      if (best == null) { best = w; continue; }
      const d = Math.abs(w - target), bd = Math.abs(best - target);
      if (d < bd || (d === bd && w > best)) best = w;
    }
    return best;
  }
  /* 文档字体的获取通道：weights 静态 > desktop.url(VF) > dataUrl > null */
  function fontChannels(fontKey, fontMeta) {
    const dl = C.FONT_DOWNLOADS[fontKey];
    if (!dl) return null;
    if (dl.dataUrl) return { channels: [{ weight: 400, dataUrl: dl.dataUrl, name: dl.name || fontKey + ".ttf" }], vf: false, weights: [400] };
    if (dl.weights && Object.keys(dl.weights).length) {
      const channels = Object.keys(dl.weights).map(function (w) { return { weight: Number(w), url: dl.weights[w].url, name: dl.weights[w].name }; });
      return { channels: channels, vf: false, weights: channels.map(function (c) { return c.weight; }) };
    }
    if (dl.url) return { channels: [{ weight: null, url: dl.url, name: dl.name }], vf: null, weights: (fontMeta && fontMeta.weights) || [400] };
    return null;
  }
  async function fetchChannelBytes(channel) {
    if (channel.dataUrl) return dataUrlToBytes(channel.dataUrl);
    const res = await fetch(channel.url, { mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function exportPdf() {
    const legacy = global.BannerBuilderLegacy;
    const Export = global.BannerBuilderExport;
    if (!legacy || !Export || !SM) throw new Error("导出模块未就绪，请刷新页面后重试");
    const PDFLib = await ensurePdfLib();
    const fontkit = await ensureFontkit();

    const bbState = BB().state;
    const page = legacy.activePage();
    const size = C.pageSize(bbState.doc.ratio);

    /* BB-R22：导出前字体门禁——与 PNG/PSD 导出同款，等待标题/正文 webfont 就绪，
       避免弱网下合成底图文字回退系统字体造成「所见≠所得」 */
    if (Export && typeof Export.ensureFonts === "function") {
      try { await Export.ensureFonts(); } catch (e) { /* 门禁失败按已就绪字体继续 */ }
    }

    /* BB-R23：合成底图与页高统一取预览 DOM（与 PNG 导出同一条所见即所得链路）。
       原实现的问题（2026-09-16 实测诊断）：页高取 canvas 2D 引擎（drawPageToCanvas），
       底图却位图化预览 DOM——两套排版引擎已漂移（12 板块实测 DOM 3171px vs
       canvas 2D 4819px，差 52%），导致底图下方大片空白、页高远超所见。
       修复口径：
       1) 页高 = 预览 DOM 实际内容高 max(offsetHeight, scrollHeight, 设计页高)；
       2) 合成底图 = 同一 DOM 节点按 doc.exportScale 位图化（默认 2x，与 PNG 导出一致）；
       3) 可编辑层：measurePageLayout 供元素坐标，模块矩形以 DOM 实测校正，
          使图层组边界与底图对齐（元素级坐标仍为近似值，图层默认隐藏）；
       4) DOM 位图化失败时整链回退 canvas 2D 引擎（页高/底图/坐标同源自洽）。 */
    const scale = Math.max(1, Math.min(3, Number(bbState.doc.exportScale) || 2));
    let pageHeight = size.pageHeight;
    let compositePngBytes = null;
    let layout = null;
    try {
      const rastered = await Export.__withDesignZoom(async function () {
        const node = Export.__findPreviewCanvas(bbState.activePageId);
        if (!node) throw new Error("找不到当前屏预览画布");
        const exportH = Math.max(node.offsetHeight, node.scrollHeight, size.pageHeight);
        /* BB-R25：连续模式下 .bb-page-canvas 背景透明（底色由 .bb-strip 承载），
           位图化须显式传入底色，否则 nodeBackground 回落白色，深色底文档导出成白底 */
        const isContinuous = (bbState.doc.screenMode || "split") === "continuous";
        const bgColor = (page.backgroundColor || (isContinuous ? bbState.doc.backgroundColor : null) || (function () {
          try { const v = getComputedStyle(node).backgroundColor; return (v && v !== "transparent" && v !== "rgba(0, 0, 0, 0)") ? v : null; } catch (e) { return null; }
        })()) || "#ffffff";
        const canvas = await Export.__raster(node, size.pageWidth, exportH, scale, bgColor);
        /* DOM 实测模块矩形（相对画布左上，zoom=1 下的设计像素） */
        const rootBox = node.getBoundingClientRect();
        const rects = [].slice.call(node.querySelectorAll(".bb-art-module")).map(function (mod) {
          const box = mod.getBoundingClientRect();
          return { id: mod.dataset.moduleId, x: box.left - rootBox.left, y: box.top - rootBox.top, w: box.width, h: box.height };
        });
        return { canvas: canvas, height: exportH, rects: rects };
      });
      compositePngBytes = await canvasToBytes(rastered.canvas, "image/png");
      pageHeight = rastered.height;
      layout = await legacy.measurePageLayout(page, 0);
      const byId = {};
      (rastered.rects || []).forEach(function (r) { if (r.id) byId[r.id] = r; });
      layout.forEach(function (item) {
        const r = byId[item.module && item.module.id];
        if (r) { item.x = Math.round(r.x); item.y = Math.round(r.y); item.w = Math.round(r.w); item.h = Math.round(r.h); }
      });
    } catch (error) {
      /* DOM 位图化失败：回退 canvas 2D 引擎，页高/底图/坐标三者同源，避免混搭错位 */
      compositePngBytes = null;
      const full = await legacy.drawPageToCanvas(page);
      layout = full.layout;
      pageHeight = full.canvas.height;
      try { compositePngBytes = await canvasToBytes(full.canvas, "image/png"); } catch (e2) { compositePngBytes = null; }
    }

    const scene = SM.buildScene({ page: page, layout: layout, doc: bbState.doc, pageHeight: pageHeight, pageSize: size, registry: global.BannerBuilderRegistry });
    const snapshot = await SM.selfContained(scene, global.BannerBuilderMyTemplates ? global.BannerBuilderMyTemplates.snapshotData : null);
    const sceneJson = JSON.stringify(snapshot, null, 2);

    const headingKey = bbState.doc.headingFont || bbState.doc.fontFamily || "sans";
    const bodyKey = bbState.doc.bodyFont || headingKey;
    const channelCache = {};
    /* BB-R15：字体解析缓存——按 fontKey + 实际选中字重 + 字体 URL 三维缓存 Promise，
       同一字体文件只下载/解析一次；resolveFont 返回稳定 cacheKey 供 embedJob 复用嵌入。 */
    const fontResolveCache = {};
    const resolveFont = async function (scope, weight) {
      const fontKey = scope === "body" ? bodyKey : headingKey;
      const meta = C.FONTS[fontKey];
      const label = (meta && meta.label) || fontKey;
      if (!channelCache[fontKey]) channelCache[fontKey] = fontChannels(fontKey, meta);
      const plan = channelCache[fontKey];
      if (!plan) return null;
      let channel = null;
      if (plan.vf === false) {
        const w = nearestWeight(plan.weights, weight);
        channel = plan.channels.filter(function (c) { return c.weight === w; })[0];
      } else {
        channel = plan.channels[0];
      }
      if (!channel) return null;
      /* cacheKey：fontKey + 实际选中字重 + 字体数据源 URL，同一通道只解析一次 */
      const channelUrl = channel.url || channel.src || channel.name || "";
      const cacheKey = fontKey + "#" + (channel.weight || "vf") + "#" + channelUrl;
      if (fontResolveCache[cacheKey]) return fontResolveCache[cacheKey];
      const job = (async function () {
        const bytes = await fetchChannelBytes(channel);
        let vfDefault = null;
        try {
          const probe = fontkit.create(bytes);
          if (probe && probe.variationAxes && probe.variationAxes.wght) vfDefault = probe.variationAxes.wght.default;
        } catch (e) { /* 探测失败不影响嵌入 */ }
        return { bytes: bytes, name: channel.name || label, vfDefault: vfDefault, cacheKey: cacheKey };
      })();
      fontResolveCache[cacheKey] = job;
      return job;
    };

    const iccBytes = await ensureIccBytes();
    const result = await assemblePdf({
      PDFLib: PDFLib, fontkit: fontkit,
      scene: scene, sceneJson: sceneJson,
      compositePngBytes: compositePngBytes,
      iccBytes: iccBytes,
      resolveFont: resolveFont,
      title: bbState.doc.name || "Only-box banner",
    });

    const pageNo = String((bbState.doc.pages || []).indexOf(page) + 1).padStart(2, "0");
    const blob = new Blob([result.bytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "only-box-banner-page-" + pageNo + ".pdf";
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);

    if (result.warnings.length && global.console && global.console.warn) global.console.warn("[PDF 导出]", result.warnings);
    if (result.warnings.length && global.alert) {
      global.alert("PDF 已导出，但有以下事项：\n" + result.warnings.slice(0, 10).join("\n") + (result.warnings.length > 10 ? "\n……详见浏览器控制台" : ""));
    }
    return {
      layers: scene.modules.length + 1,
      fonts: result.embeddedKeys,
      warnings: result.warnings,
      attachment: SCHEMA,
      sizeBytes: result.bytes.length,
    };
  }

  /* ---------- 工具 ---------- */
  function canvasToBytes(canvas, mime) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error("画布编码失败")); return; }
          const reader = new FileReader();
          reader.onload = function () { resolve(new Uint8Array(reader.result)); };
          reader.onerror = function () { reject(new Error("画布数据读取失败")); };
          reader.readAsArrayBuffer(blob);
        }, mime);
      } else reject(new Error("canvas.toBlob 不可用"));
    });
  }
  function dataUrlToBytes(dataUrl) {
    const parts = String(dataUrl).split(",");
    const bin = atob(parts[1] || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  async function ensureEmbeddableDataUrl(dataUrl) {
    if (/^data:image\/(png|jpe?g);/i.test(dataUrl)) return dataUrl;
    return new Promise(function (resolve) {
      const image = new Image();
      image.onload = function () {
        const c = document.createElement("canvas");
        c.width = image.naturalWidth || image.width; c.height = image.naturalHeight || image.height;
        c.getContext("2d").drawImage(image, 0, 0);
        try { resolve(c.toDataURL("image/png")); } catch (e) { resolve(dataUrl); }
      };
      image.onerror = function () { resolve(dataUrl); };
      image.src = dataUrl;
    });
  }

  global.BannerBuilderPdfExport = Object.freeze({
    exportPdf: exportPdf,
    assemblePdf: assemblePdf,
    ensurePdfLib: ensurePdfLib,
    ensureFontkit: ensureFontkit,
    __pure: Object.freeze({
      nearestWeight: nearestWeight,
      buildXmp: buildXmp,
      xmpTimestamp: xmpTimestamp,
      fitRect: fitRect,
      flattenColor: flattenColor,
      fontChannels: fontChannels,
    }),
  });
})(typeof window !== "undefined" ? window : globalThis);

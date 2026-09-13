/* js/font-file-meta.js —— 字体文件元数据解析（纯前端，无依赖）
   从 .ttf/.otf/.woff/.woff2 的字节流中解析：
   - family（name 表 nameID=1，用于 FontFace 注册与 canvas 引用）
   - format（sfnt 标签判断，用于 @font-face src format）
   - weightClass（OS/2 表 usWeightClass，静态字体的真实字重档）
   - 可变字体信息（fvar 表 wght 轴 min/default/max），用于字重轴拖动
   对外暴露 window.OnlyBoxFontMeta.parse(arrayBuffer)；解析失败时 family 为 null，调用方自行兜底。 */

(function (global) {
  "use strict";

  function ascii(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  }
  function utf16be(bytes) {
    var out = "";
    for (var i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  function utf8(bytes) {
    try { return new TextDecoder("utf-8").decode(bytes); } catch (e) { return ascii(bytes); }
  }
  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function fixed(b, o) { return u32(b, o) / 65536; }

  /* 返回 { family, format, weightClass, isVariable, wghtMin, wghtMax, wghtDefault } */
  function parse(arrayBuffer) {
    var out = { family: null, format: null, weightClass: null, isVariable: false, wghtMin: null, wghtMax: null, wghtDefault: null };
    var b = new Uint8Array(arrayBuffer);
    if (b.length < 12) return out;

    var tag = ascii(b.subarray(0, 4));
    if (tag === "OTTO") out.format = "opentype";
    else if (tag === "true") out.format = "truetype";
    else if (tag === "wOFF") out.format = "woff";
    else if (tag === "wOF2") out.format = "woff2";
    else if (b[0] === 0x00 && b[1] === 0x01) out.format = "truetype";
    else out.format = "truetype";

    /* woff/woff2 是压缩容器，表目录不直接可读；仅输出 format，其余交给浏览器 */
    if (tag === "wOFF" || tag === "wOF2") return out;

    try {
      var numTables = u16(b, 4);
      var tables = {};
      for (var i = 0; i < numTables && i < 512; i += 1) {
        var base = 12 + i * 16;
        tables[ascii(b.subarray(base, base + 4))] = u32(b, base + 8);
      }
      /* name 表 → family：优先 nameID=16（Typographic Family，可变字体的真实家族名），
         回落 nameID=1（Legacy Family；部分 VF 的 nameID=1 是首个命名实例，如 "Montserrat Thin"）。
         记录选择优先 Windows/zh-CN 与 en-US。 */
      if (tables.name != null) {
        var nameOff = tables.name;
        var count = u16(b, nameOff + 2);
        var stringOff = nameOff + u16(b, nameOff + 4);
        var best16 = null, best1 = null, any16 = null, any1 = null;
        for (var j = 0; j < count; j += 1) {
          var rec = nameOff + 6 + j * 12;
          var platformId = u16(b, rec), encodingId = u16(b, rec + 2);
          var languageId = u16(b, rec + 4), nameId = u16(b, rec + 6);
          var length = u16(b, rec + 8), offset = u16(b, rec + 10);
          if (nameId !== 1 && nameId !== 16) continue;
          var slice = b.subarray(stringOff + offset, stringOff + offset + length);
          var str = platformId === 0 ? (encodingId === 3 ? utf8(slice) : utf16be(slice)) : platformId === 3 ? utf16be(slice) : null;
          if (!str || !str.trim()) continue;
          str = str.replace(/\u0000+$/, "").trim();
          /* Windows 平台：优先简体中文(0x804) 与美式英语(0x409) 记录；繁中(0x404) 次之 */
          var preferred = platformId === 3 && (languageId === 0x409 || languageId === 0x804);
          if (nameId === 16) {
            if (preferred) { best16 = str; break; }
            if (!any16) any16 = str;
          } else {
            if (preferred && !best1) best1 = str;
            else if (platformId === 3 && !best1 && !any1) any1 = str;
          }
        }
        out.family = best16 || any16 || best1 || any1 || null;
      }
      /* OS/2 表 → usWeightClass（静态字体真实字重） */
      if (tables["OS/2"] != null) {
        var os2 = tables["OS/2"];
        if (os2 + 6 <= b.length) out.weightClass = u16(b, os2 + 4);
      }
      /* fvar 表 → wght 轴范围（可变字体字重轴） */
      if (tables.fvar != null) {
        var fvar = tables.fvar;
        if (fvar + 16 <= b.length) {
          var axisCount = u16(b, fvar + 8);
          var axesOffset = fvar + u16(b, fvar + 4);
          for (var k = 0; k < axisCount; k += 1) {
            var axis = axesOffset + k * 20;
            if (ascii(b.subarray(axis, axis + 4)) === "wght") {
              out.isVariable = true;
              out.wghtMin = Math.round(fixed(b, axis + 4));
              out.wghtDefault = Math.round(fixed(b, axis + 8));
              out.wghtMax = Math.round(fixed(b, axis + 12));
              break;
            }
          }
        }
      }
    } catch (e) { /* 结构异常时按兜底流程处理 */ }
    return out;
  }

  global.OnlyBoxFontMeta = Object.freeze({ parse: parse });
})(window);

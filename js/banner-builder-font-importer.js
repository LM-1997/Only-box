/* banner-builder-font-importer.js —— 用户自定义字体导入模块
   纯前端无后端：用户从本地选取 .ttf/.otf/.woff/.woff2 字体文件，读取为 dataURL
   存入浏览器 IndexedDB（跨会话保留），并注入 BannerBuilderConstants.FONTS，
   使导入字体可在「全局 / 标题 / 正文」三个字体下拉中选用，预览与导出（PNG/PSD/长图）
   均能正确渲染，导出 PSD 时若勾选「打包字体」也会把导入字体一并打进 ZIP。
   依赖：banner-builder-constants.js 先行加载；对外暴露 BannerBuilderFontImporter。 */

(function (global) {
  "use strict";

  var C = global.BannerBuilderConstants;

  var DB_NAME = "only-box-banner-fonts";
  var DB_VERSION = 1;
  var STORE = "fonts";
  var dbPromise = null;

  /* ================================================================
     IndexedDB 存取
     ================================================================ */
  function dbOpen() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB || typeof global.indexedDB.open !== "function") { dbPromise = null; reject(new Error("当前环境不支持 IndexedDB")); return; }
      var req;
      try { req = global.indexedDB.open(DB_NAME, DB_VERSION); } catch (error) { dbPromise = null; reject(error); return; }
      req.onupgradeneeded = function (event) { var db = event.target.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = function (event) { resolve(event.target.result); };
      req.onerror = function () { dbPromise = null; reject(req.error || new Error("打开字体库失败")); };
      req.onblocked = function () { dbPromise = null; reject(new Error("字体库被占用")); };
    });
    return dbPromise;
  }

  function run(mode, method, value) {
    return new Promise(function (resolve, reject) {
      dbOpen().then(function (db) {
        var tx;
        try { tx = db.transaction(STORE, mode === "readonly" ? "readonly" : "readwrite"); } catch (error) { reject(error); return; }
        var store = tx.objectStore(STORE);
        var req;
        try { req = store[method](value); } catch (error) { reject(error); return; }
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error("字体库读写失败")); };
      }, reject);
    });
  }

  function listFonts() {
    return run("readonly", "getAll").then(function (rows) {
      return (rows || []).sort(function (a, b) { return (b.uploadedAt || 0) - (a.uploadedAt || 0); });
    });
  }

  function addFont(record) { return run("readwrite", "put", record); }
  function removeFont(id) { return run("readwrite", "delete", id); }
  function isAvailable() { return typeof global.indexedDB !== "undefined" && typeof global.indexedDB.open === "function"; }

  /* ================================================================
     字体文件 name 表解析：读取真实 family（用于预览/导出正确引用 @font-face）
     ================================================================ */
  function bytesToAscii(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  }
  function utf16beDecode(bytes) {
    var out = "";
    for (var i = 0; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
  }
  function utf8Decode(bytes) {
    try { return new TextDecoder("utf-8").decode(bytes); } catch (e) { return bytesToAscii(bytes); }
  }
  function decodeName(platformId, encodingId, bytes) {
    if (platformId === 0) return encodingId === 3 ? utf8Decode(bytes) : utf16beDecode(bytes);
    if (platformId === 3) return utf16beDecode(bytes);
    return null; // Macintosh(1) 等旧编码忽略，优先取 Windows/Unicode 记录
  }

  /* 返回 { family, format }；失败时 family 为 null */
  function parseFontMeta(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 12) return { family: null, format: null };
    var tag = bytesToAscii(bytes.subarray(0, 4));
    var format;
    if (tag === "OTTO") format = "opentype";
    else if (tag === "true") format = "truetype";
    else if (tag === "wOFF") format = "woff";
    else if (tag === "wOF2") format = "woff2";
    else if (bytes[0] === 0x00 && bytes[1] === 0x01) format = "truetype"; // magic 0x00010000
    else format = "truetype";

    var family = null;
    try {
      var numTables = (bytes[4] << 8) | bytes[5];
      var nameOffset = -1;
      for (var i = 0; i < numTables; i += 1) {
        var base = 12 + i * 16;
        var tagName = bytesToAscii(bytes.subarray(base, base + 4));
        if (tagName !== "name") continue;
        nameOffset = (bytes[base + 8] << 24) | (bytes[base + 9] << 16) | (bytes[base + 10] << 8) | bytes[base + 11];
        break;
      }
      if (nameOffset < 0) return { family: null, format: format };
      var count = (bytes[nameOffset + 2] << 8) | bytes[nameOffset + 3];
      var stringOffset = nameOffset + (bytes[nameOffset + 4] << 8 | bytes[nameOffset + 5]);
      var best = null;
      var any = null;
      for (var j = 0; j < count; j += 1) {
        var rec = nameOffset + 6 + j * 12;
        var platformId = (bytes[rec] << 8) | bytes[rec + 1];
        var encodingId = (bytes[rec + 2] << 8) | bytes[rec + 3];
        var languageId = (bytes[rec + 4] << 8) | bytes[rec + 5];
        var nameId = (bytes[rec + 6] << 8) | bytes[rec + 7];
        var length = (bytes[rec + 8] << 8) | bytes[rec + 9];
        var offset = (bytes[rec + 10] << 8) | bytes[rec + 11];
        if (nameId !== 1) continue; // Family
        var slice = bytes.subarray(stringOffset + offset, stringOffset + offset + length);
        var str = decodeName(platformId, encodingId, slice);
        if (!str || !str.trim()) continue;
        str = str.replace(/\u0000+$/, "").trim();
        if (platformId === 3 && languageId === 0x409) { best = str; break; }
        if (platformId === 3 && !best) best = str;
        else if (!any) any = str;
      }
      family = best || any || null;
    } catch (e) {
      family = null;
    }
    return { family: family, format: format };
  }

  /* ================================================================
     注入到 Constants（使 ensureFont / fontStack / buildFontCss / packFontsZip 全链路识别）
     ================================================================ */
  function applyToConstants() {
    var fonts = [];
    try {
      // 同步场景下（listFonts 为异步）此函数由 banner-builder.js 在 await listFonts 后调用，
      // 直接读取内部缓存列表注入，避免再次异步。
      fonts = _cache || [];
    } catch (e) { fonts = []; }
    if (!C || !C.FONTS) return fonts;
    fonts.forEach(function (f) {
      if (!f || !f.id || !f.dataUrl) return;
      C.FONTS[f.id] = { label: f.label || f.family, family: f.family, src: [{ url: f.dataUrl, format: f.format || "truetype" }] };
      C.FONT_DOWNLOADS[f.id] = { url: "", dataUrl: f.dataUrl, name: f.fileName || (f.id + "." + (f.format || "ttf")) };
    });
    return fonts;
  }

  var _cache = [];
  function refresh() {
    return listFonts().then(function (rows) { _cache = rows; return rows; }).catch(function () { _cache = []; return []; });
  }

  /* 便捷构造导入记录 */
  function buildRecord(input) {
    var id = input.id || ("cx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    return {
      id: id,
      label: input.label || input.family || input.fileName,
      family: input.family || input.label || "OnlyBoxCustomFont",
      format: input.format || "truetype",
      fileName: input.fileName || "",
      dataUrl: input.dataUrl || "",
      uploadedAt: input.uploadedAt || Date.now(),
    };
  }

  global.BannerBuilderFontImporter = Object.freeze({
    isAvailable: isAvailable,
    listFonts: listFonts,
    addFont: addFont,
    removeFont: removeFont,
    parseFontMeta: parseFontMeta,
    buildRecord: buildRecord,
    applyToConstants: applyToConstants,
    refresh: refresh,
  });
})(window);
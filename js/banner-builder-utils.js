(function (global) {
  "use strict";

  var C = global.BannerBuilderConstants;

  /* 主题字段拼进 class 名前的清理：枚举外/含空格的值回退默认，防 DOMException 与 class 语义破坏 */
  function safeClassSuffix(value, fallback) {
    var token = C.safeCssToken(value);
    return /^[a-z0-9_-]+$/i.test(token) ? token : fallback;
  }

  function hexToRgba(value, alpha) {
    var raw = String(value || "").trim().replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(raw)) return "";
    var number = parseInt(raw, 16);
    return "rgba(" + ((number >> 16) & 255) + "," + ((number >> 8) & 255) + "," + (number & 255) + "," + Math.max(0, Math.min(1, alpha)) + ")";
  }

  function alphaColor(value, alpha) {
    var raw = hexToRgba(value, alpha);
    return raw || value || "";
  }

  function legacyCopyText(text) {
    try {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(area);
      return !!ok;
    } catch (error) { return false; }
  }

  function copyTextToClipboard(text) {
    return new Promise(function (resolve) {
      var value = String(text == null ? "" : text);
      if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === "function") {
        global.navigator.clipboard.writeText(value).then(function () { resolve(true); }, function () { resolve(legacyCopyText(value)); });
        return;
      }
      resolve(legacyCopyText(value));
    });
  }

  function downloadBlob(blob, name) {
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function downloadText(content, name) {
    downloadBlob(new Blob([content], { type: "application/json;charset=utf-8" }), name);
  }

  function dataUrlToBlob(dataUrl) {
    var comma = dataUrl.indexOf(",");
    if (comma < 0) throw new Error("数据格式错误");
    var meta = dataUrl.slice(0, comma).match(/^data:([^;]+)/);
    var mime = meta ? meta[1] : "application/octet-stream";
    var bin = atob(dataUrl.slice(comma + 1));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  var wrapCache = new Map();
  function wrapLines(ctx, value, maxWidth) {
    var key = ctx.font + "|" + Math.round(maxWidth) + "|" + value;
    var hit = wrapCache.get(key);
    if (hit) return hit;
    var result = [];
    String(value || "").split("\n").forEach(function (line) {
      var current = "";
      Array.from(line).forEach(function (char) {
        var next = current + char;
        if (ctx.measureText(next).width > maxWidth && current) {
          result.push(current);
          current = char;
        } else current = next;
      });
      result.push(current);
    });
    if (wrapCache.size > 4000) wrapCache.clear();
    wrapCache.set(key, result);
    return result;
  }

  function clearWrapCache() {
    wrapCache.clear();
  }

  function capText(value, limit) {
    var out = String(value || "").trim();
    return out.length > limit ? out.slice(0, limit) + "\u2026" : out;
  }

  function dataUrlToBlobRecord(value) {
    try {
      var parts = String(value.url).split(",");
      if (!parts[1] || parts[1].length > 32000000) return value;
      var meta = parts[0].match(/^data:([^;]+)/);
      var mime = meta ? meta[1] : "image/png";
      var bin = atob(parts[1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return { url: URL.createObjectURL(new Blob([bytes], { type: mime })), name: value.name, type: mime };
    } catch (error) { return value; }
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + "MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + "KB";
    return bytes + "B";
  }

  function hexToColor(value) {
    return String(value || "").match(/^#[0-9a-f]{6}$/i) ? value.toLowerCase() : "#000000";
  }

  global.BannerBuilderUtils = {
    safeClassSuffix: safeClassSuffix,
    hexToRgba: hexToRgba,
    alphaColor: alphaColor,
    legacyCopyText: legacyCopyText,
    copyTextToClipboard: copyTextToClipboard,
    downloadBlob: downloadBlob,
    downloadText: downloadText,
    dataUrlToBlob: dataUrlToBlob,
    wrapLines: wrapLines,
    clearWrapCache: clearWrapCache,
    capText: capText,
    dataUrlToBlobRecord: dataUrlToBlobRecord,
    formatBytes: formatBytes,
    hexToColor: hexToColor,
  };

})(window);
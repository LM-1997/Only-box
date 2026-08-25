(function (global) {
  "use strict";

  /* 需求文档算法 A：中文文本逐字符贪心换行。调用前需先设置 ctx.font。 */
  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let line = "";
    for (const ch of String(text)) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line !== "") {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /* 需求文档算法 A 补充：按最大行数截断，末行以省略号收尾且不超宽。 */
  function wrapTextWithLimit(ctx, text, maxWidth, maxLines) {
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > maxWidth) {
      last = last.slice(0, -1);
    }
    kept[maxLines - 1] = last + "…";
    return kept;
  }

  /* 需求文档算法 B：字号自适应缩放（二分查找）。 */
  function fitFontSize(ctx, text, maxWidth, options) {
    const config = options || {};
    const maxFontSize = config.maxFontSize || 80;
    const minFontSize = config.minFontSize || 12;
    const fontFamily = config.fontFamily || "sans-serif";
    const weight = config.weight || "bold";
    let lo = minFontSize;
    let hi = maxFontSize;
    let best = minFontSize;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      ctx.font = weight + " " + mid + "px " + fontFamily;
      if (ctx.measureText(text).width <= maxWidth) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  /* 需求文档算法 C：手工实现 object-fit: contain / cover。 */
  function drawContain(ctx, img, dx, dy, dw, dh) {
    const scale = Math.min(dw / img.naturalWidth, dh / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const x = dx + (dw - w) / 2;
    const y = dy + (dh - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  function drawCover(ctx, img, dx, dy, dw, dh) {
    const scale = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
    const cropW = dw / scale;
    const cropH = dh / scale;
    const sx = (img.naturalWidth - cropW) / 2;
    const sy = (img.naturalHeight - cropH) / 2;
    ctx.drawImage(img, sx, sy, cropW, cropH, dx, dy, dw, dh);
  }

  /* 需求文档算法 D：批量任务分帧执行 + 进度播报。 */
  async function processBatch(items, handler, options) {
    const config = options || {};
    const chunkSize = config.chunkSize || 5;
    for (let i = 0; i < items.length; i++) {
      await handler(items[i], i);
      if ((i + 1) % chunkSize === 0 || i === items.length - 1) {
        if (config.onProgress) config.onProgress(i + 1, items.length);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  /* 需求文档算法 E：安全的自然日日期差计算。 */
  function daysUntil(targetDateStr, now) {
    const parts = String(targetDateStr).split("-").map(Number);
    if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return NaN;
    const target = new Date(parts[0], parts[1] - 1, parts[2]);
    const reference = now ? new Date(now) : new Date();
    const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    return Math.round((target - today) / 86400000);
  }

  /* 需求文档算法 F：文件名安全化。 */
  function sanitizeFilename(name, fallback) {
    const cleaned = name === null || name === undefined ? "" : String(name).replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 80);
    return cleaned || (fallback || "untitled");
  }

  /* 批量导出重名计数后缀：同名依次追加 _2 / _3。 */
  function uniqueFilename(name, usedNames) {
    const used = usedNames || new Map();
    const base = String(name).replace(/\.png$/i, "");
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    if (count === 0) return base + ".png";
    return base + "_" + (count + 1) + ".png";
  }

  /* 需求文档算法 G：JSZip 标准调用范式 + canvas 转 blob。浏览器环境专用。 */
  function canvasToBlob(canvas, type) {
    return new Promise(resolve => canvas.toBlob(resolve, type || "image/png"));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportZip(files, zipFilename) {
    if (!global.MobileImageUpload || typeof global.MobileImageUpload.ensureZip !== "function") {
      throw new Error("DEPENDENCY_LOAD_FAILED");
    }
    const JSZip = await global.MobileImageUpload.ensureZip();
    const zip = new JSZip();
    files.forEach(file => zip.file(file.name, file.blob));
    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, zipFilename);
  }

  /* 需求三补充：A4 拼版网格几何（纯计算，供测试）。 */
  function printGridCells(pageW, pageH, cols, rows, margin) {
    const cells = [];
    const cellW = (pageW - margin * (cols + 1)) / cols;
    const cellH = (pageH - margin * (rows + 1)) / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        cells.push({
          row,
          col,
          dx: margin + col * (cellW + margin),
          dy: margin + row * (cellH + margin),
          dw: cellW,
          dh: cellH
        });
      }
    }
    return cells;
  }

  function printPageAssignment(imageIndex, cellsPerPage) {
    const pageIndex = Math.floor(imageIndex / cellsPerPage);
    const cellIndex = imageIndex % cellsPerPage;
    return { pageIndex, cellIndex };
  }

  /* 需求二补充：批量文本解析（每行"摊位号,名称"，名称可空）。 */
  function parseSignLines(text) {
    return String(text)
      .split(/\r?\n/)
      .map(line => line.split(/[，,]/))
      .filter(parts => parts.length && parts.join("").trim() !== "")
      .map(parts => ({ code: (parts[0] || "").trim(), name: (parts[1] || "").trim() }))
      .filter(item => item.code !== "");
  }

  global.CanvasUtils = Object.freeze({
    wrapText,
    wrapTextWithLimit,
    fitFontSize,
    drawContain,
    drawCover,
    processBatch,
    daysUntil,
    sanitizeFilename,
    uniqueFilename,
    canvasToBlob,
    downloadBlob,
    exportZip,
    printGridCells,
    printPageAssignment,
    parseSignLines
  });
})(typeof window !== "undefined" ? window : globalThis);

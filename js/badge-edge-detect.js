(function (global) {
  "use strict";

  /*
   * badge-edge-detect.js
   * 证件/头像的边缘检测模块，服务于 badge-generator。
   * 提供两个纯算法（输入原始 RGBA 像素，输出矩形坐标，便于单测）与一个浏览器侧取像素辅助。
   *
   * 1. contentBoundsFromRgba —— 检测「照片内容边界」，用于裁掉头像照片四周的留白（自动裁剪到像素边缘）。
   * 2. avatarFrameFromRgba —— 检测「证件背景图上的头像框内边缘」，用于自动定位头像框。
   * 3. imageToRgba —— 把 HTMLImageElement 降采样到离屏 canvas 并取出 RGBA。
   *
   * 坐标约定：所有返回的 {x, y, width, height} 都是相对「传入像素」的坐标（含 imageToRgba 的降采样坐标）。
   * 调用方负责按 原图尺寸 / 分析尺寸 的比例映射回原图坐标。
   */

  var DEFAULTS = {
    // 留白/背景判定：与背景色的曼哈顿距离小于该阈值视为背景（用于去留白）
    contentBgTolerance: 24,
    // 内容区域最小占比：低于该比例视为「无留白 / 内容过小」，返回 null 保持原样
    contentMinRatio: 0.08,
    // 头像框检测（留白通道）：留白灰度阈值（> 该值视为近白留白）
    frameWhiteGray: 225,
    // 头像框检测（留白通道）：三通道最大差容差（白/浅灰可能带轻微噪点或偏色）
    frameWhiteSpread: 42,
    // 头像框检测（留白通道）：行/列投影中「留白像素数」达到投影峰值的该比例才认为是头像框内部（自适应阈值）
    framePeakRatio: 0.45,
    // 头像框检测（框线通道）：最小梯度幅值，低于此视为无明显框线
    frameEdgeMinMag: 24,
    // 头像框检测（框线通道）：强边缘阈值 = 最大梯度 × 该比例
    frameEdgeThrRatio: 0.22,
    // 头像框面积占整图比例的合理范围（过滤过大/过小候选）
    frameAreaMin: 0.015,
    frameAreaMax: 0.9,
    // 头像框宽高比合理范围（矩形 / 圆角矩形）
    frameAspectMin: 0.35,
    frameAspectMax: 2.8
  };

  function clamp01(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function grayOf(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  /* 取像素，越界安全返回 null。 */
  function pixelAt(rgba, width, height, x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const i = (y * width + x) * 4;
    return { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2], a: rgba[i + 3] };
  }

  function manhattan(p, q) {
    return Math.abs(p.r - q.r) + Math.abs(p.g - q.g) + Math.abs(p.b - q.b);
  }

  /* 采样四个角点像素，估算背景色（留白通常白/浅色，但兼容纯色证件照背景）。 */
  function estimateBackground(rgba, width, height) {
    const corners = [
      pixelAt(rgba, width, height, 0, 0),
      pixelAt(rgba, width, height, width - 1, 0),
      pixelAt(rgba, width, height, 0, height - 1),
      pixelAt(rgba, width, height, width - 1, height - 1)
    ].filter(Boolean);
    if (!corners.length) return { r: 255, g: 255, b: 255 };
    const sum = corners.reduce((acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }), { r: 0, g: 0, b: 0 });
    const n = corners.length;
    return { r: Math.round(sum.r / n), g: Math.round(sum.g / n), b: Math.round(sum.b / n) };
  }

  /*
   * 检测照片内容边界（去留白）。
   * 思路：估算四角背景色，从上下左右四边向中心扫描，找到第一个「非背景」像素，即内容边缘。
   * 返回 {x, y, width, height}，或 null（无留白 / 内容过小，保持原样）。
   */
  function contentBoundsFromRgba(rgba, width, height, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (!width || !height) return null;
    const bg = estimateBackground(rgba, width, height);

    const isBackground = (x, y) => {
      const p = pixelAt(rgba, width, height, x, y);
      return p ? manhattan(p, bg) < o.contentBgTolerance : true;
    };

    let top = -1, bottom = -1, left = -1, right = -1;

    // 上边
    for (let y = 0; y < height; y++) {
      let allBg = true;
      for (let x = 0; x < width; x++) { if (!isBackground(x, y)) { allBg = false; break; } }
      if (!allBg) { top = y; break; }
    }
    // 下边
    for (let y = height - 1; y >= 0; y--) {
      let allBg = true;
      for (let x = 0; x < width; x++) { if (!isBackground(x, y)) { allBg = false; break; } }
      if (!allBg) { bottom = y; break; }
    }
    // 左边
    for (let x = 0; x < width; x++) {
      let allBg = true;
      for (let y = 0; y < height; y++) { if (!isBackground(x, y)) { allBg = false; break; } }
      if (!allBg) { left = x; break; }
    }
    // 右边
    for (let x = width - 1; x >= 0; x--) {
      let allBg = true;
      for (let y = 0; y < height; y++) { if (!isBackground(x, y)) { allBg = false; break; } }
      if (!allBg) { right = x; break; }
    }

    if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;

    const cw = right - left + 1;
    const ch = bottom - top + 1;
    // 内容过小（几乎整张都是留白）视为无效，返回 null
    if (cw < width * o.contentMinRatio || ch < height * o.contentMinRatio) return null;
    // 内容已接近整图（无明显留白），返回 null 保持原样
    if (cw >= width - 2 && ch >= height - 2 && left <= 1 && top <= 1) return null;

    return { x: left, y: top, width: cw, height: ch };
  }

  /*
   * 检测证件背景图上的头像框内边缘。
   * 头像框特征（用户约定）：一般留白、一般在中间、矩形 / 圆角矩形，框线可能有颜色。
   * 采用双通道检测：
   *   通道 A（留白）：对「近白留白」像素做行列投影，找连续留白矩形 —— 适合「彩色底 + 白留白框」。
   *   通道 B（框线）：灰度梯度找强边缘，行列投影定位闭合框线的四条边 —— 适合「白/浅底 + 彩色框线」。
   * 通道 A 优先，失败后回退通道 B；都失败返回 null（由调用方提示手动调整）。
   */
  function avatarFrameFromRgba(rgba, width, height, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (!width || !height) return null;
    // 背景本身白/浅色（整图留白占比高）时，留白通道不可靠（会把贯穿整图的条带误判成框），
    // 直接走框线边缘通道。
    const whiteRatio = countWhiteRatio(rgba, width, height, o);
    if (whiteRatio < 0.8) {
      const viaWhite = detectFrameByWhite(rgba, width, height, o);
      if (viaWhite) return viaWhite;
    }
    return detectFrameByEdge(rgba, width, height, o);
  }

  /* 统计整图「近白留白」像素占比。 */
  function countWhiteRatio(rgba, width, height, o) {
    let white = 0;
    const total = width * height;
    for (let i = 0; i < total; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      const gy = grayOf(r, g, b);
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (gy >= o.frameWhiteGray && spread <= o.frameWhiteSpread) white++;
    }
    return white / total;
  }

  /* 通道 A：留白检测。 */
  function detectFrameByWhite(rgba, width, height, o) {
    const rowCount = new Array(height).fill(0);
    const colCount = new Array(width).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = pixelAt(rgba, width, height, x, y);
        if (!p) continue;
        const g = grayOf(p.r, p.g, p.b);
        const spread = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
        if (g >= o.frameWhiteGray && spread <= o.frameWhiteSpread) {
          rowCount[y]++;
          colCount[x]++;
        }
      }
    }
    const rowPeak = Math.max.apply(null, rowCount);
    const colPeak = Math.max.apply(null, colCount);
    if (rowPeak < Math.max(4, width * 0.05) || colPeak < Math.max(4, height * 0.05)) return null;
    const rowThr = Math.max(4, Math.round(rowPeak * o.framePeakRatio));
    const colThr = Math.max(4, Math.round(colPeak * o.framePeakRatio));

    const rowBands = findBands(rowCount, rowThr);
    const colBands = findBands(colCount, colThr);
    if (!rowBands.length || !colBands.length) return null;
    return scoreCandidates(rowBands, colBands, width, height, o);
  }

  /* 通道 B：框线边缘检测。 */
  function detectFrameByEdge(rgba, width, height, o) {
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = pixelAt(rgba, width, height, x, y);
        gray[y * width + x] = p ? grayOf(p.r, p.g, p.b) : 255;
      }
    }
    // 梯度幅值（中心差分近似）
    let maxMag = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const gx = x < width - 1 ? Math.abs(gray[i + 1] - gray[i]) : 0;
        const gy = y < height - 1 ? Math.abs(gray[i + width] - gray[i]) : 0;
        const m = gx + gy;
        if (m > maxMag) maxMag = m;
      }
    }
    if (maxMag < o.frameEdgeMinMag) return null;
    const thr = Math.max(20, maxMag * o.frameEdgeThrRatio);

    // 强边缘行列投影
    const rowCount = new Array(height).fill(0);
    const colCount = new Array(width).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const gx = x < width - 1 ? Math.abs(gray[i + 1] - gray[i]) : 0;
        const gy = y < height - 1 ? Math.abs(gray[i + width] - gray[i]) : 0;
        if (gx + gy >= thr) { rowCount[y]++; colCount[x]++; }
      }
    }

    const rowPeak = Math.max.apply(null, rowCount);
    const colPeak = Math.max.apply(null, colCount);
    if (rowPeak < Math.max(6, width * 0.04) || colPeak < Math.max(6, height * 0.04)) return null;

    // 框线四边：从上/下/左/右找到第一条强边缘带（框线外边界）
    const rowThr = Math.max(6, Math.round(rowPeak * 0.5));
    const colThr = Math.max(6, Math.round(colPeak * 0.5));
    let top = -1, bottom = -1, left = -1, right = -1;
    for (let y = 0; y < height; y++) { if (rowCount[y] >= rowThr) { top = y; break; } }
    for (let y = height - 1; y >= 0; y--) { if (rowCount[y] >= rowThr) { bottom = y; break; } }
    for (let x = 0; x < width; x++) { if (colCount[x] >= colThr) { left = x; break; } }
    for (let x = width - 1; x >= 0; x--) { if (colCount[x] >= colThr) { right = x; break; } }

    if (top < 0 || bottom < 0 || left < 0 || right < 0 || top >= bottom || left >= right) return null;
    const w = right - left + 1;
    const h = bottom - top + 1;
    const areaRatio = (w * h) / (width * height);
    const aspect = w / h;
    if (areaRatio < o.frameAreaMin || areaRatio > o.frameAreaMax) return null;
    if (aspect < o.frameAspectMin || aspect > o.frameAspectMax) return null;
    return { x: left, y: top, width: w, height: h };
  }

  /* 找投影中「计数 ≥ 阈值」的连续区间。 */
  function findBands(counts, thr) {
    const bands = [];
    let start = -1;
    for (let i = 0; i <= counts.length; i++) {
      const filled = i < counts.length && counts[i] >= thr;
      if (filled && start < 0) start = i;
      else if (!filled && start >= 0) { bands.push([start, i - 1]); start = -1; }
    }
    return bands;
  }

  /* 组合行列区间候选，按面积占比 / 宽高比 / 居中度评分取最优。 */
  function scoreCandidates(rowBands, colBands, width, height, o) {
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    let best = null;
    for (const [r0, r1] of rowBands) {
      for (const [c0, c1] of colBands) {
        const w = c1 - c0 + 1;
        const h = r1 - r0 + 1;
        const area = w * h;
        const areaRatio = area / (width * height);
        const aspect = w / h;
        if (areaRatio < o.frameAreaMin || areaRatio > o.frameAreaMax) continue;
        if (aspect < o.frameAspectMin || aspect > o.frameAspectMax) continue;
        // 仅排除贯穿整图宽/高的候选（整图都是留白时无法定位头像框），允许贴边但不贯穿
        if (w >= width - 2 || h >= height - 2) continue;
        const bcx = (c0 + c1) / 2;
        const bcy = (r0 + r1) / 2;
        const offNorm = Math.hypot(bcx - cx, bcy - cy) / Math.max(1, Math.hypot(cx, cy));
        const score = areaRatio - offNorm * 0.5;
        if (!best || score > best.score) best = { x: c0, y: r0, width: w, height: h, score };
      }
    }
    return best ? { x: best.x, y: best.y, width: best.width, height: best.height } : null;
  }

  /*
   * 浏览器侧：把 HTMLImageElement 降采样到离屏 canvas，取出 RGBA。
   * 返回 { rgba, width, height }（分析尺寸），供上述两个算法使用。
   */
  function imageToRgba(image, maxEdge) {
    const srcW = image.naturalWidth || image.width || 0;
    const srcH = image.naturalHeight || image.height || 0;
    if (!srcW || !srcH) return null;
    const edge = Math.max(1, maxEdge || 640);
    const scale = Math.min(1, edge / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return null;
    }
    return { rgba: data, width: w, height: h };
  }

  global.BadgeEdgeDetect = Object.freeze({
    contentBoundsFromRgba,
    avatarFrameFromRgba,
    imageToRgba
  });
})(window);

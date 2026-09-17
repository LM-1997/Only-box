/* ================================================================
   banner-builder-backgrounds.js —— 长条工具的图案背景生成引擎

   为「活动宣传长条」提供整条底图：在一张底色画布上按某种空间
   规律撒布大量小图形。共六种分布规律：
     regular  规则网格（可交错）
     linear   沿一条轴从疏到密
     radial   从一个中心向外扩散
     organic  噪声驱动的自然流动感
     hybrid   中心规则、边缘打散
     image    按参考图的明暗分布撒点

   设计要点：
   - 点生成与绘制彻底分离：generatePoints 是纯函数，node:vm 可单测；
   - 确定性：同一份参数（含 seed）永远得到同一份点集，草稿往返不漂移；
   - 参数归一化是唯一入口：任何来源（UI/AI/草稿）的参数先过 normalize，
     非法值一律钳制或回退，存进文档的就是归一化结果；
   - PSD/PDF 矢量化：圆点/方点可输出为逐个圆角矩形矢量元素（颜色预先
     混入底色以规避矢量填充无透明度的问题），其余形状整层转位图。

   文档集成（doc.background）：
     { type:"parametric", params:{…normalize 输出}, presetId?, themeLocked? }
   依赖：无。独立 IIFE，先于 banner-builder.js 加载。
   ================================================================ */
(function (global) {
  "use strict";

  const SCHEMA = "only-box-banner-background/1";
  const MODES = ["regular", "linear", "radial", "organic", "hybrid", "image"];
  const SHAPES = ["circle", "square", "triangle", "diamond", "polygon", "morph"];

  /* 等边三角形密铺的行高系数（√3/2，行距 = 步距 × 此系数） */
  const TRI_HEIGHT_RATIO = Math.sqrt(3) / 2;

  /* ================================================================
     一、基础数值工具
     ================================================================ */

  function clamp(v, lo, hi) {
    if (lo == null) lo = 0;
    if (hi == null) hi = 1;
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function clamp01(v) { return clamp(v, 0, 1); }

  /* 两条常用的缓动：easeInOut 用于尺寸插值，easeSmoother 用于边缘过渡 */
  function easeInOut(t) { return t * t * (3 - (t + t)); }
  function easeSmoother(t) { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); }

  /* 整数格点散列 → [0,1)。值噪声的晶格随机源。 */
  function latticeHash(ix, iy, seed) {
    const mixed = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
    let n = (mixed ^ (mixed >>> 13)) * 1274126177;
    const fin = (n ^ (n >>> 16)) >>> 0;
    return fin / 4294967295;
  }

  /* 双线性插值的值噪声：四角晶格值按平滑权重混合 */
  function latticeNoise(x, y, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const xf = x - x0, yf = y - y0;
    const v00 = latticeHash(x0, y0, seed), v10 = latticeHash(x0 + 1, y0, seed);
    const v01 = latticeHash(x0, y0 + 1, seed), v11 = latticeHash(x0 + 1, y0 + 1, seed);
    const wx = easeInOut(xf), wy = easeInOut(yf);
    const rowA = v00 + (v10 - v00) * wx;
    const rowB = v01 + (v11 - v01) * wx;
    return rowA + (rowB - rowA) * wy;
  }

  /* 可复现随机序列（抖动/密度丢弃共用），seed 相同则序列相同 */
  function randomStream(seedValue) {
    let t = seedValue;
    return function () {
      t = (t + 0x6D2B79F5) | 0;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================================================================
     二、颜色工具
     ================================================================ */

  function parseColor(color) {
    const raw = String(color == null ? "" : color).trim();
    let m = raw.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    m = raw.match(/^#([0-9a-f]{3})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      return { r: ((n >> 8) & 15) * 17, g: ((n >> 4) & 15) * 17, b: (n & 15) * 17 };
    }
    return null;
  }

  function rgbToHex(rgb) {
    const part = function (n) {
      const v = Math.max(0, Math.min(255, Math.round(n)));
      return (v < 16 ? "0" : "") + v.toString(16);
    };
    return "#" + part(rgb.r) + part(rgb.g) + part(rgb.b);
  }

  /* 非法颜色回退；合法则统一成小写 6 位 hex */
  function hexOr(value, fallback) {
    return parseColor(value) ? String(value).trim().toLowerCase() : fallback;
  }

  /* 图案色按不透明度预先混入底色（矢量填充不支持透明度时的等价色） */
  function blendHexOver(fg, bg, alpha) {
    const front = parseColor(fg);
    const back = parseColor(bg);
    if (!front) return hexOr(bg, "#ffffff");
    if (!back || alpha >= 1) return rgbToHex(front);
    const a = clamp01(alpha);
    const mix = function (fc, bc) { return fc * a + bc * (1 - a); };
    return rgbToHex({ r: mix(front.r, back.r), g: mix(front.g, back.g), b: mix(front.b, back.b) });
  }

  /* ================================================================
     三、参数归一化（唯一入口，存入 doc 的即此输出）
     ================================================================ */

  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function pct(v, d) { return num(v, d); }

  function point2(v, dx, dy) {
    return {
      x: clamp01(num(v && v.x, dx)),
      y: clamp01(num(v && v.y, dy)),
    };
  }

  function normalizeStops(raw, maxDefault) {
    let list = Array.isArray(raw) && raw.length > 1
      ? raw.map(function (s) {
          return { t: clamp01(num(s && s.t, 0)), size: Math.max(0, num(s && s.size, 0)) };
        })
      : [{ t: 0, size: 0 }, { t: 1, size: maxDefault }];
    list = list.slice().sort(function (a, b) { return a.t - b.t; });
    list[0].t = 0;
    list[list.length - 1].t = 1;
    return list;
  }

  function normalize(raw) {
    const r = (raw && typeof raw === "object") ? raw : {};
    const out = {};

    out.mode = MODES.includes(r.mode) ? r.mode : "regular";
    out.shape = SHAPES.includes(r.shape) ? r.shape : "circle";

    out.spacing = clamp(num(r.spacing, 34), 6, 400);
    out.minSize = clamp(num(r.minSize, 2), 0, 200);
    out.maxSize = clamp(num(r.maxSize, 8), 0.1, 200);
    if (out.maxSize < out.minSize) {
      const t = out.minSize;
      out.minSize = Math.max(0, out.maxSize - .1);
      out.maxSize = t;
    }
    out.jitter = clamp(num(r.jitter, 0), 0, 100);
    out.density = clamp(num(r.density, 100), 0, 100);
    out.stagger = !!r.stagger;
    out.invert = !!r.invert;

    out.angle = clamp(num(r.angle, 0), -180, 180);
    out.strength = clamp(num(r.strength, 100), 0, 100);
    out.falloff = clamp(num(r.falloff, 55), 0, 100);
    out.noise = clamp(num(r.noise, 45), 0, 100);
    out.opacity = clamp(num(r.opacity, 92), 0, 100);

    out.fg = hexOr(r.fg, "#000000");
    out.bg = hexOr(r.bg, "#f5f1e9");
    out.rotation = clamp(num(r.rotation, 0), -180, 180);
    const seedNum = Math.round(num(r.seed, 7421));
    out.seed = seedNum || 7421;

    /* 画布尺寸与「场空间」分离：渐变轴/噪声/网格按场空间计算，
       画布因内容溢出加高时图案不会整体漂移。 */
    out.width = Math.max(1, Math.round(num(r.width, 750)));
    out.height = Math.max(1, Math.round(num(r.height, 1000)));
    out.fieldHeight = Math.max(1, Math.round(num(r.fieldHeight, out.height)));
    out.fieldWidth = Math.max(1, Math.round(num(r.fieldWidth, out.width)));

    /* organic 轴与停靠点 */
    out.organicAxisStart = point2(r.organicAxisStart, .14, .82);
    out.organicAxisEnd = point2(r.organicAxisEnd, .86, .18);
    out.organicStops = normalizeStops(r.organicStops, out.maxSize || 8);

    /* 线性轴：显式给出则用之，否则按角度推导一条穿过中心的轴 */
    if (r.linearAxisStart || r.linearAxisEnd) {
      out.linearAxisStart = point2(r.linearAxisStart, .14, .5);
      out.linearAxisEnd = point2(r.linearAxisEnd, .86, .5);
    } else {
      const rad = out.angle * Math.PI / 180;
      const half = .36;
      out.linearAxisStart = { x: clamp01(.5 - Math.cos(rad) * half), y: clamp01(.5 - Math.sin(rad) * half) };
      out.linearAxisEnd = { x: clamp01(.5 + Math.cos(rad) * half), y: clamp01(.5 + Math.sin(rad) * half) };
    }

    /* 径向轴 */
    out.radialAxisCenter = point2(r.radialAxisCenter, .5, .5);
    out.radialAxisEnd = point2(r.radialAxisEnd, .86, .5);
    out.radialShape = r.radialShape === "rect" ? "rect" : "circle";
    out.radialScaleX = clamp(num(r.radialScaleX, 100), 0, 200);
    out.radialScaleY = clamp(num(r.radialScaleY, 100), 0, 200);

    /* hybrid（中心规则 · 边缘随机） */
    out.coreRadius = clamp(num(r.coreRadius, 40), 4, 90);
    out.transition = clamp(num(r.transition, 28), 0, 100);
    out.edgeDensity = clamp(num(r.edgeDensity, 58), 0, 100);

    out.hybridBoundary = r.hybridBoundary === "rect" ? "rect" : "circle";
    out.hybridAxisCenter = point2(r.hybridAxisCenter, .5, .5);
    out.hybridAxisEnd = point2(r.hybridAxisEnd, .86, .5);
    out.hybridScaleX = clamp(num(r.hybridScaleX, 100), 0, 200);
    out.hybridScaleY = clamp(num(r.hybridScaleY, 100), 0, 200);
    out.hybridTop = r.hybridTop !== false;
    out.hybridBottom = r.hybridBottom !== false;
    out.hybridLeft = r.hybridLeft !== false;
    out.hybridRight = r.hybridRight !== false;

    /* 形状细节 */
    out.shapeScaleX = clamp(num(r.shapeScaleX, 100), 0, 400);
    out.shapeScaleY = clamp(num(r.shapeScaleY, 100), 0, 400);
    out.cornerRadius = clamp(num(r.cornerRadius, 18), 0, 100);
    out.polygonSides = Math.max(3, Math.min(12, Math.round(num(r.polygonSides, 6))));

    /* morph（形状渐变）两端点 */
    const readEndpoint = function (side) {
      const shapeRaw = r["morph" + side];
      return {
        shape: (SHAPES.includes(shapeRaw) && shapeRaw !== "morph") ? shapeRaw : "circle",
        scaleX: clamp(num(r["morph" + side + "ScaleX"], 100), 0, 400),
        scaleY: clamp(num(r["morph" + side + "ScaleY"], 100), 0, 400),
        polygonSides: Math.max(3, Math.min(12, Math.round(num(r["morph" + side + "PolygonSides"], 6)))),
        cornerRadius: clamp(num(r["morph" + side + "CornerRadius"], 18), 0, 100),
        rotation: clamp(num(r["morph" + side + "Rotation"], 0), -180, 180),
      };
    };
    out.morphFrom = readEndpoint("From");
    out.morphTo = readEndpoint("To");
    out.morphAxisStart = point2(r.morphAxisStart, .14, .5);
    out.morphAxisEnd = point2(r.morphAxisEnd, .86, .5);

    /* image 模式 */
    out.imageMap = r.imageMap === "density" ? "density" : "size";
    out.imageContrast = clamp(num(r.imageContrast, 62), 0, 100);
    out.imageDetail = clamp(num(r.imageDetail, 94), 0, 100);
    out.layerDepth = clamp(num(r.layerDepth, 88), 0, 100);
    out.subjectBoost = clamp(num(r.subjectBoost, 92), 0, 100);
    out.backgroundTolerance = clamp(num(r.backgroundTolerance, 18), 0, 100);
    out.imageCutoff = clamp(num(r.imageCutoff, 8), 0, 95);
    out.imageInvert = !!r.imageInvert;
    out.imageFit = r.imageFit === "contain" ? "contain" : "cover";

    out.schema = SCHEMA;
    return out;
  }

  /* ================================================================
     四、空间场：把画布上的一点 (nx, ny) 映射为强度 [0,1]
     ================================================================ */

  /* 点到线段的投影参数（0=起点 1=终点），用于线性/organic/morph 轴 */
  function axisProjection(nx, ny, start, end) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const len2 = Math.max(.0001, dx * dx + dy * dy);
    return clamp01(((nx - start.x) * dx + (ny - start.y) * dy) / len2);
  }

  /* 椭圆/矩形径向几何：中心、半径、旋转角与两轴缩放 */
  function radialFrame(s) {
    const ctr = s.radialAxisCenter, tip = s.radialAxisEnd;
    const w = Math.max(1, s.width), h = Math.max(1, s.height);
    const dx = (tip.x - ctr.x) * w, dy = (tip.y - ctr.y) * h;
    return {
      c: ctr, width: w, height: h,
      radius: Math.max(1, Math.hypot(dx, dy)),
      angle: Math.atan2(dy, dx),
      sx: Math.max(.001, s.radialScaleX / 100),
      sy: Math.max(.001, s.radialScaleY / 100),
    };
  }

  /* 径向强度：0=中心 1=轴端。矩形模式取两轴分量的最大值。 */
  function radialIntensity(nx, ny, s) {
    const frame = radialFrame(s);
    const px = (nx - frame.c.x) * frame.width, py = (ny - frame.c.y) * frame.height;
    const cosA = Math.cos(frame.angle);
    const sinA = Math.sin(frame.angle);
    const along = (px * cosA + py * sinA) / (frame.radius * frame.sx);
    const across = (-px * sinA + py * cosA) / (frame.radius * frame.sy);
    if (s.radialShape === "rect") return clamp01(Math.max(Math.abs(along), Math.abs(across)));
    return clamp01(Math.hypot(along, across));
  }

  /* organic：轴投影 + 停靠点插值得到「规则尺寸」 */
  function flowAxisT(nx, ny, s) {
    return axisProjection(nx, ny, s.organicAxisStart, s.organicAxisEnd);
  }
  function flowStopSize(nx, ny, s) {
    const stopList = s.organicStops;
    const t = flowAxisT(nx, ny, s);
    if (t <= stopList[0].t) return Math.max(0, stopList[0].size);
    for (let i = 1; i < stopList.length; i++) {
      if (stopList[i].t >= t) {
        const a = stopList[i - 1], b = stopList[i];
        const span = Math.max(.0001, b.t - a.t);
        const u = easeInOut(clamp01((t - a.t) / span));
        return Math.max(0, a.size + (b.size - a.size) * u);
      }
    }
    return Math.max(0, stopList[stopList.length - 1].size);
  }

  /* organic 主控：噪声/正弦扰动与规则尺寸按 noise 比例混合，
     返回该点的强度场与目标尺寸 */
  function flowControl(nx, ny, s) {
    const na = latticeNoise(nx * 4.3 + s.seed * .01, ny * 4.3, s.seed);
    const nb = latticeNoise(nx * 10.5 - s.seed * .013, ny * 10.5 + 3, s.seed + 91);
    const phase = nx * 11 + Math.sin(ny * 8) * 2.2 + s.seed * .014;
    const wv = .5 + .5 * Math.sin(phase);
    const irregular = na * .55 + nb * .22 + wv * .23;
    const phase2 = nx * 7.5 + ny * 3.2 + s.seed * .009;
    const structured = .5 + .5 * Math.sin(phase2);
    const noiseAmt = clamp01(s.noise / 100);
    const randomField = clamp01(structured * (1 - noiseAmt) + irregular * noiseAmt);

    const axisMax = Math.max(.001, s.maxSize);
    const ruleSize = flowStopSize(nx, ny, s);
    const ruleField = clamp01(ruleSize / axisMax);

    let field = ruleField * (1 - noiseAmt) + randomField * noiseAmt;
    if (s.invert) { field = 1 - field; }
    const strengthK = s.strength / 100;
    field = .5 + (field - .5) * strengthK;

    let randomSizeField = randomField;
    if (s.invert) randomSizeField = 1 - randomField;
    const randomSize = s.minSize + (s.maxSize - s.minSize) * easeInOut(randomSizeField);
    const ruleSizeDirected = s.invert ? axisMax - ruleSize : ruleSize;
    const blendedSize = noiseAmt < .001
      ? axisMax * (s.invert ? 1 - ruleField : ruleField)
      : ruleSizeDirected * (1 - noiseAmt) + randomSize * noiseAmt;
    const blendedField = clamp01(blendedSize / axisMax);
    const szField = .5 + (blendedField - .5) * strengthK;
    const size = axisMax * szField;
    return { field: clamp01(field), size: Math.max(0, size) };
  }

  /* 各模式的强度场（organic 除外，它走 flowControl） */
  function fieldAt(nx, ny, s) {
    let f = 1;
    if (s.mode === "linear") {
      f = axisProjection(nx, ny, s.linearAxisStart, s.linearAxisEnd);
    } else if (s.mode === "regular" && s.shape === "morph") {
      const rad = s.angle * Math.PI / 180;
      const p = (nx - .5) * Math.cos(rad) + (ny - .5) * Math.sin(rad);
      f = clamp01(.5 + p / .7071);
    } else if (s.mode === "radial") {
      const t = radialIntensity(nx, ny, s);
      f = Math.pow(clamp01(1 - t), 1.02 + (100 - s.falloff) / 38);
    } else if (s.mode === "organic") {
      f = flowControl(nx, ny, s).field;
    }
    if (s.mode !== "organic" && s.invert) f = 1 - f;
    if (s.mode !== "organic") {
      const k = s.strength / 100;
      f = .5 + (f - .5) * k;
    }
    return clamp01(f);
  }

  /* ================================================================
     五、hybrid 模式：中心保持规则，越靠边越随机
     ================================================================ */

  function hybridFrame(s) {
    const ctr = s.hybridAxisCenter, tip = s.hybridAxisEnd;
    const w = Math.max(1, s.width), h = Math.max(1, s.height);
    const dx = (tip.x - ctr.x) * w, dy = (tip.y - ctr.y) * h;
    return {
      c: ctr, width: w, height: h,
      radius: Math.max(1, Math.hypot(dx, dy)),
      angle: Math.atan2(dy, dx),
      sx: Math.max(.001, s.hybridScaleX / 100),
      sy: Math.max(.001, s.hybridScaleY / 100),
    };
  }

  /* 归一化到 hybrid 轴系：along=轴向 across=横向 */
  function hybridLocalCoords(nx, ny, s) {
    const frame = hybridFrame(s);
    const px = (nx - frame.c.x) * frame.width, py = (ny - frame.c.y) * frame.height;
    const cosA = Math.cos(frame.angle);
    const sinA = Math.sin(frame.angle);
    return {
      along: (px * cosA + py * sinA) / (frame.radius * frame.sx),
      across: (-px * sinA + py * cosA) / (frame.radius * frame.sy),
    };
  }

  function hybridCoreDistance(nx, ny, s) {
    const local = hybridLocalCoords(nx, ny, s);
    const raw = s.hybridBoundary === "rect"
      ? Math.max(Math.abs(local.along), Math.abs(local.across))
      : Math.hypot(local.along, local.across);
    return clamp01(raw);
  }

  function hybridUsesSides(s) {
    return Boolean(s.hybridTop || s.hybridBottom || s.hybridLeft || s.hybridRight);
  }

  /* 方向化边缘：只朝选中的边（上下左右）发散 */
  function hybridSideIntensity(nx, ny, s) {
    const local = hybridLocalCoords(nx, ny, s);
    const upSide = Math.max(0, -local.across);
    const downSide = Math.max(0, local.across);
    const leftSide = Math.max(0, -local.along);
    const rightSide = Math.max(0, local.along);
    const picks = [];
    if (s.hybridTop) picks.push(upSide);
    if (s.hybridBottom) picks.push(downSide);
    if (s.hybridLeft) picks.push(leftSide);
    if (s.hybridRight) picks.push(rightSide);
    if (picks.length === 0) return 0;
    const picksMax = Math.max.apply(null, picks);
    if (s.hybridBoundary === "rect") return clamp01(picksMax);
    const alongAbs = Math.abs(local.along);
    const acrossAbs = Math.abs(local.across);
    const maxAxis = Math.max(alongAbs, acrossAbs, 1e-9);
    const distRadial = Math.hypot(local.along, local.across);
    return clamp01(distRadial * picksMax / maxAxis);
  }

  /* 距中心 coreRadius 以内为 0（纯规则），向外平滑过渡到 1（纯随机） */
  function hybridFalloffMix(distance, s) {
    if (!hybridUsesSides(s)) return 0;
    const coreRadiusNorm = clamp(s.coreRadius / 100, .04, .9);
    const softness = clamp01(s.transition / 100);
    const bandWidth = .035 + softness * Math.max(.04, 1 - coreRadiusNorm);
    return easeSmoother((distance - coreRadiusNorm) / bandWidth);
  }

  /* ================================================================
     六、形状几何
     ================================================================ */

  function canonicalShape(shape) {
    return ["circle", "square", "triangle", "diamond", "polygon"].includes(shape) ? shape : "circle";
  }
  function morphIsActive(s) { return !!s && s.shape === "morph"; }

  function morphPair(s) {
    return {
      from: canonicalShape(s.morphFrom.shape),
      to: canonicalShape(s.morphTo.shape),
    };
  }

  function morphPairScale(side, s) {
    const ep = side === "from" ? s.morphFrom : s.morphTo;
    return { x: Math.max(0, ep.scaleX) / 100, y: Math.max(0, ep.scaleY) / 100 };
  }

  function morphPairSides(side, s) {
    return side === "from" ? s.morphFrom.polygonSides : s.morphTo.polygonSides;
  }

  /* morph 中间时刻的缩放与旋转（两端点线性插值，t 先平滑） */
  function morphLerpTransform(t, s) {
    const u = easeInOut(clamp01(t));
    const fromR = s.morphFrom.rotation, toR = s.morphTo.rotation;
    const from = morphPairScale("from", s), to = morphPairScale("to", s);
    return {
      scaleX: from.x + (to.x - from.x) * u,
      scaleY: from.y + (to.y - from.y) * u,
      rotation: (fromR + (toR - fromR) * u) * Math.PI / 180,
    };
  }

  /* 等边多边形沿角度 angle 的径向缩放系数（顶点方向半径最大） */
  function polygonRadiusFactor(angle, sides) {
    const sidesN = Math.max(3, Math.min(12, Math.round(Number(sides) || 6)));
    const sector = Math.PI * 2 / sidesN;
    let localAngle = (angle + Math.PI / 2) % sector;
    if (localAngle < 0) localAngle += sector;
    localAngle -= sector / 2;
    return Math.cos(Math.PI / sidesN) / Math.max(.001, Math.cos(localAngle));
  }

  /* 圆角矩形沿角度的径向系数：二分搜索圆角约束下的边界 */
  function roundedRectFactor(angle, cornerPercent, scaleX, scaleY) {
    const corner01 = Math.min(1, Math.max(0, Number(cornerPercent) || 0) / 100);
    const halfW = Math.max(.001, Math.abs(Number(scaleX) || 1));
    const halfH = Math.max(.001, Math.abs(Number(scaleY) || 1));
    const corner = Math.min(halfW, halfH) * corner01;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const inside = function (factor) {
      const px = factor * cosA * halfW;
      const py = factor * sinA * halfH;
      const ex = Math.max(Math.abs(px) - (halfW - corner), 0);
      const ey = Math.max(Math.abs(py) - (halfH - corner), 0);
      return ex * ex + ey * ey <= corner * corner + 1e-7;
    };
    let lo = 0, hi = 2;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) * .5;
      if (inside(mid)) lo = mid; else hi = mid;
    }
    return lo;
  }

  /* 菱形径向系数（固定纵横比 1.25 : .86） */
  function diamondFactor(angle) {
    const absCos = Math.abs(Math.cos(angle));
    const absSin = Math.abs(Math.sin(angle));
    return 1 / Math.max(.001, absCos / .86 + absSin / 1.25);
  }

  function shapeRadiusFactor(shape, angle, s, cornerRadius, scaleX, scaleY, triangleFlip, polygonSides) {
    const id = canonicalShape(shape);
    if (id === "square") {
      return roundedRectFactor(angle, cornerRadius == null ? 18 : cornerRadius, scaleX == null ? 1 : scaleX, scaleY == null ? 1 : scaleY);
    }
    if (id === "triangle") return polygonRadiusFactor(angle - (triangleFlip ? Math.PI : 0), 3);
    if (id === "diamond") return diamondFactor(angle);
    if (id === "polygon") return polygonRadiusFactor(angle, polygonSides == null ? s.polygonSides : polygonSides);
    return 1;
  }

  /* morph 轮廓点：两端形状的径向系数插值（方→方走专用路径） */
  function morphOutlinePoint(angle, t, s, endpoints, triangleFlip) {
    const pair = endpoints || morphPair(s);
    const fromCorner = pair.from === "square" ? s.morphFrom.cornerRadius : 0;
    const toCorner = pair.to === "square" ? s.morphTo.cornerRadius : 0;
    const fromScale = morphPairScale("from", s), toScale = morphPairScale("to", s);
    const rf = shapeRadiusFactor(pair.from, angle, s, fromCorner, fromScale.x, fromScale.y, triangleFlip, morphPairSides("from", s));
    const rt = shapeRadiusFactor(pair.to, angle, s, toCorner, toScale.x, toScale.y, triangleFlip, morphPairSides("to", s));
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    if (pair.from === "square" && pair.to === "square") {
      const sx = fromScale.x * (1 - t) + toScale.x * t;
      const sy = fromScale.y * (1 - t) + toScale.y * t;
      const corner = fromCorner * (1 - t) + toCorner * t;
      const rr = roundedRectFactor(angle, corner, sx, sy);
      return { x: dirX * rr * sx, y: dirY * rr * sy };
    }
    const transform = morphLerpTransform(t, s);
    const radius = rf * (1 - t) + rt * t;
    return { x: dirX * radius * transform.scaleX, y: dirY * radius * transform.scaleY };
  }

  function morphAxisField(nx, ny, s) {
    if (s.mode === "radial") return radialIntensity(nx, ny, s);
    return axisProjection(nx, ny, s.morphAxisStart, s.morphAxisEnd);
  }

  function morphBlend(field, s, nx, ny) {
    if (!morphIsActive(s)) return 0;
    const hasCoords = Number.isFinite(nx) && Number.isFinite(ny);
    const axisField = hasCoords ? morphAxisField(nx, ny, s) : field;
    return easeInOut(clamp01(axisField));
  }

  function isTriangleLayout(s) {
    return s.shape === "triangle" || (canonicalShape(s.shape) === "polygon" && s.polygonSides === 3);
  }
  function morphEndIsTriangle(side, s) {
    const id = canonicalShape(side === "from" ? s.morphFrom.shape : s.morphTo.shape);
    return id === "triangle" || (id === "polygon" && morphPairSides(side, s) === 3);
  }

  /* ================================================================
     七、网格遍历与点生成
     ================================================================ */

  function latticePoint(row, col, s, step) {
    const triangular = isTriangleLayout(s);
    const rowPitch = triangular ? step * TRI_HEIGHT_RATIO : step;
    const rowOffset = triangular
      ? (row % 2 ? step * .5 : 0)
      : (s.stagger && row % 2 ? step * .5 : 0);
    return { x: col * step + rowOffset, y: row * rowPitch, triangleFlip: triangular && ((row + col) % 2 === 1) };
  }

  /* 三角形需要边对边密铺（上下颠倒交错）才能无缝 */
  function needsTriangleTiling(s) {
    if (!s) { return false; }
    if (s.shape === "triangle") return true;
    if (!morphIsActive(s)) { return false; }
    return morphEndIsTriangle("from", s) || morphEndIsTriangle("to", s);
  }

  function walkGrid(s, step, visitor) {
    if (needsTriangleTiling(s)) {
      const triHeight = step * TRI_HEIGHT_RATIO;
      const stripCount = Math.ceil(s.height / triHeight) + 3;
      const colCount = Math.ceil(s.width / step) + 4;
      for (let strip = -1; strip < stripCount; strip++) {
        const rowOffset = Math.abs(strip % 2) * step * .5;
        const stripY = strip * triHeight;
        for (let col = -2; col < colCount; col++) {
          const cellX = col * step + rowOffset;
          visitor({ x: cellX + step, y: stripY + triHeight / 3, triangleFlip: true });
          visitor({ x: cellX + step * .5, y: stripY + triHeight * 2 / 3, triangleFlip: false });
        }
      }
      return;
    }
    const colTotal = Math.ceil(s.width / step) + 1;
    const rowPitch = isTriangleLayout(s) ? step * TRI_HEIGHT_RATIO : step;
    const rowTotal = Math.ceil(s.height / rowPitch) + 1;
    for (let row = 0; row < rowTotal; row++) {
      for (let col = 0; col < colTotal; col++) visitor(latticePoint(row, col, s, step));
    }
  }

  /* 画布外沿留 maxSize 两倍的余量，超出即丢弃 */
  function insideCanvasMargin(x, y, s) {
    const m = s.maxSize * 2;
    return x >= -m && x <= s.width + m && y >= -m && y <= s.height + m;
  }

  /* 通用点生成：regular / linear / radial / organic */
  function buildGridPoints(s) {
    const points = [];
    const rand = randomStream((s.seed >>> 0) || 1);
    const triangular = isTriangleLayout(s) || needsTriangleTiling(s);
    const jitterAmt = triangular ? 0 : s.spacing * (s.jitter / 100) * .48;
    const dropRate = s.density / 100;
    walkGrid(s, s.spacing, function (grid) {
      if (dropRate < 1 && rand() > dropRate) { return; }
      let x = grid.x;
      let y = grid.y;
      if (jitterAmt) {
        x += (rand() - .5) * jitterAmt * 2;
        y += (rand() - .5) * jitterAmt * 2;
      }
      if (!insideCanvasMargin(x, y, s)) return;
      const control = s.mode === "organic" ? flowControl(x / s.width, y / s.height, s) : null;
      const field = control ? control.field : fieldAt(x / s.width, y / s.height, s);
      const size = morphIsActive(s)
        ? Math.max(.001, s.maxSize)
        : (control ? control.size : s.minSize + (s.maxSize - s.minSize) * easeInOut(field));
      const alpha = clamp01(s.opacity / 100);
      const morph = morphBlend(field, s, x / s.width, y / s.height);
      const rot = morphIsActive(s) ? 0 : (s.rotation * Math.PI / 180) * (s.mode === "organic" ? (rand() * 2 - 1) : 1);
      points.push({ x: x, y: y, size: Math.max(0, size) * .5, alpha: alpha, rot: rot, field: field, morph: morph, triangleFlip: grid.triangleFlip });
    });
    return points;
  }

  /* hybrid 点生成：中心规则网格 + 边缘随机丢弃与噪声 */
  function buildHybridPoints(s) {
    const points = [];
    const rand = randomStream((s.seed >>> 0) || 1);
    const baseKeep = s.density / 100;
    const edgeDensity01 = clamp01(s.edgeDensity / 100);
    const fadeAtEdge = .78;
    const hasDirection = hybridUsesSides(s);
    const coreRadiusNorm = clamp(s.coreRadius / 100, .04, .9);
    walkGrid(s, s.spacing, function (grid) {
      const x = grid.x;
      const y = grid.y;
      const nx = x / s.width;
      const ny = y / s.height;
      if (!hasDirection && hybridCoreDistance(nx, ny, s) > coreRadiusNorm) return;
      const d0 = hybridSideIntensity(nx, ny, s);
      const edgeT = hasDirection ? hybridFalloffMix(d0, s) : 0;
      const edgeKeep = .025 + edgeDensity01 * .975;
      const keep = baseKeep * ((1 - edgeT) + edgeT * edgeKeep);
      if (rand() > clamp01(keep)) return;
      if (!insideCanvasMargin(x, y, s)) return;
      const radial = clamp01(1 - d0);
      const localNoise = latticeNoise(x / s.width * 5 + s.seed * .01, y / s.height * 5, s.seed + 13);
      const field = clamp01(radial * (1 - edgeT * .55) + localNoise * edgeT * .16);
      const fieldSize01 = easeInOut(field) * (1 - edgeT * fadeAtEdge);
      const size = morphIsActive(s)
        ? Math.max(.001, s.maxSize)
        : s.minSize + (s.maxSize - s.minSize) * fieldSize01;
      const alpha = clamp01(s.opacity / 100);
      const morph = morphBlend(field, s, x / s.width, y / s.height);
      const rot = morphIsActive(s) ? 0 : s.rotation * Math.PI / 180;
      points.push({ x: x, y: y, size: Math.max(0, size) * .5, alpha: alpha, rot: rot, field: field, morph: morph, triangleFlip: grid.triangleFlip });
    });
    return points;
  }

  /* ================================================================
     八、image 模式：按参考图明暗撒点（源图经 opts.source 传入）
     ================================================================ */

  function effectiveSpacing(s) {
    if (s.mode !== "image") return s.spacing;
    const detail01 = s.imageDetail / 100;
    return Math.max(6, s.spacing * (1.32 - detail01 * 1.12));
  }

  /* 源图统计：亮度分位 + 边框/顶部均值（用于背景色估计） */
  function analyzeSource(pixels, w, h) {
    if (!pixels || !w || !h) return null;
    const step = Math.max(1, Math.floor(Math.min(w, h) / 180));
    const lumas = [];
    let lumaSum = 0, lumaSumSq = 0;
    const borderPx = [], topPx = [];
    const pushPixel = function (x, y) {
      const i = (y * w + x) * 4;
      const l = (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722) / 255;
      lumas.push(l);
      lumaSum += l;
      lumaSumSq += l * l;
      return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] };
    };
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const px = pushPixel(x, y);
        if (x < step * 1.5 || x > w - step * 1.5 || y < step * 1.5 || y > h - step * 1.5) borderPx.push(px);
        if (y < h * .14) topPx.push(px);
      }
    }
    lumas.sort(function (a, b) { return a - b; });
    const quantile = function (p) {
      const idx = Math.max(0, Math.min(lumas.length - 1, Math.floor((lumas.length - 1) * p)));
      return lumas[idx];
    };
    const mean = lumaSum / Math.max(1, lumas.length);
    const stats = {
      lumaLow: quantile(.035),
      lumaHigh: quantile(.965),
      lumaMedian: quantile(.5),
      lumaStd: Math.sqrt(Math.max(0, lumaSumSq / Math.max(1, lumas.length) - mean * mean)),
    };
    const average = function (list) {
      if (list.length === 0) return null;
      const out = list.reduce(function (a, p) { return { r: a.r + p.r, g: a.g + p.g, b: a.b + p.b }; }, { r: 0, g: 0, b: 0 });
      return { r: out.r / list.length, g: out.g / list.length, b: out.b / list.length };
    };
    const topAvg = average(topPx);
    const borderAvg = average(borderPx);
    let backdrop = { r: 0, g: 0, b: 0 };
    if (topAvg && borderAvg) {
      backdrop = {
        r: topAvg.r * .72 + borderAvg.r * .28,
        g: topAvg.g * .72 + borderAvg.g * .28,
        b: topAvg.b * .72 + borderAvg.b * .28,
      };
    } else if (topAvg || borderAvg) {
      backdrop = topAvg || borderAvg;
    }
    return { stats: stats, backdrop: backdrop };
  }

  /* 画布坐标 → 源图 UV（cover/contain 两种适配） */
  function mapToSourceUV(nx, ny, s, src) {
    if (!src || !src.pixels || !src.w || !src.h) return null;
    const imageRatio = src.w / src.h, canvasRatio = s.width / s.height;
    let fitW = 1, fitH = 1, shiftX = 0, shiftY = 0;
    if (s.imageFit === "cover") {
      if (canvasRatio > imageRatio) { fitH = canvasRatio / imageRatio; shiftY = (1 - fitH) / 2; }
      else { fitW = imageRatio / canvasRatio; shiftX = (1 - fitW) / 2; }
    } else if (canvasRatio > imageRatio) { fitW = imageRatio / canvasRatio; shiftX = (1 - fitW) / 2; }
    else { fitH = canvasRatio / imageRatio; shiftY = (1 - fitH) / 2; }
    const u = (nx - shiftX) / fitW, v = (ny - shiftY) / fitH;
    if (u < 0 || u > 1 || v < 0 || v > 1) { return null; }
    return { u: u, v: v };
  }

  /* 采样一个点的明暗信号：邻域加权均值 + 对比度拉伸 + 主体增强 */
  function sampleToneSignal(nx, ny, s, src) {
    const mapped = mapToSourceUV(nx, ny, s, src);
    if (!mapped) { return null; }
    const detail01 = s.imageDetail / 100;
    const step = effectiveSpacing(s);
    const spanU = (step / s.width) * (.18 + (1 - detail01) * .28);
    const spanV = (step / s.height) * (.18 + (1 - detail01) * .28);
    const steps = detail01 > .48 ? 3 : 2;
    const read = function (u, v) {
      const ix = Math.min(src.w - 1, Math.max(0, Math.floor(clamp01(u) * src.w)));
      const iy = Math.min(src.h - 1, Math.max(0, Math.floor(clamp01(v) * src.h)));
      const i = (iy * src.w + ix) * 4;
      const r = src.pixels[i], g = src.pixels[i + 1], b = src.pixels[i + 2];
      return { r: r, g: g, b: b, l: (r * .2126 + g * .7152 + b * .0722) / 255 };
    };
    let wsum = 0, wsq = 0, wr = 0, wg = 0, wb = 0, wtot = 0;
    for (let oy = -steps; oy <= steps; oy++) {
      for (let ox = -steps; ox <= steps; ox++) {
        const px = read(mapped.u + (ox / steps) * spanU, mapped.v + (oy / steps) * spanV);
        const darkSample = s.imageInvert ? px.l : 1 - px.l;
        const distance = Math.sqrt(ox * ox + oy * oy);
        const weight = Math.exp(-distance * distance / (steps * steps * .72));
        wsum += darkSample * weight;
        wsq += darkSample * darkSample * weight;
        wtot += weight;
        wr += px.r * weight;
        wg += px.g * weight;
        wb += px.b * weight;
      }
    }
    const wgt = Math.max(.001, wtot);
    const rawDark = wsum / wgt;
    const spreadVar = Math.max(0, wsq / wgt - rawDark * rawDark);
    const avgR = wr / wgt, avgG = wg / wgt, avgB = wb / wgt;

    /* 亮度归一化到源图动态范围，再按对比度参数拉伸 */
    const st = src.stats || { lumaLow: .08, lumaHigh: .92 };
    const lumaLow = s.imageInvert ? st.lumaLow : 1 - st.lumaHigh;
    const lumaHigh = s.imageInvert ? st.lumaHigh : 1 - st.lumaLow;
    const lumaRange = Math.max(.08, lumaHigh - lumaLow);
    let tone = clamp01((rawDark - lumaLow) / lumaRange);
    const contrastK = 1 + (s.imageContrast / 100) * .42;
    tone = clamp01((tone - .5) * contrastK + .5);

    /* 局部梯度/纹理增强（layerDepth 控制强度） */
    const sampleDark = function (u, v) {
      const p = read(u, v);
      return s.imageInvert ? p.l : 1 - p.l;
    };
    const cx = mapped.u;
    const cy = mapped.v;
    const near = [
      sampleDark(cx - spanU * 2.8, cy),
      sampleDark(cx + spanU * 2.8, cy),
      sampleDark(cx, cy - spanV * 2.8),
      sampleDark(cx, cy + spanV * 2.8),
    ];
    const nearMean = near.reduce(function (a, v) { return a + v; }, 0) / near.length;
    const diffLocal = Math.abs(rawDark - nearMean);
    const dHoriz = near[1] - near[0];
    const dVert = near[3] - near[2];
    const gradient = Math.sqrt(Math.pow(dHoriz, 2) + Math.pow(dVert, 2)) * .5;
    const texture = Math.sqrt(spreadVar);
    const depthMix = clamp01(s.layerDepth / 100);
    const detailSignal = clamp01(diffLocal * 2.5 + gradient * 1.8 + texture * 1.35);
    tone = clamp01(tone + Math.max(0, detailSignal - .08) * depthMix * .48);

    /* 背景色距离 → 主体信号（离背景越远越可能是主体） */
    const bd = src.backdrop || { r: 0, g: 0, b: 0 };
    const backdropDistance = Math.sqrt(
      Math.pow((avgR - bd.r) / 255, 2) +
      Math.pow((avgG - bd.g) / 255, 2) +
      Math.pow((avgB - bd.b) / 255, 2)
    ) / Math.sqrt(3);
    const bgTolerance = .02 + (s.backgroundTolerance / 100) * .46;
    const distSignal = backdropDistance <= bgTolerance
      ? 0
      : Math.pow(easeInOut(clamp01((backdropDistance - bgTolerance) / Math.max(.001, 1 - bgTolerance))), .62);
    const subjectSignal = distSignal * (.78 + .22 * tone);
    const subjectInfluence = (.06 + (s.subjectBoost / 100) * .22) * (1 - depthMix * .2);
    tone = clamp01(tone * (1 - subjectInfluence) + subjectSignal * subjectInfluence);

    const cutoff01 = s.imageCutoff / 100;
    return clamp01((tone - cutoff01) / Math.max(.001, 1 - cutoff01));
  }

  function buildImagePoints(s, src) {
    if (!src || !src.pixels) return buildGridPoints(Object.assign({}, s, { mode: "regular" }));
    const step = effectiveSpacing(s);
    const points = [];
    const rand = randomStream((s.seed >>> 0) || 1);
    const triangular = isTriangleLayout(s) || needsTriangleTiling(s);
    const jitterAmt = triangular ? 0 : step * (s.jitter / 100) * .48;
    const dropRate = s.density / 100;
    walkGrid(s, step, function (grid) {
      let x = grid.x;
      let y = grid.y;
      const dark = sampleToneSignal(x / s.width, y / s.height, s, src);
      if (dark === null) { return; }
      const sig = clamp01(Math.pow(clamp01(dark), .76));
      const detailFrac = s.imageDetail / 100;
      const densityFloor = .01 + (1 - s.subjectBoost / 100) * .14 + detailFrac * .03;
      const densitySignal = densityFloor + sig * (1 - densityFloor);
      const keepProb = s.imageMap === "size" ? dropRate : dropRate * densitySignal;
      if (rand() > keepProb) { return; }
      if (jitterAmt) {
        x += (rand() - .5) * jitterAmt * 2;
        y += (rand() - .5) * jitterAmt * 2;
      }
      const field = s.imageMap === "density" ? .64 : sig;
      const size = morphIsActive(s)
        ? Math.max(.001, s.maxSize)
        : (s.imageMap === "density" ? (s.minSize + s.maxSize) * .5 : s.minSize + (s.maxSize - s.minSize) * field);
      const alpha = clamp01(s.opacity / 100);
      const morph = morphBlend(field, s, x / s.width, y / s.height);
      const rot = morphIsActive(s) ? 0 : (s.rotation * Math.PI / 180) * (s.jitter > 0 ? (rand() * 2 - 1) : 1);
      points.push({ x: x, y: y, size: Math.max(0, size) * .5, alpha: alpha, rot: rot, field: field, morph: morph, triangleFlip: grid.triangleFlip });
    });
    return points;
  }

  /* ================================================================
     九、对外生成入口
     ================================================================ */

  /* opts.width/height：画布实际尺寸（覆写 params）；
     opts.fieldHeight：场空间高度（点生成坐标系），与画布高度独立。
     场空间与画布分离时：先按场空间生成（场函数 ny = y/fieldHeight），
     网格遍历覆盖到画布全高，y 超出画布的点在裁剪阶段丢弃。 */
  function generatePoints(state, opts) {
    const o = opts || {};
    const s = normalize(state);
    if (o.width) s.width = Math.max(1, Math.round(o.width));
    if (o.height) s.height = Math.max(1, Math.round(o.height));
    const fieldHeight = o.fieldHeight ? Math.max(1, Math.round(o.fieldHeight)) : s.height;
    if (fieldHeight !== s.height) {
      const fieldState = Object.assign({}, s, { height: fieldHeight });
      const pts = generateDirect(fieldState, o);
      const margin = s.maxSize * 2;
      return pts.filter(function (p) { return p.y > -margin && p.y <= s.height + margin; });
    }
    return generateDirect(s, o);
  }

  function generateDirect(s, opts) {
    if (s.mode === "hybrid") return buildHybridPoints(s);
    if (s.mode === "image") return buildImagePoints(s, opts && opts.source ? opts.source : null);
    return buildGridPoints(s);
  }

  /* ================================================================
     十、绘制（DOM 预览与 PNG 导出共用）
     ================================================================ */

  function traceRoundedRect(ctx, x, y, bw, bh, rad) {
    const rr = Math.min(rad, Math.abs(bw) / 2, Math.abs(bh) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + bw, y, x + bw, y + bh, rr);
    ctx.arcTo(x + bw, y + bh, x, y + bh, rr);
    ctx.arcTo(x, y + bh, x, y, rr);
    ctx.arcTo(x, y, x + bw, y, rr);
    ctx.closePath();
  }

  function tracePolygon(ctx, rad, sides) {
    const sidesN = Math.max(3, Math.min(12, Math.round(Number(sides) || 6)));
    ctx.beginPath();
    for (let k = 0; k <= sidesN; k++) {
      const a = -Math.PI / 2 + k * Math.PI * 2 / sidesN;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* morph 形状：沿轮廓采样 64 段折线逼近 */
  function drawMorphOutline(ctx, p, fill, s) {
    const endpoints = morphPair(s);
    const t = clamp01(p.morph || 0);
    const steps = 64;
    const transform = morphLerpTransform(t, s);
    const scaleX = Math.max(0, transform.scaleX), scaleY = Math.max(0, transform.scaleY);
    ctx.rotate(transform.rotation);
    ctx.beginPath();
    for (let k = 0; k <= steps; k++) {
      const a = -Math.PI / 2 + k / steps * Math.PI * 2;
      const point = morphOutlinePoint(a, t, s, endpoints, !!p.triangleFlip);
      const x = point.x * p.size, y = point.y * p.size;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function paintShape(ctx, p, shape, fill, s) {
    const r = p.size;
    ctx.save();
    if (!(r > .01)) { ctx.restore(); return; }
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = fill;
    const scaleX = Math.max(0, s.shapeScaleX) / 100;
    const scaleY = Math.max(0, s.shapeScaleY) / 100;
    if (shape === "morph") {
      drawMorphOutline(ctx, p, fill, s);
    } else if (shape === "circle") {
      ctx.scale(scaleX, scaleY);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === "square") {
      const dotW = r * 2 * scaleX, dotH = r * 2 * scaleY;
      const corner = Math.min(dotW, dotH) * .5 * (s.cornerRadius / 100);
      traceRoundedRect(ctx, -dotW * .5, -dotH * .5, dotW, dotH, corner);
      ctx.fill();
    } else if (shape === "diamond") {
      ctx.scale(scaleX, scaleY);
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.25);
      ctx.lineTo(r * .86, 0);
      ctx.lineTo(0, r * 1.25);
      ctx.lineTo(-r * .86, 0);
      ctx.closePath();
      ctx.fill();
    } else if (shape === "triangle") {
      if (p.triangleFlip) ctx.rotate(Math.PI);
      ctx.scale(scaleX, scaleY);
      tracePolygon(ctx, r, 3);
      ctx.fill();
    } else if (shape === "polygon") {
      ctx.scale(scaleX, scaleY);
      tracePolygon(ctx, r, s.polygonSides);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPoints(ctx, points, s) {
    ctx.fillStyle = s.fg;
    for (let i = 0; i < points.length; i++) paintShape(ctx, points[i], s.shape, s.fg, s);
  }

  /* ================================================================
     十一、整层渲染
     ================================================================ */

  /* 完整背景（底色 + 图案）→ canvas；opts:{width,height,fieldHeight,canvas,points,source} */
  function renderToCanvas(state, opts) {
    const o = opts || {};
    const s = normalize(state);
    if (o.width) s.width = Math.max(1, Math.round(o.width));
    if (o.height) s.height = Math.max(1, Math.round(o.height));
    const canvas = o.canvas || document.createElement("canvas");
    canvas.width = s.width; canvas.height = s.height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, s.width, s.height);
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, s.width, s.height);
    const points = o.points || generatePoints(s, { source: o.source, fieldHeight: o.fieldHeight });
    drawPoints(ctx, points, s);
    return canvas;
  }

  /* 仅图案（透明底）→ canvas；PSD/PDF 栅格回退与叠层场景使用 */
  function renderPatternToCanvas(state, opts) {
    const o = opts || {};
    const s = normalize(state);
    if (o.width) s.width = Math.max(1, Math.round(o.width));
    if (o.height) s.height = Math.max(1, Math.round(o.height));
    const canvas = o.canvas || document.createElement("canvas");
    canvas.width = s.width; canvas.height = s.height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, s.width, s.height);
    const points = o.points || generatePoints(s, { source: o.source, fieldHeight: o.fieldHeight });
    drawPoints(ctx, points, s);
    return canvas;
  }

  /* ================================================================
     十二、PSD/PDF 场景元素（矢量化策略）
     可矢量：shape=circle（无形状缩放）或 square；逐点输出圆角矩形
     shape 元素，透明度预混合进底色（矢量填充无透明度通道）。
     回退栅格：triangle/diamond/polygon/morph、circle+形状缩放、超量点集。
     返回 { kind:"vector"|"raster", count, elements?, reason? }
     ================================================================ */

  function vectorizable(s) {
    if (morphIsActive(s)) return false;
    const id = canonicalShape(s.shape);
    if (id === "square") return true;
    if (id === "circle") return s.shapeScaleX === 100 && s.shapeScaleY === 100;
    return false;
  }

  function sceneElements(state, opts) {
    const o = opts || {};
    const s = normalize(state);
    if (o.width) s.width = Math.max(1, Math.round(o.width));
    if (o.height) s.height = Math.max(1, Math.round(o.height));
    const points = o.points || generatePoints(s, { source: o.source, fieldHeight: o.fieldHeight });
    if (o.forceRaster || !vectorizable(s)) {
      return { kind: "raster", count: points.length, reason: o.forceRaster ? "forced" : "shape" };
    }
    if (points.length > (o.maxVectorElements || 800)) {
      return { kind: "raster", count: points.length, reason: "count" };
    }
    const alpha = clamp01(s.opacity / 100);
    const fill = parseColor(blendHexOver(s.fg, s.bg, alpha));
    const elements = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!(p.size > .01)) continue;
      let w, h, radius;
      if (s.shape === "circle") {
        w = p.size * 2; h = p.size * 2; radius = p.size;
      } else {
        const sx = Math.max(0, s.shapeScaleX) / 100;
        const sy = Math.max(0, s.shapeScaleY) / 100;
        w = p.size * 2 * sx; h = p.size * 2 * sy;
        radius = Math.min(w, h) * .5 * (s.cornerRadius / 100);
      }
      elements.push({
        kind: "shape",
        name: "背景图案 " + (i + 1),
        x: p.x - w / 2, y: p.y - h / 2, w: w, h: h, radius: radius,
        rotation: p.rot || 0,
        fill: { r: fill.r, g: fill.g, b: fill.b },
      });
    }
    return { kind: "vector", count: points.length, elements: elements };
  }

  /* ================================================================
     十三、预设库
     colorMode:"theme" 应用时经 applyThemeColors 以当前主题取色
     （bg ← 主题 soft 浅底，fg ← 主题 primary 图案色）；
     colorMode:"fixed" 使用 params 内置 fg/bg。
     ================================================================ */

  const PRESETS = [
    { id: "dots-fine", label: "细点阵", hint: "规则 · 圆点", colorMode: "theme", params: { mode: "regular", shape: "circle", spacing: 34, minSize: 2, maxSize: 8, opacity: 92 } },
    { id: "dots-bold", label: "大点阵", hint: "规则 · 圆点", colorMode: "theme", params: { mode: "regular", shape: "circle", spacing: 56, minSize: 6, maxSize: 18, opacity: 88 } },
    { id: "dots-stagger", label: "交错点阵", hint: "规则 · 交错", colorMode: "theme", params: { mode: "regular", shape: "circle", spacing: 44, minSize: 3, maxSize: 10, stagger: true, opacity: 90 } },
    { id: "grid-square", label: "方格阵", hint: "规则 · 方点", colorMode: "theme", params: { mode: "regular", shape: "square", spacing: 40, minSize: 4, maxSize: 12, cornerRadius: 15, opacity: 85 } },
    { id: "fade-linear", label: "线性渐隐", hint: "线性尺寸场", colorMode: "theme", params: { mode: "linear", shape: "circle", spacing: 36, minSize: 1, maxSize: 12, opacity: 90 } },
    { id: "fade-diagonal", label: "对角渐隐", hint: "线性 · 45°", colorMode: "theme", params: { mode: "linear", shape: "square", spacing: 42, minSize: 2, maxSize: 14, cornerRadius: 30, angle: 45, opacity: 88 } },
    { id: "focus-radial", label: "径向聚焦", hint: "中心大 · 边缘小", colorMode: "theme", params: { mode: "radial", shape: "circle", spacing: 32, minSize: 1, maxSize: 14, falloff: 55, opacity: 90 } },
    { id: "ring-radial", label: "径向光环", hint: "反相 · 边缘大", colorMode: "theme", params: { mode: "radial", shape: "circle", spacing: 30, minSize: 2, maxSize: 10, falloff: 20, invert: true, opacity: 85 } },
    { id: "flow-organic", label: "有机流动", hint: "噪声 · 流动", colorMode: "theme", params: { mode: "organic", shape: "circle", spacing: 34, minSize: 1, maxSize: 11, noise: 72, strength: 85, opacity: 88 } },
    { id: "wave-organic", label: "有机波纹", hint: "噪声 · 交错", colorMode: "theme", params: { mode: "organic", shape: "circle", spacing: 38, minSize: 1.5, maxSize: 9, noise: 42, stagger: true, opacity: 90 } },
    { id: "core-hybrid", label: "中心聚拢", hint: "中心规则 · 边缘随机", colorMode: "theme", params: { mode: "hybrid", shape: "circle", spacing: 30, minSize: 1.5, maxSize: 12, coreRadius: 38, transition: 34, edgeDensity: 55, opacity: 90 } },
    { id: "mosaic-triangle", label: "三角马赛克", hint: "三角 · 边对边", colorMode: "theme", params: { mode: "regular", shape: "triangle", spacing: 46, minSize: 4, maxSize: 14, opacity: 80 } },
    { id: "hex-polygon", label: "六边阵列", hint: "等边六边形", colorMode: "theme", params: { mode: "regular", shape: "polygon", polygonSides: 6, spacing: 48, minSize: 4, maxSize: 13, opacity: 82 } },
    { id: "diamond-line", label: "菱形渐变", hint: "线性 · 菱形", colorMode: "theme", params: { mode: "linear", shape: "diamond", spacing: 44, minSize: 2, maxSize: 12, opacity: 85 } },
    { id: "dark-mono", label: "深底反白", hint: "固定配色 · 深色", colorMode: "fixed", params: { mode: "regular", shape: "circle", spacing: 40, minSize: 2, maxSize: 9, opacity: 80, fg: "#f5f5f0", bg: "#1d2420" } },
    { id: "grid-blueprint", label: "图纸网格", hint: "固定配色 · 冷色", colorMode: "fixed", params: { mode: "regular", shape: "square", spacing: 36, minSize: 1, maxSize: 5, cornerRadius: 0, opacity: 70, fg: "#2b5d8a", bg: "#eef3f7" } },
  ];

  function presetById(id) {
    for (let i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].id === id) return PRESETS[i];
    }
    return null;
  }

  function applyThemeColors(params, st) {
    const soft = (st && hexOr(st.soft, "")) ? st.soft : "#f2efe9";
    const primary = (st && hexOr(st.primary, "")) ? st.primary : "#3f6b4f";
    return Object.assign({}, params, { bg: soft, fg: primary });
  }

  /* 预设 → 可存储参数（归一化 + 主题取色）；width/height 由调用方按页面尺寸覆写 */
  function presetToParams(preset, st, overrides) {
    if (!preset) return normalize({});
    let params = Object.assign({}, preset.params);
    if (preset.colorMode === "theme" && st) params = applyThemeColors(params, st);
    if (overrides && typeof overrides === "object") params = Object.assign(params, overrides);
    return normalize(params);
  }

  /* ================================================================
     导出
     ================================================================ */

  global.BannerBuilderBackgrounds = Object.freeze({
    SCHEMA: SCHEMA,
    MODES: MODES,
    SHAPES: SHAPES,
    PRESETS: PRESETS,
    DEFAULTS: normalize({}),
    normalize: normalize,
    generatePoints: generatePoints,
    drawPoints: drawPoints,
    renderToCanvas: renderToCanvas,
    renderPatternToCanvas: renderPatternToCanvas,
    sceneElements: sceneElements,
    vectorizable: vectorizable,
    analyzeSource: analyzeSource,
    blendHexOver: blendHexOver,
    presetById: presetById,
    applyThemeColors: applyThemeColors,
    presetToParams: presetToParams,
  });
})(typeof window !== "undefined" ? window : globalThis);

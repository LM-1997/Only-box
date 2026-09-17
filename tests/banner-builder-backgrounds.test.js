/* banner-builder-backgrounds.js 引擎单测（node:vm 加载，无 DOM 依赖）
   覆盖：确定性、模式覆盖、边界裁剪、参数归一化、预设库、矢量化策略、颜色混合 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const code = fs.readFileSync(path.join(ROOT, "js", "banner-builder-backgrounds.js"), "utf8");
const sandbox = { console, Math, Number, Array, Object, String, JSON, parseInt, parseFloat, isNaN, isFinite };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "banner-builder-backgrounds.js" });

const BG = sandbox.BannerBuilderBackgrounds;
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error("  ✗ " + label); }
}
function section(name) { console.log("· " + name); }

/* ---------- 基础 ---------- */
section("基础导出");
ok(!!BG, "全局对象存在");
ok(typeof BG.normalize === "function", "normalize 函数");
ok(typeof BG.generatePoints === "function", "generatePoints 函数");
ok(Array.isArray(BG.PRESETS) && BG.PRESETS.length >= 12, "预设库 ≥12 项，实际 " + (BG.PRESETS ? BG.PRESETS.length : 0));

/* ---------- 归一化 ---------- */
section("参数归一化");
{
  const n = BG.normalize(null);
  ok(n.mode === "regular" && n.shape === "circle", "空输入 → 默认 regular/circle");
  ok(n.spacing === 34 && n.maxSize === 8 && n.seed === 7421, "默认数值");
  ok(/^#[0-9a-f]{6}$/i.test(n.fg) && /^#[0-9a-f]{6}$/i.test(n.bg), "颜色归一化为 6 位 hex");
  const bad = BG.normalize({ mode: "hacker", shape: "star", spacing: -10, maxSize: 999, opacity: 200, seed: "abc" });
  ok(bad.mode === "regular" && bad.shape === "circle", "非法枚举回退");
  ok(bad.spacing === 6 && bad.maxSize === 200 && bad.opacity === 100, "数值钳制");
  ok(bad.seed === 7421, "非法 seed 回退默认");
  const sw = BG.normalize({ minSize: 10, maxSize: 4 });
  ok(sw.minSize < sw.maxSize, "min>max 自动交换");
  const lin = BG.normalize({ mode: "linear", angle: 90 });
  ok(Math.abs(lin.linearAxisEnd.x - .5) < .01 && lin.linearAxisEnd.y > .8, "线性轴由 angle 推导");
  const stops = BG.normalize({ organicStops: [{ t: .8, size: 3 }, { t: .2, size: 1 }] });
  ok(stops.organicStops[0].t === 0 && stops.organicStops[stops.organicStops.length - 1].t === 1, "organic stops 排序且首尾钳制");
}

/* ---------- 确定性 ---------- */
section("确定性（同 seed 同点集）");
{
  const st = { mode: "organic", shape: "circle", seed: 123, width: 400, height: 300 };
  const a = JSON.stringify(BG.generatePoints(st));
  const b = JSON.stringify(BG.generatePoints(st));
  ok(a === b, "organic 同参数两次生成一致");
  const c = JSON.stringify(BG.generatePoints({ ...st, seed: 124 }));
  ok(a !== c, "不同 seed 产生不同点集");
}

/* ---------- 六模式覆盖 ---------- */
section("六模式点生成");
{
  const modes = ["regular", "linear", "radial", "organic", "hybrid"];
  for (const mode of modes) {
    const pts = BG.generatePoints({ mode, shape: "circle", seed: 42, width: 360, height: 480, spacing: 30, maxSize: 10 });
    ok(Array.isArray(pts) && pts.length > 4, mode + " 生成点集 n=" + (pts ? pts.length : 0));
    const allBounded = pts.every(p => p.x >= -20 && p.x <= 400 && p.y >= -20 && p.y <= 500 && p.size >= 0 && p.alpha >= 0 && p.alpha <= 1);
    ok(allBounded, mode + " 点集边界合法");
  }
  /* image 模式无源图 → 回退 regular 网格 */
  const img = BG.generatePoints({ mode: "image", shape: "circle", seed: 7, width: 200, height: 200, spacing: 20, maxSize: 6 });
  ok(Array.isArray(img) && img.length > 4, "image 无源图回退网格 n=" + img.length);
  /* image 模式带合成源图（4x4 像素，中心暗角） */
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const i = (y * 4 + x) * 4;
    const dark = (x === 1 || x === 2) && (y === 1 || y === 2);
    pixels[i] = dark ? 10 : 240; pixels[i + 1] = dark ? 10 : 240; pixels[i + 2] = dark ? 10 : 240; pixels[i + 3] = 255;
  }
  const src = { pixels, w: 4, h: 4, stats: { lumaLow: .1, lumaHigh: .9, lumaMedian: .5, lumaStd: .2 }, backdrop: { r: 240, g: 240, b: 240 } };
  const imgPts = BG.generatePoints({ mode: "image", shape: "circle", seed: 9, width: 120, height: 120, spacing: 18, maxSize: 8 }, { source: src });
  ok(Array.isArray(imgPts) && imgPts.length >= 0, "image 带源图不抛错 n=" + (imgPts ? imgPts.length : 0));
  const a2 = JSON.stringify(imgPts), b2 = JSON.stringify(BG.generatePoints({ mode: "image", shape: "circle", seed: 9, width: 120, height: 120, spacing: 18, maxSize: 8 }, { source: src }));
  ok(a2 === b2, "image 带源图确定性");
}

/* ---------- 形状覆盖 ---------- */
section("形状覆盖");
{
  for (const shape of ["circle", "square", "triangle", "diamond", "polygon", "morph"]) {
    const pts = BG.generatePoints({ mode: "radial", shape, seed: 5, width: 240, height: 320, spacing: 26, maxSize: 9 });
    ok(Array.isArray(pts) && pts.length > 4, "radial+" + shape + " n=" + (pts ? pts.length : 0));
  }
  /* morph 端点插值 */
  const mp = BG.generatePoints({
    mode: "linear", shape: "morph", seed: 3, width: 200, height: 200, spacing: 24, maxSize: 10,
    morphFrom: "circle", morphTo: "square", morphFromCornerRadius: 0, morphToCornerRadius: 60,
  });
  ok(Array.isArray(mp) && mp.length > 4, "morph 圆→方 n=" + mp.length);
  const morphVals = mp.map(p => p.morph);
  ok(Math.max(...morphVals) > .9 && Math.min(...morphVals) < .1, "morph 场覆盖 0~1");
}

/* ---------- 矢量化策略 ---------- */
section("PSD/PDF 矢量化");
{
  const v1 = BG.sceneElements({ mode: "regular", shape: "circle", seed: 1, width: 200, height: 200, spacing: 30, maxSize: 8 });
  ok(v1.kind === "vector" && v1.elements.length > 4, "circle → vector n=" + (v1.elements ? v1.elements.length : 0));
  const e0 = v1.elements[0];
  ok(e0.kind === "shape" && e0.radius > 0 && Math.abs(e0.w - e0.h) < .01, "circle 元素为圆角矩形（半径=半宽）");
  ok(e0.fill && typeof e0.fill.r === "number", "fill 为 {r,g,b}");
  const v2 = BG.sceneElements({ mode: "regular", shape: "triangle", seed: 1, width: 200, height: 200, spacing: 30, maxSize: 8 });
  ok(v2.kind === "raster" && v2.reason === "shape", "triangle → raster(shape)");
  const v3 = BG.sceneElements({ mode: "regular", shape: "circle", seed: 1, width: 200, height: 200, spacing: 30, maxSize: 8 }, { forceRaster: true });
  ok(v3.kind === "raster" && v3.reason === "forced", "forceRaster → raster(forced)");
  const v4 = BG.sceneElements({ mode: "regular", shape: "circle", seed: 1, width: 400, height: 400, spacing: 12, maxSize: 8 }, { maxVectorElements: 10 });
  ok(v4.kind === "raster" && v4.reason === "count", "超量 → raster(count)");
}

/* ---------- 颜色混合 ---------- */
section("颜色混合");
{
  ok(BG.blendHexOver("#000000", "#ffffff", 1) === "#000000", "alpha=1 返回前景");
  ok(BG.blendHexOver("#000000", "#ffffff", 0) === "#ffffff", "alpha=0 返回底色");
  const mid = BG.blendHexOver("#000000", "#ffffff", .5);
  ok(mid === "#808080" || mid === "#7f7f7f", "alpha=.5 混合 → " + mid);
}

/* ---------- 预设库 ---------- */
section("预设库");
{
  const ids = new Set();
  for (const p of BG.PRESETS) {
    ok(p.id && !ids.has(p.id), "预设 id 唯一 " + p.id);
    ids.add(p.id);
    const params = BG.presetToParams(p, { soft: "#f2efe9", primary: "#3f6b4f" });
    ok(params.mode && params.shape, "预设 " + p.id + " 归一化成功");
    if (p.colorMode === "theme") {
      ok(params.fg === "#3f6b4f" && params.bg === "#f2efe9", "theme 预设取主题色 " + p.id);
    }
  }
  ok(!!BG.presetById("dots-fine"), "presetById 命中");
  ok(BG.presetById("nope") === null, "presetById 未命中返回 null");
  const withOverride = BG.presetToParams(BG.presetById("dots-fine"), null, { spacing: 100, seed: 55 });
  ok(withOverride.spacing === 100 && withOverride.seed === 55, "overrides 覆写生效");
  /* 每个预设都能出点 */
  for (const p of BG.PRESETS) {
    const pts = BG.generatePoints(BG.presetToParams(p, null, { width: 300, height: 400 }));
    ok(Array.isArray(pts) && pts.length > 0, "预设 " + p.id + " 可生成点 n=" + (pts ? pts.length : 0));
  }
}

/* ---------- analyzeSource ---------- */
section("源图分析");
{
  const px = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 100; px[i + 1] = 150; px[i + 2] = 200; px[i + 3] = 255; }
  const r = BG.analyzeSource(px, 8, 8);
  ok(r && r.stats && typeof r.stats.lumaMedian === "number", "stats 输出");
  ok(r && r.backdrop && Math.abs(r.backdrop.g - 150) < 3, "backdrop 均值");
  ok(BG.analyzeSource(null, 0, 0) === null, "空源图 → null");
}

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);

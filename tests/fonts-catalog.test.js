"use strict";
/* tests/fonts-catalog.test.js —— data/fonts.js 统一字体清单结构校验（离线断言，不发网络请求）
   链接可用性与上游 diff 由 scripts/font-catalog-check.js 负责（人工手动运行）。 */

const assert = require("node:assert/strict");
const path = require("node:path");
require(path.join(__dirname, "..", "data", "fonts.js"));
const catalog = globalThis.OnlyBoxFonts;

assert.ok(catalog && Array.isArray(catalog.fonts), "清单存在且 fonts 为数组");
const fonts = catalog.fonts;
assert.ok(fonts.length >= 30 && fonts.length <= 50, `首批 30-50 款（实际 ${fonts.length}）`);

/* 唯一性 */
const ids = fonts.map(f => f.id);
assert.equal(new Set(ids).size, ids.length, "id 唯一");
const ranks = fonts.map(f => f.popularityRank).sort((a, b) => a - b);
ranks.forEach((r, i) => assert.equal(r, i + 1, `popularityRank 连续且从 1 开始（位置 ${i + 1} 处为 ${r}）`));
const legacySeen = new Set();
fonts.forEach(f => (f.legacyKeys || []).forEach(k => {
  assert.ok(!legacySeen.has(k), `legacyKey 不重复: ${k}`);
  legacySeen.add(k);
}));

/* 必备字段（授权可追溯是硬性要求） */
fonts.forEach(f => {
  for (const key of ["id", "family", "name", "category", "license", "licenseUrl", "sourceProject"]) {
    assert.ok(f[key], `${f.id} 缺少 ${key}`);
  }
  assert.ok(Array.isArray(f.languages) && f.languages.length, `${f.id} 标注语言覆盖`);
  assert.ok(Array.isArray(f.weights) && f.weights.length, `${f.id} 标注字重档位`);
  const sorted = f.weights.slice().sort((a, b) => a - b);
  assert.deepEqual(f.weights, sorted, `${f.id} weights 升序`);
  assert.ok(f.weights.every(w => w >= 100 && w <= 900 && Number.isInteger(w)), `${f.id} 字重为 100-900 整数档`);
  assert.ok(/^https:\/\//.test(f.licenseUrl), `${f.id} licenseUrl 为 https`);
  const load = f.load || {};
  assert.ok(load.css || load.faces, `${f.id} 有 CDN 加载源`);
  if (load.css && !Array.isArray(load.css)) {
    const cssKeys = Object.keys(load.css).map(Number);
    assert.deepEqual(cssKeys.sort((a, b) => a - b), f.weights, `${f.id} load.css 覆盖全部标注字重`);
  }
  if (load.faces) {
    assert.ok(load.faces.every(s => /^https:\/\//.test(s.url)), `${f.id} faces 直链为 https`);
    assert.deepEqual(load.faces.map(s => s.weight).sort((a, b) => a - b), f.weights, `${f.id} faces 字重与 weights 一致`);
  }
});

/* 关键字体与语言覆盖 */
const byId = Object.fromEntries(fonts.map(f => [f.id, f]));
assert.equal(byId["noto-sans-sc"].family, "Noto Sans SC", "思源黑体 family 与上游 @font-face 一致");
assert.deepEqual(byId["noto-sans-sc"].weights, [100, 200, 300, 400, 500, 600, 700, 800, 900], "思源黑体 9 档全字重");
assert.equal(byId["noto-sans-sc"].popularityRank, 1, "思源黑体 rank 1（默认预加载）");
assert.ok(byId["noto-sans-sc"].languages.includes("zh-Hans"), "思源黑体标注简体中文");
assert.ok(byId["unbounded-sans"].legacyKeys.includes("logosc"), "无界黑兼容旧 key logosc");
assert.ok(fonts.some(f => f.languages.includes("zh-Hant")), "覆盖繁体");
assert.ok(fonts.some(f => f.languages.includes("ja")), "覆盖日文");
assert.ok(fonts.filter(f => f.languages.includes("en")).length >= 10, "英文/拉丁字体充足");

/* 分类维度参考 yuleshow/chinese-fonts 的标注体系 */
const CATEGORIES = new Set(["黑体", "宋体", "楷体", "圆体", "手写", "展示", "等宽", "艺术体", "仿宋", "像素"]);
fonts.forEach(f => assert.ok(CATEGORIES.has(f.category), `${f.id} category「${f.category}」在标注体系内`));

/* 排除清单：免费商用 ≠ 允许第三方再分发的字体不得进入 fonts 数组 */
const excludedNames = (catalog.excluded || []).map(x => x.name);
assert.ok(excludedNames.some(n => n.includes("阿里妈妈数黑体")), "排除清单记录阿里妈妈数黑体");
assert.ok(excludedNames.some(n => n.includes("HONOR")), "排除清单记录 HONOR Sans");
const forbidden = ["阿里妈妈", "钉钉", "方正", "HONOR", "Helvetica"];
fonts.forEach(f => {
  const text = [f.name, f.nameEn, f.id].join(" ");
  forbidden.forEach(word => assert.ok(!text.includes(word), `${f.id} 不得包含未授权分发的厂商字体（${word}）`));
});

/* 预加载策略：rank 前 20 有中文字体打底 */
const top20 = fonts.filter(f => f.popularityRank <= 20);
assert.ok(top20.filter(f => f.languages.some(l => l.startsWith("zh"))).length >= 10, "rank 前 20 中中文字体不少于 10 款");

console.log(`fonts-catalog 测试全部通过（${fonts.length} 款字体）`);

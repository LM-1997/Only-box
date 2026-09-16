#!/usr/bin/env node
/* scripts/font-catalog-check.js —— 字体清单维护脚本（本地手动运行，不打包进线上产物）
 *
 * 用途：
 *   1. 校验 data/fonts.js 结构完整性（id/rank 唯一、weights 与 load 一致、license 可追溯）
 *   2. 检查清单内全部 CDN 直链 / licenseUrl / desktop 链接的可用性（HEAD，失败回退 GET）
 *   3. 对比上游聚合源（cn-fontsource npm 包）是否有新增字体，输出待人工审核清单
 *
 * 原则：只读 + 只输出 diff 报告，绝不自动写入 data/fonts.js；
 *       所有变更需人工核实授权后手动更新清单并提交。
 *
 * 运行：node scripts/font-catalog-check.js [--fast]（--fast 跳过 licenseUrl 检查）
 */

"use strict";

const path = require("path");
require(path.join(__dirname, "..", "data", "fonts.js"));
const catalog = globalThis.OnlyBoxFonts;

if (!catalog || !Array.isArray(catalog.fonts) || !catalog.fonts.length) {
  console.error("[FATAL] data/fonts.js 未暴露 globalThis.OnlyBoxFonts.fonts");
  process.exit(1);
}

const problems = [];
function report(level, msg) {
  if (level === "error") problems.push(msg);
  console.log((level === "error" ? "  ✗ " : level === "warn" ? "  ⚠ " : "  · ") + msg);
}

/* ---------- 1. 结构校验 ---------- */
console.log("== 1. 结构校验 ==");
const seenId = new Map(), seenRank = new Map(), seenLegacy = new Map();
const allUrls = [];
function collectUrl(url, where) {
  if (!url) return;
  if (!/^https:\/\//.test(url)) report("error", where + " 非 https 链接: " + url);
  allUrls.push({ url, where });
}

for (const f of catalog.fonts) {
  const tag = f.id || "(缺 id)";
  if (seenId.has(f.id)) report("error", `id 重复: ${f.id}`);
  seenId.set(f.id, true);
  if (seenRank.has(f.popularityRank)) report("error", `popularityRank 重复: ${f.popularityRank} (${seenRank.get(f.popularityRank)} / ${f.id})`);
  seenRank.set(f.popularityRank, f.id);

  for (const key of ["family", "name", "category", "license", "licenseUrl", "sourceProject"]) {
    if (!f[key]) report("error", `${tag} 缺少字段 ${key}`);
  }
  if (!Array.isArray(f.weights) || !f.weights.length) report("error", `${tag} weights 为空`);
  else if (f.weights.some((w, i, a) => i && w <= a[i - 1])) report("error", `${tag} weights 未按升序: ${f.weights}`);
  if (!Array.isArray(f.languages) || !f.languages.length) report("error", `${tag} languages 为空`);
  (f.legacyKeys || []).forEach((k) => {
    if (seenLegacy.has(k)) report("error", `legacyKey 重复: ${k} (${seenLegacy.get(k)} / ${f.id})`);
    seenLegacy.set(k, f.id);
  });

  const load = f.load || {};
  if (load.css) {
    if (Array.isArray(load.css)) {
      /* 整包 css（cn-fontsource 风格）：一个/多个 css 覆盖该字体全部字重，无法按 key 映射字重 */
      if (!load.css.length) report("error", `${tag} load.css 为空数组`);
      load.css.forEach((u) => collectUrl(u, `${tag} load.css`));
    } else {
      const cssKeys = Object.keys(load.css).map(Number).sort((a, b) => a - b);
      if (JSON.stringify(cssKeys) !== JSON.stringify(f.weights)) {
        report("error", `${tag} load.css 字重 [${cssKeys}] 与 weights [${f.weights}] 不一致`);
      }
      Object.values(load.css).forEach((u) => collectUrl(u, `${tag} load.css`));
    }
  }
  if (load.faces) {
    if (!load.faces.length) report("error", `${tag} load.faces 为空`);
    const faceWeights = load.faces.map((s) => s.weight).sort((a, b) => a - b);
    if (JSON.stringify(faceWeights) !== JSON.stringify(f.weights)) {
      report("warn", `${tag} load.faces 字重 [${faceWeights}] 与 weights [${f.weights}] 不一致`);
    }
    load.faces.forEach((s) => collectUrl(s.url, `${tag} load.faces`));
  }
  if (!load.css && !load.faces) report("error", `${tag} 既无 load.css 也无 load.faces`);
  if (f.desktop) collectUrl(f.desktop.url, `${tag} desktop`);
  if (f.desktop && f.desktop.weights) {
    Object.keys(f.desktop.weights).forEach((w) => {
      const entry = f.desktop.weights[w];
      if (entry && entry.url) collectUrl(entry.url, `${tag} desktop.weights[${w}]`);
    });
  }
  if (!process.argv.includes("--fast")) collectUrl(f.licenseUrl, `${tag} licenseUrl`);
}

const ranks = catalog.fonts.map((f) => f.popularityRank).sort((a, b) => a - b);
ranks.forEach((r, i) => { if (r !== i + 1) report("warn", `popularityRank 不连续（缺 ${i + 1}，实际 ${r}）——仅提示`); });
console.log(`  · 共 ${catalog.fonts.length} 款字体，待检查链接 ${allUrls.length} 条`);

/* ---------- 2. 直链可用性 ---------- */
console.log("== 2. 直链可用性检查 ==");
async function checkUrl({ url, where }) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(20000) });
      if (res.ok) return { url, where, ok: true };
      // 4xx/5xx：HEAD 被拒时用 GET 重试一次
      if (method === "HEAD") continue;
      return { url, where, ok: false, status: res.status };
    } catch (e) {
      if (method === "HEAD") continue;
      return { url, where, ok: false, status: (e && e.name) || "ERROR" };
    }
  }
}
async function pool(items, size, worker) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx]); }
  }));
  return results;
}

(async () => {
  const results = await pool(allUrls, 6, checkUrl);
  let dead = 0;
  for (const r of results) {
    if (!r.ok) { dead += 1; report("error", `链接失效 [${r.status}] ${r.where}: ${r.url}`); }
  }
  console.log(`  · ${results.length - dead}/${results.length} 条链接可用`);

  /* ---------- 3. 上游新增对比（cn-fontsource） ---------- */
  console.log("== 3. 上游新增对比（cn-fontsource，人工审核用） ==");
  try {
    const known = new Set();
    catalog.fonts.forEach((f) => {
      const css = (f.load && f.load.css) || [];
      (Array.isArray(css) ? css : Object.values(css)).forEach((u) => {
        const m = String(u).match(/npm\/(cn-fontsource-[^@/]+)/); if (m) known.add(m[1]);
      });
    });
    const found = new Set();
    for (let from = 0; from < 1000; from += 100) {
      const res = await fetch("https://registry.npmjs.org/-/v1/search?text=cn-fontsource&size=100&from=" + from, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) break;
      const j = await res.json();
      (j.objects || []).forEach((o) => { if (o.package && o.package.name.startsWith("cn-fontsource-")) found.add(o.package.name); });
      if (!j.objects || j.objects.length < 100) break;
    }
    const newPkgs = [...found].filter((n) => !known.has(n) && !known.has(n.replace(/-regular$/, ""))).sort();
    if (newPkgs.length) {
      console.log(`  ⚠ 上游出现 ${newPkgs.length} 个清单未收录的 cn-fontsource 包（授权需人工核实后再决定是否加入）：`);
      newPkgs.forEach((n) => console.log("    - " + n + "（https://www.npmjs.com/package/" + n + "）"));
    } else {
      console.log("  · 上游无未收录的 cn-fontsource 包");
    }
  } catch (e) {
    console.log("  ⚠ 上游对比失败（网络原因）：" + ((e && e.message) || e));
  }

  console.log("\n== 结果 ==");
  if (problems.length) {
    console.log(`发现 ${problems.length} 个问题，需人工修复 data/fonts.js：`);
    problems.forEach((p) => console.log("  - " + p));
    process.exit(2);
  }
  console.log("全部通过。清单可用。");
  console.log("提示：本脚本只输出报告，不写入 data/fonts.js；新增/调整字体请人工核实授权后手动修改。");
})();

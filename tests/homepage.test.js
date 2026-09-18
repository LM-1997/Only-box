/* ================================================================
   tests/homepage.test.js —— 首页（index.html）静态健康检查

   首页是整个站点的入口，工具卡片一旦指向不存在的文件、CSS 引用丢失或锚点
   失效，用户点进去就是 404。这里用静态解析守住这些"改了别的页面把首页带崩"
   的情况，无需浏览器即可在 CI 里跑。
   ================================================================ */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync("index.html", "utf8").replace(/^\uFEFF/, ""); /* 首页带 BOM，解析前先剥掉 */

/* ============ 基础文档结构 ============ */

assert.match(html, /^<!DOCTYPE html>/i, "首页以 DOCTYPE 开头");
assert.match(html, /<html lang="zh-CN">/, "声明中文语言");
assert.match(html, /<meta charset="UTF-8">/i, "声明 UTF-8");
assert.match(html, /<meta name="viewport"[^>]+width=device-width/, "含移动端 viewport");
assert.match(html, /<title>[^<]+<\/title>/, "有标题");
assert.match(html, /<meta name="description" content="[^"]+"/, "有 description，便于分享与收录");

/* ============ 引用的资源必须存在 ============ */

const refs = [];
{
  const re = /(?:href|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) refs.push(m[1]);
}
assert.ok(refs.length > 10, "首页解析出足够多的引用（实测 " + refs.length + "）");

const internalRefs = refs.filter(function (r) { return !/^(https?:|mailto:|tel:|data:)/i.test(r); });
internalRefs.forEach(function (ref) {
  const file = ref.split("#")[0].split("?")[0];
  if (!file) return; /* 纯锚点 */
  const target = path.normalize(file.replace(/^\.\//, ""));
  assert.ok(fs.existsSync(target), "首页引用的 " + ref + " 指向的文件存在（" + target + "）");
});

/* 锚点必须能落在本页元素上 */
const anchors = refs.filter(function (r) { return r.charAt(0) === "#"; });
anchors.forEach(function (anchor) {
  const id = anchor.slice(1);
  assert.ok(
    new RegExp('id="' + id + '"').test(html),
    "首页锚点 " + anchor + " 有对应 id 元素"
  );
});

/* CSS：设计系统文件存在且定义了主色令牌 */
assert.match(html, /href="\.\/css\/only-box\.css"/, "引用全站设计系统 CSS");
assert.ok(fs.existsSync("css/only-box.css"), "css/only-box.css 存在");
{
  const css = fs.readFileSync("css/only-box.css", "utf8");
  ["--ob-primary", "--ob-accent", "--ob-bg", "--ob-ink", "--ob-line"].forEach(function (token) {
    assert.ok(css.indexOf(token) >= 0, "设计系统定义了 " + token);
  });
}

/* ============ 工具卡片 ============ */

const toolPages = fs.readdirSync("tools").filter(function (f) { return /\.html$/.test(f); });

const cards = [];
{
  const re = /<a class="tool-card" href="([^"]+)">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) cards.push({ href: m[1], inner: m[2] });
}
assert.ok(cards.length >= 12, "首页至少 12 个工具卡片（实测 " + cards.length + "）");

const seen = {};
cards.forEach(function (card, i) {
  assert.match(card.href, /^\.\/tools\/[a-z0-9-]+\.html$/, "第 " + (i + 1) + " 张卡片 href 指向 tools 下的页面");
  assert.equal(seen[card.href], undefined, "卡片 " + card.href + " 不重复");
  seen[card.href] = true;
  const file = card.href.replace(/^\.\//, "");
  assert.ok(fs.existsSync(file), "卡片指向的页面存在：" + file);
  assert.match(card.inner, /<h3>[^<]+<\/h3>/, card.href + " 有标题");
  assert.match(card.inner, /<p>[^<]+<\/p>/, card.href + " 有一句话描述");
  assert.match(card.inner, /class="enter-link"/, card.href + " 有入口按钮");
  /* 卡片规范：只保留标题 + 描述 + 入口，不放图标与英文标语 */
  assert.equal(/<svg/.test(card.inner), false, card.href + " 卡片内不含图标（首页卡片规范）");
});

/* 所有工具页面都必须能被首页访问到（新工具上线忘挂首页 = 用户找不到）。
   例外：meta refresh 跳转桩页（如 banner-builder-selftest.html）本身就是跳板，
   不进首页，但它的跳转目标必须有效。 */
const redirectStubs = [];
toolPages.forEach(function (page) {
  const markup = fs.readFileSync(path.join("tools", page), "utf8");
  const m = markup.match(/<meta http-equiv="refresh" content="\d+;\s*url=([^"]+)"/i);
  if (!m) return;
  redirectStubs.push(page);
  const target = path.join("tools", m[1]);
  assert.ok(fs.existsSync(target), page + " 的跳转目标存在：" + target);
});

{
  const linked = cards.map(function (c) { return path.basename(c.href); });
  const orphans = toolPages.filter(function (f) {
    return linked.indexOf(f) < 0 && redirectStubs.indexOf(f) < 0;
  });
  assert.deepEqual(orphans, [], "无未挂到首页的工具页面（孤立页：" + orphans.join(", ") + "）");
}

/* ============ 外链安全 ============ */

{
  const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    assert.match(tag, /target="_blank"/, "外链 " + m[1] + " 新标签打开");
    assert.match(tag, /rel="[^"]*noopener[^"]*"/, "外链 " + m[1] + " 带 noopener（防 tabnabbing）");
  }
}

/* ============ 不得有重复 id ============ */

{
  const ids = [];
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  const dup = ids.filter(function (id, i) { return ids.indexOf(id) !== i; });
  assert.deepEqual(dup, [], "首页无重复 id（重复：" + dup.join(", ") + "）");
}

/* ============ 各工具页面的脚本引用健康度 ============ */
/* 拆分 js/*.js 后最容易漏的是：新模块没写进 HTML、或忘了升 ?v= 缓存号。 */

/* 收集各页面的脚本引用，供下面的存在性 / 版本号 / 一致性检查复用 */
const scriptRefs = [];
toolPages.forEach(function (page) {
  if (redirectStubs.indexOf(page) >= 0) return; /* 纯跳转桩页不加载脚本 */
  const markup = fs.readFileSync(path.join("tools", page), "utf8");
  const re = /<script\s+src="([^"]+)"\s*><\/script>/g;
  let m;
  let count = 0;
  while ((m = re.exec(markup)) !== null) {
    count += 1;
    const raw = m[1];
    const file = raw.split("?")[0].replace(/^\.\.\//, "");
    scriptRefs.push({ page: page, raw: raw, file: file, version: (raw.split("?v=")[1] || "") });
  }
  assert.ok(count > 0, page + " 至少引入了一个脚本");
});

scriptRefs.forEach(function (ref) {
  assert.ok(fs.existsSync(ref.file), ref.page + " 引用的脚本存在：" + ref.file);
});

/* 缓存版本号红线：本次拆分涉及的脚本必须带 ?v=，否则改了 js 线上不生效。
   历史页面里遗留的无版本号引用只做提示，不在本测试里判失败（避免与本次改动无关的红）。 */
const VERSION_STRICT = /^js\/banner-builder/;
const missingVersion = scriptRefs.filter(function (ref) {
  return !/^js\/vendor\//.test(ref.file) && !/\?v=\d{8}-\d{2}$/.test(ref.raw);
});
missingVersion.forEach(function (ref) {
  if (VERSION_STRICT.test(ref.file)) {
    assert.fail(ref.page + " 的 " + ref.file + " 缺少缓存版本号 ?v=YYYYMMDD-NN（实测 " + ref.raw + "）");
  }
});
if (missingVersion.length) {
  console.warn("[提示] 以下脚本引用未带缓存版本号，改到它们时记得补 ?v=：");
  missingVersion.forEach(function (ref) { console.warn("  - " + ref.page + " → " + ref.raw); });
}

/* 被多个页面共用的脚本，缓存号必须统一（不一致会导致同一次发布加载两份代码） */
{
  const versionByFile = {};
  toolPages.forEach(function (page) {
    const markup = fs.readFileSync(path.join("tools", page), "utf8");
    const re = /<script\s+src="([^"]+)"\s*><\/script>/g;
    let m;
    while ((m = re.exec(markup)) !== null) {
      const raw = m[1];
      const file = raw.split("?")[0].replace(/^\.\.\//, "");
      if (!/^js\/banner-builder/.test(file)) continue; /* 本次只审计本轮拆分涉及的脚本 */
      const v = (raw.split("?v=")[1] || "");
      if (!versionByFile[file]) versionByFile[file] = {};
      versionByFile[file][v] = true;
    }
  });
  Object.keys(versionByFile).forEach(function (file) {
    const versions = Object.keys(versionByFile[file]);
    assert.equal(versions.length, 1, "共用脚本 " + file + " 在各页面的缓存号一致（实测：" + versions.join(" / ") + "）");
  });
}

console.log("首页静态检查全部通过（" + cards.length + " 个工具卡片，" + toolPages.length + " 个工具页面）");

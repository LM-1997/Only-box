/* ================================================================
   tests/e2e/home.e2e.test.js —— 首页（index.html）浏览器端到端测试

   静态检查（tests/homepage.test.js）只能证明"链接指向的文件存在"，
   证明不了"点下去真的能用"。这里用真实 Chromium 跑一遍首页的主路径：
   加载无报错 → 锚点定位 → 卡片进工具 → 导航往返 → 移动端不溢出。
   ================================================================ */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./_harness");

let playwright = null;
try { playwright = require("playwright"); } catch (e) { playwright = null; }
const skip = playwright ? false : "未安装 playwright，跳过浏览器 E2E";

let server = null;
let browser = null;

before(async function () {
  if (!playwright) return;
  server = await harness.startServer();
  browser = await playwright.chromium.launch();
});

after(async function () {
  if (browser) await browser.close();
  if (server) await server.close();
});

test("首页加载：卡片渲染完整且无 JS 报错", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const { page } = h;
    await page.goto(server.base + "/index.html", { waitUntil: "load" });
    await page.waitForSelector(".tool-card");

    const title = await page.title();
    assert.match(title, /Only-box/, "首页标题正确");

    const count = await page.locator(".tool-card").count();
    assert.equal(count, 13, "首页渲染 13 个工具卡片");

    /* 每张卡片都要有可见的标题与入口，避免只渲染了空壳 */
    const firstCard = page.locator(".tool-card").first();
    assert.ok((await firstCard.locator("h3").innerText()).length > 0, "卡片标题可见");
    assert.ok((await firstCard.locator(".enter-link").innerText()).indexOf("立即进入") >= 0, "卡片入口按钮可见");

    /* 全站设计系统真的生效（CSS 变量被解析成具体颜色，而不是回退透明） */
    const bg = await page.evaluate(function () {
      return getComputedStyle(document.body).backgroundColor;
    });
    assert.notEqual(bg, "rgba(0, 0, 0, 0)", "背景样式已应用（CSS 加载成功）");

    harness.assertNoErrors(h, "首页");
  });
});

test("首页「开始使用」锚点定位到工具区", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const { page } = h;
    await page.goto(server.base + "/index.html", { waitUntil: "load" });
    await page.click(".home-actions .primary-link");
    await page.waitForFunction(function () { return window.location.hash === "#tools"; });

    const box = await page.locator("#tools").boundingBox();
    assert.ok(box && box.height > 0, "工具区有实际高度");
    harness.assertNoErrors(h, "首页锚点");
  });
});

test("工具卡片可进入长条搭建器页面", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const { page } = h;
    await page.goto(server.base + "/index.html", { waitUntil: "load" });
    await page.click('a.tool-card[href="./tools/banner-builder.html"]');
    await page.waitForURL(/tools\/banner-builder\.html$/);

    const title = await page.title();
    assert.match(title, /长条/, "跳转后进入长条工具页");
    assert.equal(page.url().indexOf(server.base) === 0, true, "停留在本地站点内");
    harness.assertNoErrors(h, "首页→长条工具");
  });
});

test("工具页可返回首页（导航与页脚两条路径）", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const { page } = h;
    await page.goto(server.base + "/tools/banner-builder.html", { waitUntil: "load" });
    await page.click(".site-nav .brand-link");
    await page.waitForURL(/index\.html$/);
    assert.equal(await page.locator(".tool-card").count(), 13, "从导航回首页后卡片正常渲染");

    await page.goto(server.base + "/tools/banner-builder.html", { waitUntil: "load" });
    await page.click(".site-footer a");
    await page.waitForURL(/index\.html$/);
    assert.ok(await page.locator(".home-hero").isVisible(), "从页脚回首页后首屏可见");
    harness.assertNoErrors(h, "返回首页");
  });
});

test("移动端视口下首页不横向溢出", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, { viewport: { width: 390, height: 844 } }, async function (h) {
    const { page } = h;
    await page.goto(server.base + "/index.html", { waitUntil: "load" });
    await page.waitForSelector(".tool-card");

    const overflow = await page.evaluate(function () {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 2,
      "移动端无横向滚动（scrollWidth " + overflow.scrollWidth + " ≤ clientWidth " + overflow.clientWidth + "）"
    );

    /* 卡片在窄屏下依然完整可见（没有被裁成 0 宽或溢出屏幕） */
    const box = await page.locator(".tool-card").first().boundingBox();
    assert.ok(box.width > 100 && box.width <= 390, "卡片宽度适配窄屏（实测 " + Math.round(box.width) + "px）");
    harness.assertNoErrors(h, "移动端首页");
  });
});

test("「关于本项目」入口可达", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const { page } = h;
    await page.goto(server.base + "/index.html", { waitUntil: "load" });
    await page.click('.nav-links a[href="./about.html"]');
    await page.waitForURL(/about\.html$/);
    const heading = await page.locator("h1, .page-shell h2").first().innerText();
    assert.ok(heading.length > 0, "关于页有内容标题（实测「" + heading + "」）");
    harness.assertNoErrors(h, "关于页");
  });
});

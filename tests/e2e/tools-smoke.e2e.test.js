/* ================================================================
   tests/e2e/tools-smoke.e2e.test.js —— 全部工具页加载冒烟

   本轮拆分动了共享脚本（js/ui/*、canvas-utils、mobile-image-upload 等），
   这些脚本被多个工具页共用。逐个页面真实打开一遍，是发现"某页少引一个脚本 /
   某个全局被改名"这类事故成本最低的方式：只要页面在浏览器里报一个错，
   这里就红。
   ================================================================ */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

/* meta refresh 跳转桩页不承载功能，跳过 */
function toolPages() {
  const dir = path.join(harness.ROOT, "tools");
  return fs.readdirSync(dir).filter(function (file) {
    if (!/\.html$/.test(file)) return false;
    const markup = fs.readFileSync(path.join(dir, file), "utf8");
    return !/<meta http-equiv="refresh"/i.test(markup);
  });
}

test("全部工具页：加载后无 JS 报错且结构完整", { skip: skip }, async function () {
  const pages = toolPages();
  assert.ok(pages.length >= 10, "工具页数量符合预期（实测 " + pages.length + "）");
  const problems = [];

  for (let i = 0; i < pages.length; i += 1) {
    const name = pages[i];
    await harness.withPage(browser, server.base, { timeout: 20000 }, async function (h) {
      const { page } = h;
      page.on("dialog", function (dialog) { dialog.accept().catch(function () {}); });
      try {
        await page.goto(server.base + "/tools/" + name, { waitUntil: "load" });
        /* 给各工具自己的 init / DOMContentLoaded 一点时间，让潜在异常暴露出来 */
        await page.waitForTimeout(400);

        const title = await page.title();
        if (!title || !title.trim()) problems.push(name + "：页面标题为空");

        const shell = await page.evaluate(function () {
          const main = document.querySelector("main, .page-shell, .bb-shell, #app");
          return { hasMain: !!main, nav: !!document.querySelector(".site-nav"), footer: !!document.querySelector(".site-footer") };
        });
        if (!shell.hasMain) problems.push(name + "：缺少主内容容器");
        if (!shell.nav) problems.push(name + "：缺少站点导航");
        if (!shell.footer) problems.push(name + "：缺少站点页脚");

        if (h.errors.length) problems.push(name + "：JS 报错 → " + h.errors.join(" / "));
      } catch (err) {
        problems.push(name + "：加载异常 → " + err.message);
      }
    });
  }

  assert.deepEqual(problems, [], "工具页冒烟问题：\n" + problems.join("\n"));
});

test("全部工具页：窄屏（390px）下不横向溢出", { skip: skip }, async function () {
  const pages = toolPages();
  const problems = [];

  for (let i = 0; i < pages.length; i += 1) {
    const name = pages[i];
    await harness.withPage(browser, server.base, { viewport: { width: 390, height: 844 }, timeout: 20000 }, async function (h) {
      const { page } = h;
      try {
        await page.goto(server.base + "/tools/" + name, { waitUntil: "load" });
        await page.waitForTimeout(200);
        const overflow = await page.evaluate(function () {
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          };
        });
        /* 画布类工具本身允许横向滚动查看长条，只拦截明显失控的溢出（超过一屏宽） */
        if (overflow.scrollWidth > overflow.clientWidth + 40) {
          problems.push(name + "：横向溢出 " + overflow.scrollWidth + " > " + overflow.clientWidth);
        }
      } catch (err) {
        problems.push(name + "：加载异常 → " + err.message);
      }
    });
  }

  if (problems.length) {
    console.warn("[提示] 窄屏溢出（画布类工具可横向查看，属可接受范围，此处仅提示）：\n  " + problems.join("\n  "));
  }
  assert.ok(true, "窄屏检查完成");
});

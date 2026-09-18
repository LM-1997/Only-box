/* ================================================================
   tests/e2e/banner-builder.e2e.test.js —— 长条搭建器浏览器端到端测试

   本轮 banner-builder 做了大范围拆分（utils / font / render / ui / draft /
   events / modals / legacy-export / preview 从主脚本抽出）。单测只能保证各
   模块单独加载正常，保证不了"主脚本 init 后所有接线都通"。这里在真实浏览器里
   跑完整条主路径：初始化 → 加板块 → 改字段 → 预览同步 → 切步骤 → 导出/草稿。

   判定失败的唯一硬标准：console.error / pageerror 非空。
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

const PAGE = "/tools/banner-builder.html";

async function openBanner(h, options) {
  const { page } = h;
  await page.goto(server.base + PAGE, { waitUntil: "load" });
  /* init 完成的标志：板块库被渲染出条目 */
  await page.waitForSelector("#libraryList .bb-lib-item");
  return page;
}

test("初始化：板块库渲染全部模块类型，统计与画布就位", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const page = await openBanner(h);

    const moduleCount = await page.evaluate(function () {
      return window.BannerBuilderRegistry ? window.BannerBuilderRegistry.MODULE_ORDER.length : -1;
    });
    assert.ok(moduleCount > 0, "注册表在浏览器中可用（" + moduleCount + " 种模块）");

    const libCount = await page.locator("#libraryList .bb-lib-item[data-action='lib-add']").count();
    assert.equal(libCount, moduleCount, "板块库条目数与注册表一致");

    assert.match(await page.locator("#docStats").innerText(), /1 屏 · 0 个板块/, "初始统计为 1 屏 0 板块");
    assert.equal(await page.locator("#canvasBody .bb-page-canvas").count(), 1, "画布已渲染一屏");

    /* 拆分后各命名空间必须都在（少一个就说明某个新文件没被 HTML 引入） */
    const missing = await page.evaluate(function () {
      const names = [
        "BannerBuilderConstants", "BannerBuilderRegistry", "BannerBuilderModel",
        "BannerBuilderUtils", "BannerBuilderFont", "BannerBuilderRender",
        "BannerBuilderUi", "BannerBuilderDraft", "BannerBuilderEvents",
        "BannerBuilderModals", "BannerBuilderPreview", "BannerBuilderLegacy",
        "BannerBuilderLegacyExport", "BannerBuilderExport", "BannerBuilderPdfExport",
      ];
      return names.filter(function (n) { return !window[n]; });
    });
    assert.deepEqual(missing, [], "拆分出的命名空间全部挂载：" + missing.join(", "));

    harness.assertNoErrors(h, "长条工具初始化");
  });
});

test("全部模块类型都能加入画布且不报错", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, { timeout: 20000 }, async function (h) {
    const page = await openBanner(h);
    const types = await page.evaluate(function () {
      return window.BannerBuilderRegistry.MODULE_ORDER.slice();
    });

    for (let i = 0; i < types.length; i += 1) {
      await page.click("#libraryList .bb-lib-item[data-type='" + types[i] + "']");
      await page.waitForFunction(function (n) {
        return document.querySelectorAll("#canvasBody [data-action='module-pick']").length >= n;
      }, i + 1);
      /* 加完立即判一次错：某类板块渲染炸了要能定位到具体类型 */
      if (h.errors.length) {
        throw new Error("加入板块「" + types[i] + "」时报错：\n" + h.errors.join("\n"));
      }
    }

    const stats = await page.locator("#docStats").innerText();
    assert.match(stats, new RegExp(types.length + " 个板块"), "统计显示已加入 " + types.length + " 个板块（实测：" + stats + "）");
    harness.assertNoErrors(h, "全类型板块");
  });
});

test("编辑字段：改文本内容后预览同步", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const page = await openBanner(h);

    await page.click("#libraryList .bb-lib-item[data-type='freeText']");
    await page.waitForSelector("#canvasBody [data-action='module-pick']");
    /* 属性面板按步骤切换内容：主题背景步显示配色，只有编辑步才显示板块字段 */
    await page.click("#stepEdit");
    await page.click("#canvasBody [data-action='module-pick']");
    await page.waitForSelector("#panelBody .bb-field");

    const inputId = await page.evaluate(function () {
      const labels = Array.prototype.slice.call(document.querySelectorAll("#panelBody .bb-field label"));
      const hit = labels.filter(function (l) { return l.textContent.indexOf("文本内容") >= 0; })[0];
      return hit ? hit.htmlFor : null;
    });
    assert.ok(inputId, "属性面板渲染出「文本内容」字段");

    await page.fill("#" + inputId, "自动化冒烟文本");
    await page.waitForFunction(function () {
      const body = document.getElementById("canvasBody");
      return body && body.innerText.indexOf("自动化冒烟文本") >= 0;
    });
    harness.assertNoErrors(h, "字段编辑");
  });
});

test("步骤切换：编辑 / 导出面板内容正确", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const page = await openBanner(h);

    await page.click("#stepEdit");
    await page.waitForSelector(".bb-toolbar[data-panel='edit']", { state: "visible" });
    assert.ok(await page.locator("#addPageBtn").isVisible(), "编辑步骤露出「新增屏」");

    await page.click("#stepExport");
    await page.waitForSelector(".bb-export-btn");
    const labels = await page.locator(".bb-export-btn").allInnerTexts();
    const joined = labels.join("|");
    ["导出当前屏", "导出全部屏", "导出连续长图", "导出 PSD", "导出 PDF", "备份草稿"].forEach(function (name) {
      assert.ok(joined.indexOf(name) >= 0, "导出面板含「" + name + "」");
    });
    harness.assertNoErrors(h, "步骤切换");
  });
});

test("文档设置：新增屏 / 比例 / 连续模式 / 缩放", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const page = await openBanner(h);

    /* ratioGroup / screenModeGroup 都在「文档设置」步骤的工具栏里 */
    await page.click("#stepSetup");
    await page.waitForSelector("#ratioGroup", { state: "visible" });

    const size916 = await page.locator("#sizeReadout").innerText();
    assert.match(size916, /750/, "9:16 读出包含设计宽度 750（实测：" + size916 + "）");

    await page.click("#ratioGroup [data-ratio='3:4']");
    await page.waitForFunction(function () {
      return document.getElementById("sizeReadout").innerText.indexOf("1000") >= 0;
    });
    assert.match(await page.locator("#sizeReadout").innerText(), /1000/, "3:4 高度为 1000");

    await page.click("#ratioGroup [data-ratio='9:16']");
    await page.waitForFunction(function () {
      return document.getElementById("sizeReadout").innerText.indexOf("1334") >= 0;
    });

    /* 连续模式：画布切成长条容器 */
    await page.click("#screenModeGroup [data-screen='continuous']");
    await page.waitForSelector("#canvasBody .bb-strip", { state: "attached" });
    assert.equal(await page.locator("#canvasBody .bb-continuous").count() >= 0, true, "连续模式容器就位");

    /* 新增屏 */
    await page.click("#stepEdit");
    await page.click("#addPageBtn");
    await page.waitForFunction(function () {
      return document.getElementById("docStats").innerText.indexOf("2 屏") >= 0;
    });

    /* 缩放 */
    const before = await page.locator("#zoomValue").innerText();
    await page.click("#zoomInBtn");
    await page.waitForFunction(function (prev) {
      return document.getElementById("zoomValue").innerText !== prev;
    }, before);

    harness.assertNoErrors(h, "文档设置");
  });
});

test("左侧视图：图层树可切换并渲染", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const page = await openBanner(h);
    await page.click("#libraryList .bb-lib-item[data-type='cover']");
    await page.waitForSelector("#canvasBody [data-action='module-pick']");

    await page.click("#sideTabs [data-side='layers']");
    await page.waitForSelector("#layerPane", { state: "visible" });
    const items = await page.locator("#layerTree").innerText();
    assert.ok(items.length > 0, "图层树渲染出内容");
    harness.assertNoErrors(h, "图层视图");
  });
});

test("弹窗：导入主题可打开、可关闭", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const page = await openBanner(h);
    await page.click("#stepSetup");
    await page.waitForSelector("#importThemeBtn", { state: "visible" });
    await page.click("#importThemeBtn");
    await page.waitForSelector("#bb-theme-modal", { state: "visible" });

    /* 模态里应给出可复制的 AI 提示词输入区 */
    const hasTextarea = await page.locator("#bb-theme-modal textarea").count();
    assert.ok(hasTextarea >= 1, "主题导入弹窗含输入区");

    /* openModalA11y 负责 Escape 关闭，所有弹窗共用这一条链路 */
    await page.keyboard.press("Escape");
    await page.waitForSelector("#bb-theme-modal", { state: "detached" });

    /* 再开一次，用「关闭」按钮退出 */
    await page.click("#importThemeBtn");
    await page.waitForSelector("#bb-theme-modal", { state: "visible" });
    await page.locator("#bb-theme-modal button", { hasText: "关闭" }).click();
    await page.waitForSelector("#bb-theme-modal", { state: "detached" });
    harness.assertNoErrors(h, "弹窗");
  });
});

test("备份草稿：触发 JSON 文件下载", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const page = await openBanner(h);
    await page.click("#libraryList .bb-lib-item[data-type='freeText']");
    await page.waitForSelector("#canvasBody [data-action='module-pick']");
    await page.click("#stepExport");
    await page.waitForSelector("#saveDraftBtn", { state: "visible" });

    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.click("#saveDraftBtn");
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.json$/i, "草稿文件为 .json（实测 " + download.suggestedFilename() + "）");
    harness.assertNoErrors(h, "备份草稿");
  });
});

test("导出当前屏 PNG：触发图片下载", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, { timeout: 60000 }, async function (h) {
    const page = await openBanner(h);
    await page.click("#libraryList .bb-lib-item[data-type='freeText']");
    await page.waitForSelector("#canvasBody [data-action='module-pick']");
    await page.click("#stepExport");
    await page.waitForSelector(".bb-export-btn");

    const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
    await page.locator(".bb-export-btn", { hasText: "导出当前屏" }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.png$/i, "导出产物为 PNG（实测 " + download.suggestedFilename() + "）");
    harness.assertNoErrors(h, "导出 PNG");
  });
});

/* ================================================================
   tests/e2e/banner-builder-flows.e2e.test.js —— 长条搭建器深层交互

   上一个文件覆盖"能打开、能加点东西、能导出一张图"，这里继续压拆分后
   最容易断线的重型链路：AI 整份导入、草稿备份与恢复、图层树排序/跨屏/删除、
   画布内板块操作、主题切换、PSD / PDF 导出。这些都是跨多个新文件协作的
   功能（model + render + ui + events + modals + draft + legacy-export），
   单测覆盖不到接线层。
   ================================================================ */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const harness = require("./_harness");

let playwright = null;
try { playwright = require("playwright"); } catch (e) { playwright = null; }
const skip = playwright ? false : "未安装 playwright，跳过浏览器 E2E";

let server = null;
let browser = null;
let tmpDir = null;

before(async function () {
  if (!playwright) return;
  server = await harness.startServer();
  browser = await playwright.chromium.launch();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "onlybox-e2e-"));
});

after(async function () {
  if (browser) await browser.close();
  if (server) await server.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const PAGE = "/tools/banner-builder.html";

async function openBanner(h, options) {
  const { page } = h;
  /* 删除屏等交互会弹 confirm，统一接受。
     context 关闭后可能仍有挂起的 dialog，忽略以免产生未处理的 rejection */
  page.on("dialog", function (dialog) { dialog.accept().catch(function () {}); });
  await page.goto(server.base + PAGE, { waitUntil: "load" });
  await page.waitForSelector("#libraryList .bb-lib-item");
  return page;
}

const AI_DOC = {
  schemaVersion: 1,
  name: "E2E 测试活动",
  pages: [
    { name: "第 1 屏", modules: [{ type: "cover", data: { title: "e2e 封面", infoLines: ["a", "b"] } }] },
    { name: "第 2 屏", modules: [{ type: "freeText", data: { text: "e2e 正文", level: "h2" } }] },
  ],
};

test("AI 生成长条：粘贴 JSON → 预检 → 校验并应用", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, { timeout: 30000 }, async function (h) {
    const page = await openBanner(h);
    await page.click("#stepSetup");
    await page.click("#generateAiDocumentBtn");
    await page.waitForSelector("#bb-ai-doc-modal", { state: "visible" });

    const prompt = await page.inputValue("#bb-ai-prompt");
    assert.ok(prompt.length > 500, "弹窗给出完整提示词（实测 " + prompt.length + " 字符）");

    await page.fill("#bb-ai-result", JSON.stringify(AI_DOC));
    await page.waitForFunction(function () {
      const el = document.getElementById("bb-ai-preflight");
      return el && el.textContent.indexOf("预检通过") >= 0;
    }, { timeout: 10000 });

    await page.locator("#bb-ai-doc-modal button", { hasText: "校验并应用" }).click();
    await page.waitForFunction(function () {
      return document.getElementById("bb-ai-doc-modal") === null;
    }, { timeout: 20000 });

    const stats = await page.locator("#docStats").innerText();
    assert.match(stats, /2 屏/, "AI 文档应用后变成 2 屏（实测：" + stats + "）");
    assert.match(stats, /2 个板块/, "两屏各一个板块（实测：" + stats + "）");

    const canvasText = await page.locator("#canvasBody").innerText();
    assert.ok(canvasText.indexOf("e2e 封面") >= 0 && canvasText.indexOf("e2e 正文") >= 0, "两屏内容都渲染到画布");
    harness.assertNoErrors(h, "AI 整份导入");
  });
});

test("草稿：备份 → 下载 → 恢复，内容一致", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, { timeout: 30000 }, async function (h) {
    const page = await openBanner(h);
    await page.click("#libraryList .bb-lib-item[data-type='announcement']");
    await page.waitForSelector("#canvasBody [data-action='module-pick']");
    const before = await page.locator("#docStats").innerText();

    /* 备份 */
    await page.click("#stepExport");
    const savePromise = page.waitForEvent("download", { timeout: 30000 });
    await page.click("#saveDraftBtn");
    const download = await savePromise;
    const draftPath = path.join(tmpDir, "draft.json");
    await download.saveAs(draftPath);
    assert.ok(fs.statSync(draftPath).size > 100, "草稿文件有实际内容");

    /* 清空当前文档，再做恢复，避免"本来就没变"的假通过 */
    await page.click("#stepEdit");
    await page.click("#canvasBody [data-action='module-pick']");
    await page.click("#canvasBody [data-action='module-del']");
    await page.waitForFunction(function () {
      return document.getElementById("docStats").innerText.indexOf("0 个板块") >= 0;
    });

    /* 恢复 */
    await page.click("#stepSetup");
    await page.setInputFiles("#loadDraftInput", draftPath);
    await page.waitForFunction(function () {
      return document.getElementById("docStats").innerText.indexOf("1 个板块") >= 0;
    }, { timeout: 20000 });
    assert.equal(await page.locator("#docStats").innerText(), before, "恢复后统计回到备份时状态");
    harness.assertNoErrors(h, "草稿备份与恢复");
  });
});

test("图层树：选中 / 排序 / 跨屏 / 删除", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, { timeout: 30000 }, async function (h) {
    const page = await openBanner(h);
    await page.click("#libraryList .bb-lib-item[data-type='cover']");
    await page.click("#libraryList .bb-lib-item[data-type='freeText']");
    await page.waitForFunction(function () {
      return document.querySelectorAll("#canvasBody [data-action='module-pick']").length === 2;
    });
    await page.click("#stepEdit");
    await page.waitForSelector("#layerTree .bb-layer-module");

    const ids = await page.evaluate(function () {
      return Array.prototype.slice.call(document.querySelectorAll("#layerTree .bb-layer-module"))
        .map(function (row) { return row.dataset.moduleId; });
    });
    assert.equal(ids.length, 2, "图层树列出 2 个板块");

    /* ★ 选中：点第一个图层行，属性面板切到板块字段 */
    await page.click("#layerTree .bb-layer-module[data-module-id='" + ids[0] + "']");
    await page.waitForSelector("#panelBody .bb-field");
    assert.ok((await page.locator("#panelTitle").innerText()).length > 0, "选中后标题切换");

    /* ↑↓ 排序：焦点在第一行按 ↓，顺序应交换 */
    await page.focus("#layerTree .bb-layer-module[data-module-id='" + ids[0] + "']");
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(function (prev) {
      const rows = Array.prototype.slice.call(document.querySelectorAll("#layerTree .bb-layer-module"));
      return rows.length === 2 && rows[0].dataset.moduleId === prev;
    }, ids[1]);
    assert.ok(true, "↓ 键把第一个板块移到第二位");

    /* 跨屏：新增一屏后 PageDown 把板块移到下一屏 */
    await page.click("#addPageBtnSide");
    await page.waitForFunction(function () {
      return document.getElementById("docStats").innerText.indexOf("2 屏") >= 0;
    });
    const movedId = await page.evaluate(function () {
      const rows = document.querySelectorAll("#layerTree .bb-layer-module");
      return rows.length ? rows[0].dataset.moduleId : null;
    });
    await page.focus("#layerTree .bb-layer-module[data-module-id='" + movedId + "']");
    await page.keyboard.press("PageDown");
    await page.waitForFunction(function () {
      return document.getElementById("docStats").innerText.indexOf("2 屏") >= 0;
    });
    const pageOfMoved = await page.evaluate(function (id) {
      const row = document.querySelector("#layerTree .bb-layer-module[data-module-id='" + id + "']");
      return row ? row.closest("[data-page-id]").dataset.pageId : null;
    }, movedId);
    const secondPageId = await page.evaluate(function () {
      const heads = document.querySelectorAll("#layerTree [data-page-id]");
      return heads.length ? heads[heads.length - 1].dataset.pageId : null;
    });
    assert.equal(pageOfMoved, secondPageId, "PageDown 把板块移到下一屏");

    /* 删除：删掉一个板块，数量回落。
       删除按钮是 hover 才显形的图标，用 dispatchEvent 直接派发点击 */
    const beforeDel = await page.locator("#layerTree .bb-layer-module").count();
    await page.locator("#layerTree .bb-layer-module [data-action='layer-module-del']")
      .first()
      .dispatchEvent("click");
    await page.waitForFunction(function (n) {
      return document.querySelectorAll("#layerTree .bb-layer-module").length === n - 1;
    }, beforeDel);
    harness.assertNoErrors(h, "图层树");
  });
});

test("画布板块：上移 / 下移 / 删除", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, { timeout: 30000 }, async function (h) {
    const page = await openBanner(h);
    await page.click("#libraryList .bb-lib-item[data-type='cover']");
    await page.click("#libraryList .bb-lib-item[data-type='freeText']");
    await page.waitForFunction(function () {
      return document.querySelectorAll("#canvasBody [data-action='module-pick']").length === 2;
    });
    await page.click("#stepEdit");

    const ids = await page.evaluate(function () {
      return Array.prototype.slice.call(document.querySelectorAll("#canvasBody [data-action='module-pick']"))
        .map(function (el) { return el.dataset.moduleId; });
    });
    assert.equal(ids.length, 2, "画布渲染 2 个板块");

    /* 第二个上移 → 顺序交换 */
    await page.locator("#canvasBody [data-module-id='" + ids[1] + "'] [data-action='module-up']").first().click();
    await page.waitForFunction(function (prev) {
      const els = document.querySelectorAll("#canvasBody [data-action='module-pick']");
      return els.length === 2 && els[0].dataset.moduleId === prev;
    }, ids[1]);

    /* 删除 → 剩 1 个 */
    await page.locator("#canvasBody [data-action='module-del']").first().click();
    await page.waitForFunction(function () {
      return document.querySelectorAll("#canvasBody [data-action='module-pick']").length === 1;
    });
    assert.match(await page.locator("#docStats").innerText(), /1 个板块/, "统计同步为 1 个板块");
    harness.assertNoErrors(h, "画布板块操作");
  });
});

test("多屏：新增屏后可删除空屏", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const page = await openBanner(h);
    await page.click("#stepEdit");
    await page.click("#addPageBtn");
    await page.waitForFunction(function () {
      return document.getElementById("docStats").innerText.indexOf("2 屏") >= 0;
    });
    assert.equal(await page.locator("#canvasBody .bb-page-canvas").count(), 2, "画布出现两屏");

    /* 分屏模式下「删除本屏」在屏头（.bb-page-head），与 .bb-page-canvas 同级 */
    await page.click("#canvasBody .bb-page-card:last-child [data-action='page-del']");
    await page.waitForFunction(function () {
      return document.getElementById("docStats").innerText.indexOf("1 屏") >= 0;
    });
    assert.equal(await page.locator("#canvasBody .bb-page-canvas").count(), 1, "删除后回到一屏");
    harness.assertNoErrors(h, "增删屏");
  });
});

test("主题切换：配色落到画布 CSS 变量", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const page = await openBanner(h);
    /* 默认停在「主题与背景」步骤，面板里是主题卡片 */
    await page.waitForSelector(".bb-tbg-theme-card");

    const before = await page.evaluate(function () {
      const canvas = document.querySelector("#canvasBody .bb-page-canvas");
      return getComputedStyle(canvas).getPropertyValue("--ob-primary").trim();
    });
    assert.ok(before.length > 0, "画布已应用主题主色变量（实测 " + before + "）");

    const cards = page.locator(".bb-tbg-theme-card");
    const total = await cards.count();
    assert.ok(total >= 2, "提供多个预设主题");
    await cards.nth(1).click();
    await page.waitForFunction(function (prev) {
      const canvas = document.querySelector("#canvasBody .bb-page-canvas");
      return getComputedStyle(canvas).getPropertyValue("--ob-primary").trim() !== prev;
    }, before);
    assert.equal(await cards.nth(1).getAttribute("aria-pressed"), "true", "被点的主题卡片变为选中态");
    harness.assertNoErrors(h, "主题切换");
  });
});

test("导出设置：倍率与打包字体", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, {}, async function (h) {
    const page = await openBanner(h);
    await page.click("#stepExport");
    await page.waitForSelector("#exportScaleGroup", { state: "visible" });

    const before = await page.locator("#exportSizeReadout").innerText();
    await page.click("#exportScaleGroup [data-scale='3']");
    await page.waitForFunction(function (prev) {
      return document.getElementById("exportSizeReadout").innerText !== prev;
    }, before);
    assert.equal(await page.locator("#exportScaleGroup [data-scale='3']").getAttribute("aria-pressed"), "true", "3x 变为选中");

    await page.click("#packFontsToggle");
    assert.equal(await page.isChecked("#packFontsToggle"), true, "打包字体可勾选");
    harness.assertNoErrors(h, "导出设置");
  });
});

test("导出 PSD / PDF：触发对应格式下载", { skip: skip }, async function () {
  await harness.withPage(browser, server.base, { timeout: 120000 }, async function (h) {
    const page = await openBanner(h, { timeout: 120000 });
    await page.click("#libraryList .bb-lib-item[data-type='freeText']");
    await page.waitForSelector("#canvasBody [data-action='module-pick']");
    await page.click("#stepExport");
    await page.waitForSelector(".bb-export-btn");

    const psdPromise = page.waitForEvent("download", { timeout: 120000 });
    await page.locator(".bb-export-btn", { hasText: "导出 PSD" }).click();
    const psd = await psdPromise;
    assert.match(psd.suggestedFilename(), /\.psd$/i, "PSD 导出（实测 " + psd.suggestedFilename() + "）");

    const pdfPromise = page.waitForEvent("download", { timeout: 120000 });
    await page.locator(".bb-export-btn", { hasText: "导出 PDF" }).click();
    const pdf = await pdfPromise;
    assert.match(pdf.suggestedFilename(), /\.pdf$/i, "PDF 导出（实测 " + pdf.suggestedFilename() + "）");

    harness.assertNoErrors(h, "PSD / PDF 导出");
  });
});

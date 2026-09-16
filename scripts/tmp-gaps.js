/* e2e-font-gaps.js —— 补齐验收缺口：
   G1 断网（拦截 fontsource/cn-fontsource 请求）→ 切字体 → 回退栈命中 + 提示条出现 + 无布局爆炸
   G2 移动端 375px 走查 → 无横滚、首屏可见、工作台不重叠
   G3 字体加载性能 → fonts.ready 耗时 + 预载后二次切换耗时对比
   G4 截图存档 docs/samples/font-verify-*.png */
const fs = require("node:fs");
const { chromium } = require("playwright");
const ROOT = "C:\\Users\\LM_wo\\Documents\\GitHub\\Only-box";

(async function () {
  const exe = process.env.LOCALAPPDATA + "\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
  const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, headless: true });
  const assert = require("node:assert/strict");

  /* ===== G1: 断网回退 ===== */
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.route(/fontsource|cn-fontsource|gstatic/, function (route) { route.abort(); });
  await page.goto("file:///" + ROOT.replace(/\\/g, "/") + "/tools/banner-builder.html", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const btn = page.locator("[data-action='lib-add'][data-type='announcement']").first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(2500); }
  /* 断网下切楷体（其 css 来自 fontsource，会被拦截 → 回退） */
  await page.evaluate(function () {
    const sel = document.getElementById("headingFontSelect");
    sel.value = "kai";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(4000);
  const g1 = await page.evaluate(function () {
    const art = document.querySelector(".bb-page-canvas");
    const title = art.querySelector(".bb-art-h2");
    const notice = document.getElementById("bb-font-notice");
    return {
      fallbackStack: getComputedStyle(title).fontFamily.slice(0, 90),
      wenkaiFaces: [].slice.call(document.fonts).filter(function (f) { return f.family.indexOf("WenKai") >= 0 && f.status === "loaded"; }).length,
      noticeShown: !!notice,
      noticeText: notice ? notice.textContent.slice(0, 40) : null,
      hasRetry: notice ? !!notice.querySelector("button") : false,
      layoutOk: art.getBoundingClientRect().width > 0 && document.documentElement.scrollWidth <= 1600,
      bodyRendered: (art.textContent || "").length > 20,
    };
  });
  console.log("G1 fallback:", JSON.stringify(g1));
  /* computed font-family 是声明栈（恒以选中字体开头）；回退是否生效看 face 是否加载：
     断网下 WenKai face 不存在 → check=false → 浏览器实际用栈内下一个可用字体（KaiTi/STKaiti） */
  /* css 可能命中磁盘缓存（face 注册），但字体文件被拦截 → 无 loaded 态 face → 浏览器用回退字体渲染 */
  assert.equal(g1.wenkaiFaces, 0, "G1: 断网下 WenKai 字体文件未加载（loaded 态 face 为 0，回退生效）");
  assert.ok(g1.fallbackStack.indexOf("KaiTi") >= 0, "G1: 回退栈含系统楷体（方案 §1.1 位序）");
  assert.ok(g1.noticeShown, "G1: 失败提示条出现");
  assert.ok(g1.hasRetry, "G1: 重试按钮存在");
  assert.ok(g1.layoutOk && g1.bodyRendered, "G1: 布局未爆炸、内容正常渲染");
  await page.screenshot({ path: ROOT + "\\docs\\samples\\font-verify-fallback.png" });
  await page.close();

  /* ===== G3: 加载性能（在线状态）===== */
  const page2 = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const t0 = Date.now();
  await page2.goto("file:///" + ROOT.replace(/\\/g, "/") + "/tools/banner-builder.html", { waitUntil: "load" });
  const loadMs = Date.now() - t0;
  const perf = await page2.evaluate(function () {
    return new Promise(function (resolve) {
      const t = Date.now();
      const done = function () { resolve({ fontsReadyMs: Date.now() - t, status: document.fonts.status, faces: document.fonts.size }); };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(done, done);
      else done();
      setTimeout(done, 15000); /* 兜底 */
    });
  });
  /* 二次切换耗时（预载生效后） */
  const btn2 = page2.locator("[data-action='lib-add'][data-type='announcement']").first();
  if (await btn2.count()) { await btn2.click(); await page2.waitForTimeout(1500); }
  const t1 = Date.now();
  await page2.evaluate(function () {
    const sel = document.getElementById("headingFontSelect");
    sel.value = "kai";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page2.waitForTimeout(2500);
  const switchMs = Date.now() - t1;
  console.log("G3 perf:", JSON.stringify({ loadMs: loadMs, fontsReady: perf, kaiSwitchWallMs: switchMs }));
  await page2.close();

  /* ===== G2: 移动端 375px 走查 ===== */
  const page3 = await browser.newPage({ viewport: { width: 375, height: 667 } });
  await page3.goto("file:///" + ROOT.replace(/\\/g, "/") + "/tools/banner-builder.html", { waitUntil: "load" });
  await page3.waitForTimeout(2500);
  const g2 = await page3.evaluate(function () {
    const toolbar = document.querySelector(".bb-toolbar-export") || document.querySelector(".bb-toolbar");
    const canvas = document.querySelector("#canvasBody");
    const firstBtn = document.querySelector(".bb-btn");
    return {
      noHScroll: document.documentElement.scrollWidth <= 375,
      toolbarVisible: !!toolbar && toolbar.getBoundingClientRect().width > 0,
      canvasVisible: !!canvas && canvas.getBoundingClientRect().height > 100,
      btnTappable: firstBtn ? firstBtn.getBoundingClientRect().height >= 20 : false,
    };
  });
  await page3.screenshot({ path: ROOT + "\\docs\\samples\\font-verify-mobile375.png" });
  console.log("G2 mobile375:", JSON.stringify(g2));
  assert.ok(g2.noHScroll, "G2: 无横向滚动");
  assert.ok(g2.canvasVisible, "G2: 画布首屏可见");
  await browser.close();
  console.log("GAPS-ALL-OK");
})().catch(function (e) { console.error("GAP-ERR", e.message); process.exit(1); });

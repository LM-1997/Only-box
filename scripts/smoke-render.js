/* 端到端渲染冒烟：背景图 + 非默认字体 + 字重 → 模板预览绘制成功、字体按字重就绪 */
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto("file:///" + path.resolve("tools/badge-generator.html").replace(/\\/g, "/"));
  await page.waitForTimeout(1000);

  /* 造一张 1000x1400 的测试背景图并设置 */
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1000; c.height = 1400;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#f2ede4"; ctx.fillRect(0, 0, 1000, 1400);
    ctx.strokeStyle = "#35846a"; ctx.lineWidth = 4;
    ctx.strokeRect(300, 260, 400, 400);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const file = new File([blob], "bg.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById("backgroundInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(1200);

  /* 选得意黑（中文）+ 字重 400 → 预览应使用真实字形 */
  await page.locator('[data-bfp-for="fontFamilyZh"] .bfp-trigger').click();
  await page.fill(".bfp-panel:not([hidden]) .bfp-search input", "得意");
  await page.locator(".bfp-panel:not([hidden]) .bfp-row").first().click();
  await page.waitForTimeout(1200);
  await page.selectOption("#nameWeight", "400");
  await page.waitForTimeout(900);

  const state1 = await page.evaluate(async () => {
    await document.fonts.load('400 48px "Smiley Sans Oblique"', "永");
    const previewImg = document.getElementById("templateImage");
    return {
      smileyLoaded: document.fonts.check('400 48px "Smiley Sans Oblique"', "永"),
      previewRendered: previewImg && previewImg.src.startsWith("data:image/png"),
      previewLen: previewImg ? previewImg.src.length : 0
    };
  });
  console.log("render state:", JSON.stringify(state1));
  if (!state1.smileyLoaded) throw new Error("得意黑 400 未就绪");
  if (!state1.previewRendered || state1.previewLen < 5000) throw new Error("模板预览未渲染");

  /* 字重 900 → 思源黑体（日）也要按 900 就绪（renderItem 内 ensureFontsForBlock 已触发） */
  await page.selectOption("#nameWeight", "900");
  await page.waitForTimeout(900);
  const jp900 = await page.evaluate(() => document.fonts.check('900 48px "Noto Sans JP"', "永"));
  console.log("Noto Sans JP 900 loaded:", jp900);
  if (!jp900) throw new Error("日文字体 900 字重未加载");

  if (errors.length) {
    console.log("PAGE ERRORS:\n" + errors.join("\n"));
    process.exit(1);
  }
  await browser.close();
  console.log("RENDER SMOKE PASS");
})().catch((e) => { console.error("RENDER SMOKE FAIL:", e.message); process.exit(1); });

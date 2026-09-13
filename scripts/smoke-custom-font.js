/* 浏览器深测：自定义字体上传（静态/可变）、字重轴滑杆、字重级加载 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");

async function fetchToTmp(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("download fail " + url + " " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, buf);
  return p;
}

(async () => {
  /* 静态字体：Metal Mania（OFL，weightClass 400）；可变字体：Montserrat VF（wght 100-900） */
  const staticFont = await fetchToTmp("https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/metalmania/MetalMania-Regular.ttf", "MetalMania-Regular.ttf");
  const vfFont = await fetchToTmp("https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/montserrat/Montserrat%5Bwght%5D.ttf", "Montserrat-VF.ttf");

  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto("file:///" + path.resolve("tools/badge-generator.html").replace(/\\/g, "/"));
  await page.waitForTimeout(1000);

  /* 1. 上传静态字体（走「上传字体文件」标签页的中文槽） */
  await page.setInputFiles("#fontInputZh", staticFont);
  await page.waitForTimeout(1200);
  const zhVal = await page.locator("#fontFamilyZh").inputValue();
  const statusText = await page.locator("#fontStatus").textContent();
  console.log("static upload -> zh value:", zhVal, "| status:", statusText.trim());
  if (zhVal !== "Metal Mania") throw new Error("静态字体 family 解析失败: " + zhVal);
  if (!/字重 400/.test(statusText)) throw new Error("静态字体字重提示缺失: " + statusText);

  /* 2. 选择器面板出现「我上传的字体」分组（统一展示） */
  await page.locator('[data-bfp-for="fontFamilyZh"] .bfp-trigger').click();
  await page.waitForTimeout(300);
  const customGroup = await page.locator(".bfp-panel:not([hidden]) .bfp-group", { hasText: "我上传的字体" }).count();
  const customRow = await page.locator(".bfp-panel:not([hidden]) .bfp-row-custom").count();
  console.log("custom group:", customGroup, "| custom rows:", customRow);
  if (!customGroup || !customRow) throw new Error("自定义字体未出现在选择器面板");
  await page.keyboard.press("Escape");

  /* 3. 字重控件收敛到静态字体的单一档位 */
  const weightOpts = await page.locator("#nameWeight option").allTextContents();
  console.log("weight options after static upload:", weightOpts.join(" | "));
  if (weightOpts.length !== 1 || !weightOpts[0].includes("400")) throw new Error("静态字体应只有单一字重档");

  /* 4. 上传可变字体（英文槽）→ 滑杆出现、档位扩展 */
  await page.setInputFiles("#fontInputEn", vfFont);
  await page.waitForTimeout(1500);
  const enVal = await page.locator("#fontFamilyEn").inputValue();
  const statusText2 = await page.locator("#fontStatus").textContent();
  console.log("vf upload -> en value:", enVal, "| status:", statusText2.trim());
  if (enVal !== "Montserrat") throw new Error("可变字体 family 解析失败: " + enVal);
  if (!/可变字体，字重轴/.test(statusText2)) throw new Error("可变字体提示缺失: " + statusText2);
  const sliderVisible = await page.locator("#nameWeightSlider").isVisible();
  const sliderMin = await page.locator("#nameWeightSlider").getAttribute("min");
  const sliderMax = await page.locator("#nameWeightSlider").getAttribute("max");
  console.log("slider visible:", sliderVisible, "min/max:", sliderMin, sliderMax);
  if (!sliderVisible || sliderMin !== "100" || sliderMax !== "900") throw new Error("可变字体字重轴滑杆异常");

  /* 5. 拖动字重轴 → 字重值写入 */
  await page.locator("#nameWeightSlider").fill("650");
  await page.waitForTimeout(300);
  const weightAfterDrag = await page.locator("#nameWeight").inputValue();
  console.log("weight after slider drag:", weightAfterDrag);
  if (weightAfterDrag !== "650") throw new Error("滑杆未写入字重: " + weightAfterDrag);

  /* 6. 字重级加载验证：可变字体按 650 请求应命中已注册的 VF */
  const vfLoaded = await page.evaluate(async () => {
    await document.fonts.load('650 48px "Montserrat"', "Ag");
    return document.fonts.check('650 48px "Montserrat"', "Ag");
  });
  console.log("VF check(650):", vfLoaded);
  if (!vfLoaded) throw new Error("可变字体未按字重轴注册");

  /* 7. 内置字体字重级加载：思源黑体 900 */
  const nsc900 = await page.evaluate(async () => {
    const ok = await window.BadgeFontPicker.ensureFont("Noto Sans SC", 900, "永");
    return ok && document.fonts.check('900 48px "Noto Sans SC"', "永");
  });
  console.log("Noto Sans SC check(900):", nsc900);
  if (!nsc900) throw new Error("思源黑体 900 字重加载失败");

  if (errors.length) {
    console.log("PAGE ERRORS:\n" + errors.join("\n"));
    process.exit(1);
  }
  await browser.close();
  console.log("CUSTOM-FONT SMOKE PASS");
})().catch((e) => { console.error("CUSTOM-FONT SMOKE FAIL:", e.message); process.exit(1); });

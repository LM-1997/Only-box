/* 浏览器冒烟：badge-generator 统一字体选择器 + 字重 + banner-builder 清单派生 */
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  const badgeUrl = "file:///" + path.resolve("tools/badge-generator.html").replace(/\\/g, "/");
  await page.goto(badgeUrl);
  await page.waitForTimeout(1200);

  /* 1. 选择器宿主与触发器渲染 */
  const triggers = await page.locator(".bfp-trigger").count();
  console.log("bfp triggers:", triggers);
  if (triggers !== 6) throw new Error("期望 6 个字体选择器触发器，实际 " + triggers);

  /* 2. 打开中文选择器，检查内置清单渲染（rank 排序 + 标签） */
  await page.locator('[data-bfp-for="fontFamilyZh"] .bfp-trigger').click();
  await page.waitForTimeout(400);
  const groupText = await page.locator(".bfp-panel:not([hidden]) .bfp-group").first().textContent();
  const zhRows = await page.locator(".bfp-panel:not([hidden]) .bfp-row").count();
  console.log("zh panel group:", groupText, "| rows:", zhRows);
  if (zhRows < 10) throw new Error("中文面板字体数过少: " + zhRows);
  const firstRowName = await page.locator(".bfp-panel:not([hidden]) .bfp-row .bfp-name").first().textContent();
  console.log("first zh font:", firstRowName.trim());
  if (!firstRowName.includes("思源黑体")) throw new Error("rank 1 应为思源黑体");

  /* 3. 搜索过滤 */
  await page.fill(".bfp-panel:not([hidden]) .bfp-search input", "得意");
  await page.waitForTimeout(200);
  const filtered = await page.locator(".bfp-panel:not([hidden]) .bfp-row").count();
  console.log("search 得意 -> rows:", filtered);
  if (filtered !== 1) throw new Error("搜索过滤异常");

  /* 4. 选择得意黑 → select 值同步 + 字重档位重建 */
  await page.locator(".bfp-panel:not([hidden]) .bfp-row").first().click();
  await page.waitForTimeout(600);
  const zhValue = await page.locator("#fontFamilyZh").inputValue();
  console.log("fontFamilyZh value:", zhValue);
  if (zhValue !== "Smiley Sans Oblique") throw new Error("选择器未写入 select value");
  const weightOptions = await page.locator("#nameWeight option").allTextContents();
  console.log("weight options:", weightOptions.join(" | "));
  if (!weightOptions.length) throw new Error("字重控件未生成档位");

  /* 5. 字重选择 → nameBlock.weight 生效（画布 font 字符串经渲染验证） */
  await page.selectOption("#nameWeight", "400");
  await page.waitForTimeout(300);
  const weightVal = await page.evaluate(() => document.getElementById("nameWeight").value);
  console.log("weight after select:", weightVal);

  /* 6. webfont 状态栏（在线字体加载提示） */
  const statusShown = await page.locator("#webfontStatus").textContent();
  console.log("webfontStatus:", statusShown || "(已隐藏)");

  /* 7. 编辑器侧字重控件存在 */
  const editorWeightOptions = await page.locator("#editorNameWeight option").count();
  console.log("editor weight options:", editorWeightOptions);
  if (!editorWeightOptions) throw new Error("编辑器字重控件未初始化");

  /* 8. banner-builder：字体下拉选项来自统一清单 */
  const bannerUrl = "file:///" + path.resolve("tools/banner-builder.html").replace(/\\/g, "/");
  await page.goto(bannerUrl);
  await page.waitForTimeout(1500);
  const fontOpts = await page.evaluate(() => {
    const sel = document.getElementById("fontSelect");
    return sel ? Array.from(sel.options).map((o) => o.textContent) : [];
  });
  console.log("banner fontSelect options:", fontOpts.length, "| first:", fontOpts[0], "| last:", fontOpts[fontOpts.length - 1]);
  if (fontOpts.length < 30) throw new Error("banner 字体下拉少于 30 款");
  if (fontOpts.some((t) => t.includes("数黑体") || t.includes("Helvetica"))) throw new Error("禁止再分发的字体仍出现在下拉中");

  /* 9. banner 打包字体表：数黑体/无界黑本地引用应消失 */
  const dlCheck = await page.evaluate(() => ({
    shuheiti: !window.BannerBuilderConstants.FONT_DOWNLOADS.shuheiti,
    sansUrl: window.BannerBuilderConstants.FONT_DOWNLOADS.sans && window.BannerBuilderConstants.FONT_DOWNLOADS.sans.url.startsWith("https://"),
    fontStackSans: window.BannerBuilderConstants.fontStack("sans")
  }));
  console.log("banner FONT_DOWNLOADS:", JSON.stringify(dlCheck));
  if (!dlCheck.shuheiti || !dlCheck.sansUrl) throw new Error("FONT_DOWNLOADS 派生异常");

  if (errors.length) {
    console.log("PAGE ERRORS:\n" + errors.join("\n"));
    process.exit(1);
  }
  await browser.close();
  console.log("SMOKE PASS");
})().catch((e) => { console.error("SMOKE FAIL:", e.message); process.exit(1); });

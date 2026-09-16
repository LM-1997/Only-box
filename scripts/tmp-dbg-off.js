/* dbg-offline.js —— 断网 G1 深挖：css link 加载态、拦截计数、faces 来源 */
const fs = require("node:fs");
const { chromium } = require("playwright");
const ROOT = "C:\\Users\\LM_wo\\Documents\\GitHub\\Only-box";

(async function () {
  const exe = process.env.LOCALAPPDATA + "\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
  const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let aborted = 0, passed = 0;
  await page.route(/fontsource|cn-fontsource|gstatic/, function (route) {
    aborted += 1;
    route.abort();
  });
  page.on("requestfinished", function (r) { if (/fontsource|gstatic/.test(r.url())) passed += 1; });
  await page.goto("file:///" + ROOT.replace(/\\/g, "/") + "/tools/banner-builder.html", { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const before = await page.evaluate(function () {
    return {
      links: [].slice.call(document.querySelectorAll("link[rel=stylesheet]")).map(function (l) {
        return { href: l.href.slice(-50), sheet: !!l.sheet };
      }),
      check: document.fonts.check("16px 'LXGW WenKai'"),
      faces: document.fonts.size,
    };
  });
  /* 切 kai */
  await page.evaluate(function () {
    const sel = document.getElementById("headingFontSelect");
    sel.value = "kai";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(4000);
  const after = await page.evaluate(function () {
    return {
      check: document.fonts.check("16px 'LXGW WenKai'"),
      loadedFaces: [].slice.call(document.fonts).filter(function (f) { return f.family.indexOf("WenKai") >= 0; }).map(function (f) { return f.family + "/" + f.weight + "/" + f.status; }).slice(0, 6),
      notice: !!document.getElementById("bb-font-notice"),
    };
  });
  console.log("aborted:", aborted, "passed:", passed);
  console.log("before:", JSON.stringify(before).slice(0, 500));
  console.log("after:", JSON.stringify(after));
  await browser.close();
})().catch(function (e) { console.error("DBG-ERR", e.message); process.exit(1); });

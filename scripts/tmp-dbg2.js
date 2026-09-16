/* dbg-notice2.js —— 提示条未触发最终定位：切 kai 后 ensureFont 是否走了 src 分支 */
const fs = require("node:fs");
const { chromium } = require("playwright");
const ROOT = "C:\\Users\\LM_wo\\Documents\\GitHub\\Only-box";

(async function () {
  const exe = process.env.LOCALAPPDATA + "\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
  const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let aborted = 0;
  await page.route(/fontsource|cn-fontsource|gstatic/, function (route) { aborted += 1; route.abort(); });
  await page.goto("file:///" + ROOT.replace(/\\/g, "/") + "/tools/banner-builder.html", { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const btn = page.locator("[data-action='lib-add'][data-type='announcement']").first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(2000); }
  await page.evaluate(function () {
    const sel = document.getElementById("headingFontSelect");
    sel.value = "kai";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(4500);
  const r = await page.evaluate(function () {
    const f = window.BannerBuilderConstants.FONTS.kai;
    const states = [];
    document.fonts.forEach(function (face) {
      if (face.family.indexOf("WenKai") >= 0) states.push(face.family + "/" + face.weight + "/" + face.status);
    });
    const links = [].slice.call(document.querySelectorAll("link[rel=stylesheet]")).filter(function (l) { return l.href.indexOf("wenkai") >= 0 || l.href.indexOf("lxgw") >= 0; }).map(function (l) { return { href: l.href.slice(-44), sheet: !!l.sheet }; });
    return { family: f.family, cssLen: (f.css || []).length, srcLen: (f.src || []).length, wenkaiFaces: states.slice(0, 6), total: document.fonts.size, wenkaiLinks: links, notice: !!document.getElementById("bb-font-notice") };
  });
  console.log("aborted:", aborted);
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch(function (e) { console.error("DBG-ERR", e.message); process.exit(1); });

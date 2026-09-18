/* ================================================================
   tests/e2e/_harness.js —— 浏览器端到端测试的公共底座

   项目是零构建静态站，E2E 只需要一个能把仓库根目录当成站点根发出的静态
   服务器，加上 Playwright 驱动的真实 Chromium。

   设计要点：
   - 静态服务器：node 原生 http，监听 127.0.0.1 随机端口，进程退出即释放。
   - 外部请求全部掐断：字体走 CDN，离线环境下会 hang 住页面并产生大量噪声。
     掐断后测试可重复执行，网络型报错单独归类，不计入"页面 JS 报错"。
   - 错误采集：console.error + pageerror 双通道，测试末尾统一断言为空。
   ================================================================ */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".icc": "application/vnd.color.icc-profile",
};

/* 被主动掐断的外部请求在控制台留下的噪声，不算页面缺陷 */
const NET_NOISE = /net::ERR|Failed to load resource|ERR_BLOCKED|ERR_ABORTED|Failed to fetch|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION/i;

function startServer() {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(function (req, res) {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath === "/" ) urlPath = "/index.html";
      const file = path.normalize(path.join(ROOT, urlPath));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end("forbidden"); return; }
      fs.readFile(file, function (err, data) {
        if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("not found"); return; }
        res.writeHead(200, {
          "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(data);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", function () {
      const port = server.address().port;
      resolve({
        base: "http://127.0.0.1:" + port,
        close: function () { return new Promise(function (r) { server.close(r); }); },
      });
    });
  });
}

/* 打开一个页面：自动掐断外部请求，并采集 console/page 错误 */
async function newPage(browser, base, options) {
  const opts = options || {};
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    acceptDownloads: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  const networkNoise = [];

  await context.route("**/*", function (route) {
    const url = route.request().url();
    if (url.startsWith(base) || url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") {
      return route.continue();
    }
    return route.abort();
  });

  page.on("console", function (msg) {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (NET_NOISE.test(text)) { networkNoise.push(text); return; }
    errors.push(text);
  });
  page.on("pageerror", function (err) {
    errors.push("pageerror: " + (err && err.message ? err.message : String(err)));
  });

  page.setDefaultTimeout(opts.timeout || 15000);
  return { context: context, page: page, errors: errors, networkNoise: networkNoise };
}

/* 并发安全：每个用例独立 context，跑完即关 */
async function withPage(browser, base, options, fn) {
  const handle = await newPage(browser, base, options);
  try {
    await fn(handle);
  } finally {
    await handle.context.close();
  }
}

function assertNoErrors(handle, label) {
  if (handle.errors.length) {
    throw new Error((label || "页面") + " 出现 JS 错误：\n" + handle.errors.join("\n"));
  }
}

module.exports = {
  ROOT: ROOT,
  NET_NOISE: NET_NOISE,
  startServer: startServer,
  newPage: newPage,
  withPage: withPage,
  assertNoErrors: assertNoErrors,
};

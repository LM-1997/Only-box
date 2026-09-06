/* banner-builder-mytemplates.js —— 「我的模板」本地持久化（IndexedDB）
   纯前端无后端：把用户调好的整个板块（内容 + 版式 + 图片）存进浏览器 IndexedDB，
   刷新 / 重开页面后仍在。图片一律转成 dataURL 一起存，取用无需联网。
   依赖：window.indexedDB / fetch / FileReader（浏览器环境）。
   对外暴露 BannerBuilderMyTemplates。 */
(function (global) {
  "use strict";

  const DB_NAME = "only-box-banner-mytemplates";
  const DB_VERSION = 1;
  const STORE = "templates";
  let dbPromise = null;

  function dbOpen() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB || typeof global.indexedDB.open !== "function") { dbPromise = null; reject(new Error("当前环境不支持 IndexedDB")); return; }
      let req;
      try { req = global.indexedDB.open(DB_NAME, DB_VERSION); } catch (error) { dbPromise = null; reject(error); return; }
      req.onupgradeneeded = function (event) { const db = event.target.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = function (event) { resolve(event.target.result); };
      req.onerror = function () { dbPromise = null; reject(req.error || new Error("打开模板库失败")); };
      req.onblocked = function () { dbPromise = null; reject(new Error("模板库被占用")); };
    });
    return dbPromise;
  }

  function run(mode, method, value) {
    return new Promise(function (resolve, reject) {
      dbOpen().then(function (db) {
        let tx;
        try { tx = db.transaction(STORE, mode === "readonly" ? "readonly" : "readwrite"); } catch (error) { reject(error); return; }
        const store = tx.objectStore(STORE);
        let req;
        try { req = store[method](value); } catch (error) { reject(error); return; }
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error("模板库读写失败")); };
      }, reject);
    });
  }

  /* 全部模板，按保存时间倒序（新的在前）。 */
  function listTemplates() {
    return run("readonly", "getAll").then(function (rows) {
      return (rows || []).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    });
  }

  function saveTemplate(record) { return run("readwrite", "put", record); }
  function removeTemplate(id) { return run("readwrite", "delete", id); }

  function isAvailable() { return typeof global.indexedDB !== "undefined" && typeof global.indexedDB.open === "function"; }

  /* blob: 链接转 dataURL（图片进模板前调用，避免刷新后 blob 失效）。 */
  function blobUrlToDataUrl(url) {
    return new Promise(function (resolve) {
      let res;
      Promise.resolve(global.fetch(url)).then(function (r) { res = r; return r.blob(); }).then(function (blob) {
        const reader = new global.FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { resolve(url); };
        reader.readAsDataURL(blob);
      }).catch(function () { resolve(url); });
    });
  }

  /* 递归深拷贝，并把所有「长得像图片字段」的 {url,name(,type)} 里 blob: 换成 dataURL。
     只处理同时具备 string url + name 的对象（模块图片字段的统一形态），其余原样复制。 */
  async function snapshotData(value) {
    if (Array.isArray(value)) {
      const out = [];
      for (let i = 0; i < value.length; i += 1) out.push(await snapshotData(value[i]));
      return out;
    }
    if (!value || typeof value !== "object") return value;
    if (typeof value.url === "string" && typeof value.name === "string" && value.url.indexOf("blob:") === 0) {
      const converted = await blobUrlToDataUrl(value.url);
      const out = { url: converted, name: value.name };
      if (value.type) out.type = value.type;
      return out;
    }
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i += 1) out[keys[i]] = await snapshotData(value[keys[i]]);
    return out;
  }

  /* 从模板取回时用：纯 JSON 克隆（存的是 dataURL，直接可渲染/导出，无需再转 blob）。 */
  function cloneTemplateData(data) { return JSON.parse(JSON.stringify(data)); }

  global.BannerBuilderMyTemplates = Object.freeze({
    listTemplates: listTemplates,
    saveTemplate: saveTemplate,
    removeTemplate: removeTemplate,
    snapshotData: snapshotData,
    cloneTemplateData: cloneTemplateData,
    isAvailable: isAvailable,
  });
})(window);

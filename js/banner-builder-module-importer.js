/* banner-builder-module-importer.js —— 可导入的板块模块（模块预设）
   模块由「已有板块类型 + 一组默认数据」组成，适合用户让 AI 生成 JSON 后导入。
   内置板块定义仍由 BannerBuilderRegistry 提供，用户模块只保存差异化预设，避免引入任意脚本执行风险。 */
(function (global) {
  "use strict";
  var STORAGE_KEY = "only-box-banner-custom-modules";
  var ID_RE = /^[a-z][a-z0-9_-]*$/;

  function loadAll() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      var rows = raw ? JSON.parse(raw) : [];
      return Array.isArray(rows) ? rows : [];
    } catch (error) { return []; }
  }
  function saveAll(rows) {
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); return true; }
    catch (error) { return false; }
  }
  function extractJson(text) {
    var raw = String(text || "").trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/, "");
    var start = raw.indexOf("{"); var end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(raw.slice(start, end + 1)); } catch (error) { return null; }
  }
  function validate(obj) {
    var errors = [];
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return ["板块模块必须是 JSON 对象"];
    if (typeof obj.id !== "string" || !ID_RE.test(obj.id)) errors.push("id 必填，只能用小写字母开头，可含数字、下划线、短横线");
    if (typeof obj.label !== "string" || !obj.label.trim()) errors.push("label 必填，用于板块库显示");
    if (!global.BannerBuilderRegistry || !global.BannerBuilderRegistry.getDef(obj.type)) errors.push("type 必须是现有板块类型");
    if (!obj.data || typeof obj.data !== "object" || Array.isArray(obj.data)) errors.push("data 必须是对象");
    return errors;
  }
  function add(obj) {
    var record = { id: obj.id, label: obj.label.trim(), type: obj.type, description: String(obj.description || ""), data: JSON.parse(JSON.stringify(obj.data || {})), createdAt: Date.now() };
    var rows = loadAll(); var index = rows.findIndex(function (item) { return item.id === record.id; });
    if (index >= 0) rows[index] = record; else rows.push(record);
    if (!saveAll(rows)) throw new Error("浏览器本地存储失败");
    return record;
  }
  function remove(id) { var rows = loadAll(); var next = rows.filter(function (item) { return item.id !== id; }); if (next.length === rows.length) return false; saveAll(next); return true; }
  function buildPrompt() {
    var types = (global.BannerBuilderRegistry && global.BannerBuilderRegistry.MODULE_ORDER || []).map(function (type) { return type + "（" + global.BannerBuilderRegistry.typeLabel(type) + "）"; }).join("\n");
    return ["你是 Only-box 活动宣传长条排版工具的板块设计专家。请输出一个纯 JSON，不要 markdown 代码块，不要解释文字。", "这是一个可导入板块模块，必须基于已有板块类型，通过 data 提供默认内容与排版参数。", "", "{", '  "id": "my-ticket",', '  "label": "我的票务板块",', '  "description": "用于活动票务说明",', '  "type": "ticketInfo",', '  "data": {', '    "sectionTitle": "票务信息",', '    "width": "full",', '    "contentAlign": "center",', '    "bodyAlign": "left",', '    "tiers": [{"label": "预售票", "price": "￥65"}],', '    "note": "请提前购票"', "  }", "}", "", "可用 type：", types, "", "规则：id 使用小写英文；type 必须来自上面的可用类型；data 只填写该板块已有字段；图片字段使用 null；只输出 JSON。"].join("\n");
  }
  global.BannerBuilderModuleImporter = Object.freeze({ loadAll: loadAll, add: add, remove: remove, validate: validate, extractJson: extractJson, buildPrompt: buildPrompt, promptText: buildPrompt() });
})(window);

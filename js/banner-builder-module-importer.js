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
  /* 生成字段级 AI 提示词：遍历注册表全部板块的 fields（含 objectList 嵌套子字段与
     select 枚举取值范围），把「当前 definitions 里所有字段」自动展开为说明，避免
     AI 靠猜字段名、或仅在 registry 改字段后提示词脱节。通用字段统一单列一段，各板块只列特有字段。 */
  function buildPrompt() {
    var R = global.BannerBuilderRegistry;
    if (!R || !R.MODULE_ORDER) return "（板块注册表未加载，请刷新页面后重试）";

    function blank(n) { var s = ""; for (var i = 0; i < n; i += 1) s += "  "; return s; }

    /* 通用字段（LAYOUT_FIELDS + bodyAlign）：单独说明一次，各板块特有字段里不重复 */
    var COMMON_KEYS = ["template", "sectionTitle", "width", "contentAlign", "bodyAlign",
      "blockBgColor", "blockBgImage", "blockOpacity", "imageRatio", "imageFit"];

    function fieldTypeHint(field) {
      if (field.type === "select") {
        var vals = (field.options || []).map(function (o) { return o.value === "" ? "留空" : o.value; });
        return "（可选: " + vals.join("/") + "）";
      }
      if (field.type === "image") return "（图片，JSON 里写 null，导入后再上传）";
      if (field.type === "number") return "（数字" + (field.min != null ? " " + field.min + "-" + field.max : "") + "）";
      if (field.type === "textarea") return "（多行文本）";
      return "（文本）";
    }

    /* placeholder 若已自带「例如：」前缀则不再叠加，避免「如：例如：」重复 */
    function cleanPlaceholder(ph) {
      return String(ph || "").replace(/^(例如|样例|如)[：:]\s*/, "");
    }

    function sampleValue(field) {
      if (field.type === "objectList") return null;
      if (field.type === "stringList") return "[]";
      if (field.type === "image") return "null";
      if (field.type === "number") return "0";
      return '""';
    }

    /* 递归描述一个字段；objectList 展开为数组 + 逐子字段，子字段可能再套 objectList */
    function describeField(field, depth) {
      var ind = blank(depth);
      var name = '"' + field.key + '"';
      if (field.type === "objectList") {
        var lines = [ind + name + ": [{"];
        (field.fields || []).forEach(function (sub) {
          lines.push(describeField(sub, depth + 1));
        });
        lines.push(ind + "}]   // " + field.label + "（" + (field.itemLabel || "条目") + "数组，可多条）");
        return lines.join("\n");
      }
      if (field.type === "stringList") {
        return ind + name + ": [],  // " + field.label + "（字符串数组，每条一个" + (field.itemLabel || "条目") + "）" + (field.placeholder ? "，如：" + cleanPlaceholder(field.placeholder) : "");
      }
      var ph = field.placeholder ? "，如：" + cleanPlaceholder(field.placeholder) : "";
      return ind + name + ": " + sampleValue(field) + ",  // " + field.label + fieldTypeHint(field) + ph;
    }

    var sections = [];

    /* 通用布局字段 */
    var common = [
      "所有板块的 data 都可带以下通用字段（可选，未写用默认值）：",
      '  "template": "",         // 板块模板，取值见下各板块「可用模板」',
      '  "sectionTitle": "",    // 板块大标题，可留空',
      '  "width": "full",       // 占宽: full（通栏） / half（半宽，与下一个半宽并排）',
      '  "contentAlign": "left",// 内容对齐: left / center / right',
      '  "bodyAlign": "",       // 正文对齐: ""（跟随板块） / left / center / right',
      '  "blockBgColor": "",    // 板块底色，如 #163a8a，可留空',
      '  "blockBgImage": null,  // 板块底图，JSON 里写 null，导入后上传',
      '  "blockOpacity": 94,    // 板块透明度 0-100',
      '  "imageRatio": "auto",  // 图片比例: auto / 1:1 / 4:3 / 3:4 / 16:9',
      '  "imageFit": "cover",   // 图片填充: cover（裁切填满） / contain（完整显示）',
    ].join("\n");
    sections.push(common);

    /* 每类板块特有字段 */
    R.MODULE_ORDER.forEach(function (type) {
      var def = R.getDef(type);
      if (!def || !Array.isArray(def.fields)) return;
      var specific = def.fields.filter(function (f) { return COMMON_KEYS.indexOf(f.key) < 0; });
      var lines = [];
      lines.push("【" + type + "】" + def.label);
      var tpls = R.templateOptions(type);
      if (tpls && tpls.length) {
        lines.push("  可用模板: " + tpls.map(function (t) { return t.value + "（" + t.label + "）"; }).join(" / "));
      }
      if (specific.length) {
        lines.push("  data 特有字段：");
        specific.forEach(function (f) { lines.push(describeField(f, 2)); });
      } else {
        lines.push("  data 特有字段：无（仅通用字段）");
      }
      sections.push(lines.join("\n"));
    });

    var head = [
      "你是 Only-box 活动宣传长条排版工具的板块设计专家。请输出一个纯 JSON（不要 markdown 代码块，不要解释文字）。",
      "一个可导入板块模块 = 已有板块 type + 一份 data 默认数据。data 只写下方定义过的字段，未写的字段用默认值。",
      "",
      "{",
      '  "id": "my-module",',
      '  "label": "我的板块",',
      '  "description": "一句话说明（可选）",',
      '  "type": "ticketInfo",',
      '  "data": { ... 按下方字段填写 ... }',
      "}",
      "",
      "===== 通用字段 ===== ",
    ].join("\n");
    head += "\n" + common; /* 通用字段紧跟 head，避免重复输出 */

    var tail = [
      "===== 规则 =====",
      "- id 使用小写英文开头，可含数字/下划线/短横线",
      "- type 必须从上方【type】列表中选择",
      "- data 的 key 必须用上面出现过的字段名，不要自造字段，也不要传入未定义字段",
      "- objectList（对象数组）字段的值是「子字段组成的对象」数组；stringList 是纯字符串数组",
      "- 所有图片字段（image / 图标 / 头像 / 配图 / 二维码 / 底图）在 JSON 里一律写 null，导入后到编辑器里上传",
      "- 只输出 JSON，不要其他文字",
    ].join("\n");

    /* 板块字段明细插在通用字段之后、规则之前 */
    return head + "\n\n" + sections.slice(1).join("\n\n") + "\n\n" + tail;
  }
  global.BannerBuilderModuleImporter = Object.freeze({ loadAll: loadAll, add: add, remove: remove, validate: validate, extractJson: extractJson, buildPrompt: buildPrompt, promptText: buildPrompt() });
})(window);

/* banner-builder-ai-document.js —— 「AI 生成整份长条」纯数据层
   职责（全部为纯函数，不操作 DOM、不读写 localStorage、不发送网络请求）：
   - buildPrompt       依据当前画布/主题/字体与「同时生成主题」开关，动态生成外部 AI 提示词
   - extractJson       剥离 Markdown 围栏后严格 JSON.parse（不删注释、不补引号、不替换单引号、不截取花括号）
   - validate          按生成协议 + BannerBuilderRegistry 递归校验，返回结构化错误
   - normalize         合并本地默认值，构造不含未知字段、模块间不共享引用的规范化数据
   - buildCandidateDoc 以本地生成的 ID 构造候选文档（原子替换前使用）
   - applyPipeline     可注入状态的应用核心：解析→校验→规范化→构造→安装→渲染失败回滚
   协议要点：AI 不返回任何 ID/版本/比例/字体/导出倍率/图片 URL；板块字段以 Registry 为唯一权威来源；
   themeOverrides 是否允许由调用方显式传入的 includeTheme 决定，不靠 JSON 内容猜测。 */
(function (global) {
  "use strict";

  var C = global.BannerBuilderConstants;
  var R = global.BannerBuilderRegistry;
  var M = global.BannerBuilderModel;

  /* ===== 硬上限（与提示词文案保持一致） ===== */
  var LIMITS = {
    jsonMaxLength: 1048576,
    maxPages: 20,
    maxModulesPerPage: 30,
    maxModulesTotal: 120,
    docNameMax: 80,
    pageNameMax: 40,
    textMax: 500,
    textareaMax: 5000,
    listMax: 100,
    maxDepth: 10,
    maxShownErrors: 50,
  };

  var TOP_ALLOWED_BASE = ["schemaVersion", "name", "pages"];
  var TOP_ALLOWED_WITH_THEME = TOP_ALLOWED_BASE.concat(["themeOverrides"]);

  var THEME_BASE_COLORS = ["primary", "primaryDark", "primarySoft", "accent", "accentSoft", "line", "soft"];
  var THEME_EXTRA_COLORS = ["ink", "muted"];
  var THEME_ENUMS = {
    cardStyle: ["card", "panel", "glass", "ticket", "sticker", "ink"],
    shadow: ["soft", "hard", "glow", "none"],
    divider: ["wave", "dots", "line", "glitch", "thread", "dashed"],
    chips: ["pill", "squared", "tag"],
    titleDecor: ["none", "bar", "bracket", "stitch", "kicker"],
    pattern: ["none", "grid", "dots", "stripes", "paper", "noise"],
    avatarStyle: ["none", "ring", "glow", "badge", "frame", "polaroid"],
  };
  /* 数值范围与现有「微调主题 / 排版微调」手动界面完全一致 */
  var THEME_NUMBERS = {
    radius: { min: 0, max: 100, step: 1 },
    typeScale: { min: 0.7, max: 1.5, step: 0.05 },
    h1Scale: { min: 0.7, max: 1.3, step: 0.05 },
    h2Scale: { min: 0.7, max: 1.3, step: 0.05 },
    h3Scale: { min: 0.7, max: 1.3, step: 0.05 },
    bodyScale: { min: 0.7, max: 1.3, step: 0.05 },
    captionScale: { min: 0.7, max: 1.3, step: 0.05 },
    lineHeight: { min: 0.8, max: 2, step: 0.05 },
    letterSpacing: { min: -2, max: 8, step: 0.5 },
  };
  var THEME_WEIGHTS = [400, 500, 600, 700, 800, 900];
  var THEME_FORBIDDEN_KEYS = ["id", "label", "headingFont", "bodyFont"];
  var THEME_ALLOWED_KEYS = THEME_BASE_COLORS
    .concat(THEME_EXTRA_COLORS, Object.keys(THEME_ENUMS), Object.keys(THEME_NUMBERS), ["headingWeight", "bodyWeight"]);

  /* 提示词中的通用字段段：与 Registry 的 LAYOUT_FIELDS 对应（bodyAlign 仅部分板块拥有，随各板块单独列出） */
  var COMMON_FIELD_KEYS = ["template", "sectionTitle", "width", "contentAlign", "blockBgColor", "blockBgImage", "blockOpacity", "imageRatio", "imageFit"];

  /* ===== 小工具 ===== */
  function isPlainObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function cloneJson(value) { return JSON.parse(JSON.stringify(value === undefined ? null : value)); }
  function trimString(value) { return typeof value === "string" ? value.trim() : ""; }
  /* 步进校验用浮点容差，不用 % 取模判断小数 */
  function matchesStep(value, min, step) {
    if (!step) return true;
    var units = (value - min) / step;
    return Math.abs(units - Math.round(units)) < 1e-8;
  }
  function isValidHex(value) { return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value); }
  function cloneImageRecord(record) {
    if (!isPlainObject(record) || typeof record.url !== "string") return null;
    return { url: record.url, name: typeof record.name === "string" ? record.name : "", type: typeof record.type === "string" ? record.type : "" };
  }

  /* ===== JSON 清洗与解析：只剥整包裹围栏，不做任何危险修复 ===== */
  function stripFence(text) {
    var match = /^```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```$/.exec(text);
    return match ? match[1] : text;
  }
  function errorPosition(message, text) {
    var match = /position\s+(\d+)/i.exec(String(message || ""));
    if (!match) return "";
    var pos = Number(match[1]);
    if (!isFinite(pos) || pos < 0 || pos > text.length) return "";
    var before = text.slice(0, pos);
    var line = before.split("\n").length;
    var column = pos - before.lastIndexOf("\n");
    return "（约第 " + line + " 行第 " + column + " 列）";
  }
  function extractJson(text) {
    var raw = String(text == null ? "" : text).trim();
    if (!raw) return { ok: false, message: "内容为空，请先粘贴 AI 返回的 JSON。" };
    if (raw.length > LIMITS.jsonMaxLength) return { ok: false, message: "粘贴内容超过 1MB，疑似混入了大段非 JSON 文本，已拒绝解析。" };
    var cleaned = stripFence(raw);
    try {
      return { ok: true, value: JSON.parse(cleaned) };
    } catch (error) {
      var message = "不是合法 JSON，请确认没有解释文字、注释或尾逗号" + errorPosition(error && error.message, cleaned);
      return { ok: false, message: message };
    }
  }

  /* ===== themeOverrides 校验 ===== */
  function validateThemeOverrides(ov, path, err) {
    Object.keys(ov).forEach(function (key) {
      if (THEME_ALLOWED_KEYS.indexOf(key) < 0) {
        var forbidden = THEME_FORBIDDEN_KEYS.indexOf(key) >= 0;
        err(path + "." + key, "unknown_field", forbidden
          ? "themeOverrides 不允许 \"" + key + "\"（整份生成只微调当前主题，不创建新主题、不改字体）"
          : "themeOverrides 不允许未知字段 \"" + key + "\"");
      }
    });
    THEME_BASE_COLORS.forEach(function (key) {
      if (!isValidHex(ov[key])) err(path + "." + key, "theme_color_required", "themeOverrides." + key + " 必填，必须是 #RRGGBB 格式的十六进制颜色");
    });
    THEME_EXTRA_COLORS.forEach(function (key) {
      if (ov[key] != null && !isValidHex(ov[key])) err(path + "." + key, "invalid_hex", "themeOverrides." + key + " 可选，必须是 #RRGGBB 格式的十六进制颜色");
    });
    Object.keys(THEME_ENUMS).forEach(function (key) {
      if (ov[key] != null && THEME_ENUMS[key].indexOf(ov[key]) < 0) {
        err(path + "." + key, "invalid_option", "themeOverrides." + key + " 可选值为: " + THEME_ENUMS[key].join(" / "));
      }
    });
    Object.keys(THEME_NUMBERS).forEach(function (key) {
      var spec = THEME_NUMBERS[key];
      var value = ov[key];
      if (value == null) return;
      if (typeof value !== "number" || !isFinite(value)) { err(path + "." + key, "expected_number", "themeOverrides." + key + " 必须是数字"); return; }
      if (value < spec.min || value > spec.max) { err(path + "." + key, "number_range", "themeOverrides." + key + " 必须是 " + spec.min + "-" + spec.max + " 的数字"); return; }
      if (!matchesStep(value, spec.min, spec.step)) err(path + "." + key, "number_step", "themeOverrides." + key + " 必须按步进 " + spec.step + " 取值（从 " + spec.min + " 开始）");
    });
    ["headingWeight", "bodyWeight"].forEach(function (key) {
      var value = ov[key];
      if (value == null) return;
      if (THEME_WEIGHTS.indexOf(value) < 0) err(path + "." + key, "invalid_option", "themeOverrides." + key + " 只能为: " + THEME_WEIGHTS.join(" / "));
    });
  }

  /* ===== 板块 data 字段递归校验（schema 唯一来源 = Registry） ===== */
  function optionsFor(field, moduleType) {
    return field.dynamicOptions === "templates" ? R.templateOptions(moduleType) : (field.options || []);
  }
  function validateDataFields(def, moduleType, data, path, err, depth) {
    if (depth > LIMITS.maxDepth) { err(path, "depth_limit", "嵌套层级超过保护上限 " + LIMITS.maxDepth + " 层"); return; }
    var fields = def.fields || [];
    Object.keys(data).forEach(function (key) {
      var field = null;
      for (var i = 0; i < fields.length; i += 1) { if (fields[i].key === key) { field = fields[i]; break; } }
      if (!field) {
        err(path + "." + key, "unknown_field", "板块 \"" + def.label + "\" 的 data 不允许未知字段 \"" + key + "\"");
        return;
      }
      validateFieldValue(field, moduleType, data[key], path + "." + key, err, depth);
    });
  }
  function validateFieldValue(field, moduleType, value, path, err, depth) {
    switch (field.type) {
      case "text":
        if (typeof value !== "string") { err(path, "expected_string", field.label + " 必须是字符串"); return; }
        if (value.length > LIMITS.textMax) err(path, "text_too_long", field.label + " 长度不能超过 " + LIMITS.textMax + " 字");
        return;
      case "textarea":
        if (typeof value !== "string") { err(path, "expected_string", field.label + " 必须是字符串"); return; }
        if (value.length > LIMITS.textareaMax) err(path, "text_too_long", field.label + " 长度不能超过 " + LIMITS.textareaMax + " 字");
        return;
      case "number": {
        if (typeof value !== "number" || !isFinite(value)) { err(path, "expected_number", field.label + " 必须是有限数字"); return; }
        var min = field.min;
        var max = field.max;
        if ((min != null && value < min) || (max != null && value > max)) {
          err(path, "number_range", field.label + " 必须是 " + min + "-" + max + " 的数字");
          return;
        }
        if (field.step != null && !matchesStep(value, min != null ? min : 0, field.step)) {
          err(path, "number_step", field.label + " 必须按步进 " + field.step + " 取值（从 " + min + " 开始）");
        }
        return;
      }
      case "select": {
        var options = optionsFor(field, moduleType);
        for (var i = 0; i < options.length; i += 1) { if (options[i].value === value) return; }
        var allowed = options.map(function (o) { return o.value === "" ? "空字符串" : "\"" + o.value + "\""; }).join(" / ");
        err(path, "invalid_option", field.label + " 必须是以下取值之一: " + allowed);
        return;
      }
      case "image":
        /* 图片字段严格只接受 null：不接收网络图片、Base64、本地路径或 Blob URL */
        if (value !== null) err(path, "image_not_null", field.label + " 是图片字段，必须为 null（图片由用户在编辑界面手动上传）");
        return;
      case "stringList":
        if (!Array.isArray(value)) { err(path, "expected_array", field.label + " 必须是字符串数组"); return; }
        if (value.length > LIMITS.listMax) { err(path, "list_too_long", field.label + " 数量不能超过 " + LIMITS.listMax + " 项"); return; }
        value.forEach(function (item, ii) {
          if (typeof item !== "string") err(path + "[" + ii + "]", "expected_string", field.label + " 第 " + (ii + 1) + " 项必须是字符串");
          else if (item.length > LIMITS.textMax) err(path + "[" + ii + "]", "text_too_long", field.label + " 第 " + (ii + 1) + " 项长度不能超过 " + LIMITS.textMax + " 字");
        });
        return;
      case "objectList":
        if (!Array.isArray(value)) { err(path, "expected_array", field.label + " 必须是对象数组"); return; }
        if (value.length > LIMITS.listMax) { err(path, "list_too_long", field.label + " 数量不能超过 " + LIMITS.listMax + " 项"); return; }
        var subFields = field.fields || [];
        value.forEach(function (item, ii) {
          var itemPath = path + "[" + ii + "]";
          if (!isPlainObject(item)) { err(itemPath, "expected_object", field.label + " 第 " + (ii + 1) + " 项必须是对象"); return; }
          Object.keys(item).forEach(function (key) {
            var sub = null;
            for (var i = 0; i < subFields.length; i += 1) { if (subFields[i].key === key) { sub = subFields[i]; break; } }
            if (!sub) err(itemPath + "." + key, "unknown_field", field.label + " 第 " + (ii + 1) + " 项不允许未知字段 \"" + key + "\"");
            else validateFieldValue(sub, moduleType, item[key], itemPath + "." + key, err, depth + 1);
          });
        });
        return;
      default:
        err(path, "unsupported_field_type", "字段 \"" + field.key + "\" 的类型暂不支持（" + String(field.type) + "）");
    }
  }

  function validateModule(module, pi, mi, err, countModule) {
    var path = "pages[" + pi + "].modules[" + mi + "]";
    if (!isPlainObject(module)) { err(path, "module_type", "板块必须是对象"); return; }
    Object.keys(module).forEach(function (key) {
      if (key !== "type" && key !== "data") err(path + "." + key, "unknown_field", "板块不允许未知字段 \"" + key + "\"（id、visible 等由工具本地生成）");
    });
    var type = module.type;
    if (typeof type !== "string" || !R.getDef(type)) {
      err(path + ".type", "unknown_module_type", "不支持的板块类型 " + (type == null ? "null" : "\"" + String(type) + "\"") + "，请从板块目录中选择");
      return;
    }
    countModule();
    var data = module.data;
    if (!isPlainObject(data)) { err(path + ".data", "data_type", "data 必须是对象（不能是数组或其他类型）"); return; }
    validateDataFields(R.getDef(type), type, data, path + ".data", err, 1);
  }

  function validatePage(page, pi, err, countModule) {
    var path = "pages[" + pi + "]";
    if (!isPlainObject(page)) { err(path, "page_type", "页面必须是对象"); return; }
    Object.keys(page).forEach(function (key) {
      if (key !== "name" && key !== "modules") err(path + "." + key, "unknown_field", "页面不允许未知字段 \"" + key + "\"（只允许 name、modules）");
    });
    var name = page.name;
    if (typeof name !== "string" || trimString(name).length < 1 || trimString(name).length > LIMITS.pageNameMax) {
      err(path + ".name", "page_name_length", "页面 name 必填，去除首尾空白后长度 1-" + LIMITS.pageNameMax + " 字");
    }
    var modules = page.modules;
    if (!Array.isArray(modules)) { err(path + ".modules", "expected_array", "modules 必须是数组"); return; }
    if (modules.length > LIMITS.maxModulesPerPage) {
      err(path + ".modules", "modules_per_page", "每屏板块数不能超过 " + LIMITS.maxModulesPerPage + " 个（当前 " + modules.length + " 个）");
    }
    modules.forEach(function (module, mi) { validateModule(module, pi, mi, err, countModule); });
  }

  /* ===== 顶层校验：includeTheme 必须由调用方显式传入 ===== */
  function validate(aiResult, options) {
    var includeTheme = !!(options && options.includeTheme);
    var errors = [];
    function err(path, code, message) { errors.push({ path: path, code: code, message: message }); }

    if (!isPlainObject(aiResult)) {
      err("", "root_type", "顶层必须是一个 JSON 对象（不能是数组、字符串或其他类型）");
      return { valid: false, errors: errors };
    }
    Object.keys(aiResult).forEach(function (key) {
      if (TOP_ALLOWED_WITH_THEME.indexOf(key) < 0) err(key, "unknown_field", "未知顶层字段 \"" + key + "\"");
      else if (key === "themeOverrides" && !includeTheme) err(key, "theme_not_allowed", "本次未勾选「同时生成主题」，JSON 中不允许出现主题字段 \"" + key + "\"");
    });
    if (aiResult.schemaVersion !== 1) err("schemaVersion", "schema_version", "schemaVersion 必须严格等于数字 1");
    var name = aiResult.name;
    if (typeof name !== "string" || trimString(name).length < 1 || trimString(name).length > LIMITS.docNameMax) {
      err("name", "name_length", "name 必填，去除首尾空白后长度 1-" + LIMITS.docNameMax + " 字");
    }
    if (includeTheme) {
      var themeOverrides = aiResult.themeOverrides;
      if (!isPlainObject(themeOverrides)) err("themeOverrides", "theme_required", "已勾选「同时生成主题」，themeOverrides 必须是对象");
      else validateThemeOverrides(themeOverrides, "themeOverrides", err);
    }
    var pages = aiResult.pages;
    if (!Array.isArray(pages)) {
      err("pages", "expected_array", "pages 必须是数组（1-" + LIMITS.maxPages + " 屏，由 AI 根据活动资料自行决定屏数）");
      return { valid: false, errors: errors };
    }
    if (pages.length < 1 || pages.length > LIMITS.maxPages) {
      err("pages", "pages_range", "pages 必须是 1-" + LIMITS.maxPages + " 屏，由 AI 根据活动资料自行决定屏数");
    }
    var totalModules = 0;
    pages.forEach(function (page, pi) {
      validatePage(page, pi, err, function () { totalModules += 1; });
    });
    if (totalModules > LIMITS.maxModulesTotal) {
      err("pages", "modules_total", "全部屏的板块总数不能超过 " + LIMITS.maxModulesTotal + " 个（当前 " + totalModules + " 个）");
    }
    return { valid: errors.length === 0, errors: errors };
  }

  /* ===== 规范化：合并本地默认值，未知字段一律不保留，模块间不共享引用 ===== */
  function subFieldDefault(field) {
    if (field.type === "select") return field.options && field.options.length ? field.options[0].value : "";
    if (field.type === "number") return 0;
    if (field.type === "image") return null;
    if (field.type === "stringList" || field.type === "objectList") return [];
    return "";
  }
  function buildEntryFromSchema(field, item) {
    var entry = {};
    (field.fields || []).forEach(function (sub) { entry[sub.key] = subFieldDefault(sub); });
    if (!isPlainObject(item)) return entry;
    (field.fields || []).forEach(function (sub) {
      if (!Object.prototype.hasOwnProperty.call(item, sub.key)) return;
      entry[sub.key] = sub.type === "objectList" ? mergeObjectList(sub, item[sub.key]) : item[sub.key];
    });
    return entry;
  }
  function mergeObjectList(field, list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (item) { return buildEntryFromSchema(field, item); });
  }
  function buildNormalizedData(def, aiData) {
    /* 从 createDefault 起步：保留注册表默认值（含 template 默认模板与历史内部字段），
       再覆盖 AI 提供的合法字段；对象数组按子字段 schema 重建，不做无规则深合并 */
    var defaults = def.createDefault();
    var out = {};
    Object.keys(defaults).forEach(function (key) { out[key] = defaults[key]; });
    (def.fields || []).forEach(function (field) {
      if (!Object.prototype.hasOwnProperty.call(aiData, field.key)) return;
      out[field.key] = field.type === "objectList" ? mergeObjectList(field, aiData[field.key]) : aiData[field.key];
    });
    return out;
  }
  function normalizeThemeOverrides(ov) {
    if (!isPlainObject(ov)) return {};
    var out = {};
    THEME_BASE_COLORS.concat(THEME_EXTRA_COLORS).forEach(function (key) {
      if (typeof ov[key] === "string") out[key] = ov[key].trim().toLowerCase();
    });
    Object.keys(THEME_ENUMS).forEach(function (key) { if (typeof ov[key] === "string") out[key] = ov[key]; });
    Object.keys(THEME_NUMBERS).forEach(function (key) { if (typeof ov[key] === "number") out[key] = ov[key]; });
    ["headingWeight", "bodyWeight"].forEach(function (key) { if (typeof ov[key] === "number") out[key] = ov[key]; });
    return out;
  }
  function normalize(aiResult, options) {
    var includeTheme = !!(options && options.includeTheme);
    if (!isPlainObject(aiResult) || !Array.isArray(aiResult.pages)) {
      return { ok: false, errors: [{ path: "", code: "root_type", message: "输入不是有效的整份长条 JSON（请先通过校验再规范化）" }] };
    }
    try {
      var pages = aiResult.pages.map(function (page) {
        var modules = (Array.isArray(page && page.modules) ? page.modules : []).map(function (module) {
          var def = R.getDef(module && module.type);
          if (!def) throw new Error("未知板块类型，无法规范化");
          return { type: module.type, data: buildNormalizedData(def, isPlainObject(module.data) ? module.data : {}) };
        });
        return { name: trimString(page && page.name), modules: modules };
      });
      return {
        ok: true,
        value: {
          name: trimString(aiResult.name),
          themeOverrides: includeTheme ? normalizeThemeOverrides(aiResult.themeOverrides) : null,
          pages: pages,
        },
      };
    } catch (error) {
      return { ok: false, errors: [{ path: "", code: "normalize_failed", message: (error && error.message) || String(error) }] };
    }
  }

  /* ===== 候选文档构造：ID 全部本地生成，页面背景重置，结构配置沿用当前文档 ===== */
  function assertCandidate(candidate) {
    if (!isPlainObject(candidate)) throw new Error("候选文档无效");
    if (!Array.isArray(candidate.pages) || !candidate.pages.length) throw new Error("候选文档缺少页面");
    var pageIds = {};
    var moduleIds = {};
    var total = 0;
    candidate.pages.forEach(function (page, pi) {
      if (!isPlainObject(page) || !page.id || pageIds[page.id]) throw new Error("候选文档页面 ID 异常（第 " + (pi + 1) + " 屏）");
      pageIds[page.id] = true;
      if (!Array.isArray(page.modules)) throw new Error("候选文档页面缺少板块数组");
      page.modules.forEach(function (module, mi) {
        if (!isPlainObject(module) || !module.id || moduleIds[module.id]) throw new Error("候选文档板块 ID 异常（第 " + (pi + 1) + " 屏第 " + (mi + 1) + " 个）");
        moduleIds[module.id] = true;
        if (!R.getDef(module.type)) throw new Error("候选文档板块类型无效（" + String(module.type) + "）");
        if (!isPlainObject(module.data)) throw new Error("候选文档板块数据异常");
        total += 1;
      });
    });
    if (!total) throw new Error("候选文档没有任何板块");
    return { pages: candidate.pages.length, modules: total };
  }
  function buildCandidateDoc(normalized, currentDoc, options) {
    var includeTheme = !!(options && options.includeTheme);
    if (!normalized || !Array.isArray(normalized.pages)) throw new Error("规范化结果缺失，无法构造候选文档");
    if (!isPlainObject(currentDoc)) throw new Error("当前文档缺失，无法构造候选文档");
    var candidate = M.createDoc(currentDoc.ratio);
    candidate.name = trimString(normalized.name) || candidate.name;
    if (C.CANVAS_PRESETS[currentDoc.ratio]) candidate.ratio = currentDoc.ratio;
    candidate.screenMode = currentDoc.screenMode || "split";
    candidate.theme = currentDoc.theme || "forest";
    candidate.fontFamily = currentDoc.fontFamily || "sans";
    candidate.headingFont = currentDoc.headingFont || "";
    candidate.bodyFont = currentDoc.bodyFont || "";
    candidate.fontManual = currentDoc.fontManual === true;
    candidate.backgroundColor = typeof currentDoc.backgroundColor === "string" && currentDoc.backgroundColor ? currentDoc.backgroundColor : "#ffffff";
    candidate.backgroundImage = cloneImageRecord(currentDoc.backgroundImage);
    candidate.exportScale = currentDoc.exportScale || 2;
    /* 勾选主题 → 用校验过的 AI 覆盖参数；未勾选 → 深拷贝保留当前覆盖参数，不清空不改写 */
    candidate.themeOverrides = includeTheme
      ? cloneJson(normalized.themeOverrides || {})
      : cloneJson(isPlainObject(currentDoc.themeOverrides) ? currentDoc.themeOverrides : {});
    candidate.pages = normalized.pages.map(function (sourcePage) {
      var page = M.createPage();
      page.name = sourcePage.name;
      page.backgroundColor = "";
      page.backgroundImage = null;
      sourcePage.modules.forEach(function (sourceModule) {
        var module = M.createModule(sourceModule.type);
        module.data = cloneJson(sourceModule.data);
        page.modules.push(module);
      });
      return page;
    });
    assertCandidate(candidate);
    return candidate;
  }

  /* ===== 动态提示词 ===== */
  var COMMON_FIELDS_TEXT = [
    "所有板块的 data 都可以使用以下通用字段（全部可省略，省略时用默认值）：",
    "- \"template\"：板块模板，取值见各板块的「可用模板」；省略时用该板块第一个模板",
    "- \"sectionTitle\"：板块大标题（文本，可留空）",
    "- \"width\"：占宽，可选 full（通栏） / half（半宽，相邻两个 half 板块会左右并排）",
    "- \"contentAlign\"：内容对齐，可选 left / center / right",
    "- \"blockBgColor\"：板块底色（文本，如 \"#163a8a\"，可留空）",
    "- \"blockBgImage\"：板块底图（图片字段，必须为 null）",
    "- \"blockOpacity\"：板块透明度，数字 0-100 的整数",
    "- \"imageRatio\"：图片比例，可选 auto / 1:1 / 4:3 / 3:4 / 16:9",
    "- \"imageFit\"：图片填充，可选 cover（裁切填满） / contain（完整显示）",
  ].join("\n");

  function describeValue(field) {
    switch (field.type) {
      case "text": return "文本，" + LIMITS.textMax + " 字内";
      case "textarea": return "多行文本，" + LIMITS.textareaMax + " 字内";
      case "number":
        return "数字" + (field.min != null ? "，范围 " + field.min + "-" + field.max + (field.step != null ? "，步进 " + field.step : "") : "");
      case "select": {
        var options = field.options || [];
        return "可选: " + options.map(function (o) {
          return o.value === "" ? "空字符串(" + (o.label || "跟随默认") + ")" : o.value + "(" + o.label + ")";
        }).join(" / ");
      }
      case "image": return "图片字段，必须为 null，导入后在编辑界面手动上传";
      case "stringList": return "字符串数组，每项 " + LIMITS.textMax + " 字内，最多 " + LIMITS.listMax + " 项";
      case "objectList": return "对象数组，最多 " + LIMITS.listMax + " 项";
      default: return String(field.type);
    }
  }
  function describeFieldLine(field, pad) {
    if (field.type === "objectList") {
      var lines = [pad + "- \"" + field.key + "\"：" + field.label + "（对象数组，最多 " + LIMITS.listMax + " 项；每项只允许以下字段）"];
      (field.fields || []).forEach(function (sub) {
        lines.push(describeFieldLine(sub, pad + "    "));
      });
      return lines.join("\n");
    }
    return pad + "- \"" + field.key + "\"：" + field.label + "（" + describeValue(field) + "）";
  }
  function buildModuleCatalog() {
    var lines = [];
    R.MODULE_ORDER.forEach(function (type) {
      var def = R.getDef(type);
      lines.push("■ " + type + " · " + def.label);
      var templates = R.templateOptions(type);
      lines.push("  可用模板（data.template）: " + templates.map(function (t) { return t.value + "=" + t.label; }).join(" / "));
      var specific = (def.fields || []).filter(function (f) { return COMMON_FIELD_KEYS.indexOf(f.key) < 0; });
      if (specific.length) {
        lines.push("  特有字段：");
        specific.forEach(function (f) { lines.push(describeFieldLine(f, "    ")); });
      } else {
        lines.push("  特有字段：无（只用通用字段）");
      }
    });
    return lines.join("\n");
  }
  function buildThemeSection() {
    var lines = [];
    lines.push("【主题微调协议（本次必须包含 themeOverrides）】");
    lines.push("JSON 顶层必须包含 \"themeOverrides\" 对象，表示对当前主题的微调参数；不创建新主题、不修改任何字体。");
    lines.push("如果用户随消息附上了参考图片，请从参考图中提取配色与风格感受，转化为以下参数；你不需要、也不应该生成或返回任何图片本身。");
    lines.push("");
    lines.push("themeOverrides 字段说明：");
    lines.push("- 必填颜色（#RRGGBB 六位十六进制）: " + THEME_BASE_COLORS.join(" / "));
    lines.push("  含义参考: primary 主色(按钮/选中/边框)、primaryDark 深主色(标题/深底)、primarySoft 浅主色底(卡片浅底)、accent 强调色(价格/高亮)、accentSoft 浅强调底(标签底)、line 线色(分隔线/描边)、soft 软底(空状态底色)");
    lines.push("- 可选颜色（#RRGGBB）: ink(正文墨色) / muted(弱化说明色)");
    lines.push("- cardStyle 卡片骨架，可选: " + THEME_ENUMS.cardStyle.join(" / "));
    lines.push("- radius 默认卡片圆角，数字 0-100 的整数");
    lines.push("- shadow 阴影，可选: " + THEME_ENUMS.shadow.join(" / "));
    lines.push("- divider 分割线，可选: " + THEME_ENUMS.divider.join(" / "));
    lines.push("- chips 标签形状，可选: " + THEME_ENUMS.chips.join(" / "));
    lines.push("- titleDecor 大标题装饰，可选: " + THEME_ENUMS.titleDecor.join(" / "));
    lines.push("- pattern 页面底纹，可选: " + THEME_ENUMS.pattern.join(" / "));
    lines.push("- avatarStyle 头像装饰，可选: " + THEME_ENUMS.avatarStyle.join(" / "));
    lines.push("- typeScale 全局字号缩放，数字 0.7-1.5，步进 0.05");
    lines.push("- h1Scale / h2Scale / h3Scale / bodyScale / captionScale 各级字号缩放，数字 0.7-1.3，步进 0.05");
    lines.push("- headingWeight / bodyWeight 字重，只能为: " + THEME_WEIGHTS.join(" / "));
    lines.push("- lineHeight 行距倍率，数字 0.8-2，步进 0.05；letterSpacing 字距，数字 -2 到 8，步进 0.5");
    lines.push("- 不允许出现 " + THEME_FORBIDDEN_KEYS.map(function (k) { return "\"" + k + "\""; }).join(" / ") + " 或其他任何字段");
    return lines.join("\n");
  }
  /* 示例即「成熟 live 活动长条」的迷你样板：无封面，第一屏以活动介绍开场，
     阵容按角色分组放 castList。AI 会参照示例的组织方式。 */
  function exampleDoc(includeTheme) {
    var doc = {
      schemaVersion: 1,
      name: "示例活动长条",
      pages: [
        {
          name: "第 1 屏",
          modules: [
            { type: "announcement", data: { template: "notice", sectionTitle: "活动介绍", heading: "一场面向所有人的主题演出", body: "6 小时超长演出，3 支乐队、2 位嘉宾、2 位 DJ，一次听个够！\n大量经典曲目轮番上演。\n如果这是你第一次来到线下现场，这会是一个美好的开始。" } },
            { type: "venueInfo", data: { template: "venue-side", sectionTitle: "活动信息", description: "📅 时间：2026.10.01（周四）14:00-20:00\n📍 地点：上海市 XX 区 XX 路 XX 号 Livehouse\n🎸 演出乐队：某乐队 / 某某乐队\n🎧 DJ：DJ 某某 / DJ 某某\n🎫 活动群：123456789", tags: ["地铁 2 号线 XX 站 3 号口步行 5 分钟"], imagePlacement: "right" } },
          ],
        },
        {
          name: "第 2 屏",
          modules: [
            { type: "ticketInfo", data: { sectionTitle: "票务（XX 平台开票）", tiers: [{ label: "预售票", price: "￥65" }, { label: "现场票", price: "￥80" }], note: "目前暂未开票，请关注后续开票消息。" } },
            { type: "castList", data: { sectionTitle: "演出阵容", cast: [{ role: "band", name: "某乐队", time: "14:30" }, { role: "singer", name: "某歌手", time: "16:00", setlist: [{ song: "代表曲", coverBy: "原唱某乐队" }] }, { role: "DJ", name: "DJ 某某", time: "18:00" }] } },
            { type: "footer", data: { lines: ["微博 @XXX", "QQ 群 123456789"] } },
          ],
        },
      ],
    };
    if (includeTheme) {
      doc.themeOverrides = {
        primary: "#1e7a4f",
        primaryDark: "#124f30",
        primarySoft: "#e4f2ea",
        accent: "#f2704b",
        accentSoft: "#fdeae2",
        line: "#cfe3d6",
        soft: "#edf4ee",
        radius: 18,
        divider: "dots",
      };
    }
    return doc;
  }
  /* ===== 活动类型页面组织范例（live 范例来自成熟 Live 演出长条样板） ===== */
  var EVENT_TYPE_LABELS = { mixed: "综合活动", live: "Live 演出活动", booth: "摊位活动" };
  function buildEventSection(eventType) {
    var typeLabel = EVENT_TYPE_LABELS[eventType] || EVENT_TYPE_LABELS.mixed;
    var lines = [];
    lines.push("【活动类型：" + typeLabel + " · 页面组织范例】");
    lines.push("- 默认不生成 cover 封面板块（下方 JSON 示例就是无封面的推荐结构）：第一屏以「活动介绍」等公告或信息板块直接开场。");
    lines.push("- 以下顺序仅为建议，请根据活动资料实际内容取舍与排序：");
    if (eventType === "live") {
      lines.push("  1. announcement 活动介绍（公告卡）：一句话定性活动 + 演出规模（几支乐队/几位嘉宾/几位 DJ、时长）+ 曲目或内容亮点 + 对新观众的引导。");
      lines.push("  2. venueInfo 活动信息（图文侧栏）：时间、地点、阵容概览、交流群，逐行分行写清楚。");
      lines.push("  3. venueInfo（场地重点）或 routeText：入场时间与交通指引（地铁/打车/导航地标，写具体）。");
      lines.push("  4. ticketInfo 票务：票档与价格、开票渠道与开票状态说明（未开票时写清关注方式）。");
      lines.push("  5. materials：入场物料（荧光棒/手环/场刊等）与观演注意事项。");
      lines.push("  6. castList 演出阵容：按角色分组各一个板块（如「嘉宾阵容」「DJ阵容」「乐队阵容」），成员条目写角色、名称、演出时段，有曲目信息时填歌单。");
      lines.push("  7. schedule 活动时间轴：分时段流程（如有）。");
      lines.push("  8. footer 页脚：主办/合作/社交账号。");
    } else if (eventType === "booth") {
      lines.push("  1. announcement 活动介绍（公告卡）：活动性质、主题与主要卖点。");
      lines.push("  2. venueInfo 活动信息（图文侧栏）：日期、场地、开放时间、交流群。");
      lines.push("  3. venueInfo（地图说明）或 routeText：场地平面说明与交通指引。");
      lines.push("  4. boothList 摊位信息：按分区或类型组织摊位条目（摊位名 + 简介）。");
      lines.push("  5. programList 或 schedule：现场节目、互动环节、限时活动（如有）。");
      lines.push("  6. materials：参展/观展规则、应援物说明、寄存信息。");
      lines.push("  7. ticketInfo：门票或入场券信息（如有）。");
      lines.push("  8. footer 页脚：主办方/社交账号/补充声明。");
    } else {
      lines.push("  综合演出与摊位市集等多种活动形式：结合活动资料自由编排，可选板块包括活动介绍（announcement）、活动信息与场地交通（venueInfo / routeText）、票务（ticketInfo）、演出阵容（castList，按角色分组）、时间轴（schedule）、摊位列表（boothList）、节目单（programList）、规则物料（materials）、页脚（footer），按观众阅读顺序取舍组合。");
    }
    return lines.join("\n");
  }
  function buildPrompt(context) {
    var ctx = context || {};
    var includeTheme = !!ctx.includeTheme;
    var preset = C.CANVAS_PRESETS[ctx.ratio] ? C.CANVAS_PRESETS[ctx.ratio] : null;
    var ratioText = ctx.ratio || C.DEFAULT_RATIO;
    if (preset) ratioText += "（" + preset.pageWidth + " × " + preset.pageHeight + " px）";
    var screenText = ctx.screenMode === "continuous"
      ? "continuous（连续：全部屏拼成一张连续长图，相邻屏的内容要自然衔接）"
      : "split（分屏：每屏是一张独立图片，适合逐屏发布）";
    var themeLabel = ctx.themeLabel || ctx.themeId || "默认主题";
    function fontLabel(key) {
      if (!key) return "";
      var f = C.FONTS[key];
      return f && f.label ? f.label + "(" + key + ")" : key;
    }
    var fontText = "全局 " + (fontLabel(ctx.fontFamily) || "默认") + "；标题 " + (ctx.headingFont ? fontLabel(ctx.headingFont) : "跟随全局") + "；正文 " + (ctx.bodyFont ? fontLabel(ctx.bodyFont) : "跟随标题");

    var lines = [];
    var eventType = EVENT_TYPE_LABELS[ctx.eventType] ? ctx.eventType : "mixed";
    lines.push("你是一位活动宣传长条排版设计师。用户正在使用「Only-box 活动宣传长条排版工具」，请你根据用户提供的活动资料，生成整份多屏长条的结构化内容。");
    lines.push("");
    lines.push("【操作说明】");
    lines.push("1. 本提示词需要与用户的活动资料一起发送：活动资料（活动介绍、时间安排、票务、阵容、场地等信息）由用户在对话中另行提供，不需要写进本提示词模板。");
    if (includeTheme) {
      lines.push("2. 如果用户使用的是支持看图的模型，用户还可以同时附上参考图片；请从参考图提取配色与风格感受，用于生成 themeOverrides（见下方主题微调协议）。");
    } else {
      lines.push("2. 如果用户同时附上了参考图片，只能作为理解活动风格的背景信息；本次不需要输出任何主题参数。");
    }
    lines.push("3. 你只输出一个 JSON 对象；工具会把 JSON 转换为可编辑的长条内容，不会上传或保存任何对话内容。");
    lines.push("");
    lines.push("【当前画布信息】");
    lines.push("- 画布比例: " + ratioText);
    lines.push("- 屏幕衔接方式: " + screenText);
    lines.push("- 当前主题: " + themeLabel + (ctx.themeId ? "（主题标识 " + ctx.themeId + "）" : ""));
    lines.push("- 字体: " + fontText + "。字体由工具保留，JSON 中不要出现任何字体设置。");
    lines.push("");
    lines.push("【页面规划】");
    lines.push("- 根据活动资料的信息量与阅读顺序，自行决定拆分为 1 到 20 屏；不要假设固定的屏数。");
    lines.push("- 每屏建议 1 到 12 个板块，每屏硬上限 30 个，全部屏合计硬上限 120 个板块。");
    lines.push("- 同类信息必须合并到同一个板块，靠板块内的数组条目扩展，而不是拆成多个同类板块：多个票档、多条节目、多个摊位、多行路线各用一个板块承载；演出阵容按角色、天或舞台分组时，每组一个阵容板块（如「嘉宾阵容」「DJ阵容」「乐队阵容」）。");
    lines.push("- 屏与屏按观众从上到下的阅读顺序组织：活动介绍与核心信息在前，票务、时间、地点、阵容等主体内容在中部，页脚与联系方式收尾。同一屏内按信息主次排序，可用分割线与自由文本调节节奏。");
    lines.push("");
    lines.push(buildEventSection(eventType));
    lines.push("");
    lines.push("【输出要求】");
    lines.push("- 只输出单个合法 JSON 对象：不要任何解释文字，不要 Markdown 代码块围栏，不要注释，不要尾逗号。");
    lines.push("- 所有图片字段一律写 null；工具不接收任何图片，用户会在编辑界面手动上传图片。");
    lines.push("- 只使用下方列出的板块类型与字段；写出的字段名必须与定义完全一致，不要自造字段。");
    lines.push("- data 中所有字段都可以省略，省略时使用工具默认值；不确定模板时直接省略 template 字段。演出阵容资料以文字、歌单为主用 castList（列表式），强调成员头像与视觉形象时才用 castCards（卡片式）。");
    lines.push("- 活动资料可能只有海报图或零散文字：请充分提取资料中出现的全部信息（时间、地点、阵容、票务、规则、社交账号等）并组织到对应板块；资料未覆盖但该类活动应有的板块，可依据活动类型合理撰写文案补全；无法从资料推断的具体数字（价格、群号、场次时间）留空或省略，不要编造。");
    if (!includeTheme) {
      lines.push("- JSON 顶层只允许 schemaVersion、name、pages 三个字段，不要输出任何主题配色参数。");
    }
    lines.push("");
    lines.push("【JSON 结构示例】（仅演示结构，内容必须替换为根据活动资料生成的真实内容）");
    lines.push(JSON.stringify(exampleDoc(includeTheme), null, 2));
    lines.push("【示例结束】");
    lines.push("");
    lines.push("结构说明：");
    lines.push("- schemaVersion 固定为数字 1。");
    lines.push("- name 是整份长条的名称，1 到 80 字。");
    lines.push("- pages 是页面数组：每页只允许 name（1 到 40 字）与 modules 两个字段。");
    lines.push("- modules 是板块数组：每个板块只允许 type 与 data 两个字段，type 从下方板块目录中选择。");
    if (includeTheme) {
      lines.push("");
      lines.push(buildThemeSection());
    }
    lines.push("");
    lines.push("【板块目录与字段定义】");
    lines.push(COMMON_FIELDS_TEXT);
    lines.push("");
    lines.push(buildModuleCatalog());
    lines.push("");
    lines.push("最后再次强调：只输出一个 JSON 对象，不要解释，不要 Markdown 围栏，不要注释，不要尾逗号；所有图片字段写 null。");
    return lines.join("\n");
  }

  /* ===== 可注入状态的应用核心（原子应用） =====
     config: { rawText, includeTheme, currentDoc, replace(candidate), render() }
     任何失败都保证调用方文档未被改动；render 抛错时自动用快照回滚并重渲染。 */
  function applyPipeline(rawText, config) {
    var cfg = config || {};
    var options = { includeTheme: !!cfg.includeTheme };
    var currentDoc = cfg.currentDoc;
    var replace = typeof cfg.replace === "function" ? cfg.replace : null;
    var render = typeof cfg.render === "function" ? cfg.render : null;
    if (!replace) return { ok: false, phase: "config", message: "缺少 replace 安装钩子" };

    var parsed = extractJson(rawText);
    if (!parsed.ok) return { ok: false, phase: "parse", message: parsed.message };
    var check = validate(parsed.value, options);
    if (!check.valid) return { ok: false, phase: "validate", errors: check.errors };
    var normalized = normalize(parsed.value, options);
    if (!normalized.ok) return { ok: false, phase: "normalize", errors: normalized.errors };
    var candidate;
    try {
      candidate = buildCandidateDoc(normalized.value, currentDoc, options);
    } catch (error) {
      return { ok: false, phase: "build", message: (error && error.message) || String(error) };
    }
    var snapshot = cloneJson(currentDoc);
    try {
      /* replace(candidate, snapshot)：安装回调同时拿到撤销快照，便于调用方先接管 blob 保护再释放旧图 */
      replace(candidate, snapshot);
      if (render) render();
    } catch (error) {
      var restoreError = null;
      try {
        replace(snapshot, null);
        if (render) render();
      } catch (restoreFailure) {
        restoreError = restoreFailure;
      }
      return {
        ok: false,
        phase: "render",
        message: (error && error.message) || String(error),
        restored: !restoreError,
        restoreError: restoreError ? String((restoreError && restoreError.message) || restoreError) : null,
      };
    }
    return { ok: true, doc: candidate, snapshot: snapshot, stats: assertCandidate(candidate) };
  }

  global.BannerBuilderAiDocument = Object.freeze({
    buildPrompt: buildPrompt,
    extractJson: extractJson,
    validate: validate,
    normalize: normalize,
    buildCandidateDoc: buildCandidateDoc,
    applyPipeline: applyPipeline,
    LIMITS: Object.freeze(LIMITS),
  });
})(window);

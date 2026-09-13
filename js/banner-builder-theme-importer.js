/* banner-builder-theme-importer.js —— 主题可导入模块
   用户复制 AI 提示词 → 让其他 AI 生成 JSON → 粘贴回本工具导入。
   数据存 localStorage，与内置主题合并后供全局使用。

   AI 提示词要求其他 AI 输出符合 schema 的 JSON 块，字段含义与枚举值
   已在 prompt 中完整定义，任何主流 LLM 均可正确生成。

   对外暴露 BannerBuilderThemeImporter。 */

(function (global) {
  "use strict";

  var C = global.BannerBuilderConstants;

  var STORAGE_KEY = "only-box-banner-custom-themes";

  /* ================================================================
     Schema 与校验
     ================================================================ */

  var VALID_CARD_STYLES = ["card", "panel", "glass", "ticket", "sticker", "ink"];
  var VALID_SHADOWS = ["soft", "hard", "glow", "none"];
  var VALID_DIVIDERS = ["wave", "dots", "line", "glitch", "thread", "dashed"];
  var VALID_CHIPS = ["pill", "squared", "tag"];
  var VALID_TITLE_DECOR = ["none", "bar", "bracket", "stitch", "kicker"];
  var VALID_PATTERNS = ["none", "grid", "dots", "stripes", "paper", "noise"];
  var VALID_AVATAR_STYLES = ["none", "ring", "glow", "badge", "frame", "polaroid"];
  var VALID_FONT_KEYS = Object.keys(C.FONTS);

  var STYLE_DEFAULTS = {
    cardStyle: "card", radius: 13, shadow: "soft", divider: "wave",
    chips: "pill", titleDecor: "none", pattern: "none", avatarStyle: "none", headingFont: "", bodyFont: "",
    ink: "#20251f", muted: "#6a706c", headingWeight: 800, bodyWeight: 400, lineHeight: 1, letterSpacing: 0, typeScale: 1,
    h1Scale: 1, h2Scale: 1, h3Scale: 1, bodyScale: 1, captionScale: 1
  };

  function isValidHex(value) {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  function validateTheme(obj) {
    var errors = [];

    if (!obj || typeof obj !== "object") { errors.push("主题必须是一个 JSON 对象"); return errors; }

    // 必填：id
    if (typeof obj.id !== "string" || !/^[a-z][a-z0-9_-]*$/.test(obj.id)) {
      errors.push("id 必填，只能用小写字母开头，含字母数字下划线短横线（如 sunset-glow）");
    }

    // 必填：label
    if (typeof obj.label !== "string" || !obj.label.trim()) {
      errors.push("label 必填，中英文均可，用于下拉菜单显示（如「日落辉光」）");
    }

    // 必填：7 个色值
    ["primary", "primaryDark", "primarySoft", "accent", "accentSoft", "line", "soft"].forEach(function (key) {
      if (!isValidHex(obj[key])) {
        errors.push(key + " 必填，必须是 #RRGGBB 格式的十六进制颜色");
      }
    });

    // 选填：枚举值校验
    var enumChecks = [
      ["cardStyle", VALID_CARD_STYLES], ["shadow", VALID_SHADOWS],
      ["divider", VALID_DIVIDERS], ["chips", VALID_CHIPS],
      ["titleDecor", VALID_TITLE_DECOR], ["pattern", VALID_PATTERNS],
      ["avatarStyle", VALID_AVATAR_STYLES]
    ];
    enumChecks.forEach(function (pair) {
      var key = pair[0], valid = pair[1];
      if (obj[key] != null && valid.indexOf(obj[key]) < 0) {
        errors.push(key + " 可选值为: " + valid.join(", "));
      }
    });

    // 选填：radius 数字
    if (obj.radius != null && (typeof obj.radius !== "number" || obj.radius < 0 || obj.radius > 100)) {
      errors.push("radius 必须是 0-100 的数字");
    }

    // 选填：文字色（为主题追加的排版字段）
    ["ink", "muted"].forEach(function (key) {
      if (obj[key] != null && !isValidHex(obj[key])) {
        errors.push(key + " 可选，必须是 #RRGGBB 格式的十六进制颜色");
      }
    });

    // 选填：字重
    [["headingWeight", 400, 900], ["bodyWeight", 300, 900]].forEach(function (pair) {
      var key = pair[0], min = pair[1], max = pair[2];
      if (obj[key] != null && (typeof obj[key] !== "number" || obj[key] < min || obj[key] > max)) {
        errors.push(key + " 可选，必须是 " + min + "-" + max + " 的数字");
      }
    });

    // 选填：行距 / 字距
    if (obj.lineHeight != null && (typeof obj.lineHeight !== "number" || obj.lineHeight < 0.8 || obj.lineHeight > 2)) {
      errors.push("lineHeight 可选，必须是 0.8-2 的数字（行距缩放倍率，1=不缩放）");
    }
    if (obj.letterSpacing != null && (typeof obj.letterSpacing !== "number" || obj.letterSpacing < -5 || obj.letterSpacing > 20)) {
      errors.push("letterSpacing 可选，必须是 -5 到 20 的数字（像素字距）");
    }

    // 选填：字号缩放
    if (obj.typeScale != null && (typeof obj.typeScale !== "number" || obj.typeScale < 0.5 || obj.typeScale > 2)) {
      errors.push("typeScale 可选，必须是 0.5-2 的数字（全局字号缩放）");
    }
    ["h1Scale", "h2Scale", "h3Scale", "bodyScale", "captionScale"].forEach(function (k) {
      if (obj[k] != null && (typeof obj[k] !== "number" || obj[k] < 0.5 || obj[k] > 2)) {
        errors.push(k + " 可选，必须是 0.5-2 的数字（该层级字号缩放）");
      }
    });

    // 选填：字体键
    ["headingFont", "bodyFont"].forEach(function (key) {
      if (obj[key] != null && obj[key] !== "" && VALID_FONT_KEYS.indexOf(obj[key]) < 0) {
        errors.push(key + " 可选值为: " + VALID_FONT_KEYS.join(", ") + "，或留空");
      }
    });

    return errors;
  }

  /* 补齐选填字段的默认值 */
  function withDefaults(obj) {
    var out = {};
    // 必填字段直出
    ["id", "label", "primary", "primaryDark", "primarySoft", "accent", "accentSoft", "line", "soft"].forEach(function (key) {
      out[key] = obj[key];
    });
    // 选填字段用默认值
    Object.keys(STYLE_DEFAULTS).forEach(function (key) {
      out[key] = obj[key] != null ? obj[key] : STYLE_DEFAULTS[key];
    });
    // radius 特殊：0 是合法值
    out.radius = typeof obj.radius === "number" ? obj.radius : STYLE_DEFAULTS.radius;
    return out;
  }

  /* ================================================================
     localStorage 存取
     ================================================================ */

  function loadAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveAll(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      if (global.alert) global.alert("主题保存失败（可能浏览器存储空间不足）");
    }
  }

  function addTheme(obj) {
    var themes = loadAll();
    // 同 id 覆盖
    var idx = -1;
    for (var i = 0; i < themes.length; i++) {
      if (themes[i].id === obj.id) { idx = i; break; }
    }
    var record = withDefaults(obj);
    if (idx >= 0) themes[idx] = record;
    else themes.push(record);
    saveAll(themes);
    return record;
  }

  function removeTheme(id) {
    var themes = loadAll();
    var filtered = themes.filter(function (t) { return t.id !== id; });
    if (filtered.length === themes.length) return false;
    saveAll(filtered);
    return true;
  }

  /* 合并：自定义主题（localStorage）覆盖内置主题，按 label 排序显示 */
  function mergeAll() {
    var builtin = C.THEMES || {};
    var custom = loadAll();
    var merged = {};

    // 先放内置
    Object.keys(builtin).forEach(function (key) {
      merged[key] = builtin[key];
    });

    // 自定义覆盖（同 key 优先）
    custom.forEach(function (t) {
      merged[t.id] = t;
    });

    return merged;
  }

  /* 判断是否自定义主题 */
  function isCustom(id) {
    return loadAll().some(function (t) { return t.id === id; });
  }

  /* ================================================================
     AI 提示词
     ================================================================ */

  function buildPrompt() {
    var fontList = VALID_FONT_KEYS.map(function (k) {
      var f = C.FONTS[k]; return k + "（" + (f ? f.label : k) + "）";
    }).join("\n");

    return [
      "你是一位 UI 配色专家。请为「Only-box 活动宣传长条排版工具」设计一套主题配色方案，",
      "输出一段纯 JSON（不要 markdown 代码块标记，不要解释文字），格式如下：",
      "",
      "{",
      '  "id": "my-theme",           // 唯一标识，小写字母开头，可含数字下划线短横线',
      '  "label": "我的主题",         // 显示名称，中英文均可',
      '  "primary": "#1e7a4f",       // 主色，用于按钮/选中态/边框',
      '  "primaryDark": "#124f30",   // 深主色，用于标题/强调/深底',
      '  "primarySoft": "#e4f2ea",   // 浅主色，用于卡片底色/浅区',
      '  "accent": "#f2704b",        // 强调色，用于价格/高亮/小点缀',
      '  "accentSoft": "#fdeae2",    // 浅强调色，用于标签底',
      '  "line": "#cfe3d6",          // 线色，用于分隔线/边框/输入框',
      '  "soft": "#edf4ee",          // 软底，用于工具栏底/空状态',
      "",
      "  以下字段为可选，不写则使用默认值：",
      '  "cardStyle": "card",        // 可选: card / panel / glass / ticket / sticker / ink',
      '  "radius": 23,               // 默认卡片圆角，0-100',
      '  "shadow": "soft",           // 可选: soft / hard / glow / none',
      '  "divider": "wave",          // 可选: wave / dots / line / glitch / thread / dashed',
      '  "chips": "pill",            // 可选: pill / squared / tag',
      '  "titleDecor": "none",       // 可选: none / bar / bracket / stitch / kicker',
      '  "pattern": "none",          // 可选: none / grid / dots / stripes / paper / noise',
      '  "avatarStyle": "none",      // 可选头像装饰: none / ring / glow / badge / frame / polaroid（作用于演出阵容头像）',
      '  "headingFont": "",          // 可选字体键，留空跟随全局。可用字体：',
      fontList,
      '  "bodyFont": "",             // 同上',
      "",
      "  以下为排版与文字样式（可选，不写则用默认值）：",
      '  "ink": "#2b2f2a",           // 正文墨色（正文字号的大段文字颜色）',
      '  "muted": "#6a706c",         // 弱化说明色（图注/辅助信息颜色）',
      '  "headingWeight": 800,       // 标题字重，400-900（主标题/板块标题/醒目数字）',
      '  "bodyWeight": 400,          // 正文字重，300-900（正文/说明/图注）',
      '  "lineHeight": 1,            // 全局行距缩放倍率，0.8-2（1=不缩放保持各层级原行距，1.2=整体放 20%）',
      '  "letterSpacing": 0,         // 全局字距（像素），-5 到 20',
      '  "typeScale": 1,             // 全局字号缩放，0.5-2（所有文字统一放大/缩小）',
      '  "h1Scale": 1,               // 大标题字号缩放（60px 以上），0.5-2',
      '  "h2Scale": 1,               // 板块标题字号缩放（44-59px），0.5-2',
      '  "h3Scale": 1,               // 卡片标题字号缩放（32-43px），0.5-2',
      '  "bodyScale": 1,             // 正文字号缩放（26-31px），0.5-2',
      '  "captionScale": 1,          // 小字/图注缩放（26px 以下），0.5-2',
      "}",
      "",
      "规则：",
      "- 所有颜色必须为 #RRGGBB 格式，不要用 rgba/hsl/color-mix/transparent",
      "- 色值之间应有一致的饱和度/明度关系，体现统一的配色体系",
      "- primary 和 accent 要有足够的对比度区分",
      "- primarySoft 应比 primary 明显更浅",
      "- line 介于 soft 和 primarySoft 之间",
      "- ink 建议采用接近深灰/主题深色的低饱和色，保证大段正文可读；muted 比 ink 更浅一档",
      "- 字重/字号缩放/行距/字距请用数字，不要带单位",
      "- 只输出 JSON，不要其他文字"
    ].join("\n");
  }

  /* 从文本中提取 JSON（容错：去除 markdown 代码块标记和前后空白） */
  function extractJson(text) {
    var raw = String(text || "").trim();
    // 去掉 markdown 代码块
    raw = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/, "");
    // 找到第一个 { 到最后一个 }
    var start = raw.indexOf("{");
    var end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (e) {
      return null;
    }
  }

  /* ================================================================
     对外接口
     ================================================================ */

  global.BannerBuilderThemeImporter = Object.freeze({
    validate: validateTheme,
    add: addTheme,
    remove: removeTheme,
    mergeAll: mergeAll,
    isCustom: isCustom,
    loadAll: loadAll,
    buildPrompt: buildPrompt,
    extractJson: extractJson,
    promptText: buildPrompt(),
    STYLE_DEFAULTS: STYLE_DEFAULTS,
  });

})(window);
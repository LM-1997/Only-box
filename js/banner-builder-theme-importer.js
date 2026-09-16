/* banner-builder-theme-importer.js —— 主题可导入模块
   用户复制 AI 提示词 → 让其他 AI 生成 JSON → 粘贴回本工具导入。
   数据存 localStorage，与内置主题合并后供全局使用。

   AI 提示词要求其他 AI 输出符合 schema 的 JSON 块（示例为合法 JSON，字段说明在示例之外，
   避免 AI 照抄注释导致解析失败），字段含义与枚举值已在 prompt 中完整定义。

   校验范围与「微调主题 / 排版微调」手动界面保持一致；同 ID（含内置主题）拒绝覆盖；
   存储失败向上抛错，由调用方统一反馈。

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

  /* 字体 key 动态读取：用户导入的本地字体会运行时扩充 C.FONTS，
     静态捕获会让后导入字体无法通过校验/出现在提示词。 */
  function validFontKeys() {
    return Object.keys(C.FONTS);
  }

  var STYLE_DEFAULTS = {
    cardStyle: "card", radius: 13, shadow: "soft", divider: "wave",
    chips: "pill", titleDecor: "none", pattern: "none", avatarStyle: "none", headingFont: "", bodyFont: "",
    ink: "#20251f", muted: "#6a706c", headingWeight: 800, bodyWeight: 400, lineHeight: 1, letterSpacing: 0, typeScale: 1,
    h1Scale: 1, h2Scale: 1, h3Scale: 1, bodyScale: 1, captionScale: 1
  };

  function isValidHex(value) {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  /* 与手动微调界面完全一致的范围（排版微调面板：typeScale 0.7-1.5、各级 0.7-1.3、
     lineHeight 0.8-2 步进 0.05、letterSpacing -2 到 8 步进 0.5；字重档位 400-900）。 */
  function checkStep(value, min, step) {
    var units = (value - min) / step;
    return Math.abs(units - Math.round(units)) < 1e-8;
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

    // 选填：字重（与手动档位一致：400/500/600/700/800/900）
    ["headingWeight", "bodyWeight"].forEach(function (key) {
      if (obj[key] != null && [400, 500, 600, 700, 800, 900].indexOf(obj[key]) < 0) {
        errors.push(key + " 可选，只能为 400 / 500 / 600 / 700 / 800 / 900");
      }
    });

    // 选填：行距 / 字距（与排版微调面板一致）
    if (obj.lineHeight != null && (typeof obj.lineHeight !== "number" || obj.lineHeight < 0.8 || obj.lineHeight > 2 || !checkStep(obj.lineHeight, 0.8, 0.05))) {
      errors.push("lineHeight 可选，必须是 0.8-2 的数字，步进 0.05（行距缩放倍率，1=不缩放）");
    }
    if (obj.letterSpacing != null && (typeof obj.letterSpacing !== "number" || obj.letterSpacing < -2 || obj.letterSpacing > 8 || !checkStep(obj.letterSpacing, -2, 0.5))) {
      errors.push("letterSpacing 可选，必须是 -2 到 8 的数字，步进 0.5（像素字距）");
    }

    // 选填：字号缩放（与排版微调面板一致）
    if (obj.typeScale != null && (typeof obj.typeScale !== "number" || obj.typeScale < 0.7 || obj.typeScale > 1.5 || !checkStep(obj.typeScale, 0.7, 0.05))) {
      errors.push("typeScale 可选，必须是 0.7-1.5 的数字，步进 0.05（全局字号缩放）");
    }
    ["h1Scale", "h2Scale", "h3Scale", "bodyScale", "captionScale"].forEach(function (k) {
      if (obj[k] != null && (typeof obj[k] !== "number" || obj[k] < 0.7 || obj[k] > 1.3 || !checkStep(obj[k], 0.7, 0.05))) {
        errors.push(k + " 可选，必须是 0.7-1.3 的数字，步进 0.05（该层级字号缩放）");
      }
    });

    // 选填：字体键（动态清单，含用户后导入的字体）
    var fontKeys = validFontKeys();
    ["headingFont", "bodyFont"].forEach(function (key) {
      if (obj[key] != null && obj[key] !== "" && fontKeys.indexOf(obj[key]) < 0) {
        errors.push(key + " 可选值为: " + fontKeys.join(", ") + "，或留空");
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
      var raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveAll(list) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function addTheme(obj) {
    if (typeof obj.id === "string") {
      var builtinExists = !!C.THEMES[obj.id];
      var customExists = loadAll().some(function (t) { return t.id === obj.id; });
      if (builtinExists || customExists) {
        throw new Error("已存在同 ID 主题「" + obj.id + "」" + (builtinExists ? "（与内置主题冲突）" : "") + "，为避免覆盖已有配置，请更换一个新 ID 再导入");
      }
    }
    var themes = loadAll();
    var record = withDefaults(obj);
    themes.push(record);
    if (!saveAll(themes)) throw new Error("浏览器本地存储失败，主题未保存（可能存储空间不足或被禁用）");
    return record;
  }

  /* BB-R23：删除必须如实报告持久化结果——saveAll 失败时抛错，不返回伪成功 */
  function removeTheme(id) {
    var themes = loadAll();
    var filtered = themes.filter(function (t) { return t.id !== id; });
    if (filtered.length === themes.length) return false;
    if (!saveAll(filtered)) throw new Error("浏览器本地存储写入失败，主题未删除");
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

    // 自定义覆盖（同 key 优先；addTheme 已拒绝与内置同 ID，此处仅兼容历史数据）
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
     AI 提示词（示例为合法 JSON，字段说明在示例之外，无注释）
     ================================================================ */

  function buildPrompt() {
    var fontList = validFontKeys().map(function (k) {
      var f = C.FONTS[k]; return "- " + k + "（" + (f ? f.label : k) + "）";
    }).join("\n");

    return [
      "你是一位 UI 配色专家。请为「Only-box 活动宣传长条排版工具」设计一套主题配色方案。",
      "只输出一段纯 JSON：不要 markdown 代码块标记，不要解释文字，不要注释，不要尾逗号。",
      "",
      "JSON 格式如下：",
      "{",
      '  "id": "my-theme",',
      '  "label": "我的主题",',
      '  "primary": "#1e7a4f",',
      '  "primaryDark": "#124f30",',
      '  "primarySoft": "#e4f2ea",',
      '  "accent": "#f2704b",',
      '  "accentSoft": "#fdeae2",',
      '  "line": "#cfe3d6",',
      '  "soft": "#edf4ee",',
      '  "cardStyle": "card",',
      '  "radius": 23,',
      '  "shadow": "soft",',
      '  "divider": "wave",',
      '  "chips": "pill",',
      '  "titleDecor": "none",',
      '  "pattern": "none",',
      '  "avatarStyle": "none",',
      '  "ink": "#2b2f2a",',
      '  "muted": "#6a706c",',
      '  "headingWeight": 800,',
      '  "bodyWeight": 400,',
      '  "lineHeight": 1,',
      '  "letterSpacing": 0,',
      '  "typeScale": 1,',
      '  "h1Scale": 1,',
      '  "h2Scale": 1,',
      '  "h3Scale": 1,',
      '  "bodyScale": 1,',
      '  "captionScale": 1,',
      '  "headingFont": "",',
      '  "bodyFont": ""',
      "}",
      "",
      "字段说明（除 id、label 与 7 个颜色外均为可选，不写则使用默认值）：",
      "- id：唯一标识，小写字母开头，可含数字、下划线、短横线（如 sunset-glow）；不要与现有主题重名",
      "- label：显示名称，中英文均可（如「日落辉光」）",
      "- primary：主色，用于按钮/选中态/边框；primaryDark：深主色，用于标题/强调/深底；primarySoft：浅主色，用于卡片底色/浅区",
      "- accent：强调色，用于价格/高亮/小点缀；accentSoft：浅强调色，用于标签底",
      "- line：线色，用于分隔线/边框/输入框；soft：软底，用于工具栏底/空状态",
      "- cardStyle：卡片骨架，可选 card / panel / glass / ticket / sticker / ink",
      "- radius：默认卡片圆角，0-100 的数字",
      "- shadow：阴影，可选 soft / hard / glow / none",
      "- divider：默认分割线，可选 wave / dots / line / glitch / thread / dashed",
      "- chips：标签块形状，可选 pill / squared / tag",
      "- titleDecor：大标题装饰，可选 none / bar / bracket / stitch / kicker",
      "- pattern：页面底纹，可选 none / grid / dots / stripes / paper / noise",
      "- avatarStyle：头像装饰（作用于演出阵容头像），可选 none / ring / glow / badge / frame / polaroid",
      "- ink：正文墨色（大段文字颜色）；muted：弱化说明色（图注/辅助信息），均为 #RRGGBB",
      "- headingWeight：标题字重，只能为 400 / 500 / 600 / 700 / 800 / 900；bodyWeight：正文字重，同档位",
      "- lineHeight：全局行距缩放倍率，0.8-2、步进 0.05（1=不缩放）",
      "- letterSpacing：全局字距（像素），-2 到 8、步进 0.5",
      "- typeScale：全局字号缩放，0.7-1.5、步进 0.05",
      "- h1Scale / h2Scale / h3Scale / bodyScale / captionScale：各级字号缩放，0.7-1.3、步进 0.05",
      "- headingFont / bodyFont：可选字体键，留空跟随全局。可用字体：",
      fontList,
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
    /* 大小上限：与整份长条协议一致，阻断超大粘贴导致解析冻结 */
    if (raw.length > 1048576) return null;
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
    /* getter：字体导入后提示词实时包含新字体清单 */
    get promptText() { return buildPrompt(); },
    STYLE_DEFAULTS: STYLE_DEFAULTS,
  });

})(window);

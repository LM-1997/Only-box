(function (global) {
  "use strict";

  const CANVAS_PRESETS = {
    "9:16": { pageWidth: 750, pageHeight: 1334 },
    "3:4": { pageWidth: 750, pageHeight: 1000 },
  };
  const DEFAULT_RATIO = "9:16";
  const TYPE_SCALE = {
    h1: { fontScale: 65 / 750, weight: 700 },
    h2: { fontScale: 48 / 750, weight: 700 },
    h3: { fontScale: 35 / 750, weight: 600 },
    body: { fontScale: 29 / 750, weight: 400 },
    caption: { fontScale: 23 / 750, weight: 400 },
  };
  const CAPTION_MIN_PX_WARNING = 18;

  /* 文档级主题配色：切主题覆盖画布内主色/强调色/线色/浅底变量（line 供边框与分隔线，soft 供卡片空底）。 */
  const THEMES = global.BannerBuilderBuiltinThemes || {};

  /* 风格合并器：颜色字段直出，形状字段缺省回落（旧草稿/新增主题兼容）。
     排版字段（ink/muted 文字色、headingWeight/bodyWeight 字重、lineHeight 行距、
     letterSpacing 字距、typeScale 全局字号缩放、h1Scale..captionScale 逐层字号缩放）
     与颜色/形状同层：AI 可直接生成、步骤 1 可覆盖、未设走默认值。 */
  const STYLE_DEFAULTS = {
    cardStyle: "card", radius: 13, shadow: "soft", divider: "wave", chips: "pill", titleDecor: "none", pattern: "none", avatarStyle: "none", headingFont: "", bodyFont: "",
    ink: "#20251f", muted: "#6a706c", headingWeight: 800, bodyWeight: 400, lineHeight: 1, letterSpacing: 0, typeScale: 1,
    h1Scale: 1, h2Scale: 1, h3Scale: 1, bodyScale: 1, captionScale: 1,
  };
  function normalizeTheme(theme) {
    const t = theme || THEMES.forest || {};
    const out = {};
    Object.keys(STYLE_DEFAULTS).forEach(function (k) { out[k] = t[k] != null ? t[k] : STYLE_DEFAULTS[k]; });
    Object.keys(t).forEach(function (k) { if (!(k in out)) out[k] = t[k]; });
    return out;
  }
  function themeStyle(key) {
    var importer = global.BannerBuilderThemeImporter;
    var merged = THEMES;
    if (importer && typeof importer.mergeAll === "function") {
      merged = importer.mergeAll();
    }
    return normalizeTheme(merged[key] || merged.forest || THEMES.forest);
  }
  /* 草稿 v3 可携带文档级主题定义。只在 id 与当前 theme 一致时使用，
     避免换浏览器后依赖 localStorage，也避免同 ID 的本地主题覆盖草稿原貌。 */
  function themeStyleForDoc(doc) {
    const embedded = doc && doc.themeDefinition;
    if (embedded && typeof embedded === "object" && !Array.isArray(embedded) && embedded.id === doc.theme) {
      return normalizeTheme(embedded);
    }
    return themeStyle(doc && doc.theme);
  }

  /* 文档级字体：从统一字体清单 data/fonts.js（window.OnlyBoxFonts）派生，与 badge-generator 共用一份清单。
     清单只存元数据 + CDN 直链（授权与直链由 scripts/font-catalog-check.js 校验）；
     FONTS 保留旧 key（legacyKeys）映射，旧草稿里的 sans/serif/kai/... 等键值继续有效。
     family 必须与上游 @font-face 声明一致；css 数组按字重列出，全部注入后任意字重档位都可用真实字形渲染。
     注意：官方"免费商用但禁止第三方再分发"的字体（阿里妈妈数黑体/东方大楷、钉钉进步体、方正免费系列等）
     不进清单，用户可从官网下载后用「导入字体」上传（见 docs/fonts-catalog.md 的 excluded 说明）。 */
  const CATALOG = global.OnlyBoxFonts && Array.isArray(global.OnlyBoxFonts.fonts) ? global.OnlyBoxFonts.fonts : [];
  const FONTS = {};
  const FONT_DOWNLOADS = {};
  CATALOG.forEach(function (font) {
    const keys = (font.legacyKeys && font.legacyKeys.length) ? font.legacyKeys : [font.id];
    const load = font.load || {};
    const entry = { label: font.name || font.nameEn || font.family, family: font.family, category: font.category || "" };
    if (Array.isArray(font.weights)) entry.weights = font.weights.slice();
    if (Array.isArray(font.languages)) entry.languages = font.languages.slice();
    if (Array.isArray(load.css)) entry.css = load.css.slice();
    else if (load.css) entry.css = Object.keys(load.css).sort(function (a, b) { return Number(a) - Number(b); }).map(function (w) { return load.css[w]; });
    if (load.faces) entry.src = load.faces.map(function (s) { return { url: s.url, format: s.format || "truetype", weight: s.weight || 400 }; });
    keys.forEach(function (key) {
      if (FONTS[key]) return; /* 多 legacyKey 指向同一条目时只登记一次 */
      FONTS[key] = entry;
      if (font.desktop && font.desktop.url) {
      const dl = { url: font.desktop.url, name: font.desktop.name };
      if (font.desktop.weights && typeof font.desktop.weights === "object") dl.weights = font.desktop.weights;
      FONT_DOWNLOADS[key] = dl;
    }
    });
  });
  /* CSS 字符串安全化：family/url 来自字体清单、字体文件 name 表或用户文件名（均属不可信输入），
     统一去除引号/反斜杠/花括号/尖括号/反引号与控制字符，阻断向 @font-face 样式表注入任意 CSS 的路径 */
  function safeCssToken(value) {
    return String(value == null ? "" : value)
      .replace(/["'\\{}<>`]/g, "")
      .replace(/[\r\n\t\u0000-\u001f]/g, " ")
      .trim();
  }
  /* 单字体文件源（src 数组）合成 @font-face；css 源走独立 <link> 注入通道，此处返回空。
     单档展示字体按 100-900 全字重登记（与旧行为一致），避免标题 800/900 触发伪粗合成破坏字形；
     多档字重文件则逐档登记真实 font-weight，浏览器按最近档位匹配、不再合成。 */
  function fontFaceFor(f) {
    if (!f || !Array.isArray(f.src) || !f.src.length) return "";
    if (f.src.length === 1) {
      const s = f.src[0];
      return '@font-face{font-family:"' + safeCssToken(f.family) + '";font-style:normal;font-display:swap;font-weight:100 900;src:url("' + safeCssToken(s.url) + '") format("' + safeCssToken(s.format || "truetype") + '");}';
    }
    return f.src.map(function (s) {
      return '@font-face{font-family:"' + safeCssToken(f.family) + '";font-style:normal;font-display:swap;font-weight:' + (Number(s.weight) || 400) + ';src:url("' + safeCssToken(s.url) + '") format("' + safeCssToken(s.format || "truetype") + '");}';
    }).join("\n");
  }
  /* 按清单 category 回落系统字体栈（在线字体加载失败时保底，尽量保持字形气质）。 */
  function fontFallback(category) {
    if (category === "宋体") return "'Songti SC','SimSun',serif";
    if (category === "楷体" || category === "手写") return "'KaiTi','STKaiti',serif";
    if (category === "圆体") return "'Yuanti SC','Microsoft YaHei',sans-serif";
    if (category === "等宽") return "Consolas,'Courier New',monospace";
    if (category === "展示" || category === "艺术体") return "'Arial Black','Microsoft YaHei',sans-serif";
    return "'Microsoft YaHei',sans-serif";
  }
  /* 语言适配回退（方案 §1.2）：繁中/日文字体的汉字与假名先落对应语言系统字体，
     避免回落到简体 Microsoft YaHei 造成字形气质断裂（假名→简体黑体）。 */
  function languageFallback(f) {
    const langs = (f && f.languages) || [];
    if (langs.indexOf("ja") >= 0) return "'Hiragino Kaku Gothic ProN','Yu Gothic','Meiryo'";
    if (langs.indexOf("zh-Hant") >= 0) return "'PingFang TC','Microsoft JhengHei'";
    return "";
  }
  function fontStack(key) {
    const f = FONTS[key] || FONTS.sans;
    const lang = languageFallback(f);
    return '"' + safeCssToken(f.family) + '",' + (lang ? lang + "," : "") + fontFallback(f.category);
  }
  /* 分角色字体栈（审计 P7 配套）：headingFontStack 用于主/板块标题与醒目数字，
     bodyFontStack 用于正文、说明、图注；两者可独立设置。 */
  function headingFontStack(doc) {
    const key = (doc && doc.headingFont) || (doc && doc.fontFamily) || "sans";
    return fontStack(key);
  }
  function bodyFontStack(doc) {
    const headingKey = (doc && doc.headingFont) || (doc && doc.fontFamily) || "sans";
    const bodyKey = (doc && doc.bodyFont) || headingKey;
    if (bodyKey === headingKey) return fontStack(headingKey);
    return fontStack(bodyKey);
  }

  function optionList(map) {
    return Object.keys(map).map(function (key) { return { value: key, label: map[key].label }; });
  }
  /* 字体选项（动态）：FONTS 可被字体导入模块运行时扩充，故每次调用重新枚举，
     保证「用户导入字体」即时出现在全局/标题/正文三个下拉中。 */
  function getFontOptions() {
    return optionList(FONTS);
  }

  function pageSize(ratio) {
    return CANVAS_PRESETS[ratio] || CANVAS_PRESETS[DEFAULT_RATIO];
  }

  function fontSizePx(level, pageWidth) {
    const scale = TYPE_SCALE[level] || TYPE_SCALE.body;
    return Math.round(pageWidth * scale.fontScale);
  }

  function captionWarning(level, pageWidth) {
    const px = fontSizePx(level, pageWidth);
    return px < CAPTION_MIN_PX_WARNING
      ? "当前层级换算字号约 " + px + "px，低于 " + CAPTION_MIN_PX_WARNING + "px，小屏与压缩后可能看不清。"
      : "";
  }

  /* 字重吸附（方案 §2.2）：在字体实际档位里取离 target 最近的档（同差取大）。
     请求 800：LXGW WenKai(300-700)→700，Noto Sans SC(含800)→800。
     预览与导出走同一函数，杜绝伪粗合成导致的两侧不一致。 */
  function snapWeight(font, target) {
    const target2 = Math.round(Number(target) || 400);
    const weights = (font && Array.isArray(font.weights) && font.weights.length) ? font.weights.map(Number)
      : [400, 500, 600, 700, 800, 900].filter(function (w) { return w <= Math.max(400, Math.min(900, Math.round(target2 / 100) * 100)); }).slice(-1);
    let best = weights[0];
    for (let i = 1; i < weights.length; i += 1) {
      const d = Math.abs(weights[i] - target2), bd = Math.abs(best - target2);
      if (d < bd || (d === bd && weights[i] > best)) best = weights[i];
    }
    return best;
  }

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function getThemeOptions() {
    var importer = global.BannerBuilderThemeImporter;
    if (importer && typeof importer.mergeAll === "function") {
      return optionList(importer.mergeAll());
    }
    return optionList(THEMES);
  }

  global.BannerBuilderConstants = Object.freeze({
    CANVAS_PRESETS,
    DEFAULT_RATIO,
    TYPE_SCALE,
    CAPTION_MIN_PX_WARNING,
    THEMES,
    FONTS,
    FONT_DOWNLOADS,
    STYLE_DEFAULTS,
    THEME_OPTIONS: optionList(THEMES),
    getThemeOptions: getThemeOptions,
    FONT_OPTIONS: optionList(FONTS),
    getFontOptions: getFontOptions,
    ROLE_FONT_OPTIONS: [
      { value: "", label: "跟随全局字体" },
      { value: "heading", label: "标题字体" },
      { value: "body", label: "正文字体" },
    ],
    pageSize,
    snapWeight,
    fontSizePx,
    captionWarning,
    uid,
    fontStack,
    safeCssToken,
    headingFontStack,
    bodyFontStack,
    fontFaceFor,
    themeStyle,
    themeStyleForDoc,
  });
})(window);

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
  const THEMES = {
    forest: { label: "森林绿", primary: "#1e7a4f", primaryDark: "#124f30", primarySoft: "#e4f2ea", accent: "#f2704b", accentSoft: "#fdeae2", line: "#cfe3d6", soft: "#edf4ee", cardStyle: "card", radius: 23, shadow: "soft", divider: "wave", chips: "pill", titleDecor: "none", pattern: "none", headingFont: "", bodyFont: "" },
    sakura: { label: "樱花粉紫", primary: "#b8437e", primaryDark: "#7e2a58", primarySoft: "#f7e4ee", accent: "#7a5bd8", accentSoft: "#ece5fb", line: "#e9d2e0", soft: "#faeef5", cardStyle: "sticker", radius: 29, shadow: "soft", divider: "wave", chips: "pill", titleDecor: "none", pattern: "dots", headingFont: "rounded", bodyFont: "" },
    ocean: { label: "海蓝", primary: "#1f6fb2", primaryDark: "#124d7e", primarySoft: "#e2eef9", accent: "#f59a3c", accentSoft: "#fdf0e0", line: "#cfe2f2", soft: "#eaf3fb", cardStyle: "card", radius: 23, shadow: "soft", divider: "line", chips: "pill", titleDecor: "bar", pattern: "none", headingFont: "", bodyFont: "" },
    sunset: { label: "落日橙", primary: "#cf6a26", primaryDark: "#9c4313", primarySoft: "#f9ecdf", accent: "#d6453d", accentSoft: "#fbe4e1", line: "#efd8c4", soft: "#fbf0e6", cardStyle: "glass", radius: 32, shadow: "soft", divider: "wave", chips: "pill", titleDecor: "none", pattern: "stripes", headingFont: "", bodyFont: "" },
    mono: { label: "黑白极简", primary: "#373d44", primaryDark: "#14171a", primarySoft: "#eceff1", accent: "#e5484d", accentSoft: "#fbe7e8", line: "#d7dbe0", soft: "#f1f2f4", cardStyle: "panel", radius: 0, shadow: "hard", divider: "line", chips: "squared", titleDecor: "bar", pattern: "grid", headingFont: "bebas", bodyFont: "lato" },
    aurora: { label: "极光紫蓝", primary: "#5a5fd8", primaryDark: "#32349a", primarySoft: "#e9e9fa", accent: "#2fa8a0", accentSoft: "#e0f4f2", line: "#d5d6ef", soft: "#f1f1fb", cardStyle: "glass", radius: 32, shadow: "glow", divider: "wave", chips: "pill", titleDecor: "none", pattern: "none", headingFont: "poppins", bodyFont: "" },
    candy: { label: "糖果派对", primary: "#ef5da8", primaryDark: "#b32d74", primarySoft: "#fdeaf4", accent: "#8f6ee8", accentSoft: "#efeaff", line: "#f3d3e2", soft: "#fbf1f6", cardStyle: "sticker", radius: 32, shadow: "soft", divider: "dots", chips: "pill", titleDecor: "none", pattern: "dots", headingFont: "rounded", bodyFont: "" },
    cyber: { label: "赛博霓虹", primary: "#8a2be2", primaryDark: "#571a9c", primarySoft: "#f0e6fb", accent: "#00b3a4", accentSoft: "#dff5f2", line: "#ddd2f0", soft: "#f6f1fb", cardStyle: "panel", radius: 0, shadow: "glow", divider: "glitch", chips: "squared", titleDecor: "bar", pattern: "grid", headingFont: "grotesk", bodyFont: "robotoCond" },
    midnight: { label: "午夜蓝", primary: "#2f56a4", primaryDark: "#1b3570", primarySoft: "#e2e9f6", accent: "#e8993e", accentSoft: "#fbeeda", line: "#d0dcef", soft: "#eef2fa", cardStyle: "panel", radius: 7, shadow: "hard", divider: "line", chips: "squared", titleDecor: "bar", pattern: "none", headingFont: "oswald", bodyFont: "lato" },
    crimson: { label: "中国红金", primary: "#c0392b", primaryDark: "#8c1f14", primarySoft: "#fbe7e3", accent: "#c9a227", accentSoft: "#f8f0d9", line: "#eccdc7", soft: "#faf0ee", cardStyle: "ticket", radius: 18, shadow: "soft", divider: "dashed", chips: "tag", titleDecor: "bracket", pattern: "none", headingFont: "qingke", bodyFont: "" },
    ink: { label: "水墨青灰", primary: "#3f5c66", primaryDark: "#243b42", primarySoft: "#e8eef0", accent: "#c05b3c", accentSoft: "#f8e6df", line: "#cdd9dc", soft: "#f2f5f5", cardStyle: "ink", radius: 11, shadow: "soft", divider: "thread", chips: "pill", titleDecor: "bracket", pattern: "paper", headingFont: "xiaowei", bodyFont: "kai" },
    matcha: { label: "抹茶绿", primary: "#5f8f4a", primaryDark: "#3c6130", primarySoft: "#ebf3e4", accent: "#c47a3c", accentSoft: "#f8ecdf", line: "#d3e2c8", soft: "#f3f7ef", cardStyle: "ink", radius: 14, shadow: "soft", divider: "dots", chips: "pill", titleDecor: "stitch", pattern: "paper", headingFont: "xiaowei", bodyFont: "kai" },
    peach: { label: "蜜桃乌龙", primary: "#e2715a", primaryDark: "#ab432f", primarySoft: "#fdebe4", accent: "#7f6fd0", accentSoft: "#eeeafb", line: "#f0cfc4", soft: "#fbf2ee", cardStyle: "glass", radius: 36, shadow: "soft", divider: "wave", chips: "pill", titleDecor: "none", pattern: "none", headingFont: "", bodyFont: "" },
    lavender: { label: "薰衣草紫", primary: "#7c6fc0", primaryDark: "#55479b", primarySoft: "#efecfa", accent: "#e08a5e", accentSoft: "#fbece2", line: "#ddd7f0", soft: "#f6f4fb", cardStyle: "card", radius: 29, shadow: "soft", divider: "thread", chips: "pill", titleDecor: "stitch", pattern: "none", headingFont: "playfair", bodyFont: "" },
    mint: { label: "薄荷青", primary: "#1f9d8e", primaryDark: "#0f6b60", primarySoft: "#e1f3ef", accent: "#f2a03d", accentSoft: "#fdf0dd", line: "#c9e7e0", soft: "#f0f8f5", cardStyle: "card", radius: 18, shadow: "soft", divider: "dots", chips: "squared", titleDecor: "none", pattern: "dots", headingFont: "montserrat", bodyFont: "" },
    desert: { label: "沙漠落日", primary: "#b5703e", primaryDark: "#7f471f", primarySoft: "#f7ecdf", accent: "#4a8572", accentSoft: "#e3f0ea", line: "#ecdcc8", soft: "#faf4ec", cardStyle: "ticket", radius: 14, shadow: "hard", divider: "dashed", chips: "tag", titleDecor: "bar", pattern: "stripes", headingFont: "abril", bodyFont: "" },
    noir: { label: "黑金质感", primary: "#46403a", primaryDark: "#262119", primarySoft: "#efede8", accent: "#c2a024", accentSoft: "#f6efd8", line: "#d9d4ca", soft: "#f4f2ed", cardStyle: "panel", radius: 4, shadow: "hard", divider: "line", chips: "squared", titleDecor: "bar", pattern: "noise", headingFont: "playfair", bodyFont: "lato" },
    grape: { label: "葡萄汽水", primary: "#7b52a8", primaryDark: "#4f2f77", primarySoft: "#f0e9f8", accent: "#e5567c", accentSoft: "#fde8ee", line: "#dccfee", soft: "#f7f3fb", cardStyle: "sticker", radius: 32, shadow: "soft", divider: "wave", chips: "pill", titleDecor: "none", pattern: "dots", headingFont: "rounded", bodyFont: "" },
    berry: { label: "树莓冰茶", primary: "#a4356f", primaryDark: "#6f1f4a", primarySoft: "#f9e7f0", accent: "#3f7fa8", accentSoft: "#e6f1f7", line: "#e5c7d8", soft: "#faf1f6", cardStyle: "glass", radius: 25, shadow: "soft", divider: "dots", chips: "pill", titleDecor: "none", pattern: "none", headingFont: "poppins", bodyFont: "" },
  };

  /* 风格合并器：颜色字段直出，形状字段缺省回落（旧草稿/新增主题兼容）。 */
  const STYLE_DEFAULTS = { cardStyle: "card", radius: 13, shadow: "soft", divider: "wave", chips: "pill", titleDecor: "none", pattern: "none", headingFont: "", bodyFont: "" };
  function themeStyle(key) {
    var importer = global.BannerBuilderThemeImporter;
    var merged = THEMES;
    if (importer && typeof importer.mergeAll === "function") {
      merged = importer.mergeAll();
    }
    const t = merged[key] || merged.forest || THEMES.forest;
    const out = {};
    Object.keys(STYLE_DEFAULTS).forEach(function (k) { out[k] = t[k] != null ? t[k] : STYLE_DEFAULTS[k]; });
    Object.keys(t).forEach(function (k) { if (!(k in out)) out[k] = t[k]; });
    return out;
  }

  /* 文档级字体：全部为免费可商用字体（SIL OFL / 官方免费授权），经 jsDelivr 在线加载 @fontsource 分包。
     family 必须与 @fontsource css 内 @font-face 声明的字体名一致；css 数组按字重列出。
     标题（标题字体）与大标题/板块标题/醒目数字同栈，正文（正文字体）用于正文/说明/图注。 */
  const FONTS = {
    sans: { label: "思源黑体（可商用）", family: "Noto Sans SC", css: ["https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/500.css", "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/700.css", "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/900.css"] },
    serif: { label: "思源宋体（可商用）", family: "Noto Serif SC", css: ["https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5/600.css", "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5/700.css"] },
    kai: { label: "霞鹜文楷（可商用）", family: "LXGW WenKai", css: ["https://cdn.jsdelivr.net/npm/@fontsource/lxgw-wenkai@5/index.css", "https://cdn.jsdelivr.net/npm/@fontsource/lxgw-wenkai@5/700.css"] },
    rounded: { label: "站酷快乐体（可商用）", family: "ZCOOL KuaiLe", css: ["https://cdn.jsdelivr.net/npm/@fontsource/zcool-kuaile@5/index.css"] },
    xiaowei: { label: "站酷小薇（可商用）", family: "ZCOOL XiaoWei", css: ["https://cdn.jsdelivr.net/npm/@fontsource/zcool-xiaowei@5/index.css"] },
    qingke: { label: "站酷庆科黄油体（可商用）", family: "ZCOOL QingKe HuangYou", css: ["https://cdn.jsdelivr.net/npm/@fontsource/zcool-qingke-huangyou@5/index.css"] },
    mashanzheng: { label: "马善政毛笔楷书", family: "Ma Shan Zheng", css: ["https://cdn.jsdelivr.net/npm/@fontsource/ma-shan-zheng@5/index.css"] },
    longcang: { label: "龙藏体（手写）", family: "Long Cang", css: ["https://cdn.jsdelivr.net/npm/@fontsource/long-cang@5/index.css"] },
    zhimangxing: { label: "志莽行书（手写）", family: "Zhi Mang Xing", css: ["https://cdn.jsdelivr.net/npm/@fontsource/zhi-mang-xing@5/index.css"] },
    liujianmaocao: { label: "柳建草书（手写）", family: "Liu Jian Mao Cao", css: ["https://cdn.jsdelivr.net/npm/@fontsource/liu-jian-mao-cao@5/index.css"] },
    poppins: { label: "Poppins（几何无衬线）", family: "Poppins", css: ["https://cdn.jsdelivr.net/npm/@fontsource/poppins@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/poppins@5/500.css", "https://cdn.jsdelivr.net/npm/@fontsource/poppins@5/600.css", "https://cdn.jsdelivr.net/npm/@fontsource/poppins@5/700.css"] },
    montserrat: { label: "Montserrat（现代无衬线）", family: "Montserrat", css: ["https://cdn.jsdelivr.net/npm/@fontsource/montserrat@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/montserrat@5/600.css", "https://cdn.jsdelivr.net/npm/@fontsource/montserrat@5/700.css", "https://cdn.jsdelivr.net/npm/@fontsource/montserrat@5/900.css"] },
    oswald: { label: "Oswald（窄体标题）", family: "Oswald", css: ["https://cdn.jsdelivr.net/npm/@fontsource/oswald@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/oswald@5/500.css", "https://cdn.jsdelivr.net/npm/@fontsource/oswald@5/600.css", "https://cdn.jsdelivr.net/npm/@fontsource/oswald@5/700.css"] },
    bebas: { label: "Bebas Neue（海报标题）", family: "Bebas Neue", css: ["https://cdn.jsdelivr.net/npm/@fontsource/bebas-neue@5/index.css"] },
    playfair: { label: "Playfair Display（衬线标题）", family: "Playfair Display", css: ["https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5/700.css", "https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5/900.css"] },
    abril: { label: "Abril Fatface（衬线展示）", family: "Abril Fatface", css: ["https://cdn.jsdelivr.net/npm/@fontsource/abril-fatface@5/index.css"] },
    lato: { label: "Lato（清爽无衬线）", family: "Lato", css: ["https://cdn.jsdelivr.net/npm/@fontsource/lato@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/lato@5/700.css", "https://cdn.jsdelivr.net/npm/@fontsource/lato@5/900.css"] },
    grotesk: { label: "Space Grotesk（科技感）", family: "Space Grotesk", css: ["https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5/500.css", "https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5/700.css"] },
    robotoCond: { label: "Roboto Condensed（窄体正文）", family: "Roboto Condensed", css: ["https://cdn.jsdelivr.net/npm/@fontsource/roboto-condensed@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/roboto-condensed@5/700.css"] },
    ubuntu: { label: "Ubuntu（人文无衬线）", family: "Ubuntu", css: ["https://cdn.jsdelivr.net/npm/@fontsource/ubuntu@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/ubuntu@5/500.css", "https://cdn.jsdelivr.net/npm/@fontsource/ubuntu@5/700.css"] },
  };
  /* 桌面字体文件（供「打包字体」下载）：PS 需安装对应 .ttf/.otf 才能正确渲染文字图层。
     来源优先 google/fonts（jsDelivr 镜像，CORS 友好）；思源宋体走 raw.githubusercontent；
     霞鹜文楷走官方 release（部分网络环境下 fetch 可能受限，打包时容错跳过并提示）。 */
  const FONT_DOWNLOADS = {
    sans: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf", name: "NotoSansSC.ttf" },
    serif: { url: "https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf", name: "NotoSerifSC.ttf" },
    kai: { url: "https://github.com/lxgw/LxgwWenKai/releases/download/v1.510/LXGWWenKai-Regular.ttf", name: "LXGWWenKai-Regular.ttf" },
    rounded: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf", name: "ZCOOLKuaiLe-Regular.ttf" },
    xiaowei: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf", name: "ZCOOLXiaoWei-Regular.ttf" },
    qingke: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zcoolqingkehuangyou/ZCOOLQingKeHuangYou-Regular.ttf", name: "ZCOOLQingKeHuangYou-Regular.ttf" },
    mashanzheng: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/mashanzheng/MaShanZheng-Regular.ttf", name: "MaShanZheng-Regular.ttf" },
    longcang: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/longcang/LongCang-Regular.ttf", name: "LongCang-Regular.ttf" },
    zhimangxing: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zhimangxing/ZhiMangXing-Regular.ttf", name: "ZhiMangXing-Regular.ttf" },
    liujianmaocao: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/liujianmaocao/LiuJianMaoCao-Regular.ttf", name: "LiuJianMaoCao-Regular.ttf" },
    poppins: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-Regular.ttf", name: "Poppins-Regular.ttf" },
    montserrat: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/montserrat/Montserrat%5Bwght%5D.ttf", name: "Montserrat-Variable.ttf" },
    oswald: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/oswald/Oswald%5Bwght%5D.ttf", name: "Oswald-Variable.ttf" },
    bebas: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/bebasneue/BebasNeue-Regular.ttf", name: "BebasNeue-Regular.ttf" },
    playfair: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf", name: "PlayfairDisplay-Variable.ttf" },
    abril: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/abrilfatface/AbrilFatface-Regular.ttf", name: "AbrilFatface-Regular.ttf" },
    lato: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lato/Lato-Regular.ttf", name: "Lato-Regular.ttf" },
    grotesk: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf", name: "SpaceGrotesk-Variable.ttf" },
    robotoCond: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/robotocondensed/RobotoCondensed%5Bwght%5D.ttf", name: "RobotoCondensed-Variable.ttf" },
    ubuntu: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ufl/ubuntu/Ubuntu-Regular.ttf", name: "Ubuntu-Regular.ttf" },
  };
  function fontFallback(key) {
    if (key === "serif" || key === "xiaowei" || key === "playfair" || key === "abril") return "'Songti SC',serif";
    if (key === "kai" || key === "mashanzheng" || key === "longcang" || key === "zhimangxing" || key === "liujianmaocao") return "'KaiTi',serif";
    if (key === "rounded" || key === "qingke") return "'Yuanti SC',cursive,sans-serif";
    return "'Microsoft YaHei',sans-serif";
  }
  function fontStack(key) {
    const f = FONTS[key] || FONTS.sans;
    return '"' + f.family + '",' + fontFallback(key);
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
    ROLE_FONT_OPTIONS: [
      { value: "", label: "跟随全局字体" },
      { value: "heading", label: "标题字体" },
      { value: "body", label: "正文字体" },
    ],
    pageSize,
    fontSizePx,
    captionWarning,
    uid,
    fontStack,
    headingFontStack,
    bodyFontStack,
    themeStyle,
  });
})(window);

(function (global) {
  "use strict";

  const CANVAS_PRESETS = {
    "9:16": { pageWidth: 1242, pageHeight: 2208 },
    "3:4": { pageWidth: 1242, pageHeight: 1656 },
  };
  const DEFAULT_RATIO = "9:16";
  const TYPE_SCALE = {
    h1: { fontScale: 96 / 1242, weight: 700 },
    h2: { fontScale: 72 / 1242, weight: 700 },
    h3: { fontScale: 48 / 1242, weight: 600 },
    body: { fontScale: 34 / 1242, weight: 400 },
    caption: { fontScale: 26 / 1242, weight: 400 },
  };
  const CAPTION_MIN_PX_WARNING = 24;

  /* 文档级主题配色：切主题覆盖画布内主色/强调色/线色/浅底变量（line 供边框与分隔线，soft 供卡片空底）。 */
  const THEMES = {
    forest: { label: "森林绿", primary: "#1e7a4f", primaryDark: "#124f30", primarySoft: "#e4f2ea", accent: "#f2704b", accentSoft: "#fdeae2", line: "#cfe3d6", soft: "#edf4ee" },
    sakura: { label: "樱花粉紫", primary: "#b8437e", primaryDark: "#7e2a58", primarySoft: "#f7e4ee", accent: "#7a5bd8", accentSoft: "#ece5fb", line: "#e9d2e0", soft: "#faeef5" },
    ocean: { label: "海蓝", primary: "#1f6fb2", primaryDark: "#124d7e", primarySoft: "#e2eef9", accent: "#f59a3c", accentSoft: "#fdf0e0", line: "#cfe2f2", soft: "#eaf3fb" },
    sunset: { label: "落日橙", primary: "#cf6a26", primaryDark: "#9c4313", primarySoft: "#f9ecdf", accent: "#d6453d", accentSoft: "#fbe4e1", line: "#efd8c4", soft: "#fbf0e6" },
    mono: { label: "黑白极简", primary: "#373d44", primaryDark: "#14171a", primarySoft: "#eceff1", accent: "#e5484d", accentSoft: "#fbe7e8", line: "#d7dbe0", soft: "#f1f2f4" },
  };

  /* 文档级字体：全部为免费可商用字体（SIL OFL / 官方免费授权），经 jsDelivr 在线加载 @fontsource 分包。
     family 必须与 @fontsource css 内 @font-face 声明的字体名一致；css 数组按字重列出。 */
  const FONTS = {
    sans: { label: "思源黑体（可商用）", family: "Noto Sans SC", css: ["https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/500.css", "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/700.css", "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/900.css"] },
    serif: { label: "思源宋体（可商用）", family: "Noto Serif SC", css: ["https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5/400.css", "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5/600.css", "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5/700.css"] },
    kai: { label: "霞鹜文楷（可商用）", family: "LXGW WenKai", css: ["https://cdn.jsdelivr.net/npm/@fontsource/lxgw-wenkai@5/index.css", "https://cdn.jsdelivr.net/npm/@fontsource/lxgw-wenkai@5/700.css"] },
    rounded: { label: "站酷快乐体（可商用）", family: "ZCOOL KuaiLe", css: ["https://cdn.jsdelivr.net/npm/@fontsource/zcool-kuaile@5/index.css"] },
  };
  function fontStack(key) {
    const f = FONTS[key] || FONTS.sans;
    const fallback = key === "serif" ? "'Songti SC',serif" : key === "kai" ? "'KaiTi',serif" : key === "rounded" ? "'Yuanti SC',cursive,sans-serif" : "'Microsoft YaHei',sans-serif";
    return '"' + f.family + '",' + fallback;
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

  global.BannerBuilderConstants = Object.freeze({
    CANVAS_PRESETS,
    DEFAULT_RATIO,
    TYPE_SCALE,
    CAPTION_MIN_PX_WARNING,
    THEMES,
    FONTS,
    THEME_OPTIONS: optionList(THEMES),
    FONT_OPTIONS: optionList(FONTS),
    pageSize,
    fontSizePx,
    captionWarning,
    uid,
    fontStack,
  });
})(window);

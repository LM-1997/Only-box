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
    /* ===== 用户追加字体（混合源：css=fontsource 分片 / src=单字体文件自建 @font-face） ===== */
    /* 本地字体 family 以字体文件 name 表实测为准（fonts/ 目录随仓库分发）：
       - 阿里妈妈数黑体：Alimama ShuHeiTi（OTF）同族，先 CDN woff2 后本地 OTF 兜底
       - Metal Mania：OFL，走 @fontsource CDN（本地也有副本，无需额外登记）
       - 标小智无界黑：OTF 家族名「LogoSC Unbounded Sans」、TTF 常规家族名「Unbounded Sans」，两者并存
       - Helvetica「黑窄版」：name 表家族名为「HelveticaNeue LT 97 BlackCn」 */
    shuheiti: { label: "阿里妈妈数黑体", family: "Alimama ShuHeiTi", src: [{ url: "https://cdn.jsdelivr.net/npm/@fontpkg/alimama-shu-hei-ti@1.0.5/AlimamaShuHeiTi-Bold.woff2", format: "woff2" }, { url: "../fonts/AlimamaShuHeiTi-Bold.otf", format: "opentype" }] },
    metalmania: { label: "Metal Mania（重金属）", family: "Metal Mania", css: ["https://cdn.jsdelivr.net/npm/@fontsource/metal-mania@5/index.css"] },
    logosc: { label: "标小智无界黑", family: "LogoSC Unbounded Sans", src: [{ url: "../fonts/LogoSCUnboundedSans.otf", format: "opentype" }] },
    logosc_regular: { label: "标小智无界黑（常规）", family: "Unbounded Sans", src: [{ url: "../fonts/LogoSCUnboundedSans-Regular.ttf", format: "truetype" }] },
    helveticalt: { label: "Helvetica 黑窄体加粗", family: "HelveticaNeue LT 97 BlackCn", src: [{ url: "../fonts/Helvetica LT 97 Black Condensed.ttf", format: "truetype" }] },
  };

  /* 单字体文件源（src 数组）合成 @font-face；css 源走独立 <link> 注入通道，此处返回空。
     单文件展示字体按 100-900 全字重登记，避免各层级 700/800/900 触发伪粗合成破坏字形。 */
  function fontFaceFor(f) {
    if (!f || !Array.isArray(f.src) || !f.src.length) return "";
    const parts = f.src.map(function (s) {
      return 'url("' + s.url + '") format("' + (s.format || "truetype") + '")';
    }).join(", ");
    return '@font-face{font-family:"' + f.family + '";font-style:normal;font-display:swap;font-weight:100 900;src:' + parts + ';}';
  }
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
    shuheiti: { url: "https://cdn.jsdelivr.net/npm/@fontpkg/alimama-shu-hei-ti@1.0.5/AlimamaShuHeiTi-Bold.ttf", name: "AlimamaShuHeiTi-Bold.ttf" },
    metalmania: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/metalmania/MetalMania-Regular.ttf", name: "MetalMania-Regular.ttf" },
    logosc: { url: "", name: "LogoSCUnboundedSans.otf" },
    logosc_regular: { url: "", name: "LogoSCUnboundedSans-Regular.ttf" },
    helveticalt: { url: "", name: "Helvetica LT 97 Black Condensed.ttf" },
  };
  /* 本地字体（src 为相对路径、无 css 源）的打包策略：FONT_DOWNLOADS.url 留空表示
     无需联网下载，而是提示用户手动安装（本地字体已随仓库/用户机器存在）。 */
  function fontFallback(key) {
    if (key === "serif" || key === "xiaowei" || key === "playfair" || key === "abril") return "'Songti SC',serif";
    if (key === "kai" || key === "mashanzheng" || key === "longcang" || key === "zhimangxing" || key === "liujianmaocao") return "'KaiTi',serif";
    if (key === "rounded" || key === "qingke") return "'Yuanti SC',cursive,sans-serif";
    if (key === "shuheiti" || key === "metalmania" || key === "logosc" || key === "logosc_regular" || key === "helveticalt") return "'Microsoft YaHei',sans-serif";
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
    fontSizePx,
    captionWarning,
    uid,
    fontStack,
    headingFontStack,
    bodyFontStack,
    fontFaceFor,
    themeStyle,
  });
})(window);

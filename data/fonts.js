/* data/fonts.js —— Only-box 内置开源字体清单（唯一数据源）
 *
 * 原则：只维护"元数据 + CDN 直链"，不搬运字体文件本身。
 * 字体文件的实际托管、分发、授权合规由上游项目负责（FontSource / cn-fontsource / 字体官方仓库）。
 * 每款字体入库前必须人工核实官方授权页（licenseUrl），聚合站标注仅作参考不作为最终依据。
 * 维护：运行 `node scripts/font-catalog-check.js` 校验全部直链可用性并对比上游新增（输出 diff，不自动写入本文件）。
 *
 * 字段说明：
 * - id          唯一标识（kebab-case）
 * - family      CSS font-family 名，必须与上游 @font-face 声明一致（canvas 绘制/导出都依赖它）
 * - name/nameEn 中英文名
 * - category    分类（黑体/宋体/楷体/圆体/仿宋/手写/艺术体/展示/等宽）
 * - languages   语言覆盖：zh-Hans 简体中文 / zh-Hant 繁体中文 / ja 日文 / en 英文
 * - weights     实际可加载的字重档位（升序，不得虚构上游不存在的字重）
 * - load.css    上游整包 CSS（内含按字重+unicode-range 切分的 @font-face），直接 <link> 注入
 * - load.faces  单字体文件源（自建 @font-face，每档字重一条）
 * - desktop     桌面字体文件（banner-builder「打包字体」下载用，可选）
 * - license / licenseUrl  授权名 + 官方授权页（必须可追溯）
 * - sourceProject  CDN 来源项目
 * - popularityRank 排序（1 = 最高优先级；选择器默认预加载 rank ≤ 20）
 * - legacyKeys  历史草稿兼容：banner-builder 旧配置里的字体 key 映射到本条目
 */

(function (global) {
  "use strict";

  var FONTSOURCE = function (pkg, weights) {
    var load = {};
    weights.forEach(function (w) {
      load[String(w)] = w === 400
        ? "https://cdn.jsdelivr.net/npm/@fontsource/" + pkg + "@5/index.css"
        : "https://cdn.jsdelivr.net/npm/@fontsource/" + pkg + "@5/" + w + ".css";
    });
    return { css: load };
  };
  var GFOFL = function (folder) { return "https://github.com/google/fonts/tree/main/ofl/" + folder; };

  global.OnlyBoxFonts = {
    version: "2026-09-15",
    fonts: [
      /* ================= 简体中文 ================= */
      {
        id: "noto-sans-sc", family: "Noto Sans SC", name: "思源黑体", nameEn: "Source Han Sans SC",
        category: "黑体", languages: ["zh-Hans", "en"], weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("notosanssc"), sourceProject: "FontSource",
        popularityRank: 1, legacyKeys: ["sans"],
        load: FONTSOURCE("noto-sans-sc", [100, 200, 300, 400, 500, 600, 700, 800, 900]),
        desktop: {
          url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
          name: "NotoSansSC.ttf",
          weights: {
        "400": { url: "https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf", name: "NotoSansSC-Regular.ttf" },
        "500": { url: "https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG-3FnYw.ttf", name: "NotoSansSC-Medium.ttf" },
        "700": { url: "https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGzjCnYw.ttf", name: "NotoSansSC-Bold.ttf" },
        "900": { url: "https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG3bCnYw.ttf", name: "NotoSansSC-Black.ttf" }
          }
        }
      },
      {
        id: "noto-serif-sc", family: "Noto Serif SC", name: "思源宋体", nameEn: "Source Han Serif SC",
        category: "宋体", languages: ["zh-Hans", "en"], weights: [200, 300, 400, 500, 600, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("notoserifsc"), sourceProject: "FontSource",
        popularityRank: 2, legacyKeys: ["serif"],
        load: FONTSOURCE("noto-serif-sc", [200, 300, 400, 500, 600, 700, 900]),
        desktop: {
          url: "https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf",
          name: "NotoSerifSC.ttf",
          weights: {
        "400": { url: "https://fonts.gstatic.com/s/notoserifsc/v35/H4cyBXePl9DZ0Xe7gG9cyOj7uK2-n-D2rd4FY7SCqyWv.ttf", name: "NotoSerifSC-Regular.ttf" },
        "700": { url: "https://fonts.gstatic.com/s/notoserifsc/v35/H4cyBXePl9DZ0Xe7gG9cyOj7uK2-n-D2rd4FY7RlrCWv.ttf", name: "NotoSerifSC-Bold.ttf" }
          }
        }
      },
      {
        id: "lxgw-wenkai", family: "LXGW WenKai", name: "霞鹜文楷", nameEn: "LXGW WenKai",
        category: "楷体", languages: ["zh-Hans", "en"], weights: [300, 400, 500, 700],
        license: "SIL OFL 1.1", licenseUrl: "https://github.com/lxgw/LxgwWenKai", sourceProject: "FontSource",
        popularityRank: 3, legacyKeys: ["kai"],
        load: FONTSOURCE("lxgw-wenkai", [300, 400, 500, 700]),
        desktop: { url: "https://github.com/lxgw/LxgwWenKai/releases/download/v1.510/LXGWWenKai-Regular.ttf", name: "LXGWWenKai-Regular.ttf" }
      },
      {
        id: "smiley-sans", family: "Smiley Sans Oblique", name: "得意黑", nameEn: "Smiley Sans",
        category: "黑体", languages: ["zh-Hans", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: "https://github.com/atelier-anchor/smiley-sans", sourceProject: "cn-fontsource",
        popularityRank: 4,
        load: { css: ["https://cdn.jsdelivr.net/npm/cn-fontsource-smiley-sans-oblique-regular@latest/font.css"] }
      },
      {
        id: "zcool-kuaile", family: "ZCOOL KuaiLe", name: "站酷快乐体", nameEn: "ZCOOL KuaiLe",
        category: "手写", languages: ["zh-Hans", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("zcoolkuaile"), sourceProject: "FontSource",
        popularityRank: 5, legacyKeys: ["rounded"],
        load: FONTSOURCE("zcool-kuaile", [400]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf", name: "ZCOOLKuaiLe-Regular.ttf" }
      },
      {
        id: "zcool-xiaowei", family: "ZCOOL XiaoWei", name: "站酷小薇体", nameEn: "ZCOOL XiaoWei",
        category: "宋体", languages: ["zh-Hans", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("zcoolxiaowei"), sourceProject: "FontSource",
        popularityRank: 6, legacyKeys: ["xiaowei"],
        load: FONTSOURCE("zcool-xiaowei", [400]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf", name: "ZCOOLXiaoWei-Regular.ttf" }
      },
      {
        id: "zcool-qingke-huangyou", family: "ZCOOL QingKe HuangYou", name: "站酷庆科黄油体", nameEn: "ZCOOL QingKe HuangYou",
        category: "黑体", languages: ["zh-Hans", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("zcoolqingkehuangyou"), sourceProject: "FontSource",
        popularityRank: 7, legacyKeys: ["qingke"],
        load: FONTSOURCE("zcool-qingke-huangyou", [400]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zcoolqingkehuangyou/ZCOOLQingKeHuangYou-Regular.ttf", name: "ZCOOLQingKeHuangYou-Regular.ttf" }
      },
      {
        id: "unbounded-sans", family: "Unbounded Sans", name: "标小智无界黑", nameEn: "(LogoSC) Unbounded Sans",
        category: "黑体", languages: ["zh-Hans", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: "https://github.com/maoken-fonts/unbounded-sans", sourceProject: "官方仓库（猫啃网）",
        popularityRank: 8, legacyKeys: ["logosc", "logosc_regular"],
        load: { faces: [{ weight: 400, url: "https://cdn.jsdelivr.net/gh/maoken-fonts/unbounded-sans@1.100/fonts/UnboundedSans-Regular.ttf", format: "truetype" }] },
        desktop: { url: "https://cdn.jsdelivr.net/gh/maoken-fonts/unbounded-sans@1.100/fonts/UnboundedSans-Regular.ttf", name: "UnboundedSans-Regular.ttf" }
      },
      {
        id: "ma-shan-zheng", family: "Ma Shan Zheng", name: "马善政毛笔楷书", nameEn: "Ma Shan Zheng",
        category: "手写", languages: ["zh-Hans", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("mashanzheng"), sourceProject: "FontSource",
        popularityRank: 9, legacyKeys: ["mashanzheng"],
        load: FONTSOURCE("ma-shan-zheng", [400]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/mashanzheng/MaShanZheng-Regular.ttf", name: "MaShanZheng-Regular.ttf" }
      },
      {
        id: "long-cang", family: "Long Cang", name: "龙藏体", nameEn: "Long Cang",
        category: "手写", languages: ["zh-Hans", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("longcang"), sourceProject: "FontSource",
        popularityRank: 10, legacyKeys: ["longcang"],
        load: FONTSOURCE("long-cang", [400]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/longcang/LongCang-Regular.ttf", name: "LongCang-Regular.ttf" }
      },
      {
        id: "zhi-mang-xing", family: "Zhi Mang Xing", name: "志莽行书", nameEn: "Zhi Mang Xing",
        category: "手写", languages: ["zh-Hans", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("zhimangxing"), sourceProject: "FontSource",
        popularityRank: 11, legacyKeys: ["zhimangxing"],
        load: FONTSOURCE("zhi-mang-xing", [400]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zhimangxing/ZhiMangXing-Regular.ttf", name: "ZhiMangXing-Regular.ttf" }
      },
      {
        id: "liu-jian-mao-cao", family: "Liu Jian Mao Cao", name: "柳建草书", nameEn: "Liu Jian Mao Cao",
        category: "手写", languages: ["zh-Hans", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("liujianmaocao"), sourceProject: "FontSource",
        popularityRank: 12, legacyKeys: ["liujianmaocao"],
        load: FONTSOURCE("liu-jian-mao-cao", [400]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/liujianmaocao/LiuJianMaoCao-Regular.ttf", name: "LiuJianMaoCao-Regular.ttf" }
      },
      {
        id: "slidefu", family: "Slidefu", name: "演示春风楷", nameEn: "Slidefu",
        category: "手写", languages: ["zh-Hans", "en"], weights: [400],
        license: "免费商用（作者公开发布）", licenseUrl: "https://www.100font.com/thread-152.htm", sourceProject: "cn-fontsource",
        popularityRank: 13,
        load: { css: ["https://cdn.jsdelivr.net/npm/cn-fontsource-slidefu-regular@latest/font.css"] }
      },
      {
        id: "xiaolai-sc", family: "Xiaolai SC", name: "小赖字体", nameEn: "Xiaolai SC",
        category: "手写", languages: ["zh-Hans", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: "https://github.com/lxgw/kose-font", sourceProject: "cn-fontsource",
        popularityRank: 14,
        load: { css: ["https://cdn.jsdelivr.net/npm/cn-fontsource-xiaolai-sc-regular@latest/font.css"] }
      },
      {
        id: "yozai", family: "Yozai", name: "悠哉字体", nameEn: "Yozai",
        category: "手写", languages: ["zh-Hans", "ja", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: "https://github.com/lxgw/yozai-font", sourceProject: "cn-fontsource",
        popularityRank: 15,
        load: { css: ["https://cdn.jsdelivr.net/npm/cn-fontsource-yozai-regular@latest/font.css"] }
      },
      {
        id: "lxgw-marker-gothic", family: "LXGW Marker Gothic", name: "霞鹜新晰黑", nameEn: "LXGW Marker Gothic",
        category: "黑体", languages: ["zh-Hans", "ja", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: "https://github.com/lxgw/LxgwMarkerGothic", sourceProject: "cn-fontsource",
        popularityRank: 16,
        load: { css: ["https://cdn.jsdelivr.net/npm/cn-fontsource-lxgw-marker-gothic-regular@latest/font.css"] }
      },
      {
        id: "maru-975-sc", family: "975Maru SC", name: "975马圆体", nameEn: "975Maru SC",
        category: "圆体", languages: ["zh-Hans", "ja", "en"], weights: [400, 700],
        license: "SIL OFL 1.1（npm 包元数据标注，官方授权页待补充）", licenseUrl: "https://registry.npmjs.org/cn-fontsource-975-maru-sc-regular", sourceProject: "cn-fontsource",
        popularityRank: 17,
        load: {
          css: [
            "https://cdn.jsdelivr.net/npm/cn-fontsource-975-maru-sc-regular@latest/font.css",
            "https://cdn.jsdelivr.net/npm/cn-fontsource-975-maru-sc-bold@latest/font.css"
          ]
        }
      },

      /* ================= 繁体中文 ================= */
      {
        id: "noto-sans-tc", family: "Noto Sans TC", name: "思源黑体（繁）", nameEn: "Source Han Sans TC",
        category: "黑体", languages: ["zh-Hant", "en"], weights: [100, 300, 400, 500, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("notosanstc"), sourceProject: "FontSource",
        popularityRank: 18,
        load: FONTSOURCE("noto-sans-tc", [100, 300, 400, 500, 700, 900]),
        desktop: {
          url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf",
          name: "NotoSansTC.ttf",
          weights: {
        "400": { url: "https://fonts.gstatic.com/s/notosanstc/v39/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz76Cy_Co.ttf", name: "NotoSansTC-Regular.ttf" },
        "700": { url: "https://fonts.gstatic.com/s/notosanstc/v39/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz70e1_Co.ttf", name: "NotoSansTC-Bold.ttf" }
          }
        }
      },
      {
        id: "noto-serif-tc", family: "Noto Serif TC", name: "思源宋体（繁）", nameEn: "Source Han Serif TC",
        category: "宋体", languages: ["zh-Hant", "en"], weights: [300, 400, 500, 600, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("notoseriftc"), sourceProject: "FontSource",
        popularityRank: 19,
        load: FONTSOURCE("noto-serif-tc", [300, 400, 500, 600, 700, 900]),
        desktop: {
          url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notoseriftc/NotoSerifTC%5Bwght%5D.ttf",
          name: "NotoSerifTC.ttf",
          weights: {
            "400": { url: "https://fonts.gstatic.com/s/notoseriftc/v36/XLYzIZb5bJNDGYxLBibeHZ0BnHwmuanx8cUaGX9aMOpD.ttf", name: "NotoSerifTC-Regular.ttf" },
            "700": { url: "https://fonts.gstatic.com/s/notoseriftc/v36/XLYzIZb5bJNDGYxLBibeHZ0BnHwmuanx8cUaGX-9N-pD.ttf", name: "NotoSerifTC-Bold.ttf" }
          }
        }
      },

      /* ================= 日文 ================= */
      {
        id: "noto-sans-jp", family: "Noto Sans JP", name: "思源黑体（日）", nameEn: "Source Han Sans JP",
        category: "黑体", languages: ["ja", "en"], weights: [100, 300, 400, 500, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("notosansjp"), sourceProject: "FontSource",
        popularityRank: 20,
        load: FONTSOURCE("noto-sans-jp", [100, 300, 400, 500, 700, 900]),
        desktop: {
          url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf",
          name: "NotoSansJP.ttf",
          weights: {
        "400": { url: "https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf", name: "NotoSansJP-Regular.ttf" },
        "700": { url: "https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk75s.ttf", name: "NotoSansJP-Bold.ttf" }
          }
        }
      },
      {
        id: "noto-serif-jp", family: "Noto Serif JP", name: "思源宋体（日）", nameEn: "Source Han Serif JP",
        category: "宋体", languages: ["ja", "en"], weights: [200, 300, 400, 500, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("notoserifjp"), sourceProject: "FontSource",
        popularityRank: 21,
        load: FONTSOURCE("noto-serif-jp", [200, 300, 400, 500, 700, 900]),
        desktop: {
          url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf",
          name: "NotoSerifJP.ttf",
          weights: {
            "400": { url: "https://fonts.gstatic.com/s/notoserifjp/v33/xn71YHs72GKoTvER4Gn3b5eMRtWGkp6o7MjQ2bwxOubA.ttf", name: "NotoSerifJP-Regular.ttf" },
            "700": { url: "https://fonts.gstatic.com/s/notoserifjp/v33/xn71YHs72GKoTvER4Gn3b5eMRtWGkp6o7MjQ2bzWPebA.ttf", name: "NotoSerifJP-Bold.ttf" }
          }
        }
      },
      {
        id: "zen-kaku-gothic-new", family: "Zen Kaku Gothic New", name: "全角哥特新", nameEn: "Zen Kaku Gothic New",
        category: "黑体", languages: ["ja", "en"], weights: [400, 500, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("zenkakugothicnew"), sourceProject: "FontSource",
        popularityRank: 22,
        load: FONTSOURCE("zen-kaku-gothic-new", [400, 500, 700, 900])
      },
      {
        id: "m-plus-1p", family: "M PLUS 1p", name: "M PLUS 1p", nameEn: "M PLUS 1p",
        category: "黑体", languages: ["ja", "en"], weights: [100, 300, 400, 500, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("mplus1p"), sourceProject: "FontSource",
        popularityRank: 23,
        load: FONTSOURCE("m-plus-1p", [100, 300, 400, 500, 700, 900])
      },
      {
        id: "zen-maru-gothic", family: "Zen Maru Gothic", name: "全角丸哥特", nameEn: "Zen Maru Gothic",
        category: "圆体", languages: ["ja", "en"], weights: [300, 400, 500, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("zenmarugothic"), sourceProject: "FontSource",
        popularityRank: 24,
        load: FONTSOURCE("zen-maru-gothic", [300, 400, 500, 700, 900])
      },
      {
        id: "sawarabi-gothic", family: "Sawarabi Gothic", name: "蕨哥特", nameEn: "Sawarabi Gothic",
        category: "黑体", languages: ["ja", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("sawarabigothic"), sourceProject: "FontSource",
        popularityRank: 25,
        load: FONTSOURCE("sawarabi-gothic", [400])
      },
      {
        id: "kosugi-maru", family: "Kosugi Maru", name: "小丸哥特圆", nameEn: "Kosugi Maru",
        category: "圆体", languages: ["ja", "en"], weights: [400],
        license: "Apache 2.0", licenseUrl: "https://github.com/google/fonts/tree/main/apache/kosugimaru", sourceProject: "FontSource",
        popularityRank: 26,
        load: FONTSOURCE("kosugi-maru", [400])
      },
      {
        id: "dela-gothic-one", family: "Dela Gothic One", name: "德拉黑体", nameEn: "Dela Gothic One",
        category: "黑体", languages: ["ja", "en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("delagothicone"), sourceProject: "FontSource",
        popularityRank: 27,
        load: FONTSOURCE("dela-gothic-one", [400])
      },

      /* ================= 英文 / 拉丁 ================= */
      {
        id: "noto-sans", family: "Noto Sans", name: "Noto Sans", nameEn: "Noto Sans",
        category: "黑体", languages: ["en"], weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("notosans"), sourceProject: "FontSource",
        popularityRank: 28,
        load: FONTSOURCE("noto-sans", [100, 200, 300, 400, 500, 600, 700, 800, 900])
      },
      {
        id: "inter", family: "Inter", name: "Inter", nameEn: "Inter",
        category: "黑体", languages: ["en"], weights: [100, 300, 400, 500, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("inter"), sourceProject: "FontSource",
        popularityRank: 29,
        load: FONTSOURCE("inter", [100, 300, 400, 500, 700, 900])
      },
      {
        id: "roboto", family: "Roboto", name: "Roboto", nameEn: "Roboto",
        category: "黑体", languages: ["en"], weights: [100, 300, 400, 500, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("roboto"), sourceProject: "FontSource",
        popularityRank: 30,
        load: FONTSOURCE("roboto", [100, 300, 400, 500, 700, 900])
      },
      {
        id: "open-sans", family: "Open Sans", name: "Open Sans", nameEn: "Open Sans",
        category: "黑体", languages: ["en"], weights: [300, 400, 500, 600, 700, 800],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("opensans"), sourceProject: "FontSource",
        popularityRank: 31,
        load: FONTSOURCE("open-sans", [300, 400, 500, 600, 700, 800])
      },
      {
        id: "lato", family: "Lato", name: "Lato", nameEn: "Lato",
        category: "黑体", languages: ["en"], weights: [100, 300, 400, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("lato"), sourceProject: "FontSource",
        popularityRank: 32, legacyKeys: ["lato"],
        load: FONTSOURCE("lato", [100, 300, 400, 700, 900]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lato/Lato-Regular.ttf", name: "Lato-Regular.ttf" }
      },
      {
        id: "montserrat", family: "Montserrat", name: "Montserrat", nameEn: "Montserrat",
        category: "黑体", languages: ["en"], weights: [100, 300, 400, 500, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("montserrat"), sourceProject: "FontSource",
        popularityRank: 33, legacyKeys: ["montserrat"],
        load: FONTSOURCE("montserrat", [100, 300, 400, 500, 700, 900]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/montserrat/Montserrat%5Bwght%5D.ttf", name: "Montserrat-Variable.ttf" }
      },
      {
        id: "oswald", family: "Oswald", name: "Oswald", nameEn: "Oswald",
        category: "黑体", languages: ["en"], weights: [200, 300, 400, 500, 600, 700],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("oswald"), sourceProject: "FontSource",
        popularityRank: 34, legacyKeys: ["oswald"],
        load: FONTSOURCE("oswald", [200, 300, 400, 500, 600, 700]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/oswald/Oswald%5Bwght%5D.ttf", name: "Oswald-Variable.ttf" }
      },
      {
        id: "bebas-neue", family: "Bebas Neue", name: "Bebas Neue", nameEn: "Bebas Neue",
        category: "展示", languages: ["en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("bebasneue"), sourceProject: "FontSource",
        popularityRank: 35, legacyKeys: ["bebas"],
        load: FONTSOURCE("bebas-neue", [400]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/bebasneue/BebasNeue-Regular.ttf", name: "BebasNeue-Regular.ttf" }
      },
      {
        id: "playfair-display", family: "Playfair Display", name: "Playfair Display", nameEn: "Playfair Display",
        category: "宋体", languages: ["en"], weights: [400, 500, 600, 700, 800, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("playfairdisplay"), sourceProject: "FontSource",
        popularityRank: 36, legacyKeys: ["playfair"],
        load: FONTSOURCE("playfair-display", [400, 500, 600, 700, 800, 900]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf", name: "PlayfairDisplay-Variable.ttf" }
      },
      {
        id: "abril-fatface", family: "Abril Fatface", name: "Abril Fatface", nameEn: "Abril Fatface",
        category: "展示", languages: ["en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("abrilfatface"), sourceProject: "FontSource",
        popularityRank: 37, legacyKeys: ["abril"],
        load: FONTSOURCE("abril-fatface", [400]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/abrilfatface/AbrilFatface-Regular.ttf", name: "AbrilFatface-Regular.ttf" }
      },
      {
        id: "jetbrains-mono", family: "JetBrains Mono", name: "JetBrains Mono", nameEn: "JetBrains Mono",
        category: "等宽", languages: ["en"], weights: [100, 300, 400, 500, 600, 700, 800],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("jetbrainsmono"), sourceProject: "FontSource",
        popularityRank: 38,
        load: FONTSOURCE("jetbrains-mono", [100, 300, 400, 500, 600, 700, 800])
      },
      {
        id: "poppins", family: "Poppins", name: "Poppins", nameEn: "Poppins",
        category: "黑体", languages: ["en"], weights: [100, 300, 400, 500, 600, 700, 800, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("poppins"), sourceProject: "FontSource",
        popularityRank: 39, legacyKeys: ["poppins"],
        load: FONTSOURCE("poppins", [100, 300, 400, 500, 600, 700, 800, 900]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-Regular.ttf", name: "Poppins-Regular.ttf" }
      },
      {
        id: "space-grotesk", family: "Space Grotesk", name: "Space Grotesk", nameEn: "Space Grotesk",
        category: "黑体", languages: ["en"], weights: [300, 400, 500, 700],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("spacegrotesk"), sourceProject: "FontSource",
        popularityRank: 40, legacyKeys: ["grotesk"],
        load: FONTSOURCE("space-grotesk", [300, 400, 500, 700]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf", name: "SpaceGrotesk-Variable.ttf" }
      },
      {
        id: "roboto-condensed", family: "Roboto Condensed", name: "Roboto Condensed", nameEn: "Roboto Condensed",
        category: "黑体", languages: ["en"], weights: [100, 300, 400, 500, 700, 900],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("robotocondensed"), sourceProject: "FontSource",
        popularityRank: 41, legacyKeys: ["robotoCond"],
        load: FONTSOURCE("roboto-condensed", [100, 300, 400, 500, 700, 900]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/robotocondensed/RobotoCondensed%5Bwght%5D.ttf", name: "RobotoCondensed-Variable.ttf" }
      },
      {
        id: "ubuntu", family: "Ubuntu", name: "Ubuntu", nameEn: "Ubuntu",
        category: "黑体", languages: ["en"], weights: [300, 400, 500, 700],
        license: "Ubuntu Font Licence 1.0", licenseUrl: "https://github.com/google/fonts/tree/main/ufl/ubuntu", sourceProject: "FontSource",
        popularityRank: 42, legacyKeys: ["ubuntu"],
        load: FONTSOURCE("ubuntu", [300, 400, 500, 700]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ufl/ubuntu/Ubuntu-Regular.ttf", name: "Ubuntu-Regular.ttf" }
      },
      {
        id: "metal-mania", family: "Metal Mania", name: "Metal Mania（重金属）", nameEn: "Metal Mania",
        category: "展示", languages: ["en"], weights: [400],
        license: "SIL OFL 1.1", licenseUrl: GFOFL("metalmania"), sourceProject: "FontSource",
        popularityRank: 43, legacyKeys: ["metalmania"],
        load: FONTSOURCE("metal-mania", [400]),
        desktop: { url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/metalmania/MetalMania-Regular.ttf", name: "MetalMania-Regular.ttf" }
      }
    ],
    /* 授权核实后明确排除的字体（免费商用 ≠ 允许第三方 CDN 再分发）：
       引导用户从官方渠道下载后走「自定义字体上传」。
       - 阿里妈妈数黑体 / 东方大楷：官方声明禁止未经授权上传、发布、转载字体文件（fonts.alibabagroup.com/#/more）
       - 钉钉进步体：永久免费商用，但要求经官方指定渠道下载使用（page.dingtalk.com）
       - 方正免费系列（楷体/仿宋等）：方正官网免费字体，再分发条款未明确
       - HONOR Sans CN：厂商字体，无公开 CDN 且再分发许可未确认
       - Helvetica LT 97 Black Condensed：Monotype 商用授权字体，不属于开源字体 */
    excluded: [
      { name: "阿里妈妈数黑体", reason: "官方禁止第三方再分发", officialUrl: "https://fonts.alibabagroup.com/#/more" },
      { name: "阿里妈妈东方大楷", reason: "同阿里妈妈官方声明，禁止第三方再分发", officialUrl: "https://fonts.alibabagroup.com/#/more" },
      { name: "钉钉进步体", reason: "要求经官方指定渠道下载使用", officialUrl: "https://www.iconfont.cn/fonts/detail?cnid=clpB5hhpYWUN" },
      { name: "方正楷体/方正仿宋（免费系列）", reason: "免费商用，再分发条款未明确", officialUrl: "https://www.foundertype.com/" },
      { name: "HONOR Sans CN", reason: "无公开 CDN，再分发许可未确认", officialUrl: "https://www.hihonor.com/" },
      { name: "Helvetica LT 97 Black Condensed", reason: "Monotype 商用授权字体，非开源", officialUrl: "https://www.monotype.com/" }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);

(function (global) {
  "use strict";

  const C = global.BannerBuilderConstants;
  const baseWidth = C.CANVAS_PRESETS[C.DEFAULT_RATIO].pageWidth;

  function opt(value, label) {
    return { value: value, label: label };
  }

  /* 层级下拉：把 TYPE_SCALE 换算成 1242 宽下的实际字号，方便用户选。 */
  const LEVEL_OPTIONS = Object.keys(C.TYPE_SCALE).map(function (level) {
    const names = { h1: "大标题 H1", h2: "板块标题 H2", h3: "卡片标题 H3", body: "正文", caption: "小字 / 图注" };
    return opt(level, names[level] + " · " + C.fontSizePx(level, baseWidth) + "px");
  });

  const RATIO_OPTIONS = [
    opt("auto", "自动（按原图）"),
    opt("1:1", "1:1 正方形"),
    opt("3:4", "3:4 竖版"),
    opt("4:3", "4:3 横版"),
    opt("9:16", "9:16 竖版"),
    opt("16:9", "16:9 横版"),
  ];

  const DIVIDER_OPTIONS = [
    opt("wave", "波浪线"),
    opt("dots", "圆点"),
    opt("line", "直线"),
  ];

  const ALIGN_OPTIONS = [
    opt("left", "左对齐"),
    opt("center", "居中"),
    opt("right", "右对齐"),
  ];

  /* 正文对齐：空 = 跟随板块「内容对齐」。 */
  const BODY_ALIGN_OPTIONS = [opt("", "跟随板块")].concat(ALIGN_OPTIONS);
  const BODY_ALIGN_FIELD = { key: "bodyAlign", label: "正文对齐", type: "select", options: BODY_ALIGN_OPTIONS };

  const WIDTH_OPTIONS = [
    opt("full", "通栏（整行）"),
    opt("half", "半宽（与下一个半宽并排）"),
  ];

  const IMAGE_PLACEMENT_OPTIONS = [
    opt("none", "不配图"),
    opt("left", "图在左"),
    opt("right", "图在右"),
    opt("top", "图在上"),
  ];

  const TITLE_PLACEMENT_OPTIONS = [
    opt("overlay-bottom", "叠在主视觉底部"),
    opt("overlay-center", "叠在主视觉中央"),
    opt("below", "放在主视觉下方"),
    opt("hidden", "不显示标题"),
  ];

  const QR_PLACEMENT_OPTIONS = [
    opt("right", "二维码在右"),
    opt("left", "二维码在左"),
    opt("top", "二维码在上"),
    opt("hidden", "不放二维码"),
  ];

  const COLUMN_OPTIONS = [
    opt("1", "1 列"),
    opt("2", "2 列"),
    opt("3", "3 列"),
    opt("4", "4 列"),
  ];

  const MEDIA_SIDE_OPTIONS = [
    opt("left", "图在左"),
    opt("right", "图在右"),
    opt("top", "图在上"),
    opt("none", "本条不配图"),
  ];

  const CONTENT_ALIGN_OPTIONS = [
    opt("left", "左对齐"),
    opt("center", "居中"),
    opt("right", "右对齐"),
  ];

  const MEDIA_RATIO_OPTIONS = [
    opt("auto", "自动"),
    opt("1:1", "1:1 正方形"),
    opt("4:3", "4:3 横图"),
    opt("3:4", "3:4 竖图"),
    opt("16:9", "16:9 横图"),
  ];

  const IMAGE_FIT_OPTIONS = [
    opt("cover", "裁切填满"),
    opt("contain", "完整显示"),
  ];

  function countLabel(n, unit) {
    return n + " " + unit;
  }

  function pickImages(list, limit) {
    const out = [];
    (list || []).forEach(function (item) {
      if (item && item.url && out.length < limit) out.push(item);
    });
    return out;
  }

  function widthLabel(value) {
    const hit = WIDTH_OPTIONS.filter(function (item) { return item.value === value; })[0];
    return hit ? hit.label : "";
  }

  function optionLabel(options, value) {
    const hit = (options || []).filter(function (item) { return item.value === value; })[0];
    return hit ? hit.label : String(value || "");
  }

  const MODULE_TEMPLATES = {
    cover: [opt("immersive", "沉浸海报"), opt("info", "信息封面"), opt("minimal", "纯标题"), opt("split", "上下分割")],
    announcement: [opt("notice", "公告卡"), opt("quote", "重点引语"), opt("plain", "纯文本"), opt("boxed", "描边卡片")],
    ticketInfo: [opt("qr-side", "二维码侧栏"), opt("ticket-cards", "票档卡片"), opt("ticket-focus", "购票重点"), opt("ticket-hero", "主推票档")],
    materials: [opt("icon-grid", "图标网格"), opt("checklist", "清单"), opt("notice-strip", "横条提示")],
    crossPromo: [opt("promo-card", "推广卡"), opt("promo-strip", "横向条"), opt("promo-centered", "居中推广")],
    schedule: [opt("timeline", "时间轴"), opt("schedule-table", "时间表"), opt("schedule-cards", "分组卡片")],
    venueInfo: [opt("venue-side", "图文侧栏"), opt("venue-focus", "场地重点"), opt("venue-map", "地图说明")],
    routeText: [opt("steps", "步骤路线"), opt("route-list", "路线清单"), opt("route-focus", "重点指引")],
    programList: [opt("program-list", "节目列表"), opt("program-cards", "节目卡片"), opt("program-compact", "紧凑双栏")],
    performerCard: [opt("performer-side", "人物侧栏"), opt("performer-poster", "人物海报"), opt("performer-grid", "双图资料")],
    boothList: [opt("booth-grid", "摊位网格"), opt("booth-cards", "摊位卡片"), opt("booth-list", "摊位名单")],
    divider: [opt("wave", "波浪分隔"), opt("dots", "圆点分隔"), opt("line", "直线分隔")],
    footer: [opt("footer-simple", "简洁页脚"), opt("footer-center", "居中页脚"), opt("footer-banner", "信息条"), opt("footer-pills", "胶囊页脚")],
    freeText: [opt("text-basic", "基础文字"), opt("text-highlight", "重点文字"), opt("text-note", "注释文字"), opt("text-card", "白底卡片")],
    freeImageBox: [opt("image-focus", "主图"), opt("image-card", "图片卡片"), opt("image-caption", "图注图片")],
  };

  function templateOptions(type) {
    return MODULE_TEMPLATES[type] || [];
  }

  /* 每个模块都能改：模板、板块大标题、通栏/半宽、板块底色/底图和阅读密度。 */
  const LAYOUT_FIELDS = [
    { key: "template", label: "板块模板", type: "select", dynamicOptions: "templates" },
    { key: "sectionTitle", label: "板块大标题", type: "text", placeholder: "例如：票务信息（可留空）" },
    { key: "width", label: "占宽", type: "select", options: WIDTH_OPTIONS },
    { key: "contentAlign", label: "内容对齐", type: "select", options: CONTENT_ALIGN_OPTIONS },
    { key: "blockBgColor", label: "板块底色", type: "text", placeholder: "例如：#163a8a，可留空" },
    { key: "blockBorderColor", label: "板块边框颜色", type: "text", placeholder: "例如：#e056a0（留空跟随主题）" },
    { key: "blockBgImage", label: "板块底图", type: "image" },
    { key: "blockOpacity", label: "板块透明度（%）", type: "number", min: 0, max: 100, step: 1 },
    { key: "padding", label: "板块内边距（px）", type: "number", min: 0, max: 240, step: 1 },
    { key: "marginBottom", label: "板块下间距（px）", type: "number", min: 0, max: 240, step: 1 },
    { key: "radius", label: "板块圆角（px）", type: "number", min: 0, max: 160, step: 1 },
    { key: "imageRatio", label: "图片比例", type: "select", options: MEDIA_RATIO_OPTIONS },
    { key: "imageFit", label: "图片填充", type: "select", options: IMAGE_FIT_OPTIONS },
  ];

  function withLayout(extra) {
    const data = {
      template: "",
      sectionTitle: "",
      width: "full",
      contentAlign: "center",
      blockBgColor: "",
      blockBorderColor: "",
      blockBgImage: null,
      blockOpacity: 94,
      padding: 16,
      marginBottom: 18,
      radius: 13,
      imageRatio: "auto",
      imageFit: "cover",
    };
    Object.keys(extra || {}).forEach(function (key) {
      data[key] = extra[key];
    });
    return data;
  }

  function layoutSummary(data) {
    const bits = [];
    if (data.sectionTitle) bits.push(data.sectionTitle);
    bits.push(widthLabel(data.width) || "通栏");
    if (data.blockBgColor) bits.push(data.blockBgColor);
    if (data.blockBgImage && data.blockBgImage.name) bits.push("有底图");
    return { label: "排版", value: bits.join(" · ") };
  }

  function withBlockThumb(data, extra) {
    const out = [];
    if (data && data.blockBgImage && data.blockBgImage.url) out.push(data.blockBgImage);
    (extra || []).forEach(function (item) {
      if (item && item.url) out.push(item);
    });
    return out.slice(0, 4);
  }

  const MODULE_REGISTRY = {
    cover: {
      label: "封面",
      createDefault: function () {
        return withLayout({
          mainImage: null,
          title: "",
          subtitle: "",
          infoLines: [],
          qqGroupNumber: "",
          titlePlacement: "overlay-bottom",
        });
      },
      fields: [
        { key: "mainImage", label: "主视觉图", type: "image" },
        { key: "title", label: "主标题", type: "text", placeholder: "例如：第一届 XX ONLY" },
        { key: "subtitle", label: "副标题", type: "text", placeholder: "例如：2026.10.01 · 上海" },
        { key: "titlePlacement", label: "标题位置", type: "select", options: TITLE_PLACEMENT_OPTIONS },
        { key: "infoLines", label: "信息行", type: "stringList", itemLabel: "一行", placeholder: "例如：10:00-16:00 入场" },
        { key: "qqGroupNumber", label: "QQ 群号", type: "text" },
      ].concat(LAYOUT_FIELDS),
      summary: function (data) {
        return [
          layoutSummary(data),
          { label: "主标题", value: data.title },
          { label: "标题位置", value: optionLabel(TITLE_PLACEMENT_OPTIONS, data.titlePlacement) },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, data.mainImage && data.mainImage.url ? [data.mainImage] : []);
      },
    },

    announcement: {
      label: "情报公告文本块",
      createDefault: function () {
        return withLayout({ bodyAlign: "left", heading: "", body: "" });
      },
      fields: [BODY_ALIGN_FIELD].concat(LAYOUT_FIELDS, [
        { key: "heading", label: "小标题", type: "text" },
        { key: "body", label: "正文", type: "textarea", rows: 5 },
      ]),
      summary: function (data) {
        return [
          layoutSummary(data),
          { label: "小标题", value: data.heading },
          { label: "正文", value: data.body },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, []);
      },
    },

    ticketInfo: {
      label: "票务信息",
      createDefault: function () {
        return withLayout({ bodyAlign: "left", qrImage: null, tiers: [], note: "", qrPlacement: "right" });
      },
      fields: [BODY_ALIGN_FIELD].concat(LAYOUT_FIELDS, [
        { key: "qrImage", label: "购票二维码", type: "image" },
        { key: "qrPlacement", label: "二维码位置", type: "select", options: QR_PLACEMENT_OPTIONS },
        {
          key: "tiers",
          label: "票档",
          type: "objectList",
          itemLabel: "票档",
          fields: [
            { key: "label", label: "名称", type: "text", placeholder: "例如：预售票" },
            { key: "price", label: "价格", type: "text", placeholder: "例如：￥65" },
          ],
        },
        { key: "note", label: "购票说明", type: "textarea", rows: 3 },
      ]),
      summary: function (data) {
        const tiers = data.tiers || [];
        const first = tiers[0];
        return [
          layoutSummary(data),
          { label: "票档", value: first ? countLabel(tiers.length, "档") + "：" + [first.label, first.price].filter(Boolean).join(" ") : countLabel(tiers.length, "档") },
          { label: "二维码", value: optionLabel(QR_PLACEMENT_OPTIONS, data.qrPlacement) },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, data.qrImage && data.qrImage.url ? [data.qrImage] : []);
      },
    },

    materials: {
      label: "物料监修",
      createDefault: function () {
        return withLayout({ bodyAlign: "left", items: [], note: "", columns: "2" });
      },
      fields: [BODY_ALIGN_FIELD].concat(LAYOUT_FIELDS, [
        { key: "columns", label: "图标列数", type: "select", options: COLUMN_OPTIONS },
        {
          key: "items",
          label: "物料条目",
          type: "objectList",
          itemLabel: "物料",
          fields: [
            { key: "icon", label: "图标", type: "image" },
            { key: "label", label: "说明", type: "text", placeholder: "例如：禁止闪光摄影" },
          ],
        },
        { key: "note", label: "补充说明", type: "textarea", rows: 3 },
      ]),
      summary: function (data) {
        const items = data.items || [];
        return [
          layoutSummary(data),
          { label: "条目", value: items.map(function (item) { return item.label; }).filter(Boolean).join(" / ") || countLabel(items.length, "条") },
          { label: "列数", value: optionLabel(COLUMN_OPTIONS, data.columns) },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, pickImages((data.items || []).map(function (item) { return item.icon; }), 3));
      },
    },

    crossPromo: {
      label: "联动推广条",
      createDefault: function () {
        return withLayout({ bodyAlign: "left", icon: null, text: "", imagePlacement: "left" });
      },
      fields: [BODY_ALIGN_FIELD].concat(LAYOUT_FIELDS, [
        { key: "icon", label: "联动方图标", type: "image" },
        { key: "imagePlacement", label: "图标位置", type: "select", options: IMAGE_PLACEMENT_OPTIONS },
        { key: "text", label: "推广文案", type: "textarea", rows: 3 },
      ]),
      summary: function (data) {
        return [
          layoutSummary(data),
          { label: "文案", value: data.text },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, data.icon && data.icon.url ? [data.icon] : []);
      },
    },

    schedule: {
      label: "活动时间轴",
      createDefault: function () {
        return withLayout({ groups: [] });
      },
      fields: LAYOUT_FIELDS.concat([
        {
          key: "groups",
          label: "时间分组",
          type: "objectList",
          itemLabel: "分组",
          fields: [
            { key: "groupName", label: "分组名", type: "text", placeholder: "例如：主舞台" },
            {
              key: "rows",
              label: "环节",
              type: "objectList",
              itemLabel: "环节",
              fields: [
                { key: "name", label: "环节名", type: "text" },
                { key: "time", label: "时间", type: "text", placeholder: "例如：13:00" },
              ],
            },
          ],
        },
      ]),
      summary: function (data) {
        const groups = data.groups || [];
        const rows = groups.reduce(function (sum, group) { return sum + ((group.rows || []).length); }, 0);
        return [
          layoutSummary(data),
          { label: "分组", value: groups.map(function (group) { return group.groupName; }).filter(Boolean).join(" / ") || countLabel(groups.length, "组") },
          { label: "环节", value: countLabel(rows, "条") },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, []);
      },
    },

    venueInfo: {
      label: "场地信息",
      createDefault: function () {
        return withLayout({ bodyAlign: "left", description: "", tags: [], photo: null, imagePlacement: "right" });
      },
      fields: [BODY_ALIGN_FIELD].concat(LAYOUT_FIELDS, [
        { key: "description", label: "场地描述", type: "textarea", rows: 4 },
        { key: "tags", label: "标签", type: "stringList", itemLabel: "标签", placeholder: "例如：地铁 2 号口步行 5 分钟" },
        { key: "photo", label: "场地照片", type: "image" },
        { key: "imagePlacement", label: "照片位置", type: "select", options: IMAGE_PLACEMENT_OPTIONS },
      ]),
      summary: function (data) {
        return [
          layoutSummary(data),
          { label: "描述", value: data.description },
          { label: "照片", value: optionLabel(IMAGE_PLACEMENT_OPTIONS, data.imagePlacement) },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, data.photo && data.photo.url ? [data.photo] : []);
      },
    },

    routeText: {
      label: "入场路线",
      createDefault: function () {
        return withLayout({ lines: [] });
      },
      fields: LAYOUT_FIELDS.concat([
        { key: "lines", label: "路线步骤", type: "stringList", itemLabel: "一步", placeholder: "例如：地铁 2 号线 A 口出，直行 300 米" },
      ]),
      summary: function (data) {
        const lines = (data.lines || []).filter(Boolean);
        return [
          layoutSummary(data),
          { label: "步骤", value: countLabel(lines.length, "步") },
          { label: "第一步", value: lines[0] || "" },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, []);
      },
    },

    programList: {
      label: "节目单列表",
      createDefault: function () {
        return withLayout({ items: [] });
      },
      fields: LAYOUT_FIELDS.concat([
        {
          key: "items",
          label: "节目条目",
          type: "objectList",
          itemLabel: "节目",
          fields: [
            { key: "tag", label: "标签", type: "text", placeholder: "例如：13:00" },
            { key: "title", label: "标题", type: "text" },
            { key: "subtitle", label: "副标题", type: "text" },
            { key: "image", label: "配图", type: "image" },
            { key: "mediaSide", label: "本条图文方向", type: "select", options: MEDIA_SIDE_OPTIONS },
          ],
        },
      ]),
      summary: function (data) {
        const items = data.items || [];
        return [
          layoutSummary(data),
          { label: "节目", value: countLabel(items.length, "条") },
          { label: "首个", value: items[0] ? [items[0].tag, items[0].title].filter(Boolean).join(" ") : "" },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, pickImages((data.items || []).map(function (item) { return item.image; }), 3));
      },
    },

    performerCard: {
      label: "嘉宾/乐队/DJ 介绍卡",
      createDefault: function () {
        return withLayout({ bodyAlign: "left", images: [], name: "", bio: "", setlist: [], imagePlacement: "left" });
      },
      fields: [BODY_ALIGN_FIELD].concat(LAYOUT_FIELDS, [
        { key: "images", label: "照片（最多 2 张）", type: "imageList", max: 2 },
        { key: "imagePlacement", label: "照片位置", type: "select", options: IMAGE_PLACEMENT_OPTIONS },
        { key: "name", label: "名称", type: "text" },
        { key: "bio", label: "简介", type: "textarea", rows: 4 },
        { key: "setlist", label: "曲目单", type: "stringList", itemLabel: "一首", placeholder: "例如：01. 曲名" },
      ]),
      summary: function (data) {
        return [
          layoutSummary(data),
          { label: "名称", value: data.name },
          { label: "照片", value: optionLabel(IMAGE_PLACEMENT_OPTIONS, data.imagePlacement) },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, pickImages(data.images, 2));
      },
    },

    boothList: {
      label: "摊位信息列表",
      createDefault: function () {
        return withLayout({ items: [], columns: "2" });
      },
      fields: LAYOUT_FIELDS.concat([
        { key: "columns", label: "摊位列数", type: "select", options: COLUMN_OPTIONS },
        {
          key: "items",
          label: "摊位条目",
          type: "objectList",
          itemLabel: "摊位",
          fields: [
            { key: "image", label: "摊位图", type: "image" },
            { key: "name", label: "摊位名", type: "text" },
            { key: "desc", label: "简介", type: "textarea", rows: 2 },
          ],
        },
      ]),
      summary: function (data) {
        const items = data.items || [];
        return [
          layoutSummary(data),
          { label: "摊位", value: items.map(function (item) { return item.name; }).filter(Boolean).join(" / ") || countLabel(items.length, "个") },
          { label: "列数", value: optionLabel(COLUMN_OPTIONS, data.columns) },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, pickImages((data.items || []).map(function (item) { return item.image; }), 3));
      },
    },

    divider: {
      label: "分割线/装饰条",
      createDefault: function () {
        return withLayout({});
      },
      fields: LAYOUT_FIELDS,
      summary: function (data) {
        return [
          layoutSummary(data),
          { label: "样式", value: optionLabel(DIVIDER_OPTIONS, data.template) },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, []);
      },
    },

    footer: {
      label: "页脚/更多信息",
      createDefault: function () {
        return withLayout({ bodyAlign: "left", lines: [] });
      },
      fields: [BODY_ALIGN_FIELD].concat(LAYOUT_FIELDS, [
        { key: "lines", label: "页脚行", type: "stringList", itemLabel: "一行", placeholder: "例如：微博 @XXX" },
      ]),
      summary: function (data) {
        const lines = (data.lines || []).filter(Boolean);
        return [
          layoutSummary(data),
          { label: "行数", value: countLabel(lines.length, "行") },
          { label: "首行", value: lines[0] || "" },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, []);
      },
    },

    freeText: {
      label: "自由文本框",
      createDefault: function () {
        return withLayout({ text: "", level: "body", align: "left" });
      },
      fields: [
        { key: "text", label: "文本内容", type: "textarea", rows: 5 },
        { key: "level", label: "文字层级", type: "select", options: LEVEL_OPTIONS },
        { key: "align", label: "文字对齐", type: "select", options: ALIGN_OPTIONS },
      ].concat(LAYOUT_FIELDS),
      summary: function (data) {
        return [
          { label: "文本", value: data.text },
          { label: "层级", value: optionLabel(LEVEL_OPTIONS, data.level) },
          layoutSummary(data),
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, []);
      },
    },

    freeImageBox: {
      label: "自由图片框（也用于场地平面图等复杂手绘图）",
      createDefault: function () {
        return withLayout({ image: null, ratio: "auto", radius: 0, caption: "" });
      },
      fields: LAYOUT_FIELDS.concat([
        { key: "image", label: "图片", type: "image" },
        { key: "ratio", label: "显示比例", type: "select", options: RATIO_OPTIONS },
        { key: "radius", label: "圆角", type: "number", min: 0, max: 200, step: 1 },
        { key: "caption", label: "图注", type: "text" },
      ]),
      summary: function (data) {
        return [
          layoutSummary(data),
          { label: "比例", value: optionLabel(RATIO_OPTIONS, data.ratio) },
          { label: "图注", value: data.caption },
        ];
      },
      thumbs: function (data) {
        return withBlockThumb(data, data.image && data.image.url ? [data.image] : []);
      },
    },
  };

  Object.keys(MODULE_REGISTRY).forEach(function (type) {
    const def = MODULE_REGISTRY[type];
    const originalCreateDefault = def.createDefault;
    def.createDefault = function () {
      const data = originalCreateDefault();
      const options = templateOptions(type);
      if (!data.template && options.length) data.template = options[0].value;
      return data;
    };
  });

  const MODULE_ORDER = Object.keys(MODULE_REGISTRY);

  function getDef(type) {
    return MODULE_REGISTRY[type] || null;
  }

  function typeLabel(type) {
    const def = getDef(type);
    return def ? def.label : String(type || "未知模块");
  }

  /* 占位框上的关键字段摘要，最多保留 2 条非空值。 */
  function moduleSummary(module) {
    const def = getDef(module && module.type);
    if (!def || typeof def.summary !== "function") return [];
    const rows = def.summary(module.data || {}) || [];
    return rows.filter(function (row) { return row && String(row.value || "").trim(); }).slice(0, 2);
  }

  function moduleThumbs(module) {
    const def = getDef(module && module.type);
    if (!def || typeof def.thumbs !== "function") return [];
    return def.thumbs(module.data || {}) || [];
  }

  global.BannerBuilderRegistry = Object.freeze({
    MODULE_REGISTRY,
    MODULE_ORDER,
    LEVEL_OPTIONS,
    RATIO_OPTIONS,
    DIVIDER_OPTIONS,
    ALIGN_OPTIONS,
    BODY_ALIGN_OPTIONS,
    WIDTH_OPTIONS,
    IMAGE_PLACEMENT_OPTIONS,
    TITLE_PLACEMENT_OPTIONS,
    QR_PLACEMENT_OPTIONS,
    COLUMN_OPTIONS,
    MEDIA_SIDE_OPTIONS,
    getDef,
    typeLabel,
    moduleSummary,
    moduleThumbs,
    templateOptions,
  });
})(window);

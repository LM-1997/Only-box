/* ================================================================
   banner-builder-preview.js — WYSIWYG DOM 预览渲染层（Stage 10）
   从 js/banner-builder.js 拆出的 DOM 预览系统：
   15 类板块按「预览模板」还原成 DOM（.bb-art-module 及内部图文排版），
   供屏幕所见即所得预览（buildPage/renderCanvas 组装）使用。

   分层归属（零构建 IIFE，单一全局命名空间）：
   - 跨层依赖 C/R/M 从 global.BannerBuilder* 读取；
   - 绘制辅助（artTheme/alphaColor 等）从 global.BannerBuilderRender 读取；
   - 主脚本私有辅助（state、els、el、text、imageSrc、docBackgroundOf 等）
     通过 setState/setContext 注入，保持单一状态源；
   - 对外仅暴露 BannerBuilderPreview.renderCanvas 给主脚本 renderAll。

   加载顺序：
     本文件依赖 banner-builder-render.js（BannerBuilderRender 定义）
     因此必须放在 render.js 之后、banner-builder.js 之前加载。
   ================================================================ */
(function (global) {
  "use strict";

  /* 跨层依赖（IIFE 顶部缓存 —— 加载顺序保证此时已存在） */
  var C = global.BannerBuilderConstants;
  var R = global.BannerBuilderRegistry;
  var M = global.BannerBuilderModel;
  var Render = global.BannerBuilderRender;

  /* 注入式私有状态 */
  var state = null;
  var els = {};
  var ctx = {};

  function setState(s) { state = s; }
  function setContext(c) {
    ctx = c || {};
    if (ctx.els) els = ctx.els;
  }

  /* ===== 主脚本私有辅助转发（保持与主脚本同名，使搬出的函数原样可用） ===== */
  function el(tag, cls, text) { return ctx.el(tag, cls, text); }
  function text(value, fallback) { return ctx.text(value, fallback); }
  function moduleTitle(module, def) { return ctx.moduleTitle(module, def); }
  function visualImage(src, cls, alt) { return ctx.visualImage(src, cls, alt); }
  function imageSrc(value) { return ctx.imageSrc(value); }
  function imageSizeOf(data, key, min, max, step) { return ctx.imageSizeOf(data, key, min, max, step); }
  function dataImageFit(data) { return ctx.dataImageFit(data); }
  function safeClassSuffix(value, fallback) { return ctx.safeClassSuffix(value, fallback); }
  function pageSize() { return ctx.pageSize(); }
  function continuousMode() { return ctx.continuousMode(); }
  function applyThemeVars(rootEl) { return ctx.applyThemeVars(rootEl); }
  function docBackgroundStyle(value) { return ctx.docBackgroundStyle(value); }
  function docBackgroundOf(target) { return ctx.docBackgroundOf(target); }
  function parametricBackgroundDataUrl(bgRecord, width, height) { return ctx.parametricBackgroundDataUrl(bgRecord, width, height); }
  function effectiveBackgroundColor(page) { return ctx.effectiveBackgroundColor(page); }
  function backgroundPatternActive(page) { return ctx.backgroundPatternActive(page); }

  /* ===== 绘制辅助转发（Stage 3 banner-builder-render.js） ===== */
  function artTheme() { return Render.artTheme(); }
  function styleCardPad(base, st) { return Render.styleCardPad(base, st); }
  function cardRadius(data, st) { return Render.cardRadius(data, st); }
  function cardBaseFill(st, data, opacity) { return Render.cardBaseFill(st, data, opacity); }
  function px2(v) { return Render.px2(v); }
  function alphaColor(value, alpha) { return Render.alphaColor(value, alpha); }

  /* =================================================================
     以下为从 banner-builder.js 原样搬迁的函数（保证逐字可 diff）

     16 类板块 DOM 生成器（含板块皮肤/排版辅助）：
       addVisualBody / renderCover ~ renderFreeImage / addGrid
       applyBlockSurface / applyBodyFontScope
     编排：
       buildModule / buildThemeBgPreviewCard / buildPage / renderCanvas
     ================================================================= */

  function addVisualBody(box, module) {
    const data = module.data;
    const tpl = data.template || "";
    switch (module.type) {
      case "cover": renderCover(box, data, tpl); break;
      case "announcement": renderAnnouncement(box, data, tpl); break;
      case "ticketInfo": renderTicket(box, data, tpl); break;
      case "materials": renderMaterials(box, data, tpl); break;
      case "crossPromo": renderCrossPromo(box, data, tpl); break;
      case "schedule": renderSchedule(box, data, tpl); break;
      case "venueInfo": renderVenue(box, data, tpl); break;
      case "routeText": renderRoute(box, data, tpl); break;
      case "programList": renderProgram(box, data, tpl); break;
      case "castList":
      case "castCards":
        renderPerformer(box, data, tpl); break;
      case "boothList": renderBooth(box, data, tpl); break;
      case "divider": renderDivider(box, data, tpl); break;
      case "footer": renderFooter(box, data, tpl); break;
      case "freeText": renderFreeText(box, data, tpl); break;
      case "freeImageBox": renderFreeImage(box, data, tpl); break;
      default: box.appendChild(el("p", "bb-art-body", "内容模块"));
    }
  }

  function renderCover(box, data, tpl) {
    const img = visualImage(imageSrc(data.mainImage), "bb-art-cover-image", "主视觉图");
    /* imageSize：主视觉高度（0=模板默认）；info/split 模板生效，immersive/minimal 不受影响 */
    const userH = imageSizeOf(data, "imageSize", 0, 1000, 4);
    if (userH > 0 && img) img.style.maxHeight = userH + "px";
    if (tpl === "info") {
      if (img) { const figure = el("div", "bb-cover-figure"); figure.appendChild(img); box.appendChild(figure); }
      const copy = el("div", "bb-cover-info-copy");
      copy.appendChild(el("strong", "bb-art-h1", text(data.title, "活动主标题")));
      if (data.subtitle) copy.appendChild(el("span", "bb-art-subtitle", data.subtitle));
      const lines = (data.infoLines || []).slice(0, 4);
      if (lines.length) { const ul = el("div", "bb-cover-info-lines"); lines.forEach(function (line) { ul.appendChild(el("div", "bb-cover-info-line", line)); }); copy.appendChild(ul); }
      if (data.qqGroupNumber) copy.appendChild(el("div", "bb-cover-qq", "QQ 群：" + data.qqGroupNumber));
      box.appendChild(copy); return;
    }
    if (tpl === "minimal") {
      const copy = el("div", "bb-cover-minimal");
      copy.appendChild(el("strong", "bb-art-h1", text(data.title, "活动主标题")));
      if (data.subtitle) copy.appendChild(el("span", "bb-art-subtitle", data.subtitle));
      const lines = (data.infoLines || []).slice(0, 4);
      if (lines.length) { const ul = el("div", "bb-cover-info-lines"); lines.forEach(function (line) { ul.appendChild(el("div", "bb-cover-info-line", line)); }); copy.appendChild(ul); }
      if (data.qqGroupNumber) copy.appendChild(el("div", "bb-cover-qq", "QQ 群：" + data.qqGroupNumber));
      box.appendChild(copy); return;
    }
    if (tpl === "split") {
      if (img) { const figure = el("div", "bb-cover-figure"); figure.appendChild(img); box.appendChild(figure); }
      const panel = el("div", "bb-cover-panel");
      panel.appendChild(el("strong", "bb-art-h1", text(data.title, "活动主标题")));
      if (data.subtitle) panel.appendChild(el("span", "bb-art-subtitle", data.subtitle));
      const lines = (data.infoLines || []).slice(0, 4);
      if (lines.length) { const ul = el("div", "bb-cover-info-lines"); lines.forEach(function (line) { ul.appendChild(el("div", "bb-cover-info-line", line)); }); panel.appendChild(ul); }
      if (data.qqGroupNumber) panel.appendChild(el("div", "bb-cover-qq", "QQ 群：" + data.qqGroupNumber));
      box.appendChild(panel); return;
    }
    const hero = el("div", "bb-art-cover");
    if (img) hero.appendChild(img);
    const overlay = el("div", "bb-art-cover-copy");
    overlay.appendChild(el("strong", "bb-art-h1", text(data.title, "活动主标题")));
    if (data.subtitle) overlay.appendChild(el("span", "bb-art-subtitle", data.subtitle));
    (data.infoLines || []).slice(0, 3).forEach(function (line) { overlay.appendChild(el("span", "bb-art-info", line)); });
    hero.appendChild(overlay); box.appendChild(hero);
  }

  function renderAnnouncement(box, data, tpl) {
    if (tpl === "quote") {
      const quote = el("div", "bb-announce-quote");
      quote.appendChild(el("span", "bb-quote-mark", "\u201C"));
      quote.appendChild(el("p", "bb-art-body", text(data.body, "重点引语内容")));
      if (data.heading) quote.appendChild(el("span", "bb-quote-source", data.heading));
      box.appendChild(quote); return;
    }
    if (tpl === "plain") {
      if (data.heading) box.appendChild(el("strong", "bb-art-h3", data.heading));
      box.appendChild(el("p", "bb-art-body", text(data.body, "在这里填写活动公告、入场须知或情报说明。"))); return;
    }
    if (tpl === "boxed") {
      const boxed = el("div", "bb-announce-box");
      if (data.heading) boxed.appendChild(el("strong", "bb-art-h3", data.heading));
      boxed.appendChild(el("p", "bb-art-body", text(data.body, "在这里填写活动公告、入场须知或情报说明。")));
      box.appendChild(boxed); return;
    }
    const card = el("div", "bb-announce-notice");
    if (data.heading) card.appendChild(el("strong", "bb-announce-notice-title", data.heading));
    card.appendChild(el("p", "bb-art-body", text(data.body, "在这里填写活动公告、入场须知或情报说明。")));
    box.appendChild(card);
  }

  function renderTicket(box, data, tpl) {
    /* 多平台二维码：与「物料监修」同一套网格逻辑（可添加多条、可选列数）。
       旧草稿的单一 qrImage 自动并入为首条，保持向后兼容。 */
    const qrList = (Array.isArray(data.qrItems) && data.qrItems.length)
      ? data.qrItems
      : (data.qrImage && data.qrImage.url ? [{ icon: data.qrImage, label: "" }] : []);
    const qrPx = imageSizeOf(data, "qrSize", 120, 320, 4) || 208;
    const buildQrGrid = function () {
      if (!qrList.length) return null;
      const wrap = el("div", "bb-ticket-qr-grid");
      wrap.style.setProperty("--bb-mat-icon-size", qrPx + "px");
      addGrid(wrap, qrList, data.qrColumns || "2", "icon", "label", "购票平台");
      return wrap;
    };
    const tiers = data.tiers || [];
    if (tpl === "ticket-cards") {
      const grid = el("div", "bb-ticket-cards");
      tiers.forEach(function (tier) { const card = el("div", "bb-ticket-card"); card.appendChild(el("span", "bb-ticket-card-label", text(tier.label, "票档"))); card.appendChild(el("strong", "bb-ticket-card-price", text(tier.price, "价格"))); grid.appendChild(card); });
      if (!tiers.length) grid.appendChild(el("p", "bb-art-caption", "暂无票档"));
      box.appendChild(grid);
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note));
      const qg = buildQrGrid(); if (qg) box.appendChild(qg); return;
    }
    if (tpl === "ticket-focus") {
      const focus = el("div", "bb-ticket-focus");
      const first = tiers[0];
      if (first) { focus.appendChild(el("strong", "bb-ticket-focus-price", text(first.price, "价格"))); focus.appendChild(el("span", "bb-ticket-focus-label", text(first.label, "票档"))); }
      box.appendChild(focus);
      const rest = tiers.slice(1);
      if (rest.length) { const list = el("div", "bb-ticket-rest"); rest.forEach(function (t) { list.appendChild(el("div", "bb-ticket-rest-item", text(t.label, "") + "\u3000" + text(t.price, ""))); }); box.appendChild(list); }
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note));
      const qg = buildQrGrid(); if (qg) box.appendChild(qg); return;
    }
    if (tpl === "ticket-hero") {
      const first = tiers[0];
      const hero = el("div", "bb-ticket-hero");
      hero.appendChild(el("strong", "bb-ticket-hero-price", text(first ? first.price : "价格", "价格")));
      hero.appendChild(el("span", "bb-ticket-hero-label", text(first ? first.label : "票档", "票档")));
      box.appendChild(hero);
      const rest = tiers.slice(1);
      if (rest.length) { const list = el("div", "bb-ticket-rest"); rest.forEach(function (t) { list.appendChild(el("div", "bb-ticket-rest-item", text(t.label, "") + "\u3000" + text(t.price, ""))); }); box.appendChild(list); }
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note));
      const qg = buildQrGrid(); if (qg) box.appendChild(qg); return;
    }
    const row = el("div", "bb-art-split");
    const copy = el("div");
    tiers.forEach(function (tier) { const p = el("div", "bb-art-ticket"); p.appendChild(el("b", null, text(tier.label, "票档"))); p.appendChild(el("span", null, text(tier.price, "价格"))); copy.appendChild(p); });
    if (!tiers.length) copy.appendChild(el("p", "bb-art-caption", "暂无票档"));
    if (data.note) copy.appendChild(el("p", "bb-art-caption", data.note));
    row.appendChild(copy); const qg = buildQrGrid(); if (qg) row.appendChild(qg); box.appendChild(row);
  }

  function renderMaterials(box, data, tpl) {
    const items = data.items || [];
    if (tpl === "checklist") {
      const list = el("div", "bb-materials-checklist");
      items.forEach(function (item) { list.appendChild(el("div", "bb-checklist-item", text(item.label, "物料条目"))); });
      if (!items.length) list.appendChild(el("p", "bb-art-caption", "暂无条目"));
      box.appendChild(list);
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note)); return;
    }
    if (tpl === "notice-strip") {
      const list = el("div", "bb-materials-strip");
      items.forEach(function (item) { list.appendChild(el("div", "bb-strip-item", text(item.label, "物料条目"))); });
      if (!items.length) list.appendChild(el("p", "bb-art-caption", "暂无条目"));
      box.appendChild(list);
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note)); return;
    }
    /* iconSize：整板块统一图标大小（px，画布坐标系），DOM 预览与导出同源；上限放宽到接近板块容器宽 */
    const size = Math.round(Math.min(600, Math.max(48, Number(data.iconSize) || 104)));
    box.style.setProperty("--bb-mat-icon-size", size + "px");
    addGrid(box, items, data.columns, "icon", "label", "物料条目");
    if (data.note) box.appendChild(el("p", "bb-art-caption", data.note));
  }

  function renderCrossPromo(box, data, tpl) {
    const img = visualImage(imageSrc(data.icon), "bb-art-icon", "联动方图标");
    /* iconSize：联动图标边长（px，画布坐标系），未设置走 CSS 默认 104 */
    const iconPx = imageSizeOf(data, "iconSize", 60, 220, 4);
    if (iconPx && img) { img.style.width = iconPx + "px"; img.style.height = iconPx + "px"; }
    if (tpl === "promo-strip") {
      const strip = el("div", "bb-promo-strip");
      if (img) strip.appendChild(img);
      strip.appendChild(el("p", "bb-art-body", text(data.text, "联动推广文案")));
      box.appendChild(strip); return;
    }
    if (tpl === "promo-centered") {
      const center = el("div", "bb-promo-centered");
      if (img) center.appendChild(img);
      center.appendChild(el("p", "bb-art-body", text(data.text, "联动推广文案")));
      box.appendChild(center); return;
    }
    const row = el("div", "bb-art-split");
    if (img) row.appendChild(img);
    row.appendChild(el("p", "bb-art-body", text(data.text, "联动推广文案")));
    box.appendChild(row);
  }

  function renderSchedule(box, data, tpl) {
    const groups = data.groups || [];
    if (tpl === "schedule-table") {
      groups.forEach(function (group) {
        const tbl = el("div", "bb-schedule-table");
        tbl.appendChild(el("strong", "bb-art-h3", text(group.groupName, "活动时间")));
        (group.rows || []).forEach(function (item) { const r = el("div", "bb-schedule-table-row"); r.appendChild(el("b", null, text(item.time, "00:00"))); r.appendChild(el("span", null, text(item.name, "环节"))); tbl.appendChild(r); });
        box.appendChild(tbl);
      });
      if (!groups.length) box.appendChild(el("p", "bb-art-caption", "暂无时间安排")); return;
    }
    if (tpl === "schedule-cards") {
      groups.forEach(function (group) {
        const card = el("div", "bb-schedule-card");
        card.appendChild(el("strong", "bb-art-h3", text(group.groupName, "活动时间")));
        (group.rows || []).forEach(function (item) { const r = el("div", "bb-schedule-card-row"); r.appendChild(el("span", null, text(item.name, "环节"))); r.appendChild(el("b", null, text(item.time, "00:00"))); card.appendChild(r); });
        box.appendChild(card);
      });
      if (!groups.length) box.appendChild(el("p", "bb-art-caption", "暂无时间安排")); return;
    }
    groups.forEach(function (group) {
      const g = el("div", "bb-art-timeline-group");
      g.appendChild(el("strong", "bb-art-h3", text(group.groupName, "活动时间")));
      (group.rows || []).forEach(function (item) { const r = el("div", "bb-art-time-row"); r.appendChild(el("b", null, text(item.time, "00:00"))); r.appendChild(el("span", null, text(item.name, "环节"))); g.appendChild(r); });
      box.appendChild(g);
    });
    if (!groups.length) box.appendChild(el("p", "bb-art-caption", "暂无时间安排"));
  }

  function renderVenue(box, data, tpl) {
    const img = visualImage(imageSrc(data.photo), "bb-art-side-image", "场地照片");
    /* photoSize：venue-side 模板右侧照片边长（px，画布坐标系），未设置走 CSS 默认 162 */
    const photoPx = imageSizeOf(data, "photoSize", 100, 400, 4);
    if (photoPx && img && tpl !== "venue-focus" && tpl !== "venue-map") { img.style.width = photoPx + "px"; img.style.height = photoPx + "px"; }
    const tags = data.tags || [];
    function buildTags() { const chips = el("div", "bb-venue-tags"); tags.forEach(function (t) { chips.appendChild(el("span", "bb-venue-tag", t)); }); return chips; }
    if (tpl === "venue-focus") {
      if (img) { const figure = el("div", "bb-venue-focus-figure"); figure.appendChild(img); box.appendChild(figure); }
      box.appendChild(el("p", "bb-art-body", text(data.description, "场地描述")));
      if (tags.length) box.appendChild(buildTags()); return;
    }
    if (tpl === "venue-map") {
      const map = el("div", "bb-venue-map");
      map.appendChild(el("p", "bb-art-body", text(data.description, "场地描述")));
      if (tags.length) map.appendChild(buildTags());
      box.appendChild(map); return;
    }
    const row = el("div", "bb-art-split");
    const copy = el("div");
    copy.appendChild(el("p", "bb-art-body", text(data.description, "场地描述")));
    if (tags.length) copy.appendChild(buildTags());
    row.appendChild(copy);
    if (img) row.appendChild(img);
    box.appendChild(row);
  }

  function renderRoute(box, data, tpl) {
    const lines = data.lines || [];
    if (tpl === "route-list") {
      const list = el("div", "bb-route-list");
      lines.forEach(function (line) { list.appendChild(el("div", "bb-route-list-item", line)); });
      if (!lines.length) list.appendChild(el("p", "bb-art-caption", "暂无路线"));
      box.appendChild(list); return;
    }
    if (tpl === "route-focus") {
      const first = lines[0];
      if (first) box.appendChild(el("div", "bb-route-focus", first));
      const rest = lines.slice(1);
      if (rest.length) { const list = el("div", "bb-route-list"); rest.forEach(function (line) { list.appendChild(el("div", "bb-route-list-item", line)); }); box.appendChild(list); }
      if (!lines.length) box.appendChild(el("p", "bb-art-caption", "暂无路线")); return;
    }
    lines.forEach(function (line, index) { const r = el("div", "bb-art-route-row"); r.appendChild(el("b", null, String(index + 1).padStart(2, "0"))); r.appendChild(el("span", null, line)); box.appendChild(r); });
    if (!lines.length) box.appendChild(el("p", "bb-art-caption", "暂无路线"));
  }

  function renderProgram(box, data, tpl) {
    const items = data.items || [];
    if (tpl === "program-cards") {
      const grid = el("div", "bb-program-cards");
      items.forEach(function (item) {
        const card = el("div", "bb-program-card");
        const img = visualImage(imageSrc(item.image), "bb-program-card-image", "节目配图");
        if (img) card.appendChild(img);
        const c = el("div");
        if (item.tag) c.appendChild(el("span", "bb-program-card-tag", item.tag));
        c.appendChild(el("strong", null, text(item.title, "节目标题")));
        if (item.subtitle) c.appendChild(el("span", null, item.subtitle));
        card.appendChild(c); grid.appendChild(card);
      });
      if (!items.length) grid.appendChild(el("p", "bb-art-caption", "暂无节目"));
      box.appendChild(grid); return;
    }
    if (tpl === "program-compact") {
      const grid = el("div", "bb-program-compact");
      items.forEach(function (item) { const cell = el("div", "bb-program-compact-item"); cell.appendChild(el("b", null, text(item.tag, "节目"))); cell.appendChild(el("strong", null, text(item.title, "节目标题"))); grid.appendChild(cell); });
      if (!items.length) grid.appendChild(el("p", "bb-art-caption", "暂无节目"));
      box.appendChild(grid); return;
    }
    items.forEach(function (item) {
      const r = el("div", "bb-art-program-row");
      const img = visualImage(imageSrc(item.image), "bb-art-program-image", "节目配图");
      /* thumbWidth：节目列表配图宽度（px，画布坐标系），未设置走 CSS 默认 162；高度同宽（正方形） */
      const tw = imageSizeOf(data, "thumbWidth", 80, 300, 4);
      if (tw && img) { img.style.width = tw + "px"; img.style.height = tw + "px"; }
      if (item.mediaSide === "left" && img) r.appendChild(img);
      const c = el("div");
      if (item.tag) c.appendChild(el("b", null, text(item.tag, "节目")));
      c.appendChild(el("strong", null, text(item.title, "节目标题")));
      if (item.subtitle) c.appendChild(el("span", null, item.subtitle));
      r.appendChild(c);
      if (item.mediaSide !== "left" && img) r.appendChild(img);
      box.appendChild(r);
    });
    if (!items.length) box.appendChild(el("p", "bb-art-caption", "暂无节目"));
  }

  function renderPerformer(box, data, tpl) {
    const cast = data.cast || [];
    /* 头像尺寸（按比例换算高度，宽度 = avatarWidth 或默认 150） */
    const avatarW = imageSizeOf(data, "avatarWidth", 80, 260, 4) || 150;
    function avatarSize(ratio) {
      const w = avatarW;
      switch (ratio) {
        case "1:1": return { w: w, h: Math.round(w) };
        case "3:4": return { w: w, h: Math.round(w * 4 / 3) };
        case "1:1.4": return { w: w, h: Math.round(w * 1.4) };
        default: return { w: w, h: Math.round(w) };
      }
    }
    function buildAvatar(member) {
      const style = safeClassSuffix(artTheme().avatarStyle, "none");
      const media = el("div", "bb-cast-media " + style);
      const size = avatarSize(member.avatarRatio || "1:1");
      const img = visualImage(imageSrc(member.avatar), "bb-cast-avatar", "头像");
      if (img) { img.style.width = size.w + "px"; img.style.height = size.h + "px"; media.appendChild(img); }
      else { const ph = el("div", "bb-cast-avatar placeholder"); ph.style.width = size.w + "px"; ph.style.height = size.h + "px"; ph.textContent = "未设头像"; media.appendChild(ph); }
      return media;
    }
    function buildSetlist(member) {
      const list = (member.setlist || []).filter(function (s) { return s && (s.song || s.coverBy); });
      if (!list.length) return null;
      const hasCover = list.some(function (s) { return s.coverBy; });
      const wrap = el("div", "bb-setlist" + (hasCover ? "" : " single"));
      const head = el("div", "bb-setlist-head");
      head.appendChild(el("span", null, "歌单"));
      if (hasCover) head.appendChild(el("span", null, "原唱 / Cover"));
      wrap.appendChild(head);
      list.forEach(function (s) {
        const row = el("div", "bb-setlist-row");
        row.appendChild(el("span", "bb-setlist-song", s.song || ""));
        if (hasCover) row.appendChild(el("span", "bb-setlist-cover", s.coverBy || ""));
        wrap.appendChild(row);
      });
      return wrap;
    }
    function buildCopy(member) {
      const c = el("div", "bb-cast-info");
      const head = el("div", "bb-cast-head");
      head.appendChild(el("strong", "bb-art-h3", text(member.name, "成员名称")));
      if (member.role) head.appendChild(el("span", "bb-cast-role", R.castRoleLabel(member.role)));
      if (member.time) head.appendChild(el("span", "bb-cast-time", member.time));
      c.appendChild(head);
      if (member.bio) c.appendChild(el("p", "bb-cast-bio", member.bio));
      const sl = buildSetlist(member);
      if (sl) c.appendChild(sl);
      return c;
    }
    if (tpl === "cast-cards") {
      const grid = el("div", "bb-cast-cards");
      cast.forEach(function (member) {
        const card = el("div", "bb-cast-card");
        card.appendChild(buildAvatar(member));
        card.appendChild(buildCopy(member));
        grid.appendChild(card);
      });
      if (!cast.length) grid.appendChild(el("p", "bb-art-caption", "暂无阵容"));
      box.appendChild(grid); return;
    }
    const list = el("div", "bb-cast-list");
    cast.forEach(function (member) {
      const row = el("div", "bb-cast-member");
      row.appendChild(buildAvatar(member));
      row.appendChild(buildCopy(member));
      list.appendChild(row);
    });
    if (!cast.length) list.appendChild(el("p", "bb-art-caption", "暂无阵容"));
    box.appendChild(list);
  }

  function renderBooth(box, data, tpl) {
    const items = data.items || [];
    /* imageWidth：摊位卡片图边长（px，画布坐标系），未设置走 CSS 默认 150 */
    const boothImgPx = imageSizeOf(data, "imageWidth", 80, 260, 4);
    if (tpl === "booth-cards") {
      const list = el("div", "bb-booth-cards");
      items.forEach(function (item) {
        const card = el("div", "bb-booth-card");
        const img = visualImage(imageSrc(item.image), "bb-booth-card-image", "摊位图");
        if (boothImgPx && img) { img.style.width = boothImgPx + "px"; img.style.height = boothImgPx + "px"; }
        if (img) card.appendChild(img);
        const c = el("div");
        c.appendChild(el("strong", null, text(item.name, "摊位")));
        if (item.desc) c.appendChild(el("span", null, item.desc));
        card.appendChild(c); list.appendChild(card);
      });
      if (!items.length) list.appendChild(el("p", "bb-art-caption", "暂无摊位"));
      box.appendChild(list); return;
    }
    if (tpl === "booth-list") {
      const list = el("div", "bb-booth-list");
      items.forEach(function (item) { const row = el("div", "bb-booth-list-item"); row.appendChild(el("strong", null, text(item.name, "摊位"))); if (item.desc) row.appendChild(el("span", null, item.desc)); list.appendChild(row); });
      if (!items.length) list.appendChild(el("p", "bb-art-caption", "暂无摊位"));
      box.appendChild(list); return;
    }
    /* booth-grid：网格图高度 = imageWidth（px，画布坐标系），未设置走 CSS 默认 187 */
    if (boothImgPx) box.style.setProperty("--bb-mat-icon-size", boothImgPx + "px");
    addGrid(box, items, data.columns, "image", "name", "摊位条目", "desc");
  }

  function renderDivider(box, data, tpl) {
    const themeDiv = artTheme().divider || "wave";
    const raw = (tpl === "wave" && themeDiv !== "wave") ? themeDiv : (tpl || themeDiv);
    const style = ["dots", "line", "glitch", "thread", "dashed"].indexOf(raw) >= 0 ? raw : "wave";
    box.appendChild(el("div", "bb-art-divider " + style, ""));
  }

  function renderFooter(box, data, tpl) {
    const lines = data.lines || [];
    if (tpl === "footer-banner") {
      const banner = el("div", "bb-footer-banner");
      lines.forEach(function (line) { banner.appendChild(el("span", "bb-footer-banner-item", line)); });
      if (!lines.length) banner.appendChild(el("span", "bb-footer-banner-item", "微博 @XXX"));
      box.appendChild(banner); return;
    }
    if (tpl === "footer-center") {
      lines.forEach(function (line) { box.appendChild(el("p", "bb-art-caption bb-caption-center", line)); });
      if (!lines.length) box.appendChild(el("p", "bb-art-caption bb-caption-center", "微博 @XXX")); return;
    }
    if (tpl === "footer-pills") {
      const wrap = el("div", "bb-footer-pills");
      const items = lines.length ? lines : ["主办：Only-box 企划"];
      items.forEach(function (line) { wrap.appendChild(el("span", null, line)); });
      box.appendChild(wrap); return;
    }
    lines.forEach(function (line) { box.appendChild(el("p", "bb-art-caption", line)); });
    if (!lines.length) box.appendChild(el("p", "bb-art-caption", "微博 @XXX"));
  }

  function renderFreeText(box, data, tpl) {
    const cls = "bb-art-free-text " + text(data.level, "body") + " align-" + text(data.align, "left");
    if (tpl === "text-highlight") {
      const hl = el("div", "bb-free-text-highlight");
      hl.appendChild(el("p", cls, text(data.text, "自由文本")));
      box.appendChild(hl); return;
    }
    if (tpl === "text-note") {
      box.appendChild(el("p", "bb-art-free-text bb-free-text-note", text(data.text, "自由文本"))); return;
    }
    if (tpl === "text-card") {
      const card = el("div", "bb-text-card");
      card.appendChild(el("p", cls, text(data.text, "自由文本")));
      box.appendChild(card); return;
    }
    box.appendChild(el("p", cls, text(data.text, "自由文本")));
  }

  function renderFreeImage(box, data, tpl) {
    const img = visualImage(imageSrc(data.image), "bb-art-free-image", "自由图片");
    if (tpl === "image-card") {
      const card = el("div", "bb-free-image-card");
      if (img) card.appendChild(img);
      if (data.caption) card.appendChild(el("p", "bb-art-caption", data.caption));
      box.appendChild(card); return;
    }
    if (img) box.appendChild(img);
    if (data.caption) box.appendChild(el("p", "bb-art-caption", data.caption));
  }

  function addGrid(box, list, columns, imageKey, titleKey, emptyText, descKey) {
    const grid = el("div", "bb-art-grid cols-" + text(columns, "2"));
    (list || []).forEach(function (item) { const cell = el("div", "bb-art-grid-item"); const img = visualImage(imageSrc(item[imageKey]), "bb-art-grid-image", ""); if (img) cell.appendChild(img); cell.appendChild(el("strong", null, text(item[titleKey], emptyText))); if (descKey && item[descKey]) cell.appendChild(el("span", null, item[descKey])); grid.appendChild(cell); });
    if (!list || !list.length) grid.appendChild(el("p", "bb-art-caption", "暂无" + emptyText)); box.appendChild(grid);
  }

  function applyBlockSurface(box, data) {
    const opacity = Number.isFinite(Number(data.blockOpacity)) ? Number(data.blockOpacity) / 100 : .94;
    const st = artTheme();
    box.style.padding = styleCardPad(Math.min(80, Math.max(17, px2(Number(data.padding) != null ? Number(data.padding) : 16))), st) + "px";
    box.style.marginBottom = Math.max(px2(Number(data.marginBottom) || 18), 24) + "px";
    box.style.borderRadius = cardRadius(data, st) + "px";
    box.style.textAlign = data.contentAlign || "left";
    box.style.backgroundColor = cardBaseFill(st, data, opacity);
    box.style.borderStyle = st.cardStyle === "ticket" ? "dashed" : "solid";
    box.style.borderWidth = (st.cardStyle === "panel" ? 2.5 : st.cardStyle === "sticker" ? 7 : st.cardStyle === "glass" ? 1.5 : st.cardStyle === "ink" ? 2 : 2) + "px";
    box.style.borderColor = data.blockBorderColor || (st.cardStyle === "panel" ? st.primaryDark : st.cardStyle === "sticker" ? alphaColor(st.primary, 0.9) : st.cardStyle === "glass" ? alphaColor("#ffffff", 0.7) : st.cardStyle === "ink" ? alphaColor(st.primaryDark, 0.75) : st.cardStyle === "ticket" ? alphaColor(st.primary, 0.45) : alphaColor(st.primary, 0.16));
    let domShadow = st.shadow === "hard" ? "6px 7px 0 " + alphaColor(st.primaryDark, 0.85)
      : st.shadow === "glow" ? "0 4px 22px " + alphaColor(st.primary, 0.5)
      : st.shadow === "none" ? "none"
      : "0 12px 26px rgba(38,65,51,.15)";
    if (st.cardStyle === "sticker") domShadow += ", inset 0 0 0 3px #ffffff";
    if (st.cardStyle === "ink") domShadow += ", inset 0 0 0 1px " + alphaColor(st.primary, 0.35);
    box.style.boxShadow = domShadow;
    box.classList.remove("bb-card-card", "bb-card-panel", "bb-card-glass", "bb-card-ink", "bb-card-ticket", "bb-card-sticker");
    box.classList.add("bb-card-" + safeClassSuffix(st.cardStyle, "card"));
    if (data.blockBgImage && data.blockBgImage.url) { box.style.backgroundImage = "url(\"" + data.blockBgImage.url + "\")"; box.style.backgroundSize = "cover"; box.style.backgroundPosition = "center"; }
    box.dataset.imageRatio = data.imageRatio || "auto";
    box.dataset.imageFit = data.imageFit || "cover";
  }

  function applyBodyFontScope(rootEl) {
    if (!rootEl) return;
    rootEl.style.fontFamily = C.bodyFontStack(state.doc);
  }

  function buildModule(page, module, index) {
    const def = R.getDef(module.type);
    const tpl = module.data.template || "";
    const box = el("article", "bb-art-module width-" + text(module.data.width, "full") + " bb-tpl-" + module.type + "-" + (tpl || "default"));
    box.dataset.action = "module-pick"; box.dataset.moduleId = module.id; box.dataset.template = tpl;
    if (module.id === state.selectedModuleId) box.classList.add("is-selected");
    applyBlockSurface(box, module.data);
    const head = el("div", "bb-art-module-head");
    const title = el("div", "bb-art-module-title");
    title.appendChild(el("span", "bb-art-kicker", "0" + (index + 1)));
    title.appendChild(el("strong", "bb-art-h2", moduleTitle(module, def)));
    head.appendChild(title);
    const actions = el("div", "bb-art-actions");
    actions.style.setProperty("--bb-btn-comp", String(1 / Math.max(0.05, state.zoom || 1)));
    const up = el("button", "bb-icon-btn", "\u2191"); up.type = "button"; up.title = "上移"; up.disabled = index === 0; up.dataset.action = "module-up"; up.dataset.moduleId = module.id;
    const down = el("button", "bb-icon-btn", "\u2193"); down.type = "button"; down.title = "下移"; down.disabled = index === page.modules.length - 1; down.dataset.action = "module-down"; down.dataset.moduleId = module.id;
    const remove = el("button", "bb-icon-btn danger", "\u00D7"); remove.type = "button"; remove.title = "删除模块"; remove.dataset.action = "module-del"; remove.dataset.moduleId = module.id;
    actions.appendChild(up); actions.appendChild(down); actions.appendChild(remove); head.appendChild(actions); box.appendChild(head);
    addVisualBody(box, module);
    box.querySelectorAll(".bb-art-body,.bb-art-caption,.bb-setlist-item,.bb-setlist-song,.bb-setlist-cover,.bb-cast-bio,.bb-cover-qq,.bb-quote-source,.bb-art-free-text,.bb-art-info,.bb-art-subtitle").forEach(applyBodyFontScope);
    box.querySelectorAll("img").forEach(function (image) {
      image.style.objectFit = dataImageFit(module.data);
      if (module.data.imageRatio && module.data.imageRatio !== "auto") image.style.aspectRatio = module.data.imageRatio.replace(":", " / ");
    });
    const bodyAlign = module.data.bodyAlign;
    if (bodyAlign === "left" || bodyAlign === "center" || bodyAlign === "right") {
      box.querySelectorAll(".bb-art-body,.bb-art-caption,.bb-art-free-text,.bb-announce-notice-title,.bb-cover-qq,.bb-quote-source").forEach(function (node) { node.classList.add("bb-txt-" + bodyAlign); });
    }
    return box;
  }

  /* ===== 第 0 步 throwaway 预览卡（Task #16）：空文档时的主题/背景观感演示 =====
     纯 DOM 展示（bb-dom-only，不进导出），全部取色走主题 CSS 变量，
     切主题/换背景/微调颜色实时反映。不写入 doc，进入步骤 1 后自然消失。 */
  function buildThemeBgPreviewCard() {
    const wrap = el("div", "bb-tbg-preview bb-dom-only");
    const tag = el("div", "bb-tbg-preview-tag", "预览示意");
    tag.title = "这是空文档时的临时预览，仅用于查看主题与背景效果，不会保存或导出";
    wrap.appendChild(tag);

    const hero = el("div", "bb-tbg-preview-hero");
    hero.appendChild(el("div", "bb-tbg-preview-kicker", "ONLY BOX \u00B7 LIVE"));
    hero.appendChild(el("div", "bb-tbg-preview-title", "主题预览标题"));
    hero.appendChild(el("div", "bb-tbg-preview-sub", "这是当前主题的标题与正文观感"));
    wrap.appendChild(hero);

    const card = el("div", "bb-tbg-preview-card");
    card.appendChild(el("div", "bb-tbg-preview-card-title", "板块卡片样式"));
    const lines = el("div", "bb-tbg-preview-lines");
    ["正文行示例：当前主题的正文颜色与行距", "强调信息用主题强调色高亮显示"].forEach(function (text) {
      lines.appendChild(el("span", null, text));
    });
    card.appendChild(lines);
    const chips = el("div", "bb-tbg-preview-chips");
    ["标签一", "标签二", "标签三"].forEach(function (text) {
      chips.appendChild(el("span", "bb-tbg-preview-chip", text));
    });
    card.appendChild(chips);
    wrap.appendChild(card);

    const btn = el("div", "bb-tbg-preview-btn", "主题按钮色");
    wrap.appendChild(btn);
    return wrap;
  }

  function buildPage(page, index, continuous) {
    const card = el("section", "bb-page-card"); card.dataset.pageId = page.id;
    const isActive = page.id === state.activePageId;
    if (!continuous && isActive) card.classList.add("is-active");
    if (!continuous) {
      const head = el("header", "bb-page-head"); const title = el("div", "bb-page-title"); title.appendChild(el("strong", "bb-page-index", "第 " + (index + 1) + " 屏")); title.appendChild(el("span", "bb-page-meta", page.modules.length + " 个板块 \u00B7 " + pageSize().pageWidth + " \u00D7 " + pageSize().pageHeight)); head.appendChild(title);
      const del = el("button", "bb-text-btn danger", "删除本屏"); del.type = "button"; del.dataset.action = "page-del"; del.dataset.pageId = page.id; head.appendChild(del); card.appendChild(head);
    }
    const canvas = el("div", "bb-page-canvas"); canvas.dataset.action = "page-pick"; canvas.dataset.pageId = page.id; canvas.style.aspectRatio = pageSize().pageWidth + " / " + pageSize().pageHeight;
    if (continuous) { if (isActive) canvas.classList.add("is-active"); canvas.style.width = "100%"; }
    else { canvas.style.width = pageSize().pageWidth + "px"; canvas.style.zoom = state.zoom; }
    canvas.dataset.theme = state.doc.theme || "forest";
    canvas.style.fontFamily = C.headingFontStack(state.doc);
    applyThemeVars(canvas);
    canvas.style.setProperty("--bb-font-heading", C.headingFontStack(state.doc));
  /* 方案 \u00A72.2：DOM 预览字重吸附\u2014\u2014标题基准 800 吸附到当前标题字体实际档位 */
  canvas.style.setProperty("--bb-weight-heading", String(C.snapWeight(C.FONTS[state.doc.headingFont || state.doc.fontFamily || "sans"] || C.FONTS.sans, 800)));
    canvas.style.setProperty("--bb-font-body", C.bodyFontStack(state.doc));
    canvas.style.setProperty("--bb-page-bg", effectiveBackgroundColor(page));
    canvas.classList.add("bb-pattern-" + safeClassSuffix(artTheme().pattern, "none"));
    if (continuous) {
      if (page.backgroundColor) canvas.style.backgroundColor = page.backgroundColor;
      const pageParamBg = docBackgroundOf(page);
      if (pageParamBg) {
        const url = parametricBackgroundDataUrl(pageParamBg, pageSize().pageWidth, pageSize().pageHeight);
        if (url) { canvas.style.backgroundImage = "url(\"" + url + "\")"; canvas.style.backgroundSize = "100% 100%"; }
      }
    } else {
      const pageColor = effectiveBackgroundColor(page);
      canvas.style.backgroundColor = pageColor;
      const pageImage = backgroundPatternActive(page) ? null : (page.backgroundImage || state.doc.backgroundImage);
      if (pageImage && pageImage.url) { canvas.style.backgroundImage = docBackgroundStyle(pageImage); canvas.style.backgroundSize = "cover"; }
      const pageParamBg = docBackgroundOf(page);
      const docParamBg = docBackgroundOf(state.doc);
      const paramBg = pageParamBg || docParamBg;
      if (paramBg) {
        const url = parametricBackgroundDataUrl(paramBg, pageSize().pageWidth, pageSize().pageHeight);
        if (url) { canvas.style.backgroundImage = "url(\"" + url + "\")"; canvas.style.backgroundSize = "100% 100%"; }
      }
    }
    if (!page.modules.length) {
      if (state.step === "theme-bg") {
        /* 第 0 步空文档：throwaway 预览（纯 DOM 演示卡，不入文档不导出），
           让用户在选主题/背景时看到真实观感；进入后续步骤自动消失。 */
        canvas.appendChild(buildThemeBgPreviewCard());
      } else if (continuous) {
        /* 连续模式空屏：不显示\u300C添加第一个板块\u300D提示，仅留轻量可点选占位；导出时整块隐藏不占高度 */
        canvas.classList.add("bb-empty-screen", "bb-dom-only");
      } else {
        canvas.appendChild(el("div", "bb-page-empty bb-dom-only", "从左侧\u300C板块库\u300D添加第一个板块，即可预览主题效果。"));
      }
    }
    else {
      const rows = M.packModuleRows(page.modules);
      rows.forEach(function (row) {
        if (row.kind === "pair") {
          const pair = el("div", "bb-art-module-row");
          row.modules.forEach(function (module) {
            if (module.visible !== false) pair.appendChild(buildModule(page, module, page.modules.indexOf(module)));
          });
          canvas.appendChild(pair);
        } else if (row.modules[0].visible !== false) {
          canvas.appendChild(buildModule(page, row.modules[0], page.modules.indexOf(row.modules[0])));
        }
      });
    }
    if (continuous) {
      const tag = el("div", "bb-slice-tag"); tag.dataset.action = "page-pick"; tag.dataset.pageId = page.id; tag.title = "选择第 " + (index + 1) + " 屏";
      tag.appendChild(el("span", null, "第 " + (index + 1) + " 屏"));
      const del = el("button", null, "\u00D7"); del.type = "button"; del.title = "删除本屏"; del.dataset.action = "page-del"; del.dataset.pageId = page.id;
      tag.appendChild(del); canvas.appendChild(tag);
    }
    card.appendChild(canvas); return card;
  }

  function renderCanvas() {
    const keep = els.canvasBody.scrollTop; const frag = document.createDocumentFragment();
    if (continuousMode()) {
      const strip = el("div", "bb-strip");
      strip.style.width = pageSize().pageWidth + "px"; strip.style.zoom = state.zoom;
      strip.style.backgroundColor = state.doc.backgroundColor || "#ffffff";
      /* 图案背景激活时忽略整条底图（图案自带底色铺底），避免双层背景冲突 */
      const stripParamBg = docBackgroundOf(state.doc);
      if (!stripParamBg && state.doc.backgroundImage && state.doc.backgroundImage.url) { strip.style.backgroundImage = docBackgroundStyle(state.doc.backgroundImage); strip.style.backgroundSize = "cover"; }
      state.doc.pages.forEach(function (page, index) { strip.appendChild(buildPage(page, index, true)); });
      strip.style.fontFamily = C.headingFontStack(state.doc);
      applyThemeVars(strip);
      strip.classList.add("bb-pattern-" + safeClassSuffix(artTheme().pattern, "none"));
      frag.appendChild(strip);
    } else {
      state.doc.pages.forEach(function (page, index) { frag.appendChild(buildPage(page, index, false)); });
    }
    els.canvasBody.style.setProperty("--bb-view-zoom", String(state.zoom || 1));
    els.canvasBody.classList.toggle("bb-continuous", continuousMode());
    els.canvasBody.textContent = ""; els.canvasBody.appendChild(frag); els.canvasBody.scrollTop = keep;
  }

  global.BannerBuilderPreview = {
    setState: setState,
    setContext: setContext,
    renderCanvas: renderCanvas
  };
})(window);
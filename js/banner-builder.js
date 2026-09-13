(function (global) {
  "use strict";

  const C = global.BannerBuilderConstants;
  const R = global.BannerBuilderRegistry;
  const M = global.BannerBuilderModel;
  const MI = global.BannerBuilderModuleImporter;
  const state = {
    doc: M.createDoc(C.DEFAULT_RATIO),
    activePageId: null,
    selectedModuleId: null,
    pickMode: "screen",
    zoom: 0.46,
    step: "setup",
  };
  const els = {};
  let inputId = 0;
  let initialized = false;
  let framePending = false;
  const fontLinks = {};

  function ensureFont(key) {
    const f = C.FONTS[key] || C.FONTS.sans;
    (f.css || []).forEach(function (url) {
      if (fontLinks[url]) return;
      fontLinks[url] = true;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      document.head.appendChild(link);
    });
    /* 单字体文件源（用户追加 / 本地字体）：无 @fontsource css 可引，改由 C.fontFaceFor
       合成 @font-face 内联注入，按 family 去重（同族只注入一次）。 */
    if (Array.isArray(f.src) && f.src.length) {
      const faceKey = "faceref:" + f.family;
      if (fontLinks[faceKey]) return;
      fontLinks[faceKey] = true;
      const css = C.fontFaceFor(f);
      if (!css) return;
      const style = document.createElement("style");
      style.id = "bb-font-face-" + key;
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  function showFontFallbackNotice(family) {
    if (document.getElementById("bb-font-notice")) return;
    const bar = document.createElement("div");
    bar.id = "bb-font-notice";
    bar.style.cssText = "margin:10px 0 0;padding:9px 13px;border:1px solid #e0c07a;border-radius:9px;background:#faf3df;color:#715b1e;font-size:12px;font-weight:700";
    bar.textContent = "在线字体（" + family + "）加载失败，已回退系统近似字体，导出效果可能与选择不符；网络恢复后可重新选择字体。";
    const shell = document.querySelector(".bb-shell");
    if (shell && shell.parentNode) shell.parentNode.insertBefore(bar, shell);
  }

  async function readyFontForText(key, text) {
    const f = C.FONTS[key] || C.FONTS.sans;
    ensureFont(key);
    if (!document.fonts || typeof document.fonts.load !== "function") return;
    const payload = String(text || "Only-box 活动宣传长条 0123456789");
    try {
      const faces = await document.fonts.load("400 24px \"" + f.family + "\"", payload);
      await document.fonts.load("700 24px \"" + f.family + "\"", payload);
      if (f.css && f.css.length > 3) await document.fonts.load("900 24px \"" + f.family + "\"", payload);
      if (!faces || !faces.length) showFontFallbackNotice(f.family);
    } catch (error) { /* 字体加载失败时使用回退字体渲染 */ }
  }

  /* 导出字体门禁：标题/正文两种角色的 webfont 全部就绪（含中文分片按需命中）才开始导出。 */
  async function readyFontsForPage(page) {
    if (!document.fonts || typeof document.fonts.load !== "function") return;
    const headingKey = state.doc.headingFont || state.doc.fontFamily || "sans";
    const bodyKey = state.doc.bodyFont || headingKey;
    const payload = ((state.doc.pages || []).map(collectPageText).join(" ") + " " + collectPageText(page) + " 0123456789").slice(0, 4000);
    const jobs = [];
    [headingKey, bodyKey].forEach(function (key) {
      const f = C.FONTS[key];
      if (!f) return;
      ensureFont(key);
      ["400", "700", "900"].forEach(function (weight) {
        try { jobs.push(document.fonts.load(weight + ' 24px "' + f.family + '"', payload)); } catch (error) { /* 忽略单档失败 */ }
      });
    });
    try { await Promise.all(jobs); if (document.fonts.ready) await document.fonts.ready; } catch (error) { /* 超时/失败时按已就绪字体导出 */ }
  }

  function collectPageText(page) {
    const parts = [];
    (page.modules || []).forEach(function (module) {
      const data = module.data || {};
      Object.keys(data).forEach(function (key) {
        const value = data[key];
        if (typeof value === "string") parts.push(value);
        else if (Array.isArray(value)) value.forEach(function (item) {
          if (typeof item === "string") parts.push(item);
          else if (item) Object.keys(item).forEach(function (k) { if (typeof item[k] === "string") parts.push(item[k]); });
        });
      });
    });
    return parts.join(" ");
  }

  function docFontFamily() {
    return state.doc.fontFamily || "sans";
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function activePage() {
    return M.findPage(state.doc, state.activePageId) || state.doc.pages[state.doc.pages.length - 1];
  }

  function activePageIndex() {
    return state.doc.pages.indexOf(activePage());
  }

  function pageSize() {
    return C.pageSize(state.doc.ratio);
  }

  function continuousMode() {
    return (state.doc.screenMode || "split") === "continuous";
  }

  /* 主题变量内联写入（单一数据源 = C.THEMES）。
     旧实现依赖 [data-theme=...] CSS 规则，新增主题没写规则时会回落站点默认色（切主题失效）。
     现在所有主题一律走这里，CSS 规则保留仅为兜底。 */
  function applyThemeVars(rootEl) {
    if (!rootEl || !rootEl.style) return;
    const theme = artTheme();
    rootEl.style.setProperty("--ob-primary", theme.primary);
    rootEl.style.setProperty("--ob-primary-dark", theme.primaryDark);
    rootEl.style.setProperty("--ob-primary-soft", theme.primarySoft);
    rootEl.style.setProperty("--ob-accent", theme.accent);
    rootEl.style.setProperty("--ob-accent-soft", theme.accentSoft);
    rootEl.style.setProperty("--bb-line", theme.line);
    rootEl.style.setProperty("--bb-soft", theme.soft);
  }

  function docBackgroundStyle(value) {
    if (!value || !value.url) return "";
    return "linear-gradient(rgba(255,255,255,.18),rgba(255,255,255,.18)),url(\"" + value.url + "\")";
  }

  function imageSrc(value) {
    return value && value.url ? value.url : "";
  }

  function dataImageFit(data) {
    return data && data.imageFit === "contain" ? "contain" : "cover";
  }

  function hexToRgba(value, alpha) {
    const raw = String(value || "").trim().replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(raw)) return "";
    const number = parseInt(raw, 16);
    return "rgba(" + ((number >> 16) & 255) + "," + ((number >> 8) & 255) + "," + (number & 255) + "," + Math.max(0, Math.min(1, alpha)) + ")";
  }

  function imageField(field, obj, id) {
    const wrap = el("div", "bb-image-field");
    const preview = el("div", "bb-image-preview");
    const current = obj[field.key];
    if (imageSrc(current)) {
      const img = el("img", "bb-image-thumb");
      img.src = current.url;
      img.alt = current.name || "已选图片";
      preview.appendChild(img);
    } else preview.appendChild(el("span", "bb-image-empty", "未选择"));
    const actions = el("div", "bb-image-actions");
    const pick = el("label", "bb-file-btn", "选择图片");
    pick.htmlFor = id;
    const input = el("input");
    input.type = "file";
    input.id = id;
    input.accept = "image/*";
    input.className = "bb-file-input";
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (!file) return;
      obj[field.key] = { url: URL.createObjectURL(file), name: file.name, type: file.type };
      renderAll();
    });
    pick.appendChild(input);
    actions.appendChild(pick);
    if (current && current.url) {
      const clear = el("button", "bb-mini-btn", "移除");
      clear.type = "button";
      clear.addEventListener("click", function () { obj[field.key] = null; renderAll(); });
      actions.appendChild(clear);
    }
    actions.appendChild(el("span", "bb-image-name", current && current.name ? current.name : "仅在浏览器本地处理"));
    wrap.appendChild(preview);
    wrap.appendChild(actions);
    return wrap;
  }

  function defaultFor(field) {
    if (field.type === "select") return field.options && field.options[0] ? field.options[0].value : "";
    if (field.type === "number") return 0;
    if (field.type === "image" || field.type === "imageList") return field.type === "imageList" ? [] : null;
    if (field.type === "stringList" || field.type === "objectList") return [];
    return "";
  }

  function newEntry(field) {
    const value = {};
    (field.fields || []).forEach(function (sub) { value[sub.key] = defaultFor(sub); });
    return value;
  }

  function buildField(field, obj, moduleType) {
    const wrap = el("div", "bb-field");
    const id = "bb-input-" + (++inputId);
    if (field.dynamicOptions === "templates") {
      field = Object.assign({}, field, { options: R.templateOptions(moduleType) });
    }
    if (field.type === "image") return imageField(field, obj, id);
    if (field.type === "stringList") return buildStringList(field, obj, wrap);
    if (field.type === "objectList") return buildObjectList(field, obj, wrap);
    if (field.type === "imageList") return buildImageList(field, obj, wrap);

    const label = el("label", "bb-field-label", field.label);
    label.htmlFor = id;
    wrap.appendChild(label);
    let input;
    if (field.type === "textarea") {
      input = el("textarea", "bb-input");
      input.rows = field.rows || 4;
    } else if (field.type === "select") {
      input = el("select", "bb-input");
      if (field.dynamicOptions === "templates") input.dataset.templateField = "1";
      (field.options || []).forEach(function (option) {
        const item = el("option", null, option.label);
        item.value = option.value;
        input.appendChild(item);
      });
    } else if (field.type === "color") {
      input = el("input", "bb-input bb-color-input");
      input.type = "color";
    } else {
      input = el("input", "bb-input");
      input.type = field.type === "number" ? "number" : "text";
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;
    }
    input.id = id;
    input.value = obj[field.key] == null ? "" : String(obj[field.key]);
    if (field.type === "color" && !input.value) input.value = field.fallback || "#ffffff";
    if (field.placeholder) input.placeholder = field.placeholder;
    input.addEventListener(field.type === "select" ? "change" : "input", function () {
      obj[field.key] = field.type === "number" ? Number(input.value) || 0 : input.value;
      if (field.type === "select") renderAll(); else scheduleCanvas();
    });
    wrap.appendChild(input);
    if (field.type === "color" && field.optional) {
      const clear = el("button", "bb-mini-btn", "跟随默认");
      clear.type = "button";
      clear.title = "清除本屏底色，跟随整条背景";
      clear.addEventListener("click", function () { obj[field.key] = ""; renderAll(); });
      wrap.appendChild(clear);
    }
    if (field.options === R.LEVEL_OPTIONS) {
      const warning = C.captionWarning(obj[field.key], pageSize().pageWidth);
      wrap.appendChild(el("p", "bb-hint" + (warning ? " warn" : ""), warning || "字号按画布宽度比例保存"));
    }
    return wrap;
  }

  function buildStringList(field, obj, wrap) {
    const list = Array.isArray(obj[field.key]) ? obj[field.key] : (obj[field.key] = []);
    const head = el("div", "bb-field-head");
    head.appendChild(el("span", "bb-field-label", field.label));
    head.appendChild(el("span", "bb-count", list.length + " 项"));
    const add = el("button", "bb-add-btn", "＋ 添加" + (field.itemLabel || "一行"));
    add.type = "button";
    add.addEventListener("click", function () { list.push(""); renderAll(); });
    head.appendChild(add);
    wrap.appendChild(head);
    const body = el("div", "bb-list");
    list.forEach(function (value, index) {
      const row = el("div", "bb-list-row");
      const input = el("input", "bb-input");
      input.value = value || "";
      input.placeholder = field.placeholder || "请输入内容";
      input.addEventListener("input", function () { list[index] = input.value; scheduleCanvas(); });
      const del = el("button", "bb-icon-btn danger", "×");
      del.type = "button";
      del.title = "删除这一项";
      del.addEventListener("click", function () { list.splice(index, 1); renderAll(); });
      row.appendChild(input); row.appendChild(del); body.appendChild(row);
    });
    if (!list.length) body.appendChild(el("p", "bb-hint", "还没有内容，点击添加。"));
    wrap.appendChild(body);
    return wrap;
  }

  function buildObjectList(field, obj, wrap) {
    const list = Array.isArray(obj[field.key]) ? obj[field.key] : (obj[field.key] = []);
    const head = el("div", "bb-field-head");
    head.appendChild(el("span", "bb-field-label", field.label));
    head.appendChild(el("span", "bb-count", list.length + " 项"));
    const add = el("button", "bb-add-btn", "＋ 添加" + (field.itemLabel || "一条"));
    add.type = "button";
    add.addEventListener("click", function () { list.push(newEntry(field)); renderAll(); });
    head.appendChild(add); wrap.appendChild(head);
    list.forEach(function (entry, index) {
      const card = el("div", "bb-entry");
      const title = el("div", "bb-entry-head");
      title.appendChild(el("span", "bb-entry-title", (field.itemLabel || "条目") + " " + (index + 1)));
      const del = el("button", "bb-icon-btn danger", "×");
      del.type = "button";
      del.title = "删除这一项";
      del.addEventListener("click", function () { list.splice(index, 1); renderAll(); });
      title.appendChild(del); card.appendChild(title);
      const body = el("div", "bb-entry-body");
      (field.fields || []).forEach(function (sub) { body.appendChild(buildField(sub, entry)); });
      card.appendChild(body); wrap.appendChild(card);
    });
    if (!list.length) wrap.appendChild(el("p", "bb-hint", "还没有内容，点击添加。"));
    return wrap;
  }

  function buildImageList(field, obj, wrap) {
    const list = Array.isArray(obj[field.key]) ? obj[field.key] : (obj[field.key] = []);
    const head = el("div", "bb-field-head");
    head.appendChild(el("span", "bb-field-label", field.label));
    head.appendChild(el("span", "bb-count", list.length + " / " + (field.max || 4)));
    const id = "bb-input-" + (++inputId);
    const add = el("label", "bb-add-btn", "＋ 添加图片");
    add.htmlFor = id;
    const input = el("input");
    input.id = id; input.type = "file"; input.accept = "image/*"; input.className = "bb-file-input";
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (!file || list.length >= (field.max || 4)) return;
      list.push({ url: URL.createObjectURL(file), name: file.name, type: file.type }); renderAll();
    });
    add.appendChild(input); head.appendChild(add); wrap.appendChild(head);
    const grid = el("div", "bb-image-grid");
    list.forEach(function (item, index) {
      const cell = el("div", "bb-image-cell");
      const img = el("img", "bb-image-thumb"); img.src = item.url; img.alt = item.name || "已选图片";
      const del = el("button", "bb-icon-btn danger", "×"); del.type = "button"; del.title = "移除这张图片";
      del.addEventListener("click", function () { list.splice(index, 1); renderAll(); });
      cell.appendChild(img); cell.appendChild(del); grid.appendChild(cell);
    });
    if (list.length) wrap.appendChild(grid); else wrap.appendChild(el("p", "bb-hint", "还没有图片，点击添加。"));
    return wrap;
  }

  function text(value, fallback) { return String(value || fallback || ""); }
  function moduleTitle(module, def) { return module.data.sectionTitle || def.label; }

  function visualImage(src, cls, alt) {
    if (!src) return null;
    const img = el("img", cls || "bb-art-image"); img.src = src; img.alt = alt || ""; return img;
  }

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
      case "performerCard": renderPerformer(box, data, tpl); break;
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
      quote.appendChild(el("span", "bb-quote-mark", "“"));
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
    const qr = visualImage(imageSrc(data.qrImage), "bb-art-qr", "购票二维码");
    const tiers = data.tiers || [];
    if (tpl === "ticket-cards") {
      const grid = el("div", "bb-ticket-cards");
      tiers.forEach(function (tier) { const card = el("div", "bb-ticket-card"); card.appendChild(el("span", "bb-ticket-card-label", text(tier.label, "票档"))); card.appendChild(el("strong", "bb-ticket-card-price", text(tier.price, "价格"))); grid.appendChild(card); });
      if (!tiers.length) grid.appendChild(el("p", "bb-art-caption", "暂无票档"));
      box.appendChild(grid);
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note));
      if (qr) box.appendChild(el("div", "bb-ticket-qr-wrap", qr)); return;
    }
    if (tpl === "ticket-focus") {
      const focus = el("div", "bb-ticket-focus");
      const first = tiers[0];
      if (first) { focus.appendChild(el("strong", "bb-ticket-focus-price", text(first.price, "价格"))); focus.appendChild(el("span", "bb-ticket-focus-label", text(first.label, "票档"))); }
      if (qr) focus.appendChild(qr);
      box.appendChild(focus);
      const rest = tiers.slice(1);
      if (rest.length) { const list = el("div", "bb-ticket-rest"); rest.forEach(function (t) { list.appendChild(el("div", "bb-ticket-rest-item", text(t.label, "") + "　" + text(t.price, ""))); }); box.appendChild(list); }
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note)); return;
    }
    if (tpl === "ticket-hero") {
      const first = tiers[0];
      const hero = el("div", "bb-ticket-hero");
      hero.appendChild(el("strong", "bb-ticket-hero-price", text(first ? first.price : "价格", "价格")));
      hero.appendChild(el("span", "bb-ticket-hero-label", text(first ? first.label : "票档", "票档")));
      box.appendChild(hero);
      const rest = tiers.slice(1);
      if (rest.length) { const list = el("div", "bb-ticket-rest"); rest.forEach(function (t) { list.appendChild(el("div", "bb-ticket-rest-item", text(t.label, "") + "　" + text(t.price, ""))); }); box.appendChild(list); }
      if (qr) box.appendChild(el("div", "bb-ticket-qr-wrap", qr));
      if (data.note) box.appendChild(el("p", "bb-art-caption", data.note)); return;
    }
    const row = el("div", "bb-art-split");
    const copy = el("div");
    tiers.forEach(function (tier) { const p = el("div", "bb-art-ticket"); p.appendChild(el("b", null, text(tier.label, "票档"))); p.appendChild(el("span", null, text(tier.price, "价格"))); copy.appendChild(p); });
    if (!tiers.length) copy.appendChild(el("p", "bb-art-caption", "暂无票档"));
    if (data.note) copy.appendChild(el("p", "bb-art-caption", data.note));
    row.appendChild(copy); if (qr) row.appendChild(qr); box.appendChild(row);
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
    addGrid(box, items, data.columns, "icon", "label", "物料条目");
    if (data.note) box.appendChild(el("p", "bb-art-caption", data.note));
  }

  function renderCrossPromo(box, data, tpl) {
    const img = visualImage(imageSrc(data.icon), "bb-art-icon", "联动方图标");
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
    /* 头像尺寸（按比例换算高度，宽度固定为设计宽的一定比例） */
    function avatarSize(ratio) {
      const w = 150;
      switch (ratio) {
        case "1:1": return { w: w, h: Math.round(w) };
        case "3:4": return { w: w, h: Math.round(w * 4 / 3) };
        case "1:1.4": return { w: w, h: Math.round(w * 1.4) };
        default: return { w: w, h: Math.round(w) };
      }
    }
    function buildAvatar(member) {
      const style = artTheme().avatarStyle || "none";
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
    if (tpl === "booth-cards") {
      const list = el("div", "bb-booth-cards");
      items.forEach(function (item) {
        const card = el("div", "bb-booth-card");
        const img = visualImage(imageSrc(item.image), "bb-booth-card-image", "摊位图");
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
    box.classList.add("bb-card-" + (st.cardStyle || "card"));
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
    const up = el("button", "bb-icon-btn", "↑"); up.type = "button"; up.title = "上移"; up.disabled = index === 0; up.dataset.action = "module-up"; up.dataset.moduleId = module.id;
    const down = el("button", "bb-icon-btn", "↓"); down.type = "button"; down.title = "下移"; down.disabled = index === page.modules.length - 1; down.dataset.action = "module-down"; down.dataset.moduleId = module.id;
    const remove = el("button", "bb-icon-btn danger", "×"); remove.type = "button"; remove.title = "删除模块"; remove.dataset.action = "module-del"; remove.dataset.moduleId = module.id;
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

  function buildPage(page, index, continuous) {
    const card = el("section", "bb-page-card"); card.dataset.pageId = page.id;
    const isActive = page.id === state.activePageId;
    if (!continuous && isActive) card.classList.add("is-active");
    if (!continuous) {
      const head = el("header", "bb-page-head"); const title = el("div", "bb-page-title"); title.appendChild(el("strong", "bb-page-index", "第 " + (index + 1) + " 屏")); title.appendChild(el("span", "bb-page-meta", page.modules.length + " 个板块 · " + pageSize().pageWidth + " × " + pageSize().pageHeight)); head.appendChild(title);
      const del = el("button", "bb-text-btn danger", "删除本屏"); del.type = "button"; del.dataset.action = "page-del"; del.dataset.pageId = page.id; head.appendChild(del); card.appendChild(head);
    }
    const canvas = el("div", "bb-page-canvas"); canvas.dataset.action = "page-pick"; canvas.dataset.pageId = page.id; canvas.style.aspectRatio = pageSize().pageWidth + " / " + pageSize().pageHeight;
    if (continuous) { if (isActive) canvas.classList.add("is-active"); canvas.style.width = "100%"; }
    else { canvas.style.width = pageSize().pageWidth + "px"; canvas.style.zoom = state.zoom; }
    canvas.dataset.theme = state.doc.theme || "forest";
    canvas.style.fontFamily = C.headingFontStack(state.doc);
    applyThemeVars(canvas);
    canvas.style.setProperty("--bb-font-heading", C.headingFontStack(state.doc));
    canvas.style.setProperty("--bb-font-body", C.bodyFontStack(state.doc));
    canvas.style.setProperty("--bb-page-bg", page.backgroundColor || state.doc.backgroundColor || "#ffffff");
    canvas.classList.add("bb-pattern-" + (artTheme().pattern || "none"));
    if (continuous) {
      if (page.backgroundColor) canvas.style.backgroundColor = page.backgroundColor;
      if (page.backgroundImage && page.backgroundImage.url) { canvas.style.backgroundImage = docBackgroundStyle(page.backgroundImage); canvas.style.backgroundSize = "cover"; }
    } else {
      const pageColor = page.backgroundColor || state.doc.backgroundColor || "#ffffff";
      canvas.style.backgroundColor = pageColor;
      const pageImage = page.backgroundImage || state.doc.backgroundImage;
      if (pageImage && pageImage.url) { canvas.style.backgroundImage = docBackgroundStyle(pageImage); canvas.style.backgroundSize = "cover"; }
    }
    if (!page.modules.length) { const emptyTip = el("div", "bb-page-empty bb-dom-only", state.step === "edit" ? "从左侧添加第一个板块，开始制作真实长条。" : "切换到「编辑」步骤，开始添加板块内容。"); canvas.appendChild(emptyTip); }
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
      const del = el("button", null, "×"); del.type = "button"; del.title = "删除本屏"; del.dataset.action = "page-del"; del.dataset.pageId = page.id;
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
      if (state.doc.backgroundImage && state.doc.backgroundImage.url) { strip.style.backgroundImage = docBackgroundStyle(state.doc.backgroundImage); strip.style.backgroundSize = "cover"; }
      state.doc.pages.forEach(function (page, index) { strip.appendChild(buildPage(page, index, true)); });
      strip.style.fontFamily = C.headingFontStack(state.doc);
      applyThemeVars(strip);
      strip.classList.add("bb-pattern-" + (artTheme().pattern || "none"));
      frag.appendChild(strip);
    } else {
      state.doc.pages.forEach(function (page, index) { frag.appendChild(buildPage(page, index, false)); });
    }
    els.canvasBody.style.setProperty("--bb-view-zoom", String(state.zoom || 1));
    els.canvasBody.classList.toggle("bb-continuous", continuousMode());
    els.canvasBody.textContent = ""; els.canvasBody.appendChild(frag); els.canvasBody.scrollTop = keep;
  }

  function renderToolbar() {
    const size = pageSize(); els.sizeReadout.textContent = size.pageWidth + " × " + size.pageHeight + " px";
    Array.prototype.forEach.call(els.ratioGroup.querySelectorAll("[data-ratio]"), function (button) { const active = button.dataset.ratio === state.doc.ratio; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", active ? "true" : "false"); });
    els.zoomValue.textContent = Math.round(state.zoom * 100) + "%"; els.stats.textContent = state.doc.pages.length + " 屏 · " + M.countModules(state.doc) + " 个板块";
    els.themeSelect.value = state.doc.theme || "forest"; els.fontSelect.value = state.doc.fontFamily || "sans"; els.headingFontSelect.value = state.doc.headingFont || ""; els.bodyFontSelect.value = state.doc.bodyFont || "";
    if (els.backgroundColorInput) {
      const scopeColor = (els.backgroundScope && els.backgroundScope.value === "page") ? activePage().backgroundColor : state.doc.backgroundColor;
      els.backgroundColorInput.value = (scopeColor || "#ffffff");
    }
    Array.prototype.forEach.call(els.screenModeGroup.querySelectorAll("[data-screen]"), function (button) { const active = button.dataset.screen === (state.doc.screenMode || "split"); button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", active ? "true" : "false"); });
    const scale = Number(state.doc.exportScale) || 2;
    if (els.exportScaleGroup) Array.prototype.forEach.call(els.exportScaleGroup.querySelectorAll("[data-scale]"), function (button) { const active = Number(button.dataset.scale) === scale; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", active ? "true" : "false"); });
    if (els.exportSizeReadout) els.exportSizeReadout.textContent = (size.pageWidth * scale) + " × " + (size.pageHeight * scale) + " px";
    syncStep();
    syncPickMode();
  }

  /* ===== 三步向导：同步步骤条、对应工具栏显隐、工作区库栏显隐、属性面板 ===== */
  function syncStep() {
    if (!els.stepBar) return;
    Array.prototype.forEach.call(els.stepBar.querySelectorAll(".bb-step"), function (button) {
      const active = button.dataset.step === state.step;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    ["setup", "edit", "export"].forEach(function (key) {
      const bar = els.stepToolbars[key];
      if (bar) bar.hidden = key !== state.step;
    });
    if (els.workbench) els.workbench.classList.toggle("hide-library", state.step !== "edit");
  }

  function renderLibrary() {
    els.libraryList.textContent = ""; const frag = document.createDocumentFragment();
    R.MODULE_ORDER.forEach(function (type) { const button = el("button", "bb-lib-item"); button.type = "button"; button.dataset.action = "lib-add"; button.dataset.type = type; button.appendChild(el("span", "bb-lib-text", R.getDef(type).label)); button.appendChild(el("span", "bb-lib-plus", "+")); frag.appendChild(button); });
    if (MI) {
      MI.loadAll().forEach(function (record) {
        const button = el("button", "bb-lib-item bb-lib-custom"); button.type = "button"; button.dataset.action = "lib-add-custom"; button.dataset.customId = record.id;
        button.appendChild(el("span", "bb-lib-text", "★ " + record.label)); button.appendChild(el("span", "bb-lib-plus", "+"));
        if (record.description) button.title = record.description;
        frag.appendChild(button);
      });
    }
    els.libraryList.appendChild(frag); els.libraryHint.textContent = "点击板块，添加到第 " + (activePageIndex() + 1) + " 屏";
  }

  /* ===== 我的模板（IndexedDB 本地持久化）===== */
  async function renderMyTemplates() {
    els.myTplArea.hidden = true; els.myTplList.textContent = "";
    if (!global.BannerBuilderMyTemplates || !global.BannerBuilderMyTemplates.isAvailable()) return;
    let rows;
    try { rows = await global.BannerBuilderMyTemplates.listTemplates(); } catch (error) { return; }
    if (!rows || !rows.length) return;
    els.myTplArea.hidden = false; els.myTplCount.textContent = rows.length + " 个";
    rows.forEach(function (row) {
      const def = R.getDef(row.type);
      const item = el("div", "bb-lib-item bb-mytpl-item"); item.dataset.action = "tpl-add"; item.dataset.tplId = row.id; item.title = "点击把整个板块（含文字与图片）加入当前屏";
      item.appendChild(el("span", "bb-lib-text", "★ " + row.name));
      item.appendChild(el("span", "bb-mytpl-type", def ? def.label : row.type));
      const del = el("button", "bb-mytpl-del", "×"); del.type = "button"; del.title = "删除此模板"; del.dataset.action = "tpl-del"; del.dataset.tplId = row.id;
      item.appendChild(del); els.myTplList.appendChild(item);
    });
  }

  async function saveSelectedModuleAsTemplate() {
    const hit = M.findModule(state.doc, state.selectedModuleId);
    if (!hit.module || !global.BannerBuilderMyTemplates) return;
    const def = R.getDef(hit.module.type);
    const suggested = def.label + " 模板";
    let name = suggested;
    if (global.prompt) { const raw = global.prompt("给我的模板起个名字（留空用默认）", suggested); if (raw === null) return; name = (raw || "").trim() || suggested; }
    try {
      const data = await global.BannerBuilderMyTemplates.snapshotData(hit.module.data);
      await global.BannerBuilderMyTemplates.saveTemplate({ id: C.uid(), type: hit.module.type, name: name, createdAt: Date.now(), data: data });
      renderMyTemplates();
    } catch (error) { if (global.alert) global.alert("模板保存失败（浏览器可能不支持本地存储）：" + ((error && error.message) || error)); }
  }

  function addCustomModuleToPage(customId) {
    if (!MI) return;
    const record = MI.loadAll().filter(function (item) { return item.id === customId; })[0];
    if (!record) return;
    const module = M.addModule(state.doc, activePage().id, record.type);
    if (!module) return;
    module.data = Object.assign({}, module.data, JSON.parse(JSON.stringify(record.data || {})));
    migrateModuleData(module);
    state.selectedModuleId = module.id; renderAll(); if (continuousMode()) scrollSelectedIntoView();
  }

  function showModuleImportModal() {
    if (!MI) return;
    const existing = document.getElementById("bb-module-modal"); if (existing) existing.remove();
    const mask = document.createElement("div"); mask.className = "bb-modal-mask"; mask.id = "bb-module-modal";
    const modal = document.createElement("div"); modal.className = "bb-modal";
    const title = document.createElement("h3"); title.textContent = "导入板块模块"; modal.appendChild(title);
    const intro = document.createElement("p"); intro.textContent = "复制提示词给其他 AI，让 AI 输出 JSON；导入后会出现在板块库的自定义模块区域。"; modal.appendChild(intro);
    const promptArea = document.createElement("textarea"); promptArea.className = "bb-input bb-modal-textarea"; promptArea.readOnly = true; promptArea.value = MI.promptText; modal.appendChild(promptArea);
    const inputArea = document.createElement("textarea"); inputArea.className = "bb-input bb-modal-textarea"; inputArea.placeholder = "把 AI 返回的 JSON 粘贴到这里"; modal.appendChild(inputArea);
    const msg = document.createElement("div"); modal.appendChild(msg);
    const actions = document.createElement("div"); actions.className = "bb-modal-actions";
    const copyBtn = document.createElement("button"); copyBtn.className = "bb-btn ghost"; copyBtn.type = "button"; copyBtn.textContent = "复制提示词";
    copyBtn.addEventListener("click", function () { promptArea.select(); try { document.execCommand("copy"); msg.className = "bb-modal-success"; msg.textContent = "提示词已复制"; } catch (error) { msg.textContent = "请手动复制上方提示词"; } });
    const importBtn = document.createElement("button"); importBtn.className = "bb-btn primary"; importBtn.type = "button"; importBtn.textContent = "导入模块";
    importBtn.addEventListener("click", function () { const obj = MI.extractJson(inputArea.value); if (!obj) { msg.className = "bb-modal-error"; msg.textContent = "JSON 格式解析失败"; return; } const errors = MI.validate(obj); if (errors.length) { msg.className = "bb-modal-error"; msg.textContent = "校验不通过：" + errors.join("；"); return; } try { MI.add(obj); renderLibrary(); msg.className = "bb-modal-success"; msg.textContent = "板块模块「" + obj.label + "」已导入"; } catch (error) { msg.className = "bb-modal-error"; msg.textContent = "保存失败：" + error.message; } });
    const closeBtn = document.createElement("button"); closeBtn.className = "bb-btn ghost"; closeBtn.type = "button"; closeBtn.textContent = "关闭"; closeBtn.addEventListener("click", function () { mask.remove(); });
    actions.appendChild(copyBtn); actions.appendChild(importBtn); actions.appendChild(closeBtn); modal.appendChild(actions); mask.appendChild(modal); document.body.appendChild(mask);
  }

  async function addTemplateToPage(tplId) {
    if (!global.BannerBuilderMyTemplates) return;
    let rows = [];
    try { rows = await global.BannerBuilderMyTemplates.listTemplates(); } catch (error) { return; }
    const row = rows.filter(function (record) { return record.id === tplId; })[0];
    if (!row) { renderMyTemplates(); return; }
    const module = M.addModule(state.doc, activePage().id, row.type);
    if (!module) return;
    module.data = Object.assign({}, module.data, global.BannerBuilderMyTemplates.cloneTemplateData(row.data));
    migrateModuleData(module);
    state.selectedModuleId = module.id; renderAll(); if (continuousMode()) scrollSelectedIntoView();
  }

  function deleteMyTemplate(tplId) {
    if (!global.BannerBuilderMyTemplates) return;
    if (!global.confirm("删除这个「我的模板」？不会影响已放进画布的板块。")) return;
    global.BannerBuilderMyTemplates.removeTemplate(tplId).then(renderMyTemplates, function () {});
  }

  function buildSurfacePanel() {
    const wrap = el("div"); wrap.appendChild(el("p", "bb-hint", "点击画布空白处编辑整条或当前屏背景。"));
    wrap.appendChild(buildField({ key: "name", label: "草稿名称", type: "text" }, state.doc));
    wrap.appendChild(buildField({ key: "backgroundColor", label: "整条底色", type: "color", fallback: "#ffffff" }, state.doc));
    wrap.appendChild(buildField({ key: "backgroundImage", label: "整条底图", type: "image" }, state.doc));
    const page = activePage(); if (page) { wrap.appendChild(el("div", "bb-panel-divider", "当前第 " + (activePageIndex() + 1) + " 屏")); wrap.appendChild(buildField({ key: "backgroundColor", label: "本屏底色", type: "color", fallback: state.doc.backgroundColor || "#ffffff", optional: true }, page)); wrap.appendChild(buildField({ key: "backgroundImage", label: "本屏底图", type: "image" }, page)); }
    return wrap;
  }

  function renderPanel() {
    els.panelBody.textContent = "";
    if (state.step === "export") { els.panelTitle.textContent = "导出与备份"; els.panelSub.textContent = "选择输出方式，导出高清图片或可编辑文件"; els.panelBody.appendChild(buildExportPanel()); return; }
    const hit = M.findModule(state.doc, state.selectedModuleId);
    if (!hit.module) { els.panelTitle.textContent = "整条 / 当前屏"; els.panelSub.textContent = state.step === "setup" ? "第 1 步 · 设置整条背景与名称" : "画布真实预览 · 点模块编辑板块"; els.panelBody.appendChild(buildSurfacePanel()); return; }
    const def = R.getDef(hit.module.type); els.panelTitle.textContent = def.label; els.panelSub.textContent = "第 " + (hit.pageIndex + 1) + " 屏 · 可编辑文字、图片与版式";
    const saveRow = el("div", "bb-field"); const saveBtn = el("button", "bb-file-btn", "☆ 存为我的模板"); saveBtn.type = "button"; saveBtn.dataset.action = "save-tpl"; saveBtn.title = "把当前这整个板块（含文字、配色、图片与版式）存成「我的模板」，浏览器本地保存，刷新后仍在"; saveRow.appendChild(saveBtn); els.panelBody.appendChild(saveRow);
    (def.fields || []).forEach(function (field) { els.panelBody.appendChild(buildField(field, hit.module.data, hit.module.type)); });
  }

  /* ===== 第三步导出面板（右侧属性栏），与顶部导出按钮共用同一批导出函数 ===== */
  function buildExportPanel() {
    const wrap = el("div", "bb-export-panel");
    const size = pageSize();
    const scale = Number(state.doc.exportScale) || 2;
    const hint = el("p", "bb-export-hint");
    hint.innerHTML = "";
    hint.appendChild(document.createTextNode("当前输出倍率 " + scale + "x，单屏导出为 " + (size.pageWidth * scale) + " × " + (size.pageHeight * scale) + " 像素。倍率越高越清晰、文件越大。"));
    wrap.appendChild(hint);

    const main = el("div", "bb-export-main");
    function btn(cls, label, sub, handler, primary) {
      const b = el("button", cls + (primary ? " primary" : ""), label);
      b.type = "button";
      if (sub) b.appendChild(el("small", null, sub));
      b.addEventListener("click", function () { handler(); });
      main.appendChild(b);
    }
    main.appendChild(el("div", "bb-panel-divider", "图片导出"));
    btn("bb-export-btn", "导出当前屏", "PNG · " + (size.pageWidth * scale) + "×" + (size.pageHeight * scale), function () { exportPng(false); }, true);
    btn("bb-export-btn", "导出全部屏", "多屏逐个下载 PNG", function () { exportPng(true); });
    btn("bb-export-btn", "导出连续长图", "全部屏拼成一张 PNG（需连续模式）", exportStripPng);
    main.appendChild(el("div", "bb-panel-divider", "可编辑文件"));
    btn("bb-export-btn", "导出 PSD", "分层可编辑（可选打包字体）", function () {
      exportPsd().then(function (result) {
        if (result && els.packFontsToggle && els.packFontsToggle.checked) {
          packFontsZip().catch(function (e) { if (global.alert) global.alert("字体打包失败：" + ((e && e.message) || e)); });
        }
      }).catch(function (e) { if (global.alert) global.alert("导出失败：" + ((e && e.message) || e)); });
    });
    main.appendChild(el("div", "bb-panel-divider", "草稿"));
    btn("bb-export-btn", "备份草稿", "含图片，跨会话不丢", saveDraft);
    wrap.appendChild(main);
    return wrap;
  }

  function renderAll() {
    try {
      renderToolbar(); renderLibrary(); renderCanvas(); renderPanel();
    } catch (error) {
      try {
        els.canvasBody.textContent = "";
        const bug = el("div", "bb-page-empty", "界面渲染出现异常：" + (error && error.message || error) + "。请刷新页面重试；若反复出现请导出草稿反馈。");
        bug.classList.add("bb-dom-only");
        els.canvasBody.appendChild(bug);
      } catch (_) {}
      if (global.console && global.console.error) global.console.error("renderAll error:", error);
    }
  }
  /* 连续模式跟随：新增屏后让新屏顶部对齐可视区上沿（新屏在最下）。 */
  function scrollCanvasToBottom() {
    const target = document.querySelector("#canvasBody .bb-page-canvas.is-active") || document.querySelector(".bb-strip");
    if (!target) return;
    if (typeof target.scrollIntoView === "function") {
      try { target.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (error) { target.scrollIntoView(); }
      return;
    }
    if (!els.canvasBody) return;
    try { els.canvasBody.scrollTo({ top: els.canvasBody.scrollHeight, behavior: "smooth" }); } catch (error) { els.canvasBody.scrollTop = els.canvasBody.scrollHeight; }
  }
  function scrollSelectedIntoView() {
    const node = document.querySelector("#canvasBody .bb-art-module.is-selected");
    if (!node || typeof node.scrollIntoView !== "function") return;
    try { node.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (error) { node.scrollIntoView(); }
  }
  function scheduleCanvas() { if (framePending) return; framePending = true; global.requestAnimationFrame(function () { framePending = false; renderCanvas(); renderToolbar(); }); }

  function downloadBlob(blob, name) { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000); }
  function downloadText(content, name) { downloadBlob(new Blob([content], { type: "application/json;charset=utf-8" }), name); }
  function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) throw new Error("数据格式错误");
    const meta = dataUrl.slice(0, comma).match(/^data:([^;]+)/);
    const mime = meta ? meta[1] : "application/octet-stream";
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  const wrapCache = new Map();
  function wrapLines(ctx, value, maxWidth) {
    const key = ctx.font + "|" + Math.round(maxWidth) + "|" + value;
    const hit = wrapCache.get(key);
    if (hit) return hit;
    const result = []; String(value || "").split("\n").forEach(function (line) { let current = ""; Array.from(line).forEach(function (char) { const next = current + char; if (ctx.measureText(next).width > maxWidth && current) { result.push(current); current = char; } else current = next; }); result.push(current); });
    if (wrapCache.size > 4000) wrapCache.clear();
    wrapCache.set(key, result);
    return result;
  }

  function loadImage(value) { return new Promise(function (resolve) { if (!imageSrc(value)) return resolve(null); const image = new Image(); image.onload = function () { resolve(image); }; image.onerror = function () { resolve(null); }; image.src = imageSrc(value); }); }

  /* ================================================================
     导出画质：15 类板块按「预览模板」还原成 canvas 绘制（主题色系、
     卡片底色/边框/圆角、图文排版），供分屏 / 全部 / 连续长图导出共用。
     ================================================================ */

  /* 主题色：与 DOM 预览同源（C.THEMES[theme]），保证导出观感随主题变化。
     themeOverrides（设置步骤「微调主题」）在此叠加：用户手动覆盖的字段优先，未覆盖回退预设。 */
  function artTheme() {
    const base = C.themeStyle(state.doc.theme);
    const ov = state.doc.themeOverrides || {};
    const merged = Object.assign({}, base);
    Object.keys(ov).forEach(function (k) {
      const v = ov[k];
      if (v !== null && v !== undefined && v !== "") merged[k] = v;
    });
    return merged;
  }

  /* ===== 主题风格绘制辅助（卡片骨架/形状/底纹），DOM 与 Canvas 双侧共用同名概念 ===== */
  let pageBgColorForHoles = "#ffffff";
  let noiseCanvas = null;
  function noisePattern(ctx) {
    if (!noiseCanvas) {
      noiseCanvas = document.createElement("canvas"); noiseCanvas.width = 64; noiseCanvas.height = 64;
      const nc = noiseCanvas.getContext("2d");
      const img = nc.createImageData(64, 64);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 110 + Math.floor(Math.random() * 130);
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      nc.putImageData(img, 0, 0);
    }
    return ctx.createPattern(noiseCanvas, "repeat");
  }
  function cardRadius(data, st) {
    const user = Number(data.radius);
    const base = (user === 13 || !Number.isFinite(user)) ? (st.radius != null ? st.radius : 27) : user;
    return Math.max(0, Math.round(base));
  }
  function cardRadiusDom(data, st) {
    return cardRadius(data, st);
  }
  function styleCardPad(base, st) {
    if (st.cardStyle === "ticket") return base + 20;
    if (st.cardStyle === "panel") return base + 2;
    return base;
  }
  function cardBaseFill(st, data, opacity) {
    if (data.blockBgColor) return hexToRgba(data.blockBgColor, opacity) || data.blockBgColor;
    switch (st.cardStyle) {
      case "glass": return alphaColor("#ffffff", Math.min(0.62, opacity * 0.66));
      case "ink": return alphaColor(st.soft, 0.97);
      case "panel": return alphaColor("#ffffff", 0.94);
      case "ticket": return alphaColor("#ffffff", 0.97);
      case "sticker": return alphaColor("#ffffff", 0.96);
      default: return cardFillStyle(data, "#ffffff");
    }
  }
  function drawCardBase(ctx, x, y, w, h, r, st, data, opacity) {
    ctx.save();
    if (st.shadow === "hard") {
      ctx.fillStyle = alphaColor(st.primaryDark, 0.85);
      roundRectPath(ctx, x + 6, y + 7, w, h, r); ctx.fill();
    } else if (st.shadow === "glow") {
      ctx.shadowColor = alphaColor(st.primary, 0.5); ctx.shadowBlur = 22; ctx.shadowOffsetY = 4;
    } else if (st.shadow === "soft") {
      ctx.shadowColor = "rgba(38,65,51,.15)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 12;
    }
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = cardBaseFill(st, data, opacity);
    ctx.fill();
    ctx.restore();
  }
  function drawCardBorder(ctx, x, y, w, h, r, st, data) {
    ctx.save();
    const userColor = data.blockBorderColor || "";
    if (st.cardStyle === "panel") {
      ctx.strokeStyle = userColor || st.primaryDark; ctx.lineWidth = 2.5;
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
    } else if (st.cardStyle === "glass") {
      ctx.strokeStyle = userColor || alphaColor("#ffffff", 0.7); ctx.lineWidth = 1.5;
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
      ctx.strokeStyle = alphaColor(st.primary, 0.35); ctx.lineWidth = 1;
      roundRectPath(ctx, x + 2, y + 2, w - 4, h - 4, Math.max(1, r - 2)); ctx.stroke();
    } else if (st.cardStyle === "ink") {
      ctx.strokeStyle = userColor || alphaColor(st.primaryDark, 0.75); ctx.lineWidth = 2;
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
      ctx.strokeStyle = alphaColor(st.primary, 0.5); ctx.lineWidth = 1;
      roundRectPath(ctx, x + 8, y + 8, w - 16, h - 16, Math.max(1, r - 7)); ctx.stroke();
    } else if (st.cardStyle === "ticket") {
      ctx.strokeStyle = userColor || alphaColor(st.primary, 0.45); ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 7]);
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
      ctx.setLineDash([]);
    } else if (st.cardStyle === "sticker") {
      ctx.strokeStyle = userColor || alphaColor(st.primary, 0.9); ctx.lineWidth = 7;
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
      roundRectPath(ctx, x + 5, y + 5, w - 10, h - 10, Math.max(1, r - 4)); ctx.stroke();
    } else {
      ctx.strokeStyle = userColor || alphaColor(st.primary, 0.16); ctx.lineWidth = 2;
      roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
    }
    ctx.restore();
  }
  function drawCardDecor(ctx, x, y, w, h, r, st) {
    ctx.save();
    if (st.cardStyle === "panel") {
      roundRectPath(ctx, x, y, w, h, r); ctx.clip();
      ctx.fillStyle = st.accent; ctx.fillRect(x, y, 26, 26);
      ctx.restore(); ctx.save();
    }
    if (st.cardStyle === "ticket") {
      const r0 = 13;
      const holes = [{ cx: x, cy: y + h / 2 }, { cx: x + w, cy: y + h / 2 }];
      holes.forEach(function (pos) {
        ctx.beginPath(); ctx.arc(pos.cx, pos.cy, r0, 0, Math.PI * 2);
        ctx.fillStyle = pageBgColorForHoles || "#ffffff"; ctx.fill();
        ctx.strokeStyle = alphaColor(st.primary, 0.4); ctx.lineWidth = 1.5; ctx.stroke();
      });
    }
    ctx.restore();
  }
  function drawPatternOverlay(ctx, w, h, st) {
    ctx.save();
    if (st.pattern === "grid") {
      ctx.globalAlpha = 0.05; ctx.strokeStyle = st.primaryDark; ctx.lineWidth = 1;
      for (let gx = 0; gx <= w; gx += 48) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (let gy = 0; gy <= h; gy += 48) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
    } else if (st.pattern === "dots") {
      ctx.globalAlpha = 0.06; ctx.fillStyle = st.primary;
      for (let gy = 18; gy < h; gy += 36) for (let gx = 18; gx < w; gx += 36) { ctx.beginPath(); ctx.arc(gx, gy, 2, 0, Math.PI * 2); ctx.fill(); }
    } else if (st.pattern === "stripes") {
      ctx.globalAlpha = 0.04; ctx.strokeStyle = st.primary; ctx.lineWidth = 5;
      for (let gx = -h; gx < w; gx += 56) { ctx.beginPath(); ctx.moveTo(gx, h); ctx.lineTo(gx + h, 0); ctx.stroke(); }
    } else if (st.pattern === "noise") {
      const nz = noisePattern(ctx);
      if (nz) { ctx.globalAlpha = 0.04; ctx.fillStyle = nz; ctx.fillRect(0, 0, w, h); }
    } else if (st.pattern === "paper") {
      ctx.globalAlpha = 0.035; ctx.strokeStyle = st.primaryDark; ctx.lineWidth = 1;
      for (let gx = -h; gx < w; gx += 90) { ctx.beginPath(); ctx.moveTo(gx, h); ctx.lineTo(gx + h, 0); ctx.stroke(); }
    }
    ctx.restore();
  }
  function chipPath(ctx, x, y, bw, bh, size, shape) {
    if (shape === "tag") {
      const sl = Math.round(bh * 0.35);
      ctx.beginPath();
      ctx.moveTo(x + sl, y);
      ctx.lineTo(x + bw, y);
      ctx.lineTo(x + bw - sl, y + bh);
      ctx.lineTo(x, y + bh);
      ctx.closePath();
    } else {
      roundRectPath(ctx, x, y, bw, bh, shape === "squared" ? Math.round(size * 0.18) : Math.round(bh / 2));
    }
  }
  /* 750 设计宽度空间：导出坐标与预览 CSS px 同一单位（px2 保留为兼容别名）。 */
  function px2(v) {
    return Math.max(1, Math.round((Number(v) || 0) * 2.08));
  }
  /* canvas 只认 100 一档的 numeric font-weight，兜底 clamp 到最接近档位。 */
  function artWeight(v) {
    return v >= 900 ? 900 : v >= 800 ? 800 : v >= 600 ? 600 : v >= 500 ? 500 : 400;
  }
  function artFont(ctx, size, weight, scope) {
    const key = scope === "body"
      ? (state.doc.bodyFont || state.doc.headingFont || state.doc.fontFamily || "sans")
      : (state.doc.headingFont || state.doc.fontFamily || "sans");
    ctx.font = artWeight(weight || 400) + " " + size + "px " + C.fontStack(key);
  }
  function artInk() {
    return "#20251f";
  }
  function artMuted() {
    return "#6a706c";
  }
  function alphaColor(value, alpha) {
    const raw = hexToRgba(value, alpha);
    return raw || value || "";
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }
  function coverDraw(ctx, image, x, y, w, h) {
    if (!image || !w || !h) return;
    const ir = image.width / image.height;
    const tr = w / h;
    let sw = image.width, sh = image.height, sx = 0, sy = 0;
    if (ir > tr) { sw = image.height * tr; sx = (image.width - sw) / 2; }
    else { sh = image.width / tr; sy = (image.height - sh) / 2; }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }
  function containDraw(ctx, image, x, y, w, h) {
    if (!image || !w || !h) return;
    const ir = image.width / image.height;
    const tr = w / h;
    let dw = w, dh = h, dx = 0, dy = 0;
    if (ir > tr) { dw = w; dh = w / ir; dy = (h - dh) / 2; }
    else { dh = h; dw = h * ir; dx = (w - dw) / 2; }
    ctx.drawImage(image, dx, dy, dw, dh);
  }
  /* 取图片应显示比例：模块级 imageRatio 优先，其次原图自然比例，缺省 1:1。 */
  function artImageRatio(data, image) {
    const raw = (data && data.imageRatio) || "auto";
    if (raw && raw !== "auto") {
      const m = String(raw).replace(/\s+/g, "").match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/);
      if (m && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]);
    }
    if (image && image.width && image.height) return image.width / image.height;
    return 1;
  }
  function artImageHeight(data, image, w) {
    return Math.round(w / artImageRatio(data, image));
  }
  /* 当前模块的卡片底色：没有自定义底色时 = 半透明白（与 DOM 默认一致）。 */
  function cardFillStyle(data, ink) {
    const opacity = Number.isFinite(Number(data.blockOpacity)) ? Number(data.blockOpacity) / 100 : 0.94;
    if (data.blockBgColor) { const raw = hexToRgba(data.blockBgColor, opacity); return raw || data.blockBgColor; }
    return alphaColor(ink || "#ffffff", opacity);
  }

  /* 文本排版：支持 左/中/右；返回用尽后(含行距)的 y。
     与旧 drawText 同构但显式携带字号/字重/行距倍数。 */
  function drawRich(ctx, value, x, y, maxWidth, size, weight, color, align, lineMul, scope) {
    ctx.save();
    artFont(ctx, size, weight, scope);
    ctx.fillStyle = color || artInk();
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    const step = Math.round(size * (lineMul || 1.45));
    const lines = wrapLines(ctx, String(value || ""), Math.max(10, maxWidth));
    lines.forEach(function (line, index) { ctx.fillText(line, x, y + index * step); });
    ctx.restore();
    return y + Math.max(1, lines.length) * step;
  }
  /* 只测高度的排版辅助：行数 × 步进，供「先铺底、后写字」的内衬面板计算高度。 */
  function textBlockInfo(ctx, value, maxWidth, size, weight, lineMul, scope) {
    ctx.save();
    artFont(ctx, size, weight || 400, scope);
    const step = Math.round(size * (lineMul || 1.45));
    const count = wrapLines(ctx, String(value || ""), Math.max(10, maxWidth)).length;
    ctx.restore();
    return { count: count, step: step, height: Math.max(1, count) * step };
  }
  /* 从 bottom 界向上排版一个文本块（供封面沉浸底部锚定），返回块顶(可作为上方块的新 bottom)。 */
  function paintUpText(ctx, value, x, bottom, maxWidth, size, weight, color, align, lineMul, scope) {
    const info = textBlockInfo(ctx, value, maxWidth, size, weight, lineMul, scope);
    const step = info.step;
    const count = info.count;
    const yStart = bottom - (count - 1) * step - Math.round(size * 0.3);
    ctx.save();
    artFont(ctx, size, weight, scope);
    ctx.fillStyle = color || artInk();
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    const lines = wrapLines(ctx, String(value || ""), Math.max(10, maxWidth));
    lines.forEach(function (line, index) { ctx.fillText(line, x, yStart + index * step); });
    ctx.restore();
    return yStart - Math.round(size * 0.78);
  }
  /* 圆角胶囊 chips：自动换行；返回下一行起始 y。 */
  function drawChips(ctx, items, x, y, maxWidth, opt) {
    if (!items || !items.length) return y;
    const o = opt || {};
    const shape = o.shape || artTheme().chips || "pill";
    const size = o.size || 23;
    const gap = Math.round(size * 0.6);
    const padX = Math.round(size * 0.95);
    const lh = Math.round(size * 1.85);
    ctx.save();
    artFont(ctx, size, o.weight || 500, o.scope);
    ctx.textAlign = "left";
    const measure = function (label) { return { label: label, bw: ctx.measureText(label).width + padX * 2 }; };
    const rowsLayout = [];
    let row = []; let rowW = 0;
    (items || []).forEach(function (item) {
      const label = String(item || "");
      if (!label) return;
      const chip = measure(label);
      if (row.length && rowW + chip.bw + gap > maxWidth) { rowsLayout.push({ row: row, width: rowW }); row = []; rowW = 0; }
      row.push(chip); rowW += chip.bw + (row.length > 1 ? gap : 0);
    });
    if (row.length) rowsLayout.push({ row: row, width: rowW });
    const padTop = Math.round(size * 0.72);
    let cy = y;
    if (o.center) {
      rowsLayout.forEach(function (line) {
        let sx = x - line.width / 2;
        line.row.forEach(function (chip) {
          if (o.fill) { ctx.fillStyle = o.fill; chipPath(ctx, sx, cy - padTop, chip.bw, Math.round(size * 1.5), size, shape); ctx.fill(); }
          if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = o.lw || 2; chipPath(ctx, sx, cy - padTop, chip.bw, Math.round(size * 1.5), size, shape); ctx.stroke(); }
          ctx.fillStyle = o.color || artInk();
          ctx.fillText(chip.label, sx + padX, cy + Math.round(size * 0.32));
          sx += chip.bw + gap;
        });
        cy += lh;
      });
    } else {
      let cx = x;
      rowsLayout.forEach(function (line) {
        line.row.forEach(function (chip) {
          if (o.fill) { ctx.fillStyle = o.fill; chipPath(ctx, cx, cy - padTop, chip.bw, Math.round(size * 1.5), size, shape); ctx.fill(); }
          if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = o.lw || 2; chipPath(ctx, cx, cy - padTop, chip.bw, Math.round(size * 1.5), size, shape); ctx.stroke(); }
          ctx.fillStyle = o.color || artInk();
          ctx.fillText(chip.label, cx + padX, cy + Math.round(size * 0.32));
          cx += chip.bw + gap;
        });
        cy += lh;
        cx = x;
      });
    }
    ctx.restore();
    return cy;
  }
  /* 只量 chips 高度（行数 × 行高），供「先铺底、后排版」的布局预估。 */
  function chipRowCount(ctx, items, maxWidth, size, scope) {
    const gap = Math.round(size * 0.6);
    const padX = Math.round(size * 0.95);
    ctx.save();
    artFont(ctx, size, 500, scope);
    let rows = 1; let rowW = 0;
    (items || []).forEach(function (item) {
      const label = String(item || "");
      if (!label) return;
      const bw = ctx.measureText(label).width + padX * 2;
      if (rowW > 0 && rowW + bw + gap > maxWidth) { rows += 1; rowW = bw; }
      else rowW += bw + (rowW > 0 ? gap : 0);
    });
    ctx.restore();
    if (!items || !items.filter(function (i) { return String(i || ""); }).length) return 0;
    return rows * Math.round(size * 1.85);
  }
  function drawDividerShape(ctx, data, x, y, w, color) {
    const themeDiv = artTheme().divider || "wave";
    const raw = (data.template === "wave" && themeDiv !== "wave") ? themeDiv : (data.template || themeDiv);
    const style = ["dots", "line", "glitch", "thread", "dashed"].indexOf(raw) >= 0 ? raw : "wave";
    ctx.save();
    const cy = y + Math.round(19);
    if (style === "glitch") {
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, cy - 4); ctx.lineTo(x + Math.round(w * 0.72), cy - 4); ctx.stroke();
      ctx.strokeStyle = alphaColor(artTheme().accent, 0.9); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + Math.round(w * 0.28), cy + 4); ctx.lineTo(x + w, cy + 4); ctx.stroke();
      ctx.fillStyle = color; ctx.fillRect(x + Math.round(w * 0.4), cy - 2, 10, 10);
    } else if (style === "thread") {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([10, 7]);
      ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillRect(x + Math.round(w * 0.5) - 5, cy - 5, 10, 10);
    } else if (style === "dashed") {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([11, 9]);
      ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke();
      ctx.setLineDash([]);
    } else if (style === "line") {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke();
    } else if (style === "dots") {
      ctx.fillStyle = color; const d = 6; const gap = Math.round(16);
      const count = Math.max(1, Math.floor((w - d) / (d + gap)));
      const start = x + (w - (count * d + (count - 1) * gap)) / 2;
      for (let i = 0; i < count; i += 1) { ctx.beginPath(); ctx.arc(start + i * (d + gap) + d / 2, cy, d / 2, 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath();
      const seg = Math.max(1, Math.floor(w / 40));
      const amp = 8;
      for (let i = 0; i <= seg; i += 1) {
        const px = x + (w * i) / seg;
        const py = cy + (i % 2 === 0 ? -amp : amp);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawLine(ctx, x1, y1, x2, y2, color, width) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }
  function drawGradientOverlay(ctx, x, y, w, h, color, from, to) {
    ctx.save();
    const gradient = ctx.createLinearGradient(0, y, 0, y + h);
    gradient.addColorStop(0, alphaColor(color, from || 0));
    gradient.addColorStop(1, alphaColor(color, to == null ? 0.84 : to));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  function capText(value, limit) {
    const out = String(value || "").trim();
    return out.length > limit ? out.slice(0, limit) + "…" : out;
  }

  /* ===== 各模块类型的内容绘制器：ctx 为模块临时画布，x0/y0 为内容区原点（已含卡片内边距），
        宽 w 为内容宽；返回内容底部的 y（供卡片定高）。所有绘制在坐标 y0 起、逐块向下排版。 ===== */
  async function paintCover(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const img = await loadImage(data.mainImage);
    const tpl = data.template || "immersive";
    const title = text(data.title, "活动主标题");
    const subtitle = data.subtitle;
    const infoLines = (data.infoLines || []).slice(0, 6).filter(Boolean);
    const qqText = data.qqGroupNumber ? "QQ 群：" + data.qqGroupNumber : "";
    const chipPlain = { size: 23, color: ink, border: alphaColor(P.primary, 0.35), fill: "#ffffff", lw: 2 };
    const chipCenter = { size: 23, color: P.primaryDark, border: alphaColor(P.primary, 0.4), fill: "#ffffff", lw: 2, center: true };
    const drawInfoCopy = function (yy, centered) {
      let c = yy;
      c = drawRich(ctx, title, centered ? x0 + w / 2 : x0, c, w, 65, 900, P.primaryDark, centered ? "center" : "left", 1.2) + 19;
      if (subtitle) c = drawRich(ctx, subtitle, centered ? x0 + w / 2 : x0, c, w, 29, 500, artMuted(), centered ? "center" : "left", null, "body") + 17;
      c = drawChips(ctx, infoLines, centered ? x0 + w / 2 : x0, c + 4, w, Object.assign({}, centered ? chipCenter : chipPlain, { scope: "body" }));
      if (qqText) c = drawRich(ctx, qqText, centered ? x0 + w / 2 : x0, c + 13, w, 23, 500, artMuted(), centered ? "center" : "left", null, "body") + 10;
      return c;
    };
    if (tpl === "info") {
      let y = y0;
      if (img) { const h = Math.min(Math.round(w * 0.6), 1000); ctx.save(); roundRectPath(ctx, x0, y, w, h, 21); ctx.clip(); coverDraw(ctx, img, x0, y, w, h); ctx.restore(); y += h + 71; }
      return drawInfoCopy(y, false);
    }
    if (tpl === "minimal") {
      return drawInfoCopy(y0, true);
    }
    if (tpl === "split") {
      let y = y0;
      if (img) { const h = Math.min(Math.round(w * 0.64), 1000); ctx.save(); roundRectPath(ctx, x0, y, w, h, 21); ctx.clip(); coverDraw(ctx, img, x0, y, w, h); ctx.restore(); y += h + 75; }
      else { ctx.save(); roundRectPath(ctx, x0, y, w, 354, 21); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore(); y += 400; }
      return drawInfoCopy(y, false);
    }
    /* immersive 沉浸封面：主图整幅 + 底部渐变信息带（从下往上锚定）。 */
    const heroH = img ? Math.round(w * 0.85) : Math.round(w * 0.6);
    if (img) { ctx.save(); roundRectPath(ctx, x0, y0, w, heroH, 26); ctx.clip(); coverDraw(ctx, img, x0, y0, w, heroH); ctx.restore(); }
    else { ctx.save(); roundRectPath(ctx, x0, y0, w, heroH, 26); ctx.fillStyle = P.primaryDark; ctx.fill(); ctx.restore(); }
    drawGradientOverlay(ctx, x0, y0 + Math.round(heroH * 0.42), w, heroH - Math.round(heroH * 0.42), P.primaryDark, 0.05, 0.88);
    const cx = x0 + w / 2;
    const cw = w - 40;
    let bottom = y0 + heroH - 26;
    const infoShown = infoLines.slice(0, 3);
    for (let i = infoShown.length - 1; i >= 0; i -= 1) {
      if (!infoShown[i]) continue;
      bottom = paintUpText(ctx, infoShown[i], cx, bottom - 4, cw, 23, 500, "rgba(255,255,255,.85)", "center", 1.55, "body");
      bottom -= 10;
    }
    if (subtitle) { bottom = paintUpText(ctx, subtitle, cx, bottom - 8, cw, 29, 600, "rgba(255,255,255,.96)", "center", 1.45, "body"); bottom -= 25; }
    paintUpText(ctx, title, cx, bottom - 6, cw, 65, 900, "#ffffff", "center", 1.22);
    let y = y0 + heroH;
    if (qqText) y = drawRich(ctx, qqText, cx, y + 33, w, 23, 500, artMuted(), "center", null, "body") + 13;
    return y;
  }

  async function paintAnnouncement(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const tpl = data.template || "notice";
    const bodyValue = data.body || "在这里填写活动公告、入场须知或情报说明。";
    const heading = data.heading || "";
    const align = data.bodyAlign === "right" ? "right" : data.bodyAlign === "center" ? "center" : "left";
    const bodySize = 29; const bodyMul = 1.7; const headSize = 29;
    const anchor = function (leftX, width) {
      return { x: align === "center" ? leftX + width / 2 : align === "right" ? leftX + width : leftX };
    };
    if (tpl === "plain") {
      let y = y0;
      const a = anchor(x0, w);
      if (heading) y = drawRich(ctx, heading, a.x, y, w, headSize, 800, P.primaryDark, align, 1.35) + 10;
      y = drawRich(ctx, bodyValue, a.x, y, w, bodySize, 400, ink, align, bodyMul, "body");
      return y;
    }
    const padX = 30;
    const innerLeft = x0 + padX;
    const innerW = Math.max(60, w - padX * 2);
    const a = anchor(innerLeft, innerW);
    const headInfo = heading ? textBlockInfo(ctx, heading, innerW, headSize, 800, 1.35) : { height: 0 };
    const bodyInfo = textBlockInfo(ctx, bodyValue, innerW, bodySize, 400, bodyMul, "body");
    if (tpl === "boxed") {
      const padY = 20;
      const paneH = padY * 2 + headInfo.height + (heading ? 12 : 0) + bodyInfo.height;
      let y = y0 + padY + Math.round(headSize * 0.2);
      if (heading) y = drawRich(ctx, heading, a.x, y, innerW, headSize, 800, P.primaryDark, align, 1.35) + 13;
      drawRich(ctx, bodyValue, a.x, y, innerW, bodySize, 400, ink, align, bodyMul, "body");
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 24); ctx.strokeStyle = alphaColor(P.primary, 0.42); ctx.lineWidth = 3; ctx.setLineDash([2, 16]); ctx.stroke(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 24); ctx.strokeStyle = alphaColor(P.accent, 0.9); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      return y0 + paneH;
    }
    /* notice / quote：内衬面板 */
    let innerH = bodyInfo.height;
    if (heading) innerH += headInfo.height + 7;
    if (tpl === "quote") innerH = Math.max(innerH, 100);
    const padTop = 30; const padBottom = 30;
    const paneH = padTop + innerH + padBottom;
    let bodyLeft = innerLeft;
    let bodyTopPad = 0;
    if (tpl === "quote") {
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 24); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore();
      ctx.save(); artFont(ctx, 71, 900); ctx.fillStyle = P.accent; ctx.textAlign = "left"; ctx.fillText("“", x0 + 18, y0 + padTop + 78); ctx.restore();
      bodyLeft = x0 + 66;
      bodyTopPad = 4;
    } else {
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 24); ctx.fillStyle = alphaColor(P.primary, 0.07); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0, y0 + 6, 9, paneH - 12, 4); ctx.fillStyle = P.accent; ctx.fill(); ctx.restore();
      bodyLeft = innerLeft + 10;
      bodyTopPad = 0;
    }
    const bodyW = Math.max(60, w - (bodyLeft - x0) - padX);
    const ba = anchor(bodyLeft, bodyW);
    let y = y0 + padTop + Math.round(headSize * 0.2);
    if (heading && tpl !== "quote") {
      const headLeft = x0 + padX;
      const ha = anchor(headLeft, bodyW);
      y = drawRich(ctx, heading, ha.x, y, bodyW, headSize, 800, P.primaryDark, align, 1.35) + 13;
    }
    y = y0 + padTop + Math.round(bodySize * 0.2) + (heading && tpl !== "quote" ? headInfo.height + 13 : 0) + bodyTopPad;
    if (tpl === "quote") {
      drawRich(ctx, bodyValue, ba.x, y, bodyW, bodySize, 700, "#20251f", align, bodyMul, "body");
      if (heading) drawRich(ctx, heading, x0 + w - padX, y0 + paneH - padBottom + 12, innerW, 23, 600, P.primaryDark, "right", 1.4);
    } else {
      drawRich(ctx, bodyValue, ba.x, y, bodyW, bodySize, 400, ink, align, bodyMul, "body");
    }
    return y0 + paneH;
  }

  async function paintTicket(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk(); let y = y0;
    const tiers = (data.tiers || []).filter(function (t) { return t && (t.label || t.price); });
    const qr = await loadImage(data.qrImage);
    const tpl = data.template || "qr-side";
    const qrSize = Math.round(w * 0.32);
    if (tpl === "ticket-focus" || tpl === "ticket-hero") {
      const first = tiers[0];
      const bandH = Math.round(w * 0.42);
      ctx.save(); roundRectPath(ctx, x0, y, w, bandH, 30); const g = ctx.createLinearGradient(x0, y, x0 + w, y + bandH); g.addColorStop(0, P.primary); g.addColorStop(1, P.primaryDark); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      if (qr && tpl === "ticket-focus") {
        ctx.save(); ctx.fillStyle = "#ffffff"; roundRectPath(ctx, x0 + w - qrSize - 26, y + (bandH - qrSize) / 2, qrSize, qrSize, 18); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, x0 + w - qrSize - 26, y + (bandH - qrSize) / 2, qrSize, qrSize, 18); ctx.clip(); containDraw(ctx, qr, x0 + w - qrSize - 26, y + (bandH - qrSize) / 2, qrSize, qrSize); ctx.restore();
      }
      if (first) {
        ctx.fillStyle = "#ffffff"; ctx.textAlign = "left";
        y = drawRich(ctx, text(first.price, "价格"), x0 + 22, y + Math.round(bandH * 0.34), w * 0.6, 71, 900, "#ffffff", "left", 1) + 6;
        if (first.label) y = drawRich(ctx, first.label, x0 + 22, y + 8, w * 0.6, 27, 600, "rgba(255,255,255,.9)", "left") + 8;
      } else y = drawRich(ctx, "价格", x0 + 22, y + Math.round(bandH * 0.4), w * 0.6, 71, 900, "#ffffff", "left") + 6;
      y += Math.round(bandH * 0.18);
      const rest = tiers.slice(1);
      if (rest.length) y = drawChips(ctx, rest.map(function (t) { return [t.label, t.price].filter(Boolean).join("　"); }), x0, y + 14, w, { size: 25, color: ink, border: alphaColor(P.primary, 0.4), fill: "#ffffff", lw: 2 });
      if (qr && tpl === "ticket-hero") {
        y += 24;
        const qw = qrSize + 24; const qh = qrSize + 24;
        ctx.save(); ctx.fillStyle = "#ffffff"; roundRectPath(ctx, x0 + (w - qw) / 2, y, qw, qh, 20); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, x0 + (w - qw) / 2, y, qw, qh, 20); ctx.clip(); containDraw(ctx, qr, x0 + (w - qw) / 2 + 12, y + 12, qrSize, qrSize); ctx.restore();
        y += qh + 8;
      }
      if (data.note) y = drawRich(ctx, data.note, x0, y + 15, w, 23, 500, artMuted(), "left", 1.5, "body") + 10;
      return y;
    }
    if (tpl === "ticket-cards") {
      const cols = Math.max(1, Math.min(3, Math.ceil(tiers.length / 2)));
      const gap = 22;
      const cw = (w - gap * (cols - 1)) / cols;
      const ch = Math.round(cw * 0.9);
      tiers.slice(0, 6).forEach(function (tier, index) {
        const col = index % cols; const row = Math.floor(index / cols);
        const cx = x0 + col * (cw + gap); const cy = y + row * (ch + gap);
        ctx.save(); roundRectPath(ctx, cx, cy, cw, ch, 24); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, cx, cy, cw, ch, 24); ctx.strokeStyle = alphaColor(P.primary, 0.22); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        drawRich(ctx, text(tier.price, "价格"), cx + cw / 2, cy + Math.round(ch * 0.4), cw - 20, 46, 900, P.accent, "center", 1);
        drawRich(ctx, text(tier.label, "票档"), cx + cw / 2, cy + Math.round(ch * 0.4) + 48, cw - 20, 23, 600, artMuted(), "center", 1);
      });
      if (!tiers.length) { ctx.save(); roundRectPath(ctx, x0, y, w, 140, 24); ctx.fillStyle = P.soft; ctx.fill(); ctx.restore(); drawRich(ctx, "暂无票档", x0 + w / 2, y + 30, w, 27, 600, artMuted(), "center", 1); y += 60; }
      else y += Math.ceil(Math.min(tiers.length, 6) / cols) * (ch + gap) - gap;
      if (data.note) y = drawRich(ctx, data.note, x0, y + 21, w, 23, 500, artMuted(), "left", 1.5, "body") + 14;
      if (qr) {
        y += 18; const qw = qrSize + 32; const qh = qrSize + 32;
        ctx.save(); ctx.fillStyle = "#ffffff"; roundRectPath(ctx, x0 + (w - qw) / 2, y, qw, qh, 22); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, x0 + (w - qw) / 2, y, qw, qh, 22); ctx.clip(); containDraw(ctx, qr, x0 + (w - qw) / 2 + 16, y + 16, qrSize, qrSize); ctx.restore();
        y += qh + 6;
      }
      return y;
    }
    /* 默认 qr-side / 其余：左侧票档行 + 右侧二维码 */
    const splitGap = 30;
    const qrSide = qr ? qrSize + 40 : 0;
    const leftW = qrSide ? w - qrSide - splitGap : w;
    let ly = y;
    if (!tiers.length) { drawRich(ctx, "暂无票档", x0, ly + 8, leftW, 27, 600, artMuted(), "left", 1); ly += 50; }
    tiers.slice(0, 8).forEach(function (tier) {
      const rowY = ly + 8;
      drawRich(ctx, text(tier.label, "票档"), x0, rowY, leftW * 0.62, 27, 600, ink, "left", 1);
      drawRich(ctx, text(tier.price, "价格"), x0 + leftW, rowY, leftW * 0.38, 27, 900, P.accent, "right", 1);
      ly += 63;
      drawLine(ctx, x0, ly, x0 + leftW, ly, alphaColor(P.primary, 0.14), 2);
    });
    if (qr) {
      const qx = x0 + leftW + splitGap;
      ctx.save(); ctx.fillStyle = "#ffffff"; roundRectPath(ctx, qx, y, qrSide, qrSide, 20); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, qx, y, qrSide, qrSide, 20); ctx.clip(); containDraw(ctx, qr, qx + 20, y + 20, qrSize, qrSize); ctx.restore();
    }
    y = Math.max(ly, qr ? y + qrSide : ly);
    if (data.note) y = drawRich(ctx, data.note, x0, y + 19, w, 23, 500, artMuted(), "left", 1.5, "body") + 10;
    return y;
  }

  async function paintMaterials(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const items = data.items || [];
    const note = data.note;
    const tpl = data.template || "icon-grid";
    const list = items.length ? items : [{}];
    let y = y0;
    if (tpl === "checklist") {
      for (const item of list) {
        drawRich(ctx, "✓", x0 + 17, y + 36, 40, 27, 900, P.accent, "left", 1);
        drawRich(ctx, text(item.label, "物料条目"), x0 + 54, y + 30, w - 54, 27, 500, ink, "left", 1, "body");
        y += 71;
      }
      if (!items.length) y -= 29;
      if (note) y = drawRich(ctx, note, x0, y + 17, w, 23, 500, artMuted(), "left", 1.5, "body") + 12;
      return y;
    }
    if (tpl === "notice-strip") {
      const stripH = 64;
      list.forEach(function (item, index) {
        ctx.save(); roundRectPath(ctx, x0, y, w, stripH, 18); ctx.fillStyle = index % 2 === 0 ? P.accent : P.primary; ctx.fill(); ctx.restore();
        drawRich(ctx, text(item.label, "物料条目"), x0 + w / 2, y + stripH - 22, w - 30, 25, 700, "#ffffff", "center", 1, "body");
        y += stripH + 16;
      });
      if (!items.length) y -= 50;
      if (note) y = drawRich(ctx, note, x0, y + 7, w, 11, 500, artMuted(), "left", 1.5, "body") + 5;
      return y;
    }
    /* icon-grid：图标圆角块 + 说明文字 */
    const icons = await Promise.all(items.map(function (it) { return it && it.icon && it.icon.url ? loadImage(it.icon) : Promise.resolve(null); }));
    const cols = Math.max(1, Math.min(4, Number(data.columns) || 2));
    const gap = 20;
    const cw = (w - gap * (cols - 1)) / cols;
    const cellH = Math.round(cw * 1.15);
    const iconBox = Math.min(104, Math.round(cw * 0.7));
    const count = Math.max(1, items.length);
    for (let i = 0; i < count; i += 1) {
      const item = items[i] || {};
      const cx = x0 + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (cellH + gap);
      ctx.save(); roundRectPath(ctx, cx, cy, cw, cellH, 22); ctx.fillStyle = alphaColor("#ffffff", 0.78); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, cx, cy, cw, cellH, 22); ctx.strokeStyle = alphaColor(P.primary, 0.14); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      const img = icons[i];
      if (img) { ctx.save(); roundRectPath(ctx, cx + (cw - iconBox) / 2, cy + Math.round(cellH * 0.16), iconBox, iconBox, 24); ctx.clip(); coverDraw(ctx, img, cx + (cw - iconBox) / 2, cy + Math.round(cellH * 0.16), iconBox, iconBox); ctx.restore(); }
      drawRich(ctx, text(item.label, "物料条目"), cx + cw / 2, cy + cellH - 34, cw - 16, 25, 600, ink, "center", 1.35, "body");
    }
    y += Math.ceil(count / cols) * (cellH + gap) - gap;
    if (note) y = drawRich(ctx, note, x0, y + 19, w, 23, 500, artMuted(), "left", 1.5, "body") + 10;
    return y;
  }

  async function paintCrossPromo(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const icon = await loadImage(data.icon);
    const tpl = data.template || "promo-card";
    const value = data.text || "联动推广文案";
    const padY = 24;
    let innerH = 0;
    if (tpl === "promo-centered") {
      const info = textBlockInfo(ctx, value, w - 60, 29, 600, 1.7, "body");
      innerH = (icon ? Math.round(w * 0.24) + 38 : 0) + info.height + padY * 2 - 30;
      ctx.save(); roundRectPath(ctx, x0, y0, w, innerH, 26); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore();
      let y = y0 + 36;
      if (icon) {
        const iw = Math.min(104, Math.round(w * 0.22)); const ih = iw;
        const ix = x0 + (w - iw) / 2;
        ctx.save(); roundRectPath(ctx, ix, y, iw, ih, 26); ctx.clip(); coverDraw(ctx, icon, ix, y, iw, ih); ctx.restore();
        y += ih + 33;
      }
      y = drawRich(ctx, value, x0 + w / 2, y, w - 60, 29, 600, ink, "center", 1.7, "body");
      return y0 + innerH;
    }
    const side = icon ? Math.min(163, Math.round(w * 0.26)) : 0;
    const textInfo = textBlockInfo(ctx, value, w - side - (icon ? 60 : 0), 29, 600, 1.68, "body");
    const bandH = Math.max(100, padY * 2 + textInfo.height);
    ctx.save(); roundRectPath(ctx, x0, y0, w, bandH, 26); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore();
    if (icon) {
      const iw = Math.min(104, side - 36); const ih = iw;
      const ix = x0 + (side - iw) / 2; const iy = y0 + (bandH - ih) / 2;
      ctx.save(); roundRectPath(ctx, ix, iy, iw, ih, 26); ctx.clip(); coverDraw(ctx, icon, ix, iy, iw, ih); ctx.restore();
      drawRich(ctx, value, x0 + side + 19, y0 + (bandH - textInfo.height) / 2 + 20, w - side - 40, 29, 600, ink, "left", 1.68, "body");
    } else {
      drawRich(ctx, value, x0 + w / 2, y0 + (bandH - textInfo.height) / 2 + 20, w - 60, 29, 600, ink, "center", 1.68, "body");
    }
    return y0 + bandH;
  }

  async function paintSchedule(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk(); let y = y0;
    const groups = data.groups || [];
    const tpl = data.template || "timeline";
    for (const group of groups) {
      const rows = group.rows || [];
      if (!rows.length) continue;
      if (tpl === "schedule-table") {
        const headH = 84;
        ctx.save(); roundRectPath(ctx, x0, y, w, headH, 18); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore();
        drawRich(ctx, text(group.groupName, "活动时间"), x0 + 22, y + 52, w - 44, 33, 800, P.primaryDark, "left", 1);
        y += headH;
        rows.forEach(function (row, ri) {
          if (ri > 0) drawLine(ctx, x0, y, x0 + w, y, P.line, 2);
          drawRich(ctx, text(row.time, "00:00"), x0 + 22, y + 40, w * 0.22, 25, 700, P.accent, "left", 1);
          drawRich(ctx, text(row.name, "环节"), x0 + w * 0.22 + 22, y + 40, w * 0.72, 27, 500, ink, "left", 1);
          y += 92;
        });
        y += 25;
      } else if (tpl === "schedule-cards") {
        ctx.save(); roundRectPath(ctx, x0, y, w, 84, 21); ctx.fillStyle = alphaColor("#ffffff", 0.78); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, x0, y, w, 96, 24); ctx.strokeStyle = alphaColor(P.primary, 0.2); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        drawRich(ctx, text(group.groupName, "活动时间"), x0 + 22, y + 52, w - 44, 33, 800, P.primaryDark, "left", 1);
        y += 84;
        rows.forEach(function (row, ri) {
          if (ri > 0) drawLine(ctx, x0 + 20, y - 6, x0 + w - 20, y - 6, alphaColor(P.primary, 0.12), 2);
          drawRich(ctx, text(row.name, "环节"), x0 + 22, y + 40, w * 0.62, 27, 500, ink, "left", 1);
          drawRich(ctx, text(row.time, "00:00"), x0 + w - 22, y + 40, w * 0.3, 25, 800, P.accent, "right", 1);
          y += 61;
        });
        y += 25;
      } else {
        drawRich(ctx, text(group.groupName, "活动时间"), x0, y, w, 33, 800, P.primaryDark, "left", 1.35);
        y += 25;
        rows.forEach(function (row) {
          ctx.save(); ctx.fillStyle = P.accent; ctx.beginPath(); ctx.arc(x0 + 13, y + 20, 7, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          drawRich(ctx, text(row.time, "00:00"), x0 + 42, y + 22, w * 0.2, 25, 700, P.accent, "left", 1);
          drawRich(ctx, text(row.name, "环节"), x0 + 42 + w * 0.2 + 17, y + 22, w * 0.72, 27, 500, ink, "left", 1.7);
          y += 59;
        });
        y += 14;
      }
    }
    if (!groups.length || !groups.some(function (g) { return (g.rows || []).length; })) {
      drawRich(ctx, "暂无时间安排", x0 + w / 2, y + 32, w, 27, 600, artMuted(), "center", 1);
      y += 66;
    }
    return y;
  }

  async function paintVenue(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const tags = (data.tags || []).filter(Boolean);
    const img = await loadImage(data.photo);
    const tpl = data.template || "venue-side";
    const chipsOpt = { size: 23, color: P.primaryDark, border: alphaColor(P.primary, 0.3), fill: P.primarySoft, lw: 2 };
    if (tpl === "venue-focus") {
      let y = y0;
      if (img) { const h = Math.min(396, Math.round(w * 0.5)); ctx.save(); roundRectPath(ctx, x0, y, w, h, 21); ctx.clip(); coverDraw(ctx, img, x0, y, w, h); ctx.restore(); y += h + 44; }
      y = drawRich(ctx, data.description || "场地描述", x0, y, w, 29, 400, ink, "left", 1.68, "body") + 10;
      if (tags.length) y = drawChips(ctx, tags, x0, y, w, chipsOpt) + 8;
      return y;
    }
    if (tpl === "venue-map") {
      const pad = 25;
      const textH = textBlockInfo(ctx, data.description || "场地描述", w - pad * 2, 29, 400, 1.68, "body").height;
      const chipsH = tags.length ? chipRowCount(ctx, tags, w - pad * 2, 23) : 0;
      const paneH = pad + textH + 24 + (tags.length ? chipsH + 14 : 0) + pad - 20;
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 26); ctx.fillStyle = alphaColor("#ffffff", 0.7); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 26); ctx.strokeStyle = alphaColor(P.accent, 0.75); ctx.lineWidth = 3; ctx.setLineDash([14, 14]); ctx.stroke(); ctx.restore();
      let y = y0 + pad - 8;
      y = drawRich(ctx, data.description || "场地描述", x0 + pad, y, w - pad * 2, 29, 400, ink, "left", 1.68, "body") + 10;
      if (tags.length) drawChips(ctx, tags, x0 + pad, y, w - pad * 2, chipsOpt);
      return y0 + paneH;
    }
    /* venue-side：左描述 + 右侧场地照片 */
    const side = img ? Math.min(163, Math.round(w * 0.4)) : 0;
    const textW = side ? w - side - 34 : w;
    const textH = textBlockInfo(ctx, data.description || "场地描述", textW, 29, 400, 1.68, "body").height;
    const chipsH = tags.length ? chipRowCount(ctx, tags, textW, 23) : 0;
    const copyH = textH + (tags.length ? chipsH + 16 : 0);
    const imgH = Math.max(Math.round(w * 0.48), copyH + 20);
    if (img) { ctx.save(); roundRectPath(ctx, x0 + textW + 19, y0, side, imgH, 21); ctx.clip(); coverDraw(ctx, img, x0 + textW + 19, y0, side, imgH); ctx.restore(); }
    let y = y0;
    y = drawRich(ctx, data.description || "场地描述", x0, y, textW, 29, 400, ink, "left", 1.68, "body") + 10;
    if (tags.length) y = drawChips(ctx, tags, x0, y, textW, chipsOpt);
    return Math.max(y + 12, img ? y0 + imgH : y + 12);
  }

  async function paintRoute(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const lines = (data.lines || []).filter(Boolean);
    const tpl = data.template || "steps";
    let y = y0;
    if (tpl === "route-focus") {
      if (lines[0]) {
        ctx.save(); roundRectPath(ctx, x0, y, w, 100, 21); ctx.fillStyle = P.primary; ctx.fill(); ctx.restore();
        drawRich(ctx, lines[0], x0 + w / 2, y + 60, w - 44, 29, 700, "#ffffff", "center", 1.5, "body");
        y += 100 + 21;
      }
      for (const line of lines.slice(1)) {
        drawRich(ctx, "›", x0, y + 34, 40, 28, 900, P.accent, "left", 1);
        drawRich(ctx, line, x0 + 48, y + 30, w - 48, 27, 500, ink, "left", 1.6, "body");
        y += 92;
      }
      if (!lines.length) { drawRich(ctx, "暂无路线", x0, y + 34, w, 27, 600, artMuted(), "left", 1); y += 60; }
      return y;
    }
    const showLines = lines.length ? lines : [""];
    for (let i = 0; i < showLines.length; i += 1) {
      const line = showLines[i];
      if (tpl === "route-list") {
        ctx.save(); roundRectPath(ctx, x0, y, w, 62, 17); ctx.fillStyle = alphaColor("#ffffff", 0.7); ctx.fill(); ctx.restore();
        drawRich(ctx, "›", x0 + 20, y + 40, 30, 28, 900, P.accent, "left", 1);
        drawRich(ctx, line, x0 + 46, y + 38, w - 62, 27, 500, ink, "left", 1, "body");
        y += 78;
      } else {
        const num = String(i + 1).padStart(2, "0");
        drawRich(ctx, num, x0, y + 34, 76, 30, 900, P.accent, "left", 1);
        drawRich(ctx, line, x0 + 86, y + 34, w - 86, 27, 600, ink, "left", 1.35, "body");
        y += 92;
      }
    }
    if (!lines.length) y -= 26;
    return y;
  }

  async function paintProgram(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const items = data.items || [];
    const tpl = data.template || "program-list";
    let y = y0;
    if (tpl === "program-cards") {
      const cols = Math.max(1, Math.min(3, Math.ceil(Math.max(items.length, 1) / 2)));
      const gap = 24;
      const cw = (w - gap * (cols - 1)) / cols;
      const imgH = Math.round(cw * 0.9);
      const cardH = imgH + Math.round(cw * 0.48);
      const count = Math.max(1, items.length);
      for (let i = 0; i < count; i += 1) {
        const item = items[i] || {};
        const cx = x0 + (i % cols) * (cw + gap);
        const cy = y + Math.floor(i / cols) * (cardH + gap);
        ctx.save(); roundRectPath(ctx, cx, cy, cw, cardH, 22); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, cx, cy, cw, cardH, 22); ctx.strokeStyle = alphaColor(P.primary, 0.18); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        const itemImg = item.image && item.image.url ? await loadImage(item.image) : null;
        if (itemImg) { ctx.save(); roundRectPath(ctx, cx, cy, cw, imgH, 22); ctx.clip(); coverDraw(ctx, itemImg, cx, cy, cw, imgH); ctx.restore(); }
        else { ctx.save(); roundRectPath(ctx, cx, cy, cw, imgH, 22); ctx.fillStyle = P.soft; ctx.fill(); ctx.restore(); }
        if (item.tag) drawRich(ctx, item.tag, cx + 14, cy + imgH + 30, cw - 26, 21, 800, P.accent, "left", 1);
        drawRich(ctx, text(item.title, "节目标题"), cx + 14, cy + imgH + 58, cw - 26, 27, 700, ink, "left", 1.35);
        if (item.subtitle) drawRich(ctx, item.subtitle, cx + 14, cy + imgH + 88, cw - 26, 23, 500, artMuted(), "left", 1.3, "body");
      }
      y += Math.ceil(count / cols) * (cardH + gap) - gap;
      return y;
    }
    if (tpl === "program-compact") {
      const cols = 2; const gap = 17; const cw = (w - gap) / 2; const ch = 100;
      const list = items.length ? items : [{ tag: "", title: "" }];
      list.forEach(function (item, index) {
        const cx = x0 + (index % cols) * (cw + gap);
        const cy = y + Math.floor(index / cols) * (ch + gap);
        ctx.save(); roundRectPath(ctx, cx, cy, cw, ch, 20); ctx.fillStyle = alphaColor("#ffffff", 0.75); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, cx, cy, cw, ch, 20); ctx.strokeStyle = alphaColor(P.primary, 0.16); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        if (item.tag) drawRich(ctx, item.tag, cx + 14, cy + 36, cw - 26, 21, 800, P.accent, "left", 1);
        drawRich(ctx, text(item.title, "节目标题"), cx + 14, cy + 66, cw - 26, 27, 700, ink, "left", 1.2);
      });
      y += Math.ceil(Math.max(items.length, 1) / cols) * (ch + gap) - gap;
      return y;
    }
    /* program-list 默认列表 */
    const itemsShown = items.length ? items : [{}];
    for (const item of itemsShown) {
      const img = item.image && item.image.url ? await loadImage(item.image) : null;
      if (img) {
        const thumb = Math.round(w * 0.28);
        const th = Math.min(200, Math.round(thumb * 0.74));
        const ix = item.mediaSide === "left" ? x0 : x0 + w - thumb;
        ctx.save(); roundRectPath(ctx, ix, y + 8, thumb, th, 18); ctx.clip(); coverDraw(ctx, img, ix, y + 8, thumb, th); ctx.restore();
        const textX = item.mediaSide === "left" ? x0 + thumb + 30 : x0;
        const textW = w - thumb - 30;
        let cy = y + 28;
        if (item.tag) cy = drawRich(ctx, item.tag, textX, cy, textW, 21, 800, P.accent, "left", 1) + 10;
        cy = drawRich(ctx, text(item.title, "节目标题"), textX, cy, textW, 27, 700, ink, "left", 1.3) + 8;
        if (item.subtitle) cy = drawRich(ctx, item.subtitle, textX, cy, textW, 23, 500, artMuted(), "left", 1.4, "body");
        y += Math.max(th + 24, cy - y + 17);
      } else {
        let cy = y + 28;
        if (item.tag) cy = drawRich(ctx, item.tag, x0, cy, w, 21, 800, P.accent, "left", 1) + 10;
        cy = drawRich(ctx, text(item.title, "节目标题"), x0, cy, w, 27, 700, ink, "left", 1.3) + 8;
        if (item.subtitle) cy = drawRich(ctx, item.subtitle, x0, cy, w, 23, 500, artMuted(), "left", 1.4, "body");
        y = cy + 19;
      }
      drawLine(ctx, x0, y - 10, x0 + w, y - 10, alphaColor(P.primary, 0.12), 2);
    }
    if (!items.length) { drawRich(ctx, "暂无节目", x0 + w / 2, y + 34, w, 27, 600, artMuted(), "center", 1); y += 60; }
    return y;
  }

  async function paintPerformer(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const tpl = data.template || "cast-list";
    const cast = data.cast || [];
    const avatarDims = function (ratio) {
      const aw = 150;
      if (ratio === "3:4") return { w: aw, h: Math.round(aw * 4 / 3) };
      if (ratio === "1:1.4") return { w: aw, h: Math.round(aw * 1.4) };
      return { w: aw, h: aw };
    };
    const drawMember = async function (member, mx, my, mw) {
      const img = member.avatar && member.avatar.url ? await loadImage(member.avatar) : null;
      const dims = avatarDims(member.avatarRatio || "1:1");
      const avatarStyle = P.avatarStyle || "none";
      let cy = my;
      const leftW = img ? dims.w + 25 : 0;
      if (img) {
        if (avatarStyle === "polaroid") {
          ctx.save(); ctx.fillStyle = "#ffffff"; roundRectPath(ctx, mx - 8, my - 8, dims.w + 16, dims.h + 26, 4); ctx.fill();
          ctx.restore();
          ctx.save(); roundRectPath(ctx, mx, my, dims.w, dims.h, 3); ctx.clip(); coverDraw(ctx, img, mx, my, dims.w, dims.h); ctx.restore();
        } else {
          ctx.save(); roundRectPath(ctx, mx, my, dims.w, dims.h, 14); ctx.clip(); coverDraw(ctx, img, mx, my, dims.w, dims.h); ctx.restore();
        }
        if (avatarStyle === "ring" || avatarStyle === "frame") {
          roundRectPath(ctx, mx, my, dims.w, dims.h, avatarStyle === "frame" ? 3 : 14);
          ctx.strokeStyle = P.primary; ctx.lineWidth = avatarStyle === "frame" ? 5 : 3; ctx.stroke();
          if (avatarStyle === "frame") { roundRectPath(ctx, mx - 4, my - 4, dims.w + 8, dims.h + 8, 5); ctx.strokeStyle = P.accent; ctx.lineWidth = 1.5; ctx.stroke(); }
        } else if (avatarStyle === "glow") {
          ctx.save(); ctx.shadowColor = alphaColor(P.primary, 0.65); ctx.shadowBlur = 24; roundRectPath(ctx, mx, my, dims.w, dims.h, 14); ctx.strokeStyle = alphaColor(P.accent, 0.7); ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
        } else if (avatarStyle === "badge") {
          ctx.save(); ctx.fillStyle = P.accent; roundRectPath(ctx, mx + dims.w - 20, my + dims.h - 20, 16, 16, 4); ctx.fill();
          ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx + dims.w - 12, my + dims.h - 12, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
        }
      }
      const tx = mx + leftW;
      const tw = mw - leftW;
      let headY = cy;
      const name = text(member.name, "");
      if (name) { headY = drawRich(ctx, name, tx, headY, tw, 33, 800, P.primaryDark, "left", 1.3); }
      if (member.role || member.time) {
        headY = name ? headY + 8 : headY;
        const tag = [R.castRoleLabel(member.role), member.time].filter(Boolean).join("  ·  ");
        headY = drawRich(ctx, tag, tx, headY, tw, 21, 700, P.accent, "left", 1);
      }
      if (member.bio) { headY = drawRich(ctx, member.bio, tx, headY + 8, tw, 23, 400, ink, "left", 1.5, "body"); }
      cy = headY + 10;
      const setlist = (member.setlist || []).filter(function (s) { return s && (s.song || s.coverBy); });
      if (setlist.length) {
        cy = cy + 14;
        drawRich(ctx, "歌单", tx, cy, tw, 19, 800, artMuted(), "left", 1);
        cy += 30;
        const hasCover = setlist.some(function (s) { return s.coverBy; });
        for (const s of setlist) {
          if (hasCover) {
            drawRich(ctx, s.song || "", tx, cy, Math.round(tw * 0.62), 23, 600, ink, "left", 1.2, "body");
            drawRich(ctx, s.coverBy || "", tx + Math.round(tw * 0.62), cy, Math.round(tw * 0.38), 19, 500, artMuted(), "right", 1.2, "body");
          } else {
            drawRich(ctx, s.song || "", tx, cy, tw, 23, 600, ink, "left", 1.2, "body");
          }
          cy += 30;
        }
      }
      return cy;
    };
    const gap = 25;
    if (tpl === "cast-cards") {
      const cols = Math.max(1, Math.floor(w / 260));
      const cw = Math.floor((w - gap * (cols - 1)) / cols);
      const rows = Math.ceil(Math.max(cast.length, 1) / cols);
      const ch = 340;
      for (let i = 0; i < Math.max(cast.length, 1); i += 1) {
        const col = i % cols; const row = Math.floor(i / cols);
        const member = cast[i] || {};
        const cx = x0 + col * (cw + gap);
        const cy0 = y0 + row * (ch + gap);
        ctx.save(); roundRectPath(ctx, cx, cy0, cw, ch, 17); ctx.fillStyle = alphaColor("#ffffff", 0.72); ctx.fill(); ctx.restore();
        ctx.save(); roundRectPath(ctx, cx, cy0, cw, ch, 17); ctx.strokeStyle = alphaColor(P.primary, 0.16); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        await drawMember(member, cx + 16, cy0 + 16, cw - 32);
      }
      return y0 + rows * (ch + gap) - gap;
    }
    let y = y0;
    const shown = cast.length ? cast : [{}];
    for (const member of shown) {
      y = await drawMember(member, x0, y, w);
      if (cast.length) y += gap;
    }
    return cast.length ? y - gap : y;
  }

  async function paintBooth(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const items = data.items || [];
    const tpl = data.template || "booth-grid";
    let y = y0;
    if (tpl === "booth-cards") {
      const list = items.length ? items : [{}];
      for (const item of list) {
        const img = item.image && item.image.url ? await loadImage(item.image) : null;
        const imgW = Math.min(150, Math.round(w * 0.2));
        const rowH = Math.max(130, imgW + 48);
        if (img) { ctx.save(); roundRectPath(ctx, x0 + 20, y + 24, imgW, imgW, 20); ctx.clip(); coverDraw(ctx, img, x0 + 20, y + 24, imgW, imgW); ctx.restore(); }
        else { ctx.save(); roundRectPath(ctx, x0 + 20, y + 24, imgW, imgW, 20); ctx.fillStyle = P.soft; ctx.fill(); ctx.restore(); }
        drawRich(ctx, text(item.name, "摊位"), x0 + imgW + 23, y + 58, w - imgW - 40, 27, 800, ink, "left", 1);
        if (item.desc) drawRich(ctx, item.desc, x0 + imgW + 23, y + 96, w - imgW - 40, 23, 500, artMuted(), "left", 1.5, "body");
        ctx.save(); roundRectPath(ctx, x0, y, w, rowH, 22); ctx.strokeStyle = alphaColor(P.primary, 0.16); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        y += rowH + 21;
      }
      if (!items.length) y -= 50;
      return y;
    }
    if (tpl === "booth-list") {
      const list = items.length ? items : [{}];
      for (const item of list) {
        drawRich(ctx, text(item.name, "摊位"), x0, y + 42, w * 0.52, 27, 700, ink, "left", 1);
        if (item.desc) drawRich(ctx, item.desc, x0 + w * 0.5, y + 39, w * 0.5, 23, 500, artMuted(), "right", 1, "body");
        y += 68;
        drawLine(ctx, x0, y - 8, x0 + w, y - 8, alphaColor(P.primary, 0.14), 2);
      }
      if (!items.length) { drawRich(ctx, "暂无摊位", x0 + w / 2, y + 30, w, 27, 600, artMuted(), "center", 1); y += 62; }
      return y;
    }
    /* booth-grid 默认：摊位名/简介网格（有图则图上文下） */
    const cols = Math.max(1, Math.min(4, Number(data.columns) || 2));
    const gap = 20;
    const cw = (w - gap * (cols - 1)) / cols;
    const cellH = Math.round(cw * 1.35);
    const count = Math.max(1, items.length);
    const imgs = await Promise.all(items.map(function (it) { return it && it.image && it.image.url ? loadImage(it.image) : Promise.resolve(null); }));
    for (let i = 0; i < count; i += 1) {
      const item = items[i] || {};
      const cx = x0 + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (cellH + gap);
      ctx.save(); roundRectPath(ctx, cx, cy, cw, cellH, 22); ctx.fillStyle = alphaColor("#ffffff", 0.8); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, cx, cy, cw, cellH, 22); ctx.strokeStyle = alphaColor(P.primary, 0.15); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      const img = imgs[i];
      const hasImg = img || (item.image && item.image.url);
      if (hasImg) {
        const imgH = Math.round(cw * 0.52);
        if (img) { ctx.save(); roundRectPath(ctx, cx, cy, cw, imgH, 22); ctx.clip(); coverDraw(ctx, img, cx, cy, cw, imgH); ctx.restore(); }
        else { ctx.save(); roundRectPath(ctx, cx, cy, cw, imgH, 22); ctx.fillStyle = P.soft; ctx.fill(); ctx.restore(); }
        drawRich(ctx, text(item.name, "摊位"), cx + 12, cy + imgH + 36, cw - 22, 27, 700, ink, "left", 1.3);
        if (item.desc) drawRich(ctx, capText(item.desc, 26), cx + 12, cy + imgH + 66, cw - 22, 23, 500, artMuted(), "left", 1.35, "body");
      } else {
        drawRich(ctx, text(item.name, "摊位"), cx + cw / 2, cy + 54, cw - 24, 30, 700, ink, "center", 1.3);
        if (item.desc) drawRich(ctx, capText(item.desc, 30), cx + cw / 2, cy + 102, cw - 24, 25, 500, artMuted(), "center", 1.35, "body");
      }
    }
    y += Math.ceil(count / cols) * (cellH + gap) - gap;
    return y;
  }
  function paintDivider(ctx, data, x0, y0, w) {
    const P = artTheme();
    drawDividerShape(ctx, data, x0, y0 + 26, w, alphaColor(P.primary, 0.75));
    return y0 + 80;
  }

  function paintFooter(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const lines = (data.lines || []).filter(Boolean);
    const tpl = data.template || "footer-simple";
    let y = y0;
    if (tpl === "footer-banner") {
      const items = lines.length ? lines : ["主办：Only-box 企划"];
      const size = 25; const gap = 21; const rowH = 52;
      ctx.save(); artFont(ctx, size, 600, "body");
      let rows = 1; let rowW = 0;
      const widths = items.map(function (line) { const tw = ctx.measureText(String(line)).width; return { line: line, tw: tw }; });
      const fitted = [];
      let current = []; let cw2 = 0;
      widths.forEach(function (it) {
        if (current.length && cw2 + it.tw + gap > w - 58) { fitted.push(current); current = []; cw2 = 0; }
        current.push(it); cw2 += it.tw + (current.length > 1 ? gap : 0);
      });
      if (current.length) fitted.push(current);
      ctx.restore();
      const boxH = 40 + fitted.length * rowH + 24;
      ctx.save(); roundRectPath(ctx, x0, y, w, boxH, 21); ctx.fillStyle = P.primaryDark; ctx.fill(); ctx.restore();
      let by = y + 44;
      fitted.forEach(function (rowItems) {
        let cx = x0 + w / 2 - (rowItems.reduce(function (s, it) { return s + it.tw; }, 0) + (rowItems.length - 1) * gap) / 2;
        rowItems.forEach(function (it) {
          drawRich(ctx, it.line, cx, by, it.tw + 6, size, 600, "#ffffff", "left", 1, "body");
          cx += it.tw + gap;
        });
        by += rowH;
      });
      return y + boxH;
    }
    if (tpl === "footer-center") {
      (lines.length ? lines : ["微博 @XXX"]).forEach(function (line) {
        y = drawRich(ctx, line, x0 + w / 2, y, w, 23, 500, artMuted(), "center", 1.6, "body") + 8;
      });
      return y;
    }
    if (tpl === "footer-pills") {
      const items = lines.length ? lines : ["主办：Only-box 企划"];
      y = drawChips(ctx, items, x0 + w / 2, y, w, { size: 23, color: P.primaryDark, border: alphaColor(P.primary, 0.35), fill: P.primarySoft, lw: 2, center: true, scope: "body" });
      return y + 10;
    }
    (lines.length ? lines : ["微博 @XXX"]).forEach(function (line) {
      y = drawRich(ctx, line, x0, y, w, 23, 500, ink, "left", 1.5, "body") + 6;
    });
    return y;
  }

  function paintFreeText(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const level = data.level || "body";
    const size = C.fontSizePx(level, 750);
    const align = data.align === "center" ? "center" : data.align === "right" ? "right" : "left";
    const tx = align === "center" ? x0 + w / 2 : align === "right" ? x0 + w : x0;
    const tpl = data.template || "text-basic";
    const value = data.text || "自由文本";
    const drawTxt = function (y, sizePx, weight, color, mul, maxW) {
      return drawRich(ctx, value, tx, y, maxW || w, sizePx, weight, color || ink, align, mul || 1.66, "body");
    };
    if (tpl === "text-highlight") {
      const padX = 31; const padY = 27;
      const innerW = w - padX * 2 - 18;
      const info = textBlockInfo(ctx, value, innerW, size, 600, 1.7, "body");
      const paneH = padY * 2 + info.height;
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 24); ctx.fillStyle = P.primarySoft; ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0 + 13, y0 + 13, 9, paneH - 26, 5); ctx.fillStyle = P.accent; ctx.fill(); ctx.restore();
      drawTxt(y0 + padY + Math.round(size * 0.2), size, 600, ink, 1.7, innerW);
      return y0 + paneH;
    }
    if (tpl === "text-card") {
      const padX = 33; const padY = 29;
      const info = textBlockInfo(ctx, value, w - padX * 2, size, 500, 1.66, "body");
      const paneH = padY * 2 + info.height;
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 26); ctx.fillStyle = alphaColor("#ffffff", 0.82); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0, y0, w, paneH, 26); ctx.strokeStyle = alphaColor(P.primary, 0.2); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      drawTxt(y0 + padY + Math.round(size * 0.2), size, 500, ink, 1.66, w - padX * 2);
      return y0 + paneH;
    }
    if (tpl === "text-note") return drawTxt(y0, 23, 400, artMuted(), 1.75);
    const weight = level === "h1" || level === "h2" ? 800 : level === "h3" ? 700 : 400;
    return drawTxt(y0, size, weight, ink, 1.66);
  }

  function ratioNumber(raw) {
    const m = String(raw || "").replace(/\s+/g, "").match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/);
    return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : 0;
  }

  async function paintFreeImage(ctx, data, x0, y0, w) {
    const P = artTheme(); const ink = artInk();
    const img = await loadImage(data.image);
    const tpl = data.template || "image-focus";
    const fit = dataImageFit(data);
    const isCard = tpl === "image-card";
    const defaultRadius = isCard ? 21 : Math.max(0, Math.round(px2(Number(data.radius) != null ? Number(data.radius) : 0)));
    const ratio = data.ratio && data.ratio !== "auto" ? ratioNumber(data.ratio) : 0;
    let y = y0;
    let h = 0;
    if (img) h = ratio > 0 ? Math.round(w / ratio) : artImageHeight(data, img, w);
    h = Math.max(220, Math.min(h || Math.round(w * 0.6), 1200));
    if (!img) h = Math.round(w * 0.56);
    const radius = Math.min(isCard ? 24 : defaultRadius, 100);
    if (isCard) {
      ctx.save(); roundRectPath(ctx, x0, y0, w, h + 40, 26); ctx.fillStyle = alphaColor("#ffffff", 0.85); ctx.fill(); ctx.restore();
      ctx.save(); roundRectPath(ctx, x0, y0, w, h + 40, 26); ctx.strokeStyle = alphaColor(P.primary, 0.16); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      y += 20;
    }
    ctx.save(); roundRectPath(ctx, x0, y, w, h, radius); ctx.clip();
    if (img) { if (fit === "contain") containDraw(ctx, img, x0, y, w, h); else coverDraw(ctx, img, x0, y, w, h); }
    else { ctx.fillStyle = P.soft; ctx.fillRect(x0, y, w, h); }
    ctx.restore();
    y += h;
    if (isCard) y += 20;
    if (data.caption) { y += 12; y = drawRich(ctx, data.caption, x0, y, w, 27, 500, artMuted(), "left", 1.5, "body"); }
    return y;
  }

  async function paintModuleBody(ctx, module, x0, y0, w) {
    const data = module.data || {};
    switch (module.type) {
      case "cover": return paintCover(ctx, data, x0, y0, w);
      case "announcement": return paintAnnouncement(ctx, data, x0, y0, w);
      case "ticketInfo": return paintTicket(ctx, data, x0, y0, w);
      case "materials": return paintMaterials(ctx, data, x0, y0, w);
      case "crossPromo": return paintCrossPromo(ctx, data, x0, y0, w);
      case "schedule": return paintSchedule(ctx, data, x0, y0, w);
      case "venueInfo": return paintVenue(ctx, data, x0, y0, w);
      case "routeText": return paintRoute(ctx, data, x0, y0, w);
      case "programList": return paintProgram(ctx, data, x0, y0, w);
      case "performerCard": return paintPerformer(ctx, data, x0, y0, w);
      case "boothList": return paintBooth(ctx, data, x0, y0, w);
      case "divider": return paintDivider(ctx, data, x0, y0, w);
      case "footer": return paintFooter(ctx, data, x0, y0, w);
      case "freeText": return paintFreeText(ctx, data, x0, y0, w);
      case "freeImageBox": return paintFreeImage(ctx, data, x0, y0, w);
      default: return drawRich(ctx, R.typeLabel(module.type), x0, y0 + 20, w, 40, 800, artInk(), "left", 1.4);
    }
  }

  /* 板块标题头（序号 + 大标题），返回含头间距后的 y。 */
  function paintModuleHead(ctx, module, def, x0, y0, w, serial) {
    const P = artTheme();
    const rawTitle = moduleTitle(module, def);
    const title = P.titleDecor === "bracket" ? "「" + rawTitle + "」" : rawTitle;
    const kickerText = P.titleDecor === "kicker" ? "/ " + String(serial).padStart(2, "0") : String(serial).padStart(2, "0");
    /* 标题基线需下移一个「字身顶部」的高度，否则 58px 大标题的上半截会被卡片顶边裁掉。
       基线 = y0 + 0.92 * size，使字形顶(≈基线-0.88*size)恰好落在卡片 y0 附近。 */
    const headBaseline = y0 + Math.round(54 * 0.92);
    ctx.save(); artFont(ctx, 23, 900); ctx.fillStyle = P.accent; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(kickerText, x0, y0 + 26);
    ctx.restore();
    if (P.titleDecor === "bar") {
      ctx.save(); ctx.fillStyle = P.accent;
      ctx.fillRect(x0 - 12, y0 + 2, 6, 62);
      ctx.restore();
    }
    const y = drawRich(ctx, title, x0 + w / 2, headBaseline, w - 60, 54, 800, P.primaryDark, "center", 1.22);
    if (P.titleDecor === "stitch") {
      ctx.save(); ctx.strokeStyle = alphaColor(P.accent, 0.75); ctx.lineWidth = 2; ctx.setLineDash([9, 7]);
      ctx.beginPath(); ctx.moveTo(x0, y + 2); ctx.lineTo(x0 + w, y + 2); ctx.stroke();
      ctx.restore();
    }
    return y + 20;
  }

  /* 公共辅助：把模块内容渲染到临时 scratch canvas 并返回布局参数。
     供 drawModuleCard 和 measureCardLayout 共用，消除 ~60 行重复代码。 */
  async function _renderScratch(module, w, serial) {
    const def = R.getDef(module.type);
    const data = module.data || {};
    const pad = styleCardPad(Math.min(80, Math.max(17, px2(Number(data.padding) != null ? Number(data.padding) : 16))), artTheme());
    let scratch = document.createElement("canvas");
    scratch.width = Math.max(1, Math.round(w));
    scratch.height = 3400;
    let sctx = scratch.getContext("2d");
    let cursor = pad;
    let headBaseline = pad;
    if (module.type !== "divider" || data.sectionTitle) {
      headBaseline = pad + Math.round(54 * 0.92);
      cursor = await paintModuleHead(sctx, module, def, pad, pad, w - pad * 2, serial);
    }
    let contentEnd = await paintModuleBody(sctx, module, pad, cursor, w - pad * 2);
    if (contentEnd + pad > 3400) {
      scratch = document.createElement("canvas");
      scratch.width = Math.max(1, Math.round(w));
      scratch.height = Math.ceil(contentEnd + pad + 64);
      sctx = scratch.getContext("2d");
      cursor = pad;
      headBaseline = pad;
      if (module.type !== "divider" || data.sectionTitle) {
        headBaseline = pad + Math.round(54 * 0.92);
        cursor = await paintModuleHead(sctx, module, def, pad, pad, w - pad * 2, serial);
      }
      contentEnd = await paintModuleBody(sctx, module, pad, cursor, w - pad * 2);
    }
    const usedH = Math.max(pad * 2 + 48, contentEnd + pad);
    return { scratch: scratch, usedH: usedH, pad: pad, headBaseline: headBaseline };
  }

  async function drawModuleCard(ctx, module, area, serial) {
    const data = module.data || {};
    const st = artTheme();
    const w = area.w;
    const r = await _renderScratch(module, w, serial);
    const usedH = r.usedH;
    const radius = cardRadius(data, st);
    const opacity = Number.isFinite(Number(data.blockOpacity)) ? Number(data.blockOpacity) / 100 : 0.94;
    const silence = [];
    const bg = data.blockBgImage && data.blockBgImage.url ? await loadImage(data.blockBgImage) : null;
    if (!bg && data.blockBgImage && data.blockBgImage.url) silence.push({ type: "block-image", module: (data.sectionTitle || (R.getDef(module.type) && R.getDef(module.type).label) || "未知板块") });
    const P = artTheme();
    const rot = st.cardStyle === "sticker" ? 0.013 : 0;
    ctx.save();
    if (rot) { const cx0 = area.x + w / 2, cy0 = area.y + usedH / 2; ctx.translate(cx0, cy0); ctx.rotate(rot); ctx.translate(-cx0, -cy0); }
    drawCardBase(ctx, area.x, area.y, w, usedH, radius, st, data, opacity);
    ctx.save();
    roundRectPath(ctx, area.x, area.y, w, usedH, radius);
    ctx.clip();
    if (bg) {
      ctx.fillStyle = data.blockBgColor ? (hexToRgba(data.blockBgColor, 1) || data.blockBgColor) : "#ffffff";
      ctx.fillRect(area.x, area.y, w, usedH);
      coverDraw(ctx, bg, area.x, area.y, w, usedH);
      if (opacity < 0.98) { ctx.fillStyle = alphaColor("#ffffff", 1 - opacity); ctx.fillRect(area.x, area.y, w, usedH); }
    } else if (st.cardStyle === "ink") {
      const nz = noisePattern(ctx);
      if (nz) { ctx.save(); ctx.globalAlpha = 0.05; ctx.fillStyle = nz; ctx.fillRect(area.x, area.y, w, usedH); ctx.restore(); }
    }
    ctx.drawImage(r.scratch, 0, 0, r.scratch.width, usedH, area.x, area.y, w, usedH);
    ctx.restore();
    drawCardBorder(ctx, area.x, area.y, w, usedH, radius, st, data);
    drawCardDecor(ctx, area.x, area.y, w, usedH, radius, st);
    ctx.restore();
    return { h: usedH, silence: silence };
  }

  /* 测量单个模块卡片的真实高度与「标题基线」相对卡片顶的偏移，供排版与 PSD 对齐共用。
     与 drawModuleCard 同款：先画到 scratch 量出 contentEnd → usedH；headBaseline 即 H2 标题基线
     相对卡片顶的像素偏移（0.92*58 的字身顶部下移 + pad）。 */
  async function measureCardLayout(module, w, serial) {
    const r = await _renderScratch(module, w, serial);
    return { h: r.usedH, pad: r.pad, headBaseline: r.headBaseline, w: w };
  }

  /* 计算整页模块的真实排版位置（含 offsetY），供导出与 PSD 对齐共用同一套坐标。 */
  async function measurePageLayout(page, offsetY) {
    const size = pageSize();
    const x = 50;
    const w = size.pageWidth - 100;
    let y = 46 + (offsetY || 0);
    const out = [];
    const rows = M.packModuleRows(page.modules);
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      const list = row.modules.filter(function (m) { return m.visible !== false; });
      if (!list.length) continue;
      if (row.kind === "pair" && list.length === 2) {
        const gap = 14;
        const halfW = (w - gap) / 2;
        const left = await measureCardLayout(list[0], halfW, page.modules.indexOf(list[0]) + 1);
        const right = await measureCardLayout(list[1], halfW, page.modules.indexOf(list[1]) + 1);
        out.push({ module: list[0], x: x, y: y, w: halfW, serial: page.modules.indexOf(list[0]) + 1, head: left.headBaseline, h: left.h });
        out.push({ module: list[1], x: x + halfW + gap, y: y, w: halfW, serial: page.modules.indexOf(list[1]) + 1, head: right.headBaseline, h: right.h });
        const mb = Math.max(px2(Number(list[0].data && list[0].data.marginBottom) || 18), px2(Number(list[1].data && list[1].data.marginBottom) || 18));
        y += Math.max(left.h, right.h) + Math.max(mb, 24);
      } else {
        const module = list[0];
        const meas = await measureCardLayout(module, w, page.modules.indexOf(module) + 1);
        out.push({ module: module, x: x, y: y, w: w, serial: page.modules.indexOf(module) + 1, head: meas.headBaseline, h: meas.h });
        const mb = px2(Number(module.data && module.data.marginBottom) || 18);
        y += meas.h + Math.max(mb, 24);
      }
    }
    return out;
  }

  async function drawModuleStack(ctx, page, offsetY, preLayout) {
    const layout = preLayout || await measurePageLayout(page, offsetY);
    const silence = [];
    for (let i = 0; i < layout.length; i += 1) {
      const item = layout[i];
      const card = await drawModuleCard(ctx, item.module, { x: item.x, y: item.y, w: item.w }, item.serial);
      if (card && card.silence && card.silence.length) silence.push.apply(silence, card.silence);
    }
    return silence;
  }


  /* 导出统一走「实测排版高度」：画布高度 = max(屏高, 内容总高 + 底距)。
     内容超屏时导出画布自动加高，不再静默截断（审计 P1）。
     背景图统一 coverDraw 等比裁切（与预览 background-size:cover 一致，审计 P3）；
     连续长图的整条背景向下锚定，保证跨屏衔接连续。 */
  function auditSilence(silence, pageLabel) {
    if (!silence || !silence.length) return;
    const lines = silence.slice(0, 8).map(function (row) {
      const kind = row.type === "page-background" ? "本屏背景" : row.type === "doc-background" ? "整条背景" : "板块配图";
      const where = row.page ? "第 " + row.page + " 屏 " : (pageLabel || "");
      return where + "「" + (row.module || "未知板块") + "」的" + kind + "引用已失效，该处按占位底色导出";
    });
    if (silence.length > 8) lines.push("……等共 " + silence.length + " 处");
    if (global.alert) global.alert("导出完成，但以下图片未能加载（刷新后旧图片引用会过期）：\n" + lines.join("\n") + "\n\n重新插入图片后再次导出即可还原。");
  }

  /* 整条背景（连续长图）：等比 cover、水平居中、顶对齐向下延展。 */
  function coverDownDraw(ctx, image, x, y, w, h) {
    if (!image || !w || !h) return;
    const scale = Math.max(w / image.width, h / image.height);
    ctx.drawImage(image, x + (w - image.width * scale) / 2, y, image.width * scale, image.height * scale);
  }

  async function drawPageToCanvas(page, opts) {
    const options = opts || {};
    const size = pageSize();
    wrapCache.clear();
    const layout = await measurePageLayout(page, 0);
    const contentBottom = layout.reduce(function (max, item) { return Math.max(max, item.y + (item.h || 0)); }, 0);
    const height = Math.max(size.pageHeight, Math.ceil(contentBottom + 46));
    const canvas = document.createElement("canvas"); canvas.width = size.pageWidth; canvas.height = height; const ctx = canvas.getContext("2d");
    await readyFontForText(docFontFamily(), collectPageText(page));
    await readyFontsForPage(page);
    const silence = [];
    if (options.forStrip) {
      if (page.backgroundColor) { ctx.fillStyle = page.backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      if (page.backgroundImage && page.backgroundImage.url) {
        const pageBg = await loadImage(page.backgroundImage);
        if (pageBg) coverDraw(ctx, pageBg, 0, 0, canvas.width, canvas.height);
        else silence.push({ type: "page-background", module: "本屏背景", page: (state.doc.pages || []).indexOf(page) + 1 });
      }
    } else {
      ctx.fillStyle = page.backgroundColor || state.doc.backgroundColor || "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const bgRef = page.backgroundImage || state.doc.backgroundImage;
      const background = await loadImage(bgRef);
      if (background) coverDraw(ctx, background, 0, 0, canvas.width, canvas.height);
      else if (imageSrc(bgRef)) silence.push({ type: page.backgroundImage ? "page-background" : "doc-background", module: page.backgroundImage ? "本屏背景" : "整条背景" });
    }
    pageBgColorForHoles = page.backgroundColor || state.doc.backgroundColor || "#ffffff";
    const pst = artTheme();
    if (pst.pattern && pst.pattern !== "none") drawPatternOverlay(ctx, canvas.width, canvas.height, pst);
    silence.push.apply(silence, await drawModuleStack(ctx, page, 0, layout));
    return { canvas: canvas, layout: layout, silence: silence, contentHeight: height };
  }

  async function exportPng(allPages) {
    if (global.BannerBuilderExport && global.BannerBuilderExport.exportPng) return global.BannerBuilderExport.exportPng({ allPages: allPages });
    return legacyExportPng(allPages);
  }
  async function exportStripPng() {
    if (global.BannerBuilderExport && global.BannerBuilderExport.exportStripPng) return global.BannerBuilderExport.exportStripPng();
    return legacyExportStripPng();
  }
  async function exportPsd() {
    if (global.BannerBuilderExport && global.BannerBuilderExport.exportPsd) return global.BannerBuilderExport.exportPsd();
    return legacyExportPsd();
  }

  /* ===== 打包字体：把所用字体的桌面文件(.ttf/.otf)下载并打包 ZIP，便于在 PS 中正确渲染文字图层 ===== */
  const _libScriptPromises = {};
  function loadLibScript(url, globalName) {
    if (globalName && global[globalName]) return Promise.resolve(global[globalName]);
    if (_libScriptPromises[url]) return _libScriptPromises[url];
    _libScriptPromises[url] = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = url; s.async = true;
      s.onload = function () { resolve(globalName ? global[globalName] : undefined); };
      s.onerror = function () { reject(new Error("依赖加载失败：" + url)); };
      document.head.appendChild(s);
    });
    return _libScriptPromises[url];
  }
  async function ensureZip() {
    const JSZip = await loadLibScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "JSZip");
    if (typeof JSZip !== "function") throw new Error("JSZip 加载失败");
    return JSZip;
  }
  async function packFontsZip() {
    const headingKey = state.doc.headingFont || state.doc.fontFamily || "sans";
    const bodyKey = state.doc.bodyFont || headingKey;
    const keys = [headingKey, bodyKey].filter(function (key, index, arr) { return arr.indexOf(key) === index; });
    const JSZip = await ensureZip();
    const zip = new JSZip();
    const ok = []; const fail = [];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const dl = C.FONT_DOWNLOADS[key];
      if (!dl) continue;
      const label = C.FONTS[key] ? C.FONTS[key].label : key;
      /* 用户导入字体：dataURL 直存，直接还原打包 */
      if (dl.dataUrl) {
        zip.file("fonts/" + dl.name, dataUrlToBlob(dl.dataUrl));
        ok.push(label);
        continue;
      }
      /* 本地字体（url 为空）：随仓库/系统已存在，无需联网，直接提示手动安装 */
      if (!dl.url) { fail.push(label + "（本地字体，安装 fonts/" + dl.name + "）"); continue; }
      try {
        const resp = await fetch(dl.url, { mode: "cors" });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const blob = await resp.blob();
        zip.file("fonts/" + dl.name, blob);
        ok.push(label);
      } catch (error) { fail.push(label); }
    }
    if (!ok.length) throw new Error("没有可打包的字体文件（可能网络受限）");
    const lines = ["Only-box 长条排版 · 字体安装说明", "", "已打包字体（位于 fonts/ 目录）："];
    ok.forEach(function (name) { lines.push("  - " + name); });
    if (fail.length) {
      lines.push(""); lines.push("以下字体未能自动下载，请手动下载安装：");
      fail.forEach(function (name) { lines.push("  - " + name); });
    }
    lines.push("");
    lines.push("安装方法：双击 .ttf/.otf 文件点击「安装」，或将字体文件复制到系统字体目录后重启 Photoshop。");
    zip.file("字体安装说明.txt", lines.join("\r\n"));
    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, "only-box-banner-fonts.zip");
    return { ok: ok, fail: fail };
  }
  global.BannerBuilderLegacy = { exportPng: function (a) { return legacyExportPng(a); }, exportStripPng: function () { return legacyExportStripPng(); }, exportPsd: function () { return legacyExportPsd(); } };
  /* 导出倍率（1x = 750 设计宽；默认 2x = 1500 高清），文档级可配 doc.exportScale */
  function exportScale() { return Number(state.doc.exportScale) || 2; }

  async function legacyExportPng(allPages) {
    const pages = allPages ? state.doc.pages : [activePage()];
    const allSilence = [];
    const scale = exportScale();
    const pageNo = function (page) { return String(state.doc.pages.indexOf(page) + 1).padStart(2, "0"); };
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      const result = await drawPageToCanvas(page);
      const outCanvas = document.createElement("canvas");
      outCanvas.width = result.canvas.width * scale;
      outCanvas.height = result.canvas.height * scale;
      const outCtx = outCanvas.getContext("2d");
      outCtx.scale(scale, scale);
      outCtx.drawImage(result.canvas, 0, 0);
      await new Promise(function (resolve) {
        outCanvas.toBlob(function (blob) {
          if (blob) downloadBlob(blob, "only-box-banner-" + pageNo(page) + ".png");
          else if (global.alert) global.alert("导出失败：PNG 编码返回空（画布可能过大，请尝试减少板块内容）。");
          resolve();
        }, "image/png");
      });
      result.silence.forEach(function (row) { allSilence.push({ type: row.type, module: row.module, page: state.doc.pages.indexOf(page) + 1 }); });
      /* 多屏连下需要间隔，避免被浏览器「多文件下载」策略拦截（审计 P4）。 */
      if (i < pages.length - 1) await new Promise(function (resolve) { setTimeout(resolve, 320); });
    }
    auditSilence(allSilence);
    return { pages: pages.length };
  }

  /* 连续长图：逐屏按实测高度渲染后纵向拼接；整条背景 cover 向下锚定跨屏连续。 */
  async function legacyExportStripPng() {
    const pages = state.doc.pages || []; if (!pages.length) return null;
    const size = pageSize(); const width = size.pageWidth;
    await readyFontForText(docFontFamily(), pages.map(collectPageText).join(" "));
    const rendered = [];
    let total = 0;
    for (let i = 0; i < pages.length; i += 1) {
      const one = await drawPageToCanvas(pages[i], { forStrip: true });
      rendered.push(one); total += one.canvas.height;
    }
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = total; const ctx = canvas.getContext("2d");
    ctx.fillStyle = state.doc.backgroundColor || "#ffffff"; ctx.fillRect(0, 0, width, total);
    const docImage = await loadImage(state.doc.backgroundImage);
    if (docImage) coverDownDraw(ctx, docImage, 0, 0, width, total);
    else if (imageSrc(state.doc.backgroundImage)) auditSilence([{ type: "doc-background", module: "整条背景" }], "连续长图 ");
    let y0 = 0; const silence = [];
    for (let i = 0; i < rendered.length; i += 1) {
      const h = rendered[i].canvas.height;
      ctx.save(); ctx.beginPath(); ctx.rect(0, y0, width, h); ctx.clip();
      ctx.drawImage(rendered[i].canvas, 0, y0);
      ctx.restore();
      rendered[i].silence.forEach(function (row) { silence.push({ page: i + 1, type: row.type, module: row.module }); });
      y0 += h;
    }
    auditSilence(silence);
    const scale = exportScale();
    const outCanvas = document.createElement("canvas");
    outCanvas.width = canvas.width * scale;
    outCanvas.height = canvas.height * scale;
    const outCtx = outCanvas.getContext("2d");
    outCtx.scale(scale, scale);
    outCtx.drawImage(canvas, 0, 0);
    outCanvas.toBlob(function (blob) { if (blob) downloadBlob(blob, "only-box-banner-continuous.png"); else if (global.alert) global.alert("长图导出失败：PNG 编码返回空（内容可能过大）。"); }, "image/png");
    return { width: outCanvas.width, height: outCanvas.height, pages: rendered.length, silence: silence.length };
  }

  function psFontName() {
    const f = C.FONTS[docFontFamily()] || C.FONTS.sans;
    return f.family.replace(/ /g, "");
  }
  /* PSD 文字层字体名：标题层用标题字体，正文层用正文字体（分角色设置同步到 PS）。 */
  function psFontNameFor(scope) {
    const key = scope === "body"
      ? (state.doc.bodyFont || state.doc.headingFont || state.doc.fontFamily || "sans")
      : (state.doc.headingFont || state.doc.fontFamily || "sans");
    const f = C.FONTS[key] || C.FONTS.sans;
    return f.family.replace(/ /g, "");
  }

  function textLayer(name, value, x, y, size, align) { return textLayerScope(name, value, x, y, size, align, null); }
  function textLayerScope(name, value, x, y, size, align, scope) { if (!value) return null; return { name: name, text: { text: String(value), transform: [1, 0, 0, 1, x, y], style: { font: { name: psFontNameFor(scope) }, fontSize: size, fillColor: { r: 24, g: 34, b: 29 } }, paragraphStyle: { justification: align === "center" ? "center" : align === "right" ? "right" : "left" } } }; }

  /* ===== PSD 可编辑图层辅助：把 CSS 元素转成 PS 形状/文字/图片图层 ===== */
  /* hex(#rgb/#rrggbb) 或 rgb()/rgba() 字符串 → {r,g,b}(0-255)；无法解析返回 null */
  function psdParseRgb(color) {
    const raw = String(color || "").trim();
    if (!raw) return null;
    let m = raw.match(/^#?([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
    m = raw.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (m) { return { r: Math.max(0, Math.min(255, Math.round(Number(m[1])))), g: Math.max(0, Math.min(255, Math.round(Number(m[2])))), b: Math.max(0, Math.min(255, Math.round(Number(m[3])))) }; }
    return null;
  }
  /* 圆角矩形 → PS 矢量蒙版 paths（8 锚点闭合子路径，逆…顺时钟贝塞尔圆角） */
  function psdRoundRect(x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    const k = radius * 0.5522847498;
    const knot = function (cbx, cby, ax, ay, cax, cay) { return { linked: true, points: [cbx, cby, ax, ay, cax, cay] }; };
    return [{ open: false, fillRule: "non-zero", knots: [
      knot(x, y + radius, x, y + radius, x, y + radius - k),
      knot(x + radius - k, y, x + radius, y, x + radius, y),
      knot(x + w - radius, y, x + w - radius, y, x + w - radius + k, y),
      knot(x + w, y + radius - k, x + w, y + radius, x + w, y + radius),
      knot(x + w, y + h - radius, x + w, y + h - radius, x + w, y + h - radius + k),
      knot(x + w - radius + k, y + h, x + w - radius, y + h, x + w - radius, y + h),
      knot(x + radius, y + h, x + radius, y + h, x + radius - k, y + h),
      knot(x, y + h - radius + k, x, y + h - radius, x, y + h - radius),
    ] }];
  }
  /* 形状图层：圆角矩形 + 纯色填充（PS 里可直接改颜色/圆角/路径） */
  function psdShapeLayer(name, x, y, w, h, r, color) {
    const rgb = psdParseRgb(color);
    if (!rgb) return null;
    return { name: name, vectorMask: { paths: psdRoundRect(x, y, w, h, r), invert: false, notLink: false, disable: false }, vectorFill: { type: "color", color: rgb } };
  }
  /* 可见文字图层：可编辑文字、字号、颜色、对齐 */
  function psdTextLayer(name, value, x, y, size, color, align, scope) {
    if (value == null || String(value).trim() === "") return null;
    const rgb = psdParseRgb(color) || { r: 24, g: 34, b: 29 };
    return { name: name, text: { text: String(value), transform: [1, 0, 0, 1, x, y], style: { font: { name: psFontNameFor(scope) }, fontSize: size, fillColor: rgb }, paragraphStyle: { justification: align === "center" ? "center" : align === "right" ? "right" : "left" } } };
  }
  /* 图片位图图层：整页尺寸画布，图片按 cover/contain 定位到指定区域（PS 里可替换/移动） */
  async function psdImageLayer(name, imageRef, x, y, w, h, fit) {
    const img = await loadImage(imageRef);
    if (!img || !w || !h) return null;
    const c = document.createElement("canvas");
    c.width = pageSize().pageWidth; c.height = pageSize().pageHeight;
    const cx = c.getContext("2d");
    if (fit === "contain") containDraw(cx, img, x, y, w, h);
    else coverDraw(cx, img, x, y, w, h);
    return { name: name, canvas: c };
  }

  async function legacyExportPsd() {
    if (!global.agPsd || typeof global.agPsd.writePsd !== "function") { global.alert("PSD 引擎尚未加载，请刷新页面后重试。"); return null; }
    const page = activePage(); const size = pageSize();
    const full = await drawPageToCanvas(page);
    const layout = full.layout;
    const silence = full.silence || [];
    const pageHeight = full.canvas.height;
    const px = function (n) { return Math.round(n); };
    const children = [];
    /* 背景层：铺页面底色，便于在 PS 里改背景 */
    children.push({ name: "背景底色", canvas: (function () {
      const c = document.createElement("canvas"); c.width = size.pageWidth; c.height = pageHeight;
      const cx = c.getContext("2d");
      cx.fillStyle = page.backgroundColor || "#ffffff";
      cx.fillRect(0, 0, c.width, c.height);
      return c;
    })() });

    /* 每板块一组：可编辑图层 = 形状背景 + 图片位图 + 可见文字（全部可在 PS 里直接编辑） */
    const st = artTheme();
    const inkColor = artInk();
    const mutedColor = artMuted();
    const ratioOf = function (ratioStr, fallback) { const m = String(ratioStr || "").replace(/\s+/g, "").match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/); return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : fallback; };
    for (let idx = 0; idx < layout.length; idx += 1) {
      const item = layout[idx];
      const module = item.module;
      const def = R.getDef(module.type);
      const data = module.data || {};
      const group = { name: "板块 " + (idx + 1) + " · " + def.label, children: [], opened: true };

      const addT = function (name, value, x, y, sz, color, align, scope) { const l = psdTextLayer(name, value, x, y, sz, color, align, scope); if (l) group.children.push(l); };
      const addShape = function (name, x, y, w, h, r, color) { const l = psdShapeLayer(name, x, y, w, h, r, color); if (l) group.children.push(l); };
      const addImg = async function (name, ref, x, y, w, h, fit) { const l = await psdImageLayer(name, ref, x, y, w, h, fit); if (l) group.children.push(l); };

      const cardLeft = px(item.x + 18);
      const headY = px(item.y + item.head);
      const cw = item.w;

      /* 1) 卡片背景：CSS 卡片底色 → PS 圆角矩形纯色形状图层（可改颜色/圆角/路径） */
      addShape(def.label + " 背景", item.x, item.y, item.w, item.h, cardRadius(data, st), cardBaseFill(st, data, 1));

      /* 2) 模块主图 → 独立位图图层（可替换/移动） */
      const imgFit = data.imageFit === "contain" ? "contain" : "cover";
      if (module.type === "cover") {
        const tpl = data.template || "immersive";
        if (tpl === "immersive") {
          if (data.mainImage && data.mainImage.url) await addImg("主视觉图", data.mainImage, item.x, item.y, item.w, Math.round(item.w * 0.85), imgFit);
          else addShape(def.label + " 主视觉底", item.x, item.y, item.w, Math.round(item.w * 0.85), cardRadius(data, st), st.primaryDark);
        } else await addImg("主视觉图", data.mainImage, item.x, px(headY + 24), item.w, Math.round(item.w * 0.6), imgFit);
      } else if (module.type === "freeImageBox") {
        await addImg("图片", data.image, item.x, px(headY + 20), item.w, Math.round(item.w / ratioOf(data.ratio, 0.6)), imgFit);
      } else if (module.type === "venueInfo" && data.photo) {
        await addImg("场地照片", data.photo, item.x, px(headY + 24), item.w, Math.round(item.w * 0.55), imgFit);
      } else if (module.type === "crossPromo" && data.icon) {
        await addImg("联动方图标", data.icon, item.x, px(headY + 20), 120, 120, "contain");
      } else if (module.type === "ticketInfo" && data.qrImage) {
        await addImg("购票二维码", data.qrImage, px(item.x + item.w - 228), px(headY + 20), 208, 208, "contain");
      } else if (module.type === "performerCard" && data.cast && data.cast[0] && data.cast[0].avatar) {
        await addImg("成员头像", data.cast[0].avatar, item.x, px(headY + 20), 160, 160, imgFit);
      } else if (module.type === "programList") {
        const pgItems = data.items || [];
        for (let pi = 0; pi < pgItems.length; pi++) { if (pgItems[pi].image) await addImg("节目配图 " + (pi + 1), pgItems[pi].image, item.x, px(headY + 24), cw, Math.round(cw * 0.4), imgFit); }
      } else if (module.type === "boothList") {
        const boItems = data.items || [];
        for (let bi = 0; bi < boItems.length; bi++) { if (boItems[bi].image) await addImg("摊位图 " + (bi + 1), boItems[bi].image, px(item.x + 20), px(headY + 24), 150, 150, imgFit); }
      }

      /* 3) 序号 + 板块标题 + 内容文字（可见、可编辑文字/字号/颜色） */
      addT("序号", String(item.serial != null ? item.serial : idx + 1).padStart(2, "0"), px(item.x + 20), px(item.y + 26), 23, st.accent, "left");
      if (module.type !== "divider" || data.sectionTitle) addT("板块标题", moduleTitle(module, def), px(item.x + item.w / 2), headY, 54, st.primaryDark, "center");

      switch (module.type) {
        case "cover": {
          if ((data.template || "immersive") === "immersive") {
            const heroH = Math.round(item.w * 0.85);
            addT("主标题", data.title, px(item.x + cw / 2), px(item.y + heroH - 42), 65, "#ffffff", "center");
            addT("副标题", data.subtitle, px(item.x + cw / 2), px(item.y + heroH - 90), 29, "#ffffff", "center");
          } else {
            addT("主标题", data.title, cardLeft, px(headY + 68), 65, st.primaryDark, "left");
            addT("副标题", data.subtitle, cardLeft, px(headY + 170), 29, mutedColor, "left");
          }
          (data.infoLines || []).filter(Boolean).slice(0, 6).forEach(function (line, i) { addT("信息行 " + (i + 1), line, cardLeft, px(headY + 235 + i * 36), 23, mutedColor, "left"); });
          addT("QQ 群号", data.qqGroupNumber, cardLeft, px(headY + 320), 23, mutedColor, "left");
          break;
        }
        case "announcement":
          addT("小标题", data.heading, cardLeft, px(headY + 60), 29, st.primaryDark, "left");
          addT("正文", data.body, cardLeft, px(headY + 105), 29, inkColor, data.bodyAlign || "left", "body");
          break;
        case "ticketInfo": {
          let ty = headY + 70;
          (data.tiers || []).forEach(function (t, i) { addT("票档 " + (i + 1), [t.label, t.price].filter(Boolean).join("　"), cardLeft, ty, 27, st.primaryDark, "left"); ty += 42; });
          addT("购票说明", data.note, cardLeft, ty + 10, 23, mutedColor, "left", "body");
          break;
        }
        case "materials": {
          let my = headY + 70;
          (data.items || []).forEach(function (it, i) { addT("物料 " + (i + 1), it.label, cardLeft, my, 25, inkColor, "left", "body"); my += 38; });
          addT("补充说明", data.note, cardLeft, my + 10, 23, mutedColor, "left", "body");
          break;
        }
        case "crossPromo":
          addT("推广文案", data.text, cardLeft, px(headY + 70), 27, inkColor, data.bodyAlign || "left", "body");
          break;
        case "schedule": {
          let sy = headY + 70;
          (data.groups || []).forEach(function (g) { if (g.groupName) { addT("分组", g.groupName, cardLeft, sy, 27, st.primaryDark, "left"); sy += 40; } (g.rows || []).forEach(function (r) { addT("环节", [r.time, r.name].filter(Boolean).join("  "), cardLeft, sy, 25, inkColor, "left", "body"); sy += 36; }); sy += 14; });
          break;
        }
        case "venueInfo":
          addT("场地描述", data.description, cardLeft, px(headY + 70), 27, inkColor, data.bodyAlign || "left", "body");
          addT("标签", (data.tags || []).filter(Boolean).join(" · "), cardLeft, px(headY + 170), 23, st.primaryDark, "left");
          break;
        case "routeText": {
          let ry = headY + 70;
          (data.lines || []).filter(Boolean).forEach(function (line, i) { addT("步骤 " + (i + 1), line, cardLeft, ry, 27, inkColor, "left", "body"); ry += 40; });
          break;
        }
        case "programList": {
          let py = headY + 70;
          (data.items || []).forEach(function (it, i) { addT("节目 " + (i + 1), [it.tag, it.title, it.subtitle].filter(Boolean).join("  "), cardLeft, py, 25, inkColor, "left", "body"); py += 40; });
          break;
        }
        case "performerCard": {
          let pcy = headY + 70;
          (data.cast || []).forEach(function (member) {
            if (member.name) { addT("成员", [R.castRoleLabel(member.role), member.name, member.time].filter(Boolean).join("  "), cardLeft, pcy, 30, st.primaryDark, "left"); pcy += 44; }
            if (member.bio) { addT("简介", member.bio, cardLeft, pcy, 23, inkColor, data.bodyAlign || "left", "body"); pcy += 60; }
            const setlist = (member.setlist || []).filter(function (s) { return s && (s.song || s.coverBy); });
            if (setlist.length) {
              addT("歌单", setlist.map(function (s) { return [s.song, s.coverBy].filter(Boolean).join(" / "); }).join("  ·  "), cardLeft, pcy, 21, mutedColor, "left", "body");
              pcy += 34;
            }
            pcy += 8;
          });
          break;
        }
        case "boothList": {
          let by = headY + 70;
          (data.items || []).forEach(function (it, i) { addT("摊位 " + (i + 1), [it.name, it.desc].filter(Boolean).join("  "), cardLeft, by, 25, inkColor, "left", "body"); by += 42; });
          break;
        }
        case "footer":
          addT("页脚内容", (data.lines || []).filter(Boolean).join(" · "), cardLeft, px(headY + 70), 23, mutedColor, "left", "body");
          break;
        case "freeText":
          addT("文本", data.text, cardLeft, px(headY + 70), C.fontSizePx(data.level || "body", size.pageWidth), inkColor, data.align || "left", "body");
          break;
        case "freeImageBox":
          addT("图注", data.caption, px(item.x + cw / 2), px(item.y + item.h - 20), 23, mutedColor, data.contentAlign || "center");
          break;
        case "divider":
          break;
        default:
          break;
      }
      children.push(group);
    }
    try {
      const buffer = global.agPsd.writePsd({ width: size.pageWidth, height: pageHeight, children: children }, { generateThumbnail: true });
      downloadBlob(new Blob([buffer], { type: "application/octet-stream" }), "only-box-banner-page-" + (activePageIndex() + 1) + ".psd");
      auditSilence(silence, "PSD 第 " + (activePageIndex() + 1) + " 屏 ");
      return { layers: children.length, silence: silence.length };
    } catch (error) { global.alert("PSD 导出失败：" + error.message); return null; }
  }

  /* 草稿图片持久化（审计 P6）：保存前用「我的模板」同款 snapshotData 把所有 blob: 引用
     转成 dataURL 写进 JSON；恢复时再把 dataURL 还原为 blob:，会话内行为与手选图片一致。
     还原只处理 <32MB 的 dataURL，超大的保留原样（canvas 可直接加载 data:）。 */
  function dataUrlToBlobRecord(value) {
    try {
      const parts = String(value.url).split(",");
      if (!parts[1] || parts[1].length > 32000000) return value;
      const meta = parts[0].match(/^data:([^;]+)/);
      const mime = meta ? meta[1] : "image/png";
      const bin = atob(parts[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return { url: URL.createObjectURL(new Blob([bytes], { type: mime })), name: value.name, type: mime };
    } catch (error) { return value; }
  }
  function restoreDraftImages(value) {
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i += 1) value[i] = restoreDraftImages(value[i]); return value; }
    if (!value || typeof value !== "object") return value;
    if (typeof value.url === "string" && value.url.indexOf("data:") === 0 && typeof value.name === "string") return dataUrlToBlobRecord(value);
    Object.keys(value).forEach(function (key) { value[key] = restoreDraftImages(value[key]); });
    return value;
  }
  async function saveDraft() {
    const tpl = global.BannerBuilderMyTemplates;
    if (!tpl || typeof tpl.snapshotData !== "function") { downloadText(JSON.stringify(M.toJSON(state.doc), null, 2), "only-box-banner-draft.json"); return; }
    try {
      const snap = await tpl.snapshotData(M.toJSON(state.doc));
      downloadText(JSON.stringify(snap, null, 2), "only-box-banner-draft.json");
    } catch (error) { global.alert("草稿保存失败：" + ((error && error.message) || error)); }
  }
  function migrateModuleData(module) {
    /* 旧「嘉宾卡」单嘉宾结构（name/bio/setlist/images）→ 新「演出阵容」列表结构（cast） */
    if (module && module.type === "performerCard" && module.data && !Array.isArray(module.data.cast)) {
      const legacy = module.data;
      const setlist = (legacy.setlist || []).map(function (song) {
        return { song: String(song).replace(/^♪\s*/, ""), coverBy: "" };
      });
      module.data.cast = [{
        role: "",
        name: legacy.name || "",
        avatar: (legacy.images && legacy.images[0]) || null,
        avatarRatio: "1:1",
        time: "",
        bio: legacy.bio || "",
        setlist: setlist,
      }];
    }
    return module;
  }
  function loadDraft(file) { const reader = new FileReader(); reader.onload = function () { try { const parsed = JSON.parse(reader.result); if (!parsed || !Array.isArray(parsed.pages)) throw new Error("文件结构不正确"); restoreDraftImages(parsed); (parsed.pages || []).forEach(function (page) { (page.modules || []).forEach(migrateModuleData); }); state.doc = parsed; if (!state.doc.themeOverrides) state.doc.themeOverrides = {}; if (!state.doc.exportScale) state.doc.exportScale = 2; state.activePageId = state.doc.pages[0].id; state.selectedModuleId = null; if (state.doc.headingFont) ensureFont(state.doc.headingFont); if (state.doc.bodyFont) ensureFont(state.doc.bodyFont); if (state.doc.fontFamily) ensureFont(state.doc.fontFamily); renderAll(); } catch (error) { global.alert("草稿读取失败：" + error.message); } }; reader.readAsText(file); }

  function bindEvents() {
    els.ratioGroup.addEventListener("click", function (event) { const button = event.target.closest("[data-ratio]"); if (!button) return; state.doc.ratio = button.dataset.ratio; renderAll(); });
    els.screenModeGroup.addEventListener("click", function (event) { const button = event.target.closest("[data-screen]"); if (!button) return; state.doc.screenMode = button.dataset.screen; renderAll(); });
    els.addPageBtn.addEventListener("click", function () {
      const page = M.addPage(state.doc); state.activePageId = page.id; state.selectedModuleId = null; renderAll();
      if (continuousMode()) scrollCanvasToBottom();
    });
    els.backgroundInput.addEventListener("change", function () {
      const file = this.files && this.files[0];
      if (!file) return;
      const value = { url: URL.createObjectURL(file), name: file.name, type: file.type };
      if (els.backgroundScope.value === "page") activePage().backgroundImage = value;
      else state.doc.backgroundImage = value;
      renderAll();
      this.value = "";
    });
    if (els.backgroundColorInput) els.backgroundColorInput.addEventListener("input", function () {
      const value = this.value || "#ffffff";
      if (els.backgroundScope.value === "page") activePage().backgroundColor = value;
      else state.doc.backgroundColor = value;
      renderCanvas(); renderPanel();
    });
    if (els.backgroundScope && els.backgroundColorInput) els.backgroundScope.addEventListener("change", function () {
      const scopeColor = this.value === "page" ? activePage().backgroundColor : state.doc.backgroundColor;
      els.backgroundColorInput.value = scopeColor || "#ffffff";
      if (this.value === "doc") renderCanvas();
    });
    els.themeSelect.addEventListener("change", function () {
      const prev = state.doc.theme;
      state.doc.theme = this.value;
      const nextSt = C.themeStyle(state.doc.theme);
      const prevSt = C.themeStyle(prev);
      /* 主题推荐字体：用户从未手动改字体时随主题应用；手动改过则只在「仍等于旧主题推荐」时跟随，
         且「跟随全局/标题」(空) 与手动字体一律保持，避免主题切换污染字体跟随关系。 */
      if (state.doc.fontManual === true) {
        if (prevSt.headingFont && state.doc.headingFont === prevSt.headingFont) state.doc.headingFont = nextSt.headingFont || "";
        if (prevSt.bodyFont && state.doc.bodyFont === prevSt.bodyFont) state.doc.bodyFont = nextSt.bodyFont || "";
      } else {
        state.doc.headingFont = nextSt.headingFont || "";
        state.doc.bodyFont = nextSt.bodyFont || "";
      }
      if (state.doc.headingFont) ensureFont(state.doc.headingFont);
      if (state.doc.bodyFont) ensureFont(state.doc.bodyFont);
      renderAll();
    });
    els.fontSelect.addEventListener("change", function () { state.doc.fontFamily = this.value || "sans"; state.doc.fontManual = true; ensureFont(state.doc.fontFamily); renderAll(); });
    els.headingFontSelect.addEventListener("change", function () { state.doc.headingFont = this.value; state.doc.fontManual = true; if (this.value) ensureFont(this.value); renderAll(); });
    els.bodyFontSelect.addEventListener("change", function () { state.doc.bodyFont = this.value; state.doc.fontManual = true; if (this.value) ensureFont(this.value); renderAll(); });
    if (els.importFontBtn) els.importFontBtn.addEventListener("click", showFontImportModal);
    els.zoomOutBtn.addEventListener("click", function () { state.zoom = Math.max(.15, state.zoom - .05); renderToolbar(); renderCanvas(); });
    els.zoomInBtn.addEventListener("click", function () { state.zoom = Math.min(1.5, state.zoom + .05); renderToolbar(); renderCanvas(); });
    els.zoomFitBtn.addEventListener("click", function () { const avail = (els.canvasBody.clientWidth || 560) - 48; state.zoom = Math.min(1.5, Math.max(.15, avail / pageSize().pageWidth)); renderToolbar(); renderCanvas(); });
    els.exportPngBtn.addEventListener("click", function () { exportPng(false); });
    els.exportAllBtn.addEventListener("click", function () { exportPng(true); });
    els.exportStripBtn.addEventListener("click", exportStripPng);
    els.exportPsdBtn.addEventListener("click", async function () { const result = await exportPsd(); if (result && els.packFontsToggle && els.packFontsToggle.checked) { try { await packFontsZip(); } catch (error) { if (global.alert) global.alert("字体打包失败：" + (error && error.message || error)); } } });
    els.saveDraftBtn.addEventListener("click", saveDraft);
    els.loadDraftInput.addEventListener("change", function () { if (this.files && this.files[0]) loadDraft(this.files[0]); this.value = ""; });
    els.libraryList.addEventListener("click", function (event) { const custom = event.target.closest("[data-action='lib-add-custom']"); if (custom) { addCustomModuleToPage(custom.dataset.customId); return; } const button = event.target.closest("[data-action='lib-add']"); if (!button) return; const module = M.addModule(state.doc, activePage().id, button.dataset.type); state.selectedModuleId = module.id; renderAll(); if (continuousMode()) scrollSelectedIntoView(); });
    els.myTplList.addEventListener("click", function (event) { const del = event.target.closest("[data-action='tpl-del']"); if (del) { deleteMyTemplate(del.dataset.tplId); return; } const add = event.target.closest("[data-action='tpl-add']"); if (add) addTemplateToPage(add.dataset.tplId); });
    els.panelBody.addEventListener("click", function (event) { const target = event.target.closest("[data-action='save-tpl']"); if (target) saveSelectedModuleAsTemplate(); });
    els.canvasBody.addEventListener("click", function (event) { const target = event.target.closest("[data-action]"); if (!target) return; const action = target.dataset.action; const moduleId = target.dataset.moduleId; const pageId = target.dataset.pageId; if (action === "page-pick") { state.activePageId = pageId; state.selectedModuleId = null; renderAll(); return; } if (action === "module-pick") { if (state.pickMode !== "module") { const hostCard = target.closest(".bb-page-card"); state.activePageId = (hostCard && hostCard.dataset.pageId) || M.findModule(state.doc, moduleId).page.id; state.selectedModuleId = null; renderAll(); return; } state.selectedModuleId = moduleId; state.activePageId = M.findModule(state.doc, moduleId).page.id; renderAll(); return; } if (action === "page-del") { const page = M.findPage(state.doc, pageId); if (page.modules.length && !global.confirm("这一屏还有内容，确定删除吗？")) return; M.removePage(state.doc, pageId); state.activePageId = activePage().id; state.selectedModuleId = null; renderAll(); return; } if (action === "module-up" || action === "module-down") { event.stopPropagation(); M.moveModule(state.doc, moduleId, action === "module-up" ? -1 : 1); renderAll(); return; } if (action === "module-del") { event.stopPropagation(); M.removeModule(state.doc, moduleId); state.selectedModuleId = null; renderAll(); } });
    if (els.pickModuleToggle) els.pickModuleToggle.addEventListener("change", function () { state.pickMode = this.checked ? "module" : "screen"; if (state.pickMode === "screen" && state.selectedModuleId) { state.selectedModuleId = null; renderAll(); return; } syncPickMode(); });
    if (els.importThemeBtn) els.importThemeBtn.addEventListener("click", showThemeImportModal);
    if (els.importModuleBtn) els.importModuleBtn.addEventListener("click", showModuleImportModal);
    /* ===== 三步向导切换 ===== */
    if (els.stepBar) els.stepBar.addEventListener("click", function (event) {
      const button = event.target.closest(".bb-step[data-step]");
      if (!button) return;
      const next = button.dataset.step;
      if (next === state.step) return;
      state.step = next;
      /* 进入编辑步骤清除选中，避免属性栏在库栏隐藏时残留孤板块面板 */
      if (next !== "edit") state.selectedModuleId = null;
      renderAll();
    });
    /* ===== 导出倍率 ===== */
    if (els.exportScaleGroup) els.exportScaleGroup.addEventListener("click", function (event) {
      const button = event.target.closest("[data-scale]");
      if (!button) return;
      state.doc.exportScale = Number(button.dataset.scale);
      renderToolbar(); renderPanel();
    });
    /* ===== 微调主题 ===== */
    if (els.tweakThemeBtn) els.tweakThemeBtn.addEventListener("click", showThemeTweakModal);
  }

  /* ===== 主题导入弹窗 ===== */
  function rebuildThemeSelect(opts) {
    var sel = els.themeSelect;
    if (!sel) return;
    var value = sel.value;
    sel.textContent = "";
    var options = opts || C.getThemeOptions();
    var importer = global.BannerBuilderThemeImporter;
    options.forEach(function (o) {
      var option = el("option", null, (importer && importer.isCustom(o.value) ? "★ " : "") + o.label);
      option.value = o.value;
      sel.appendChild(option);
    });
    sel.value = options.some(function (o) { return o.value === value; }) ? value : (options[0] ? options[0].value : "forest");
  }

  function showThemeImportModal() {
    var existing = document.getElementById("bb-theme-modal");
    if (existing) { existing.parentNode.removeChild(existing); }

    var mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-theme-modal";

    var modal = document.createElement("div");
    modal.className = "bb-modal";

    var h3 = el("h3", null, "导入 AI 生成的主题");
    modal.appendChild(h3);
    modal.appendChild(el("p", null, "复制下方 AI 提示词发给 ChatGPT / Claude 等 AI → 把生成的 JSON 粘贴回来 → 点击导入"));

    var promptArea = document.createElement("textarea");
    promptArea.className = "bb-input bb-modal-textarea";
    promptArea.readOnly = true;
    promptArea.style.height = "80px";
    promptArea.value = (global.BannerBuilderThemeImporter && global.BannerBuilderThemeImporter.promptText) || "";
    modal.appendChild(promptArea);

    var copyRow = document.createElement("div");
    copyRow.className = "bb-modal-actions";
    var copyBtn = el("button", "bb-btn ghost", "📋 复制 AI 提示词");
    copyBtn.type = "button";
    copyBtn.addEventListener("click", function () {
      try { navigator.clipboard.writeText(promptArea.value).then(function () { copyBtn.textContent = "✓ 已复制"; setTimeout(function () { copyBtn.textContent = "📋 复制 AI 提示词"; }, 2000); }); } catch (e) {}
    });
    copyRow.appendChild(copyBtn);
    modal.appendChild(copyRow);

    var inputLabel = el("p", null, "▼ 将 AI 生成的 JSON 粘贴到下方（支持带 markdown 代码块）");
    inputLabel.style.marginTop = "16px";
    modal.appendChild(inputLabel);

    var inputArea = document.createElement("textarea");
    inputArea.className = "bb-input bb-modal-textarea";
    inputArea.placeholder = "粘贴 AI 生成的 JSON 主题代码...";
    modal.appendChild(inputArea);

    var msgArea = el("div");
    msgArea.style.display = "none";
    modal.appendChild(msgArea);

    var actionRow = document.createElement("div");
    actionRow.className = "bb-modal-actions";
    var importBtn = el("button", "bb-btn primary", "导入主题");
    importBtn.type = "button";
    importBtn.addEventListener("click", function () {
      var raw = inputArea.value.trim();
      if (!raw) { showMsg("error", "请先粘贴 JSON 代码"); return; }
      var obj = global.BannerBuilderThemeImporter.extractJson(raw);
      if (!obj) { showMsg("error", "JSON 格式解析失败，请确认粘贴内容"); return; }
      var errors = global.BannerBuilderThemeImporter.validate(obj);
      if (errors.length) { showMsg("error", "校验不通过：\n" + errors.join("\n")); return; }
      try {
        global.BannerBuilderThemeImporter.add(obj);
        rebuildThemeSelect();
        showMsg("success", "✓ 主题「" + obj.label + "」已导入，可在主题下拉菜单中选用");
      } catch (e) {
        showMsg("error", "保存失败：" + (e && e.message || e));
      }
    });
    actionRow.appendChild(importBtn);

    var cancelBtn = el("button", "bb-btn ghost", "关闭");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", function () { mask.parentNode.removeChild(mask); });
    actionRow.appendChild(cancelBtn);

    modal.appendChild(actionRow);
    mask.appendChild(modal);

    mask.addEventListener("click", function (e) { if (e.target === mask) mask.parentNode.removeChild(mask); });
    document.body.appendChild(mask);

    function showMsg(type, text) {
      msgArea.style.display = "block";
      msgArea.className = type === "error" ? "bb-modal-error" : "bb-modal-success";
      msgArea.textContent = text;
    }
  }

  /* ===== 微调主题：在当前预设主题基础上手动覆盖颜色与风格字段（写入 doc.themeOverrides） ===== */
  const THEME_COLOR_FIELDS = [
    { key: "primary", label: "主色" },
    { key: "primaryDark", label: "深主色" },
    { key: "primarySoft", label: "浅底" },
    { key: "accent", label: "强调色" },
    { key: "accentSoft", label: "强调浅底" },
    { key: "line", label: "线色 / 描边" },
    { key: "soft", label: "软底 / 卡片空底" },
  ];
  const THEME_STYLE_FIELDS = [
    { key: "cardStyle", label: "卡片骨架", options: [["card", "细边框白底"], ["panel", "深色硬边"], ["glass", "磨砂玻璃"], ["ticket", "打孔票据"], ["sticker", "白底粗描边贴纸"], ["ink", "双层描边纸感"]] },
    { key: "radius", label: "圆角 (px)", type: "number" },
    { key: "shadow", label: "阴影", options: [["soft", "柔和"], ["hard", "硬偏移"], ["glow", "霓虹光晕"], ["none", "无"]] },
    { key: "divider", label: "分割线", options: [["wave", "波浪"], ["dots", "圆点"], ["line", "直线"], ["glitch", "故障线"], ["thread", "缝线"], ["dashed", "虚线"]] },
    { key: "chips", label: "标签块形状", options: [["pill", "胶囊"], ["squared", "方角"], ["tag", "单边缺角"]] },
    { key: "titleDecor", label: "大标题装饰", options: [["none", "无"], ["bar", "色条"], ["bracket", "括号"], ["stitch", "缝线"], ["kicker", "斜杠序号"]] },
    { key: "pattern", label: "页面底纹", options: [["none", "无"], ["grid", "网格"], ["dots", "圆点"], ["stripes", "斜条纹"], ["paper", "纸纹"], ["noise", "噪点"]] },
    { key: "avatarStyle", label: "头像装饰", options: [["none", "无"], ["ring", "描边圈"], ["glow", "光晕"], ["badge", "角标"], ["frame", "相框"], ["polaroid", "拍立得"]] },
  ];
  function hexToColor(value) {
    return String(value || "").match(/^#[0-9a-f]{6}$/i) ? value.toLowerCase() : "#000000";
  }
  function themeOverride(key) {
    const ov = state.doc.themeOverrides || {};
    return ov[key] == null || ov[key] === "" ? null : ov[key];
  }
  function showThemeTweakModal() {
    const existing = document.getElementById("bb-tweak-modal");
    if (existing) existing.parentNode.removeChild(existing);
    const base = C.themeStyle(state.doc.theme);

    const mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-tweak-modal";
    const modal = document.createElement("div");
    modal.className = "bb-modal";
    modal.appendChild(el("h3", null, "微调主题「" + (base.label || state.doc.theme) + "」"));
    modal.appendChild(el("p", null, "在预设主题基础上手动覆盖颜色与风格。未覆盖的项显示为「继承预设」，恢复默认即清除该项覆盖。改动实时反映到画布与导出。"));

    const body = el("div");
    body.style.marginTop = "6px";

    function section(title) {
      const d = el("div", "bb-tweak-section", title);
      body.appendChild(d);
    }

    /* 颜色覆盖 */
    section("颜色覆盖");
    THEME_COLOR_FIELDS.forEach(function (field) {
      const cur = themeOverride(field.key);
      const preset = base[field.key] || "#ffffff";
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", field.label));
      const colorInput = el("input", "bb-tweak-input");
      colorInput.type = "color";
      colorInput.value = hexToColor(cur != null ? cur : preset);
      const hex = el("input", "bb-tweak-hex");
      hex.value = cur != null ? cur : preset;
      hex.readOnly = cur == null;
      hex.style.opacity = cur == null ? "0.55" : "1";
      const flag = el("span", "bb-tweak-inherit");
      flag.textContent = cur == null ? "继承预设" : "已覆盖";
      const clear = el("a", "bb-tweak-clear", "恢复默认");
      clear.style.display = cur == null ? "none" : "inline";
      clear.title = "清除该颜色覆盖，回退到预设主题";
      function applyHex() {
        const value = hexToColor(hex.value);
        state.doc.themeOverrides = state.doc.themeOverrides || {};
        state.doc.themeOverrides[field.key] = value;
        colorInput.value = value;
        hex.value = value;
        flag.textContent = "已覆盖";
        clear.style.display = "inline";
        renderAll();
      }
      colorInput.addEventListener("input", function () { hex.value = colorInput.value; applyHex(); });
      hex.addEventListener("change", applyHex);
      clear.addEventListener("click", function () {
        if (state.doc.themeOverrides) delete state.doc.themeOverrides[field.key];
        renderAll(); maskRemove();
      });
      row.appendChild(colorInput); row.appendChild(hex); row.appendChild(flag); row.appendChild(clear);
      body.appendChild(row);
    });

    /* 风格覆盖 */
    section("风格覆盖");
    THEME_STYLE_FIELDS.forEach(function (field) {
      const cur = themeOverride(field.key);
      const preset = field.type === "number" ? (base[field.key] != null ? base[field.key] : 13) : (base[field.key] || (field.options && field.options[0][0]));
      const row = el("div", "bb-tweak-row");
      row.appendChild(el("span", "bb-tweak-label", field.label));
      let input;
      if (field.type === "number") {
        input = el("input", "bb-tweak-num");
        input.type = "number"; input.min = "0"; input.max = "100"; input.step = "1";
        input.value = cur != null ? cur : preset;
      } else {
        input = el("select", "bb-tweak-select");
        field.options.forEach(function (pair) {
          const opt = el("option", pair[1]); opt.value = pair[0]; input.appendChild(opt);
        });
        input.value = cur != null ? cur : preset;
      }
      const flag = el("span", "bb-tweak-inherit");
      flag.textContent = cur == null ? "继承预设" : "已覆盖";
      const clear = el("a", "bb-tweak-clear", "恢复默认");
      clear.style.display = cur == null ? "none" : "inline";
      function applyValue() {
        state.doc.themeOverrides = state.doc.themeOverrides || {};
        state.doc.themeOverrides[field.key] = field.type === "number" ? (Number(input.value) || 0) : input.value;
        flag.textContent = "已覆盖";
        clear.style.display = "inline";
        renderAll();
      }
      input.addEventListener(field.type === "number" ? "input" : "change", applyValue);
      clear.addEventListener("click", function () {
        if (state.doc.themeOverrides) delete state.doc.themeOverrides[field.key];
        renderAll(); maskRemove();
      });
      row.appendChild(input); row.appendChild(flag); row.appendChild(clear);
      body.appendChild(row);
    });
    modal.appendChild(body);

    const actionRow = el("div", "bb-modal-actions");
    const resetAll = el("button", "bb-btn ghost", "全部恢复预设");
    resetAll.type = "button";
    resetAll.addEventListener("click", function () { state.doc.themeOverrides = {}; renderAll(); maskRemove(); });
    const closeBtn = el("button", "bb-btn primary", "完成");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () { maskRemove(); });
    actionRow.appendChild(resetAll);
    actionRow.appendChild(closeBtn);
    modal.appendChild(actionRow);
    mask.appendChild(modal);
    mask.addEventListener("click", function (e) { if (e.target === mask) maskRemove(); });
    document.body.appendChild(mask);

    function maskRemove() {
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
    }
  }

  function syncPickMode() {
    if (!els.pickModuleToggle) return;
    const on = state.pickMode === "module";
    els.pickModuleToggle.checked = on;
    if (els.pickModeText) els.pickModeText.textContent = on ? "选图层" : "选整屏";
    if (els.canvasBody) els.canvasBody.classList.toggle("bb-pick-module", on);
  }

  /* ===== 字体下拉重建（内置字体 + 用户导入字体） ===== */
  function fillFontSelect(sel, opts, firstOption) {
    if (!sel) return;
    sel.textContent = "";
    if (firstOption) { const o = el("option", null, firstOption.label); o.value = firstOption.value; sel.appendChild(o); }
    opts.forEach(function (o) {
      const option = el("option", null, o.label);
      option.value = o.value;
      sel.appendChild(option);
    });
  }
  function refreshFontSelects() {
    const opts = C.getFontOptions();
    const keep = {
      font: els.fontSelect.value,
      heading: els.headingFontSelect.value,
      body: els.bodyFontSelect.value,
    };
    fillFontSelect(els.fontSelect, opts);
    fillFontSelect(els.headingFontSelect, opts, { value: "", label: "跟随全局字体" });
    fillFontSelect(els.bodyFontSelect, opts, { value: "", label: "跟随标题字体" });
    const has = function (v) { return !v || opts.some(function (o) { return o.value === v; }); };
    els.fontSelect.value = has(keep.font) ? keep.font : "sans";
    els.headingFontSelect.value = has(keep.heading) ? keep.heading : "";
    els.bodyFontSelect.value = has(keep.body) ? keep.body : "";
  }

  /* ===== 用户导入字体弹窗 ===== */
  function showFontImportModal() {
    var importer = global.BannerBuilderFontImporter;
    if (!importer || !importer.isAvailable()) {
      if (global.alert) global.alert("当前浏览器不支持 IndexedDB，无法保存导入字体。");
      return;
    }
    var existing = document.getElementById("bb-font-modal");
    if (existing) existing.parentNode.removeChild(existing);

    var mask = document.createElement("div");
    mask.className = "bb-modal-mask";
    mask.id = "bb-font-modal";
    var modal = document.createElement("div");
    modal.className = "bb-modal";

    modal.appendChild(el("h3", null, "导入本地字体"));
    modal.appendChild(el("p", null, "选择一个 .ttf / .otf / .woff / .woff2 字体文件，工具会读取字体家族名、保存到浏览器本地，并立即加入上方的「全局 / 标题 / 正文」字体下拉。"));

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";
    fileInput.style.cssText = "margin:14px 0;display:block";
    modal.appendChild(fileInput);

    var msgArea = el("div");
    msgArea.style.display = "none";
    modal.appendChild(msgArea);

    function showMsg(type, text) {
      msgArea.style.display = "block";
      msgArea.className = type === "error" ? "bb-modal-error" : "bb-modal-success";
      msgArea.textContent = text;
    }

    fileInput.addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || "";
      if (["ttf", "otf", "woff", "woff2"].indexOf(String(ext).toLowerCase()) < 0) {
        showMsg("error", "不支持的文件类型，请选择 .ttf / .otf / .woff / .woff2 字体文件。");
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result);
        try {
          var meta = importer.parseFontMeta(arrayBufferFromDataUrl(dataUrl));
          var family = meta.family || file.name.replace(/\.[a-z0-9]+$/i, "");
          var record = importer.buildRecord({
            label: family,
            family: family,
            format: meta.format || "truetype",
            fileName: file.name,
            dataUrl: dataUrl,
          });
          importer.addFont(record).then(function () {
            return importer.refresh().then(function () {
              importer.applyToConstants();
              refreshFontSelects();
              showMsg("success", "✓ 已导入字体「" + family + "」（" + file.name + "），可在字体下拉中选用。");
              fileInput.value = "";
            });
          }).catch(function (e) {
            showMsg("error", "导入失败：" + (e && e.message || e));
          });
        } catch (e) {
          showMsg("error", "解析字体失败：" + (e && e.message || e));
        }
      };
      reader.onerror = function () { showMsg("error", "读取字体文件失败。"); };
      reader.readAsDataURL(file);
    });

    var actionRow = document.createElement("div");
    actionRow.className = "bb-modal-actions";
    var closeBtn = el("button", "bb-btn ghost", "关闭");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () { mask.parentNode.removeChild(mask); });
    actionRow.appendChild(closeBtn);
    modal.appendChild(actionRow);
    mask.appendChild(modal);
    mask.addEventListener("click", function (e) { if (e.target === mask) mask.parentNode.removeChild(mask); });
    document.body.appendChild(mask);
  }

  function arrayBufferFromDataUrl(dataUrl) {
    var comma = dataUrl.indexOf(",");
    if (comma < 0) throw new Error("字体数据格式错误");
    var b64 = dataUrl.slice(comma + 1);
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function init() { if (initialized) return; initialized = true; els.backgroundInput = document.getElementById("backgroundInput"); els.backgroundScope = document.getElementById("backgroundScope"); els.backgroundColorInput = document.getElementById("backgroundColorInput"); els.ratioGroup = document.getElementById("ratioGroup"); els.screenModeGroup = document.getElementById("screenModeGroup"); els.sizeReadout = document.getElementById("sizeReadout"); els.addPageBtn = document.getElementById("addPageBtn"); els.stats = document.getElementById("docStats"); els.themeSelect = document.getElementById("themeSelect"); els.importThemeBtn = document.getElementById("importThemeBtn"); els.importModuleBtn = document.getElementById("importModuleBtn"); els.libraryList = document.getElementById("libraryList"); els.libraryHint = document.getElementById("libraryHint"); els.myTplArea = document.getElementById("myTplArea"); els.myTplCount = document.getElementById("myTplCount"); els.myTplList = document.getElementById("myTplList"); els.fontSelect = document.getElementById("fontSelect"); els.headingFontSelect = document.getElementById("headingFontSelect"); els.bodyFontSelect = document.getElementById("bodyFontSelect"); els.importFontBtn = document.getElementById("importFontBtn"); C.getThemeOptions().forEach(function (o) { const op = el("option", null, o.label); op.value = o.value; els.themeSelect.appendChild(op); }); els.zoomOutBtn = document.getElementById("zoomOutBtn"); els.zoomInBtn = document.getElementById("zoomInBtn"); els.zoomFitBtn = document.getElementById("zoomFitBtn"); els.zoomValue = document.getElementById("zoomValue"); els.exportPngBtn = document.getElementById("exportPngBtn"); els.exportAllBtn = document.getElementById("exportAllBtn"); els.exportStripBtn = document.getElementById("exportStripBtn"); els.exportPsdBtn = document.getElementById("exportPsdBtn"); els.packFontsToggle = document.getElementById("packFontsToggle"); els.saveDraftBtn = document.getElementById("saveDraftBtn"); els.loadDraftInput = document.getElementById("loadDraftInput"); els.libraryList = document.getElementById("libraryList"); els.libraryHint = document.getElementById("libraryHint"); els.myTplArea = document.getElementById("myTplArea"); els.myTplList = document.getElementById("myTplList"); els.myTplCount = document.getElementById("myTplCount"); els.canvasBody = document.getElementById("canvasBody"); els.pickModuleToggle = document.getElementById("pickModuleToggle"); els.pickModeText = document.getElementById("pickModeText"); els.panelTitle = document.getElementById("panelTitle"); els.panelSub = document.getElementById("panelSub"); els.panelBody = document.getElementById("panelBody"); els.stepBar = document.getElementById("stepBar"); els.workbench = document.getElementById("workbench"); els.exportScaleGroup = document.getElementById("exportScaleGroup"); els.exportSizeReadout = document.getElementById("exportSizeReadout"); els.tweakThemeBtn = document.getElementById("tweakThemeBtn"); els.stepToolbars = { setup: document.querySelector(".bb-toolbar-setup"), edit: document.querySelector(".bb-toolbar-edit"), export: document.querySelector(".bb-toolbar-export") }; state.activePageId = state.doc.pages[0].id; refreshFontSelects(); ensureFont(docFontFamily()); bindEvents(); renderAll(); renderMyTemplates(); bootstrapUserFonts(); global.bannerBuilder = { state: state, get doc() { return state.doc; }, toJSON: function () { return M.toJSON(state.doc); }, exportPng: exportPng, exportStripPng: exportStripPng, exportPsd: exportPsd, setZoom: function (z) { state.zoom = z; renderToolbar(); renderCanvas(); }, renderAll: renderAll }; }
  /* 启动时载入用户已导入的字体（IndexedDB），注入 Constants 并刷新三个字体下拉。 */
  function bootstrapUserFonts() {
    var importer = global.BannerBuilderFontImporter;
    if (!importer || !importer.isAvailable() || typeof importer.refresh !== "function") return;
    importer.refresh().then(function (rows) {
      if (!rows || !rows.length) return;
      importer.applyToConstants();
      refreshFontSelects();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);

/* ================================================================
   banner-builder-scene-model.js —— 格式无关的结构化场景数据模型
   目的：PSD 导出器与 PDF 导出器消费同一份「板块 → 图层元素」数据，
        不再各自维护一套图层生成逻辑（需求 brief 第 6 节）。
   schema: only-box-scene-model/1
     顶层 { schema, generatedAt, tool, page:{width,height,background},
            fonts:[{id,key,family,role,psName}], modules:[...] }
     module { id,type,label,serial,rect:{x,y,w,h},radius,background,elements:[...] }
     element 三类：
       { kind:"shape", name, x,y,w,h, radius, fill }          —— 纯色形状
       { kind:"image", name, x,y,w,h, fit, image }            —— image 为图片引用 {url,name,type}
       { kind:"text",  name, text, x,y(基线), size, weight, color, align, scope }
   坐标系：750 设计宽度、y 向下（与预览/PSD 相同）；PDF 侧导出时自行翻转。
   本文件保持纯数据、无 DOM/canvas 依赖，可被 node vm 单测加载（tests 同款）。
   依赖：banner-builder-constants.js 先行加载（C.*）。
   ================================================================ */
(function (global) {
  "use strict";

  const C = global.BannerBuilderConstants;

  const SCHEMA = "only-box-scene-model/1";

  /* ---------- 纯逻辑辅助（与 banner-builder.js 同源等价的重建） ---------- */

  /* hex(#rgb/#rrggbb) 或 rgb()/rgba() 字符串 → {r,g,b}(0-255)；无法解析返回 null。
     附带 alpha（cardBaseFill 可能给出 rgba 字符串），无 alpha 为 undefined。 */
  function parseColor(color) {
    const raw = String(color || "").trim();
    if (!raw) return null;
    let m = raw.match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
    m = raw.match(/^#([0-9a-f]{3})$/i);
    if (m) { const n = parseInt(m[1], 16); return { r: ((n >> 8) & 15) * 17, g: ((n >> 4) & 15) * 17, b: (n & 15) * 17 }; }
    m = raw.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)/i);
    if (m) {
      const out = { r: Math.max(0, Math.min(255, Math.round(Number(m[1])))), g: Math.max(0, Math.min(255, Math.round(Number(m[2])))), b: Math.max(0, Math.min(255, Math.round(Number(m[3])))) };
      if (m[4] != null) out.a = Math.max(0, Math.min(1, Number(m[4])));
      return out;
    }
    return null;
  }

  /* 主题色合并（artTheme 等价）：doc.theme + themeOverrides，未覆盖回退预设 */
  function themeOf(doc) {
    const base = C.themeStyleForDoc ? C.themeStyleForDoc(doc) : C.themeStyle(doc.theme);
    const ov = doc.themeOverrides || {};
    const merged = Object.assign({}, base);
    Object.keys(ov).forEach(function (k) {
      const v = ov[k];
      if (v !== null && v !== undefined && v !== "") merged[k] = v;
    });
    return merged;
  }
  function inkOf(st) {
    const v = st.ink;
    return (v && /^#[0-9a-f]{6}$/i.test(v)) ? v : "#20251f";
  }
  function mutedOf(st) {
    const v = st.muted;
    return (v && /^#[0-9a-f]{6}$/i.test(v)) ? v : "#6a706c";
  }
  /* 卡片圆角（cardRadius 等价） */
  function radiusOf(data, st) {
    const user = Number(data.radius);
    const base = (user === 13 || !Number.isFinite(user)) ? (st.radius != null ? st.radius : 27) : user;
    return Math.max(0, Math.round(base));
  }
  /* 卡片底色（cardBaseFill(st, data, 1) 等价：PSD/PDF 导出口径下 opacity=1）。
     blockBgColor → 原色（不透明）；各卡样式的白色底带固定透明度（旧 alphaColor 行为）；
     默认样式走 cardFillStyle 的 blockOpacity（默认 0.94）。 */
  function baseFillOf(st, data) {
    if (data.blockBgColor) return hexToRgba(data.blockBgColor, 1) || data.blockBgColor;
    switch (st.cardStyle) {
      case "glass": return "rgba(255,255,255,0.62)";
      case "ink": return alphaColor(st.soft, 0.97);
      case "panel": return "rgba(255,255,255,0.94)";
      case "ticket": return "rgba(255,255,255,0.97)";
      case "sticker": return "rgba(255,255,255,0.96)";
      default: {
        const op = Number.isFinite(Number(data.blockOpacity)) ? Number(data.blockOpacity) / 100 : 0.94;
        return hexToRgba("#ffffff", op) || "#ffffff";
      }
    }
  }
  function hexToRgba(value, alpha) {
    const raw = String(value || "").trim().replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(raw)) return "";
    const number = parseInt(raw, 16);
    return "rgba(" + ((number >> 16) & 255) + "," + ((number >> 8) & 255) + "," + (number & 255) + "," + Math.max(0, Math.min(1, alpha)) + ")";
  }
  /* alphaColor（banner-builder.js 同名等价）：非 hex 色先归一化为 hex 再加透明度，无法解析原样返回 */
  function alphaColor(value, alpha) {
    if (value == null || value === "") return "";
    let hex = value;
    if (!(typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value))) {
      const rgb = parseColor(value);
      hex = rgb ? rgbToHex(rgb) : "";
    }
    return hexToRgba(hex, alpha) || String(value);
  }
  function rgbToHex(rgb) {
    const p = function (n) { return String(Math.max(0, Math.min(255, Math.round(n))).toString(16)).padStart(2, "0"); };
    return "#" + p(rgb.r) + p(rgb.g) + p(rgb.b);
  }
  /* 逐层字号缩放（artSize 等价）：主题 typeScale × 逐层 scale */
  const TYPE_LEVEL_BANDS = [
    { key: "h1", min: 60 }, { key: "h2", min: 44 }, { key: "h3", min: 32 },
    { key: "body", min: 26 }, { key: "caption", min: 0 },
  ];
  function typeLevelKeyFor(size) {
    for (let i = 0; i < TYPE_LEVEL_BANDS.length; i += 1) { if (size >= TYPE_LEVEL_BANDS[i].min) return TYPE_LEVEL_BANDS[i].key; }
    return "caption";
  }
  function scaledSize(size, st) {
    const s = Number(size) || 0;
    if (s <= 0) return s;
    const perLevel = Number(st[typeLevelKeyFor(s) + "Scale"] != null ? st[typeLevelKeyFor(s) + "Scale"] : 1) || 1;
    const globalV = Number(st.typeScale);
    const global = Number.isFinite(globalV) && globalV > 0 ? globalV : 1;
    return Math.max(1, Math.round(s * global * (perLevel || 1)));
  }
  /* 字重整体偏置（artAdjustedWeight 等价）：标题 800 基准、正文 400 基准 */
  function weightBin(v) {
    const bins = [400, 500, 600, 700, 800, 900];
    const n = Number(v) || 400;
    if (n >= 900) return 900;
    let best = 400;
    for (let i = 0; i < bins.length; i += 1) { if (bins[i] <= n) best = bins[i]; else break; }
    return best;
  }
  function adjustedWeight(weight, scope, st) {
    const base = weightBin(weight || 400);
    const nominal = scope === "body" ? 400 : 800;
    const target = scope === "body"
      ? (Number(st.bodyWeight) != null ? Number(st.bodyWeight) : 400)
      : (Number(st.headingWeight) != null ? Number(st.headingWeight) : 800);
    const delta = weightBin(target || nominal) - nominal;
    return weightBin(base + delta);
  }
  /* 宽高比字符串 "16:9" → 数值 */
  function ratioValue(ratioStr, fallback) {
    const m = String(ratioStr || "").replace(/\s+/g, "").match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/);
    return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : fallback;
  }
  /* 板块图片大小统一读取（与 banner-builder.js imageSizeOf 同源等价的纯函数版）：
     data[key] 未设置 → 0（渲染端走模板默认），设置 → clamp 到 [min,max] 按 step 收敛 */
  function imageSizeOf(data, key, min, max, step) {
    const raw = data ? data[key] : null;
    if (raw == null || raw === "" || !Number.isFinite(Number(raw))) return 0;
    const st = Number(step) > 0 ? Number(step) : 1;
    let v = Math.round(Number(raw) / st) * st;
    v = Math.max(min, Math.min(max, v));
    return v;
  }

  /* ---------- 字体角色清单：scene 文本元素按 scope 关联字体 ---------- */
  function psFamilyName(f) {
    return String(f.family || "").replace(/ /g, "");
  }
  function fontsOf(doc) {
    const headingKey = doc.headingFont || doc.fontFamily || "sans";
    const bodyKey = doc.bodyFont || headingKey;
    const fonts = [];
    const hf = C.FONTS[headingKey];
    if (hf) fonts.push({ id: "heading", key: headingKey, family: hf.family, role: "heading", psName: psFamilyName(hf) });
    const bf = C.FONTS[bodyKey];
    if (bf && (!hf || bf.family !== hf.family)) fonts.push({ id: "body", key: bodyKey, family: bf.family, role: "body", psName: psFamilyName(bf) });
    return fonts;
  }

  /* ================================================================
     场景模型构建：输入 = 一页的 layout（measurePageLayout 产物，坐标与
     预览一致）+ 文档/页面/注册表，输出 = 纯数据 scene。
     与 legacyExportPsd 的 switch 同源移植（坐标常数不动，保持 PSD 粒度）。
     ================================================================ */
  function buildScene(options) {
    const page = options.page;
    const layout = options.layout;            /* measurePageLayout 产物 [{module,x,y,w,serial,head,h}] */
    const doc = options.doc;
    const pageHeight = options.pageHeight;    /* 实测内容高（含超屏加高），≥ 设计页高 */
    const size = options.pageSize || { pageWidth: 750, pageHeight: 1334 };
    const R = options.registry;               /* BannerBuilderRegistry */
    const fonts = options.fonts || fontsOf(doc);
    const st = options.theme || themeOf(doc);
    const inkColor = inkOf(st);
    const mutedColor = mutedOf(st);
    const px = function (n) { return Math.round(n); };

    const modules = [];
    for (let idx = 0; idx < layout.length; idx += 1) {
      const item = layout[idx];
      const module = item.module;
      const def = R.getDef(module.type);
      const data = module.data || {};
      const els = [];
      /* 物料图标大小与行距（iconSize 与 DOM 预览/PNG 导出同源，画布坐标系 px，默认 104）：
         在 else-if 图层分支与 switch 文字分支两处使用，故提升到模块循环体顶部。
         上限放宽到 400（接近板块容器宽），行距随图标等比放大防重叠。 */
      const mtIcon = Math.round(Math.min(600, Math.max(48, Number(data.iconSize) || 104)));
      const mtStep = Math.max(38, Math.round(mtIcon * 0.42) + 14);
      /* BB-R09：文本元素携带主题行高/字距，PDF/PSD 可编辑层与预览排版参数一致 */
      const themeLineHeight = typeof st.lineHeight === "number" && isFinite(st.lineHeight) ? st.lineHeight : 1;
      const themeLetterSpacing = typeof st.letterSpacing === "number" && isFinite(st.letterSpacing) ? st.letterSpacing : 0;
      const addT = function (name, value, x, y, sz, color, align, scope) {
        if (value == null || String(value).trim() === "") return;
        els.push({ kind: "text", name: name, text: String(value), x: px(x), y: px(y), size: scaledSize(sz, st), weight: adjustedWeight(scope === "body" ? 400 : 800, scope, st), color: parseColor(color) || parseColor(inkColor) || { r: 24, g: 34, b: 29 }, align: align === "center" ? "center" : align === "right" ? "right" : "left", scope: scope === "body" ? "body" : "heading", lineHeight: themeLineHeight, letterSpacing: themeLetterSpacing });
      };
      const addShape = function (name, x, y, w, h, r, color) {
        const fill = parseColor(color);
        if (!fill) return;
        els.push({ kind: "shape", name: name, x: px(x), y: px(y), w: px(w), h: px(h), radius: Math.max(0, Math.round(r || 0)), fill: fill });
      };
      const addImg = function (name, ref, x, y, w, h, fit) {
        if (!ref || !ref.url || !w || !h) return;
        els.push({ kind: "image", name: name, x: px(x), y: px(y), w: px(w), h: px(h), fit: fit === "contain" ? "contain" : "cover", image: { url: ref.url, name: ref.name || "", type: ref.type || "" } });
      };

      const cardLeft = px(item.x + 18);
      const headY = px(item.y + item.head);
      const cw = item.w;

      /* 1) 卡片背景（圆角矩形 + 纯色，可改颜色/圆角） */
      addShape(def.label + " 背景", item.x, item.y, item.w, item.h, radiusOf(data, st), baseFillOf(st, data));

      /* 2) 模块主图（可替换/移动）。
         BB-R09 第一阶段：遍历全部成员/节目/摊位/物料条目，每张图独立 scene element、
         独立坐标（纵向排布），不再只取第一位或共用坐标。 */
      const imgFit = data.imageFit === "contain" ? "contain" : "cover";
      /* BB-R09：板块底图（blockBgImage）作为独立图片图层，铺满卡片 */
      if (data.blockBgImage && data.blockBgImage.url) {
        addImg(def.label + " 板块底图", data.blockBgImage, item.x, item.y, item.w, item.h, "cover");
      }
      if (module.type === "cover") {
        const tpl = data.template || "immersive";
        if (tpl === "immersive") {
          if (data.mainImage && data.mainImage.url) addImg("主视觉图", data.mainImage, item.x, item.y, item.w, Math.round(item.w * 0.85), imgFit);
          else addShape(def.label + " 主视觉底", item.x, item.y, item.w, Math.round(item.w * 0.85), radiusOf(data, st), st.primaryDark);
        } else addImg("主视觉图", data.mainImage, item.x, px(headY + 24), item.w, Math.round(item.w * 0.6), imgFit);
      } else if (module.type === "freeImageBox") {
        addImg("图片", data.image, item.x, px(headY + 20), item.w, Math.round(item.w / ratioValue(data.ratio, 0.6)), imgFit);
      } else if (module.type === "venueInfo" && data.photo) {
        addImg("场地照片", data.photo, item.x, px(headY + 24), item.w, Math.round(item.w * 0.55), imgFit);
      } else if (module.type === "crossPromo" && data.icon) {
        const cpIcon = imageSizeOf(data, "iconSize", 60, 220, 4) || 120;
        addImg("联动方图标", data.icon, item.x, px(headY + 20), cpIcon, cpIcon, "contain");
      } else if (module.type === "ticketInfo" && data.qrImage) {
        const qrSide = imageSizeOf(data, "qrSize", 120, 320, 4) || 208;
        addImg("购票二维码", data.qrImage, px(item.x + item.w - qrSide - 20), px(headY + 20), qrSide, qrSide, "contain");
      } else if (module.type === "castList") {
        /* BB-R09：列表式阵容——每位成员头像独立图层（左列头像，与预览布局一致） */
        const castAvatarW = imageSizeOf(data, "avatarWidth", 80, 260, 4) || 120;
        const castStep = Math.max(castAvatarW + 30, 150);
        (data.cast || []).forEach(function (member, ci) {
          if (member && member.avatar && member.avatar.url) {
            addImg("成员头像 " + (ci + 1), member.avatar, px(item.x + 20), px(headY + 70 + ci * castStep), castAvatarW, castAvatarW, "cover");
          }
        });
      } else if (module.type === "castCards") {
        /* BB-R09：卡片式阵容——每位成员头像独立图层，两列卡片网格 */
        (data.cast || []).forEach(function (member, ci) {
          if (member && member.avatar && member.avatar.url) {
            const col = ci % 2;
            const row = Math.floor(ci / 2);
            const cardW = Math.round((item.w - 48) / 2);
            addImg("成员头像 " + (ci + 1), member.avatar, px(item.x + 20 + col * (cardW + 8)), px(headY + 70 + row * 190), cardW, Math.round(cardW / 0.75), "cover");
          }
        });
      } else if (module.type === "programList") {
        /* BB-R09：每张节目配图独立坐标（纵向排布），不再共用同一坐标 */
        const pgItems = data.items || [];
        let pgImgY = headY + 70;
        for (let pi = 0; pi < pgItems.length; pi++) {
          if (pgItems[pi].image && pgItems[pi].image.url) {
            addImg("节目配图 " + (pi + 1), pgItems[pi].image, item.x, px(pgImgY), cw, Math.round(cw * 0.4), imgFit);
            pgImgY += Math.round(cw * 0.4) + 24;
          }
        }
      } else if (module.type === "boothList") {
        /* BB-R09：每张摊位图独立坐标（纵向排布）；imageWidth 控制图层边长 */
        const boItems = data.items || [];
        const boSide = imageSizeOf(data, "imageWidth", 80, 260, 4) || 150;
        const boStep = boSide + 24;
        let boImgY = headY + 70;
        for (let bi = 0; bi < boItems.length; bi++) {
          if (boItems[bi].image && boItems[bi].image.url) {
            addImg("摊位图 " + (bi + 1), boItems[bi].image, px(item.x + 20), px(boImgY), boSide, boSide, imgFit);
            boImgY += boStep;
          }
        }
      } else if (module.type === "materials") {
        /* BB-R09：物料图标进入场景（每条物料一个独立小图层，与物料文字行对齐） */
        const mtItems = data.items || [];
        for (let mi2 = 0; mi2 < mtItems.length; mi2++) {
          if (mtItems[mi2].icon && mtItems[mi2].icon.url) {
            addImg("物料图标 " + (mi2 + 1), mtItems[mi2].icon, px(item.x + 20), px(headY + 70 + mi2 * mtStep), mtIcon, mtIcon, "contain");
          }
        }
      }

      /* 3) 序号 + 板块标题（可见、可编辑） */
      addT("序号", String(item.serial != null ? item.serial : idx + 1).padStart(2, "0"), px(item.x + 20), px(item.y + 26), 23, st.accent, "left");
      if (module.type !== "divider" || data.sectionTitle) addT("板块标题", moduleTitle(module, def), px(item.x + item.w / 2), headY, 54, st.primaryDark, "center");

      /* 4) 模块正文内容（与 legacyExportPsd switch 同源） */
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
          /* 文字行距与 BB-R09 图标行距同源（mtStep），避免大图标与文字重叠 */
          let my = headY + 70;
          (data.items || []).forEach(function (it, i) { addT("物料 " + (i + 1), it.label, cardLeft, my, 25, inkColor, "left", "body"); my += mtStep; });
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
        case "castList":
        case "castCards": {
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
        default:
          break;
      }

      modules.push({
        id: module.id || "module-" + (idx + 1),
        type: module.type,
        label: def.label,
        serial: item.serial != null ? item.serial : idx + 1,
        rect: { x: px(item.x), y: px(item.y), w: px(item.w), h: px(item.h) },
        radius: radiusOf(data, st),
        background: { fill: parseColor(baseFillOf(st, data)) || { r: 255, g: 255, b: 255 } },
        elements: els,
      });
    }

    /* BB-R09：页面背景图作为独立可编辑图层（最底层模块），不再只存在于合成位图中 */
    /* 底图与图案背景互斥：图案背景激活时不再输出底图模块（冲突消解规则） */
    const paramBgActiveForImage = (page.background && page.background.type === "parametric")
      || (doc.background && doc.background.type === "parametric");
    const pageBg = paramBgActiveForImage ? null : (page.backgroundImage || doc.backgroundImage);
    if (pageBg && pageBg.url) {
      modules.unshift({
        id: "page-background",
        type: "pageBackground",
        label: "页面背景图",
        serial: 0,
        rect: { x: 0, y: 0, w: size.pageWidth, h: pageHeight || size.pageHeight },
        radius: 0,
        background: { fill: parseColor(page.backgroundColor || doc.backgroundColor || "#ffffff") || { r: 255, g: 255, b: 255 } },
        elements: [{ kind: "image", name: "页面背景图", x: 0, y: 0, w: size.pageWidth, h: pageHeight || size.pageHeight, fit: "cover", image: { url: pageBg.url, name: pageBg.name || "", type: pageBg.type || "" } }],
      });
    }

    /* 图案背景（Task #18）：矢量元素组（circle/square）或栅格 image 引用。
       栅格 dataURL 由调用方经 options.backgroundRasterUrl 传入（DOM 侧生成）；
       未提供时仅输出矢量元素（circle/square 可完整表达）。 */
    const paramBg = (page.background && page.background.type === "parametric" && page.background.params)
      ? page.background
      : (doc.background && doc.background.type === "parametric" && doc.background.params ? doc.background : null);
    if (paramBg) {
      const engine = (typeof global !== "undefined") && global.BannerBuilderBackgrounds ? global.BannerBuilderBackgrounds : null;
      if (engine) {
        const H = pageHeight || size.pageHeight;
        const bgParams = Object.assign({}, paramBg.params, { width: size.pageWidth, height: H, fieldHeight: size.pageHeight });
        let vec = null;
        try { vec = engine.sceneElements(bgParams); } catch (e) { vec = null; }
        if (vec && vec.kind === "vector" && vec.elements && vec.elements.length) {
          modules.unshift({
            id: "page-background-pattern",
            type: "pageBackgroundPattern",
            label: "背景图案（矢量）",
            serial: 0,
            rect: { x: 0, y: 0, w: size.pageWidth, h: H },
            radius: 0,
            background: { fill: parseColor(engine.normalize(bgParams).bg) || { r: 255, g: 255, b: 255 } },
            elements: vec.elements,
          });
        } else if (options.backgroundRasterUrl) {
          modules.unshift({
            id: "page-background-pattern",
            type: "pageBackgroundPattern",
            label: "背景图案（栅格）",
            serial: 0,
            rect: { x: 0, y: 0, w: size.pageWidth, h: H },
            radius: 0,
            background: { fill: parseColor(engine.normalize(bgParams).bg) || { r: 255, g: 255, b: 255 } },
            elements: [{ kind: "image", name: "背景图案（栅格）", x: 0, y: 0, w: size.pageWidth, h: H, fit: "cover", image: { url: options.backgroundRasterUrl, name: "背景图案.png", type: "image/png" } }],
          });
        }
      }
    }

    return {
      schema: SCHEMA,
      generatedAt: new Date().toISOString(),
      tool: "Only-box banner-builder",
      page: {
        width: size.pageWidth,
        height: pageHeight || size.pageHeight,
        designHeight: size.pageHeight,
        background: {
          /* 图案背景激活时取图案底色（params.bg），否则回退页面/文档底色 */
          color: (function () {
            const paramBg = (page.background && page.background.type === "parametric" && page.background.params)
              ? page.background
              : (doc.background && doc.background.type === "parametric" && doc.background.params ? doc.background : null);
            if (paramBg && typeof global !== "undefined" && global.BannerBuilderBackgrounds) {
              try { const bgc = global.BannerBuilderBackgrounds.normalize(paramBg.params).bg; if (bgc) return bgc; } catch (e) { /* 回退 */ }
            }
            return page.backgroundColor || doc.backgroundColor || "#ffffff";
          })(),
          image: (function () {
            const paramBgActive = (page.background && page.background.type === "parametric")
              || (doc.background && doc.background.type === "parametric");
            return paramBgActive ? null : (page.backgroundImage || doc.backgroundImage || null);
          })(),
        },
      },
      fonts: fonts,
      theme: { key: doc.theme || "", radius: st.radius, cardStyle: st.cardStyle },
      modules: modules,
    };
  }

  function moduleTitle(module, def) { return module.data.sectionTitle || def.label; }

  /* 附件自包含版：把 blob: 图片引用全部转为 dataURL（复用「我的模板」同款 snapshotData） */
  function selfContained(scene, snapshotData) {
    const fix = function (out) {
      out.schema = SCHEMA;
      out.attachment = { kind: "only-box-scene", note: "生成此 PDF 的原始结构化场景数据（无损再导入用）" };
      return out;
    };
    if (typeof snapshotData !== "function") return Promise.resolve(fix(JSON.parse(JSON.stringify(scene))));
    return snapshotData(scene).then(fix);
  }

  global.BannerBuilderSceneModel = Object.freeze({
    SCHEMA: SCHEMA,
    buildScene: buildScene,
    fontsOf: fontsOf,
    parseColor: parseColor,
    scaledSize: scaledSize,
    adjustedWeight: adjustedWeight,
    selfContained: selfContained,
  });
})(typeof window !== "undefined" ? window : globalThis);

/* js/badge-font-picker.js —— badge-generator 统一字体选择器 + 在线字体加载（替代 badge-webfonts.js）
 *
 * 功能（对应内置字体清单功能）：
 * - 与 data/fonts.js（window.OnlyBoxFonts）统一清单联动：内置字体按 popularityRank 分层加载
 *   · 默认预览：rank 前 20 的字体，首次打开面板时注入 @font-face 并渲染真实字形
 *   · 其余字体：先以系统字体渲染名称，hover/搜索命中/选中时才懒加载对应字重
 * - 每款字体展示语言覆盖标签（中/繁/日/英）+ 分类（黑体/宋体/…），title 提示授权信息
 * - 自定义上传字体与内置清单同面板展示（底部「我上传的字体」分组），上传入口固定置底
 * - 字重支持：随所选字体重建字重档位（与 canvas 绘制、导出共用同一 weight 值）；
 *   可变字体上传后显示字重轴滑杆
 * - ensureFontsForBlock：按姓名实际字符 × 语言字体 × 字重预加载，保证预览/导出一致
 *
 * 依赖：data/fonts.js 先行加载；badge-generator.js 提供 init 参数（自定义字体表 + 重绘回调）。
 */

(function (global) {
  "use strict";

  var CATALOG = (global.OnlyBoxFonts && Array.isArray(global.OnlyBoxFonts.fonts)) ? global.OnlyBoxFonts.fonts : [];
  var byFamily = {};
  CATALOG.forEach(function (f) { if (f.family) byFamily[f.family] = f; });

  var LANG_TAG = { "zh-Hans": "中", "zh-Hant": "繁", "ja": "日", "en": "英" };
  var PRELOAD_RANK = 20;
  var config = {
    getCustomFonts: function () { return new Map(); },
    rerenderAll: function () { },
    statusEl: null
  };

  var injected = { css: {}, face: {} }; /* 去重：cssUrl / family:weight */
  var loadedFamilies = new Set(); /* 至少一个字重已就绪的 family，用于直接渲染真实字形预览 */
  var panels = []; /* 已创建的选择器实例 */
  var scopes = [];  /* 字重作用域（模板 / 编辑器） */
  var preloaded = false;
  var weightJobs = {}; /* family|weight -> Promise<boolean> */

  function statusEl() { return config.statusEl || document.getElementById("webfontStatus"); }
  function setStatus(text, keep) {
    var el = statusEl();
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    if (text && !keep) { clearTimeout(setStatus._t); setStatus._t = setTimeout(function () { el.hidden = true; }, 3000); }
  }

  /* ================= 字体加载（FontFace / @font-face，原生 API） ================= */
  function nearestWeight(font, weight) {
    if (!font || !Array.isArray(font.weights) || !font.weights.length) return weight || 400;
    var best = font.weights[0];
    font.weights.forEach(function (w) { if (Math.abs(w - weight) < Math.abs(best - weight)) best = w; });
    return best;
  }
  function injectCss(url) {
    if (injected.css[url]) return;
    injected.css[url] = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
  function injectFaces(family, faces) {
    var key = family + ":" + faces.map(function (s) { return s.weight; }).join(",");
    if (injected.face[key]) return;
    injected.face[key] = true;
    var css = faces.map(function (s) {
      return '@font-face{font-family:"' + family + '";font-style:normal;font-display:swap;font-weight:' + s.weight + ';src:url("' + s.url + '") format("' + (s.format || "truetype") + '");}';
    }).join("\n");
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
  function waitLoad(family, weight, text) {
    var spec = weight + ' 48px "' + family + '"';
    var job = document.fonts && document.fonts.load ? document.fonts.load(spec, text) : Promise.resolve([]);
    return job.then(function () {
      return !!(document.fonts && document.fonts.check && document.fonts.check(spec, text));
    }).catch(function () { return false; });
  }

  /* 确保某 family 的某字重可用；返回 Promise<boolean>（false = 加载失败，将回退系统字体渲染）。
     自定义上传字体优先于内置清单（家族名可能与内置字体同名，用户上传的文件应获胜）。 */
  function ensureFont(family, weight, text) {
    weight = weight || 400;
    var key = family + "|" + weight;
    if (weightJobs[key]) return weightJobs[key];
    var task = (async function () {
      var customInfo = config.getCustomFonts().get(family);
      var font = !customInfo ? byFamily[family] : null;
      try {
        if (customInfo) {
          /* 自定义上传字体：FontFace 已注册（静态=真实字重档，可变=全轴），直接按字重等待 */
          setStatus("正在加载自定义字体：" + family + " ……");
          var okCustom = await waitLoad(family, weight, text || "永Aあ");
          if (okCustom) loadedFamilies.add(family);
          setStatus(okCustom ? "自定义字体已就绪。" : "自定义字体未按该字重注册，将以近似字重渲染。");
          return okCustom;
        }
        if (!font) {
          setStatus("字体 " + family + " 不在清单中，将以系统字体渲染。", true);
          return false;
        }
        var load = font.load || {};
        if (load.css) {
          var urls = Array.isArray(load.css) ? load.css.slice() : [load.css[nearestWeight(font, weight)]];
          setStatus("正在加载在线字体：" + (font.name || family) + " ……");
          urls.forEach(injectCss);
        } else if (load.faces) {
          setStatus("正在加载在线字体：" + (font.name || family) + " ……");
          injectFaces(family, load.faces);
        }
        var ok = await waitLoad(family, weight, text || "永Aあ");
        if (!ok && load.css && !Array.isArray(load.css)) {
          /* 目标字重档缺失时用整包兜底再试一次 */
          Object.values(load.css).forEach(injectCss);
          ok = await waitLoad(family, nearestWeight(font, weight), text || "永Aあ");
        }
        if (ok) loadedFamilies.add(family);
        setStatus(ok ? "在线字体已就绪：" + (font.name || family) : "字体 " + (font.name || family) + " 加载失败（网络原因），将回退为默认字体渲染。", !ok);
        return ok;
      } catch (e) {
        setStatus("字体 " + family + " 加载失败，将回退为默认字体渲染。", true);
        return false;
      } finally {
        setTimeout(function () { delete weightJobs[key]; }, 1000);
      }
    })();
    weightJobs[key] = task;
    return task;
  }

  /* 按姓名文本 × 语言字体映射 × 字重预加载（canvas 不触发字体下载，必须先 load 再绘制） */
  function familyForChar(ch, block) {
    var families = (block && block.fontFamilies) || {};
    if (/^[\x00-\x7f]$/.test(ch)) return families.en || (block && block.cssFontFamily) || "Noto Sans";
    if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(ch)) return families.ja || (block && block.cssFontFamily) || "Noto Sans JP";
    return families.zh || (block && block.cssFontFamily) || "Noto Sans SC";
  }
  function ensureFontsForBlock(text, block) {
    var weight = (block && block.weight) || 700;
    var needed = {};
    String(text || "").split("").forEach(function (ch) { needed[familyForChar(ch, block)] = true; });
    var jobs = Object.keys(needed).map(function (family) { return ensureFont(family, weight, String(text || "永Aあ")); });
    return Promise.all(jobs).then(function () { return true; });
  }

  /* ================= 面板 UI ================= */
  function fontLabel(font) {
    return font.name || font.nameEn || font.family;
  }
  function previewText(font) {
    var langs = (font && font.languages) || [];
    var latinOnly = langs.length && langs.every(function (l) { return l === "en"; });
    return latinOnly ? "Ag 123" : "永Aあ Ag 123";
  }
  function langTags(font) {
    return (font.languages || []).map(function (l) { return LANG_TAG[l] || l; }).join("/");
  }

  function buildRows(list, customGroup) {
    var frag = document.createDocumentFragment();
    list.forEach(function (font) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "bfp-row" + (customGroup ? " bfp-row-custom" : "");
      row.dataset.family = font.family;
      row.title = font.license ? "授权：" + font.license + (font.licenseUrl ? "（点击选项使用）" : "") : "";
      var preview = document.createElement("span");
      preview.className = "bfp-preview";
      preview.textContent = previewText(font);
      /* 已加载过的字体直接以真实字形渲染（预载/历史加载均命中） */
      if (loadedFamilies.has(font.family)) preview.style.fontFamily = '"' + font.family + '"';
      var meta = document.createElement("span");
      meta.className = "bfp-meta";
      var nameLine = document.createElement("span");
      nameLine.className = "bfp-name";
      nameLine.textContent = fontLabel(font);
      if (font.nameEn && font.name && font.nameEn !== font.name) {
        var en = document.createElement("small");
        en.textContent = " " + font.nameEn;
        nameLine.appendChild(en);
      }
      var tagLine = document.createElement("span");
      tagLine.className = "bfp-tags";
      var tags = [];
      if (customGroup) tags.push("自定义");
      if (font.category) tags.push(font.category);
      var lt = langTags(font); if (lt) tags.push(lt);
      tagLine.textContent = tags.join(" · ");
      meta.appendChild(nameLine); meta.appendChild(tagLine);
      row.appendChild(preview); row.appendChild(meta);
      row.addEventListener("mouseenter", function () {
        ensureFont(font.family, 400, previewText(font)).then(function (ok) {
          if (ok) preview.style.fontFamily = '"' + font.family + '"';
        });
      });
      frag.appendChild(row);
    });
    return frag;
  }

  function customFontOptions() {
    var out = [];
    config.getCustomFonts().forEach(function (info, family) {
      out.push({
        family: family,
        name: (info && info.fileName) || family,
        nameEn: "",
        category: info && info.meta && info.meta.isVariable ? "可变字体" : "上传字体",
        languages: info && info.language ? [info.language] : [],
        license: "",
        weights: info && info.meta && info.meta.isVariable ? [info.meta.wghtMin || 100, info.meta.wghtMax || 900] : [info && info.meta && info.meta.weightClass || 400]
      });
    });
    return out;
  }

  function createPicker(host) {
    var select = document.getElementById(host.dataset.bfpFor);
    if (!select) return null;
    var lang = host.dataset.bfpLang || "";
    var inst = { host: host, select: select, lang: lang, open: false };
    populateSelectOptions(select);

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "bfp-trigger";
    trigger.innerHTML = '<span class="bfp-trigger-glyph">永</span><span class="bfp-trigger-text"></span><span class="bfp-caret">▾</span>';

    var panel = document.createElement("div");
    panel.className = "bfp-panel";
    panel.hidden = true;
    panel.innerHTML =
      '<div class="bfp-search"><input type="text" placeholder="搜索字体名 / 分类 / 语言…"></div>' +
      '<div class="bfp-list" role="listbox"></div>' +
      '<div class="bfp-foot"><button type="button" class="bfp-upload">＋ 上传自定义字体…</button></div>';

    host.appendChild(trigger);
    host.appendChild(panel);
    inst.trigger = trigger; inst.panel = panel;
    inst.glyph = trigger.querySelector(".bfp-trigger-glyph");
    inst.textEl = trigger.querySelector(".bfp-trigger-text");
    inst.search = panel.querySelector("input");
    inst.list = panel.querySelector(".bfp-list");

    function openPanel() {
      if (!preloaded) { preloaded = true; preloadTop(); }
      inst.open = true;
      panel.hidden = false;
      trigger.classList.add("is-open");
      renderList();
      inst.search.value = "";
      setTimeout(function () { inst.search.focus(); }, 0);
    }
    function closePanel() {
      inst.open = false;
      panel.hidden = true;
      trigger.classList.remove("is-open");
    }
    inst.close = closePanel;

    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      panels.forEach(function (other) { if (other !== inst && other.close) other.close(); });
      inst.open ? closePanel() : openPanel();
    });
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    inst.search.addEventListener("input", renderList);

    inst.list.addEventListener("click", async function (e) {
      var row = e.target.closest(".bfp-row");
      if (!row) return;
      var family = row.dataset.family;
      if (select.value !== family) {
        select.value = family;
        select.dispatchEvent(new Event("input", { bubbles: true }));
      }
      closePanel();
      syncTrigger(inst);
      var weight = currentWeightFor(inst);
      var ok = await ensureFont(family, weight, "永AあAg123");
      if (ok) config.rerenderAll();
    });
    inst.list.addEventListener("mouseover", function (e) {
      var row = e.target.closest(".bfp-row");
      if (row && row.dataset.family) preloadGlyph(row.querySelector(".bfp-preview"), row.dataset.family);
    });

    panel.querySelector(".bfp-upload").addEventListener("click", function () {
      closePanel();
      /* 触发页面顶部「上传字体文件」标签页（badge-wizard.js 负责切换） */
      var segBtns = document.querySelectorAll(".font-seg button");
      if (segBtns.length >= 2) segBtns[1].click();
      var firstInput = document.getElementById("fontInputZh");
      if (firstInput) firstInput.focus({ preventScroll: false });
    });

    function renderList() {
      var kw = inst.search.value.trim().toLowerCase();
      var langSet = { zh: "zh-Hans", en: "en", ja: "ja" }[lang];
      var match = function (f) {
        if (!kw) return true;
        return [f.name, f.nameEn, f.family, f.category].concat(f.languages || []).join(" ").toLowerCase().indexOf(kw) >= 0;
      };
      var inLang = function (f) { return !langSet || (f.languages || []).indexOf(langSet) >= 0; };
      inst.list.innerHTML = "";
      var customs = customFontOptions().filter(match);
      if (customs.length) {
        var cg = document.createElement("div"); cg.className = "bfp-group"; cg.textContent = "我上传的字体";
        inst.list.appendChild(cg);
        inst.list.appendChild(buildRows(customs, true));
      }
      var builtIn = CATALOG.filter(function (f) { return inLang(f) && match(f); })
        .sort(function (a, b) { return (a.popularityRank || 999) - (b.popularityRank || 999); });
      if (builtIn.length) {
        var g = document.createElement("div"); g.className = "bfp-group"; g.textContent = "内置开源字体（" + builtIn.length + "）";
        inst.list.appendChild(g);
        inst.list.appendChild(buildRows(builtIn, false));
      }
      if (!builtIn.length && !customs.length) {
        var empty = document.createElement("div"); empty.className = "bfp-empty"; empty.textContent = "没有匹配的字体";
        inst.list.appendChild(empty);
      }
      markSelected(inst);
    }
    inst.renderList = renderList;

    return inst;
  }

  function preloadGlyph(previewEl, family) {
    if (!previewEl || previewEl.dataset.loaded === family) return;
    ensureFont(family, 400, "永AあAg123").then(function (ok) {
      if (ok) { previewEl.style.fontFamily = '"' + family + '"'; previewEl.dataset.loaded = family; }
    });
  }
  function preloadTop() {
    var top = CATALOG.slice().sort(function (a, b) { return (a.popularityRank || 999) - (b.popularityRank || 999); }).slice(0, PRELOAD_RANK);
    var queue = top.slice();
    var worker = async function () {
      while (queue.length) {
        var f = queue.shift();
        await ensureFont(f.family, 400, "永AあAg123");
      }
    };
    Promise.all([worker(), worker(), worker()]).then(function () { panels.forEach(function (p) { p.renderList && p.renderList(); }); });
  }
  function markSelected(inst) {
    inst.list.querySelectorAll(".bfp-row").forEach(function (row) {
      row.classList.toggle("is-selected", row.dataset.family === inst.select.value);
    });
  }

  /* ================= 触发器 / 字重联动 ================= */
  /* 隐藏的宿主 select 用于与 badge-generator 的读写同步（value 保存 css family 名），
     需先填充候选（全部内置 family + 各语言默认兜底），否则 .value 赋值不生效。 */
  function populateSelectOptions(select) {
    if (select.options.length) return;
    var defaults = { fontFamilyZh: "Noto Sans SC", fontFamilyEn: "Noto Sans", fontFamilyJa: "Noto Sans JP", editorFontFamilyZh: "Noto Sans SC", editorFontFamilyEn: "Noto Sans", editorFontFamilyJa: "Noto Sans JP" };
    var fams = [];
    if (defaults[select.id]) fams.push(defaults[select.id]);
    CATALOG.forEach(function (f) { if (f.family && fams.indexOf(f.family) < 0) fams.push(f.family); });
    fams.forEach(function (fam) {
      var o = document.createElement("option");
      o.value = fam;
      o.textContent = fam;
      select.appendChild(o);
    });
    /* badge-generator 首次 updateTemplateInputs 跑在本模块加载前（当时无 option，
       value 赋值被丢弃），此处为空值 select 补回该语言的默认字体。 */
    if (!select.value && defaults[select.id]) select.value = defaults[select.id];
  }

  function syncTrigger(inst) {
    var family = inst.select.value;
    var custom = config.getCustomFonts().get(family);
    var font = !custom ? byFamily[family] : null;
    var label = custom ? (custom.fileName || family) : font ? fontLabel(font) : (family || "默认字体");
    inst.textEl.textContent = label;
    inst.trigger.title = font && font.license ? font.name + " · " + font.license : label;
    preloadGlyph(inst.glyph, family);
  }

  function currentWeightFor(inst) {
    var scope = scopes.find(function (s) { return s.selects.indexOf(inst.select) >= 0; });
    return scope ? Number(scope.weightSelect.value) || 700 : 700;
  }

  /* 字重作用域：一组语言选择器（中/英/日）+ 一个字重控件（+ 可选滑杆）。
     字重档位 = 三个所选字体实际字重的并集；中文所选为可变自定义字体时显示字重轴滑杆。 */
  function createScope(weightSelectId, sliderId, selectIds) {
    var weightSelect = document.getElementById(weightSelectId);
    if (!weightSelect) return null;
    var slider = sliderId ? document.getElementById(sliderId) : null;
    var scope = { weightSelect: weightSelect, slider: slider, selects: selectIds.map(function (id) { return document.getElementById(id); }).filter(Boolean), lastFamily: null };
    scopes.push(scope);

    weightSelect.addEventListener("input", async function () {
      if (slider) slider.value = weightSelect.value;
      var family = scope.selects[0] && scope.selects[0].value;
      if (family) {
        var ok = await ensureFont(family, Number(weightSelect.value) || 700, "永AあAg123");
        if (ok) config.rerenderAll();
      }
    });
    if (slider) {
      slider.addEventListener("input", function () {
        /* 滑杆值可能不在下拉档位（50 步进）内：动态补一个瞬时 option，保证数值精确写入 */
        var v = slider.value;
        var has = Array.prototype.some.call(weightSelect.options, function (o) { return o.value === v; });
        if (!has) {
          var o = document.createElement("option");
          o.value = v;
          o.textContent = weightName(Number(v));
          weightSelect.appendChild(o);
        }
        weightSelect.value = v;
        weightSelect.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    scope.sync = function () {
      /* 三槽任意一个换字体都要重建档位（并集可能变化） */
      var familyKey = scope.selects.map(function (sel) { return sel ? sel.value : ""; }).join("|");
      if (familyKey !== scope.lastFamily || !weightSelect.options.length) {
        scope.lastFamily = familyKey;
        var weights = unionWeights(scope.selects);
        var current = Number(weightSelect.value) || 700;
        weightSelect.innerHTML = "";
        weights.forEach(function (w) {
          var opt = document.createElement("option");
          opt.value = String(w);
          opt.textContent = weightName(w);
          weightSelect.appendChild(opt);
        });
        weightSelect.value = String(nearestIn(weights, current));
      }
      /* 任一语言所选为可变自定义字体 → 显示字重轴滑杆（档位下拉保留，二者同步） */
      var vfMeta = null;
      scope.selects.forEach(function (sel) {
        var meta = sel && sel.value ? customMeta(sel.value) : null;
        if (meta && meta.isVariable && !vfMeta) vfMeta = meta;
      });
      if (slider) {
        slider.hidden = !vfMeta;
        if (vfMeta) { slider.min = vfMeta.wghtMin || 100; slider.max = vfMeta.wghtMax || 900; slider.value = weightSelect.value; }
      }
    };
    scope.sync();
    return scope;
  }

  function customMeta(family) {
    var info = config.getCustomFonts().get(family);
    return info && info.meta ? info.meta : null;
  }
  function weightsOf(family) {
    var info = config.getCustomFonts().get(family);
    if (info && info.meta) {
      if (info.meta.isVariable) return range(info.meta.wghtMin || 100, info.meta.wghtMax || 900, 50);
      if (info.meta.weightClass) return [info.meta.weightClass];
    }
    var font = byFamily[family];
    if (font) return (font.weights || [400]).slice();
    return [400];
  }
  function range(min, max, step) { var out = []; for (var w = min; w <= max; w += step) out.push(w); return out; }
  function unionWeights(selects) {
    var set = new Set();
    selects.forEach(function (sel) { if (sel && sel.value) weightsOf(sel.value).forEach(function (w) { set.add(w); }); });
    if (!set.size) set.add(700);
    return Array.from(set).sort(function (a, b) { return a - b; });
  }
  function nearestIn(list, value) {
    var best = list[0];
    list.forEach(function (w) { if (Math.abs(w - value) < Math.abs(best - value)) best = w; });
    return best;
  }
  function weightName(w) {
    return ({ 100: "Thin 100", 200: "ExtraLight 200", 300: "Light 300", 400: "Regular 400", 500: "Medium 500", 600: "SemiBold 600", 700: "Bold 700", 800: "ExtraBold 800", 900: "Black 900" })[w] || ("字重 " + w);
  }

  /* ================= 对外 API ================= */
  function syncAll() {
    panels.forEach(syncTrigger);
    scopes.forEach(function (s) { s.sync && s.sync(); });
  }
  function refreshCustomFonts() {
    panels.forEach(function (p) { if (p.open) p.renderList(); });
    syncAll();
  }
  function init(params) {
    if (params) {
      if (typeof params.getCustomFonts === "function") config.getCustomFonts = params.getCustomFonts;
      if (typeof params.rerenderAll === "function") config.rerenderAll = params.rerenderAll;
    }
    document.querySelectorAll(".bfp-host[data-bfp-for]").forEach(function (host) {
      var inst = createPicker(host);
      if (inst) panels.push(inst);
    });
    createScope("nameWeight", "nameWeightSlider", ["fontFamilyZh", "fontFamilyEn", "fontFamilyJa"]);
    createScope("editorNameWeight", "editorNameWeightSlider", ["editorFontFamilyZh", "editorFontFamilyEn", "editorFontFamilyJa"]);
    document.addEventListener("click", function () { panels.forEach(function (p) { p.close && p.close(); }); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") panels.forEach(function (p) { p.close && p.close(); }); });
    syncAll();
  }

  global.BadgeFontPicker = {
    init: init,
    syncAll: syncAll,
    refreshCustomFonts: refreshCustomFonts,
    ensureFont: ensureFont,
    ensureFontsForBlock: ensureFontsForBlock,
    familyForChar: familyForChar,
    catalogSize: CATALOG.length,
    ready: false
  };
  /* badge-generator.js 先于本文件加载（HTML 引入顺序），其配置挂在 __badgeFontPickerConfig；
     本文件加载完成后自初始化，保证六处选择器与字重控件立即可用。 */
  if (global.__badgeFontPickerConfig) {
    init(global.__badgeFontPickerConfig);
    global.BadgeFontPicker.ready = true;
  }
})(window);

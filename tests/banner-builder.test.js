const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
/* document 桩：banner-builder.js 末尾按 readyState 决定是否 init，"loading" + 空 addEventListener 可让模块安全加载而不启动 UI */
const documentStub = { readyState: "loading", addEventListener: function () {}, removeEventListener: function () {} };
const ctx = vm.createContext({ window, console, document: documentStub });
["data/fonts.js", "js/banner-builder-themes.js", "js/banner-builder-constants.js", "js/banner-builder-registry.js", "js/banner-builder-model.js", "js/banner-builder-mytemplates.js", "js/banner-builder-module-importer.js", "js/banner-builder-ai-document.js"].forEach(function (file) {
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
});

const C = window.BannerBuilderConstants;
const R = window.BannerBuilderRegistry;
const M = window.BannerBuilderModel;
const T = window.BannerBuilderMyTemplates;
const MI = window.BannerBuilderModuleImporter;

/* ============ 常量 ============ */
/* 跨 vm 上下文对象原型不同，deepStrictEqual 会失败，须逐字段断言。 */assert.equal(C.pageSize("9:16").pageWidth, 750, "9:16 宽度");
assert.equal(C.pageSize("9:16").pageHeight, 1334, "9:16 高度");
assert.equal(C.pageSize("3:4").pageWidth, 750, "3:4 宽度");
assert.equal(C.pageSize("3:4").pageHeight, 1000, "3:4 高度");
assert.equal(C.pageSize("8:1").pageWidth, 750, "未知比例回退默认宽度");
assert.equal(C.pageSize("8:1").pageHeight, 1334, "未知比例回退默认高度");

assert.equal(C.fontSizePx("h1", 750), 65, "H1 在 750 宽下为 65px");
assert.equal(C.fontSizePx("body", 750), 29, "正文在 750 宽下为 29px");
assert.equal(C.fontSizePx("caption", 750), 23, "小字在 750 宽下为 23px");
assert.equal(C.fontSizePx("caption", 375), 12, "字号按画布宽度换算");

assert.equal(C.captionWarning("caption", 750), "", "23px 不提示");
assert.ok(C.captionWarning("caption", 400).includes("12px"), "换算后低于 18px 应提示");

assert.notEqual(C.uid(), C.uid(), "uid 每次不同");
assert.ok(C.uid().length >= 8, "uid 长度可用");

/* ============ 注册表完整性 ============ */

assert.equal(R.MODULE_ORDER.length, 16, "共 16 种模块（演出阵容拆分为列表/卡片两类）");

/* 演出阵容拆分：类型即版式，默认模板各自固定 */
{
  const listDef = R.getDef("castList");
  const cardsDef = R.getDef("castCards");
  assert.ok(listDef && cardsDef, "castList 与 castCards 并存");
  assert.equal(R.getDef("performerCard"), null, "旧类型 performerCard 已从注册表移除");
  assert.equal(listDef.createDefault().template, "cast-list", "阵容列表默认列表模板");
  assert.equal(cardsDef.createDefault().template, "cast-cards", "阵容卡片默认卡片模板");
  assert.equal(JSON.stringify(R.templateOptions("castList").map(function (o) { return o.value; })), JSON.stringify(["cast-list"]), "列表类型只有一个模板");
  assert.equal(JSON.stringify(R.templateOptions("castCards").map(function (o) { return o.value; })), JSON.stringify(["cast-cards"]), "卡片类型只有一个模板");
  assert.ok((listDef.fields || []).some(function (f) { return f.key === "cast"; }), "列表类型保留 cast 字段");
  assert.equal(R.getDef("castCards").label.indexOf("演出阵容卡片"), 0, "卡片类型名称区分");
}

R.MODULE_ORDER.forEach(function (type) {
  const def = R.getDef(type);
  assert.ok(def && typeof def.label === "string" && def.label.length, type + " 有中文 label");
  assert.equal(typeof def.createDefault, "function", type + " 有 createDefault");
  assert.ok(Array.isArray(def.fields) && def.fields.length, type + " 有属性字段定义");
  assert.equal(typeof def.summary, "function", type + " 有占位摘要");
  assert.equal(typeof def.thumbs, "function", type + " 有缩略图取值");

  const data = def.createDefault();
  assert.ok(data && typeof data === "object", type + " 默认数据是对象");
  /* 属性面板要能编辑 data 里的全部字段：每个字段 key 都必须在默认数据里存在 */
  def.fields.forEach(function (field) {
    assert.ok(Object.prototype.hasOwnProperty.call(data, field.key), type + " 字段 " + field.key + " 存在于默认数据");
    if (field.type === "objectList") {
      assert.ok(Array.isArray(field.fields) && field.fields.length, type + " 对象数组 " + field.key + " 有子字段");
    }
    if (field.type === "select") {
      const options = field.dynamicOptions === "templates" ? R.templateOptions(type) : field.options;
      assert.ok(options.some(function (o) { return o.value === data[field.key]; }), type + " 枚举默认值合法");
    }
  });
});

/* 每个模块都能生成模块实例，且两次生成互不影响 */
R.MODULE_ORDER.forEach(function (type) {
  const a = M.createModule(type);
  const b = M.createModule(type);
  assert.notEqual(a.id, b.id, type + " 两次生成的 id 不同");
  a.data.title = "x";
  assert.notEqual(b.data.title, "x", type + " 默认数据不共享引用");
});

/* 占位摘要随字段值变化（验收标准：改字段占位框跟着变） */
{
  const module = M.createModule("freeText");
  assert.ok(R.moduleSummary(module).length > 0, "即使为空也有层级摘要");
  module.data.text = "现场禁止闪光摄影";
  const rows = R.moduleSummary(module);
  assert.ok(rows.some(function (row) { return row.value === "现场禁止闪光摄影"; }), "摘要显示文本内容");
  module.data.text = "改后的文本";
  assert.ok(R.moduleSummary(module).some(function (row) { return row.value === "改后的文本"; }), "改字段后摘要同步");
}

{
  const module = M.createModule("castList");
  module.data.cast = [{ name: "某乐队", avatar: { url: "blob:a", name: "a.png" } }];
  assert.ok(R.moduleSummary(module).some(function (row) { return row.value === "某乐队"; }), "演出阵容摘要显示成员名");
  module.data.cast = [
    { avatar: { url: "blob:a", name: "a.png" } },
    { avatar: { url: "blob:b", name: "b.png" } },
    { avatar: { url: "blob:c", name: "c.png" } },
  ];
  assert.equal(R.moduleThumbs(module).length, 3, "阵容头像缩略图按成员收集");
}

/* ============ 文档模型：页面 ============ */

{
  const doc = M.createDoc();
  assert.equal(doc.ratio, "9:16", "默认比例");
  assert.equal(doc.screenMode, "split", "默认分屏模式");
  assert.equal(doc.pages.length, 1, "默认 1 页");
  assert.equal(doc.pages[0].modules.length, 0, "新页没有模块");
  assert.equal(doc.version, 3, "新建文档使用自包含主题草稿版本");
  assert.ok(Object.prototype.hasOwnProperty.call(doc, "themeDefinition"), "文档含主题定义快照字段");
  assert.equal(doc.themeDefinition, null, "新建文档主题定义快照默认为空");
  assert.ok(Object.prototype.hasOwnProperty.call(doc, "themeOverrides"), "文档含 themeOverrides 字段");
  assert.equal(typeof doc.themeOverrides, "object", "themeOverrides 是对象");
  assert.equal(Object.keys(doc.themeOverrides).length, 0, "themeOverrides 默认为空");

  const second = M.addPage(doc);
  assert.equal(doc.pages.length, 2, "新增页");
  assert.equal(doc.pages[1], second, "返回新增的页");
  assert.notEqual(doc.pages[0].id, second.id, "页面 id 唯一");

  doc.pages[1].modules.push(M.createModule("cover"));
  assert.equal(M.removePage(doc, "not-exist"), false, "删除不存在的页返回 false");
  assert.equal(M.removePage(doc, doc.pages[0].id), true, "删除空页成功");
  assert.equal(doc.pages.length, 1, "删到只剩一页");
  assert.equal(M.removePage(doc, doc.pages[0].id), true, "允许删除最后一页");
  assert.equal(doc.pages.length, 1, "删空后自动补一页空页");
  assert.equal(doc.pages[0].modules.length, 0, "补出来的是空页");
}

/* ============ 文档模型：模块 ============ */

{
  const doc = M.createDoc("3:4");
  const pageA = doc.pages[0];
  const pageB = M.addPage(doc);

  const cover = M.addModule(doc, pageA.id, "cover");
  const ticket = M.addModule(doc, pageA.id, "ticketInfo");
  const footer = M.addModule(doc, pageA.id, "footer");
  assert.equal(pageA.modules.length, 3, "模块加到指定页末尾");
  assert.equal(pageB.modules.length, 0, "模块不会串到别的页");
  assert.equal(pageA.modules[0].id, cover.id, "追加顺序正确");

  /* 无效 pageId 时追加到最后一页 */
  const stray = M.addModule(doc, "bad-id", "divider");
  assert.equal(pageB.modules[0].id, stray.id, "无效页 id 时加到最后一页");
  assert.equal(M.addModule(doc, pageA.id, "unknownType"), null, "未知类型返回 null");

  assert.equal(M.moveModule(doc, cover.id, -1), false, "第一个模块不能再上移");
  /* 顺序用 id 拼串比较，避免跨 vm 原型的 deepStrictEqual 问题 */
  const order = function () { return pageA.modules.map(m => m.id).join(","); };
  assert.equal(M.moveModule(doc, cover.id, 1), true, "第一个模块可下移");
  assert.equal(order(), [ticket.id, cover.id, footer.id].join(","), "下移后顺序正确");
  assert.equal(M.moveModule(doc, footer.id, 1), false, "最后一个模块不能再下移");
  assert.equal(M.moveModule(doc, footer.id, -1), true, "最后一个模块可上移");
  assert.equal(order(), [ticket.id, footer.id, cover.id].join(","), "上移后顺序正确");

  assert.equal(M.countModules(doc), 4, "统计全部模块数");

  const hit = M.findModule(doc, ticket.id);
  assert.equal(hit.page.id, pageA.id, "定位到所属页");
  assert.equal(hit.index, 0, "定位到页内序号");
  assert.equal(M.findModule(doc, "nope").module, null, "找不到模块返回 null");

  assert.equal(M.removeModule(doc, ticket.id), true, "删除模块");
  assert.equal(pageA.modules.length, 2, "删除后剩 2 个");
  assert.equal(M.removeModule(doc, ticket.id), false, "重复删除返回 false");
}

/* ============ 文档模型：跨屏移动 ============ */

{
  const doc = M.createDoc();
  const pageA = doc.pages[0];
  const pageB = M.addPage(doc);
  const a1 = M.addModule(doc, pageA.id, "cover");
  const a2 = M.addModule(doc, pageA.id, "announcement");
  const b1 = M.addModule(doc, pageB.id, "footer");

  /* 跨屏移动到目标屏末尾 */
  assert.equal(M.moveModuleAcross(doc, a1.id, pageB.id, null), true, "跨屏移动到目标屏末尾");
  assert.equal(pageA.modules.length, 1, "源屏移除后剩 1 个");
  assert.equal(pageB.modules.map(m => m.id).join(","), [b1.id, a1.id].join(","), "目标屏末尾追加");

  /* 跨屏插入到指定下标（插到 b1 之前） */
  assert.equal(M.moveModuleAcross(doc, a2.id, pageB.id, 0), true, "跨屏插入到下标 0");
  assert.equal(pageB.modules.map(m => m.id).join(","), [a2.id, b1.id, a1.id].join(","), "插入到目标屏指定位置");

  /* 同屏拖拽：a2（原下标 0）移动到下标 2（原 a1 之后），语义为「插到原列表位置」，回退一位后落到 a1 之后 */
  assert.equal(M.moveModuleAcross(doc, a2.id, pageB.id, 2), true, "同屏拖拽到下标 2");
  assert.equal(pageB.modules.map(m => m.id).join(","), [b1.id, a2.id, a1.id].join(","), "同屏拖拽位置回退后顺序正确");

  /* 找不到模块返回 false */
  assert.equal(M.moveModuleAcross(doc, "nope", pageB.id, 0), false, "未知模块移动失败");
  assert.equal(M.moveModuleAcross(doc, a1.id, "bad-page", 0), false, "未知目标屏移动失败");
}

/* ============ 导出 JSON ============ */

{
  const doc = M.createDoc();
  const module = M.addModule(doc, doc.pages[0].id, "schedule");
  module.data.groups.push({ groupName: "主舞台", rows: [{ name: "开场", time: "13:00" }] });
  const cover = M.addModule(doc, doc.pages[0].id, "cover");
  cover.data.title = "测试活动";
  cover.data.infoLines = ["10:00 开场", "16:00 闭场"];
  cover.data.mainImage = { url: "blob:fake", name: "main.png" };
  cover.data.notUsedField = undefined;

  const json = M.toJSON(doc);
  assert.equal(json.ratio, "9:16", "导出保留比例");
  assert.equal(json.pages.length, 1, "导出保留页");
  assert.equal(json.pages[0].modules.length, 2, "导出保留模块");
  assert.equal(json.pages[0].modules[1].data.title, "测试活动", "导出保留字段值");
  assert.equal(json.pages[0].modules[1].data.infoLines.length, 2, "导出保留数组");
  assert.equal(json.pages[0].modules[0].data.groups[0].rows[0].time, "13:00", "导出保留嵌套对象数组");

  const text = JSON.stringify(json);
  assert.equal(text.includes("undefined"), false, "JSON 里没有 undefined");
  assert.equal(JSON.stringify(JSON.parse(text)), text, "可完整反序列化");
}

/* 16 种模块全部塞进一页后也能正常序列化（验收标准：同类型可重复添加） */
{
  const doc = M.createDoc();
  R.MODULE_ORDER.forEach(function (type) {
    M.addModule(doc, doc.pages[0].id, type);
    M.addModule(doc, doc.pages[0].id, type);
  });
  assert.equal(doc.pages[0].modules.length, 32, "同类型可重复添加");
  const text = JSON.stringify(M.toJSON(doc));
  assert.equal(text.includes("undefined"), false, "全类型文档无 undefined");
}

/* ============ 我的模板纯函数 ============ */

assert.equal(typeof T.cloneTemplateData, "function", "mytemplates 导出克隆函数");
{
  const src = { text: "a", nested: { arr: [{ url: "http://x/y.png", name: "y.png" }] } };
  const clone = T.cloneTemplateData(src);
  assert.notEqual(clone, src, "克隆不是原引用");
  assert.notEqual(clone.nested, src.nested, "深层也克隆");
  assert.equal(clone.nested.arr[0].url, "http://x/y.png", "克隆保留非 blob 链接原样");
  clone.nested.arr[0].url = "changed";
  assert.equal(src.nested.arr[0].url, "http://x/y.png", "克隆互不影响");
}
assert.equal(T.isAvailable(), false, "Node/无 IndexedDB 环境判不可用（浏览器内为 true）");

/* ============ 可导入板块模块 ============ */
assert.equal(typeof MI.buildPrompt, "function", "板块导入器提供 AI 提示词");
assert.ok(MI.buildPrompt().includes("ticketInfo"), "提示词包含可用板块类型");
assert.deepEqual(MI.validate({ id: "Bad ID", label: "x", type: "ticketInfo", data: {} }).length > 0, true, "非法 id 被拒绝");
assert.equal(MI.validate({ id: "my-ticket", label: "我的票务", type: "ticketInfo", data: {} }).length, 0, "合法板块模块通过校验");
assert.equal(MI.extractJson("```json\n{\"id\":\"x\"}\n``` ").id, "x", "板块 JSON 可从代码块提取");

/* 提示词字段级完整性：字段由注册表自动生成，必须覆盖每一个板块类型的每一项特有字段
  （含 objectList 嵌套子字段），这样 AI 才不会靠猜字段名、或 registry 加字段后脱节。 */
{
  const PROMPT = MI.buildPrompt();
  const COMMON_KEYS = ["template", "sectionTitle", "width", "contentAlign", "bodyAlign",
    "blockBgColor", "blockBgImage", "blockOpacity", "imageRatio", "imageFit"];
  R.MODULE_ORDER.forEach(function (type) {
    const def = R.getDef(type);
    (def.fields || []).forEach(function (field) {
      if (COMMON_KEYS.indexOf(field.key) >= 0) return; /* 通用字段单独一段，逐板块不重复 */
      assert.ok(PROMPT.indexOf('"' + field.key + '"') >= 0, type + " 特有字段 " + field.key + " 应出现在提示词里");
      /* objectList 的子字段也要被提及 */
      if (field.type === "objectList") {
        (field.fields || []).forEach(function (sub) {
          assert.ok(PROMPT.indexOf('"' + sub.key + '"') >= 0, type + "." + field.key + " 子字段 " + sub.key + " 应出现在提示词里");
        });
      }
    });
    /* 每个板块的枚举模板取值也要列出 */
    R.templateOptions(type).forEach(function (t) {
      assert.ok(PROMPT.indexOf(t.value) >= 0, type + " 模板 " + t.value + " 应出现在提示词里");
    });
  });
}

/* 高频模块内置模板扩充：5 类至少 4 个模板且含新增样式 */
[["cover", "split"], ["announcement", "boxed"], ["freeText", "text-card"], ["footer", "footer-pills"], ["ticketInfo", "ticket-hero"]].forEach(function (pair) {
  const options = R.templateOptions(pair[0]);
  assert.ok(options.length >= 4, pair[0] + " 模板数应 ≥ 4，实际 " + options.length);
  assert.ok(options.some(function (o) { return o.value === pair[1]; }), pair[0] + " 应含新增模板 " + pair[1]);
});

/* 含正文的模块默认正文左对齐（用户要求：所有正文内容默认左对齐） */
["announcement", "ticketInfo", "materials", "crossPromo", "venueInfo", "castList", "castCards", "footer"].forEach(function (type) {
  assert.equal(R.getDef(type).createDefault().bodyAlign, "left", type + " 正文默认左对齐");
});
assert.equal(R.getDef("freeText").createDefault().align, "left", "自由文本默认左对齐");

/* 板块内容默认左对齐，封面保持居中（大标题成果、正文左对齐） */
assert.equal(R.getDef("announcement").createDefault().contentAlign, "left", "普通板块内容默认左对齐");
assert.equal(R.getDef("cover").createDefault().contentAlign, "center", "封面默认居中");

/* 角色标签值存机器可读键，显示名转中文 */
assert.equal(R.castRoleLabel("band"), "乐队", "角色 band 映射为乐队");
assert.equal(R.castRoleLabel("producer"), "制作人", "角色 producer 映射为制作人");
assert.equal(R.castRoleLabel(""), "", "空角色映射为空");

/* 头像装饰已收归主题（不再作为成员级字段，演出阵容类型默认无 avatarStyle） */
{
  const def = R.getDef("castList");
  const castField = def.fields.filter(function (f) { return f.key === "cast"; })[0];
  const avatarStyleField = (castField && castField.fields || []).filter(function (f) { return f.key === "avatarStyle"; })[0];
  assert.equal(avatarStyleField, undefined, "成员级 avatarStyle 字段已移除");
  const memberDefaults = [];
  // cast 子字段的默认值由 newEntry 产生，此处仅验证字段定义不含 avatarStyle
  assert.ok((castField.fields || []).some(function (f) { return f.key === "avatarRatio"; }), "成员仍可调头像比例");
}

console.log("banner-builder 测试全部通过");

/* ============ 统一字体清单派生（data/fonts.js → BannerBuilderConstants） ============ */
const catalog = window.OnlyBoxFonts;
assert.ok(Array.isArray(catalog.fonts) && catalog.fonts.length >= 30, "清单不少于 30 款字体");
assert.ok(catalog.fonts.length <= 50, "首批清单不超过 50 款");

assert.ok(C.FONTS.sans && C.FONTS.sans.family === "Noto Sans SC", "legacyKey sans 映射思源黑体");
assert.ok(C.FONTS.serif && C.FONTS.serif.family === "Noto Serif SC", "legacyKey serif 映射思源宋体");
assert.ok(C.FONTS.kai && C.FONTS.kai.family === "LXGW WenKai", "legacyKey kai 映射霞鹜文楷");
assert.ok(C.FONTS.logosc && C.FONTS.logosc.family === "Unbounded Sans", "旧 key logosc 映射到 OFL 版无界黑（本地字体已移除）");
assert.equal(C.FONTS.shuheiti, undefined, "阿里妈妈数黑体（禁止再分发）已移出内置清单");
assert.equal(C.FONTS.helveticalt, undefined, "Helvetica 商用字体已移出内置清单");
assert.equal(C.fontStack("shuheiti").indexOf("Noto Sans SC"), 1, "已移除 key 的旧草稿回落到思源黑体");

assert.ok(C.FONTS.sans.css.length >= 9, "思源黑体注入全字重 css（字重档位真实可渲染）");
assert.ok(C.FONTS.logosc.src && C.FONTS.logosc.src.length === 1, "无界黑为单文件 src 源");
assert.ok(C.fontFaceFor(C.FONTS.logosc).includes("font-weight:100 900"), "单文件展示字体按 100-900 登记（避免伪粗）");

const fontOpts = C.getFontOptions();
assert.ok(fontOpts.length >= catalog.fonts.length, "字体下拉选项覆盖全部清单条目（含多 legacyKey）");
assert.equal(fontOpts[0].value, "sans", "下拉第一项为思源黑体（rank 1）");
assert.ok(Object.keys(C.FONT_DOWNLOADS).length >= 20, "桌面字体下载表已从清单派生");
assert.ok(!C.FONT_DOWNLOADS.helveticalt, "Helvetica 不再提供打包下载");

console.log("字体清单派生测试全部通过");

/* ============ AI 生成整份长条（banner-builder-ai-document.js） ============ */
const AD = window.BannerBuilderAiDocument;
assert.ok(AD && typeof AD === "object", "AI 整份长条模块已加载");
assert.equal(typeof AD.buildPrompt, "function", "buildPrompt 导出");
assert.equal(typeof AD.extractJson, "function", "extractJson 导出");
assert.equal(typeof AD.validate, "function", "validate 导出");
assert.equal(typeof AD.normalize, "function", "normalize 导出");
assert.equal(typeof AD.buildCandidateDoc, "function", "buildCandidateDoc 导出");
assert.equal(typeof AD.applyPipeline, "function", "applyPipeline 导出");

/* ---- 测试数据工厂 ---- */
function validAiDoc() {
  return {
    schemaVersion: 1,
    name: "测试活动",
    pages: [
      { name: "第 1 屏", modules: [{ type: "cover", data: { title: "活动", infoLines: ["a", "b"] } }] },
      { name: "第 2 屏", modules: [{ type: "freeText", data: { text: "hi", level: "h2" } }] },
    ],
  };
}
function validThemeOverrides() {
  return {
    primary: "#1e7a4f", primaryDark: "#124f30", primarySoft: "#e4f2ea",
    accent: "#f2704b", accentSoft: "#fdeae2", line: "#cfe3d6", soft: "#edf4ee",
  };
}
function expectError(input, includeTheme, pathFragment, code, label) {
  const result = AD.validate(input, { includeTheme: includeTheme });
  assert.equal(result.valid, false, (label || "应拒绝") + "：" + JSON.stringify(input).slice(0, 160));
  assert.ok(
    result.errors.some(function (e) {
      return (pathFragment == null || e.path.indexOf(pathFragment) >= 0) && (!code || e.code === code);
    }),
    (label || "缺少预期错误") + " " + pathFragment + " " + (code || "") + " → " + JSON.stringify(result.errors)
  );
  return result;
}

/* ---- buildPrompt ---- */
{
  const promptNoTheme = AD.buildPrompt({ ratio: "9:16", screenMode: "split", themeId: "forest", themeLabel: "森林绿", fontFamily: "sans", headingFont: "", bodyFont: "", includeTheme: false });
  const promptTheme = AD.buildPrompt({ ratio: "3:4", screenMode: "continuous", themeId: "ocean", themeLabel: "海蓝", fontFamily: "serif", headingFont: "montserrat", bodyFont: "lato", includeTheme: true });
  const promptLive = AD.buildPrompt({ ratio: "9:16", screenMode: "split", themeId: "forest", themeLabel: "森林绿", fontFamily: "sans", headingFont: "", bodyFont: "", includeTheme: false, eventType: "live" });
  const promptBooth = AD.buildPrompt({ ratio: "9:16", screenMode: "split", themeId: "forest", themeLabel: "森林绿", fontFamily: "sans", headingFont: "", bodyFont: "", includeTheme: false, eventType: "booth" });
  const promptMixed = AD.buildPrompt({ ratio: "9:16", screenMode: "split", themeId: "forest", themeLabel: "森林绿", fontFamily: "sans", headingFont: "", bodyFont: "", includeTheme: false, eventType: "mixed" });
  const promptBadType = AD.buildPrompt({ ratio: "9:16", screenMode: "split", includeTheme: false, eventType: "unknown" });

  assert.ok(promptNoTheme.includes("9:16") && promptNoTheme.includes("750 × 1334"), "提示词包含画布比例与像素尺寸");
  assert.ok(promptNoTheme.includes("split"), "提示词包含屏幕模式 split");
  assert.ok(promptNoTheme.includes("森林绿") && promptNoTheme.includes("forest"), "提示词包含当前主题");
  assert.ok(promptTheme.includes("3:4") && promptTheme.includes("continuous"), "提示词包含比例与连续模式");
  assert.ok(promptNoTheme.includes("活动资料"), "提示词要求用户在外部 AI 对话中另附活动资料");
  assert.ok(promptNoTheme.includes("参考图"), "提示词提到可选附参考图片");
  assert.ok(promptNoTheme.includes("不要假设固定的屏数"), "提示词要求 AI 自行决定屏数");
  assert.ok(!promptNoTheme.includes("沿用") && !promptNoTheme.includes("当前屏数"), "提示词不包含强制沿用当前屏数的指令");
  assert.ok(promptNoTheme.includes("合并到同一个板块"), "提示词包含同类信息合并规则（多乐队不拆多板块）");
  assert.ok(promptNoTheme.includes("castList（列表式）") && promptNoTheme.includes("castCards（卡片式）"), "提示词指导演出阵容默认列表式");

  /* 活动类型分类提示词与无封面规则 */
  [promptNoTheme, promptTheme, promptLive, promptBooth, promptMixed].forEach(function (prompt, i) {
    assert.ok(prompt.includes("默认不生成 cover 封面板块"), "提示词 " + i + " 包含默认无封面规则");
    assert.ok(prompt.includes("合理撰写文案补全"), "提示词 " + i + " 包含资料不全时的补全规则");
  });
  assert.ok(promptLive.includes("Live 演出活动") && promptLive.includes("按角色分组各一个板块") && promptLive.includes("入场物料"), "Live 类型包含演出活动组织范例");
  assert.ok(promptBooth.includes("摊位活动") && promptBooth.includes("boothList 摊位信息") && promptBooth.includes("参展/观展规则"), "摊位类型包含摊位活动组织范例");
  assert.ok(promptMixed.includes("综合活动") && promptMixed.includes("多种活动形式"), "综合类型包含混合组织范例");
  assert.ok(promptBadType.includes("综合活动"), "未知活动类型回退综合");
  assert.ok(!promptLive.includes("Live 演出活动 · 页面组织范例】\n  综合演出") && promptLive.indexOf("按角色分组各一个板块") > 0, "Live 范例独立于综合范例");
  assert.equal(promptLive.indexOf("摊位信息：按分区"), -1, "Live 范例不包含摊位组织细节");
  assert.equal(promptNoTheme.includes("themeOverrides"), false, "未勾选主题时提示词完全不含 themeOverrides");
  assert.ok(promptTheme.includes("themeOverrides"), "勾选主题时提示词要求 themeOverrides");
  ["primary", "accentSoft", "cardStyle", "shadow", "divider", "chips", "titleDecor", "pattern", "avatarStyle", "radius", "typeScale", "h1Scale", "captionScale", "headingWeight", "lineHeight", "letterSpacing"].forEach(function (key) {
    assert.ok(promptTheme.includes(key), "主题字段说明包含 " + key);
  });
  assert.ok(promptTheme.includes("参考图") && promptTheme.includes("图片本身"), "主题提示词说明可分析参考图但不生成图片");
  R.MODULE_ORDER.forEach(function (type) {
    assert.ok(promptNoTheme.includes(type), "提示词包含模块类型 " + type);
    R.templateOptions(type).forEach(function (t) {
      assert.ok(promptNoTheme.includes(t.value), "提示词包含 " + type + " 模板枚举 " + t.value);
    });
  });
  ["groups", "rows", "groupName", "cast", "setlist", "song", "coverBy"].forEach(function (key) {
    assert.ok(promptNoTheme.includes('"' + key + '"'), "提示词递归包含嵌套字段 " + key);
  });

  /* 示例 JSON 可解析、无 // 注释，且本身通过校验 */
  assert.ok(!promptNoTheme.includes("//"), "未勾选提示词不含 // 注释");
  assert.ok(!promptTheme.includes("//"), "勾选主题提示词不含 // 注释");
  function extractExample(prompt) {
    const start = prompt.indexOf("【JSON 结构示例】");
    const end = prompt.indexOf("【示例结束】");
    assert.ok(start >= 0 && end > start, "示例有明确边界标记");
    const s = prompt.indexOf("{", start);
    const e = prompt.lastIndexOf("}", end);
    return JSON.parse(prompt.slice(s, e + 1));
  }
  const exNo = extractExample(promptNoTheme);
  assert.equal(exNo.schemaVersion, 1, "未勾选示例 schemaVersion=1");
  assert.equal("themeOverrides" in exNo, false, "未勾选示例不含 themeOverrides");
  assert.equal(AD.validate(exNo, { includeTheme: false }).valid, true, "未勾选示例本身通过校验");
  {
    const exTypes = [];
    exNo.pages.forEach(function (p) { (p.modules || []).forEach(function (m) { exTypes.push(m.type); }); });
    assert.equal(exTypes.indexOf("cover"), -1, "示例默认无封面板块");
    assert.equal(exTypes[0], "announcement", "示例第一屏以活动介绍开场");
    assert.ok(exTypes.indexOf("castList") >= 0, "示例使用阵容列表板块（类型即版式）");
    assert.ok(exTypes.indexOf("venueInfo") >= 0 && exTypes.indexOf("ticketInfo") >= 0 && exTypes.indexOf("footer") >= 0, "示例覆盖 live 长条核心板块");
  }
  const exTheme = extractExample(promptTheme);
  assert.ok(exTheme.themeOverrides && typeof exTheme.themeOverrides.primary === "string", "勾选示例包含 themeOverrides");
  assert.equal(AD.validate(exTheme, { includeTheme: true }).valid, true, "勾选示例本身通过校验");
}

/* ---- extractJson ---- */
assert.equal(AD.extractJson('{"a":1}').ok, true, "纯 JSON 可解析");
assert.equal(AD.extractJson('```json\n{"a":1}\n```').ok, true, "json 围栏可解析");
assert.equal(AD.extractJson('```JSON\n{"a":1}\n```').ok, true, "大写 JSON 围栏可解析");
assert.equal(AD.extractJson('```\n{"a":1}\n```').ok, true, "普通围栏可解析");
assert.equal(AD.extractJson('好的，这是结果：{"a":1}').ok, false, "解释文字包裹被拒绝（不截取花括号）");
assert.equal(AD.extractJson("").ok, false, "空文本被拒绝");
assert.equal(AD.extractJson("   \n  ").ok, false, "纯空白被拒绝");
assert.equal(AD.extractJson("{a:1}").ok, false, "JSON5 无引号键被拒绝");
assert.equal(AD.extractJson('{"a":1,}').ok, false, "尾逗号被拒绝");
assert.equal(AD.extractJson('{"a":1 /* 注释 */}').ok, false, "注释被拒绝");
assert.equal(AD.extractJson("[".repeat(3)).ok, false, "残缺文本被拒绝");
assert.equal(AD.extractJson("[1,2]").ok, true, "JSON 数组可解析（由 validate 拒绝）");

/* ---- validate：合法输入 ---- */
assert.equal(AD.validate(validAiDoc(), { includeTheme: false }).valid, true, "不带主题合法文档通过");
const themedValid = Object.assign(validAiDoc(), { themeOverrides: validThemeOverrides() });
assert.equal(AD.validate(themedValid, { includeTheme: true }).valid, true, "带主题合法文档通过");
assert.equal(
  AD.validate(Object.assign(validThemeOverrides(), {}), { includeTheme: true }).valid, false, "非文档对象被拒绝"
);

/* AI 自行决定 1-20 屏，与当前文档屏数无关 */
{
  const seven = validAiDoc();
  seven.pages = Array.from({ length: 7 }, function (_, i) {
    return { name: "第 " + (i + 1) + " 屏", modules: [{ type: "divider", data: {} }] };
  });
  assert.equal(AD.validate(seven, { includeTheme: false }).valid, true, "7 屏合法（不比较当前屏数）");
  const twenty = validAiDoc();
  twenty.pages = Array.from({ length: 20 }, function (_, i) {
    return { name: "第 " + (i + 1) + " 屏", modules: [{ type: "divider", data: {} }] };
  });
  assert.equal(AD.validate(twenty, { includeTheme: false }).valid, true, "20 屏合法");
  const twentyOne = twenty;
  twentyOne.pages.push({ name: "第 21 屏", modules: [] });
  expectError(twentyOne, false, "pages", "pages_range", "21 屏被拒绝");
}

/* 顶层结构 */
{
  const badVersion = validAiDoc();
  badVersion.schemaVersion = 2;
  expectError(badVersion, false, "schemaVersion", "schema_version", "schemaVersion 错误");
}
{
  const strVersion = validAiDoc();
  strVersion.schemaVersion = "1";
  expectError(strVersion, false, "schemaVersion", "schema_version", "字符串 schemaVersion 被拒绝");
}
{
  const noName = validAiDoc();
  delete noName.name;
  expectError(noName, false, "name", "name_length", "缺 name");
  const longName = validAiDoc();
  longName.name = "字".repeat(81);
  expectError(longName, false, "name", "name_length", "name 超长");
  const blankName = validAiDoc();
  blankName.name = "   ";
  expectError(blankName, false, "name", "name_length", "空白 name");
}
expectError([1, 2], false, "", "root_type", "顶层数组被拒绝");
expectError("text", false, "", "root_type", "顶层字符串被拒绝");
{
  const extra = validAiDoc();
  extra.pages = [];
  extra.customField = 1;
  expectError(extra, false, "customField", "unknown_field", "未知顶层字段");
  expectError(extra, false, "pages", null, "空 pages 数组");
}

/* 条件主题 */
{
  const withTheme = validAiDoc();
  withTheme.themeOverrides = validThemeOverrides();
  expectError(withTheme, false, "themeOverrides", "theme_not_allowed", "未勾选时出现主题字段");
  expectError(validAiDoc(), true, "themeOverrides", "theme_required", "勾选但缺 themeOverrides");
  const incomplete = validAiDoc();
  incomplete.themeOverrides = { primary: "#111111", primaryDark: "#222222", primarySoft: "#333333" };
  expectError(incomplete, true, "themeOverrides", "theme_color_required", "缺少基础颜色字段");
  const badHex = validAiDoc();
  badHex.themeOverrides = validThemeOverrides();
  badHex.themeOverrides.accent = "red";
  expectError(badHex, true, "themeOverrides.accent", null, "非法颜色格式");
  const badEnum = validAiDoc();
  badEnum.themeOverrides = validThemeOverrides();
  badEnum.themeOverrides.cardStyle = "round";
  expectError(badEnum, true, "themeOverrides.cardStyle", "invalid_option", "非法卡片骨架");
  const badWeight = validAiDoc();
  badWeight.themeOverrides = validThemeOverrides();
  badWeight.themeOverrides.headingWeight = 750;
  expectError(badWeight, true, "themeOverrides.headingWeight", "invalid_option", "非法字重");
  const badRange = validAiDoc();
  badRange.themeOverrides = validThemeOverrides();
  badRange.themeOverrides.radius = 101;
  expectError(badRange, true, "themeOverrides.radius", "number_range", "radius 超范围");
  const badStep = validAiDoc();
  badStep.themeOverrides = validThemeOverrides();
  badStep.themeOverrides.typeScale = 1.02;
  expectError(badStep, true, "themeOverrides.typeScale", "number_step", "typeScale 步进错误");
  const badStep2 = validAiDoc();
  badStep2.themeOverrides = validThemeOverrides();
  badStep2.themeOverrides.lineHeight = 1.234;
  expectError(badStep2, true, "themeOverrides.lineHeight", "number_step", "lineHeight 步进错误");
  const fontField = validAiDoc();
  fontField.themeOverrides = validThemeOverrides();
  fontField.themeOverrides.headingFont = "sans";
  expectError(fontField, true, "themeOverrides.headingFont", "unknown_field", "themeOverrides 禁止字体字段");
  const goodThemeStep = validAiDoc();
  goodThemeStep.themeOverrides = Object.assign(validThemeOverrides(), { typeScale: 1.2, letterSpacing: -1.5, lineHeight: 0.85, radius: 0 });
  assert.equal(AD.validate(goodThemeStep, { includeTheme: true }).valid, true, "边界步进值通过（浮点容差）");
}

/* 页面与模块结构 */
{
  const badPage = validAiDoc();
  badPage.pages[0].id = "page-x";
  expectError(badPage, false, "pages[0].id", "unknown_field", "页面禁止 id");
  const badPage2 = validAiDoc();
  badPage2.pages[0].ratio = "9:16";
  expectError(badPage2, false, "pages[0].ratio", "unknown_field", "页面禁止 ratio");
  const badPageName = validAiDoc();
  badPageName.pages[0].name = "";
  expectError(badPageName, false, "pages[0].name", "page_name_length", "页面 name 为空");
  const longPageName = validAiDoc();
  longPageName.pages[0].name = "屏".repeat(41);
  expectError(longPageName, false, "pages[0].name", "page_name_length", "页面 name 超长");
  const noModules = validAiDoc();
  noModules.pages[0].modules = "x";
  expectError(noModules, false, "pages[0].modules", "expected_array", "modules 非数组");
  const manyModules = validAiDoc();
  manyModules.pages[0].modules = Array.from({ length: 31 }, function () { return { type: "divider", data: {} }; });
  expectError(manyModules, false, "pages[0].modules", "modules_per_page", "单屏 31 个板块");
  const okThirty = validAiDoc();
  okThirty.pages = [{ name: "p", modules: Array.from({ length: 30 }, function () { return { type: "divider", data: {} }; }) }];
  assert.equal(AD.validate(okThirty, { includeTheme: false }).valid, true, "单屏 30 个板块合法");
  const totalOver = validAiDoc();
  totalOver.pages = Array.from({ length: 20 }, function () {
    return { name: "p", modules: Array.from({ length: 7 }, function () { return { type: "divider", data: {} }; }) };
  });
  expectError(totalOver, false, "pages", "modules_total", "总板块 140 超上限");
  const totalExact = validAiDoc();
  totalExact.pages = Array.from({ length: 20 }, function () {
    return { name: "p", modules: Array.from({ length: 6 }, function () { return { type: "divider", data: {} }; }) };
  });
  assert.equal(AD.validate(totalExact, { includeTheme: false }).valid, true, "总板块 120 恰好合法");
}

/* 模块级 */
{
  const modExtra = validAiDoc();
  modExtra.pages[0].modules[0].id = "mod-x";
  expectError(modExtra, false, "modules[0].id", "unknown_field", "模块禁止 id");
  const modVisible = validAiDoc();
  modVisible.pages[0].modules[0].visible = true;
  expectError(modVisible, false, "modules[0].visible", "unknown_field", "模块禁止 visible");
  expectError({ schemaVersion: 1, name: "x", pages: [{ name: "p", modules: [{ type: "ticket", data: {} }] }] }, false, "modules[0].type", "unknown_module_type", "未知模块类型");
  expectError({ schemaVersion: 1, name: "x", pages: [{ name: "p", modules: [{ type: "cover", data: [] }] }] }, false, "modules[0].data", "data_type", "data 为数组");
  const unknownData = validAiDoc();
  unknownData.pages[0].modules[0].data.evilField = "x";
  expectError(unknownData, false, "data.evilField", "unknown_field", "data 未知字段");
}

/* 字段类型递归校验 */
{
  const badImage = validAiDoc();
  badImage.pages[0].modules[0].data.mainImage = { url: "https://example.com/a.png" };
  expectError(badImage, false, "mainImage", "image_not_null", "图片字段拒绝对象");
  const blobImage = validAiDoc();
  blobImage.pages[0].modules[0].data.mainImage = "blob:x";
  expectError(blobImage, false, "mainImage", "image_not_null", "图片字段拒绝字符串");
  const emptyImage = validAiDoc();
  emptyImage.pages[0].modules[0].data.mainImage = "";
  expectError(emptyImage, false, "mainImage", "image_not_null", "图片字段拒绝空串");
  const bgImage = validAiDoc();
  bgImage.pages[0].modules[0].data.blockBgImage = 0;
  expectError(bgImage, false, "blockBgImage", "image_not_null", "图片字段拒绝数字");
  const okNullImage = validAiDoc();
  okNullImage.pages[0].modules[0].data.mainImage = null;
  okNullImage.pages[0].modules[0].data.blockBgImage = null;
  assert.equal(AD.validate(okNullImage, { includeTheme: false }).valid, true, "图片字段 null 合法");

  const badText = validAiDoc();
  badText.pages[0].modules[0].data.title = 123;
  expectError(badText, false, "data.title", "expected_string", "文本字段拒绝数字");
  const longText = validAiDoc();
  longText.pages[0].modules[0].data.title = "字".repeat(501);
  expectError(longText, false, "data.title", "text_too_long", "文本超 500 字");
  const longBody = validAiDoc();
  longBody.pages[1].modules[0].data.text = "字".repeat(5001);
  expectError(longBody, false, "data.text", "text_too_long", "多行正文超 5000 字");

  const badNumber = validAiDoc();
  badNumber.pages[0].modules[0].data.blockOpacity = "90";
  expectError(badNumber, false, "blockOpacity", "expected_number", "数字字段拒绝字符串");
  const rangeNumber = validAiDoc();
  rangeNumber.pages[0].modules[0].data.blockOpacity = -1;
  expectError(rangeNumber, false, "blockOpacity", "number_range", "blockOpacity 超范围");
  const stepNumber = validAiDoc();
  stepNumber.pages[0].modules[0].data.blockOpacity = 94.5;
  expectError(stepNumber, false, "blockOpacity", "number_step", "blockOpacity 步进 1");
  const okOpacity = validAiDoc();
  okOpacity.pages[0].modules[0].data.blockOpacity = 0;
  assert.equal(AD.validate(okOpacity, { includeTheme: false }).valid, true, "blockOpacity 0 合法");

  const badSelect = validAiDoc();
  badSelect.pages[1].modules[0].data.level = "h9";
  expectError(badSelect, false, "data.level", "invalid_option", "非法层级枚举");
  const badTemplate = validAiDoc();
  badTemplate.pages[0].modules[0].data.template = "nope";
  expectError(badTemplate, false, "data.template", "invalid_option", "非法模板（动态模板枚举）");
  const okTemplate = validAiDoc();
  okTemplate.pages[0].modules[0].data.template = "split";
  assert.equal(AD.validate(okTemplate, { includeTheme: false }).valid, true, "合法模板通过");
  const okEmptyBodyAlign = validAiDoc();
  okEmptyBodyAlign.pages[1].modules[0] = { type: "announcement", data: { bodyAlign: "", heading: "x", body: "y" } };
  assert.equal(AD.validate(okEmptyBodyAlign, { includeTheme: false }).valid, true, "bodyAlign 空字符串合法");
  const badBodyAlignScope = validAiDoc();
  badBodyAlignScope.pages[0].modules[0] = { type: "schedule", data: { bodyAlign: "left" } };
  expectError(badBodyAlignScope, false, "data.bodyAlign", "unknown_field", "schedule 无 bodyAlign 字段");

  const badStringList = validAiDoc();
  badStringList.pages[0].modules[0].data.infoLines = "x";
  expectError(badStringList, false, "infoLines", "expected_array", "stringList 非数组");
  const badStringItem = validAiDoc();
  badStringItem.pages[0].modules[0].data.infoLines = [1];
  expectError(badStringItem, false, "infoLines[0]", "expected_string", "stringList 项非字符串");

  const badObjectList = validAiDoc();
  badObjectList.pages[0].modules[0] = { type: "ticketInfo", data: { tiers: {} } };
  expectError(badObjectList, false, "tiers", "expected_array", "objectList 非数组");
  const badTier = validAiDoc();
  badTier.pages[0].modules[0] = { type: "ticketInfo", data: { tiers: [{ label: 5 }] } };
  expectError(badTier, false, "tiers[0].label", "expected_string", "objectList 子字段类型错误");
  const extraTier = validAiDoc();
  extraTier.pages[0].modules[0] = { type: "ticketInfo", data: { tiers: [{ evil: 1 }] } };
  expectError(extraTier, false, "tiers[0].evil", "unknown_field", "objectList 子字段未知键");

  /* 深层嵌套：schedule.groups[].rows[] 与 castList.cast[].setlist[] */
  const deepBad = validAiDoc();
  deepBad.pages[0].modules[0] = { type: "schedule", data: { groups: [{ groupName: "g", rows: [{ name: 5, time: "13:00" }] }] } };
  const deepResult = AD.validate(deepBad, { includeTheme: false });
  assert.equal(deepResult.valid, false, "深层嵌套类型错误被拒绝");
  assert.ok(deepResult.errors.some(function (e) { return e.path.indexOf("groups[0].rows[0].name") >= 0; }), "深层错误路径准确: " + JSON.stringify(deepResult.errors));
  const setlistBad = validAiDoc();
  setlistBad.pages[0].modules[0] = { type: "castList", data: { cast: [{ name: "乐队", setlist: [{ song: 3 }] }] } };
  const setlistResult = AD.validate(setlistBad, { includeTheme: false });
  assert.equal(setlistResult.valid, false, "setlist 类型错误被拒绝");
  assert.ok(setlistResult.errors.some(function (e) { return e.path.indexOf("cast[0].setlist[0].song") >= 0; }), "setlist 错误路径准确");
  const deepOk = validAiDoc();
  deepOk.pages[0].modules[0] = { type: "castList", data: { cast: [{ role: "DJ", name: "DJ 某", avatar: null, avatarRatio: "3:4", setlist: [{ song: "曲一", coverBy: "原唱" }] }] } };
  assert.equal(AD.validate(deepOk, { includeTheme: false }).valid, true, "深层嵌套合法数据通过");
  /* 拆分后的旧类型与非法模板 */
  expectError({ schemaVersion: 1, name: "x", pages: [{ name: "p", modules: [{ type: "performerCard", data: {} }] }] }, false, "modules[0].type", "unknown_module_type", "旧类型 performerCard 不再被 AI 协议接受");
  const badCardsTemplate = validAiDoc();
  badCardsTemplate.pages[0].modules[0] = { type: "castList", data: { template: "cast-cards" } };
  expectError(badCardsTemplate, false, "data.template", "invalid_option", "castList 不接受卡片模板");
}

/* ---- normalize ---- */
{
  const n1 = AD.normalize(validAiDoc(), { includeTheme: false });
  assert.ok(n1.ok, "normalize 成功: " + JSON.stringify(n1.errors || null));
  const coverData = n1.value.pages[0].modules[0].data;
  assert.equal(coverData.title, "活动", "AI 字段保留");
  assert.equal(coverData.contentAlign, "center", "cover 默认对齐来自注册表");
  assert.equal(coverData.width, "full", "默认占宽");
  assert.equal(coverData.mainImage, null, "图片默认 null");
  assert.ok(coverData.template, "模板保留注册表默认");
  assert.equal(n1.value.themeOverrides, null, "未勾选主题时 themeOverrides 为 null");
  assert.equal(n1.value.name, "测试活动", "名称规范化");

  /* 未提供的字段补默认，objectList 条目按子字段 schema 重建 */
  const nT = AD.normalize({ schemaVersion: 1, name: "x", pages: [{ name: "p", modules: [{ type: "ticketInfo", data: { tiers: [{ label: "早鸟" }] } }] }] }, { includeTheme: false });
  const tier = nT.value.pages[0].modules[0].data.tiers[0];
  assert.equal(tier.label, "早鸟", "条目 AI 字段保留");
  assert.equal(tier.price, "", "条目缺失子字段补默认");
  assert.equal(nT.value.pages[0].modules[0].data.qrImage, null, "条目外图片默认 null");
  assert.equal(nT.value.pages[0].modules[0].data.qrPlacement, "right", "select 默认值为首项");

  /* 未知字段即使未经校验也不保留 */
  const nE = AD.normalize({ schemaVersion: 1, name: "x", pages: [{ name: "p", modules: [{ type: "cover", data: { title: "t", evil: "y" } }] }] }, { includeTheme: false });
  assert.equal("evil" in nE.value.pages[0].modules[0].data, false, "规范化丢弃未知字段");

  /* themeOverrides 规范化 */
  const nTh = AD.normalize(Object.assign(validAiDoc(), { themeOverrides: Object.assign(validThemeOverrides(), { radius: 20, divider: "dots", headingWeight: 800 }) }), { includeTheme: true });
  assert.equal(nTh.value.themeOverrides.primary, "#1e7a4f", "主题颜色规范化");
  assert.equal(nTh.value.themeOverrides.radius, 20, "主题数值规范化");
  assert.equal(nTh.value.themeOverrides.divider, "dots", "主题枚举规范化");
  assert.ok(!("headingFont" in nTh.value.themeOverrides), "主题不允许的键不保留");
}

/* ---- buildCandidateDoc ---- */
{
  const current = M.createDoc("3:4");
  current.name = "旧名称";
  current.theme = "ocean";
  current.fontFamily = "serif";
  current.headingFont = "montserrat";
  current.bodyFont = "lato";
  current.fontManual = true;
  current.backgroundColor = "#f0f0f0";
  current.backgroundImage = { url: "blob:doc-bg", name: "bg.png", type: "image/png" };
  current.exportScale = 3;
  current.themeOverrides = { primary: "#123456" };

  const n1 = AD.normalize(validAiDoc(), { includeTheme: false });
  const cand = AD.buildCandidateDoc(n1.value, current, { includeTheme: false });
  assert.equal(cand.name, "测试活动", "候选名称来自 AI");
  assert.equal(cand.ratio, "3:4", "保留当前比例");
  assert.equal(cand.screenMode, "split", "保留屏幕模式");
  assert.equal(cand.theme, "ocean", "保留主题");
  assert.equal(cand.fontFamily, "serif", "保留全局字体");
  assert.equal(cand.headingFont, "montserrat", "保留标题字体");
  assert.equal(cand.bodyFont, "lato", "保留正文字体");
  assert.equal(cand.fontManual, true, "保留 fontManual");
  assert.equal(cand.backgroundColor, "#f0f0f0", "保留整条背景色");
  assert.equal(cand.backgroundImage.url, "blob:doc-bg", "保留整条背景图");
  assert.equal(cand.exportScale, 3, "保留导出倍率");
  assert.equal(JSON.stringify(cand.themeOverrides), JSON.stringify(current.themeOverrides), "未勾选时深拷贝保留原主题覆盖");
  assert.equal(cand.version, 3, "版本号本地生成");

  assert.equal(cand.pages.length, 2, "页面数来自 AI");
  assert.notEqual(cand.pages[0].id, current.pages[0].id, "页面 ID 本地生成");
  assert.equal(cand.pages[0].name, "第 1 屏", "页面名称来自 AI");
  assert.equal(cand.pages[0].backgroundColor, "", "页面背景色重置");
  assert.equal(cand.pages[0].backgroundImage, null, "页面背景图重置");
  const candModule = cand.pages[0].modules[0];
  assert.equal(candModule.type, "cover", "模块类型保留");
  assert.equal(candModule.visible, true, "visible 固定 true");
  assert.ok(candModule.id && typeof candModule.id === "string" && candModule.id.length >= 8, "模块 ID 本地生成");
  const ids = new Set();
  cand.pages.forEach(function (p) { ids.add(p.id); p.modules.forEach(function (m) { ids.add(m.id); }); });
  assert.equal(ids.size, 4, "页面与模块 ID 全部唯一");

  /* 勾选主题时替换覆盖参数 */
  const nTh = AD.normalize(Object.assign(validAiDoc(), { themeOverrides: Object.assign(validThemeOverrides(), { radius: 20, divider: "dots" }) }), { includeTheme: true });
  const candTh = AD.buildCandidateDoc(nTh.value, current, { includeTheme: true });
  assert.equal(candTh.themeOverrides.primary, "#1e7a4f", "勾选主题时使用 AI 覆盖参数");
  assert.equal(candTh.themeOverrides.radius, 20, "AI 主题数值带入");
  assert.ok(!("ink" in candTh.themeOverrides), "未提供的主题字段不出现");

  /* 默认 data 不共享引用 */
  const twoCovers = AD.normalize({ schemaVersion: 1, name: "x", pages: [{ name: "p", modules: [{ type: "cover", data: {} }, { type: "cover", data: {} }] }] }, { includeTheme: false });
  const cand2 = AD.buildCandidateDoc(twoCovers.value, current, { includeTheme: false });
  cand2.pages[0].modules[0].data.title = "改了";
  assert.notEqual(cand2.pages[0].modules[1].data.title, "改了", "同类型模块默认 data 不共享引用");
  cand.pages[0].modules[0].data.infoLines.push("zzz");
  assert.equal(n1.value.pages[0].modules[0].data.infoLines.length, 2, "候选深拷贝，不影响规范化结果");

  assert.throws(function () { AD.buildCandidateDoc(null, current, {}); }, /规范化/, "非法规范化输入抛错");
  assert.throws(function () { AD.buildCandidateDoc(n1.value, null, {}); }, /当前文档/, "缺当前文档抛错");
}

/* ---- applyPipeline（原子应用核心） ---- */
{
  const current = M.createDoc("9:16");
  M.addModule(current, current.pages[0].id, "footer");
  const before = JSON.stringify(current);
  let replaceCalls = 0;
  function noopReplace() { replaceCalls += 1; }
  function noopRender() {}

  const badParse = AD.applyPipeline("{bad json", { includeTheme: false, currentDoc: current, replace: noopReplace, render: noopRender });
  assert.equal(badParse.ok, false, "解析失败返回不通过");
  assert.equal(badParse.phase, "parse", "失败阶段为 parse");
  assert.equal(replaceCalls, 0, "解析失败不触发安装");
  assert.equal(JSON.stringify(current), before, "解析失败原文档深度不变");

  const badValidate = AD.applyPipeline(JSON.stringify({ schemaVersion: 9 }), { includeTheme: false, currentDoc: current, replace: noopReplace, render: noopRender });
  assert.equal(badValidate.phase, "validate", "校验失败阶段");
  assert.ok(badValidate.errors.length > 0, "返回结构化错误");
  assert.equal(JSON.stringify(current), before, "校验失败原文档不变");

  const mismatch = AD.applyPipeline(JSON.stringify(Object.assign(validAiDoc(), { themeOverrides: validThemeOverrides() })), { includeTheme: false, currentDoc: current, replace: noopReplace, render: noopRender });
  assert.equal(mismatch.ok, false, "勾选状态与 JSON 不匹配被拒绝");
  assert.ok(mismatch.errors.some(function (e) { return e.code === "theme_not_allowed"; }), "给出主题字段不允许错误");
  assert.equal(JSON.stringify(current), before, "主题不匹配原文档不变");

  const badBuild = AD.applyPipeline(JSON.stringify(validAiDoc()), { includeTheme: false, currentDoc: null, replace: noopReplace, render: noopRender });
  assert.equal(badBuild.ok, false, "候选构造失败返回不通过");
  assert.equal(badBuild.phase, "build", "失败阶段为 build");
  assert.equal(replaceCalls, 0, "构造失败不触发安装");

  /* replace 抛错（安装即失败）：文档内容不变 */
  const holder = { doc: current };
  const badInstall = AD.applyPipeline(JSON.stringify(validAiDoc()), {
    includeTheme: false,
    currentDoc: current,
    replace: function () { throw new Error("install boom"); },
    render: noopRender,
  });
  assert.equal(badInstall.ok, false, "安装失败返回不通过");
  assert.equal(badInstall.phase, "render", "安装失败归入 render 阶段");
  assert.equal(badInstall.restored, false, "安装钩子本身抛错时无法回滚，显式标记");
  assert.equal(JSON.stringify(holder.doc), before, "安装失败原文档深度不变");

  /* render 抛错：自动回滚快照并重渲染 */
  let renderCount = 0;
  const badRender = AD.applyPipeline(JSON.stringify(validAiDoc()), {
    includeTheme: false,
    currentDoc: current,
    replace: function (doc) { holder.doc = doc; },
    render: function () { renderCount += 1; if (renderCount === 1) throw new Error("render boom"); },
  });
  assert.equal(badRender.ok, false, "渲染失败返回不通过");
  assert.equal(badRender.phase, "render", "失败阶段为 render");
  assert.equal(badRender.restored, true, "已自动回滚");
  assert.equal(JSON.stringify(holder.doc), before, "回滚后文档内容恢复");
  assert.equal(renderCount, 2, "回滚后重渲染一次");

  /* 成功路径：一次替换 + 快照 + 统计 */
  let rendered = 0;
  const okRun = AD.applyPipeline(JSON.stringify(validAiDoc()), {
    includeTheme: false,
    currentDoc: current,
    replace: function (doc) { holder.doc = doc; },
    render: function () { rendered += 1; },
  });
  assert.equal(okRun.ok, true, "成功应用");
  assert.equal(rendered, 1, "成功后渲染一次");
  assert.equal(okRun.stats.pages, 2, "统计屏数");
  assert.equal(okRun.stats.modules, 2, "统计板块数");
  assert.ok(okRun.snapshot && JSON.stringify(okRun.snapshot) === before, "快照为应用前文档");
  assert.notEqual(JSON.stringify(holder.doc), before, "成功后文档被替换");

  /* 撤销 = 重新安装快照（banner 内为 state.aiUndoSnapshot 赋值） */
  holder.doc = okRun.snapshot;
  assert.equal(JSON.stringify(holder.doc), before, "撤销恢复生成前文档");

  /* 第二次生成返回全新快照（覆盖旧撤销快照） */
  const okRun2 = AD.applyPipeline(JSON.stringify(validAiDoc()), {
    includeTheme: false,
    currentDoc: holder.doc,
    replace: function (doc) { holder.doc = doc; },
    render: noopRender,
  });
  assert.equal(okRun2.ok, true, "第二次生成成功");
  assert.notEqual(okRun2.snapshot, okRun.snapshot, "新快照覆盖旧快照");
  assert.notEqual(okRun2.doc.pages[0].id, okRun.doc.pages[0].id, "两次生成 ID 不同");

  /* 勾选主题端到端 */
  const okThemed = AD.applyPipeline(JSON.stringify(Object.assign(validAiDoc(), { themeOverrides: validThemeOverrides() })), {
    includeTheme: true,
    currentDoc: current,
    replace: function (doc) { holder.doc = doc; },
    render: noopRender,
  });
  assert.equal(okThemed.ok, true, "带主题管线成功");
  assert.equal(okThemed.doc.themeOverrides.primary, "#1e7a4f", "AI 主题覆盖参数进入候选文档");
  const okNoThemeKeep = AD.applyPipeline(JSON.stringify(validAiDoc()), {
    includeTheme: false,
    currentDoc: okThemed.doc,
    replace: function (doc) { holder.doc = doc; },
    render: noopRender,
  });
  assert.equal(okNoThemeKeep.doc.themeOverrides.primary, "#1e7a4f", "未勾选时候选保留原文档主题覆盖");
}

console.log("AI 整份长条数据层测试全部通过");

/* ============ 草稿恢复候选构造（banner-builder.js 内部纯函数） ============ */
vm.runInContext(fs.readFileSync("js/banner-builder.js", "utf8"), ctx, { filename: "js/banner-builder.js" });
const DraftTools = window.BannerBuilderDraftTools;
assert.ok(DraftTools && typeof DraftTools.buildDraftCandidate === "function", "草稿候选构造器已暴露");
{
  const draft = {
    version: 2, name: "旧草稿", ratio: "3:4", theme: "sunset", fontFamily: "kai",
    headingFont: "", bodyFont: "", fontManual: false, screenMode: "continuous",
    backgroundColor: "#ffffff", backgroundImage: null,
    pages: [
      {
        id: "page-1", name: "首屏", backgroundColor: "#eef", backgroundImage: null,
        modules: [
          { id: "mod-1", type: "performerCard", visible: true, data: { name: "旧嘉宾", bio: "老结构", setlist: ["歌曲一", "♪歌曲二"], padding: 20 } },
          { id: "mod-2", type: "performerCard", visible: true, data: { template: "cast-cards", cast: [{ name: "卡片乐队", avatar: null, setlist: [] }] } },
        ],
      },
    ],
  };
  const candidate = DraftTools.buildDraftCandidate(draft);
  assert.equal(candidate.name, "旧草稿", "草稿名称保留");
  assert.equal(candidate.ratio, "3:4", "草稿比例保留");
  assert.equal(candidate.screenMode, "continuous", "草稿屏幕模式保留");
  assert.equal(candidate.theme, "sunset", "草稿主题保留");
  assert.equal(candidate.fontFamily, "kai", "草稿字体保留");
  assert.equal(candidate.exportScale, 2, "缺失导出倍率补默认 2");
  assert.equal(JSON.stringify(candidate.themeOverrides), "{}", "缺失主题覆盖补空对象");
  assert.equal(candidate.pages.length, 1, "页面数保留");
  assert.equal(candidate.pages[0].id, "page-1", "保留原页面 ID");
  assert.equal(candidate.pages[0].backgroundColor, "#eef", "保留页背景");
  const mod = candidate.pages[0].modules[0];
  assert.equal(mod.id, "mod-1", "保留原模块 ID");
  assert.equal(mod.type, "castList", "旧 performerCard（无模板）迁移为 castList");
  assert.equal(mod.data.padding, 20, "草稿允许保留历史内部字段");
  assert.equal(mod.data.cast.length, 1, "旧嘉宾结构迁移为 cast");
  assert.equal(mod.data.cast[0].name, "旧嘉宾", "迁移保留名称");
  assert.equal(mod.data.cast[0].setlist[0].song, "歌曲一", "迁移转换歌单");
  assert.equal(mod.data.cast[0].setlist[1].song, "歌曲二", "迁移去掉音符前缀");
  const modCards = candidate.pages[0].modules[1];
  assert.equal(modCards.type, "castCards", "旧 performerCard（卡片模板）迁移为 castCards");
  assert.equal(modCards.data.cast[0].name, "卡片乐队", "迁移保留卡片成员数据");

  assert.throws(function () { DraftTools.buildDraftCandidate({ pages: [] }); }, /pages/, "空 pages 被拒绝（修复部分应用缺陷）");
  assert.throws(function () { DraftTools.buildDraftCandidate({}); }, /pages/, "缺 pages 被拒绝");
  assert.throws(function () { DraftTools.buildDraftCandidate(null); }, /对象/, "非对象草稿被拒绝");
  assert.throws(function () { DraftTools.buildDraftCandidate({ pages: [{ name: "p", modules: [{ id: "m", type: "nope", data: {} }] }] }); }, /类型/, "未知板块类型被拒绝");
  assert.throws(function () { DraftTools.buildDraftCandidate({ pages: [{ name: "p" }] }); }, /数组/, "缺模块数组被拒绝");

  const fixed = DraftTools.buildDraftCandidate({ name: "x", pages: [{ name: "p", modules: [{ type: "divider", data: {} }] }] });
  assert.equal(typeof fixed.pages[0].id, "string", "缺页面 ID 自动补");
  assert.equal(typeof fixed.pages[0].modules[0].id, "string", "缺模块 ID 自动补");
  assert.equal(fixed.pages[0].modules[0].visible, true, "visible 默认 true");
  const badRatio = DraftTools.buildDraftCandidate({ ratio: "8:1", pages: [{ name: "p", modules: [] }] });
  assert.equal(badRatio.ratio, "9:16", "非法比例回退默认");

  const customTheme = {
    id: "portable-theme", label: "可携带主题", primary: "#111111", primaryDark: "#222222", primarySoft: "#eeeeee",
    accent: "#cc5500", accentSoft: "#fff0e6", line: "#cccccc", soft: "#f7f7f7",
    cardStyle: "glass", radius: 24, shadow: "soft", divider: "dots", chips: "pill", titleDecor: "bar", pattern: "grid", avatarStyle: "ring",
    ink: "#202020", muted: "#666666", headingWeight: 800, bodyWeight: 400, lineHeight: 1, letterSpacing: 0,
    typeScale: 1, h1Scale: 1, h2Scale: 1, h3Scale: 1, bodyScale: 1, captionScale: 1, headingFont: "", bodyFont: ""
  };
  const portableDraft = DraftTools.buildDraftCandidate({ version: 3, theme: "portable-theme", themeDefinition: customTheme, pages: [{ name: "p", modules: [] }] });
  assert.equal(portableDraft.__themeKnown, true, "内嵌主题无需当前浏览器预装即可识别");
  assert.equal(portableDraft.themeDefinition.primary, "#111111", "完整主题定义进入候选文档");
  assert.equal(C.themeStyleForDoc(portableDraft).accent, "#cc5500", "渲染优先使用草稿内嵌主题");
  assert.throws(function () {
    DraftTools.buildDraftCandidate({ version: 3, theme: "portable-theme", themeDefinition: Object.assign({}, customTheme, { id: "other-theme" }), pages: [{ name: "p", modules: [] }] });
  }, /ID 不一致/, "主题定义 ID 不一致时拒绝导入");
}

console.log("草稿恢复候选构造测试全部通过");

/* ============ 导入器加固（theme / module importer） ============ */
/* window.localStorage 内存桩：导入器通过 global.localStorage 读写，注入后可在 Node 中测试导入与同 ID 拒绝 */
window.localStorage = {
  _d: {},
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; },
};
vm.runInContext(fs.readFileSync("js/banner-builder-theme-importer.js", "utf8"), ctx, { filename: "js/banner-builder-theme-importer.js" });
vm.runInContext(fs.readFileSync("js/banner-builder-module-importer.js", "utf8"), ctx, { filename: "js/banner-builder-module-importer.js" });
const TI = window.BannerBuilderThemeImporter;
assert.ok(TI && typeof TI.add === "function", "主题导入器已加载");

/* 提示词无 // 注释，板块提示词头部示例为合法 JSON（修复 AI 照抄注释导致解析失败） */
assert.equal(TI.buildPrompt().includes("//"), false, "主题提示词无 // 注释");
{
  const modulePrompt = MI.buildPrompt();
  assert.equal(modulePrompt.includes("//"), false, "板块提示词无 // 注释");
  const hs = modulePrompt.indexOf("{", modulePrompt.indexOf("JSON"));
  const he = modulePrompt.lastIndexOf("}", modulePrompt.indexOf("====="));
  assert.equal(JSON.parse(modulePrompt.slice(hs, he + 1)).id, "my-module", "板块提示词头部示例为合法 JSON");
}

/* 主题校验范围与「微调主题 / 排版微调」手动界面一致 */
function themeBase() {
  return { id: "range-test", label: "范围", primary: "#111111", primaryDark: "#222222", primarySoft: "#333333", accent: "#444444", accentSoft: "#555555", line: "#666666", soft: "#777777" };
}
assert.ok(TI.validate(Object.assign(themeBase(), { letterSpacing: 10 })).some(function (m) { return m.includes("letterSpacing"); }), "letterSpacing 超出手动范围（-2..8）被拒");
assert.equal(TI.validate(Object.assign(themeBase(), { letterSpacing: -2, typeScale: 1.5, h1Scale: 1.3, bodyWeight: 400, lineHeight: 0.8 })).length, 0, "手动界面边界值全部通过");
assert.ok(TI.validate(Object.assign(themeBase(), { bodyWeight: 300 })).some(function (m) { return m.includes("bodyWeight"); }), "bodyWeight 300 被拒（手动档位 400-900）");
assert.ok(TI.validate(Object.assign(themeBase(), { lineHeight: 1.234 })).some(function (m) { return m.includes("lineHeight"); }), "lineHeight 步进校验生效");
assert.ok(TI.validate(Object.assign(themeBase(), { headingFont: "nonexistent-font" })).some(function (m) { return m.includes("headingFont"); }), "未知字体 key 被拒");

/* 同 ID 拒绝覆盖（自定义之间 + 与内置主题冲突），失败不改变原记录 */
TI.add(Object.assign(themeBase(), { id: "my-new-theme" }));
const customDraftDoc = M.createDoc();
customDraftDoc.theme = "my-new-theme";
const customDraftPayload = DraftTools.buildDraftPayload(customDraftDoc);
assert.equal(customDraftPayload.version, 3, "导出草稿升级为 v3");
assert.equal(customDraftPayload.themeDefinition.id, "my-new-theme", "导出草稿包含当前自定义主题定义");
assert.equal(customDraftPayload.themeDefinition.primary, "#111111", "自定义主题完整色值进入草稿");
window.localStorage.removeItem("only-box-banner-custom-themes");
const restoredCustomDraft = DraftTools.buildDraftCandidate(customDraftPayload);
assert.equal(restoredCustomDraft.__themeKnown, true, "清空本地主题后仍可从草稿恢复");
assert.equal(C.themeStyleForDoc(restoredCustomDraft).primary, "#111111", "草稿往返后主题渲染保持一致");
TI.add(Object.assign(themeBase(), { id: "my-new-theme" }));
assert.throws(function () { TI.add(Object.assign(themeBase(), { id: "my-new-theme", label: "覆盖尝试" })); }, /同 ID/, "同 ID 自定义主题拒绝覆盖");
assert.throws(function () { TI.add(Object.assign(themeBase(), { id: "forest", label: "内置冲突" })); }, /同 ID/, "与内置主题同 ID 拒绝");
assert.equal(TI.loadAll().filter(function (t) { return t.id === "my-new-theme"; }).length, 1, "拒绝后原记录未被替换");
assert.equal(typeof TI.promptText, "string", "promptText getter 可用（字体导入后实时刷新）");

/* 板块模块同 ID 拒绝覆盖 */
MI.add({ id: "my-module-x", label: "模块", type: "ticketInfo", data: {} });
assert.throws(function () { MI.add({ id: "my-module-x", label: "覆盖尝试", type: "ticketInfo", data: {} }); }, /同 ID/, "同 ID 板块模块拒绝覆盖");
assert.equal(MI.loadAll().filter(function (m) { return m.id === "my-module-x"; }).length, 1, "板块拒绝后原记录未被替换");

console.log("导入器加固测试全部通过");
/* ============ 安全加固测试 ============ */

/* 字体家族名/URL 注入清理：恶意字体文件名或 name 表内容不得破坏 @font-face 样式表 */
{
  const evilFamily = 'x"}*{background:url(https://evil/log)}@import "https://evil";.a{';
  const cleaned = C.safeCssToken(evilFamily);
  assert.equal(cleaned.includes("}"), false, "safeCssToken 去除花括号");
  assert.equal(cleaned.includes('"'), false, "safeCssToken 去除引号");
  assert.equal(cleaned.includes("\\"), false, "safeCssToken 去除反斜杠");
  const face = C.fontFaceFor({ family: evilFamily, src: [{ url: 'a");}body{display:none}x.ttf', format: "truetype" }] });
  /* 安全性质：注入文本无法逃逸字符串边界——产物中不再存在可闭合规则的结构序列 */
  assert.equal(face.includes('"}'), false, "产物中无可闭合家族名字符串的序列");
  assert.equal(face.split("@font-face").length, 2, "产物只含一条 @font-face 规则（未注入新规则）");
  assert.ok(face.includes("font-family:\""), "正常 @font-face 结构保留");
  const normalFace = C.fontFaceFor({ family: "Noto Sans SC", src: [{ url: "https://cdn.example/x.woff2", format: "woff2" }] });
  assert.ok(normalFace.includes("Noto Sans SC"), "正常家族名原样保留");
}

/* 草稿恢复资源上限：社区互传的草稿属于不可信输入 */
{
  const hugePages = { name: "evil", pages: [] };
  for (let i = 0; i < 201; i += 1) hugePages.pages.push({ name: "p", modules: [] });
  assert.throws(function () { DraftTools.buildDraftCandidate(hugePages); }, /屏数/, "超过 200 屏的草稿被拒绝");

  const hugeText = { name: "evil", pages: [{ name: "p", modules: [{ type: "freeText", data: { text: "字".repeat(50001) } }] }] };
  assert.throws(function () { DraftTools.buildDraftCandidate(hugeText); }, /异常长的文本/, "超长文本字段被拒绝");

  const manyModules = { name: "evil", pages: [{ name: "p", modules: [] }] };
  for (let i = 0; i < 301; i += 1) manyModules.pages[0].modules.push({ type: "divider", data: {} });
  assert.throws(function () { DraftTools.buildDraftCandidate(manyModules); }, /板块数/, "单屏超过 300 板块被拒绝");

  const deep = { name: "evil", pages: [{ name: "p", modules: [] }] };
  let node = deep;
  for (let i = 0; i < 70; i += 1) { node.child = {}; node = node.child; }
  assert.throws(function () { DraftTools.buildDraftCandidate(deep); }, /嵌套过深/, "超深嵌套被拒绝");

  /* 正常规模草稿不受影响：边界值恰好在限内 */
  const okDraft = { name: "ok", pages: [{ name: "p", modules: [] }] };
  for (let i = 0; i < 200; i += 1) okDraft.pages.push({ name: "p" + i, modules: [{ type: "divider", data: {} }] });
  okDraft.pages = okDraft.pages.slice(0, 200);
  const okCandidate = DraftTools.buildDraftCandidate(okDraft);
  assert.equal(okCandidate.pages.length, 200, "200 屏草稿正常恢复");
}

console.log("安全加固测试全部通过");

/* ============ 任务A加固：版本门禁 / ID唯一 / 主题覆盖白名单 / 模块数据形状（BB-R01/R05/R06/R07） ============ */
{
  /* BB-R06 版本门禁：未来版本、非整数、负数、0 一律拒绝 */
  const page = [{ name: "p", modules: [{ type: "divider", data: {} }] }];
  assert.throws(function () { DraftTools.buildDraftCandidate({ version: 999, pages: page }); }, /更新版本|999/, "未来版本草稿被拒绝");
  assert.throws(function () { DraftTools.buildDraftCandidate({ version: 2.5, pages: page }); }, /整数/, "非整数版本被拒绝");
  assert.throws(function () { DraftTools.buildDraftCandidate({ version: -1, pages: page }); }, /正整数|过老/, "负数版本被拒绝");
  assert.throws(function () { DraftTools.buildDraftCandidate({ version: 0, pages: page }); }, /正整数|过老/, "0 版本被拒绝");
  /* v1（无 version 字段）与 v3 均可正常恢复 */
  assert.ok(DraftTools.buildDraftCandidate({ pages: page }), "无版本字段草稿按 v1 迁移恢复");
  assert.ok(DraftTools.buildDraftCandidate({ version: 3, pages: page }), "v3 草稿正常恢复");
  /* 迁移后候选版本恒为 3 */
  assert.equal(DraftTools.buildDraftCandidate({ pages: page }).version, 3, "v1 草稿迁移后版本为 3");
  assert.equal(DraftTools.buildDraftCandidate({ version: 2, pages: page }).version, 3, "v2 草稿迁移后版本为 3");

  /* BB-R07 ID 唯一性：显式重复拒绝，缺失自动补齐且全局唯一 */
  assert.throws(function () {
    DraftTools.buildDraftCandidate({ pages: [{ id: "dup", name: "p1", modules: [] }, { id: "dup", name: "p2", modules: [] }] });
  }, /重复/, "重复页面 ID 被拒绝");
  assert.throws(function () {
    DraftTools.buildDraftCandidate({ pages: [{ name: "p", modules: [{ id: "m1", type: "divider", data: {} }, { id: "m1", type: "divider", data: {} }] }] });
  }, /重复/, "重复模块 ID 被拒绝");
  assert.throws(function () {
    DraftTools.buildDraftCandidate({ pages: [{ id: "same", name: "p", modules: [{ id: "same", type: "divider", data: {} }] }] });
  }, /重复/, "页面 ID 与模块 ID 相同也被拒绝（全局唯一）");
  {
    const noIds = DraftTools.buildDraftCandidate({ pages: [{ name: "a", modules: [{ type: "divider", data: {} }, { type: "divider", data: {} }] }, { name: "b", modules: [] }] });
    const allIds = noIds.pages.map(function (p) { return p.id; }).concat(noIds.pages[0].modules.map(function (m) { return m.id; }));
    assert.equal(new Set(allIds).size, allIds.length, "自动补齐的 ID 全局唯一");
  }

  /* BB-R05 themeOverrides 白名单：未知字段丢弃、危险键丢弃、超范围数值丢弃、合法覆盖保留 */
  {
    const draft = {
      version: 3,
      themeOverrides: {
        primary: "#AABBCC", radius: 24, cardStyle: "glass", headingWeight: 800,
        evil: "#123456", __proto__x: 1, radius2: 999,
        typeScale: 99, lineHeight: "big", shadow: "unknown-style",
      },
      pages: [{ name: "p", modules: [] }],
    };
    const ov = DraftTools.buildDraftCandidate(draft).themeOverrides;
    assert.equal(ov.primary, "#aabbcc", "合法颜色覆盖保留（并规范化小写）");
    assert.equal(ov.radius, 24, "合法圆角保留");
    assert.equal(ov.cardStyle, "glass", "合法枚举保留");
    assert.equal(ov.headingWeight, 800, "合法字重保留");
    assert.equal("evil" in ov, false, "未知字段被白名单丢弃");
    assert.equal("typeScale" in ov, false, "超范围数值被丢弃");
    assert.equal("lineHeight" in ov, false, "非数值被丢弃");
    assert.equal("shadow" in ov, false, "非法枚举被丢弃");
  }

  /* BB-R01 模块数据形状校验：stringList 写成对象 / objectList 项为字符串 / 图片字段为远程 URL 均拒绝 */
  assert.throws(function () {
    DraftTools.buildDraftCandidate({ pages: [{ name: "p", modules: [{ type: "footer", data: { lines: {} } }] }] });
  }, /lines|数组/, "stringList 写成对象被拒绝");
  assert.throws(function () {
    DraftTools.buildDraftCandidate({ pages: [{ name: "p", modules: [{ type: "castList", data: { cast: ["不是对象"] } }] }] });
  }, /cast|对象/, "objectList 项为字符串被拒绝");
  assert.throws(function () {
    DraftTools.buildDraftCandidate({ pages: [{ name: "p", modules: [{ type: "cover", data: { mainImage: "https://evil.example/x.png" } }] }] });
  }, /mainImage|null|图片/, "图片字段为远程 URL 字符串被拒绝");
  /* 草稿图片记录（data:/blob: url + name + type）合法保留 */
  {
    const imgDraft = DraftTools.buildDraftCandidate({ pages: [{ name: "p", modules: [{ type: "cover", data: { mainImage: { url: "data:image/png;base64,iVBOR", name: "a.png", type: "image/png" } } }] }] });
    assert.equal(imgDraft.pages[0].modules[0].data.mainImage.url, "data:image/png;base64,iVBOR", "草稿内嵌图片记录合法保留");
  }
  /* 历史内部字段（padding 等注册表外字段）宽容保留 */
  {
    const legacy = DraftTools.buildDraftCandidate({ pages: [{ name: "p", modules: [{ type: "divider", data: { padding: 20, customLegacy: "x" } }] }] });
    assert.equal(legacy.pages[0].modules[0].data.padding, 20, "历史内部字段宽容保留");
  }
}

console.log("任务A加固测试全部通过");

/* ============ 模块导入器深度校验（BB-R14） ============ */
{
  /* 深度校验：未知字段 / 远程图片 / 形状错误在导入时被拒绝 */
  assert.ok(MI.validate({ id: "ok-mod", label: "正常", type: "ticketInfo", data: { sectionTitle: "票", tiers: [] } }).length === 0, "合法模块数据通过深度校验");
  assert.ok(MI.validate({ id: "bad-unknown", label: "未知字段", type: "ticketInfo", data: { evilField: 1 } }).some(function (m) { return m.includes("evilField"); }), "未知字段被深度校验拒绝");
  assert.ok(MI.validate({ id: "bad-image", label: "远程图", type: "cover", data: { mainImage: "https://evil.example/x.png" } }).some(function (m) { return m.includes("mainImage"); }), "远程图片 URL 被深度校验拒绝");
  assert.ok(MI.validate({ id: "bad-shape", label: "形状错误", type: "footer", data: { lines: {} } }).some(function (m) { return m.includes("lines"); }), "stringList 对象形状被深度校验拒绝");
  /* localStorage 历史损坏记录隔离：loadAll 跳过无效记录，不影响其余记录 */
  window.localStorage.setItem("only-box-banner-custom-modules", JSON.stringify([
    { id: "good-record", label: "好记录", type: "ticketInfo", data: {}, createdAt: 1 },
    { id: "bad-record", label: "坏记录", type: "no-such-type", data: {}, createdAt: 2 },
    { id: "bad-image-record", label: "远程图记录", type: "cover", data: { mainImage: "https://evil.example/x.png" }, createdAt: 3 },
    "not-an-object",
  ]));
  const loaded = MI.loadAll();
  assert.equal(loaded.length, 1, "损坏历史记录被隔离（只保留 1 条有效记录）");
  assert.equal(loaded[0].id, "good-record", "有效历史记录正常加载");
  window.localStorage.removeItem("only-box-banner-custom-modules");
}

console.log("模块导入器深度校验测试全部通过");

/* ============ 任务B加固：blob 转换显式失败 + 快照无残留 blob:（BB-R03） ============ */
{
  /* snapshotData 转换失败必须抛错（带字段路径），不得静默返回 blob: 原值 */
  window.fetch = function (url) { return Promise.reject(new Error("network down")); };
  const T2 = window.BannerBuilderMyTemplates;
  const withBlob = { pages: [{ name: "p", modules: [{ type: "cover", data: { mainImage: { url: "blob:mock-1", name: "a.png", type: "image/png" } } }] }] };
  let rejected = null;
  T2.snapshotData(withBlob).then(
    function () { rejected = false; },
    function (error) { rejected = String(error && error.message || error); }
  );
  /* 同步等待微任务队列排空（Node 下 setTimeout(0) 在 promise 之后） */
  setTimeout(function () {
    assert.ok(rejected !== false, "blob 转换失败时 snapshotData 拒绝而不是静默成功");
    assert.ok(/blob:mock-1|pages\[0\]|mainImage/.test(rejected), "失败信息携带字段路径（实际：" + rejected + "）");
    /* 成功路径：data: URL 原样保留（无需转换） */
    const withData = { mainImage: { url: "data:image/png;base64,iVBOR", name: "a.png", type: "image/png" }, text: "x" };
    T2.snapshotData(withData).then(function (snap) {
      assert.equal(snap.mainImage.url, "data:image/png;base64,iVBOR", "data: URL 快照原样保留");
      assert.equal(snap.text, "x", "普通字段快照原样保留");
      console.log("任务B加固测试全部通过");
    }, function (error) {
      assert.fail("data: URL 快照不应失败：" + (error && error.message));
    });
  }, 50);
}

/* ============ 任务E加固：字体依赖声明与缺失映射（BB-R13） ============ */
{
  /* 在已加载 banner-builder.js 的 vm 上下文中注入字体导入器桩，验证 fontDependencies 声明逻辑。
     collectFontDependencies 只声明「用户导入字体」：内置字体（如 sans/kai）不声明，
     doc 三级字体与主题定义推荐字体分别声明，同一 key 去重合并 role。 */
  const DT = window.BannerBuilderDraftTools;
  assert.ok(DT && typeof DT.buildDraftPayload === "function", "DraftTools 可用");

  /* 场景 1：无字体导入器（旧浏览器/未导入）——fontDependencies 为空数组，不抛错 */
  const docPlain = M.createDoc();
  const payloadPlain = DT.buildDraftPayload(docPlain);
  assert.ok(Array.isArray(payloadPlain.fontDependencies), "无导入器时 fontDependencies 为数组");
  assert.equal(payloadPlain.fontDependencies.length, 0, "内置字体不声明依赖（无用户字体场景）");

  /* 场景 2：注入字体导入器桩——用户字体被声明，内置字体仍不声明 */
  const savedImporter = window.BannerBuilderFontImporter;
  window.BannerBuilderFontImporter = {
    listFonts: function () {
      return [{ id: "user-font-a" }, { id: "user-font-b" }, { id: null }];
    },
  };
  /* C.FONTS 需含用户字体元数据供 label 取值；模拟 applyToConstants 后的状态 */
  C.FONTS["user-font-a"] = { label: "用户字体A", css: [] };
  C.FONTS["user-font-b"] = { label: "用户字体B", css: [] };
  try {
    const docUser = M.createDoc();
    docUser.fontFamily = "user-font-a";
    docUser.headingFont = "user-font-b";
    docUser.bodyFont = "kai"; /* 内置字体：不声明 */
    const payloadUser = DT.buildDraftPayload(docUser);
    const deps = payloadUser.fontDependencies;
    assert.equal(deps.length, 2, "只声明用户导入字体（kai 不声明）");
    const depA = deps.filter(function (d) { return d.key === "user-font-a"; })[0];
    const depB = deps.filter(function (d) { return d.key === "user-font-b"; })[0];
    assert.ok(depA, "全局字体 user-font-a 已声明");
    assert.equal(depA.label, "用户字体A", "依赖 label 取自 C.FONTS 元数据");
    assert.ok(depA.role.length === 1 && depA.role[0] === "global", "全局字体 role 标记");
    assert.ok(depB, "标题字体 user-font-b 已声明");
    assert.ok(depB.role.length === 1 && depB.role[0] === "heading", "标题字体 role 标记");

    /* 场景 3：主题定义推荐字体与 doc 字体同 key 时合并 role */
    const docTheme = M.createDoc();
    docTheme.fontFamily = "user-font-a";
    docTheme.themeDefinition = {
      id: "test-theme", label: "测试", primary: "#111111", primaryDark: "#222222", primarySoft: "#333333",
      accent: "#444444", accentSoft: "#555555", line: "#666666", soft: "#777777",
      headingFont: "user-font-a", bodyFont: "user-font-b",
    };
    const payloadTheme = DT.buildDraftPayload(docTheme);
    const depsT = payloadTheme.fontDependencies;
    assert.equal(depsT.length, 2, "同 key 去重后仍为 2 条依赖");
    const depTA = depsT.filter(function (d) { return d.key === "user-font-a"; })[0];
    const depTB = depsT.filter(function (d) { return d.key === "user-font-b"; })[0];
    assert.ok(depTA.role.indexOf("global") >= 0 && depTA.role.indexOf("theme") >= 0, "同 key 合并 role：global + theme");
    assert.ok(depTB.role.length === 1 && depTB.role[0] === "theme", "仅主题推荐时 role 为 theme");

    /* 场景 4：listFonts 抛错时安全回退为空声明（不阻断草稿导出） */
    window.BannerBuilderFontImporter = { listFonts: function () { throw new Error("IndexedDB broken"); } };
    const docErr = M.createDoc();
    docErr.fontFamily = "user-font-a";
    const payloadErr = DT.buildDraftPayload(docErr);
    assert.equal(payloadErr.fontDependencies.length, 0, "导入器异常时回退空声明，草稿导出不受阻");
  } finally {
    delete C.FONTS["user-font-a"];
    delete C.FONTS["user-font-b"];
    if (savedImporter === undefined) delete window.BannerBuilderFontImporter;
    else window.BannerBuilderFontImporter = savedImporter;
  }
}

console.log("任务E加固测试全部通过");


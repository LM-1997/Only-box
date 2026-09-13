const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const ctx = vm.createContext({ window, console });
["data/fonts.js", "js/banner-builder-constants.js", "js/banner-builder-registry.js", "js/banner-builder-model.js", "js/banner-builder-mytemplates.js", "js/banner-builder-module-importer.js"].forEach(function (file) {
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

assert.equal(R.MODULE_ORDER.length, 15, "共 15 种模块");

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
  const module = M.createModule("performerCard");
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

/* 15 种模块全部塞进一页后也能正常序列化（验收标准：同类型可重复添加） */
{
  const doc = M.createDoc();
  R.MODULE_ORDER.forEach(function (type) {
    M.addModule(doc, doc.pages[0].id, type);
    M.addModule(doc, doc.pages[0].id, type);
  });
  assert.equal(doc.pages[0].modules.length, 30, "同类型可重复添加");
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
["announcement", "ticketInfo", "materials", "crossPromo", "venueInfo", "performerCard", "footer"].forEach(function (type) {
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

/* 头像装饰已收归主题（不再作为成员级字段，performerCard 默认无 avatarStyle） */
{
  const def = R.getDef("performerCard");
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

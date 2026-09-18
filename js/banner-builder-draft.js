/* =====================================================================
   Only-box · banner-builder-draft.js（草稿导入/导出纯逻辑层）
   ---------------------------------------------------------------------
   职责：草稿 JSON 的构造、版本迁移、白名单校验、结构规范化、图片还原。
   边界：纯数据变换，不触碰 DOM、不直接读写 state.doc（由主脚本编排）。
   依赖（均为已加载的全局命名空间）：
     C  BannerBuilderConstants   R  BannerBuilderRegistry
     M  BannerBuilderModel       U  BannerBuilderUtils
     以及按需访问的 BannerBuilderThemeImporter / BannerBuilderAiDocument /
     BannerBuilderFontImporter / BannerBuilderBackgrounds。
   ===================================================================== */
(function (global) {
  "use strict";

  var C = global.BannerBuilderConstants;
  var R = global.BannerBuilderRegistry;
  var M = global.BannerBuilderModel;
  var U = global.BannerBuilderUtils;
  var BG = function () { return global.BannerBuilderBackgrounds; };

  function dataUrlToBlobRecord(value) {
    return U.dataUrlToBlobRecord(value);
  }
  function restoreDraftImages(value) {
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i += 1) value[i] = restoreDraftImages(value[i]); return value; }
    if (!value || typeof value !== "object") return value;
    if (typeof value.url === "string" && value.url.indexOf("data:") === 0 && typeof value.name === "string") return dataUrlToBlobRecord(value);
    Object.keys(value).forEach(function (key) { value[key] = restoreDraftImages(value[key]); });
    return value;
  }
  function buildDraftPayload(doc) {
    const draft = M.toJSON(doc);
    draft.version = Math.max(3, Number(draft.version) || 0);
    const importer = global.BannerBuilderThemeImporter;
    let definition = draft.themeDefinition;
    if (!definition && importer && typeof importer.loadAll === "function") {
      definition = importer.loadAll().filter(function (theme) { return theme && theme.id === draft.theme; })[0] || null;
    }
    /* 所有主题均写入完整基础定义：自定义主题可跨浏览器恢复，内置主题也不受后续预设改版影响。 */
    if (!definition && C.themeStyle) {
      definition = C.themeStyle(draft.theme);
      if (definition) definition.id = draft.theme;
    }
    draft.themeDefinition = definition ? JSON.parse(JSON.stringify(definition)) : null;
    /* BB-R13：字体依赖声明——草稿只存字体 key，自定义字体文件在本机 IndexedDB。
       导出时声明文档实际引用的字体（含主题推荐与手动选择），导入端据此检测缺失并让用户映射替代，
       字体缺失不拒绝主题配色恢复。 */
    draft.fontDependencies = collectFontDependencies(draft);
    return draft;
  }
  /* 收集草稿实际引用的字体依赖：doc 三级字体 + 主题定义内嵌推荐字体。
     只声明「当前环境里属于用户导入字体」的 key（内置字体随工具分发，不存在跨浏览器缺失）。 */
  function collectFontDependencies(draft) {
    const fontImporter = global.BannerBuilderFontImporter;
    let userFontIds = [];
    if (fontImporter && typeof fontImporter.listFonts === "function") {
      try { userFontIds = fontImporter.listFonts().map(function (row) { return row && row.id; }).filter(Boolean); } catch (error) { userFontIds = []; }
    }
    const deps = [];
    const roles = { fontFamily: "global", headingFont: "heading", bodyFont: "body" };
    Object.keys(roles).forEach(function (key) {
      const fontKey = draft[key];
      if (typeof fontKey !== "string" || !fontKey) return;
      if (userFontIds.indexOf(fontKey) < 0) return; /* 内置字体不声明 */
      const meta = C.FONTS[fontKey];
      if (deps.some(function (d) { return d.key === fontKey; })) return;
      deps.push({ key: fontKey, label: (meta && meta.label) || fontKey, role: [roles[key]] });
    });
    /* 主题定义中的推荐字体（headingFont/bodyFont）同样声明，role 标记为 theme */
    const def = draft.themeDefinition;
    if (def && typeof def === "object") {
      ["headingFont", "bodyFont"].forEach(function (key) {
        const fontKey = def[key];
        if (typeof fontKey !== "string" || !fontKey) return;
        if (userFontIds.indexOf(fontKey) < 0) return;
        const existing = deps.filter(function (d) { return d.key === fontKey; })[0];
        if (existing) { if (existing.role.indexOf("theme") < 0) existing.role.push("theme"); return; }
        const meta = C.FONTS[fontKey];
        deps.push({ key: fontKey, label: (meta && meta.label) || fontKey, role: ["theme"] });
      });
    }
    return deps;
  }
  /* 旧类型 key 迁移：performerCard 拆分为 castList / castCards 后，历史数据按模板落位。
     存储记录（草稿/自定义板块/我的模板）创建模块前必须先过这个函数。 */
  function migrateLegacyModuleType(type, data) {
    if (type === "performerCard") {
      return data && data.template === "cast-cards" ? "castCards" : "castList";
    }
    return type;
  }
  function migrateModuleData(module) {
    if (!module || !module.data) return module;
    /* 旧「嘉宾卡」单嘉宾结构（name/bio/setlist/images）→ 新「演出阵容」列表结构（cast） */
    const isPerformer = module.type === "performerCard" || module.type === "castList" || module.type === "castCards";
    if (isPerformer && !Array.isArray(module.data.cast)) {
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
    /* performerCard 拆分落位：卡片模板 → castCards，其余 → castList */
    if (module.type === "performerCard") {
      module.type = migrateLegacyModuleType(module.type, module.data);
    }
    return module;
  }
  /* 草稿资源上限：草稿 JSON 会在社区互传，属于不可信输入。
     上限远超正常使用（正常长条 ≤ 20 屏 / ≤ 120 板块），只为阻断恶意超大草稿导致浏览器冻结。 */
  const DRAFT_LIMITS = Object.freeze({
    maxFileSize: 64 * 1024 * 1024,
    maxPages: 200,
    maxModulesPerPage: 300,
    maxModulesTotal: 3000,
    maxStringLength: 50000,
    maxDataUrlLength: 32 * 1024 * 1024,
    maxDepth: 64,
  });
  /* BB-R02：保存端与导入端共用同一常量（上方 DRAFT_LIMITS），保存前按最终 JSON 字节数校验，
     确保工具导出的每一份草稿都能被同版本工具重新导入（导入端 loadDraft 用同一 maxFileSize 拒收）。 */
  function assertNoBlobUrls(value, path, findings) {
    if (typeof value === "string") {
      if (value.indexOf("blob:") === 0) findings.push({ path: path, url: value });
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) assertNoBlobUrls(value[i], path + "[" + i + "]", findings);
      return;
    }
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) { assertNoBlobUrls(value[key], path + "." + key, findings); });
    }
  }
  /* 按体积降序收集草稿内嵌图片资源（超限提示用：显示主要超限资源清单） */
  function collectDraftImageSizes(value, path, out) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) collectDraftImageSizes(value[i], path + "[" + i + "]", out);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.url === "string" && value.url.indexOf("data:") === 0 && typeof value.name === "string") {
      out.push({ path: path, name: value.name || "未命名图片", bytes: value.url.length });
      return;
    }
    Object.keys(value).forEach(function (key) { collectDraftImageSizes(value[key], path + "." + key, out); });
  }
  function formatBytes(bytes) {
    return U.formatBytes(bytes);
  }
  function assertDraftLimits(value, depth, parentKey) {
    if (depth > DRAFT_LIMITS.maxDepth) throw new Error("草稿数据嵌套过深");
    if (typeof value === "string") {
      /* data: URL 是草稿导出时的图片内嵌载荷（「我的模板」snapshotData 同款格式），
         正常头像/照片单条可达数 MB，不属于异常文本；只对 url 字段豁免，其余仍严格限长 */
      if (parentKey === "url" && value.indexOf("data:") === 0) {
        if (value.length > DRAFT_LIMITS.maxDataUrlLength) throw new Error("草稿包含异常大的内嵌图片（超过 " + Math.round(DRAFT_LIMITS.maxDataUrlLength / 1024 / 1024) + "MB），疑似损坏或恶意文件");
        return;
      }
      if (value.length > DRAFT_LIMITS.maxStringLength) throw new Error("草稿包含异常长的文本（超过 " + DRAFT_LIMITS.maxStringLength + " 字），疑似损坏或恶意文件");
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) assertDraftLimits(value[i], depth + 1, parentKey);
      return;
    }
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) { assertDraftLimits(value[key], depth + 1, key); });
    }
  }
  function validateDraftThemeDefinition(definition, themeId) {
    if (definition == null) return null;
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("草稿主题定义必须是 JSON 对象");
    if (!themeId || definition.id !== themeId) throw new Error("草稿主题定义与当前主题 ID 不一致");
    const importer = global.BannerBuilderThemeImporter;
    if (importer && typeof importer.validate === "function") {
      const errors = importer.validate(definition);
      if (errors.length) throw new Error("草稿主题定义无效：" + errors.join("；"));
    } else {
      ["label", "primary", "primaryDark", "primarySoft", "accent", "accentSoft", "line", "soft"].forEach(function (key) {
        if (typeof definition[key] !== "string" || !definition[key]) throw new Error("草稿主题定义缺少字段：" + key);
      });
    }
    return JSON.parse(JSON.stringify(definition));
  }
  /* ===== 草稿版本门禁与显式迁移（BB-R06） =====
     CURRENT_DRAFT_VERSION：当前导出的草稿结构版本；MIN_SUPPORTED_DRAFT_VERSION：仍可恢复的最老版本。
     未来版本（> 当前）与非法版本（非整数 / 负数 / 0）一律拒绝，不做猜测式降级。 */
  const CURRENT_DRAFT_VERSION = 3;
  const MIN_SUPPORTED_DRAFT_VERSION = 1;
  function assertDraftVersion(version) {
    if (typeof version !== "number" || !Number.isInteger(version)) throw new Error("草稿版本号必须是整数（收到：" + String(version) + "）");
    if (version <= 0) throw new Error("草稿版本号必须是正整数（收到：" + version + "）");
    if (version > CURRENT_DRAFT_VERSION) throw new Error("草稿来自更新版本的工具（版本 " + version + " > 当前支持 " + CURRENT_DRAFT_VERSION + "），请升级本工具后再导入");
  }
  /* v1 → v2：v1 草稿没有 version 字段（按 1 处理），结构上与 v2 相同（pages/modules），
     差异仅在旧类型 key（performerCard），由 migrateLegacyModuleType 在模块构造时迁移。 */
  function migrateDraftV1ToV2(draft) {
    draft.version = 2;
    return draft;
  }
  /* v2 → v3：v3 起草稿内嵌完整主题定义 themeDefinition，v2 只有主题 ID。
     主题定义缺失时按当前浏览器主题清单补齐（复制后改 id，不突变共享主题对象）；
     主题不存在或无主题时保持 null（沿用既有降级提示路径）。 */
  function migrateDraftV2ToV3(draft) {
    if (draft.themeDefinition == null) {
      const importer = global.BannerBuilderThemeImporter;
      let definition = null;
      if (typeof draft.theme === "string" && draft.theme) {
        if (importer && typeof importer.loadAll === "function") {
          definition = importer.loadAll().filter(function (theme) { return theme && theme.id === draft.theme; })[0] || null;
        }
        if (!definition && C.themeStyle) {
          const style = C.themeStyle(draft.theme);
          if (style) {
            definition = JSON.parse(JSON.stringify(style));
            definition.id = draft.theme;
          }
        }
      }
      draft.themeDefinition = definition;
    }
    draft.version = 3;
    return draft;
  }
  function migrateDraft(parsed) {
    let draft = parsed;
    const version = draft.version == null ? 1 : draft.version;
    assertDraftVersion(version);
    if (version < MIN_SUPPORTED_DRAFT_VERSION) throw new Error("草稿版本过老（" + version + "），低于最低支持版本 " + MIN_SUPPORTED_DRAFT_VERSION);
    if (version === 1) draft = migrateDraftV1ToV2(draft);
    if (draft.version === 2) draft = migrateDraftV2ToV3(draft);
    if (draft.version !== CURRENT_DRAFT_VERSION) throw new Error("草稿迁移后版本异常（" + String(draft.version) + "）");
    return draft;
  }
  /* ===== themeOverrides 白名单校验（BB-R05）：与 AI 整份主题 / 手动微调共用同一 schema =====
     schema 唯一来源是 BannerBuilderAiDocument 的主题字段表；草稿导入复用同一规则。
     注意语义差异：AI 协议的 themeOverrides 是完整主题（基础色必填），草稿的
     themeOverrides 是增量覆盖（只存用户手动改过的字段）。因此这里做「部分覆盖校验」：
     只校验存在的键（hex 格式 / 枚举值 / 数值范围步进 / 字重档位），不要求必填；
     白名单复制而不是深拷贝原对象，杜绝 __proto__ / prototype / constructor / 未知字段。 */
  /* ===== 图案背景记录白名单校验（Task #18）：草稿/AI 共用 =====
     合法形态：{ type:"parametric", params:{引擎 normalize 可接受的任意子集}, presetId? }。
     params 经引擎 normalize 全量归一化（数值钳制/枚举回退/颜色规整），任何异常返回 null
     （草稿宽容策略：背景记录非法不拒绝整份草稿，仅丢弃背景）。 */
  function sanitizeDraftBackground(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (raw.type !== "parametric" || !raw.params || typeof raw.params !== "object" || Array.isArray(raw.params)) return null;
    const engine = BG();
    if (!engine) return null;
    try {
      const params = engine.normalize(raw.params);
      const out = { type: "parametric", params: params };
      if (typeof raw.presetId === "string" && raw.presetId) out.presetId = raw.presetId;
      if (raw.themeLocked === true) out.themeLocked = true;
      return out;
    } catch (error) { return null; }
  }

  function sanitizeThemeOverrides(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const AD = global.BannerBuilderAiDocument;
    const schema = AD && AD.THEME_OVERRIDE_SCHEMA;
    const out = {};
    if (!schema) return out; /* schema 未加载时保守返回空覆盖（不应发生：ai-document 先于本文件加载） */
    Object.keys(raw).forEach(function (key) {
      if (schema.allowedKeys.indexOf(key) < 0) return; /* 未知/危险键直接丢弃，不报错（宽容恢复） */
      const value = raw[key];
      if (schema.baseColors.indexOf(key) >= 0 || schema.extraColors.indexOf(key) >= 0) {
        if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) out[key] = value.trim().toLowerCase();
        return;
      }
      if (schema.enums[key]) {
        if (typeof value === "string" && schema.enums[key].indexOf(value) >= 0) out[key] = value;
        return;
      }
      const spec = schema.numbers[key];
      if (spec) {
        if (typeof value === "number" && isFinite(value) && value >= spec.min && value <= spec.max) out[key] = value;
        return;
      }
      if (key === "headingWeight" || key === "bodyWeight") {
        if (schema.weights.indexOf(value) >= 0) out[key] = value;
      }
    });
    return out;
  }
  /* ===== 模块数据 schema 校验 + 规范化（BB-R01）：草稿宽容策略 =====
     草稿是用户自己的备份，允许保留历史内部字段（如 padding），因此：
     - 已知字段：按 Registry schema 严格校验类型/范围/枚举/数组形状，不合格即拒绝；
     - 未知字段：保留（历史内部字段），但同样受 DRAFT_LIMITS 深度/长度约束；
     - 图片字段：接受 {url, name, type} 记录（url 限 data:/blob:），拒绝远程 URL。
     与社区模块导入（严格拒绝未知字段）策略不同，两者不要混用。 */
  function normalizeDraftModuleData(def, typeKey, rawData, where) {
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
      throw new Error(where + "：data 必须是对象");
    }
    const AD = global.BannerBuilderAiDocument;
    if (AD && typeof AD.validateDataFields === "function") {
      const errors = [];
      const err = function (path, code, message) { errors.push({ path: path, code: code, message: message }); };
      AD.validateDataFields(def, typeKey, rawData, where, err, 0, { allowUnknownFields: true, allowImageRecords: true });
      if (errors.length) throw new Error(errors[0].path + "：" + errors[0].message);
    }
    return rawData;
  }
  function buildDraftCandidate(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("草稿必须是 JSON 对对象");
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) throw new Error("草稿缺少页面数据（pages 必须是非空数组）");
    if (parsed.pages.length > DRAFT_LIMITS.maxPages) throw new Error("草稿屏数超过 " + DRAFT_LIMITS.maxPages + " 屏，疑似损坏或恶意文件");
    if (parsed.name != null && (typeof parsed.name !== "string" || parsed.name.length > 200)) throw new Error("草稿名称异常");
    try { assertDraftLimits(parsed, 0, ""); } catch (error) { throw new Error((error && error.message) || error); }
    /* BB-R06：版本门禁 + 显式迁移（v1→v2→v3），迁移在结构校验前完成 */
    const draft = migrateDraft(parsed);
    const embeddedTheme = validateDraftThemeDefinition(draft.themeDefinition, draft.theme);
    /* v1/v2 旧草稿没有主题定义时仍按当前主题清单判定；v3 自带定义时可独立恢复。 */
    const themeKeys = C.getThemeOptions().map(function (o) { return o.value; });
    const themeKnown = !!embeddedTheme || !draft.theme || themeKeys.indexOf(draft.theme) >= 0;
    const candidate = M.createDoc(C.CANVAS_PRESETS[draft.ratio] ? draft.ratio : C.DEFAULT_RATIO);
    if (typeof draft.name === "string" && draft.name.trim()) candidate.name = draft.name;
    if (draft.screenMode === "continuous" || draft.screenMode === "split") candidate.screenMode = draft.screenMode;
    if (typeof draft.theme === "string" && draft.theme) candidate.theme = draft.theme;
    candidate.themeDefinition = embeddedTheme;
    candidate.version = CURRENT_DRAFT_VERSION;
    ["fontFamily", "headingFont", "bodyFont"].forEach(function (key) {
      if (typeof draft[key] === "string") candidate[key] = draft[key];
    });
    if (draft.fontManual === true) candidate.fontManual = true;
    /* BB-R13：字体缺失不拒绝草稿——字体 key 只要求是字符串；是否缺失在应用成功后
       由 showMissingFontMapper 检测（等待 IndexedDB bootstrap 完成），用户可映射替代字体。
       主题定义中的推荐字体同样不参与拒绝（validateDraftThemeDefinition 不校验字体 key）。 */
    if (typeof draft.backgroundColor === "string" && draft.backgroundColor) candidate.backgroundColor = draft.backgroundColor;
    if (draft.backgroundImage && typeof draft.backgroundImage === "object" && typeof draft.backgroundImage.url === "string") {
      candidate.backgroundImage = { url: draft.backgroundImage.url, name: draft.backgroundImage.name || "", type: draft.backgroundImage.type || "" };
    }
    /* Task #18：图案背景记录（type/params/presetId）经引擎 normalize 白名单化后恢复 */
    candidate.background = sanitizeDraftBackground(draft.background);
    candidate.exportScale = draft.exportScale === 1 || draft.exportScale === 3 ? draft.exportScale : 2;
    candidate.__themeKnown = themeKnown;
    /* BB-R05：themeOverrides 白名单校验 + 规范化复制（拒绝 __proto__/未知字段/超范围数值） */
    candidate.themeOverrides = sanitizeThemeOverrides(draft.themeOverrides);
    /* BB-R07：页面/模块 ID 全局唯一。缺失 ID 自动补齐（历史草稿常见），显式重复 ID 拒绝（疑似损坏）。 */
    const usedIds = new Set();
    const claimId = function (rawId, fallback, where) {
      if (typeof rawId === "string" && rawId) {
        if (usedIds.has(rawId)) throw new Error(where + " 的 ID「" + rawId + "」与其他页面或板块重复，疑似损坏草稿");
        usedIds.add(rawId);
        return rawId;
      }
      let id = fallback;
      while (usedIds.has(id)) id = C.uid();
      usedIds.add(id);
      return id;
    };
    candidate.pages = draft.pages.map(function (rawPage, pi) {
      if (!rawPage || typeof rawPage !== "object" || Array.isArray(rawPage)) throw new Error("第 " + (pi + 1) + " 屏数据不正确");
      const page = M.createPage();
      page.id = claimId(rawPage.id, C.uid(), "第 " + (pi + 1) + " 屏");
      if (typeof rawPage.name === "string" && rawPage.name) page.name = rawPage.name;
      if (typeof rawPage.backgroundColor === "string") page.backgroundColor = rawPage.backgroundColor;
      if (rawPage.backgroundImage && typeof rawPage.backgroundImage === "object" && typeof rawPage.backgroundImage.url === "string") {
        page.backgroundImage = { url: rawPage.backgroundImage.url, name: rawPage.backgroundImage.name || "", type: rawPage.backgroundImage.type || "" };
      }
      page.background = sanitizeDraftBackground(rawPage.background);
      if (!Array.isArray(rawPage.modules)) throw new Error("第 " + (pi + 1) + " 屏缺少板块数组");
      if (rawPage.modules.length > DRAFT_LIMITS.maxModulesPerPage) throw new Error("第 " + (pi + 1) + " 屏板块数超过 " + DRAFT_LIMITS.maxModulesPerPage + " 个，疑似损坏或恶意文件");
      page.modules = rawPage.modules.map(function (rawModule, mi) {
        if (!rawModule || typeof rawModule !== "object") throw new Error("第 " + (pi + 1) + " 屏第 " + (mi + 1) + " 个板块数据不正确");
        const typeKey = migrateLegacyModuleType(rawModule.type, rawModule.data);
        if (!typeKey || !R.getDef(typeKey)) throw new Error("第 " + (pi + 1) + " 屏第 " + (mi + 1) + " 个板块类型无效：" + String(rawModule.type));
        const module = M.createModule(typeKey);
        module.id = claimId(rawModule.id, C.uid(), "第 " + (pi + 1) + " 屏第 " + (mi + 1) + " 个板块");
        module.visible = rawModule.visible === false ? false : true;
        /* BB-R01：先迁移旧结构，再按 schema 校验已知字段形状（宽容保留历史内部字段） */
        if (rawModule.data && typeof rawModule.data === "object" && !Array.isArray(rawModule.data)) module.data = rawModule.data;
        migrateModuleData(module);
        normalizeDraftModuleData(R.getDef(module.type), module.type, module.data, "第 " + (pi + 1) + " 屏第 " + (mi + 1) + " 个板块");
        return module;
      });
      return page;
    });
    if (candidate.pages.reduce(function (sum, page) { return sum + page.modules.length; }, 0) > DRAFT_LIMITS.maxModulesTotal) {
      throw new Error("草稿板块总数超过 " + DRAFT_LIMITS.maxModulesTotal + " 个，疑似损坏或恶意文件");
    }
    return candidate;
  }

  global.BannerBuilderDraft = Object.freeze({
    DRAFT_LIMITS: DRAFT_LIMITS,
    CURRENT_DRAFT_VERSION: CURRENT_DRAFT_VERSION,
    MIN_SUPPORTED_DRAFT_VERSION: MIN_SUPPORTED_DRAFT_VERSION,
    buildDraftPayload: buildDraftPayload,
    buildDraftCandidate: buildDraftCandidate,
    collectFontDependencies: collectFontDependencies,
    restoreDraftImages: restoreDraftImages,
    dataUrlToBlobRecord: dataUrlToBlobRecord,
    migrateLegacyModuleType: migrateLegacyModuleType,
    migrateModuleData: migrateModuleData,
    assertDraftVersion: assertDraftVersion,
    assertDraftLimits: assertDraftLimits,
    assertNoBlobUrls: assertNoBlobUrls,
    collectDraftImageSizes: collectDraftImageSizes,
    validateDraftThemeDefinition: validateDraftThemeDefinition,
    sanitizeDraftBackground: sanitizeDraftBackground,
    sanitizeThemeOverrides: sanitizeThemeOverrides,
    normalizeDraftModuleData: normalizeDraftModuleData,
    migrateDraftV1ToV2: migrateDraftV1ToV2,
    migrateDraftV2ToV3: migrateDraftV2ToV3,
    migrateDraft: migrateDraft,
    formatBytes: formatBytes,
  });
})(window);

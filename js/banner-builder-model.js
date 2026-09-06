(function (global) {
  "use strict";

  const C = global.BannerBuilderConstants;
  const R = global.BannerBuilderRegistry;

  function imageValue() {
    return null;
  }

  function createPage() {
    return {
      id: C.uid(),
      name: "未命名页面",
      modules: [],
      backgroundColor: "",
      backgroundImage: imageValue(),
    };
  }

  function createDoc(ratio) {
    return {
      version: 2,
      name: "Only 活动宣传长条",
      ratio: C.CANVAS_PRESETS[ratio] ? ratio : C.DEFAULT_RATIO,
      theme: "forest",
      fontFamily: "sans",
      screenMode: "split",
      backgroundColor: "#ffffff",
      backgroundImage: imageValue(),
      pages: [createPage()],
    };
  }

  function createModule(type) {
    const def = R.getDef(type);
    if (!def) return null;
    return {
      id: C.uid(),
      type: type,
      visible: true,
      data: def.createDefault(),
    };
  }

  function findPage(doc, pageId) {
    return (doc.pages || []).filter(function (page) { return page.id === pageId; })[0] || null;
  }

  function findModule(doc, moduleId) {
    const pages = doc.pages || [];
    for (let p = 0; p < pages.length; p += 1) {
      const modules = pages[p].modules || [];
      for (let m = 0; m < modules.length; m += 1) {
        if (modules[m].id === moduleId) return { page: pages[p], pageIndex: p, module: modules[m], index: m };
      }
    }
    return { page: null, pageIndex: -1, module: null, index: -1 };
  }

  function addPage(doc) {
    const page = createPage();
    doc.pages.push(page);
    return page;
  }

  function removePage(doc, pageId) {
    const pages = doc.pages || [];
    const index = pages.findIndex(function (page) { return page.id === pageId; });
    if (index < 0) return false;
    pages.splice(index, 1);
    if (!pages.length) pages.push(createPage());
    return true;
  }

  function addModule(doc, pageId, type) {
    const module = createModule(type);
    const page = findPage(doc, pageId) || doc.pages[doc.pages.length - 1];
    if (!module || !page) return null;
    page.modules.push(module);
    return module;
  }

  function removeModule(doc, moduleId) {
    const hit = findModule(doc, moduleId);
    if (!hit.module) return false;
    hit.page.modules.splice(hit.index, 1);
    return true;
  }

  function moveModule(doc, moduleId, offset) {
    const hit = findModule(doc, moduleId);
    const target = hit.index + offset;
    if (!hit.module || target < 0 || target >= hit.page.modules.length) return false;
    const moved = hit.page.modules.splice(hit.index, 1)[0];
    hit.page.modules.splice(target, 0, moved);
    return true;
  }

  function countModules(doc) {
    return (doc.pages || []).reduce(function (sum, page) { return sum + (page.modules || []).length; }, 0);
  }

  function moduleWidth(module) {
    return module && module.data && module.data.width === "half" ? "half" : "full";
  }

  function packModuleRows(modules) {
    const rows = [];
    const list = modules || [];
    for (let i = 0; i < list.length; i += 1) {
      const current = list[i];
      const next = list[i + 1];
      if (moduleWidth(current) === "half" && next && moduleWidth(next) === "half") {
        rows.push({ kind: "pair", modules: [current, next] });
        i += 1;
      } else rows.push({ kind: "single", modules: [current] });
    }
    return rows;
  }

  function toJSON(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  global.BannerBuilderModel = Object.freeze({
    createDoc,
    createPage,
    createModule,
    findPage,
    findModule,
    addPage,
    removePage,
    addModule,
    removeModule,
    moveModule,
    countModules,
    moduleWidth,
    packModuleRows,
    toJSON,
  });
})(window);

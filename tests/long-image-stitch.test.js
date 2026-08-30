const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
vm.runInContext(fs.readFileSync("js/long-image-layout.js", "utf8"), vm.createContext({ window }));
const api = window.LongImageLayout;

const first = { id: "first", width: 1000, height: 2000 };
const second = { id: "second", width: 500, height: 500 };

const vertical = api.calculate([first, second], "vertical");
assert.equal(vertical.width, 500, "竖向拼接应统一到最小宽度，避免放大图片");
assert.equal(vertical.height, 1500);
assert.deepEqual(vertical.placements.map(item => [item.item.id, item.x, item.y, item.width, item.height]), [
  ["first", 0, 0, 500, 1000],
  ["second", 0, 1000, 500, 500]
]);

const horizontal = api.calculate([first, second], "horizontal");
assert.equal(horizontal.width, 750, "横向拼接应统一到最小高度");
assert.equal(horizontal.height, 500);
assert.deepEqual(horizontal.placements.map(item => item.item.id), ["first", "second"], "输出必须保持点按后的传入顺序");
const drawCalls = [];
first.image = { key: "first-image" };
api.drawPlacement({ drawImage(...args) { drawCalls.push(args); } }, vertical.placements[0]);
assert.deepEqual(drawCalls[0], [first.image, 0, 0, 500, 1000], "Canvas 必须按计算后的目标位置和尺寸绘制图片");

const huge = api.calculate(Array.from({ length: 30 }, (_, index) => ({ id: index, width: 4000, height: 4000 })), "vertical");
assert.ok(huge.width <= api.MAX_OUTPUT_EDGE && huge.height <= api.MAX_OUTPUT_EDGE, "超长图不得超过手机安全边长");
assert.ok(huge.width * huge.height <= api.MAX_OUTPUT_PIXELS, "超长图不得超过手机安全像素面积");
assert.equal(huge.wasReduced, true);

const customVertical = api.calculate([first, second], "vertical", 2000);
assert.equal(customVertical.width, 2000, "竖向拼接应使用用户设置的输出宽度");
assert.equal(customVertical.height, 6000);
assert.deepEqual(customVertical.placements.map(item => [item.item.id, item.width, item.height]), [
  ["first", 2000, 4000],
  ["second", 2000, 2000]
], "用户指定宽度后每张图应按比例放大到该宽度");
assert.equal(customVertical.enlarged, true, "超过自动基准宽度时应标记为放大输出");

const customHorizontal = api.calculate([first, second], "horizontal", 1000);
assert.equal(customHorizontal.width, 1500, "横向拼接应使用用户设置的输出高度");
assert.equal(customHorizontal.height, 1000);

const customLimited = api.calculate(Array.from({ length: 30 }, (_, index) => ({ id: index, width: 4000, height: 4000 })), "vertical", 4000);
assert.equal(customLimited.width, 4000, "手动设置宽度时必须强制按用户值输出，不自动缩小");
assert.equal(customLimited.height, 120000);
assert.equal(customLimited.userCross, 4000);
assert.equal(customLimited.wasReduced, false, "手动设置时不触发自动缩小兜底");

const doubledAuto = api.calculate([first, second], "vertical", 0, 2);
assert.equal(doubledAuto.width, 1000, "自动基准（最小宽度 500）× 倍率 2 应输出 1000px");
assert.equal(doubledAuto.height, 3000);
assert.equal(doubledAuto.multiplier, 2);
const doubledManual = api.calculate([first, second], "vertical", 2000, 3);
assert.equal(doubledManual.width, 6000, "手动宽度 2000 × 倍率 3 应输出 6000px");
assert.equal(doubledManual.height, 18000);
assert.equal(api.calculate([first, second], "vertical", 2000, 1).width, 2000, "倍率 1 应与原行为完全一致");
assert.equal(api.calculate([first, second], "vertical", 2000, 0).width, 2000, "倍率无效值应回退为 1");

const shrunkDoubled = api.calculate(Array.from({ length: 30 }, (_, index) => ({ id: index, width: 4000, height: 4000 })), "vertical", 0, 2);
assert.equal(shrunkDoubled.width, 1066, "自动缩小后的基准（533）再乘倍率 2，不得被二次缩小覆盖");
assert.equal(shrunkDoubled.height, 31980);
assert.equal(shrunkDoubled.wasReduced, false, "倍率非 1 时不再标记为安全缩小");

assert.equal(api.calculate([first], "vertical"), null, "至少需要两张图片");

let tapOrder = api.toggleOrder([], "second");
tapOrder = api.toggleOrder(tapOrder, "first");
assert.deepEqual(tapOrder, ["second", "first"], "点按顺序必须直接成为拼接顺序");
tapOrder = api.toggleOrder(tapOrder, "second");
assert.deepEqual(tapOrder, ["first"], "再次点按已编号图片应取消并自动压缩编号");

const html = fs.readFileSync("tools/long-image-stitch.html", "utf8");
const js = fs.readFileSync("js/long-image-stitch.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
assert.match(html, /type="file"[^>]*accept="image\/\*"[^>]*multiple/i, "选择器必须支持手机相册多选");
assert.match(html, /id="verticalBtn"/);
assert.match(html, /id="horizontalBtn"/);
assert.match(html, /id="sortBtn"/);
assert.match(html, /id="downloadLink"/);
assert.match(html, /id="zoomRange"[^>]*min="25"[^>]*max="400"/, "结果区必须提供 25% 到 400% 的缩放滑杆");
assert.match(html, /id="fitWidthBtn"/, "结果区必须提供适应宽度按钮");
assert.match(html, /id="compressToggle"/, "设置区必须提供压缩输出开关");
assert.match(html, /id="compressLightBtn"/, "压缩强度必须提供轻度档");
assert.match(html, /id="multiplierInput"[^>]*value="1"/, "输出尺寸旁必须提供默认 1 的倍率输入框");
assert.match(html, /id="uploadList"/, "图片列表必须放置在添加图片容器内");
assert.ok(html.indexOf("upload-panel") < html.indexOf('id="uploadList"') && html.indexOf('id="uploadList"') < html.indexOf('id="imageGrid"'), "添加图片后列表与排序操作必须保留在上方的添加图片容器里");
assert.doesNotMatch(html, /sequence-panel/, "图片列表移入添加图片容器后不应保留独立顺序面板");
assert.ok(html.indexOf("mobile-image-upload.js") < html.indexOf("long-image-stitch.js"), "统一图片兼容层必须先加载");
assert.ok(html.indexOf("long-image-compress.js") < html.indexOf("long-image-stitch.js"), "压缩模块必须先于主逻辑加载");
assert.ok(html.indexOf("vendor/pako.min.js") < html.indexOf("vendor/upng.js") && html.indexOf("vendor/upng.js") < html.indexOf("long-image-compress.js"), "量化依赖 pako 与 UPNG 必须先于压缩模块加载");
assert.match(js, /toggleOrder\(state\.order, id\)/, "点按图片必须调用经过测试的排序逻辑");
assert.match(js, /MAX_IMAGES = 30/, "应限制手机端同时保留的图片数量");
assert.doesNotMatch(js, /FormData|XMLHttpRequest|fetch\(/, "图片不得上传服务器");
assert.match(index, /href="\.\/tools\/long-image-stitch\.html"/, "首页必须提供长图拼接入口");

class MockElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = "";
    this.classList = {
      values: new Set(),
      add: name => this.classList.values.add(name),
      remove: name => this.classList.values.delete(name),
      toggle: (name, force) => force === undefined
        ? (this.classList.values.has(name) ? !this.classList.values.delete(name) : Boolean(this.classList.values.add(name)))
        : (force ? Boolean(this.classList.values.add(name)) : !this.classList.values.delete(name))
    };
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.textContent = "";
    this.value = "";
    this.files = [];
    this.style = {};
    this.clientWidth = 720;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  async dispatch(type, init = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() {}, ...init };
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  scrollIntoView() {}
}

  const integrationDrawCalls = [];
  class MockCanvas extends MockElement {
    constructor() {
      super("canvas");
      this.width = 0;
      this.height = 0;
      this.context = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        drawImage(...args) { integrationDrawCalls.push(args); },
        getImageData(x, y, w, h) { return { data: new Uint8Array(Math.max(0, w) * Math.max(0, h) * 4) }; }
      };
    }
    getContext() { return this.context; }
    toBlob(callback, type) {
      this.snapshot = { width: this.width, height: this.height };
      queueMicrotask(() => callback(new Blob(["png"], { type })));
    }
  }

async function runIntegration() {
  const ids = ["fileInput", "dropzone", "loadStatus", "uploadList", "verticalBtn", "horizontalBtn", "crossSizeInput", "crossSizeLabel", "multiplierInput", "sizeClearBtn", "sizeHint", "compressToggle", "compressLevels", "compressLightBtn", "compressMediumBtn", "compressHighBtn", "dimensionReadout", "generateBtn", "generateStatus", "sortHelp", "sortBtn", "resetOrderBtn", "clearAllBtn", "imageGrid", "resultPanel", "resultMeta", "resultViewport", "resultImage", "downloadLink", "zoomOutBtn", "zoomRange", "zoomInBtn", "zoomValue", "fitWidthBtn"];
  const elements = Object.fromEntries(ids.map(id => [id, new MockElement(id === "fileInput" ? "input" : "div", id)]));
  const createdCanvases = [];
  const document = {
    getElementById(id) { return elements[id]; },
    createElement(tagName) {
      const element = tagName === "canvas" ? new MockCanvas() : new MockElement(tagName);
      if (tagName === "canvas") createdCanvases.push(element);
      return element;
    }
  };
  let nextUrl = 1;
  const mockUrl = {
    createObjectURL() { return `blob:integration-${nextUrl++}`; },
    revokeObjectURL() {}
  };
  const integrationWindow = { addEventListener() {} };
  const compressCalls = [];
  const quantizeCalls = [];
  const longImageCompress = {
    async compress(blob, levelName) {
      compressCalls.push(levelName);
      return new Blob(["p"], { type: "image/png" });
    },
    async quantize(rgba, width, height, colors, dither) {
      quantizeCalls.push({ width, height, colors, dither, bytes: rgba.byteLength });
      return new Blob(["q"], { type: "image/png" });
    },
    errorMessage() { return "mock compress error"; },
    LEVELS: { light: 1, medium: 3, high: 4 }
  };
  const mobileImageUpload = {
    async open(file) {
      const image = { naturalWidth: file.width, naturalHeight: file.height, key: file.name };
      return { image, src: mockUrl.createObjectURL(file), release() {} };
    },
    errorMessage(error) { return error ? error.message : "读取失败"; }
  };
  let frameId = 1;
  const context = vm.createContext({
    Blob,
    console,
    document,
    LongImageCompress: longImageCompress,
    LongImageLayout: api,
    Map,
    MobileImageUpload: mobileImageUpload,
    requestAnimationFrame(callback) { const id = frameId++; setTimeout(() => callback(Date.now()), 0); return id; },
    setTimeout,
    URL: mockUrl,
    window: integrationWindow
  });
  vm.runInContext(js, context, { filename: "long-image-stitch.js" });

  elements.fileInput.files = [
    { name: "first.png", width: 1000, height: 2000 },
    { name: "second.png", width: 500, height: 500 },
    { name: "third.png", width: 800, height: 400 }
  ];
  await elements.fileInput.dispatch("change");
  await waitUntil(() => /当前共 3 张/.test(elements.loadStatus.textContent));
  assert.equal(elements.imageGrid.children.length, 3, "多选的三张图片必须全部显示在添加图片容器内");
  assert.equal(elements.uploadList.hidden, false, "添加图片后列表区必须可见");
  assert.equal(elements.generateBtn.disabled, false, "默认添加顺序应可直接生成");

  await elements.sortBtn.dispatch("click");
  await elements.imageGrid.children[1].children[0].dispatch("click");
  await elements.imageGrid.children[0].children[0].dispatch("click");
  await elements.imageGrid.children[2].children[0].dispatch("click");
  const firstSortedName = elements.imageGrid.children[0].children[0].children[1].children[0].textContent;
  assert.equal(firstSortedName, "second.png", "完成点按后卡片和输出顺序都应更新");

  await elements.horizontalBtn.dispatch("click");
  assert.equal(elements.horizontalBtn.attributes.get("aria-pressed"), "true", "横向拼接按钮必须切换成功");
  assert.equal(elements.crossSizeLabel.textContent, "输出高度", "横向拼接时尺寸输入框应切换为输出高度");
  elements.crossSizeInput.value = "1200";
  await elements.crossSizeInput.dispatch("input");
  await elements.generateBtn.dispatch("click");
  assert.equal(integrationDrawCalls.length, 3, "生成时必须按顺序绘制全部图片");
  const lastCanvas = createdCanvases[createdCanvases.length - 1];
  assert.equal(lastCanvas.snapshot.width, 4200, "横向拼接应按用户设置的高度 1200px 输出");
  assert.equal(lastCanvas.snapshot.height, 1200, "横向拼接的输出高度应等于用户设置值");
  assert.equal(elements.resultPanel.hidden, false, "生成完成后必须显示结果区");
  assert.match(elements.downloadLink.href, /^blob:integration-/, "下载按钮必须指向本地生成的 Blob");
  assert.match(elements.downloadLink.download, /horizontal\.png$/, "横向结果应使用对应文件名");
  await elements.zoomInBtn.dispatch("click");
  assert.equal(elements.zoomValue.textContent, "125%", "放大按钮应按 25% 步进更新预览");
  assert.equal(elements.resultImage.style.width, "865px", "放大应改变预览图片宽度而不重新生成文件");
  await elements.fitWidthBtn.dispatch("click");
  assert.equal(elements.zoomValue.textContent, "100%", "适应宽度应恢复到 100%");
  elements.zoomRange.value = "400";
  await elements.zoomRange.dispatch("input");
  assert.equal(elements.zoomInBtn.disabled, true, "达到 400% 后应禁用继续放大");

  assert.equal(compressCalls.length, 0, "默认关闭压缩时生成不得调用压缩");
  assert.equal(elements.compressLevels.hidden, true, "默认关闭压缩时强度选择应隐藏");
  elements.compressToggle.checked = true;
  await elements.compressToggle.dispatch("change");
  assert.equal(elements.compressLevels.hidden, false, "开启压缩后应显示强度选择");
  const canvasesBefore = createdCanvases.length;
  await elements.generateBtn.dispatch("click");
  const canvases = createdCanvases.slice(canvasesBefore);
  assert.equal(canvases.length, 1, "中度有损应只创建主画布，不创建缩放画布");
  assert.equal(canvases[0].snapshot.width, 4200, "中度有损输出宽度必须保持 4200px 不变");
  assert.equal(canvases[0].snapshot.height, 1200, "中度有损输出高度必须保持 1200px 不变");
  assert.equal(quantizeCalls.length, 1, "中度有损应调用颜色量化");
  assert.equal(quantizeCalls[0].width, 4200, "量化应使用拼接原始宽度，不缩放");
  assert.equal(quantizeCalls[0].height, 1200, "量化应使用拼接原始高度，不缩放");
  assert.equal(quantizeCalls[0].colors, 256, "中度应量化到 256 色");
  assert.deepEqual(Array.from(quantizeCalls[0].dither), [1, 1, 1, 0], "中度应使用 RGB 抖动");
  assert.equal(compressCalls.length, 0, "有损档不应调用 oxipng 压缩");
  assert.match(elements.resultMeta.textContent, /有损压缩 256 色/, "结果区应标注有损压缩色数");
  assert.match(elements.resultMeta.textContent, /尺寸不变 4200 × 1200px/, "结果区应标注尺寸不变");
  assert.doesNotMatch(elements.generateStatus.textContent, /压缩失败/, "有损档成功时不应提示失败");

  await elements.compressLightBtn.dispatch("click");
  await elements.generateBtn.dispatch("click");
  assert.equal(compressCalls.length, 1, "轻度无损档应调用 oxipng 压缩");
  assert.equal(compressCalls[0], "high", "无损档应使用 oxipng 最高档");
  assert.equal(quantizeCalls.length, 1, "轻度无损档不应调用颜色量化");
  assert.match(elements.resultMeta.textContent, /无损优化/, "结果区应标注无损优化");
  assert.doesNotMatch(elements.generateStatus.textContent, /压缩失败/, "无损档成功时不应提示失败");

  // 倍率：输出尺寸整体放大（压缩开启时布局尺寸同样跟随倍率）
  elements.multiplierInput.value = "2";
  await elements.multiplierInput.dispatch("input");
  await elements.generateBtn.dispatch("click");
  const multCanvas = createdCanvases[createdCanvases.length - 1];
  assert.equal(multCanvas.snapshot.width, 8400, "倍率 2 应将横向输出宽度放大到 8400px（4200×2）");
  assert.equal(multCanvas.snapshot.height, 2400, "倍率 2 应将横向输出高度放大到 2400px（1200×2）");
  assert.match(elements.dimensionReadout.children[0].textContent, /^8400 × 2400px/, "预览区应显示倍率放大后的输出尺寸");
  assert.match(elements.dimensionReadout.children[1].textContent, /已按 2 倍率放大/, "预览区应标注倍率放大");
  assert.equal(elements.sizeClearBtn.hidden, false, "倍率非 1 时应显示恢复自动按钮");

  // 恢复自动：宽度与倍率都回到默认
  await elements.sizeClearBtn.dispatch("click");
  assert.equal(elements.multiplierInput.value, "1", "恢复自动应把倍率重置为 1");
  assert.equal(elements.crossSizeInput.value, "", "恢复自动应清空宽度输入");
  assert.equal(elements.sizeClearBtn.hidden, true, "恢复自动后按钮应隐藏");
  await elements.generateBtn.dispatch("click");
  const autoCanvas = createdCanvases[createdCanvases.length - 1];
  assert.equal(autoCanvas.snapshot.width, 1400, "恢复自动后应回到最小高度基准（横向输出 1400px）");
  assert.equal(autoCanvas.snapshot.height, 400, "恢复自动后输出高度应为最小高度 400px");
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("integration test timeout");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

runIntegration().then(() => {
  console.log("long image stitch tests: OK");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

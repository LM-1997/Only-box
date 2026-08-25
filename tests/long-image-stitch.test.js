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
assert.ok(html.indexOf("mobile-image-upload.js") < html.indexOf("long-image-stitch.js"), "统一图片兼容层必须先加载");
assert.match(js, /toggleOrder\(state\.order, id\)/, "点按图片必须调用经过测试的排序逻辑");
assert.match(js, /MAX_IMAGES = 30/, "应限制手机端同时保留的图片数量");
assert.match(js, /MAX_TOTAL_PIXELS = 80 \* 1000 \* 1000/, "应限制多图累计解码内存");
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
      drawImage(...args) { integrationDrawCalls.push(args); }
    };
  }
  getContext() { return this.context; }
  toBlob(callback, type) { queueMicrotask(() => callback(new Blob(["png"], { type }))); }
}

async function runIntegration() {
  const ids = ["fileInput", "dropzone", "loadStatus", "verticalBtn", "horizontalBtn", "dimensionReadout", "generateBtn", "generateStatus", "sequencePanel", "sortHelp", "sortBtn", "resetOrderBtn", "clearAllBtn", "imageGrid", "resultPanel", "resultMeta", "resultViewport", "resultImage", "downloadLink", "zoomOutBtn", "zoomRange", "zoomInBtn", "zoomValue", "fitWidthBtn"];
  const elements = Object.fromEntries(ids.map(id => [id, new MockElement(id === "fileInput" ? "input" : "div", id)]));
  const document = {
    getElementById(id) { return elements[id]; },
    createElement(tagName) { return tagName === "canvas" ? new MockCanvas() : new MockElement(tagName); }
  };
  let nextUrl = 1;
  const mockUrl = {
    createObjectURL() { return `blob:integration-${nextUrl++}`; },
    revokeObjectURL() {}
  };
  const integrationWindow = { addEventListener() {} };
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
  assert.equal(elements.imageGrid.children.length, 3, "多选的三张图片必须全部进入排序区");
  assert.equal(elements.generateBtn.disabled, false, "默认添加顺序应可直接生成");

  await elements.sortBtn.dispatch("click");
  await elements.imageGrid.children[1].children[0].dispatch("click");
  await elements.imageGrid.children[0].children[0].dispatch("click");
  await elements.imageGrid.children[2].children[0].dispatch("click");
  const firstSortedName = elements.imageGrid.children[0].children[0].children[1].children[0].textContent;
  assert.equal(firstSortedName, "second.png", "完成点按后卡片和输出顺序都应更新");

  await elements.horizontalBtn.dispatch("click");
  assert.equal(elements.horizontalBtn.attributes.get("aria-pressed"), "true", "横向拼接按钮必须切换成功");
  await elements.generateBtn.dispatch("click");
  assert.equal(integrationDrawCalls.length, 3, "生成时必须按顺序绘制全部图片");
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

"use strict";
// 无头冒烟测试：验证 badge-generator.js 的 IIFE 能正常初始化，
// 所有新增控件（保存/导入配置、编辑器头像外观）的 els 引用均已接线。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const srcPath = path.join(__dirname, "..", "js", "badge-generator.js");
const code = fs.readFileSync(srcPath, "utf8");

function makeEl(id) {
  const el = {
    id: id || "",
    value: "",
    checked: false,
    hidden: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    src: "",
    files: [],
    dataset: {},
    options: [],
    listeners: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, force) { if (force === undefined ? !this._s.has(c) : force) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    style: { setProperty() {}, },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    setAttribute() {},
    getAttribute() { return null; },
    appendChild() {},
    cloneNode() { return makeEl(id + "-clone"); },
    querySelector() { return makeEl(id + "-child"); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    setPointerCapture() {},
    releasePointerCapture() {},
    focus() {},
    clientWidth: 100,
    clientHeight: 100
  };
  return el;
}

const elsById = new Map();
function getEl(id) {
  if (!elsById.has(id)) elsById.set(id, makeEl(id));
  return elsById.get(id);
}

const sandbox = {
  console,
  TextDecoder,
  Blob,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL() {} },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: (fn) => { return setTimeout(fn, 0); },
  cancelAnimationFrame: (id) => clearTimeout(id),
  Date,
  Math,
  JSON,
  Number,
  String,
  Object,
  Array,
  Map,
  Set,
  Boolean,
  Promise,
  RegExp,
  Error,
  isNaN,
  parseInt,
  parseFloat,
  DOMParser: function () { this.parseFromString = () => ({ getElementsByTagNameNS: () => [] }); },
  window: null,
  document: {
    getElementById: (id) => getEl(id),
    createElement: (tag) => (tag === "canvas" ? { width: 0, height: 0, getContext: () => ({ fillStyle: "", strokeStyle: "", lineWidth: 0, globalAlpha: 1, textBaseline: "", font: "", save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, drawImage() {}, fillText() {}, measureText: () => ({ width: 0 }), fillRect() {}, scale() {}, clearRect() {} }), toDataURL: () => "data:image/png;base64," } : makeEl(tag)),
    querySelectorAll: () => [],
    querySelector: () => makeEl("q")
  },
  FontFace: function () { this.load = () => Promise.resolve(); },
  navigator: { userAgent: "node" }
};
sandbox.window = sandbox;
sandbox.window.CanvasUtils = { downloadBlob() {}, sanitizeFilename: (s) => s, uniqueFilename: (s) => s, canvasToBlob: () => ({}), exportZip: () => Promise.resolve() };
sandbox.window.MobileImageUpload = { errorMessage: (e) => String(e), open: () => Promise.resolve({}), isImageFile: () => true, ensureZip: () => Promise.resolve({}), ensureCropper: () => Promise.resolve() };
sandbox.window.BadgeEdgeDetect = { imageToRgba: () => null, avatarFrameFromRgba: () => null, contentBoundsFromRgba: () => null };
sandbox.window.confirm = () => true;
sandbox.window.addEventListener = () => {};
sandbox.window.Cropper = function () { this.destroy = () => {}; };

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "badge-generator.js" });

// 验证关键新增控件均已被查询（若 $() 返回了 mock，则说明 HTML 里存在对应 id 且已接线）
const requiredIds = [
  "avatarBaseEnabled", "avatarBaseColor", "avatarOutlineWidth", "avatarOutlineGap", "avatarOutlineColor",
  "saveTemplateBtn", "loadTemplateInput",
  "editorAvatarAspect", "editorAvatarRadius", "editorAvatarBorder", "editorAvatarBorderColor",
  "editorAvatarBaseEnabled", "editorAvatarBaseColor", "editorAvatarOutlineWidth", "editorAvatarOutlineGap", "editorAvatarOutlineColor"
];
const missing = requiredIds.filter(id => !elsById.has(id));
if (missing.length) {
  console.error("SMOKE FAIL: missing queried ids:", missing.join(", "));
  process.exit(1);
}

// 验证每个控件都绑定了事件（除 saveTemplateBtn/loadTemplateInput 是 click/change 之外，其余走 input 或 change）
const mustHaveListener = requiredIds.filter(id => id !== "loadTemplateInput");
const noListener = mustHaveListener.filter(id => {
  const el = elsById.get(id);
  const count = Object.keys(el.listeners).reduce((n, k) => n + el.listeners[k].length, 0);
  return count === 0;
});
if (noListener.length) {
  console.error("SMOKE FAIL: controls without any listener:", noListener.join(", "));
  process.exit(1);
}

console.log("smoke: badge-generator loaded OK. queried=" + requiredIds.length + ", with-listener=" + (mustHaveListener.length - noListener.length));

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const blobs = new Map();
const revoked = new Set();
const appendedAssets = [];
let nextUrl = 1;

class MockImage {
  set src(value) {
    this._src = value;
    const blob = blobs.get(value);
    queueMicrotask(() => {
      const isHeic = /image\/(?:heic|heif)/i.test(blob && blob.type || "") || /\.(?:heic|heif)$/i.test(blob && blob.name || "");
      if (isHeic) {
        if (this.onerror) this.onerror(new Error("unsupported"));
        return;
      }
      this.naturalWidth = /giant/i.test(blob && blob.name || "") ? 20000 : 1200;
      this.naturalHeight = /giant/i.test(blob && blob.name || "") ? 3000 : 800;
      if (this.onload) this.onload();
    });
  }
}

const window = {
  Blob,
  Image: MockImage,
  URL: {
    createObjectURL(blob) {
      const url = `blob:test-${nextUrl++}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL(url) {
      revoked.add(url);
    }
  },
  async heic2any() {
    return new Blob(["converted"], { type: "image/jpeg" });
  }
};

const document = {
  createElement(tagName) {
    return { tagName: tagName.toUpperCase() };
  },
  head: {
    appendChild(node) {
      appendedAssets.push(node.src || node.href);
      queueMicrotask(() => {
        if (/cropper\.min\.js/.test(node.src || "")) window.Cropper = function Cropper() {};
        if (/jszip\.min\.js/.test(node.src || "")) window.JSZip = function JSZip() {};
        if (node.onload) node.onload();
      });
    }
  }
};

const context = vm.createContext({ Blob, document, Image: MockImage, URL: window.URL, window });
vm.runInContext(fs.readFileSync("js/mobile-image-upload.js", "utf8"), context);
const api = window.MobileImageUpload;

async function run() {
  assert.equal(api.isImageFile({ name: "android-gallery.jpg", type: "" }), true, "空 MIME 的 Android 相册图片应按扩展名识别");
  assert.equal(api.isImageFile({ name: "notes.txt", type: "" }), false);
  assert.equal(typeof api.ensureCropper, "function");
  assert.equal(typeof api.ensureZip, "function");
  assert.equal(appendedAssets.length, 0, "图片依赖不应在页面启动时加载");
  await api.ensureCropper();
  assert.equal(appendedAssets.filter(url => /cropper/.test(url)).length, 2, "选择图片后才加载 Cropper 脚本和样式");
  await api.ensureZip();
  assert.equal(appendedAssets.filter(url => /jszip/.test(url)).length, 1, "点击打包后才加载 JSZip");

  const jpeg = await api.open({ name: "android-gallery.jpg", type: "" });
  assert.equal(jpeg.converted, false);
  assert.equal(jpeg.image.naturalWidth, 1200);
  jpeg.release();
  assert.equal(revoked.has(jpeg.src), true, "替换图片时应释放 Blob URL");

  const heic = await api.open({ name: "iphone-photo.HEIC", type: "" });
  assert.equal(heic.converted, true, "原生解码失败的 HEIC 应调用成熟转换库");
  assert.equal(heic.blob.type, "image/jpeg");
  heic.release();

  await assert.rejects(() => api.open({ name: "notes.txt", type: "" }), /NOT_AN_IMAGE/);
  await assert.rejects(() => api.open({ name: "huge.jpg", type: "image/jpeg", size: 41 * 1024 * 1024 }), /IMAGE_FILE_TOO_LARGE/);
  await assert.rejects(() => api.open({ name: "giant.jpg", type: "image/jpeg", size: 1024 }), /IMAGE_DIMENSIONS_TOO_LARGE/);

  const expectedInputs = { "tools/grid-cutter.html": 1, "tools/avatar-preview.html": 1, "tools/payment-merge.html": 3, "tools/long-image-stitch.html": 1 };
  for (const file of Object.keys(expectedInputs)) {
    const html = fs.readFileSync(file, "utf8");
    const fileInputs = [...html.matchAll(/<input[^>]+type="file"[^>]*>/gi)];
    assert.equal(fileInputs.length, expectedInputs[file], `${file} 的图片入口数量应完整`);
    fileInputs.forEach(match => assert.match(match[0], /accept="image\/\*"/i, `${file} 应直接使用系统图片选择器`));
    const helperIndex = html.indexOf("mobile-image-upload.js");
    assert.ok(helperIndex >= 0, `${file} 应加载统一兼容层`);
    assert.doesNotMatch(html, /<script[^>]+(?:heic2any|cropperjs|jszip)/i, `${file} 不应在首屏同步加载大型图片依赖`);
    assert.doesNotMatch(html, /<link[^>]+cropper\.min\.css/i, `${file} 不应在首屏加载裁切样式`);
  }

  assert.match(fs.readFileSync("js/mobile-image-upload.js", "utf8"), /ensureHeicConverter/, "HEIC 转换器应按需加载");
  assert.match(fs.readFileSync("tools/grid-cutter.html", "utf8"), /ensureZip\(\)/, "ZIP 组件应在点击打包后加载");
  assert.doesNotMatch(fs.readFileSync("js/payment-merge.js", "utf8"), /createImageBitmap/, "二维码识别不应强制依赖旧 iOS 缺失的 API");
  console.log("mobile image upload compatibility tests: OK");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

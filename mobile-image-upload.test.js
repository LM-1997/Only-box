const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const blobs = new Map();
const revoked = new Set();
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
      this.naturalWidth = 1200;
      this.naturalHeight = 800;
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

const context = vm.createContext({ Blob, Image: MockImage, URL: window.URL, window });
vm.runInContext(fs.readFileSync("mobile-image-upload.js", "utf8"), context);
const api = window.MobileImageUpload;

async function run() {
  assert.equal(api.isImageFile({ name: "android-gallery.jpg", type: "" }), true, "空 MIME 的 Android 相册图片应按扩展名识别");
  assert.equal(api.isImageFile({ name: "notes.txt", type: "" }), false);

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

  for (const file of ["grid-cutter.html", "avatar-preview.html", "payment-merge.html"]) {
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, /accept="[^"]*\.heic,\.heif"/i, `${file} 应允许移动相册中的 HEIC/HEIF`);
    const converterIndex = html.indexOf("heic2any@0.0.4");
    const helperIndex = html.indexOf("mobile-image-upload.js");
    assert.ok(converterIndex >= 0 && helperIndex > converterIndex, `${file} 应先加载转换库，再加载统一兼容层`);
  }

  assert.doesNotMatch(fs.readFileSync("payment-merge.js", "utf8"), /createImageBitmap/, "二维码识别不应强制依赖旧 iOS 缺失的 API");
  console.log("mobile image upload compatibility tests: OK");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

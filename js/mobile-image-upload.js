(function (global) {
  "use strict";

  const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i;
  const HEIC_EXTENSION = /\.(?:heic|heif)$/i;
  const HEIC_MIME = /^image\/(?:heic|heif|heic-sequence|heif-sequence)$/i;
  const MAX_FILE_BYTES = 40 * 1024 * 1024;
  const MAX_IMAGE_PIXELS = 40 * 1000 * 1000;
  const MAX_IMAGE_EDGE = 16384;
  const ASSETS = {
    cropperCss: "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css",
    cropperJs: "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js",
    heic: "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js",
    jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
  };
  const assetPromises = new Map();

  function isImageFile(file) {
    if (!file) return false;
    return /^image\//i.test(file.type || "") || IMAGE_EXTENSION.test(file.name || "");
  }

  function isHeicFile(file) {
    return Boolean(file) && (HEIC_MIME.test(file.type || "") || HEIC_EXTENSION.test(file.name || ""));
  }

  function validateFile(file) {
    if (Number.isFinite(file && file.size) && file.size > MAX_FILE_BYTES) throw new Error("IMAGE_FILE_TOO_LARGE");
  }

  function validateImageSize(image) {
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
      throw new Error("IMAGE_DIMENSIONS_TOO_LARGE");
    }
  }

  function loadScript(src, globalName) {
    if (globalName && global[globalName]) return Promise.resolve(global[globalName]);
    if (assetPromises.has(src)) return assetPromises.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      script.onload = () => resolve(globalName ? global[globalName] : true);
      script.onerror = () => reject(new Error("DEPENDENCY_LOAD_FAILED"));
      document.head.appendChild(script);
    });
    const tracked = promise.catch(error => {
      assetPromises.delete(src);
      throw error;
    });
    assetPromises.set(src, tracked);
    return tracked;
  }

  function loadStyle(href) {
    if (assetPromises.has(href)) return assetPromises.get(href);
    const promise = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.crossOrigin = "anonymous";
      link.referrerPolicy = "no-referrer";
      link.onload = () => resolve(true);
      link.onerror = () => reject(new Error("DEPENDENCY_LOAD_FAILED"));
      document.head.appendChild(link);
    });
    const tracked = promise.catch(error => {
      assetPromises.delete(href);
      throw error;
    });
    assetPromises.set(href, tracked);
    return tracked;
  }

  async function ensureCropper() {
    await Promise.all([loadStyle(ASSETS.cropperCss), loadScript(ASSETS.cropperJs, "Cropper")]);
    if (typeof global.Cropper !== "function") throw new Error("DEPENDENCY_LOAD_FAILED");
    return global.Cropper;
  }

  async function ensureHeicConverter() {
    await loadScript(ASSETS.heic, "heic2any");
    if (typeof global.heic2any !== "function") throw new Error("HEIC_CONVERTER_UNAVAILABLE");
    return global.heic2any;
  }

  async function ensureZip() {
    await loadScript(ASSETS.jszip, "JSZip");
    if (typeof global.JSZip !== "function") throw new Error("DEPENDENCY_LOAD_FAILED");
    return global.JSZip;
  }

  function loadBlob(blob) {
    return new Promise((resolve, reject) => {
      const src = URL.createObjectURL(blob);
      const image = new Image();
      let active = true;
      const release = () => {
        if (!active) return;
        active = false;
        URL.revokeObjectURL(src);
      };

      image.onload = () => {
        try {
          validateImageSize(image);
          resolve({ blob, image, src, release });
        } catch (error) {
          release();
          reject(error);
        }
      };
      image.onerror = () => {
        release();
        reject(new Error("IMAGE_DECODE_FAILED"));
      };
      image.src = src;
    });
  }

  async function convertHeic(file) {
    const heic2any = await ensureHeicConverter();
    const source = file.type
      ? file
      : new Blob([file], { type: HEIC_EXTENSION.test(file.name || "") && /\.heif$/i.test(file.name || "") ? "image/heif" : "image/heic" });
    let converted = await heic2any({ blob: source, toType: "image/jpeg", quality: 0.9 });
    if (Array.isArray(converted)) converted = converted[0];
    if (!(converted instanceof Blob)) throw new Error("HEIC_CONVERSION_FAILED");
    return converted;
  }

  async function open(file) {
    if (!isImageFile(file)) throw new Error("NOT_AN_IMAGE");
    validateFile(file);

    try {
      return { ...(await loadBlob(file)), converted: false, originalFile: file };
    } catch (nativeError) {
      if (!isHeicFile(file)) throw nativeError;
    }

    try {
      const converted = await convertHeic(file);
      return { ...(await loadBlob(converted)), converted: true, originalFile: file };
    } catch (error) {
      const wrapped = new Error("HEIC_DECODE_FAILED");
      wrapped.cause = error;
      throw wrapped;
    }
  }

  function errorMessage(error) {
    if (error && error.message === "NOT_AN_IMAGE") return "请选择图片文件。";
    if (error && error.message === "IMAGE_FILE_TOO_LARGE") return "图片文件超过 40 MB，请先缩小文件后重试。";
    if (error && error.message === "IMAGE_DIMENSIONS_TOO_LARGE") return "图片像素尺寸过大，请缩小到 4000 万像素以内且最长边不超过 16384px。";
    if (error && error.message === "HEIC_DECODE_FAILED") return "这张 HEIC/HEIF 照片无法读取，请尝试在相册中导出为 JPEG 后重试。";
    if (error && error.message === "DEPENDENCY_LOAD_FAILED") return "图片处理组件加载失败，请检查网络后重试。";
    return "图片读取失败或格式不受当前浏览器支持，请换一张图片重试。";
  }

  global.MobileImageUpload = Object.freeze({ ensureCropper, ensureZip, errorMessage, isHeicFile, isImageFile, open });
})(window);

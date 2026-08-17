(function (global) {
  "use strict";

  const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i;
  const HEIC_EXTENSION = /\.(?:heic|heif)$/i;
  const HEIC_MIME = /^image\/(?:heic|heif|heic-sequence|heif-sequence)$/i;

  function isImageFile(file) {
    if (!file) return false;
    return /^image\//i.test(file.type || "") || IMAGE_EXTENSION.test(file.name || "");
  }

  function isHeicFile(file) {
    return Boolean(file) && (HEIC_MIME.test(file.type || "") || HEIC_EXTENSION.test(file.name || ""));
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

      image.onload = () => resolve({ blob, image, src, release });
      image.onerror = () => {
        release();
        reject(new Error("IMAGE_DECODE_FAILED"));
      };
      image.src = src;
    });
  }

  async function convertHeic(file) {
    if (typeof global.heic2any !== "function") throw new Error("HEIC_CONVERTER_UNAVAILABLE");
    const source = file.type
      ? file
      : new Blob([file], { type: HEIC_EXTENSION.test(file.name || "") && /\.heif$/i.test(file.name || "") ? "image/heif" : "image/heic" });
    let converted = await global.heic2any({ blob: source, toType: "image/jpeg", quality: 0.94 });
    if (Array.isArray(converted)) converted = converted[0];
    if (!(converted instanceof Blob)) throw new Error("HEIC_CONVERSION_FAILED");
    return converted;
  }

  async function open(file) {
    if (!isImageFile(file)) throw new Error("NOT_AN_IMAGE");

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
    if (error && error.message === "HEIC_DECODE_FAILED") return "这张 HEIC/HEIF 照片无法读取，请尝试在相册中导出为 JPEG 后重试。";
    return "图片读取失败或格式不受当前浏览器支持，请换一张图片重试。";
  }

  global.MobileImageUpload = Object.freeze({ errorMessage, isHeicFile, isImageFile, open });
})(window);

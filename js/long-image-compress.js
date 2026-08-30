(function (global) {
  "use strict";

  // jSquash oxipng（PNG 无损压缩）底层 wasm glue，直接经 unpkg 以 ES Module 方式动态引入。
  // 注意：不走 @jsquash/oxipng 的入口 optimise.js，因其内部有裸依赖 wasm-feature-detect，
  // unpkg 无法解析裸包名；底层 codec glue 无任何裸依赖，wasm 通过
  // new URL('squoosh_oxipng_bg.wasm', import.meta.url) 自动定位，unpkg 可直接服务。
  const OXiPNG_URL = "https://unpkg.com/@jsquash/oxipng@2.3.0/codec/pkg/squoosh_oxipng.js?module";
  // 压缩档位 → oxipng level（0-6，官方建议不超过 4）
  const LEVELS = Object.freeze({ light: 1, medium: 3, high: 4 });

  let codecModule = null;

  function dynamicImport(specifier) {
    if (typeof global.__dynamicImport === "function") return global.__dynamicImport(specifier);
    return import(specifier);
  }

  async function ensureCodec() {
    if (codecModule) return codecModule;
    let mod;
    try {
      mod = await dynamicImport(OXiPNG_URL);
    } catch (error) {
      const wrapped = new Error("CODEC_LOAD_FAILED");
      wrapped.cause = error;
      throw wrapped;
    }
    if (!mod || typeof mod.default !== "function" || typeof mod.optimise !== "function") {
      throw new Error("CODEC_LOAD_FAILED");
    }
    try {
      await mod.default();
    } catch (error) {
      const wrapped = new Error("CODEC_INIT_FAILED");
      wrapped.cause = error;
      throw wrapped;
    }
    codecModule = mod;
    return codecModule;
  }

  async function compress(blob, levelName) {
    const level = Object.prototype.hasOwnProperty.call(LEVELS, levelName) ? LEVELS[levelName] : LEVELS.medium;
    const codec = await ensureCodec();
    let source;
    try {
      source = await blob.arrayBuffer();
    } catch (error) {
      throw new Error("COMPRESS_FAILED");
    }
    try {
      // interlace=false, optimiseAlpha=false：保持像素原样，避免改变画面
      const output = codec.optimise(new Uint8Array(source), level, false, false);
      return new Blob([output], { type: "image/png" });
    } catch (error) {
      const wrapped = new Error("COMPRESS_FAILED");
      wrapped.cause = error;
      throw wrapped;
    }
  }

  // 有损压缩（颜色量化）：把 RGBA 像素压缩到有限调色板（如 256/128 色），
  // 输出尺寸与输入完全一致，体积大幅下降（TinyPNG 同类原理）。
  // 由本地 vendor 的 UPNG.js + pako 实现，纯本地、无需联网。
  async function quantize(rgba, width, height, colors, dither) {
    const upng = global.UPNG;
    if (!upng || typeof upng.encode !== "function") {
      throw new Error("QUANTIZE_UNAVAILABLE");
    }
    try {
      const buffer = upng.encode([rgba], width, height, colors, dither || null);
      return new Blob([buffer], { type: "image/png" });
    } catch (error) {
      const wrapped = new Error("QUANTIZE_FAILED");
      wrapped.cause = error;
      throw wrapped;
    }
  }

  function errorMessage(error) {
    if (error && error.message === "CODEC_LOAD_FAILED") return "压缩组件加载失败，请检查网络后重试。";
    if (error && error.message === "CODEC_INIT_FAILED") return "压缩组件初始化失败，请重试。";
    if (error && error.message === "QUANTIZE_UNAVAILABLE") return "量化组件缺失，无法进行有损压缩。";
    if (error && error.message === "QUANTIZE_FAILED") return "有损压缩失败。";
    return "图片压缩失败。";
  }

  global.LongImageCompress = Object.freeze({ compress, quantize, errorMessage, LEVELS });
})(window);

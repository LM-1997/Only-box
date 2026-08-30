const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadApi({ importImpl, upng } = {}) {
  const window = {};
  if (importImpl) window.__dynamicImport = importImpl;
  if (upng) window.UPNG = upng;
  vm.runInContext(fs.readFileSync("js/long-image-compress.js", "utf8"), vm.createContext({ Blob, Uint8Array, window }));
  return window.LongImageCompress;
}

function pngBlob(bytes) {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

(async () => {
  // 档位常量
  const plain = loadApi();
  assert.equal(plain.LEVELS.light, 1, "轻度应映射到 level 1");
  assert.equal(plain.LEVELS.medium, 3, "中度应映射到 level 3");
  assert.equal(plain.LEVELS.high, 4, "高度应映射到 level 4");

  // 成功路径：mock import 返回 glue 模块，验证调用参数与输出
  const importCalls = [];
  const okModule = {
    inited: false,
    optimiseCalls: [],
    async default() { this.inited = true; },
    optimise(data, level, interlace, optimiseAlpha) {
      this.optimiseCalls.push({ data: Array.from(data), level, interlace, optimiseAlpha });
      return new Uint8Array([1, 2, 3, 4]);
    }
  };
  const successApi = loadApi({ importImpl: async specifier => {
    importCalls.push(specifier);
    return okModule;
  } });
  const out = await successApi.compress(pngBlob([9, 8, 7]), "medium");
  assert.ok(out instanceof Blob, "压缩结果应为 Blob");
  assert.equal(out.type, "image/png", "压缩结果应保持 PNG 类型");
  assert.deepEqual(Array.from(new Uint8Array(await out.arrayBuffer())), [1, 2, 3, 4], "应返回 wasm 优化后的字节");
  assert.deepEqual(okModule.optimiseCalls[0].data, [9, 8, 7], "应把原图字节传给 wasm");
  assert.equal(okModule.optimiseCalls[0].level, 3, "中度应映射到 level 3");
  assert.equal(okModule.optimiseCalls[0].interlace, false);
  assert.equal(okModule.optimiseCalls[0].optimiseAlpha, false);
  assert.equal(importCalls.length, 1, "首次压缩应加载一次 codec");
  assert.equal(okModule.inited, true, "加载后应初始化 wasm");
  await successApi.compress(pngBlob([1]), "high");
  assert.equal(importCalls.length, 1, "codec 应缓存，不重复加载");
  assert.equal(importCalls[0], "https://unpkg.com/@jsquash/oxipng@2.3.0/codec/pkg/squoosh_oxipng.js?module", "应直连 unpkg 上的 oxipng 底层 glue");

  // 档位映射：light/medium/high/未知
  const levelSeen = [];
  const levelModule = {
    async default() {},
    optimise(data, level) { levelSeen.push(level); return new Uint8Array([0]); }
  };
  const levelApi = loadApi({ importImpl: async () => levelModule });
  await levelApi.compress(pngBlob([1]), "light");
  await levelApi.compress(pngBlob([1]), "medium");
  await levelApi.compress(pngBlob([1]), "high");
  await levelApi.compress(pngBlob([1]), "unknown");
  assert.deepEqual(levelSeen, [1, 3, 4, 3], "未知档位应回退到中度 level 3");

  // import 失败 → CODEC_LOAD_FAILED
  const loadFailApi = loadApi({ importImpl: async () => { throw new Error("network down"); } });
  await assert.rejects(loadFailApi.compress(pngBlob([1]), "medium"), error => error.message === "CODEC_LOAD_FAILED");

  // 模块结构不合法 → CODEC_LOAD_FAILED
  const badApi = loadApi({ importImpl: async () => ({}) });
  await assert.rejects(badApi.compress(pngBlob([1]), "medium"), error => error.message === "CODEC_LOAD_FAILED");

  // wasm 初始化失败 → CODEC_INIT_FAILED
  const initFailApi = loadApi({ importImpl: async () => ({
    async default() { throw new Error("wasm boom"); },
    optimise() { return new Uint8Array([0]); }
  }) });
  await assert.rejects(initFailApi.compress(pngBlob([1]), "medium"), error => error.message === "CODEC_INIT_FAILED");

  // 压缩执行失败 → COMPRESS_FAILED
  const runFailApi = loadApi({ importImpl: async () => ({
    async default() {},
    optimise() { throw new Error("bad image"); }
  }) });
  await assert.rejects(runFailApi.compress(pngBlob([1]), "medium"), error => error.message === "COMPRESS_FAILED");

  // 有损量化：成功路径（mock UPNG.encode）
  const encodeCalls = [];
  const mockUpng = {
    encode(imgs, w, h, colors, dither) {
      encodeCalls.push({ imgs, w, h, colors, dither });
      return new Uint8Array([7, 8, 9]).buffer;
    }
  };
  const quantApi = loadApi({ upng: mockUpng });
  const rgba = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const quantOut = await quantApi.quantize(rgba, 2, 1, 256, [1, 1, 1, 0]);
  assert.ok(quantOut instanceof Blob, "量化结果应为 Blob");
  assert.equal(quantOut.type, "image/png", "量化结果应保持 PNG 类型");
  assert.deepEqual(Array.from(new Uint8Array(await quantOut.arrayBuffer())), [7, 8, 9], "应返回 UPNG 编码后的字节");
  assert.equal(encodeCalls[0].imgs.length, 1, "应把 RGBA 像素数组传给 UPNG");
  assert.strictEqual(encodeCalls[0].imgs[0], rgba, "传入的像素数组应与原数据一致");
  assert.equal(encodeCalls[0].w, 2, "量化必须保持原宽度");
  assert.equal(encodeCalls[0].h, 1, "量化必须保持原高度");
  assert.equal(encodeCalls[0].colors, 256, "中度档应量化到 256 色");
  assert.deepEqual(encodeCalls[0].dither, [1, 1, 1, 0], "应传递 RGB 抖动参数");

  // 量化组件缺失 → QUANTIZE_UNAVAILABLE
  const noUpngApi = loadApi();
  await assert.rejects(noUpngApi.quantize(rgba, 2, 1, 256, null), error => error.message === "QUANTIZE_UNAVAILABLE");

  // 编码失败 → QUANTIZE_FAILED
  const failUpngApi = loadApi({ upng: { encode() { throw new Error("oom"); } } });
  await assert.rejects(failUpngApi.quantize(rgba, 2, 1, 256, null), error => error.message === "QUANTIZE_FAILED");

  // 错误提示文案
  assert.equal(successApi.errorMessage({ message: "CODEC_LOAD_FAILED" }), "压缩组件加载失败，请检查网络后重试。");
  assert.equal(successApi.errorMessage({ message: "CODEC_INIT_FAILED" }), "压缩组件初始化失败，请重试。");
  assert.equal(successApi.errorMessage({ message: "QUANTIZE_UNAVAILABLE" }), "量化组件缺失，无法进行有损压缩。");
  assert.equal(successApi.errorMessage({ message: "QUANTIZE_FAILED" }), "有损压缩失败。");
  assert.equal(successApi.errorMessage({ message: "COMPRESS_FAILED" }), "图片压缩失败。");
  assert.equal(successApi.errorMessage(null), "图片压缩失败。");

  console.log("long image compress tests: OK");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

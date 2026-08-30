(() => {
  "use strict";

  const MAX_IMAGES = 30;
  // 压缩档位预设：轻度=无损（oxipng 最高档）；中/高度=有损（颜色量化，尺寸不变，纯本地 UPNG）
  const COMPRESS_PRESETS = Object.freeze({
    light: { lossy: false, mode: "oxipng" },
    medium: { lossy: true, mode: "quantize", colors: 256, dither: [1, 1, 1, 0] },
    high: { lossy: true, mode: "quantize", colors: 128, dither: [1, 1, 1, 0] }
  });
  const state = {
    items: [],
    order: [],
    direction: "vertical",
    crossSize: { vertical: "", horizontal: "" },
    multiplier: "1",
    compressEnabled: false,
    compressLevel: "medium",
    sorting: false,
    loading: false,
    generating: false,
    resultUrl: "",
    previewZoom: 100,
    nextId: 1,
    sortMessage: ""
  };

  const $ = id => document.getElementById(id);
  const els = {
    fileInput: $("fileInput"),
    dropzone: $("dropzone"),
    loadStatus: $("loadStatus"),
    verticalBtn: $("verticalBtn"),
    horizontalBtn: $("horizontalBtn"),
    crossSizeInput: $("crossSizeInput"),
    crossSizeLabel: $("crossSizeLabel"),
    multiplierInput: $("multiplierInput"),
    sizeClearBtn: $("sizeClearBtn"),
    sizeHint: $("sizeHint"),
    compressToggle: $("compressToggle"),
    compressLevels: $("compressLevels"),
    compressLightBtn: $("compressLightBtn"),
    compressMediumBtn: $("compressMediumBtn"),
    compressHighBtn: $("compressHighBtn"),
    dimensionReadout: $("dimensionReadout"),
    generateBtn: $("generateBtn"),
    generateStatus: $("generateStatus"),
    uploadList: $("uploadList"),
    sortHelp: $("sortHelp"),
    sortBtn: $("sortBtn"),
    resetOrderBtn: $("resetOrderBtn"),
    clearAllBtn: $("clearAllBtn"),
    imageGrid: $("imageGrid"),
    resultPanel: $("resultPanel"),
    resultMeta: $("resultMeta"),
    resultViewport: $("resultViewport"),
    resultImage: $("resultImage"),
    downloadLink: $("downloadLink"),
    zoomOutBtn: $("zoomOutBtn"),
    zoomRange: $("zoomRange"),
    zoomInBtn: $("zoomInBtn"),
    zoomValue: $("zoomValue"),
    fitWidthBtn: $("fitWidthBtn")
  };

  function orderedItems() {
    const byId = new Map(state.items.map(item => [item.id, item]));
    return state.order.map(id => byId.get(id)).filter(Boolean);
  }

  function invalidateResult() {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = "";
    els.resultImage.removeAttribute("src");
    els.downloadLink.removeAttribute("href");
    els.resultPanel.hidden = true;
    els.generateStatus.textContent = "";
  }

  function setPreviewZoom(value) {
    state.previewZoom = Math.max(25, Math.min(400, Math.round(Number(value) / 25) * 25));
    applyPreviewZoom();
  }

  function applyPreviewZoom() {
    els.zoomRange.value = String(state.previewZoom);
    els.zoomValue.textContent = `${state.previewZoom}%`;
    els.zoomOutBtn.disabled = state.previewZoom <= 25;
    els.zoomInBtn.disabled = state.previewZoom >= 400;
    if (!state.resultUrl || els.resultPanel.hidden) return;
    const fitWidth = Math.max(1, (els.resultViewport.clientWidth || 720) - 28);
    const previewWidth = Math.max(1, Math.round(fitWidth * state.previewZoom / 100));
    els.resultImage.style.width = `${previewWidth}px`;
    els.resultImage.style.height = "auto";
    els.resultViewport.classList.toggle("is-zoomed", state.previewZoom > 100);
  }

  function setDirection(direction) {
    if (state.direction === direction || state.generating) return;
    state.crossSize[state.direction] = els.crossSizeInput.value;
    state.direction = direction;
    els.crossSizeInput.value = state.crossSize[direction];
    updateCrossSizeLabel();
    invalidateResult();
    updateUI();
  }

  function setCompressEnabled(enabled) {
    state.compressEnabled = Boolean(enabled);
    invalidateResult();
    updateUI();
  }

  function setCompressLevel(level) {
    if (!Object.prototype.hasOwnProperty.call(LongImageCompress.LEVELS, level)) return;
    state.compressLevel = level;
    invalidateResult();
    updateUI();
  }

  function readCrossSize() {
    const value = Number(els.crossSizeInput.value);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value);
  }

  function readMultiplier() {
    const value = Number(els.multiplierInput.value);
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.round(value * 100) / 100;
  }

  function updateCrossSizeLabel() {
    const vertical = state.direction === "vertical";
    els.crossSizeLabel.textContent = vertical ? "输出宽度" : "输出高度";
    els.crossSizeInput.placeholder = vertical ? "自动（取最小宽度）" : "自动（取最小高度）";
    els.sizeHint.textContent = vertical
      ? "留空时自动取所有图片的最小宽度（过大时为手机稳定性自动缩小）；手动设置后强制按该宽度输出。倍率默认 1，对最终输出整体放大，不会被自动缩小覆盖。"
      : "留空时自动取所有图片的最小高度（过大时为手机稳定性自动缩小）；手动设置后强制按该高度输出。倍率默认 1，对最终输出整体放大，不会被自动缩小覆盖。";
    const multiplierValue = els.multiplierInput.value.trim();
    els.sizeClearBtn.hidden = els.crossSizeInput.value.trim() === "" && (multiplierValue === "" || Number(multiplierValue) === 1);
  }

  function calculateLayout() {
    const items = orderedItems();
    if (items.length < 2 || items.length !== state.items.length) return null;
    return LongImageLayout.calculate(items, state.direction, readCrossSize(), readMultiplier());
  }

  function renderDimensionReadout() {
    els.dimensionReadout.replaceChildren();
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    const layout = calculateLayout();
    if (!layout) {
      title.textContent = state.sorting ? `还需点按 ${state.items.length - state.order.length} 张` : "等待图片";
      detail.textContent = state.items.length < 2 ? "添加两张或更多图片后可生成" : "请先完成所有图片的点按排序";
    } else {
      title.textContent = `${layout.width} × ${layout.height}px`;
      detail.textContent = `${state.items.length} 张图片 · ${state.direction === "vertical" ? "统一宽度后竖向拼接" : "统一高度后横向拼接"}`;
      const notes = [];
      if (layout.multiplier !== 1) {
        const rateNote = layout.multiplier > 1 ? `已按 ${layout.multiplier} 倍率放大` : `已按 ${layout.multiplier} 倍率缩小`;
        notes.push(`${rateNote}，原图分辨率不足时可能发虚`);
      } else if (layout.wasReduced) {
        notes.push(`已为手机稳定性缩小至 ${Math.round(layout.scale * 100)}%`);
      } else if (layout.enlarged) {
        notes.push(`已按设置放大至 ${Math.round(layout.scale * 100)}%，原图分辨率不足时可能发虚`);
      }
      const preset = COMPRESS_PRESETS[state.compressLevel];
      if (state.compressEnabled && preset && preset.lossy) {
        notes.push(`有损压缩 ${preset.colors} 色（输出尺寸不变）`);
      }
      if (notes.length) {
        detail.className = "scale-warning";
        detail.textContent += ` · ${notes.join(" · ")}`;
      }
    }
    els.dimensionReadout.append(title, detail);
  }

  function renderSequence() {
    els.uploadList.hidden = state.items.length === 0;
    els.imageGrid.replaceChildren();
    els.imageGrid.classList.toggle("sorting-active", state.sorting);
    if (!state.items.length) return;

    if (state.sorting) {
      els.sortHelp.textContent = `请从第 1 张开始依次点按；已选择 ${state.order.length} / ${state.items.length} 张。再次点已编号图片可取消。`;
      els.sortBtn.textContent = "重新开始排序";
    } else {
      els.sortHelp.textContent = state.sortMessage || "当前按上方编号拼接。需要调整时，进入点按排序。";
      els.sortBtn.textContent = "重新点按排序";
    }

    const displayItems = state.sorting ? state.items : orderedItems();
    displayItems.forEach(item => {
      const rank = state.order.indexOf(item.id);
      const card = document.createElement("article");
      card.className = `image-card ${rank >= 0 ? "is-ranked" : "is-awaiting"}`;
      card.setAttribute("role", "listitem");

      const orderButton = document.createElement("button");
      orderButton.type = "button";
      orderButton.className = "image-order-button";
      orderButton.disabled = state.loading || state.generating;
      orderButton.setAttribute("aria-label", state.sorting ? `${rank >= 0 ? `当前第 ${rank + 1} 张，点按取消` : "尚未排序，点按设为下一张"}：${item.name}` : `第 ${rank + 1} 张：${item.name}`);
      orderButton.addEventListener("click", () => handleOrderTap(item.id));

      const thumb = document.createElement("span");
      thumb.className = "thumb-wrap";
      const image = document.createElement("img");
      image.src = item.src;
      image.alt = "";
      thumb.appendChild(image);

      const badge = document.createElement("span");
      badge.className = "order-badge";
      badge.textContent = rank >= 0 ? String(rank + 1).padStart(2, "0") : "点我";

      const copy = document.createElement("span");
      copy.className = "image-copy";
      const name = document.createElement("strong");
      name.textContent = item.name;
      const meta = document.createElement("span");
      meta.textContent = `${item.width} × ${item.height}px`;
      copy.append(name, meta);
      orderButton.append(thumb, copy);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-image";
      remove.textContent = "×";
      remove.disabled = state.loading || state.generating;
      remove.setAttribute("aria-label", `移除 ${item.name}`);
      remove.addEventListener("click", event => {
        event.stopPropagation();
        removeImage(item.id);
      });

      card.append(orderButton, badge, remove);
      els.imageGrid.appendChild(card);
    });
  }

  function updateControls() {
    const busy = state.loading || state.generating;
    els.fileInput.disabled = busy || state.items.length >= MAX_IMAGES;
    els.dropzone.classList.toggle("is-disabled", els.fileInput.disabled);
    els.verticalBtn.disabled = busy;
    els.horizontalBtn.disabled = busy;
    els.crossSizeInput.disabled = busy;
    els.multiplierInput.disabled = busy;
    els.verticalBtn.classList.toggle("active", state.direction === "vertical");
    els.horizontalBtn.classList.toggle("active", state.direction === "horizontal");
    els.verticalBtn.setAttribute("aria-pressed", String(state.direction === "vertical"));
    els.horizontalBtn.setAttribute("aria-pressed", String(state.direction === "horizontal"));
    els.sortBtn.disabled = busy || state.items.length < 2;
    els.resetOrderBtn.disabled = busy || state.items.length < 2;
    els.clearAllBtn.disabled = busy || state.items.length === 0;
    els.fitWidthBtn.disabled = !state.resultUrl;
    els.compressToggle.disabled = busy;
    els.compressLevels.hidden = !state.compressEnabled;
    els.compressLightBtn.disabled = busy || !state.compressEnabled;
    els.compressMediumBtn.disabled = busy || !state.compressEnabled;
    els.compressHighBtn.disabled = busy || !state.compressEnabled;
    els.compressLightBtn.classList.toggle("active", state.compressLevel === "light");
    els.compressMediumBtn.classList.toggle("active", state.compressLevel === "medium");
    els.compressHighBtn.classList.toggle("active", state.compressLevel === "high");
    els.compressLightBtn.setAttribute("aria-pressed", String(state.compressLevel === "light"));
    els.compressMediumBtn.setAttribute("aria-pressed", String(state.compressLevel === "medium"));
    els.compressHighBtn.setAttribute("aria-pressed", String(state.compressLevel === "high"));
    const ready = Boolean(calculateLayout()) && !busy;
    els.generateBtn.disabled = !ready;
    els.generateBtn.textContent = state.generating ? "正在生成…" : state.items.length < 2 ? "至少需要 2 张图片" : state.sorting ? "请先完成点按排序" : `生成${state.direction === "vertical" ? "竖向" : "横向"}长图`;
  }

  function updateUI() {
    renderSequence();
    renderDimensionReadout();
    updateControls();
    updateCrossSizeLabel();
  }

  function handleOrderTap(id) {
    if (!state.sorting || state.loading || state.generating) return;
    state.order = LongImageLayout.toggleOrder(state.order, id);
    invalidateResult();
    if (state.order.length === state.items.length) {
      state.sorting = false;
      state.sortMessage = "排序完成，图片已按新的编号重新排列。";
    }
    updateUI();
  }

  function startSorting() {
    if (state.items.length < 2 || state.loading || state.generating) return;
    state.sorting = true;
    state.order = [];
    state.sortMessage = "";
    invalidateResult();
    updateUI();
  }

  function resetOrder() {
    if (state.loading || state.generating) return;
    state.order = state.items.map(item => item.id);
    state.sorting = false;
    state.sortMessage = "已恢复为图片添加顺序。";
    invalidateResult();
    updateUI();
  }

  function removeImage(id) {
    if (state.loading || state.generating) return;
    const index = state.items.findIndex(item => item.id === id);
    if (index < 0) return;
    state.items[index].release();
    state.items.splice(index, 1);
    state.order = state.order.filter(itemId => itemId !== id);
    if (state.sorting && state.order.length === state.items.length) state.sorting = false;
    state.sortMessage = "";
    invalidateResult();
    els.loadStatus.textContent = state.items.length ? `已添加 ${state.items.length} 张，还可以继续添加。` : "还没有选择图片。";
    updateUI();
  }

  function clearAll() {
    if (state.loading || state.generating) return;
    state.items.forEach(item => item.release());
    state.items = [];
    state.order = [];
    state.sorting = false;
    state.sortMessage = "";
    els.fileInput.value = "";
    els.loadStatus.textContent = "还没有选择图片。";
    invalidateResult();
    updateUI();
  }

  async function addFiles(fileList) {
    if (state.loading || state.generating) return;
    const available = MAX_IMAGES - state.items.length;
    if (available <= 0) {
      els.loadStatus.textContent = `最多添加 ${MAX_IMAGES} 张图片。`;
      return;
    }
    const files = Array.from(fileList || []).slice(0, available);
    if (!files.length) return;
    const omitted = Math.max(0, Array.from(fileList || []).length - files.length);
    state.loading = true;
    state.sorting = false;
    state.sortMessage = "";
    invalidateResult();
    updateUI();

    let added = 0;
    let failed = 0;
    let firstError = null;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      els.loadStatus.textContent = `正在读取 ${index + 1} / ${files.length}：${file.name || "图片"}`;
      let opened = null;
      try {
        opened = await MobileImageUpload.open(file);
        const item = {
          id: state.nextId++,
          name: file.name || `图片 ${state.nextId - 1}`,
          image: opened.image,
          src: opened.src,
          release: opened.release,
          width: opened.image.naturalWidth,
          height: opened.image.naturalHeight
        };
        state.items.push(item);
        state.order.push(item.id);
        opened = null;
        added++;
      } catch (error) {
        if (opened) opened.release();
        if (!firstError) firstError = error;
        failed++;
      }
      await nextFrame();
    }

    state.loading = false;
    const notes = [`已添加 ${added} 张`];
    if (failed) {
      const message = MobileImageUpload.errorMessage(firstError);
      notes.push(`${failed} 张未添加：${message}`);
    }
    if (omitted) notes.push(`超出上限的 ${omitted} 张未添加`);
    notes.push(`当前共 ${state.items.length} 张`);
    els.loadStatus.textContent = notes.join(" · ");
    updateUI();
  }

  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG_ENCODE_FAILED")), "image/png");
    });
  }

  async function generate() {
    const layout = calculateLayout();
    if (!layout || state.loading || state.generating) return;
    state.generating = true;
    invalidateResult();
    updateUI();
    let canvas = null;
    try {
      canvas = document.createElement("canvas");
      canvas.width = layout.width;
      canvas.height = layout.height;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      for (let index = 0; index < layout.placements.length; index++) {
        const placement = layout.placements[index];
        els.generateStatus.textContent = `正在绘制 ${index + 1} / ${layout.placements.length}…`;
        LongImageLayout.drawPlacement(ctx, placement);
        await nextFrame();
      }
      els.generateStatus.textContent = "正在编码 PNG…";
      const blob = await canvasToBlob(canvas);

      let outputBlob = blob;
      let compressNote = "";
      let compressError = null;
      if (state.compressEnabled) {
        const preset = COMPRESS_PRESETS[state.compressLevel] || COMPRESS_PRESETS.medium;
        if (preset.lossy) {
          // 有损档：颜色量化（减少颜色数量），输出尺寸与拼接结果完全一致（纯本地 UPNG，无需联网）
          els.generateStatus.textContent = `正在有损压缩（${preset.colors} 色）…`;
          const rgba = ctx.getImageData(0, 0, layout.width, layout.height).data;
          const quantized = await LongImageCompress.quantize(rgba, layout.width, layout.height, preset.colors, preset.dither);
          outputBlob = quantized;
          const saved = ((1 - quantized.size / blob.size) * 100).toFixed(1);
          compressNote = `有损压缩 ${preset.colors} 色（尺寸不变 ${layout.width} × ${layout.height}px）· 原 ${formatBytes(blob.size)} → 压缩 ${formatBytes(quantized.size)}（省 ${saved}%）`;
        } else {
          // 无损档：oxipng 最高档优化（PNG 无损，画质不变）
          els.generateStatus.textContent = "正在压缩 PNG…";
          try {
            const compressed = await LongImageCompress.compress(blob, "high");
            if (compressed.size < blob.size) {
              outputBlob = compressed;
              const saved = ((1 - compressed.size / blob.size) * 100).toFixed(1);
              compressNote = `无损优化 · 原 ${formatBytes(blob.size)} → 压缩 ${formatBytes(compressed.size)}（省 ${saved}%）`;
            } else {
              compressNote = "无损优化未减小体积，已使用未压缩版本";
            }
          } catch (error) {
            compressError = LongImageCompress.errorMessage(error);
            compressNote = compressError;
          }
        }
      }

      state.resultUrl = URL.createObjectURL(outputBlob);
      state.previewZoom = 100;
      els.resultImage.src = state.resultUrl;
      els.resultViewport.className = `result-viewport ${state.direction}`;
      els.downloadLink.href = state.resultUrl;
      els.downloadLink.download = `only-box-long-image-${state.direction === "vertical" ? "vertical" : "horizontal"}.png`;
      const baseMeta = `${layout.width} × ${layout.height}px · ${state.items.length} 张 · PNG ${formatBytes(outputBlob.size)}`;
      els.resultMeta.textContent = compressNote ? `${baseMeta} · ${compressNote}` : baseMeta;
      els.resultPanel.hidden = false;
      els.generateStatus.textContent = compressError
        ? "压缩失败，已使用未压缩版本，可以下载 PNG。"
        : "拼接完成，可以下载 PNG。";
      requestAnimationFrame(applyPreviewZoom);
      els.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      els.generateStatus.textContent = "生成失败，可能是图片过大或手机内存不足。请减少图片数量后重试。";
    } finally {
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
      state.generating = false;
      updateUI();
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  els.fileInput.addEventListener("change", event => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    addFiles(files);
  });
  ["dragenter", "dragover"].forEach(type => els.dropzone.addEventListener(type, event => {
    event.preventDefault();
    if (!els.fileInput.disabled) els.dropzone.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach(type => els.dropzone.addEventListener(type, event => {
    event.preventDefault();
    els.dropzone.classList.remove("drag");
  }));
  els.dropzone.addEventListener("drop", event => {
    if (!els.fileInput.disabled) addFiles(event.dataTransfer.files);
  });
  els.verticalBtn.addEventListener("click", () => setDirection("vertical"));
  els.horizontalBtn.addEventListener("click", () => setDirection("horizontal"));
  els.crossSizeInput.addEventListener("input", () => {
    state.crossSize[state.direction] = els.crossSizeInput.value;
    updateCrossSizeLabel();
    invalidateResult();
    updateUI();
  });
  els.multiplierInput.addEventListener("input", () => {
    state.multiplier = els.multiplierInput.value;
    updateCrossSizeLabel();
    invalidateResult();
    updateUI();
  });
  els.sizeClearBtn.addEventListener("click", () => {
    els.crossSizeInput.value = "";
    state.crossSize[state.direction] = "";
    els.multiplierInput.value = "1";
    state.multiplier = "1";
    updateCrossSizeLabel();
    invalidateResult();
    updateUI();
  });
  els.compressToggle.addEventListener("change", event => {
    setCompressEnabled(event.target.checked);
  });
  els.compressLightBtn.addEventListener("click", () => setCompressLevel("light"));
  els.compressMediumBtn.addEventListener("click", () => setCompressLevel("medium"));
  els.compressHighBtn.addEventListener("click", () => setCompressLevel("high"));
  els.sortBtn.addEventListener("click", startSorting);
  els.resetOrderBtn.addEventListener("click", resetOrder);
  els.clearAllBtn.addEventListener("click", clearAll);
  els.generateBtn.addEventListener("click", generate);
  els.zoomOutBtn.addEventListener("click", () => setPreviewZoom(state.previewZoom - 25));
  els.zoomInBtn.addEventListener("click", () => setPreviewZoom(state.previewZoom + 25));
  els.zoomRange.addEventListener("input", event => setPreviewZoom(event.target.value));
  els.fitWidthBtn.addEventListener("click", () => setPreviewZoom(100));
  els.resultImage.addEventListener("load", applyPreviewZoom);
  window.addEventListener("resize", applyPreviewZoom);
  window.addEventListener("beforeunload", () => {
    state.items.forEach(item => item.release());
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  });

  updateUI();
})();

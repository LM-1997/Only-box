(() => {
  const state = {
    layout: "landscape",
    frameMode: "border",
    title: "扫码付款",
    subtitle: "微信 / 支付宝均可使用",
    footer: "请确认金额后再付款，感谢支持",
    titleColor: "#17231d",
    subtitleColor: "#69736d",
    footerColor: "#17231d",
    backgroundColor: "#fbfaf5",
    backgroundColorOpacity: 100,
    backgroundImage: null,
    backgroundImageSrc: "",
    backgroundImageOpacity: 22,
    backgroundImageScale: 100,
    backgroundCropper: null,
    backgroundCrop: null,
    backgroundRelease: null,
    backgroundLoadToken: 0,
    paymentLoadTokens: { wechat: 0, alipay: 0 },
    wechat: null,
    alipay: null
  };

  const $ = id => document.getElementById(id);
  const canvas = $("posterCanvas");
  const ctx = canvas.getContext("2d");
  const colors = { wechat: "#20b15a", alipay: "#1677ff", ink: "#17231d", muted: "#69736d", page: "#fbfaf5", line: "#e5ded1" };
  const controls = {
    wechatInput: $("wechatInput"),
    alipayInput: $("alipayInput"),
    wechatMeta: $("wechatMeta"),
    alipayMeta: $("alipayMeta"),
    landscapeBtn: $("landscapeBtn"),
    portraitBtn: $("portraitBtn"),
    layoutValue: $("layoutValue"),
    frameModeValue: $("frameModeValue"),
    frameNoneBtn: $("frameNoneBtn"),
    frameBorderBtn: $("frameBorderBtn"),
    frameFillBtn: $("frameFillBtn"),
    titleInput: $("titleInput"),
    subtitleInput: $("subtitleInput"),
    footerInput: $("footerInput"),
    titleColorInput: $("titleColorInput"),
    subtitleColorInput: $("subtitleColorInput"),
    footerColorInput: $("footerColorInput"),
    bgColorInput: $("bgColorInput"),
    bgColorHexInput: $("bgColorHexInput"),
    bgColorSwatch: $("bgColorSwatch"),
    bgColorOpacityRange: $("bgColorOpacityRange"),
    bgColorOpacityValue: $("bgColorOpacityValue"),
    bgInput: $("bgInput"),
    clearBgBtn: $("clearBgBtn"),
    bgCropPanel: $("bgCropPanel"),
    bgCropImage: $("bgCropImage"),
    bgCropRatio: $("bgCropRatio"),
    bgImageOpacityRange: $("bgImageOpacityRange"),
    bgImageOpacityValue: $("bgImageOpacityValue"),
    bgImageScaleRange: $("bgImageScaleRange"),
    bgImageScaleValue: $("bgImageScaleValue"),
    status: $("status"),
    downloadBtn: $("downloadBtn")
  };

  function normalizeHex(value) {
    const raw = String(value).trim();
    const full = raw.startsWith("#") ? raw : `#${raw}`;
    if (/^#[0-9a-fA-F]{6}$/.test(full)) return full.toLowerCase();
    const short = full.match(/^#([0-9a-fA-F]{3})$/);
    if (!short) return null;
    const rgb = short[1];
    return `#${rgb[0]}${rgb[0]}${rgb[1]}${rgb[1]}${rgb[2]}${rgb[2]}`.toLowerCase();
  }

  function syncBgColor(value) {
    const hex = normalizeHex(value);
    if (!hex) return;
    state.backgroundColor = hex;
    if (state.backgroundImage && state.backgroundColorOpacity === 0) {
      state.backgroundColorOpacity = 100;
      controls.bgColorOpacityRange.value = "100";
      controls.bgColorOpacityValue.textContent = "100%";
    }
    controls.bgColorInput.value = hex;
    controls.bgColorHexInput.value = hex;
    controls.bgColorSwatch.style.backgroundColor = hex;
    render();
  }

  async function loadPaymentImage(file, platform) {
    const token = ++state.paymentLoadTokens[platform];
    controls.status.textContent = "正在识别二维码区域……";
    try {
      const opened = await MobileImageUpload.open(file);
      if (token !== state.paymentLoadTokens[platform]) {
        opened.release();
        return;
      }
      const qr = await findQrRegion(opened.image, platform);
      const previous = state[platform];
      if (previous && previous.cropper) previous.cropper.destroy();
      if (previous && previous.release) previous.release();
      state[platform] = { image: opened.image, src: opened.src, qr, autoQr: { ...qr }, cropper: null, release: opened.release, name: file.name, width: opened.image.naturalWidth, height: opened.image.naturalHeight };
      setupPaymentCropper(platform);
      updateMeta(platform);
      controls.status.textContent = opened.converted ? "HEIC 照片已转换，可继续调整。" : "图片已载入，可继续调整。";
      render();
    } catch (error) {
      controls.status.textContent = MobileImageUpload.errorMessage(error);
    }
  }

  async function findQrRegion(image, platform) {
    const detected = await detectByBarcode(image);
    const estimated = detected || estimateByFinderPatterns(image) || estimateByDensity(image);
    const refined = refineDarkRegion(image, estimated) || estimated;
    return squareRegion(refined, image.naturalWidth, image.naturalHeight, platform === "alipay" ? 0.006 : 0.008, Boolean(detected || estimated.detected));
  }

  async function detectByBarcode(image) {
    if (!("BarcodeDetector" in window)) return null;
    try {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const results = await detector.detect(image);
      if (!results.length) return null;
      const box = results.sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height)[0].boundingBox;
      return { x: box.x, y: box.y, width: box.width, height: box.height, detected: true };
    } catch {
      return null;
    }
  }

  function createDarkSample(image, sampleWidth) {
    const width = sampleWidth;
    const height = Math.max(320, Math.round(width * image.naturalHeight / image.naturalWidth));
    const work = document.createElement("canvas");
    const workCtx = work.getContext("2d", { willReadFrequently: true });
    work.width = width;
    work.height = height;
    workCtx.drawImage(image, 0, 0, width, height);
    const pixels = workCtx.getImageData(0, 0, width, height).data;
    const map = new Uint8Array(width * height);
    for (let index = 0; index < map.length; index++) {
      const pixel = index * 4;
      const r = pixels[pixel];
      const g = pixels[pixel + 1];
      const b = pixels[pixel + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      map[index] = (lum < 112 && max - min < 84) || lum < 70 ? 1 : 0;
    }
    return { map, width, height };
  }

  function estimateByFinderPatterns(image) {
    const { map, width, height } = createDarkSample(image, 720);
    const patterns = findComponents(map, width, height).sort((a, b) => b.size - a.size).slice(0, 32);
    if (patterns.length < 3) return null;
    const triple = selectFinderTriple(patterns, width, height);
    if (!triple) return null;
    const left = Math.min(...triple.map(item => item.x));
    const top = Math.min(...triple.map(item => item.y));
    const right = Math.max(...triple.map(item => item.x + item.width));
    const bottom = Math.max(...triple.map(item => item.y + item.height));
    const finderSize = triple.reduce((sum, item) => sum + item.size, 0) / triple.length;
    return {
      x: (left - finderSize * 0.08) * image.naturalWidth / width,
      y: (top - finderSize * 0.08) * image.naturalHeight / height,
      width: (right - left + finderSize * 0.16) * image.naturalWidth / width,
      height: (bottom - top + finderSize * 0.16) * image.naturalHeight / height,
      detected: true
    };
  }

  function findComponents(map, width, height) {
    const visited = new Uint8Array(map.length);
    const stack = new Int32Array(map.length);
    const list = [];
    const minSize = Math.max(14, Math.round(Math.min(width, height) * 0.026));
    const maxSize = Math.round(Math.min(width, height) * 0.22);
    for (let start = 0; start < map.length; start++) {
      if (!map[start] || visited[start]) continue;
      let top = 0;
      let count = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      visited[start] = 1;
      stack[top++] = start;
      while (top) {
        const index = stack[--top];
        const x = index % width;
        const y = Math.floor(index / width);
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        add(index - 1, x > 0);
        add(index + 1, x < width - 1);
        add(index - width, y > 0);
        add(index + width, y < height - 1);
      }
      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      const size = Math.max(componentWidth, componentHeight);
      const aspect = componentWidth / componentHeight;
      const fill = count / (componentWidth * componentHeight);
      if (size >= minSize && size <= maxSize && aspect > 0.72 && aspect < 1.38 && fill > 0.22 && fill < 0.76) {
        list.push({ x: minX, y: minY, width: componentWidth, height: componentHeight, size, fill, cx: minX + componentWidth / 2, cy: minY + componentHeight / 2, count });
      }
      function add(next, inside) {
        if (!inside || visited[next] || !map[next]) return;
        visited[next] = 1;
        stack[top++] = next;
      }
    }
    return list;
  }

  function selectFinderTriple(patterns, width, height) {
    let best = null;
    for (let i = 0; i < patterns.length; i++) {
      for (let j = 0; j < patterns.length; j++) {
        if (j === i) continue;
        for (let k = j + 1; k < patterns.length; k++) {
          if (k === i) continue;
          const corner = patterns[i];
          const a = patterns[j];
          const b = patterns[k];
          const v1x = a.cx - corner.cx;
          const v1y = a.cy - corner.cy;
          const v2x = b.cx - corner.cx;
          const v2y = b.cy - corner.cy;
          const d1 = Math.hypot(v1x, v1y);
          const d2 = Math.hypot(v2x, v2y);
          if (d1 < width * 0.16 || d2 < width * 0.16) continue;
          const angle = Math.abs((v1x * v2x + v1y * v2y) / (d1 * d2));
          const distanceRatio = Math.min(d1, d2) / Math.max(d1, d2);
          if (angle > 0.34 || distanceRatio < 0.66) continue;
          const predictedX = a.cx + b.cx - corner.cx;
          const predictedY = a.cy + b.cy - corner.cy;
          if (predictedX < 0 || predictedX > width || predictedY < 0 || predictedY > height) continue;
          const left = Math.min(corner.x, a.x, b.x);
          const top = Math.min(corner.y, a.y, b.y);
          const right = Math.max(corner.x + corner.width, a.x + a.width, b.x + b.width);
          const bottom = Math.max(corner.y + corner.height, a.y + a.height, b.y + b.height);
          const boxWidth = right - left;
          const boxHeight = bottom - top;
          const boxRatio = Math.min(boxWidth, boxHeight) / Math.max(boxWidth, boxHeight);
          if (boxWidth < width * 0.28 || boxHeight < width * 0.28 || boxRatio < 0.72) continue;
          const sizeSpread = Math.max(corner.size, a.size, b.size) / Math.min(corner.size, a.size, b.size);
          if (sizeSpread > 1.75) continue;
          const score = (1 - angle) * 4 + distanceRatio * 3 + boxRatio * 2 + Math.log(corner.count + a.count + b.count) - Math.abs(sizeSpread - 1);
          if (!best || score > best.score) best = { score, triple: [corner, a, b] };
        }
      }
    }
    return best ? best.triple : null;
  }

  function estimateByDensity(image) {
    const { map, width, height } = createDarkSample(image, 560);
    const integral = createIntegral(map, width, height);
    const minSide = Math.min(width, height);
    const minSize = Math.max(120, Math.round(minSide * 0.34));
    const maxSize = Math.round(minSide * 0.74);
    let best = null;
    for (let size = minSize; size <= maxSize; size += 6) {
      const step = Math.max(4, Math.round(size / 48));
      const xMin = Math.round(width * 0.04);
      const xMax = Math.round(width - size - width * 0.04);
      const yMin = Math.round(height * 0.08);
      const yMax = Math.round(height - size - height * 0.08);
      for (let y = yMin; y <= yMax; y += step) {
        for (let x = xMin; x <= xMax; x += step) {
          const density = rectSum(integral, width, x, y, size, size) / (size * size);
          if (density < 0.15 || density > 0.50) continue;
          const cx = x + size / 2;
          const cy = y + size / 2;
          const centerScore = 1 - Math.min(1, Math.hypot((cx - width / 2) / width, (cy - height * 0.45) / height) * 1.8);
          const densityScore = 1 - Math.min(1, Math.abs(density - 0.32) / 0.18);
          const edgeScore = scoreEdges(map, width, x, y, size);
          const score = densityScore * 3 + centerScore * 1.2 + edgeScore * 3;
          if (!best || score > best.score) best = { x, y, size, score };
        }
      }
    }
    if (!best) {
      const size = Math.min(image.naturalWidth, image.naturalHeight) * 0.54;
      return { x: (image.naturalWidth - size) / 2, y: image.naturalHeight * 0.28, width: size, height: size, detected: false };
    }
    return {
      x: best.x * image.naturalWidth / width,
      y: best.y * image.naturalHeight / height,
      width: best.size * image.naturalWidth / width,
      height: best.size * image.naturalHeight / height,
      detected: false
    };
  }

  function scoreEdges(map, width, x, y, size) {
    const step = Math.max(3, Math.round(size / 64));
    let rows = 0;
    let cols = 0;
    for (let yy = y; yy < y + size; yy += step) {
      let dark = 0;
      for (let xx = x; xx < x + size; xx++) dark += map[yy * width + xx];
      if (dark > size * 0.08 && dark < size * 0.72) rows++;
    }
    for (let xx = x; xx < x + size; xx += step) {
      let dark = 0;
      for (let yy = y; yy < y + size; yy++) dark += map[yy * width + xx];
      if (dark > size * 0.08 && dark < size * 0.72) cols++;
    }
    return Math.min(rows, cols) / Math.max(1, Math.ceil(size / step));
  }

  function createIntegral(map, width, height) {
    const integral = new Uint32Array((width + 1) * (height + 1));
    for (let y = 1; y <= height; y++) {
      let row = 0;
      for (let x = 1; x <= width; x++) {
        row += map[(y - 1) * width + x - 1];
        integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + row;
      }
    }
    return integral;
  }

  function rectSum(integral, width, x, y, w, h) {
    const stride = width + 1;
    const x2 = x + w;
    const y2 = y + h;
    return integral[y2 * stride + x2] - integral[y * stride + x2] - integral[y2 * stride + x] + integral[y * stride + x];
  }

  function refineDarkRegion(image, region) {
    const base = Math.max(region.width, region.height);
    const centerX = region.x + region.width / 2;
    const centerY = region.y + region.height / 2;
    const cropSize = Math.min(base * 1.08, image.naturalWidth, image.naturalHeight);
    const cropX = clamp(centerX - cropSize / 2, 0, image.naturalWidth - cropSize);
    const cropY = clamp(centerY - cropSize / 2, 0, image.naturalHeight - cropSize);
    const size = Math.max(160, Math.round(Math.min(520, cropSize)));
    const scale = size / cropSize;
    const work = document.createElement("canvas");
    const workCtx = work.getContext("2d", { willReadFrequently: true });
    work.width = size;
    work.height = size;
    workCtx.drawImage(image, cropX, cropY, cropSize, cropSize, 0, 0, size, size);
    const pixels = workCtx.getImageData(0, 0, size, size).data;
    const map = new Uint8Array(size * size);
    for (let index = 0; index < map.length; index++) {
      const pixel = index * 4;
      const r = pixels[pixel];
      const g = pixels[pixel + 1];
      const b = pixels[pixel + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      map[index] = (lum < 118 && max - min < 88) || lum < 72 ? 1 : 0;
    }
    const bounds = denseBounds(map, size, size);
    if (!bounds) return null;
    const pad = Math.round(Math.max(bounds.width, bounds.height) * 0.006);
    const expanded = expandRect(bounds, size, size, pad);
    return {
      x: cropX + expanded.x / scale,
      y: cropY + expanded.y / scale,
      width: expanded.width / scale,
      height: expanded.height / scale,
      detected: region.detected
    };
  }

  function denseBounds(map, width, height) {
    const rows = new Uint16Array(height);
    const cols = new Uint16Array(width);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = map[y * width + x];
        rows[y] += value;
        cols[x] += value;
      }
    }
    const rowBand = strongestBand(rows, width * 0.07, height * 0.45, Math.max(3, Math.round(height * 0.025)));
    const colBand = strongestBand(cols, height * 0.07, width * 0.45, Math.max(3, Math.round(width * 0.025)));
    if (!rowBand || !colBand) return null;
    return { x: colBand.start, y: rowBand.start, width: colBand.end - colBand.start + 1, height: rowBand.end - rowBand.start + 1 };
  }

  function strongestBand(counts, threshold, minLength, maxGap) {
    let best = null;
    let current = null;
    let gap = 0;
    for (let index = 0; index < counts.length; index++) {
      if (counts[index] >= threshold) {
        if (!current) current = { start: index, end: index, score: 0 };
        current.end = index;
        current.score += counts[index];
        gap = 0;
      } else if (current && gap < maxGap) {
        current.end = index;
        gap++;
      } else if (current) {
        best = chooseBand(best, current, minLength);
        current = null;
        gap = 0;
      }
    }
    if (current) best = chooseBand(best, current, minLength);
    return best;
  }

  function chooseBand(best, band, minLength) {
    const length = band.end - band.start + 1;
    if (length < minLength) return best;
    const score = band.score * Math.sqrt(length);
    return !best || score > best.score ? { ...band, score } : best;
  }

  function expandRect(rect, maxWidth, maxHeight, amount) {
    const x = Math.max(0, rect.x - amount);
    const y = Math.max(0, rect.y - amount);
    const right = Math.min(maxWidth, rect.x + rect.width + amount);
    const bottom = Math.min(maxHeight, rect.y + rect.height + amount);
    return { x, y, width: right - x, height: bottom - y };
  }

  function squareRegion(region, imageWidth, imageHeight, padding, detected) {
    const centerX = region.x + region.width / 2;
    const centerY = region.y + region.height / 2;
    const size = Math.min(Math.max(region.width, region.height) * (1 + padding * 2), imageWidth, imageHeight);
    return { x: clamp(centerX - size / 2, 0, imageWidth - size), y: clamp(centerY - size / 2, 0, imageHeight - size), size, detected };
  }

  function setupPaymentCropper(platform) {
    const item = state[platform];
    const image = $(platform + "CropImage");
    const panel = $(platform + "CropPanel");
    if (!item || !image || !panel) return;
    panel.hidden = false;
    if (item.cropper) item.cropper.destroy();
    image.src = item.src;
    if (typeof Cropper === "undefined") {
      controls.status.textContent = "裁切组件加载失败，请检查网络后刷新页面。";
      return;
    }
    requestAnimationFrame(() => {
      item.cropper = new Cropper(image, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: "move",
        autoCropArea: 0.82,
        background: false,
        responsive: true,
        restore: false,
        modal: true,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        ready() {
          this.cropper.setData({ x: item.autoQr.x, y: item.autoQr.y, width: item.autoQr.size, height: item.autoQr.size });
          updatePaymentCropFromCropper(platform);
        },
        crop() {
          updatePaymentCropFromCropper(platform);
        }
      });
    });
  }

  function updatePaymentCropFromCropper(platform) {
    const item = state[platform];
    if (!item || !item.cropper) return;
    const data = item.cropper.getData(true);
    const size = Math.max(1, Math.min(data.width, data.height));
    item.qr = { x: clamp(data.x, 0, item.width - size), y: clamp(data.y, 0, item.height - size), size, detected: Boolean(item.autoQr && item.autoQr.detected) };
    render();
  }

  function resetPaymentCropper(platform) {
    const item = state[platform];
    if (!item || !item.cropper || !item.autoQr) return;
    item.cropper.setData({ x: item.autoQr.x, y: item.autoQr.y, width: item.autoQr.size, height: item.autoQr.size });
    updatePaymentCropFromCropper(platform);
  }

  function updateMeta(platform) {
    const item = state[platform];
    controls[`${platform}Meta`].textContent = `${item.name} · ${item.width} × ${item.height}px · ${item.qr.detected ? "已识别" : "已估算"}`;
  }

  function setLayout(layout) {
    state.layout = layout;
    controls.landscapeBtn.classList.toggle("active", layout === "landscape");
    controls.portraitBtn.classList.toggle("active", layout === "portrait");
    controls.layoutValue.textContent = layout === "landscape" ? "横版 4:3" : "竖版 9:16";
    updateBackgroundAspect();
    render();
  }

  function setFrameMode(mode) {
    state.frameMode = mode;
    controls.frameNoneBtn.classList.toggle("active", mode === "none");
    controls.frameBorderBtn.classList.toggle("active", mode === "border");
    controls.frameFillBtn.classList.toggle("active", mode === "fill");
    controls.frameModeValue.textContent = mode === "none" ? "无" : mode === "border" ? "边框" : "填充";
    render();
  }

  function getBackgroundAspectRatio() {
    return state.layout === "landscape" ? 4 / 3 : 9 / 16;
  }

  function setupBackgroundCropper() {
    if (!state.backgroundImage || !controls.bgCropImage || typeof Cropper === "undefined") return;
    controls.bgCropPanel.hidden = false;
    controls.bgCropRatio.textContent = state.layout === "landscape" ? "横版 4:3" : "竖版 9:16";
    if (state.backgroundCropper) state.backgroundCropper.destroy();
    controls.bgCropImage.src = state.backgroundImageSrc;
    requestAnimationFrame(() => {
      state.backgroundCropper = new Cropper(controls.bgCropImage, {
        aspectRatio: getBackgroundAspectRatio(),
        viewMode: 1,
        dragMode: "move",
        autoCropArea: 0.9,
        background: false,
        responsive: true,
        restore: false,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        ready() {
          setBackgroundCropToLargestArea();
          updateBackgroundCropFromCropper();
        },
        crop() {
          updateBackgroundCropFromCropper();
        }
      });
    });
  }

  function updateBackgroundAspect() {
    if (controls.bgCropRatio) controls.bgCropRatio.textContent = state.layout === "landscape" ? "横版 4:3" : "竖版 9:16";
    if (!state.backgroundCropper) return;
    state.backgroundCropper.setAspectRatio(getBackgroundAspectRatio());
    setBackgroundCropToLargestArea();
    updateBackgroundCropFromCropper();
  }

  function setBackgroundCropToLargestArea() {
    if (!state.backgroundCropper || !state.backgroundImage) return;
    const width = state.backgroundImage.naturalWidth || state.backgroundImage.width || 1;
    const height = state.backgroundImage.naturalHeight || state.backgroundImage.height || 1;
    const ratio = getBackgroundAspectRatio();
    let cropWidth = width;
    let cropHeight = width / ratio;
    if (cropHeight > height) {
      cropHeight = height;
      cropWidth = height * ratio;
    }
    state.backgroundCropper.setData({
      x: (width - cropWidth) / 2,
      y: (height - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight
    });
  }

  function updateBackgroundCropFromCropper() {
    if (!state.backgroundCropper || !state.backgroundImage) return;
    const data = state.backgroundCropper.getData(true);
    state.backgroundCrop = { x: data.x, y: data.y, width: Math.max(1, data.width), height: Math.max(1, data.height) };
    render();
  }

  function roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function fillRound(x, y, width, height, radius, fill, stroke, lineWidth = 0) {
    roundedRect(x, y, width, height, radius);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke && lineWidth) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  function drawText(text, x, y, size, weight, color, align = "center") {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }

  function drawBackground(width, height) {
    ctx.fillStyle = colors.page;
    ctx.fillRect(0, 0, width, height);
    if (state.backgroundImage && state.backgroundCrop) {
      ctx.save();
      ctx.globalAlpha = state.backgroundImageOpacity / 100;
      ctx.drawImage(state.backgroundImage, state.backgroundCrop.x, state.backgroundCrop.y, state.backgroundCrop.width, state.backgroundCrop.height, 0, 0, width, height);
      ctx.restore();
    }
    if (state.backgroundColorOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = state.backgroundColorOpacity / 100;
      ctx.fillStyle = state.backgroundColor;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 6;
    roundedRect(42, 42, width - 84, height - 84, 54);
    ctx.stroke();
  }

  function drawQr(platform, x, y, size) {
    const item = state[platform];
    if (!item) {
      ctx.save();
      ctx.setLineDash([14, 12]);
      ctx.strokeStyle = "#b8c6bc";
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 26, y + 26, size - 52, size - 52);
      ctx.restore();
      drawText("等待上传", x + size / 2, y + size / 2, 40, "800", colors.muted);
      return;
    }
    const source = item.qr;
    ctx.drawImage(item.image, source.x, source.y, source.size, source.size, x, y, size, size);
  }

  function drawCard(platform, label, x, y, width, height, qrSize) {
    const color = platform === "wechat" ? colors.wechat : colors.alipay;
    const filled = state.frameMode === "fill";
    const stroke = state.frameMode === "border" ? color : null;
    const fill = filled ? color : null;
    const textColor = filled ? "#fff" : state.footerColor;
    const tagFill = filled ? "#fff" : color;
    const tagText = filled ? color : "#fff";
    fillRound(x, y, width, height, 48, fill, stroke, 8);
    fillRound(x + 38, y + 38, 196, 66, 24, tagFill, null, 0);
    drawText(label, x + 136, y + 71, 30, "850", tagText);
    drawQr(platform, x + (width - qrSize) / 2, y + Math.round(height * (state.layout === "portrait" ? 0.18 : 0.17)), qrSize);
    drawText(platform === "wechat" ? "微信扫码付款" : "支付宝扫码付款", x + width / 2, y + height - 62, 34, "850", textColor);
  }

  function renderLandscape() {
    canvas.width = 2400;
    canvas.height = 1800;
    drawBackground(2400, 1800);
    drawText(state.title, 1200, 165, 86, "900", state.titleColor);
    drawText(state.subtitle, 1200, 245, 34, "650", state.subtitleColor);
    drawCard("wechat", "微信", 150, 360, 1000, 1160, 760);
    drawCard("alipay", "支付宝", 1250, 360, 1000, 1160, 760);
    drawText(state.footer, 1200, 1650, 38, "750", state.footerColor);
  }

  function renderPortrait() {
    canvas.width = 1440;
    canvas.height = 2560;
    drawBackground(1440, 2560);
    drawText(state.title, 720, 145, 76, "900", state.titleColor);
    drawText(state.subtitle, 720, 215, 30, "650", state.subtitleColor);
    drawCard("wechat", "微信", 220, 310, 1000, 1000, 650);
    drawCard("alipay", "支付宝", 220, 1370, 1000, 1000, 650);
    drawText(state.footer, 720, 2430, 34, "750", state.footerColor);
  }

  function render() {
    if (state.layout === "landscape") renderLandscape();
    else renderPortrait();
    const ready = Boolean(state.wechat && state.alipay);
    controls.downloadBtn.disabled = !ready;
    controls.status.textContent = ready ? "已更新预览，可以下载 PNG。" : "请先导入两张收款码图片。";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function download() {
    if (controls.downloadBtn.disabled) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = state.layout === "landscape" ? "only-box-payment-landscape.png" : "only-box-payment-portrait.png";
    link.click();
  }

  function bindDropUpload() {
    document.querySelectorAll(".mini-upload[data-platform]").forEach(zone => {
      const platform = zone.dataset.platform;
      ["dragenter", "dragover"].forEach(type => {
        zone.addEventListener(type, event => {
          event.preventDefault();
          zone.classList.add("drag");
        });
      });
      ["dragleave", "drop"].forEach(type => {
        zone.addEventListener(type, event => {
          event.preventDefault();
          zone.classList.remove("drag");
        });
      });
      zone.addEventListener("drop", event => loadPaymentImage(event.dataTransfer.files[0], platform));
    });
  }

  controls.wechatInput.addEventListener("change", event => { const file = event.target.files[0]; event.target.value = ""; if (file) loadPaymentImage(file, "wechat"); });
  controls.alipayInput.addEventListener("change", event => { const file = event.target.files[0]; event.target.value = ""; if (file) loadPaymentImage(file, "alipay"); });
  controls.landscapeBtn.addEventListener("click", () => setLayout("landscape"));
  controls.portraitBtn.addEventListener("click", () => setLayout("portrait"));
  controls.frameNoneBtn.addEventListener("click", () => setFrameMode("none"));
  controls.frameBorderBtn.addEventListener("click", () => setFrameMode("border"));
  controls.frameFillBtn.addEventListener("click", () => setFrameMode("fill"));
  controls.titleInput.addEventListener("input", event => { state.title = event.target.value; render(); });
  controls.subtitleInput.addEventListener("input", event => { state.subtitle = event.target.value; render(); });
  controls.footerInput.addEventListener("input", event => { state.footer = event.target.value; render(); });
  controls.titleColorInput.addEventListener("input", event => { state.titleColor = event.target.value; render(); });
  controls.subtitleColorInput.addEventListener("input", event => { state.subtitleColor = event.target.value; render(); });
  controls.footerColorInput.addEventListener("input", event => { state.footerColor = event.target.value; render(); });
  controls.bgColorInput.addEventListener("input", event => syncBgColor(event.target.value));
  controls.bgColorHexInput.addEventListener("input", event => syncBgColor(event.target.value));
  controls.bgColorOpacityRange.addEventListener("input", event => {
    state.backgroundColorOpacity = Number(event.target.value);
    controls.bgColorOpacityValue.textContent = `${event.target.value}%`;
    render();
  });
  controls.bgImageOpacityRange.addEventListener("input", event => {
    state.backgroundImageOpacity = Number(event.target.value);
    controls.bgImageOpacityValue.textContent = `${event.target.value}%`;
    render();
  });
  controls.bgImageScaleRange.addEventListener("input", event => {
    state.backgroundImageScale = Number(event.target.value);
    controls.bgImageScaleValue.textContent = `${event.target.value}%`;
    if (state.backgroundCropper) state.backgroundCropper.zoomTo(state.backgroundImageScale / 100);
    render();
  });
  controls.bgInput.addEventListener("change", async event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const token = ++state.backgroundLoadToken;
    controls.status.textContent = "正在读取背景图片……";
    try {
      const opened = await MobileImageUpload.open(file);
      if (token !== state.backgroundLoadToken) {
        opened.release();
        return;
      }
      if (state.backgroundCropper) state.backgroundCropper.destroy();
      state.backgroundCropper = null;
      if (state.backgroundRelease) state.backgroundRelease();
      state.backgroundRelease = opened.release;
      state.backgroundImageSrc = opened.src;
      state.backgroundImage = opened.image;
      state.backgroundColorOpacity = 0;
      controls.bgColorOpacityRange.value = "0";
      controls.bgColorOpacityValue.textContent = "0%";
      setupBackgroundCropper();
      controls.status.textContent = opened.converted ? "HEIC 背景已转换。" : "背景图片已载入。";
      render();
    } catch (error) {
      controls.status.textContent = MobileImageUpload.errorMessage(error);
    }
  });
  controls.clearBgBtn.addEventListener("click", () => {
    if (state.backgroundCropper) state.backgroundCropper.destroy();
    state.backgroundCropper = null;
    state.backgroundCrop = null;
    state.backgroundImage = null;
    state.backgroundImageSrc = "";
    if (state.backgroundRelease) state.backgroundRelease();
    state.backgroundRelease = null;
    controls.bgCropPanel.hidden = true;
    controls.bgInput.value = "";
    state.backgroundColorOpacity = 100;
    controls.bgColorOpacityRange.value = "100";
    controls.bgColorOpacityValue.textContent = "100%";
    render();
  });
  controls.downloadBtn.addEventListener("click", download);
  controls.bgColorSwatch.style.backgroundColor = state.backgroundColor;
  controls.bgColorHexInput.value = state.backgroundColor;
  bindDropUpload();
  ["wechat", "alipay"].forEach(platform => {
    const reset = $(`${platform}CropReset`);
    if (reset) reset.addEventListener("click", () => resetPaymentCropper(platform));
  });
  window.addEventListener("beforeunload", () => {
    [state.wechat, state.alipay].forEach(item => { if (item && item.release) item.release(); });
    if (state.backgroundRelease) state.backgroundRelease();
  });
  render();
})();

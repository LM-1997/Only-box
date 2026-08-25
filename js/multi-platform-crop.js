(() => {
  "use strict";

  /* 比例数值参考 2025 年各平台公开推荐尺寸：
     小红书竖版图文封面 3:4；微信公众号封面 900×383；微博横图 16:9；
     微信朋友圈/通用方图 1:1；竖版全屏（视频封面/手机海报）9:16。 */
  const PLATFORMS = [
    { key: "xhs", label: "小红书封面", ratio: 3 / 4, ratioLabel: "3:4", width: 1242, height: 1656, checked: true },
    { key: "wechat", label: "公众号头图", ratio: 900 / 383, ratioLabel: "2.35:1", width: 900, height: 383, checked: true },
    { key: "weibo", label: "微博横图", ratio: 16 / 9, ratioLabel: "16:9", width: 1280, height: 720, checked: false },
    { key: "square", label: "朋友圈方图", ratio: 1, ratioLabel: "1:1", width: 1080, height: 1080, checked: true },
    { key: "story", label: "竖版全屏", ratio: 9 / 16, ratioLabel: "9:16", width: 1080, height: 1920, checked: false }
  ];

  const state = {
    activeKey: "xhs",
    cropsByPlatform: {},  // key -> cropper.getData() 结果
    cropper: null,
    releaseImage: null,
    loadToken: 0,
    thumbTimer: 0,
    updatingThumbs: false  // 程序化 setData/setAspectRatio 期间不再调度缩略图，避免循环
  };

  const $ = id => document.getElementById(id);
  const controls = {
    dropzone: $("dropzone"),
    fileInput: $("fileInput"),
    workPanel: $("workPanel"),
    thumbPanel: $("thumbPanel"),
    stage: $("stage"),
    stageImg: $("stageImg"),
    platformList: $("platformList"),
    thumbGrid: $("thumbGrid"),
    zipBtn: $("zipBtn"),
    cropStatus: $("cropStatus"),
    status: $("status")
  };

  function activePlatform() {
    return PLATFORMS.find(item => item.key === state.activeKey);
  }

  function checkedPlatforms() {
    return PLATFORMS.filter(item => item.checked);
  }

  function renderPlatformList() {
    controls.platformList.innerHTML = "";
    PLATFORMS.forEach(platform => {
      const row = document.createElement("label");
      row.className = "platform-item" + (platform.key === state.activeKey ? " active" : "");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = platform.checked;
      checkbox.setAttribute("aria-label", platform.label + " 是否导出");
      checkbox.addEventListener("click", event => {
        event.stopPropagation();
      });
      checkbox.addEventListener("change", () => {
        platform.checked = checkbox.checked;
        renderThumbnails();
      });
      const body = document.createElement("span");
      body.className = "p-body";
      const name = document.createElement("strong");
      name.textContent = platform.label;
      const size = document.createElement("span");
      size.textContent = platform.width + " × " + platform.height + "px";
      body.append(name, size);
      const badge = document.createElement("span");
      badge.className = "ratio-badge";
      badge.textContent = platform.ratioLabel;
      row.append(checkbox, body, badge);
      row.addEventListener("click", () => switchPlatform(platform.key));
      controls.platformList.appendChild(row);
    });
  }

  /* 切换比例：先保存当前比例裁切数据，再 setAspectRatio 并还原目标比例数据。 */
  function switchPlatform(key) {
    if (key === state.activeKey || !state.cropper) {
      state.activeKey = key;
      renderPlatformList();
      return;
    }
    saveCurrentCrop();
    state.activeKey = key;
    const platform = activePlatform();
    state.cropper.setAspectRatio(platform.ratio);
    const saved = state.cropsByPlatform[key];
    if (saved) {
      state.cropper.setData(saved);
    } else {
      setLargestArea(platform);
    }
    controls.cropStatus.textContent = "正在编辑「" + platform.label + "」" + platform.ratioLabel + " 的裁切范围。";
    renderPlatformList();
    renderThumbnails();
  }

  function saveCurrentCrop() {
    if (!state.cropper) return;
    state.cropsByPlatform[state.activeKey] = state.cropper.getData(true);
  }

  function setLargestArea(platform) {
    if (!state.cropper || !controls.stageImg.naturalWidth) return;
    const width = controls.stageImg.naturalWidth;
    const height = controls.stageImg.naturalHeight;
    const ratio = platform.ratio;
    let cropWidth = width;
    let cropHeight = width / ratio;
    if (cropHeight > height) {
      cropHeight = height;
      cropWidth = height * ratio;
    }
    state.cropper.setData({
      x: (width - cropWidth) / 2,
      y: (height - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight
    });
  }

  function scheduleThumbnails() {
    if (state.updatingThumbs) return;
    clearTimeout(state.thumbTimer);
    state.thumbTimer = setTimeout(renderThumbnails, 200);
  }

  function renderThumbnails() {
    if (!state.cropper || state.updatingThumbs) return;
    state.updatingThumbs = true;
    try {
      renderThumbnailsInner();
    } finally {
      state.updatingThumbs = false;
    }
  }

  function renderThumbnailsInner() {
    if (!state.cropper) return;
    controls.thumbGrid.innerHTML = "";
    const platforms = checkedPlatforms();
    controls.thumbPanel.hidden = platforms.length === 0;
    controls.zipBtn.disabled = platforms.length === 0;
    const savedActive = state.cropsByPlatform[state.activeKey];

    platforms.forEach(platform => {
      const card = document.createElement("div");
      card.className = "thumb-card";
      const thumb = document.createElement("canvas");
      const scale = Math.min(1, 440 / Math.max(platform.width, platform.height));
      thumb.width = Math.round(platform.width * scale);
      thumb.height = Math.round(platform.height * scale);
      if (platform.key === state.activeKey) {
        saveCurrentCrop();
      } else if (state.cropsByPlatform[platform.key]) {
        state.cropper.setData(state.cropsByPlatform[platform.key]);
      }
      const cropped = state.cropper.getCroppedCanvas({ width: thumb.width, height: thumb.height, imageSmoothingQuality: "high" });
      if (cropped) {
        thumb.getContext("2d").drawImage(cropped, 0, 0);
      }
      const meta = document.createElement("div");
      meta.className = "t-meta";
      meta.textContent = platform.label + " · " + platform.ratioLabel;
      card.append(thumb, meta);
      controls.thumbGrid.appendChild(card);
    });

    // 还原当前编辑比例的裁切框，避免预览循环改变编辑状态。
    state.cropper.setAspectRatio(activePlatform().ratio);
    if (savedActive) state.cropper.setData(savedActive);
    else setLargestArea(activePlatform());
  }

  async function loadFile(file) {
    const token = ++state.loadToken;
    let opened = null;
    controls.cropStatus.textContent = "正在读取图片……";
    try {
      opened = await MobileImageUpload.open(file);
      if (token !== state.loadToken) {
        opened.release();
        return;
      }
      await MobileImageUpload.ensureCropper();
      if (token !== state.loadToken) {
        opened.release();
        return;
      }
      if (state.cropper) {
        state.cropper.destroy();
        state.cropper = null;
      }
      if (state.releaseImage) state.releaseImage();
      state.releaseImage = opened.release;
      state.cropsByPlatform = {};
      controls.stageImg.onload = () => {
        controls.workPanel.hidden = false;
        controls.thumbPanel.hidden = false;
        setupCropper();
      };
      controls.stageImg.onerror = () => {
        controls.cropStatus.textContent = "图片显示失败，请换一张图片重试。";
      };
      controls.stageImg.src = opened.src;
      opened = null;
    } catch (error) {
      if (opened) opened.release();
      controls.cropStatus.textContent = MobileImageUpload.errorMessage(error);
    }
  }

  function setupCropper() {
    if (typeof Cropper === "undefined") {
      controls.cropStatus.textContent = "裁切组件加载失败，请检查网络后刷新页面。";
      return;
    }
    const platform = activePlatform();
    state.cropper = new Cropper(controls.stageImg, {
      aspectRatio: platform.ratio,
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
        setLargestArea(platform);
        controls.cropStatus.textContent = "正在编辑「" + platform.label + "」" + platform.ratioLabel + " 的裁切范围。";
        renderThumbnails();
      },
      crop() {
        scheduleThumbnails();
      }
    });
  }

  controls.zipBtn.addEventListener("click", async () => {
    const platforms = checkedPlatforms();
    if (!state.cropper || !platforms.length) return;
    controls.zipBtn.disabled = true;
    controls.status.textContent = "正在生成 " + platforms.length + " 张图片……";
    try {
      const files = [];
      await CanvasUtils.processBatch(platforms, async platform => {
        if (platform.key === state.activeKey) {
          saveCurrentCrop();
        } else if (state.cropsByPlatform[platform.key]) {
          state.cropper.setAspectRatio(platform.ratio);
          state.cropper.setData(state.cropsByPlatform[platform.key]);
        }
        const cropped = state.cropper.getCroppedCanvas({
          width: platform.width,
          height: platform.height,
          imageSmoothingEnabled: true,
          imageSmoothingQuality: "high"
        });
        const blob = await CanvasUtils.canvasToBlob(cropped, "image/png");
        files.push({ name: platform.key + "-" + platform.width + "x" + platform.height + ".png", blob });
        cropped.width = 1;
        cropped.height = 1;
      }, {
        chunkSize: 2,
        onProgress: (done, total) => {
          controls.status.textContent = "正在生成第 " + done + " / " + total + " 张";
        }
      });
      await CanvasUtils.exportZip(files, "platform-crops.zip");
      controls.status.textContent = "ZIP 已下载。";
    } catch (error) {
      controls.status.textContent = "导出失败，请重试或减少勾选的比例。";
    } finally {
      controls.zipBtn.disabled = false;
    }
  });

  ["dragover", "dragenter"].forEach(name => controls.dropzone.addEventListener(name, event => {
    event.preventDefault();
    controls.dropzone.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach(name => controls.dropzone.addEventListener(name, event => {
    event.preventDefault();
    controls.dropzone.classList.remove("drag");
  }));
  controls.dropzone.addEventListener("drop", event => {
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) loadFile(file);
  });
  controls.fileInput.addEventListener("change", event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) loadFile(file);
  });

  window.addEventListener("beforeunload", () => {
    clearTimeout(state.thumbTimer);
    if (state.cropper) state.cropper.destroy();
    if (state.releaseImage) state.releaseImage();
  });

  renderPlatformList();
})();

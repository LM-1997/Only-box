(() => {
  "use strict";

  const MAX_IMAGES = 30;

  const state = {
    size: 400,
    shape: "circle",
    items: [],          // { id, name, image, src, release, resultCanvas, done }
    loadToken: 0,
    cropper: null,
    editingId: null
  };

  const $ = id => document.getElementById(id);
  const controls = {
    dropzone: $("dropzone"),
    fileInput: $("fileInput"),
    sizeInput: $("sizeInput"),
    zipBtn: $("zipBtn"),
    gridPanel: $("gridPanel"),
    avatarGrid: $("avatarGrid"),
    status: $("status"),
    cropModal: $("cropModal"),
    modalImg: $("modalImg"),
    modalCancelBtn: $("modalCancelBtn"),
    modalConfirmBtn: $("modalConfirmBtn")
  };

  /* 自动初裁：中心最大正方形 + drawCover 到目标画布。 */
  function autoCrop(item) {
    const canvas = document.createElement("canvas");
    canvas.width = state.size;
    canvas.height = state.size;
    const targetCtx = canvas.getContext("2d");
    targetCtx.fillStyle = "#ffffff";
    targetCtx.fillRect(0, 0, state.size, state.size);
    CanvasUtils.drawCover(targetCtx, item.image, 0, 0, state.size, state.size);
    return canvas;
  }

  function applyShape(canvas) {
    if (state.shape !== "circle") return canvas;
    const rounded = document.createElement("canvas");
    rounded.width = canvas.width;
    rounded.height = canvas.height;
    const targetCtx = rounded.getContext("2d");
    targetCtx.save();
    targetCtx.beginPath();
    const r = Math.min(rounded.width, rounded.height) / 2;
    targetCtx.arc(rounded.width / 2, rounded.height / 2, r, 0, Math.PI * 2);
    targetCtx.clip();
    targetCtx.drawImage(canvas, 0, 0);
    targetCtx.restore();
    return rounded;
  }

  function renderGrid() {
    controls.avatarGrid.innerHTML = "";
    state.items.forEach(item => {
      const card = document.createElement("div");
      card.className = "avatar-card" + (item.done ? " done" : "");
      const wrap = document.createElement("div");
      wrap.className = "thumb-wrap";
      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = 200;
      previewCanvas.height = 200;
      previewCanvas.setAttribute("aria-label", item.name + " 裁切预览");
      const previewCtx = previewCanvas.getContext("2d");
      previewCtx.drawImage(applyShape(item.resultCanvas), 0, 0, 200, 200);
      wrap.appendChild(previewCanvas);
      const meta = document.createElement("div");
      meta.className = "a-meta";
      const name = document.createElement("span");
      name.textContent = item.name;
      name.title = item.name;
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = item.done ? "重新精调" : "精调";
      editBtn.addEventListener("click", () => openModal(item.id));
      meta.append(name, editBtn);
      card.append(wrap, meta);
      controls.avatarGrid.appendChild(card);
    });
    controls.gridPanel.hidden = state.items.length === 0;
    controls.zipBtn.disabled = state.items.length === 0;
  }

  async function loadFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, MAX_IMAGES);
    if (!files.length) return;
    const token = ++state.loadToken;
    controls.status.textContent = "正在读取 " + files.length + " 张照片……";
    const openedList = [];
    try {
      for (const file of files) {
        const opened = await MobileImageUpload.open(file);
        if (token !== state.loadToken) {
          opened.release();
          openedList.forEach(item => item.release());
          return;
        }
        openedList.push(opened);
      }
      if (token !== state.loadToken) {
        openedList.forEach(item => item.release());
        return;
      }
      releaseAll();
      state.items = openedList.map((opened, index) => {
        const item = {
          id: index + 1,
          name: CanvasUtils.sanitizeFilename(opened.originalFile ? opened.originalFile.name.replace(/\.[^.]+$/, "") : "avatar-" + (index + 1), "avatar-" + (index + 1)),
          image: opened.image,
          src: opened.src,
          release: opened.release,
          resultCanvas: null,
          done: false
        };
        item.resultCanvas = autoCrop(item);
        return item;
      });
      renderGrid();
      controls.status.textContent = "已导入 " + state.items.length + " 张照片，全部按中心正方形自动初裁。点击“精调”可逐张确认。";
    } catch (error) {
      openedList.forEach(item => item.release && item.release());
      controls.status.textContent = MobileImageUpload.errorMessage(error);
    }
  }

  /* 单实例精调：打开弹层时 new Cropper，确认/取消后 destroy。 */
  async function openModal(id) {
    const item = state.items.find(entry => entry.id === id);
    if (!item) return;
    await MobileImageUpload.ensureCropper();
    if (typeof Cropper === "undefined") {
      controls.status.textContent = "裁切组件加载失败，请检查网络后刷新页面。";
      return;
    }
    state.editingId = id;
    controls.cropModal.hidden = false;
    controls.modalImg.src = item.src;
    requestAnimationFrame(() => {
      state.cropper = new Cropper(controls.modalImg, {
        aspectRatio: 1,
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
        toggleDragModeOnDblclick: false
      });
    });
  }

  function closeModal() {
    if (state.cropper) {
      state.cropper.destroy();
      state.cropper = null;
    }
    controls.modalImg.src = "";
    controls.cropModal.hidden = true;
    state.editingId = null;
  }

  controls.modalConfirmBtn.addEventListener("click", () => {
    const item = state.items.find(entry => entry.id === state.editingId);
    if (!item || !state.cropper) {
      closeModal();
      return;
    }
    const cropped = state.cropper.getCroppedCanvas({
      width: state.size,
      height: state.size,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high"
    });
    if (cropped) {
      if (item.resultCanvas) {
        item.resultCanvas.width = 1;
        item.resultCanvas.height = 1;
      }
      item.resultCanvas = cropped;
      item.done = true;
    }
    closeModal();
    renderGrid();
    controls.status.textContent = "“" + item.name + "”已按精调结果更新。";
  });

  controls.modalCancelBtn.addEventListener("click", closeModal);
  controls.cropModal.addEventListener("click", event => {
    if (event.target === controls.cropModal) closeModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !controls.cropModal.hidden) closeModal();
  });

  controls.sizeInput.addEventListener("change", () => {
    let value = parseInt(controls.sizeInput.value, 10);
    if (Number.isNaN(value)) value = 400;
    value = Math.min(1000, Math.max(100, value));
    controls.sizeInput.value = value;
    state.size = value;
    // 尺寸变化后重算全部自动初裁；已精调的也按新尺寸从原图重新居中生成。
    state.items.forEach(item => {
      if (item.resultCanvas) {
        item.resultCanvas.width = 1;
        item.resultCanvas.height = 1;
      }
      item.resultCanvas = autoCrop(item);
      item.done = false;
    });
    renderGrid();
  });

  document.querySelectorAll("[data-shape]").forEach(button => {
    button.addEventListener("click", () => {
      state.shape = button.dataset.shape;
      document.querySelectorAll("[data-shape]").forEach(other => {
        const active = other === button;
        other.classList.toggle("active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      renderGrid();
    });
  });

  controls.zipBtn.addEventListener("click", async () => {
    if (!state.items.length) return;
    controls.zipBtn.disabled = true;
    controls.status.textContent = "正在生成头像文件……";
    try {
      const files = [];
      const usedNames = new Map();
      await CanvasUtils.processBatch(state.items, async item => {
        const shaped = applyShape(item.resultCanvas);
        const blob = await CanvasUtils.canvasToBlob(shaped, "image/png");
        files.push({ name: CanvasUtils.uniqueFilename(item.name, usedNames), blob });
        if (shaped !== item.resultCanvas) {
          shaped.width = 1;
          shaped.height = 1;
        }
      }, {
        chunkSize: 5,
        onProgress: (done, total) => {
          controls.status.textContent = "正在生成第 " + done + " / " + total + " 张";
        }
      });
      await CanvasUtils.exportZip(files, "avatars-" + state.shape + ".zip");
      controls.status.textContent = "ZIP 已下载。";
    } catch (error) {
      controls.status.textContent = "导出失败，请重试或减少照片数量。";
    } finally {
      controls.zipBtn.disabled = false;
    }
  });

  function releaseAll() {
    state.items.forEach(item => item.release());
    state.items = [];
  }

  ["dragover", "dragenter"].forEach(name => controls.dropzone.addEventListener(name, event => {
    event.preventDefault();
    controls.dropzone.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach(name => controls.dropzone.addEventListener(name, event => {
    event.preventDefault();
    controls.dropzone.classList.remove("drag");
  }));
  controls.dropzone.addEventListener("drop", event => loadFiles(event.dataTransfer.files));
  controls.fileInput.addEventListener("change", event => {
    loadFiles(event.target.files);
    event.target.value = "";
  });

  window.addEventListener("beforeunload", () => {
    if (state.cropper) state.cropper.destroy();
    releaseAll();
  });
})();

(() => {
  "use strict";

  const PAGE_WIDTH = 2480;  // A4 300dpi
  const PAGE_HEIGHT = 3508;
  const GRIDS = {
    "2x2": { cols: 2, rows: 2 },
    "2x3": { cols: 2, rows: 3 },
    "3x3": { cols: 3, rows: 3 },
    "2x4": { cols: 2, rows: 4 }
  };
  const MAX_IMAGES = 36;

  const state = {
    grid: "2x2",
    fill: "cover",
    margin: 80,
    marks: true,
    images: [],          // { image, release, name }
    loadToken: 0,
    pages: [],           // 每页 { canvas, index }
    activePage: 0
  };

  const $ = id => document.getElementById(id);
  const controls = {
    dropzone: $("dropzone"),
    fileInput: $("fileInput"),
    marginInput: $("marginInput"),
    marksCheck: $("marksCheck"),
    status: $("status"),
    resultPanel: $("resultPanel"),
    pagesStrip: $("pagesStrip"),
    pageIndicator: $("pageIndicator"),
    pagePrevBtn: $("pagePrevBtn"),
    pageNextBtn: $("pageNextBtn"),
    downloadPageBtn: $("downloadPageBtn"),
    zipBtn: $("zipBtn"),
    gridHelp: $("gridHelp")
  };

  function cellsPerPage() {
    const grid = GRIDS[state.grid];
    return grid.cols * grid.rows;
  }

  function pageCount() {
    return Math.max(1, Math.ceil(state.images.length / cellsPerPage()));
  }

  function drawCropMarks(targetCtx, cell) {
    const len = Math.min(46, cell.dw * 0.08);
    targetCtx.save();
    targetCtx.strokeStyle = "#9aa5a0";
    targetCtx.lineWidth = 3;
    targetCtx.setLineDash([12, 12]);
    const corners = [
      [cell.dx, cell.dy, 1, 1],
      [cell.dx + cell.dw, cell.dy, -1, 1],
      [cell.dx, cell.dy + cell.dh, 1, -1],
      [cell.dx + cell.dw, cell.dy + cell.dh, -1, -1]
    ];
    corners.forEach(([x, y, dirX, dirY]) => {
      targetCtx.beginPath();
      targetCtx.moveTo(x, y);
      targetCtx.lineTo(x + len * dirX, y);
      targetCtx.moveTo(x, y);
      targetCtx.lineTo(x, y + len * dirY);
      targetCtx.stroke();
    });
    targetCtx.restore();
  }

  function drawPage(pageIndex) {
    const grid = GRIDS[state.grid];
    const cells = CanvasUtils.printGridCells(PAGE_WIDTH, PAGE_HEIGHT, grid.cols, grid.rows, state.margin);
    const page = document.createElement("canvas");
    page.width = PAGE_WIDTH;
    page.height = PAGE_HEIGHT;
    const pageCtx = page.getContext("2d");
    pageCtx.fillStyle = "#ffffff";
    pageCtx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

    const start = pageIndex * cells.length;
    const end = Math.min(start + cells.length, state.images.length);
    for (let i = start; i < end; i++) {
      const cell = cells[i - start];
      const img = state.images[i].image;
      if (state.fill === "cover") CanvasUtils.drawCover(pageCtx, img, cell.dx, cell.dy, cell.dw, cell.dh);
      else CanvasUtils.drawContain(pageCtx, img, cell.dx, cell.dy, cell.dw, cell.dh);
      if (state.marks) drawCropMarks(pageCtx, cell);
    }
    return page;
  }

  function releaseImages() {
    state.images.forEach(item => item.release());
    state.images = [];
  }

  function renderPages() {
    state.pages.forEach(page => {
      page.canvas.width = 1;
      page.canvas.height = 1;
    });
    state.pages = [];
    const total = pageCount();
    for (let p = 0; p < total; p++) {
      state.pages.push({ canvas: drawPage(p), index: p });
    }
    state.activePage = Math.min(state.activePage, total - 1);
    renderStrip();
    controls.resultPanel.hidden = state.pages.length === 0 || state.images.length === 0;
  }

  function renderStrip() {
    controls.pagesStrip.innerHTML = "";
    state.pages.forEach(page => {
      const card = document.createElement("div");
      card.className = "page-card";
      const thumb = document.createElement("canvas");
      thumb.width = 440;
      thumb.height = Math.round(440 * PAGE_HEIGHT / PAGE_WIDTH);
      const thumbCtx = thumb.getContext("2d");
      thumbCtx.fillStyle = "#fff";
      thumbCtx.fillRect(0, 0, thumb.width, thumb.height);
      thumbCtx.drawImage(page.canvas, 0, 0, thumb.width, thumb.height);
      const meta = document.createElement("div");
      meta.className = "page-meta";
      meta.textContent = "第 " + (page.index + 1) + " 页";
      card.append(thumb, meta);
      card.addEventListener("click", () => {
        state.activePage = page.index;
        updatePager();
      });
      controls.pagesStrip.appendChild(card);
    });
    updatePager();
  }

  function updatePager() {
    const total = state.pages.length;
    controls.pageIndicator.textContent = "第 " + (state.activePage + 1) + " / " + total + " 页";
    controls.pagePrevBtn.disabled = state.activePage <= 0;
    controls.pageNextBtn.disabled = state.activePage >= total - 1;
    controls.downloadPageBtn.disabled = total === 0;
  }

  async function loadFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, MAX_IMAGES);
    if (!files.length) return;
    const token = ++state.loadToken;
    controls.status.textContent = "正在读取 " + files.length + " 张图片……";
    const openedList = [];
    try {
      for (const file of files) {
        const opened = await MobileImageUpload.open(file);
        if (token !== state.loadToken) {
          opened.release();
          openedList.forEach(item => item.release());
          return;
        }
        openedList.push({ image: opened.image, release: opened.release, name: file.name });
      }
      if (token !== state.loadToken) {
        openedList.forEach(item => item.release());
        return;
      }
      releaseImages();
      state.images = openedList;
      state.activePage = 0;
      renderPages();
      const grid = GRIDS[state.grid];
      controls.status.textContent = "已排入 " + state.images.length + " 张图片，共 " + state.pages.length + " 页（每页 " + grid.cols + " × " + grid.rows + "）。";
    } catch (error) {
      openedList.forEach(item => item.release());
      controls.status.textContent = MobileImageUpload.errorMessage(error);
    }
  }

  function syncGridHelp() {
    const grid = GRIDS[state.grid];
    controls.gridHelp.textContent = "A4 竖版 300dpi：2480 × 3508px，每页 " + grid.cols + " × " + grid.rows + " = " + (grid.cols * grid.rows) + " 格";
  }

  document.querySelectorAll("[data-grid]").forEach(button => {
    button.addEventListener("click", () => {
      state.grid = button.dataset.grid;
      document.querySelectorAll("[data-grid]").forEach(other => {
        const active = other === button;
        other.classList.toggle("active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      syncGridHelp();
      if (state.images.length) renderPages();
    });
  });

  document.querySelectorAll("[data-fill]").forEach(button => {
    button.addEventListener("click", () => {
      state.fill = button.dataset.fill;
      document.querySelectorAll("[data-fill]").forEach(other => {
        const active = other === button;
        other.classList.toggle("active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      if (state.images.length) renderPages();
    });
  });

  controls.marginInput.addEventListener("change", () => {
    let value = parseInt(controls.marginInput.value, 10);
    if (Number.isNaN(value)) value = 80;
    value = Math.min(400, Math.max(20, value));
    controls.marginInput.value = value;
    state.margin = value;
    if (state.images.length) renderPages();
  });

  controls.marksCheck.addEventListener("change", () => {
    state.marks = controls.marksCheck.checked;
    if (state.images.length) renderPages();
  });

  controls.pagePrevBtn.addEventListener("click", () => {
    if (state.activePage > 0) {
      state.activePage--;
      updatePager();
    }
  });
  controls.pageNextBtn.addEventListener("click", () => {
    if (state.activePage < state.pages.length - 1) {
      state.activePage++;
      updatePager();
    }
  });

  controls.downloadPageBtn.addEventListener("click", async () => {
    const page = state.pages[state.activePage];
    if (!page) return;
    const blob = await CanvasUtils.canvasToBlob(page.canvas, "image/png");
    CanvasUtils.downloadBlob(blob, "a4-layout-page-" + (page.index + 1) + ".png");
    controls.status.textContent = "第 " + (page.index + 1) + " 页 PNG 已下载。";
  });

  controls.zipBtn.addEventListener("click", async () => {
    if (!state.pages.length) return;
    controls.zipBtn.disabled = true;
    controls.status.textContent = "正在打包 " + state.pages.length + " 页……";
    try {
      const files = [];
      for (const page of state.pages) {
        const blob = await CanvasUtils.canvasToBlob(page.canvas, "image/png");
        files.push({ name: "a4-layout-page-" + String(page.index + 1).padStart(2, "0") + ".png", blob });
      }
      await CanvasUtils.exportZip(files, "a4-layout-pages.zip");
      controls.status.textContent = "ZIP 已下载。";
    } catch (error) {
      controls.status.textContent = "打包失败，请改为逐页下载。";
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
  controls.dropzone.addEventListener("drop", event => loadFiles(event.dataTransfer.files));
  controls.fileInput.addEventListener("change", event => {
    loadFiles(event.target.files);
    event.target.value = "";
  });

  window.addEventListener("beforeunload", releaseImages);

  syncGridHelp();
})();

(() => {
  "use strict";

  const CANVAS_WIDTH = 1000;
  const PADDING = 72;
  const ROW_GAP = 18;
  const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

  const state = {
    title: "价目表",
    note: "",
    items: [
      { id: 1, name: "亚克力立牌", price: "35" },
      { id: 2, name: "明信片（一张）", price: "8" },
      { id: 3, name: "徽章（任意三枚）", price: "20" }
    ],
    nextId: 4,
    renderTimer: 0
  };

  const $ = id => document.getElementById(id);
  const canvas = $("previewCanvas");
  const ctx = canvas.getContext("2d");
  const itemRows = $("itemRows");
  const controls = {
    titleInput: $("titleInput"),
    noteInput: $("noteInput"),
    addRowBtn: $("addRowBtn"),
    downloadBtn: $("downloadBtn"),
    status: $("status")
  };

  /* 防抖渲染：输入 150ms 后统一重绘，避免逐字符重排卡顿。 */
  function scheduleRender() {
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(render, 150);
  }

  function fontOf(size, weight) {
    return weight + " " + size + "px " + FONT_STACK;
  }

  function measureRows() {
    ctx.font = fontOf(30, "600");
    const maxWidth = CANVAS_WIDTH - PADDING * 2 - 160;
    return state.items.map(item => {
      const lines = CanvasUtils.wrapTextWithLimit(ctx, item.name || "（未命名）", maxWidth, 2);
      return { item, lines };
    });
  }

  function computeHeight(measured) {
    let height = PADDING + 96 + 56; // 顶部留白 + 标题区 + 标题与列表间距
    measured.forEach(entry => {
      height += entry.lines.length * 40 + 26 + ROW_GAP;
    });
    height += 40;
    if (state.note.trim()) height += 48;
    height += PADDING - 18;
    return Math.max(640, height);
  }

  function render() {
    const measured = measureRows();
    const height = computeHeight(measured);
    if (canvas.width !== CANVAS_WIDTH || canvas.height !== height) {
      canvas.width = CANVAS_WIDTH;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, CANVAS_WIDTH, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, height);

    // 标题：字号自适应，超长时最多两行。
    const title = state.title.trim() || "价目表";
    const titleSize = CanvasUtils.fitFontSize(ctx, title, CANVAS_WIDTH - PADDING * 2, { maxFontSize: 58, minFontSize: 26, fontFamily: FONT_STACK, weight: "800" });
    ctx.font = fontOf(titleSize, "800");
    ctx.fillStyle = "#18221d";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const titleLines = CanvasUtils.wrapTextWithLimit(ctx, title, CANVAS_WIDTH - PADDING * 2, 2);
    titleLines.forEach((line, index) => {
      ctx.fillText(line, CANVAS_WIDTH / 2, PADDING + 40 + index * (titleSize + 10));
    });

    // 分隔粗线。
    const bodyTop = PADDING + 96 + 16;
    ctx.strokeStyle = "#18221d";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(PADDING, bodyTop);
    ctx.lineTo(CANVAS_WIDTH - PADDING, bodyTop);
    ctx.stroke();

    // 条目：品名左对齐最多两行，价格右对齐。
    let y = bodyTop + 44;
    ctx.textAlign = "left";
    measured.forEach((entry, index) => {
      ctx.font = fontOf(30, "600");
      ctx.fillStyle = "#18221d";
      entry.lines.forEach((line, lineIndex) => {
        ctx.fillText(line, PADDING, y + lineIndex * 40);
      });
      ctx.font = fontOf(34, "800");
      ctx.fillStyle = "#236b4f";
      ctx.textAlign = "right";
      const price = String(entry.item.price).trim();
      ctx.fillText(price === "" ? "待定" : "¥ " + price, CANVAS_WIDTH - PADDING, y);
      ctx.textAlign = "left";

      y += entry.lines.length * 40 + 26;
      if (index < measured.length - 1) {
        ctx.strokeStyle = "#dce4dd";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(PADDING, y - ROW_GAP / 2);
        ctx.lineTo(CANVAS_WIDTH - PADDING, y - ROW_GAP / 2);
        ctx.stroke();
      }
      y += ROW_GAP;
    });

    // 底部备注。
    if (state.note.trim()) {
      ctx.font = fontOf(24, "600");
      ctx.fillStyle = "#657069";
      ctx.textAlign = "center";
      ctx.fillText(state.note.trim(), CANVAS_WIDTH / 2, height - PADDING + 12);
      ctx.textAlign = "left";
    }

    controls.status.textContent = "预览已更新，共 " + state.items.length + " 个条目。";
  }

  function renderRows() {
    itemRows.innerHTML = "";
    state.items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "item-row";

      const nameInput = document.createElement("input");
      nameInput.className = "text-input";
      nameInput.value = item.name;
      nameInput.maxLength = 60;
      nameInput.placeholder = "品名";
      nameInput.setAttribute("aria-label", "第 " + (index + 1) + " 条品名");
      nameInput.addEventListener("input", () => {
        item.name = nameInput.value;
        scheduleRender();
      });

      const priceInput = document.createElement("input");
      priceInput.className = "text-input";
      priceInput.value = item.price;
      priceInput.maxLength = 12;
      priceInput.placeholder = "价格";
      priceInput.inputMode = "decimal";
      priceInput.setAttribute("aria-label", "第 " + (index + 1) + " 条价格");
      priceInput.addEventListener("input", () => {
        item.price = priceInput.value;
        scheduleRender();
      });

      const btns = document.createElement("div");
      btns.className = "row-btns";
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "move-btn";
      upBtn.textContent = "↑";
      upBtn.setAttribute("aria-label", "上移第 " + (index + 1) + " 条");
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => moveItem(index, -1));
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "move-btn";
      downBtn.textContent = "↓";
      downBtn.setAttribute("aria-label", "下移第 " + (index + 1) + " 条");
      downBtn.disabled = index === state.items.length - 1;
      downBtn.addEventListener("click", () => moveItem(index, 1));
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", "删除第 " + (index + 1) + " 条");
      removeBtn.addEventListener("click", () => {
        state.items.splice(index, 1);
        renderRows();
        render();
      });
      btns.append(upBtn, downBtn, removeBtn);

      row.append(nameInput, priceInput, btns);
      itemRows.appendChild(row);
    });
  }

  /* 上移/下移：与相邻元素 splice 交换后整体重渲染。 */
  function moveItem(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= state.items.length) return;
    const [moved] = state.items.splice(index, 1);
    state.items.splice(target, 0, moved);
    renderRows();
    render();
  }

  controls.addRowBtn.addEventListener("click", () => {
    state.items.push({ id: state.nextId++, name: "", price: "" });
    renderRows();
    render();
    const inputs = itemRows.querySelectorAll(".item-row:last-child .text-input");
    if (inputs[0]) inputs[0].focus();
  });

  controls.titleInput.addEventListener("input", () => {
    state.title = controls.titleInput.value;
    scheduleRender();
  });
  controls.noteInput.addEventListener("input", () => {
    state.note = controls.noteInput.value;
    scheduleRender();
  });

  controls.downloadBtn.addEventListener("click", () => {
    canvas.toBlob(blob => {
      if (!blob) {
        controls.status.textContent = "生成失败，请重试。";
        return;
      }
      CanvasUtils.downloadBlob(blob, CanvasUtils.sanitizeFilename((state.title.trim() || "价目表")) + "-价目表.png");
      controls.status.textContent = "PNG 已下载。";
    }, "image/png");
  });

  window.addEventListener("beforeunload", () => clearTimeout(state.renderTimer));

  renderRows();
  render();
})();

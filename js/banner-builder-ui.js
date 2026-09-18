/* banner-builder-ui.js
   UI 构件子系统：表单字段构建（buildField / buildStringList / buildObjectList /
   buildImageList / buildFontSelectField）+ 图片选择（imageField / openImageWithCrop）+
   裁剪弹窗（buildCropModal / closeCropModal / cropAspectForField）。
   这些是面板与模态框的基础 leaf 层，不持有主文件 state，所需依赖经 setContext 注入。
   导出：global.BannerBuilderUi = { setContext, buildField, buildFontSelectField, ... } */

(function (global) {
  "use strict";

  const C = global.BannerBuilderConstants;
  const R = global.BannerBuilderRegistry;
  const U = global.BannerBuilderUtils;

  let ctx = {};
  let inputId = 0;

  /* 裁剪弹窗内部状态（本子系统私有，不暴露到主文件） */
  let cropModal = null; let cropCropper = null; let cropOpened = null; let cropDone = null; let cropFileName = "";

  function setContext(context) {
    ctx = context || {};
  }

  /* 依赖转发包装（保持被搬移函数体内原样调用名不变） */
  function el(tag, cls, text) { return ctx.el(tag, cls, text); }
  function imageSrc(value) { return ctx.imageSrc(value); }
  function renderAll() { ctx.renderAll(); }
  function scheduleCanvas() { ctx.scheduleCanvas(); }
  function replaceImageRecord(holder, key, next) { ctx.replaceImageRecord(holder, key, next); }
  function releaseImageRecord(value) { ctx.releaseImageRecord(value); }
  function refreshProtectedBlobUrls() { ctx.refreshProtectedBlobUrls(); }
  function pageSize() { return ctx.pageSize(); }
  function ratioNumber(ratio) { return ctx.ratioNumber(ratio); }

  function closeCropModal() {
    if (cropCropper) { try { cropCropper.destroy(); } catch (e) { /* ignore */ } cropCropper = null; }
    if (cropOpened && cropOpened.release) { try { cropOpened.release(); } catch (e) { /* ignore */ } cropOpened = null; }
    if (cropModal && cropModal.parentNode) cropModal.parentNode.removeChild(cropModal);
    cropModal = null; cropDone = null;
  }
  function buildCropModal(imageSrc) {
    if (cropModal) closeCropModal();
    cropModal = document.createElement("div");
    cropModal.className = "bb-crop-modal";
    const box = document.createElement("div");
    box.className = "bb-crop-box"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
    box.appendChild(el("h3", null, "裁剪图片"));
    const wrap = el("div", "bb-crop-wrap");
    const img = document.createElement("img"); img.alt = "图片裁剪预览"; img.src = imageSrc;
    wrap.appendChild(img); box.appendChild(wrap);
    const actions = el("div", "bb-crop-actions");
    const cancel = el("button", "bb-btn ghost", "取消"); cancel.type = "button";
    cancel.addEventListener("click", function () { const done = cropDone; closeCropModal(); if (done) done(null); });
    const save = el("button", "bb-btn primary", "应用裁剪"); save.type = "button";
    save.addEventListener("click", async function () {
      /* 先捕获回调再关闭弹窗：closeCropModal 会把 cropDone 置空，若后取则永远拿不到回调 */
      const done = cropDone;
      let blob = cropOpened ? cropOpened.blob : null;
      let mime = (blob && blob.type) || "image/png";
      let name = cropFileName || "image.png";
      let type = mime;
      if (cropCropper) {
        try {
          mime = /jpe?g/i.test(mime) ? "image/jpeg" : "image/png";
          const cropped = cropCropper.getCroppedCanvas({ maxWidth: 4000, maxHeight: 4000 });
          if (!cropped) throw new Error("裁剪结果为空");
          blob = await new Promise(function (resolve) { cropped.toBlob(resolve, mime, mime === "image/jpeg" ? 0.92 : undefined); });
          if (!blob) throw new Error("裁剪结果编码失败");
          type = mime;
        } catch (e) { /* 裁剪失败回退原图 */ }
      }
      /* BB-R21：裁剪器加载失败时不能静默回退原图（用户会误以为已按框裁剪）——
         明确提示并中止本次选择，网络恢复后重试仍可用（loadScript 失败已不缓存） */
      if (!cropCropper) {
        closeCropModal();
        if (done) done(null);
        if (global.alert) global.alert("裁剪组件加载失败，本次未执行裁剪（图片未被修改）。请检查网络后重试，或刷新页面。");
        return;
      }
      closeCropModal();
      if (done && blob) done({ url: URL.createObjectURL(blob), name: name, type: type });
      else if (done) done(null);
    });
    actions.appendChild(cancel); actions.appendChild(save); box.appendChild(actions);
    cropModal.appendChild(box);
    cropModal.addEventListener("click", function (e) { if (e.target === cropModal) { const done = cropDone; closeCropModal(); if (done) done(null); } });
    document.body.appendChild(cropModal);
    return img;
  }
  function openImageWithCrop(file, done, aspectRatio) {
    const MUI = global.MobileImageUpload;
    /* 无裁剪组件或文件非法时降级为「直选不裁」，保证基本功能可用 */
    if (!MUI || typeof MUI.open !== "function" || typeof MUI.ensureCropper !== "function") {
      done({ url: URL.createObjectURL(file), name: file.name, type: file.type });
      return;
    }
    cropDone = done; cropFileName = file.name;
    MUI.open(file).then(function (opened) {
      cropOpened = opened;
      const img = buildCropModal(opened.src);
      MUI.ensureCropper().then(function (Cropper) {
        if (!cropModal || !global.Cropper) return;
        /* 锁定展示比例进行裁剪：目标宽高比来自板块图片字段设置；未指定比例时自由裁剪 */
        const options = { viewMode: 1, autoCropArea: 1, dragMode: "move" };
        if (aspectRatio && aspectRatio > 0) options.aspectRatio = aspectRatio;
        cropCropper = new global.Cropper(img, options);
      }).catch(function () { cropCropper = null; });
    }).catch(function (error) {
      cropOpened = null;
      if (global.alert) global.alert(MUI.errorMessage ? MUI.errorMessage(error) : "图片读取失败，请换一张图片重试。");
      if (cropDone) { const cb = cropDone; cropDone = null; cb(null); }
    });
  }

  /* 根据图片字段语义推断裁剪目标比例（宽/高，0 表示自由裁剪）：
     - qrImage：二维码正方形语义，不锁比例（裁变形会损坏扫码）
     - avatar：头像字段，取成员对象自带的 avatarRatio
     - image：自由图片框主图，取对象自带的 ratio（"auto" 视为自由）
     - 其余统一回落到模块级 imageRatio（LAYOUT_FIELDS 的图片比例）；模块级数据经 fallbackData 传入，
       以覆盖 objectList 嵌套图片（obj 是子条目、本身不带 imageRatio 的情况，渲染层会统一套用模块 imageRatio） */
  function cropAspectForField(field, obj, fallbackData) {
    const key = field ? field.key : "";
    if (!obj || !key) return 0;
    if (key === "qrImage") return 0;
    if (key === "avatar" && obj.avatarRatio) return ratioNumber(obj.avatarRatio);
    if (key === "image" && obj.ratio && obj.ratio !== "auto") return ratioNumber(obj.ratio);
    const src = (obj.imageRatio && obj.imageRatio !== "auto") ? obj : (fallbackData && fallbackData.imageRatio && fallbackData.imageRatio !== "auto" ? fallbackData : null);
    if (src) return ratioNumber(src.imageRatio);
    return 0;
  }

  function imageField(field, obj, id, moduleData) {
    const wrap = el("div", "bb-image-field");
    const preview = el("div", "bb-image-preview");
    const current = obj[field.key];
    if (imageSrc(current)) {
      const img = el("img", "bb-image-thumb");
      img.src = current.url;
      img.alt = current.name || "已选图片";
      preview.appendChild(img);
    } else preview.appendChild(el("span", "bb-image-empty", "未选择"));
    const actions = el("div", "bb-image-actions");
    const pick = el("label", "bb-file-btn", "选择图片");
    pick.htmlFor = id;
    const input = el("input");
    input.type = "file";
    input.id = id;
    input.accept = "image/*";
    input.className = "bb-file-input";
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (!file) return;
      openImageWithCrop(file, function (value) {
        if (value) { replaceImageRecord(obj, field.key, value); renderAll(); }
      }, cropAspectForField(field, obj, moduleData));
      input.value = "";
    });
    pick.appendChild(input);
    actions.appendChild(pick);
    if (current && current.url) {
      const clear = el("button", "bb-mini-btn", "移除");
      clear.type = "button";
      clear.addEventListener("click", function () { replaceImageRecord(obj, field.key, null); renderAll(); });
      actions.appendChild(clear);
    }
    actions.appendChild(el("span", "bb-image-name", current && current.name ? current.name : "仅在浏览器本地处理"));
    wrap.appendChild(preview);
    wrap.appendChild(actions);
    return wrap;
  }

  function defaultFor(field) {
    if (field.type === "select") return field.options && field.options[0] ? field.options[0].value : "";
    if (field.type === "number") return 0;
    if (field.type === "image" || field.type === "imageList") return field.type === "imageList" ? [] : null;
    if (field.type === "stringList" || field.type === "objectList") return [];
    return "";
  }

  function newEntry(field) {
    const value = {};
    (field.fields || []).forEach(function (sub) { value[sub.key] = defaultFor(sub); });
    return value;
  }

  function buildField(field, obj, moduleType, moduleData) {
    const wrap = el("div", "bb-field");
    const id = "bb-input-" + (++inputId);
    if (field.dynamicOptions === "templates") {
      field = Object.assign({}, field, { options: R.templateOptions(moduleType) });
    }
    if (field.type === "image") return imageField(field, obj, id, moduleData);
    if (field.type === "stringList") return buildStringList(field, obj, wrap);
    if (field.type === "objectList") return buildObjectList(field, obj, wrap, moduleType, moduleData);
    if (field.type === "imageList") return buildImageList(field, obj, wrap, moduleData);

    const label = el("label", "bb-field-label", field.label);
    label.htmlFor = id;
    wrap.appendChild(label);
    let input;
    if (field.type === "textarea") {
      input = el("textarea", "bb-input");
      input.rows = field.rows || 4;
    } else if (field.type === "select") {
      input = el("select", "bb-input");
      if (field.dynamicOptions === "templates") input.dataset.templateField = "1";
      (field.options || []).forEach(function (option) {
        const item = el("option", null, option.label);
        item.value = option.value;
        input.appendChild(item);
      });
    } else if (field.type === "color") {
      input = el("input", "bb-input bb-color-input");
      input.type = "color";
    } else if (field.type === "range") {
      input = el("input", "bb-input bb-range-input");
      input.type = "range";
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;
    } else {
      input = el("input", "bb-input");
      input.type = field.type === "number" ? "number" : "text";
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;
    }
    input.id = id;
    input.value = obj[field.key] == null ? "" : String(obj[field.key]);
    if (field.type === "color" && !input.value) input.value = field.fallback || "#ffffff";
    if (field.type === "range" && (obj[field.key] == null || obj[field.key] === "")) input.value = String(field.fallback != null ? field.fallback : field.min != null ? field.min : 0);
    if (field.placeholder) input.placeholder = field.placeholder;
    input.addEventListener(field.type === "select" ? "change" : "input", function () {
      obj[field.key] = (field.type === "number" || field.type === "range") ? Number(input.value) || 0 : input.value;
      if (field.type === "select") renderAll(); else scheduleCanvas();
    });
    wrap.appendChild(input);
    /* range 类型：滑块 + 数值输入复合控件（可拖动、也可直接键入 px 数值）。
       键入过程中不回写输入框（避免打断输入），失焦/回车时收敛到合法范围。 */
    if (field.type === "range") {
      const rMin = Number(field.min != null ? field.min : 0);
      const rMax = Number(field.max != null ? field.max : rMin + 100);
      const rStep = Number(field.step) > 0 ? Number(field.step) : 1;
      const clampToStep = function (v) {
        let n = Math.round(v / rStep) * rStep;
        n = Math.min(rMax, Math.max(rMin, n));
        return n;
      };
      const row = el("div", "bb-range-row");
      input.classList.add("bb-range-slider");
      row.appendChild(input);
      const num = el("input", "bb-input bb-range-number");
      num.type = "number";
      num.min = rMin; num.max = rMax; num.step = rStep;
      num.value = input.value;
      num.title = "直接输入 " + rMin + "-" + rMax + " px";
      num.addEventListener("input", function () {
        const v = Number(num.value);
        if (num.value === "" || !Number.isFinite(v)) return; /* 键入中间态不回写 */
        const clamped = clampToStep(v);
        obj[field.key] = clamped;
        input.value = String(clamped);
        scheduleCanvas();
      });
      const settle = function () {
        const raw = num.value;
        const v = Number(raw);
        const base = raw === "" || !Number.isFinite(v) ? (field.fallback != null ? field.fallback : rMin) : v;
        const clamped = clampToStep(base);
        num.value = String(clamped);
        input.value = String(clamped);
        obj[field.key] = clamped;
        scheduleCanvas();
      };
      num.addEventListener("change", settle);
      num.addEventListener("blur", settle);
      input.addEventListener("input", function () { num.value = input.value; });
      row.appendChild(num);
      const unit = el("span", "bb-range-unit", "px");
      row.appendChild(unit);
      wrap.appendChild(row);
    }
    if (field.type === "color" && field.optional) {
      const clear = el("button", "bb-mini-btn", "跟随默认");
      clear.type = "button";
      clear.title = "清除本屏底色，跟随整条背景";
      clear.addEventListener("click", function () { obj[field.key] = ""; renderAll(); });
      wrap.appendChild(clear);
    }
    if (field.options === R.LEVEL_OPTIONS) {
      const warning = C.captionWarning(obj[field.key], pageSize().pageWidth);
      wrap.appendChild(el("p", "bb-hint" + (warning ? " warn" : ""), warning || "字号按画布宽度比例保存"));
    }
    return wrap;
  }

  function buildStringList(field, obj, wrap) {
    const list = Array.isArray(obj[field.key]) ? obj[field.key] : (obj[field.key] = []);
    const head = el("div", "bb-field-head");
    head.appendChild(el("span", "bb-field-label", field.label));
    head.appendChild(el("span", "bb-count", list.length + " 项"));
    const add = el("button", "bb-add-btn", "＋ 添加" + (field.itemLabel || "一行"));
    add.type = "button";
    add.addEventListener("click", function () { list.push(""); renderAll(); });
    head.appendChild(add);
    wrap.appendChild(head);
    const body = el("div", "bb-list");
    list.forEach(function (value, index) {
      const row = el("div", "bb-list-row");
      const input = el("input", "bb-input");
      input.value = value || "";
      input.placeholder = field.placeholder || "请输入内容";
      input.addEventListener("input", function () { list[index] = input.value; scheduleCanvas(); });
      const del = el("button", "bb-icon-btn danger", "×");
      del.type = "button";
      del.title = "删除这一项";
      del.addEventListener("click", function () { list.splice(index, 1); renderAll(); });
      row.appendChild(input); row.appendChild(del); body.appendChild(row);
    });
    if (!list.length) body.appendChild(el("p", "bb-hint", "还没有内容，点击添加。"));
    wrap.appendChild(body);
    return wrap;
  }

  function buildObjectList(field, obj, wrap, moduleType, moduleData) {
    const list = Array.isArray(obj[field.key]) ? obj[field.key] : (obj[field.key] = []);
    const head = el("div", "bb-field-head");
    head.appendChild(el("span", "bb-field-label", field.label));
    head.appendChild(el("span", "bb-count", list.length + " 项"));
    const add = el("button", "bb-add-btn", "＋ 添加" + (field.itemLabel || "一条"));
    add.type = "button";
    add.addEventListener("click", function () { list.push(newEntry(field)); renderAll(); });
    head.appendChild(add); wrap.appendChild(head);
    list.forEach(function (entry, index) {
      const card = el("div", "bb-entry");
      const title = el("div", "bb-entry-head");
      title.appendChild(el("span", "bb-entry-title", (field.itemLabel || "条目") + " " + (index + 1)));
      const del = el("button", "bb-icon-btn danger", "×");
      del.type = "button";
      del.title = "删除这一项";
      del.addEventListener("click", function () { list.splice(index, 1); renderAll(); });
      title.appendChild(del); card.appendChild(title);
      const body = el("div", "bb-entry-body");
      (field.fields || []).forEach(function (sub) { body.appendChild(buildField(sub, entry, moduleType, moduleData)); });
      card.appendChild(body); wrap.appendChild(card);
    });
    if (!list.length) wrap.appendChild(el("p", "bb-hint", "还没有内容，点击添加。"));
    return wrap;
  }

  function buildImageList(field, obj, wrap, moduleData) {
    const list = Array.isArray(obj[field.key]) ? obj[field.key] : (obj[field.key] = []);
    const head = el("div", "bb-field-head");
    head.appendChild(el("span", "bb-field-label", field.label));
    head.appendChild(el("span", "bb-count", list.length + " / " + (field.max || 4)));
    const id = "bb-input-" + (++inputId);
    const add = el("label", "bb-add-btn", "＋ 添加图片");
    add.htmlFor = id;
    const input = el("input");
    input.id = id; input.type = "file"; input.accept = "image/*"; input.className = "bb-file-input";
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (!file || list.length >= (field.max || 4)) return;
      openImageWithCrop(file, function (value) {
        if (value) { list.push(value); renderAll(); }
      }, cropAspectForField(field, obj, moduleData));
      input.value = "";
    });
    add.appendChild(input); head.appendChild(add); wrap.appendChild(head);
    const grid = el("div", "bb-image-grid");
    list.forEach(function (item, index) {
      const cell = el("div", "bb-image-cell");
      const img = el("img", "bb-image-thumb"); img.src = item.url; img.alt = item.name || "已选图片";
      const del = el("button", "bb-icon-btn danger", "×"); del.type = "button"; del.title = "移除这张图片";
      del.addEventListener("click", function () { const removed = list.splice(index, 1)[0]; refreshProtectedBlobUrls(); releaseImageRecord(removed); renderAll(); });
      cell.appendChild(img); cell.appendChild(del); grid.appendChild(cell);
    });
    if (list.length) wrap.appendChild(grid); else wrap.appendChild(el("p", "bb-hint", "还没有图片，点击添加。"));
    return wrap;
  }

  /* 字体下拉字段（右侧面板用，替代原顶部三个下拉） */
  function buildFontSelectField(labelText, options, value, onChange, firstOptionLabel) {
    const row = el("div", "bb-field");
    row.appendChild(el("label", "bb-field-label", labelText));
    const sel = el("select", "bb-input");
    if (firstOptionLabel) {
      const first = el("option", null, firstOptionLabel);
      first.value = "";
      sel.appendChild(first);
    }
    options.forEach(function (o) {
      const option = el("option", null, o.label);
      option.value = o.value;
      sel.appendChild(option);
    });
    sel.value = value;
    if (sel.selectedIndex < 0 && value) {
      const option = el("option", null, value);
      option.value = value;
      sel.appendChild(option);
      sel.value = value;
    }
    sel.addEventListener("change", function () { onChange(this.value); });
    row.appendChild(sel);
    return row;
  }

  /* select 赋值兜底：预设/草稿里的值可能不在选项列表（如 AI 主题字重 750），不补项会显示空白 */
  function ensureSelectValue(select, value) {
    select.value = String(value);
    if (select.selectedIndex < 0) {
      const opt = el("option", null, String(value));
      opt.value = String(value);
      select.appendChild(opt);
      select.value = String(value);
    }
  }

  global.BannerBuilderUi = {
    setContext: setContext,
    buildField: buildField,
    buildStringList: buildStringList,
    buildObjectList: buildObjectList,
    buildImageList: buildImageList,
    buildFontSelectField: buildFontSelectField,
    ensureSelectValue: ensureSelectValue,
    imageField: imageField,
    openImageWithCrop: openImageWithCrop,
    cropAspectForField: cropAspectForField,
    closeCropModal: closeCropModal,
  };
})(window);

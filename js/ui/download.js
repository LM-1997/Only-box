(function (global) {
  "use strict";

  var UI = global.OnlyBoxUI || (global.OnlyBoxUI = {});

  /**
   * 将 Canvas 导出为 PNG 并触发浏览器下载。
   * @param {HTMLCanvasElement} canvas
   * @param {string}            filename  不含后缀的文件名，自动追加 .png
   * @param {HTMLElement}       [statusEl] 可选，设置下载状态文字
   */
  UI.downloadCanvasPng = function (canvas, filename, statusEl) {
    canvas.toBlob(function (blob) {
      if (!blob) {
        if (statusEl) statusEl.textContent = "生成失败，请重试。";
        return;
      }
      CanvasUtils.downloadBlob(blob, filename + ".png");
      if (statusEl) statusEl.textContent = "PNG 已下载。";
    }, "image/png");
  };

  /**
   * 批量文件打包 ZIP 下载，自动处理按钮 disabled 和状态提示。
   * @param {HTMLButtonElement} button  下载按钮
   * @param {Array<{name:string, blob:Blob}>} files  文件列表
   * @param {string}   zipName   ZIP 文件名
   * @param {HTMLElement} [statusEl] 状态提示元素
   * @returns {Promise<void>}
   */
  UI.downloadZip = function (button, files, zipName, statusEl) {
    if (!files.length) return Promise.resolve();
    button.disabled = true;
    if (statusEl) statusEl.textContent = "正在加载打包组件……";
    return CanvasUtils.exportZip(files, zipName)
      .then(function () {
        if (statusEl) statusEl.textContent = "ZIP 已下载。";
      })
      .catch(function () {
        if (statusEl) statusEl.textContent = "打包失败，请检查网络后重试。";
      })
      .finally(function () {
        button.disabled = false;
      });
  };

})(window);
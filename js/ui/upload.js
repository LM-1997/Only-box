(function (global) {
  "use strict";

  var UI = global.OnlyBoxUI || (global.OnlyBoxUI = {});

  /**
   * 通用图片上传：封装 loadToken 防竞态 + MobileImageUpload.open + 资源释放。
   *
   * @param {File}           file         用户选择的文件
   * @param {Function}       nextToken    返回递增后的 token 值，如 () => ++state.loadToken
   * @param {string}         loadingMsg   加载中的提示文字
   * @param {HTMLElement}    [statusEl]   状态栏元素
   * @returns {Promise<{image:Image, release:Function, converted:boolean, originalFile:File}>}
   */
  UI.openImage = function (file, nextToken, loadingMsg, statusEl) {
    var token = nextToken();
    var opened = null;
    if (statusEl && loadingMsg) statusEl.textContent = loadingMsg;
    return MobileImageUpload.open(file).then(function (result) {
      if (token !== nextToken()) {
        result.release();
        throw new Error("CANCELLED"); // 静默丢弃
      }
      opened = result;
      return { image: result.image, release: result.release, converted: result.converted, originalFile: result.originalFile };
    }).catch(function (error) {
      if (error && error.message === "CANCELLED") throw error;
      if (opened) opened.release();
      var msg = MobileImageUpload.errorMessage(error);
      if (statusEl) statusEl.textContent = msg;
      throw new Error(msg);
    });
  };

  /**
   * 为 <input type="file"> + 清除按钮绑定通用图片上传流程。
   *
   * @param {Object} opts
   * @param {HTMLInputElement}   opts.input
   * @param {HTMLButtonElement}  opts.clearBtn
   * @param {Function}           opts.loadToken    () => number，返回递增后的 token
   * @param {HTMLElement}        opts.statusEl
   * @param {string}             opts.loadingMsg
   * @param {string}             opts.loadedMsg
   * @param {string}             opts.clearedMsg
   * @param {Function}           opts.onLoaded     (image, release, converted, file) => void
   * @param {Function}           [opts.onClear]    清除回调
   */
  UI.bindImageUpload = function (opts) {
    var input = opts.input;
    var clearBtn = opts.clearBtn;
    var statusEl = opts.statusEl;

    input.addEventListener("change", function (event) {
      var file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      UI.openImage(file, opts.loadToken, opts.loadingMsg, statusEl)
        .then(function (result) {
          opts.onLoaded(result.image, result.release, result.converted, file);
          if (statusEl) statusEl.textContent = opts.loadedMsg;
        })
        .catch(function (err) {
          if (err && err.message === "CANCELLED") return;
        });
    });

    clearBtn.addEventListener("click", function () {
      input.value = "";
      if (typeof opts.onClear === "function") opts.onClear();
      if (statusEl) statusEl.textContent = opts.clearedMsg;
    });
  };

})(window);
(function (global) {
  "use strict";

  var UI = global.OnlyBoxUI || (global.OnlyBoxUI = {});

  /**
   * 设置状态文字。
   * 未来可在此统一加入 aria-live polite、toast 动画等增强。
   * @param {HTMLElement} el  状态栏元素
   * @param {string} message  提示文字
   */
  UI.setStatus = function (el, message) {
    if (el) el.textContent = message;
  };

})(window);
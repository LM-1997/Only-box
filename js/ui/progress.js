(function (global) {
  "use strict";

  var UI = global.OnlyBoxUI || (global.OnlyBoxUI = {});

  /**
   * 进度条控制：通过 style.width 百分比更新。
   *
   * @param {HTMLElement} bar    进度条元素（如 <div style="width:0%">）
   * @param {number}      percent 0-100
   */
  UI.setProgress = function (bar, percent) {
    if (bar) bar.style.width = Math.max(0, Math.min(100, percent)) + "%";
  };

})(window);
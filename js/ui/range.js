(function (global) {
  "use strict";

  var UI = global.OnlyBoxUI || (global.OnlyBoxUI = {});

  /**
   * 绑定滑块 + 数值显示的联动。
   * @param {HTMLInputElement} rangeEl   <input type="range">
   * @param {HTMLElement}      displayEl 显示数值的元素（output / span）
   * @param {string}           [suffix]  数值后缀，默认 "%"
   * @param {function}         [onChange] 值变化回调 (numericValue) => void
   */
  UI.bindRange = function (rangeEl, displayEl, suffix, onChange) {
    if (!rangeEl) return;
    suffix = suffix === undefined ? "%" : suffix;
    var handler = function () {
      var value = Number(rangeEl.value);
      if (displayEl) displayEl.textContent = value + suffix;
      if (typeof onChange === "function") onChange(value);
    };
    rangeEl.addEventListener("input", handler);
    handler(); // 初始化显示
  };

})(window);
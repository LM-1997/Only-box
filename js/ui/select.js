(function (global) {
  "use strict";

  var UI = global.OnlyBoxUI || (global.OnlyBoxUI = {});

  /**
   * 下拉选择绑定：封装 change 事件。
   * @param {HTMLSelectElement} selectEl  <select> 元素
   * @param {function}          onChange  回调 (value: string) => void
   */
  UI.bindSelect = function (selectEl, onChange) {
    if (!selectEl) return;
    selectEl.addEventListener("change", function () {
      if (typeof onChange === "function") onChange(selectEl.value);
    });
  };

})(window);
(function (global) {
  "use strict";

  var UI = global.OnlyBoxUI || (global.OnlyBoxUI = {});

  /**
   * 绑定分段按钮组：点击按钮时切换 .active / aria-pressed，并通过回调传出值。
   *
   * @param {string}   dataAttr  数据集属性名（不含 "data-" 前缀），如 "template"、"tone"、"theme"
   * @param {function} onChange  回调 (value) => void
   */
  UI.bindSegmented = function (dataAttr, onChange) {
    var attr = "data-" + dataAttr;
    var buttons = document.querySelectorAll("[" + attr + "]");
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        var value = button.getAttribute(attr);
        buttons.forEach(function (other) {
          var active = other === button;
          other.classList.toggle("active", active);
          other.setAttribute("aria-pressed", String(active));
        });
        if (typeof onChange === "function") onChange(value);
      });
    });
  };

})(window);
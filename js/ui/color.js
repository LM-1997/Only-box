(function (global) {
  "use strict";

  var UI = global.OnlyBoxUI || (global.OnlyBoxUI = {});

  /**
   * 颜色输入绑定：简化的 input[type=color] 联动。
   * @param {HTMLInputElement} colorInput  <input type="color">
   * @param {function}         onChange   回调 (hexColor: string) => void
   */
  UI.bindColorInput = function (colorInput, onChange) {
    if (!colorInput) return;
    colorInput.addEventListener("input", function () {
      if (typeof onChange === "function") onChange(colorInput.value);
    });
  };

  /**
   * 颜色输入 + 文本输入双向同步。
   * @param {HTMLInputElement} colorInput  <input type="color">
   * @param {HTMLInputElement} hexInput    <input type="text"> 接收 hex 值
   * @param {function}         onChange   回调 (hexColor: string) => void
   */
  UI.bindColorSync = function (colorInput, hexInput, onChange) {
    if (!colorInput || !hexInput) return;
    var updating = false;
    colorInput.addEventListener("input", function () {
      if (updating) return;
      updating = true;
      hexInput.value = colorInput.value;
      updating = false;
      if (typeof onChange === "function") onChange(colorInput.value);
    });
    hexInput.addEventListener("input", function () {
      if (updating) return;
      var value = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        updating = true;
        colorInput.value = value;
        updating = false;
        if (typeof onChange === "function") onChange(value);
      }
    });
  };

})(window);
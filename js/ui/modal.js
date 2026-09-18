(function (global) {
  "use strict";

  var UI = global.OnlyBoxUI || (global.OnlyBoxUI = {});

  /**
   * 简单模态框：基于 hidden 属性控制显隐。
   *
   * 约定：模态容器元素需有 id，通过 hidden 控制。
   * 使用方式：
   *   OnlyBoxUI.modal.open("cropDialog")    // 显示
   *   OnlyBoxUI.modal.close("cropDialog")   // 隐藏
   *
   * @type {{open: (id: string) => void, close: (id: string) => void}}
   */
  UI.modal = {
    open: function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = false;
    },
    close: function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = true;
    }
  };

})(window);
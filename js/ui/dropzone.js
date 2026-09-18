(function (global) {
  "use strict";

  var UI = global.OnlyBoxUI || (global.OnlyBoxUI = {});

  /**
   * 为容器绑定拖拽上传：拖入时添加 .drag 类，离开/放下后移除，放下时回调。
   *
   * @param {string|HTMLElement} container  容器选择器或元素
   * @param {function}           onDrop     回调 (file: File) => void
   * @param {string}             [dragClass] 拖入时添加的类名，默认 "drag"
   */
  UI.bindDropzone = function (container, onDrop, dragClass) {
    var cls = dragClass || "drag";
    var el = typeof container === "string" ? document.querySelector(container) : container;
    if (!el) return;

    ["dragenter", "dragover"].forEach(function (type) {
      el.addEventListener(type, function (event) {
        event.preventDefault();
        el.classList.add(cls);
      });
    });

    ["dragleave", "drop"].forEach(function (type) {
      el.addEventListener(type, function (event) {
        event.preventDefault();
        el.classList.remove(cls);
      });
    });

    el.addEventListener("drop", function (event) {
      var file = event.dataTransfer && event.dataTransfer.files[0];
      if (file && typeof onDrop === "function") onDrop(file);
    });
  };

})(window);
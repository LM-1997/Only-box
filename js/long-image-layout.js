(function (global) {
  "use strict";

  const MAX_OUTPUT_EDGE = 16000;
  const MAX_OUTPUT_PIXELS = 16 * 1000 * 1000;

  function calculate(items, direction) {
    if (!Array.isArray(items) || items.length < 2) return null;
    const vertical = direction !== "horizontal";
    const baseCross = Math.min(...items.map(item => vertical ? item.width : item.height));
    if (!Number.isFinite(baseCross) || baseCross <= 0) return null;
    const rawLong = items.reduce((sum, item) => sum + (vertical ? item.height * baseCross / item.width : item.width * baseCross / item.height), 0);
    const rawWidth = vertical ? baseCross : rawLong;
    const rawHeight = vertical ? rawLong : baseCross;
    const safeScale = Math.min(1, MAX_OUTPUT_EDGE / rawWidth, MAX_OUTPUT_EDGE / rawHeight, Math.sqrt(MAX_OUTPUT_PIXELS / (rawWidth * rawHeight)));
    let targetCross = Math.max(1, Math.floor(baseCross * safeScale));
    let layout = build(items, vertical, targetCross);

    while ((layout.width > MAX_OUTPUT_EDGE || layout.height > MAX_OUTPUT_EDGE || layout.width * layout.height > MAX_OUTPUT_PIXELS) && targetCross > 1) {
      const correction = Math.min(MAX_OUTPUT_EDGE / layout.width, MAX_OUTPUT_EDGE / layout.height, Math.sqrt(MAX_OUTPUT_PIXELS / (layout.width * layout.height)));
      targetCross = Math.max(1, Math.floor(targetCross * correction) - 1);
      layout = build(items, vertical, targetCross);
    }

    layout.scale = targetCross / baseCross;
    layout.wasReduced = layout.scale < 0.999;
    return layout;
  }

  function build(items, vertical, targetCross) {
    let offset = 0;
    const placements = items.map(item => {
      const width = vertical ? targetCross : Math.max(1, Math.round(item.width * targetCross / item.height));
      const height = vertical ? Math.max(1, Math.round(item.height * targetCross / item.width)) : targetCross;
      const placement = { item, x: vertical ? 0 : offset, y: vertical ? offset : 0, width, height };
      offset += vertical ? height : width;
      return placement;
    });
    return { placements, width: vertical ? targetCross : offset, height: vertical ? offset : targetCross };
  }

  function toggleOrder(order, id) {
    const next = Array.isArray(order) ? order.filter(itemId => itemId !== id) : [];
    if (!Array.isArray(order) || !order.includes(id)) next.push(id);
    return next;
  }

  function drawPlacement(ctx, placement) {
    ctx.drawImage(placement.item.image, placement.x, placement.y, placement.width, placement.height);
  }

  global.LongImageLayout = Object.freeze({ calculate, drawPlacement, toggleOrder, MAX_OUTPUT_EDGE, MAX_OUTPUT_PIXELS });
})(window);

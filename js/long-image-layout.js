(function (global) {
  "use strict";

  const MAX_OUTPUT_EDGE = 16000;
  const MAX_OUTPUT_PIXELS = 16 * 1000 * 1000;

  function calculate(items, direction, userCross) {
    if (!Array.isArray(items) || items.length < 2) return null;
    const vertical = direction !== "horizontal";
    const autoCross = Math.min(...items.map(item => vertical ? item.width : item.height));
    if (!Number.isFinite(autoCross) || autoCross <= 0) return null;
    const requested = Number.isFinite(userCross) && userCross > 0 ? Math.round(userCross) : 0;
    const baseCross = requested > 0 ? requested : autoCross;
    const rawLong = items.reduce((sum, item) => sum + (vertical ? item.height * baseCross / item.width : item.width * baseCross / item.height), 0);
    const rawWidth = vertical ? baseCross : rawLong;
    const rawHeight = vertical ? rawLong : baseCross;
    let safeScale = 1;
    let targetCross;
    if (requested > 0) {
      targetCross = baseCross;
    } else {
      safeScale = Math.min(1, MAX_OUTPUT_EDGE / rawWidth, MAX_OUTPUT_EDGE / rawHeight, Math.sqrt(MAX_OUTPUT_PIXELS / (rawWidth * rawHeight)));
      targetCross = Math.max(1, Math.floor(baseCross * safeScale));
    }
    let layout = build(items, vertical, targetCross);

    if (requested === 0) {
      while ((layout.width > MAX_OUTPUT_EDGE || layout.height > MAX_OUTPUT_EDGE || layout.width * layout.height > MAX_OUTPUT_PIXELS) && targetCross > 1) {
        const correction = Math.min(MAX_OUTPUT_EDGE / layout.width, MAX_OUTPUT_EDGE / layout.height, Math.sqrt(MAX_OUTPUT_PIXELS / (layout.width * layout.height)));
        targetCross = Math.max(1, Math.floor(targetCross * correction) - 1);
        layout = build(items, vertical, targetCross);
      }
    }

    layout.scale = targetCross / autoCross;
    layout.userScale = requested > 0 ? targetCross / requested : 1;
    layout.userCross = requested;
    layout.wasReduced = requested === 0 && safeScale < 0.999;
    layout.enlarged = requested > 0 && targetCross > autoCross;
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

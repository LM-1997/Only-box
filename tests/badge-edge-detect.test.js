const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
vm.runInContext(fs.readFileSync("js/badge-edge-detect.js", "utf8"), vm.createContext({ window, Uint8ClampedArray }));
const E = window.BadgeEdgeDetect;

/* 跨 vm 上下文对象原型不同，deepStrictEqual 会失败，须逐字段断言。 */
function assertRect(actual, expected, message) {
  assert.ok(actual, message + "（应为非空）");
  assert.equal(actual.x, expected.x, message + " x");
  assert.equal(actual.y, expected.y, message + " y");
  assert.equal(actual.width, expected.width, message + " width");
  assert.equal(actual.height, expected.height, message + " height");
}

/* 构造 RGBA 像素数组：先填背景色，再在指定矩形内填内容色。 */
function makeRgba(width, height, bg, contentRect, contentColor) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2]; rgba[i + 3] = 255;
    }
  }
  if (contentRect) {
    for (let y = contentRect.y; y < contentRect.y + contentRect.height; y++) {
      for (let x = contentRect.x; x < contentRect.x + contentRect.width; x++) {
        const i = (y * width + x) * 4;
        rgba[i] = contentColor[0]; rgba[i + 1] = contentColor[1]; rgba[i + 2] = contentColor[2]; rgba[i + 3] = 255;
      }
    }
  }
  return rgba;
}

/* ============ contentBoundsFromRgba：去留白 ============ */

/* 白色背景 + 中间一块内容，四周有留白 */
{
  const rgba = makeRgba(100, 100, [255, 255, 255], { x: 20, y: 30, width: 60, height: 40 }, [0, 0, 0]);
  const b = E.contentBoundsFromRgba(rgba, 100, 100);
  assertRect(b, { x: 20, y: 30, width: 60, height: 40 }, "内容边界精确贴合黑色块");
}

/* 纯色证件照背景（非白），也能通过四角采样识别留白 */
{
  const rgba = makeRgba(100, 100, [200, 30, 30], { x: 10, y: 10, width: 80, height: 80 }, [30, 30, 30]);
  const b = E.contentBoundsFromRgba(rgba, 100, 100);
  assertRect(b, { x: 10, y: 10, width: 80, height: 80 }, "非白背景边界贴合内容块");
}

/* 无留白：整图都是内容，返回 null */
{
  const rgba = makeRgba(100, 100, [10, 10, 10], null, null);
  const b = E.contentBoundsFromRgba(rgba, 100, 100);
  assert.equal(b, null, "整图无留白应返回 null（保持原样）");
}

/* ============ avatarFrameFromRgba：头像框内边缘 ============ */

/* 彩色证件背景 + 一个居中的白色留白头像框（内边缘即留白区域） */
{
  const rgba = makeRgba(200, 300, [30, 70, 160], { x: 60, y: 80, width: 80, height: 100 }, [255, 255, 255]);
  const f = E.avatarFrameFromRgba(rgba, 200, 300);
  assert.ok(f, "应检测到头像框");
  assert.equal(f.x, 60, "x 对齐留白内边缘");
  assert.equal(f.y, 80, "y 对齐留白内边缘");
  assert.equal(f.width, 80, "width 对齐");
  assert.equal(f.height, 100, "height 对齐");
}

/* 头像框宽高比超出合理范围时应被过滤（返回 null） */
{
  // 一个极窄的条带，宽高比 8:1，超过 frameAspectMax
  const rgba = makeRgba(400, 200, [30, 70, 160], { x: 0, y: 50, width: 400, height: 20 }, [255, 255, 255]);
  const f = E.avatarFrameFromRgba(rgba, 400, 200);
  assert.equal(f, null, "宽高比异常的头像框候选应被过滤");
}

/* 白底证件 + 彩色框线（通道 B：框线边缘检测） */
{
  const rgba = makeRgba(200, 300, [255, 255, 255], null, null);
  // 画一个彩色矩形框线：外边界 60,80 ~ 140,180，框线宽 3
  const line = [200, 40, 40];
  function setPx(x, y) { const i = (y * 200 + x) * 4; rgba[i] = line[0]; rgba[i + 1] = line[1]; rgba[i + 2] = line[2]; }
  for (let t = 0; t < 3; t++) {
    for (let x = 60; x <= 140; x++) { setPx(x, 80 + t); setPx(x, 180 - t); }
    for (let y = 80; y <= 180; y++) { setPx(60 + t, y); setPx(140 - t, y); }
  }
  const f = E.avatarFrameFromRgba(rgba, 200, 300);
  assert.ok(f, "白底彩色框线应能检测到头像框");
  // 框线外边界 60~140 / 80~180，检测结果应贴近该区间
  assert.ok(f.x >= 58 && f.x <= 62, "x 贴近框线左缘，实际 " + f.x);
  assert.ok(f.y >= 78 && f.y <= 82, "y 贴近框线上缘，实际 " + f.y);
  assert.ok(Math.abs(f.width - 81) <= 4, "width 贴近框线宽度，实际 " + f.width);
  assert.ok(Math.abs(f.height - 101) <= 4, "height 贴近框线高度，实际 " + f.height);
}

/* 圆角矩形头像框：四角缺角后投影峰值仍足够，应能定位到主体矩形 */
{
  const rgba = makeRgba(200, 200, [40, 40, 120], { x: 50, y: 50, width: 100, height: 100 }, [255, 255, 255]);
  // 把四角 20×20 的区域填回背景色，模拟圆角
  const corners = [
    [50, 50], [130, 50], [50, 130], [130, 130]
  ];
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + 20; y++) {
      for (let x = cx; x < cx + 20; x++) {
        const i = (y * 200 + x) * 4;
        rgba[i] = 40; rgba[i + 1] = 40; rgba[i + 2] = 120;
      }
    }
  }
  const f = E.avatarFrameFromRgba(rgba, 200, 200);
  assert.ok(f, "圆角矩形留白应仍能检测到头像框");
  // 圆角使投影在角部下降，主体行/列仍是满留白，检测结果应接近 50~150 区间
  assert.ok(f.x >= 50 && f.x <= 70 && f.y >= 50 && f.y <= 70, "x/y 贴近主体留白区");
  assert.ok(f.width >= 100 && f.height >= 100, "宽高覆盖主体留白区");
}

/* 空尺寸防护 */
{
  assert.equal(E.contentBoundsFromRgba(new Uint8ClampedArray(0), 0, 0), null, "空像素返回 null");
  assert.equal(E.avatarFrameFromRgba(new Uint8ClampedArray(0), 0, 0), null, "空像素返回 null");
}

/* 贴边头像框：头像框贴紧图像左/上边缘时也应能检测（不再误排除贴边候选） */
{
  // 头像框贴左上角：x=0, y=0，宽 80 高 100
  const rgba = makeRgba(200, 300, [30, 70, 160], { x: 0, y: 0, width: 80, height: 100 }, [255, 255, 255]);
  const f = E.avatarFrameFromRgba(rgba, 200, 300);
  assert.ok(f, "贴边头像框应能检测到");
  assert.equal(f.x, 0, "x 贴左边缘");
  assert.equal(f.y, 0, "y 贴上边缘");
  assert.equal(f.width, 80, "width 对齐");
  assert.equal(f.height, 100, "height 对齐");
}

/* 头像框内带文字/图案（留白含少量非白像素，投影峰值略降）仍应能检测 */
{
  const rgba = makeRgba(200, 300, [30, 70, 160], { x: 60, y: 80, width: 80, height: 100 }, [255, 255, 255]);
  // 在留白框内部画一些深色"文字"像素（模拟头像框内的占位文字），约占内部面积 10%
  for (let y = 110; y < 140; y += 3) {
    for (let x = 70; x < 130; x += 3) {
      const i = (y * 200 + x) * 4;
      rgba[i] = 20; rgba[i + 1] = 20; rgba[i + 2] = 20;
    }
  }
  const f = E.avatarFrameFromRgba(rgba, 200, 300);
  assert.ok(f, "头像框内有文字时仍应能检测到");
  assert.ok(f.x >= 58 && f.x <= 62 && f.y >= 78 && f.y <= 82, "x/y 贴近头像框内边缘，实际 " + f.x + "," + f.y);
  assert.ok(Math.abs(f.width - 81) <= 3 && Math.abs(f.height - 101) <= 3, "宽高贴近头像框");
}

console.log("badge-edge-detect: all assertions passed");

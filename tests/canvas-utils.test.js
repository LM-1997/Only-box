const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
vm.runInContext(fs.readFileSync("js/canvas-utils.js", "utf8"), vm.createContext({ window, setTimeout }));
const api = window.CanvasUtils;

/* measureText 按"当前字号 × 字符数"模拟，保证换行/自适应逻辑可被精确断言。 */
function mockCtx() {
  return {
    font: "",
    drawCalls: [],
    measureText(text) {
      const px = /(\d+(?:\.\d+)?)px/.exec(this.font);
      const unit = px ? Number(px[1]) : 10;
      return { width: [...String(text)].length * unit };
    },
    drawImage(...args) {
      this.drawCalls.push(args);
    }
  };
}

/* 算法 A：逐字符贪心换行 */
{
  const ctx = mockCtx();
  const lines = api.wrapText(ctx, "一二三四五六七八九十", 45);
  assert.deepEqual([...lines], ["一二三四", "五六七八", "九十"], "每行不超过 maxWidth 对应的字符数");
  assert.deepEqual([...api.wrapText(mockCtx(), "", 45)], [], "空文本返回空数组");
  assert.deepEqual([...api.wrapText(mockCtx(), "短", 45)], ["短"], "单字符不触发换行");
}

/* 算法 A 补充：maxLines 截断 + 省略号 */
{
  const ctx = mockCtx();
  const lines = api.wrapTextWithLimit(ctx, "一二三四五六七八九十", 45, 2);
  assert.equal(lines.length, 2, "最多两行");
  assert.equal(lines[1], "五六七…", "末行省略号收尾且不超宽");
  const kept = api.wrapTextWithLimit(mockCtx(), "一二", 45, 2);
  assert.deepEqual([...kept], ["一二"], "未超行数时不截断");
}

/* 算法 B：字号二分查找 */
{
  const ctx = mockCtx();
  const size = api.fitFontSize(ctx, "abcd", 100, { minFontSize: 12, maxFontSize: 80 });
  assert.equal(size, 25, "4 字符 × 10px/字符，25px 时恰好 100px 不溢出");
  assert.equal(api.fitFontSize(mockCtx(), "abcd", 10000, { minFontSize: 12, maxFontSize: 80 }), 80, "不超过 maxFontSize");
  assert.equal(api.fitFontSize(mockCtx(), "abcd", 10, { minFontSize: 12, maxFontSize: 80 }), 12, "不小于 minFontSize");
}

/* 算法 C：contain / cover 绘制几何 */
{
  const ctx = mockCtx();
  const img = { naturalWidth: 2000, naturalHeight: 1000 };
  api.drawContain(ctx, img, 0, 0, 500, 500);
  assert.deepEqual(ctx.drawCalls[0], [img, 0, 125, 500, 250], "contain 应按最小比例居中缩放");
  ctx.drawCalls.length = 0;
  api.drawCover(ctx, img, 0, 0, 500, 500);
  assert.deepEqual(ctx.drawCalls[0], [img, 500, 0, 1000, 1000, 0, 0, 500, 500], "cover 应裁切填满目标框");
}

/* 算法 D：分帧执行 + 进度播报 */
{
  const progress = [];
  const items = Array.from({ length: 7 }, (_, i) => i);
  api.processBatch(items, async item => item, { chunkSize: 3, onProgress: (done, total) => progress.push([done, total]) })
    .then(() => {
      assert.deepEqual(progress, [[3, 7], [6, 7], [7, 7]], "每 chunk 播报一次且最后一条覆盖末项");
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

/* 算法 E：自然日日期差 */
{
  const now = new Date(2026, 7, 18, 22, 30); // 2026-08-18 深夜
  assert.equal(api.daysUntil("2026-10-01", now), 44, "深夜按当天零点计算，不出现差一天");
  assert.equal(api.daysUntil("2026-08-18", now), 0, "目标日即今天");
  assert.equal(api.daysUntil("2026-08-01", now), -17, "过期返回负数");
  assert.ok(Number.isNaN(api.daysUntil("bad-date")), "非法输入返回 NaN");
}

/* 算法 F：文件名安全化与去重 */
{
  assert.equal(api.sanitizeFilename('A/B:C*D?"E<F>G|H'), "A_B_C_D__E_F_G_H", "非法字符逐个替换为下划线");
  assert.equal(api.sanitizeFilename("   "), "untitled", "空白回退默认名");
  assert.equal(api.sanitizeFilename(null, "fallback"), "fallback", "非字符串安全处理");
  const used = new Map();
  assert.equal(api.uniqueFilename("摊位A", used), "摊位A.png");
  assert.equal(api.uniqueFilename("摊位A", used), "摊位A_2.png");
  assert.equal(api.uniqueFilename("摊位A", used), "摊位A_3.png");
}

/* 需求三：拼版网格几何与跨页分配 */
{
  const cells = api.printGridCells(2480, 3508, 2, 2, 60);
  assert.equal(cells.length, 4);
  const cellW = (2480 - 60 * 3) / 2;
  const cellH = (3508 - 60 * 3) / 2;
  assert.equal(JSON.stringify(cells[0]), JSON.stringify({ row: 0, col: 0, dx: 60, dy: 60, dw: cellW, dh: cellH }), "首格从 margin 起");
  assert.equal(cells[3].dx, 60 + cellW + 60, "列间留 margin 间距");
  assert.equal(JSON.stringify(api.printPageAssignment(5, 4)), JSON.stringify({ pageIndex: 1, cellIndex: 1 }), "第 6 张落在第 2 页第 2 格");
  assert.equal(JSON.stringify(api.printPageAssignment(3, 4)), JSON.stringify({ pageIndex: 0, cellIndex: 3 }), "第 4 张仍在第 1 页");
}

/* 需求二：批量文本解析 */
{
  const items = api.parseSignLines("A01,古董摊\nB02，手作饰品\n\nC03\n,,");
  assert.equal(JSON.stringify([...items]), JSON.stringify([
    { code: "A01", name: "古董摊" },
    { code: "B02", name: "手作饰品" },
    { code: "C03", name: "" }
  ]), "支持中英文逗号、名称可空、空行跳过");
}

console.log("canvas utils tests: OK");

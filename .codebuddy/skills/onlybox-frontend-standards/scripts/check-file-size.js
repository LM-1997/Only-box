#!/usr/bin/env node
"use strict";
/**
 * Only-box 模块规模检查：判断 js/ 下的文件是否超过拆分阈值。
 *
 * 用法:
 *   node .codebuddy/skills/onlybox-frontend-standards/scripts/check-file-size.js [根目录]
 * 未传根目录时默认用当前工作目录。
 *
 * 退出码: 0 全部在阈值内（含观察区告警）; 1 存在必须拆分的文件。
 */

const fs = require("fs");
const path = require("path");

const THRESHOLDS = {
  lines: { warn: 600, fail: 1200 },
  functions: { warn: 50, fail: 80 },
  longestFunction: { warn: 60, fail: 100 },
};

const SCAN_DIRS = ["js", "data"];
const EXCLUDE_DIRS = new Set([
  "node_modules",
  "vendor",
  "_archive",
  ".git",
  ".codebuddy",
  ".workbuddy",
  "assets",
  "dist",
]);
const EXCLUDE_FILES = new Set(["fonts.js"]);

const FN_DECL = /^([ \t]{0,4})(?:async[ \t]+)?function[ \t]+[A-Za-z0-9_$]+/;
const FN_ASSIGN =
  /^([ \t]{0,4})(?:const|let|var)[ \t]+[A-Za-z0-9_$]+[ \t]*=[ \t]*(?:async[ \t]+)?(?:function|\([^)]*\)[ \t]*=>|[A-Za-z0-9_$]+[ \t]*=>)/;

const endRes = new Map();
function endRegexFor(indent) {
  if (!endRes.has(indent)) {
    endRes.set(indent, new RegExp("^[ \\t]{0," + indent + "}\\}"));
  }
  return endRes.get(indent);
}

function collectFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      collectFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

function analyze(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return null;
  }
  const lines = text.split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const decl = FN_DECL.exec(lines[i]) || FN_ASSIGN.exec(lines[i]);
    if (decl) starts.push({ index: i, indent: decl[1].length });
  }
  let longest = 0;
  for (let s = 0; s < starts.length; s += 1) {
    const begin = starts[s].index;
    const next = s + 1 < starts.length ? starts[s + 1].index : lines.length;
    const endRe = endRegexFor(starts[s].indent);
    let end = next;
    for (let i = begin + 1; i < next; i += 1) {
      if (endRe.test(lines[i])) {
        end = i;
        break;
      }
    }
    longest = Math.max(longest, end - begin + 1);
  }
  return { lines: lines.length, functions: starts.length, longestFunction: longest };
}

function level(value, rule) {
  if (value > rule.fail) return "FAIL";
  if (value > rule.warn) return "WARN";
  return "OK";
}

function main() {
  const root = process.argv[2] || process.cwd();
  const files = [];
  for (const dir of SCAN_DIRS) collectFiles(path.join(root, dir), files);
  files.sort();

  const rows = [];
  let failed = 0;
  let warned = 0;
  for (const file of files) {
    const stat = analyze(file);
    if (!stat) continue;
    const lv = {
      lines: level(stat.lines, THRESHOLDS.lines),
      functions: level(stat.functions, THRESHOLDS.functions),
      longestFunction: level(stat.longestFunction, THRESHOLDS.longestFunction),
    };
    /* 纯数据/配置型文件（大字典、字段表）行数长但职责单一，行数超标只降级为观察区 */
    if (stat.functions <= 20 && lv.lines === "FAIL") lv.lines = "WARN";
    const worst = [lv.lines, lv.functions, lv.longestFunction];
    if (worst.includes("FAIL")) failed += 1;
    else if (worst.includes("WARN")) warned += 1;
    else continue;
    rows.push({
      rel: path.relative(root, file).replace(/\\/g, "/"),
      stat,
      lv,
    });
  }

  rows.sort((a, b) => b.stat.lines - a.stat.lines);

  console.log("Only-box 模块规模检查（阈值: 行数 600/1200，函数数 50/80，最长函数 60/100）");
  console.log(`扫描 ${files.length} 个文件，${failed} 个必须拆分，${warned} 个进入观察区。\n`);
  if (!rows.length) {
    console.log("全部文件在阈值内。");
    return 0;
  }
  const pad = (v, n) => String(v).padStart(n, " ");
  console.log("状态   行数  函数  最长函数  文件");
  for (const r of rows) {
    const mark = [r.lv.lines, r.lv.functions, r.lv.longestFunction].includes("FAIL") ? "FAIL" : "WARN";
    console.log(
      `${mark}  ${pad(r.stat.lines, 5)}${pad(r.stat.functions, 6)}${pad(r.stat.longestFunction, 9)}  ${r.rel}`
    );
  }
  console.log("\n拆分方式见 .codebuddy/skills/onlybox-frontend-standards/references/module-split-playbook.md");
  return failed > 0 ? 1 : 0;
}

process.exit(main());

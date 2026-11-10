/**
 * 给非武僧角色补跑动/跳跃/下落帧：
 * - run 8 → 12（插入 4 张 50% 混合的中间帧）
 * - jump/fall 2~3 → 4（垂直位移烘焙出起伏）
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const SETS = [
  { dir: "samurai-mack", out: 200 },
  { dir: "huntress", out: 150 },
  { dir: "evil-wizard", out: 250 },
  { dir: "boxer", out: 200 },
];
const CELL = 200;

function load(dir, name) {
  return PNG.sync.read(fs.readFileSync(path.join("public", "assets", dir, name)));
}

function cellFrom(png, i) {
  const out = new PNG({ width: CELL, height: CELL });
  out.data.fill(0);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const si = (y * png.width + i * CELL + x) * 4;
      const di = (y * CELL + x) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

function blend(a, b) {
  const out = new PNG({ width: CELL, height: CELL });
  for (let i = 0; i < a.data.length; i += 4) {
    const aA = a.data[i + 3] / 255;
    const bA = b.data[i + 3] / 255;
    const t = 0.5;
    out.data[i] = Math.round(a.data[i] * (1 - t) + b.data[i] * t);
    out.data[i + 1] = Math.round(a.data[i + 1] * (1 - t) + b.data[i + 1] * t);
    out.data[i + 2] = Math.round(a.data[i + 2] * (1 - t) + b.data[i + 2] * t);
    out.data[i + 3] = Math.round(255 * (aA * (1 - t) + bA * t));
  }
  return out;
}

function shift(src, dy) {
  const out = new PNG({ width: CELL, height: CELL });
  out.data.fill(0);
  for (let y = 0; y < CELL; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= CELL) continue;
    for (let x = 0; x < CELL; x++) {
      const si = (sy * src.width + x) * 4;
      const di = (y * out.width + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

function write(dir, name, cells, outCell) {
  const out = new PNG({ width: outCell * cells.length, height: outCell });
  out.data.fill(0);
  const scale = outCell / CELL;
  cells.forEach((c, i) => {
    for (let y = 0; y < outCell; y++) {
      for (let x = 0; x < outCell; x++) {
        const sx = Math.min(CELL - 1, Math.floor(x / scale));
        const sy = Math.min(CELL - 1, Math.floor(y / scale));
        const si = (sy * CELL + sx) * 4;
        const di = (y * out.width + i * outCell + x) * 4;
        out.data[di] = c.data[si];
        out.data[di + 1] = c.data[si + 1];
        out.data[di + 2] = c.data[si + 2];
        out.data[di + 3] = c.data[si + 3];
      }
    }
  });
  fs.writeFileSync(path.join("public", "assets", dir, name), PNG.sync.write(out));
  console.log(`${dir}/${name}: ${cells.length} frames @${outCell}`);
}

for (const { dir, out } of SETS) {
  const runPng = load(dir, "Run.png");
  const runCount = Math.floor(runPng.width / CELL);
  const runCells = Array.from({ length: runCount }, (_, i) => cellFrom(runPng, i));
  const run4 = [];
  for (let i = 0; i < runCells.length; i++) {
    run4.push(runCells[i]);
    if (i < runCells.length - 1 && i % 2 === 1) run4.push(blend(runCells[i], runCells[i + 1]));
  }
  const runFinal = run4.length > 12 ? Array.from({ length: 12 }, (_, i) => run4[Math.round((i * (run4.length - 1)) / 11)]) : run4;
  write(dir, "Run.png", runFinal, out);

  const jumpPng = load(dir, "Jump.png");
  const jumpCount = Math.floor(jumpPng.width / CELL);
  const jump0 = cellFrom(jumpPng, 0);
  const jumpLast = cellFrom(jumpPng, jumpCount - 1);
  write(dir, "Jump.png", [shift(jump0, 0), shift(jumpLast, -4), shift(jump0, -8), shift(jumpLast, -5)], out);

  const fallPng = load(dir, "Fall.png");
  const fallCount = Math.floor(fallPng.width / CELL);
  const f0 = cellFrom(fallPng, 0);
  const fLast = cellFrom(fallPng, fallCount - 1);
  write(dir, "Fall.png", [shift(f0, 0), shift(f0, 4), shift(fLast, 8), shift(fLast, 6)], out);
}




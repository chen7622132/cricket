/**
 * 将 OpenGameArt「Boxer Game Character」(CC0, Raga2D) 转为 200x200 序列帧。
 * 抠白底 + 裁剪 + 面积平均缩放，输出到 public/assets/boxer/*.png。
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const SRC = path.join(".tmp", "boxer-oga", "Boxer Game Sprite OGA");
const OUT = path.join("public", "assets", "boxer");
const CELL = 200;
const CROP = { x: 60, y: 40, w: 640, h: 671 };

function load(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function stripWhite(png) {
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const min = Math.min(r, g, b);
    if (min > 238) {
      // 白底转透明，边缘做软过渡
      const a = Math.max(0, Math.min(1, (238 - min) / 24));
      png.data[i + 3] = Math.round(png.data[i + 3] * a);
    }
  }
  return png;
}

function frames(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** 从裁剪区域面积平均缩放到 CELL。 */
function sample(src, ox, oy, w, h) {
  const out = new PNG({ width: CELL, height: CELL });
  out.data.fill(0);
  const sx = w / CELL;
  const sy = h / CELL;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(ox + x * sx);
      const x1 = Math.min(src.width, Math.ceil(ox + (x + 1) * sx));
      const y0 = Math.floor(oy + y * sy);
      const y1 = Math.min(src.height, Math.ceil(oy + (y + 1) * sy));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          const al = src.data[i + 3] / 255;
          r += src.data[i] * al;
          g += src.data[i + 1] * al;
          b += src.data[i + 2] * al;
          a += al;
          n++;
        }
      }
      const di = (y * CELL + x) * 4;
      if (a > 0) {
        out.data[di] = Math.round(r / a);
        out.data[di + 1] = Math.round(g / a);
        out.data[di + 2] = Math.round(b / a);
        out.data[di + 3] = Math.round((a / Math.max(1, n)) * 255);
      }
    }
  }
  return out;
}

function buildStrip(files, name, count) {
  const framesToUse = files.slice(0, count);
  const out = new PNG({ width: CELL * framesToUse.length, height: CELL });
  out.data.fill(0);
  framesToUse.forEach((file, i) => {
    const src = stripWhite(load(file));
    const cell = sample(src, CROP.x, CROP.y, CROP.w, CROP.h);
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const si = (y * CELL + x) * 4;
        const di = (y * out.width + i * CELL + x) * 4;
        out.data[di] = cell.data[si];
        out.data[di + 1] = cell.data[si + 1];
        out.data[di + 2] = cell.data[si + 2];
        out.data[di + 3] = cell.data[si + 3];
      }
    }
  });
  fs.writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(out));
  console.log(`${name}.png: ${framesToUse.length} frames`);
}

const idle = frames(path.join(SRC, "1-Idle"));
const run = frames(path.join(SRC, "2-Walk", "1-Forward"));
const jabR = frames(path.join(SRC, "3-Punch", "1-JabRight"));
const jabL = frames(path.join(SRC, "3-Punch", "2-JabLeft"));
const upper = frames(path.join(SRC, "3-Punch", "3-Uppercut"));
const hurt = frames(path.join(SRC, "5-Hurt", "1-Hurt"));
const ko = frames(path.join(SRC, "6-KO"));

fs.mkdirSync(OUT, { recursive: true });

buildStrip(idle, "Idle", 6);
buildStrip(run, "Run", 8);
buildStrip(idle, "Jump", 2);
buildStrip(idle, "Fall", 2);
buildStrip(jabR, "Attack1", 8);
buildStrip(jabL, "Attack2", 8);
buildStrip(upper, "Attack3", 8);
buildStrip(hurt, "Take hit", 8);
buildStrip(ko, "Death", 8);
buildStrip([...ko].reverse(), "Getup", 4);

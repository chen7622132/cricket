/**
 * 从英雄攻击帧生成重击专用起手/收招帧（2 帧 × 200px）。
 * 通过旋转 + 位移生成与普通攻击不同的关键姿势，输出：
 *   ExecWindup.png / ExecRecovery.png / HammerWindup.png / HammerRecovery.png
 * 运行：node scripts/build-heavy-anims.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const DIR = path.join("public", "assets", "martial-hero");
const CELL = 200;

function readStrip(file) {
  return PNG.sync.read(fs.readFileSync(path.join(DIR, file)));
}

/** 取 strip 里第 index 帧，绕中心旋转 deg 度并平移 (dx,dy)。 */
function transformFrame(strip, index, deg, dx, dy) {
  const out = new PNG({ width: CELL, height: CELL });
  out.data.fill(0);
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = CELL / 2;
  const cy = CELL / 2;

  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const ox = x - cx - dx;
      const oy = y - cy - dy;
      const sx = Math.round(cx + ox * cos + oy * sin) + index * CELL;
      const sy = Math.round(cy - ox * sin + oy * cos);
      if (sx < index * CELL || sx >= (index + 1) * CELL || sy < 0 || sy >= CELL) continue;
      const src = (sy * strip.width + sx) * 4;
      const dst = (y * CELL + x) * 4;
      out.data[dst] = strip.data[src];
      out.data[dst + 1] = strip.data[src + 1];
      out.data[dst + 2] = strip.data[src + 2];
      out.data[dst + 3] = strip.data[src + 3];
    }
  }
  return out;
}

function writeStrip(name, frames) {
  const strip = new PNG({ width: CELL * frames.length, height: CELL });
  strip.data.fill(0);
  frames.forEach((frame, i) => {
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const src = (y * CELL + x) * 4;
        const dst = (y * strip.width + i * CELL + x) * 4;
        strip.data[dst] = frame.data[src];
        strip.data[dst + 1] = frame.data[src + 1];
        strip.data[dst + 2] = frame.data[src + 2];
        strip.data[dst + 3] = frame.data[src + 3];
      }
    }
  });
  fs.writeFileSync(path.join(DIR, name), PNG.sync.write(strip));
  console.log(`${name}: ${frames.length} frames`);
}

const attack1 = readStrip("Attack1.png");
const attack2 = readStrip("Attack2.png");

writeStrip("ExecWindup.png", [
  transformFrame(attack1, 0, -7, -3, 1),
  transformFrame(attack1, 1, -10, -5, 2),
]);
writeStrip("ExecRecovery.png", [
  transformFrame(attack1, 2, 8, 4, 1),
  transformFrame(attack1, 3, 10, 6, 2),
]);
writeStrip("HammerWindup.png", [
  transformFrame(attack2, 0, -9, -4, -2),
  transformFrame(attack2, 1, -12, -6, -4),
]);
writeStrip("HammerRecovery.png", [
  transformFrame(attack2, 2, 7, 5, 2),
  transformFrame(attack2, 3, 9, 7, 3),
]);

// 英雄第三套连段：蓄力 -> 斩击 -> 回身 -> 收势
writeStrip("HeroAttack3.png", [
  transformFrame(attack2, 1, -12, -6, -4),
  transformFrame(attack1, 2, 6, 4, 1),
  transformFrame(attack2, 0, 10, 6, 2),
  transformFrame(attack1, 3, 4, 2, 0),
]);


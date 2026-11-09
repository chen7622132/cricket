/**
 * 生成每个角色的 4 帧起身条带：躺地 → 撑地 → 半跪 → 站起。
 * 以死亡末帧 + 待机帧烘焙旋转/缩放，得到专属姿势，而不是简单倒放。
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const SETS = [
  { dir: "public/assets/martial-hero", cell: 200, deathFrames: 7, idle: "Idle.png", death: "Death.png" },
  { dir: "public/assets/samurai-mack", cell: 200, deathFrames: 6, idle: "Idle.png", death: "Death.png" },
  { dir: "public/assets/huntress", cell: 150, deathFrames: 8, idle: "Idle.png", death: "Death.png" },
  { dir: "public/assets/evil-wizard", cell: 250, deathFrames: 7, idle: "Idle.png", death: "Death.png" },
];

function frameAt(png, cell, index) {
  return { png, cell, x: index * cell, y: 0 };
}

function sample(src, x, y) {
  if (x < 0 || y < 0 || x >= src.png.width || y >= src.png.height) return [0, 0, 0, 0];
  const i = ((src.y + y) * src.png.width + (src.x + x)) * 4;
  return [src.png.data[i], src.png.data[i + 1], src.png.data[i + 2], src.png.data[i + 3]];
}

function bake(out, cell, fx, angle, scale, dy) {
  const pivotX = cell / 2;
  const pivotY = cell * 0.9;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const vx = (x - pivotX) / scale;
      const vy = (y - pivotY - dy) / scale;
      const sx = vx * cos - vy * sin + pivotX;
      const sy = vx * sin + vy * cos + pivotY;
      const [r, g, b, a] = sample(src, Math.round(sx), Math.round(sy));
      if (a === 0) continue;
      const di = ((y * out.width) + fx * cell + x) * 4;
      out.data[di] = r;
      out.data[di + 1] = g;
      out.data[di + 2] = b;
      out.data[di + 3] = a;
    }
  }
}

for (const set of SETS) {
  const cell = set.cell;
  const idlePng = PNG.sync.read(fs.readFileSync(path.join(set.dir, set.idle)));
  const deathPng = PNG.sync.read(fs.readFileSync(path.join(set.dir, set.death)));
  const idle = frameAt(idlePng, cell, 0);
  const dead = frameAt(deathPng, cell, set.deathFrames - 1);

  const out = new PNG({ width: cell * 4, height: cell });
  out.data.fill(0);

  // 0 躺地：死亡末帧
  bake(dead, cell, 0, 0, 1, 6);
  // 1 撑地：待机帧旋转 1.05rad、略缩小
  bake(idle, cell, 1, 1.05, 0.92, 10);
  // 2 半跪：旋转 0.45rad
  bake(idle, cell, 2, 0.45, 0.96, 4);
  // 3 站起：待机帧
  bake(idle, cell, 3, 0, 1, 0);

  fs.writeFileSync(path.join(set.dir, "Getup.png"), PNG.sync.write(out));
  console.log(`${set.dir}/Getup.png: 4 baked frames (${cell}x${cell})`);
}

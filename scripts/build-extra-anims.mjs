/**
 * 从现有攻击帧烘焙每个角色的突进/空中/上挑动作帧（200 或 150/250 cell）。
 * 不做新美术，只做旋转/缩放/位移的像素重采样，补足动作种类。
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const SETS = [
  { dir: "public/assets/samurai-mack", cell: 200, attack1: "Attack1.png", attack2: "Attack2.png", extra: ["uppercut"] },
  { dir: "public/assets/huntress", cell: 150, attack1: "Attack1.png", attack2: "Attack3.png", extra: [] },
  { dir: "public/assets/evil-wizard", cell: 250, attack1: "Attack1.png", attack2: "Attack2.png", extra: [] },
  { dir: "public/assets/boxer", cell: 200, attack1: "Attack1.png", attack2: "Attack2.png", extra: [] },
];

function bake(out, cell, fx, src, srcIndex, angle, scale, dy) {
  const pivotX = cell / 2;
  const pivotY = cell * 0.86;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const vx = (x - pivotX) / scale;
      const vy = (y - pivotY - dy) / scale;
      const sx = Math.round(vx * cos - vy * sin + pivotX);
      const sy = Math.round(vx * sin + vy * cos + pivotY);
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const si = (sy * src.width + fx * cell + sx) * 4;
      if (src.data[si + 3] === 0) continue;
      const di = (y * out.width + fx * cell + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
}

for (const set of SETS) {
  const cell = set.cell;
  const a1 = PNG.sync.read(fs.readFileSync(path.join(set.dir, set.attack1)));
  const a2 = PNG.sync.read(fs.readFileSync(path.join(set.dir, set.attack2)));
  const n1 = Math.floor(a1.width / cell);
  const n2 = Math.floor(a2.width / cell);

  const dash = new PNG({ width: cell * 3, height: cell });
  dash.data.fill(0);
  bake(dash, cell, 0, a1, Math.min(1, n1 - 1), -0.18, 1.18, 0);
  bake(dash, cell, 1, a1, Math.min(2, n1 - 1), -0.1, 1.22, -2);
  bake(dash, cell, 2, a2, Math.min(1, n2 - 1), 0.05, 1.1, 0);
  fs.writeFileSync(path.join(set.dir, "Dash.png"), PNG.sync.write(dash));

  const air = new PNG({ width: cell * 3, height: cell });
  air.data.fill(0);
  bake(air, cell, 0, a1, n1 - 1, -0.35, 1.15, 6);
  bake(air, cell, 1, a1, n1 - 1, -0.15, 1.2, 10);
  bake(air, cell, 2, a2, n2 - 1, 0.15, 1.15, 4);
  fs.writeFileSync(path.join(set.dir, "AirSlash.png"), PNG.sync.write(air));

  if (set.extra.includes("uppercut")) {
    const up = new PNG({ width: cell * 3, height: cell });
    up.data.fill(0);
    bake(up, cell, 0, a2, 0, 0.55, 1.0, 0);
    bake(up, cell, 1, a2, 1, 0.25, 1.08, -10);
    bake(up, cell, 2, a2, 2, -0.05, 1.12, -18);
    fs.writeFileSync(path.join(set.dir, "Uppercut.png"), PNG.sync.write(up));
  }

  console.log(`${set.dir}: Dash/AirSlash${set.extra.length ? "/Uppercut" : ""} 3f`);
}

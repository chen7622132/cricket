/**
 * 用每个角色的 Death 序列帧反放，生成 4 帧“起身”条带（Getup.png）。
 * 纯像素搬运，不改美术；之后再替换为手绘起身帧。
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";


const SETS = [
  { dir: "public/assets/martial-hero", death: "Death.png", cell: 200, frames: 7 },
  { dir: "public/assets/samurai-mack", death: "Death.png", cell: 200, frames: 6 },
  { dir: "public/assets/huntress", death: "Death.png", cell: 150, frames: 8 },
  { dir: "public/assets/evil-wizard", death: "Death.png", cell: 250, frames: 7 },
];



for (const set of SETS) {
  const file = path.join(set.dir, set.death);
  if (!fs.existsSync(file)) {
    console.log(`skip ${file}`);
    continue;
  }
  const src = PNG.sync.read(fs.readFileSync(file));
  const srcCell = src.width / set.frames;
  const CELL = set.cell;
  const out = new PNG({ width: CELL * 4, height: CELL });
  out.data.fill(0);

  for (let i = 0; i < 4; i++) {
    // 死亡序列最后一帧是躺地，反放即起身
    const frame = set.frames - 1 - i;
    const sx = frame * srcCell;
    const scale = CELL / srcCell;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const px = Math.min(srcCell - 1, Math.floor(x / scale));
        const py = Math.min(srcCell - 1, Math.floor(y / scale));
        const si = ((py * src.width) + sx + px) * 4;
        const di = ((y * out.width) + i * CELL + x) * 4;
        out.data[di] = src.data[si];
        out.data[di + 1] = src.data[si + 1];
        out.data[di + 2] = src.data[si + 2];
        out.data[di + 3] = src.data[si + 3];
      }
    }
  }

  const outFile = path.join(set.dir, "Getup.png");
  fs.writeFileSync(outFile, PNG.sync.write(out));
  console.log(`${outFile}: 4 frames (${CELL}x${CELL})`);
}



/**
 * 把 Martial Hero 的横排序列帧合成一张 spritesheet（atlas PNG + JSON）。
 * 输出：public/assets/martial-hero/hero.png + hero.json
 * 运行：npm run sprites
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const DIR = path.join("public", "assets", "martial-hero");
const CELL = 200;
const COLS = 8;

const ANIMATIONS = [
  { name: "idle", file: "Idle.png", frames: 4 },
  { name: "run", file: "Run.png", frames: 8 },
  { name: "attack1", file: "Attack1.png", frames: 4 },
  { name: "attack2", file: "Attack2.png", frames: 4 },
  { name: "hit", file: "Take_hit.png", frames: 3 },
  { name: "death", file: "Death.png", frames: 7 },
];

const total = ANIMATIONS.reduce((n, a) => n + a.frames, 0);
const rows = Math.ceil(total / COLS);
const sheet = new PNG({ width: COLS * CELL, height: rows * CELL });
sheet.data.fill(0);

const frames = {};
const animations = {};
let index = 0;

for (const anim of ANIMATIONS) {
  const strip = PNG.sync.read(fs.readFileSync(path.join(DIR, anim.file)));
  if (strip.height !== CELL) throw new Error(`${anim.file}: expected height ${CELL}, got ${strip.height}`);
  animations[anim.name] = [];

  for (let f = 0; f < anim.frames; f++) {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const key = `${anim.name}_${f}`;
    frames[key] = {
      frame: { x: col * CELL, y: row * CELL, w: CELL, h: CELL },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL },
      sourceSize: { w: CELL, h: CELL },
    };
    animations[anim.name].push(key);

    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const src = (y * strip.width + (f * CELL + x)) * 4;
        const dst = ((row * CELL + y) * sheet.width + (col * CELL + x)) * 4;
        sheet.data[dst] = strip.data[src];
        sheet.data[dst + 1] = strip.data[src + 1];
        sheet.data[dst + 2] = strip.data[src + 2];
        sheet.data[dst + 3] = strip.data[src + 3];
      }
    }
    index++;
  }
}

const meta = {
  frames,
  animations,
  meta: {
    app: "cricket build-spritesheet",
    version: "1.0",
    image: "hero.png",
    format: "RGBA8888",
    size: { w: COLS * CELL, h: rows * CELL },
    scale: "1",
  },
};

fs.writeFileSync(path.join(DIR, "hero.png"), PNG.sync.write(sheet));
fs.writeFileSync(path.join(DIR, "hero.json"), JSON.stringify(meta, null, 2) + "\n");

console.log(`sheet ${COLS * CELL}x${rows * CELL}, ${total} frames`);
console.log(Object.entries(animations).map(([k, v]) => `${k}:${v.length}`).join(" "));

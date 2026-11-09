/**
 * 把 LuizMelo 的横排序列帧合成 spritesheet（atlas PNG + JSON）。
 * - 英雄：Martial Hero 2（hero）
 * - 敌方：Samurai Mack / Martial Hero 1（enemy）
 * 运行：npm run sprites
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const CELL = 200;
const COLS = 8;

const SETS = [
  {
    dir: path.join("public", "assets", "martial-hero"),
    image: "hero.png",
    json: "hero.json",
    animations: [
      { name: "idle", file: "Idle.png", frames: 4 },
      { name: "run", file: "Run.png", frames: 8 },
      { name: "jump", file: "Jump.png", frames: 2 },
      { name: "fall", file: "Fall.png", frames: 2 },
      { name: "attack1", file: "Attack1.png", frames: 4 },
      { name: "attack2", file: "Attack2.png", frames: 4 },
      { name: "exec_windup", file: "ExecWindup.png", frames: 2 },
      { name: "exec_recovery", file: "ExecRecovery.png", frames: 2 },
      { name: "hammer_windup", file: "HammerWindup.png", frames: 2 },
      { name: "hammer_recovery", file: "HammerRecovery.png", frames: 2 },
      { name: "hit", file: "Take_hit.png", frames: 3 },
      { name: "death", file: "Death.png", frames: 7 },
    ],
  },
  {
    dir: path.join("public", "assets", "huntress"),
    image: "huntress.png",
    json: "huntress.json",
    sourceCell: 150,
    animations: [
      { name: "idle", file: "Idle.png", frames: 8 },
      { name: "run", file: "Run.png", frames: 8 },
      { name: "jump", file: "Jump.png", frames: 2 },
      { name: "fall", file: "Fall.png", frames: 2 },
      { name: "attack1", file: "Attack1.png", frames: 5 },
      { name: "attack2", file: "Attack2.png", frames: 5 },
      { name: "attack3", file: "Attack3.png", frames: 7 },
      { name: "hit", file: "Take hit.png", frames: 3 },
      { name: "death", file: "Death.png", frames: 8 },
    ],
  },
  {
    dir: path.join("public", "assets", "samurai-mack"),
    image: "enemy.png",
    json: "enemy.json",
    animations: [
      { name: "idle", file: "Idle.png", frames: 8 },
      { name: "run", file: "Run.png", frames: 8 },
      { name: "jump", file: "Jump.png", frames: 2 },
      { name: "fall", file: "Fall.png", frames: 2 },
      { name: "attack1", file: "Attack1.png", frames: 6 },
      { name: "attack2", file: "Attack2.png", frames: 6 },
      { name: "hit", file: "Take Hit.png", frames: 4 },
      { name: "death", file: "Death.png", frames: 6 },
    ],
  },
];

function build({ dir, image, json, animations, sourceCell = CELL }) {
  const total = animations.reduce((n, a) => n + a.frames, 0);
  const rows = Math.ceil(total / COLS);
  const sheet = new PNG({ width: COLS * CELL, height: rows * CELL });
  sheet.data.fill(0);

  const frames = {};
  const anims = {};
  let index = 0;

  for (const anim of animations) {
    const strip = PNG.sync.read(fs.readFileSync(path.join(dir, anim.file)));
    if (strip.height !== sourceCell) throw new Error(`${anim.file}: expected height ${sourceCell}, got ${strip.height}`);
    const fit = CELL / sourceCell;
    anims[anim.name] = [];

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
      anims[anim.name].push(key);

      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const sx = f * sourceCell + Math.min(sourceCell - 1, Math.floor(x / fit));
          const sy = Math.min(sourceCell - 1, Math.floor(y / fit));
          const src = (sy * strip.width + sx) * 4;
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
    animations: anims,
    meta: {
      app: "cricket build-spritesheet",
      version: "1.0",
      image,
      format: "RGBA8888",
      size: { w: COLS * CELL, h: rows * CELL },
      scale: "1",
    },
  };

  fs.writeFileSync(path.join(dir, image), PNG.sync.write(sheet));
  fs.writeFileSync(path.join(dir, json), JSON.stringify(meta, null, 2) + "\n");
  console.log(`${json}: ${COLS * CELL}x${rows * CELL}, ${total} frames`);
  console.log(Object.entries(anims).map(([k, v]) => `${k}:${v.length}`).join(" "));
}

for (const set of SETS) build(set);



/**
 * Martial Hero 3 (LuizMelo, CC0) → 拳师 200x200 序列帧。
 * 源帧来自 alelthomas/2d-jungle-game 镜像；抠掉长枪（冷蓝色），保留拳击姿态。
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const SRC = path.join(".tmp", "mh3");
const OUT = path.join("public", "assets", "boxer");
const CELL = 200;

const FILES = {
  idle: "idle.png",
  run: "run.png",
  attack: "attack.png",
  hit: "attacked.png",
  death: "dead.png",
  jump: "jump.png",
  fall: "fall.png",
};

function load(name) {
  return PNG.sync.read(fs.readFileSync(path.join(SRC, FILES[name])));
}

function stripSpear(png) {
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] === 0) continue;
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (b > 120 && b > r + 15 && b > g + 5) png.data[i + 3] = 0;
  }
  return png;
}

function cellFrom(png, frame) {
  const s = 126;
  const out = new PNG({ width: CELL, height: CELL });
  out.data.fill(0);
  const scale = CELL / s;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const sx = Math.min(s - 1, Math.floor(x / scale));
      const sy = Math.min(s - 1, Math.floor(y / scale));
      const si = (sy * png.width + frame * s + sx) * 4;
      const di = (y * CELL + x) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

function strip(name, png, indices) {
  const out = new PNG({ width: CELL * indices.length, height: CELL });
  out.data.fill(0);
  indices.forEach((frame, i) => {
    const cell = cellFrom(png, frame);
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
  console.log(`${name}.png: ${indices.length} frames`);
}

fs.mkdirSync(OUT, { recursive: true });

const idle = stripSpear(load("idle"));
const run = stripSpear(load("run"));
const attack = stripSpear(load("attack"));
const hit = stripSpear(load("hit"));
const death = stripSpear(load("death"));
const jump = stripSpear(load("jump"));
const fall = stripSpear(load("fall"));

strip("Idle", idle, [0, 1, 2, 3, 4, 5]);
strip("Run", run, [0, 1, 2, 3, 4, 5, 6, 7]);
strip("Jump", jump, [0, 1, 2]);
strip("Fall", fall, [0, 1, 2]);
strip("Attack1", attack, [0, 1, 2, 3, 4, 5, 6]);
strip("Attack2", attack, [2, 3, 4, 5, 6, 5, 4]);
strip("Attack3", attack, [1, 2, 3, 4, 5, 6, 3]);
strip("Take hit", hit, [0, 1, 2]);
strip("Death", death, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
strip("Getup", death, [10, 9, 8, 7]);

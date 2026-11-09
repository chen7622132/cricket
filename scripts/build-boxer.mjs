/**
 * 程序化生成拳师专属 200x200 像素帧：刺拳 / 直拳 / 上勾拳 + 待机/跑/受击/倒地/起身。
 * 纯矩形像素绘制，风格为硬边像素块；后续可替换为手绘。
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const S = 200;
const SKIN = [235, 190, 150, 255];
const SKIN_D = [200, 150, 115, 255];
const HAIR = [30, 24, 22, 255];
const SHORT = [180, 45, 45, 255];
const SHORT_D = [130, 30, 30, 255];
const GLOVE = [70, 120, 220, 255];
const GLOVE_D = [40, 70, 150, 255];
const BOOT = [50, 55, 65, 255];
const OUT = [12, 14, 20, 255];

function makeFrame() {
  return new PNG({ width: S, height: S });
}

function px(png, x, y, w, h, c) {
  for (let yy = y; yy < y + h; yy++) {
    if (yy < 0 || yy >= S) continue;
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || xx >= S) continue;
      const i = (yy * S + xx) * 4;
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = c[3];
    }
  }
}

const outline = (png, x, y, w, h) => px(png, x - 2, y - 2, w + 4, h + 4, OUT);

function draw(png, pose) {
  const cx = 100;
  const ground = 186;
  const lean = pose.lean ?? 0;
  const headY = 54 + (pose.crouch ?? 0);
  const torsoY = 82 + (pose.crouch ?? 0);
  const hipY = torsoY + 42;

  // 腿
  const legSpread = pose.legs ?? 6;
  outline(png, cx - 22, hipY, 14, ground - hipY - 8);
  px(png, cx - 20, hipY, 10, ground - hipY - 8, SKIN_D);
  outline(png, cx + 8, hipY, 14, ground - hipY - 8);
  px(png, cx + 10, hipY, 10, ground - hipY - 8, SKIN_D);
  px(png, cx - 24, ground - 10, 20, 10, BOOT);
  px(png, cx + 6, ground - 10, 20, 10, BOOT);

  // 躯干 + 短裤
  outline(png, cx - 20 + lean, torsoY, 40, 44);
  px(png, cx - 18 + lean, torsoY, 36, 40, SKIN);
  px(png, cx - 20 + lean, hipY, 40, 16, SHORT);
  px(png, cx - 20 + lean, hipY + 12, 40, 6, SHORT_D);

  // 头
  outline(png, cx - 14 + lean, headY, 28, 28);
  px(png, cx - 12 + lean, headY, 24, 24, SKIN);
  px(png, cx - 14 + lean, headY - 4, 28, 8, HAIR);
  px(png, cx - 6 + lean, headY + 12, 4, 4, OUT);
  px(png, cx + 4 + lean, headY + 12, 4, 4, OUT);

  // 手臂
  const jab = pose.jab ?? false;
  const cross = pose.cross ?? false;
  const upper = pose.upper ?? 0;

  // 左臂（前手）
  if (jab) {
    outline(png, cx + 18 + lean, torsoY + 4, 52, 12);
    px(png, cx + 18 + lean, torsoY + 6, 48, 8, SKIN);
    px(png, cx + 62 + lean, torsoY + 2, 18, 18, GLOVE);
    px(png, cx + 62 + lean, torsoY + 2, 18, 6, GLOVE_D);
  } else {
    outline(png, cx + 12 + lean, torsoY + 4 + upper, 18, 34);
    px(png, cx + 14 + lean, torsoY + 6 + upper, 14, 30, SKIN);
    px(png, cx + 10 + lean, torsoY + 24 + upper, 20, 18, GLOVE);
  }

  // 右臂（后手）
  if (cross) {
    outline(png, cx - 68 + lean, torsoY + 8, 52, 12);
    px(png, cx - 64 + lean, torsoY + 10, 48, 8, SKIN);
    px(png, cx - 80 + lean, torsoY + 6, 18, 18, GLOVE_D);
  } else if (upper > 0) {
    outline(png, cx + 8 + lean, torsoY - 24 - upper, 16, 42);
    px(png, cx + 10 + lean, torsoY - 22 - upper, 12, 38, SKIN);
    px(png, cx + 6 + lean, torsoY - 34 - upper, 20, 18, GLOVE);
  } else {
    outline(png, cx - 28 + lean, torsoY + 6 + upper, 18, 34);
    px(png, cx - 26 + lean, torsoY + 8 + upper, 14, 30, SKIN);
    px(png, cx - 30 + lean, torsoY + 26 + upper, 20, 18, GLOVE_D);
  }
}

const SETS = {
  Idle: [
    { name: "idle0", pose: {} },
    { name: "idle1", pose: { crouch: 1, lean: 1 } },
    { name: "idle2", pose: { crouch: 2 } },
    { name: "idle3", pose: { crouch: 1, lean: -1 } },
  ],
  Run: [0, 1, 2, 3, 4, 5].map((i) => ({ name: `run${i}`, pose: { legs: i % 2 ? 10 : 2, lean: 2, crouch: 1 } })),
  Jump: [{ pose: { legs: 2, crouch: -2 } }, { pose: { legs: 0, crouch: -4 } }],
  Fall: [{ pose: { legs: 12, crouch: 0 } }, { pose: { legs: 14, crouch: 2 } }],
  Attack1: [
    { pose: { jab: false } },
    { pose: { jab: true, lean: 3 } },
    { pose: { jab: true, lean: 4 } },
    { pose: { jab: false, lean: 1 } },
  ],
  Attack2: [
    { pose: { cross: false, lean: -2 } },
    { pose: { cross: true, lean: 2 } },
    { pose: { cross: true, lean: 4 } },
    { pose: { cross: false, lean: 1 } },
  ],
  Attack3: [
    { pose: { crouch: 6, upper: 0 } },
    { pose: { crouch: 4, upper: 8 } },
    { pose: { crouch: 0, upper: 18 } },
    { pose: { crouch: 0, upper: 10 } },
  ],
  "Take hit": [{ pose: { lean: -6, crouch: 2 } }, { pose: { lean: -4, crouch: 1 } }],
  Death: [
    { pose: { lean: -8, crouch: 6 } },
    { pose: { lean: -14, crouch: 14 } },
    { pose: { lean: -20, crouch: 22 } },
    { pose: { lean: -24, crouch: 26 } },
  ],
  Getup: [
    { pose: { lean: -24, crouch: 26 } },
    { pose: { lean: -10, crouch: 16 } },
    { pose: { lean: -4, crouch: 8 } },
    { pose: {} },
  ],
};

const dir = path.join("public", "assets", "boxer");
fs.mkdirSync(dir, { recursive: true });

for (const [file, frames] of Object.entries(SETS)) {
  const png = new PNG({ width: S * frames.length, height: S });
  png.data.fill(0);
  frames.forEach((f, i) => {
    const frame = makeFrame();
    frame.data.fill(0);
    draw(frame, f.pose);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const si = (y * S + x) * 4;
        const di = (y * png.width + i * S + x) * 4;
        png.data[di] = frame.data[si];
        png.data[di + 1] = frame.data[si + 1];
        png.data[di + 2] = frame.data[si + 2];
        png.data[di + 3] = frame.data[si + 3];
      }
    }
  });
  const out = path.join(dir, `${file}.png`);
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log(`${out}: ${frames.length} frames`);
}

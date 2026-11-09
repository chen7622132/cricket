/**
 * 生成武士专用的 200x200 大剑气序列（8 帧）。
 * 纯代码像素绘制：白芯 + 冷色外焰 + 尾部余烬，逐帧向外扫出。
 */
import fs from "node:fs";
import { PNG } from "pngjs";

const W = 200;
const H = 200;
const FRAMES = 8;

const out = new PNG({ width: W * FRAMES, height: H });
out.data.fill(0);

const put = (fx, x, y, r, g, b, a) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = ((y * out.width) + fx * W + x) * 4;
  const inv = 1 - a;
  out.data[i] = Math.round(r * a + out.data[i] * inv);
  out.data[i + 1] = Math.round(g * a + out.data[i + 1] * inv);
  out.data[i + 2] = Math.round(b * a + out.data[i + 2] * inv);
  out.data[i + 3] = Math.min(255, out.data[i + 3] + Math.round(255 * a));
};

for (let f = 0; f < FRAMES; f++) {
  const progress = f / (FRAMES - 1);
  const cx = 96 - progress * 18;
  const cy = 100;
  const radius = 46 + progress * 34;
  const thickness = 13 - progress * 7;
  const sweep = 0.55 + progress * 0.85;
  const bright = 0.55 + progress * 0.45;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx);
      const along = Math.abs(theta);
      if (along > sweep) continue;
      const edge = Math.abs(r - radius);
      if (edge > thickness) continue;

      const core = 1 - edge / thickness;
      const fade = Math.pow(core, 1.6) * (1 - along / sweep) * bright;
      // 白芯 → 冰蓝 → 青白外焰
      if (core > 0.62) put(f, x, y, 255, 255, 255, fade * 0.95);
      else if (core > 0.3) put(f, x, y, 170, 232, 255, fade * 0.8);
      else put(f, x, y, 70, 150, 255, fade * 0.55);
    }
  }

  // 尾部余烬：沿弧线撒几粒
  for (let k = 0; k < 7; k++) {
    const a = sweep * (0.35 + (k / 7) * 0.6);
    const rr = radius + (k % 3) * 4 - 4;
    const x = Math.round(cx + Math.cos(a) * rr + (f % 2 ? 3 : 0));
    const y = Math.round(cy + Math.sin(a) * rr);
    put(f, x, y, 255, 236, 180, 0.5 * bright);
    put(f, x + 1, y, 255, 200, 110, 0.35 * bright);
  }
}

fs.mkdirSync("public/assets/fx", { recursive: true });
fs.writeFileSync("public/assets/fx/samurai-slash.png", PNG.sync.write(out));
console.log(`samurai-slash.png ${W * FRAMES}x${H}, ${FRAMES} frames`);

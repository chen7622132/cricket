import * as PIXI from "pixi.js";

export const ARENA = {
  w: 960,
  h: 320,
  floorY: 248,
  slotCount: 6,
};

/** 场地中央的三根高低立柱：角色可以站上不同柱子，形成 Y 轴高低差。 */
export const PILLARS = [
  { x0: 280, x1: 344, top: 200 },
  { x0: 420, x1: 484, top: 168 },
  { x0: 560, x1: 624, top: 214 },
  { x0: 700, x1: 764, top: 184 },
];

/** 格点落在柱子上或地面：决定落脚高度。 */
export function terrainY(x: number): number {
  for (const p of PILLARS) {
    if (x >= p.x0 && x <= p.x1) return p.top;
  }
  return ARENA.floorY;
}

/** 场地的 6 个离散格点：位移只在格点之间补间，不做持续漂移。 */
export const SLOT_X = [160, 312, 452, 592, 732, 860];

export function slotX(slot: number): number {
  const i = Math.max(0, Math.min(SLOT_X.length - 1, slot));
  return SLOT_X[i];
}

/** 固定广角的竞技场背景：不滚动、不旋转、不跟拍。 */
export function createArena(): PIXI.Container {
  const root = new PIXI.Container();
  const bg = new PIXI.Graphics();

  // 天空分层
  const bands = [
    [0, 0x0d1524],
    [34, 0x121d31],
    [68, 0x182741],
    [102, 0x1f3352],
    [136, 0x273f5e],
  ];
  for (const [y, color] of bands) {
    bg.rect(0, y, ARENA.w, 40).fill({ color });
  }

  // 远景遗迹剪影
  bg.moveTo(0, ARENA.floorY);
  const ruins = [
    [30, 190, 34, 58], [88, 168, 22, 80], [126, 202, 40, 46],
    [210, 158, 28, 90], [262, 188, 46, 60], [330, 176, 24, 72],
    [372, 198, 52, 50], [470, 162, 26, 86], [520, 190, 44, 58],
    [586, 172, 22, 76], [660, 178, 34, 70], [720, 158, 30, 90],
    [780, 192, 40, 56], [840, 168, 26, 80], [900, 188, 34, 60],
  ];
  for (const [x, y, w, h] of ruins) {
    bg.rect(x, y, w, h).fill({ color: 0x121b2b });
    bg.rect(x + w * 0.35, y + 8, 3, 6).fill({ color: 0x4a6a92 });
  }
  bg.fill();

  // 地平线雾
  const fog = new PIXI.Graphics();
  fog.rect(0, ARENA.floorY - 12, ARENA.w, 16).fill({ color: 0x3b5a80, alpha: 0.4 });

  // 地面
  const floor = new PIXI.Graphics();
  floor.rect(0, ARENA.floorY, ARENA.w, ARENA.h - ARENA.floorY).fill({ color: 0x1b2231 });
  floor.rect(0, ARENA.floorY, ARENA.w, 2).fill({ color: 0x5a7597 });
  // 透视格线
  floor.setStrokeStyle({ width: 1, color: 0x2c3950, alpha: 0.9 });
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * ARENA.w;
    floor.moveTo(x, ARENA.floorY).lineTo(ARENA.w / 2 + (x - ARENA.w / 2) * 1.6, ARENA.h);
  }
  for (let i = 1; i <= 3; i++) {
    const y = ARENA.floorY + i * 18;
    floor.moveTo(0, y).lineTo(ARENA.w, y);
  }
  floor.stroke();

  // 格点刻度
  const ticks = new PIXI.Graphics();
  for (let i = 0; i < SLOT_X.length; i++) {
    const x = SLOT_X[i];
    ticks.rect(x - 0.5, ARENA.floorY + 2, 1, 6).fill({ color: 0x6f8db3, alpha: 0.9 });
    ticks.rect(x - 6, ARENA.floorY + 10, 12, 1).fill({ color: 0x33415a, alpha: 0.95 });
  }

  root.addChild(bg, fog, floor, ticks);

  // 两侧火盆：给暗场地一点光，也作为场地边界提示
  const braziers = new PIXI.Graphics();
  for (const x of [74, 566]) {
    braziers.circle(x, ARENA.floorY - 16, 12).fill({ color: 0xff7a1a, alpha: 0.09 });
    braziers.circle(x, ARENA.floorY - 16, 5).fill({ color: 0xffb057, alpha: 0.16 });
    braziers.rect(x - 2, ARENA.floorY - 14, 4, 14).fill({ color: 0x2a3446 });
    braziers.circle(x, ARENA.floorY - 17, 3).fill({ color: 0xffc46b });
    braziers.circle(x, ARENA.floorY - 18, 1.4).fill({ color: 0xfff2cf });
  }
  root.addChild(braziers);

  // 中央三根高低立柱：接近正方形的石柱，顶部有亮面
  const pillars = new PIXI.Graphics();
  for (const p of PILLARS) {
    const w = p.x1 - p.x0;
    const cx = (p.x0 + p.x1) / 2;
    // 柱身
    pillars.rect(p.x0, p.top + 5, w, ARENA.floorY - p.top + 46).fill({ color: 0x1d2738 });
    // 柱顶亮面
    pillars.rect(p.x0 - 3, p.top, w + 6, 7).fill({ color: 0x3d5170 });
    pillars.rect(p.x0 - 3, p.top, w + 6, 2).fill({ color: 0x93b4da });
    // 侧面阴影
    pillars.rect(p.x1 - 4, p.top + 6, 4, ARENA.floorY - p.top + 44).fill({ color: 0x0f1726 });
    // 竖向纹路
    pillars.setStrokeStyle({ width: 1, color: 0x2b3a52, alpha: 0.8 });
    pillars.moveTo(cx, p.top + 10).lineTo(cx, ARENA.floorY + 40);
    pillars.stroke();
    // 底部投影
    pillars.ellipse(cx, ARENA.floorY + 44, w * 0.55, 5).fill({ color: 0x000000, alpha: 0.35 });
  }
  root.addChild(pillars);

  return root;
}



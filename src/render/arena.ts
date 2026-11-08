import * as PIXI from "pixi.js";

export const ARENA = {
  w: 640,
  h: 270,
  floorY: 208,
  platformX: 440,
  platformTop: 176,
  slotCount: 6,
};

/** 右侧高台：给战斗一个 Y 轴地形（走上台阶就抬高）。 */
export function terrainY(x: number): number {
  if (x <= 420) return ARENA.floorY;
  if (x >= 470) return ARENA.platformTop;
  const t = (x - 420) / 50;
  return Math.round(ARENA.floorY + (ARENA.platformTop - ARENA.floorY) * t);
}

/** 场地的 6 个离散格点：位移只在格点之间补间，不做持续漂移。 */
export const SLOT_X = [120, 168, 216, 264, 312, 360];

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
  bg.moveTo(0, 208);
  const ruins = [
    [30, 150, 34, 58],
    [88, 128, 22, 80],
    [126, 162, 40, 46],
    [210, 118, 28, 90],
    [262, 148, 46, 60],
    [330, 136, 24, 72],
    [372, 158, 52, 50],
    [470, 122, 26, 86],
    [520, 150, 44, 58],
    [586, 132, 22, 76],
  ];
  for (const [x, y, w, h] of ruins) {
    bg.rect(x, y, w, h).fill({ color: 0x121b2b });
    bg.rect(x + w * 0.35, y + 8, 3, 6).fill({ color: 0x4a6a92 });
  }
  bg.fill();

  // 地平线雾
  const fog = new PIXI.Graphics();
  fog.rect(0, 196, ARENA.w, 16).fill({ color: 0x3b5a80, alpha: 0.4 });

  // 地面
  const floor = new PIXI.Graphics();
  floor.rect(0, ARENA.floorY, ARENA.w, ARENA.h - ARENA.floorY).fill({ color: 0x1b2231 });
  floor.rect(0, ARENA.floorY, ARENA.w, 2).fill({ color: 0x5a7597 });
  // 透视格线
  floor.setStrokeStyle({ width: 1, color: 0x2c3950, alpha: 0.9 });
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * ARENA.w;
    floor.moveTo(x, ARENA.floorY).lineTo(240 + (x - 240) * 1.6, ARENA.h);
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

  // 右侧高台：地面之上的一层台阶，角色站上去会自然抬高
  const platform = new PIXI.Graphics();
  // 台阶（420-470 斜坡），让上台有可读的过渡
  for (let i = 0; i < 3; i++) {
    const y = ARENA.floorY - (i + 1) * 10;
    platform.rect(420 + i * 14, y, 20, 12).fill({ color: 0x28344a });
    platform.rect(420 + i * 14, y, 20, 2).fill({ color: 0x6f8db3, alpha: 0.8 });
  }
  // 台体
  platform.rect(ARENA.platformX, ARENA.platformTop + 6, ARENA.w - ARENA.platformX, ARENA.floorY - ARENA.platformTop + 40)
    .fill({ color: 0x1c2637 });
  // 台面（更亮，明确"站得上去"）
  platform.rect(ARENA.platformX, ARENA.platformTop, ARENA.w - ARENA.platformX, 6)
    .fill({ color: 0x3a4e6b });
  platform.rect(ARENA.platformX, ARENA.platformTop, ARENA.w - ARENA.platformX, 2)
    .fill({ color: 0x8fb0d6 });
  platform.rect(ARENA.platformX - 4, ARENA.platformTop, 4, ARENA.floorY - ARENA.platformTop + 46)
    .fill({ color: 0x0f1726 });
  platform.setStrokeStyle({ width: 1, color: 0x2f4059, alpha: 0.9 });
  for (let i = 1; i <= 2; i++) {
    platform.moveTo(ARENA.platformX, ARENA.platformTop + i * 18).lineTo(ARENA.w, ARENA.platformTop + i * 18);
  }
  platform.stroke();
  root.addChild(platform);

  return root;
}



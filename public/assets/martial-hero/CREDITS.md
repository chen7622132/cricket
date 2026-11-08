# 素材与授权

## 角色：Martial Hero 2

- 作者：LuizMelo
- 授权：**CC0 1.0（Creative Commons Zero）**，可商用、可修改、无需署名（本项目仍在此标注来源）
- 原始授权文件：见同目录 `License.txt`
- 使用方式：`scripts/build-spritesheet.mjs` 把横排序列帧合成为 `hero.png` + `hero.json`，
  运行时用 PixiJS `Assets.load` + `AnimatedSprite` 播放。

| 动画 | 帧数 | 用途 |
|---|---|---|
| idle | 4 | 待机 |
| run | 8 | 前冲 / 击退 / 换位 |
| attack1 | 4 | 突刺 / 处决 / 还击 |
| attack2 | 4 | 碎地锤 / 横扫 / 格挡 |
| hit | 3 | 受击 |
| death | 7 | 死亡 |

## 特效：pixelfx

- 仓库：https://github.com/patch-gg/pixelfx
- 授权：MIT
- 使用方式：离屏 Uint32 帧缓冲 → Pixi 纹理，按 tier 选择招式/命中特效。

## 粒子：pixi-particles-engine

- 授权：见 npm 包 LICENSE
- 使用方式：manual 模式 + RadialBurstBehaviour，命中 cue 触发 `emitBurst`。

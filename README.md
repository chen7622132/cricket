# cricket · 规则表驱动自动战斗（P0 切片）

> 目标不是完整游戏，是验证一件事：**同一套规则换种子过程不同，同种子换规则结果变。**

已落地：确定性 60Hz 战斗引擎 + 规则仲裁（priority / cost / interrupt）+ 事件总线 + 4 条 combo 链 + pixelfx 演出分层 + 三种空间转换 + 可复现验收脚本。

---

## 1. 快速开始

```bash
cd cricket
npm install

npm run dev        # 浏览器 demo（Vite，默认 http://localhost:5273）
npm run accept     # 4 条最小验收（Node headless，输出日志到 logs/）
npm test           # 15 个单元测试（确定性 / 规则仲裁 / combo / 演出分层 / 空间转换）
npm run build      # tsc --noEmit + vite build
npm run probe      # 无头浏览器运行时探针（hitstop / 镜头 / 慢放 / 位移）
```

CI（`.github/workflows/ci.yml`）在每次 push 到 `main` 时跑：`npm ci → build → test → accept`。

demo 里可以：改 seed、切规则表 A/B、开打、1×/2×/4×、按 `R` 重开。
点「规则表」按钮（或按 `T`）打开规则面板：列出双方每条规则的序号、priority、代价与条件，**当前触发的规则行会实时高亮**——「优先级抢断」不再只存在于日志里。
开场日志第一行是**同 seed 预演出来的预测结果**，实况结束时帧数/剩余血量完全一致——这是确定性的现场自证。

---

## 2. 已验收的四条（实测输出见 `logs/acceptance.txt`）

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| A1 | 同一套规则，3 个 seed 打出 3 局不同过程 | ✅ | digest 3/3 唯一；结局（胜者:帧数）3/3 唯一；每对 seed 都有因果说明（暴击 rng 值 → 40% 血线击穿帧 → 蓄力时机平移） |
| A2 | 同一个 seed，换规则表结果改变 | ✅ | seed 20260101：A 表 19.45s / 英雄剩 55；B 表 23.48s / 英雄剩 35；分叉点定位到第 85 帧 A 规则[3] 处决 vs B 规则[6] 突刺 |
| A3 | ≥3 条 combo 链在日志里被识别为链 | ✅ | 打断链 3 次、流血处决链 12 次、格挡还击链 10 次、看破暴击链 6 次，共 31 次链路成立（日志里有 `combo 链[名] n/m ✓`） |
| A4 | 普通命中 / 关键判定 / 全场最重 三层分层 | ✅ | hitstop 4 / 10 / 20 帧（区间 3–5 / 8–12 / 15–25）；普通命中无镜头无震动；处决 15 次、换位 6 次均为 ultimate |
| D1 | 同 seed 同规则完全可复现（附加） | ✅ | 两次运行 digest `db72d67a` 一致 |

`npm run probe` 的实测（4× 速播放一整局）：hitstop 三档都触发、crash-zoom 最大 1.415、慢放 66 个采样帧、位移落定 59 帧、特效并发封顶 16、无 console 错误。

---

## 3. 架构：逻辑与渲染完全解耦

```
src/
  engine/                 ← 纯 TS，可在 Node 跑，无 DOM
    rng.ts                mulberry32 + 带标签的随机数记录
    skills.ts             招式表（windup / recovery / tier / fx 键）
    rules.ts              规则表 A / B / ENEMY（规则序号、优先级、代价）
    battle.ts             固定步长模拟、规则仲裁、命中结算、combo 链、里程碑
    types.ts              BattleEvent / RuleDef / Cost / ActorView
  presentation/
    tiers.ts              ← 演出层级表（引擎与渲染共用，验收也读它）
  render/                 ← PixiJS v8 + pixelfx
    arena.ts              固定广角竞技场、6 个离散格点
    camera.ts             固定广角 + 轻推 + crash-zoom + shake
    fighter.ts            火柴人绘制、武器、状态图标、残影
    fx.ts                 pixelfx 桥：每特效独立离屏 canvas → Pixi 纹理
    presenter.ts          事件 → hitstop / 镜头 / 特效 / 位移
    game.ts               60Hz 逻辑 + 可变帧率渲染
  ui/hud.ts               血条 / 识破 / 状态 / 日志 / 横幅
  cli/acceptance.ts       4 条最小验收
```

引擎 `step()` 只推进逻辑、产出事件；渲染层订阅事件，自己管理时间。**引擎不 import Pixi，渲染层不写战斗规则。**

---

## 4. 规则系统

```ts
{
  id: "A_interrupt",
  name: "突刺打断",
  when: "敌方蓄力 且 距离≤2 且 识破≥1",
  priority: 90,
  cost: { kind: "resource", insight: 1 },   // resource | skip_next | hard_cc
  skill: "hero_thrust",
  tags: ["interrupt"],
  test: ({ self, foe }) => foe.charging && self.distance <= 2 && self.insight >= 1,
}
```

- **仲裁**：同一帧所有条件成立的规则按 `priority` 降序（同优先级按表内序号）排序，只执行最高那条。
- **抢断日志**：只要 ≥2 条规则同时成立，就写
  `规则[3] 抢在 规则[10] 前面触发（priority 86 > 12，差 74）`。
- **代价**（三条打断类规则各用了一种）：
  - 突刺打断 → 消耗 1 点识破（资源）
  - 闪避 → 跳过下一条（锁 20 帧）
  - 处决 → 自身硬直 36 帧
- **识破**：初始 2/3，15s 回 1 点；打断 / 闪避 / 看破共用同一个池。蓄力来了但识破只剩 1 点时，规则表会选「看破」（92）而不是「打断」（90）——资源不足时行为自然退化，这是设计出来的分支。

规则表 B 故意删掉打断与处决、把格挡提到最高优先级，用来做「同 seed 换规则」验收。

### 4 条 combo 链

| 链 | 步骤 | 触发条件 |
|---|---|---|
| 打断链 | 敌蓄力 → 突刺打断成功 | 识破 ≥1 |
| 流血处决链 | 裂伤挂流血 → 碎地锤击晕 → 处决突刺 | 标准连段 |
| 格挡还击链 | 敌蓄力（不打断）→ 格挡吃下重锤 → 后摇还击命中 | 识破耗尽 |
| 看破暴击链 | 花识破看破 → 看破后的暴击 | 只剩 1 点识破 |

链在日志里是 `combo 链[流血处决链] 2/3：碎地锤击晕`，完成时 `3/3 ✓ 链路成立`，不是三个独立技能。

---

## 5. 确定性与「为什么不一样」

- 固定步长 1/60，逻辑里没有 `Math.random` / `Date.now`。
- 所有随机来自 `Rng`（mulberry32），每次抽取记录 `{frame, label, value}`。
- 敌方节奏带 0–36 帧的种子抖动，所以同规则表不同种子会「错拍」。
- 验收脚本对两局做差分：首次暴击帧与 rng 值 → 敌方 40% 血线击穿帧差 → 蓄力/重锤时机平移 → 结局差异，形成一条可读的因果链。

示例（seed 20260101 vs 424242）：

```
首次暴击：第 43 帧（rng 0.121）vs 第 149 帧（rng 0.102）
敌方跌破 40% 血线：第 719 帧 vs 第 727 帧
结局：19.45s 英雄剩 55  vs  21.93s 英雄剩 48
```

---

## 6. 事件总线

引擎产出：`RULE_TRIGGER` `PRIORITY_CLASH` `INTERRUPT_SUCCESS` `COMBO_STEP` `STATUS_APPLY` `CRIT` `KNOCKBACK` `SWAP` `EXECUTE`
渲染层额外消费：`SKILL_START` `HIT` `DAMAGE` `GUARD` `DODGE` `MOVE` `BATTLE_END`

`SKILL_START` 带 `windup / recovery / tier / fx`，渲染层据此排预备动作；`HIT` 在命中帧到达，才触发 hitstop 与关键特效——**触发点对齐 hits 阶段**。

---

## 7. 演出分层（`src/presentation/tiers.ts`）

| tier | hitstop | 镜头 | 特效 | 位移 |
|---|---|---|---|---|
| normal | 4 帧 | 不动 | `impacts/hit-spark` 轻特效 | 无 |
| key | 10 帧 | 沿命中方向轻推 6px + shake 2 | 整套招式特效；暴击再叠 crit-hit | 无 |
| ultimate | 20 帧 | crash-zoom（zoom≈1.16）+ 慢放 0.35× | 招式特效 + ground-slam | 换位 |

hitstop 只冻结表现层时间（`Presenter.freezeMs`），引擎 `step()` 照常推进——运行时探针验证了冻结期间战斗帧继续增长。

---

## 8. 空间转换（只做三种）

1. **突刺打断 → 自己前冲**（距离 >1 时真实位移，贴身则原地突刺）
2. **碎地锤 → 敌人后滑击退**
3. **优先级抢断 → 双方换位**（防守规则以 ≥40 优先级差抢掉攻击规则时触发，延迟 14 帧执行）

统一约束：全局大位移冷却 180 帧（3s）；大位移后渲染层停 260ms；位移带残影 + 地面影子留痕；状态图标挂头顶。

---

## 9. pixelfx 是怎么接的

pixelfx 不是 Pixi 插件，是**引擎无关的 Uint32 像素帧缓冲库**（`createFrame / createFx / composite`）。接入方式：

1. 每个特效实例开一张 256×192 离屏 canvas + `Frame`；
2. 每帧 `clearFrame → fx.update(dt) → draw(back) → draw(front) → composite → putImageData`；
3. 用 canvas 建 `PIXI.Texture`，sprite 按 0.7 缩放对齐命中点；
4. 生命周期到点 `fx.stop()`，并给并发数封顶 16（高倍速下 hitstop 冻结表现层时防止堆积）。

招式资源映射在 `src/render/fx.ts` 的 `FX_MODULES`，例如 `melee/thrust`、`melee/hammer-smash`、`impacts/crit-hit`、`status/stunned`、`lightning/charge-up`。原生 `meta.actor` 骨架没有使用（我们自己画火柴人，保证和逻辑状态完全同步）。

---

## 10. 与原始交付清单的偏差（重要）

| 项 | 处理 | 原因 |
|---|---|---|
| `pixi-tiledmap` | **未安装** | P0 没有手刷的 `.tmj` 地图；装了就是死依赖。竞技场先用 Graphics 程序化画，等有 Tiled 图再接。 |
| `@zakkster/lite-camera` | **未安装** | 镜头是固定广角 + 事件驱动推镜/zoom，需要与 tier 表和确定性对拍；自己实现约 60 行，比引入后再改 shake 模型更可控。 |
| `create pixi.js` 脚手架 | **未用** | CLI 是交互式的，在无 TTY 环境会卡住；直接手写 Vite + TS 配置，产物一致。 |
| `pixelfx` 原生角色骨架 | 未用 | 演出用自绘火柴人，才能逐帧跟随引擎状态与 hitstop。 |
| 敌人蓄力条件 | `血<40% 或 战斗≥4s` | 纯 40% 血线时，战斗在触发前就结束；加时间兜底后一局能稳定跑出 3 个蓄力分支（打断→看破→格挡）。 |
| 看破链 | 归入「识破资源共用」的第 4 条链 | 原清单第 4 条是资源约束，不是独立连段；实现成「只剩 1 点识破时选择看破而不是打断」。 |

---

## 11. 还没做的（P0 之外）

- 自由走位 / 程序化大地形 / 排行榜 / 赌博经济 / >12 技能 —— 按原要求未做。
- 真正的 Tiled 地图与镜头 deadzone / lookahead。
- 音效、音乐卡点（librosa）、更多敌人规则表。
- 视觉打磨：火柴人目前是程序化线条，没有骨骼动画与受击方向分肢。

---

## 12. 验收日志

- 完整日志：`logs/battle-seed*-rules*.log`
- 验收汇总：`logs/acceptance.txt`
- 截图：`shots/final-01.png`（连段中）、`shots/final-02.png`（角色描边/状态图标）、`shots/final-03.png`（结算）、`shots/final-04.png`（规则表面板 + 触发高亮）

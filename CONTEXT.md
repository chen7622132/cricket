# cricket — 上下文压缩（handoff）

> 用途：新会话从这里恢复，不必读完整历史。最后更新：2026-11-08。

## 项目
- PixiJS v8 + TypeScript + Vite；确定性 60Hz 战斗。
- 仓库：https://github.com/chen7622132/cricket（public）
- 线上：https://chen7622132.github.io/cricket/
- 本地：`C:\Users\czh15\Documents\deepseek-harness\default-workspace\cricket`
- 推送：SSH over 443（`ssh://git@ssh.github.com:443/chen7622132/cricket.git`），deploy key `~/.ssh/cricket_github`。

## 两种模式
### 规则模式（auto）
- 规则表 `WHEN → DO`，priority / cost / cooldown；6 格位移。
- 英雄 A–E、敌方 5 套，每套有独立 `mechanic` 被动（见下）。
- 预演与实况同 seed 完全一致。

### 编排模式（duel，`?mode=duel&seed=`）
- 8 槽 = 起手 1-3 / 爆发 4-6 / 收尾 7-8。
- 起手只允许 架势/格挡/位移/错位牌；起手 3 格总时长 ≥180f。
- 10 牌 = 架势、格挡、突进、瞬移、突刺、裂伤、碎地锤、处决、脱离、赌命一击。
- 每局按 seed 禁用 2 技能 + 1 位移；同 seed 同禁用；允许重复放同一张牌。
- 严格交替 P1→E1…；相邻钩子 裂伤→碎地锤 +50%。
- 归因日志字段：runId/seed/frame/slot/phase/actor/skill/hit/damage/affinity/displacement/freeze/queueLenAfter；写 localStorage。
- 处决命中后目标下一拍跳过（落地硬直）。

## 5×5 机制
英雄：A 打断（眩晕 60f）；B 铁壁（格挡 ×0.1，还击 70f）；C 识破经济（看破返还 1）；D 裂伤（流血双跳，处决 ×1.3）；E 背水（<40% 血伤害 ×1.35）。
敌方：重锤 ×1.2；破防（对格挡 ×1.3）；提前蓄力（重锤附 30f 眩晕）；快刀（横扫二段 50%）；游走（后撤 30f 闪避减伤）。

## 数值
- 英雄 160 血；敌方 360 血；敌方重锤 30、横扫 10。
- 5×5 矩阵（seed 20260101）：英雄 10 胜 / 敌方 15 胜。

## 表现层
- 竞技场 640×270；中央三根立柱顶 172/150/184，地面 208；`terrainY(x)` 决定落脚。
- 镜头跟随双方中点；左侧编排面板展开时镜头右移内缩；右日志栏可收起（`L`）。
- 程序化腾空/空中攻击；击飞（26–46px + 推出）；撞边界反弹 55%；掉落 + 落地硬直提示。
- 打击层：impact frame（白/黑 1-2 帧）、放射速度线、硬边碎屑、smear 2 帧拖影、受击闪白、按技能分型（突刺/X/地环/纵切/锯齿/扇形/护盾）与配色。
- 机制画面：浮字（背水/铁壁/破防/快刀/游走…）+ 背水红光、格挡弧、游走圈。

## 关键文件
- `src/engine/battle.ts`：规则触发、伤害/格挡/机制钩子、日志。
- `src/engine/rules.ts`：A–E / 5 敌方规则表、`mechanic`、`MECHANIC_LABEL`。
- `src/engine/skills.ts`：技能 windup/recovery、DAMAGE、HP。
- `src/duel/session.ts`：8 槽状态机、禁用、队列、归因日志。
- `src/render/presenter.ts`：位移/镜头/打击/机制表现。
- `src/render/impact.ts`：impact frame、速度线、碎屑、smear 触发。
- `src/render/arena.ts`：场地、立柱、`terrainY`。
- `src/ui/duelPanel.ts`、`src/main.ts`、`index.html`、`src/style.css`。

## 验证
```
npm test                                  # 32 tests
npx tsx src/cli/acceptance.ts             # 验收
node scripts/probe.mjs                    # 13 项运行时检查
npm run build
```
临时脚本：`.tmp/balance.ts`（5×5 矩阵）、`.tmp/duel8-check.mjs`（无头 3 局）、`.tmp/skipcheck.ts`。

## 已知限制
- duel 仍是离散槽位 + 表现层位移，不是自由走位/平台碰撞。
- 跳跃/空中攻击是程序化腾空，不是独立 JUMP 状态；无二段跳/空中受击。
- 机制提示是程序化 Graphics，没有专属序列帧 VFX。
- 数值平衡只按 seed 20260101 调过；其他 seed 结局会变。
- 无音频。

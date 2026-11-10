# cricket — 上下文压缩（handoff）

> 新会话从这里恢复，不必读完整历史。最后更新：2026-11-09。

## 项目
- PixiJS v8 + TypeScript + Vite；确定性 60Hz 自动战斗。
- 仓库：https://github.com/chen7622132/cricket（public）
- 线上：https://chen7622132.github.io/cricket/
- 本地：`C:\Users\czh15\Documents\deepseek-harness\default-workspace\cricket`
- 推送：SSH over 443，`ssh://git@ssh.github.com:443/chen7622132/cricket.git`。

## 两种模式
- 规则模式：`WHEN→DO` 规则表，priority/cost/cooldown，6 格位移；英雄 A–E / 敌方 5 套，各有 mechanic。
- 编排模式 `?mode=duel&seed=`：8 槽、10 牌、seed 禁用、严格交替、归因日志 localStorage。

## 角色（双方均可选，`?heroChar=&enemyChar=`）
- 武僧 martial（雷/拳）、武士 samurai（火/刀）、猎手 huntress（冰/弓）、法师 wizard（火/法杖）、骨架 skeleton（占位分件，测试用）。
- 远程：距离 2–4 发弹道；剑=剑气血刃、弓=冰箭、法师=火球（pixelfx 火球素材）、武僧=发劲波。
- 远程角色（猎手/法师）额外有「强射」（距离 3–5，伤害 +3，弹道放大）。
- 法师专属「暗触禁锢」：远程 2–4，6 伤害，24f 禁锢 + 推开，240f CD。

## 战斗机制
- 弹反：格挡后 45f 内被击中 → 0 伤害、攻击方 40f 硬直、防守方 70f 还击窗口。
- 取消：命中后 2–6f（seed 抖动）可取消到更高 tier（普通→关键→必杀），无额外惩罚。
- 多段：`SkillDef.multi={count,interval}`；高频突刺 3×6f、旋风斩 4×8f，后续段 ×0.6 伤害，每段独立反馈。
- 击飞：冲量 110/210 + 0.07/0.14s 持续力 + 阻力；位移上限 500px；空中旋转。
- 倒地：落地才挂 downed 60f（1s），无敌覆盖；GETUP 播放 4 帧起身（Death 反放生成的烘焙帧）。
- 处决/碎地锤/受身/连招链仍按原规则表。

## 数值
- 英雄 560 血 / 敌方 1120 血；对局上限 10800f（180s）。
- 5×5 矩阵（seed 20260101）：约 11 英雄胜 / 14 敌方胜；单局约 55–75s。

## 表现层
- 竞技场 960×320，floorY 248；`terrainY(x)`。
- 速度档：0.25/0.5/0.75/1/1.5/2/4；表现层 animScale 跟随速度，顿帧按真实 ms（不受速度影响）。
- 反馈：顿帧（3/8/16f，拼刀 250/150ms）、闪白、像素抖动、压扁、定向火花、pixelfx parry/ricochet/heavy-landing/sword-slash。
- 镜头：trauma² + 多层低频噪声；落地/拼刀/必杀有 flash 与震屏。
- 场内浮字只保留：弹反、拼刀/振刀、必杀伤害数字。
- 武士刀光：additive 刀尖拖尾 + 刀尖月牙 + 每 50ms 残影/火花。
- 法师命中生成摆动贝塞尔触手（表现层）。
- 落地：双层冲击环 + heavy-landing + 顿帧。
- 血条：延迟残影 + 受击闪白 + 低血危险边框。

## 关键文件
- `src/engine/battle.ts`：规则/伤害/格挡/弹反/取消/多段/倒地/击飞。
- `src/engine/rules.ts`：A–E / 敌方规则 + 远程/强射/特技/突刺/旋风/触手规则。
- `src/engine/skills.ts`：技能、DAMAGE、HP、multi。
- `src/render/presenter.ts`：镜头/位移/命中/拖尾/触手/浮字/落地。
- `src/render/hero.ts`：序列帧状态机、弹簧冲刺、骨架 rig、GETUP。
- `src/render/impact.ts`：火花/刀光/元素/拼刀/落地。
- `src/render/fx.ts`：pixelfx 模块映射与图层。
- `src/render/camera.ts`：trauma 镜头。
- `src/render/characters.ts`：角色定义（元素/弹道/伤害/风格/rig）。
- `scripts/build-*.mjs`：精灵表、重击帧、起身帧、武士剑气。
- `public/assets/fx/`：fireball / sword-slash / samurai-slash。

## 验证
```
npm test                        # 32 tests
npx tsx src/cli/acceptance.ts   # A1–A4/D1
node scripts/probe.mjs          # 13 项运行时
npm run build
npm run sprites                 # 重建 4 角色精灵表
```

## 已知限制
- 无音频（用户明确要求不加）。
- 骨架角色是程序化占位分件，不是正式 DragonBones/Spine 资产。
- 触手是表现层曲线，判定仍为距离单点；禁锢复用 stun。
- 旋风斩不是旋转 hitbox，仍是格子距离判定。
- 弹反触发率低（0–1 次/局），防守规则不会主动卡帧。
- 取消无被弹反加罚；无独立取消动画。
- 起身帧由 Death/待机帧烘焙，不是手绘。
- 平衡按单 seed 调，未跑全量矩阵。


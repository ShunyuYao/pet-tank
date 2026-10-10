# 桌宠坦克营

一个单文件 HTML 的玩具坦克游戏，给「吐梨邦」桌宠的 HTML 作品能力做的。你的桌宠坐上玩具坦克，在玩具房地板上开火：积木墙能打碎，要守住自家的零食罐。

- **合作守家**：1–4 人一起打电脑敌车，一关 20 辆，共 6 关。打掉闪光的敌车会掉道具。
- **组队对战**：2v2，左边橘队、右边蓝队，先打翻对面的零食罐；3 分钟内都没打翻，击毁数多的一队赢。
- 在桌宠里打开：自动带入你当前的桌宠（3D 布偶或 2D 立绘），坐在坦克的炮塔上。
- 和朋友一起玩：在桌宠里「发送并一起玩」这份 HTML，再用游戏窗口控制栏的「＋ 邀请」拉第 3、4 个人。最多 4 人，支持局域网或互联网好友。对战时空位由电脑坦克补上。
- 单人：普通浏览器直接打开也能玩，合作守家单人打电脑，或者和电脑一起 2v2。

交付文件：`dist/桌宠坦克营.html`（three.js、cannon-es 与全部代码内联，无 CDN、无服务器）。

LAN 版本需要支持 4 人会话的桌宠宿主。互联网候选还需要支持 `transport:auto`、真实账号好友和认证中转；版本文字不能代替宿主验证。

## 键位

| 键 | 作用 |
|---|---|
| W A S D / 方向键 | 开车（同时按两个方向，以后按的为准） |
| J / 空格 | 开火，按住连发 |
| P | 显示 / 隐藏键位 |

Esc 在桌宠里会直接关掉游戏窗口，想离开请点右上角「离开」。

## 地形和道具

| 地形 | 说明 |
|---|---|
| 积木墙 | 一发子弹碎掉正前方一层 |
| 铁饼干盒 | 3 星子弹才打得穿 |
| 打翻的水 | 子弹能过，车过不去 |
| 毛毯 | 车开进去，对面就看不到 |
| 打蜡地板 | 松开方向键还会滑一段 |

| 道具 | 效果 |
|---|---|
| 星星 | 升一星：1 星子弹变快，2 星同屏 2 发，3 星打穿铁饼干盒 |
| 纸板护盾 | 10 秒无敌 |
| 胶带 | 零食罐周围的积木变铁饼干盒，持续 15 秒 |
| 鞭炮 | 场上的敌车全部爆掉 |
| 闹钟 | 敌车停住 10 秒 |
| 小鱼干 | +1 条命 |

## 开发

```bash
npm run build        # dist/桌宠坦克营.html
npm run test:rules   # 规则单测
npm run test:net     # 联机（pet-kit 的严格模拟宿主：丢包、限速、宿主限额）
npm run test:appearance # 保护罩期间的男女 3D 上身可见性（真实像素）
npm run test:browser # 普通浏览器端到端（真实按键）
npm run test:host    # 三个隐藏桌宠实例，真实局域网入口
npm run test:host:relay # 四个实例，真实中转/TLS/键盘输入
npm run test:host:mixed # 四个实例，局域网与中转混合
npm run test:delivery # 构建、规则、网络、浏览器和宿主聚合
PET_KIT_DIR=/absolute/pet-kit npm run kit:update # 导入审核过的固定库源码
```

规则、数值和每条规则对应的测试见 [docs/SPEC.zh-CN.md](docs/SPEC.zh-CN.md)。

## 第三方

- [pet-kit](https://github.com/ShunyuYao/pet-kit) 0.2.1（MIT）：`vendor/pet-kit/`，联机房间、传输、形象读取；由 `npm run kit:update`（显式设置 PET_KIT_DIR 为固定库源码的绝对路径）写入，不在本仓库里改。
- three.js 0.164.1（MIT）、cannon-es 0.20.0（MIT）：`vendor/lib/`
- pet-ragdoll-renderer 0.2.0（MIT）：`vendor/doll/`，说明见其中的 NOTICE.md
- 其余美术（地形、坦克、零食罐、道具、电脑的玩具形象）和音效都由代码生成，没有外部素材。

MIT License.

## Internet candidate / 互联网候选

默认 HTML 声明 `transport:auto`；单独的 `-LAN.html` 仅声明局域网。应用协议升为 v2，双方必须使用同一份文件，既有附件不会自动升级。pet-kit 0.2.1 管理房间、形象、传输和预算，玩法规则及预测不变。`dist/build*.json` and `vendor/pet-kit/VERSION.json` 记录实际产物与 vendor 摘要。

The default artifact supports host-selected LAN or authenticated relay transport. The separate LAN artifact shares application protocol v2. Both peers must accept the identical HTML. Four-process loopback tests do not prove physical internet connectivity; physical Test-account acceptance is recorded separately. This source candidate does not publish an installer or marketplace release.

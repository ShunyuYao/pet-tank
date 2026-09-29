# 桌宠坦克营 · 规格

桌宠坐进玩具坦克的炮塔，在玩具房地板上开火：积木墙能打碎，要守住自家的零食罐。两种模式：**合作守家**（1–4 人一起打电脑敌车，一关 20 辆，共 6 关）和**组队对战**（2v2，先打翻对面的零食罐）。局域网联机最多 4 人（桌宠「发送并一起玩」+ 控制栏「＋ 邀请」），普通浏览器也能单人玩。每个人用自己的桌宠上场：3D 布偶或 2D 立绘。

每条规则后面的「→」是对应的自动化断言。断言都由真实输入（按键、文件选择）或规则模块的公开入口驱动，不直接改内部标志。断言分四层：`rules`（node 规则单测）、`net`（模拟宿主会话，含丢包和限速）、`browser`（普通浏览器，真实按键）、`host`（三台真实桌宠宿主）。

## §1 场地

- 19 × 13 格，每格 2 × 2 块小砖（38 × 26 块）。地形按小砖记：空地、积木墙、铁饼干盒、打翻的水、毛毯、打蜡地板、零食罐。场地外面算墙。→ `rules: every map is 19×13 cells of 2×2 bricks`
- 合作 6 张图，对战 2 张图，都是手工设计的。合作图的零食罐在底边正中，周围一圈 8 块积木；对战图两队的零食罐在左右两端正中，各有一圈积木。→ `rules: every base has its ring of eight bricks`
- 敌车从顶边左、中、右三个出生点轮流出来；玩家的出生点在零食罐两侧（对战时在自家零食罐前面）。所有出生点都是空地。→ `rules: every spawn point is open floor`
- 每张合作图，从每个敌车出生点都有一条路能开到零食罐跟前（积木墙可以打穿，铁饼干盒和水过不去）。对战图里，每个出生点都能开到对面的零食罐跟前。这项检查用寻路自动完成。→ `rules: computer tanks can reach the base on every map`

## §2 开车

- WASD 或方向键上下左右四个方向开；同时按两个方向，以后按的为准。玩家车速 3 格/秒。→ `rules: a player tank drives 3 cells/s`；`browser: the most recent direction wins`
- 拐弯时，车在横向上自动对齐到最近的半格，方便钻进一格宽的缝；掉头不对齐。→ `rules: turning snaps to the nearest half cell`
- 积木墙、铁饼干盒、水、零食罐和场地边缘挡车；毛毯和打蜡地板能开上去。→ `rules: walls, steel, water and the base block tanks; rug and ice do not`
- 车和车互相挡；已经重叠的两辆车（比如刚重生）可以各自开出来。→ `rules: tanks block each other but overlapping tanks can drive apart`
- 在打蜡地板上松开方向键，车会顺着原方向再滑 0.6 格。→ `rules: a tank on ice slides on after the key is released`

## §3 开火与星级

- J 或空格开火，按住会连发。子弹从炮口沿车头方向直飞，普通速度 8 格/秒，快速 13 格/秒。→ `rules: bullets fly straight at 8 or 13 cells/s`
- 星级决定火力：
  - 0 星：同屏只能有 1 发自己的子弹，普通速度；
  - 1 星：子弹变快；
  - 2 星：同屏 2 发；
  - 3 星：还能打穿铁饼干盒。

  → `rules: 0 stars allow one bullet on screen, 2 stars allow two`；`rules: 1 star makes bullets fast`；`browser: tapping fire with 0 stars keeps one bullet in the air`
- 被打爆后掉回 0 星。→ `rules: losing a life drops back to 0 stars`

## §4 地形

- 积木墙被打中，只碎掉弹道正前方那一层小砖。子弹正对缝口时碎两块（半格宽），墙不会整格消失。→ `rules: a shot breaks only the front layer of bricks`
- 铁饼干盒：0–2 星的子弹打上去停下，砖不坏；3 星子弹打碎它。→ `rules: steel stops bullets below 3 stars and breaks at 3 stars`
- 打翻的水：子弹能飞过去，车开不过去。→ `rules: bullets cross water, tanks do not`
- 毛毯：车开进去以后，对手的画面里看不到它；自己和队友看到的是半透明轮廓。电脑敌车也看不到毛毯里的玩家。→ `rules: a tank in the rug is hidden from the other side`
- 打蜡地板：见 §2 的滑行。

## §5 子弹

- 两颗不同阵营的子弹迎面相撞，一起消失。同阵营的子弹互不影响。→ `rules: two bullets from opposing sides cancel out`
- 自己的子弹打不到自己。电脑敌车的子弹从别的敌车身上穿过去。→ `rules: enemy bullets pass through enemy tanks`

## §6 零食罐

- 零食罐被任何子弹打中（包括自己人的）就翻倒。合作模式立刻失败；对战模式是对面队伍赢。→ `rules: a hit on the base loses the stage in co-op`；`rules: a hit on a team's base wins versus for the other team`

## §7 被击中

- 玩家被敌车（对战时是对手）打中就爆炸，扣 1 条命，掉回 0 星；3 秒后在自己的出生点重生，带 2 秒护盾。初始 3 条命。→ `rules: a hit costs a life and respawns 3 s later with a 2 s shield`
- 被队友打中只定身 2 秒：不能开、不能开火，不扣命。→ `rules: a teammate's hit only freezes for 2 s`
- 命用完的人本关出局。合作模式里所有人都出局就失败。对战模式不限命，被击毁后照样 3 秒重生。→ `rules: when every player is out of lives the stage is lost`

## §8 电脑敌车（合作）

- 每关 20 辆。场上同时存在的上限是 4 辆，每多一名玩家加 1 辆，最多 7 辆。出车前出生点闪 1 秒。→ `rules: at most 4 + (players − 1) enemies are on the field, 7 at most`
- 四种敌车：

  | 敌车 | 速度 | 子弹 | 耐打 |
  |---|---|---|---|
  | 普通车 | 2.5 格/秒 | 普通 | 1 发 |
  | 快车 | 4.5 格/秒 | 普通 | 1 发 |
  | 速射车 | 2.5 格/秒 | 快速 | 1 发 |
  | 铁甲车 | 2 格/秒 | 普通 | 4 发，车身颜色随血量变 |

  每关的组成按关数加难，顺序由这一关的种子打乱。→ `rules: an armored tank takes four hits`；`rules: every stage sends twenty enemies of the four kinds`
- 第 4、11、18 辆会闪光。把它打掉会在场上随机空地掉一个道具，道具 20 秒后消失，场上同时只有一个。→ `rules: the 4th, 11th and 18th enemies flash and drop an item`
- 20 辆都被打掉就过关。→ `rules: destroying all twenty enemies clears the stage`
- 电脑分三档（简单、普通、困难）：出车间隔、开火频率、朝零食罐和玩家开的倾向逐档加强。没人防守时，电脑敌车会打穿墙、打翻零食罐。→ `rules: undefended, the enemies break through and hit the base`

## §9 道具

每种道具各有一条断言，验的是道具的实际效果：

| 道具 | 效果 | 时长 | → 断言 |
|---|---|---|---|
| 星星 | 升一星，最多 3 星 | — | `rules: a star raises the tank one star` |
| 纸板护盾 | 无敌 | 10 秒 | `rules: while shielded a hit costs nothing` |
| 胶带 | 零食罐周围那圈积木变成铁饼干盒，时间到后恢复成完整积木 | 15 秒 | `rules: tape turns the base ring to steel for 15 s` |
| 鞭炮 | 场上所有敌车爆掉，不计入个人击毁 | — | `rules: a firecracker destroys every enemy on the field` |
| 闹钟 | 敌车全部停住，不开车也不开火 | 10 秒 | `rules: a clock stops the enemies for 10 s` |
| 小鱼干 | 捡到的人 +1 命 | — | `rules: a fish gives one more life` |

## §10 一局的流程

- 开局 3 秒倒数，倒数期间不能开车。→ `browser: the countdown freezes the tank`
- **合作守家**：
  - 从大厅选择从第几关开始（1–6）。
  - 过关后显示结算表：按敌车种类列出每人的击毁数，以及捡到的道具数。
  - 房主（单人时就是自己）点「下一关」继续。命数和星级带到下一关；出局的人以 3 条命、0 星重新上场。
  - 失败可以「重试这一关」，所有人都回到 3 条命、0 星。
  - 打完第 6 关显示通关。

  → `rules: after a clear the next stage keeps lives and stars`；`browser: a lost stage offers a retry`
- **组队对战**：
  - 2v2，左边橘队、右边蓝队，没有电脑敌车和道具；空座位由电脑坦克补上。
  - 3 分钟内打翻对面零食罐就赢；时间到，击毁数多的队赢，一样多算平局。

  → `rules: versus ends after 3 minutes by kills`

## §11 联机：谁说了算

| 事情 | 谁说了算 |
|---|---|
| 自己开车 | 自己这台，其他人按约 110 ms 插值显示 |
| 开火 | 自己先发出；房主按同样的起点、方向和时刻确认。其他人按同样的起点、方向和时刻模拟这颗子弹 |
| 子弹打墙、打车、打零食罐、子弹相撞 | 房主。本机先放火花，墙碎和爆炸等房主确认。打没打中玩家，按被打的人自己上报的位置判：在自己画面里躲开了就算躲开 |
| 地形 | 房主。碎砖随事件广播；每 2 秒带一次地形校验值，不一致就要一份完整地形 |
| 电脑敌车、道具、命数、星级、胜负 | 房主 |

- 联机三台：每人都能看到所有人的子弹；打完时地形、命数和结算表三台一致。→ `net: host + 2 guests play a stage and end with the same terrain and table`；`host: three hosts see each other's bullets and agree on the result`
- 每人看到别人子弹的延迟 P95 ≤ 150 ms。压缩后每个客人的流量 ≤ 12 KB/秒。1 Mbps、往返 100 ms 时，状态落后 P95 ≤ 150 ms。→ `net: bullets show up within 150 ms and a guest costs at most 12 KB/s`；`net: state age p95 stays under 150 ms on a 1 Mbps / 100 ms link`
- 客人中途离开，由电脑接手他的坦克，这局继续；房主离开，房间关闭。→ `net: a guest leaving is taken over by a computer; the host leaving ends the room`

## §12 画面

- 斜俯视镜头，整张地图固定在一屏里，镜头不跟车。
- 车身是程序画的玩具坦克，颜色跟随玩家（对战时跟随队伍）；敌车是没有驾驶员的灰色车。
- 3D 布偶坐在炮塔舱口，只露出上半身，跟着车头转向；2D 立绘做成插在舱口的立牌，永远朝向镜头。电脑队友用内置玩具形象。→ `browser: 2D and 3D pets ride in the turret`；`host: each pet rides as its own 2D / 3D kind on every screen`
- 顶部显示关数和剩余敌车（对战时显示比分和倒计时）以及零食罐状态；底部显示每个人的命数和星级。

# Motion adoption value audit / 运动适配收益评估

2026-10-14。评估完成，游戏逻辑、内置HTML、协议与固定 pet-kit 0.2.1 均未改变。0.3.0 的 Room 只改变版本号，不能把更新版本本身算作改善。

运行：`TANK_HOST_ROOT=/absolute/host npm run test:motion:host`；已纳入 `test:delivery`。脚本检验观测流程、邀请/身份/人数、有效样本、对局仍进行中及退出，**不是运动流畅性验收通过**。`report.findings` 仅以相对操作者的停顿和P95作为筛查；不能漏看原始轨迹、少数峰值、撞墙与停止。

## 方法与证据

最终证据：`artifacts/host-e2e/2026-10-14T14-40-16-357Z/report.json`。原始产品SHA-256：`afb34d1b11b27fee06b508c048ed59e941cf641ccc6f7846a3a43ead4e24784c`。测试基于该原始HTML插入只读Three物体坐标探针，唯一网络故障是接收端SDK poll之前额外等待180ms。没有重写模拟/输入或设置游戏位置。四个真实隐藏Electron、独立profile/CDP、本地隔离生产账号服务真实UI登录、真实局域网邀请与授权、当前2D宠物、四人全部真实键盘移动。宿主实际证书自动配对，邀请同意及SDK授权仍必需。

四人都不射击/放球；对战模式避免合作关卡电脑敌人及结束干扰。每个模式20次350ms方向输入；普通/180ms批次收包、转向、松键1.1秒后的稳定性和关闭。每组至少25个有效运动绘制帧，实际每组约400帧。测试期间全为play，存活、自己的状态和对面状态均有观测；截图已检查，所有本轮进程已实际退出。原生鼠标/焦点、真实两机公网、3D以及完整战斗结算不属于本轮（游戏逻辑没有改变）。

| 接收端观测模式 | 移动标志期间位置保持比例 | P95绘制速度（格/秒） | 最大绘制速度（格/秒） |
| --- | --- | --- | --- |
| normal | 10.0%–17.8% | 5.64–6.18 | 19.27 |
| batched | 25.8%–36.3% | 8.91–13.10 | 56.06 |

停顿包含顶墙和转向，不能把比例全算成网络缺陷。对照同一玩家自己的画面、同一接收端两种网络，批次收包增加了远端停顿及追赶峰值。最终松键后最大端间误差0.000002格，最后250ms无漂移。没有发现必须替换本地输入预测的证据。

## 判断

值得做有限的收包节奏/显示时间轴对照实验；尚未证明整套迁移或仅升级vendor能解决问题。现有110ms插值和100ms有限推算、host转发时间与模拟时钟校正是后续调查点，属于推断，不能作为已确认根因。先比较最小节奏修正和Motion显示层接入；碰撞、命中、死亡/复活与权威归游戏。没有批准或实施通用位置预测。

English: This is a completed measurement audit, not a smoothness acceptance or a product fix. Four real hidden hosts use real keyboard input and production LAN transport. The instrumented artifact preserves the exact released simulation; only a read-only render probe and an additional 180ms SDK poll delay are injected. Own/remote trajectories, walls/turns, stable stop and room exit are recorded. Batched arrivals show remote catch-up spikes. No gameplay, protocol, vendored library or shipped HTML changed. Physical WAN, 3D and complete combat are not newly verified. Consider a minimal timing/presentation experiment before a shared-library migration.

## 发现记录

Agent在评估阶段发现旧测试仍等待已取消的人工设备配对，按当前宿主自动证书确认流程修正并保留真实邀请/权限/连接检查；早期三个玩家的合作场景有敌人/状态变化干扰，故最终使用四名真实输入玩家并断言play；正常顶墙不得误算网络卡顿。退出前先停止观测CDP连接，防止已关闭页面的清理请求逐个超时。初步运行保留在本地证据中，以上数值只引用最终四人对照。

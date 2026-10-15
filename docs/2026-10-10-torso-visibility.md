# 2026-10-10｜3D 坐骑上身缺失

## 问题与根因

用户在实际游玩阶段发现坦克上的 3D 角色上身缺失。隐藏 Chromium 中导入真实短袖男生包、开始游戏并通过 CDP 按 S 朝向镜头，可复现胸口和短裤透出橙色坦克；出生保护罩过期后恢复。

`src/scene.js` 的 `setAlpha()` 每帧把所有材质的 `depthWrite` 改为 `alpha > 0.9`，覆盖了保护罩和冰冻效果原本的 `depthWrite: false`。透明罩先写深度，再绘制的衣服片元被拒绝。资源、三角形朝向、坐姿均无需修改。修复保存材质原始透明度和深度策略；淡入淡出只能收紧原策略，不能把特效变成遮挡物。

参考：[three.js Material.depthWrite 官方说明](https://threejs.org/docs/pages/Material.html#depthWrite)。当前固定版本为 three.js 0.164.1；Context7 在本环境未提供，核对了官方文档和本地固定版本源码。

## 验证与遗漏复盘

- 原有测试仅检查无 clippingPlanes 和大腿坐姿，无法证明服装实际可见；检查晚于保护罩过期也会漏报。
- 新增 `npm run test:appearance`，纳入 `npm test`：真实 ZIP 导入、真实键盘朝向、保护罩开启期间与过期后的胸口三点截图像素断言，男女两种角色及四朝向截图；同时检查护罩/冰冻效果保留不写深度、实体车体保留写深度。
- 修复前像素断言失败，胸口 RGB 为 `[173,108,52]`（坦克橙色）；同位置保护罩过期后为 `[131,128,124]`（灰色衣服）。修复后两种角色通过。
- 规则 38 项、网络 4 项通过；完整浏览器玩法测试与宿主游戏库 fresh / 离线重启加载另留运行日志。
- 浏览器旧测试还发现异步形象构建与首帧定位之间的等待缺口（bottom 尚为 0）；补充等待真实定位/坐姿完成，原数值断言不变。
- 所有窗口自创建即隐藏，独立 profile，测试中不操作日常桌宠。
- 本轮未改联机规则、SDK、外部渲染器或布局；未验证物理双机网络，也不发布宿主安装包。

## 交付

游戏 0.1.3 重新构建单文件 HTML；宿主 Test 游戏目录的 SHA256 同步至 `dist/build.json` 中的实际值。重新从游戏库打开才会使用新文件，已打开或历史收到的 HTML 保持其原内容。

后续相同问题先覆盖“特效有效期间”的画面证据，而不是仅检查网格存在；不把扩大模型、双面绘制或取消角色深度测试作为修复。

## 2026-10-15 联网主分支补齐

产品打包核对发现上述修复仍留在旧分支，联网0.2.0未包含它。现恢复到0.2.1：只合并原材质深度修复与外观回归，保留当前联网协议、pet-kit 0.2.1和模拟，不引入已淘汰的Motion实验。双HTML由当前源码重新构建；auto SHA-256为`0c89e342330288f523696156bd6ff9c21db4bf85f21a4ac44241dc0e23379bc0`。

同一外观测试重放旧联网产物时，护罩期间胸口像素断言失败；新产物男女两种角色、四朝向、护罩有效/过期和材质策略均通过。38项规则、4项网络、产物契约和完整浏览器玩法通过。首次完整运行因未显式指定私有形象路径而停在夹具检查，补齐路径后只重跑失败及未运行项，未改变产品或断言。

真实三宿主隐藏Electron报告`artifacts/host-e2e/2026-10-15T02-52-26-661Z/report.json`通过：真实登录、文件投递与摘要、邀请、3D/2D形象互传、全部准备、三键盘移动开火、相同结算/地形、客人退出由电脑接管、房主退出关闭剩余对局；所有自有进程实际退出。宿主最初缺少账号测试依赖的失败记录保留，补齐后重放同一路径。无新增实体双机/公网验收。

English: The older torso fix was missing from the internet main branch. Version 0.2.1 restores it without changing networking, simulation or adopting the rejected Motion experiment. The original shipped HTML fails the same real-pixel regression; the rebuilt artifact passes both 3D appearances, four directions, gameplay and a real three-host LAN lifecycle. Private fixture setup failures are retained separately. No new physical WAN or public installer release is claimed.

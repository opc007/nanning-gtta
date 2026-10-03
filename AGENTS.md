# AGENTS.md

给在这个仓库里改代码的人 / AI agent。先读完这一份再动手，能省掉一整轮返工。

---

## 这是什么

**南宁街头**——一个跑在浏览器里的 GTA 式开放世界。广西南宁的中山路商圈、机械厂文创园、邕江。
买奶茶、嗦老友粉、逛夜市、砸铺子、被警察追、骑电瓶车过大桥。

没有后端。打开网址就能玩。

---

## 技术栈

| | |
|---|---|
| 渲染 | Three.js r160 |
| 语言 | TypeScript（`strict`） |
| 构建 | Vite 5 |
| 测试 | Vitest（164 个单测） |
| 渲染自测 | Playwright + headless Chromium（swiftshader） |
| 美术 | 程序化为主。`public/assets/` 里可以放**许可证兼容的** GLB 和贴图（CC0 优先） |

**依赖只有 4 个**：`three`、`simplex-noise`、`lucide`、`vite|typescript|vitest|playwright`。
不要再加一套美术中间件（贴图压缩器、独立 DCC 导出链）。GLB 用 Three 自带的 `GLTFLoader` 从
`public/assets/` 加载，地址必须带 `import.meta.env.BASE_URL`（Pages 的 base 是相对路径）。

### 真实素材

- 放在 `public/assets/`。每件在 `public/assets/CREDITS.md` 写来源和许可证。CC0 优先。
- 样板（主角 + 复记老友粉）的下载总量控制在约 15 MB 以内。几何能压就压（Draco / meshopt）；
  动画轨往往比网格大，先剪掉用不到的 clip 再决定要不要上解码器。
- 收音机音频仍然不进仓库。不要把别人仓库的音频热链回来。

---

## 目录

```
src/
  main.ts              游戏装配 + 主循环。所有系统在这里接线。
  nanning/             ← 南宁专属层，改玩法基本都在这
    data.ts            店铺/食物/台词/区域文案。纯数据。
    layout.ts          手工编写的街区布局（中山路、夜市、巷子、邕江、大桥、文创园）
    shops.ts           店铺系统：买、砸、饱食度、钱包
    missions.ts        任务链：六个委托，目标计数、路点、奖励
    crowd.ts           NPC：白话对话气泡、讨债 NPC
    scenery.ts         青石板/沥青地面、邕江、纸灯笼串、夜市摊位
  render/
    character.ts       主角与 NPC 的程序化人体 + 走路/跑/跳循环
    vehicleBody.ts     汽车放样（沿车长切截面蒙皮）
    materials.ts       程序化 PBR：青砖/红砖/混凝土/沥青/石灰墙/刷钢
    modernCity.ts      现代城区（窗洞、腰线、钢柱）+ 背景体量 + 屋顶杂物
    nnArch.ts          骑楼/钟鼓楼/满洲窗
    qilou.ts           旧街区块与 landmark
    props.ts           空调外机、水塔、晾衣架、落水管、防盗网
    qilou.ts           旧街区块与 landmark
    Scene.ts           渲染器/相机/光照/Bloom 后期
  entities/Player.ts   玩家：移动 + 重力 + 跳跃
  systems/             上游 gta7 保留：碰撞、车辆、行人、通缉、相机
  core/                输入、数学、固定步长循环
  world/               上游 gta7 保留：City 生成器（南宁路径已不用）
scripts/
  nn-smoke.mjs         无头渲染自测 + 截图
  _shot.mjs            截图工具（见下）
```

---

## 改完必须跑

```bash
npx tsc --noEmit      # 必须干净
npx vitest run        # 164 个单测必须全过
npx vite build        # 必须能构建
```

**渲染回归**（这个容易忘，但它才是真正的验收）：

```bash
npx vite build && (npx vite preview --port 5244 &) && sleep 4
URL="http://localhost:5244/?t=0.45" SHOTS="hero|auto|auto|2000" node scripts/_shot.mjs
```

---

## URL 调试参数

这几个是专门为了「看清自己在改什么」加的，**判断模型质量时请务必用**：

| 参数 | 作用 |
|---|---|
| `?t=0.45` | 把时间钉在平光（约 10 点）。**默认 0.79 是黄昏，看不清材质。** |
| `?hud=0` | 隐藏所有 HUD，拍照不挡视线 |
| `?seed=1234` | 换一张地图（布局是种子化的） |
| `?stream=0` | 强制有限地图（南宁是有限地图，默认就是） |

`window.__nn` 暴露了 `scene` / `camera` / `city` / `player` / `loop` / `district`，可以在 console 里直接查。

---

## 截图工具

**不要只凭想象判断模型好不好。** 之前一整轮都在黄昏光下、二十米外看，结果人物是方块都没人发现。

```bash
SHOTS="名字|距离,高度,方位角|瞄准高度|等待ms|按键" node scripts/_shot.mjs
```

方位角是绕玩家的角度（0 = 正面）。例：

```bash
SHOTS="face|0.72,1.5,0.45|1.46|1500;front|1.75,1.2,0|0.95|1200" node scripts/_shot.mjs
```

---

## 必须守住的规矩

### 1. 渲染按材质合批，不要一个物体一个 Mesh

早期版本实测 **1900 个 mesh / 1400 个材质**，`swiftshader` 下 0.2 fps。
现在整片城区 ~20 个 draw call / ~680 材质。

做法：把几何体累加进**按材质分的桶**（`Bucket`），最后每个桶 `mergeGeometries` 一次。
**例外**：招牌、霓虹要单独 mesh——它们有独立贴图和动画。

新建物体时先问：它能不能并进已有的桶？

### 2. 建筑要按米数缩放 UV

`scaleBoxUv(geo, w, h, d, perMetre)` 之后再合并，否则贴图会被拉伸。

### 3. `GameLoop` 的 `frameTime` 必须夹在 `[0, maxFrame]`

上游只夹了上限。下限漏了之后，Chrome 会把**当前帧开始时刻**的 rAF 时间戳传给回调；
如果 `start()` 之前有长时间同步构建（生成材质、铺地图），`performance.now()` 会比它**晚 1.7 秒**。
负 dt 进 `damp` 是个大于 1 的系数，不是平滑而是放大，相机会被甩到几百万米外。
`FollowCamera.update()` 的首帧 snap 也是为此存在的。

### 4. 跳跃只有一套：`stepPlayer`

高度、土狼时间、按键缓冲都在 `src/player/PlayerController.ts`。
`jumpPressed()` 记一次轻点（边沿），`jumpHeld()` 是按住（电平），缓冲吃掉慢设备上漏掉的短按。
不要再接 `player.jump()` 或第二套重力。键位是 Space 跳、J / 左键打、G 捡、E 进店、F 上下车、Shift 跑、C 蹲。

### 5. 店名默认用真名，虚构名走开关

店主要求街上用真实铺名（复记老友粉、中山粉饺、荣记烧烤、横州茉莉奶茶等）。
默认就是这些名字。`?names=fictional` 换成谐音备用名，给不想出现注册商标的构建用。
不要把默认改回全虚构。

### 6. 音频不许热链别人的仓库

上游的 `public/radio.json` 指向 gta7 作者的 GitHub Release。默认关闭（`?radio=1` 才开）。
**不要把它接回来**，除非换成我们自己的音频。

---

## 上游血统

基于 [depixeled-chris/gta7](https://github.com/depixeled-chris/gta7)（MIT）改造。
碰撞、空间网格、车辆物理、通缉系统、音频合成、移动端适配、164 个单测都来自那里。

改了上游的文件请在 commit message 里说清楚，这样回头好合并上游更新。

---

## 还没做的

按价值排序，都在 README 里有：

- [ ] **建筑立面换成实拍照片** — 材质管线已就位（`pbr()`），纯素材活。`public/textures/`
- [ ] **街道家具实体化** — 路灯/花坛/护栏/垃圾桶现在还是简模
- [ ] **车流用同一套放样车体** — 货车还在用盒体
- [ ] 店主骂人 + 砸铺后围观报警
- [ ] 酸嘢 / 嗦粉小游戏
- [ ] 湿沥青地面反光
- [ ] 邕江夜游灯光秀
- [ ] 合成式邕州电台（WebAudio 五声音阶，零素材）

---

## 截图里看到的问题，别当成「风格」

- 人物的肩如果像护具 → deltoid 球半径太大，降到 0.052
- 头发像头盔 → 材质 roughness 必须 > 0.9，亮面深色球一定是这个结果
- 脸是平的 → 缺**凹陷的眼窝**。低模脸靠阴影成立，不靠五官数量
- 楼像脚手架 → 投影量太大。窗台 0.1、腰线 0.16 就够了，第一版 0.3 明显过头
- 街景像调色板 → 强调色太多太杂。55% 的楼应该是米白

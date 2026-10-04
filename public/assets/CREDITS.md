# 第三方素材 / Third-party assets

本目录（`public/assets/`）是这个仓库里**唯一**存放外部美术资源的地方。
游戏里其他所有模型、贴图、音频都是运行时程序化生成的，没有文件。

## `characters/protagonist.glb`

| | |
|---|---|
| **名称** | Ultimate Modular Men — "Suit" |
| **作者** | [Quaternius](https://quaternius.com/) |
| **许可** | **CC0 1.0 Universal**（公有领域） — https://creativecommons.org/publicdomain/zero/1.0/ |
| **用途** | 男主身体的底模 |
| **大小** | 约 840 KB |

来源：Quaternius 官方 "Ultimate Modular Men" 素材包（CC0）。
本仓库使用的是 `Suit` 变体，按骨骼命名的 glTF 版本（`.glb`），带 49 根骨骼的蒙皮，
**不含任何动画片段**——动画由 `src/characters/pose.ts` 驱动骨骼实时生成。

### 改了什么

CC0 不要求署名，但为了让下一个改代码的人一眼看懂"哪些是作者的、哪些是我们加的"，
还是记一下我们对原模型做的改动：

- 等比缩放到 1.74 m，脚底对齐 y = 0，整体绕 Y 轴转 90°（原模型朝 +Z，游戏约定朝 +X）
- 材质改色：`Hair` → 灰黑、`Suit` → 灰、`Tie` → 深灰
- 隐藏 `Black`（原模型的皮鞋），改为程序化人字拖
- **在模型之上叠加程序化部件**（都在 `src/characters/glbOutfit.ts`，没有改动原网格）：
  - 粗黑框眼镜
  - 敞开的白大褂（衣身、袖子、衣摆随走路摆动）
  - 口袋里的笔和本子

脸、发型、五官全部是原模型的，我们没有重做。

## 音频

本目录**不放音频**。

`public/radio.json` 原本指向 gta7 上游作者的 GitHub Release，属于热链别人的仓库，
已在 v0.4 移除，默认不再加载。要加电台请自建音频并按同样格式接回来。

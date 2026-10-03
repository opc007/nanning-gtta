# Asset credits

The sample (protagonist + 复记老友粉) uses these files. Everything else in the street stays procedural.

| File | Source | License |
|---|---|---|
| `characters/protagonist.glb` | [KayKit Character Pack: Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) — `Rogue.glb`, clips pruned to idle / walk / run / jump / punch / sit | CC0 1.0 |
| `props/*.gltf` `props/*.bin` `props/restaurantbits_texture.png` | [KayKit Restaurant Bits](https://github.com/KayKit-Game-Assets/KayKit-Restaurant-Bits-1.0) | CC0 1.0 |
| `props/bush.gltf` `props/bush.bin` `props/citybits_texture.png` | [KayKit City Builder Bits](https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0) | CC0 1.0 |

Kay Lousberg / KayKit. No attribution required. The skinned body, hair, and boots are the KayKit rogue mesh (atlas recolored: clothing greens toward grey, dark leather toward charcoal) with the real clips. The lab coat, glasses, qilou shell, sign, lanterns, steam, and chopsticks are original meshes in this repo.

Glasses, coat and clothing colours come from `src/characters/protagonist.ts` (`CharacterDef`). `?skin=procedural` still builds the old box rig. `?skin=suit` keeps the earlier suit.

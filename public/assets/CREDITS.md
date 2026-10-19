# Asset credits

## Kenney — CC0 1.0 (public domain, no attribution required)

All packs downloaded from kenney.nl as zip archives.

| Pack | Used for | Files staged under |
|---|---|---|
| Mini Characters | protagonist (`character-male-d`) + street NPCs | `kenney/chars/` |
| Blocky Characters | NPC variety only (not the hero) | `kenney/blocky/` |
| Building Kit | arcade columns, walls, windows | `kenney/building/` |
| City Kit Commercial | background buildings, awnings | `kenney/city-commercial/` |
| City Kit Roads | road tiles | `kenney/roads/` |
| Car Kit | taxis, cars | `kenney/car/` |
| Furniture Kit | tables, stools, counters, stoves | `kenney/furniture/` |
| Food Kit | bowls, pots, cups | `kenney/food/` |
| Fantasy Town Kit | stalls, stools, arch | `kenney/fantasy-town/` |
| Holiday Kit | lanterns, light strings | `kenney/holiday/` |
| Mini Market | cash register, shelves, freezer | `kenney/mini-market/` |

`Textures/` directories are kept next to their GLBs because the glTF files
reference `Textures/colormap.png` by a relative path. Renaming or flattening
those directories leaves every material untextured. The Furniture Kit ships as
`Models/GLTF format/*.glb` (embedded materials, no external atlas) — that path
is preserved as authored.

Total staged: well under the 15 MB budget (~6.6 MB).

## Hero decision (opc li, 2026-10-05)

**A: Mini Characters `character-male-d`.** Acceptance is “Q版西装男主”, not
“1.7 m upright”. Blocky Characters stay in the tree for NPC variety only.

## Poly Pizza

| Model | Source | Licence | Staged as |
|---|---|---|---|
| red lantern | [Sophie Kim](https://poly.pizza/m/7PZhxLFiGc2) | CC-BY 3.0 | `poly/red-lantern.glb` |
| Chukaman Steamer | Quaternius (Issue #6 Poly Pizza entry `40XM5hLr4Y`) | CC0 1.0 | `poly/steamer.glb` |
| Scooter (e-bike) | [Poly by Google](https://poly.pizza/m/fPLXByG4Vx5) | CC-BY 3.0 | `poly/ebike.glb` |
| Pan Wok | [MilkAndBanana](https://poly.pizza/m/3rvYMi6EF1) | CC0 1.0 | `poly/wok.glb` |

**Attribution (CC-BY 3.0):**

- “red lantern” by Sophie Kim (https://poly.pizza/m/7PZhxLFiGc2) / CC-BY 3.0.
- “Scooter” by Poly by Google (https://poly.pizza/m/fPLXByG4Vx5) / CC-BY 3.0.

“Pan Wok” by MilkAndBanana (https://poly.pizza/m/3rvYMi6EF1) is CC0 1.0
(no attribution required; noted here for provenance).

## Kenney licence

https://kenney.nl — CC0 1.0 Universal. Public domain dedication; commercial
use, modification and redistribution are all permitted with no attribution
requirement.

## Previous asset

`characters/protagonist.glb` was a Quaternius "Ultimate Modular Men" body
(CC0). It is no longer used by the default skin and is kept only for the
`?skin=procedural` comparison. See the repository history for its provenance.

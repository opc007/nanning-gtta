# Asset credits

## Kenney — CC0 1.0 (public domain, no attribution required)

All packs downloaded from kenney.nl as zip archives.

| Pack | Used for | Files staged under |
|---|---|---|
| Mini Characters | protagonist + NPC | `kenney/chars/` |
| Blocky Characters | staged for upright proportions | `kenney/blocky/` |
| Building Kit | arcade columns, walls, windows | `kenney/building/` |
| City Kit Commercial | background buildings, awnings | `kenney/city-commercial/` |
| City Kit Roads | road tiles | `kenney/roads/` |
| Car Kit | taxis, cars | `kenney/car/` |
| Furniture Kit | tables, chairs, counters | `kenney/furniture/` |
| Food Kit | bowls, pots, steamers, cups | `kenney/food/` |
| Fantasy Town Kit | stalls, stools, arch | `kenney/fantasy-town/` |
| Holiday Kit | lanterns, light strings | `kenney/holiday/` |
| Mini Market | cash register, shelves | `kenney/mini-market/` |

`Textures/` directories are kept next to their GLBs because the glTF files
reference `Textures/colormap.png` by a relative path. Renaming or flattening
those directories leaves every material untextured.

Total staged: ~58 GLB, well under the 15 MB budget.

## Why two character packs

Mini Characters is the pack the task brief names, and its figures are chibi:
large head, rounded torso, legs too short to read. Verified by loading the
GLB in a bare three.js page with no mixer and no clips — it renders the same
way there, so the silhouette is the artwork, not a rig or scale fault on our
side. That cannot satisfy the brief's other requirement, a 1.7 m upright suited
protagonist.

Blocky Characters is the same publisher's normal-proportion pack, and it stands
upright. It is also built from rigid parts parented to bones (`skins: 0`,
meshes named `leg-left` / `torso` / `head`) rather than skinned meshes, so an
`AnimationMixer` only has to rotate bones — a simpler path than the skinned
route. Staged and ready; which one is the default is a call for the reviewer.

## Kenney licence

https://kenney.nl — CC0 1.0 Universal. Public domain dedication; commercial
use, modification and redistribution are all permitted with no attribution
requirement.

## Previous asset

`characters/protagonist.glb` was a Quaternius "Ultimate Modular Men" body
(CC0). It is no longer used by the default skin and is kept only for the
`?skin=procedural` comparison. See the repository history for its provenance.

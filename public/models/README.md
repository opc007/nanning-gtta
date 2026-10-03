# public/models

Runtime 3D models (glTF / **.glb** preferred) loaded via Three's `GLTFLoader`.
Files in `public/` are copied verbatim to the deploy root (not hashed/bundled).

- **Reference with the base path**, not a bare absolute path — the site is served
  from `/gta7/` on GitHub Pages:
  ```ts
  loader.load(`${import.meta.env.BASE_URL}models/car.glb`, …)
  ```
- **CC0 (or otherwise compatible) sample models** live in `public/assets/` and are
  listed in `public/assets/CREDITS.md`. Keep that set small (the noodle-shop sample
  aims to stay under ~15 MB). Anything larger still belongs on a GitHub Release,
  same precedent as the radio audio (`radio-v1`).
- Models are a **render-layer** concern (load them from `src/render/`), keeping the
  pure simulation core Three-free.

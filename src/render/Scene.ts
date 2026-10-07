import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { daylightFactor, sunPosition } from '../core/math';
import { makeGlowTexture } from './textures';
import type { City } from '../world/City';

/**
 * Owns the renderer, scene graph, camera and the static environment (ground +
 * road grid + dusk lighting). A single directional light covers the whole city
 * for shadows; everything else is emissive, which keeps the night look cheap.
 */
export interface SceneQuality {
  maxPixelRatio?: number; // cap device pixel ratio (lower = cheaper)
  shadowMapSize?: number; // directional shadow resolution
  streaming?: boolean; // streamed world: ground/shadow/sun follow the player (R007)
  /** Neon/lantern bloom. Off on coarse-pointer devices, which can't afford it. */
  bloom?: boolean;
}

// In streamed mode the shadow frustum is a tight window around the player rather
// than the whole (unbounded) world.
const STREAM_SHADOW_HALF = 90;
// 中山路 is a finite 300 m street, but its shadow frustum was sized to the whole
// map: a 2048² map stretched across ±MAP_HALF is about half a metre per texel, so
// the shadows were both ugly and — the real cost — every object on the map was
// drawn into the shadow pass each frame. A ±70 m window around the player is
// 6 cm per texel and only the block you can actually see goes in.
const FIXED_SHADOW_HALF = 70;

// Night (t=0, the original look) ↔ day palette, lerped by the daylight factor.
const NIGHT = {
  sky: 0x141a2e,
  ambient: { color: 0x5a5344, intensity: 1.9 },
  hemiSky: 0x6a6480,
  sun: { color: 0xbcd0ff, intensity: 1.5 },
};
const DAY = {
  sky: 0x9ec3e6,
  ambient: { color: 0x9fb3d0, intensity: 0.95 },
  hemiSky: 0x87b5e0,
  sun: { color: 0xfff4e0, intensity: 2.6 },
};

export class SceneEnv {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private ambient!: THREE.AmbientLight;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private sunDisc!: THREE.Sprite;
  private sunRadius = 0;
  private ground!: THREE.Mesh;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private readonly streaming: boolean;
  private followX = 0;
  private followZ = 0;
  private readonly shadowHalf: number;

  constructor(container: HTMLElement, city: City, quality: SceneQuality = {}) {
    const maxPixelRatio = quality.maxPixelRatio ?? 2;
    // 1024, not 2048. A 2048² map is 4.2 Mpx — measured against a 320x200 canvas
    // at 0.064 Mpx, the shadow pass was drawing ~65x more pixels than the view
    // the player was actually looking at, and it did that every frame. That is
    // the fixed per-frame cost that made the game resolution-independent in
    // the worst way: 0.23 fps at 1000x620 and 0.85 fps at 320x200, because the
    // canvas was never the bottleneck. Paired with the ±70 m follow window,
    // 1024 still gives ~14 cm shadow texels, which is fine for a street.
    const shadowMapSize = quality.shadowMapSize ?? 1024;
    this.streaming = !!quality.streaming;
    // Finite world: the shadow frustum spans the whole map. Streamed world: a
    // tight window that follows the player (city.half is effectively unbounded).
    // A finite city is still walked through; a tight window beats covering the
    // whole map unless the map is small enough that the window is the map.
    this.shadowHalf =
      this.streaming || city.half > FIXED_SHADOW_HALF
        ? (this.streaming ? STREAM_SHADOW_HALF : FIXED_SHADOW_HALF)
        : city.half;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141a2e);
    this.scene.fog = new THREE.Fog(0x141a2e, city.extent * 0.18, city.extent * 0.7);

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.5,
      city.extent * 1.5,
    );
    this.camera.position.set(0, 30, 30);

    this.addLights(city, shadowMapSize);
    this.addGround(city);
    // Streamed roads are everywhere (the grid between blocks); the finite per-
    // roadCenter planes don't apply, so the ground reads as asphalt-dark instead.
    if (!this.streaming) this.addRoads(city);

    this.setupComposer(window.innerWidth, window.innerHeight, quality.bloom ?? true);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
  }

  private addLights(city: City, shadowMapSize: number): void {
    this.ambient = new THREE.AmbientLight(NIGHT.ambient.color, NIGHT.ambient.intensity);
    this.scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(NIGHT.hemiSky, 0x1a1712, 1.05);
    this.scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(NIGHT.sun.color, NIGHT.sun.intensity);
    sun.position.set(city.half * 0.6, city.half * 1.2, city.half * 0.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = -this.shadowHalf;
    cam.right = this.shadowHalf;
    cam.top = this.shadowHalf;
    cam.bottom = -this.shadowHalf;
    cam.near = 1;
    cam.far = city.extent * 2.5;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.scene.add(sun.target); // target stays at origin; moving the light sweeps shadows
    this.sun = sun;

    // A visible sun/moon disc that rides the same arc as the directional light.
    this.sunRadius = Math.min(city.extent * 1.1, 620); // inside the camera far plane
    const disc = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    // A sun is ~0.5° across. Scaling it with map extent meant the Nanning map
    // (560 m across) rendered a 123 m glowing ball straight down the street.
    disc.scale.setScalar(Math.min(city.extent * 0.22, 26));
    this.scene.add(disc);
    this.sunDisc = disc;
    this.setTimeOfDay(0); // place everything for the initial (midnight) look
  }

  /**
   * Drive the day/night look from a time-of-day in [0,1) (0 = midnight). Lerps
   * sky/fog colour and light colour+intensity between the night and day
   * palettes by a daylight factor (0 at night, 1 at noon), and rides the sun
   * (the shadow-casting directional light + a visible disc) along an east→
   * overhead→west arc so shadows sweep across the city through the day.
   */
  setTimeOfDay(t: number): void {
    this.lastTimeOfDay = t;
    const d = daylightFactor(t); // 0 night → 1 noon
    const mix = (a: number, b: number): THREE.Color => new THREE.Color(a).lerp(new THREE.Color(b), d);
    const lerpN = (a: number, b: number): number => a + (b - a) * d;

    const sky = mix(NIGHT.sky, DAY.sky);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);

    this.ambient.color.copy(mix(NIGHT.ambient.color, DAY.ambient.color));
    this.ambient.intensity = lerpN(NIGHT.ambient.intensity, DAY.ambient.intensity);
    this.hemi.color.copy(mix(NIGHT.hemiSky, DAY.hemiSky));
    this.sun.color.copy(mix(NIGHT.sun.color, DAY.sun.color));
    this.sun.intensity = lerpN(NIGHT.sun.intensity, DAY.sun.intensity);

    // Sweep the light + disc along the day's arc. The target sits at the follow
    // centre (origin in the finite world; the player in the streamed world), so
    // the shadow frustum rides along instead of being left behind.
    const dir = sunPosition(t);
    this.sun.position.set(
      this.followX + dir.x * this.sunRadius,
      dir.y * this.sunRadius,
      this.followZ + dir.z * this.sunRadius,
    );
    this.sun.target.position.set(this.followX, 0, this.followZ);
    this.sun.target.updateMatrixWorld();
    this.sunDisc.position.copy(this.sun.position);
    // Warm sun by day, pale moon by night; never fully invisible.
    this.sunDisc.material.color.copy(mix(0xaec6ff, 0xfff1c4));
    this.sunDisc.material.opacity = 0.45 + 0.4 * d;
  }

  private addGround(city: City): void {
    const size = city.extent * 2;
    // In the streamed world the ground is asphalt-dark (it stands in for the
    // road grid, which isn't drawn as planes) and follows the player.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: this.streaming ? 0x1a1e28 : 0x0c0e14, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;
  }

  /**
   * Streamed world: recentre the ground + the shadow/sun window on the player so
   * the lit, shadow-casting region travels with them (the sun is repositioned
   * from these in `setTimeOfDay`, which runs every frame). No-op when finite.
   */
  follow(x: number, z: number): void {
    this.followX = x;
    this.followZ = z;
    // Ground is infinite only in the streamed world; the finite city has its own.
    if (this.streaming) this.ground.position.set(x, 0, z);
  }

  private addRoads(city: City): void {
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x202430, roughness: 0.9 });
    const roadGeoH = new THREE.PlaneGeometry(city.extent, city.config.roadWidth);
    const roadGeoV = new THREE.PlaneGeometry(city.config.roadWidth, city.extent);

    for (const c of city.roadCenters) {
      const h = new THREE.Mesh(roadGeoH, asphalt);
      h.rotation.x = -Math.PI / 2;
      h.position.set(0, 0.02, c);
      h.receiveShadow = true;
      this.scene.add(h);

      const v = new THREE.Mesh(roadGeoV, asphalt);
      v.rotation.x = -Math.PI / 2;
      v.position.set(c, 0.02, 0);
      v.receiveShadow = true;
      this.scene.add(v);
    }
  }

  /**
   * Adaptive quality. Fed the real frame time each frame, this walks the
   * expensive knobs down when the device cannot keep up and back up when it can.
   *
   * Resolution is the first thing to go and the last thing to be missed: pixel
   * count scales the whole pipeline — shadow pass, main pass, and every bloom
   * blur tap on top. Bloom is the last to go because it is the whole night
   * street, and a soft image is a worse complaint than a hard one.
   *
   * Hysteresis is deliberate: the thresholds do not overlap, so a machine
   * sitting near the boundary cannot oscillate between two settings forever.
   */
  private qScale = 1;
  private qBloom = true;
  private qAccum = 0;
  private qFrames = 0;

  /** Cheap → expensive steps. Index 0 is what a struggling device gets. */
  static readonly QUALITY_STEPS = [
    { scale: 0.6, bloom: false },
    { scale: 0.75, bloom: false },
    { scale: 1.0, bloom: false },
    { scale: 1.0, bloom: true },
  ];

  /**
   * @param frameTime seconds for the frame just rendered
   * @returns true if the quality level changed this frame
   */
  adaptQuality(frameTime: number, maxPixelRatio: number): boolean {
    if (!(frameTime > 0)) return false;
    this.qAccum += frameTime;
    this.qFrames++;
    // Judge on a window long enough to ride out a stutter but short enough that
    // the picture is not left ugly for a second after the machine settles.
    // 90 frames, not 45. Each step calls setPixelRatio, which reallocates the
    // drawing buffer — doing that every two seconds on a device that is already
    // struggling is how you talk a weak GPU into losing its context. Decide
    // less often, and never step twice in a row without a fresh measurement.
    if (this.qFrames < 90) return false;
    const avg = this.qAccum / this.qFrames;
    this.qAccum = 0;
    this.qFrames = 0;

    const level = SceneEnv.QUALITY_STEPS.indexOf(
      SceneEnv.QUALITY_STEPS.find((s) => s.scale === this.qScale && s.bloom === this.qBloom)!,
    );
    let next = level;
    if (avg > 1 / 34) next = Math.max(0, level - 1); // under ~34 fps: cheaper
    else if (avg < 1 / 56) next = Math.min(SceneEnv.QUALITY_STEPS.length - 1, level + 1); // over ~56 fps
    if (next === level) return false;

    const s = SceneEnv.QUALITY_STEPS[next];
    this.qScale = s.scale;
    this.qBloom = s.bloom;
    this.renderer.setPixelRatio(
      Math.max(0.4, Math.min(window.devicePixelRatio, maxPixelRatio) * s.scale),
    );
    // A lost context leaves the ladder pointing at settings nothing is drawing
    // with. Reset it so the next successful frame starts from the top again.
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      () => { this.qAccum = 0; this.qFrames = 0; },
      { once: true },
    );
    if (this.bloomPass) this.bloomPass.enabled = s.bloom;
    return true;
  }

  /**
   * Bloom is the single biggest "细腻" upgrade available for a night street: it
   * is what turns an emissive signboard from a flat bright rectangle into
   * something that actually glows onto the wall next to it. Falls back to a
   * direct render when the composer is off (mobile) or unavailable.
   */
  render(): void {
    if (this.composer) {
      // Bloom tracks the day cycle: a noon sky must not bloom.
      const d = daylightFactor(this.lastTimeOfDay);
      if (this.bloomPass) this.bloomPass.strength = 0.12 + 0.62 * (1 - d);
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private lastTimeOfDay = 0;

  private setupComposer(w: number, h: number, enabled: boolean): void {
    if (!enabled) return;
    try {
      const c = new EffectComposer(this.renderer);
      c.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.75, 1.5);
      c.addPass(bloom);
      // OutputPass applies tone mapping + sRGB conversion at the end of the
      // chain, which is what keeps ACES from being applied twice.
      c.addPass(new OutputPass());
      c.setSize(w, h);
      this.composer = c;
      this.bloomPass = bloom;
    } catch {
      // A driver without float render targets: ship the direct path.
      this.composer = null;
    }
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  };
}

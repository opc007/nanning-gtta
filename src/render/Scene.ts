import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
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
  /** `low` skips SSAO, outlines, the grade and FXAA. `?fx=low` forces it. */
  fx?: 'low' | 'high';
}

// In streamed mode the shadow frustum is a tight window around the player rather
// than the whole (unbounded) world.
const STREAM_SHADOW_HALF = 90;

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
  private outline: OutlinePass | null = null;
  private fxaa: ShaderPass | null = null;
  private grade: ShaderPass | null = null;
  private outlineTargets: THREE.Object3D[] = [];
  private readonly fx: 'low' | 'high';
  private readonly streaming: boolean;
  private followX = 0;
  private followZ = 0;
  private readonly shadowHalf: number;

  constructor(container: HTMLElement, city: City, quality: SceneQuality = {}) {
    const maxPixelRatio = quality.maxPixelRatio ?? 2;
    const shadowMapSize = quality.shadowMapSize ?? 2048;
    this.streaming = !!quality.streaming;
    this.fx = quality.fx ?? 'high';
    // Finite world: the shadow frustum spans the whole map. Streamed world: a
    // tight window that follows the player (city.half is effectively unbounded).
    this.shadowHalf = this.streaming ? STREAM_SHADOW_HALF : city.half;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141a2e);
    this.scene.fog = new THREE.Fog(0x141a2e, city.extent * 0.18, city.extent * 0.7);
    // A small room probe so Standard materials (the untouched street) pick up
    // soft reflections. Toon materials ignore it.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

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
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.04;
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

    // t=0.75 is the sine's dusk (daylight 0). A short window around it is the
    // sample's golden hour; 0.79 (the default night boot) stays night.
    const g = goldenHour(t);
    if (g > 0) {
      const goldSky = new THREE.Color(0xffc48a);
      sky.lerp(goldSky, g);
      (this.scene.background as THREE.Color).copy(sky);
      (this.scene.fog as THREE.Fog).color.copy(sky);
      this.ambient.color.lerp(new THREE.Color(0xffd8b0), g);
      this.ambient.intensity = this.ambient.intensity * (1 - g) + 0.78 * g;
      this.hemi.color.lerp(new THREE.Color(0xffe2b8), g);
      this.hemi.groundColor.lerp(new THREE.Color(0xc48455), g);
      this.sun.color.lerp(new THREE.Color(0xffb15e), g);
      this.sun.intensity = this.sun.intensity * (1 - g) + 3.35 * g;
    }
    this.renderer.toneMappingExposure = 1.12 + 0.16 * g;
    if (this.grade) this.grade.uniforms.warmth.value = 0.25 + 0.75 * g;

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
    if (!this.streaming) return;
    this.followX = x;
    this.followZ = z;
    this.ground.position.set(x, 0, z);
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
   * Bloom is the single biggest "细腻" upgrade available for a night street: it
   * is what turns an emissive signboard from a flat bright rectangle into
   * something that actually glows onto the wall next to it. Falls back to a
   * direct render when the composer is off (mobile) or unavailable.
   */
  render(): void {
    if (this.composer) {
      // Bloom tracks the day cycle: a noon sky must not bloom.
      const d = daylightFactor(this.lastTimeOfDay);
      if (this.bloomPass) {
        // Lanterns and the sign bloom. The sky stays under the threshold.
        this.bloomPass.threshold = 0.84;
        this.bloomPass.strength = 0.18 + 0.22 * (1 - d);
        this.bloomPass.radius = 0.42;
      }
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private lastTimeOfDay = 0;

  /** Character + the sample shop, so OutlinePass knows what to ink. */
  setOutline(objects: THREE.Object3D[]): void {
    this.outlineTargets = objects;
    if (this.outline) this.outline.selectedObjects = objects;
  }

  private setupComposer(w: number, h: number, enabled: boolean): void {
    if (!enabled) return;
    try {
      const c = new EffectComposer(this.renderer);
      c.addPass(new RenderPass(this.scene, this.camera));
      const high = this.fx === 'high';
      if (high) {
        const ssao = new SSAOPass(this.scene, this.camera, w, h);
        ssao.kernelRadius = 14;
        ssao.minDistance = 0.002;
        ssao.maxDistance = 0.14;
        c.addPass(ssao);
        const outline = new OutlinePass(new THREE.Vector2(w, h), this.scene, this.camera);
        outline.edgeStrength = 3.4;
        outline.edgeGlow = 0.15;
        outline.edgeThickness = 1.35;
        outline.pulsePeriod = 0;
        outline.visibleEdgeColor.set(0x3a2c24);
        outline.hiddenEdgeColor.set(0x3a2c24);
        outline.selectedObjects = this.outlineTargets;
        c.addPass(outline);
        this.outline = outline;
      }
      const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.28, 0.5, 0.84);
      c.addPass(bloom);
      if (high) {
        const grade = new ShaderPass(GradeShader);
        grade.uniforms.warmth.value = 0.4;
        c.addPass(grade);
        this.grade = grade;
        const fxaa = new ShaderPass(FXAAShader);
        const pr = this.renderer.getPixelRatio();
        fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
        c.addPass(fxaa);
        this.fxaa = fxaa;
      }
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
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    if (this.fxaa) {
      const pr = this.renderer.getPixelRatio();
      this.fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    }
  };
}

/** 0 at night and noon, 1 near t=0.735 (just before the dusk cutoff at 0.75). */
function goldenHour(t: number): number {
  const x = Math.abs(t - 0.735) / 0.07;
  if (x >= 1) return 0;
  const k = 1 - x;
  return k * k;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    warmth: { value: 0.4 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float warmth;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col *= mix(vec3(1.0), vec3(1.10, 1.03, 0.90), warmth);
      col += vec3(0.045, 0.02, 0.0) * warmth * (1.0 - l);
      col = pow(max(col, 0.0), vec3(0.95));
      gl_FragColor = vec4(col, c.a);
    }
  `,
};

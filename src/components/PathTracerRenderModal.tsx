/**
 * Modale "Render Fotografico HD (Motore ArchViz Multi-Campione — Zero Puntini)":
 * - Motore fotografico progressivo ad accumulo HDR pensato per realismo architettonico tipo Corona/Enscape:
 *   1. True Hemispherical Sky GI: luce cielo con shadow map campionata su tutta la semisfera Fibonacci (32-64 direzioni)
 *      -> occlusione direzionale reale in angoli, nicchie, infissi e sotto i mobili, ZERO puntini!
 *   2. Luce solare dorata con shadow map 4096px + disco solare Vogel -> raggi nitidi attraverso le finestre con penombre fisiche
 *   3. 4 Atmosfere fotografiche (Sole Architettonico, Golden Hour, Luce Nordica, Sera Calda)
 *   4. Materiali PBR rifiniti (riflessi Fresnel clearcoat su parquet/piastrelle, sheen sui tessuti, terreno travertino procedurale, HDRI PMREM con cielo+nuvole)
 *   5. Tone Mapping AgX Filmic + GTAO full-res + HDR Bloom + Split-Tone ArchViz + Micro-nitidezza + Grana pellicola regolabili live
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  Camera,
  Download,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { getWallsBounds } from '../utils/geometry';
import { detectRooms } from '../utils/rooms';
import {
  ArchitecturalGTAOPass,
  PhotographicFinishShader,
} from '../viewer3d/postProcessing';
import type { RenderStylePreset } from '../types/project';

type QualityPreset = 'fast' | 'high' | 'ultra';
type PhotoMood = 'archviz' | 'golden' | 'nordic' | 'evening';

const QUALITY_CONFIG: Record<
  QualityPreset,
  { label: string; samples: number; maxWidth: number; aoSamples: number; sunShadowRes: number; timeHint: string }
> = {
  fast: {
    label: 'Veloce (20×)',
    samples: 20,
    maxWidth: 1152,
    aoSamples: 20,
    sunShadowRes: 2048,
    timeHint: '~1.2 sec • anteprima rapida',
  },
  high: {
    label: 'Alta Qualità (40×)',
    samples: 40,
    maxWidth: 1440,
    aoSamples: 28,
    sunShadowRes: 4096,
    timeHint: '~2.5 sec • consigliato',
  },
  ultra: {
    label: 'Ultra HD 2K (64×)',
    samples: 64,
    maxWidth: 1920,
    aoSamples: 32,
    sunShadowRes: 4096,
    timeHint: '~4.5 sec • stampa 2K',
  },
};

interface MoodConfig {
  label: string;
  desc: string;
  elevationRad: number;
  azimuthOffsetRad: number;
  sunColor: string;
  sunIntensity: number;
  sunSpread: number;
  skyGiColor: string;
  skyGiIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  envTop: string;
  envHorizon: string;
  envGround: string;
  envSunColor: string;
  envSunPower: number;
  envIntensity: number;
  fogColor: string;
  groundTint: string;
  interiorLightMult: number;
  bloomThreshold: number;
  defaultBloom: number;
  defaultExposure: number;
  splitTone: number;
  vignette: number;
}

const PHOTO_MOODS: Record<PhotoMood, MoodConfig> = {
  archviz: {
    label: 'Sole Architettonico',
    desc: 'Luce radente calda + ombre cielo fresche',
    elevationRad: 0.56, // ~32°: lame di sole spettacolari attraverso porte e finestre
    azimuthOffsetRad: 0.58,
    sunColor: '#ffe9c6',
    sunIntensity: 2.75,
    sunSpread: 0.042,
    skyGiColor: '#98c4f5',
    skyGiIntensity: 0.78,
    hemiSky: '#c7e0fc',
    hemiGround: '#c9a984', // Rimbalzo caldo dal pavimento
    hemiIntensity: 0.28,
    envTop: '#4e88cc',
    envHorizon: '#e9eff7',
    envGround: '#bfb29f',
    envSunColor: '#fff1d4',
    envSunPower: 4.5,
    envIntensity: 0.9,
    fogColor: '#dfe7ef',
    groundTint: '#cfc6b8',
    interiorLightMult: 0.85,
    bloomThreshold: 0.95,
    defaultBloom: 0.22,
    defaultExposure: 1.0,
    splitTone: 0.24,
    vignette: 0.16,
  },
  golden: {
    label: 'Golden Hour',
    desc: 'Tramonto dorato radente + lampade accese',
    elevationRad: 0.31, // ~18°: raggi dorati lunghi dentro le stanze
    azimuthOffsetRad: 0.85,
    sunColor: '#ffb86c',
    sunIntensity: 3.1,
    sunSpread: 0.055,
    skyGiColor: '#7ca3de',
    skyGiIntensity: 0.62,
    hemiSky: '#8faed9',
    hemiGround: '#b88356',
    hemiIntensity: 0.24,
    envTop: '#2b4a7a',
    envHorizon: '#f2b179',
    envGround: '#7a5d47',
    envSunColor: '#ffbe70',
    envSunPower: 6.0,
    envIntensity: 0.85,
    fogColor: '#dfc6b0',
    groundTint: '#bfa994',
    interiorLightMult: 2.1,
    bloomThreshold: 0.84,
    defaultBloom: 0.34,
    defaultExposure: 0.98,
    splitTone: 0.32,
    vignette: 0.22,
  },
  nordic: {
    label: 'Luce Nordica',
    desc: 'Cielo diffuso morbido stile editoriale',
    elevationRad: 0.72,
    azimuthOffsetRad: 0.42,
    sunColor: '#fff8ee',
    sunIntensity: 1.45,
    sunSpread: 0.19, // Sole molto diffuso tra nuvole leggere
    skyGiColor: '#d9e7f5',
    skyGiIntensity: 1.15,
    hemiSky: '#eef4fa',
    hemiGround: '#c4b8a8',
    hemiIntensity: 0.34,
    envTop: '#9fb4c9',
    envHorizon: '#edf1f5',
    envGround: '#c4beb6',
    envSunColor: '#ffffff',
    envSunPower: 2.0,
    envIntensity: 0.95,
    fogColor: '#e6ebf0',
    groundTint: '#d6d2cb',
    interiorLightMult: 0.75,
    bloomThreshold: 1.0,
    defaultBloom: 0.14,
    defaultExposure: 1.02,
    splitTone: 0.14,
    vignette: 0.11,
  },
  evening: {
    label: 'Sera / Interni',
    desc: 'Crepuscolo blu + atmosfera calda interna',
    elevationRad: 0.26,
    azimuthOffsetRad: -0.75,
    sunColor: '#7ea2d9',
    sunIntensity: 0.65,
    sunSpread: 0.14,
    skyGiColor: '#4e73b0',
    skyGiIntensity: 0.52,
    hemiSky: '#3b588c',
    hemiGround: '#4a3a2d',
    hemiIntensity: 0.2,
    envTop: '#0d1930',
    envHorizon: '#2e456e',
    envGround: '#1a1d24',
    envSunColor: '#f29a5e',
    envSunPower: 2.6,
    envIntensity: 0.6,
    fogColor: '#1a2538',
    groundTint: '#363d4a',
    interiorLightMult: 4.4,
    bloomThreshold: 0.74,
    defaultBloom: 0.42,
    defaultExposure: 1.04,
    splitTone: 0.28,
    vignette: 0.26,
  },
};

interface PathTracerRenderModalProps {
  sourceGroup: THREE.Group;
  sourceCamera: THREE.Camera;
  onClose: () => void;
  onSendToAiPhoto?: (dataUrl: string) => void;
}

/** Sequenza Halton a bassa discrepanza per SSAA sub-pixel */
function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** Disco di Vogel uniforme per penombre solari naturali senza banding */
function vogelDisk(sampleIndex: number, totalSamples: number): [number, number] {
  const goldenAngle = 2.399963229728653;
  const r = Math.sqrt((sampleIndex + 0.5) / Math.max(1, totalSamples));
  const theta = sampleIndex * goldenAngle;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/**
 * Direzione campionata uniformemente sulla semisfera superiore (Fibonacci Cosine-Weighted):
 * permette di accumulare vero Sky Dome GI con ombre morbide a 360° in tutti gli angoli!
 */
function fibonacciHemisphereDir(sampleIndex: number, totalSamples: number, out: THREE.Vector3): THREE.Vector3 {
  const goldenAngle = 2.399963229728653;
  const u = (sampleIndex + 0.5) / Math.max(1, totalSamples);
  // Elevazione minima ~14° (sin >= 0.24) per luce naturale dal cielo senza artefatti radenti dal terreno
  const y = 0.24 + (1.0 - 0.24) * Math.sqrt(u);
  const rad = Math.sqrt(Math.max(0, 1.0 - y * y));
  const theta = sampleIndex * goldenAngle;
  return out.set(Math.cos(theta) * rad, y, Math.sin(theta) * rad).normalize();
}

/** Calcola la direzione del sole combinando l'ora del giorno dello Step 3 con l'elevazione fotografica del mood */
function computeArchVizSunDirection(hour: number, mood: MoodConfig): THREE.Vector3 {
  const t = Math.max(0, Math.min(1, (hour - 6) / 14));
  const userAzimuth = (t - 0.5) * Math.PI * 1.25;
  const azimuth = userAzimuth + mood.azimuthOffsetRad;
  // Blend morbido tra l'angolo fotografico ideale del mood e l'ora del giorno dell'utente
  const userElev = Math.sin(t * Math.PI) * 0.65 + 0.24;
  const elevation = mood.elevationRad * 0.72 + userElev * 0.28;
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  ).normalize();
}

/** Crea un WebGLRenderer WebGL2 con preserveDrawingBuffer=true per non perdere mai il frame al 100% */
function createSafeWebGLRenderer(): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  const contextAttrs: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'default',
    failIfMajorPerformanceCaveat: false,
  };

  const gl =
    (canvas.getContext('webgl2', contextAttrs) as WebGL2RenderingContext | null) ||
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null);

  if (!gl) {
    throw new Error(
      'WebGL2 non disponibile o risorse GPU esaurite. Prova a chiudere altre schede 3D o ricarica la pagina.'
    );
  }

  return new THREE.WebGLRenderer({
    canvas,
    context: gl,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'default',
  });
}

/** Clona una texture in modo pulito nel nuovo contesto WebGL preservando repeat, offset e colorSpace */
function cloneTextureForRenderer(
  src: THREE.Texture | null | undefined,
  cache: Map<THREE.Texture, THREE.Texture>,
  disposables: Array<{ dispose: () => void }>
): THREE.Texture | null {
  if (!src) return null;
  const existing = cache.get(src);
  if (existing) return existing;
  const cloned = src.clone();
  cloned.wrapS = src.wrapS;
  cloned.wrapT = src.wrapT;
  cloned.repeat.copy(src.repeat);
  cloned.offset.copy(src.offset);
  cloned.colorSpace = src.colorSpace;
  cloned.anisotropy = 8;
  cloned.needsUpdate = true;
  cache.set(src, cloned);
  disposables.push(cloned);
  return cloned;
}

/** Genera una micro-texture procedurale in travertino/pietra architettonica per il piano esterno */
function createArchitecturalGroundTextures(tintHex: string): {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const size = 512;
  const diffCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  diffCanvas.width = roughCanvas.width = size;
  diffCanvas.height = roughCanvas.height = size;

  const ctx = diffCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;

  const base = new THREE.Color(tintHex);
  const br = Math.round(base.r * 255);
  const bg = Math.round(base.g * 255);
  const bb = Math.round(base.b * 255);

  ctx.fillStyle = `rgb(${br},${bg},${bb})`;
  ctx.fillRect(0, 0, size, size);
  rCtx.fillStyle = 'rgb(228,228,228)';
  rCtx.fillRect(0, 0, size, size);

  // Grana minerale fine deterministica + lievi variazioni di tono architettonico
  let seed = 13379;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < 4800; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rad = 1 + rand() * 3.5;
    const delta = (rand() - 0.5) * 16;
    ctx.fillStyle = `rgba(${Math.max(0, Math.min(255, Math.round(br + delta)))},${Math.max(0, Math.min(255, Math.round(bg + delta)))},${Math.max(0, Math.min(255, Math.round(bb + delta)))},0.28)`;
    ctx.fillRect(x, y, rad, rad);

    const rv = Math.max(195, Math.min(250, Math.round(225 + delta * 1.4)));
    rCtx.fillStyle = `rgba(${rv},${rv},${rv},0.35)`;
    rCtx.fillRect(x, y, rad * 1.2, rad * 1.2);
  }

  // Giunti larghi molto discreti tipo pavimentazione esterna in pietra/cemento architettonico
  ctx.strokeStyle = `rgba(${Math.max(0, br - 28)},${Math.max(0, bg - 28)},${Math.max(0, bb - 28)},0.22)`;
  ctx.lineWidth = 1.5;
  for (let p = 0; p < size; p += 128) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(diffCanvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(34, 34);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(34, 34);
  roughnessMap.anisotropy = 4;

  return { map, roughnessMap };
}

/**
 * Genera una HDRI PMREM procedurale fotorealistica (cielo fisico + nuvole soffici + corona solare + orizzonte caldo)
 * per riflessi verosimili su vetri, parquet, gres, marmo e rubinetteria cromata.
 */
function createPhotorealisticEnvironment(
  renderer: THREE.WebGLRenderer,
  mood: MoodConfig,
  sunDir: THREE.Vector3
): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();

  const domeGeo = new THREE.SphereGeometry(40, 48, 24);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(mood.envTop) },
      horizonColor: { value: new THREE.Color(mood.envHorizon) },
      groundColor: { value: new THREE.Color(mood.envGround) },
      sunDir: { value: sunDir.clone() },
      sunColor: { value: new THREE.Color(mood.envSunColor) },
      sunPower: { value: mood.envSunPower },
      envScale: { value: mood.envIntensity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float sunPower;
      uniform float envScale;
      varying vec3 vDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p *= 2.04;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col;
        if (h >= 0.0) {
          col = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55));
          // Nuvole morbide procedurali per riflessi naturali su vetri e metalli
          vec2 cloudUv = d.xz / (h + 0.35) * 1.4;
          float c = smoothstep(0.46, 0.78, fbm(cloudUv));
          col = mix(col, horizonColor * 1.22, c * smoothstep(0.02, 0.25, h) * 0.45);
          // Corona solare HDR
          float sDot = max(0.0, dot(d, normalize(sunDir)));
          col += sunColor * (pow(sDot, 160.0) * sunPower * 2.2 + pow(sDot, 14.0) * sunPower * 0.22);
        } else {
          col = mix(horizonColor * 0.85, groundColor, clamp(-h * 2.6, 0.0, 1.0));
        }
        gl_FragColor = vec4(col * envScale, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  envScene.add(dome);

  const envRT = pmrem.fromScene(envScene, 0.025);
  domeGeo.dispose();
  domeMat.dispose();
  pmrem.dispose();
  return envRT;
}

/** Cupola cielo atmosferica di sfondo (ignorata da GTAO grazie a ShaderMaterial + depthWrite=false) */
function createSkyBackdropDome(
  mood: MoodConfig,
  sunDir: THREE.Vector3
): { mesh: THREE.Mesh; dispose: () => void } {
  const geo = new THREE.SphereGeometry(110, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(mood.envTop) },
      horizonColor: { value: new THREE.Color(mood.envHorizon) },
      groundColor: { value: new THREE.Color(mood.fogColor) },
      sunDir: { value: sunDir.clone() },
      sunColor: { value: new THREE.Color(mood.envSunColor) },
      sunGlow: { value: mood.envSunPower * 0.085 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float sunGlow;
      varying vec3 vWorldDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        vec3 d = normalize(vWorldDir);
        float h = d.y;
        vec3 col;
        if (h >= 0.0) {
          col = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.52));
          vec2 cuv = d.xz / (h + 0.4) * 1.1;
          float n = noise(cuv) * 0.65 + noise(cuv * 2.3) * 0.35;
          float cloud = smoothstep(0.52, 0.82, n) * smoothstep(0.04, 0.35, h);
          col = mix(col, mix(horizonColor, vec3(1.0), 0.55), cloud * 0.35);
          float sunDot = max(0.0, dot(d, normalize(sunDir)));
          col += sunColor * (pow(sunDot, 28.0) * sunGlow + pow(sunDot, 220.0) * sunGlow * 2.5);
        } else {
          col = mix(horizonColor, groundColor, clamp(-h * 4.0, 0.0, 1.0));
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Clona fedelmente la scena 3D potenziando i materiali PBR per il massimo realismo fotografico:
 * - Pavimenti (parquet/piastrelle) con riflesso satinato clearcoat Fresnel
 * - Tessuti (divani/letti/tappeti) con sheen vellutato morbido
 * - Intonaco pareti calibrato per esaltare luce radente e ombre morbide
 * - Piano esterno in travertino/cemento architettonico procedurale che sfuma nella foschia d'orizzonte
 */
function buildPhotorealisticScene(
  sourceGroup: THREE.Group,
  mood: MoodConfig
): {
  scene: THREE.Scene;
  sceneRadius: number;
  sceneCenter: THREE.Vector3;
  disposables: Array<{ dispose: () => void }>;
} {
  const studioScene = new THREE.Scene();
  const disposables: Array<{ dispose: () => void }> = [];
  const texCache = new Map<THREE.Texture, THREE.Texture>();
  const groundTex = createArchitecturalGroundTextures(mood.groundTint);
  disposables.push(groundTex.map, groundTex.roughnessMap);

  sourceGroup.updateMatrixWorld(true);
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();
  const bbox = new THREE.Box3();
  let hasHouseMesh = false;

  sourceGroup.traverse((obj) => {
    if (obj.name === '__piantestudio_stylized_outline__') return;
    if (!obj.visible) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const rawMat = (mesh.userData.__origMaterial ?? mesh.material) as
      | THREE.Material
      | THREE.Material[];
    if (Array.isArray(rawMat)) return;
    if (rawMat.transparent && rawMat.opacity < 0.22) return;

    const srcGeo = mesh.geometry;
    if (!srcGeo.getAttribute('position')) return;

    const geo = srcGeo.clone();
    if (!geo.getAttribute('normal')) {
      geo.computeVertexNormals();
    }
    disposables.push(geo);

    const std = rawMat as THREE.MeshStandardMaterial & {
      clearcoat?: number;
      clearcoatRoughness?: number;
      bumpMap?: THREE.Texture | null;
      bumpScale?: number;
      normalMap?: THREE.Texture | null;
    };

    const isGlass = Boolean(std.transparent && std.opacity < 0.65);
    const isGroundPlane =
      srcGeo.type === 'PlaneGeometry' &&
      srcGeo.getAttribute('position').count <= 6 &&
      mesh.position.y < -0.05;

    mesh.matrixWorld.decompose(worldPos, worldQuat, worldScale);

    // Rileva la soletta pavimento interna (box piatto intorno a y = -0.02 con texture PBR)
    const isFloorSlab =
      !isGroundPlane &&
      !isGlass &&
      Boolean(std.map && std.roughnessMap) &&
      Math.abs(worldPos.y + 0.02) < 0.06;

    let mat: THREE.Material;
    if (isGlass) {
      mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#cce7f7'),
        transparent: true,
        opacity: 0.24,
        roughness: 0.03,
        metalness: 0.06,
        clearcoat: 1.0,
        clearcoatRoughness: 0.02,
        ior: 1.52,
        reflectivity: 0.98,
        envMapIntensity: 2.2,
        depthWrite: false,
      });
    } else if (isGroundPlane) {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#ffffff'),
        map: groundTex.map,
        roughnessMap: groundTex.roughnessMap,
        roughness: 0.95,
        metalness: 0.0,
        envMapIntensity: 0.22,
      });
    } else {
      const clonedMap = cloneTextureForRenderer(std.map, texCache, disposables);
      const clonedBump = cloneTextureForRenderer(std.bumpMap, texCache, disposables);
      const clonedRough = cloneTextureForRenderer(std.roughnessMap, texCache, disposables);
      const clonedNormal = cloneTextureForRenderer(std.normalMap, texCache, disposables);

      const baseCol = std.color ? std.color.clone() : new THREE.Color('#e2e8f0');
      const matRoughness = clonedRough ? 1.0 : std.roughness ?? 0.65;
      const matMetalness = std.metalness ?? 0.02;
      const isMattePlaster = !clonedMap && matRoughness >= 0.85 && matMetalness < 0.05;
      const isFabricLike = !isFloorSlab && matRoughness >= 0.8 && matMetalness < 0.04 && !isMattePlaster;

      // Rifinitura ottica per realismo fotografico:
      // - Pavimenti: strato clearcoat satinato per riflessi naturali di cielo e finestre
      // - Tessuti: sheen morbido sui profili di divani, letti e cuscini
      // - Metalli: envMapIntensity più ricco per riflessi croccanti
      const clearcoat = isFloorSlab
        ? Math.max(std.clearcoat ?? 0, 0.36)
        : std.clearcoat ?? (matRoughness < 0.35 && matMetalness < 0.2 ? 0.28 : 0);
      const clearcoatRoughness = isFloorSlab
        ? 0.22
        : std.clearcoatRoughness ?? 0.12;

      mat = new THREE.MeshPhysicalMaterial({
        color: baseCol,
        map: clonedMap,
        bumpMap: clonedBump,
        bumpScale: isMattePlaster ? (std.bumpScale ?? 0.006) * 1.35 : std.bumpScale ?? 0.008,
        roughnessMap: clonedRough,
        normalMap: clonedNormal,
        roughness: matRoughness,
        metalness: matMetalness,
        clearcoat,
        clearcoatRoughness,
        sheen: isFabricLike ? 0.55 : 0,
        sheenRoughness: isFabricLike ? 0.72 : 1.0,
        sheenColor: isFabricLike ? baseCol.clone().lerp(new THREE.Color('#ffffff'), 0.45) : new THREE.Color('#000000'),
        envMapIntensity: isMattePlaster
          ? 0.32
          : isFloorSlab
            ? 1.15
            : matMetalness > 0.4
              ? 1.55
              : std.envMapIntensity ?? 0.9,
        emissive: std.emissive ? std.emissive.clone() : new THREE.Color('#000000'),
        emissiveIntensity: std.emissiveIntensity ?? 0,
      });
    }
    disposables.push(mat);

    const clonedMesh = new THREE.Mesh(geo, mat);
    clonedMesh.position.copy(worldPos);
    clonedMesh.quaternion.copy(worldQuat);
    clonedMesh.scale.copy(worldScale);
    clonedMesh.castShadow = !isGlass && !isGroundPlane;
    clonedMesh.receiveShadow = !isGlass;
    studioScene.add(clonedMesh);

    if (!isGroundPlane) {
      clonedMesh.updateMatrixWorld(true);
      bbox.expandByObject(clonedMesh);
      hasHouseMesh = true;
    }
  });

  const sceneCenter = new THREE.Vector3(0, 1.0, 0);
  let sceneRadius = 8;
  if (hasHouseMesh && !bbox.isEmpty()) {
    const size = new THREE.Vector3();
    bbox.getCenter(sceneCenter);
    bbox.getSize(size);
    sceneRadius = Math.max(3.6, Math.hypot(size.x, size.z) * 0.55);
  }

  return { scene: studioScene, sceneRadius, sceneCenter, disposables };
}

/** Shader per media progressiva HDR in virgola mobile (accumulo SSAA + Sky GI + ombre d'area) */
function createAccumulateMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    uniforms: {
      tPrev: { value: null as THREE.Texture | null },
      tCurr: { value: null as THREE.Texture | null },
      weight: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tPrev;
      uniform sampler2D tCurr;
      uniform float weight;
      varying vec2 vUv;
      void main() {
        vec4 curr = texture2D(tCurr, vUv);
        if (weight >= 0.9999) {
          gl_FragColor = curr;
          return;
        }
        vec4 prev = texture2D(tPrev, vUv);
        gl_FragColor = mix(prev, curr, weight);
      }
    `,
  });
}

/** Shader che fonde l'AO ad alta definizione nel buffer HDR lineare prima del Bloom e di AgX */
function createAoCompositeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    uniforms: {
      tBeauty: { value: null as THREE.Texture | null },
      tAo: { value: null as THREE.Texture | null },
      aoStrength: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tBeauty;
      uniform sampler2D tAo;
      uniform float aoStrength;
      varying vec2 vUv;
      void main() {
        vec4 beauty = texture2D(tBeauty, vUv);
        float ao = texture2D(tAo, vUv).r;
        // Multi-bounce AO approximation: mantiene calore naturale nelle ombre invece di annerire i colori
        float shapedAo = pow(clamp(ao, 0.0, 1.0), 1.0 + aoStrength * 0.4);
        vec3 bounceTint = mix(vec3(0.88, 0.89, 0.94), vec3(1.0), shapedAo);
        vec3 aoColor = mix(vec3(1.0), vec3(shapedAo) * bounceTint, clamp(aoStrength, 0.0, 1.35));
        gl_FragColor = vec4(beauty.rgb * aoColor, 1.0);
      }
    `,
  });
}

function defaultMoodFromPreset(preset: RenderStylePreset): PhotoMood {
  if (preset === 'evening') return 'evening';
  if (preset === 'studio') return 'nordic';
  return 'archviz';
}

export const PathTracerRenderModal: React.FC<PathTracerRenderModalProps> = ({
  sourceGroup,
  sourceCamera,
  onClose,
  onSendToAiPhoto,
}) => {
  const { project, selectedRoomId3D, showToast } = useProjectStore();
  const preset: RenderStylePreset = project.renderSettings.renderPreset ?? 'realistic';

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const renderPostProcessRef = useRef<(() => void) | null>(null);

  const initialMood = defaultMoodFromPreset(preset);
  const [mood, setMood] = useState<PhotoMood>(initialMood);
  const [quality, setQuality] = useState<QualityPreset>('high');
  const [hasStarted, setHasStarted] = useState(false);
  const [aoStrength, setAoStrength] = useState(1.0);
  const [bloomStrength, setBloomStrength] = useState(PHOTO_MOODS[initialMood].defaultBloom);
  const [grainStrength, setGrainStrength] = useState(0.018);
  const [exposure, setExposure] = useState(PHOTO_MOODS[initialMood].defaultExposure);
  const [sunStrength, setSunStrength] = useState(1.05);
  const [isPaused, setIsPaused] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [samples, setSamples] = useState(0);
  const [targetSamples, setTargetSamples] = useState(QUALITY_CONFIG.high.samples);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [runToken, setRunToken] = useState(0);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const aoStrengthRef = useRef(aoStrength);
  aoStrengthRef.current = aoStrength;
  const bloomStrengthRef = useRef(bloomStrength);
  bloomStrengthRef.current = bloomStrength;
  const grainStrengthRef = useRef(grainStrength);
  grainStrengthRef.current = grainStrength;
  const exposureRef = useRef(exposure);
  exposureRef.current = exposure;
  const sunStrengthRef = useRef(sunStrength);
  sunStrengthRef.current = sunStrength;

  const handleSelectMood = (nextMood: PhotoMood) => {
    setMood(nextMood);
    setBloomStrength(PHOTO_MOODS[nextMood].defaultBloom);
    setExposure(PHOTO_MOODS[nextMood].defaultExposure);
  };

  // Aggiorna AO, Bloom, Grana e Luminosità ISTANTANEAMENTE sul risultato accumulato
  useEffect(() => {
    const r = rendererRef.current;
    if (r) {
      r.toneMappingExposure = exposure;
    }
    renderPostProcessRef.current?.();
  }, [aoStrength, bloomStrength, grainStrength, exposure]);

  // Effetto principale: costruisce la scena ArchViz, calcola GTAO HD e accumula Sky GI + Sun Penumbra + SSAA
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host || !hasStarted) return;

    let cancelled = false;
    let rafId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let onContextLost: ((e: Event) => void) | null = null;
    const cleanupList: Array<() => void> = [];

    const start = async () => {
      const qCfg = QUALITY_CONFIG[quality];
      const moodCfg = PHOTO_MOODS[mood];
      setTargetSamples(qCfg.samples);
      setIsInitializing(true);
      setErrorMsg(null);
      setSamples(0);

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      if (cancelled) return;

      try {
        const rect = host.getBoundingClientRect();
        const aspect = Math.max(1.2, Math.min(2.1, rect.width / Math.max(1, rect.height)));
        const outW = qCfg.maxWidth;
        const outH = Math.round(outW / aspect);

        renderer = createSafeWebGLRenderer();
        renderer.setPixelRatio(1);
        renderer.setSize(outW, outH, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.AgXToneMapping;
        renderer.toneMappingExposure = exposureRef.current;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.style.maxWidth = '100%';
        renderer.domElement.style.maxHeight = '100%';
        renderer.domElement.style.width = 'auto';
        renderer.domElement.style.height = 'auto';
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.borderRadius = '0.5rem';

        onContextLost = (ev: Event) => {
          ev.preventDefault();
          cancelled = true;
          setIsInitializing(false);
          setErrorMsg(
            'La scheda grafica ha interrotto il contesto WebGL. Prova la qualità "Veloce" oppure premi "Riavvia".'
          );
        };
        renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);

        host.innerHTML = '';
        host.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // 1. Clona fedelmente la scena 3D con materiali PBR potenziati (clearcoat pavimenti, sheen tessuti, terreno pietra)
        const built = buildPhotorealisticScene(sourceGroup, moodCfg);
        const studioScene = built.scene;
        cleanupList.push(() => {
          for (const d of built.disposables) {
            try {
              d.dispose();
            } catch {
              // ignore
            }
          }
        });

        const sunDir = computeArchVizSunDirection(project.renderSettings.timeOfDay, moodCfg);

        // Foschia atmosferica morbida all'orizzonte per fondere il piano esterno col cielo
        studioScene.fog = new THREE.Fog(
          moodCfg.fogColor,
          Math.max(18, built.sceneRadius * 2.4),
          Math.max(58, built.sceneRadius * 6.5)
        );

        // 2. HDRI PMREM procedurale (cielo + nuvole + corona solare) + Cupola cielo atmosferica
        const envRT = createPhotorealisticEnvironment(renderer, moodCfg, sunDir);
        studioScene.environment = envRT.texture;
        cleanupList.push(() => envRT.dispose());

        const skyDome = createSkyBackdropDome(moodCfg, sunDir);
        studioScene.add(skyDome.mesh);
        cleanupList.push(() => skyDome.dispose());

        // 3. Rig di Illuminazione ArchViz (Sole 4K + Hemispherical Fibonacci Sky GI + Bounce + Luci Interne)
        const shadowHalf = Math.min(18, Math.max(4.5, built.sceneRadius * 1.18));
        const sunDist = Math.max(18, built.sceneRadius * 2.6);
        const maxTex = renderer.capabilities.maxTextureSize;
        const sunShadowRes = Math.min(qCfg.sunShadowRes, maxTex >= 4096 ? 4096 : 2048);

        // Emisferica delicata (cielo zenitale + rimbalzo caldo del pavimento sulle pareti)
        const hemi = new THREE.HemisphereLight(
          moodCfg.hemiSky,
          moodCfg.hemiGround,
          moodCfg.hemiIntensity
        );
        studioScene.add(hemi);

        // Sole Direzionale Principale (4096px PCFSoftShadowMap, disco Vogel per penombre fisiche)
        const sunLight = new THREE.DirectionalLight(
          moodCfg.sunColor,
          moodCfg.sunIntensity * sunStrengthRef.current
        );
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.set(sunShadowRes, sunShadowRes);
        sunLight.shadow.camera.near = 1;
        sunLight.shadow.camera.far = sunDist * 2.5;
        sunLight.shadow.camera.left = -shadowHalf;
        sunLight.shadow.camera.right = shadowHalf;
        sunLight.shadow.camera.top = shadowHalf;
        sunLight.shadow.camera.bottom = -shadowHalf;
        sunLight.shadow.bias = -0.00014;
        sunLight.shadow.normalBias = 0.018;
        sunLight.shadow.radius = 2.2;
        sunLight.target.position.copy(built.sceneCenter);
        studioScene.add(sunLight);
        studioScene.add(sunLight.target);

        // TRUE HEMISPHERICAL SKY GI LIGHT:
        // Campionata su tutta la semisfera cielo Fibonacci (32-64 direzioni con ombre 1024px)
        // Produce vera occlusione globale morbida da cupola cielo in ogni stanza e angolo senza alcun puntino!
        const skyGiLight = new THREE.DirectionalLight(
          moodCfg.skyGiColor,
          moodCfg.skyGiIntensity
        );
        skyGiLight.castShadow = true;
        skyGiLight.shadow.mapSize.set(1024, 1024);
        skyGiLight.shadow.camera.near = 1;
        skyGiLight.shadow.camera.far = sunDist * 2.5;
        skyGiLight.shadow.camera.left = -shadowHalf;
        skyGiLight.shadow.camera.right = shadowHalf;
        skyGiLight.shadow.camera.top = shadowHalf;
        skyGiLight.shadow.camera.bottom = -shadowHalf;
        skyGiLight.shadow.bias = -0.00035;
        skyGiLight.shadow.normalBias = 0.032;
        skyGiLight.shadow.radius = 3.5;
        skyGiLight.target.position.copy(built.sceneCenter);
        studioScene.add(skyGiLight);
        studioScene.add(skyGiLight.target);

        // Luci calde interne reali al centro delle stanze (con ombre in Golden Hour / Sera / Prima Persona)
        const interiorLightsOn = project.renderSettings.interiorLights ?? true;
        if (interiorLightsOn && project.walls.length > 0) {
          const allRooms = detectRooms(project.walls, project.furniture);
          const activeRoom = allRooms.find((r) => r.id === selectedRoomId3D) ?? null;
          const allBounds = getWallsBounds(project.walls);
          const cx = activeRoom ? activeRoom.bounds.centerX : allBounds.centerX;
          const cz = activeRoom ? activeRoom.bounds.centerY : allBounds.centerY;
          const targetRooms = activeRoom ? [activeRoom] : allRooms.slice(0, 6);
          const wallH = project.walls.reduce((m, w) => Math.max(m, w.height), 2.7);
          const showRoof = project.renderSettings.cameraMode === 'first_person';
          const baseInterior = showRoof ? 1.65 : 0.85;
          const ptIntensity = baseInterior * moodCfg.interiorLightMult;

          targetRooms.forEach((rm, idx) => {
            const pLight = new THREE.PointLight(
              mood === 'evening' || mood === 'golden' ? '#ffcb80' : '#fff0d6',
              ptIntensity,
              Math.max(5.5, Math.hypot(rm.bounds.width, rm.bounds.height) * 1.25),
              1.75
            );
            pLight.position.set(
              rm.bounds.centerX - cx,
              Math.max(2.1, wallH - 0.25),
              rm.bounds.centerY - cz
            );
            if ((mood === 'evening' || mood === 'golden' || showRoof) && idx < 2) {
              pLight.castShadow = true;
              pLight.shadow.mapSize.set(512, 512);
              pLight.shadow.bias = -0.0006;
              pLight.shadow.normalBias = 0.025;
            }
            studioScene.add(pLight);

            if (showRoof) {
              const lampGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.035, 24);
              const lampMat = new THREE.MeshStandardMaterial({
                color: '#fffdf8',
                emissive: new THREE.Color('#ffdfa8'),
                emissiveIntensity: mood === 'evening' ? 3.5 : 1.9,
                roughness: 0.2,
              });
              const lamp = new THREE.Mesh(lampGeo, lampMat);
              lamp.position.set(rm.bounds.centerX - cx, Math.max(2.35, wallH - 0.03), rm.bounds.centerY - cz);
              studioScene.add(lamp);
              cleanupList.push(() => {
                lampGeo.dispose();
                lampMat.dispose();
              });
            }
          });
        }

        // 4. Clona camera attiva con aspect esatto dell'output
        const renderCam = sourceCamera.clone() as THREE.PerspectiveCamera;
        if (renderCam.isPerspectiveCamera) {
          renderCam.aspect = outW / outH;
          renderCam.updateProjectionMatrix();
        }
        renderCam.updateMatrixWorld(true);
        const baseProjectionMatrix = renderCam.projectionMatrix.clone();

        // 5. Calcola GTAO ad Alta Definizione una sola volta sulla geometria pulita
        const gtaoPass = new ArchitecturalGTAOPass(
          studioScene,
          renderCam,
          outW,
          outH,
          outW
        );
        gtaoPass.output = ArchitecturalGTAOPass.OUTPUT.Off;
        gtaoPass.updateGtaoMaterial({
          radius: 0.52,
          distanceExponent: 1.55,
          thickness: 0.9,
          distanceFallOff: 0.9,
          scale: 1.18,
          samples: qCfg.aoSamples,
        });
        gtaoPass.updatePdMaterial({
          lumaPhi: 7.5,
          depthPhi: 1.8,
          normalPhi: 3.0,
          radius: 7,
          radiusExponent: 2,
          rings: 2,
          samples: 16,
        });
        cleanupList.push(() => gtaoPass.dispose());

        const glCtx = renderer.getContext();
        const supportsHalfFloatRT = Boolean(
          glCtx.getExtension('EXT_color_buffer_float') ||
            glCtx.getExtension('EXT_color_buffer_half_float')
        );
        const rtType = supportsHalfFloatRT ? THREE.HalfFloatType : THREE.UnsignedByteType;

        const dummyRT = new THREE.WebGLRenderTarget(16, 16, { type: rtType });
        cleanupList.push(() => dummyRT.dispose());
        gtaoPass.render(renderer, dummyRT, dummyRT, 0, false);

        // 6. Buffer HDR di accumulo + Pipeline Post-Processing Fotografico
        const frameRT = new THREE.WebGLRenderTarget(outW, outH, { type: rtType });
        const accumA = new THREE.WebGLRenderTarget(outW, outH, { type: rtType });
        const accumB = new THREE.WebGLRenderTarget(outW, outH, { type: rtType });
        const postHdrRT = new THREE.WebGLRenderTarget(outW, outH, { type: rtType });
        const tonemappedRT = new THREE.WebGLRenderTarget(outW, outH, { type: rtType });
        cleanupList.push(() => {
          frameRT.dispose();
          accumA.dispose();
          accumB.dispose();
          postHdrRT.dispose();
          tonemappedRT.dispose();
        });

        const accumMat = createAccumulateMaterial();
        const accumQuad = new FullScreenQuad(accumMat);
        const aoCompMat = createAoCompositeMaterial();
        const aoCompQuad = new FullScreenQuad(aoCompMat);
        const bloomPass = new UnrealBloomPass(
          new THREE.Vector2(outW, outH),
          bloomStrengthRef.current,
          0.58,
          moodCfg.bloomThreshold
        );
        const outputPass = new OutputPass();
        const finishMat = new THREE.ShaderMaterial({
          uniforms: THREE.UniformsUtils.clone(PhotographicFinishShader.uniforms),
          vertexShader: PhotographicFinishShader.vertexShader,
          fragmentShader: PhotographicFinishShader.fragmentShader,
          depthTest: false,
          depthWrite: false,
        });
        finishMat.uniforms.resolution.value.set(outW, outH);
        finishMat.uniforms.time.value = 1.0;
        const finishQuad = new FullScreenQuad(finishMat);
        cleanupList.push(() => {
          accumMat.dispose();
          accumQuad.dispose();
          aoCompMat.dispose();
          aoCompQuad.dispose();
          bloomPass.dispose();
          outputPass.dispose();
          finishMat.dispose();
          finishQuad.dispose();
        });

        let readAccum = accumA;
        let writeAccum = accumB;
        let currentSample = 0;

        /** Applica AO + HDR Bloom + AgX Filmic + Color Grading ArchViz + Grana (istantaneo!) */
        const renderPostProcess = () => {
          if (!renderer || currentSample === 0) return;
          const prevTone = renderer.toneMapping;

          // Step A: Applica GTAO multi-bounce in spazio lineare HDR
          renderer.toneMapping = THREE.NoToneMapping;
          aoCompMat.uniforms.tBeauty.value = readAccum.texture;
          aoCompMat.uniforms.tAo.value = gtaoPass.gtaoMap;
          aoCompMat.uniforms.aoStrength.value = aoStrengthRef.current;
          renderer.setRenderTarget(postHdrRT);
          aoCompQuad.render(renderer);

          // Step B: HDR UnrealBloom sugli highlight naturali
          if (bloomStrengthRef.current > 0.005) {
            bloomPass.strength = bloomStrengthRef.current;
            bloomPass.threshold = moodCfg.bloomThreshold;
            bloomPass.radius = mood === 'evening' || mood === 'golden' ? 0.65 : 0.56;
            bloomPass.renderToScreen = false;
            bloomPass.render(renderer, postHdrRT, postHdrRT, 0, false);
          }

          // Step C: AgX Filmic Tone Mapping (resa naturale su legni, intonaci e luci solari calde)
          renderer.toneMapping = THREE.AgXToneMapping;
          renderer.toneMappingExposure = exposureRef.current;
          outputPass.renderToScreen = false;
          outputPass.render(renderer, tonemappedRT, postHdrRT, 0, false);

          // Step D: Finitura fotografica DSLR (Split-Tone, Clarity, Micro-CA bordi, Vignette, Grana 35mm)
          finishMat.uniforms.tDiffuse.value = tonemappedRT.texture;
          finishMat.uniforms.grainIntensity.value = grainStrengthRef.current;
          finishMat.uniforms.vignetteIntensity.value = moodCfg.vignette;
          finishMat.uniforms.clarity.value = 0.18;
          finishMat.uniforms.contrast.value = 1.07;
          finishMat.uniforms.saturation.value = mood === 'nordic' ? 1.0 : 1.06;
          finishMat.uniforms.splitTone.value = moodCfg.splitTone;
          finishMat.uniforms.chromaticAberration.value = 0.00075;
          renderer.setRenderTarget(null);
          finishQuad.render(renderer);

          renderer.toneMapping = prevTone;
        };

        renderPostProcessRef.current = renderPostProcess;

        // Base ortonormale per disco solare
        const upRef = Math.abs(sunDir.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const sunU = new THREE.Vector3().crossVectors(upRef, sunDir).normalize();
        const sunV = new THREE.Vector3().crossVectors(sunDir, sunU).normalize();
        const tmpDir = new THREE.Vector3();
        const skyDir = new THREE.Vector3();

        setIsInitializing(false);

        const renderStep = () => {
          if (cancelled || !renderer) return;
          if (currentSample >= qCfg.samples) return;
          rafId = window.requestAnimationFrame(renderStep);
          if (isPausedRef.current) return;

          try {
            const batchSize = qCfg.samples >= 64 ? 2 : 1;
            for (let b = 0; b < batchSize && currentSample < qCfg.samples; b++) {
              const sIdx = currentSample;

              // 1. Sub-pixel Halton camera jitter (true SSAA)
              const jx = (halton(sIdx + 1, 2) - 0.5) / outW;
              const jy = (halton(sIdx + 1, 3) - 0.5) / outH;
              renderCam.projectionMatrix.copy(baseProjectionMatrix);
              renderCam.projectionMatrix.elements[8] += jx * 2.0;
              renderCam.projectionMatrix.elements[9] += jy * 2.0;

              // 2. Disco solare Vogel per penombre fisiche realistiche
              const [du, dv] = vogelDisk(sIdx, qCfg.samples);
              tmpDir
                .copy(sunDir)
                .addScaledVector(sunU, du * moodCfg.sunSpread)
                .addScaledVector(sunV, dv * moodCfg.sunSpread)
                .normalize();
              sunLight.position.copy(built.sceneCenter).addScaledVector(tmpDir, sunDist);

              // 3. Semisfera Fibonacci completa per vero Sky Dome GI a 360° con ombre morbide
              fibonacciHemisphereDir(sIdx, qCfg.samples, skyDir);
              skyGiLight.position.copy(built.sceneCenter).addScaledVector(skyDir, sunDist);

              // 4. Render frame lineare HDR
              renderer.toneMapping = THREE.NoToneMapping;
              renderer.setRenderTarget(frameRT);
              renderer.render(studioScene, renderCam);

              // 5. Accumulo progressivo in ping-pong
              accumMat.uniforms.tPrev.value = readAccum.texture;
              accumMat.uniforms.tCurr.value = frameRT.texture;
              accumMat.uniforms.weight.value = 1.0 / (sIdx + 1);
              renderer.setRenderTarget(writeAccum);
              accumQuad.render(renderer);

              const tmp = readAccum;
              readAccum = writeAccum;
              writeAccum = tmp;

              currentSample += 1;
            }

            renderPostProcess();
            setSamples(currentSample);
          } catch (loopErr) {
            cancelled = true;
            setErrorMsg(
              loopErr instanceof Error
                ? loopErr.message
                : 'Errore WebGL durante il calcolo del Render Fotografico.'
            );
          }
        };

        rafId = window.requestAnimationFrame(renderStep);
      } catch (err) {
        if (!cancelled) {
          setIsInitializing(false);
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Impossibile avviare il motore fotografico WebGL2 su questa scheda grafica.'
          );
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      renderPostProcessRef.current = null;
      if (rafId) window.cancelAnimationFrame(rafId);
      if (renderer && onContextLost) {
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      }
      for (let i = cleanupList.length - 1; i >= 0; i--) {
        try {
          cleanupList[i]();
        } catch {
          // ignore
        }
      }
      if (renderer) {
        try {
          renderer.forceContextLoss();
        } catch {
          // ignore
        }
        renderer.dispose();
        renderer.domElement.remove();
      }
      rendererRef.current = null;
    };
  }, [
    hasStarted,
    mood,
    quality,
    sunStrength,
    sourceGroup,
    sourceCamera,
    project.renderSettings.timeOfDay,
    project.renderSettings.interiorLights,
    project.renderSettings.cameraMode,
    project.walls,
    project.furniture,
    selectedRoomId3D,
    runToken,
  ]);

  const progressPct = Math.min(100, Math.round((samples / Math.max(1, targetSamples)) * 100));
  const isDone = !isInitializing && samples >= targetSamples && targetSamples > 0;

  const captureCurrentFrameDataUrl = (): string | null => {
    const r = rendererRef.current;
    if (!r) return null;
    renderPostProcessRef.current?.();
    return r.domElement.toDataURL('image/png', 1.0);
  };

  const handleDownloadPng = () => {
    const dataUrl = captureCurrentFrameDataUrl();
    if (!dataUrl) return;
    const a = document.createElement('a');
    const safeName = (project.name || 'piantestudio').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = dataUrl;
    a.download = `${safeName}-render-fotografico-hd.png`;
    a.click();
    showToast('Render Fotografico HD salvato in PNG!', 'success');
  };

  const handleSendToAi = () => {
    const dataUrl = captureCurrentFrameDataUrl();
    if (!dataUrl || !onSendToAiPhoto) return;
    onSendToAiPhoto(dataUrl);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl max-h-[94vh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-xs">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Render Fotografico HD (Motore ArchViz)
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                  Sky GI 360° • AgX Filmic • Zero Puntini
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Cupola cielo GI a 360°, ombre solari 4K morbide, riflessi PBR, GTAO, Bloom HDR e color grading fotografico.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Barra Controlli: Atmosfera Fotografica + Qualità + Slider Live */}
        <div className="px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 mr-0.5">Luce:</span>
              {(['archviz', 'golden', 'nordic', 'evening'] as PhotoMood[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleSelectMood(m)}
                  title={PHOTO_MOODS[m].desc}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                    mood === m
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-400'
                  }`}
                >
                  {PHOTO_MOODS[m].label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 mr-0.5">Qualità:</span>
              {(['fast', 'high', 'ultra'] as QualityPreset[]).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuality(q)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                    quality === q
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-emerald-400'
                  }`}
                >
                  {QUALITY_CONFIG[q].label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-0.5">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
              <span>AO:</span>
              <input
                type="range"
                min={0}
                max={1.35}
                step={0.05}
                value={aoStrength}
                onChange={(e) => setAoStrength(Number(e.target.value))}
                className="w-16 accent-emerald-600"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
              <span>Bloom:</span>
              <input
                type="range"
                min={0}
                max={0.75}
                step={0.02}
                value={bloomStrength}
                onChange={(e) => setBloomStrength(Number(e.target.value))}
                className="w-16 accent-sky-500"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
              <span>Grana:</span>
              <input
                type="range"
                min={0}
                max={0.05}
                step={0.002}
                value={grainStrength}
                onChange={(e) => setGrainStrength(Number(e.target.value))}
                className="w-16 accent-slate-500"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>Sole:</span>
              <input
                type="range"
                min={0.4}
                max={1.8}
                step={0.1}
                value={sunStrength}
                onChange={(e) => setSunStrength(Number(e.target.value))}
                className="w-16 accent-amber-500"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
              <span>Esposizione:</span>
              <input
                type="range"
                min={0.75}
                max={1.4}
                step={0.02}
                value={exposure}
                onChange={(e) => setExposure(Number(e.target.value))}
                className="w-16 accent-emerald-600"
              />
              <span className="font-mono text-[10px] w-7">{exposure.toFixed(2)}</span>
            </label>
          </div>
        </div>

        {/* Viewport Render ArchViz HD */}
        <div className="flex-1 min-h-[380px] bg-slate-950 relative flex items-center justify-center overflow-hidden p-3">
          <div
            ref={canvasHostRef}
            className="w-full h-full min-h-[380px] max-h-[64vh] flex items-center justify-center"
          />

          {!hasStarted && (
            <div className="absolute inset-0 bg-slate-950/92 flex items-center justify-center p-6">
              <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 p-6 text-center space-y-5 shadow-2xl">
                <div className="space-y-1.5">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center mx-auto shadow-md">
                    <Camera className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-white">
                    Scegli atmosfera e risoluzione del Render Fotografico
                  </h3>
                  <p className="text-xs text-slate-400">
                    Calcola <strong>Sky Dome GI a 360°</strong>, ombre solari 4K morbide, riflessi PBR,{' '}
                    <strong>AgX Filmic</strong>, <strong>GTAO</strong>, <strong>Bloom</strong> e <strong>grana 35mm</strong> — zero puntini.
                  </p>
                </div>

                {/* Scelta Atmosfera rapida */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-left">
                  {(['archviz', 'golden', 'nordic', 'evening'] as PhotoMood[]).map((m) => {
                    const active = mood === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleSelectMood(m)}
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                          active
                            ? 'bg-amber-500/20 border-amber-400 ring-1 ring-amber-400 text-white'
                            : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <div className="text-[11px] font-bold">{PHOTO_MOODS[m].label}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                          {PHOTO_MOODS[m].desc}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Scelta Qualità */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-left">
                  {(['fast', 'high', 'ultra'] as QualityPreset[]).map((id) => {
                    const opt = QUALITY_CONFIG[id];
                    const active = quality === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setQuality(id)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          active
                            ? 'bg-emerald-600/20 border-emerald-400 ring-1 ring-emerald-400 text-white'
                            : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <div className="text-xs font-bold">
                          {id === 'fast' ? 'Veloce' : id === 'high' ? 'Alta Qualità' : 'Ultra HD 2K'}
                        </div>
                        <div className="text-[11px] font-mono text-emerald-300 mt-0.5">
                          {opt.samples}× GI+SSAA • {opt.maxWidth}px
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1 leading-tight">
                          {opt.timeHint}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsPaused(false);
                    setTargetSamples(QUALITY_CONFIG[quality].samples);
                    setHasStarted(true);
                  }}
                  className="w-full py-3 px-5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg cursor-pointer transition-all"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Avvia Render Fotografico ({PHOTO_MOODS[mood].label} • {QUALITY_CONFIG[quality].label})
                </button>
              </div>
            </div>
          )}

          {hasStarted && isInitializing && !errorMsg && (
            <div className="absolute inset-0 bg-slate-950/75 flex flex-col items-center justify-center gap-2.5 text-white text-xs">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
              <span className="font-semibold">
                Generazione HDRI cielo, materiali PBR e GTAO ad alta definizione...
              </span>
            </div>
          )}

          {errorMsg && (
            <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center gap-3 p-6 text-center text-xs text-red-300 max-w-md mx-auto">
              <p className="font-semibold text-sm text-white">
                Impossibile eseguire il Render Fotografico WebGL
              </p>
              <p>{errorMsg}</p>
              <button
                type="button"
                onClick={() => {
                  setQuality('fast');
                  setErrorMsg(null);
                  setIsPaused(false);
                  setRunToken((n) => n + 1);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
              >
                Riprova in modalità Veloce (leggera)
              </button>
            </div>
          )}

          {hasStarted && !isInitializing && !errorMsg && !isDone && (
            <div className="absolute bottom-4 left-4 right-4 max-w-md mx-auto bg-slate-900/88 backdrop-blur border border-slate-700/80 rounded-xl px-3.5 py-2 text-white text-[11px] shadow-lg space-y-1.5 pointer-events-none">
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-1.5">
                  {isPaused ? (
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                  ) : (
                    <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                  )}
                  {isPaused ? 'In pausa' : 'Calcolo Sky GI 360°, ombre 4K e AgX...'}
                </span>
                <span className="font-mono text-emerald-300 font-bold">
                  {samples} / {targetSamples} ({progressPct}%)
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-150"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {hasStarted && isDone && !errorMsg && (
            <div className="absolute top-3 right-3 bg-slate-900/80 backdrop-blur border border-emerald-500/40 rounded-lg px-2.5 py-1 text-emerald-300 text-[10px] font-semibold flex items-center gap-1.5 shadow pointer-events-none">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Pronto ({PHOTO_MOODS[mood].label} • {QUALITY_CONFIG[quality].samples}× GI)
            </div>
          )}
        </div>

        {/* Footer Azioni */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!hasStarted ? (
              <button
                type="button"
                onClick={() => {
                  setIsPaused(false);
                  setTargetSamples(QUALITY_CONFIG[quality].samples);
                  setHasStarted(true);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Avvia Render
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setIsPaused((p) => !p)}
                  disabled={isInitializing || isDone}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  {isPaused ? 'Riprendi' : 'Pausa'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPaused(false);
                    setErrorMsg(null);
                    setRunToken((n) => n + 1);
                  }}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Riavvia
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onSendToAiPhoto && (
              <button
                type="button"
                disabled={!hasStarted || isInitializing || samples < 1}
                onClick={handleSendToAi}
                className="px-3.5 py-2 rounded-xl border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 text-violet-700 dark:text-violet-300 disabled:opacity-40 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                title="Opzionale: usa questo render ArchViz come base ultra-fedele per la Foto AI fotorealistica"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Rifinisci con AI
              </button>
            )}
            <button
              type="button"
              disabled={!hasStarted || isInitializing || samples < 1}
              onClick={handleDownloadPng}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Scarica Render HD (PNG)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Modale "Render Fotografico HD (Motore Studio Multi-Campione — Zero Puntini)":
 * - Sostituisce il vecchio path-tracing rumoroso con un motore fotografico progressivo ad accumulo HDR:
 *   1. Super-Sampling sub-pixel Halton (16× / 32× / 64× SSAA) per spigoli perfettamente nitidi
 *   2. Ombre d'area fisicamente morbide (disco solare + sky-fill jitterati con PCFSoftShadowMap 2048px)
 *   3. Riflessi HDR architettonici (PMREM) e luci calde interne reali per ogni stanza
 *   4. Ambient Occlusion ad alta definizione (Architectural GTAO 32 campioni + Poisson Denoise)
 *   5. Post-Processing fotografico interattivo istantaneo: AO, HDR UnrealBloom, ACES Filmic, Micro-nitidezza e Grana pellicola
 * - 100% locale e online (WebGL2 puro, zero server, zero API key, zero puntini/fireflies)
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
  getPostProcessPresetConfig,
} from '../viewer3d/postProcessing';
import type { RenderStylePreset } from '../types/project';

type QualityPreset = 'fast' | 'high' | 'ultra';

const QUALITY_CONFIG: Record<
  QualityPreset,
  { label: string; samples: number; maxWidth: number; aoSamples: number; timeHint: string }
> = {
  fast: {
    label: 'Veloce (16×)',
    samples: 16,
    maxWidth: 1152,
    aoSamples: 20,
    timeHint: '~1 sec • prova rapida',
  },
  high: {
    label: 'Alta Qualità (32×)',
    samples: 32,
    maxWidth: 1440,
    aoSamples: 28,
    timeHint: '~2 sec • consigliato',
  },
  ultra: {
    label: 'Ultra HD Full (64×)',
    samples: 64,
    maxWidth: 1920,
    aoSamples: 32,
    timeHint: '~4 sec • stampa 2K',
  },
};

interface PathTracerRenderModalProps {
  sourceGroup: THREE.Group;
  sourceCamera: THREE.Camera;
  onClose: () => void;
  onSendToAiPhoto?: (dataUrl: string) => void;
}

/** Sequenza Halton a bassa discrepanza per SSAA sub-pixel senza pattern */
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

/** Disco di Vogel per campionamento uniforme del disco solare / cielo (ombre d'area soffici senza banding) */
function vogelDisk(sampleIndex: number, totalSamples: number): [number, number] {
  const goldenAngle = 2.399963229728653;
  const r = Math.sqrt((sampleIndex + 0.5) / Math.max(1, totalSamples));
  const theta = sampleIndex * goldenAngle;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/** Calcola direzione e colore del sole dall'ora del giorno (coerente con Scene3D) */
function computeSunParams(hour: number, preset: RenderStylePreset) {
  const effectiveHour = preset === 'evening' ? 19.35 : hour;
  const t = Math.max(0, Math.min(1, (effectiveHour - 6) / 14));
  const elevation = Math.sin(t * Math.PI) * 1.15 + 0.16;
  const azimuth = (t - 0.5) * Math.PI * 1.25;
  const dir = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  ).normalize();

  const warmth = 1 - Math.sin(t * Math.PI);
  const sunColor =
    preset === 'studio'
      ? new THREE.Color('#fffcf7')
      : preset === 'evening'
        ? new THREE.Color('#ffad66')
        : new THREE.Color().setRGB(1, 1 - warmth * 0.24, 1 - warmth * 0.48);

  const baseSunIntensity =
    preset === 'evening'
      ? 1.15
      : preset === 'studio'
        ? 1.75
        : (0.85 + Math.sin(t * Math.PI) * 1.35) * 1.3;

  return { dir, sunColor, baseSunIntensity, warmth };
}

/** Crea un WebGLRenderer WebGL2 sicuro evitando switch GPU ANGLE */
function createSafeWebGLRenderer(): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  const contextAttrs: WebGLContextAttributes = {
    alpha: false,
    antialias: false, // Super-sampling Halton 16x-64x nativo
    depth: true,
    stencil: false,
    preserveDrawingBuffer: false,
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
    preserveDrawingBuffer: false,
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

/** Genera una Environment Map HDR architettonica (PMREM) 100% procedurale per riflessi fotografici */
function createArchitecturalEnvironment(
  renderer: THREE.WebGLRenderer,
  preset: RenderStylePreset
): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const isEvening = preset === 'evening';
  const isStudio = preset === 'studio';

  envScene.background = new THREE.Color(
    isEvening ? '#151e30' : isStudio ? '#e9eef4' : '#cfe2f5'
  );

  const addPanel = (
    color: string,
    intensity: number,
    pos: [number, number, number],
    rot: [number, number, number],
    scale: [number, number]
  ) => {
    const col = new THREE.Color(color).multiplyScalar(intensity);
    const mat = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(scale[0], scale[1]), mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    envScene.add(mesh);
  };

  // Cupola zenitale soffusa
  addPanel(
    isEvening ? '#4b6496' : isStudio ? '#ffffff' : '#f2f7ff',
    isEvening ? 0.85 : isStudio ? 2.6 : 2.1,
    [0, 14, 0],
    [Math.PI / 2, 0, 0],
    [28, 28]
  );
  // Disco / pannello solare caldo per highlight speculari naturali su metalli e vetri
  addPanel(
    isEvening ? '#ff9d57' : '#fff5e0',
    isEvening ? 3.8 : isStudio ? 2.4 : 4.2,
    [13, isEvening ? 4.5 : 10, 11],
    [0, -Math.PI / 4, 0],
    [6.5, 6.5]
  );
  // Finestra cielo laterale fredda
  addPanel(
    isEvening ? '#5b7290' : '#d2e8ff',
    isEvening ? 0.9 : 1.75,
    [-14, 5, 9],
    [0, Math.PI / 3, 0],
    [16, 8]
  );
  // Rimbalzo parete calda opposta
  addPanel(
    isEvening ? '#ffbe78' : '#f5eadb',
    isEvening ? 1.45 : 1.15,
    [9, 3.5, -13],
    [0, -Math.PI / 5, 0],
    [16, 7]
  );
  // Rimbalzo pavimento morbido
  addPanel('#cfc3b2', isEvening ? 0.35 : 0.65, [0, -7, 0], [-Math.PI / 2, 0, 0], [26, 26]);

  const envRT = pmrem.fromScene(envScene, 0.035);

  envScene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  });
  pmrem.dispose();
  return envRT;
}

/** Cupola cielo sfumata di sfondo (ignorata dal GTAO grazie a ShaderMaterial + depthWrite=false) */
function createSkyBackdropDome(
  preset: RenderStylePreset,
  sunDir: THREE.Vector3
): { mesh: THREE.Mesh; dispose: () => void } {
  const isEvening = preset === 'evening';
  const isStudio = preset === 'studio';
  const isSketch = preset === 'sketch';

  const topCol = new THREE.Color(
    isEvening ? '#0f172a' : isStudio ? '#e2e8f0' : isSketch ? '#f5efe4' : '#7cb5e8'
  );
  const horizonCol = new THREE.Color(
    isEvening ? '#d97b48' : isStudio ? '#f8fafc' : isSketch ? '#fbf8f2' : '#eef4fa'
  );
  const groundCol = new THREE.Color(
    isEvening ? '#1e2533' : isStudio ? '#d8dee6' : isSketch ? '#eae2d3' : '#d8d2c6'
  );

  const geo = new THREE.SphereGeometry(95, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: topCol },
      horizonColor: { value: horizonCol },
      groundColor: { value: groundCol },
      sunDir: { value: sunDir.clone() },
      sunGlow: { value: isStudio || isSketch ? 0.0 : isEvening ? 0.65 : 0.35 },
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
      uniform float sunGlow;
      varying vec3 vWorldDir;
      void main() {
        vec3 d = normalize(vWorldDir);
        float h = d.y;
        vec3 col = h >= 0.0
          ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.58))
          : mix(horizonColor, groundColor, clamp(-h * 3.0, 0.0, 1.0));
        if (sunGlow > 0.001) {
          float sunDot = max(0.0, dot(d, normalize(sunDir)));
          col += vec3(1.0, 0.9, 0.72) * pow(sunDot, 24.0) * sunGlow;
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
 * Clona fedelmente tutta la scena 3D corrente con materiali PBR di qualità fotografica
 * (preservando map, bumpMap, roughnessMap, clearcoat, vetri fisici e geometrie esatte).
 */
function buildPhotographicStudioScene(
  sourceGroup: THREE.Group,
  preset: RenderStylePreset
): {
  scene: THREE.Scene;
  sceneRadius: number;
  sceneCenter: THREE.Vector3;
  disposables: Array<{ dispose: () => void }>;
} {
  const studioScene = new THREE.Scene();
  const disposables: Array<{ dispose: () => void }> = [];
  const texCache = new Map<THREE.Texture, THREE.Texture>();
  const isEvening = preset === 'evening';

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
    // Salta tracce fantasma muri abbattuti
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

    let mat: THREE.Material;
    if (isGlass) {
      mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#d8eef9'),
        transparent: true,
        opacity: 0.26,
        roughness: 0.04,
        metalness: 0.05,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        ior: 1.5,
        reflectivity: 0.96,
        envMapIntensity: 1.85,
        depthWrite: false,
      });
    } else {
      const clonedMap = isGroundPlane
        ? null
        : cloneTextureForRenderer(std.map, texCache, disposables);
      const clonedBump = isGroundPlane
        ? null
        : cloneTextureForRenderer(std.bumpMap, texCache, disposables);
      const clonedRough = isGroundPlane
        ? null
        : cloneTextureForRenderer(std.roughnessMap, texCache, disposables);
      const clonedNormal = isGroundPlane
        ? null
        : cloneTextureForRenderer(std.normalMap, texCache, disposables);

      const baseCol = isGroundPlane
        ? new THREE.Color(isEvening ? '#242e3f' : preset === 'studio' ? '#e4e8ee' : '#dcd6cb')
        : std.color
          ? std.color.clone()
          : new THREE.Color('#e2e8f0');

      mat = new THREE.MeshPhysicalMaterial({
        color: baseCol,
        map: clonedMap,
        bumpMap: clonedBump,
        bumpScale: std.bumpScale ?? 0.008,
        roughnessMap: clonedRough,
        normalMap: clonedNormal,
        roughness: isGroundPlane ? 0.94 : clonedRough ? 1.0 : std.roughness ?? 0.65,
        metalness: std.metalness ?? 0.02,
        clearcoat: std.clearcoat ?? 0,
        clearcoatRoughness: std.clearcoatRoughness ?? 0.08,
        envMapIntensity: isGroundPlane ? 0.45 : std.envMapIntensity ?? 1.0,
        emissive: std.emissive ? std.emissive.clone() : new THREE.Color('#000000'),
        emissiveIntensity: std.emissiveIntensity ?? 0,
      });
    }
    disposables.push(mat);

    mesh.matrixWorld.decompose(worldPos, worldQuat, worldScale);
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
    sceneRadius = Math.max(4.0, Math.hypot(size.x, size.z) * 0.55);
  }

  return { scene: studioScene, sceneRadius, sceneCenter, disposables };
}

/** Shader per media progressiva HDR in virgola mobile (accumulo SSAA + ombre d'area soffici) */
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

/** Shader che fonde l'AO ad alta definizione nel buffer HDR lineare prima del Bloom e di ACES */
function createAoCompositeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    uniforms: {
      tBeauty: { value: null as THREE.Texture | null },
      tAo: { value: null as THREE.Texture | null },
      aoStrength: { value: 0.9 },
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
        // Curva morbida sull'AO per ombre profonde ma naturali negli spigoli
        float shapedAo = pow(clamp(ao, 0.0, 1.0), 1.0 + aoStrength * 0.45);
        float factor = mix(1.0, shapedAo, clamp(aoStrength, 0.0, 1.35));
        gl_FragColor = vec4(beauty.rgb * factor, 1.0);
      }
    `,
  });
}

export const PathTracerRenderModal: React.FC<PathTracerRenderModalProps> = ({
  sourceGroup,
  sourceCamera,
  onClose,
  onSendToAiPhoto,
}) => {
  const { project, selectedRoomId3D, showToast } = useProjectStore();
  const preset: RenderStylePreset = project.renderSettings.renderPreset ?? 'realistic';
  const presetFx = getPostProcessPresetConfig(preset);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const renderPostProcessRef = useRef<(() => void) | null>(null);

  const [quality, setQuality] = useState<QualityPreset>('high');
  const [hasStarted, setHasStarted] = useState(false);
  const [aoStrength, setAoStrength] = useState(0.95);
  const [bloomStrength, setBloomStrength] = useState(
    Number(Math.max(0.16, presetFx.bloomStrength).toFixed(2))
  );
  const [grainStrength, setGrainStrength] = useState(0.02);
  const [exposure, setExposure] = useState(1.08);
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

  // Aggiorna AO, Bloom, Grana e Luminosità ISTANTANEAMENTE sul risultato accumulato
  useEffect(() => {
    const r = rendererRef.current;
    if (r) {
      r.toneMappingExposure = exposure;
    }
    renderPostProcessRef.current?.();
  }, [aoStrength, bloomStrength, grainStrength, exposure]);

  // Effetto principale: costruisce la scena Studio, calcola GTAO HD e accumula 16x/32x/64x frame HDR
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
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = exposureRef.current;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.objectFit = 'contain';
        renderer.domElement.style.display = 'block';

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

        // 1. Clona fedelmente la scena 3D con texture PBR e materiali fisici
        const built = buildPhotographicStudioScene(sourceGroup, preset);
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

        const sunInfo = computeSunParams(project.renderSettings.timeOfDay, preset);

        // 2. Environment Map HDR (PMREM) + Cupola cielo sfumata
        const envRT = createArchitecturalEnvironment(renderer, preset);
        studioScene.environment = envRT.texture;
        cleanupList.push(() => envRT.dispose());

        const skyDome = createSkyBackdropDome(preset, sunInfo.dir);
        studioScene.add(skyDome.mesh);
        cleanupList.push(() => skyDome.dispose());

        // 3. Illuminazione Studio Multi-Sorgente con Ombre d'Area Soft
        const isEvening = preset === 'evening';
        const isStudio = preset === 'studio';
        const shadowHalf = Math.min(20, Math.max(5.5, built.sceneRadius * 1.12));

        // Emisferica bilanciata (cielo + rimbalzo caldo dal pavimento)
        const hemi = new THREE.HemisphereLight(
          isEvening ? '#8fb8f0' : isStudio ? '#ffffff' : '#f2f7ff',
          isEvening ? '#524135' : '#c9b7a0',
          isEvening ? 0.42 : isStudio ? 0.92 : 0.68
        );
        studioScene.add(hemi);

        // Sole direzionale principale con ombre 2048px (jitterato sul disco solare per penombre fisiche)
        const sunDist = Math.max(18, built.sceneRadius * 2.4);
        const sunLight = new THREE.DirectionalLight(
          sunInfo.sunColor,
          sunInfo.baseSunIntensity * sunStrengthRef.current
        );
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.set(2048, 2048);
        sunLight.shadow.camera.near = 1;
        sunLight.shadow.camera.far = sunDist * 2.4;
        sunLight.shadow.camera.left = -shadowHalf;
        sunLight.shadow.camera.right = shadowHalf;
        sunLight.shadow.camera.top = shadowHalf;
        sunLight.shadow.camera.bottom = -shadowHalf;
        sunLight.shadow.bias = -0.0002;
        sunLight.shadow.normalBias = 0.022;
        sunLight.shadow.radius = 3.0;
        sunLight.target.position.copy(built.sceneCenter);
        studioScene.add(sunLight);
        studioScene.add(sunLight.target);

        // Luce Sky-Fill opposta con ombre morbide 1024px (simula luce diffusa cielo / GI negli angoli in ombra)
        const skyFillBaseDir = new THREE.Vector3(
          -sunInfo.dir.x * 0.85,
          Math.max(0.65, sunInfo.dir.y + 0.35),
          -sunInfo.dir.z * 0.85
        ).normalize();
        const skyFillLight = new THREE.DirectionalLight(
          isEvening ? '#7da6de' : '#dceaff',
          isEvening ? 0.32 : isStudio ? 0.58 : 0.48
        );
        skyFillLight.castShadow = true;
        skyFillLight.shadow.mapSize.set(1024, 1024);
        skyFillLight.shadow.camera.near = 1;
        skyFillLight.shadow.camera.far = sunDist * 2.4;
        skyFillLight.shadow.camera.left = -shadowHalf;
        skyFillLight.shadow.camera.right = shadowHalf;
        skyFillLight.shadow.camera.top = shadowHalf;
        skyFillLight.shadow.camera.bottom = -shadowHalf;
        skyFillLight.shadow.bias = -0.0003;
        skyFillLight.shadow.normalBias = 0.03;
        skyFillLight.shadow.radius = 4.0;
        skyFillLight.target.position.copy(built.sceneCenter);
        studioScene.add(skyFillLight);
        studioScene.add(skyFillLight.target);

        // Luci calde interne automatiche al centro delle stanze (fondamentali in Prima Persona e Serale!)
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
          const ptIntensity = isEvening ? 3.8 : showRoof ? 1.85 : isStudio ? 0.55 : 0.85;

          targetRooms.forEach((rm, idx) => {
            const pLight = new THREE.PointLight(
              isEvening ? '#ffcf87' : '#fff2dc',
              ptIntensity,
              Math.max(5, Math.hypot(rm.bounds.width, rm.bounds.height) * 1.15),
              1.8
            );
            pLight.position.set(
              rm.bounds.centerX - cx,
              Math.max(2.15, wallH - 0.25),
              rm.bounds.centerY - cz
            );
            // Attiva ombre morbide sui primi 2 lampadari principali in serale/prima persona
            if ((isEvening || showRoof) && idx < 2) {
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
                emissive: new THREE.Color('#ffe4b3'),
                emissiveIntensity: isEvening ? 3.2 : 1.8,
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

        // 5. Calcola GTAO ad Alta Definizione una sola volta sulla geometria pulita (zero jitter)
        const gtaoPass = new ArchitecturalGTAOPass(
          studioScene,
          renderCam,
          outW,
          outH,
          outW
        );
        gtaoPass.output = ArchitecturalGTAOPass.OUTPUT.Off;
        gtaoPass.updateGtaoMaterial({
          radius: 0.54,
          distanceExponent: 1.55,
          thickness: 0.92,
          distanceFallOff: 0.9,
          scale: 1.2,
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

        const dummyRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
        cleanupList.push(() => dummyRT.dispose());
        gtaoPass.render(renderer, dummyRT, dummyRT, 0, false);

        // 6. Buffer HDR di accumulo + Pipeline Post-Processing Fotografico
        const frameRT = new THREE.WebGLRenderTarget(outW, outH, { type: THREE.HalfFloatType });
        const accumA = new THREE.WebGLRenderTarget(outW, outH, { type: THREE.HalfFloatType });
        const accumB = new THREE.WebGLRenderTarget(outW, outH, { type: THREE.HalfFloatType });
        const postHdrRT = new THREE.WebGLRenderTarget(outW, outH, { type: THREE.HalfFloatType });
        const tonemappedRT = new THREE.WebGLRenderTarget(outW, outH, { type: THREE.HalfFloatType });
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
          presetFx.bloomRadius,
          presetFx.bloomThreshold
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

        /** Applica AO + HDR Bloom + ACES Filmic + Grana/Nitidezza sul buffer accumulato (istantaneo!) */
        const renderPostProcess = () => {
          if (!renderer || currentSample === 0) return;
          const prevTone = renderer.toneMapping;

          // Step A: Applica GTAO in spazio lineare HDR
          renderer.toneMapping = THREE.NoToneMapping;
          aoCompMat.uniforms.tBeauty.value = readAccum.texture;
          aoCompMat.uniforms.tAo.value = gtaoPass.gtaoMap;
          aoCompMat.uniforms.aoStrength.value = aoStrengthRef.current;
          renderer.setRenderTarget(postHdrRT);
          aoCompQuad.render(renderer);

          // Step B: HDR UnrealBloom sugli highlight naturali
          if (bloomStrengthRef.current > 0.005) {
            bloomPass.strength = bloomStrengthRef.current;
            bloomPass.threshold = isEvening ? 0.76 : preset === 'studio' ? 0.98 : 0.92;
            bloomPass.radius = isEvening ? 0.64 : 0.55;
            bloomPass.renderToScreen = false;
            bloomPass.render(renderer, postHdrRT, postHdrRT, 0, false);
          }

          // Step C: ACES Filmic Tone Mapping + Esposizione + sRGB
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = exposureRef.current;
          outputPass.renderToScreen = false;
          outputPass.render(renderer, tonemappedRT, postHdrRT, 0, false);

          // Step D: Finitura fotografica (Micro-nitidezza, Vignettatura morbida, Grana pellicola) -> schermo
          finishMat.uniforms.tDiffuse.value = tonemappedRT.texture;
          finishMat.uniforms.grainIntensity.value = grainStrengthRef.current;
          finishMat.uniforms.vignetteIntensity.value = isEvening ? 0.2 : isStudio ? 0.08 : 0.14;
          finishMat.uniforms.clarity.value = 0.16;
          finishMat.uniforms.contrast.value = isEvening ? 1.05 : 1.04;
          finishMat.uniforms.saturation.value = isEvening ? 1.06 : 1.04;
          renderer.setRenderTarget(null);
          finishQuad.render(renderer);

          renderer.toneMapping = prevTone;
        };

        renderPostProcessRef.current = renderPostProcess;

        // Base ortonormale per jitterare il sole e la luce sky-fill in un cono fisicamente morbido
        const makeTangentBasis = (dir: THREE.Vector3) => {
          const upRef = Math.abs(dir.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          const u = new THREE.Vector3().crossVectors(upRef, dir).normalize();
          const v = new THREE.Vector3().crossVectors(dir, u).normalize();
          return { u, v };
        };
        const sunBasis = makeTangentBasis(sunInfo.dir);
        const fillBasis = makeTangentBasis(skyFillBaseDir);
        const tmpDir = new THREE.Vector3();

        setIsInitializing(false);

        const renderStep = () => {
          if (cancelled || !renderer) return;
          if (currentSample >= qCfg.samples) return;
          rafId = window.requestAnimationFrame(renderStep);
          if (isPausedRef.current) return;

          try {
            // Elabora fino a 2 campioni per frame così il render completa in 1-4 secondi restando fluido
            const batchSize = qCfg.samples >= 64 ? 2 : 1;
            for (let b = 0; b < batchSize && currentSample < qCfg.samples; b++) {
              const sIdx = currentSample;

              // 1. Sub-pixel Halton camera jitter (true SSAA)
              const jx = (halton(sIdx + 1, 2) - 0.5) / outW;
              const jy = (halton(sIdx + 1, 3) - 0.5) / outH;
              renderCam.projectionMatrix.copy(baseProjectionMatrix);
              renderCam.projectionMatrix.elements[8] += jx * 2.0;
              renderCam.projectionMatrix.elements[9] += jy * 2.0;

              // 2. Jitter disco solare (~5° penombra fisica)
              const [du, dv] = vogelDisk(sIdx, qCfg.samples);
              const sunSpread = isStudio ? 0.14 : 0.095;
              tmpDir
                .copy(sunInfo.dir)
                .addScaledVector(sunBasis.u, du * sunSpread)
                .addScaledVector(sunBasis.v, dv * sunSpread)
                .normalize();
              sunLight.position.copy(built.sceneCenter).addScaledVector(tmpDir, sunDist);

              // 3. Jitter luce cielo secondaria (cono ampio per ombre diffuse ultra-morbide)
              const [fu, fv] = vogelDisk((sIdx * 7 + 3) % qCfg.samples, qCfg.samples);
              tmpDir
                .copy(skyFillBaseDir)
                .addScaledVector(fillBasis.u, fu * 0.28)
                .addScaledVector(fillBasis.v, fv * 0.28)
                .normalize();
              skyFillLight.position.copy(built.sceneCenter).addScaledVector(tmpDir, sunDist);

              // 4. Render frame lineare HDR
              renderer.toneMapping = THREE.NoToneMapping;
              renderer.setRenderTarget(frameRT);
              renderer.render(studioScene, renderCam);

              // 5. Media progressiva in ping-pong (zero rumore, zero puntini)
              accumMat.uniforms.tPrev.value = readAccum.texture;
              accumMat.uniforms.tCurr.value = frameRT.texture;
              accumMat.uniforms.weight.value = 1.0 / (sIdx + 1);
              renderer.setRenderTarget(writeAccum);
              accumQuad.render(renderer);

              // Scambia ping-pong
              const tmp = readAccum;
              readAccum = writeAccum;
              writeAccum = tmp;

              currentSample += 1;
            }

            // Mostra anteprima aggiornata con AO + Bloom + Grana
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
    quality,
    sunStrength,
    sourceGroup,
    sourceCamera,
    preset,
    project.renderSettings.timeOfDay,
    project.renderSettings.interiorLights,
    project.renderSettings.cameraMode,
    project.walls,
    project.furniture,
    selectedRoomId3D,
    presetFx.bloomRadius,
    presetFx.bloomThreshold,
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
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-xs">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Render Fotografico HD (Studio Multi-Campione)
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                  Zero Puntini • AO + Bloom + Grana
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Super-sampling sub-pixel SSAA, ombre d’area morbide, GTAO architettonico, HDR Bloom e grana fotografica regolabili live.
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

        {/* Controlli Qualità + Post-FX Istantanei (AO / Bloom / Grana / Sole / Luminosità) */}
        <div className="px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500 mr-1">Qualità:</span>
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

          <div className="flex flex-wrap items-center gap-3.5">
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
                max={0.06}
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
                min={0.5}
                max={1.8}
                step={0.1}
                value={sunStrength}
                onChange={(e) => setSunStrength(Number(e.target.value))}
                className="w-16 accent-amber-500"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
              <span>Luce:</span>
              <input
                type="range"
                min={0.75}
                max={1.45}
                step={0.05}
                value={exposure}
                onChange={(e) => setExposure(Number(e.target.value))}
                className="w-16 accent-emerald-600"
              />
              <span className="font-mono text-[10px] w-7">{exposure.toFixed(2)}</span>
            </label>
          </div>
        </div>

        {/* Viewport Render Studio HD */}
        <div className="flex-1 min-h-[380px] bg-slate-950 relative flex items-center justify-center overflow-hidden p-3">
          <div
            ref={canvasHostRef}
            className="w-full h-full min-h-[380px] max-h-[65vh] flex items-center justify-center"
          />

          {!hasStarted && (
            <div className="absolute inset-0 bg-slate-950/92 flex items-center justify-center p-6">
              <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 text-center space-y-5 shadow-2xl">
                <div className="space-y-1.5">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center mx-auto shadow-md">
                    <Camera className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-white">
                    Scegli la risoluzione del Render Fotografico
                  </h3>
                  <p className="text-xs text-slate-400">
                    Motore Studio progressivo <strong>senza puntini</strong>: ombre d’area morbide,{' '}
                    <strong>GTAO</strong> negli angoli, <strong>Bloom HDR</strong> e{' '}
                    <strong>grana fotografica</strong> regolabili live.
                  </p>
                </div>

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
                          {opt.samples}× SSAA • {opt.maxWidth}px
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
                  Avvia Render Fotografico ({QUALITY_CONFIG[quality].label})
                </button>
              </div>
            </div>
          )}

          {hasStarted && isInitializing && !errorMsg && (
            <div className="absolute inset-0 bg-slate-950/75 flex flex-col items-center justify-center gap-2.5 text-white text-xs">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
              <span className="font-semibold">
                Preparazione luci Studio, riflessi HDR e Ambient Occlusion (GTAO)...
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

          {hasStarted && !isInitializing && !errorMsg && (
            <div className="absolute bottom-4 left-4 right-4 max-w-md mx-auto bg-slate-900/88 backdrop-blur border border-slate-700/80 rounded-xl px-3.5 py-2 text-white text-[11px] shadow-lg space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-1.5">
                  {isDone ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  ) : isPaused ? (
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                  ) : (
                    <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                  )}
                  {isDone
                    ? 'Render Fotografico completato! Regola AO / Bloom / Grana live.'
                    : isPaused
                      ? 'In pausa'
                      : 'Accumulo ombre morbide, SSAA e Post-FX...'}
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
                title="Opzionale: usa questo render HD come base ultra-fedele per la Foto AI"
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

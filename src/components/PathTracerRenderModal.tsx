/**
 * Modale "Render Fotografico HD (Ray-Tracing 100% Locale & Online)":
 * - Usa `three-gpu-pathtracer` su GPU WebGL (zero server, zero API key, funziona anche su GitHub Pages)
 * - Illuminazione architettonica calibrata: DirectionalLight solare fisico (MIS senza rumore) +
 *   cupola cielo soffusa per vera Global Illumination multi-rimbalzo + luci interne calde in modalità serale
 * - Filtro GPU Denoise edge-preserving (`DenoiseMaterial`) attivo di default per superfici lisce
 *   e spigoli nitidi senza grana puntinata
 * - Clona le texture in sicurezza per il contesto WebGL dedicato (parquet, piastrelle, legno, marmo nitidi)
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
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

type QualityPreset = 'fast' | 'high' | 'ultra';

const QUALITY_SAMPLES: Record<QualityPreset, { label: string; samples: number; scale: number }> = {
  fast: { label: 'Veloce (40)', samples: 40, scale: 0.85 },
  high: { label: 'Alta Qualità (100)', samples: 100, scale: 1.0 },
  ultra: { label: 'Ultra HD (220)', samples: 220, scale: 1.0 },
};

interface PathTracerRenderModalProps {
  sourceGroup: THREE.Group;
  sourceCamera: THREE.Camera;
  onClose: () => void;
  onSendToAiPhoto?: (dataUrl: string) => void;
}

/** Calcola la direzione normalizzata del sole dall'ora del giorno (coerente con Scene3D) */
function computeSunDirection(hour: number): THREE.Vector3 {
  const t = Math.max(0, Math.min(1, (hour - 6) / 14));
  const elevation = Math.sin(t * Math.PI) * 1.05 + 0.28;
  const azimuth = (t - 0.5) * Math.PI * 1.25;
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  ).normalize();
}

/** Clona una texture in modo pulito per un contesto WebGL dedicato preservando repeat e colorSpace */
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

/**
 * Clona il gruppo 3D corrente normalizzando tutte le geometrie (non-indexed, position + normal + uv),
 * clonando le texture nel nuovo contesto WebGL e convertendo i vetri in vetro trasmissivo fisico.
 */
function buildCleanPathTracingScene(
  sourceGroup: THREE.Group,
  isEvening: boolean
): { scene: THREE.Scene; disposables: Array<{ dispose: () => void }> } {
  const ptScene = new THREE.Scene();
  const disposables: Array<{ dispose: () => void }> = [];
  const texCache = new Map<THREE.Texture, THREE.Texture>();

  sourceGroup.updateMatrixWorld(true);
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();

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
    const posAttr = srcGeo.getAttribute('position');
    if (!posAttr || posAttr.count === 0) return;

    const geo = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
    if (!geo.getAttribute('normal')) {
      geo.computeVertexNormals();
    }
    const vertCount = geo.getAttribute('position').count;
    if (!geo.getAttribute('uv')) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertCount * 2), 2));
    }
    for (const key of Object.keys(geo.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') {
        geo.deleteAttribute(key);
      }
    }
    geo.clearGroups();
    disposables.push(geo);

    const std = rawMat as THREE.MeshStandardMaterial & {
      clearcoat?: number;
      clearcoatRoughness?: number;
    };

    let ptMat: THREE.MeshPhysicalMaterial;
    if (std.transparent && std.opacity < 0.65) {
      // Vetro finestre trasmissivo pulito: lascia entrare i raggi solari diretti sul pavimento
      ptMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#f4fbff'),
        roughness: 0.03,
        metalness: 0.0,
        transmission: 0.94,
        ior: 1.48,
        thickness: 0.015,
      });
    } else {
      const col = std.color ? std.color.clone() : new THREE.Color('#e2e8f0');
      const isGroundPlane =
        srcGeo.type === 'PlaneGeometry' && posAttr.count <= 6 && mesh.position.y < -0.05;
      const clonedMap = isGroundPlane
        ? null
        : cloneTextureForRenderer(std.map, texCache, disposables);
      const clonedRoughMap = isGroundPlane
        ? null
        : cloneTextureForRenderer(std.roughnessMap, texCache, disposables);

      ptMat = new THREE.MeshPhysicalMaterial({
        color: isGroundPlane ? new THREE.Color(isEvening ? '#273244' : '#e6e0d6') : col,
        map: clonedMap,
        roughnessMap: clonedRoughMap,
        roughness: isGroundPlane
          ? 0.94
          : clonedRoughMap
            ? 0.92
            : Math.max(0.08, Math.min(0.95, std.roughness ?? 0.65)),
        metalness: Math.max(0, Math.min(0.96, std.metalness ?? 0.02)),
        clearcoat: std.clearcoat ?? 0,
        clearcoatRoughness: std.clearcoatRoughness ?? 0.1,
        emissive: std.emissive ? std.emissive.clone() : new THREE.Color('#000000'),
        emissiveIntensity: std.emissiveIntensity ?? 0,
        side: THREE.DoubleSide,
      });
    }
    disposables.push(ptMat);

    mesh.matrixWorld.decompose(worldPos, worldQuat, worldScale);
    const clonedMesh = new THREE.Mesh(geo, ptMat);
    clonedMesh.position.copy(worldPos);
    clonedMesh.quaternion.copy(worldQuat);
    clonedMesh.scale.copy(worldScale);
    ptScene.add(clonedMesh);
  });

  return { scene: ptScene, disposables };
}

export const PathTracerRenderModal: React.FC<PathTracerRenderModalProps> = ({
  sourceGroup,
  sourceCamera,
  onClose,
  onSendToAiPhoto,
}) => {
  const { project, showToast } = useProjectStore();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathTracerRef = useRef<any>(null);

  const [quality, setQuality] = useState<QualityPreset>('high');
  const [hasStarted, setHasStarted] = useState(false);
  const [enableDenoise, setEnableDenoise] = useState(true);
  const [exposure, setExposure] = useState(1.0);
  const [sunStrength, setSunStrength] = useState(1.1);
  const [isPaused, setIsPaused] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [samples, setSamples] = useState(0);
  const [targetSamples, setTargetSamples] = useState(QUALITY_SAMPLES.high.samples);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [runToken, setRunToken] = useState(0);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const targetSamplesRef = useRef(targetSamples);
  targetSamplesRef.current = targetSamples;
  const exposureRef = useRef(exposure);
  exposureRef.current = exposure;
  const enableDenoiseRef = useRef(enableDenoise);
  enableDenoiseRef.current = enableDenoise;

  useEffect(() => {
    setTargetSamples(QUALITY_SAMPLES[quality].samples);
  }, [quality]);

  // Ridisegna subito al cambio di esposizione o toggle Denoise senza perdere i campioni accumulati
  useEffect(() => {
    const r = rendererRef.current;
    const pt = pathTracerRef.current;
    if (!r) return;
    r.toneMappingExposure = exposure;
    if (pt && pt.samples >= 1) {
      const prevPause = pt.pausePathTracing;
      pt.pausePathTracing = true;
      try {
        pt.renderSample();
      } catch {
        // ignore
      }
      pt.pausePathTracing = prevPause;
    }
  }, [exposure, enableDenoise]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host || !hasStarted) return;

    let cancelled = false;
    let rafId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pathTracer: any = null;
    let envTex: THREE.Texture | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let denoiseQuad: any = null;
    let disposables: Array<{ dispose: () => void }> = [];

    const start = async () => {
      setIsInitializing(true);
      setErrorMsg(null);
      setSamples(0);

      try {
        const [{ WebGLPathTracer, ProceduralEquirectTexture, DenoiseMaterial }, { FullScreenQuad }] =
          await Promise.all([
            import('three-gpu-pathtracer'),
            import('three/examples/jsm/postprocessing/Pass.js'),
          ]);
        if (cancelled) return;

        const rect = host.getBoundingClientRect();
        const aspect = Math.max(1.2, Math.min(2.1, rect.width / Math.max(1, rect.height)));
        const outW = Math.min(1440, Math.max(900, Math.round(rect.width * Math.min(1.5, window.devicePixelRatio || 1))));
        const outH = Math.round(outW / aspect);

        renderer = new THREE.WebGLRenderer({
          antialias: true,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(1);
        renderer.setSize(outW, outH, false);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = exposureRef.current;
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.objectFit = 'contain';
        renderer.domElement.style.display = 'block';

        // Fix compatibilità Three.js 0.169 + three-gpu-pathtracer 0.0.23 (passa sempre una camera)
        const fallbackCam = new THREE.PerspectiveCamera();
        const activeRenderer = renderer;
        activeRenderer.compileAsync = (sceneArg, camArg, targetScene) => {
          try {
            activeRenderer.compile(sceneArg, camArg ?? fallbackCam, targetScene);
          } catch {
            // Compilazione al primo draw call
          }
          return Promise.resolve(sceneArg);
        };

        host.innerHTML = '';
        host.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const isEvening = project.renderSettings.renderPreset === 'evening';
        const effectiveHour = isEvening ? 19.2 : project.renderSettings.timeOfDay;
        const sunDir = computeSunDirection(effectiveHour);

        // 1. Scena pulita con geometrie normalizzate, texture clonate e vetri trasmissivi
        const built = buildCleanPathTracingScene(sourceGroup, isEvening);
        const ptScene = built.scene;
        disposables = built.disposables;

        // 2. Luce solare direzionale fisica esplicita (MIS: ombre pulite e contrasto caldo senza rumore!)
        const sunLight = new THREE.DirectionalLight(
          isEvening ? '#ffaa66' : '#fff3de',
          (isEvening ? 2.2 : 3.4) * sunStrength
        );
        sunLight.position.copy(sunDir).multiplyScalar(25);
        ptScene.add(sunLight);

        // 3. Cupola cielo calibrata (luce morbida diffusa per GI & ombre negli angoli, senza bruciare i contrasti)
        const env = new ProceduralEquirectTexture(256, 128);
        const topSky = new THREE.Color(isEvening ? '#18243d' : '#c4dff7');
        const horizonSky = new THREE.Color(isEvening ? '#d47c4a' : '#f7f1e6');
        const groundBounce = new THREE.Color(isEvening ? '#1c1816' : '#c9c0b3');
        const dirVec = new THREE.Vector3();

        env.generationCallback = (polar, _uv, _coord, color) => {
          dirVec.setFromSpherical(polar).normalize();
          const up = dirVec.y;
          if (up >= 0) {
            const k = Math.pow(up, 0.55);
            color.copy(horizonSky).lerp(topSky, k);
            color.multiplyScalar(isEvening ? 0.35 : 0.72);
          } else {
            const k = Math.min(1, Math.abs(up) * 2.2);
            color.copy(horizonSky).lerp(groundBounce, k);
            color.multiplyScalar(isEvening ? 0.2 : 0.42);
          }
        };
        env.update();
        envTex = env;

        ptScene.environment = env;
        ptScene.background = env;
        ptScene.backgroundBlurriness = 0.04;
        ptScene.environmentIntensity = isEvening ? 0.55 : 0.82;

        // 4. Clona la camera attiva
        const ptCamera = sourceCamera.clone() as THREE.PerspectiveCamera;
        if (ptCamera.isPerspectiveCamera) {
          ptCamera.aspect = outW / outH;
          ptCamera.updateProjectionMatrix();
        }
        ptCamera.updateMatrixWorld(true);

        // 5. Filtro GPU Smart Denoiser edge-preserving (pulisce la grana mantenendo nitidi gli spigoli!)
        const denoiseMat = new DenoiseMaterial({
          sigma: 3.4,
          kSigma: 1.0,
          threshold: 0.075,
        });
        denoiseQuad = new FullScreenQuad(denoiseMat);
        disposables.push(denoiseMat);

        pathTracer = new WebGLPathTracer(renderer);
        pathTracer.bounces = 5;
        pathTracer.transmissiveBounces = 4;
        pathTracer.filterGlossyFactor = 0.65;
        pathTracer.multipleImportanceSampling = true;
        pathTracer.renderScale = QUALITY_SAMPLES[quality].scale;
        pathTracer.tiles.set(quality === 'fast' ? 1 : 2, quality === 'fast' ? 1 : 2);
        pathTracer.renderDelay = 0;
        pathTracer.minSamples = 1;
        pathTracer.fadeDuration = 0;
        pathTracer.rasterizeScene = false;
        pathTracer.textureSize.set(1024, 1024);

        // Passaggio finale su schermo con GPU Denoise attivo (o diretto se disattivato dall'utente)
        pathTracer.renderToCanvasCallback = (
          target: THREE.WebGLRenderTarget,
          r: THREE.WebGLRenderer,
          quad: { render: (ren: THREE.WebGLRenderer) => void }
        ) => {
          const prevAutoClear = r.autoClear;
          r.autoClear = false;
          if (enableDenoiseRef.current && denoiseQuad && pathTracer.samples >= 3) {
            // Riduce leggermente il raggio denoise man mano che i campioni aumentano per preservare micro-dettagli
            const s = pathTracer.samples;
            denoiseMat.sigma = s > 100 ? 2.1 : s > 40 ? 2.8 : 3.6;
            denoiseMat.threshold = s > 100 ? 0.045 : s > 40 ? 0.065 : 0.085;
            denoiseMat.map = target.texture;
            denoiseQuad.render(r);
          } else {
            quad.render(r);
          }
          r.autoClear = prevAutoClear;
        };

        pathTracerRef.current = pathTracer;
        pathTracer.setScene(ptScene, ptCamera);
        if (cancelled) return;

        setIsInitializing(false);

        const renderLoop = () => {
          if (cancelled) return;
          rafId = window.requestAnimationFrame(renderLoop);

          if (isPausedRef.current) return;
          if (pathTracer.samples >= targetSamplesRef.current) return;

          try {
            pathTracer.renderSample();
            const cur = Number(pathTracer.samples.toFixed(1));
            setSamples((prev) => (prev !== cur ? cur : prev));
          } catch (loopErr) {
            cancelled = true;
            setErrorMsg(
              loopErr instanceof Error
                ? loopErr.message
                : 'Errore WebGL durante il calcolo Ray-Tracing.'
            );
          }
        };

        rafId = window.requestAnimationFrame(renderLoop);
      } catch (err) {
        if (!cancelled) {
          setIsInitializing(false);
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Impossibile avviare il motore Ray-Tracing WebGL su questa scheda grafica.'
          );
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      try {
        denoiseQuad?.dispose();
      } catch {
        // ignore
      }
      try {
        pathTracer?.dispose();
      } catch {
        // ignore
      }
      envTex?.dispose();
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          // ignore
        }
      }
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
      rendererRef.current = null;
      pathTracerRef.current = null;
    };
  }, [
    hasStarted,
    sourceGroup,
    sourceCamera,
    project.renderSettings.timeOfDay,
    project.renderSettings.renderPreset,
    quality,
    sunStrength,
    runToken,
  ]);

  const progressPct = Math.min(100, Math.round((samples / Math.max(1, targetSamples)) * 100));
  const isDone = !isInitializing && samples >= targetSamples;

  const handleDownloadPng = () => {
    const r = rendererRef.current;
    if (!r) return;
    const dataUrl = r.domElement.toDataURL('image/png', 1.0);
    const a = document.createElement('a');
    const safeName = (project.name || 'piantestudio').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = dataUrl;
    a.download = `${safeName}-render-fotografico-hd.png`;
    a.click();
    showToast('Render Fotografico HD (Ray-Tracing) salvato in PNG!', 'success');
  };

  const handleSendToAi = () => {
    const r = rendererRef.current;
    if (!r || !onSendToAiPhoto) return;
    const dataUrl = r.domElement.toDataURL('image/png', 1.0);
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
                Render Fotografico HD (Ray-Tracing + Denoise GPU)
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                  Zero AI • Fedeltà 100%
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Luce solare fisica direzionale, rimbalzi reali (GI), ombre morbide negli angoli e filtro Denoise GPU per superfici pulite.
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

        {/* Controlli Qualità / Esposizione / Luce Solare / Denoise */}
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
                {QUALITY_SAMPLES[q].label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={enableDenoise}
                onChange={(e) => setEnableDenoise(e.target.checked)}
                className="accent-emerald-600 rounded"
              />
              <span>Denoise GPU</span>
            </label>
            <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>Sole:</span>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={sunStrength}
                onChange={(e) => setSunStrength(Number(e.target.value))}
                className="w-20 accent-amber-500"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <span>Luminosità:</span>
              <input
                type="range"
                min={0.7}
                max={1.45}
                step={0.05}
                value={exposure}
                onChange={(e) => setExposure(Number(e.target.value))}
                className="w-20 accent-emerald-600"
              />
              <span className="font-mono text-[10px] w-7">{exposure.toFixed(2)}</span>
            </label>
          </div>
        </div>

        {/* Viewport Ray-Tracing progressivo (oppure schermata scelta qualità prima di avviare) */}
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
                    Scegli la qualità prima di avviare
                  </h3>
                  <p className="text-xs text-slate-400">
                    Include luce solare direzionale fisica, Global Illumination e filtro <strong>Denoise GPU</strong> anti-grana.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-left">
                  {(
                    [
                      {
                        id: 'fast' as QualityPreset,
                        title: 'Veloce',
                        sub: '40 campioni',
                        time: '~4–8 sec • prova rapida',
                      },
                      {
                        id: 'high' as QualityPreset,
                        title: 'Alta Qualità',
                        sub: '100 campioni',
                        time: '~12–22 sec • consigliato',
                      },
                      {
                        id: 'ultra' as QualityPreset,
                        title: 'Ultra HD',
                        sub: '220 campioni',
                        time: '~30–55 sec • massima resa',
                      },
                    ]
                  ).map((opt) => {
                    const active = quality === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setQuality(opt.id)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          active
                            ? 'bg-emerald-600/20 border-emerald-400 ring-1 ring-emerald-400 text-white'
                            : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <div className="text-xs font-bold">{opt.title}</div>
                        <div className="text-[11px] font-mono text-emerald-300 mt-0.5">
                          {opt.sub}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1 leading-tight">
                          {opt.time}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsPaused(false);
                    setTargetSamples(QUALITY_SAMPLES[quality].samples);
                    setHasStarted(true);
                  }}
                  className="w-full py-3 px-5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg cursor-pointer transition-all"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Avvia Render Fotografico ({QUALITY_SAMPLES[quality].label})
                </button>
              </div>
            </div>
          )}

          {hasStarted && isInitializing && !errorMsg && (
            <div className="absolute inset-0 bg-slate-950/75 flex flex-col items-center justify-center gap-2.5 text-white text-xs">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
              <span className="font-semibold">
                Preparazione scena e accelerazione Ray-Tracing (BVH) sulla GPU...
              </span>
            </div>
          )}

          {errorMsg && (
            <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-red-300 max-w-md mx-auto">
              <p className="font-semibold text-sm text-white">
                Impossibile eseguire il Ray-Tracing WebGL
              </p>
              <p>{errorMsg}</p>
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
                    ? 'Render Fotografico completato!'
                    : isPaused
                      ? 'In pausa'
                      : 'Calcolo luce, ombre e Denoise GPU...'}
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
                  setTargetSamples(QUALITY_SAMPLES[quality].samples);
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
                    setTargetSamples((t) => t + 60);
                  }}
                  disabled={isInitializing}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  title="Accumula altri 60 campioni per ombre ancora più morbide"
                >
                  +60 campioni
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPaused(false);
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
                disabled={!hasStarted || isInitializing || samples < 2}
                onClick={handleSendToAi}
                className="px-3.5 py-2 rounded-xl border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 text-violet-700 dark:text-violet-300 disabled:opacity-40 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                title="Opzionale: usa questo render Ray-Tracing come base ultra-fedele per la Foto AI"
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

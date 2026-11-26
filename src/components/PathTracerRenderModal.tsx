/**
 * Modale "Render Fotografico HD (Ray-Tracing 100% Locale & Online)":
 * - Usa `three-gpu-pathtracer` su GPU WebGL (zero server, zero API key, funziona anche su GitHub Pages)
 * - Calcola vera Global Illumination multi-rimbalzo, ombre morbidissime negli angoli (AO fisica)
 *   e riflessi realistici su acciaio, vetri e parquet mantenendo fedeltà geometrica al 100%
 * - Caricato dinamicamente on-demand per non appesantire l'avvio dell'app
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
  fast: { label: 'Veloce (36)', samples: 36, scale: 0.85 },
  high: { label: 'Alta Qualità (90)', samples: 90, scale: 1.0 },
  ultra: { label: 'Ultra HD (200)', samples: 200, scale: 1.0 },
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
  const elevation = Math.sin(t * Math.PI) * 1.1 + 0.22;
  const azimuth = (t - 0.5) * Math.PI * 1.25;
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  ).normalize();
}

/**
 * Clona il gruppo 3D corrente normalizzando tutte le geometrie (non-indexed, position + normal + uv)
 * e convertendo i vetri trasparenti in vetro fisico trasmissivo per il Path Tracer.
 */
function buildCleanPathTracingScene(
  sourceGroup: THREE.Group,
  isEvening: boolean
): { scene: THREE.Scene; disposables: Array<{ dispose: () => void }> } {
  const ptScene = new THREE.Scene();
  const disposables: Array<{ dispose: () => void }> = [];

  sourceGroup.updateMatrixWorld(true);
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();

  sourceGroup.traverse((obj) => {
    if (obj.name === '__piantestudio_stylized_outline__') return;
    if (!obj.visible) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    // Ignora eventuali muri demoliti fantasma traslucidi
    const rawMat = (mesh.userData.__origMaterial ?? mesh.material) as
      | THREE.Material
      | THREE.Material[];
    if (Array.isArray(rawMat)) return;
    if (rawMat.transparent && rawMat.opacity < 0.22) return;

    // Normalizza la geometria in un formato uniforme garantito per StaticGeometryGenerator
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
    // Tieni solo position, normal, uv per evitare mismatch tra CSG, RoundedBox e GLB
    for (const key of Object.keys(geo.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') {
        geo.deleteAttribute(key);
      }
    }
    geo.clearGroups();
    disposables.push(geo);

    // Converte il materiale in MeshPhysicalMaterial ottimizzato per Path Tracing fisico
    const std = rawMat as THREE.MeshStandardMaterial & {
      clearcoat?: number;
      clearcoatRoughness?: number;
    };

    let ptMat: THREE.MeshPhysicalMaterial;
    if (std.transparent && std.opacity < 0.65) {
      // Vetro finestre / box doccia: trasmissivo così la luce solare attraversa realmente le finestre!
      ptMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#eef7fc'),
        roughness: 0.04,
        metalness: 0.0,
        transmission: 0.92,
        ior: 1.48,
        thickness: 0.02,
      });
    } else {
      const col = std.color ? std.color.clone() : new THREE.Color('#e2e8f0');
      // Per il piano terreno esterno rendilo pulito e luminoso come uno studio architettonico caldo
      const isGroundPlane = srcGeo.type === 'PlaneGeometry' && posAttr.count <= 6 && mesh.position.y < -0.05;
      ptMat = new THREE.MeshPhysicalMaterial({
        color: isGroundPlane ? new THREE.Color(isEvening ? '#334155' : '#e7e2d9') : col,
        map: std.map ?? null,
        roughnessMap: std.roughnessMap ?? null,
        bumpMap: std.bumpMap ?? null,
        bumpScale: std.bumpScale ?? 0.006,
        roughness: isGroundPlane ? 0.92 : Math.max(0.06, Math.min(1, std.roughness ?? 0.7)),
        metalness: Math.max(0, Math.min(1, std.metalness ?? 0.02)),
        clearcoat: std.clearcoat ?? 0,
        clearcoatRoughness: std.clearcoatRoughness ?? 0.12,
        emissive: std.emissive ? std.emissive.clone() : new THREE.Color('#000000'),
        emissiveIntensity: std.emissiveIntensity ?? 0,
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

  const [quality, setQuality] = useState<QualityPreset>('high');
  const [exposure, setExposure] = useState(1.12);
  const [sunStrength, setSunStrength] = useState(1.0);
  const [isPaused, setIsPaused] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
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

  useEffect(() => {
    setTargetSamples(QUALITY_SAMPLES[quality].samples);
  }, [quality]);

  // Aggiorna esposizione live senza riavviare i campioni
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.toneMappingExposure = exposure;
    }
  }, [exposure]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    let cancelled = false;
    let rafId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pathTracer: any = null;
    let envTex: THREE.Texture | null = null;
    let disposables: Array<{ dispose: () => void }> = [];

    const start = async () => {
      setIsInitializing(true);
      setErrorMsg(null);
      setSamples(0);

      try {
        const { WebGLPathTracer, ProceduralEquirectTexture } = await import(
          'three-gpu-pathtracer'
        );
        if (cancelled) return;

        const rect = host.getBoundingClientRect();
        const outW = Math.min(1280, Math.max(640, Math.round(rect.width)));
        const outH = Math.min(760, Math.max(400, Math.round(rect.height)));

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

        host.innerHTML = '';
        host.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const isEvening = project.renderSettings.renderPreset === 'evening';
        const effectiveHour = isEvening ? 19.2 : project.renderSettings.timeOfDay;
        const sunDir = computeSunDirection(effectiveHour);

        // Costruisce la scena pulita per il Path Tracer (geometrie normalizzate + vetri trasmissivi)
        const built = buildCleanPathTracingScene(sourceGroup, isEvening);
        const ptScene = built.scene;
        disposables = built.disposables;

        // Genera ambiente HDRI fisico procedurale con cupola cielo morbida + disco solare caldo
        // (questo produce rimbalzi reali GI, luce diagonale dalle finestre e ombre morbidissime!)
        const env = new ProceduralEquirectTexture(512, 256);
        const topSky = new THREE.Color(isEvening ? '#1e2c4a' : '#cfe5ff');
        const horizonSky = new THREE.Color(isEvening ? '#ff9e64' : '#fffaf0');
        const groundBounce = new THREE.Color(isEvening ? '#2e2724' : '#ded6ca');
        const sunTint = new THREE.Color(isEvening ? '#ff8b47' : '#fff4de');
        const dirVec = new THREE.Vector3();
        const sunBoost = sunStrength;

        env.generationCallback = (polar, _uv, _coord, color) => {
          // Converte coordinate sferiche in direzione 3D
          dirVec.setFromSpherical(polar).normalize();
          const up = dirVec.y;

          if (up >= 0) {
            const k = Math.pow(up, 0.55);
            color.copy(horizonSky).lerp(topSky, k);
            color.multiplyScalar(isEvening ? 0.55 : 1.38);
          } else {
            const k = Math.min(1, Math.abs(up) * 2.5);
            color.copy(horizonSky).lerp(groundBounce, k);
            color.multiplyScalar(isEvening ? 0.35 : 0.72);
          }

          // Disco solare fisico + corona atmosferica calda
          const sunDot = Math.max(0, dirVec.dot(sunDir));
          if (sunDot > 0.992) {
            const s = (isEvening ? 12 : 22) * sunBoost;
            color.r += sunTint.r * s;
            color.g += sunTint.g * s;
            color.b += sunTint.b * s;
          } else if (sunDot > 0.85) {
            const halo = Math.pow(sunDot, 28) * (isEvening ? 2.4 : 3.2) * sunBoost;
            color.r += sunTint.r * halo;
            color.g += sunTint.g * halo;
            color.b += sunTint.b * halo;
          }
        };
        env.update();
        envTex = env;

        ptScene.environment = env;
        ptScene.background = env;
        ptScene.backgroundBlurriness = 0.08;
        ptScene.environmentIntensity = isEvening ? 0.95 : 1.15;

        // Clona esattamente la camera attiva nello Step 3 adattando l'aspect al canvas HD
        const ptCamera = sourceCamera.clone() as THREE.PerspectiveCamera;
        if (ptCamera.isPerspectiveCamera) {
          ptCamera.aspect = outW / outH;
          ptCamera.updateProjectionMatrix();
        }
        ptCamera.updateMatrixWorld(true);

        pathTracer = new WebGLPathTracer(renderer);
        pathTracer.bounces = 5;
        pathTracer.transmissiveBounces = 4;
        pathTracer.filterGlossyFactor = 0.5;
        pathTracer.multipleImportanceSampling = true;
        pathTracer.renderScale = QUALITY_SAMPLES[quality].scale;
        pathTracer.tiles.set(2, 2);
        pathTracer.minSamples = 1;
        pathTracer.fadeDuration = 0;
        pathTracer.rasterizeScene = false;

        pathTracer.setScene(ptScene, ptCamera);
        if (cancelled) return;

        setIsInitializing(false);

        const renderLoop = () => {
          if (cancelled) return;
          rafId = window.requestAnimationFrame(renderLoop);

          if (isPausedRef.current) return;
          if (pathTracer.samples >= targetSamplesRef.current) return;

          pathTracer.renderSample();
          const cur = Math.floor(pathTracer.samples);
          setSamples((prev) => (prev !== cur ? cur : prev));
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
    };
  }, [sourceGroup, sourceCamera, project.renderSettings.timeOfDay, project.renderSettings.renderPreset, quality, sunStrength, runToken]);

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
                Render Fotografico HD (Ray-Tracing 100% Locale)
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                  Zero AI • Fedeltà 100%
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Calcola rimbalzi reali della luce, ombre morbide negli angoli e riflessi fisici direttamente sulla tua GPU. Più campioni accumula, più l’immagine diventa pulita.
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

        {/* Controlli Qualità / Esposizione / Luce Solare */}
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
            <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>Sole:</span>
              <input
                type="range"
                min={0.4}
                max={1.8}
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
                min={0.75}
                max={1.55}
                step={0.05}
                value={exposure}
                onChange={(e) => setExposure(Number(e.target.value))}
                className="w-20 accent-emerald-600"
              />
              <span className="font-mono text-[10px] w-7">{exposure.toFixed(2)}</span>
            </label>
          </div>
        </div>

        {/* Viewport Ray-Tracing progressivo */}
        <div className="flex-1 min-h-[360px] bg-slate-950 relative flex items-center justify-center overflow-hidden p-3">
          <div
            ref={canvasHostRef}
            className="w-full h-full min-h-[360px] max-h-[64vh] flex items-center justify-center"
          />

          {isInitializing && !errorMsg && (
            <div className="absolute inset-0 bg-slate-950/75 flex flex-col items-center justify-center gap-2.5 text-white text-xs">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
              <span className="font-semibold">
                Costruzione accelerazione Ray-Tracing (BVH) sulla GPU...
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

          {/* Barra di avanzamento campioni in sovrimpressione in basso */}
          {!isInitializing && !errorMsg && (
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
                      : 'Rifinitura luce e ombre in corso...'}
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
                setTargetSamples((t) => t + 50);
              }}
              disabled={isInitializing}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              title="Accumula altri 50 campioni per ombre ancora più lisce e pulite"
            >
              +50 campioni
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
          </div>

          <div className="flex items-center gap-2">
            {onSendToAiPhoto && (
              <button
                type="button"
                disabled={isInitializing || samples < 2}
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
              disabled={isInitializing || samples < 1}
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

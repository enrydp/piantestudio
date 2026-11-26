/**
 * Modale interattiva completa per preparare la piantina:
 * - Rotazione 90°, rotazione fine (±45°) e Allinea muro (2 click)
 * - Correzione prospettica a TRAPEZIO (slider Trapezio V / H + modalità 4 Angoli liberi stile scanner)
 * - Ritaglio interattivo con 8 maniglie per rimuovere bordi, timbri e scritte esterne
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Compass,
  Crop,
  Maximize,
  Move,
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { FloorplanImage } from '../types/project';
import {
  quadFromKeystoneSliders,
  warpPerspectiveCanvas,
  type QuadPoint,
} from '../utils/perspective';

export interface CropApplyMeta {
  scaleRatio: number;
  preserveCalibration: boolean;
}

interface FloorplanCropModalProps {
  floorplan: FloorplanImage;
  onCancel: () => void;
  onApply: (cropped: FloorplanImage, meta?: CropApplyMeta) => void;
}

interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragMode =
  | null
  | 'move'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'draw';

const MIN_SIZE = 0.02;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Errore caricamento immagine'));
    img.src = src;
  });
}

/** Renderizza l'immagine sorgente ruotata di `angleDeg` su un canvas con sfondo bianco */
function renderRotatedCanvas(
  img: HTMLImageElement,
  angleDeg: number,
  maxDim?: number
): HTMLCanvasElement {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const fullW = Math.ceil(srcW * cos + srcH * sin);
  const fullH = Math.ceil(srcW * sin + srcH * cos);

  const scale = maxDim ? Math.min(1, maxDim / Math.max(fullW, fullH)) : 1;
  const outW = Math.max(32, Math.round(fullW * scale));
  const outH = Math.max(32, Math.round(fullH * scale));

  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(rad);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -srcW / 2, -srcH / 2);
  return c;
}

/** Applica rotazione + eventuale trapezio V/H a partire dall'immagine sorgente */
function buildTransformedCanvas(
  img: HTMLImageElement,
  angleDeg: number,
  keystoneV: number,
  keystoneH: number,
  maxDim?: number
): HTMLCanvasElement {
  const rotated = renderRotatedCanvas(img, angleDeg, maxDim);
  if (Math.abs(keystoneV) < 0.002 && Math.abs(keystoneH) < 0.002) {
    return rotated;
  }
  const quad = quadFromKeystoneSliders(keystoneV, keystoneH);
  return warpPerspectiveCanvas(rotated, quad, rotated.width, rotated.height);
}

const DEFAULT_QUAD: [QuadPoint, QuadPoint, QuadPoint, QuadPoint] = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
];

export const FloorplanCropModal: React.FC<FloorplanCropModalProps> = ({
  floorplan,
  onCancel,
  onApply,
}) => {
  const [sourceImgEl, setSourceImgEl] = useState<HTMLImageElement | null>(null);
  const [totalAngleDeg, setTotalAngleDeg] = useState(0);
  // Trapezio verticale e orizzontale (-0.35..+0.35 -> mostrati come -35%..+35%)
  const [keystoneV, setKeystoneV] = useState(0);
  const [keystoneH, setKeystoneH] = useState(0);

  const [previewUrl, setPreviewUrl] = useState(floorplan.dataUrl);
  const [transformedDims, setTransformedDims] = useState({
    w: floorplan.widthPx,
    h: floorplan.heightPx,
  });

  const [crop, setCrop] = useState<NormRect>({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 });
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [zoom, setZoom] = useState(1);
  const [isApplying, setIsApplying] = useState(false);

  // Modalità "Allinea muro (2 click)"
  const [alignMode, setAlignMode] = useState(false);
  const [alignPtA, setAlignPtA] = useState<QuadPoint | null>(null);
  const [alignHover, setAlignHover] = useState<QuadPoint | null>(null);

  // Modalità "4 Angoli (Trapezio libero)"
  const [quadMode, setQuadMode] = useState(false);
  const [quad, setQuad] = useState<[QuadPoint, QuadPoint, QuadPoint, QuadPoint]>(DEFAULT_QUAD);
  const [draggingQuadIdx, setDraggingQuadIdx] = useState<number | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    startCrop: NormRect;
  } | null>(null);

  // Carica immagine sorgente originale (usiamo sempre l'originale così le regolazioni non degradano mai la qualità)
  useEffect(() => {
    let active = true;
    loadImg(floorplan.dataUrl)
      .then((el) => {
        if (active) setSourceImgEl(el);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [floorplan.dataUrl]);

  // Aggiorna l'anteprima ruotata + trapezio in tempo reale (debounced leggerissimo 45ms per slider fluidi)
  useEffect(() => {
    if (!sourceImgEl) return;
    const isIdentity =
      Math.abs(totalAngleDeg % 360) < 0.01 &&
      Math.abs(keystoneV) < 0.002 &&
      Math.abs(keystoneH) < 0.002;

    if (isIdentity) {
      setPreviewUrl(floorplan.dataUrl);
      setTransformedDims({ w: sourceImgEl.naturalWidth, h: sourceImgEl.naturalHeight });
      return;
    }

    const timer = window.setTimeout(() => {
      const rad = (totalAngleDeg * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const fullW = Math.ceil(sourceImgEl.naturalWidth * cos + sourceImgEl.naturalHeight * sin);
      const fullH = Math.ceil(sourceImgEl.naturalWidth * sin + sourceImgEl.naturalHeight * cos);
      setTransformedDims({ w: fullW, h: fullH });

      const previewMax = Math.abs(keystoneV) > 0.002 || Math.abs(keystoneH) > 0.002 ? 720 : 1050;
      const c = buildTransformedCanvas(
        sourceImgEl,
        totalAngleDeg,
        keystoneV,
        keystoneH,
        previewMax
      );
      setPreviewUrl(c.toDataURL('image/png'));
    }, 45);

    return () => window.clearTimeout(timer);
  }, [sourceImgEl, totalAngleDeg, keystoneV, keystoneH, floorplan.dataUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (alignMode) {
          setAlignMode(false);
          setAlignPtA(null);
        } else if (quadMode) {
          setQuadMode(false);
        } else {
          onCancel();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, alignMode, quadMode]);

  const getNormPointer = (clientX: number, clientY: number): QuadPoint => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  };

  // Trascinamento dei 4 angoli prospettici
  useEffect(() => {
    if (draggingQuadIdx === null) return;
    const onMove = (e: PointerEvent) => {
      const pt = getNormPointer(e.clientX, e.clientY);
      setQuad((prev) => {
        const next = [...prev] as [QuadPoint, QuadPoint, QuadPoint, QuadPoint];
        next[draggingQuadIdx] = pt;
        return next;
      });
    };
    const onUp = () => setDraggingQuadIdx(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingQuadIdx]);

  const handleStagePointerDown = (e: React.PointerEvent) => {
    if (quadMode) return;

    if (alignMode) {
      e.stopPropagation();
      e.preventDefault();
      const pt = getNormPointer(e.clientX, e.clientY);
      if (!alignPtA) {
        setAlignPtA(pt);
        setAlignHover(pt);
      } else {
        const dxPx = (pt.x - alignPtA.x) * transformedDims.w;
        const dyPx = (pt.y - alignPtA.y) * transformedDims.h;
        if (Math.hypot(dxPx, dyPx) > 8) {
          const lineAngleDeg = (Math.atan2(dyPx, dxPx) * 180) / Math.PI;
          const nearestOrtho = Math.round(lineAngleDeg / 90) * 90;
          const correction = nearestOrtho - lineAngleDeg;
          setTotalAngleDeg((prev) => Number((prev + correction).toFixed(2)));
        }
        setAlignPtA(null);
        setAlignHover(null);
        setAlignMode(false);
      }
      return;
    }

    beginDrag('draw', e);
  };

  const beginDrag = (mode: DragMode, e: React.PointerEvent) => {
    if (alignMode || quadMode) return;
    e.stopPropagation();
    e.preventDefault();
    const pt = getNormPointer(e.clientX, e.clientY);
    setDragMode(mode);
    dragStartRef.current = {
      pointerX: pt.x,
      pointerY: pt.y,
      startCrop: { ...crop },
    };
    if (mode === 'draw') {
      setCrop({ x: pt.x, y: pt.y, w: 0.01, h: 0.01 });
    }
  };

  useEffect(() => {
    if (!dragMode) return;

    const handleMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const pt = getNormPointer(e.clientX, e.clientY);
      const dx = pt.x - start.pointerX;
      const dy = pt.y - start.pointerY;
      const sc = start.startCrop;

      if (dragMode === 'draw') {
        const x0 = Math.min(start.pointerX, pt.x);
        const y0 = Math.min(start.pointerY, pt.y);
        const x1 = Math.max(start.pointerX, pt.x);
        const y1 = Math.max(start.pointerY, pt.y);
        setCrop({
          x: x0,
          y: y0,
          w: Math.min(1 - x0, Math.max(MIN_SIZE, x1 - x0)),
          h: Math.min(1 - y0, Math.max(MIN_SIZE, y1 - y0)),
        });
        return;
      }

      if (dragMode === 'move') {
        const nx = clamp(sc.x + dx, 0, 1 - sc.w);
        const ny = clamp(sc.y + dy, 0, 1 - sc.h);
        setCrop({ ...sc, x: nx, y: ny });
        return;
      }

      let left = sc.x;
      let top = sc.y;
      let right = sc.x + sc.w;
      let bottom = sc.y + sc.h;

      if (dragMode.includes('w')) left = clamp(sc.x + dx, 0, right - MIN_SIZE);
      if (dragMode.includes('e')) right = clamp(sc.x + sc.w + dx, left + MIN_SIZE, 1);
      if (dragMode.includes('n')) top = clamp(sc.y + dy, 0, bottom - MIN_SIZE);
      if (dragMode.includes('s')) bottom = clamp(sc.y + sc.h + dy, top + MIN_SIZE, 1);

      setCrop({ x: left, y: top, w: right - left, h: bottom - top });
    };

    const handleUp = () => {
      setDragMode(null);
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragMode]);

  const handleApplyFinal = async () => {
    if (isApplying) return;
    setIsApplying(true);
    try {
      const imgEl = sourceImgEl ?? (await loadImg(floorplan.dataUrl));

      // 1. Mantieni alta risoluzione PRIMA del ritaglio (fino a 4096 px) così anche 1 piano su un foglio multi-piano rimane nitido!
      const rad = (totalAngleDeg * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const rawFullW = Math.ceil(imgEl.naturalWidth * cos + imgEl.naturalHeight * sin);
      const rawFullH = Math.ceil(imgEl.naturalWidth * sin + imgEl.naturalHeight * cos);
      const preScale = Math.min(1, 4096 / Math.max(rawFullW, rawFullH));

      const fullTransformed = buildTransformedCanvas(
        imgEl,
        totalAngleDeg,
        keystoneV,
        keystoneH,
        4096
      );

      let finalCanvas: HTMLCanvasElement;
      let postScale = 1;
      const hasPerspectiveWarp =
        quadMode || Math.abs(keystoneV) >= 0.002 || Math.abs(keystoneH) >= 0.002;

      if (quadMode) {
        // 2A. Modalità 4 Angoli: rettifica il quadrilatero disegnato in un rettangolo dritto
        finalCanvas = warpPerspectiveCanvas(fullTransformed, quad);
      } else {
        // 2B. Modalità Ritaglio standard con clamping sicuro dentro i bordi del canvas
        const sx = clamp(Math.round(crop.x * fullTransformed.width), 0, fullTransformed.width - 16);
        const sy = clamp(Math.round(crop.y * fullTransformed.height), 0, fullTransformed.height - 16);
        const sw = clamp(
          Math.round(crop.w * fullTransformed.width),
          16,
          fullTransformed.width - sx
        );
        const sh = clamp(
          Math.round(crop.h * fullTransformed.height),
          16,
          fullTransformed.height - sy
        );

        const maxOut = 2200;
        postScale = Math.min(1, maxOut / Math.max(sw, sh));
        const outW = Math.max(32, Math.round(sw * postScale));
        const outH = Math.max(32, Math.round(sh * postScale));

        finalCanvas = document.createElement('canvas');
        finalCanvas.width = outW;
        finalCanvas.height = outH;
        const ctx = finalCanvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(fullTransformed, sx, sy, sw, sh, 0, 0, outW, outH);
      }

      const scaleRatio = preScale * postScale;

      onApply(
        {
          ...floorplan,
          dataUrl: finalCanvas.toDataURL('image/jpeg', 0.93),
          widthPx: finalCanvas.width,
          heightPx: finalCanvas.height,
        },
        {
          scaleRatio,
          preserveCalibration: !hasPerspectiveWarp,
        }
      );
    } finally {
      setIsApplying(false);
    }
  };

  const baseQuarter = Math.round(totalAngleDeg / 90) * 90;
  const fineOffset = Number((totalAngleDeg - baseQuarter).toFixed(1));

  const outW = quadMode
    ? Math.round(
        Math.max(
          Math.hypot((quad[1].x - quad[0].x) * transformedDims.w, (quad[1].y - quad[0].y) * transformedDims.h),
          Math.hypot((quad[2].x - quad[3].x) * transformedDims.w, (quad[2].y - quad[3].y) * transformedDims.h)
        )
      )
    : Math.round(crop.w * transformedDims.w);
  const outH = quadMode
    ? Math.round(
        Math.max(
          Math.hypot((quad[3].x - quad[0].x) * transformedDims.w, (quad[3].y - quad[0].y) * transformedDims.h),
          Math.hypot((quad[2].x - quad[1].x) * transformedDims.w, (quad[2].y - quad[1].y) * transformedDims.h)
        )
      )
    : Math.round(crop.h * transformedDims.h);

  const quadLabels = ['AS', 'AD', 'BD', 'BS'];

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 select-none"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-4xl max-h-[94vh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crop className="w-4 h-4 text-blue-600" />
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                Ritaglia, raddrizza e correggi trapezio
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Usa <strong>Trapezio V/H</strong> o <strong>4 Angoli</strong> per appiattire foto storte prese dal telefono, poi ritaglia attorno ai muri.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Chiudi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Barra strumenti: Rotazione + Trapezio V/H + 4 Angoli */}
        <div className="px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 space-y-2 text-xs">
          {/* Riga 1: Strumenti rapidi e Rotazione */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setQuadMode(false);
                setAlignMode((v) => !v);
                setAlignPtA(null);
                setAlignHover(null);
              }}
              className={`px-2.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                alignMode
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-amber-500'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              {alignMode
                ? alignPtA
                  ? 'Clicca 2° punto muro...'
                  : 'Clicca 1° punto muro...'
                : 'Allinea muro (2 click)'}
            </button>

            <button
              type="button"
              onClick={() => {
                setAlignMode(false);
                setAlignPtA(null);
                setQuadMode((v) => !v);
              }}
              className={`px-2.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                quadMode
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-500'
              }`}
              title="Trascina 4 maniglie sui 4 angoli della piantina per correggere prospettive forti"
            >
              <Maximize className="w-3.5 h-3.5" />
              {quadMode ? 'Modalità 4 Angoli attiva' : '4 Angoli (Trapezio)'}
            </button>

            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Ruota:</span>
              <button
                type="button"
                onClick={() => setTotalAngleDeg((a) => Number((a - 0.5).toFixed(1)))}
                className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[10px] font-mono cursor-pointer"
              >
                -0,5°
              </button>
              <input
                type="range"
                min={-45}
                max={45}
                step={0.2}
                value={fineOffset}
                onChange={(e) =>
                  setTotalAngleDeg(Number((baseQuarter + Number(e.target.value)).toFixed(1)))
                }
                className="flex-1 accent-blue-600"
              />
              <button
                type="button"
                onClick={() => setTotalAngleDeg((a) => Number((a + 0.5).toFixed(1)))}
                className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[10px] font-mono cursor-pointer"
              >
                +0,5°
              </button>
              <span className="text-[11px] font-mono font-semibold text-blue-600 dark:text-blue-400 w-12 text-right">
                {totalAngleDeg.toFixed(1)}°
              </span>
            </div>

            <button
              type="button"
              onClick={() => setTotalAngleDeg((a) => Number((a + 90).toFixed(1)))}
              className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              +90°
            </button>

            <div className="flex items-center gap-1 border-l border-slate-300 dark:border-slate-700 pl-2">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(1, Number((z - 0.35).toFixed(2))))}
                title="Riduci zoom"
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono w-9 text-center text-slate-600 dark:text-slate-300">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3.1, Number((z + 0.35).toFixed(2))))}
                title="Ingrandisci per ritagliare con precisione un singolo piano"
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Riga 2: Slider Trapezio Verticale e Orizzontale */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 w-20 shrink-0">
                Trapezio V:
              </span>
              <input
                type="range"
                min={-35}
                max={35}
                step={1}
                value={Math.round(keystoneV * 100)}
                onChange={(e) => setKeystoneV(Number(e.target.value) / 100)}
                className="flex-1 accent-indigo-600"
              />
              <span className="text-[11px] font-mono font-semibold text-indigo-600 dark:text-indigo-400 w-10 text-right">
                {Math.round(keystoneV * 100) > 0
                  ? `+${Math.round(keystoneV * 100)}%`
                  : `${Math.round(keystoneV * 100)}%`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 w-20 shrink-0">
                Trapezio H:
              </span>
              <input
                type="range"
                min={-35}
                max={35}
                step={1}
                value={Math.round(keystoneH * 100)}
                onChange={(e) => setKeystoneH(Number(e.target.value) / 100)}
                className="flex-1 accent-indigo-600"
              />
              <span className="text-[11px] font-mono font-semibold text-indigo-600 dark:text-indigo-400 w-10 text-right">
                {Math.round(keystoneH * 100) > 0
                  ? `+${Math.round(keystoneH * 100)}%`
                  : `${Math.round(keystoneH * 100)}%`}
              </span>
            </div>
          </div>
        </div>

        {/* Area interattiva immagine + griglia + ritaglio / 4 angoli */}
        <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-950 p-4 flex items-center justify-center overflow-auto">
          <div
            ref={stageRef}
            onPointerDown={handleStagePointerDown}
            onPointerMove={(e) => {
              if (alignMode && alignPtA) {
                setAlignHover(getNormPointer(e.clientX, e.clientY));
              }
            }}
            style={zoom > 1 ? { width: `${Math.round(zoom * 100)}%` } : undefined}
            className={`relative inline-block shadow-lg border border-slate-300 dark:border-slate-700 touch-none ${
              zoom > 1 ? 'max-w-none' : 'max-w-full max-h-[52vh]'
            } ${quadMode ? 'cursor-default' : 'cursor-crosshair'}`}
          >
            <img
              src={previewUrl}
              alt="Piantina da ritagliare e correggere"
              draggable={false}
              className={`block pointer-events-none ${
                zoom > 1 ? 'w-full h-auto' : 'max-w-full max-h-[52vh] w-auto h-auto'
              }`}
            />

            {/* Griglia blu di riferimento ortogonale */}
            <div
              className="absolute inset-0 pointer-events-none opacity-45"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(37,99,235,0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(37,99,235,0.45) 1px, transparent 1px)',
                backgroundSize: '40px 40px',
              }}
            />

            {/* Linea guida Allinea muro (2 click) */}
            {alignMode && alignPtA && alignHover && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <line
                  x1={alignPtA.x * 100}
                  y1={alignPtA.y * 100}
                  x2={alignHover.x * 100}
                  y2={alignHover.y * 100}
                  stroke="#f59e0b"
                  strokeWidth="0.7"
                  strokeDasharray="1.5 1"
                />
                <circle cx={alignPtA.x * 100} cy={alignPtA.y * 100} r="1.3" fill="#f59e0b" />
                <circle cx={alignHover.x * 100} cy={alignHover.y * 100} r="1.3" fill="#f59e0b" />
              </svg>
            )}

            {/* Overlay 4 Angoli (Trapezio libero stile scanner) */}
            {quadMode && (
              <>
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <polygon
                    points={quad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                    fill="rgba(79, 70, 229, 0.14)"
                    stroke="#4f46e5"
                    strokeWidth="0.7"
                  />
                </svg>
                {quad.map((pt, idx) => (
                  <div
                    key={idx}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setDraggingQuadIdx(idx);
                    }}
                    style={{
                      left: `${pt.x * 100}%`,
                      top: `${pt.y * 100}%`,
                    }}
                    title="Trascina sull'angolo della piantina"
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-indigo-600 text-white border-2 border-white shadow-md flex items-center justify-center text-[9px] font-bold cursor-move"
                  >
                    {quadLabels[idx]}
                  </div>
                ))}
              </>
            )}

            {/* Maschere e maniglie ritaglio standard */}
            {!alignMode && !quadMode && (
              <>
                <div
                  className="absolute inset-x-0 top-0 bg-slate-950/55 pointer-events-none"
                  style={{ height: `${crop.y * 100}%` }}
                />
                <div
                  className="absolute inset-x-0 bottom-0 bg-slate-950/55 pointer-events-none"
                  style={{ height: `${(1 - crop.y - crop.h) * 100}%` }}
                />
                <div
                  className="absolute left-0 bg-slate-950/55 pointer-events-none"
                  style={{
                    top: `${crop.y * 100}%`,
                    height: `${crop.h * 100}%`,
                    width: `${crop.x * 100}%`,
                  }}
                />
                <div
                  className="absolute right-0 bg-slate-950/55 pointer-events-none"
                  style={{
                    top: `${crop.y * 100}%`,
                    height: `${crop.h * 100}%`,
                    width: `${(1 - crop.x - crop.w) * 100}%`,
                  }}
                />

                {/* Riquadro ritaglio: trascinando dentro disegni un NUOVO riquadro (perfetto per scegliere 1 piano!),
                    mentre le 8 maniglie ridimensionano e la pillola centrale sposta il riquadro */}
                <div
                  className="absolute border-2 border-blue-500 shadow-[0_0_0_1px_rgba(255,255,255,0.85)] pointer-events-none"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`,
                    height: `${crop.h * 100}%`,
                  }}
                >
                  {/* Maniglia centrale per spostare il riquadro esistente */}
                  <div
                    onPointerDown={(e) => beginDrag('move', e)}
                    title="Trascina per spostare il riquadro; oppure clicca e trascina altrove per disegnare un nuovo riquadro su un singolo piano"
                    className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-1 rounded-full bg-blue-600/90 hover:bg-blue-700 text-white text-[10px] font-semibold shadow-md flex items-center gap-1 cursor-move"
                  >
                    <Move className="w-3 h-3" />
                    Sposta
                  </div>

                  {(
                    [
                      { mode: 'nw', cls: '-top-2 -left-2 cursor-nwse-resize' },
                      { mode: 'ne', cls: '-top-2 -right-2 cursor-nesw-resize' },
                      { mode: 'sw', cls: '-bottom-2 -left-2 cursor-nesw-resize' },
                      { mode: 'se', cls: '-bottom-2 -right-2 cursor-nwse-resize' },
                    ] as { mode: DragMode; cls: string }[]
                  ).map((h) => (
                    <div
                      key={h.mode}
                      onPointerDown={(e) => beginDrag(h.mode, e)}
                      className={`pointer-events-auto absolute w-4 h-4 rounded-full bg-white border-2 border-blue-600 shadow ${h.cls}`}
                    />
                  ))}

                  {(
                    [
                      { mode: 'n', cls: '-top-1.5 left-1/2 -translate-x-1/2 w-8 h-3 cursor-ns-resize' },
                      { mode: 's', cls: '-bottom-1.5 left-1/2 -translate-x-1/2 w-8 h-3 cursor-ns-resize' },
                      { mode: 'w', cls: '-left-1.5 top-1/2 -translate-y-1/2 w-3 h-8 cursor-ew-resize' },
                      { mode: 'e', cls: '-right-1.5 top-1/2 -translate-y-1/2 w-3 h-8 cursor-ew-resize' },
                    ] as { mode: DragMode; cls: string }[]
                  ).map((h) => (
                    <div
                      key={h.mode}
                      onPointerDown={(e) => beginDrag(h.mode, e)}
                      className={`pointer-events-auto absolute rounded-full bg-white border-2 border-blue-600 shadow ${h.cls}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer azioni */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTotalAngleDeg(0);
                setKeystoneV(0);
                setKeystoneH(0);
                setCrop({ x: 0, y: 0, w: 1, h: 1 });
                setQuad(DEFAULT_QUAD);
                setAlignMode(false);
                setAlignPtA(null);
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Ripristina tutto
            </button>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 ml-1">
              Output: {outW} × {outH} px
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={isApplying}
              onClick={() => void handleApplyFinal()}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              {isApplying
                ? 'Ritaglio in corso...'
                : quadMode
                  ? 'Raddrizza dai 4 angoli'
                  : 'Applica ritaglio'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Modale guidata e visuale di importazione CAD (.DWG / .DXF) nello Step 0:
 * - Passo 1 (Scala): pulsanti rapidi mm / cm / m con semaforo automatico (Verde = scala corretta, Giallo = misura anomala)
 * - Passo 2 (Modalità semplice): scelta chiara tra:
 *   • "Solo Piantina 1:1" (zero spunte da fare: importa lo sfondo già calibrato pronto da ricalcare)
 *   • "Piantina + Muri automatici" (clicca direttamente su un muro nel disegno o passa il mouse sui layer per vederli illuminati in arancione!)
 * - Passo 3 (Layer opzionali): evidenziazione istantanea in arancione al passaggio del mouse + pulsante "Solo muri" / "Tutti"
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Crop,
  Eye,
  EyeOff,
  FileImage,
  Layers,
  MousePointerClick,
  RotateCcw,
  Ruler,
  Wand2,
  X,
} from 'lucide-react';
import type { FloorplanImage, Wall } from '../types/project';
import {
  CAD_UNIT_TO_METERS,
  extractWallsFromCad,
  renderCadToFloorplanImage,
  type CadBounds,
  type CadUnit,
  type ParsedCadDocument,
} from '../utils/cadImport';
import { generateId } from '../store/useProjectStore';

interface CadImportModalProps {
  doc: ParsedCadDocument;
  defaultWallThickness: number;
  defaultWallHeight: number;
  onCancel: () => void;
  onImport: (result: {
    floorplan: FloorplanImage;
    pixelsPerMeter: number;
    walls: Wall[];
    unit: CadUnit;
  }) => void;
}

const QUICK_UNITS: { id: CadUnit; short: string; label: string }[] = [
  { id: 'mm', short: 'mm', label: 'Millimetri' },
  { id: 'cm', short: 'cm', label: 'Centimetri' },
  { id: 'm', short: 'm', label: 'Metri' },
];

export const CadImportModal: React.FC<CadImportModalProps> = ({
  doc,
  defaultWallThickness,
  defaultWallHeight,
  onCancel,
  onImport,
}) => {
  const [unit, setUnit] = useState<CadUnit>(doc.detectedUnit);
  const [includeTexts, setIncludeTexts] = useState(false);
  // Di default nascondi layer puramente di quote/testi/retini/cartigli così la pianta è subito pulita e leggibile
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(() => {
    const isClutterLayer = (name: string) =>
      /(quot|dim|test|text|nota|annot|legenda|cartigl|squadr|retino|hatch|trat|defpoints)/i.test(
        name
      );
    const clean = doc.layers
      .filter((l) => !isClutterLayer(l.name) && (l.segmentCount > 0 || l.arcCount > 0))
      .map((l) => l.name);
    return new Set(clean.length > 0 ? clean : doc.layers.map((l) => l.name));
  });
  const [wallLayers, setWallLayers] = useState<Set<string>>(
    () => new Set(doc.layers.filter((l) => l.suggestedAsWall).map((l) => l.name))
  );
  const [autoGenerateWalls, setAutoGenerateWalls] = useState(true);
  const [hoveredLayer, setHoveredLayer] = useState<string | null>(null);
  const [lastPickedHint, setLastPickedHint] = useState<string | null>(null);
  // Ritaglio vettoriale diretto di 1 singolo piano (per DWG con più piani sullo stesso foglio!)
  const [cropMode, setCropMode] = useState(false);
  const [cropBounds, setCropBounds] = useState<CadBounds | null>(null);
  const [cropDragStart, setCropDragStart] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const activeBounds = cropBounds ?? doc.bounds;
  const activeSpanW = Math.max(1e-3, activeBounds.maxX - activeBounds.minX);
  const activeSpanH = Math.max(1e-3, activeBounds.maxY - activeBounds.minY);
  const toM = CAD_UNIT_TO_METERS[unit];
  const widthM = activeSpanW * toM;
  const heightM = activeSpanH * toM;
  const maxDimM = Math.max(widthM, heightM);

  const svgPointToCad = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const res = pt.matrixTransform(ctm.inverse());
    // Nel viewBox la Y è invertita (-cadY)
    return { x: res.x, y: -res.y };
  };

  // Controllo intelligente scala (un edificio/appartamento sta di solito tra 3 m e 60 m)
  const scaleAdvice = useMemo(() => {
    if (maxDimM >= 2.5 && maxDimM <= 80) {
      return {
        status: 'ok' as const,
        text: `Dimensione realistica (${widthM.toFixed(1)} × ${heightM.toFixed(1)} m): scala corretta!`,
        suggestedUnit: null as CadUnit | null,
      };
    }
    // Trova l'unità che porta maxDimM più vicino all'intervallo 5..30 m
    const candidates: CadUnit[] = ['mm', 'cm', 'm'];
    const best = candidates.find((u) => {
      const d = Math.max(activeSpanW, activeSpanH) * CAD_UNIT_TO_METERS[u];
      return d >= 2.5 && d <= 80;
    });
    return {
      status: 'warn' as const,
      text:
        maxDimM > 80
          ? `Misura troppo grande (${widthM.toFixed(0)} × ${heightM.toFixed(0)} m): il file probabilmente usa ${best ? best.toUpperCase() : 'mm o cm'}.`
          : `Misura troppo piccola (${widthM.toFixed(2)} × ${heightM.toFixed(2)} m): prova a cambiare unità in ${best ? best.toUpperCase() : 'cm o m'}.`,
      suggestedUnit: best ?? null,
    };
  }, [maxDimM, widthM, heightM, activeSpanW, activeSpanH]);

  // Anteprima fluida fino a 3000 segmenti (dando priorità ai layer evidenziati / muri)
  const previewSegments = useMemo(() => {
    const filtered = doc.segments.filter((s) => visibleLayers.has(s.layer));
    if (filtered.length <= 3000) return filtered;
    const step = Math.ceil(filtered.length / 3000);
    return filtered.filter(
      (s, idx) =>
        idx % step === 0 || s.layer === hoveredLayer || wallLayers.has(s.layer)
    );
  }, [doc.segments, visibleLayers, hoveredLayer, wallLayers]);

  const previewArcs = useMemo(() => {
    const filtered = doc.arcs.filter((a) => visibleLayers.has(a.layer));
    return filtered.slice(0, 600);
  }, [doc.arcs, visibleLayers]);

  const estimatedWallCount = useMemo(() => {
    if (!autoGenerateWalls || wallLayers.size === 0) return 0;
    const rawW = Math.max(0.5, widthM);
    const rawH = Math.max(0.5, heightM);
    const padMeters = Math.max(0.4, Math.min(1.2, Math.max(rawW, rawH) * 0.04));
    return extractWallsFromCad(
      doc,
      unit,
      wallLayers,
      padMeters,
      defaultWallThickness,
      defaultWallHeight,
      generateId,
      cropBounds
    ).length;
  }, [
    autoGenerateWalls,
    wallLayers,
    doc,
    unit,
    widthM,
    heightM,
    defaultWallThickness,
    defaultWallHeight,
    cropBounds,
  ]);

  const toggleVisible = (name: string) => {
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleWallLayer = (name: string) => {
    setAutoGenerateWalls(true);
    setWallLayers((prev) => {
      const next = new Set(prev);
      const willSelect = !next.has(name);
      if (willSelect) {
        next.add(name);
        setLastPickedHint(`Layer "${name}" aggiunto ai Muri (blu)`);
      } else {
        next.delete(name);
        setLastPickedHint(`Layer "${name}" tolto dai Muri`);
      }
      return next;
    });
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  };

  const handleConfirmImport = () => {
    const rendered = renderCadToFloorplanImage(
      doc,
      unit,
      visibleLayers,
      wallLayers,
      includeTexts,
      cropBounds
    );
    const walls = autoGenerateWalls
      ? extractWallsFromCad(
          doc,
          unit,
          wallLayers,
          rendered.padMeters,
          defaultWallThickness,
          defaultWallHeight,
          generateId,
          cropBounds
        )
      : [];

    onImport({
      floorplan: rendered.floorplan,
      pixelsPerMeter: rendered.pixelsPerMeter,
      walls,
      unit,
    });
  };

  const padX = doc.bounds.width * 0.04;
  const padY = doc.bounds.height * 0.04;
  const vbW = Math.max(1, doc.bounds.width + padX * 2);
  const vbH = Math.max(1, doc.bounds.height + padY * 2);
  const strokeUnit = Math.max(vbW, vbH) * 0.0022;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-6xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Intestazione */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ruler className="w-4 h-4 text-blue-600" />
              Importa Piantina CAD ({doc.format.toUpperCase()}) — {doc.fileName}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Non serve capire tutti i layer: controlla solo che la misura in metri sia sensata, poi scegli se importare solo lo sfondo o anche i muri automatici.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo: Anteprima interattiva a sinistra + Guida semplice a destra */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Anteprima vettoriale interattiva (col-span-7) */}
          <div className="lg:col-span-7 bg-slate-100 dark:bg-slate-950 p-4 flex flex-col min-h-[280px]">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] mb-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setCropMode((v) => !v);
                    setCropDragStart(null);
                  }}
                  className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                    cropMode
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-500'
                  }`}
                  title="Se il DWG ha più piani sullo stesso foglio, trascina un riquadro intorno al singolo piano da importare"
                >
                  <Crop className="w-3.5 h-3.5" />
                  {cropMode ? 'Trascina sul piano da tenere...' : 'Ritaglia 1 piano (multi-piano)'}
                </button>
                {cropBounds && (
                  <button
                    type="button"
                    onClick={() => {
                      setCropBounds(null);
                      setCropMode(false);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-700 dark:text-slate-200 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Tutto il foglio
                  </button>
                )}
              </div>
              <span
                className={`font-mono font-semibold px-2 py-0.5 rounded-md ${
                  scaleAdvice.status === 'ok'
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                    : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                }`}
              >
                {cropBounds ? 'Piano ritagliato: ' : ''}
                {widthM.toFixed(2)} m × {heightM.toFixed(2)} m
              </span>
            </div>

            <div className="flex-1 min-h-0 rounded-xl bg-white border border-slate-200 dark:border-slate-800 overflow-hidden flex items-center justify-center relative">
              {/* Badge layer sotto il cursore o istruzione ritaglio */}
              {(cropMode || hoveredLayer || lastPickedHint) && (
                <div className="absolute top-2.5 left-2.5 z-10 px-2.5 py-1 rounded-lg bg-slate-900/90 text-white text-[11px] font-medium shadow-md pointer-events-none">
                  {cropMode ? (
                    <span className="text-emerald-300">
                      Trascina con il mouse un rettangolo intorno al piano che vuoi importare
                    </span>
                  ) : hoveredLayer ? (
                    <span>
                      Layer evidenziato in arancione: <strong className="text-amber-300">{hoveredLayer}</strong>
                    </span>
                  ) : (
                    <span>{lastPickedHint}</span>
                  )}
                </div>
              )}

              <svg
                ref={svgRef}
                viewBox={`${doc.bounds.minX - padX} ${-doc.bounds.maxY - padY} ${vbW} ${vbH}`}
                className={`w-full h-full max-h-[58vh] select-none ${
                  cropMode ? 'cursor-crosshair' : ''
                }`}
                preserveAspectRatio="xMidYMid meet"
                onPointerDown={(e) => {
                  if (!cropMode) return;
                  e.preventDefault();
                  const pt = svgPointToCad(e.clientX, e.clientY);
                  if (!pt) return;
                  setCropDragStart(pt);
                  setCropBounds({ minX: pt.x, maxX: pt.x, minY: pt.y, maxY: pt.y });
                }}
                onPointerMove={(e) => {
                  if (!cropMode || !cropDragStart) return;
                  const pt = svgPointToCad(e.clientX, e.clientY);
                  if (!pt) return;
                  setCropBounds({
                    minX: Math.min(cropDragStart.x, pt.x),
                    maxX: Math.max(cropDragStart.x, pt.x),
                    minY: Math.min(cropDragStart.y, pt.y),
                    maxY: Math.max(cropDragStart.y, pt.y),
                  });
                }}
                onPointerUp={() => {
                  if (!cropMode || !cropDragStart) return;
                  setCropDragStart(null);
                  setCropBounds((prev) => {
                    if (
                      !prev ||
                      prev.maxX - prev.minX < doc.bounds.width * 0.02 ||
                      prev.maxY - prev.minY < doc.bounds.height * 0.02
                    ) {
                      return null;
                    }
                    return prev;
                  });
                  setCropMode(false);
                }}
              >
                {/* Prima le linee normali (grigie), poi i muri (blu), infine il layer evidenziato (arancione) */}
                {previewSegments.map((s, idx) => {
                  const isHovered = !cropMode && hoveredLayer === s.layer;
                  const isWall = autoGenerateWalls && wallLayers.has(s.layer);
                  if (isHovered) return null;
                  return (
                    <line
                      key={idx}
                      x1={s.x1}
                      y1={-s.y1}
                      x2={s.x2}
                      y2={-s.y2}
                      stroke={isWall ? '#2563eb' : '#94a3b8'}
                      strokeWidth={isWall ? strokeUnit * 2.0 : strokeUnit * 0.9}
                      strokeLinecap="round"
                      className={!cropMode && autoGenerateWalls ? 'cursor-pointer' : ''}
                      onMouseEnter={() => {
                        if (!cropMode) setHoveredLayer(s.layer);
                      }}
                      onMouseLeave={() => {
                        if (!cropMode) setHoveredLayer(null);
                      }}
                      onClick={() => {
                        if (!cropMode && autoGenerateWalls) toggleWallLayer(s.layer);
                      }}
                    />
                  );
                })}

                {/* Layer attualmente sotto il cursore evidenziato in arancione brillante */}
                {!cropMode &&
                  hoveredLayer &&
                  previewSegments
                    .filter((s) => s.layer === hoveredLayer)
                    .map((s, idx) => (
                      <line
                        key={`hov_${idx}`}
                        x1={s.x1}
                        y1={-s.y1}
                        x2={s.x2}
                        y2={-s.y2}
                        stroke="#f97316"
                        strokeWidth={strokeUnit * 3.0}
                        strokeLinecap="round"
                        className={autoGenerateWalls ? 'cursor-pointer' : ''}
                        onMouseLeave={() => setHoveredLayer(null)}
                        onClick={() => {
                          if (autoGenerateWalls) toggleWallLayer(s.layer);
                        }}
                      />
                    ))}

                {previewArcs.map((a, idx) => (
                  <circle
                    key={`a_${idx}`}
                    cx={a.cx}
                    cy={-a.cy}
                    r={a.r}
                    fill="none"
                    stroke={!cropMode && hoveredLayer === a.layer ? '#f97316' : '#cbd5e1'}
                    strokeWidth={!cropMode && hoveredLayer === a.layer ? strokeUnit * 2.2 : strokeUnit * 0.75}
                  />
                ))}

                {/* Mostra anteprima testi solo se l'utente attiva "Includi scritte e quote" */}
                {includeTexts &&
                  doc.texts
                    .filter((t) => visibleLayers.has(t.layer) && t.text.length <= 42)
                    .slice(0, 250)
                    .map((t, idx) => (
                      <text
                        key={`tx_${idx}`}
                        x={t.x}
                        y={-t.y}
                        fontSize={Math.max(strokeUnit * 6, Math.min(strokeUnit * 14, t.height * 0.75))}
                        fill="#1e3a8a"
                        opacity={0.7}
                      >
                        {t.text}
                      </text>
                    ))}

                {/* Riquadro verde del singolo piano ritagliato */}
                {cropBounds && (
                  <rect
                    x={cropBounds.minX}
                    y={-cropBounds.maxY}
                    width={Math.max(0, cropBounds.maxX - cropBounds.minX)}
                    height={Math.max(0, cropBounds.maxY - cropBounds.minY)}
                    fill="rgba(16, 185, 129, 0.12)"
                    stroke="#059669"
                    strokeWidth={strokeUnit * 2.6}
                    strokeDasharray={`${strokeUnit * 8} ${strokeUnit * 4}`}
                    pointerEvents="none"
                  />
                )}
              </svg>
            </div>

            {/* Legenda colori chiara */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400 mt-2">
              <span className="inline-flex items-center gap-1.5">
                <MousePointerClick className="w-3.5 h-3.5 text-blue-600" />
                Clicca un muro per farlo diventare <strong className="text-blue-700 dark:text-blue-400">Blu (3D)</strong>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-1 rounded-full bg-slate-400 inline-block" />
                <strong>Grigio</strong> = sfondo
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-1 rounded-full bg-orange-500 inline-block" />
                <strong className="text-orange-600">Arancione</strong> = layer sotto il mouse
              </span>
            </div>
          </div>

          {/* Pannello guidato a destra (col-span-5) */}
          <div className="lg:col-span-5 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-3.5 overflow-y-auto text-xs">
            {/* PASSO 1: SCALA / UNITÀ DI MISURA */}
            <div className="space-y-2">
              <div className="font-bold text-slate-900 dark:text-white">
                Passo 1 — Verifica le dimensioni in metri
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {QUICK_UNITS.map((u) => {
                  const active = unit === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setUnit(u.id)}
                      className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                        active
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-400'
                      }`}
                    >
                      <div className="text-xs font-bold">{u.label}</div>
                      <div className={`text-[10px] font-mono ${active ? 'text-blue-100' : 'text-slate-400'}`}>
                        ({u.short})
                      </div>
                    </button>
                  );
                })}
              </div>

              <div
                className={`p-2.5 rounded-xl border text-[11px] flex items-start gap-2 ${
                  scaleAdvice.status === 'ok'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                }`}
              >
                {scaleAdvice.status === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                )}
                <div className="flex-1 space-y-1">
                  <div>{scaleAdvice.text}</div>
                  {scaleAdvice.suggestedUnit && (
                    <button
                      type="button"
                      onClick={() => setUnit(scaleAdvice.suggestedUnit!)}
                      className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold cursor-pointer"
                    >
                      Correggi automaticamente in {scaleAdvice.suggestedUnit.toUpperCase()}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* PASSO 2: COSA VUOI IMPORTARE? (SCELTA CHIARA IN 2 SCHEDE) */}
            <div className="space-y-2">
              <div className="font-bold text-slate-900 dark:text-white">
                Passo 2 — Come vuoi importare il file?
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAutoGenerateWalls(false)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    !autoGenerateWalls
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 ring-1 ring-emerald-500'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-xs">
                    <FileImage className="w-3.5 h-3.5 text-emerald-600" />
                    Solo piantina 1:1
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                    <strong>Più facile!</strong> Non devi spuntare nulla: importa il disegno già in scala e ricalchi i muri a mano.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setAutoGenerateWalls(true)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    autoGenerateWalls
                      ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-500 ring-1 ring-blue-500'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-xs">
                    <Wand2 className="w-3.5 h-3.5 text-blue-600" />
                    Piantina + Muri 3D
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                    Crea automaticamente circa <strong>{estimatedWallCount} muri</strong> dalle linee blu.
                  </p>
                </button>
              </div>

              {/* Opzione scritte e quote DWG (spenta di default per piantina pulita!) */}
              <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 cursor-pointer">
                <div>
                  <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                    Includi scritte e quote del DWG
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Consigliato spento per mantenere la piantina pulita e leggibile ({doc.texts.length} testi nel file)
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeTexts}
                  onChange={(e) => setIncludeTexts(e.target.checked)}
                  className="accent-blue-600 rounded shrink-0"
                />
              </label>
            </div>

            {/* PASSO 3: SCELTA LAYER (CON ANTEPRIMA ARANCIONE AL PASSAGGIO DEL MOUSE) */}
            <div className="flex-1 min-h-0 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  {autoGenerateWalls
                    ? 'Passo 3 — Scegli quali layer sono Muri'
                    : 'Layer visibili sullo sfondo (opzionale)'}
                </span>
                <div className="flex items-center gap-2 text-[10px]">
                  {autoGenerateWalls && (
                    <button
                      type="button"
                      onClick={() => setWallLayers(new Set())}
                      className="text-slate-500 hover:text-red-600 hover:underline cursor-pointer"
                    >
                      Azzera muri
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleLayers(
                        visibleLayers.size === doc.layers.length
                          ? new Set()
                          : new Set(doc.layers.map((l) => l.name))
                      )
                    }
                    className="text-blue-600 hover:underline cursor-pointer"
                  >
                    {visibleLayers.size === doc.layers.length ? 'Nascondi tutti' : 'Mostra tutti'}
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                Passa il mouse sopra un nome qui sotto per vederlo illuminato in <strong className="text-orange-600">arancione</strong> a sinistra.
                {autoGenerateWalls
                  ? ' Clicca “Muri” solo sui layer delle pareti (lascia spenti mobili, quote e testi).'
                  : ' Puoi lasciare tutto così e cliccare subito Importa.'}
              </p>

              <div className="flex-1 min-h-[140px] max-h-60 overflow-y-auto space-y-1 pr-1">
                {doc.layers.map((layer) => {
                  const isVis = visibleLayers.has(layer.name);
                  const isWall = wallLayers.has(layer.name);
                  const isHov = hoveredLayer === layer.name;
                  return (
                    <div
                      key={layer.name}
                      onMouseEnter={() => setHoveredLayer(layer.name)}
                      onMouseLeave={() => setHoveredLayer(null)}
                      className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-2 transition-colors ${
                        isHov
                          ? 'bg-orange-50 dark:bg-orange-950/40 border-orange-400'
                          : isWall && autoGenerateWalls
                            ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800'
                            : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200/80 dark:border-slate-700/70'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleVisible(layer.name)}
                        title={isVis ? 'Nascondi questo layer' : 'Mostra questo layer'}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        {isVis ? (
                          <Eye className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300 shrink-0" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0" />
                        )}
                        <span
                          className={`truncate text-[11px] font-semibold ${
                            isVis
                              ? 'text-slate-800 dark:text-slate-100'
                              : 'text-slate-400 line-through'
                          }`}
                        >
                          {layer.name}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {layer.segmentCount > 0 ? `${layer.segmentCount} linee` : `${layer.textCount} testi`}
                        </span>
                      </button>

                      {autoGenerateWalls && layer.segmentCount > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleWallLayer(layer.name)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer shrink-0 ${
                            isWall
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-blue-500 hover:text-blue-600'
                          }`}
                        >
                          {isWall ? 'Muri ✓' : '+ Muri'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {!autoGenerateWalls
              ? 'Modalità semplice: importa solo la piantina in scala 1:1 (potrai ricalcare i muri subito).'
              : estimatedWallCount > 0
                ? `Pronto: importerà la piantina + ${estimatedWallCount} muri automatici.`
                : 'Nessun layer selezionato come "Muri": verrà importata solo la piantina di sfondo.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={visibleLayers.size === 0}
              onClick={handleConfirmImport}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Check className="w-4 h-4" />
              {!autoGenerateWalls || estimatedWallCount === 0
                ? 'Importa solo piantina 1:1'
                : `Importa piantina + ${estimatedWallCount} muri`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

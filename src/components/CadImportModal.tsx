/**
 * Modale di importazione CAD (.DWG / .DXF) nello Step 0:
 * - Mostra anteprima vettoriale interattiva del disegno CAD
 * - Consente di confermare/cambiare l'unità di misura (mm / cm / m) con verifica istantanea delle dimensioni in metri
 * - Permette di accendere/spegnere i layer visibili e scegliere quali layer convertire automaticamente in muri 2D/3D
 * - Importa la piantina già calibrata in scala reale 1:1
 */
import React, { useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Layers, Ruler, Wand2, X } from 'lucide-react';
import type { FloorplanImage, Wall } from '../types/project';
import {
  CAD_UNIT_LABELS,
  CAD_UNIT_TO_METERS,
  extractWallsFromCad,
  renderCadToFloorplanImage,
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

export const CadImportModal: React.FC<CadImportModalProps> = ({
  doc,
  defaultWallThickness,
  defaultWallHeight,
  onCancel,
  onImport,
}) => {
  const [unit, setUnit] = useState<CadUnit>(doc.detectedUnit);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    () => new Set(doc.layers.map((l) => l.name))
  );
  const [wallLayers, setWallLayers] = useState<Set<string>>(
    () => new Set(doc.layers.filter((l) => l.suggestedAsWall).map((l) => l.name))
  );
  const [autoGenerateWalls, setAutoGenerateWalls] = useState(true);

  const toM = CAD_UNIT_TO_METERS[unit];
  const widthM = doc.bounds.width * toM;
  const heightM = doc.bounds.height * toM;

  // Anteprima leggera limitata a 2500 segmenti per fluidità immediata nella modale
  const previewSegments = useMemo(() => {
    const filtered = doc.segments.filter((s) => visibleLayers.has(s.layer));
    if (filtered.length <= 2500) return filtered;
    const step = Math.ceil(filtered.length / 2500);
    return filtered.filter((_, idx) => idx % step === 0);
  }, [doc.segments, visibleLayers]);

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
      generateId
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
    setWallLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  };

  const handleConfirmImport = () => {
    const rendered = renderCadToFloorplanImage(doc, unit, visibleLayers, wallLayers);
    const walls = autoGenerateWalls
      ? extractWallsFromCad(
          doc,
          unit,
          wallLayers,
          rendered.padMeters,
          defaultWallThickness,
          defaultWallHeight,
          generateId
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
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Intestazione */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ruler className="w-4 h-4 text-blue-600" />
              Importazione CAD ({doc.format.toUpperCase()}) — {doc.fileName}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {doc.segments.length} linee • {doc.arcs.length} archi • {doc.texts.length} quote/testi •{' '}
              {doc.layers.length} layer rilevati
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

        {/* Corpo: Anteprima SVG a sinistra + Impostazioni Scala/Layer a destra */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 overflow-hidden">
          {/* Anteprima vettoriale */}
          <div className="lg:col-span-2 bg-slate-100 dark:bg-slate-950 p-4 flex flex-col min-h-[260px]">
            <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
              <span>Anteprima disegno CAD</span>
              <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                Ingombro reale stimato: {widthM.toFixed(2)} m × {heightM.toFixed(2)} m
              </span>
            </div>
            <div className="flex-1 min-h-0 rounded-xl bg-white border border-slate-200 dark:border-slate-800 overflow-hidden flex items-center justify-center">
              <svg
                viewBox={`${doc.bounds.minX - padX} ${-doc.bounds.maxY - padY} ${vbW} ${vbH}`}
                className="w-full h-full max-h-[55vh]"
                preserveAspectRatio="xMidYMid meet"
              >
                {previewSegments.map((s, idx) => {
                  const isWall = autoGenerateWalls && wallLayers.has(s.layer);
                  return (
                    <line
                      key={idx}
                      x1={s.x1}
                      y1={-s.y1}
                      x2={s.x2}
                      y2={-s.y2}
                      stroke={isWall ? '#1d4ed8' : '#64748b'}
                      strokeWidth={isWall ? strokeUnit * 1.6 : strokeUnit * 0.85}
                      strokeLinecap="round"
                    />
                  );
                })}
                {previewArcs.map((a, idx) => (
                  <circle
                    key={`a_${idx}`}
                    cx={a.cx}
                    cy={-a.cy}
                    r={a.r}
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth={strokeUnit * 0.7}
                  />
                ))}
              </svg>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              In <strong className="text-blue-600">blu</strong> i layer selezionati per la generazione automatica dei muri; in grigio i layer di riferimento (quote, arredi, porte).
            </p>
          </div>

          {/* Controlli unità e layer */}
          <div className="border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-4 overflow-y-auto text-xs">
            {/* Unità di misura */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-800 dark:text-slate-100 block">
                1. Unità di misura del file CAD
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as CadUnit)}
                className="w-full px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium text-slate-800 dark:text-slate-100"
              >
                {(Object.keys(CAD_UNIT_LABELS) as CadUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {CAD_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">
                Controlla l’ingombro sopra (es. un appartamento misura di solito 6–20 m). Se vedi 1000 m cambia da <strong>m</strong> a <strong>mm</strong> o <strong>cm</strong>.
              </p>
            </div>

            {/* Generazione automatica muri */}
            <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoGenerateWalls}
                  onChange={(e) => setAutoGenerateWalls(e.target.checked)}
                  className="mt-0.5 accent-blue-600"
                />
                <div>
                  <div className="font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-1">
                    <Wand2 className="w-3.5 h-3.5" />
                    Genera muri automatici dai layer &ldquo;Muri&rdquo;
                  </div>
                  <div className="text-[11px] text-blue-700/80 dark:text-blue-300/80">
                    {autoGenerateWalls
                      ? `Verranno creati circa ${estimatedWallCount} muri (unendo i doppi fili paralleli con spessore reale).`
                      : 'Verrà importata solo la piantina CAD in scala 1:1 pronta da ricalcare.'}
                  </div>
                </div>
              </label>
            </div>

            {/* Elenco Layer */}
            <div className="flex-1 min-h-0 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  2. Layer del file ({doc.layers.length})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setVisibleLayers(
                      visibleLayers.size === doc.layers.length
                        ? new Set()
                        : new Set(doc.layers.map((l) => l.name))
                    )
                  }
                  className="text-[10px] text-blue-600 hover:underline cursor-pointer"
                >
                  {visibleLayers.size === doc.layers.length ? 'Nascondi tutti' : 'Mostra tutti'}
                </button>
              </div>

              <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                {doc.layers.map((layer) => {
                  const isVis = visibleLayers.has(layer.name);
                  const isWall = wallLayers.has(layer.name);
                  return (
                    <div
                      key={layer.name}
                      className="px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/70 flex items-center justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => toggleVisible(layer.name)}
                        title={isVis ? 'Nascondi layer dalla piantina' : 'Mostra layer nella piantina'}
                        className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        {isVis ? (
                          <Eye className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300 shrink-0" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0" />
                        )}
                        <span
                          className={`truncate text-[11px] font-medium ${
                            isVis
                              ? 'text-slate-800 dark:text-slate-100'
                              : 'text-slate-400 line-through'
                          }`}
                        >
                          {layer.name}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          ({layer.segmentCount})
                        </span>
                      </button>

                      {autoGenerateWalls && layer.segmentCount > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleWallLayer(layer.name)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer shrink-0 ${
                            isWall
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                          }`}
                        >
                          {isWall ? 'Muri ✓' : 'Usa come muri'}
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
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-end gap-2">
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
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Check className="w-4 h-4" />
            Importa in scala 1:1
            {autoGenerateWalls && estimatedWallCount > 0 ? ` (+ ${estimatedWallCount} muri)` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Piantina Impianti interattiva ad alta leggibilità (Step 4):
 * - Schema planimetrico grande (con Zoom, Pan, Schermo Intero ed Export SVG)
 * - Disegna in modo chiaro e distinto con percorsi ortogonali CAD:
 *   1) ⚡ Impianto Elettrico: Quadro → dorsali stanze, punti luce (1,5 mm²), prese FM (2,5 mm²), linee potenza (4 mm²)
 *   2) 💧 Impianto Idraulico: Dorsale grande Ø20/26 mm (Generatore/Ingresso ↔ Collettore Acqua) +
 *      diramazioni Ø16 mm Fredda/Calda e Scarichi dal Collettore Acqua verso sanitari, cucina e lavatrice
 *   3) 🔥 Riscaldamento & Clima: DORSALE PRIMARIA MAGGIORATA Ø26/32 mm (Pompa di Calore / Caldaia ↔ Collettore Riscaldamento) +
 *      diramazioni Ø16 mm (Mandata + Ritorno) dal Collettore Riscaldamento verso Termosifoni, Scaldasalviette e Split idronici
 *      (oppure linee rame frigorifero per Split a gas)
 * - Permette di inserire e spostare direttamente sulla piantina:
 *   Collettore Acqua, Collettore Riscaldamento, Quadro Elettrico, Generatori (PdC/Caldaia), Termosifoni e Split!
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Download,
  Droplets,
  Flame,
  Maximize2,
  Minimize2,
  PlusCircle,
  RotateCcw,
  Thermometer,
  Trash2,
  Wind,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import rawCatalog from '../data/furnitureCatalog.json';
import type {
  Furniture,
  FurnitureCatalogItem,
  Point2D,
  ProjectData,
} from '../types/project';
import { getOpeningCenter, getWallsBounds, wallAngleRad } from '../utils/geometry';
import type { DetectedRoom } from '../utils/rooms';
import {
  isHvacGenerator,
  isHvacTerminal,
  isWaterFixture,
  type MepConfig,
  type MepEstimate,
} from '../utils/mepEstimator';

const CATALOG = rawCatalog as FurnitureCatalogItem[];

export type BlueprintPlaceAction =
  | null
  | 'panel'
  | 'water_manifold'
  | 'heating_manifold'
  | 'add_heat_pump_monobloc'
  | 'add_heat_pump_split'
  | 'add_boiler'
  | 'add_radiator'
  | 'add_ac_split_high';

interface MepBlueprintCanvasProps {
  project: ProjectData;
  rooms: DetectedRoom[];
  config: MepConfig;
  estimate: MepEstimate;
  hasPlacedWaterManifold: boolean;
  hasPlacedHeatingManifold: boolean;
  showWaterManifold: boolean;
  showHeatingManifold: boolean;
  showElectricalDefault: boolean;
  showPlumbingDefault: boolean;
  showHvacDefault: boolean;
  onMovePanel: (pt: Point2D) => void;
  onPlaceOrMoveWaterManifold: (pt: Point2D) => void;
  onPlaceOrMoveHeatingManifold: (pt: Point2D) => void;
  onDeleteWaterManifold: () => void;
  onDeleteHeatingManifold: () => void;
  onQuickPlaceCatalogItem: (item: FurnitureCatalogItem, pt: Point2D) => void;
}

/** Genera un percorso ortogonale (a L con gomito morbido) tra A e B con offset parallelo opzionale */
function buildOrthogonalPath(
  a: Point2D,
  b: Point2D,
  offset = 0,
  horizontalFirst = true
): { d: string; mid: Point2D } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;

  // Offset perpendicolare piccolo per separare mandata/ritorno o fredda/calda
  const p1x = a.x + (horizontalFirst ? 0 : offset);
  const p1y = a.y + (horizontalFirst ? offset : 0);
  const p2x = b.x + (horizontalFirst ? offset : 0);
  const p2y = b.y + (horizontalFirst ? 0 : offset);

  const cornerX = horizontalFirst ? p2x : p1x;
  const cornerY = horizontalFirst ? p1y : p2y;

  const leg1 = Math.hypot(cornerX - p1x, cornerY - p1y);
  const leg2 = Math.hypot(p2x - cornerX, p2y - cornerY);
  const r = Math.min(0.18, leg1 * 0.35, leg2 * 0.35);

  if (r < 0.03) {
    return {
      d: `M ${p1x.toFixed(3)} ${p1y.toFixed(3)} L ${p2x.toFixed(3)} ${p2y.toFixed(3)}`,
      mid: { x: (p1x + p2x) / 2, y: (p1y + p2y) / 2 },
    };
  }

  let beforeX = cornerX;
  let beforeY = cornerY;
  let afterX = cornerX;
  let afterY = cornerY;

  if (horizontalFirst) {
    beforeX = cornerX - sx * r;
    afterY = cornerY + sy * r;
  } else {
    beforeY = cornerY - sy * r;
    afterX = cornerX + sx * r;
  }

  const d = `M ${p1x.toFixed(3)} ${p1y.toFixed(3)} L ${beforeX.toFixed(3)} ${beforeY.toFixed(3)} Q ${cornerX.toFixed(3)} ${cornerY.toFixed(3)} ${afterX.toFixed(3)} ${afterY.toFixed(3)} L ${p2x.toFixed(3)} ${p2y.toFixed(3)}`;
  // Punto etichetta sul tratto più lungo
  const mid =
    leg1 >= leg2
      ? { x: (p1x + cornerX) / 2, y: (p1y + cornerY) / 2 }
      : { x: (cornerX + p2x) / 2, y: (cornerY + p2y) / 2 };
  return { d, mid };
}

export const MepBlueprintCanvas: React.FC<MepBlueprintCanvasProps> = ({
  project,
  rooms,
  config,
  estimate,
  hasPlacedWaterManifold,
  hasPlacedHeatingManifold,
  showWaterManifold,
  showHeatingManifold,
  showElectricalDefault,
  showPlumbingDefault,
  showHvacDefault,
  onMovePanel,
  onPlaceOrMoveWaterManifold,
  onPlaceOrMoveHeatingManifold,
  onDeleteWaterManifold,
  onDeleteHeatingManifold,
  onQuickPlaceCatalogItem,
}) => {
  const [layerElectric, setLayerElectric] = useState(true);
  const [layerWater, setLayerWater] = useState(true);
  const [layerHeating, setLayerHeating] = useState(true);
  const [showDiameters, setShowDiameters] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [placeAction, setPlaceAction] = useState<BlueprintPlaceAction>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const activeWalls = useMemo(
    () => project.walls.filter((w) => !w.demolished),
    [project.walls]
  );

  const wallMap = useMemo(
    () => new Map(activeWalls.map((w) => [w.id, w])),
    [activeWalls]
  );

  const baseBounds = useMemo(() => {
    const b = getWallsBounds(activeWalls);
    const pad = Math.max(0.85, Math.max(b.width, b.height) * 0.09);
    return {
      minX: b.minX - pad,
      minY: b.minY - pad,
      width: Math.max(3, b.width + pad * 2),
      height: Math.max(3, b.height + pad * 2),
      centerX: b.centerX,
      centerY: b.centerY,
    };
  }, [activeWalls]);

  // Calcola viewBox zoomato attorno al centro della pianta
  const viewBox = useMemo(() => {
    const w = baseBounds.width / zoom;
    const h = baseBounds.height / zoom;
    const minX = baseBounds.centerX - w / 2;
    const minY = baseBounds.centerY - h / 2;
    return { minX, minY, width: w, height: h };
  }, [baseBounds, zoom]);

  // Scala adattiva per spessori linee e testi in metri reali
  const unitScale = Math.max(0.012, Math.min(0.032, Math.max(baseBounds.width, baseBounds.height) / 360));

  const showElec = layerElectric && showElectricalDefault;
  const showWat = layerWater && showPlumbingDefault;
  const showHeat = layerHeating && showHvacDefault;

  // Calcola i punti elettrici dedicati (cucine e generatori)
  const dedicatedPowerTargets = useMemo(() => {
    return project.furniture.filter(
      (f) =>
        f.geometryType === 'kitchen_linear' ||
        f.geometryType === 'kitchen_l' ||
        f.geometryType === 'kitchen_peninsula' ||
        f.geometryType === 'kitchen_island' ||
        f.geometryType === 'heat_pump_monobloc' ||
        f.geometryType === 'heat_pump_split' ||
        f.geometryType === 'boiler' ||
        f.geometryType === 'boiler_pellet' ||
        f.geometryType === 'water_heater'
    );
  }, [project.furniture]);

  // Boiler acqua calda (Bollitore ACS) se presente in pianta
  const placedWaterHeaters = useMemo(
    () => project.furniture.filter((f) => f.geometryType === 'water_heater'),
    [project.furniture]
  );

  // Generatore primario per dorsali riscaldamento e acqua calda (priorità al Boiler ACS per la linea sanitaria)
  const primaryGen = estimate.hvac.primaryGeneratorAnchor;
  const acsGen: Point2D | null = placedWaterHeaters[0]
    ? { x: placedWaterHeaters[0].x, y: placedWaterHeaters[0].y }
    : primaryGen;
  const splitGasGen =
    estimate.hvac.generators.find((g) => g.kind === 'hp_split') ??
    estimate.hvac.generators.find((g) => g.kind === 'hp_monobloc') ??
    null;

  // Click sulla piantina: converte coordinate schermo -> metri reali usando CTM SVG (esatto anche con preserveAspectRatio!)
  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!placeAction || !svgRef.current) return;
    const svg = svgRef.current;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const worldPt = pt.matrixTransform(ctm.inverse());
    const pos: Point2D = {
      x: Number(worldPt.x.toFixed(2)),
      y: Number(worldPt.y.toFixed(2)),
    };

    if (placeAction === 'panel') {
      onMovePanel(pos);
      setPlaceAction(null);
      return;
    }
    if (placeAction === 'water_manifold') {
      onPlaceOrMoveWaterManifold(pos);
      setPlaceAction(null);
      return;
    }
    if (placeAction === 'heating_manifold') {
      onPlaceOrMoveHeatingManifold(pos);
      setPlaceAction(null);
      return;
    }

    const catalogIdMap: Record<string, string> = {
      add_heat_pump_monobloc: 'heat-pump-monobloc',
      add_heat_pump_split: 'heat-pump-split',
      add_boiler: 'boiler',
      add_radiator: 'radiator',
      add_ac_split_high: 'ac-split-high',
    };
    const catId = catalogIdMap[placeAction];
    const item = CATALOG.find((c) => c.id === catId);
    if (item) {
      onQuickPlaceCatalogItem(item, pos);
    }
    setPlaceAction(null);
  };

  const handleExportSvg = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgRef.current);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (project.name || 'progetto').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `${safeName}-schema-impianti.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const placeHint: Record<Exclude<BlueprintPlaceAction, null>, string> = {
    panel: 'Clicca sulla piantina per spostare il Quadro Elettrico (⚡)',
    water_manifold:
      'Clicca sulla piantina per inserire/spostare il Collettore Acqua Sanitaria (💧)',
    heating_manifold:
      'Clicca sulla piantina per inserire/spostare il Collettore Riscaldamento (🔥)',
    add_heat_pump_monobloc:
      'Clicca sulla piantina (es. esterno/terrazzo) per inserire la Pompa di Calore Monoblocco',
    add_heat_pump_split:
      'Clicca sulla piantina (es. esterno) per inserire la Pompa di Calore Splittata',
    add_boiler: 'Clicca sulla piantina per inserire la Caldaia a Gas',
    add_radiator: 'Clicca vicino a una parete per inserire un Termosifone',
    add_ac_split_high: 'Clicca vicino a una parete per inserire uno Split Clima',
  };

  const renderSvgPlan = (tallClass: string) => (
    <div className={`relative w-full ${tallClass} rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#f8fafc] dark:bg-[#0b1220]`}>
      {/* Banner istruzioni posizionamento attivo */}
      {placeAction && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full bg-blue-600 text-white text-xs font-semibold shadow-lg flex items-center gap-2.5 animate-pulse">
          <span>{placeHint[placeAction]}</span>
          <button
            type="button"
            onClick={() => setPlaceAction(null)}
            className="px-2 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-[10px] cursor-pointer"
          >
            Annulla
          </button>
        </div>
      )}

      {/* Controlli Zoom / Export in alto a destra dentro il canvas */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 p-1 rounded-xl bg-white/92 dark:bg-slate-900/92 backdrop-blur border border-slate-200 dark:border-slate-700 shadow-sm">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2.6, Number((z + 0.25).toFixed(2))))}
          title="Zoom avanti"
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <span className="text-[10px] font-mono text-slate-500 px-1">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
          title="Zoom indietro"
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          title="Adatta pianta"
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
        <button
          type="button"
          onClick={handleExportSvg}
          title="Scarica piantina impianti in formato vettoriale SVG"
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setIsFullscreen((f) => !f)}
          title={isFullscreen ? 'Riduci vista' : 'Espandi piantina a tutto schermo'}
          className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 text-blue-600 dark:text-blue-400 cursor-pointer"
        >
          {isFullscreen ? (
            <Minimize2 className="w-3.5 h-3.5" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        onClick={handleSvgClick}
        className={`w-full h-full select-none ${
          placeAction ? 'cursor-crosshair' : 'cursor-default'
        }`}
      >
        <defs>
          {/* Griglia metrica tecnica 1m × 1m */}
          <pattern id="mepGrid1m" width="1" height="1" patternUnits="userSpaceOnUse">
            <path
              d="M 1 0 L 0 0 0 1"
              fill="none"
              stroke="rgba(148,163,184,0.22)"
              strokeWidth={unitScale * 0.45}
            />
          </pattern>
        </defs>

        {/* Sfondo griglia */}
        <rect
          x={viewBox.minX - 10}
          y={viewBox.minY - 10}
          width={viewBox.width + 20}
          height={viewBox.height + 20}
          fill="url(#mepGrid1m)"
        />

        {/* 1. STANZE RILEVATE */}
        {rooms.map((rm) => (
          <g key={rm.id}>
            {rm.floorStrips.map((st, idx) => (
              <rect
                key={idx}
                x={st.x}
                y={st.y}
                width={st.width}
                height={st.height}
                fill={
                  rm.kind === 'bagno'
                    ? 'rgba(14,165,233,0.11)'
                    : rm.kind === 'cucina' || rm.kind === 'soggiorno_cucina'
                      ? 'rgba(245,158,11,0.09)'
                      : 'rgba(148,163,184,0.08)'
                }
              />
            ))}
            <text
              x={rm.bounds.centerX}
              y={rm.bounds.centerY - unitScale * 9}
              textAnchor="middle"
              fontSize={unitScale * 9.5}
              fill="#64748b"
              fontWeight="700"
              opacity={0.78}
            >
              {rm.name}
            </text>
            <text
              x={rm.bounds.centerX}
              y={rm.bounds.centerY + unitScale * 1.5}
              textAnchor="middle"
              fontSize={unitScale * 6.8}
              fill="#94a3b8"
              fontWeight="500"
            >
              {rm.areaSqm} m²
            </text>
          </g>
        ))}

        {/* 2. SAGOME LEGGERE DEI MOBILI (contesto spaziale) */}
        {project.furniture.map((f) => {
          const isSpecial =
            isWaterFixture(f) ||
            isHvacTerminal(f) ||
            isHvacGenerator(f) ||
            f.geometryType === 'manifold_water' ||
            f.geometryType === 'manifold_heating';
          return (
            <g
              key={`bg_f_${f.id}`}
              transform={`translate(${f.x}, ${f.y}) rotate(${f.rotation})`}
              opacity={isSpecial ? 0.55 : 0.28}
            >
              <rect
                x={-f.width / 2}
                y={-f.depth / 2}
                width={f.width}
                height={f.depth}
                rx={0.04}
                fill={isSpecial ? '#e2e8f0' : '#cbd5e1'}
                stroke="#64748b"
                strokeWidth={unitScale * 0.65}
              />
            </g>
          );
        })}

        {/* 3. MURI ATTIVI + APERTURE (PORTE / FINESTRE) */}
        {activeWalls.map((w) => (
          <line
            key={w.id}
            x1={w.start.x}
            y1={w.start.y}
            x2={w.end.x}
            y2={w.end.y}
            stroke="#334155"
            strokeWidth={Math.max(0.11, w.thickness)}
            strokeLinecap="square"
          />
        ))}
        {project.openings.map((op) => {
          const w = wallMap.get(op.wallId);
          if (!w) return null;
          const center = getOpeningCenter(op, w);
          const angleDeg = (wallAngleRad(w) * 180) / Math.PI;
          const isWindow = op.type === 'window' || op.type === 'french_window';
          return (
            <g
              key={`op_${op.id}`}
              transform={`translate(${center.x}, ${center.y}) rotate(${angleDeg})`}
            >
              <rect
                x={-op.width / 2}
                y={-(w.thickness + 0.03) / 2}
                width={op.width}
                height={w.thickness + 0.03}
                fill={isWindow ? '#bae6fd' : '#f8fafc'}
                stroke={isWindow ? '#0284c7' : '#94a3b8'}
                strokeWidth={unitScale * 0.6}
              />
            </g>
          );
        })}

        {/* ===================================================================
            4. LINEE IMPIANTO ELETTRICO (LUCE + PRESE FM + POTENZA 4 mm²)
           =================================================================== */}
        {showElec && (
          <g>
            {/* Dorsali dal Quadro Elettrico verso ogni stanza (Luce 1,5 mm² + Prese FM 2,5 mm²) */}
            {rooms.map((rm, idx) => {
              const targetLight: Point2D = {
                x: rm.bounds.centerX,
                y: rm.bounds.centerY + unitScale * 9,
              };
              const targetOutlet: Point2D = {
                x: rm.bounds.minX + Math.min(0.45, rm.bounds.width * 0.25),
                y: rm.bounds.maxY - Math.min(0.4, rm.bounds.height * 0.25),
              };
              const lightPath = buildOrthogonalPath(
                config.panelPosition,
                targetLight,
                -unitScale * 1.4,
                idx % 2 === 0
              );
              const outletPath = buildOrthogonalPath(
                config.panelPosition,
                targetOutlet,
                unitScale * 1.6,
                idx % 2 === 1
              );
              return (
                <g key={`el_${rm.id}`}>
                  {/* Linea Luce 1,5 mm² (ambra/oro continua) */}
                  <path
                    d={lightPath.d}
                    fill="none"
                    stroke="#eab308"
                    strokeWidth={unitScale * 1.65}
                    strokeLinecap="round"
                    opacity={0.9}
                  />
                  {/* Linea Prese FM 2,5 mm² (arancione tratteggiata) */}
                  <path
                    d={outletPath.d}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth={unitScale * 1.35}
                    strokeDasharray={`${unitScale * 4.5} ${unitScale * 3}`}
                    strokeLinecap="round"
                    opacity={0.82}
                  />
                  {/* Simbolo Punto Luce centrale (⊗) */}
                  <g transform={`translate(${targetLight.x}, ${targetLight.y})`}>
                    <circle
                      r={unitScale * 5.2}
                      fill="#fef9c3"
                      stroke="#ca8a04"
                      strokeWidth={unitScale * 1.1}
                    />
                    <line
                      x1={-unitScale * 3.3}
                      y1={-unitScale * 3.3}
                      x2={unitScale * 3.3}
                      y2={unitScale * 3.3}
                      stroke="#ca8a04"
                      strokeWidth={unitScale * 1.1}
                    />
                    <line
                      x1={unitScale * 3.3}
                      y1={-unitScale * 3.3}
                      x2={-unitScale * 3.3}
                      y2={unitScale * 3.3}
                      stroke="#ca8a04"
                      strokeWidth={unitScale * 1.1}
                    />
                  </g>
                  {/* Simbolo Presa FM */}
                  <circle
                    cx={targetOutlet.x}
                    cy={targetOutlet.y}
                    r={unitScale * 3.2}
                    fill="#ffedd5"
                    stroke="#ea580c"
                    strokeWidth={unitScale * 1.0}
                  />
                </g>
              );
            })}

            {/* Linee elettriche dedicate di potenza 4 mm² verso Cucina/Induzione e PdC/Caldaia */}
            {dedicatedPowerTargets.map((f, idx) => {
              const p = buildOrthogonalPath(
                config.panelPosition,
                { x: f.x, y: f.y },
                unitScale * 2.4,
                idx % 2 === 0
              );
              return (
                <g key={`el_ded_${f.id}`}>
                  <path
                    d={p.d}
                    fill="none"
                    stroke="#9333ea"
                    strokeWidth={unitScale * 2.1}
                    strokeDasharray={`${unitScale * 6} ${unitScale * 2.5}`}
                    strokeLinecap="round"
                    opacity={0.82}
                  />
                  {showDiameters && (
                    <g transform={`translate(${p.mid.x}, ${p.mid.y})`}>
                      <rect
                        x={-unitScale * 13}
                        y={-unitScale * 4.5}
                        width={unitScale * 26}
                        height={unitScale * 9}
                        rx={unitScale * 2.5}
                        fill="#faf5ff"
                        stroke="#9333ea"
                        strokeWidth={unitScale * 0.6}
                      />
                      <text
                        y={unitScale * 2.4}
                        textAnchor="middle"
                        fontSize={unitScale * 5.8}
                        fill="#7e22ce"
                        fontWeight="700"
                      >
                        4 mm²
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* ===================================================================
            5. LINEE IMPIANTO IDRAULICO (ACQUA SANITARIA + DORSALE + SCARICHI)
           =================================================================== */}
        {showWat && showWaterManifold && (
          <g>
            {/* DORSALE SANITARIA PIÙ GRANDE (Ø20/26 mm) tra Boiler ACS / Caldaia / PdC e Collettore Acqua */}
            {acsGen && (
              (() => {
                const trunkCold = buildOrthogonalPath(
                  acsGen,
                  config.waterManifoldPosition,
                  -unitScale * 2.4,
                  true
                );
                const trunkHot = buildOrthogonalPath(
                  acsGen,
                  config.waterManifoldPosition,
                  unitScale * 2.4,
                  true
                );
                return (
                  <g>
                    <path
                      d={trunkCold.d}
                      fill="none"
                      stroke="#0369a1"
                      strokeWidth={unitScale * 3.6}
                      strokeLinecap="round"
                      opacity={0.9}
                    />
                    {config.includeHotWater && (
                      <path
                        d={trunkHot.d}
                        fill="none"
                        stroke="#e11d48"
                        strokeWidth={unitScale * 3.2}
                        strokeLinecap="round"
                        opacity={0.88}
                      />
                    )}
                    {showDiameters && (
                      <g transform={`translate(${trunkCold.mid.x}, ${trunkCold.mid.y - unitScale * 6})`}>
                        <rect
                          x={-unitScale * 22}
                          y={-unitScale * 5}
                          width={unitScale * 44}
                          height={unitScale * 10}
                          rx={unitScale * 3}
                          fill="#0369a1"
                        />
                        <text
                          y={unitScale * 2.4}
                          textAnchor="middle"
                          fontSize={unitScale * 5.8}
                          fill="#ffffff"
                          fontWeight="800"
                        >
                          ACS Ø20/26
                        </text>
                      </g>
                    )}
                  </g>
                );
              })()
            )}

            {/* Diramazioni Ø16 mm dal COLLETTORE ACQUA verso ogni sanitario / cucina / lavatrice */}
            {estimate.plumbing.fixtures.map((fx, idx) => {
              const coldPath = buildOrthogonalPath(
                config.waterManifoldPosition,
                { x: fx.x, y: fx.y },
                -unitScale * 1.4,
                idx % 2 === 0
              );
              const hotPath = buildOrthogonalPath(
                config.waterManifoldPosition,
                { x: fx.x, y: fx.y },
                unitScale * 1.4,
                idx % 2 === 0
              );
              const drainPath = buildOrthogonalPath(
                config.waterManifoldPosition,
                { x: fx.x, y: fx.y },
                unitScale * 3.4,
                idx % 2 === 0
              );

              return (
                <g key={`wat_${fx.id}`}>
                  {/* Acqua Fredda Ø16 (blu cielo) */}
                  <path
                    d={coldPath.d}
                    fill="none"
                    stroke="#0284c7"
                    strokeWidth={unitScale * 1.85}
                    strokeLinecap="round"
                    opacity={0.92}
                  />
                  {/* Acqua Calda Ø16 (rosa/rosso sanitario, se richiesta dall'utenza) */}
                  {fx.needsHot && (
                    <path
                      d={hotPath.d}
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth={unitScale * 1.65}
                      strokeLinecap="round"
                      opacity={0.88}
                    />
                  )}
                  {/* Scarico Ø40/50/110 (tratteggiato verde-petrolio scuro) */}
                  {config.includeDrains && (
                    <path
                      d={drainPath.d}
                      fill="none"
                      stroke="#475569"
                      strokeWidth={
                        fx.drainDiameterMm === 110 ? unitScale * 2.4 : unitScale * 1.35
                      }
                      strokeDasharray={`${unitScale * 3} ${unitScale * 2.5}`}
                      opacity={0.55}
                    />
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* ===================================================================
            6. LINEE RISCALDAMENTO & CLIMA:
               - DORSALE PRIMARIA GROSSA (Ø26 / Ø32 mm) Generatore ↔ Collettore Riscaldamento
               - DIRAMAZIONI (Ø16 mm) Collettore Riscaldamento → Termosifoni / Split idronici
               - RAME FRIGO (1/4"+3/8") PdC Splittata → Split a gas
           =================================================================== */}
        {showHeat && (
          <g>
            {/* DORSALE PRIMARIA MAGGIORATA (TUBI PIÙ GRANDI Ø26 / Ø32 mm) da PdC / Caldaia → Collettore Riscaldamento */}
            {showHeatingManifold && primaryGen && (
              (() => {
                const supplyTrunk = buildOrthogonalPath(
                  primaryGen,
                  config.heatingManifoldPosition,
                  -unitScale * 3.0,
                  false
                );
                const returnTrunk = buildOrthogonalPath(
                  primaryGen,
                  config.heatingManifoldPosition,
                  unitScale * 3.0,
                  false
                );
                return (
                  <g>
                    {/* Alone esterno per evidenziare il tubo grosso primario */}
                    <path
                      d={supplyTrunk.d}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={unitScale * 7.2}
                      strokeLinecap="round"
                      opacity={0.75}
                    />
                    <path
                      d={returnTrunk.d}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={unitScale * 7.2}
                      strokeLinecap="round"
                      opacity={0.75}
                    />
                    {/* Tubo Mandata Primaria Ø26/32 (ROSSO SPESSO) */}
                    <path
                      d={supplyTrunk.d}
                      fill="none"
                      stroke="#dc2626"
                      strokeWidth={unitScale * 4.8}
                      strokeLinecap="round"
                    />
                    {/* Tubo Ritorno Primario Ø26/32 (BLU SPESSO) */}
                    <path
                      d={returnTrunk.d}
                      fill="none"
                      stroke="#1d4ed8"
                      strokeWidth={unitScale * 4.8}
                      strokeLinecap="round"
                    />
                    {showDiameters && (
                      <g transform={`translate(${supplyTrunk.mid.x}, ${supplyTrunk.mid.y})`}>
                        <rect
                          x={-unitScale * 28}
                          y={-unitScale * 6}
                          width={unitScale * 56}
                          height={unitScale * 12}
                          rx={unitScale * 3.5}
                          fill="#991b1b"
                          stroke="#ffffff"
                          strokeWidth={unitScale * 0.9}
                        />
                        <text
                          y={unitScale * 2.8}
                          textAnchor="middle"
                          fontSize={unitScale * 6.5}
                          fill="#ffffff"
                          fontWeight="800"
                        >
                          DORSALE Ø{estimate.hvac.primaryTrunkDiameterMm}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })()
            )}

            {/* Diramazioni da Collettore Riscaldamento → Termosifoni / Scaldasalviette / Split idronici
                e da PdC Splittata → Split a gas */}
            {estimate.hvac.terminals.map((term, idx) => {
              if (term.circuitType === 'water') {
                if (!showHeatingManifold) return null;
                const mandata = buildOrthogonalPath(
                  config.heatingManifoldPosition,
                  { x: term.x, y: term.y },
                  -unitScale * 1.5,
                  idx % 2 === 1
                );
                const ritorno = buildOrthogonalPath(
                  config.heatingManifoldPosition,
                  { x: term.x, y: term.y },
                  unitScale * 1.5,
                  idx % 2 === 1
                );
                return (
                  <g key={`heat_${term.id}`}>
                    {/* Mandata riscaldamento Ø16 mm (rosso) */}
                    <path
                      d={mandata.d}
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth={unitScale * 2.0}
                      strokeLinecap="round"
                      opacity={0.94}
                    />
                    {/* Ritorno riscaldamento Ø16 mm (blu indaco) */}
                    <path
                      d={ritorno.d}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth={unitScale * 1.8}
                      strokeLinecap="round"
                      opacity={0.86}
                    />
                    {showDiameters && (
                      <g transform={`translate(${mandata.mid.x}, ${mandata.mid.y})`}>
                        <rect
                          x={-unitScale * 12}
                          y={-unitScale * 4.2}
                          width={unitScale * 24}
                          height={unitScale * 8.4}
                          rx={unitScale * 2.2}
                          fill="#fef2f2"
                          stroke="#dc2626"
                          strokeWidth={unitScale * 0.6}
                        />
                        <text
                          y={unitScale * 2.2}
                          textAnchor="middle"
                          fontSize={unitScale * 5.2}
                          fill="#b91c1c"
                          fontWeight="700"
                        >
                          Ø16
                        </text>
                      </g>
                    )}
                  </g>
                );
              }

              // Split a gas refrigerante: coppia rame da unità esterna (PdC Splittata)
              const gasOrigin = splitGasGen ?? config.heatingManifoldPosition;
              const gasPath = buildOrthogonalPath(
                gasOrigin,
                { x: term.x, y: term.y },
                0,
                idx % 2 === 0
              );
              return (
                <g key={`gas_${term.id}`}>
                  <path
                    d={gasPath.d}
                    fill="none"
                    stroke="#06b6d4"
                    strokeWidth={unitScale * 2.4}
                    strokeDasharray={`${unitScale * 5.5} ${unitScale * 2.5}`}
                    strokeLinecap="round"
                    opacity={0.95}
                  />
                  {showDiameters && (
                    <g transform={`translate(${gasPath.mid.x}, ${gasPath.mid.y})`}>
                      <rect
                        x={-unitScale * 18}
                        y={-unitScale * 4.5}
                        width={unitScale * 36}
                        height={unitScale * 9}
                        rx={unitScale * 2.4}
                        fill="#ecfeff"
                        stroke="#0891b2"
                        strokeWidth={unitScale * 0.6}
                      />
                      <text
                        y={unitScale * 2.2}
                        textAnchor="middle"
                        fontSize={unitScale * 5.1}
                        fill="#0e7490"
                        fontWeight="700"
                      >
                        1/4&quot;+3/8&quot;
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* ===================================================================
            7. NODI & SIMBOLI TERMINALI, GENERATORI, COLLETTORI E QUADRO
           =================================================================== */}

        {/* Utenze idriche (Sanitari / Cucina / Lavatrice) */}
        {project.furniture.filter(isWaterFixture).map((f) => (
          <g key={`node_wf_${f.id}`} transform={`translate(${f.x}, ${f.y})`}>
            <circle
              r={unitScale * 6.8}
              fill="#0ea5e9"
              stroke="#ffffff"
              strokeWidth={unitScale * 1.8}
            />
            <text
              y={unitScale * 2.4}
              textAnchor="middle"
              fontSize={unitScale * 6.5}
              fill="#ffffff"
              fontWeight="700"
            >
              H₂O
            </text>
          </g>
        ))}

        {/* Terminali Riscaldamento / Clima (Termosifoni, Scaldasalviette, Split) */}
        {project.furniture.filter(isHvacTerminal).map((f: Furniture) => {
          const isRad = f.geometryType === 'radiator' || f.geometryType === 'towel_warmer';
          return (
            <g key={`node_ht_${f.id}`} transform={`translate(${f.x}, ${f.y})`}>
              <rect
                x={-unitScale * 8.5}
                y={-unitScale * 6}
                width={unitScale * 17}
                height={unitScale * 12}
                rx={unitScale * 3}
                fill={isRad ? '#dc2626' : '#0891b2'}
                stroke="#ffffff"
                strokeWidth={unitScale * 1.8}
              />
              <text
                y={unitScale * 2.4}
                textAnchor="middle"
                fontSize={unitScale * 6}
                fill="#ffffff"
                fontWeight="800"
              >
                {isRad ? 'RAD' : 'AC'}
              </text>
            </g>
          );
        })}

        {/* Boiler Acqua Calda (Bollitore ACS) */}
        {placedWaterHeaters.map((wh) => (
          <g key={`node_wh_${wh.id}`} transform={`translate(${wh.x}, ${wh.y})`}>
            <circle
              r={unitScale * 13}
              fill="#e11d48"
              stroke="#ffffff"
              strokeWidth={unitScale * 2.2}
            />
            <text
              y={-unitScale * 1}
              textAnchor="middle"
              fontSize={unitScale * 6.2}
              fill="#ffffff"
              fontWeight="800"
            >
              BOILER
            </text>
            <text
              y={unitScale * 5.8}
              textAnchor="middle"
              fontSize={unitScale * 5.4}
              fill="#ffe4e6"
              fontWeight="700"
            >
              ACS
            </text>
          </g>
        ))}

        {/* Generatori (Pompa di Calore Monoblocco / Splittata, Caldaia Gas / Pellet) */}
        {estimate.hvac.generators.map((g) => {
          const fill =
            g.kind === 'boiler_pellet'
              ? '#991b1b'
              : g.kind === 'boiler_gas'
                ? '#ea580c'
                : g.kind === 'hp_monobloc'
                  ? '#0369a1'
                  : '#0e7490';
          const shortCode =
            g.kind === 'boiler_pellet'
              ? 'PELLET'
              : g.kind === 'boiler_gas'
                ? 'CALDAIA'
                : g.kind === 'hp_monobloc'
                  ? 'PdC H₂O'
                  : 'PdC GAS';
          return (
            <g key={`node_gen_${g.id}`} transform={`translate(${g.x}, ${g.y})`}>
              <rect
                x={-unitScale * 18}
                y={-unitScale * 10}
                width={unitScale * 36}
                height={unitScale * 20}
                rx={unitScale * 4}
                fill={fill}
                stroke="#ffffff"
                strokeWidth={unitScale * 2.2}
              />
              <text
                y={unitScale * 2.5}
                textAnchor="middle"
                fontSize={unitScale * 6.8}
                fill="#ffffff"
                fontWeight="800"
              >
                {shortCode}
              </text>
            </g>
          );
        })}

        {/* COLLETTORE ACQUA SANITARIA (💧) */}
        {showWaterManifold && (
          <g
            transform={`translate(${config.waterManifoldPosition.x}, ${config.waterManifoldPosition.y})`}
            className="cursor-pointer"
            onClick={(e) => {
              if (!placeAction) {
                e.stopPropagation();
                setPlaceAction('water_manifold');
              }
            }}
          >
            <rect
              x={-unitScale * 19}
              y={-unitScale * 11}
              width={unitScale * 38}
              height={unitScale * 22}
              rx={unitScale * 5}
              fill="#0284c7"
              stroke="#ffffff"
              strokeWidth={unitScale * 2.4}
            />
            <text
              y={-unitScale * 1}
              textAnchor="middle"
              fontSize={unitScale * 7.5}
              fill="#ffffff"
              fontWeight="800"
            >
              💧 COLL.
            </text>
            <text
              y={unitScale * 6.8}
              textAnchor="middle"
              fontSize={unitScale * 5.8}
              fill="#e0f2fe"
              fontWeight="700"
            >
              ACQUA
            </text>
            {/* Pulsante × per eliminare direttamente dalla pianta */}
            <g
              transform={`translate(${unitScale * 18}, ${-unitScale * 10})`}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteWaterManifold();
              }}
            >
              <title>Cancella Collettore Acqua</title>
              <circle
                r={unitScale * 5.2}
                fill="#ef4444"
                stroke="#ffffff"
                strokeWidth={unitScale * 1.4}
              />
              <text
                y={unitScale * 2.2}
                textAnchor="middle"
                fontSize={unitScale * 7}
                fill="#ffffff"
                fontWeight="900"
              >
                ×
              </text>
            </g>
          </g>
        )}

        {/* COLLETTORE RISCALDAMENTO (🔥) */}
        {showHeatingManifold && (
          <g
            transform={`translate(${config.heatingManifoldPosition.x}, ${config.heatingManifoldPosition.y})`}
            className="cursor-pointer"
            onClick={(e) => {
              if (!placeAction) {
                e.stopPropagation();
                setPlaceAction('heating_manifold');
              }
            }}
          >
            <rect
              x={-unitScale * 21}
              y={-unitScale * 11}
              width={unitScale * 42}
              height={unitScale * 22}
              rx={unitScale * 5}
              fill="#dc2626"
              stroke="#ffffff"
              strokeWidth={unitScale * 2.4}
            />
            <text
              y={-unitScale * 1}
              textAnchor="middle"
              fontSize={unitScale * 7.5}
              fill="#ffffff"
              fontWeight="800"
            >
              🔥 COLL.
            </text>
            <text
              y={unitScale * 6.8}
              textAnchor="middle"
              fontSize={unitScale * 5.6}
              fill="#fee2e2"
              fontWeight="700"
            >
              RISCALD.
            </text>
            {/* Pulsante × per eliminare direttamente dalla pianta */}
            <g
              transform={`translate(${unitScale * 20}, ${-unitScale * 10})`}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteHeatingManifold();
              }}
            >
              <title>Cancella Collettore Riscaldamento</title>
              <circle
                r={unitScale * 5.2}
                fill="#ef4444"
                stroke="#ffffff"
                strokeWidth={unitScale * 1.4}
              />
              <text
                y={unitScale * 2.2}
                textAnchor="middle"
                fontSize={unitScale * 7}
                fill="#ffffff"
                fontWeight="900"
              >
                ×
              </text>
            </g>
          </g>
        )}

        {/* QUADRO ELETTRICO (⚡) */}
        <g
          transform={`translate(${config.panelPosition.x}, ${config.panelPosition.y})`}
          className="cursor-pointer"
          onClick={(e) => {
            if (!placeAction) {
              e.stopPropagation();
              setPlaceAction('panel');
            }
          }}
        >
          <rect
            x={-unitScale * 17}
            y={-unitScale * 10.5}
            width={unitScale * 34}
            height={unitScale * 21}
            rx={unitScale * 5}
            fill="#d97706"
            stroke="#ffffff"
            strokeWidth={unitScale * 2.4}
          />
          <text
            y={-unitScale * 0.8}
            textAnchor="middle"
            fontSize={unitScale * 7.5}
            fill="#ffffff"
            fontWeight="800"
          >
            ⚡ QE
          </text>
          <text
            y={unitScale * 6.5}
            textAnchor="middle"
            fontSize={unitScale * 5.2}
            fill="#fef3c7"
            fontWeight="700"
          >
            QUADRO
          </text>
        </g>
      </svg>
    </div>
  );

  const controlsBar = (
    <div className="space-y-3">
      {/* Riga 1: Titolo + Toggle Layer Acqua / Luce / Riscaldamento */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            Schema Piantina Impianti (Acqua, Luce & Riscaldamento)
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Clicca un pulsante sotto (o clicca direttamente un collettore sulla mappa) e poi clicca sulla piantina per posizionarlo: tubi e metri si ricalcolano in tempo reale.
          </p>
        </div>

        {/* Filtri rapidi visibilità linee */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => setLayerElectric((v) => !v)}
            className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
              layerElectric
                ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 line-through'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Luce & Prese
          </button>
          <button
            type="button"
            onClick={() => setLayerWater((v) => !v)}
            className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
              layerWater
                ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 line-through'
            }`}
          >
            <Droplets className="w-3.5 h-3.5" />
            Acqua & Scarichi
          </button>
          <button
            type="button"
            onClick={() => setLayerHeating((v) => !v)}
            className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
              layerHeating
                ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 line-through'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            Riscaldamento & Clima
          </button>
          <button
            type="button"
            onClick={() => setShowDiameters((v) => !v)}
            className={`px-2.5 py-1 rounded-lg border font-medium cursor-pointer transition-colors ${
              showDiameters
                ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 border-slate-800'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
          >
            Etichette Ø
          </button>
        </div>
      </div>

      {/* Riga 2: Pulsanti principali per Inserire / Spostare / Cancellare Collettori, Quadro e Componenti */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-stretch">
          <button
            type="button"
            onClick={() =>
              setPlaceAction(placeAction === 'water_manifold' ? null : 'water_manifold')
            }
            className={`px-3 py-2 border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
              showWaterManifold ? 'rounded-l-xl border-r-0' : 'rounded-xl'
            } ${
              placeAction === 'water_manifold'
                ? 'bg-sky-600 text-white border-sky-700 shadow-sm'
                : 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200 hover:bg-sky-100'
            }`}
          >
            <Droplets className="w-3.5 h-3.5" />
            {showWaterManifold && hasPlacedWaterManifold
              ? 'Sposta Collettore Acqua'
              : showWaterManifold
                ? 'Posiziona Collettore Acqua'
                : '+ Inserisci Collettore Acqua'}
            {showWaterManifold && (
              <span className="font-mono text-[10px] opacity-75 ml-0.5">
                ({config.waterManifoldPosition.x}m, {config.waterManifoldPosition.y}m)
              </span>
            )}
          </button>
          {showWaterManifold && (
            <button
              type="button"
              onClick={() => {
                if (placeAction === 'water_manifold') setPlaceAction(null);
                onDeleteWaterManifold();
              }}
              title="Cancella Collettore Acqua dalla piantina"
              className="px-2.5 py-2 rounded-r-xl border border-sky-200 dark:border-sky-800 bg-red-50 dark:bg-red-950/40 hover:bg-red-600 text-red-600 dark:text-red-400 hover:text-white transition-colors cursor-pointer flex items-center"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="inline-flex items-stretch">
          <button
            type="button"
            onClick={() =>
              setPlaceAction(placeAction === 'heating_manifold' ? null : 'heating_manifold')
            }
            className={`px-3 py-2 border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
              showHeatingManifold ? 'rounded-l-xl border-r-0' : 'rounded-xl'
            } ${
              placeAction === 'heating_manifold'
                ? 'bg-rose-600 text-white border-rose-700 shadow-sm'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 hover:bg-rose-100'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            {showHeatingManifold && hasPlacedHeatingManifold
              ? 'Sposta Collettore Riscaldamento'
              : showHeatingManifold
                ? 'Posiziona Collettore Riscaldamento'
                : '+ Inserisci Collettore Riscaldamento'}
            {showHeatingManifold && (
              <span className="font-mono text-[10px] opacity-75 ml-0.5">
                ({config.heatingManifoldPosition.x}m, {config.heatingManifoldPosition.y}m)
              </span>
            )}
          </button>
          {showHeatingManifold && (
            <button
              type="button"
              onClick={() => {
                if (placeAction === 'heating_manifold') setPlaceAction(null);
                onDeleteHeatingManifold();
              }}
              title="Cancella Collettore Riscaldamento dalla piantina"
              className="px-2.5 py-2 rounded-r-xl border border-rose-200 dark:border-rose-800 bg-red-50 dark:bg-red-950/40 hover:bg-red-600 text-red-600 dark:text-red-400 hover:text-white transition-colors cursor-pointer flex items-center"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setPlaceAction(placeAction === 'panel' ? null : 'panel')}
          className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
            placeAction === 'panel'
              ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-100'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          Sposta Quadro Elettrico
        </button>

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block mx-0.5" />

        {/* Inserimento rapido Generatori e Terminali direttamente dallo schema */}
        <span className="text-[11px] text-slate-400 font-medium hidden xl:inline">
          Aggiungi in pianta:
        </span>
        {(
          [
            {
              action: 'add_heat_pump_monobloc',
              label: '+ PdC Acqua',
              icon: <PlusCircle className="w-3 h-3 text-sky-600" />,
            },
            {
              action: 'add_boiler',
              label: '+ Caldaia',
              icon: <PlusCircle className="w-3 h-3 text-orange-600" />,
            },
            {
              action: 'add_radiator',
              label: '+ Termosifone',
              icon: <Thermometer className="w-3 h-3 text-rose-600" />,
            },
            {
              action: 'add_ac_split_high',
              label: '+ Split',
              icon: <Wind className="w-3 h-3 text-cyan-600" />,
            },
          ] as {
            action: Exclude<BlueprintPlaceAction, null>;
            label: string;
            icon: React.ReactNode;
          }[]
        ).map((btn) => (
          <button
            key={btn.action}
            type="button"
            onClick={() => setPlaceAction(placeAction === btn.action ? null : btn.action)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
              placeAction === btn.action
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-400'
            }`}
          >
            {btn.icon}
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );

  const legendBar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2 text-[11px] text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800">
      <span className="inline-flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-300">
        <span className="inline-flex flex-col gap-0.5">
          <span className="w-6 h-1.5 bg-red-600 rounded-full block" />
          <span className="w-6 h-1.5 bg-blue-700 rounded-full block" />
        </span>
        Dorsale Primaria Ø{estimate.hvac.primaryTrunkDiameterMm} (PdC/Caldaia ↔ Coll. Risc.)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex flex-col gap-0.5">
          <span className="w-5 h-0.5 bg-red-500 rounded-full block" />
          <span className="w-5 h-0.5 bg-blue-500 rounded-full block" />
        </span>
        Diramazioni Risc. Ø16 (Coll. → Termosifoni/Split)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 border-t-2 border-dashed border-cyan-500 block" />
        Rame Frigo Split Gas (1/4&quot;+3/8&quot;)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 h-1 bg-sky-600 rounded-full block" />
        Acqua Fredda / Calda Ø16 + Dorsale ACS Ø20/26
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 border-t-2 border-dashed border-slate-500 block" />
        Scarichi Ø40/50/110
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 h-0.5 bg-yellow-500 rounded-full block" />
        Luce 1,5 mm²
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 border-t-2 border-dashed border-orange-500 block" />
        Prese 2,5 mm²
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 border-t-2 border-dashed border-purple-600 block" />
        Linea Potenza 4 mm²
      </span>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs p-3 md:p-5 flex flex-col">
        <div className="flex-1 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-3 min-h-0 shadow-2xl">
          {controlsBar}
          <div className="flex-1 min-h-0">{renderSvgPlan('h-full')}</div>
          {legendBar}
        </div>
      </div>
    );
  }

  return (
    <section className="p-4 md:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 shadow-xs">
      {controlsBar}
      {renderSvgPlan('h-[520px] md:h-[620px]')}
      {legendBar}
    </section>
  );
};

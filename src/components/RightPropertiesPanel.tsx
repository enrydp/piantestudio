/**
 * Pannello proprietà a destra, completo per tutti i 4 step del wizard:
 * - Step 0: Caricamento piantina (PNG/JPG/PDF), opacità, calibrazione scala, spessore/altezza muri e ispettore muro selezionato
 * - Step 1: Palette aperture rapide, ispettore larghezza/altezza/davanzale/verso apertura, duplica/elimina
 * - Step 2: Catalogo mobili ricercabile e filtrabile, ispettore colore/materiale/dimensioni/rotazione/upload .glb, avvisi collisione
 * - Step 3: Slider ora del giorno, modalità vista 3D, texture pavimento, colore pareti, export PNG / GLB / JSON
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Box,
  Camera,
  Copy,
  Crop,
  Download,
  FileJson,
  Hammer,
  Image as ImageIcon,
  Layers,
  RotateCcw,
  RotateCw,
  Ruler,
  Scissors,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { useProjectStore, generateId } from '../store/useProjectStore';
import type {
  CameraMode3D,
  DoorStyle,
  DoorSwing,
  FloorTextureType,
  FurnitureCatalogItem,
  FurnitureMaterial,
  OpeningType,
} from '../types/project';
import { OPENING_PRESETS } from '../types/project';
import { cmToMeters, formatMeters, metersToCm } from '../utils/scale';
import {
  detectFurnitureCollisions,
  getWallsBounds,
  wallLength,
} from '../utils/geometry';
import { FurnitureCatalogPanel } from './FurnitureCatalogPanel';
import { CmNumberInput } from './CmNumberInput';
import {
  AUTO_ROOM_OPTIONS,
  detectRoomBoxAtPoint,
  generateAutoFurnishLayout,
  type AutoRoomType,
} from '../utils/autoFurnish';
import { DEFAULT_FLOOR_COLORS } from '../utils/proceduralTextures';
import { detectRooms } from '../utils/rooms';

interface RightPropertiesPanelProps {
  onTriggerUploadFloorplan: () => void;
  onLoadSampleFloorplan: () => void;
  onExportPng: () => void;
  onExportGlb: () => void;
  onOpenAiPhotoModal: () => void;
}

const FLOOR_COLOR_PRESETS: Record<FloorTextureType, { name: string; hex: string }[]> = {
  parquet: [
    { name: 'Rovere miele', hex: '#b28150' },
    { name: 'Rovere chiaro', hex: '#cfa97e' },
    { name: 'Rovere sbiancato', hex: '#dfd0bc' },
    { name: 'Teak caldo', hex: '#9c5d36' },
    { name: 'Noce scuro', hex: '#6b4730' },
    { name: 'Wengé', hex: '#433126' },
  ],
  piastrelle: [
    { name: 'Grès sabbia', hex: '#d9cfc1' },
    { name: 'Bianco marmo', hex: '#f0eee9' },
    { name: 'Terracotta', hex: '#b86f52' },
    { name: 'Grigio pietra', hex: '#9da3a8' },
    { name: 'Antracite', hex: '#4b525a' },
    { name: 'Salvia', hex: '#a7b8a8' },
    { name: 'Blu ceramica', hex: '#8ca6bc' },
  ],
  cemento: [
    { name: 'Cemento naturale', hex: '#b2b6bc' },
    { name: 'Grigio chiaro', hex: '#d2d5d9' },
    { name: 'Tortora', hex: '#b8afa4' },
    { name: 'Antracite', hex: '#565c63' },
    { name: 'Bianco resina', hex: '#e6e7e9' },
    { name: 'Sabbia', hex: '#cfc5b4' },
  ],
};

const WALL_COLOR_PRESETS = [
  { name: 'Bianco caldo', hex: '#f5f2eb' },
  { name: 'Bianco puro', hex: '#ffffff' },
  { name: 'Sabbia', hex: '#e8dfd1' },
  { name: 'Grigio perla', hex: '#e2e6ea' },
  { name: 'Salvia', hex: '#dce5dc' },
  { name: 'Azzurro polvere', hex: '#dce6ee' },
];

const FURNITURE_COLOR_PRESETS = [
  '#5b6e82',
  '#b57c52',
  '#9e7146',
  '#4a7c59',
  '#cfd6df',
  '#e6e2da',
  '#334155',
  '#b95c48',
];

const SWING_OPTIONS: { value: DoorSwing; label: string }[] = [
  { value: 'left_in', label: 'Sinistra interno' },
  { value: 'right_in', label: 'Destra interno' },
  { value: 'left_out', label: 'Sinistra esterno' },
  { value: 'right_out', label: 'Destra esterno' },
];

const DOOR_STYLE_OPTIONS: { value: DoorStyle; label: string }[] = [
  { value: 'single', label: 'Battente (1 anta)' },
  { value: 'double', label: 'Doppia anta' },
  { value: 'sliding', label: 'Scorrevole' },
  { value: 'glass', label: 'Con vetro' },
];

const OPENING_COLOR_PRESETS = [
  { name: 'Bianco avorio', hex: '#f4efe6' },
  { name: 'Bianco puro', hex: '#f1f5f9' },
  { name: 'Rovere', hex: '#c89d6c' },
  { name: 'Noce', hex: '#7c5436' },
  { name: 'Legno scuro', hex: '#4f3524' },
  { name: 'Antracite', hex: '#334155' },
];

const MATERIAL_OPTIONS: { value: FurnitureMaterial; label: string }[] = [
  { value: 'wood', label: 'Legno' },
  { value: 'fabric', label: 'Tessuto' },
  { value: 'leather', label: 'Pelle' },
  { value: 'matte', label: 'Laccato opaco' },
  { value: 'metal', label: 'Metallo' },
  { value: 'ceramic', label: 'Ceramica' },
];

export const RightPropertiesPanel: React.FC<RightPropertiesPanelProps> = ({
  onTriggerUploadFloorplan,
  onLoadSampleFloorplan,
  onExportPng,
  onExportGlb,
  onOpenAiPhotoModal,
}) => {
  const {
    step,
    setStep,
    project,
    setActiveTool,
    activeOpeningType,
    setActiveOpeningType,
    activeDoorStyle,
    setActiveDoorStyle,
    activeOpeningColor,
    setActiveOpeningColor,
    defaultWallThickness,
    setDefaultWallThickness,
    defaultWallHeight,
    setDefaultWallHeight,
    wallOpacity,
    setWallOpacity,
    setFloorplan,
    setShowCropModal,
    setFloorplanOpacity,
    clearCalibrationPoints,
    selectedWallId,
    selectWall,
    updateWall,
    toggleDemolishWall,
    splitWall,
    applyDefaultHeightToAllWalls,
    autoAlignProjectWalls,
    restoreAllDemolishedWalls,
    deleteWall,
    clearAllWalls,
    selectedOpeningId,
    selectOpening,
    updateOpening,
    duplicateOpening,
    deleteOpening,
    selectedFurnitureIds,
    addFurnitureFromCatalog,
    addFurnitureBatch,
    selectAllFurniture,
    autoFurnishMode,
    setAutoFurnishMode,
    updateFurniture,
    rotateSelectedFurniture,
    copySelectedFurniture,
    deleteSelectedFurniture,
    setCameraMode,
    setFloorTexture,
    setFloorColor,
    setWallColor,
    setTimeOfDay,
    updateRenderSettings,
    selectedRoomId3D,
    setSelectedRoomId3D,
    exportProjectJson,
    showToast,
  } = useProjectStore();

  const glbInputRef = useRef<HTMLInputElement>(null);
  const [selectedAutoRoom, setSelectedAutoRoom] = useState<AutoRoomType>('soggiorno');

  const selectedWall = useMemo(
    () => project.walls.find((w) => w.id === selectedWallId) ?? null,
    [project.walls, selectedWallId]
  );

  const selectedOpening = useMemo(
    () => project.openings.find((o) => o.id === selectedOpeningId) ?? null,
    [project.openings, selectedOpeningId]
  );

  const selectedFurniture = useMemo(
    () =>
      selectedFurnitureIds.length === 1
        ? project.furniture.find((f) => f.id === selectedFurnitureIds[0]) ?? null
        : null,
    [project.furniture, selectedFurnitureIds]
  );

  const conflicts = useMemo(
    () => detectFurnitureCollisions(project.furniture, project.openings, project.walls),
    [project.furniture, project.openings, project.walls]
  );

  const detectedRooms = useMemo(
    () => detectRooms(project.walls, project.furniture),
    [project.walls, project.furniture]
  );

  const handleQuickAddFurniture = (item: FurnitureCatalogItem) => {
    const bounds = getWallsBounds(project.walls);
    // Posiziona ogni nuovo mobile in una griglia a spirale intorno al centro per evitare che si sovrappongano tutti sullo stesso punto
    const idx = project.furniture.length;
    const col = (idx % 4) - 1.5;
    const row = Math.floor(idx / 4) % 4 - 1.0;
    const x = Math.max(bounds.minX + 0.6, Math.min(bounds.maxX - 0.6, bounds.centerX + col * 0.9));
    const y = Math.max(bounds.minY + 0.6, Math.min(bounds.maxY - 0.6, bounds.centerY + row * 0.9));
    addFurnitureFromCatalog(item, Number(x.toFixed(2)), Number(y.toFixed(2)));
    showToast(`${item.nome} aggiunto nella pianta`, 'success');
  };

  const handleGlbUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedFurniture) return;
    const url = URL.createObjectURL(file);
    updateFurniture(selectedFurniture.id, {
      customGlbUrl: url,
      customGlbName: file.name,
    });
    showToast(`Modello 3D "${file.name}" collegato a ${selectedFurniture.name}`, 'success');
    e.target.value = '';
  };

  const handleExportProjectJson = () => {
    const data = exportProjectJson();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (project.name || 'progetto').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `${safeName}.piantestudio.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Progetto salvato in JSON!', 'success');
  };

  const formatHour = (h: number) => {
    const hh = Math.floor(h).toString().padStart(2, '0');
    const mm = Math.round((h % 1) * 60)
      .toString()
      .padStart(2, '0');
    return `${hh}:${mm}`;
  };

  return (
    <aside className="w-72 lg:w-80 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden z-20">
      {/* Intestazione pannello */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <Layers className="w-3.5 h-3.5 text-blue-600" />
          <span>
            {step === 0 && 'Piantina e Muri'}
            {step === 1 && 'Finestre e Aperture'}
            {step === 2 && 'Arredamento'}
            {step === 3 && 'Rendering 3D'}
            {step === 4 && 'Impianti e Vernice'}
          </span>
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          Step {step}/4
        </span>
      </div>

      {/* Corpo scrollabile */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-slate-600 dark:text-slate-300">
        {/* ================= STEP 0 ================= */}
        {step === 0 && (
          <>
            {/* Sezione Piantina */}
            <section className="space-y-2.5 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                  1. Immagine piantina
                </h3>
              </div>

              {project.floorplan ? (
                <div className="space-y-2.5">
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-[11px]">
                    <div className="font-medium text-slate-800 dark:text-slate-100 truncate">
                      {project.floorplan.fileName}
                    </div>
                    <div className="text-slate-400 mt-0.5">
                      {project.floorplan.widthPx} × {project.floorplan.heightPx} px
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span>Opacità piantina</span>
                      <span className="font-mono">
                        {Math.round(project.floorplan.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={project.floorplan.opacity}
                      onChange={(e) => setFloorplanOpacity(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span>Opacità muri (sfumatura)</span>
                      <span className="font-mono">{Math.round(wallOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={wallOpacity}
                      onChange={(e) => setWallOpacity(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowCropModal(true)}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Crop className="w-3.5 h-3.5" />
                    Ritaglia / Raddrizza piantina
                  </button>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={onTriggerUploadFloorplan}
                      className="py-1.5 px-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-blue-600" />
                      Cambia file
                    </button>
                    <button
                      type="button"
                      onClick={() => setFloorplan(null)}
                      className="py-1.5 px-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950 font-semibold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Cancella piantina
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={onTriggerUploadFloorplan}
                    className="w-full py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-blue-600" />
                    Carica PNG / PDF / DWG / DXF
                  </button>
                  <button
                    type="button"
                    onClick={onLoadSampleFloorplan}
                    className="w-full py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    Carica piantina d’esempio
                  </button>
                </div>
              )}
            </section>

            {/* Sezione Calibrazione */}
            <section className="space-y-2.5 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                  2. Calibrazione scala
                </h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    project.calibration.isCalibrated
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                  }`}
                >
                  {project.calibration.isCalibrated ? 'Calibrata' : 'Da calibrare'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Clicca due punti su una quota nota della piantina e inserisci la lunghezza in centimetri.
              </p>
              <button
                type="button"
                onClick={() => {
                  clearCalibrationPoints();
                  setActiveTool('calibrate');
                }}
                className="w-full py-2 px-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950 font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Ruler className="w-3.5 h-3.5" />
                {project.calibration.isCalibrated ? 'Ricalibra scala' : 'Avvia calibrazione (C)'}
              </button>
            </section>

            {/* Sezione Parametri Muri */}
            <section className="space-y-2.5 pb-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                3. Impostazioni muri
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500">Spessore (cm)</span>
                  <CmNumberInput
                    min={5}
                    max={80}
                    value={metersToCm(defaultWallThickness)}
                    onChangeValue={(cm) => setDefaultWallThickness(cmToMeters(cm))}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500">Altezza (cm)</span>
                  <CmNumberInput
                    min={100}
                    max={500}
                    value={metersToCm(defaultWallHeight)}
                    onChangeValue={(cm) => setDefaultWallHeight(cmToMeters(cm))}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-white"
                  />
                </label>
              </div>
              {project.walls.length > 0 && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={applyDefaultHeightToAllWalls}
                    className="w-full py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    Applica altezza ({metersToCm(defaultWallHeight)} cm) a tutti i muri
                  </button>
                  {project.walls.length >= 2 && (
                    <button
                      type="button"
                      onClick={autoAlignProjectWalls}
                      title="Raddrizza muri leggermente inclinati, taglia sporgenze troppo lunghe e chiude automaticamente angoli e giunzioni"
                      className="w-full py-2 px-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-950 text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Allinea e sistema muri (Auto)
                    </button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTool('wall')}
                  className="py-2 px-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950 font-semibold cursor-pointer"
                >
                  Disegna muri (W)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool('demolish')}
                  className="py-2 px-2 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950 font-semibold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Hammer className="w-3.5 h-3.5" />
                  Abbatti (D)
                </button>
              </div>
            </section>

            {/* Ispettore muro selezionato */}
            {selectedWall ? (
              <section
                className={`space-y-2.5 p-3 rounded-xl border ${
                  selectedWall.demolished
                    ? 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-800'
                    : 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`font-semibold ${
                      selectedWall.demolished
                        ? 'text-red-700 dark:text-red-300'
                        : 'text-blue-800 dark:text-blue-200'
                    }`}
                  >
                    {selectedWall.demolished ? 'Muro abbattuto' : 'Muro selezionato'}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-300">
                    {formatMeters(wallLength(selectedWall))}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500">Spessore (cm)</span>
                    <CmNumberInput
                      min={5}
                      max={80}
                      value={metersToCm(selectedWall.thickness)}
                      onChangeValue={(cm) =>
                        updateWall(selectedWall.id, { thickness: cmToMeters(cm) })
                      }
                      className="w-full px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500">Altezza (cm)</span>
                    <CmNumberInput
                      min={100}
                      max={500}
                      value={metersToCm(selectedWall.height)}
                      onChangeValue={(cm) =>
                        updateWall(selectedWall.id, { height: cmToMeters(cm) })
                      }
                      className="w-full px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                    />
                  </label>
                </div>

                {/* Azioni ristrutturazione: Abbatti/Ripristina e Dividi in 2 */}
                <button
                  type="button"
                  onClick={() => toggleDemolishWall(selectedWall.id)}
                  className={`w-full py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                    selectedWall.demolished
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-amber-600 hover:bg-amber-700 text-white'
                  }`}
                >
                  {selectedWall.demolished ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      Ripristina muro
                    </>
                  ) : (
                    <>
                      <Hammer className="w-3.5 h-3.5" />
                      Abbatti muro
                    </>
                  )}
                </button>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => splitWall(selectedWall.id)}
                    title="Divide il muro a metà per poter abbattere solo una parte"
                    className="py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium flex items-center justify-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    Dividi in 2
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteWall(selectedWall.id)}
                    title="Elimina definitivamente il muro"
                    className="py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Elimina
                  </button>
                </div>
              </section>
            ) : (
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Muri attivi:{' '}
                <strong>{project.walls.filter((w) => !w.demolished).length}</strong>
                {project.walls.some((w) => w.demolished) && (
                  <>
                    {' '}• Abbattuti:{' '}
                    <strong className="text-red-600 dark:text-red-400">
                      {project.walls.filter((w) => w.demolished).length}
                    </strong>
                  </>
                )}
                . Usa <strong>Abbatti (D)</strong> per demolire un muro con un click.
              </div>
            )}

            {/* Lista compatta muri */}
            {project.walls.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Elenco muri ({project.walls.length})
                  </span>
                  <div className="flex items-center gap-2">
                    {project.walls.some((w) => w.demolished) && (
                      <button
                        type="button"
                        onClick={restoreAllDemolishedWalls}
                        className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline font-medium cursor-pointer"
                      >
                        Ripristina
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={clearAllWalls}
                      title="Cancella tutti i muri mantenendo la piantina caricata"
                      className="text-[10px] text-red-600 dark:text-red-400 hover:underline font-medium cursor-pointer"
                    >
                      Cancella tutti
                    </button>
                  </div>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {project.walls.map((w, i) => (
                    <div
                      key={w.id}
                      className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between gap-1 text-[11px] ${
                        w.id === selectedWallId
                          ? 'bg-blue-600 text-white'
                          : w.demolished
                            ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200/70 dark:border-red-900'
                            : 'bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTool('select');
                          selectWall(w.id);
                        }}
                        className="flex-1 flex items-center justify-between text-left cursor-pointer"
                      >
                        <span className={w.demolished ? 'line-through' : ''}>
                          Muro #{i + 1}
                        </span>
                        <span className="font-mono text-[10px]">
                          {w.demolished ? 'Abbattuto' : formatMeters(wallLength(w))}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleDemolishWall(w.id)}
                        title={w.demolished ? 'Ripristina muro' : 'Abbatti muro'}
                        className={`p-1 rounded hover:bg-black/10 cursor-pointer ${
                          w.id === selectedWallId ? 'text-white' : ''
                        }`}
                      >
                        {w.demolished ? (
                          <RotateCcw className="w-3 h-3" />
                        ) : (
                          <Hammer className="w-3 h-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteWall(w.id)}
                        title="Elimina definitivamente questo muro"
                        className={`p-1 rounded hover:bg-red-500/20 cursor-pointer ${
                          w.id === selectedWallId ? 'text-white' : 'text-red-500'
                        }`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ================= STEP 1 ================= */}
        {step === 1 && (
          <>
            {/* Controllo sfumatura muri e piantina per posizionare porte e finestre con precisione */}
            {project.floorplan && (
              <section className="space-y-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="font-semibold text-slate-800 dark:text-slate-100">
                  Sfumatura muri e piantina
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  I muri sono sfumati così puoi vedere porte e finestre direttamente sulla piantina.
                </p>
                <div>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span>Opacità muri</span>
                    <span className="font-mono">{Math.round(wallOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={wallOpacity}
                    onChange={(e) => setWallOpacity(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span>Opacità piantina</span>
                    <span className="font-mono">
                      {Math.round(project.floorplan.opacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={project.floorplan.opacity}
                    onChange={(e) => setFloorplanOpacity(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>
              </section>
            )}

            <section className="space-y-2 pb-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Inserisci apertura
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Seleziona un elemento e clicca su un muro, oppure trascinalo direttamente dalla barra sinistra.
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {(Object.keys(OPENING_PRESETS) as OpeningType[]).map((type) => {
                  const p = OPENING_PRESETS[type];
                  const active = activeOpeningType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-piantestudio-opening', type);
                        setActiveOpeningType(type);
                      }}
                      onClick={() => setActiveOpeningType(type)}
                      className={`px-3 py-2 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                        active
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="font-medium">{p.label}</span>
                      <span className="text-[10px] font-mono opacity-75">
                        {metersToCm(p.width)}×{metersToCm(p.height)} cm
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Scelta modello e colore per le porte prima dell'inserimento */}
              {(activeOpeningType === 'door_internal' || activeOpeningType === 'door_entrance') && (
                <div className="pt-2 space-y-2 border-t border-slate-200/70 dark:border-slate-800">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 block">
                    Modello porta da inserire
                  </span>
                  <div className="grid grid-cols-2 gap-1">
                    {DOOR_STYLE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setActiveDoorStyle(opt.value)}
                        className={`py-1.5 px-2 rounded-lg text-[10px] font-semibold border transition-colors cursor-pointer ${
                          activeDoorStyle === opt.value
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="text-[10px] text-slate-500 mr-1">Finitura:</span>
                    {OPENING_COLOR_PRESETS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        title={c.name}
                        onClick={() => setActiveOpeningColor(c.hex)}
                        style={{ backgroundColor: c.hex }}
                        className={`w-5 h-5 rounded-md border cursor-pointer ${
                          activeOpeningColor.toLowerCase() === c.hex.toLowerCase()
                            ? 'ring-2 ring-blue-500 border-white'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Ispettore apertura selezionata */}
            {selectedOpening ? (
              <section className="space-y-3 p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                <div className="font-semibold text-blue-800 dark:text-blue-200">
                  Modifica apertura selezionata
                </div>

                {/* Cambio tipo apertura */}
                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-500">Tipo</span>
                  <select
                    value={selectedOpening.type}
                    onChange={(e) => {
                      const nextType = e.target.value as OpeningType;
                      const preset = OPENING_PRESETS[nextType];
                      updateOpening(selectedOpening.id, {
                        type: nextType,
                        width: preset.width,
                        height: preset.height,
                        sillHeight: preset.sillHeight,
                        doorStyle:
                          nextType === 'door_internal' || nextType === 'door_entrance'
                            ? selectedOpening.doorStyle ?? 'single'
                            : undefined,
                      });
                    }}
                    className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  >
                    {(Object.keys(OPENING_PRESETS) as OpeningType[]).map((t) => (
                      <option key={t} value={t}>
                        {OPENING_PRESETS[t].label}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Scelta modello porta */}
                {(selectedOpening.type === 'door_internal' ||
                  selectedOpening.type === 'door_entrance') && (
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-500">Modello porta</span>
                    <div className="grid grid-cols-2 gap-1">
                      {DOOR_STYLE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            updateOpening(selectedOpening.id, {
                              doorStyle: opt.value,
                              width:
                                opt.value === 'double' && selectedOpening.width < 1.2
                                  ? 1.4
                                  : selectedOpening.width,
                            })
                          }
                          className={`py-1 px-1.5 rounded-lg text-[10px] font-semibold border cursor-pointer ${
                            (selectedOpening.doorStyle ?? 'single') === opt.value
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Colore / finitura porta o infisso */}
                {selectedOpening.type !== 'arch' && (
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-500">Colore / Finitura</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <input
                        type="color"
                        value={selectedOpening.color ?? '#f4efe6'}
                        onChange={(e) =>
                          updateOpening(selectedOpening.id, { color: e.target.value })
                        }
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                      />
                      {OPENING_COLOR_PRESETS.map((c) => (
                        <button
                          key={c.hex}
                          type="button"
                          title={c.name}
                          onClick={() => updateOpening(selectedOpening.id, { color: c.hex })}
                          style={{ backgroundColor: c.hex }}
                          className={`w-5 h-5 rounded-md border cursor-pointer ${
                            (selectedOpening.color ?? '').toLowerCase() === c.hex.toLowerCase()
                              ? 'ring-2 ring-blue-500 border-white'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500">Larghezza (cm)</span>
                    <CmNumberInput
                      min={30}
                      max={400}
                      value={metersToCm(selectedOpening.width)}
                      onChangeValue={(cm) =>
                        updateOpening(selectedOpening.id, { width: cmToMeters(cm) })
                      }
                      className="w-full px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500">Altezza (cm)</span>
                    <CmNumberInput
                      min={40}
                      max={300}
                      value={metersToCm(selectedOpening.height)}
                      onChangeValue={(cm) =>
                        updateOpening(selectedOpening.id, { height: cmToMeters(cm) })
                      }
                      className="w-full px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-500">
                    Altezza da terra / davanzale (cm)
                  </span>
                  <CmNumberInput
                    min={0}
                    max={200}
                    value={metersToCm(selectedOpening.sillHeight)}
                    onChangeValue={(cm) =>
                      updateOpening(selectedOpening.id, { sillHeight: cmToMeters(cm) })
                    }
                    className="w-full px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </label>

                {OPENING_PRESETS[selectedOpening.type].hasSwing &&
                  selectedOpening.doorStyle !== 'sliding' && (
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-500">Verso di apertura</span>
                      <select
                        value={selectedOpening.swing}
                        onChange={(e) =>
                          updateOpening(selectedOpening.id, {
                            swing: e.target.value as DoorSwing,
                          })
                        }
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      >
                        {SWING_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => duplicateOpening(selectedOpening.id)}
                    className="py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Duplica
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteOpening(selectedOpening.id)}
                    className="py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Elimina
                  </button>
                </div>
              </section>
            ) : (
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Aperture inserite: <strong>{project.openings.length}</strong>. Usa{' '}
                <strong>Seleziona (V)</strong> per trascinare un’apertura lungo il muro o modificarne le dimensioni.
              </div>
            )}

            {/* Elenco aperture */}
            {project.openings.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Aperture presenti ({project.openings.length})
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {project.openings.map((op) => (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => {
                        setActiveTool('select');
                        selectOpening(op.id);
                      }}
                      className={`w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between text-[11px] cursor-pointer ${
                        op.id === selectedOpeningId
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{OPENING_PRESETS[op.type].label}</span>
                      <span className="font-mono text-[10px]">
                        {metersToCm(op.width)}×{metersToCm(op.height)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ================= STEP 2 ================= */}
        {step === 2 && (
          <>
            {/* Auto-arredamento opzionale per tipo di stanza */}
            <section className="space-y-2 p-3 rounded-xl bg-violet-50/70 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800/70">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-violet-900 dark:text-violet-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                  Auto-arredamento (opzionale)
                </h3>
              </div>
              <select
                value={selectedAutoRoom}
                onChange={(e) => setSelectedAutoRoom(e.target.value as AutoRoomType)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 text-xs text-slate-800 dark:text-slate-100"
              >
                {AUTO_ROOM_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                {AUTO_ROOM_OPTIONS.find((o) => o.id === selectedAutoRoom)?.desc}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setAutoFurnishMode(autoFurnishMode === selectedAutoRoom ? null : selectedAutoRoom)
                  }
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                    autoFurnishMode === selectedAutoRoom
                      ? 'bg-amber-500 text-white'
                      : 'bg-violet-600 hover:bg-violet-700 text-white'
                  }`}
                >
                  {autoFurnishMode === selectedAutoRoom ? 'Annulla click' : 'Clicca nella stanza'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const bounds = getWallsBounds(project.walls);
                    const box = detectRoomBoxAtPoint(
                      { x: bounds.centerX, y: bounds.centerY },
                      project.walls
                    );
                    const items = generateAutoFurnishLayout(selectedAutoRoom, box, generateId);
                    const opt = AUTO_ROOM_OPTIONS.find((o) => o.id === selectedAutoRoom);
                    addFurnitureBatch(items, opt?.label);
                  }}
                  className="py-1.5 px-2 rounded-lg bg-white dark:bg-slate-900 border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950 text-[11px] font-semibold cursor-pointer"
                >
                  Arreda subito
                </button>
              </div>
              {project.furniture.length > 0 && (
                <button
                  type="button"
                  onClick={selectAllFurniture}
                  className="w-full py-1.5 px-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Seleziona tutti i mobili ({project.furniture.length}) per spostarli insieme
                </button>
              )}
            </section>

            <FurnitureCatalogPanel onQuickAdd={handleQuickAddFurniture} />

            <div className="h-px bg-slate-200 dark:bg-slate-800" />

            {/* Ispettore mobile selezionato */}
            {selectedFurniture ? (
              <section className="space-y-3 p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-blue-800 dark:text-blue-200 truncate">
                    {selectedFurniture.name}
                  </span>
                  <span className="text-[10px] text-slate-500">{selectedFurniture.category}</span>
                </div>

                {conflicts[selectedFurniture.id] && (
                  <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950/70 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 text-[11px] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{conflicts[selectedFurniture.id]}</span>
                  </div>
                )}

                {/* Scelta lato prima rampa per scale a L e a U */}
                {(selectedFurniture.geometryType === 'stairs_l' ||
                  selectedFurniture.geometryType === 'stairs_u') && (
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-500">Prima rampa (salita)</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { value: 'left', label: 'Sinistra' },
                          { value: 'right', label: 'Destra' },
                        ] as const
                      ).map((opt) => {
                        const active =
                          (selectedFurniture.stairsFirstFlight ?? 'left') === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              updateFurniture(selectedFurniture.id, {
                                stairsFirstFlight: opt.value,
                              })
                            }
                            className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                              active
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Scelta lato angolo / penisola per mobili a L */}
                {(selectedFurniture.geometryType === 'kitchen_l' ||
                  selectedFurniture.geometryType === 'kitchen_peninsula' ||
                  selectedFurniture.geometryType === 'sofa_l' ||
                  selectedFurniture.geometryType === 'wardrobe_corner') && (
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-500">Lato angolo / penisola</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { value: false, label: 'Sinistra' },
                          { value: true, label: 'Destra' },
                        ] as const
                      ).map((opt) => {
                        const active = Boolean(selectedFurniture.mirrored) === opt.value;
                        return (
                          <button
                            key={String(opt.value)}
                            type="button"
                            onClick={() =>
                              updateFurniture(selectedFurniture.id, {
                                mirrored: opt.value,
                              })
                            }
                            className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                              active
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Colore e Materiale */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-slate-500">Colore</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <input
                      type="color"
                      value={selectedFurniture.color}
                      onChange={(e) =>
                        updateFurniture(selectedFurniture.id, { color: e.target.value })
                      }
                      className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                      title="Scegli colore personalizzato"
                    />
                    {FURNITURE_COLOR_PRESETS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => updateFurniture(selectedFurniture.id, { color: hex })}
                        style={{ backgroundColor: hex }}
                        className={`w-5 h-5 rounded-md border cursor-pointer ${
                          selectedFurniture.color.toLowerCase() === hex.toLowerCase()
                            ? 'ring-2 ring-blue-500 border-white'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-500">Materiale</span>
                  <select
                    value={selectedFurniture.material}
                    onChange={(e) =>
                      updateFurniture(selectedFurniture.id, {
                        material: e.target.value as FurnitureMaterial,
                      })
                    }
                    className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  >
                    {MATERIAL_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Dimensioni cm */}
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="space-y-1">
                    <span className="text-[10px] text-slate-500">Largh. (cm)</span>
                    <CmNumberInput
                      min={15}
                      max={600}
                      value={metersToCm(selectedFurniture.width)}
                      onChangeValue={(cm) =>
                        updateFurniture(selectedFurniture.id, { width: cmToMeters(cm) })
                      }
                      className="w-full px-1.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-slate-500">Prof. (cm)</span>
                    <CmNumberInput
                      min={15}
                      max={600}
                      value={metersToCm(selectedFurniture.depth)}
                      onChangeValue={(cm) =>
                        updateFurniture(selectedFurniture.id, { depth: cmToMeters(cm) })
                      }
                      className="w-full px-1.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-slate-500">Alt. (cm)</span>
                    <CmNumberInput
                      min={1}
                      max={300}
                      value={metersToCm(selectedFurniture.height)}
                      onChangeValue={(cm) =>
                        updateFurniture(selectedFurniture.id, { height: cmToMeters(cm) })
                      }
                      className="w-full px-1.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px]"
                    />
                  </label>
                </div>

                {/* Rotazione */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Rotazione</span>
                    <span className="font-mono font-semibold">
                      {Math.round(selectedFurniture.rotation)}°
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={355}
                      step={5}
                      value={Math.round(selectedFurniture.rotation)}
                      onChange={(e) =>
                        updateFurniture(
                          selectedFurniture.id,
                          { rotation: Number(e.target.value) },
                          false
                        )
                      }
                      className="flex-1 accent-blue-600"
                    />
                    <button
                      type="button"
                      onClick={() => rotateSelectedFurniture(90)}
                      title="Ruota +90°"
                      className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCw className="w-3 h-3" />
                      90°
                    </button>
                  </div>
                </div>

                {/* Caricamento opzionale modello .glb personalizzato */}
                <div className="pt-1 border-t border-blue-200/70 dark:border-blue-800/70 space-y-1.5">
                  <input
                    ref={glbInputRef}
                    type="file"
                    accept=".glb"
                    onChange={handleGlbUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => glbInputRef.current?.click()}
                    className="w-full py-1.5 px-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-medium flex items-center justify-center gap-1.5 hover:border-blue-400 cursor-pointer"
                  >
                    <Box className="w-3.5 h-3.5 text-indigo-500" />
                    {selectedFurniture.customGlbName
                      ? `GLB: ${selectedFurniture.customGlbName}`
                      : 'Carica modello 3D (.glb) opzionale'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={copySelectedFurniture}
                    className="py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copia
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedFurniture}
                    className="py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Elimina
                  </button>
                </div>
              </section>
            ) : selectedFurnitureIds.length > 1 ? (
              <section className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-2">
                <div className="font-semibold text-blue-800 dark:text-blue-200">
                  {selectedFurnitureIds.length} mobili selezionati
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => rotateSelectedFurniture(15)}
                    className="py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium cursor-pointer"
                  >
                    Ruota +15°
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedFurniture}
                    className="py-1.5 rounded-lg bg-red-600 text-white font-medium cursor-pointer"
                  >
                    Elimina tutti
                  </button>
                </div>
              </section>
            ) : (
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Mobili posizionati: <strong>{project.furniture.length}</strong>. Clicca un mobile (o usa Shift+click / riquadro) per modificarlo.
              </div>
            )}
          </>
        )}

        {/* ================= STEP 3 ================= */}
        {step === 3 && (
          <>
            {/* Scelta Ambiente: Tutta la casa oppure Singola stanza */}
            {detectedRooms.length > 0 && (
              <section className="space-y-2 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-blue-600" />
                    Ambiente da visualizzare
                  </h3>
                  <span className="text-[10px] text-slate-400">
                    {detectedRooms.length} {detectedRooms.length === 1 ? 'stanza' : 'stanze'}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedRoomId3D(null)}
                    className={`px-2.5 py-2 rounded-xl border text-left text-[11px] font-semibold flex items-center justify-between transition-all cursor-pointer ${
                      !selectedRoomId3D || !detectedRooms.some((r) => r.id === selectedRoomId3D)
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>Tutta la casa</span>
                    <span className="text-[10px] font-mono opacity-80">
                      {detectedRooms.reduce((s, r) => s + r.areaSqm, 0).toFixed(1)} m²
                    </span>
                  </button>
                  <div className="grid grid-cols-2 gap-1.5">
                    {detectedRooms.map((rm) => {
                      const active = selectedRoomId3D === rm.id;
                      return (
                        <button
                          key={rm.id}
                          type="button"
                          onClick={() => setSelectedRoomId3D(rm.id)}
                          className={`px-2 py-1.5 rounded-xl border text-left transition-all cursor-pointer ${
                            active
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="text-[11px] font-semibold truncate">{rm.name}</div>
                          <div
                            className={`text-[10px] font-mono ${
                              active ? 'text-blue-100' : 'text-slate-400'
                            }`}
                          >
                            {rm.areaSqm} m²
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* Illuminazione e ora del giorno */}
            <section className="space-y-2.5 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Sun className="w-4 h-4 text-amber-500" />
                  Luce solare
                </h3>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                  {formatHour(project.renderSettings.timeOfDay)}
                </span>
              </div>
              <input
                type="range"
                min={6}
                max={20.5}
                step={0.25}
                value={project.renderSettings.timeOfDay}
                onChange={(e) => setTimeOfDay(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Alba 06:00</span>
                <span>Mezzogiorno</span>
                <span>Tramonto 20:30</span>
              </div>
            </section>

            {/* Modalità di vista */}
            <section className="space-y-2 pb-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-blue-600" />
                Modalità di vista
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { id: 'orbit', label: 'Orbita libera' },
                    { id: 'top', label: "Vista dall'alto" },
                    { id: 'dollhouse', label: 'Casa di bambola' },
                    { id: 'first_person', label: 'Prima persona' },
                  ] as { id: CameraMode3D; label: string }[]
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setCameraMode(m.id)}
                    className={`py-2 px-2 rounded-xl border text-[11px] font-medium transition-all cursor-pointer ${
                      project.renderSettings.cameraMode === m.id
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {project.renderSettings.cameraMode === 'first_person' && (
                <p className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 p-2 rounded-lg">
                  Usa i tasti <strong>W A S D</strong> (o le frecce) per camminare e trascina con il mouse per guardarti intorno.
                </p>
              )}
            </section>

            {/* Finiture: Pavimento (Texture + Colore) e Colore pareti */}
            <section className="space-y-3 pb-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Finiture e materiali
              </h3>

              {/* Blocco Pavimento */}
              <div className="p-2.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/70 space-y-2.5">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                    Texture pavimento
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'parquet', label: 'Parquet', swatch: '#b28150' },
                        { id: 'piastrelle', label: 'Piastrelle', swatch: '#d9cfc1' },
                        { id: 'cemento', label: 'Cemento', swatch: '#b2b6bc' },
                      ] as { id: FloorTextureType; label: string; swatch: string }[]
                    ).map((tex) => (
                      <button
                        key={tex.id}
                        type="button"
                        onClick={() => setFloorTexture(tex.id)}
                        className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                          project.renderSettings.floorTexture === tex.id
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 font-semibold text-blue-700 dark:text-blue-300'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div
                          className="w-full h-5 rounded-md mb-1 border border-black/10"
                          style={{
                            backgroundColor:
                              project.renderSettings.floorTexture === tex.id
                                ? project.renderSettings.floorColor || tex.swatch
                                : tex.swatch,
                          }}
                        />
                        <span className="text-[10px]">{tex.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Colore pavimento (dedicato a piastrelle / parquet / cemento) */}
                {(() => {
                  const activeTex = project.renderSettings.floorTexture;
                  const activeFloorColor =
                    project.renderSettings.floorColor || DEFAULT_FLOOR_COLORS[activeTex];
                  const presets = FLOOR_COLOR_PRESETS[activeTex];
                  const colorLabel =
                    activeTex === 'piastrelle'
                      ? 'Colore piastrelle (pavimento)'
                      : activeTex === 'parquet'
                        ? 'Colore parquet (pavimento)'
                        : 'Colore cemento (pavimento)';
                  return (
                    <div className="space-y-1.5 pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {colorLabel}
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <input
                          type="color"
                          value={activeFloorColor}
                          onChange={(e) => setFloorColor(e.target.value)}
                          className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                          title="Colore pavimento personalizzato"
                        />
                        {presets.map((c) => (
                          <button
                            key={c.hex}
                            type="button"
                            title={c.name}
                            onClick={() => setFloorColor(c.hex)}
                            style={{ backgroundColor: c.hex }}
                            className={`w-6 h-6 rounded-md border cursor-pointer ${
                              activeFloorColor.toLowerCase() === c.hex.toLowerCase()
                                ? 'ring-2 ring-blue-500 border-blue-500'
                                : 'border-slate-300 dark:border-slate-600'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Blocco Pareti */}
              <div className="p-2.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/70 space-y-1.5">
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Colore pareti (muri)
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input
                    type="color"
                    value={project.renderSettings.wallColor}
                    onChange={(e) => setWallColor(e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                    title="Colore pareti personalizzato"
                  />
                  {WALL_COLOR_PRESETS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.name}
                      onClick={() => setWallColor(c.hex)}
                      style={{ backgroundColor: c.hex }}
                      className={`w-6 h-6 rounded-md border cursor-pointer ${
                        project.renderSettings.wallColor.toLowerCase() === c.hex.toLowerCase()
                          ? 'ring-2 ring-blue-500 border-blue-500'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between pt-1 cursor-pointer">
                <span className="text-[11px] text-slate-600 dark:text-slate-300">
                  Mostra griglia metrica 3D
                </span>
                <input
                  type="checkbox"
                  checked={project.renderSettings.showGrid3D}
                  onChange={(e) => updateRenderSettings({ showGrid3D: e.target.checked })}
                  className="accent-blue-600 rounded"
                />
              </label>

              {project.walls.some((w) => w.demolished) && (
                <label className="flex items-center justify-between pt-1 cursor-pointer">
                  <span className="text-[11px] text-red-600 dark:text-red-400">
                    Mostra traccia muri abbattuti
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(project.renderSettings.showDemolishedWalls3D)}
                    onChange={(e) =>
                      updateRenderSettings({ showDemolishedWalls3D: e.target.checked })
                    }
                    className="accent-red-600 rounded"
                  />
                </label>
              )}
            </section>

            {/* Esportazioni e Foto Realistica AI */}
            <section className="space-y-2">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Foto AI ed Esportazione
              </h3>
              <button
                type="button"
                onClick={onOpenAiPhotoModal}
                className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white font-semibold flex items-center justify-center gap-2 shadow-sm cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                Crea Foto Realistica con AI
              </button>
              <button
                type="button"
                onClick={onExportPng}
                className="w-full py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-2 shadow-sm cursor-pointer"
              >
                <ImageIcon className="w-4 h-4" />
                Salva immagine (PNG)
              </button>
              <button
                type="button"
                onClick={onExportGlb}
                className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center justify-center gap-2 shadow-sm cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Esporta modello 3D (.glb)
              </button>
              <button
                type="button"
                onClick={handleExportProjectJson}
                className="w-full py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <FileJson className="w-4 h-4 text-emerald-600" />
                Salva progetto (.json)
              </button>
            </section>
          </>
        )}
      </div>

      {/* Navigazione Avanti / Indietro del wizard in basso al pannello destro */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex items-center gap-2">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((step - 1) as 0 | 1 | 2 | 3)}
            className="py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Indietro
          </button>
        )}
        {step < 4 && (
          <button
            type="button"
            onClick={() => setStep((step + 1) as 1 | 2 | 3 | 4)}
            className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>
              {step === 0 && 'Passa alle Aperture'}
              {step === 1 && 'Passa all’Arredamento'}
              {step === 2 && 'Apri Rendering 3D'}
              {step === 3 && 'Impianti & Vernice'}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </aside>
  );
};

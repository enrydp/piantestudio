/**
 * Toolbar verticale a sinistra, adattata dinamicamente allo step corrente del wizard.
 * Ogni strumento include icona, tooltip descrittivo e indicazione della scorciatoia.
 */
import React from 'react';
import {
  Camera,
  Copy,
  Crop,
  DoorClosed,
  DoorOpen,
  Eye,
  Footprints,
  Grid,
  Hammer,
  Hand,
  Home,
  ImageOff,
  Magnet,
  MousePointer2,
  PenTool,
  RotateCcw,
  RotateCw,
  Ruler,
  Square,
  Trash2,
  ClipboardPaste,
  Columns2,
  LayoutGrid,
  Upload,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import type { CameraMode3D, OpeningType } from '../types/project';
import { OPENING_PRESETS } from '../types/project';

interface LeftToolbarProps {
  onTriggerUploadFloorplan?: () => void;
}

interface ToolButtonProps {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  danger?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

const ToolButton: React.FC<ToolButtonProps> = ({
  active,
  disabled,
  onClick,
  title,
  label,
  shortcut,
  icon,
  danger,
  draggable,
  onDragStart,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    draggable={draggable}
    onDragStart={onDragStart}
    title={shortcut ? `${title} (${shortcut})` : title}
    className={`w-full flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl text-[10px] font-medium transition-all cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
      active
        ? 'bg-blue-600 text-white shadow-sm'
        : danger
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`}
  >
    {icon}
    <span className="leading-tight text-center">{label}</span>
  </button>
);

export const LeftToolbar: React.FC<LeftToolbarProps> = ({ onTriggerUploadFloorplan }) => {
  const {
    step,
    activeTool,
    setActiveTool,
    activeOpeningType,
    setActiveOpeningType,
    snapAngles,
    setSnapAngles,
    snapToGrid,
    setSnapToGrid,
    snapToWalls,
    setSnapToWalls,
    selectedWallId,
    setFloorplan,
    setShowCropModal,
    toggleDemolishWall,
    deleteWall,
    selectedOpeningId,
    duplicateOpening,
    deleteOpening,
    selectedFurnitureIds,
    rotateSelectedFurniture,
    copySelectedFurniture,
    pasteFurniture,
    clipboardFurniture,
    deleteSelectedFurniture,
    project,
    setCameraMode,
  } = useProjectStore();

  const openingButtons: { type: OpeningType; icon: React.ReactNode }[] = [
    { type: 'door_internal', icon: <DoorOpen className="w-4 h-4" /> },
    { type: 'door_entrance', icon: <DoorClosed className="w-4 h-4" /> },
    { type: 'window', icon: <LayoutGrid className="w-4 h-4" /> },
    { type: 'french_window', icon: <Columns2 className="w-4 h-4" /> },
    { type: 'arch', icon: <Square className="w-4 h-4 rounded-t-full" /> },
  ];

  const cameraModes: { mode: CameraMode3D; label: string; title: string; icon: React.ReactNode }[] = [
    {
      mode: 'orbit',
      label: 'Orbita',
      title: 'Vista orbita libera 3D',
      icon: <Camera className="w-4 h-4" />,
    },
    {
      mode: 'top',
      label: 'Dall’alto',
      title: 'Vista ortogonale dall’alto',
      icon: <Eye className="w-4 h-4" />,
    },
    {
      mode: 'dollhouse',
      label: 'Bambola',
      title: 'Vista casa di bambola (tetto nascosto)',
      icon: <Home className="w-4 h-4" />,
    },
    {
      mode: 'first_person',
      label: '1ª Pers.',
      title: 'Cammina dentro casa con WASD',
      icon: <Footprints className="w-4 h-4" />,
    },
  ];

  return (
    <aside className="w-[76px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 flex flex-col gap-1.5 overflow-y-auto select-none z-20">
      {/* Strumenti di navigazione base (Step 0, 1, 2) */}
      {step < 3 && (
        <>
          <ToolButton
            active={activeTool === 'select'}
            onClick={() => setActiveTool('select')}
            title="Seleziona e sposta elementi"
            label="Seleziona"
            shortcut="V"
            icon={<MousePointer2 className="w-4 h-4" />}
          />
          <ToolButton
            active={activeTool === 'pan'}
            onClick={() => setActiveTool('pan')}
            title="Sposta la vista (trascina il canvas)"
            label="Sposta"
            shortcut="H"
            icon={<Hand className="w-4 h-4" />}
          />
          <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />
        </>
      )}

      {/* STEP 0: Caricamento, Calibrazione, Polilinea Muri */}
      {step === 0 && (
        <>
          <ToolButton
            onClick={() => onTriggerUploadFloorplan?.()}
            title="Carica o sostituisci immagine PNG/JPG o PDF della piantina"
            label="Carica"
            icon={<Upload className="w-4 h-4" />}
          />
          {project.floorplan && (
            <>
              <ToolButton
                onClick={() => setShowCropModal(true)}
                title="Ritaglia o raddrizza la piantina (allineamento 2 click, rotazione fine e rimozione bordi)"
                label="Ritaglia"
                icon={<Crop className="w-4 h-4" />}
              />
              <ToolButton
                danger
                onClick={() => setFloorplan(null)}
                title="Cancella la piantina caricata"
                label="Cancella"
                icon={<ImageOff className="w-4 h-4" />}
              />
            </>
          )}
          <ToolButton
            active={activeTool === 'calibrate'}
            onClick={() => setActiveTool('calibrate')}
            title="Calibra scala cliccando due punti su una misura nota"
            label="Calibra"
            shortcut="C"
            icon={<Ruler className="w-4 h-4" />}
          />
          <ToolButton
            active={activeTool === 'wall'}
            onClick={() => setActiveTool('wall')}
            title="Disegna un muro cliccando punto iniziale e punto finale (tieni Shift per disattivare snap 90°)"
            label="Muri"
            shortcut="W"
            icon={<PenTool className="w-4 h-4" />}
          />
          <ToolButton
            active={activeTool === 'demolish'}
            danger={activeTool !== 'demolish'}
            onClick={() => setActiveTool('demolish')}
            title="Abbatti o ripristina un muro con un click (ristrutturazione)"
            label="Abbatti"
            shortcut="D"
            icon={<Hammer className="w-4 h-4" />}
          />

          <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />

          <ToolButton
            active={snapAngles}
            onClick={() => setSnapAngles(!snapAngles)}
            title="Snap angoli 90° durante la tracciatura (disattivabile con Shift)"
            label="Snap 90°"
            icon={<Magnet className="w-4 h-4" />}
          />

          {selectedWallId && (
            <>
              <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />
              <ToolButton
                danger
                onClick={() => toggleDemolishWall(selectedWallId)}
                title="Abbatti o ripristina il muro selezionato"
                label={
                  project.walls.find((w) => w.id === selectedWallId)?.demolished
                    ? 'Ripristina'
                    : 'Abbatti'
                }
                icon={<Hammer className="w-4 h-4" />}
              />
              <ToolButton
                danger
                onClick={() => deleteWall(selectedWallId)}
                title="Elimina definitivamente il muro selezionato"
                label="Elimina"
                shortcut="Canc"
                icon={<Trash2 className="w-4 h-4" />}
              />
            </>
          )}
        </>
      )}

      {/* STEP 1: Palette Aperture (click o drag sul muro) */}
      {step === 1 && (
        <>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 text-center">
            Trascina o clicca
          </div>
          {openingButtons.map(({ type, icon }) => {
            const preset = OPENING_PRESETS[type];
            return (
              <ToolButton
                key={type}
                active={activeTool === 'place_opening' && activeOpeningType === type}
                onClick={() => setActiveOpeningType(type)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-piantestudio-opening', type);
                  e.dataTransfer.effectAllowed = 'copy';
                  setActiveOpeningType(type);
                }}
                title={`${preset.label} (${Math.round(preset.width * 100)}×${Math.round(preset.height * 100)} cm) — trascina su un muro o clicca`}
                label={preset.shortLabel}
                icon={icon}
              />
            );
          })}

          {selectedOpeningId && (
            <>
              <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />
              <ToolButton
                onClick={() => duplicateOpening(selectedOpeningId)}
                title="Duplica apertura selezionata"
                label="Duplica"
                shortcut="Ctrl+D"
                icon={<Copy className="w-4 h-4" />}
              />
              <ToolButton
                danger
                onClick={() => deleteOpening(selectedOpeningId)}
                title="Elimina apertura selezionata"
                label="Elimina"
                shortcut="Canc"
                icon={<Trash2 className="w-4 h-4" />}
              />
            </>
          )}
        </>
      )}

      {/* STEP 2: Arredamento */}
      {step === 2 && (
        <>
          <ToolButton
            active={snapToGrid}
            onClick={() => setSnapToGrid(!snapToGrid)}
            title="Aggancia i mobili alla griglia (10 cm)"
            label="Griglia"
            icon={<Grid className="w-4 h-4" />}
          />
          <ToolButton
            active={snapToWalls}
            onClick={() => setSnapToWalls(!snapToWalls)}
            title="Aggancia automaticamente i mobili ai muri vicini"
            label="Snap Muri"
            icon={<Magnet className="w-4 h-4" />}
          />

          <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />

          <ToolButton
            disabled={selectedFurnitureIds.length === 0}
            onClick={() => rotateSelectedFurniture(-15)}
            title="Ruota in senso antiorario di 15°"
            label="-15°"
            shortcut="Shift+R"
            icon={<RotateCcw className="w-4 h-4" />}
          />
          <ToolButton
            disabled={selectedFurnitureIds.length === 0}
            onClick={() => rotateSelectedFurniture(15)}
            title="Ruota in senso orario di 15°"
            label="+15°"
            shortcut="R"
            icon={<RotateCw className="w-4 h-4" />}
          />
          <ToolButton
            disabled={selectedFurnitureIds.length === 0}
            onClick={copySelectedFurniture}
            title="Copia mobili selezionati"
            label="Copia"
            shortcut="Ctrl+C"
            icon={<Copy className="w-4 h-4" />}
          />
          <ToolButton
            disabled={clipboardFurniture.length === 0}
            onClick={pasteFurniture}
            title="Incolla mobili copiati"
            label="Incolla"
            shortcut="Ctrl+V"
            icon={<ClipboardPaste className="w-4 h-4" />}
          />
          <ToolButton
            danger
            disabled={selectedFurnitureIds.length === 0}
            onClick={deleteSelectedFurniture}
            title="Elimina mobili selezionati"
            label="Elimina"
            shortcut="Canc"
            icon={<Trash2 className="w-4 h-4" />}
          />
        </>
      )}

      {/* STEP 3: Modalità Vista 3D */}
      {step === 3 && (
        <>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 text-center">
            Vista 3D
          </div>
          {cameraModes.map((cam) => (
            <ToolButton
              key={cam.mode}
              active={project.renderSettings.cameraMode === cam.mode}
              onClick={() => setCameraMode(cam.mode)}
              title={cam.title}
              label={cam.label}
              icon={cam.icon}
            />
          ))}
        </>
      )}
    </aside>
  );
};

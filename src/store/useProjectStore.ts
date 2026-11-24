/**
 * Store globale Zustand di PianteStudio.
 * Gestisce:
 * - Stato del progetto (piantina, calibrazione, muri, aperture, mobili, impostazioni 3D)
 * - Stack completo di Undo/Redo funzionante in tutti i 4 step
 * - Persistenza automatica su localStorage + Export/Import JSON
 * - Selezione (singola e multipla), clipboard (copia/incolla), strumenti 2D e tema chiaro/scuro
 */
import { create } from 'zustand';
import type {
  CalibrationData,
  CameraMode3D,
  DoorStyle,
  DoorSwing,
  EditorTool,
  FloorplanImage,
  FloorTextureType,
  Furniture,
  FurnitureCatalogItem,
  Opening,
  OpeningType,
  Point2D,
  ProjectData,
  RenderSettings,
  Wall,
  WizardStep,
} from '../types/project';
import { OPENING_PRESETS } from '../types/project';
import { autoAlignWalls } from '../utils/geometry';
import { DEFAULT_FLOOR_COLORS } from '../utils/proceduralTextures';
import type { AutoRoomType } from '../utils/autoFurnish';

const STORAGE_KEY = 'piantestudio_project_v1';
const THEME_KEY = 'piantestudio_theme_v1';
const MAX_HISTORY = 80;

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const DEFAULT_CALIBRATION: CalibrationData = {
  pointA: null,
  pointB: null,
  realLengthCm: null,
  pixelsPerMeter: 100,
  isCalibrated: false,
};

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  timeOfDay: 11.5,
  cameraMode: 'dollhouse',
  floorTexture: 'parquet',
  floorColor: DEFAULT_FLOOR_COLORS.parquet,
  wallColor: '#f5f2eb',
  showGrid3D: false,
  showDemolishedWalls3D: false,
};

export function createEmptyProject(): ProjectData {
  return {
    name: 'Nuovo Progetto',
    version: '1.0',
    floorplan: null,
    calibration: { ...DEFAULT_CALIBRATION },
    walls: [],
    openings: [],
    furniture: [],
    renderSettings: { ...DEFAULT_RENDER_SETTINGS },
  };
}

function cloneProject(p: ProjectData): ProjectData {
  // Evita di duplicare con JSON.stringify l'intera stringa base64 della piantina a ogni singolo click!
  return {
    ...p,
    floorplan: p.floorplan ? { ...p.floorplan } : null,
    calibration: {
      ...p.calibration,
      pointA: p.calibration.pointA ? { ...p.calibration.pointA } : null,
      pointB: p.calibration.pointB ? { ...p.calibration.pointB } : null,
    },
    walls: p.walls.map((w) => ({
      ...w,
      start: { ...w.start },
      end: { ...w.end },
    })),
    openings: p.openings.map((o) => ({ ...o })),
    furniture: p.furniture.map((f) => ({ ...f })),
    renderSettings: { ...p.renderSettings },
  };
}

let persistTimer: number | null = null;

function loadFromStorage(): ProjectData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyProject();
    const parsed = JSON.parse(raw) as Partial<ProjectData>;
    return {
      ...createEmptyProject(),
      ...parsed,
      calibration: { ...DEFAULT_CALIBRATION, ...(parsed.calibration ?? {}) },
      renderSettings: { ...DEFAULT_RENDER_SETTINGS, ...(parsed.renderSettings ?? {}) },
      walls: Array.isArray(parsed.walls) ? parsed.walls : [],
      openings: Array.isArray(parsed.openings) ? parsed.openings : [],
      furniture: Array.isArray(parsed.furniture) ? parsed.furniture : [],
    };
  } catch {
    return createEmptyProject();
  }
}

function persistToStorage(project: ProjectData): void {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      // Se l'immagine è molto grande per localStorage, salva almeno la geometria senza dataUrl
      try {
        const slim: ProjectData = { ...project, floorplan: null };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
      } catch {
        // Ignora errori quota localStorage
      }
    }
  }, 250);
}

function loadTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore
  }
  return 'light';
}

export interface ToastMessage {
  id: string;
  text: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface ProjectStore {
  // Stato progetto e cronologia Undo/Redo
  project: ProjectData;
  past: ProjectData[];
  future: ProjectData[];

  // Navigazione Wizard e UI
  step: WizardStep;
  theme: 'light' | 'dark';
  activeTool: EditorTool;
  activeOpeningType: OpeningType;
  activeDoorStyle: DoorStyle;
  activeOpeningColor: string;
  draggingCatalogItem: FurnitureCatalogItem | null;
  autoFurnishMode: AutoRoomType | null;

  // Preferenze strumenti
  defaultWallThickness: number; // metri (default 0.20)
  defaultWallHeight: number;    // metri (default 2.70)
  wallOpacity: number;          // opacità muri sopra la piantina in Step 0 e 1 (0.1..1)
  snapToGrid: boolean;
  gridSize: number;             // metri (default 0.10)
  snapToWalls: boolean;
  snapAngles: boolean;

  // Selezione e Clipboard
  selectedWallId: string | null;
  selectedOpeningId: string | null;
  selectedFurnitureIds: string[];
  clipboardFurniture: Furniture[];

  // Stato modali / notifiche
  toast: ToastMessage | null;
  showShortcutsModal: boolean;
  showCropModal: boolean;
  selectedRoomId3D: string | null;

  // Azioni UI
  setStep: (step: WizardStep) => void;
  toggleTheme: () => void;
  setActiveTool: (tool: EditorTool) => void;
  setActiveOpeningType: (type: OpeningType) => void;
  setActiveDoorStyle: (style: DoorStyle) => void;
  setActiveOpeningColor: (color: string) => void;
  setDraggingCatalogItem: (item: FurnitureCatalogItem | null) => void;
  setAutoFurnishMode: (room: AutoRoomType | null) => void;
  setDefaultWallThickness: (meters: number) => void;
  setDefaultWallHeight: (meters: number) => void;
  setWallOpacity: (opacity: number) => void;
  setSnapToGrid: (v: boolean) => void;
  setSnapToWalls: (v: boolean) => void;
  setSnapAngles: (v: boolean) => void;
  setShowShortcutsModal: (v: boolean) => void;
  setShowCropModal: (v: boolean) => void;
  setSelectedRoomId3D: (roomId: string | null) => void;
  showToast: (text: string, type?: ToastMessage['type']) => void;
  clearToast: () => void;

  // Azioni Progetto & Cronologia
  setProjectName: (name: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  resetProject: () => void;
  importProjectJson: (jsonText: string) => boolean;
  exportProjectJson: () => string;

  // Step 0: Piantina, Calibrazione, Muri
  setFloorplan: (floorplan: FloorplanImage | null) => void;
  applyCroppedFloorplan: (cropped: FloorplanImage) => void;
  setFloorplanOpacity: (opacity: number) => void;
  setCalibrationPoint: (which: 'A' | 'B', ptImagePx: Point2D) => void;
  clearCalibrationPoints: () => void;
  applyCalibration: (realLengthCm: number) => void;
  addWall: (start: Point2D, end: Point2D, thickness?: number, height?: number) => Wall;
  updateWall: (id: string, patch: Partial<Wall>, recordHistory?: boolean) => void;
  moveWallVertex: (id: string, endpoint: 'start' | 'end', pos: Point2D, recordHistory?: boolean) => void;
  toggleDemolishWall: (id: string) => void;
  splitWall: (id: string) => void;
  applyDefaultHeightToAllWalls: () => void;
  autoAlignProjectWalls: () => void;
  restoreAllDemolishedWalls: () => void;
  deleteWall: (id: string) => void;
  clearAllWalls: () => void;
  selectWall: (id: string | null) => void;
  pushHistorySnapshot: () => void;

  // Step 1: Aperture
  addOpening: (wallId: string, type: OpeningType, position: number) => Opening;
  updateOpening: (id: string, patch: Partial<Opening>, recordHistory?: boolean) => void;
  duplicateOpening: (id: string) => void;
  deleteOpening: (id: string) => void;
  selectOpening: (id: string | null) => void;

  // Step 2: Arredamento
  addFurnitureFromCatalog: (item: FurnitureCatalogItem, x: number, y: number) => Furniture;
  addFurnitureBatch: (items: Furniture[], roomLabel?: string) => void;
  selectAllFurniture: () => void;
  updateFurniture: (id: string, patch: Partial<Furniture>, recordHistory?: boolean) => void;
  moveFurnitureBatch: (deltas: Record<string, Point2D>, recordHistory?: boolean) => void;
  rotateSelectedFurniture: (deltaDeg: number) => void;
  deleteSelectedFurniture: () => void;
  copySelectedFurniture: () => void;
  pasteFurniture: () => void;
  selectFurniture: (ids: string[]) => void;
  toggleFurnitureSelection: (id: string) => void;
  clearSelection: () => void;

  // Step 3: Impostazioni 3D
  updateRenderSettings: (patch: Partial<RenderSettings>) => void;
  setCameraMode: (mode: CameraMode3D) => void;
  setFloorTexture: (tex: FloorTextureType) => void;
  setFloorColor: (color: string) => void;
  setWallColor: (color: string) => void;
  setTimeOfDay: (hour: number) => void;
}

const initialProject = loadFromStorage();

export const useProjectStore = create<ProjectStore>((set, get) => {
  /** Registra lo stato corrente nello stack past e aggiorna project + localStorage */
  const commit = (updater: (prev: ProjectData) => ProjectData, recordHistory = true) => {
    set((state) => {
      const nextProject = updater(state.project);
      persistToStorage(nextProject);
      if (!recordHistory) {
        return { project: nextProject };
      }
      const nextPast = [...state.past, cloneProject(state.project)].slice(-MAX_HISTORY);
      return {
        project: nextProject,
        past: nextPast,
        future: [],
      };
    });
  };

  return {
    project: initialProject,
    past: [],
    future: [],

    step: 0,
    theme: loadTheme(),
    activeTool: 'select',
    activeOpeningType: 'door_internal',
    activeDoorStyle: 'single',
    activeOpeningColor: '#f4efe6',
    draggingCatalogItem: null,
    autoFurnishMode: null,

    defaultWallThickness: 0.2,
    defaultWallHeight: 2.7,
    wallOpacity: 0.35,
    snapToGrid: true,
    gridSize: 0.1,
    snapToWalls: true,
    snapAngles: true,

    selectedWallId: null,
    selectedOpeningId: null,
    selectedFurnitureIds: [],
    clipboardFurniture: [],

    toast: null,
    showShortcutsModal: false,
    showCropModal: false,
    selectedRoomId3D: null,

    setStep: (step) => {
      set((state) => {
        // Adatta lo strumento di default allo step selezionato senza perdere dati
        let nextTool: EditorTool = 'select';
        if (step === 0 && state.project.walls.length === 0 && state.project.floorplan) {
          nextTool = state.project.calibration.isCalibrated ? 'wall' : 'calibrate';
        }
        return {
          step,
          activeTool: nextTool,
          selectedWallId: step === 0 ? state.selectedWallId : null,
          selectedOpeningId: step === 1 ? state.selectedOpeningId : null,
          selectedFurnitureIds: step === 2 ? state.selectedFurnitureIds : [],
        };
      });
    },

    toggleTheme: () =>
      set((state) => {
        const next = state.theme === 'light' ? 'dark' : 'light';
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // ignore
        }
        return { theme: next };
      }),

    setActiveTool: (activeTool) => set({ activeTool }),
    setActiveOpeningType: (activeOpeningType) =>
      set({ activeOpeningType, activeTool: 'place_opening' }),
    setActiveDoorStyle: (activeDoorStyle) => set({ activeDoorStyle }),
    setActiveOpeningColor: (activeOpeningColor) => set({ activeOpeningColor }),
    setDraggingCatalogItem: (draggingCatalogItem) => set({ draggingCatalogItem }),
    setAutoFurnishMode: (autoFurnishMode) =>
      set({ autoFurnishMode, activeTool: 'select' }),
    setDefaultWallThickness: (defaultWallThickness) => set({ defaultWallThickness }),
    setDefaultWallHeight: (defaultWallHeight) => set({ defaultWallHeight }),
    setWallOpacity: (wallOpacity) =>
      set({ wallOpacity: Math.max(0.1, Math.min(1, wallOpacity)) }),
    setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
    setSnapToWalls: (snapToWalls) => set({ snapToWalls }),
    setSnapAngles: (snapAngles) => set({ snapAngles }),
    setShowShortcutsModal: (showShortcutsModal) => set({ showShortcutsModal }),
    setShowCropModal: (showCropModal) => set({ showCropModal }),
    setSelectedRoomId3D: (selectedRoomId3D) => set({ selectedRoomId3D }),

    showToast: (text, type = 'info') =>
      set({ toast: { id: generateId('toast'), text, type } }),
    clearToast: () => set({ toast: null }),

    setProjectName: (name) => commit((p) => ({ ...p, name }), false),

    pushHistorySnapshot: () => {
      set((state) => ({
        past: [...state.past, cloneProject(state.project)].slice(-MAX_HISTORY),
        future: [],
      }));
    },

    undo: () => {
      const state = get();
      if (state.past.length === 0) return;
      const previous = state.past[state.past.length - 1];
      const nextPast = state.past.slice(0, -1);
      const nextFuture = [cloneProject(state.project), ...state.future].slice(0, MAX_HISTORY);
      persistToStorage(previous);
      set({
        project: previous,
        past: nextPast,
        future: nextFuture,
        selectedWallId: null,
        selectedOpeningId: null,
        selectedFurnitureIds: [],
      });
    },

    redo: () => {
      const state = get();
      if (state.future.length === 0) return;
      const next = state.future[0];
      const nextFuture = state.future.slice(1);
      const nextPast = [...state.past, cloneProject(state.project)].slice(-MAX_HISTORY);
      persistToStorage(next);
      set({
        project: next,
        past: nextPast,
        future: nextFuture,
        selectedWallId: null,
        selectedOpeningId: null,
        selectedFurnitureIds: [],
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    resetProject: () => {
      const empty = createEmptyProject();
      commit(() => empty, true);
      set({
        step: 0,
        activeTool: 'select',
        selectedWallId: null,
        selectedOpeningId: null,
        selectedFurnitureIds: [],
      });
      get().showToast('Nuovo progetto inizializzato', 'info');
    },

    exportProjectJson: () => JSON.stringify(get().project, null, 2),

    importProjectJson: (jsonText) => {
      try {
        const parsed = JSON.parse(jsonText) as Partial<ProjectData>;
        if (!parsed || !Array.isArray(parsed.walls)) {
          throw new Error('Formato file progetto non valido.');
        }
        const merged: ProjectData = {
          ...createEmptyProject(),
          ...parsed,
          calibration: { ...DEFAULT_CALIBRATION, ...(parsed.calibration ?? {}) },
          renderSettings: { ...DEFAULT_RENDER_SETTINGS, ...(parsed.renderSettings ?? {}) },
          walls: parsed.walls,
          openings: Array.isArray(parsed.openings) ? parsed.openings : [],
          furniture: Array.isArray(parsed.furniture) ? parsed.furniture : [],
        };
        commit(() => merged, true);
        set({
          selectedWallId: null,
          selectedOpeningId: null,
          selectedFurnitureIds: [],
        });
        get().showToast(`Progetto "${merged.name}" importato`, 'success');
        return true;
      } catch {
        get().showToast('Impossibile importare il file JSON selezionato', 'error');
        return false;
      }
    },

    // --- STEP 0 ---
    setFloorplan: (floorplan) => {
      commit((p) => ({
        ...p,
        floorplan,
        calibration: { ...DEFAULT_CALIBRATION },
      }));
      if (floorplan) {
        set({ activeTool: 'calibrate' });
        get().showToast('Piantina caricata! Clicca due punti noti per calibrare la scala.', 'success');
      } else {
        set((s) => ({
          activeTool: s.activeTool === 'calibrate' ? 'select' : s.activeTool,
        }));
        get().showToast('Piantina cancellata', 'info');
      }
    },

    applyCroppedFloorplan: (cropped) => {
      commit((p) => ({
        ...p,
        floorplan: cropped,
        // Azzera la calibrazione perché ritaglio/trapezio/4 angoli cambiano scala e coordinate
        calibration: { ...DEFAULT_CALIBRATION },
      }));
      set({ showCropModal: false, activeTool: 'calibrate' });
      get().showToast(
        `Piantina aggiornata (${cropped.widthPx}×${cropped.heightPx} px)! Clicca due punti noti per calibrare.`,
        'success'
      );
    },

    setFloorplanOpacity: (opacity) => {
      commit(
        (p) =>
          p.floorplan
            ? { ...p, floorplan: { ...p.floorplan, opacity } }
            : p,
        false
      );
    },

    setCalibrationPoint: (which, ptImagePx) => {
      commit(
        (p) => ({
          ...p,
          calibration: {
            ...p.calibration,
            pointA: which === 'A' ? ptImagePx : p.calibration.pointA,
            pointB: which === 'B' ? ptImagePx : p.calibration.pointB,
          },
        }),
        false
      );
    },

    clearCalibrationPoints: () => {
      commit(
        (p) => ({
          ...p,
          calibration: {
            ...p.calibration,
            pointA: null,
            pointB: null,
          },
        }),
        false
      );
    },

    applyCalibration: (realLengthCm) => {
      const { calibration } = get().project;
      if (!calibration.pointA || !calibration.pointB || realLengthCm <= 0) return;

      const distPx = Math.hypot(
        calibration.pointB.x - calibration.pointA.x,
        calibration.pointB.y - calibration.pointA.y
      );
      if (distPx < 2) {
        get().showToast('I punti A e B sono troppo vicini: clicca due punti più distanti.', 'warning');
        return;
      }

      const newPixelsPerMeter = distPx / (realLengthCm / 100);
      const oldPixelsPerMeter = calibration.pixelsPerMeter || 100;
      const scaleFactor = oldPixelsPerMeter / newPixelsPerMeter;

      commit((p) => ({
        ...p,
        calibration: {
          ...p.calibration,
          realLengthCm,
          pixelsPerMeter: newPixelsPerMeter,
          isCalibrated: true,
        },
        // Mantiene allineati eventuali muri e mobili già disegnati
        walls: p.walls.map((w) => ({
          ...w,
          start: { x: w.start.x * scaleFactor, y: w.start.y * scaleFactor },
          end: { x: w.end.x * scaleFactor, y: w.end.y * scaleFactor },
        })),
        furniture: p.furniture.map((f) => ({
          ...f,
          x: f.x * scaleFactor,
          y: f.y * scaleFactor,
        })),
      }));

      set({ activeTool: 'wall' });
      get().showToast(
        `Scala calibrata (${realLengthCm} cm). Ora puoi tracciare i muri!`,
        'success'
      );
    },

    addWall: (start, end, thickness, height) => {
      const state = get();
      const wall: Wall = {
        id: generateId('wall'),
        start: { x: Number(start.x.toFixed(4)), y: Number(start.y.toFixed(4)) },
        end: { x: Number(end.x.toFixed(4)), y: Number(end.y.toFixed(4)) },
        thickness: thickness ?? state.defaultWallThickness,
        height: height ?? state.defaultWallHeight,
      };
      commit((p) => ({ ...p, walls: [...p.walls, wall] }));
      return wall;
    },

    updateWall: (id, patch, recordHistory = true) => {
      commit(
        (p) => ({
          ...p,
          walls: p.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)),
        }),
        recordHistory
      );
    },

    moveWallVertex: (id, endpoint, pos, recordHistory = false) => {
      commit(
        (p) => ({
          ...p,
          walls: p.walls.map((w) =>
            w.id === id ? { ...w, [endpoint]: { x: pos.x, y: pos.y } } : w
          ),
        }),
        recordHistory
      );
    },

    toggleDemolishWall: (id) => {
      const target = get().project.walls.find((w) => w.id === id);
      if (!target) return;
      const nextDemolished = !target.demolished;
      commit((p) => ({
        ...p,
        walls: p.walls.map((w) =>
          w.id === id ? { ...w, demolished: nextDemolished } : w
        ),
      }));
      get().showToast(
        nextDemolished
          ? 'Muro abbattuto! Rimane tratteggiato in 2D e rimosso nel 3D.'
          : 'Muro ripristinato!',
        nextDemolished ? 'warning' : 'success'
      );
    },

    splitWall: (id) => {
      const target = get().project.walls.find((w) => w.id === id);
      if (!target) return;
      const mid: Point2D = {
        x: Number(((target.start.x + target.end.x) / 2).toFixed(4)),
        y: Number(((target.start.y + target.end.y) / 2).toFixed(4)),
      };
      const firstId = target.id;
      const secondId = generateId('wall');

      const firstHalf: Wall = { ...target, id: firstId, end: mid };
      const secondHalf: Wall = { ...target, id: secondId, start: mid };

      commit((p) => ({
        ...p,
        walls: p.walls.flatMap((w) => (w.id === id ? [firstHalf, secondHalf] : [w])),
        // Riassegna le eventuali aperture alla metà corretta
        openings: p.openings.map((op) => {
          if (op.wallId !== id) return op;
          if (op.position <= 0.5) {
            return { ...op, wallId: firstId, position: Math.min(0.9, Math.max(0.1, op.position * 2)) };
          }
          return {
            ...op,
            wallId: secondId,
            position: Math.min(0.9, Math.max(0.1, (op.position - 0.5) * 2)),
          };
        }),
      }));
      set({ selectedWallId: firstId });
      get().showToast('Muro diviso in 2 tratti: ora puoi abbatterne anche solo una parte!', 'info');
    },

    applyDefaultHeightToAllWalls: () => {
      const state = get();
      if (state.project.walls.length === 0) return;
      const h = state.defaultWallHeight;
      commit((p) => ({
        ...p,
        walls: p.walls.map((w) => ({ ...w, height: h })),
      }));
      get().showToast(
        `Altezza di tutti i muri aggiornata a ${Math.round(h * 100)} cm`,
        'success'
      );
    },

    autoAlignProjectWalls: () => {
      const state = get();
      if (state.project.walls.length < 2) {
        get().showToast('Servono almeno 2 muri per eseguire l’allineamento automatico', 'info');
        return;
      }
      const { walls: aligned, adjustedCount } = autoAlignWalls(state.project.walls);
      if (adjustedCount === 0) {
        get().showToast('I muri risultano già allineati correttamente!', 'info');
        return;
      }
      commit((p) => ({ ...p, walls: aligned }));
      get().showToast(
        `Corretti e allineati automaticamente ${adjustedCount} ${adjustedCount === 1 ? 'muro' : 'muri'}! (Ctrl+Z per annullare)`,
        'success'
      );
    },

    restoreAllDemolishedWalls: () => {
      const hasDemolished = get().project.walls.some((w) => w.demolished);
      if (!hasDemolished) return;
      commit((p) => ({
        ...p,
        walls: p.walls.map((w) => (w.demolished ? { ...w, demolished: false } : w)),
      }));
      get().showToast('Tutti i muri abbattuti sono stati ripristinati', 'success');
    },

    deleteWall: (id) => {
      commit((p) => ({
        ...p,
        walls: p.walls.filter((w) => w.id !== id),
        // Rimuove anche le aperture agganciate al muro eliminato
        openings: p.openings.filter((o) => o.wallId !== id),
      }));
      set((s) => ({
        selectedWallId: s.selectedWallId === id ? null : s.selectedWallId,
      }));
    },

    clearAllWalls: () => {
      if (get().project.walls.length === 0) return;
      commit((p) => ({
        ...p,
        walls: [],
        openings: [],
      }));
      set({ selectedWallId: null, selectedOpeningId: null });
      get().showToast('Tutti i muri sono stati cancellati (piantina mantenuta)', 'info');
    },

    selectWall: (selectedWallId) =>
      set({ selectedWallId, selectedOpeningId: null, selectedFurnitureIds: [] }),

    // --- STEP 1 ---
    addOpening: (wallId, type, position) => {
      const state = get();
      const preset = OPENING_PRESETS[type];
      const isDoor = type === 'door_internal' || type === 'door_entrance';
      const doorStyle = isDoor ? state.activeDoorStyle : undefined;
      // Per porta a doppia anta imposta di default 140 cm se stiamo usando lo stile double
      const width = isDoor && doorStyle === 'double' ? Math.max(1.4, preset.width) : preset.width;
      const defaultColor =
        type === 'door_entrance'
          ? '#4f3524'
          : type === 'door_internal'
            ? state.activeOpeningColor
            : '#f1f5f9';

      const opening: Opening = {
        id: generateId('open'),
        wallId,
        type,
        position,
        width,
        height: preset.height,
        sillHeight: preset.sillHeight,
        swing: 'left_in' as DoorSwing,
        doorStyle,
        color: defaultColor,
      };
      commit((p) => ({ ...p, openings: [...p.openings, opening] }));
      set({ selectedOpeningId: opening.id });
      return opening;
    },

    updateOpening: (id, patch, recordHistory = true) => {
      commit(
        (p) => ({
          ...p,
          openings: p.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
        }),
        recordHistory
      );
    },

    duplicateOpening: (id) => {
      const target = get().project.openings.find((o) => o.id === id);
      if (!target) return;
      const nextPos = target.position + 0.15 <= 0.88 ? target.position + 0.15 : Math.max(0.12, target.position - 0.15);
      const copy: Opening = {
        ...target,
        id: generateId('open'),
        position: nextPos,
      };
      commit((p) => ({ ...p, openings: [...p.openings, copy] }));
      set({ selectedOpeningId: copy.id });
      get().showToast('Apertura duplicata', 'info');
    },

    deleteOpening: (id) => {
      commit((p) => ({
        ...p,
        openings: p.openings.filter((o) => o.id !== id),
      }));
      set((s) => ({
        selectedOpeningId: s.selectedOpeningId === id ? null : s.selectedOpeningId,
      }));
    },

    selectOpening: (selectedOpeningId) =>
      set({ selectedOpeningId, selectedWallId: null, selectedFurnitureIds: [] }),

    // --- STEP 2 ---
    addFurnitureFromCatalog: (item, x, y) => {
      const furn: Furniture = {
        id: generateId('furn'),
        catalogId: item.id,
        name: item.nome,
        category: item.categoria,
        geometryType: item.tipoGeometria,
        x,
        y,
        width: item.dimensioni.width / 100,
        depth: item.dimensioni.depth / 100,
        height: item.dimensioni.height / 100,
        rotation: 0,
        color: item.coloreDefault,
        material: item.materialeDefault,
        stairsFirstFlight:
          item.tipoGeometria === 'stairs_l' || item.tipoGeometria === 'stairs_u'
            ? 'left'
            : undefined,
        customGlbUrl: item.glbUrl,
      };
      commit((p) => ({ ...p, furniture: [...p.furniture, furn] }));
      set({ selectedFurnitureIds: [furn.id] });
      return furn;
    },

    addFurnitureBatch: (items, roomLabel) => {
      if (items.length === 0) return;
      commit((p) => ({ ...p, furniture: [...p.furniture, ...items] }));
      set({
        selectedFurnitureIds: items.map((f) => f.id),
        autoFurnishMode: null,
        selectedWallId: null,
        selectedOpeningId: null,
      });
      get().showToast(
        `Auto-arredamento${roomLabel ? ` (${roomLabel})` : ''}: inseriti ${items.length} mobili! Puoi spostarli tutti insieme trascinandone uno, oppure cliccarli singolarmente.`,
        'success'
      );
    },

    selectAllFurniture: () => {
      const allIds = get().project.furniture.map((f) => f.id);
      set({
        selectedFurnitureIds: allIds,
        selectedWallId: null,
        selectedOpeningId: null,
      });
      if (allIds.length > 0) {
        get().showToast(
          `Selezionati tutti i ${allIds.length} mobili: trascinane uno per spostarli insieme!`,
          'info'
        );
      }
    },

    updateFurniture: (id, patch, recordHistory = true) => {
      commit(
        (p) => ({
          ...p,
          furniture: p.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        }),
        recordHistory
      );
    },

    moveFurnitureBatch: (deltas, recordHistory = false) => {
      commit(
        (p) => ({
          ...p,
          furniture: p.furniture.map((f) => {
            const target = deltas[f.id];
            return target ? { ...f, x: target.x, y: target.y } : f;
          }),
        }),
        recordHistory
      );
    },

    rotateSelectedFurniture: (deltaDeg) => {
      const ids = get().selectedFurnitureIds;
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      commit((p) => ({
        ...p,
        furniture: p.furniture.map((f) =>
          idSet.has(f.id)
            ? { ...f, rotation: ((f.rotation + deltaDeg) % 360 + 360) % 360 }
            : f
        ),
      }));
    },

    deleteSelectedFurniture: () => {
      const ids = get().selectedFurnitureIds;
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      commit((p) => ({
        ...p,
        furniture: p.furniture.filter((f) => !idSet.has(f.id)),
      }));
      set({ selectedFurnitureIds: [] });
    },

    copySelectedFurniture: () => {
      const { selectedFurnitureIds, project } = get();
      if (selectedFurnitureIds.length === 0) return;
      const idSet = new Set(selectedFurnitureIds);
      const copied = project.furniture
        .filter((f) => idSet.has(f.id))
        .map((f) => ({ ...f }));
      set({ clipboardFurniture: copied });
      get().showToast(
        copied.length === 1
          ? `Copiato "${copied[0].name}"`
          : `Copiati ${copied.length} mobili`,
        'info'
      );
    },

    pasteFurniture: () => {
      const { clipboardFurniture } = get();
      if (clipboardFurniture.length === 0) return;
      const pasted = clipboardFurniture.map((f) => ({
        ...f,
        id: generateId('furn'),
        x: f.x + 0.35,
        y: f.y + 0.35,
      }));
      commit((p) => ({ ...p, furniture: [...p.furniture, ...pasted] }));
      set({ selectedFurnitureIds: pasted.map((f) => f.id) });
      get().showToast(
        pasted.length === 1
          ? `Incollato "${pasted[0].name}"`
          : `Incollati ${pasted.length} mobili`,
        'success'
      );
    },

    selectFurniture: (selectedFurnitureIds) =>
      set({ selectedFurnitureIds, selectedWallId: null, selectedOpeningId: null }),

    toggleFurnitureSelection: (id) =>
      set((state) => {
        const exists = state.selectedFurnitureIds.includes(id);
        return {
          selectedFurnitureIds: exists
            ? state.selectedFurnitureIds.filter((x) => x !== id)
            : [...state.selectedFurnitureIds, id],
          selectedWallId: null,
          selectedOpeningId: null,
        };
      }),

    clearSelection: () =>
      set({ selectedWallId: null, selectedOpeningId: null, selectedFurnitureIds: [] }),

    // --- STEP 3 ---
    updateRenderSettings: (patch) => {
      commit(
        (p) => ({
          ...p,
          renderSettings: { ...p.renderSettings, ...patch },
        }),
        false
      );
    },

    setCameraMode: (cameraMode) => get().updateRenderSettings({ cameraMode }),
    setFloorTexture: (floorTexture) =>
      get().updateRenderSettings({
        floorTexture,
        floorColor: DEFAULT_FLOOR_COLORS[floorTexture],
      }),
    setFloorColor: (floorColor) => get().updateRenderSettings({ floorColor }),
    setWallColor: (wallColor) => get().updateRenderSettings({ wallColor }),
    setTimeOfDay: (timeOfDay) => get().updateRenderSettings({ timeOfDay }),
  };
});

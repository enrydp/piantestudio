/**
 * Editor 2D principale basato su Konva (react-konva).
 * Gestisce:
 * - Zoom centrato sul cursore (rotella) e Pan (trascina con strumento Sposta, tasto centrale o Spazio)
 * - Griglia metrica reale adattiva e barra di scala
 * - Caricamento drag & drop di piantine PNG/JPG/PDF
 * - Step 0: Calibrazione scala a 2 punti + tracciatura muri a polilinea (snap 90° disattivabile con Shift, snap vertici)
 * - Step 1: Inserimento aperture su muri (drag & drop dalla palette o click) + spostamento agganciato ai muri
 * - Step 2: Drag & drop mobili dal catalogo, selezione multipla (Shift+click o rettangolo), rotazione, snap e avviso collisioni rosso
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import {
  AlertTriangle,
  Check,
  Loader2,
  Maximize2,
  RotateCcw,
  Upload,
  ZoomIn,
  ZoomOut,
  Sparkles,
} from 'lucide-react';
import { useProjectStore, generateId } from '../store/useProjectStore';
import {
  AUTO_ROOM_OPTIONS,
  detectRoomBoxAtPoint,
  generateAutoFurnishLayout,
} from '../utils/autoFurnish';
import type {
  Furniture,
  FurnitureCatalogItem,
  Opening,
  OpeningType,
  Point2D,
} from '../types/project';
import { OPENING_PRESETS } from '../types/project';
import {
  WORLD_PX_PER_METER,
  imagePxToMeters,
  metersToImagePx,
  metersToWorld,
  pointMetersToWorld,
  worldToMeters,
} from '../utils/scale';
import {
  detectFurnitureCollisions,
  distance2D,
  findClosestWallForOpening,
  findNearestVertex,
  getWallsBounds,
  snapAngle90,
  snapFurniturePosition,
} from '../utils/geometry';
import { loadFloorplanFile } from '../utils/pdf';
import { isCadFile, parseCadFile, type ParsedCadDocument } from '../utils/cadImport';
import { CadImportModal } from '../components/CadImportModal';
import { WallLayer } from './WallLayer';
import { OpeningLayer } from './OpeningLayer';
import { FurnitureLayer } from './FurnitureLayer';

interface FloorplanCanvasProps {
  onLoadSampleFloorplan: () => void;
  externalFileInputRef: React.RefObject<HTMLInputElement>;
}

/** Hook per caricare HTMLImageElement da un dataUrl per KonvaImage */
function useHtmlImage(dataUrl: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!dataUrl) {
      setImg(null);
      return;
    }
    const image = new window.Image();
    image.onload = () => setImg(image);
    image.src = dataUrl;
  }, [dataUrl]);
  return img;
}

export const FloorplanCanvas: React.FC<FloorplanCanvasProps> = ({
  onLoadSampleFloorplan,
  externalFileInputRef,
}) => {
  const {
    project,
    step,
    theme,
    activeTool,
    setActiveTool,
    activeOpeningType,
    activeDoorStyle,
    draggingCatalogItem,
    setDraggingCatalogItem,
    autoFurnishMode,
    setAutoFurnishMode,
    defaultWallThickness,
    defaultWallHeight,
    wallOpacity,
    snapAngles,
    snapToGrid,
    gridSize,
    snapToWalls,
    selectedWallId,
    selectWall,
    selectedOpeningId,
    selectOpening,
    selectedFurnitureIds,
    selectFurniture,
    toggleFurnitureSelection,
    clearSelection,
    setFloorplan,
    applyCadImport,
    setCalibrationPoint,
    clearCalibrationPoints,
    applyCalibration,
    addWall,
    moveWallVertex,
    toggleDemolishWall,
    addOpening,
    updateOpening,
    addFurnitureFromCatalog,
    addFurnitureBatch,
    updateFurniture,
    moveFurnitureBatch,
    pushHistorySnapshot,
    showCropModal,
    showToast,
  } = useProjectStore();

  const isDark = theme === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const [size, setSize] = useState({ width: 900, height: 640 });
  const [view, setView] = useState({ x: 80, y: 60, scale: 0.85 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [shiftDown, setShiftDown] = useState(false);
  const [isDragOverFile, setIsDragOverFile] = useState(false);
  const [cadLoadingName, setCadLoadingName] = useState<string | null>(null);
  const [pendingCadDoc, setPendingCadDoc] = useState<ParsedCadDocument | null>(null);
  const panStartRef = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null);

  // Stato tracciatura polilinea muri (Step 0)
  const [draftPoints, setDraftPoints] = useState<Point2D[]>([]);
  const [previewPoint, setPreviewPoint] = useState<Point2D | null>(null);
  const [snappedVertex, setSnappedVertex] = useState<Point2D | null>(null);
  const [cursorMeters, setCursorMeters] = useState<Point2D>({ x: 0, y: 0 });

  // Input inline calibrazione (Step 0)
  const [calibInputCm, setCalibInputCm] = useState('900');

  // Anteprima apertura agganciata al muro (Step 1)
  const [openingPreview, setOpeningPreview] = useState<{
    wallId: string;
    position: number;
    type: OpeningType;
  } | null>(null);

  // Marquee selezione multipla (Step 2)
  const [marquee, setMarquee] = useState<{ start: Point2D; end: Point2D } | null>(null);
  const multiDragOriginRef = useRef<Record<string, Point2D>>({});

  const floorplanImg = useHtmlImage(project.floorplan?.dataUrl ?? null);

  // Dimensioni reali della piantina in metri
  const floorplanMeters = useMemo(() => {
    if (!project.floorplan) return null;
    const ppm = project.calibration.pixelsPerMeter || 100;
    return {
      width: imagePxToMeters(project.floorplan.widthPx, ppm),
      height: imagePxToMeters(project.floorplan.heightPx, ppm),
    };
  }, [project.floorplan, project.calibration.pixelsPerMeter]);

  // Calcolo collisioni mobili (sovrapposizione mobile-mobile o blocco porta)
  const conflicts = useMemo(
    () => detectFurnitureCollisions(project.furniture, project.openings, project.walls),
    [project.furniture, project.openings, project.walls]
  );
  const conflictCount = Object.keys(conflicts).length;

  // Osserva il ridimensionamento del contenitore
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({
          width: Math.max(200, Math.floor(entry.contentRect.width)),
          height: Math.max(200, Math.floor(entry.contentRect.height)),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Traccia tasti Spazio (pan temporaneo), Shift (disattiva snap 90°) ed Esc (termina polilinea)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (inInput) return;

      if (e.code === 'Space') {
        setSpaceDown(true);
      }
      if (e.key === 'Shift') {
        setShiftDown(true);
      }
      if (e.key === 'Escape') {
        setDraftPoints([]);
        setPreviewPoint(null);
        setOpeningPreview(null);
        setAutoFurnishMode(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
      if (e.key === 'Shift') setShiftDown(false);
    };
    const onBlur = () => {
      setSpaceDown(false);
      setShiftDown(false);
      setIsPanning(false);
      panStartRef.current = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Ripulisce eventuali stati temporanei di pan/disegno quando si apre o chiude la modale di ritaglio
  useEffect(() => {
    setSpaceDown(false);
    setShiftDown(false);
    setIsPanning(false);
    panStartRef.current = null;
    setDraftPoints([]);
    setPreviewPoint(null);
  }, [showCropModal]);

  // Reset polilinea se cambia step o strumento
  useEffect(() => {
    if (step !== 0 || activeTool !== 'wall') {
      setDraftPoints([]);
      setPreviewPoint(null);
      setSnappedVertex(null);
    }
    if (step !== 1 || activeTool !== 'place_opening') {
      setOpeningPreview(null);
    }
  }, [step, activeTool]);

  /** Converte coordinate schermo (relative allo Stage) in metri reali */
  const screenToMeters = useCallback(
    (screenX: number, screenY: number): Point2D => {
      const worldX = (screenX - view.x) / view.scale;
      const worldY = (screenY - view.y) / view.scale;
      return { x: worldToMeters(worldX), y: worldToMeters(worldY) };
    },
    [view]
  );

  /** Centra e adatta la vista al contenuto (piantina o muri) */
  const fitToContent = useCallback(() => {
    let minX = 0;
    let minY = 0;
    let maxX = 10;
    let maxY = 7;

    if (project.walls.length > 0) {
      const b = getWallsBounds(project.walls);
      minX = b.minX - 0.8;
      minY = b.minY - 0.8;
      maxX = b.maxX + 0.8;
      maxY = b.maxY + 0.8;
    } else if (floorplanMeters) {
      minX = -0.5;
      minY = -0.5;
      maxX = floorplanMeters.width + 0.5;
      maxY = floorplanMeters.height + 0.5;
    }

    const contentW = metersToWorld(Math.max(2, maxX - minX));
    const contentH = metersToWorld(Math.max(2, maxY - minY));
    const pad = 48;
    const scale = Math.max(
      0.18,
      Math.min(
        2.5,
        Math.min((size.width - pad * 2) / contentW, (size.height - pad * 2) / contentH)
      )
    );
    const x = (size.width - contentW * scale) / 2 - metersToWorld(minX) * scale;
    const y = (size.height - contentH * scale) / 2 - metersToWorld(minY) * scale;
    setView({ x, y, scale });
  }, [project.walls, floorplanMeters, size.width, size.height]);

  // Adatta automaticamente la vista quando viene caricata O ritagliata/raddrizzata una piantina
  const prevFloorplanDataUrl = useRef<string | null>(null);
  useEffect(() => {
    const dataUrl = project.floorplan?.dataUrl ?? null;
    if (dataUrl && dataUrl !== prevFloorplanDataUrl.current) {
      prevFloorplanDataUrl.current = dataUrl;
      const timer = window.setTimeout(() => fitToContent(), 40);
      return () => window.clearTimeout(timer);
    }
  }, [project.floorplan?.dataUrl, fitToContent]);

  /** Zoom con rotella centrato sul cursore */
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const zoomFactor = e.evt.deltaY > 0 ? 0.9 : 1.11;
    const newScale = Math.max(0.15, Math.min(6, view.scale * zoomFactor));
    const mousePointTo = {
      x: (pointer.x - view.x) / view.scale,
      y: (pointer.y - view.y) / view.scale,
    };

    setView({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  /** Calcola punto muro snappato (snap vertici + snap 90° se attivo e senza Shift) */
  const computeSnappedWallPoint = useCallback(
    (rawMeters: Point2D, origin?: Point2D): { point: Point2D; vertexHit: Point2D | null } => {
      let pt = { ...rawMeters };
      const useAngleSnap = snapAngles && !shiftDown;

      if (origin && useAngleSnap) {
        pt = snapAngle90(origin, pt);
      }

      const vertexHit = findNearestVertex(pt, project.walls, 0.22);
      if (vertexHit) {
        return { point: vertexHit, vertexHit };
      }

      // Snap anche al primo punto della polilinea corrente per chiudere facilmente la stanza
      if (draftPoints.length >= 2 && distance2D(pt, draftPoints[0]) < 0.25) {
        return { point: { ...draftPoints[0] }, vertexHit: { ...draftPoints[0] } };
      }

      // Arrotonda a 1 cm per misure pulite
      return {
        point: {
          x: Math.round(pt.x * 100) / 100,
          y: Math.round(pt.y * 100) / 100,
        },
        vertexHit: null,
      };
    },
    [snapAngles, shiftDown, project.walls, draftPoints]
  );

  const handlePointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // Tasto destro: termina polilinea muri
    if (e.evt.button === 2) {
      setDraftPoints([]);
      setPreviewPoint(null);
      return;
    }

    // Pan con strumento Sposta, tasto centrale o Spazio premuto
    if (activeTool === 'pan' || spaceDown || e.evt.button === 1) {
      setIsPanning(true);
      panStartRef.current = {
        x: pointer.x,
        y: pointer.y,
        viewX: view.x,
        viewY: view.y,
      };
      return;
    }

    const ptMeters = screenToMeters(pointer.x, pointer.y);

    // STEP 0: Calibrazione 2 punti
    if (step === 0 && activeTool === 'calibrate') {
      const ppm = project.calibration.pixelsPerMeter || 100;
      const ptImagePx = {
        x: metersToImagePx(ptMeters.x, ppm),
        y: metersToImagePx(ptMeters.y, ppm),
      };
      if (!project.calibration.pointA || (project.calibration.pointA && project.calibration.pointB)) {
        clearCalibrationPoints();
        setCalibrationPoint('A', ptImagePx);
      } else {
        setCalibrationPoint('B', ptImagePx);
      }
      return;
    }

    // STEP 0: Tracciatura muri per 2 punti (inizio -> fine, non in continuo)
    if (step === 0 && activeTool === 'wall') {
      const origin = draftPoints.length > 0 ? draftPoints[0] : undefined;
      const { point } = computeSnappedWallPoint(ptMeters, origin);

      if (draftPoints.length === 0) {
        setDraftPoints([point]);
        setPreviewPoint(point);
      } else {
        const startPt = draftPoints[0];
        if (distance2D(startPt, point) >= 0.08) {
          addWall(startPt, point);
          // Termina subito il singolo tratto così il prossimo click inizia un nuovo muro indipendente
          setDraftPoints([]);
          setPreviewPoint(null);
        }
      }
      return;
    }

    // STEP 1: Inserimento apertura cliccando sul muro
    if (step === 1 && activeTool === 'place_opening') {
      const preset = OPENING_PRESETS[activeOpeningType];
      const hit = findClosestWallForOpening(ptMeters, project.walls, preset.width, 0.8);
      if (hit) {
        addOpening(hit.wall.id, activeOpeningType, hit.position);
        showToast(`${preset.label} inserita sul muro`, 'success');
      } else {
        showToast('Clicca più vicino a un muro per agganciare l’apertura', 'warning');
      }
      return;
    }

    // STEP 2: Auto-arredamento cliccando dentro una stanza
    if (step === 2 && autoFurnishMode) {
      const box = detectRoomBoxAtPoint(ptMeters, project.walls);
      const generated = generateAutoFurnishLayout(autoFurnishMode, box, generateId);
      const opt = AUTO_ROOM_OPTIONS.find((o) => o.id === autoFurnishMode);
      addFurnitureBatch(generated, opt?.label);
      return;
    }

    // Click sullo sfondo dello Stage
    if (e.target === stage) {
      if (step === 2 && activeTool === 'select') {
        if (!e.evt.shiftKey) clearSelection();
        setMarquee({ start: ptMeters, end: ptMeters });
      } else {
        clearSelection();
      }
    }
  };

  const handleMouseMove = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    if (isPanning && panStartRef.current) {
      const dx = pointer.x - panStartRef.current.x;
      const dy = pointer.y - panStartRef.current.y;
      setView((v) => ({
        ...v,
        x: panStartRef.current!.viewX + dx,
        y: panStartRef.current!.viewY + dy,
      }));
      return;
    }

    const ptMeters = screenToMeters(pointer.x, pointer.y);
    setCursorMeters(ptMeters);

    if (step === 0 && activeTool === 'wall') {
      const origin = draftPoints.length > 0 ? draftPoints[draftPoints.length - 1] : undefined;
      const { point, vertexHit } = computeSnappedWallPoint(ptMeters, origin);
      setPreviewPoint(point);
      setSnappedVertex(vertexHit);
    }

    if (step === 1 && activeTool === 'place_opening') {
      const preset = OPENING_PRESETS[activeOpeningType];
      const hit = findClosestWallForOpening(ptMeters, project.walls, preset.width, 0.8);
      if (hit) {
        setOpeningPreview({
          wallId: hit.wall.id,
          position: hit.position,
          type: activeOpeningType,
        });
      } else {
        setOpeningPreview(null);
      }
    }

    if (marquee) {
      setMarquee((m) => (m ? { ...m, end: ptMeters } : null));
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }

    // Completa selezione multipla a rettangolo (Step 2)
    if (marquee) {
      const minX = Math.min(marquee.start.x, marquee.end.x);
      const maxX = Math.max(marquee.start.x, marquee.end.x);
      const minY = Math.min(marquee.start.y, marquee.end.y);
      const maxY = Math.max(marquee.start.y, marquee.end.y);

      if (maxX - minX > 0.08 || maxY - minY > 0.08) {
        const insideIds = project.furniture
          .filter((f) => f.x >= minX && f.x <= maxX && f.y >= minY && f.y <= maxY)
          .map((f) => f.id);
        selectFurniture(insideIds);
      }
      setMarquee(null);
    }
  };

  const handleDoubleClick = () => {
    if (step === 0 && activeTool === 'wall' && draftPoints.length > 0) {
      setDraftPoints([]);
      setPreviewPoint(null);
    }
  };

  /** Gestione upload file immagine / PDF / DWG / DXF */
  const handleProcessFile = async (file: File) => {
    try {
      if (isCadFile(file)) {
        setCadLoadingName(file.name);
        try {
          const parsed = await parseCadFile(file);
          setPendingCadDoc(parsed);
        } finally {
          setCadLoadingName(null);
        }
        return;
      }
      const img = await loadFloorplanFile(file);
      setFloorplan(img);
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Formato file non supportato (usa PNG, JPG, PDF, DXF o DWG)',
        'error'
      );
    }
  };

  /** Gestione Drop su canvas: file piantina, apertura da palette o mobile da catalogo */
  const handleDropOnContainer = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverFile(false);

    const rect = containerRef.current?.getBoundingClientRect();
    const dropMeters = rect
      ? screenToMeters(e.clientX - rect.left, e.clientY - rect.top)
      : { x: 2, y: 2 };

    // 1. Drop mobile dal catalogo (Step 2) — supporta sia dataTransfer sia fallback store
    let droppedItem: FurnitureCatalogItem | null = draggingCatalogItem;
    const furnJson =
      e.dataTransfer.getData('application/x-piantestudio-furniture') ||
      e.dataTransfer.getData('text/plain');
    if (!droppedItem && furnJson) {
      try {
        const parsed = JSON.parse(furnJson) as Partial<FurnitureCatalogItem>;
        if (parsed && parsed.id && parsed.dimensioni) {
          droppedItem = parsed as FurnitureCatalogItem;
        }
      } catch {
        // ignore
      }
    }

    if (droppedItem) {
      setDraggingCatalogItem(null);
      const snapped = snapFurniturePosition(
        {
          x: dropMeters.x,
          y: dropMeters.y,
          width: droppedItem.dimensioni.width / 100,
          depth: droppedItem.dimensioni.depth / 100,
          rotation: 0,
        },
        project.walls,
        { snapGrid: snapToGrid, gridSize, snapWalls: snapToWalls }
      );
      addFurnitureFromCatalog(droppedItem, snapped.x, snapped.y);
      showToast(`${droppedItem.nome} aggiunto alla piantina`, 'success');
      return;
    }

    // 2. Drop apertura dalla toolbar (Step 1)
    const opType = e.dataTransfer.getData('application/x-piantestudio-opening') as OpeningType | '';
    if (opType && OPENING_PRESETS[opType]) {
      const preset = OPENING_PRESETS[opType];
      const hit = findClosestWallForOpening(dropMeters, project.walls, preset.width, 1.4);
      if (hit) {
        addOpening(hit.wall.id, opType, hit.position);
        showToast(`${preset.label} agganciata al muro`, 'success');
      } else {
        showToast('Trascina l’apertura direttamente sopra un muro', 'warning');
      }
      return;
    }

    // 3. Drop file immagine/PDF (Step 0)
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleProcessFile(file);
    }
  };

  /** Spostamento apertura trascinata lungo i muri (Step 1) */
  const handleOpeningDragMove = (opening: Opening, pointerMeters: Point2D) => {
    const hit = findClosestWallForOpening(pointerMeters, project.walls, opening.width, 1.5);
    if (hit) {
      updateOpening(
        opening.id,
        { wallId: hit.wall.id, position: hit.position },
        false
      );
    }
  };

  /** Spostamento mobile singolo o multi-selezione (Step 2) */
  const handleFurnitureDragStart = () => {
    pushHistorySnapshot();
    const origins: Record<string, Point2D> = {};
    for (const f of project.furniture) {
      origins[f.id] = { x: f.x, y: f.y };
    }
    multiDragOriginRef.current = origins;
  };

  const handleFurnitureDragMove = (item: Furniture, rawCenterMeters: Point2D) => {
    const snapped = snapFurniturePosition(
      {
        x: rawCenterMeters.x,
        y: rawCenterMeters.y,
        width: item.width,
        depth: item.depth,
        rotation: item.rotation,
      },
      project.walls,
      { snapGrid: snapToGrid, gridSize, snapWalls: snapToWalls }
    );

    if (selectedFurnitureIds.length > 1 && selectedFurnitureIds.includes(item.id)) {
      const origin = multiDragOriginRef.current[item.id] ?? { x: item.x, y: item.y };
      const dx = snapped.x - origin.x;
      const dy = snapped.y - origin.y;
      const updates: Record<string, Point2D> = {};
      for (const id of selectedFurnitureIds) {
        const orig = multiDragOriginRef.current[id];
        if (orig) {
          updates[id] = { x: orig.x + dx, y: orig.y + dy };
        }
      }
      moveFurnitureBatch(updates, false);
    } else {
      updateFurniture(item.id, { x: snapped.x, y: snapped.y }, false);
    }
  };

  // Calcolo linee griglia metrica visibili nella viewport corrente
  const gridLines = useMemo(() => {
    const minWorldX = -view.x / view.scale;
    const maxWorldX = (size.width - view.x) / view.scale;
    const minWorldY = -view.y / view.scale;
    const maxWorldY = (size.height - view.y) / view.scale;

    const stepMeters = view.scale < 0.45 ? 1 : 0.5;
    const startX = Math.floor(worldToMeters(minWorldX) / stepMeters) * stepMeters;
    const endX = Math.ceil(worldToMeters(maxWorldX) / stepMeters) * stepMeters;
    const startY = Math.floor(worldToMeters(minWorldY) / stepMeters) * stepMeters;
    const endY = Math.ceil(worldToMeters(maxWorldY) / stepMeters) * stepMeters;

    const vertical: { pos: number; major: boolean }[] = [];
    const horizontal: { pos: number; major: boolean }[] = [];

    for (let x = startX; x <= endX; x += stepMeters) {
      const rounded = Math.round(x * 100) / 100;
      vertical.push({ pos: metersToWorld(rounded), major: Math.abs(rounded % 1) < 0.01 });
    }
    for (let y = startY; y <= endY; y += stepMeters) {
      const rounded = Math.round(y * 100) / 100;
      horizontal.push({ pos: metersToWorld(rounded), major: Math.abs(rounded % 1) < 0.01 });
    }

    return { vertical, horizontal, minWorldX, maxWorldX, minWorldY, maxWorldY };
  }, [view, size]);

  // Punti calibrazione in coordinate mondo Konva
  const calibWorldA = project.calibration.pointA
    ? pointMetersToWorld({
        x: imagePxToMeters(project.calibration.pointA.x, project.calibration.pixelsPerMeter),
        y: imagePxToMeters(project.calibration.pointA.y, project.calibration.pixelsPerMeter),
      })
    : null;
  const calibWorldB = project.calibration.pointB
    ? pointMetersToWorld({
        x: imagePxToMeters(project.calibration.pointB.x, project.calibration.pixelsPerMeter),
        y: imagePxToMeters(project.calibration.pointB.y, project.calibration.pixelsPerMeter),
      })
    : null;

  const cursorClass =
    isPanning || activeTool === 'pan' || spaceDown
      ? 'cursor-grab active:cursor-grabbing'
      : activeTool === 'wall' ||
          activeTool === 'calibrate' ||
          activeTool === 'place_opening' ||
          activeTool === 'demolish' ||
          (step === 2 && Boolean(autoFurnishMode))
        ? 'cursor-crosshair'
        : 'cursor-default';

  const showEmptyDropzone = step === 0 && !project.floorplan && project.walls.length === 0;
  // Quando la piantina di riferimento è visibile (Step 0 e Step 1), rende i muri sfumati per vedere porte e finestre sottostanti
  const effectiveWallOpacity = step !== 2 && Boolean(project.floorplan) ? wallOpacity : 1;

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) {
          setIsDragOverFile(true);
        }
      }}
      onDragLeave={() => setIsDragOverFile(false)}
      onDrop={handleDropOnContainer}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex-1 h-full min-w-0 min-h-0 overflow-hidden bg-slate-50 dark:bg-slate-950 ${cursorClass}`}
    >
      {/* Input file nascosto collegato alla toolbar/pannello */}
      <input
        ref={externalFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.dxf,.dwg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleProcessFile(f);
          e.target.value = '';
        }}
      />

      {/* Canvas Konva */}
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handleMouseMove}
        onPointerUp={handleMouseUp}
        onDblClick={handleDoubleClick}
      >
        <Layer x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
          {/* Griglia metrica */}
          <Group listening={false}>
            {gridLines.vertical.map((g, i) => (
              <Line
                key={`v_${i}`}
                points={[g.pos, gridLines.minWorldY, g.pos, gridLines.maxWorldY]}
                stroke={
                  g.major
                    ? isDark
                      ? '#1e293b'
                      : '#e2e8f0'
                    : isDark
                      ? '#131c2e'
                      : '#f1f5f9'
                }
                strokeWidth={(g.major ? 1.2 : 0.7) / view.scale}
              />
            ))}
            {gridLines.horizontal.map((g, i) => (
              <Line
                key={`h_${i}`}
                points={[gridLines.minWorldX, g.pos, gridLines.maxWorldX, g.pos]}
                stroke={
                  g.major
                    ? isDark
                      ? '#1e293b'
                      : '#e2e8f0'
                    : isDark
                      ? '#131c2e'
                      : '#f1f5f9'
                }
                strokeWidth={(g.major ? 1.2 : 0.7) / view.scale}
              />
            ))}
          </Group>

          {/* Immagine piantina di riferimento (nascosta nella fase di arredamento) */}
          {step !== 2 && floorplanImg && floorplanMeters && project.floorplan && (
            <KonvaImage
              image={floorplanImg}
              x={0}
              y={0}
              width={metersToWorld(floorplanMeters.width)}
              height={metersToWorld(floorplanMeters.height)}
              opacity={project.floorplan.opacity}
              listening={false}
            />
          )}

          {/* Muri */}
          <WallLayer
            walls={project.walls}
            selectedWallId={step === 0 ? selectedWallId : null}
            isDark={isDark}
            interactive={step === 0 && (activeTool === 'select' || activeTool === 'demolish')}
            demolishMode={step === 0 && activeTool === 'demolish'}
            canEditVertices={step === 0 && activeTool === 'select'}
            wallOpacity={effectiveWallOpacity}
            draftPoints={draftPoints}
            previewPoint={previewPoint}
            snappedVertex={snappedVertex}
            defaultWallThickness={defaultWallThickness}
            onSelectWall={(id) => selectWall(id)}
            onToggleDemolishWall={(id) => toggleDemolishWall(id)}
            onVertexDragStart={() => pushHistorySnapshot()}
            onVertexDragMove={(wallId, endpoint, posMeters) => {
              const hit = findNearestVertex(posMeters, project.walls, 0.18, wallId);
              const finalPos = hit ?? {
                x: Math.round(posMeters.x * 100) / 100,
                y: Math.round(posMeters.y * 100) / 100,
              };
              moveWallVertex(wallId, endpoint, finalPos, false);
            }}
            onVertexDragEnd={() => {}}
          />

          {/* Aperture (porte, finestre, portefinestre, archi) */}
          <OpeningLayer
            walls={project.walls}
            openings={project.openings}
            selectedOpeningId={step === 1 ? selectedOpeningId : null}
            interactive={step === 1 && activeTool === 'select'}
            isDark={isDark}
            translucentCutout={effectiveWallOpacity < 0.85}
            onSelectOpening={(id) => selectOpening(id)}
            onOpeningDragStart={() => pushHistorySnapshot()}
            onOpeningDragMove={handleOpeningDragMove}
            onOpeningDragEnd={() => {}}
          />

          {/* Anteprima apertura in fase di posizionamento (Step 1) */}
          {step === 1 && openingPreview && (
            <Group opacity={0.65} listening={false}>
              <OpeningLayer
                walls={project.walls}
                openings={[
                  {
                    id: '__preview__',
                    wallId: openingPreview.wallId,
                    type: openingPreview.type,
                    position: openingPreview.position,
                    width:
                      (openingPreview.type === 'door_internal' ||
                        openingPreview.type === 'door_entrance') &&
                      activeDoorStyle === 'double'
                        ? Math.max(1.4, OPENING_PRESETS[openingPreview.type].width)
                        : OPENING_PRESETS[openingPreview.type].width,
                    height: OPENING_PRESETS[openingPreview.type].height,
                    sillHeight: OPENING_PRESETS[openingPreview.type].sillHeight,
                    swing: 'left_in',
                    doorStyle:
                      openingPreview.type === 'door_internal' ||
                      openingPreview.type === 'door_entrance'
                        ? activeDoorStyle
                        : undefined,
                  },
                ]}
                selectedOpeningId="__preview__"
                interactive={false}
                isDark={isDark}
                translucentCutout={effectiveWallOpacity < 0.85}
                onSelectOpening={() => {}}
                onOpeningDragStart={() => {}}
                onOpeningDragMove={() => {}}
                onOpeningDragEnd={() => {}}
              />
            </Group>
          )}

          {/* Mobili (visibili in Step 2 e in anteprima passiva negli altri step) */}
          <FurnitureLayer
            furniture={project.furniture}
            selectedIds={step === 2 ? selectedFurnitureIds : []}
            conflicts={conflicts}
            interactive={step === 2 && activeTool === 'select'}
            isDark={isDark}
            onSelect={(id, multi) => {
              if (multi) toggleFurnitureSelection(id);
              else selectFurniture([id]);
            }}
            onDragStart={handleFurnitureDragStart}
            onDragMove={handleFurnitureDragMove}
            onDragEnd={() => {}}
            onRotateStart={() => pushHistorySnapshot()}
            onRotateMove={(id, deg) => updateFurniture(id, { rotation: deg }, false)}
            onRotateEnd={() => {}}
          />

          {/* Overlay Calibrazione 2 punti (Step 0, visibile solo in modalità calibrazione) */}
          {step === 0 && activeTool === 'calibrate' && (calibWorldA || calibWorldB) && (
            <Group listening={false}>
              {calibWorldA && calibWorldB && (
                <Line
                  points={[calibWorldA.x, calibWorldA.y, calibWorldB.x, calibWorldB.y]}
                  stroke="#ef4444"
                  strokeWidth={2.5 / view.scale}
                  dash={[8 / view.scale, 6 / view.scale]}
                />
              )}
              {calibWorldA && (
                <Group x={calibWorldA.x} y={calibWorldA.y}>
                  <Circle
                    radius={7 / view.scale}
                    fill="#ef4444"
                    stroke="#ffffff"
                    strokeWidth={2 / view.scale}
                  />
                  <Text
                    text="A"
                    x={10 / view.scale}
                    y={-12 / view.scale}
                    fontSize={13 / view.scale}
                    fontStyle="bold"
                    fill="#ef4444"
                  />
                </Group>
              )}
              {calibWorldB && (
                <Group x={calibWorldB.x} y={calibWorldB.y}>
                  <Circle
                    radius={7 / view.scale}
                    fill="#ef4444"
                    stroke="#ffffff"
                    strokeWidth={2 / view.scale}
                  />
                  <Text
                    text="B"
                    x={10 / view.scale}
                    y={-12 / view.scale}
                    fontSize={13 / view.scale}
                    fontStyle="bold"
                    fill="#ef4444"
                  />
                </Group>
              )}
            </Group>
          )}

          {/* Rettangolo selezione multipla (Step 2) */}
          {marquee && (
            <Rect
              x={metersToWorld(Math.min(marquee.start.x, marquee.end.x))}
              y={metersToWorld(Math.min(marquee.start.y, marquee.end.y))}
              width={metersToWorld(Math.abs(marquee.end.x - marquee.start.x))}
              height={metersToWorld(Math.abs(marquee.end.y - marquee.start.y))}
              fill="rgba(37, 99, 235, 0.12)"
              stroke="#2563eb"
              strokeWidth={1.5 / view.scale}
              dash={[6 / view.scale, 4 / view.scale]}
              listening={false}
            />
          )}
        </Layer>
      </Stage>

      {/* Banner istruzioni contestuali in alto al centro */}
      {step === 0 && activeTool === 'calibrate' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center gap-2 px-3.5 py-2 rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-amber-300 dark:border-amber-700 shadow-lg text-xs">
          {!project.calibration.pointA ? (
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Calibrazione: clicca il <strong>punto A</strong> su una misura nota della piantina.
            </span>
          ) : !project.calibration.pointB ? (
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Ottimo! Ora clicca il <strong>punto B</strong> all’altra estremità della misura nota.
            </span>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const val = Number(calibInputCm);
                if (val > 0) applyCalibration(val);
              }}
            >
              <label className="font-medium text-slate-700 dark:text-slate-200">
                Lunghezza reale A–B (cm):
              </label>
              <input
                type="number"
                min={10}
                max={10000}
                value={calibInputCm}
                onChange={(e) => setCalibInputCm(e.target.value)}
                className="w-24 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Applica scala
              </button>
              <button
                type="button"
                onClick={clearCalibrationPoints}
                title="Ripeti selezione punti"
                className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </form>
          )}
        </div>
      )}

      {step === 0 && activeTool === 'wall' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-xl bg-blue-600 text-white shadow-md text-xs font-medium flex items-center gap-2 pointer-events-none">
          <span>
            Modalità Muri (2 punti): clicca inizio e fine del muro • Esc o tasto destro per annullare •{' '}
            {shiftDown ? 'Snap 90° disattivato (Shift)' : 'Tieni Shift per angoli liberi'}
          </span>
        </div>
      )}

      {step === 0 && activeTool === 'demolish' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-xl bg-red-600 text-white shadow-md text-xs font-medium flex items-center gap-2 pointer-events-none">
          <span>
            Modalità Abbatti Muri: clicca su un muro per abbatterlo (clicca un muro tratteggiato per ripristinarlo)
          </span>
        </div>
      )}

      {step === 1 && activeTool === 'place_opening' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-xl bg-blue-600 text-white shadow-md text-xs font-medium pointer-events-none">
          Inserimento: <strong>{OPENING_PRESETS[activeOpeningType].label}</strong> — clicca sopra un muro per posizionarla
        </div>
      )}

      {step === 2 && autoFurnishMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-2 rounded-xl bg-violet-600 text-white shadow-lg text-xs font-medium flex items-center gap-2 pointer-events-none">
          <span>
            Auto-arredamento:{' '}
            <strong>
              {AUTO_ROOM_OPTIONS.find((o) => o.id === autoFurnishMode)?.label}
            </strong>{' '}
            — clicca all’interno della stanza sulla piantina (Esc per annullare)
          </span>
        </div>
      )}

      {/* Avviso rosso collisioni mobili (Step 2) */}
      {step === 2 && conflictCount > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-2 rounded-xl bg-red-600 text-white shadow-lg text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Attenzione: {conflictCount} {conflictCount === 1 ? 'mobile presenta' : 'mobili presentano'} una sovrapposizione o bloccano una porta!
          </span>
        </div>
      )}

      {/* Dropzone iniziale quando non è stata caricata alcuna piantina */}
      {showEmptyDropzone && (
        <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
          <div className="pointer-events-auto max-w-md w-full rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white/92 dark:bg-slate-900/92 backdrop-blur-sm p-7 text-center shadow-xl">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3">
              <Upload className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Carica la tua piantina
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
              Trascina qui un’immagine <strong>PNG / JPG</strong>, un <strong>PDF</strong> oppure un file CAD <strong>DWG / DXF</strong> (già in scala reale 1:1),
              oppure inizia con la piantina d’esempio.
            </p>
            <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
              <button
                type="button"
                onClick={() => externalFileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Scegli file (PNG/PDF/DWG/DXF)
              </button>
              <button
                type="button"
                onClick={onLoadSampleFloorplan}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Usa piantina d’esempio
              </button>
            </div>
            <button
              type="button"
              onClick={() => setActiveTool('wall')}
              className="mt-3 text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Oppure traccia i muri da zero senza immagine →
            </button>
          </div>
        </div>
      )}

      {/* Overlay evidenziazione Drag-Over file */}
      {isDragOverFile && (
        <div className="absolute inset-3 z-30 rounded-2xl border-2 border-dashed border-blue-500 bg-blue-500/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="px-5 py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-lg">
            Rilascia qui la piantina (PNG, JPG, PDF, DWG o DXF)
          </div>
        </div>
      )}

      {/* Overlay caricamento/decodifica file CAD (.DWG / .DXF) */}
      {cadLoadingName && (
        <div className="absolute inset-0 z-40 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="px-5 py-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl flex items-center gap-3 text-xs font-semibold text-slate-800 dark:text-slate-100">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
            <div>
              <div>Lettura file CAD: {cadLoadingName}</div>
              <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                Estrazione geometrie, layer e quote in corso...
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modale anteprima e importazione CAD (.DWG / .DXF) */}
      {pendingCadDoc && (
        <CadImportModal
          doc={pendingCadDoc}
          defaultWallThickness={defaultWallThickness}
          defaultWallHeight={defaultWallHeight}
          onCancel={() => setPendingCadDoc(null)}
          onImport={({ floorplan, pixelsPerMeter, walls }) => {
            applyCadImport(floorplan, pixelsPerMeter, walls);
            setPendingCadDoc(null);
          }}
        />
      )}

      {/* Barra inferiore: coordinate, scala e controlli zoom */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto px-3 py-1.5 rounded-xl bg-white/90 dark:bg-slate-900/90 backdrop-blur border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 shadow-sm flex items-center gap-3">
          <span className="font-mono">
            X: {cursorMeters.x.toFixed(2)} m &nbsp; Y: {cursorMeters.y.toFixed(2)} m
          </span>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <span
            className={
              project.calibration.isCalibrated
                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                : 'text-amber-600 dark:text-amber-400'
            }
          >
            {project.calibration.isCalibrated
              ? `Scala calibrata (${Math.round(project.calibration.pixelsPerMeter)} px/m)`
              : `Scala predefinita (${WORLD_PX_PER_METER} px/m)`}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-1 p-1 rounded-xl bg-white/90 dark:bg-slate-900/90 backdrop-blur border border-slate-200 dark:border-slate-700 shadow-sm">
          <button
            type="button"
            onClick={() => setView((v) => ({ ...v, scale: Math.max(0.15, v.scale / 1.2) }))}
            title="Riduci zoom"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-mono w-11 text-center text-slate-700 dark:text-slate-200">
            {Math.round(view.scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setView((v) => ({ ...v, scale: Math.min(6, v.scale * 1.2) }))}
            title="Aumenta zoom"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={fitToContent}
            title="Adatta vista al contenuto"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

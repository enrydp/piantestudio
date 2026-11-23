/**
 * Generatore opzionale di auto-arredamento per tipo di stanza:
 * - Calcola automaticamente i confini della stanza attorno al punto cliccato (ray-cast sui muri attivi)
 * - Dispone i mobili del catalogo con proporzioni e orientamenti realistici
 * - Restituisce oggetti Furniture pronti per essere aggiunti e selezionati insieme (spostabili in blocco o singolarmente)
 */
import rawCatalog from '../data/furnitureCatalog.json';
import type { Furniture, FurnitureCatalogItem, Point2D, Wall } from '../types/project';
import { getWallsBounds } from './geometry';

const CATALOG = rawCatalog as FurnitureCatalogItem[];
const CATALOG_MAP = new Map(CATALOG.map((c) => [c.id, c]));

export type AutoRoomType =
  | 'soggiorno'
  | 'cucina'
  | 'camera_matrimoniale'
  | 'camera_singola'
  | 'bagno'
  | 'studio';

export const AUTO_ROOM_OPTIONS: { id: AutoRoomType; label: string; desc: string }[] = [
  { id: 'soggiorno', label: 'Soggiorno', desc: 'Divano, tavolino, mobile TV, poltrona, pianta' },
  { id: 'cucina', label: 'Cucina / Pranzo', desc: 'Cucina lineare, tavolo da pranzo e 4 sedie' },
  { id: 'camera_matrimoniale', label: 'Camera matrimoniale', desc: 'Letto matrimoniale, 2 comodini, armadio' },
  { id: 'camera_singola', label: 'Camera singola', desc: 'Letto singolo, comodino, scrivania, armadio' },
  { id: 'bagno', label: 'Bagno', desc: 'Lavabo, WC, doccia e lavatrice' },
  { id: 'studio', label: 'Studio', desc: 'Scrivania, sedia, libreria, poltrona, pianta' },
];

export interface RoomBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/**
 * Stima il rettangolo interno della stanza che contiene `point` lanciando 4 raggi ortogonali
 * verso i muri attivi (escludendo i muri abbattuti).
 */
export function detectRoomBoxAtPoint(point: Point2D, walls: Wall[]): RoomBox {
  const activeWalls = walls.filter((w) => !w.demolished);
  const fallback = getWallsBounds(activeWalls);

  if (activeWalls.length === 0) {
    return {
      minX: point.x - 2,
      maxX: point.x + 2,
      minY: point.y - 1.8,
      maxY: point.y + 1.8,
      width: 4,
      height: 3.6,
      centerX: point.x,
      centerY: point.y,
    };
  }

  let leftHit = -Infinity;
  let rightHit = Infinity;
  let topHit = -Infinity;
  let bottomHit = Infinity;

  const rayIntersect = (
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    w: Wall
  ): number | null => {
    const sx = w.end.x - w.start.x;
    const sy = w.end.y - w.start.y;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-6) return null;
    const qpx = w.start.x - ox;
    const qpy = w.start.y - oy;
    const t = (qpx * sy - qpy * sx) / denom;
    const u = (qpx * dy - qpy * dx) / denom;
    if (t > 0.05 && u >= -0.02 && u <= 1.02) {
      return Math.max(0.05, t - w.thickness / 2 - 0.04);
    }
    return null;
  };

  for (const w of activeWalls) {
    const dl = rayIntersect(point.x, point.y, -1, 0, w);
    if (dl !== null) leftHit = Math.max(leftHit, point.x - dl);

    const dr = rayIntersect(point.x, point.y, 1, 0, w);
    if (dr !== null) rightHit = Math.min(rightHit, point.x + dr);

    const dt = rayIntersect(point.x, point.y, 0, -1, w);
    if (dt !== null) topHit = Math.max(topHit, point.y - dt);

    const db = rayIntersect(point.x, point.y, 0, 1, w);
    if (db !== null) bottomHit = Math.min(bottomHit, point.y + db);
  }

  const minX = Number.isFinite(leftHit) ? leftHit : fallback.minX + 0.2;
  const maxX = Number.isFinite(rightHit) ? rightHit : fallback.maxX - 0.2;
  const minY = Number.isFinite(topHit) ? topHit : fallback.minY + 0.2;
  const maxY = Number.isFinite(bottomHit) ? bottomHit : fallback.maxY - 0.2;

  const safeW = Math.max(1.8, maxX - minX);
  const safeH = Math.max(1.8, maxY - minY);

  return {
    minX,
    maxX: minX + safeW,
    minY,
    maxY: minY + safeH,
    width: safeW,
    height: safeH,
    centerX: minX + safeW / 2,
    centerY: minY + safeH / 2,
  };
}

function makeItem(
  catalogId: string,
  x: number,
  y: number,
  rotation: number,
  idGen: (prefix: string) => string
): Furniture | null {
  const cat = CATALOG_MAP.get(catalogId);
  if (!cat) return null;
  return {
    id: idGen('furn'),
    catalogId: cat.id,
    name: cat.nome,
    category: cat.categoria,
    geometryType: cat.tipoGeometria,
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    width: cat.dimensioni.width / 100,
    depth: cat.dimensioni.depth / 100,
    height: cat.dimensioni.height / 100,
    rotation: ((rotation % 360) + 360) % 360,
    color: cat.coloreDefault,
    material: cat.materialeDefault,
    customGlbUrl: cat.glbUrl,
  };
}

/** Genera una disposizione coerente e pronta all'uso per il tipo di stanza scelto */
export function generateAutoFurnishLayout(
  roomType: AutoRoomType,
  box: RoomBox,
  idGen: (prefix: string) => string
): Furniture[] {
  const items: Furniture[] = [];
  const push = (id: string, x: number, y: number, rot = 0) => {
    const f = makeItem(id, x, y, rot, idGen);
    if (f) items.push(f);
  };

  const cx = box.centerX;
  const cy = box.centerY;
  const pad = 0.14;

  switch (roomType) {
    case 'soggiorno': {
      const sofaId = box.width >= 3.2 ? 'sofa-3' : 'sofa-2';
      const sofaY = Math.max(box.minY + 0.65, cy - 0.85);
      push(sofaId, cx, sofaY, 0);
      push('coffee-table', cx, sofaY + 1.0, 0);
      push('tv-stand', cx, Math.min(box.maxY - 0.35, sofaY + 1.95), 180);
      if (box.width >= 3.4) {
        push('armchair', Math.min(box.maxX - 0.55, cx + 1.55), sofaY + 0.85, 270);
      }
      push('plant', box.minX + 0.35 + pad, box.minY + 0.35 + pad, 0);
      break;
    }

    case 'cucina': {
      // Cucina lineare lungo il lato superiore
      push('kitchen-linear', cx, box.minY + 0.36 + pad, 0);
      // Tavolo da pranzo al centro-basso con 4 sedie
      const tableY = Math.min(box.maxY - 0.9, box.minY + 2.15);
      push('dining-table', cx, tableY, 0);
      push('chair', cx - 0.42, tableY - 0.7, 0);
      push('chair', cx + 0.42, tableY - 0.7, 0);
      push('chair', cx - 0.42, tableY + 0.7, 180);
      push('chair', cx + 0.42, tableY + 0.7, 180);
      break;
    }

    case 'camera_matrimoniale': {
      const bedY = box.minY + 1.08 + pad;
      push('bed-double', cx, bedY, 0);
      if (box.width >= 2.9) {
        push('nightstand', cx - 1.18, box.minY + 0.28 + pad, 0);
        push('nightstand', cx + 1.18, box.minY + 0.28 + pad, 0);
      }
      // Armadio lungo la parete inferiore o laterale
      push('wardrobe', cx, Math.min(box.maxY - 0.36 - pad, bedY + 1.85), 180);
      break;
    }

    case 'camera_singola': {
      const bedX = box.minX + 0.58 + pad;
      const bedY = box.minY + 1.08 + pad;
      push('bed-single', bedX, bedY, 0);
      push('nightstand', bedX + 0.82, box.minY + 0.26 + pad, 0);
      push('desk', Math.max(cx + 0.3, box.maxX - 0.78 - pad), box.minY + 0.45 + pad, 0);
      push('chair', Math.max(cx + 0.3, box.maxX - 0.78 - pad), box.minY + 1.1 + pad, 180);
      push('wardrobe', cx, box.maxY - 0.36 - pad, 180);
      break;
    }

    case 'bagno': {
      push('shower', box.minX + 0.5 + pad, box.minY + 0.5 + pad, 0);
      push('sink', Math.min(box.maxX - 0.48 - pad, box.minX + 1.65), box.minY + 0.32 + pad, 0);
      push('wc', box.maxX - 0.34 - pad, Math.min(box.maxY - 0.45, box.minY + 1.25), 270);
      if (box.width >= 2.2) {
        push('washing-machine', box.minX + 0.38 + pad, box.maxY - 0.38 - pad, 180);
      }
      break;
    }

    case 'studio': {
      push('desk', cx, cy - 0.25, 0);
      push('chair', cx, cy + 0.42, 180);
      push('bookshelf', cx, box.minY + 0.24 + pad, 0);
      push('plant', box.minX + 0.32 + pad, box.minY + 0.32 + pad, 0);
      if (box.width >= 3.0) {
        push('armchair', box.maxX - 0.55 - pad, box.maxY - 0.55 - pad, 315);
      }
      break;
    }
  }

  return items;
}

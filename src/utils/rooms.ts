/**
 * Rilevamento automatico delle singole stanze dalla pianta 2D (flood-fill su griglia metrica):
 * - Gestisce stanze rettangolari, a L, irregolari e piccole imprecisioni di tracciatura agli angoli
 * - Associa automaticamente mobili e muri confinanti a ciascuna stanza
 * - Assegna un nome intelligente in italiano (Bagno, Cucina, Soggiorno, Camera, Studio, ecc.)
 * - Fornisce il ritaglio geometrico pulito di muri e aperture per isolare una singola stanza nel 3D
 */
import type { Furniture, Opening, Point2D, Wall } from '../types/project';
import { getWallsBounds, wallLength } from './geometry';

export interface FloorStrip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedRoom {
  id: string;
  name: string;
  kind: 'bagno' | 'cucina' | 'soggiorno_cucina' | 'soggiorno' | 'camera' | 'studio' | 'scale' | 'generica';
  areaSqm: number;
  perimeterM: number;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  };
  /** Rettangoli che compongono esattamente il pavimento della stanza (anche per forme a L) */
  floorStrips: FloorStrip[];
  furnitureIds: string[];
  wallIds: string[];
  /** Funzione veloce per verificare se un punto (in metri) ricade dentro la stanza */
  containsPoint: (x: number, y: number) => boolean;
}

interface GridInfo {
  cols: number;
  rows: number;
  cellSize: number;
  originX: number;
  originY: number;
  /** -1 = muro, 0 = esterno, >=1 = id numerico della stanza */
  labels: Int16Array;
}

function distToSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/** Rasterizza i muri attivi ed esegue flood-fill per trovare tutte le stanze chiuse */
function buildRoomGrid(activeWalls: Wall[]): { grid: GridInfo; roomCount: number } | null {
  if (activeWalls.length < 3) return null;

  const bounds = getWallsBounds(activeWalls);
  const pad = 0.6;
  const spanX = bounds.width + pad * 2;
  const spanY = bounds.height + pad * 2;
  const maxSpan = Math.max(spanX, spanY, 2);

  // Risoluzione ~10cm (limitata a 170 celle per lato per restare istantanea <2ms)
  const cellSize = Math.max(0.08, Math.min(0.14, maxSpan / 160));
  const cols = Math.max(12, Math.ceil(spanX / cellSize));
  const rows = Math.max(12, Math.ceil(spanY / cellSize));
  const originX = bounds.minX - pad;
  const originY = bounds.minY - pad;

  const labels = new Int16Array(cols * rows);

  // 1. Rasterizza ogni muro attivo con leggera estensione sugli estremi per chiudere micro-fessure d'angolo
  for (const w of activeWalls) {
    const len = wallLength(w);
    if (len < 0.05) continue;
    const ux = (w.end.x - w.start.x) / len;
    const uy = (w.end.y - w.start.y) / len;
    const ext = Math.min(0.14, Math.max(w.thickness * 0.6, cellSize));
    const ax = w.start.x - ux * ext;
    const ay = w.start.y - uy * ext;
    const bx = w.end.x + ux * ext;
    const by = w.end.y + uy * ext;

    const halfThick = Math.max(w.thickness * 0.52, cellSize * 0.8);
    const halfThickSq = halfThick * halfThick;

    const minC = Math.max(0, Math.floor((Math.min(ax, bx) - halfThick - originX) / cellSize));
    const maxC = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + halfThick - originX) / cellSize));
    const minR = Math.max(0, Math.floor((Math.min(ay, by) - halfThick - originY) / cellSize));
    const maxR = Math.min(rows - 1, Math.ceil((Math.max(ay, by) + halfThick - originY) / cellSize));

    for (let r = minR; r <= maxR; r++) {
      const cy = originY + (r + 0.5) * cellSize;
      for (let c = minC; c <= maxC; c++) {
        const cx = originX + (c + 0.5) * cellSize;
        if (distToSegmentSq(cx, cy, ax, ay, bx, by) <= halfThickSq) {
          labels[r * cols + c] = -1;
        }
      }
    }
  }

  // 2. Flood-fill dall'esterno (valore -2 = esterno visitato)
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  const enqueueExterior = (r: number, c: number) => {
    const idx = r * cols + c;
    if (labels[idx] === 0) {
      labels[idx] = -2;
      queue[tail++] = idx;
    }
  };

  for (let c = 0; c < cols; c++) {
    enqueueExterior(0, c);
    enqueueExterior(rows - 1, c);
  }
  for (let r = 0; r < rows; r++) {
    enqueueExterior(r, 0);
    enqueueExterior(r, cols - 1);
  }

  while (head < tail) {
    const idx = queue[head++];
    const r = Math.floor(idx / cols);
    const c = idx - r * cols;
    if (r > 0) enqueueExterior(r - 1, c);
    if (r < rows - 1) enqueueExterior(r + 1, c);
    if (c > 0) enqueueExterior(r, c - 1);
    if (c < cols - 1) enqueueExterior(r, c + 1);
  }

  // 3. Componenti connesse interne (valori 1..N)
  let roomCount = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== 0) continue;
    roomCount++;
    head = 0;
    tail = 0;
    labels[i] = roomCount;
    queue[tail++] = i;

    while (head < tail) {
      const idx = queue[head++];
      const r = Math.floor(idx / cols);
      const c = idx - r * cols;
      const neighbors = [
        r > 0 ? idx - cols : -1,
        r < rows - 1 ? idx + cols : -1,
        c > 0 ? idx - 1 : -1,
        c < cols - 1 ? idx + 1 : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && labels[n] === 0) {
          labels[n] = roomCount;
          queue[tail++] = n;
        }
      }
    }
  }

  return {
    grid: { cols, rows, cellSize, originX, originY, labels },
    roomCount,
  };
}

/** Riduce le celle di una stanza in rettangoli orizzontali uniti verticalmente (pavimento esatto anche a L) */
function extractFloorStrips(grid: GridInfo, roomLabel: number): FloorStrip[] {
  const { cols, rows, cellSize, originX, originY, labels } = grid;
  // Espande leggermente di mezzo muro (~0.11m) per non lasciare fessure tra pavimento e pareti
  const expand = 0.11;
  const rawRuns: { r: number; c0: number; c1: number }[] = [];

  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (labels[r * cols + c] === roomLabel) {
        const c0 = c;
        while (c < cols && labels[r * cols + c] === roomLabel) c++;
        rawRuns.push({ r, c0, c1: c });
      } else {
        c++;
      }
    }
  }

  // Unisce righe consecutive con stessi c0..c1
  const merged: { r0: number; r1: number; c0: number; c1: number }[] = [];
  for (const run of rawRuns) {
    const prev = merged.find((m) => m.r1 === run.r && m.c0 === run.c0 && m.c1 === run.c1);
    if (prev) {
      prev.r1 = run.r + 1;
    } else {
      merged.push({ r0: run.r, r1: run.r + 1, c0: run.c0, c1: run.c1 });
    }
  }

  return merged.map((m) => ({
    x: originX + m.c0 * cellSize - expand,
    y: originY + m.r0 * cellSize - expand,
    width: (m.c1 - m.c0) * cellSize + expand * 2,
    height: (m.r1 - m.r0) * cellSize + expand * 2,
  }));
}

function classifyRoomFromFurniture(items: Furniture[]): {
  kind: DetectedRoom['kind'];
  baseName: string;
} {
  const types = new Set(items.map((f) => f.geometryType));
  const hasBath =
    types.has('wc') ||
    types.has('bidet') ||
    types.has('shower') ||
    types.has('bathtub') ||
    types.has('sink') ||
    types.has('bathroom_vanity');
  const hasKitchen =
    types.has('kitchen_linear') ||
    types.has('kitchen_l') ||
    types.has('kitchen_peninsula') ||
    types.has('kitchen_island') ||
    types.has('fridge');
  const hasSofa =
    types.has('sofa_2') ||
    types.has('sofa_3') ||
    types.has('sofa_l') ||
    types.has('tv_stand');
  const hasDoubleBed = types.has('bed_double');
  const hasSingleBed = types.has('bed_single') || types.has('bed_bunk');
  const hasStudy = types.has('desk') || types.has('bookshelf');
  const hasStairs =
    types.has('stairs_straight') || types.has('stairs_l') || types.has('stairs_u');

  if (hasBath && !hasKitchen && !hasDoubleBed && !hasSingleBed) {
    return { kind: 'bagno', baseName: 'Bagno' };
  }
  if (hasKitchen && hasSofa) {
    return { kind: 'soggiorno_cucina', baseName: 'Soggiorno / Cucina' };
  }
  if (hasKitchen) {
    return { kind: 'cucina', baseName: 'Cucina' };
  }
  if (hasDoubleBed) {
    return { kind: 'camera', baseName: 'Camera matrimoniale' };
  }
  if (hasSingleBed) {
    return { kind: 'camera', baseName: 'Camera singola' };
  }
  if (hasSofa) {
    return { kind: 'soggiorno', baseName: 'Soggiorno' };
  }
  if (hasStudy) {
    return { kind: 'studio', baseName: 'Studio' };
  }
  if (hasStairs && items.length <= 2) {
    return { kind: 'scale', baseName: 'Vano scale' };
  }
  if (hasBath) {
    return { kind: 'bagno', baseName: 'Bagno' };
  }
  return { kind: 'generica', baseName: 'Stanza' };
}

/**
 * Rileva tutte le stanze distinte del progetto in ordine leggibile (alto->basso, sinistra->destra).
 */
export function detectRooms(walls: Wall[], furniture: Furniture[]): DetectedRoom[] {
  const activeWalls = walls.filter((w) => !w.demolished);
  if (activeWalls.length === 0) return [];

  const res = buildRoomGrid(activeWalls);

  // Fallback se i muri non formano ancora un perimetro chiuso: unica stanza sull'intera area
  if (!res || res.roomCount === 0) {
    const b = getWallsBounds(activeWalls);
    const { kind, baseName } = classifyRoomFromFurniture(furniture);
    return [
      {
        id: 'room_1',
        name: kind === 'generica' ? 'Ambiente unico' : baseName,
        kind,
        areaSqm: Number((b.width * b.height).toFixed(2)),
        perimeterM: Number((2 * (b.width + b.height)).toFixed(2)),
        bounds: b,
        floorStrips: [{ x: b.minX, y: b.minY, width: b.width, height: b.height }],
        furnitureIds: furniture.map((f) => f.id),
        wallIds: activeWalls.map((w) => w.id),
        containsPoint: (x, y) =>
          x >= b.minX - 0.1 && x <= b.maxX + 0.1 && y >= b.minY - 0.1 && y <= b.maxY + 0.1,
      },
    ];
  }

  const { grid } = res;
  const { cols, rows, cellSize, originX, originY, labels } = grid;

  const getCellLabel = (x: number, y: number): number => {
    const c = Math.floor((x - originX) / cellSize);
    const r = Math.floor((y - originY) / cellSize);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return -2;
    return labels[r * cols + c];
  };

  interface RawRoom {
    label: number;
    cellCount: number;
    borderEdges: number;
    minC: number;
    maxC: number;
    minR: number;
    maxR: number;
  }

  const rawMap = new Map<number, RawRoom>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lbl = labels[r * cols + c];
      if (lbl <= 0) continue;
      let entry = rawMap.get(lbl);
      if (!entry) {
        entry = {
          label: lbl,
          cellCount: 0,
          borderEdges: 0,
          minC: c,
          maxC: c,
          minR: r,
          maxR: r,
        };
        rawMap.set(lbl, entry);
      }
      entry.cellCount++;
      if (c < entry.minC) entry.minC = c;
      if (c > entry.maxC) entry.maxC = c;
      if (r < entry.minR) entry.minR = r;
      if (r > entry.maxR) entry.maxR = r;

      if (r === 0 || labels[(r - 1) * cols + c] !== lbl) entry.borderEdges++;
      if (r === rows - 1 || labels[(r + 1) * cols + c] !== lbl) entry.borderEdges++;
      if (c === 0 || labels[r * cols + (c - 1)] !== lbl) entry.borderEdges++;
      if (c === cols - 1 || labels[r * cols + (c + 1)] !== lbl) entry.borderEdges++;
    }
  }

  const cellArea = cellSize * cellSize;
  const validRaw = Array.from(rawMap.values())
    .filter((rm) => rm.cellCount * cellArea >= 0.85)
    .sort((a, b) => {
      const ay = (a.minR + a.maxR) / 2;
      const by = (b.minR + b.maxR) / 2;
      if (Math.abs(ay - by) > 6) return ay - by;
      return (a.minC + a.maxC) / 2 - (b.minC + b.maxC) / 2;
    });

  if (validRaw.length === 0) {
    const b = getWallsBounds(activeWalls);
    return [
      {
        id: 'room_1',
        name: 'Ambiente unico',
        kind: 'generica',
        areaSqm: Number((b.width * b.height).toFixed(2)),
        perimeterM: Number((2 * (b.width + b.height)).toFixed(2)),
        bounds: b,
        floorStrips: [{ x: b.minX, y: b.minY, width: b.width, height: b.height }],
        furnitureIds: furniture.map((f) => f.id),
        wallIds: activeWalls.map((w) => w.id),
        containsPoint: (x, y) =>
          x >= b.minX - 0.1 && x <= b.maxX + 0.1 && y >= b.minY - 0.1 && y <= b.maxY + 0.1,
      },
    ];
  }

  const validLabelSet = new Set(validRaw.map((r) => r.label));

  // Assegna ogni mobile alla stanza che contiene il suo centro (o cella valida più vicina entro 0.45m)
  const furnByLabel = new Map<number, Furniture[]>();
  for (const f of furniture) {
    let lbl = getCellLabel(f.x, f.y);
    if (!validLabelSet.has(lbl)) {
      // Cerca nelle celle circostanti se il mobile è molto vicino a un muro
      let found = 0;
      const searchR = Math.ceil(0.45 / cellSize);
      const fc = Math.floor((f.x - originX) / cellSize);
      const fr = Math.floor((f.y - originY) / cellSize);
      let bestDistSq = Infinity;
      for (let dr = -searchR; dr <= searchR; dr++) {
        for (let dc = -searchR; dc <= searchR; dc++) {
          const r = fr + dr;
          const c = fc + dc;
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
          const candidate = labels[r * cols + c];
          if (validLabelSet.has(candidate)) {
            const dSq = dr * dr + dc * dc;
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              found = candidate;
            }
          }
        }
      }
      lbl = found;
    }
    if (validLabelSet.has(lbl)) {
      const list = furnByLabel.get(lbl) ?? [];
      list.push(f);
      furnByLabel.set(lbl, list);
    }
  }

  // Associa i muri che delimitano ogni stanza (campionamento su entrambi i lati normali)
  const wallsByLabel = new Map<number, Set<string>>();
  for (const w of activeWalls) {
    const len = wallLength(w);
    if (len < 0.15) continue;
    const nx = -(w.end.y - w.start.y) / len;
    const ny = (w.end.x - w.start.x) / len;
    const offset = Math.max(w.thickness * 0.5 + cellSize * 1.4, 0.22);
    const samples = Math.max(5, Math.ceil(len / 0.2));
    const hitCounts = new Map<number, number>();

    for (let s = 1; s < samples; s++) {
      const t = s / samples;
      const px = w.start.x + (w.end.x - w.start.x) * t;
      const py = w.start.y + (w.end.y - w.start.y) * t;
      for (const sign of [-1, 1]) {
        const lbl = getCellLabel(px + nx * offset * sign, py + ny * offset * sign);
        if (validLabelSet.has(lbl)) {
          hitCounts.set(lbl, (hitCounts.get(lbl) ?? 0) + 1);
        }
      }
    }

    for (const [lbl, count] of hitCounts.entries()) {
      // Richiede almeno ~20cm di adiacenza per evitare falsi tocchi di muri ortogonali
      if (count >= 2 || (len < 0.6 && count >= 1)) {
        const set = wallsByLabel.get(lbl) ?? new Set<string>();
        set.add(w.id);
        wallsByLabel.set(lbl, set);
      }
    }
  }

  // Compila le stanze e risolve eventuali omonimie ("Bagno 1", "Bagno 2")
  const draftRooms = validRaw.map((rm, idx) => {
    const items = furnByLabel.get(rm.label) ?? [];
    const { kind, baseName } = classifyRoomFromFurniture(items);
    // Aggiunge la metà dello spessore muro tipico sui bordi per stimare area interna realistica
    const minX = originX + rm.minC * cellSize - 0.08;
    const maxX = originX + (rm.maxC + 1) * cellSize + 0.08;
    const minY = originY + rm.minR * cellSize - 0.08;
    const maxY = originY + (rm.maxR + 1) * cellSize + 0.08;
    const width = Math.max(0.6, maxX - minX);
    const height = Math.max(0.6, maxY - minY);
    const rawArea = rm.cellCount * cellArea;
    // Compensa l'erosione di ~halfThickness lungo il perimetro
    const perimeterApprox = rm.borderEdges * cellSize;
    const areaSqm = Number((rawArea + perimeterApprox * 0.06).toFixed(2));
    const roomLabel = rm.label;

    return {
      id: `room_${idx + 1}`,
      baseName,
      kind,
      areaSqm,
      perimeterM: Number(perimeterApprox.toFixed(2)),
      bounds: {
        minX,
        maxX,
        minY,
        maxY,
        width,
        height,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
      },
      floorStrips: extractFloorStrips(grid, roomLabel),
      furnitureIds: items.map((f) => f.id),
      wallIds: Array.from(wallsByLabel.get(roomLabel) ?? []),
      containsPoint: (x: number, y: number) => getCellLabel(x, y) === roomLabel,
    };
  });

  const nameCounts = new Map<string, number>();
  for (const r of draftRooms) {
    nameCounts.set(r.baseName, (nameCounts.get(r.baseName) ?? 0) + 1);
  }
  const seenCounts = new Map<string, number>();

  return draftRooms.map((r) => {
    const total = nameCounts.get(r.baseName) ?? 1;
    const nextNum = (seenCounts.get(r.baseName) ?? 0) + 1;
    seenCounts.set(r.baseName, nextNum);
    const name =
      total > 1 || r.baseName === 'Stanza' ? `${r.baseName} ${nextNum}` : r.baseName;

    return {
      id: r.id,
      name,
      kind: r.kind,
      areaSqm: r.areaSqm,
      perimeterM: r.perimeterM,
      bounds: r.bounds,
      floorStrips: r.floorStrips,
      furnitureIds: r.furnitureIds,
      wallIds: r.wallIds,
      containsPoint: r.containsPoint,
    };
  });
}

/**
 * Ritaglia geometricamente i muri e riallinea le aperture per isolare una singola stanza nel 3D.
 * Se un muro continuo attraversa più stanze, mantiene solo il tratto che confina con `room`.
 */
export function clipWallsAndOpeningsForRoom(
  walls: Wall[],
  openings: Opening[],
  room: DetectedRoom
): { walls: Wall[]; openings: Opening[] } {
  const roomWallSet = new Set(room.wallIds);
  const clippedWalls: Wall[] = [];
  const clippedOpenings: Opening[] = [];

  for (const w of walls) {
    if (w.demolished || !roomWallSet.has(w.id)) continue;
    const len = wallLength(w);
    if (len < 0.15) continue;

    const nx = -(w.end.y - w.start.y) / len;
    const ny = (w.end.x - w.start.x) / len;
    const offset = Math.max(w.thickness * 0.5 + 0.18, 0.24);
    const samples = Math.max(12, Math.ceil(len / 0.12));

    let minHit = Infinity;
    let maxHit = -Infinity;

    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const px = w.start.x + (w.end.x - w.start.x) * t;
      const py = w.start.y + (w.end.y - w.start.y) * t;
      const touchesRoom =
        room.containsPoint(px + nx * offset, py + ny * offset) ||
        room.containsPoint(px - nx * offset, py - ny * offset);
      if (touchesRoom) {
        if (t < minHit) minHit = t;
        if (t > maxHit) maxHit = t;
      }
    }

    if (!Number.isFinite(minHit) || maxHit <= minHit) continue;

    // Espande leggermente sugli estremi per chiudere bene gli angoli della stanza
    const padT = Math.min(0.15, (w.thickness * 0.75 + 0.08) / len);
    const t0 = Math.max(0, minHit - padT);
    const t1 = Math.min(1, maxHit + padT);
    const newLen = (t1 - t0) * len;
    if (newLen < 0.18) continue;

    const newStart: Point2D = {
      x: w.start.x + (w.end.x - w.start.x) * t0,
      y: w.start.y + (w.end.y - w.start.y) * t0,
    };
    const newEnd: Point2D = {
      x: w.start.x + (w.end.x - w.start.x) * t1,
      y: w.start.y + (w.end.y - w.start.y) * t1,
    };

    clippedWalls.push({
      ...w,
      start: newStart,
      end: newEnd,
    });

    // Rimappa le aperture che ricadono nel tratto ritagliato
    for (const op of openings) {
      if (op.wallId !== w.id) continue;
      if (op.position >= t0 - 0.01 && op.position <= t1 + 0.01) {
        const remapped = Math.max(0.05, Math.min(0.95, (op.position - t0) / (t1 - t0)));
        clippedOpenings.push({
          ...op,
          position: remapped,
        });
      }
    }
  }

  return { walls: clippedWalls, openings: clippedOpenings };
}

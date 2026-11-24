/**
 * Utility di geometria 2D per PianteStudio:
 * - Distanze, angoli, proiezioni su segmenti
 * - Snap ad angoli di 90° e snap ai vertici esistenti
 * - Aggancio aperture ai muri
 * - Rilevamento collisioni OBB (SAT) tra mobili e tra mobili e ingombro porte
 */
import type { Furniture, Opening, Point2D, Wall } from '../types/project';

export function distance2D(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function wallLength(wall: Wall): number {
  return distance2D(wall.start, wall.end);
}

/** Angolo del muro in radianti (-PI..PI) */
export function wallAngleRad(wall: Wall): number {
  return Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
}

/** Angolo del muro in gradi */
export function wallAngleDeg(wall: Wall): number {
  return (wallAngleRad(wall) * 180) / Math.PI;
}

/** Snap di un punto a incrementi di 90° (orizzontale/verticale) rispetto a un'origine */
export function snapAngle90(origin: Point2D, target: Point2D): Point2D {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: target.x, y: origin.y };
  }
  return { x: origin.x, y: target.y };
}

/** Trova il vertice esistente più vicino entro una soglia (in metri) */
export function findNearestVertex(
  point: Point2D,
  walls: Wall[],
  thresholdMeters = 0.2,
  excludeWallId?: string
): Point2D | null {
  let best: Point2D | null = null;
  let bestDist = thresholdMeters;

  for (const w of walls) {
    if (w.id === excludeWallId) continue;
    for (const v of [w.start, w.end]) {
      const d = distance2D(point, v);
      if (d < bestDist) {
        bestDist = d;
        best = { x: v.x, y: v.y };
      }
    }
  }
  return best;
}

/** Proietta un punto su un segmento e restituisce posizione t in [0..1], punto proiettato e distanza */
export function projectPointToSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D
): { t: number; point: Point2D; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return { t: 0, point: { ...a }, distance: distance2D(p, a) };
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, point: proj, distance: distance2D(p, proj) };
}

/**
 * Trova il muro più vicino per agganciare un'apertura e limita t affinché l'apertura
 * resti all'interno del muro.
 */
export function findClosestWallForOpening(
  point: Point2D,
  walls: Wall[],
  openingWidth: number,
  maxDistanceMeters = 1.2
): { wall: Wall; position: number; distance: number } | null {
  let best: { wall: Wall; position: number; distance: number } | null = null;

  for (const wall of walls) {
    if (wall.demolished) continue;
    const len = wallLength(wall);
    if (len < 0.25) continue;
    const proj = projectPointToSegment(point, wall.start, wall.end);
    if (proj.distance <= maxDistanceMeters && (!best || proj.distance < best.distance)) {
      const halfRatio = Math.min(0.48, (openingWidth / 2 + 0.05) / len);
      const clampedT = Math.max(halfRatio, Math.min(1 - halfRatio, proj.t));
      best = { wall, position: clampedT, distance: proj.distance };
    }
  }
  return best;
}

/** Calcola il centro 2D (in metri) di un'apertura sul suo muro */
export function getOpeningCenter(opening: Opening, wall: Wall): Point2D {
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * opening.position,
    y: wall.start.y + (wall.end.y - wall.start.y) * opening.position,
  };
}

/** Restituisce i 4 vertici dell'OBB (Oriented Bounding Box) di un mobile in metri */
export function getFurnitureCorners(item: Furniture, margin = 0): Point2D[] {
  const hw = Math.max(0.02, item.width / 2 - margin);
  const hd = Math.max(0.02, item.depth / 2 - margin);
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const local: Point2D[] = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];

  return local.map((pt) => ({
    x: item.x + pt.x * cos - pt.y * sin,
    y: item.y + pt.x * sin + pt.y * cos,
  }));
}

/** Restituisce il poligono 2D di ingombro dell'apertura (area di battuta per porte) */
export function getDoorClearancePolygon(opening: Opening, wall: Wall): Point2D[] | null {
  if (opening.type !== 'door_internal' && opening.type !== 'door_entrance') {
    return null;
  }
  // Le porte scorrevoli non occupano area di battuta nella stanza
  if (opening.doorStyle === 'sliding') {
    return null;
  }
  const center = getOpeningCenter(opening, wall);
  const angle = wallAngleRad(wall);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Normale al muro
  const nx = -sin;
  const ny = cos;

  const sideSign = opening.swing === 'left_in' || opening.swing === 'right_in' ? 1 : -1;
  const hw = opening.width / 2 - 0.03;
  const clearanceDepth =
    opening.doorStyle === 'double' ? opening.width * 0.48 : opening.width * 0.92;
  const startOffset = wall.thickness / 2;

  const p1 = {
    x: center.x - cos * hw + nx * sideSign * startOffset,
    y: center.y - sin * hw + ny * sideSign * startOffset,
  };
  const p2 = {
    x: center.x + cos * hw + nx * sideSign * startOffset,
    y: center.y + sin * hw + ny * sideSign * startOffset,
  };
  const p3 = {
    x: p2.x + nx * sideSign * clearanceDepth,
    y: p2.y + ny * sideSign * clearanceDepth,
  };
  const p4 = {
    x: p1.x + nx * sideSign * clearanceDepth,
    y: p1.y + ny * sideSign * clearanceDepth,
  };

  return [p1, p2, p3, p4];
}

/** Test di intersezione tra due poligoni convessi mediante Separating Axis Theorem (SAT) */
export function polygonsOverlap(polyA: Point2D[], polyB: Point2D[]): boolean {
  const polygons = [polyA, polyB];
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      const axis = { x: -(p2.y - p1.y), y: p2.x - p1.x };
      const len = Math.hypot(axis.x, axis.y);
      if (len < 1e-9) continue;
      axis.x /= len;
      axis.y /= len;

      let minA = Infinity;
      let maxA = -Infinity;
      for (const p of polyA) {
        const proj = p.x * axis.x + p.y * axis.y;
        if (proj < minA) minA = proj;
        if (proj > maxA) maxA = proj;
      }

      let minB = Infinity;
      let maxB = -Infinity;
      for (const p of polyB) {
        const proj = p.x * axis.x + p.y * axis.y;
        if (proj < minB) minB = proj;
        if (proj > maxB) maxB = proj;
      }

      if (maxA <= minB + 1e-4 || maxB <= minA + 1e-4) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Calcola tutti i mobili con conflitti (sovrapposizione con un altro mobile o blocco porta).
 * Restituisce una mappa id -> motivo del conflitto.
 */
export function detectFurnitureCollisions(
  furniture: Furniture[],
  openings: Opening[],
  walls: Wall[]
): Record<string, string> {
  const conflicts: Record<string, string> = {};
  const polys = furniture.map((f) => getFurnitureCorners(f, 0.015));

  // Controllo sovrapposizione mobile-mobile (esclude tappeti a terra e caldaie sospese a parete)
  for (let i = 0; i < furniture.length; i++) {
    if (furniture[i].geometryType === 'rug' || furniture[i].geometryType === 'boiler') continue;
    for (let j = i + 1; j < furniture.length; j++) {
      if (furniture[j].geometryType === 'rug' || furniture[j].geometryType === 'boiler') continue;
      if (polygonsOverlap(polys[i], polys[j])) {
        conflicts[furniture[i].id] = `Sovrapposto a ${furniture[j].name}`;
        conflicts[furniture[j].id] = `Sovrapposto a ${furniture[i].name}`;
      }
    }
  }

  // Controllo ingombro apertura porte
  const wallMap = new Map(walls.map((w) => [w.id, w]));
  const doorClearances: { poly: Point2D[]; label: string }[] = [];
  for (const op of openings) {
    const w = wallMap.get(op.wallId);
    if (!w || w.demolished) continue;
    const poly = getDoorClearancePolygon(op, w);
    if (poly) {
      doorClearances.push({
        poly,
        label: op.type === 'door_entrance' ? "porta d'ingresso" : 'porta interna',
      });
    }
  }

  for (let i = 0; i < furniture.length; i++) {
    if (furniture[i].geometryType === 'rug' || furniture[i].geometryType === 'boiler') continue;
    for (const door of doorClearances) {
      if (polygonsOverlap(polys[i], door.poly)) {
        conflicts[furniture[i].id] = `Blocca apertura ${door.label}`;
      }
    }
  }

  return conflicts;
}

/** Snap di un mobile alla griglia (passo in metri) e ai muri vicini */
export function snapFurniturePosition(
  item: { x: number; y: number; width: number; depth: number; rotation: number },
  walls: Wall[],
  options: { snapGrid: boolean; gridSize: number; snapWalls: boolean }
): Point2D {
  let x = item.x;
  let y = item.y;

  if (options.snapGrid) {
    const g = options.gridSize;
    x = Math.round(x / g) * g;
    y = Math.round(y / g) * g;
  }

  if (options.snapWalls && walls.length > 0) {
    const snapMargin = 0.22; // 22 cm soglia magnetica dal muro
    const rotRad = (item.rotation * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(rotRad));
    const absSin = Math.abs(Math.sin(rotRad));
    // Half extents lungo gli assi locali rispetto al muro
    let bestShift: Point2D | null = null;
    let bestDist = snapMargin;

    for (const w of walls) {
      if (w.demolished) continue;
      const proj = projectPointToSegment({ x, y }, w.start, w.end);
      // Solo se siamo vicini lungo la lunghezza del muro
      if (proj.t < 0.02 || proj.t > 0.98) continue;

      const wAngle = wallAngleRad(w);
      const nx = -Math.sin(wAngle);
      const ny = Math.cos(wAngle);

      // Distanza firmata dal centro del mobile all'asse del muro
      const signedDist = (x - proj.point.x) * nx + (y - proj.point.y) * ny;
      const side = signedDist >= 0 ? 1 : -1;

      // Calcola semi-ingombro del mobile lungo la normale del muro
      const ux = Math.cos(rotRad);
      const uy = Math.sin(rotRad);
      const vx = -uy;
      const vy = ux;
      const halfProj =
        Math.abs(ux * nx + uy * ny) * (item.width / 2) +
        Math.abs(vx * nx + vy * ny) * (item.depth / 2);

      const targetDist = w.thickness / 2 + halfProj;
      const gap = Math.abs(Math.abs(signedDist) - targetDist);

      if (gap < bestDist) {
        bestDist = gap;
        const delta = side * targetDist - signedDist;
        bestShift = { x: x + nx * delta, y: y + ny * delta };
      }
    }

    if (bestShift) {
      x = bestShift.x;
      y = bestShift.y;
    }
    void absCos;
    void absSin;
  }

  return { x, y };
}

/** Calcola il bounding box complessivo dei muri in metri */
export function getWallsBounds(walls: Wall[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
} {
  if (walls.length === 0) {
    return {
      minX: 0,
      maxX: 8,
      minY: 0,
      maxY: 6,
      centerX: 4,
      centerY: 3,
      width: 8,
      height: 6,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const w of walls) {
    const pad = w.thickness / 2;
    minX = Math.min(minX, w.start.x - pad, w.end.x - pad);
    maxX = Math.max(maxX, w.start.x + pad, w.end.x + pad);
    minY = Math.min(minY, w.start.y - pad, w.end.y - pad);
    maxY = Math.max(maxY, w.start.y + pad, w.end.y + pad);
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Correzione automatica dei muri tracciati:
 * 1. Raddrizza muri quasi orizzontali o verticali (entro ±7°)
 * 2. Allinea muri quasi collineari (entro 22 cm) sullo stesso asse
 * 3. Taglia eventuali sporgenze di muri un po' troppo lunghi e chiude angoli/T leggermente corti (entro 40 cm)
 * 4. Salda i vertici molto vicini (entro 22 cm)
 */
export function autoAlignWalls(inputWalls: Wall[]): { walls: Wall[]; adjustedCount: number } {
  if (inputWalls.length === 0) return { walls: [], adjustedCount: 0 };

  const walls: Wall[] = inputWalls.map((w) => ({
    ...w,
    start: { ...w.start },
    end: { ...w.end },
  }));

  const isHorizontal = (w: Wall) => {
    const dx = Math.abs(w.end.x - w.start.x);
    const dy = Math.abs(w.end.y - w.start.y);
    return dx > 0.05 && dy / Math.max(dx, 1e-6) < Math.tan((7 * Math.PI) / 180);
  };

  const isVertical = (w: Wall) => {
    const dx = Math.abs(w.end.x - w.start.x);
    const dy = Math.abs(w.end.y - w.start.y);
    return dy > 0.05 && dx / Math.max(dy, 1e-6) < Math.tan((7 * Math.PI) / 180);
  };

  // Passo 1: Raddrizza muri quasi H / quasi V attorno al loro punto medio
  for (const w of walls) {
    if (isHorizontal(w)) {
      const midY = (w.start.y + w.end.y) / 2;
      w.start.y = midY;
      w.end.y = midY;
    } else if (isVertical(w)) {
      const midX = (w.start.x + w.end.x) / 2;
      w.start.x = midX;
      w.end.x = midX;
    }
  }

  // Passo 2: Allinea sullo stesso asse muri H con Y molto vicina (<= 22 cm) e muri V con X molto vicina (<= 22 cm)
  const axisTol = 0.22;
  const hWalls = walls.filter((w) => Math.abs(w.end.y - w.start.y) < 1e-4);
  const vWalls = walls.filter((w) => Math.abs(w.end.x - w.start.x) < 1e-4);

  const hVisited = new Set<string>();
  for (const w of hWalls) {
    if (hVisited.has(w.id)) continue;
    const cluster = hWalls.filter(
      (o) => !hVisited.has(o.id) && Math.abs(o.start.y - w.start.y) <= axisTol
    );
    if (cluster.length > 1) {
      let weightedSum = 0;
      let totalLen = 0;
      for (const c of cluster) {
        const len = Math.max(0.1, wallLength(c));
        weightedSum += c.start.y * len;
        totalLen += len;
        hVisited.add(c.id);
      }
      const avgY = weightedSum / totalLen;
      for (const c of cluster) {
        c.start.y = avgY;
        c.end.y = avgY;
      }
    } else {
      hVisited.add(w.id);
    }
  }

  const vVisited = new Set<string>();
  for (const w of vWalls) {
    if (vVisited.has(w.id)) continue;
    const cluster = vWalls.filter(
      (o) => !vVisited.has(o.id) && Math.abs(o.start.x - w.start.x) <= axisTol
    );
    if (cluster.length > 1) {
      let weightedSum = 0;
      let totalLen = 0;
      for (const c of cluster) {
        const len = Math.max(0.1, wallLength(c));
        weightedSum += c.start.x * len;
        totalLen += len;
        vVisited.add(c.id);
      }
      const avgX = weightedSum / totalLen;
      for (const c of cluster) {
        c.start.x = avgX;
        c.end.x = avgX;
      }
    } else {
      vVisited.add(w.id);
    }
  }

  // Passo 3: Taglia sporgenze (muri leggermente troppo lunghi) ed estende angoli/T leggermente corti (entro 40 cm)
  const cornerTol = 0.4;
  for (const hw of hWalls) {
    const hy = hw.start.y;
    for (const vw of vWalls) {
      const vx = vw.start.x;
      const vMinY = Math.min(vw.start.y, vw.end.y);
      const vMaxY = Math.max(vw.start.y, vw.end.y);
      const hMinX = Math.min(hw.start.x, hw.end.x);
      const hMaxX = Math.max(hw.start.x, hw.end.x);

      // L'asse di hw interseca (o sfiora) l'estensione di vw
      if (hy >= vMinY - cornerTol && hy <= vMaxY + cornerTol) {
        if (Math.abs(hw.start.x - vx) <= cornerTol) hw.start.x = vx;
        if (Math.abs(hw.end.x - vx) <= cornerTol) hw.end.x = vx;
      }

      // L'asse di vw interseca (o sfiora) l'estensione di hw
      if (vx >= hMinX - cornerTol && vx <= hMaxX + cornerTol) {
        if (Math.abs(vw.start.y - hy) <= cornerTol) vw.start.y = hy;
        if (Math.abs(vw.end.y - hy) <= cornerTol) vw.end.y = hy;
      }
    }
  }

  // Passo 4: Salda eventuali coppie di vertici ancora vicini (<= 22 cm, inclusi muri obliqui)
  const vertexTol = 0.22;
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const aPts: ('start' | 'end')[] = ['start', 'end'];
      const bPts: ('start' | 'end')[] = ['start', 'end'];
      for (const ap of aPts) {
        for (const bp of bPts) {
          const pA = walls[i][ap];
          const pB = walls[j][bp];
          const d = distance2D(pA, pB);
          if (d > 1e-4 && d <= vertexTol) {
            const mx = (pA.x + pB.x) / 2;
            const my = (pA.y + pB.y) / 2;
            walls[i][ap] = { x: mx, y: my };
            walls[j][bp] = { x: mx, y: my };
          }
        }
      }
    }
  }

  // Arrotonda al millimetro e conta quanti muri sono stati corretti
  let adjustedCount = 0;
  for (let i = 0; i < walls.length; i++) {
    walls[i].start = {
      x: Number(walls[i].start.x.toFixed(3)),
      y: Number(walls[i].start.y.toFixed(3)),
    };
    walls[i].end = {
      x: Number(walls[i].end.x.toFixed(3)),
      y: Number(walls[i].end.y.toFixed(3)),
    };

    const orig = inputWalls[i];
    const delta =
      distance2D(orig.start, walls[i].start) + distance2D(orig.end, walls[i].end);
    if (delta > 0.004) adjustedCount++;
  }

  return { walls, adjustedCount };
}

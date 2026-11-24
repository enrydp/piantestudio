/**
 * Importatore CAD 100% client-side per file .DXF e .DWG:
 * - Legge .dxf tramite dxf-parser (velocissimo, leggero)
 * - Legge .dwg tramite @mlightcad/libredwg-web (WebAssembly caricato on-demand)
 * - Espande blocchi INSERT e quote DIMENSION, pulisce testi MTEXT e rileva unità reali (mm/cm/m)
 * - Renderizza una piantina ad alta risoluzione già in scala 1:1 (pixelsPerMeter esatto)
 * - Estrae automaticamente i muri (anche unendo doppie linee parallele con il loro spessore reale)
 */
import type { FloorplanImage, Wall } from '../types/project';

export type CadUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export const CAD_UNIT_TO_METERS: Record<CadUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
};

export const CAD_UNIT_LABELS: Record<CadUnit, string> = {
  mm: 'Millimetri (mm)',
  cm: 'Centimetri (cm)',
  m: 'Metri (m)',
  in: 'Pollici (in)',
  ft: 'Piedi (ft)',
};

export interface CadSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  layer: string;
}

export interface CadArc {
  cx: number;
  cy: number;
  r: number;
  startAngle: number; // radianti (CAD CCW)
  endAngle: number;
  layer: string;
}

export interface CadText {
  x: number;
  y: number;
  text: string;
  height: number;
  layer: string;
}

export interface CadLayerInfo {
  name: string;
  segmentCount: number;
  arcCount: number;
  textCount: number;
  suggestedAsWall: boolean;
}

export interface ParsedCadDocument {
  fileName: string;
  format: 'dxf' | 'dwg';
  detectedUnit: CadUnit;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
  };
  layers: CadLayerInfo[];
  segments: CadSegment[];
  arcs: CadArc[];
  texts: CadText[];
}

export function isCadFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return lower.endsWith('.dxf') || lower.endsWith('.dwg');
}

/** Pulisce codici di formattazione MTEXT/AutoCAD per rendere leggibili quote e nomi stanze */
function cleanCadText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\\P/g, ' ')
    .replace(/\{\\[^;]+;([^}]*)\}/g, '$1')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/\\U\+00B2/gi, '²')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapInsUnits(insUnits?: number): CadUnit | null {
  switch (insUnits) {
    case 1:
      return 'in';
    case 2:
      return 'ft';
    case 4:
      return 'mm';
    case 5:
      return 'cm';
    case 6:
      return 'm';
    default:
      return null;
  }
}

/** Stima euristica delle unità se INSUNITS non è impostato nel file CAD */
function guessUnitFromSpan(span: number): CadUnit {
  if (span >= 1800) return 'mm'; // es. appartamento 10m = 10000 mm
  if (span >= 80) return 'cm';   // es. appartamento 10m = 1000 cm
  return 'm';                    // es. appartamento 10m = 10 m
}

function isSuggestedWallLayer(layerName: string): boolean {
  return /(mur|wall|tramezz|paret|perim|strut|pilastr|a-wall|arch_wall|muratur|divisori)/i.test(
    layerName
  );
}

interface Transform2D {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  cos: number;
  sin: number;
}

const IDENTITY_TRANSFORM: Transform2D = { tx: 0, ty: 0, sx: 1, sy: 1, cos: 1, sin: 0 };

function applyTransform(x: number, y: number, tf: Transform2D): { x: number; y: number } {
  const sx = x * tf.sx;
  const sy = y * tf.sy;
  return {
    x: tf.tx + sx * tf.cos - sy * tf.sin,
    y: tf.ty + sx * tf.sin + sy * tf.cos,
  };
}

function composeTransform(
  parent: Transform2D,
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  rotRad: number
): Transform2D {
  const c = Math.cos(rotRad);
  const s = Math.sin(rotRad);
  const p = applyTransform(tx, ty, parent);
  return {
    tx: p.x,
    ty: p.y,
    sx: parent.sx * sx,
    sy: parent.sy * sy,
    cos: parent.cos * c - parent.sin * s,
    sin: parent.sin * c + parent.cos * s,
  };
}

/** Finalizza i bounds e la tabella dei layer a partire dalle primitive estratte */
function finalizeCadDocument(
  fileName: string,
  format: 'dxf' | 'dwg',
  headerUnit: CadUnit | null,
  segments: CadSegment[],
  arcs: CadArc[],
  texts: CadText[]
): ParsedCadDocument {
  // Calcola bounding box ignorando eventuali coordinate non finite o estreme (>1e7)
  const validSegs = segments.filter(
    (s) =>
      Number.isFinite(s.x1) &&
      Number.isFinite(s.y1) &&
      Number.isFinite(s.x2) &&
      Number.isFinite(s.y2) &&
      Math.abs(s.x1) < 1e7 &&
      Math.abs(s.y1) < 1e7 &&
      Math.abs(s.x2) < 1e7 &&
      Math.abs(s.y2) < 1e7
  );
  const validArcs = arcs.filter(
    (a) =>
      Number.isFinite(a.cx) &&
      Number.isFinite(a.cy) &&
      Number.isFinite(a.r) &&
      a.r > 0 &&
      a.r < 1e6
  );
  const validTexts = texts.filter(
    (t) => Number.isFinite(t.x) && Number.isFinite(t.y) && t.text.length > 0
  );

  if (validSegs.length === 0 && validArcs.length === 0) {
    throw new Error(
      'Nessuna linea o geometria 2D trovata nello Spazio Modello del file CAD. Verifica che la piantina non sia solo un’immagine collegata o un XREF esterno.'
    );
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const includePt = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  for (const s of validSegs) {
    includePt(s.x1, s.y1);
    includePt(s.x2, s.y2);
  }
  for (const a of validArcs) {
    includePt(a.cx - a.r, a.cy - a.r);
    includePt(a.cx + a.r, a.cy + a.r);
  }

  const width = Math.max(1e-3, maxX - minX);
  const height = Math.max(1e-3, maxY - minY);
  const detectedUnit = headerUnit ?? guessUnitFromSpan(Math.max(width, height));

  const layerMap = new Map<string, CadLayerInfo>();
  const ensureLayer = (name: string) => {
    const clean = name || '0';
    let info = layerMap.get(clean);
    if (!info) {
      info = {
        name: clean,
        segmentCount: 0,
        arcCount: 0,
        textCount: 0,
        suggestedAsWall: isSuggestedWallLayer(clean),
      };
      layerMap.set(clean, info);
    }
    return info;
  };

  for (const s of validSegs) ensureLayer(s.layer).segmentCount++;
  for (const a of validArcs) ensureLayer(a.layer).arcCount++;
  for (const t of validTexts) ensureLayer(t.layer).textCount++;

  const layers = Array.from(layerMap.values()).sort((a, b) => {
    if (a.suggestedAsWall !== b.suggestedAsWall) return a.suggestedAsWall ? -1 : 1;
    return b.segmentCount + b.arcCount - (a.segmentCount + a.arcCount);
  });

  // Se nessun layer ha un nome esplicito "muri", suggerisci il layer con più segmenti
  if (layers.length > 0 && !layers.some((l) => l.suggestedAsWall)) {
    layers[0].suggestedAsWall = true;
  }

  return {
    fileName,
    format,
    detectedUnit,
    bounds: { minX, maxX, minY, maxY, width, height },
    layers,
    segments: validSegs,
    arcs: validArcs,
    texts: validTexts,
  };
}

/** Parsing DXF testuale client-side tramite dxf-parser */
async function parseDxfFile(file: File): Promise<ParsedCadDocument> {
  const text = await file.text();
  const { default: DxfParser } = await import('dxf-parser');
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) {
    throw new Error('Impossibile leggere il file DXF (formato non valido o DXF binario).');
  }

  const insUnits = Number(dxf.header?.$INSUNITS ?? 0);
  const headerUnit = mapInsUnits(insUnits);
  const blocks = (dxf.blocks ?? {}) as Record<
    string,
    { entities?: unknown[]; position?: { x?: number; y?: number } }
  >;

  const segments: CadSegment[] = [];
  const arcs: CadArc[] = [];
  const texts: CadText[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collectEntities = (entities: any[], tf: Transform2D, inheritedLayer: string, depth: number) => {
    if (!Array.isArray(entities) || depth > 5) return;

    for (const ent of entities) {
      if (!ent || ent.inPaperSpace) continue;
      const layer = String(ent.layer || inheritedLayer || '0');
      const type = String(ent.type || '').toUpperCase();

      if (type === 'LINE' && Array.isArray(ent.vertices) && ent.vertices.length >= 2) {
        const p1 = applyTransform(ent.vertices[0].x ?? 0, ent.vertices[0].y ?? 0, tf);
        const p2 = applyTransform(ent.vertices[1].x ?? 0, ent.vertices[1].y ?? 0, tf);
        segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, layer });
      } else if (
        (type === 'LWPOLYLINE' || type === 'POLYLINE') &&
        Array.isArray(ent.vertices) &&
        ent.vertices.length >= 2
      ) {
        const verts = ent.vertices;
        const closed = Boolean(ent.shape || ent.closed);
        const count = closed ? verts.length : verts.length - 1;
        for (let i = 0; i < count; i++) {
          const a = verts[i];
          const b = verts[(i + 1) % verts.length];
          const p1 = applyTransform(a.x ?? 0, a.y ?? 0, tf);
          const p2 = applyTransform(b.x ?? 0, b.y ?? 0, tf);
          segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, layer });
        }
      } else if (type === 'ARC' && ent.center && typeof ent.radius === 'number') {
        const c = applyTransform(ent.center.x ?? 0, ent.center.y ?? 0, tf);
        const scale = (Math.abs(tf.sx) + Math.abs(tf.sy)) / 2;
        arcs.push({
          cx: c.x,
          cy: c.y,
          r: ent.radius * scale,
          startAngle: Number(ent.startAngle ?? 0),
          endAngle: Number(ent.endAngle ?? Math.PI * 2),
          layer,
        });
      } else if (type === 'CIRCLE' && ent.center && typeof ent.radius === 'number') {
        const c = applyTransform(ent.center.x ?? 0, ent.center.y ?? 0, tf);
        const scale = (Math.abs(tf.sx) + Math.abs(tf.sy)) / 2;
        arcs.push({
          cx: c.x,
          cy: c.y,
          r: ent.radius * scale,
          startAngle: 0,
          endAngle: Math.PI * 2,
          layer,
        });
      } else if ((type === 'TEXT' || type === 'MTEXT') && (ent.text || ent.string)) {
        const pos = ent.startPoint ?? ent.position ?? { x: 0, y: 0 };
        const p = applyTransform(pos.x ?? 0, pos.y ?? 0, tf);
        const cleaned = cleanCadText(String(ent.text ?? ent.string ?? ''));
        if (cleaned) {
          texts.push({
            x: p.x,
            y: p.y,
            text: cleaned,
            height: Math.abs(Number(ent.textHeight ?? ent.height ?? 10)) * Math.abs(tf.sy),
            layer,
          });
        }
      } else if (type === 'DIMENSION') {
        // Espande il blocco grafico associato alla quota (linee + misura) se presente
        if (ent.block && blocks[ent.block]?.entities) {
          collectEntities(blocks[ent.block].entities!, tf, layer, depth + 1);
        } else if (ent.middleOfText && (ent.text || ent.actualMeasurement)) {
          const p = applyTransform(ent.middleOfText.x ?? 0, ent.middleOfText.y ?? 0, tf);
          const label =
            ent.text && ent.text !== '<>'
              ? cleanCadText(String(ent.text))
              : typeof ent.actualMeasurement === 'number'
                ? Number(ent.actualMeasurement).toFixed(2)
                : '';
          if (label) {
            texts.push({ x: p.x, y: p.y, text: label, height: 12, layer });
          }
        }
      } else if (type === 'INSERT' && ent.name && blocks[ent.name]?.entities) {
        const blk = blocks[ent.name];
        const pos = ent.position ?? { x: 0, y: 0 };
        const bx = blk.position?.x ?? 0;
        const by = blk.position?.y ?? 0;
        const rotRad = ((Number(ent.rotation ?? 0)) * Math.PI) / 180;
        const nextTf = composeTransform(
          tf,
          (pos.x ?? 0) - bx,
          (pos.y ?? 0) - by,
          Number(ent.xScale ?? 1) || 1,
          Number(ent.yScale ?? 1) || 1,
          rotRad
        );
        collectEntities(blk.entities!, nextTf, layer, depth + 1);
      }
    }
  };

  collectEntities(dxf.entities ?? [], IDENTITY_TRANSFORM, '0', 0);

  return finalizeCadDocument(file.name, 'dxf', headerUnit, segments, arcs, texts);
}

/** Parsing DWG binario client-side tramite WebAssembly (@mlightcad/libredwg-web) */
async function parseDwgFile(file: File): Promise<ParsedCadDocument> {
  const buffer = await file.arrayBuffer();
  const { Dwg_File_Type, LibreDwg } = await import('@mlightcad/libredwg-web');

  // Risolve ./wasm rispetto al baseURI della pagina (compatibile sia con localhost sia con GitHub Pages)
  const wasmDir = new URL('./wasm', document.baseURI).href.replace(/\/$/, '');
  const libredwg = await LibreDwg.create(wasmDir);

  const dwgPtr = libredwg.dwg_read_data(buffer, Dwg_File_Type.DWG);
  if (!dwgPtr) {
    throw new Error(
      'Impossibile decodificare questo file DWG. Prova a salvarlo come DXF (es. con AutoCAD o Autodesk DWG TrueView) e ricaricalo.'
    );
  }

  const db = libredwg.convert(dwgPtr);
  try {
    libredwg.dwg_free(dwgPtr);
  } catch {
    // ignore cleanup error
  }

  const insUnits = Number(db.header?.INSUNITS ?? 0);
  const headerUnit = mapInsUnits(insUnits);

  // Mappa dei blocchi per espansione INSERT e DIMENSION
  const blockMap = new Map<
    string,
    { entities: unknown[]; basePoint?: { x?: number; y?: number } }
  >();
  for (const blk of db.tables?.BLOCK_RECORD?.entries ?? []) {
    if (blk?.name && Array.isArray(blk.entities)) {
      blockMap.set(blk.name, { entities: blk.entities, basePoint: blk.basePoint });
    }
  }

  const segments: CadSegment[] = [];
  const arcs: CadArc[] = [];
  const texts: CadText[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collectEntities = (entities: any[], tf: Transform2D, inheritedLayer: string, depth: number) => {
    if (!Array.isArray(entities) || depth > 5) return;

    for (const ent of entities) {
      if (!ent || ent.isInPaperSpace) continue;
      const layer = String(ent.layer || inheritedLayer || '0');
      const type = String(ent.type || '').toUpperCase();

      if (type === 'LINE' && ent.startPoint && ent.endPoint) {
        const p1 = applyTransform(ent.startPoint.x ?? 0, ent.startPoint.y ?? 0, tf);
        const p2 = applyTransform(ent.endPoint.x ?? 0, ent.endPoint.y ?? 0, tf);
        segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, layer });
      } else if (
        (type === 'LWPOLYLINE' || type === 'POLYLINE2D' || type === 'POLYLINE') &&
        Array.isArray(ent.vertices) &&
        ent.vertices.length >= 2
      ) {
        const verts = ent.vertices;
        const closed = Boolean((Number(ent.flag ?? 0) & 1) === 1 || ent.closed);
        const count = closed ? verts.length : verts.length - 1;
        for (let i = 0; i < count; i++) {
          const a = verts[i];
          const b = verts[(i + 1) % verts.length];
          const p1 = applyTransform(a.x ?? 0, a.y ?? 0, tf);
          const p2 = applyTransform(b.x ?? 0, b.y ?? 0, tf);
          segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, layer });
        }
      } else if (type === 'ARC' && ent.center && typeof ent.radius === 'number') {
        const c = applyTransform(ent.center.x ?? 0, ent.center.y ?? 0, tf);
        const scale = (Math.abs(tf.sx) + Math.abs(tf.sy)) / 2;
        arcs.push({
          cx: c.x,
          cy: c.y,
          r: ent.radius * scale,
          startAngle: Number(ent.startAngle ?? 0),
          endAngle: Number(ent.endAngle ?? Math.PI * 2),
          layer,
        });
      } else if (type === 'CIRCLE' && ent.center && typeof ent.radius === 'number') {
        const c = applyTransform(ent.center.x ?? 0, ent.center.y ?? 0, tf);
        const scale = (Math.abs(tf.sx) + Math.abs(tf.sy)) / 2;
        arcs.push({
          cx: c.x,
          cy: c.y,
          r: ent.radius * scale,
          startAngle: 0,
          endAngle: Math.PI * 2,
          layer,
        });
      } else if ((type === 'TEXT' || type === 'MTEXT') && ent.text) {
        const pos = ent.startPoint ?? ent.insertionPoint ?? { x: 0, y: 0 };
        const p = applyTransform(pos.x ?? 0, pos.y ?? 0, tf);
        const cleaned = cleanCadText(String(ent.text));
        if (cleaned) {
          texts.push({
            x: p.x,
            y: p.y,
            text: cleaned,
            height: Math.abs(Number(ent.textHeight ?? 10)) * Math.abs(tf.sy),
            layer,
          });
        }
      } else if (type === 'DIMENSION') {
        const dimBlock = ent.name ? blockMap.get(ent.name) : undefined;
        if (dimBlock?.entities?.length) {
          collectEntities(dimBlock.entities, tf, layer, depth + 1);
        } else if (ent.textPoint && (ent.text || ent.measurement)) {
          const p = applyTransform(ent.textPoint.x ?? 0, ent.textPoint.y ?? 0, tf);
          const label =
            ent.text && ent.text !== '<>'
              ? cleanCadText(String(ent.text))
              : typeof ent.measurement === 'number'
                ? Number(ent.measurement).toFixed(2)
                : '';
          if (label) {
            texts.push({ x: p.x, y: p.y, text: label, height: 12, layer });
          }
        }
      } else if (type === 'INSERT' && ent.name) {
        const blk = blockMap.get(ent.name);
        if (blk?.entities?.length) {
          const pos = ent.insertionPoint ?? { x: 0, y: 0 };
          const bx = blk.basePoint?.x ?? 0;
          const by = blk.basePoint?.y ?? 0;
          const rotRad = Number(ent.rotation ?? 0); // In DwgDatabase INSERT.rotation è in radianti
          const nextTf = composeTransform(
            tf,
            (pos.x ?? 0) - bx,
            (pos.y ?? 0) - by,
            Number(ent.xScale ?? 1) || 1,
            Number(ent.yScale ?? 1) || 1,
            rotRad
          );
          collectEntities(blk.entities, nextTf, layer, depth + 1);
        }
      }
    }
  };

  collectEntities(db.entities ?? [], IDENTITY_TRANSFORM, '0', 0);

  return finalizeCadDocument(file.name, 'dwg', headerUnit, segments, arcs, texts);
}

/** Punto d'ingresso unificato per parsing .DXF e .DWG */
export async function parseCadFile(file: File): Promise<ParsedCadDocument> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.dxf')) {
    return parseDxfFile(file);
  }
  if (lower.endsWith('.dwg')) {
    return parseDwgFile(file);
  }
  throw new Error('Formato CAD non supportato: usa un file .DWG o .DXF.');
}

export interface CadFloorplanRenderResult {
  floorplan: FloorplanImage;
  pixelsPerMeter: number;
  widthMeters: number;
  heightMeters: number;
  /** Offset in metri tra coordinate CAD scalate (minX*unit, maxY*unit) e origine (0,0) immagine */
  padMeters: number;
}

/**
 * Renderizza i layer visibili del file CAD in una piantina ad alta risoluzione
 * restituendo il fattore pixelsPerMeter ESATTO per la calibrazione automatica 1:1.
 */
export function renderCadToFloorplanImage(
  doc: ParsedCadDocument,
  unit: CadUnit,
  visibleLayers: Set<string>,
  wallLayers: Set<string>
): CadFloorplanRenderResult {
  const toM = CAD_UNIT_TO_METERS[unit];
  const rawW = Math.max(0.5, doc.bounds.width * toM);
  const rawH = Math.max(0.5, doc.bounds.height * toM);
  const padMeters = Math.max(0.4, Math.min(1.2, Math.max(rawW, rawH) * 0.04));

  const totalW = rawW + padMeters * 2;
  const totalH = rawH + padMeters * 2;

  const maxCanvasPx = 2400;
  const pixelsPerMeter = Math.max(40, Math.min(260, maxCanvasPx / Math.max(totalW, totalH)));
  const widthPx = Math.max(200, Math.round(totalW * pixelsPerMeter));
  const heightPx = Math.max(200, Math.round(totalH * pixelsPerMeter));

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Impossibile creare il canvas 2D per renderizzare il file CAD.');

  // Sfondo carta tecnica bianca
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  const mapX = (cadX: number) => ((cadX - doc.bounds.minX) * toM + padMeters) * pixelsPerMeter;
  // In CAD l'asse Y cresce verso l'alto, su canvas verso il basso
  const mapY = (cadY: number) => ((doc.bounds.maxY - cadY) * toM + padMeters) * pixelsPerMeter;

  // Disegna prima i layer non-muro in grigio medio, poi i layer muro in nero nitido
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const pass of ['other', 'wall'] as const) {
    ctx.beginPath();
    ctx.strokeStyle = pass === 'wall' ? '#0f172a' : '#64748b';
    ctx.lineWidth = pass === 'wall' ? 2.1 : 1.1;

    for (const s of doc.segments) {
      if (!visibleLayers.has(s.layer)) continue;
      const isWall = wallLayers.has(s.layer);
      if ((pass === 'wall') !== isWall) continue;
      ctx.moveTo(mapX(s.x1), mapY(s.y1));
      ctx.lineTo(mapX(s.x2), mapY(s.y2));
    }
    ctx.stroke();

    for (const a of doc.arcs) {
      if (!visibleLayers.has(a.layer)) continue;
      const isWall = wallLayers.has(a.layer);
      if ((pass === 'wall') !== isWall) continue;
      ctx.beginPath();
      const rPx = a.r * toM * pixelsPerMeter;
      if (rPx < 0.5) continue;
      const isFull = Math.abs(a.endAngle - a.startAngle) >= Math.PI * 1.99;
      if (isFull) {
        ctx.arc(mapX(a.cx), mapY(a.cy), rPx, 0, Math.PI * 2);
      } else {
        // Poiché Y è invertito, gli angoli CCW CAD diventano CW su canvas con segno opposto
        ctx.arc(mapX(a.cx), mapY(a.cy), rPx, -a.startAngle, -a.endAngle, true);
      }
      ctx.stroke();
    }
  }

  // Disegna testi e quote CAD
  ctx.fillStyle = '#1e3a8a';
  ctx.textBaseline = 'middle';
  for (const t of doc.texts) {
    if (!visibleLayers.has(t.layer)) continue;
    const fontPx = Math.max(9, Math.min(24, t.height * toM * pixelsPerMeter * 0.95));
    ctx.font = `600 ${Math.round(fontPx)}px sans-serif`;
    ctx.fillText(t.text, mapX(t.x), mapY(t.y));
  }

  return {
    floorplan: {
      dataUrl: canvas.toDataURL('image/png'),
      fileName: doc.fileName,
      widthPx,
      heightPx,
      opacity: 0.78,
    },
    pixelsPerMeter,
    widthMeters: Number(totalW.toFixed(2)),
    heightMeters: Number(totalH.toFixed(2)),
    padMeters,
  };
}

/**
 * Estrae automaticamente i muri 2D/3D dai layer selezionati del CAD:
 * - Converte le coordinate CAD esattamente nello spazio metri dell'immagine renderizzata
 * - Riconosce automaticamente le coppie di linee parallele dei muri CAD (spessore 6..55 cm)
 *   e le fonde in un unico muro centrato con lo spessore reale misurato!
 */
export function extractWallsFromCad(
  doc: ParsedCadDocument,
  unit: CadUnit,
  wallLayers: Set<string>,
  padMeters: number,
  defaultThickness: number,
  defaultHeight: number,
  idGen: (prefix: string) => string
): Wall[] {
  if (wallLayers.size === 0) return [];
  const toM = CAD_UNIT_TO_METERS[unit];

  interface SegM {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    len: number;
    ux: number;
    uy: number;
    used: boolean;
  }

  const segs: SegM[] = [];
  for (const s of doc.segments) {
    if (!wallLayers.has(s.layer)) continue;
    const x1 = (s.x1 - doc.bounds.minX) * toM + padMeters;
    const y1 = (doc.bounds.maxY - s.y1) * toM + padMeters;
    const x2 = (s.x2 - doc.bounds.minX) * toM + padMeters;
    const y2 = (doc.bounds.maxY - s.y2) * toM + padMeters;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.22 || len > 45) continue;
    segs.push({
      x1,
      y1,
      x2,
      y2,
      len,
      ux: (x2 - x1) / len,
      uy: (y2 - y1) / len,
      used: false,
    });
  }

  // Ordina dal segmento più lungo al più corto per accoppiamenti prioritari sui muri principali
  segs.sort((a, b) => b.len - a.len);
  const limited = segs.slice(0, 600);

  const walls: Wall[] = [];

  for (let i = 0; i < limited.length; i++) {
    const a = limited[i];
    if (a.used) continue;

    let bestPartner = -1;
    let bestScore = Infinity;
    let bestOverlap: { tMin: number; tMax: number; perpDist: number; signedPerp: number } | null =
      null;

    // Cerca una linea parallela (doppio filo muro) a distanza 6..55 cm
    const nx = -a.uy;
    const ny = a.ux;

    for (let j = i + 1; j < limited.length; j++) {
      const b = limited[j];
      if (b.used) continue;

      const dot = Math.abs(a.ux * b.ux + a.uy * b.uy);
      if (dot < 0.992) continue; // Deve essere parallela entro ~7°

      // Distanza perpendicolare dal segmento A al punto medio di B
      const midBx = (b.x1 + b.x2) / 2;
      const midBy = (b.y1 + b.y2) / 2;
      const signedPerp = (midBx - a.x1) * nx + (midBy - a.y1) * ny;
      const perpDist = Math.abs(signedPerp);

      // Escludi linee duplicate quasi sovrapposte (<4cm) o troppo distanti (>55cm)
      if (perpDist < 0.055 || perpDist > 0.55) continue;

      // Proiezione degli estremi di B lungo l'asse di A
      const p1 = (b.x1 - a.x1) * a.ux + (b.y1 - a.y1) * a.uy;
      const p2 = (b.x2 - a.x1) * a.ux + (b.y2 - a.y1) * a.uy;
      const bMin = Math.min(p1, p2);
      const bMax = Math.max(p1, p2);

      const overlapStart = Math.max(0, bMin);
      const overlapEnd = Math.min(a.len, bMax);
      const overlapLen = overlapEnd - overlapStart;

      if (overlapLen < Math.min(a.len, b.len) * 0.45 || overlapLen < 0.25) continue;

      const score = perpDist + Math.abs(a.len - b.len) * 0.3;
      if (score < bestScore) {
        bestScore = score;
        bestPartner = j;
        bestOverlap = {
          tMin: Math.min(0, bMin),
          tMax: Math.max(a.len, bMax),
          perpDist,
          signedPerp,
        };
      }
    }

    if (bestPartner >= 0 && bestOverlap) {
      a.used = true;
      limited[bestPartner].used = true;
      const halfOffset = bestOverlap.signedPerp / 2;
      const sx = a.x1 + a.ux * bestOverlap.tMin + nx * halfOffset;
      const sy = a.y1 + a.uy * bestOverlap.tMin + ny * halfOffset;
      const ex = a.x1 + a.ux * bestOverlap.tMax + nx * halfOffset;
      const ey = a.y1 + a.uy * bestOverlap.tMax + ny * halfOffset;

      walls.push({
        id: idGen('wall'),
        start: { x: Number(sx.toFixed(3)), y: Number(sy.toFixed(3)) },
        end: { x: Number(ex.toFixed(3)), y: Number(ey.toFixed(3)) },
        thickness: Number(Math.max(0.08, Math.min(0.55, bestOverlap.perpDist)).toFixed(2)),
        height: defaultHeight,
      });
    } else {
      a.used = true;
      // Evita duplicati quasi identici
      const isDup = walls.some((w) => {
        const d1 =
          Math.hypot(w.start.x - a.x1, w.start.y - a.y1) +
          Math.hypot(w.end.x - a.x2, w.end.y - a.y2);
        const d2 =
          Math.hypot(w.start.x - a.x2, w.start.y - a.y2) +
          Math.hypot(w.end.x - a.x1, w.end.y - a.y1);
        return Math.min(d1, d2) < 0.12;
      });
      if (!isDup) {
        walls.push({
          id: idGen('wall'),
          start: { x: Number(a.x1.toFixed(3)), y: Number(a.y1.toFixed(3)) },
          end: { x: Number(a.x2.toFixed(3)), y: Number(a.y2.toFixed(3)) },
          thickness: defaultThickness,
          height: defaultHeight,
        });
      }
    }

    if (walls.length >= 250) break;
  }

  return walls;
}

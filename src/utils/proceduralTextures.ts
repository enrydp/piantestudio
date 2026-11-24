/**
 * Generatore procedurale di texture Canvas per i pavimenti 3D:
 * - Parquet (listoni in legno con venature e fughe)
 * - Piastrelle (grès porcellanato 60x60 con fughe nitide e variazioni tonali)
 * - Cemento (resina/cemento architettonico spatolato moderno)
 * Supporta la personalizzazione del colore base per ogni tipologia.
 * Funziona 100% offline senza asset esterni.
 */
import * as THREE from 'three';
import type { FloorTextureType } from '../types/project';

export const DEFAULT_FLOOR_COLORS: Record<FloorTextureType, string> = {
  parquet: '#b28150',
  piastrelle: '#d9cfc1',
  cemento: '#b2b6bc',
};

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function parseHexColor(hex: string, fallback: string): [number, number, number] {
  const clean = (hex || fallback).replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return parseHexColor(fallback, '#cccccc');
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbCss(r: number, g: number, b: number, a = 1): string {
  const cr = clampByte(r);
  const cg = clampByte(g);
  const cb = clampByte(b);
  return a < 1 ? `rgba(${cr}, ${cg}, ${cb}, ${a})` : `rgb(${cr}, ${cg}, ${cb})`;
}

function shiftRgb([r, g, b]: [number, number, number], delta: number): string {
  return rgbCss(r + delta, g + delta, b + delta);
}

function createParquetCanvas(baseColor: string): HTMLCanvasElement {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const base = parseHexColor(baseColor, DEFAULT_FLOOR_COLORS.parquet);
  ctx.fillStyle = shiftRgb(base, -8);
  ctx.fillRect(0, 0, size, size);

  const rows = 8;
  const rowH = size / rows;
  const palette = [
    shiftRgb(base, 6),
    shiftRgb(base, -6),
    shiftRgb(base, 14),
    shiftRgb(base, -14),
    shiftRgb(base, 0),
  ];

  const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
  const grainColor =
    lum > 90
      ? rgbCss(base[0] * 0.48, base[1] * 0.42, base[2] * 0.36, 0.18)
      : rgbCss(base[0] + 55, base[1] + 45, base[2] + 35, 0.16);
  const seamColor =
    lum > 80
      ? rgbCss(base[0] * 0.36, base[1] * 0.32, base[2] * 0.28, 0.52)
      : 'rgba(220, 220, 220, 0.28)';

  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    const offset = (r % 3) * 170;
    const plankW = 256;

    for (let x = -offset; x < size + plankW; x += plankW) {
      const idx = Math.abs(r * 3 + Math.floor(x / plankW)) % palette.length;
      ctx.fillStyle = palette[idx];
      ctx.fillRect(x, y, plankW, rowH);

      // Venature legno leggere
      ctx.strokeStyle = grainColor;
      ctx.lineWidth = 1;
      for (let g = 0; g < 6; g++) {
        const gy = y + ((g + 0.5) * rowH) / 6;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.bezierCurveTo(
          x + plankW * 0.33,
          gy + Math.sin(r + g) * 4,
          x + plankW * 0.66,
          gy - Math.cos(r + g) * 4,
          x + plankW,
          gy
        );
        ctx.stroke();
      }

      // Fuga tra listoni
      ctx.strokeStyle = seamColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, y + 0.5, plankW - 1, rowH - 1);
    }
  }

  return canvas;
}

function createTilesCanvas(baseColor: string): HTMLCanvasElement {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const base = parseHexColor(baseColor, DEFAULT_FLOOR_COLORS.piastrelle);
  const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];

  // Sfondo fuga ben contrastato rispetto al colore della piastrella
  const groutCss =
    lum > 110 ? shiftRgb(base, -46) : shiftRgb(base, 42);
  const speckleCss =
    lum > 110
      ? rgbCss(base[0] - 32, base[1] - 32, base[2] - 32, 0.08)
      : rgbCss(base[0] + 38, base[1] + 38, base[2] + 38, 0.08);

  ctx.fillStyle = groutCss;
  ctx.fillRect(0, 0, size, size);

  const grid = 4;
  const cell = size / grid;
  const tones = [
    shiftRgb(base, 5),
    shiftRgb(base, -3),
    shiftRgb(base, 9),
    shiftRgb(base, -7),
  ];

  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      ctx.fillStyle = tones[(r * 5 + c * 3) % tones.length];
      ctx.fillRect(c * cell + 2, r * cell + 2, cell - 4, cell - 4);

      // Effetto pietra/grès sottile
      ctx.fillStyle = speckleCss;
      for (let s = 0; s < 14; s++) {
        const sx = c * cell + ((s * 37 + r * 19) % (cell - 10)) + 4;
        const sy = r * cell + ((s * 53 + c * 23) % (cell - 10)) + 4;
        ctx.fillRect(sx, sy, 12, 5);
      }
    }
  }

  // Fughe nitide
  ctx.strokeStyle = groutCss;
  ctx.lineWidth = 3.5;
  for (let i = 0; i <= grid; i++) {
    const p = i * cell;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  return canvas;
}

function createConcreteCanvas(baseColor: string): HTMLCanvasElement {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const base = parseHexColor(baseColor, DEFAULT_FLOOR_COLORS.cemento);
  ctx.fillStyle = rgbCss(base[0], base[1], base[2]);
  ctx.fillRect(0, 0, size, size);

  // Nuvolature cemento spatolato deterministiche
  for (let i = 0; i < 180; i++) {
    const x = (i * 97) % size;
    const y = (i * 151) % size;
    const rad = 18 + (i % 45);
    const light = i % 2 === 0;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, rad);
    grad.addColorStop(
      0,
      light
        ? rgbCss(base[0] + 42, base[1] + 42, base[2] + 42, 0.14)
        : rgbCss(base[0] - 42, base[1] - 42, base[2] - 42, 0.14)
    );
    grad.addColorStop(1, rgbCss(base[0], base[1], base[2], 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Giunti di dilatazione sottili
  ctx.strokeStyle = rgbCss(base[0] - 40, base[1] - 40, base[2] - 40, 0.28);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  return canvas;
}

/** Genera una texture marmo venato procedurale adattata al colore scelto (Carrara, Calacatta, Nero Marquina, ecc.) */
function createMarbleCanvas(baseColor: string): HTMLCanvasElement {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const base = parseHexColor(baseColor, '#f2f0ec');
  const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];

  // Fondo marmo con leggere nuvolature minerali
  ctx.fillStyle = rgbCss(base[0], base[1], base[2]);
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 45; i++) {
    const x = (i * 113 + 37) % size;
    const y = (i * 167 + 29) % size;
    const rad = 45 + (i % 70);
    const delta = i % 2 === 0 ? 18 : -18;
    const grad = ctx.createRadialGradient(x, y, 4, x, y, rad);
    grad.addColorStop(0, rgbCss(base[0] + delta, base[1] + delta, base[2] + delta, 0.13));
    grad.addColorStop(1, rgbCss(base[0], base[1], base[2], 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Venature principali e secondarie (più scure su marmi chiari, chiare/dorate su marmi scuri)
  const mainVeinColor =
    lum > 125
      ? rgbCss(base[0] * 0.62, base[1] * 0.63, base[2] * 0.66, 0.42)
      : rgbCss(base[0] + 105, base[1] + 102, base[2] + 95, 0.36);
  const softVeinColor =
    lum > 125
      ? rgbCss(base[0] * 0.72, base[1] * 0.72, base[2] * 0.74, 0.24)
      : rgbCss(base[0] + 75, base[1] + 72, base[2] + 66, 0.2);

  const drawVein = (startY: number, amp: number, freq: number, width: number, stroke: string) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const t = x / size;
      const y =
        startY +
        t * 210 +
        Math.sin(t * Math.PI * freq + startY * 0.05) * amp +
        Math.sin(t * Math.PI * (freq * 2.7) + 1.2) * (amp * 0.32);
      const wy = ((y % size) + size) % size;
      if (x === 0 || Math.abs(wy - (((startY + ((x - 8) / size) * 210) % size) + size) % size) > 120) {
        ctx.moveTo(x, wy);
      } else {
        ctx.lineTo(x, wy);
      }
    }
    ctx.stroke();
  };

  drawVein(40, 26, 2.2, 3.2, softVeinColor);
  drawVein(44, 24, 2.2, 1.3, mainVeinColor);
  drawVein(190, 34, 1.8, 4.0, softVeinColor);
  drawVein(192, 32, 1.8, 1.5, mainVeinColor);
  drawVein(340, 22, 2.8, 2.6, softVeinColor);
  drawVein(342, 20, 2.8, 1.1, mainVeinColor);
  drawVein(460, 18, 3.3, 1.0, mainVeinColor);

  return canvas;
}

const canvasCache = new Map<string, HTMLCanvasElement>();
const MAX_CACHE_ENTRIES = 24;

export function getMarbleTexture(baseColor: string): THREE.CanvasTexture {
  const resolved = (baseColor || '#f2f0ec').toLowerCase();
  const key = `marble_${resolved}`;

  let canvas = canvasCache.get(key);
  if (!canvas) {
    canvas = createMarbleCanvas(resolved);
    if (canvasCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = canvasCache.keys().next().value;
      if (oldestKey) canvasCache.delete(oldestKey);
    }
    canvasCache.set(key, canvas);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function getFloorTexture(
  type: FloorTextureType,
  repeatX = 4,
  repeatY = 4,
  floorColor?: string
): THREE.CanvasTexture {
  const resolvedColor = (floorColor || DEFAULT_FLOOR_COLORS[type]).toLowerCase();
  const key = `${type}_${resolvedColor}`;

  let canvas = canvasCache.get(key);
  if (!canvas) {
    canvas =
      type === 'parquet'
        ? createParquetCanvas(resolvedColor)
        : type === 'piastrelle'
          ? createTilesCanvas(resolvedColor)
          : createConcreteCanvas(resolvedColor);
    if (canvasCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = canvasCache.keys().next().value;
      if (oldestKey) canvasCache.delete(oldestKey);
    }
    canvasCache.set(key, canvas);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY));
  texture.needsUpdate = true;
  return texture;
}

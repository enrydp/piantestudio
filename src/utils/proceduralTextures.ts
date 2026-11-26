/**
 * Generatore procedurale PBR ad alta definizione per PianteStudio 3D (100% offline):
 * - Pavimenti (Parquet, Piastrelle Grès 60×60, Microcemento): genera map (diffuse), bumpMap e roughnessMap
 * - Pareti intonacate: micro-grana stucco (bumpMap + roughnessMap) per riflessi realistici alla luce radente
 * - Materiali mobili: Legno venato, Tessuto tramato, Pelle martellata e Marmo venato
 */
import * as THREE from 'three';
import type { FloorTextureType, FurnitureMaterial } from '../types/project';

export const DEFAULT_FLOOR_COLORS: Record<FloorTextureType, string> = {
  parquet: '#b58352',
  piastrelle: '#dcd3c6',
  cemento: '#b4b8be',
};

export interface PbrTextureSet {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

export interface SurfacePbrSet {
  map?: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
}

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

/** PRNG deterministico veloce per evitare tremolii tra render */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FloorCanvasTriplet {
  diffuse: HTMLCanvasElement;
  bump: HTMLCanvasElement;
  roughness: HTMLCanvasElement;
}

/** PARQUET ROVERE / LEGNO NATURALE (1024px) con venature organiche, nodi e bisellatura PBR */
function createParquetTriplet(baseColor: string): FloorCanvasTriplet {
  const size = 1024;
  const diffuse = document.createElement('canvas');
  const bump = document.createElement('canvas');
  const roughness = document.createElement('canvas');
  diffuse.width = bump.width = roughness.width = size;
  diffuse.height = bump.height = roughness.height = size;

  const ctx = diffuse.getContext('2d')!;
  const bCtx = bump.getContext('2d')!;
  const rCtx = roughness.getContext('2d')!;

  const base = parseHexColor(baseColor, DEFAULT_FLOOR_COLORS.parquet);
  const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
  const rand = mulberry32(4219);

  // Fondi base
  ctx.fillStyle = shiftRgb(base, -26);
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = 'rgb(200,200,200)';
  bCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = 'rgb(118,118,118)'; // satinato (~0.46)
  rCtx.fillRect(0, 0, size, size);

  const rows = 8;
  const rowH = size / rows;
  const plankW = 512;

  const seamColor =
    lum > 75
      ? rgbCss(base[0] * 0.3, base[1] * 0.26, base[2] * 0.22, 0.72)
      : 'rgba(20, 20, 20, 0.75)';

  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    const offset = ((r * 179) % plankW);

    for (let x = -offset; x < size + plankW; x += plankW) {
      const toneShift = (rand() - 0.5) * 28;
      const warmShift = (rand() - 0.5) * 10;
      const pr = base[0] + toneShift + warmShift;
      const pg = base[1] + toneShift + warmShift * 0.4;
      const pb = base[2] + toneShift - warmShift * 0.5;

      // Corpo listone con gradiente longitudinale morbidissimo
      const grad = ctx.createLinearGradient(x, y, x + plankW, y + rowH);
      grad.addColorStop(0, rgbCss(pr + 5, pg + 4, pb + 2));
      grad.addColorStop(0.5, rgbCss(pr, pg, pb));
      grad.addColorStop(1, rgbCss(pr - 7, pg - 6, pb - 4));
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, plankW, rowH);

      // Roughness per singolo listone (variazione naturale vernice satinata)
      const rVal = clampByte(102 + rand() * 34);
      rCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
      rCtx.fillRect(x, y, plankW, rowH);

      bCtx.fillStyle = 'rgb(218,218,218)';
      bCtx.fillRect(x, y, plankW, rowH);

      // Venature longitudinali fini
      const grainLines = 18;
      for (let g = 0; g < grainLines; g++) {
        const gy = y + ((g + 0.3 + rand() * 0.4) * rowH) / grainLines;
        const dark = rand() > 0.35;
        const alpha = 0.06 + rand() * 0.14;
        ctx.strokeStyle = dark
          ? rgbCss(pr * 0.42, pg * 0.37, pb * 0.32, alpha)
          : rgbCss(pr + 42, pg + 36, pb + 26, alpha * 0.7);
        ctx.lineWidth = 0.8 + rand() * 1.8;

        const wave1 = (rand() - 0.5) * 9;
        const wave2 = (rand() - 0.5) * 9;

        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.bezierCurveTo(
          x + plankW * 0.33,
          gy + wave1,
          x + plankW * 0.66,
          gy + wave2,
          x + plankW,
          gy
        );
        ctx.stroke();

        // Leggero rilievo sulla bumpMap e roughnessMap lungo la venatura
        if (g % 2 === 0) {
          bCtx.strokeStyle = dark ? 'rgba(170,170,170,0.35)' : 'rgba(235,235,235,0.28)';
          bCtx.lineWidth = 1.1;
          bCtx.beginPath();
          bCtx.moveTo(x, gy);
          bCtx.bezierCurveTo(
            x + plankW * 0.33,
            gy + wave1,
            x + plankW * 0.66,
            gy + wave2,
            x + plankW,
            gy
          );
          bCtx.stroke();

          rCtx.strokeStyle = dark ? 'rgba(155,155,155,0.28)' : 'rgba(86,86,86,0.22)';
          rCtx.lineWidth = 1.4;
          rCtx.beginPath();
          rCtx.moveTo(x, gy);
          rCtx.bezierCurveTo(
            x + plankW * 0.33,
            gy + wave1,
            x + plankW * 0.66,
            gy + wave2,
            x + plankW,
            gy
          );
          rCtx.stroke();
        }
      }

      // Nodo legno occasionale naturale
      if (rand() > 0.68) {
        const kx = x + 60 + rand() * (plankW - 120);
        const ky = y + 20 + rand() * (rowH - 40);
        const krx = 9 + rand() * 12;
        const kry = 4 + rand() * 5;
        ctx.save();
        ctx.translate(kx, ky);
        ctx.scale(1, kry / krx);
        const kGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, krx);
        kGrad.addColorStop(0, rgbCss(pr * 0.35, pg * 0.28, pb * 0.22, 0.55));
        kGrad.addColorStop(0.65, rgbCss(pr * 0.55, pg * 0.48, pb * 0.4, 0.25));
        kGrad.addColorStop(1, rgbCss(pr, pg, pb, 0));
        ctx.fillStyle = kGrad;
        ctx.beginPath();
        ctx.arc(0, 0, krx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Bisellatura / Fuga incisa tra listoni
      ctx.strokeStyle = seamColor;
      ctx.lineWidth = 2.6;
      ctx.strokeRect(x + 1, y + 1, plankW - 2, rowH - 2);

      // Leggero bordo chiaro di luce su un lato del listone (effetto bisello 3D)
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 3);
      ctx.lineTo(x + plankW - 3, y + 3);
      ctx.stroke();

      // Bump scavato e Roughness opaca nelle fughe
      bCtx.strokeStyle = 'rgb(45,45,45)';
      bCtx.lineWidth = 4;
      bCtx.strokeRect(x + 1, y + 1, plankW - 2, rowH - 2);

      rCtx.strokeStyle = 'rgb(235,235,235)';
      rCtx.lineWidth = 4;
      rCtx.strokeRect(x + 1, y + 1, plankW - 2, rowH - 2);
    }
  }

  return { diffuse, bump, roughness };
}

/** GRÈS PORCELLANATO 60×60 (1024px) con nuvolatura pietra naturale, fughe incise e specularità ceramica */
function createTilesTriplet(baseColor: string): FloorCanvasTriplet {
  const size = 1024;
  const diffuse = document.createElement('canvas');
  const bump = document.createElement('canvas');
  const roughness = document.createElement('canvas');
  diffuse.width = bump.width = roughness.width = size;
  diffuse.height = bump.height = roughness.height = size;

  const ctx = diffuse.getContext('2d')!;
  const bCtx = bump.getContext('2d')!;
  const rCtx = roughness.getContext('2d')!;

  const base = parseHexColor(baseColor, DEFAULT_FLOOR_COLORS.piastrelle);
  const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
  const rand = mulberry32(9012);

  const groutCss = lum > 110 ? shiftRgb(base, -44) : shiftRgb(base, 40);
  ctx.fillStyle = groutCss;
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = 'rgb(50,50,50)'; // fughe incassate
  bCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = 'rgb(240,240,240)'; // fughe completamente opache
  rCtx.fillRect(0, 0, size, size);

  const grid = 4;
  const cell = size / grid;
  const groutW = 4;

  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const tx = c * cell + groutW / 2;
      const ty = r * cell + groutW / 2;
      const tw = cell - groutW;
      const th = cell - groutW;

      const delta = (rand() - 0.5) * 14;
      const tr = base[0] + delta;
      const tg = base[1] + delta;
      const tb = base[2] + delta;

      ctx.fillStyle = rgbCss(tr, tg, tb);
      ctx.fillRect(tx, ty, tw, th);

      // Superficie piana rialzata rispetto alla fuga
      bCtx.fillStyle = 'rgb(228,228,228)';
      bCtx.fillRect(tx, ty, tw, th);

      // Piastrella satinata-lucida (~0.28..0.38)
      const rv = clampByte(74 + rand() * 24);
      rCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
      rCtx.fillRect(tx, ty, tw, th);

      // Clippa dentro la singola piastrella per venature/nuvolature minerali
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx, ty, tw, th);
      ctx.clip();

      for (let i = 0; i < 12; i++) {
        const sx = tx + rand() * tw;
        const sy = ty + rand() * th;
        const rad = 28 + rand() * 68;
        const lighter = rand() > 0.5;
        const grad = ctx.createRadialGradient(sx, sy, 2, sx, sy, rad);
        grad.addColorStop(
          0,
          lighter
            ? rgbCss(tr + 18, tg + 18, tb + 16, 0.14)
            : rgbCss(tr - 22, tg - 22, tb - 20, 0.13)
        );
        grad.addColorStop(1, rgbCss(tr, tg, tb, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Micro-vena pietra leggera
      ctx.strokeStyle =
        lum > 110
          ? rgbCss(tr - 28, tg - 26, tb - 24, 0.16)
          : rgbCss(tr + 36, tg + 34, tb + 32, 0.14);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const vx0 = tx + rand() * tw * 0.4;
      const vy0 = ty + rand() * th;
      ctx.moveTo(vx0, vy0);
      ctx.bezierCurveTo(
        tx + tw * 0.4,
        ty + rand() * th,
        tx + tw * 0.7,
        ty + rand() * th,
        tx + tw,
        ty + rand() * th
      );
      ctx.stroke();

      // Micro-bordino luminoso rettificato
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(tx + 0.8, ty + 0.8, tw - 1.6, th - 1.6);
      ctx.restore();
    }
  }

  return { diffuse, bump, roughness };
}

/** MICROCEMENTO / RESINA ARCHITETTONICA SPATOLATA (1024px) */
function createConcreteTriplet(baseColor: string): FloorCanvasTriplet {
  const size = 1024;
  const diffuse = document.createElement('canvas');
  const bump = document.createElement('canvas');
  const roughness = document.createElement('canvas');
  diffuse.width = bump.width = roughness.width = size;
  diffuse.height = bump.height = roughness.height = size;

  const ctx = diffuse.getContext('2d')!;
  const bCtx = bump.getContext('2d')!;
  const rCtx = roughness.getContext('2d')!;

  const base = parseHexColor(baseColor, DEFAULT_FLOOR_COLORS.cemento);
  const rand = mulberry32(31415);

  ctx.fillStyle = rgbCss(base[0], base[1], base[2]);
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = 'rgb(185,185,185)';
  bCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = 'rgb(155,155,155)';
  rCtx.fillRect(0, 0, size, size);

  // Spatolate morbide multi-scala
  for (let i = 0; i < 320; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rad = 28 + rand() * 95;
    const light = rand() > 0.5;
    const grad = ctx.createRadialGradient(x, y, 4, x, y, rad);
    grad.addColorStop(
      0,
      light
        ? rgbCss(base[0] + 28, base[1] + 28, base[2] + 28, 0.11)
        : rgbCss(base[0] - 28, base[1] - 28, base[2] - 28, 0.11)
    );
    grad.addColorStop(1, rgbCss(base[0], base[1], base[2], 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();

    // Variazione lucida/opaca da spatolatura
    const rGrad = rCtx.createRadialGradient(x, y, 4, x, y, rad);
    rGrad.addColorStop(0, light ? 'rgba(115,115,115,0.22)' : 'rgba(195,195,195,0.22)');
    rGrad.addColorStop(1, 'rgba(155,155,155,0)');
    rCtx.fillStyle = rGrad;
    rCtx.beginPath();
    rCtx.arc(x, y, rad, 0, Math.PI * 2);
    rCtx.fill();

    if (i % 2 === 0) {
      bCtx.fillStyle = light ? 'rgba(205,205,205,0.16)' : 'rgba(160,160,160,0.16)';
      bCtx.beginPath();
      bCtx.arc(x, y, rad * 0.5, 0, Math.PI * 2);
      bCtx.fill();
    }
  }

  // Giunto architettonico fine
  ctx.strokeStyle = rgbCss(base[0] - 35, base[1] - 35, base[2] - 35, 0.22);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  bCtx.strokeStyle = 'rgb(90,90,90)';
  bCtx.lineWidth = 2.5;
  bCtx.strokeRect(1, 1, size - 2, size - 2);

  return { diffuse, bump, roughness };
}

/** INTONACO PARETI (512px) — bumpMap + roughnessMap finissimo per pareti reali */
function createPlasterMaps(): { bump: HTMLCanvasElement; roughness: HTMLCanvasElement } {
  const size = 512;
  const bump = document.createElement('canvas');
  const roughness = document.createElement('canvas');
  bump.width = roughness.width = size;
  bump.height = roughness.height = size;
  const bCtx = bump.getContext('2d')!;
  const rCtx = roughness.getContext('2d')!;

  bCtx.fillStyle = 'rgb(128,128,128)';
  bCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = 'rgb(218,218,218)'; // opaco intonaco (~0.85)
  rCtx.fillRect(0, 0, size, size);

  const rand = mulberry32(7731);
  // Nuvolature morbide di stesura pittura
  for (let i = 0; i < 120; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rad = 20 + rand() * 55;
    const v = rand() > 0.5 ? 148 : 108;
    const g = bCtx.createRadialGradient(x, y, 2, x, y, rad);
    g.addColorStop(0, `rgba(${v},${v},${v},0.22)`);
    g.addColorStop(1, 'rgba(128,128,128,0)');
    bCtx.fillStyle = g;
    bCtx.beginPath();
    bCtx.arc(x, y, rad, 0, Math.PI * 2);
    bCtx.fill();

    const rv = rand() > 0.5 ? 235 : 202;
    rCtx.fillStyle = `rgba(${rv},${rv},${rv},0.18)`;
    rCtx.beginPath();
    rCtx.arc(x, y, rad * 0.7, 0, Math.PI * 2);
    rCtx.fill();
  }

  // Micro-grana fine intonaco civile
  for (let i = 0; i < 3600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const v = rand() > 0.5 ? 154 : 102;
    bCtx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    bCtx.fillRect(x, y, 2, 2);
  }

  return { bump, roughness };
}

/** LEGNO MOBILI (512px) — venatura naturale tinta sul colore del mobile */
function createFurnitureWoodPair(baseColor: string): {
  diffuse: HTMLCanvasElement;
  bump: HTMLCanvasElement;
} {
  const size = 512;
  const diffuse = document.createElement('canvas');
  const bump = document.createElement('canvas');
  diffuse.width = bump.width = size;
  diffuse.height = bump.height = size;
  const ctx = diffuse.getContext('2d')!;
  const bCtx = bump.getContext('2d')!;

  const base = parseHexColor(baseColor, '#9e7146');
  const rand = mulberry32(5510);

  ctx.fillStyle = rgbCss(base[0], base[1], base[2]);
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = 'rgb(160,160,160)';
  bCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 65; i++) {
    const y = (i / 65) * size + (rand() - 0.5) * 6;
    const dark = rand() > 0.35;
    ctx.strokeStyle = dark
      ? rgbCss(base[0] * 0.52, base[1] * 0.46, base[2] * 0.4, 0.14 + rand() * 0.14)
      : rgbCss(base[0] + 34, base[1] + 28, base[2] + 22, 0.11);
    ctx.lineWidth = 1 + rand() * 2.5;
    const w1 = (rand() - 0.5) * 14;
    const w2 = (rand() - 0.5) * 14;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.33, y + w1, size * 0.66, y + w2, size, y);
    ctx.stroke();

    bCtx.strokeStyle = dark ? 'rgba(115,115,115,0.4)' : 'rgba(205,205,205,0.35)';
    bCtx.lineWidth = 1.4;
    bCtx.beginPath();
    bCtx.moveTo(0, y);
    bCtx.bezierCurveTo(size * 0.33, y + w1, size * 0.66, y + w2, size, y);
    bCtx.stroke();
  }

  return { diffuse, bump };
}

/** TESSUTO TRAMATO (256px) — effetto lino/bouclé per divani, letti e tappeti */
function createFabricPair(baseColor: string): {
  diffuse: HTMLCanvasElement;
  bump: HTMLCanvasElement;
} {
  const size = 256;
  const diffuse = document.createElement('canvas');
  const bump = document.createElement('canvas');
  diffuse.width = bump.width = size;
  diffuse.height = bump.height = size;
  const ctx = diffuse.getContext('2d')!;
  const bCtx = bump.getContext('2d')!;

  const base = parseHexColor(baseColor, '#5b6e82');
  ctx.fillStyle = rgbCss(base[0], base[1], base[2]);
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = 'rgb(128,128,128)';
  bCtx.fillRect(0, 0, size, size);

  const step = 4;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const alt = ((x / step) + (y / step)) % 2 === 0;
      ctx.fillStyle = alt
        ? rgbCss(base[0] + 15, base[1] + 15, base[2] + 15, 0.25)
        : rgbCss(base[0] - 18, base[1] - 18, base[2] - 18, 0.25);
      ctx.fillRect(x, y, step - 1, step - 1);

      bCtx.fillStyle = alt ? 'rgb(185,185,185)' : 'rgb(85,85,85)';
      bCtx.fillRect(x, y, step - 1, step - 1);
    }
  }

  return { diffuse, bump };
}

/** PELLE MARTELLATA (256px) — bumpMap organico */
function createLeatherBump(): HTMLCanvasElement {
  const size = 256;
  const bump = document.createElement('canvas');
  bump.width = bump.height = size;
  const bCtx = bump.getContext('2d')!;
  bCtx.fillStyle = 'rgb(120,120,120)';
  bCtx.fillRect(0, 0, size, size);

  const rand = mulberry32(8842);
  for (let i = 0; i < 700; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 2.5 + rand() * 3.5;
    bCtx.fillStyle = 'rgba(195,195,195,0.45)';
    bCtx.beginPath();
    bCtx.arc(x, y, r, 0, Math.PI * 2);
    bCtx.fill();
  }
  return bump;
}

/** MARMO VENATO PROCEDURALE (512px) */
function createMarbleCanvas(baseColor: string): HTMLCanvasElement {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const base = parseHexColor(baseColor, '#f2f0ec');
  const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];

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
      if (
        x === 0 ||
        Math.abs(wy - ((((startY + ((x - 8) / size) * 210) % size) + size) % size)) > 120
      ) {
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

// =========================================================================
// CACHE CANVAS (evita rigenerazioni costose a ogni render)
// =========================================================================
const floorCache = new Map<string, FloorCanvasTriplet>();
const canvasCache = new Map<string, HTMLCanvasElement>();
const pairCache = new Map<string, { diffuse: HTMLCanvasElement; bump: HTMLCanvasElement }>();
let cachedPlaster: { bump: HTMLCanvasElement; roughness: HTMLCanvasElement } | null = null;
let cachedLeatherBump: HTMLCanvasElement | null = null;
const MAX_CACHE_ENTRIES = 28;

function configureTex(
  canvas: HTMLCanvasElement,
  repeatX: number,
  repeatY: number,
  isColor: boolean
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.anisotropy = 8;
  tex.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY));
  tex.needsUpdate = true;
  return tex;
}

export function getFloorPbrTextures(
  type: FloorTextureType,
  repeatX = 4,
  repeatY = 4,
  floorColor?: string
): PbrTextureSet {
  const resolvedColor = (floorColor || DEFAULT_FLOOR_COLORS[type]).toLowerCase();
  const key = `${type}_${resolvedColor}`;

  let triplet = floorCache.get(key);
  if (!triplet) {
    triplet =
      type === 'parquet'
        ? createParquetTriplet(resolvedColor)
        : type === 'piastrelle'
          ? createTilesTriplet(resolvedColor)
          : createConcreteTriplet(resolvedColor);
    if (floorCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = floorCache.keys().next().value;
      if (oldest) floorCache.delete(oldest);
    }
    floorCache.set(key, triplet);
  }

  return {
    map: configureTex(triplet.diffuse, repeatX, repeatY, true),
    bumpMap: configureTex(triplet.bump, repeatX, repeatY, false),
    roughnessMap: configureTex(triplet.roughness, repeatX, repeatY, false),
  };
}

/** Compatibilità retroattiva */
export function getFloorTexture(
  type: FloorTextureType,
  repeatX = 4,
  repeatY = 4,
  floorColor?: string
): THREE.CanvasTexture {
  return getFloorPbrTextures(type, repeatX, repeatY, floorColor).map;
}

/** Restituisce bumpMap e roughnessMap per pareti intonacate */
export function getWallPlasterTextures(repeatX = 2, repeatY = 1.5): SurfacePbrSet {
  if (!cachedPlaster) {
    cachedPlaster = createPlasterMaps();
  }
  return {
    bumpMap: configureTex(cachedPlaster.bump, repeatX, repeatY, false),
    roughnessMap: configureTex(cachedPlaster.roughness, repeatX, repeatY, false),
  };
}

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

  return configureTex(canvas, 1, 1, true);
}

/** Genera texture PBR procedurali (legno venato, tessuto tramato, pelle, marmo) per i mobili 3D */
export function getFurnitureMaterialMaps(
  material: FurnitureMaterial,
  baseColor: string
): { map?: THREE.CanvasTexture; bumpMap?: THREE.CanvasTexture } | null {
  const resolved = (baseColor || '#cccccc').toLowerCase();

  if (material === 'marble') {
    return { map: getMarbleTexture(resolved) };
  }

  if (material === 'wood') {
    const key = `wood_${resolved}`;
    let pair = pairCache.get(key);
    if (!pair) {
      pair = createFurnitureWoodPair(resolved);
      if (pairCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = pairCache.keys().next().value;
        if (oldest) pairCache.delete(oldest);
      }
      pairCache.set(key, pair);
    }
    return {
      map: configureTex(pair.diffuse, 1.5, 1.5, true),
      bumpMap: configureTex(pair.bump, 1.5, 1.5, false),
    };
  }

  if (material === 'fabric') {
    const key = `fabric_${resolved}`;
    let pair = pairCache.get(key);
    if (!pair) {
      pair = createFabricPair(resolved);
      if (pairCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = pairCache.keys().next().value;
        if (oldest) pairCache.delete(oldest);
      }
      pairCache.set(key, pair);
    }
    return {
      map: configureTex(pair.diffuse, 4, 4, true),
      bumpMap: configureTex(pair.bump, 4, 4, false),
    };
  }

  if (material === 'leather') {
    if (!cachedLeatherBump) {
      cachedLeatherBump = createLeatherBump();
    }
    return {
      bumpMap: configureTex(cachedLeatherBump, 4, 4, false),
    };
  }

  return null;
}

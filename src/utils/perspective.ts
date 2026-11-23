/**
 * Trasformazione prospettica (omografia 3x3 + interpolazione bilineare) 100% lato client
 * per correggere distorsioni a trapezio (keystone verticale/orizzontale o 4 angoli liberi)
 * su foto e scansioni di piantine.
 */

export interface QuadPoint {
  /** Coordinata X normalizzata (0..1) o in pixel */
  x: number;
  /** Coordinata Y normalizzata (0..1) o in pixel */
  y: number;
}

/** Risolve un sistema lineare A * x = b (8x8) con eliminazione di Gauss e pivoting parziale */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r][col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-10) return null;

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pivot;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Calcola la matrice di omografia inversa H (dest -> src) che mappa i 4 angoli del rettangolo
 * di output [TL, TR, BR, BL] nei 4 punti sorgente [s0, s1, s2, s3] (in pixel).
 */
function computeHomography(
  dst: [QuadPoint, QuadPoint, QuadPoint, QuadPoint],
  src: [QuadPoint, QuadPoint, QuadPoint, QuadPoint]
): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const u = dst[i].x;
    const v = dst[i].y;
    const x = src[i].x;
    const y = src[i].y;

    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);

    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }

  const h = solveLinearSystem(A, b);
  if (!h) return null;
  return [...h, 1];
}

/**
 * Applica una correzione prospettica (trapezio o 4 angoli) a un canvas sorgente
 * e restituisce un nuovo canvas rettificato con interpolazione bilineare.
 *
 * `srcQuadNorm` sono i 4 punti [TL, TR, BR, BL] in coordinate normalizzate (0..1)
 * rispetto al canvas sorgente.
 */
export function warpPerspectiveCanvas(
  srcCanvas: HTMLCanvasElement,
  srcQuadNorm: [QuadPoint, QuadPoint, QuadPoint, QuadPoint],
  outWidth?: number,
  outHeight?: number
): HTMLCanvasElement {
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;

  const s0 = { x: srcQuadNorm[0].x * sw, y: srcQuadNorm[0].y * sh };
  const s1 = { x: srcQuadNorm[1].x * sw, y: srcQuadNorm[1].y * sh };
  const s2 = { x: srcQuadNorm[2].x * sw, y: srcQuadNorm[2].y * sh };
  const s3 = { x: srcQuadNorm[3].x * sw, y: srcQuadNorm[3].y * sh };

  // Se non specificato, calcola dimensioni output preservando le proporzioni del quadrilatero
  const topW = Math.hypot(s1.x - s0.x, s1.y - s0.y);
  const botW = Math.hypot(s2.x - s3.x, s2.y - s3.y);
  const leftH = Math.hypot(s3.x - s0.x, s3.y - s0.y);
  const rightH = Math.hypot(s2.x - s1.x, s2.y - s1.y);

  const dw = Math.max(32, Math.round(outWidth ?? Math.max(topW, botW)));
  const dh = Math.max(32, Math.round(outHeight ?? Math.max(leftH, rightH)));

  const dstQuad: [QuadPoint, QuadPoint, QuadPoint, QuadPoint] = [
    { x: 0, y: 0 },
    { x: dw - 1, y: 0 },
    { x: dw - 1, y: dh - 1 },
    { x: 0, y: dh - 1 },
  ];

  const H = computeHomography(dstQuad, [s0, s1, s2, s3]);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = dw;
  outCanvas.height = dh;
  const outCtx = outCanvas.getContext('2d')!;

  if (!H) {
    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, dw, dh);
    outCtx.drawImage(srcCanvas, 0, 0, dw, dh);
    return outCanvas;
  }

  const srcCtx = srcCanvas.getContext('2d')!;
  const srcImg = srcCtx.getImageData(0, 0, sw, sh);
  const srcData = srcImg.data;
  const dstImg = outCtx.createImageData(dw, dh);
  const dstData = dstImg.data;

  const h0 = H[0],
    h1 = H[1],
    h2 = H[2],
    h3 = H[3],
    h4 = H[4],
    h5 = H[5],
    h6 = H[6],
    h7 = H[7];

  const maxX = sw - 1;
  const maxY = sh - 1;

  for (let v = 0; v < dh; v++) {
    const h1v_h2 = h1 * v + h2;
    const h4v_h5 = h4 * v + h5;
    const h7v_1 = h7 * v + 1;
    let dstIdx = v * dw * 4;

    for (let u = 0; u < dw; u++) {
      const denom = h6 * u + h7v_1;
      const x = (h0 * u + h1v_h2) / denom;
      const y = (h3 * u + h4v_h5) / denom;

      if (x < 0 || x >= maxX || y < 0 || y >= maxY) {
        dstData[dstIdx] = 255;
        dstData[dstIdx + 1] = 255;
        dstData[dstIdx + 2] = 255;
        dstData[dstIdx + 3] = 255;
      } else {
        const x0 = x | 0;
        const y0 = y | 0;
        const fx = x - x0;
        const fy = y - y0;
        const invFx = 1 - fx;
        const invFy = 1 - fy;

        const w00 = invFx * invFy;
        const w10 = fx * invFy;
        const w01 = invFx * fy;
        const w11 = fx * fy;

        const i00 = (y0 * sw + x0) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + sw * 4;
        const i11 = i01 + 4;

        dstData[dstIdx] =
          (srcData[i00] * w00 +
            srcData[i10] * w10 +
            srcData[i01] * w01 +
            srcData[i11] * w11) |
          0;
        dstData[dstIdx + 1] =
          (srcData[i00 + 1] * w00 +
            srcData[i10 + 1] * w10 +
            srcData[i01 + 1] * w01 +
            srcData[i11 + 1] * w11) |
          0;
        dstData[dstIdx + 2] =
          (srcData[i00 + 2] * w00 +
            srcData[i10 + 2] * w10 +
            srcData[i01 + 2] * w01 +
            srcData[i11 + 2] * w11) |
          0;
        dstData[dstIdx + 3] = 255;
      }
      dstIdx += 4;
    }
  }

  outCtx.putImageData(dstImg, 0, 0);
  return outCanvas;
}

/**
 * Genera i 4 punti sorgente [TL, TR, BR, BL] a partire dagli slider di trapezio
 * verticale (`keystoneV` in -0.35..+0.35) e orizzontale (`keystoneH` in -0.35..+0.35).
 */
export function quadFromKeystoneSliders(
  keystoneV: number,
  keystoneH: number
): [QuadPoint, QuadPoint, QuadPoint, QuadPoint] {
  const tl = { x: 0, y: 0 };
  const tr = { x: 1, y: 0 };
  const br = { x: 1, y: 1 };
  const bl = { x: 0, y: 1 };

  // Trapezio verticale (corregge inclinazione avanti/indietro della fotocamera)
  if (keystoneV > 0) {
    tl.x += keystoneV * 0.5;
    tr.x -= keystoneV * 0.5;
  } else if (keystoneV < 0) {
    const k = -keystoneV;
    bl.x += k * 0.5;
    br.x -= k * 0.5;
  }

  // Trapezio orizzontale (corregge scatto laterale da sinistra/destra)
  if (keystoneH > 0) {
    tl.y += keystoneH * 0.5;
    bl.y -= keystoneH * 0.5;
  } else if (keystoneH < 0) {
    const k = -keystoneH;
    tr.y += k * 0.5;
    br.y -= k * 0.5;
  }

  return [tl, tr, br, bl];
}

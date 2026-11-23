/**
 * Genera proceduralmente una piantina architettonica di esempio (PNG base64)
 * con quote reali chiare (appartamento bilocale 9,00 m x 6,40 m) per test rapidi.
 */
import type { FloorplanImage } from '../types/project';

export function generateSampleFloorplanImage(): FloorplanImage {
  const widthPx = 1200;
  const heightPx = 860;
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;

  // Sfondo carta tecnica
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, widthPx, heightPx);

  // Griglia leggera 100px = 1m
  ctx.strokeStyle = '#ece9e1';
  ctx.lineWidth = 1;
  for (let x = 0; x <= widthPx; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, heightPx);
    ctx.stroke();
  }
  for (let y = 0; y <= heightPx; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(widthPx, y);
    ctx.stroke();
  }

  // Scala: 100 px = 1 metro -> appartamento 9.00m x 6.40m (da x=150..1050, y=110..750)
  const ox = 150;
  const oy = 110;
  const w = 900; // 9.00 m
  const h = 640; // 6.40 m

  // Riempimento ambienti
  ctx.fillStyle = '#f4f0e8';
  ctx.fillRect(ox, oy, 520, h); // Soggiorno + cucina (5.20 m)
  ctx.fillStyle = '#eef3f6';
  ctx.fillRect(ox + 520, oy, 380, 420); // Camera (3.80 m x 4.20 m)
  ctx.fillStyle = '#edf5f0';
  ctx.fillRect(ox + 520, oy + 420, 380, 220); // Bagno (3.80 m x 2.20 m)

  // Muri esterni spessi
  ctx.strokeStyle = '#2d3748';
  ctx.lineWidth = 18;
  ctx.strokeRect(ox, oy, w, h);

  // Tramezzi interni
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(ox + 520, oy);
  ctx.lineTo(ox + 520, oy + h);
  ctx.moveTo(ox + 520, oy + 420);
  ctx.lineTo(ox + w, oy + 420);
  ctx.stroke();

  // Simboli indicativi finestre (trattini chiari sui muri)
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 6;
  // Finestra soggiorno nord
  ctx.beginPath();
  ctx.moveTo(ox + 160, oy);
  ctx.lineTo(ox + 300, oy);
  // Finestra camera nord
  ctx.moveTo(ox + 640, oy);
  ctx.lineTo(ox + 780, oy);
  // Finestra bagno est
  ctx.moveTo(ox + w, oy + 490);
  ctx.lineTo(ox + w, oy + 580);
  ctx.stroke();

  // Etichette locali
  ctx.fillStyle = '#475569';
  ctx.font = '600 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SOGGIORNO / CUCINA', ox + 260, oy + 310);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('5,20 × 6,40 m', ox + 260, oy + 338);

  ctx.fillStyle = '#475569';
  ctx.font = '600 22px sans-serif';
  ctx.fillText('CAMERA', ox + 710, oy + 205);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('3,80 × 4,20 m', ox + 710, oy + 233);

  ctx.fillStyle = '#475569';
  ctx.font = '600 20px sans-serif';
  ctx.fillText('BAGNO', ox + 710, oy + 525);
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('3,80 × 2,20 m', ox + 710, oy + 552);

  // Quota superiore (900 cm = 9.00 m) per calibrazione facile
  ctx.strokeStyle = '#dc2626';
  ctx.fillStyle = '#dc2626';
  ctx.lineWidth = 2;
  const qy = oy - 48;
  ctx.beginPath();
  ctx.moveTo(ox, qy);
  ctx.lineTo(ox + w, qy);
  ctx.moveTo(ox, qy - 10);
  ctx.lineTo(ox, qy + 10);
  ctx.moveTo(ox + w, qy - 10);
  ctx.lineTo(ox + w, qy + 10);
  ctx.stroke();
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('900 cm (9,00 m)', ox + w / 2, qy - 12);

  // Quota sinistra (640 cm = 6.40 m)
  const qx = ox - 48;
  ctx.beginPath();
  ctx.moveTo(qx, oy);
  ctx.lineTo(qx, oy + h);
  ctx.moveTo(qx - 10, oy);
  ctx.lineTo(qx + 10, oy);
  ctx.moveTo(qx - 10, oy + h);
  ctx.lineTo(qx + 10, oy + h);
  ctx.stroke();
  ctx.save();
  ctx.translate(qx - 14, oy + h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('640 cm (6,40 m)', 0, 0);
  ctx.restore();

  return {
    dataUrl: canvas.toDataURL('image/png'),
    fileName: 'piantina-esempio-bilocale.png',
    widthPx,
    heightPx,
    opacity: 0.72,
  };
}

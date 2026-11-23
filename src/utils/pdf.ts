/**
 * Utility per caricare un file immagine (PNG/JPG/WebP) oppure la prima pagina di un PDF
 * e restituire un oggetto FloorplanImage completamente lato client.
 */
import type { FloorplanImage } from '../types/project';

/** Legge un'immagine raster e la ottimizza (max 2000px JPEG) se molto pesante */
export function loadImageFile(file: File): Promise<FloorplanImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Errore nella lettura del file immagine.'));
    reader.onload = () => {
      const rawDataUrl = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('Impossibile decodificare l’immagine.'));
      img.onload = () => {
        const maxDim = 2000;
        const needsResize =
          Math.max(img.naturalWidth, img.naturalHeight) > maxDim || rawDataUrl.length > 1_800_000;
        if (!needsResize) {
          resolve({
            dataUrl: rawDataUrl,
            fileName: file.name,
            widthPx: img.naturalWidth,
            heightPx: img.naturalHeight,
            opacity: 0.72,
          });
          return;
        }
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(32, Math.round(img.naturalWidth * scale));
        const h = Math.max(32, Math.round(img.naturalHeight * scale));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve({
            dataUrl: c.toDataURL('image/jpeg', 0.9),
            fileName: file.name,
            widthPx: w,
            heightPx: h,
            opacity: 0.72,
          });
        } else {
          resolve({
            dataUrl: rawDataUrl,
            fileName: file.name,
            widthPx: img.naturalWidth,
            heightPx: img.naturalHeight,
            opacity: 0.72,
          });
        }
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/** Renderizza la prima pagina di un PDF su un canvas HTML e la esporta come PNG Data URL */
export async function loadPdfFirstPage(file: File): Promise<FloorplanImage> {
  const pdfjsLib = await import('pdfjs-dist');
  // Imposta il worker di pdfjs usando Vite URL import
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);

  const scale = 2.0; // Alta risoluzione per tracciatura precisa
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Contesto 2D non disponibile per il rendering PDF.');

  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

  return {
    dataUrl,
    fileName: file.name,
    widthPx: canvas.width,
    heightPx: canvas.height,
    opacity: 0.72,
  };
}

/** Carica automaticamente PNG, JPG o PDF (prima pagina) */
export async function loadFloorplanFile(file: File): Promise<FloorplanImage> {
  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    return loadPdfFirstPage(file);
  }
  return loadImageFile(file);
}

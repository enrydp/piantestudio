/**
 * Utility per conversione scala tra pixel immagine, coordinate mondo 2D (Konva) e metri reali.
 */
import type { Point2D } from '../types/project';

/** Costante del canvas 2D Konva: 1 metro reale = 100 unità Konva (a zoom 1.0) */
export const WORLD_PX_PER_METER = 100;

/** Converte metri reali in coordinate mondo Konva */
export function metersToWorld(meters: number): number {
  return meters * WORLD_PX_PER_METER;
}

/** Converte coordinate mondo Konva in metri reali */
export function worldToMeters(worldPx: number): number {
  return worldPx / WORLD_PX_PER_METER;
}

/** Converte un punto in metri reali a coordinate mondo Konva */
export function pointMetersToWorld(p: Point2D): Point2D {
  return { x: p.x * WORLD_PX_PER_METER, y: p.y * WORLD_PX_PER_METER };
}

/** Converte un punto mondo Konva a metri reali */
export function pointWorldToMeters(p: Point2D): Point2D {
  return { x: p.x / WORLD_PX_PER_METER, y: p.y / WORLD_PX_PER_METER };
}

/** Converte pixel dell'immagine sorgente in metri reali secondo la calibrazione */
export function imagePxToMeters(px: number, pixelsPerMeter: number): number {
  return px / Math.max(pixelsPerMeter, 1e-4);
}

/** Converte metri reali in pixel dell'immagine sorgente */
export function metersToImagePx(meters: number, pixelsPerMeter: number): number {
  return meters * pixelsPerMeter;
}

/** Formatta una lunghezza in metri per visualizzazione italiana (es. "3,45 m" o "80 cm") */
export function formatMeters(meters: number): string {
  if (Math.abs(meters) < 1) {
    return `${Math.round(meters * 100)} cm`;
  }
  return `${meters.toFixed(2).replace('.', ',')} m`;
}

/** Converte cm in metri */
export function cmToMeters(cm: number): number {
  return cm / 100;
}

/** Converte metri in cm arrotondati */
export function metersToCm(meters: number): number {
  return Math.round(meters * 100);
}

/**
 * Generazione geometria muri 3D con fori reali per porte, finestre, portefinestre e archi
 * mediante CSG (three-bvh-csg).
 */
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import type { Opening, Wall } from '../types/project';
import { wallLength } from './geometry';

const evaluator = new Evaluator();
evaluator.useGroups = false;

/**
 * Crea la BufferGeometry di un singolo muro centrato localmente lungo l'asse X
 * (da -length/2 a +length/2), Y da 0 a wall.height, Z da -thickness/2 a +thickness/2,
 * sottraendo con CSG tutte le aperture agganciate al muro.
 */
export function buildWallGeometryWithCSG(
  wall: Wall,
  wallOpenings: Opening[]
): THREE.BufferGeometry {
  const len = Math.max(0.05, wallLength(wall));
  // Leggero overlap agli estremi per giunzioni d'angolo pulite senza fessure
  const extendedLen = len + wall.thickness * 0.98;
  const baseGeo = new THREE.BoxGeometry(extendedLen, wall.height, wall.thickness);
  baseGeo.translate(0, wall.height / 2, 0);

  if (wallOpenings.length === 0) {
    return baseGeo;
  }

  try {
    let resultBrush = new Brush(baseGeo);
    resultBrush.updateMatrixWorld();

    for (const op of wallOpenings) {
      const clampedWidth = Math.min(op.width, Math.max(0.2, len - 0.08));
      const clampedSill = Math.max(0, Math.min(op.sillHeight, wall.height - 0.25));
      const clampedHeight = Math.min(op.height, wall.height - clampedSill - 0.04);
      if (clampedWidth <= 0.05 || clampedHeight <= 0.05) continue;

      const localX = (op.position - 0.5) * len;
      const cutDepth = wall.thickness + 0.16;

      if (op.type === 'arch') {
        // Parte rettangolare inferiore dell'arco + semicilindro superiore
        const archRadius = clampedWidth / 2;
        const rectHeight = Math.max(0.1, clampedHeight - archRadius);

        const rectGeo = new THREE.BoxGeometry(clampedWidth, rectHeight, cutDepth);
        rectGeo.translate(localX, clampedSill + rectHeight / 2, 0);
        const rectBrush = new Brush(rectGeo);
        rectBrush.updateMatrixWorld();
        resultBrush = evaluator.evaluate(resultBrush, rectBrush, SUBTRACTION);
        resultBrush.updateMatrixWorld();
        rectGeo.dispose();

        const cylGeo = new THREE.CylinderGeometry(
          archRadius,
          archRadius,
          cutDepth,
          24
        );
        cylGeo.rotateX(Math.PI / 2);
        cylGeo.translate(localX, clampedSill + rectHeight, 0);
        const cylBrush = new Brush(cylGeo);
        cylBrush.updateMatrixWorld();
        resultBrush = evaluator.evaluate(resultBrush, cylBrush, SUBTRACTION);
        resultBrush.updateMatrixWorld();
        cylGeo.dispose();
      } else {
        const holeGeo = new THREE.BoxGeometry(clampedWidth, clampedHeight, cutDepth);
        holeGeo.translate(localX, clampedSill + clampedHeight / 2, 0);
        const holeBrush = new Brush(holeGeo);
        holeBrush.updateMatrixWorld();

        resultBrush = evaluator.evaluate(resultBrush, holeBrush, SUBTRACTION);
        resultBrush.updateMatrixWorld();
        holeGeo.dispose();
      }
    }

    const finalGeo = resultBrush.geometry.clone();
    finalGeo.computeVertexNormals();
    baseGeo.dispose();
    return finalGeo;
  } catch (err) {
    console.warn('Fallback geometria muro senza CSG:', err);
    return baseGeo;
  }
}

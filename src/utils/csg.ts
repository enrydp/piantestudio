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
      // Estende il taglio leggermente sotto y=0 per porte/archi a filo pavimento:
      // evita facce coplanari residue a y=0 che generano Z-fighting (sfarfallio) sul pavimento!
      const bottomExtend = clampedSill <= 0.005 ? 0.06 : 0;
      const bottomY = clampedSill - bottomExtend;

      if (op.type === 'arch') {
        // Profilo unico estruso (rettangolo inferiore + semicerchio superiore) per taglio CSG pulito
        // senza giunzione coplanare tra scatola e cilindro e senza pelle residua a y=0
        const archRadius = Math.min(clampedWidth / 2, Math.max(0.05, clampedHeight - 0.05));
        const springY = clampedSill + Math.max(0.05, clampedHeight - archRadius);

        const shape = new THREE.Shape();
        shape.moveTo(-archRadius, bottomY);
        shape.lineTo(archRadius, bottomY);
        shape.lineTo(archRadius, springY);
        shape.absarc(0, springY, archRadius, 0, Math.PI, false);
        shape.closePath();

        const archGeo = new THREE.ExtrudeGeometry(shape, {
          depth: cutDepth,
          bevelEnabled: false,
          curveSegments: 24,
        });
        archGeo.translate(localX, 0, -cutDepth / 2);
        archGeo.computeVertexNormals();

        const archBrush = new Brush(archGeo);
        archBrush.updateMatrixWorld();
        resultBrush = evaluator.evaluate(resultBrush, archBrush, SUBTRACTION);
        resultBrush.updateMatrixWorld();
        archGeo.dispose();
      } else {
        const holeH = clampedHeight + bottomExtend;
        const holeGeo = new THREE.BoxGeometry(clampedWidth, holeH, cutDepth);
        holeGeo.translate(localX, bottomY + holeH / 2, 0);
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

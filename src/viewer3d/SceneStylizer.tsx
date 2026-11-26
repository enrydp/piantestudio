/**
 * Motore di stilizzazione 3D client-side (100% locale e compatibile online/GitHub Pages):
 * - Modalità 'cartoon': applica Cel-Shading (MeshToonMaterial con gradientMap a 4 fasce nette)
 *   + contorni a china scura sugli spigoli di muri, infissi e mobili
 * - Modalità 'sketch' (Schizzo Architettonico / stile SketchUp): tinte pastello morbide su carta calda
 *   + tratti tecnici nitidi a china su tutti gli spigoli (EdgesGeometry)
 * - Ripristina integralmente i materiali PBR originali quando si torna a Realistico / Studio / Serale
 */
import React, { useEffect } from 'react';
import * as THREE from 'three';
import type { RenderStylePreset } from '../types/project';

const OUTLINE_NAME = '__piantestudio_stylized_outline__';

/** GradientMap a 4 fasce per vero Cel-Shading / Cartoon */
let cachedToonGradient: THREE.DataTexture | null = null;
function getToonGradientMap(): THREE.DataTexture {
  if (cachedToonGradient) return cachedToonGradient;
  // 4 bande nette di luminosità: ombra morbida -> mezzotono -> luce -> highlight
  const tones = new Uint8Array([
    108, 108, 108, 255,
    168, 168, 168, 255,
    224, 224, 224, 255,
    255, 255, 255, 255,
  ]);
  const tex = new THREE.DataTexture(tones, 4, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  cachedToonGradient = tex;
  return tex;
}

const CARTOON_LINE_MAT = new THREE.LineBasicMaterial({
  color: '#1e2430',
  transparent: true,
  opacity: 0.78,
});

const SKETCH_LINE_MAT = new THREE.LineBasicMaterial({
  color: '#1f2937',
  transparent: true,
  opacity: 0.86,
});

const WARM_PAPER_COLOR = new THREE.Color('#faf6ee');

function removeStylization(root: THREE.Object3D): void {
  const toRemove: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj.name === OUTLINE_NAME) {
      toRemove.push(obj);
      return;
    }
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.__origMaterial) {
      const stylized = mesh.material;
      mesh.material = mesh.userData.__origMaterial as THREE.Material | THREE.Material[];
      delete mesh.userData.__origMaterial;
      if (Array.isArray(stylized)) {
        stylized.forEach((m) => m.dispose());
      } else if (stylized) {
        stylized.dispose();
      }
    }
  });

  for (const lineObj of toRemove) {
    lineObj.parent?.remove(lineObj);
    const seg = lineObj as THREE.LineSegments;
    seg.geometry?.dispose();
  }
}

function createStylizedMaterial(
  orig: THREE.Material,
  preset: 'cartoon' | 'sketch'
): THREE.Material | null {
  // Mantieni trasparenti vetri, box doccia e muri demoliti fantasma
  if (orig.transparent && orig.opacity < 0.85) {
    return null;
  }

  const std = orig as THREE.MeshStandardMaterial;
  const baseColor = std.color ? std.color.clone() : new THREE.Color('#e2e8f0');
  const map = std.map ?? null;

  if (preset === 'cartoon') {
    // Aumenta leggermente la saturazione per effetto illustrazione moderna / cartoon brillante
    const hsl = { h: 0, s: 0, l: 0 };
    baseColor.getHSL(hsl);
    if (hsl.s > 0.04) {
      baseColor.setHSL(hsl.h, Math.min(0.9, hsl.s * 1.18 + 0.04), Math.min(0.92, hsl.l * 1.03));
    }
    return new THREE.MeshToonMaterial({
      color: baseColor,
      map,
      gradientMap: getToonGradientMap(),
    });
  }

  // Modalità 'sketch' (Schizzo Architettonico stile SketchUp / acquerello tecnico):
  // colori pastello morbidi fusi al 36% con carta calda e finitura opaca pulita
  const pastel = baseColor.clone().lerp(WARM_PAPER_COLOR, map ? 0.28 : 0.38);
  return new THREE.MeshStandardMaterial({
    color: pastel,
    map,
    roughness: 0.96,
    metalness: 0,
    envMapIntensity: 0.25,
  });
}

function applyStylization(root: THREE.Object3D, preset: 'cartoon' | 'sketch'): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (obj.name === OUTLINE_NAME) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      meshes.push(mesh);
    }
  });

  const edgeAngle = preset === 'sketch' ? 22 : 28;
  const lineMat = preset === 'sketch' ? SKETCH_LINE_MAT : CARTOON_LINE_MAT;

  for (const mesh of meshes) {
    // Non applicare contorni sul grande piano terreno esterno da 120×120m
    if (mesh.geometry.type === 'PlaneGeometry') {
      continue;
    }

    const origMat = mesh.material;
    if (!Array.isArray(origMat)) {
      const styled = createStylizedMaterial(origMat, preset);
      if (styled) {
        mesh.userData.__origMaterial = origMat;
        mesh.material = styled;
      }
    }

    // Aggiungi contorni a china nitidi sugli spigoli (evitando mesh minuscole o piani enormi)
    const isTransparent = !Array.isArray(origMat) && origMat.transparent && origMat.opacity < 0.25;
    if (!isTransparent) {
      try {
        const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, edgeAngle);
        if (edgesGeo.attributes.position && edgesGeo.attributes.position.count > 0) {
          const lines = new THREE.LineSegments(edgesGeo, lineMat);
          lines.name = OUTLINE_NAME;
          lines.renderOrder = 2;
          mesh.add(lines);
        } else {
          edgesGeo.dispose();
        }
      } catch {
        // Ignora geometrie non supportate da EdgesGeometry
      }
    }
  }
}

export const SceneStylizer: React.FC<{
  targetRef: React.RefObject<THREE.Group>;
  preset: RenderStylePreset;
  sceneVersion: string;
}> = ({ targetRef, preset, sceneVersion }) => {
  useEffect(() => {
    const group = targetRef.current;
    if (!group) return;

    removeStylization(group);
    if (preset === 'cartoon' || preset === 'sketch') {
      // Attendi un micro-frame così tutte le mesh figli React/CSG sono montate prima di applicare gli spigoli
      const raf = window.requestAnimationFrame(() => {
        if (!targetRef.current) return;
        removeStylization(targetRef.current);
        applyStylization(targetRef.current, preset);
      });
      return () => {
        window.cancelAnimationFrame(raf);
        if (targetRef.current) removeStylization(targetRef.current);
      };
    }

    return () => {
      if (targetRef.current) removeStylization(targetRef.current);
    };
  }, [targetRef, preset, sceneVersion]);

  return null;
};

/** Rimuove temporaneamente eventuali linee stilizzate prima di esportare il modello .glb */
export function stripStylizedOutlinesForExport(root: THREE.Object3D): () => void {
  const hidden: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj.name === OUTLINE_NAME && obj.visible) {
      obj.visible = false;
      hidden.push(obj);
    }
  });
  return () => {
    for (const obj of hidden) obj.visible = true;
  };
}

/**
 * Generatore procedurale di mobili 3D in Three.js con proporzioni credibili
 * + supporto opzionale per il caricamento di modelli .glb personalizzati.
 */
import React, { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox, useGLTF } from '@react-three/drei';
import type { Furniture, FurnitureMaterial, Opening, Wall } from '../types/project';
import { getOpeningCenter, wallLength } from '../utils/geometry';
import { getFurnitureMaterialMaps } from '../utils/proceduralTextures';

const EMPTY_WALLS: Wall[] = [];
const EMPTY_OPENINGS: Opening[] = [];

/** Ritaglia un segmento 2D (a = asse pensile, p = asse perpendicolare) sulla fascia [pMin, pMax] */
function clipSegmentToBand(
  a1: number,
  p1: number,
  a2: number,
  p2: number,
  pMin: number,
  pMax: number
): [number, number] | null {
  const dp = p2 - p1;
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dp) < 1e-6) {
    if (p1 < pMin || p1 > pMax) return null;
  } else {
    let ta = (pMin - p1) / dp;
    let tb = (pMax - p1) / dp;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  const ca = a1 + t0 * (a2 - a1);
  const cb = a1 + t1 * (a2 - a1);
  return [Math.min(ca, cb), Math.max(ca, cb)];
}

/**
 * Calcola i tratti validi dei pensili cucina [start, end] lungo un asse locale ('x' o 'z'),
 * interrompendoli automaticamente vicino a finestre, portefinestre, porte o archi
 * anche quando le basi inferiori della cucina proseguono sotto la finestra.
 */
function computeKitchenWallUnitSegments(
  item: Furniture,
  walls: Wall[],
  openings: Opening[],
  axis: 'x' | 'z',
  runStart: number,
  runEnd: number,
  backCoord: number,
  outwardSign: -1 | 1,
  cabMinY: number,
  cabMaxY: number
): Array<[number, number]> {
  if (openings.length === 0 || walls.length === 0) {
    return [[runStart, runEnd]];
  }

  const wallMap = new Map(walls.filter((w) => !w.demolished).map((w) => [w.id, w]));
  const theta = (item.rotation * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const toLocal = (wx: number, wy: number): { lx: number; lz: number } => {
    const dx = wx - item.x;
    const dy = wy - item.y;
    return {
      lx: dx * cosT + dy * sinT,
      lz: -dx * sinT + dy * cosT,
    };
  };

  const blocked: Array<[number, number]> = [];
  const windowClearance = 0.1; // 10 cm di luce libera vicino allo stipite della finestra

  for (const op of openings) {
    const wall = wallMap.get(op.wallId);
    if (!wall) continue;

    // Verifica sovrapposizione in altezza con i pensili (es. [1.46m .. 2.18m])
    const opBottom = op.sillHeight;
    const opTop = op.sillHeight + op.height;
    if (opTop <= cabMinY - 0.04 || opBottom >= cabMaxY + 0.04) continue;

    const len = wallLength(wall);
    if (len < 0.05) continue;

    const ux = (wall.end.x - wall.start.x) / len;
    const uy = (wall.end.y - wall.start.y) / len;
    const center = getOpeningCenter(op, wall);
    const halfW = op.width / 2 + windowClearance;

    const pA = toLocal(center.x - ux * halfW, center.y - uy * halfW);
    const pB = toLocal(center.x + ux * halfW, center.y + uy * halfW);

    const a1 = axis === 'x' ? pA.lx : pA.lz;
    const p1 = axis === 'x' ? pA.lz : pA.lx;
    const a2 = axis === 'x' ? pB.lx : pB.lz;
    const p2 = axis === 'x' ? pB.lz : pB.lx;

    // Fascia di prossimità rispetto al retro del pensile (copre spessore muro + leggero distacco + profondità pensile 34 cm)
    const bandMin =
      outwardSign === -1
        ? backCoord - wall.thickness / 2 - 0.45
        : backCoord - 0.38;
    const bandMax =
      outwardSign === -1
        ? backCoord + 0.38
        : backCoord + wall.thickness / 2 + 0.45;

    const hit = clipSegmentToBand(a1, p1, a2, p2, bandMin, bandMax);
    if (!hit) continue;

    // Se l'apertura è su un muro perpendicolare vicino al fianco del pensile, aggiungi il semispessore muro
    const isPerpendicular = Math.abs(p2 - p1) > Math.abs(a2 - a1) * 1.4;
    const extraPad = isPerpendicular ? wall.thickness / 2 + windowClearance : 0;
    const ga = Math.max(runStart, hit[0] - extraPad);
    const gb = Math.min(runEnd, hit[1] + extraPad);
    if (gb > ga) {
      blocked.push([ga, gb]);
    }
  }

  if (blocked.length === 0) {
    return [[runStart, runEnd]];
  }

  // Unisci intervalli bloccati sovrapposti
  blocked.sort((u, v) => u[0] - v[0]);
  const merged: Array<[number, number]> = [];
  for (const [ga, gb] of blocked) {
    if (merged.length === 0 || ga > merged[merged.length - 1][1]) {
      merged.push([ga, gb]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], gb);
    }
  }

  // Sottrai le finestre dal tratto completo del pensile e scarta ritagli troppo stretti (< 24 cm)
  const segments: Array<[number, number]> = [];
  let cursor = runStart;
  for (const [ga, gb] of merged) {
    if (ga - cursor >= 0.24) {
      segments.push([cursor, ga]);
    }
    cursor = Math.max(cursor, gb);
  }
  if (runEnd - cursor >= 0.24) {
    segments.push([cursor, runEnd]);
  }
  return segments;
}

function materialProps(mat: FurnitureMaterial): {
  roughness: number;
  metalness: number;
  bumpScale: number;
  envMapIntensity: number;
} {
  switch (mat) {
    case 'wood':
      return { roughness: 0.52, metalness: 0.04, bumpScale: 0.008, envMapIntensity: 0.85 };
    case 'marble':
      return { roughness: 0.14, metalness: 0.05, bumpScale: 0.003, envMapIntensity: 1.25 };
    case 'fabric':
      return { roughness: 0.92, metalness: 0.0, bumpScale: 0.012, envMapIntensity: 0.45 };
    case 'leather':
      return { roughness: 0.42, metalness: 0.06, bumpScale: 0.006, envMapIntensity: 0.95 };
    case 'metal':
      return { roughness: 0.22, metalness: 0.84, bumpScale: 0.004, envMapIntensity: 1.3 };
    case 'ceramic':
      return { roughness: 0.14, metalness: 0.06, bumpScale: 0.002, envMapIntensity: 1.25 };
    case 'matte':
    default:
      return { roughness: 0.72, metalness: 0.02, bumpScale: 0.004, envMapIntensity: 0.65 };
  }
}

/** Caricatore opzionale di modello .glb scalato automaticamente alle dimensioni del mobile */
const CustomGlbModel: React.FC<{
  url: string;
  width: number;
  depth: number;
  height: number;
}> = ({ url, width, depth, height }) => {
  const gltf = useGLTF(url);
  const cloned = useMemo(() => {
    const root = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const sx = size.x > 1e-4 ? width / size.x : 1;
    const sy = size.y > 1e-4 ? height / size.y : 1;
    const sz = size.z > 1e-4 ? depth / size.z : 1;
    root.scale.set(sx, sy, sz);
    root.position.set(-center.x * sx, -box.min.y * sy, -center.z * sz);
    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return root;
  }, [gltf.scene, width, depth, height]);

  return <primitive object={cloned} />;
};

/** Geometria procedurale dettagliata per ciascun tipo di mobile */
const ProceduralFurniture: React.FC<{
  item: Furniture;
  walls: Wall[];
  openings: Opening[];
}> = ({ item, walls, openings }) => {
  const { width: w, depth: d, height: h, color, material, geometryType } = item;
  const mp = materialProps(material);

  const pbrMaps = useMemo(
    () => getFurnitureMaterialMaps(material, color),
    [material, color]
  );

  useEffect(() => {
    return () => {
      pbrMaps?.map?.dispose();
      pbrMaps?.bumpMap?.dispose();
    };
  }, [pbrMaps]);

  const mainMat =
    material === 'marble' || material === 'ceramic' ? (
      <meshPhysicalMaterial
        key={`phys_${material}_${color}`}
        color={pbrMaps?.map ? '#ffffff' : color}
        map={pbrMaps?.map ?? null}
        roughness={mp.roughness}
        metalness={mp.metalness}
        clearcoat={material === 'marble' ? 0.68 : 0.75}
        clearcoatRoughness={0.1}
        envMapIntensity={mp.envMapIntensity}
      />
    ) : pbrMaps ? (
      <meshStandardMaterial
        key={`pbr_${material}_${color}`}
        color={pbrMaps.map ? '#ffffff' : color}
        map={pbrMaps.map ?? null}
        bumpMap={pbrMaps.bumpMap ?? null}
        bumpScale={mp.bumpScale}
        roughness={mp.roughness}
        metalness={mp.metalness}
        envMapIntensity={mp.envMapIntensity}
      />
    ) : (
      <meshStandardMaterial
        color={color}
        roughness={mp.roughness}
        metalness={mp.metalness}
        envMapIntensity={mp.envMapIntensity}
      />
    );
  const legMat = (
    <meshStandardMaterial color="#3c2f25" roughness={0.55} metalness={0.18} envMapIntensity={0.85} />
  );
  const chromeMat = (
    <meshStandardMaterial color="#e2e8f0" roughness={0.14} metalness={0.94} envMapIntensity={1.45} />
  );

  switch (geometryType) {
    case 'sofa_l': {
      const legH = 0.08;
      const baseH = h * 0.3;
      const seatH = h * 0.16;
      const backH = h - legH - baseH * 0.5;
      const topD = Math.min(d * 0.54, 0.95);
      const sideW = Math.min(w * 0.38, 0.95);
      const backD = topD * 0.24;
      const armW = 0.15;
      const mx = item.mirrored ? -1 : 1;
      const sideCenterX = mx * (-w / 2 + sideW / 2);
      const chaiseLen = d - topD;

      return (
        <group>
          {/* Base tratto principale lungo in alto (-Z) */}
          <mesh position={[0, legH + baseH / 2, -d / 2 + topD / 2]} castShadow receiveShadow>
            <boxGeometry args={[w, baseH, topD]} />
            {mainMat}
          </mesh>
          {/* Base penisola / chaise longue */}
          <mesh
            position={[sideCenterX, legH + baseH / 2, -d / 2 + topD + chaiseLen / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[sideW, baseH, chaiseLen]} />
            {mainMat}
          </mesh>
          {/* Schienale lungo */}
          <mesh
            position={[0, legH + baseH * 0.5 + backH / 2, -d / 2 + backD / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[w, backH, backD]} />
            {mainMat}
          </mesh>
          {/* Bracciolo lato penisola */}
          <mesh
            position={[mx * (-w / 2 + armW / 2), legH + baseH + h * 0.14, backD * 0.35]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[armW, h * 0.32, d - backD * 0.7]} />
            {mainMat}
          </mesh>
          {/* Bracciolo lato opposto */}
          <mesh
            position={[mx * (w / 2 - armW / 2), legH + baseH + h * 0.14, -d / 2 + topD / 2 + backD * 0.25]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[armW, h * 0.32, topD - backD * 0.6]} />
            {mainMat}
          </mesh>
          {/* Cuscino seduta tratto principale */}
          <mesh
            position={[0, legH + baseH + seatH / 2, -d / 2 + backD + (topD - backD) / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[w - armW * 2 - 0.02, seatH, topD - backD - 0.04]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
          {/* Cuscino penisola */}
          <mesh
            position={[sideCenterX + mx * (armW / 2), legH + baseH + seatH / 2, -d / 2 + topD + chaiseLen / 2 - 0.02]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[sideW - armW - 0.02, seatH, chaiseLen]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
          {/* Piedini */}
          {[
            [-w / 2 + 0.08, -d / 2 + 0.08],
            [w / 2 - 0.08, -d / 2 + 0.08],
            [mx * (w / 2 - 0.08), -d / 2 + topD - 0.08],
            [mx * (-w / 2 + 0.08), d / 2 - 0.08],
            [mx * (-w / 2 + sideW - 0.08), d / 2 - 0.08],
          ].map(([lx, lz], idx) => (
            <mesh key={idx} position={[lx, legH / 2, lz]} castShadow>
              <cylinderGeometry args={[0.022, 0.018, legH, 8]} />
              {legMat}
            </mesh>
          ))}
        </group>
      );
    }

    case 'sideboard': {
      const legH = 0.16;
      const bodyH = Math.max(0.3, h - legH);
      return (
        <group>
          <mesh position={[0, legH + bodyH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, bodyH, d]} />
            {mainMat}
          </mesh>
          {/* 3 maniglie ante */}
          {[-w * 0.3, 0, w * 0.3].map((hx, i) => (
            <mesh key={i} position={[hx, legH + bodyH * 0.65, d / 2 + 0.015]} castShadow>
              <boxGeometry args={[0.02, 0.16, 0.022]} />
              {chromeMat}
            </mesh>
          ))}
          {[-w / 2 + 0.09, w / 2 - 0.09].map((lx, i) =>
            [-d / 2 + 0.07, d / 2 - 0.07].map((lz, j) => (
              <mesh key={`${i}_${j}`} position={[lx, legH / 2, lz]} castShadow>
                <cylinderGeometry args={[0.018, 0.014, legH, 8]} />
                {legMat}
              </mesh>
            ))
          )}
        </group>
      );
    }

    case 'rug': {
      const rugH = Math.max(0.012, Math.min(0.03, h));
      return (
        <mesh position={[0, rugH / 2, 0]} receiveShadow>
          <boxGeometry args={[w, rugH, d]} />
          <meshStandardMaterial color={color} roughness={0.96} metalness={0} />
        </mesh>
      );
    }

    case 'dining_table_round': {
      const topT = 0.045;
      const radius = Math.min(w, d) / 2;
      const legH = h - topT;
      return (
        <group>
          <mesh position={[0, h - topT / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[radius, radius, topT, 32]} />
            {mainMat}
          </mesh>
          {/* Basamento centrale + piede */}
          <mesh position={[0, legH / 2, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.08, legH, 16]} />
            {legMat}
          </mesh>
          <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[radius * 0.45, radius * 0.48, 0.04, 24]} />
            {legMat}
          </mesh>
        </group>
      );
    }

    case 'kitchen_l':
    case 'kitchen_peninsula': {
      const topT = 0.045;
      const bodyH = h - topT;
      const topD = Math.min(d * 0.42, 0.65);
      const sideW = geometryType === 'kitchen_peninsula' ? Math.min(w * 0.34, 0.72) : Math.min(w * 0.36, 0.65);
      const sideLen = d - topD;
      const mx = item.mirrored ? -1 : 1;
      const sideCenterX = mx * (-w / 2 + sideW / 2);
      const worktopMat = <meshStandardMaterial color="#474c52" roughness={0.35} metalness={0.1} />;

      const cabY = h + 0.92;
      const cabH = 0.72;
      const cabD = 0.34;
      const cabMinY = cabY - cabH / 2;
      const cabMaxY = cabY + cabH / 2;

      const mainUpperSegments = computeKitchenWallUnitSegments(
        item,
        walls,
        openings,
        'x',
        -w / 2,
        w / 2,
        -d / 2,
        -1,
        cabMinY,
        cabMaxY
      );
      const sideUpperSegments =
        geometryType === 'kitchen_l'
          ? computeKitchenWallUnitSegments(
              item,
              walls,
              openings,
              'z',
              -d / 2 + cabD,
              d / 2,
              mx * (-w / 2),
              mx === 1 ? -1 : 1,
              cabMinY,
              cabMaxY
            )
          : [];

      return (
        <group>
          {/* Base lunga superiore (-Z) */}
          <mesh position={[0, bodyH / 2, -d / 2 + topD / 2]} castShadow receiveShadow>
            <boxGeometry args={[w, bodyH, topD - 0.02]} />
            {mainMat}
          </mesh>
          {/* Top lungo superiore */}
          <mesh position={[0, h - topT / 2, -d / 2 + topD / 2]} castShadow receiveShadow>
            <boxGeometry args={[w + 0.02, topT, topD]} />
            {worktopMat}
          </mesh>

          {/* Base ala laterale / penisola */}
          <mesh
            position={[sideCenterX, bodyH / 2, -d / 2 + topD + sideLen / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[sideW - 0.02, bodyH, sideLen]} />
            {mainMat}
          </mesh>
          {/* Top ala laterale / penisola */}
          <mesh
            position={[sideCenterX, h - topT / 2, -d / 2 + topD + sideLen / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[sideW + (geometryType === 'kitchen_peninsula' ? 0.14 : 0.02), topT, sideLen + 0.02]} />
            {worktopMat}
          </mesh>

          {/* Lavello + rubinetto sul lato lungo */}
          <mesh position={[mx * (w * 0.22), h + 0.005, -d / 2 + topD / 2]}>
            <boxGeometry args={[Math.min(0.65, w * 0.25), 0.015, topD * 0.68]} />
            {chromeMat}
          </mesh>
          <mesh position={[mx * (w * 0.22), h + 0.14, -d / 2 + 0.12]} castShadow>
            <cylinderGeometry args={[0.015, 0.018, 0.28, 10]} />
            {chromeMat}
          </mesh>

          {/* Piano cottura sull'ala laterale */}
          <mesh position={[sideCenterX, h + 0.006, -d / 2 + topD + sideLen * 0.45]}>
            <boxGeometry args={[sideW * 0.72, 0.012, Math.min(0.62, sideLen * 0.5)]} />
            <meshStandardMaterial color="#181b20" roughness={0.2} metalness={0.5} />
          </mesh>

          {/* Pensili superiori lungo il lato principale (si fermano automaticamente vicino alle finestre) */}
          {mainUpperSegments.map(([sx, ex], idx) => (
            <mesh
              key={`kl_u_main_${idx}`}
              position={[(sx + ex) / 2, cabY, -d / 2 + cabD / 2 + 0.01]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[ex - sx, cabH, cabD]} />
              {mainMat}
            </mesh>
          ))}
          {/* Pensili laterali solo per cucina ad angolo (interrotti automaticamente vicino alle finestre) */}
          {sideUpperSegments.map(([sz, ez], idx) => (
            <mesh
              key={`kl_u_side_${idx}`}
              position={[mx * (-w / 2 + cabD / 2 + 0.01), cabY, (sz + ez) / 2]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[cabD, cabH, ez - sz]} />
              {mainMat}
            </mesh>
          ))}
        </group>
      );
    }

    case 'fridge': {
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            {mainMat}
          </mesh>
          {/* Fessura divisoria frigo / congelatore */}
          <mesh position={[0, h * 0.34, d / 2 + 0.005]}>
            <boxGeometry args={[w * 0.96, 0.012, 0.01]} />
            <meshStandardMaterial color="#334155" roughness={0.4} />
          </mesh>
          {/* Maniglie */}
          <mesh position={[-w * 0.36, h * 0.56, d / 2 + 0.022]} castShadow>
            <boxGeometry args={[0.022, 0.42, 0.032]} />
            {chromeMat}
          </mesh>
          <mesh position={[-w * 0.36, h * 0.22, d / 2 + 0.022]} castShadow>
            <boxGeometry args={[0.022, 0.26, 0.032]} />
            {chromeMat}
          </mesh>
        </group>
      );
    }

    case 'bed_bunk': {
      const postR = 0.035;
      const lowY = 0.32;
      const highY = h - 0.45;
      return (
        <group>
          {/* 4 montanti verticali */}
          {[-w / 2 + postR, w / 2 - postR].map((px, i) =>
            [-d / 2 + postR, d / 2 - postR].map((pz, j) => (
              <mesh key={`${i}_${j}`} position={[px, h / 2, pz]} castShadow receiveShadow>
                <boxGeometry args={[postR * 2, h, postR * 2]} />
                {mainMat}
              </mesh>
            ))
          )}
          {/* Letto inferiore + materasso */}
          <mesh position={[0, lowY, 0]} castShadow receiveShadow>
            <boxGeometry args={[w - 0.06, 0.18, d - 0.08]} />
            <meshStandardMaterial color="#dce4ec" roughness={0.92} />
          </mesh>
          {/* Letto superiore + materasso */}
          <mesh position={[0, highY, 0]} castShadow receiveShadow>
            <boxGeometry args={[w - 0.06, 0.18, d - 0.08]} />
            <meshStandardMaterial color="#dce4ec" roughness={0.92} />
          </mesh>
          {/* Sponda di protezione letto superiore */}
          <mesh position={[-w / 2 + 0.02, highY + 0.24, 0]} castShadow>
            <boxGeometry args={[0.03, 0.22, d - 0.1]} />
            {mainMat}
          </mesh>
          <mesh position={[w / 2 - 0.02, highY + 0.24, -d * 0.15]} castShadow>
            <boxGeometry args={[0.03, 0.22, d * 0.65]} />
            {mainMat}
          </mesh>
          {/* Scaletta laterale */}
          {[0.3, 0.6, 0.9, 1.2].map((ry, idx) => (
            <mesh key={idx} position={[w / 2 + 0.02, ry, d * 0.24]} castShadow>
              <boxGeometry args={[0.04, 0.03, 0.34]} />
              {legMat}
            </mesh>
          ))}
        </group>
      );
    }

    case 'wardrobe_corner': {
      const topD = Math.min(d * 0.45, 0.6);
      const sideW = Math.min(w * 0.35, 0.6);
      const sideLen = d - topD;
      const mx = item.mirrored ? -1 : 1;
      const sideCenterX = mx * (-w / 2 + sideW / 2);
      return (
        <group>
          <mesh position={[0, h / 2, -d / 2 + topD / 2]} castShadow receiveShadow>
            <boxGeometry args={[w, h, topD]} />
            {mainMat}
          </mesh>
          <mesh
            position={[sideCenterX, h / 2, -d / 2 + topD + sideLen / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[sideW, h, sideLen]} />
            {mainMat}
          </mesh>
          {/* Maniglie */}
          <mesh position={[mx * (w * 0.18), h * 0.5, -d / 2 + topD + 0.015]} castShadow>
            <boxGeometry args={[0.02, 0.42, 0.025]} />
            {chromeMat}
          </mesh>
          <mesh
            position={[mx * (-w / 2 + sideW + 0.015), h * 0.5, -d / 2 + topD + sideLen * 0.5]}
            castShadow
          >
            <boxGeometry args={[0.025, 0.42, 0.02]} />
            {chromeMat}
          </mesh>
        </group>
      );
    }

    case 'bidet': {
      return (
        <group>
          <mesh position={[0, h * 0.48, 0.03]} castShadow receiveShadow>
            <cylinderGeometry args={[w * 0.46, w * 0.34, h * 0.96, 16]} />
            {mainMat}
          </mesh>
          <mesh position={[0, h + 0.06, -d * 0.28]} castShadow>
            <cylinderGeometry args={[0.014, 0.018, 0.12, 10]} />
            {chromeMat}
          </mesh>
        </group>
      );
    }

    case 'bathroom_vanity': {
      return (
        <group>
          {/* Mobile base */}
          <mesh position={[0, h * 0.42, 0]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.96, h * 0.78, d * 0.92]} />
            {mainMat}
          </mesh>
          {/* Top doppio lavabo in ceramica */}
          <mesh position={[0, h * 0.88, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h * 0.14, d]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.18} metalness={0.05} />
          </mesh>
          {/* Due rubinetti */}
          {[-w * 0.27, w * 0.27].map((rx, i) => (
            <mesh key={i} position={[rx, h + 0.07, -d * 0.32]} castShadow>
              <cylinderGeometry args={[0.014, 0.018, 0.15, 10]} />
              {chromeMat}
            </mesh>
          ))}
          {/* Specchio sopra il mobile bagno */}
          <mesh position={[0, h + 0.62, -d / 2 + 0.02]} castShadow>
            <boxGeometry args={[w * 0.92, 0.78, 0.025]} />
            <meshStandardMaterial color="#dbeafe" roughness={0.08} metalness={0.85} />
          </mesh>
        </group>
      );
    }

    case 'boiler': {
      return (
        <group>
          {/* Caldaia a gas murale montata in alto */}
          <mesh position={[0, 1.35 + h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            {mainMat}
          </mesh>
          {/* Display frontale */}
          <mesh position={[0, 1.35 + h * 0.28, d / 2 + 0.006]}>
            <boxGeometry args={[w * 0.45, 0.09, 0.01]} />
            <meshStandardMaterial color="#0f172a" roughness={0.2} />
          </mesh>
          {/* Tubo scarico fumi coassiale superiore */}
          <mesh position={[0, 1.35 + h + 0.2, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 0.4, 12]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.4} metalness={0.3} />
          </mesh>
          {/* Tubi inferiori (acqua + gas) */}
          {[-0.1, -0.04, 0.04, 0.1].map((tx, i) => (
            <mesh key={i} position={[tx, 1.2, 0]} castShadow>
              <cylinderGeometry args={[0.01, 0.01, 0.32, 8]} />
              {i === 2 ? (
                <meshStandardMaterial color="#eab308" roughness={0.35} metalness={0.6} />
              ) : (
                chromeMat
              )}
            </mesh>
          ))}
        </group>
      );
    }

    case 'boiler_pellet': {
      return (
        <group>
          {/* Corpo stufa / caldaia a pellet a terra */}
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            {mainMat}
          </mesh>
          {/* Top nero in ghisa */}
          <mesh position={[0, h + 0.015, 0]} castShadow>
            <boxGeometry args={[w + 0.02, 0.03, d + 0.02]} />
            <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.4} />
          </mesh>
          {/* Sportello vetro fuoco */}
          <mesh position={[0, h * 0.56, d / 2 + 0.008]}>
            <boxGeometry args={[w * 0.56, h * 0.36, 0.015]} />
            <meshStandardMaterial
              color="#7c2d12"
              emissive="#ea580c"
              emissiveIntensity={0.45}
              roughness={0.2}
            />
          </mesh>
          {/* Canna fumaria posteriore Ø80 mm */}
          <mesh position={[0, h + 0.55, -d / 2 + 0.09]} castShadow>
            <cylinderGeometry args={[0.042, 0.042, 1.1, 14]} />
            <meshStandardMaterial color="#334155" roughness={0.45} metalness={0.6} />
          </mesh>
        </group>
      );
    }

    case 'water_heater': {
      const radius = Math.min(w, d) / 2;
      const baseFootH = 0.06;
      const tankH = Math.max(0.5, h - baseFootH - 0.08);
      return (
        <group>
          {/* Basamento nero antivibrante */}
          <mesh position={[0, baseFootH / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[radius * 0.96, radius, baseFootH, 24]} />
            <meshStandardMaterial color="#1e293b" roughness={0.65} metalness={0.25} />
          </mesh>
          {/* Serbatoio cilindrico coibentato */}
          <mesh position={[0, baseFootH + tankH / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[radius, radius, tankH, 28]} />
            {mainMat}
          </mesh>
          {/* Calotta superiore stondata */}
          <mesh
            position={[0, baseFootH + tankH, 0]}
            scale={[1, 0.28, 1]}
            castShadow
            receiveShadow
          >
            <sphereGeometry args={[radius, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.35} metalness={0.45} />
          </mesh>
          {/* Pannello display temperatura frontale */}
          <mesh position={[0, baseFootH + tankH * 0.72, radius + 0.006]}>
            <boxGeometry args={[Math.min(0.18, radius * 0.7), 0.09, 0.014]} />
            <meshStandardMaterial color="#0f172a" roughness={0.25} metalness={0.3} />
          </mesh>
          {/* LED display arancio/rosso ACS */}
          <mesh position={[0, baseFootH + tankH * 0.72, radius + 0.015]}>
            <boxGeometry args={[0.08, 0.025, 0.004]} />
            <meshStandardMaterial color="#f97316" emissive="#f97316" emissiveIntensity={0.9} />
          </mesh>
          {/* Attacchi tubi ACS superiore/frontale: Fredda (blu) e Calda (rosso) */}
          <mesh position={[-radius * 0.32, baseFootH + tankH + 0.1, 0]} castShadow>
            <cylinderGeometry args={[0.016, 0.016, 0.16, 12]} />
            <meshStandardMaterial color="#0284c7" roughness={0.3} metalness={0.6} />
          </mesh>
          <mesh position={[radius * 0.32, baseFootH + tankH + 0.1, 0]} castShadow>
            <cylinderGeometry args={[0.016, 0.016, 0.16, 12]} />
            <meshStandardMaterial color="#dc2626" roughness={0.3} metalness={0.6} />
          </mesh>
        </group>
      );
    }

    case 'heat_pump_monobloc':
    case 'heat_pump_split': {
      const isMono = geometryType === 'heat_pump_monobloc';
      const footH = 0.06;
      const bodyH = Math.max(0.45, h - footH);
      const fanR = Math.min(bodyH * 0.34, w * 0.25);
      return (
        <group>
          {/* Piedini antivibranti */}
          {[-w / 2 + 0.14, w / 2 - 0.14].map((fx, i) => (
            <mesh key={i} position={[fx, footH / 2, 0]} castShadow>
              <boxGeometry args={[0.08, footH, d * 0.88]} />
              <meshStandardMaterial color="#1e293b" roughness={0.7} />
            </mesh>
          ))}
          {/* Scocca unità pompa di calore */}
          <mesh position={[0, footH + bodyH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, bodyH, d]} />
            {mainMat}
          </mesh>
          {/* Griglia ventilatore frontale */}
          <mesh
            position={[-w * 0.14, footH + bodyH * 0.52, d / 2 + 0.008]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[fanR, fanR, 0.015, 22]} />
            <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.4} />
          </mesh>
          {/* Pannello laterale attacchi idraulici (monoblocco) o frigoriferi (splittata) */}
          <mesh position={[w * 0.36, footH + bodyH * 0.42, d / 2 + 0.006]}>
            <boxGeometry args={[w * 0.18, bodyH * 0.55, 0.012]} />
            <meshStandardMaterial
              color={isMono ? '#0284c7' : '#0891b2'}
              roughness={0.4}
              metalness={0.2}
            />
          </mesh>
        </group>
      );
    }

    case 'ac_split_high': {
      const mountY = 2.2;
      return (
        <group position={[0, mountY, 0]}>
          {/* Unità interna split alta */}
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            {mainMat}
          </mesh>
          {/* Deflettore inferiore */}
          <mesh position={[0, 0.04, d / 2 + 0.004]} rotation={[0.25, 0, 0]}>
            <boxGeometry args={[w * 0.9, 0.045, 0.012]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.35} />
          </mesh>
          {/* LED stato */}
          <mesh position={[w * 0.36, h * 0.52, d / 2 + 0.005]}>
            <boxGeometry args={[0.04, 0.012, 0.008]} />
            <meshStandardMaterial color="#0ea5e9" emissive="#0ea5e9" emissiveIntensity={0.8} />
          </mesh>
        </group>
      );
    }

    case 'ac_split_low': {
      const mountY = 0.08;
      return (
        <group position={[0, mountY, 0]}>
          {/* Unità console bassa / fan-coil */}
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            {mainMat}
          </mesh>
          {/* Griglia uscita aria superiore */}
          <mesh position={[0, h + 0.005, 0]}>
            <boxGeometry args={[w * 0.84, 0.012, d * 0.45]} />
            <meshStandardMaterial color="#475569" roughness={0.5} />
          </mesh>
          {/* Fessura ripresa aria inferiore */}
          <mesh position={[0, 0.07, d / 2 + 0.005]}>
            <boxGeometry args={[w * 0.82, 0.05, 0.01]} />
            <meshStandardMaterial color="#64748b" roughness={0.5} />
          </mesh>
        </group>
      );
    }

    case 'radiator': {
      const mountY = 0.14;
      const finCount = Math.max(5, Math.min(14, Math.round(w / 0.075)));
      const finW = 0.036;
      return (
        <group position={[0, mountY, 0]}>
          {/* Elementi verticali del termosifone */}
          {Array.from({ length: finCount }).map((_, idx) => {
            const rx = -w / 2 + 0.04 + (idx / Math.max(1, finCount - 1)) * (w - 0.08);
            return (
              <mesh key={idx} position={[rx, h / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[finW, h, d]} />
                {mainMat}
              </mesh>
            );
          })}
          {/* Collettori orizzontali superiore e inferiore */}
          <mesh position={[0, h - 0.06, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.022, 0.022, w - 0.04, 10]} />
            {mainMat}
          </mesh>
          <mesh position={[0, 0.06, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.022, 0.022, w - 0.04, 10]} />
            {mainMat}
          </mesh>
          {/* Valvola termostatica laterale */}
          <mesh position={[w / 2 + 0.03, h - 0.06, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.06, 10]} />
            {chromeMat}
          </mesh>
        </group>
      );
    }

    case 'towel_warmer': {
      const mountY = 0.9;
      const bars = 10;
      return (
        <group position={[0, mountY, 0]}>
          {/* Due montanti verticali */}
          {[-w / 2 + 0.03, w / 2 - 0.03].map((px, i) => (
            <mesh key={i} position={[px, h / 2, 0]} castShadow>
              <cylinderGeometry args={[0.018, 0.018, h, 10]} />
              {mainMat}
            </mesh>
          ))}
          {/* Tubi orizzontali scaldasalviette */}
          {Array.from({ length: bars }).map((_, idx) => {
            const by = 0.08 + (idx / (bars - 1)) * (h - 0.16);
            return (
              <mesh key={idx} position={[0, by, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.011, 0.011, w - 0.06, 8]} />
                {mainMat}
              </mesh>
            );
          })}
        </group>
      );
    }

    case 'manifold_water':
    case 'manifold_heating': {
      const isHeat = geometryType === 'manifold_heating';
      const mountY = 0.45;
      const ports = isHeat ? 6 : 5;
      return (
        <group position={[0, mountY, 0]}>
          {/* Cassetta da incasso / sportello collettore */}
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color="#f1f5f9" roughness={0.4} metalness={0.35} />
          </mesh>
          {/* Cornice sportello */}
          <mesh position={[0, h / 2, d / 2 + 0.005]}>
            <boxGeometry args={[w * 0.92, h * 0.88, 0.012]} />
            <meshStandardMaterial color={isHeat ? '#fef2f2' : '#f0f9ff'} roughness={0.5} metalness={0.1} />
          </mesh>
          {/* Barra superiore (Mandata / Calda - rossa) */}
          <mesh position={[0, h * 0.68, d / 2 + 0.018]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.016, 0.016, w * 0.78, 12]} />
            <meshStandardMaterial color={isHeat ? '#dc2626' : '#ef4444'} roughness={0.3} metalness={0.6} />
          </mesh>
          {/* Barra inferiore (Ritorno / Fredda - blu) */}
          <mesh position={[0, h * 0.34, d / 2 + 0.018]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.016, 0.016, w * 0.78, 12]} />
            <meshStandardMaterial color={isHeat ? '#2563eb' : '#0284c7'} roughness={0.3} metalness={0.6} />
          </mesh>
          {/* Valvoline / attacchi vie */}
          {Array.from({ length: ports }).map((_, idx) => {
            const px = -w * 0.34 + (idx / Math.max(1, ports - 1)) * (w * 0.68);
            return (
              <group key={idx}>
                <mesh position={[px, h * 0.68, d / 2 + 0.032]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.012, 0.012, 0.02, 8]} />
                  <meshStandardMaterial color="#b91c1c" roughness={0.35} />
                </mesh>
                <mesh position={[px, h * 0.34, d / 2 + 0.032]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.012, 0.012, 0.02, 8]} />
                  <meshStandardMaterial color="#0369a1" roughness={0.35} />
                </mesh>
              </group>
            );
          })}
        </group>
      );
    }

    case 'sofa_2':
    case 'sofa_3':
    case 'armchair': {
      const legH = 0.09;
      const baseH = h * 0.28;
      const seatH = h * 0.17;
      const backH = h - legH - baseH * 0.45;
      const backD = d * 0.24;
      const armW = Math.min(0.18, w * 0.14);
      const cushions = geometryType === 'sofa_3' ? 3 : geometryType === 'sofa_2' ? 2 : 1;
      const cushionW = (w - armW * 2 - 0.025 * (cushions + 1)) / cushions;

      return (
        <group>
          {/* Struttura base smussata */}
          <RoundedBox
            args={[w, baseH, d]}
            radius={0.035}
            smoothness={3}
            position={[0, legH + baseH / 2, 0]}
            castShadow
            receiveShadow
          >
            {mainMat}
          </RoundedBox>
          {/* Schienale imbottito */}
          <RoundedBox
            args={[w - 0.02, backH, backD]}
            radius={0.045}
            smoothness={3}
            position={[0, legH + baseH * 0.5 + backH / 2, -d / 2 + backD / 2]}
            castShadow
            receiveShadow
          >
            {mainMat}
          </RoundedBox>
          {/* Braccioli arrotondati */}
          <RoundedBox
            args={[armW, h * 0.34, d - backD * 0.6]}
            radius={0.04}
            smoothness={3}
            position={[-w / 2 + armW / 2, legH + baseH + h * 0.14, backD * 0.3]}
            castShadow
            receiveShadow
          >
            {mainMat}
          </RoundedBox>
          <RoundedBox
            args={[armW, h * 0.34, d - backD * 0.6]}
            radius={0.04}
            smoothness={3}
            position={[w / 2 - armW / 2, legH + baseH + h * 0.14, backD * 0.3]}
            castShadow
            receiveShadow
          >
            {mainMat}
          </RoundedBox>
          {/* Cuscini seduta e schienale morbidi */}
          {Array.from({ length: cushions }).map((_, idx) => {
            const cx = -w / 2 + armW + 0.025 + cushionW / 2 + idx * (cushionW + 0.025);
            return (
              <React.Fragment key={idx}>
                <RoundedBox
                  args={[cushionW, seatH, d - backD - 0.03]}
                  radius={0.045}
                  smoothness={3}
                  position={[cx, legH + baseH + seatH / 2 - 0.01, backD * 0.45]}
                  castShadow
                  receiveShadow
                >
                  {mainMat}
                </RoundedBox>
                <RoundedBox
                  args={[cushionW - 0.02, backH * 0.62, 0.16]}
                  radius={0.05}
                  smoothness={3}
                  position={[cx, legH + baseH + seatH + backH * 0.24, -d / 2 + backD + 0.06]}
                  rotation={[-0.14, 0, 0]}
                  castShadow
                  receiveShadow
                >
                  {mainMat}
                </RoundedBox>
              </React.Fragment>
            );
          })}
          {/* Cuscini decorativi a contrasto sui divani */}
          {cushions >= 2 && (
            <>
              <RoundedBox
                args={[0.28, 0.28, 0.11]}
                radius={0.045}
                smoothness={3}
                position={[-w / 2 + armW + 0.15, legH + baseH + seatH + 0.12, -d / 2 + backD + 0.16]}
                rotation={[-0.22, 0.42, 0.08]}
                castShadow
              >
                <meshStandardMaterial color="#e8dfd2" roughness={0.92} />
              </RoundedBox>
              <RoundedBox
                args={[0.28, 0.28, 0.11]}
                radius={0.045}
                smoothness={3}
                position={[w / 2 - armW - 0.15, legH + baseH + seatH + 0.12, -d / 2 + backD + 0.16]}
                rotation={[-0.22, -0.42, -0.08]}
                castShadow
              >
                <meshStandardMaterial color="#c9a986" roughness={0.92} />
              </RoundedBox>
            </>
          )}
          {/* Piedini affusolati */}
          {[-w / 2 + 0.09, w / 2 - 0.09].map((lx, i) =>
            [-d / 2 + 0.09, d / 2 - 0.09].map((lz, j) => (
              <mesh key={`${i}_${j}`} position={[lx, legH / 2, lz]} castShadow>
                <cylinderGeometry args={[0.022, 0.015, legH, 10]} />
                {legMat}
              </mesh>
            ))
          )}
        </group>
      );
    }

    case 'coffee_table':
    case 'dining_table':
    case 'desk': {
      const topT = 0.046;
      const legH = h - topT;
      const legR = geometryType === 'coffee_table' ? 0.02 : 0.026;
      return (
        <group>
          <RoundedBox
            args={[w, topT, d]}
            radius={0.014}
            smoothness={2}
            position={[0, h - topT / 2, 0]}
            castShadow
            receiveShadow
          >
            {mainMat}
          </RoundedBox>
          {[-w / 2 + 0.08, w / 2 - 0.08].map((lx, i) =>
            [-d / 2 + 0.08, d / 2 - 0.08].map((lz, j) => (
              <mesh key={`${i}_${j}`} position={[lx, legH / 2, lz]} castShadow>
                <cylinderGeometry args={[legR, legR * 0.8, legH, 10]} />
                {legMat}
              </mesh>
            ))
          )}
          {geometryType === 'desk' && (
            <group position={[w / 2 - 0.22, legH / 2, 0]}>
              <RoundedBox args={[0.38, legH - 0.04, d - 0.08]} radius={0.01} smoothness={2} castShadow receiveShadow>
                {mainMat}
              </RoundedBox>
              {[0.18, 0, -0.18].map((dy, idx) => (
                <mesh key={idx} position={[0, dy, (d - 0.08) / 2 + 0.01]} castShadow>
                  <boxGeometry args={[0.14, 0.016, 0.018]} />
                  {chromeMat}
                </mesh>
              ))}
            </group>
          )}
        </group>
      );
    }

    case 'chair': {
      const seatY = h * 0.5;
      const seatT = 0.048;
      const backH = h - seatY;
      return (
        <group>
          {/* Seduta arrotondata */}
          <RoundedBox
            args={[w, seatT, d * 0.94]}
            radius={0.018}
            smoothness={2}
            position={[0, seatY, 0.01]}
            castShadow
            receiveShadow
          >
            {mainMat}
          </RoundedBox>
          {/* Schienale ergonomico leggermente inclinato */}
          <RoundedBox
            args={[w * 0.94, backH * 0.72, 0.038]}
            radius={0.016}
            smoothness={2}
            position={[0, seatY + backH * 0.62, -d / 2 + 0.035]}
            rotation={[-0.1, 0, 0]}
            castShadow
            receiveShadow
          >
            {mainMat}
          </RoundedBox>
          {/* Montanti schienale */}
          {[-w * 0.36, w * 0.36].map((mx, idx) => (
            <mesh key={idx} position={[mx, seatY + backH * 0.3, -d / 2 + 0.04]} rotation={[-0.1, 0, 0]} castShadow>
              <cylinderGeometry args={[0.014, 0.016, backH * 0.62, 8]} />
              {legMat}
            </mesh>
          ))}
          {/* 4 gambe affusolate */}
          {[-w / 2 + 0.045, w / 2 - 0.045].map((lx, i) =>
            [-d / 2 + 0.045, d / 2 - 0.045].map((lz, j) => (
              <mesh key={`${i}_${j}`} position={[lx, seatY / 2, lz]} castShadow>
                <cylinderGeometry args={[0.018, 0.013, seatY, 8]} />
                {legMat}
              </mesh>
            ))
          )}
        </group>
      );
    }

    case 'tv_stand': {
      const tvW = Math.min(w * 0.78, 1.42);
      const tvH = tvW * 0.56;
      const legH = 0.1;
      const bodyH = Math.max(0.24, h - legH);
      return (
        <group>
          {/* Mobile basso smussato con piedini */}
          <RoundedBox
            args={[w, bodyH, d]}
            radius={0.014}
            smoothness={2}
            position={[0, legH + bodyH / 2, 0]}
            castShadow
            receiveShadow
          >
            {mainMat}
          </RoundedBox>
          {/* Maniglie frontali */}
          {[-w * 0.28, w * 0.28].map((hx, idx) => (
            <mesh key={idx} position={[hx, legH + bodyH * 0.65, d / 2 + 0.012]} castShadow>
              <boxGeometry args={[0.14, 0.016, 0.018]} />
              {chromeMat}
            </mesh>
          ))}
          {[-w / 2 + 0.09, w / 2 - 0.09].map((lx, i) =>
            [-d / 2 + 0.06, d / 2 - 0.06].map((lz, j) => (
              <mesh key={`${i}_${j}`} position={[lx, legH / 2, lz]} castShadow>
                <cylinderGeometry args={[0.016, 0.012, legH, 8]} />
                {legMat}
              </mesh>
            ))
          )}
          {/* Piedistallo TV */}
          <mesh position={[0, h + 0.05, -d * 0.08]} castShadow>
            <boxGeometry args={[0.36, 0.018, 0.16]} />
            <meshStandardMaterial color="#1e293b" roughness={0.3} metalness={0.65} />
          </mesh>
          <mesh position={[0, h + 0.11, -d * 0.1]} castShadow>
            <boxGeometry args={[0.12, 0.12, 0.035]} />
            <meshStandardMaterial color="#1e293b" roughness={0.3} metalness={0.65} />
          </mesh>
          {/* Cornice TV sottile */}
          <RoundedBox
            args={[tvW, tvH, 0.032]}
            radius={0.008}
            smoothness={2}
            position={[0, h + 0.12 + tvH / 2, -d * 0.1]}
            castShadow
          >
            <meshStandardMaterial color="#0f172a" roughness={0.28} metalness={0.5} />
          </RoundedBox>
          {/* Pannello vetro schermo lucido */}
          <mesh position={[0, h + 0.12 + tvH / 2, -d * 0.1 + 0.017]}>
            <planeGeometry args={[tvW - 0.03, tvH - 0.03]} />
            <meshPhysicalMaterial
              color="#0b1120"
              roughness={0.08}
              metalness={0.18}
              clearcoat={1}
              clearcoatRoughness={0.06}
              envMapIntensity={1.5}
            />
          </mesh>
        </group>
      );
    }

    case 'bookshelf': {
      const shelves = 5;
      const sideT = 0.03;
      return (
        <group>
          {/* Fianchi + schienale */}
          <mesh position={[-w / 2 + sideT / 2, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[sideT, h, d]} />
            {mainMat}
          </mesh>
          <mesh position={[w / 2 - sideT / 2, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[sideT, h, d]} />
            {mainMat}
          </mesh>
          <mesh position={[0, h / 2, -d / 2 + 0.012]} castShadow receiveShadow>
            <boxGeometry args={[w, h, 0.024]} />
            {mainMat}
          </mesh>
          {/* Ripiani */}
          {Array.from({ length: shelves + 1 }).map((_, idx) => {
            const sy = (idx / shelves) * (h - sideT) + sideT / 2;
            return (
              <mesh key={idx} position={[0, sy, 0]} castShadow receiveShadow>
                <boxGeometry args={[w - sideT * 2, sideT, d - 0.02]} />
                {mainMat}
              </mesh>
            );
          })}
          {/* Libri decorativi */}
          {[0.28, 0.5, 0.72].map((ratio, i) => (
            <mesh key={i} position={[-w * 0.15 + i * w * 0.14, h * ratio, 0.02]} castShadow>
              <boxGeometry args={[w * 0.22, 0.24, d * 0.65]} />
              <meshStandardMaterial
                color={['#3b5998', '#9b4d3f', '#4a7c59'][i % 3]}
                roughness={0.8}
              />
            </mesh>
          ))}
        </group>
      );
    }

    case 'kitchen_linear':
    case 'kitchen_island': {
      const topT = 0.045;
      const plinthH = 0.1;
      const bodyH = h - topT - plinthH;
      const cabY = h + 0.92;
      const cabH = 0.72;
      const cabD = 0.34;
      const doorCount = Math.max(2, Math.round(w / 0.6));
      const linearUpperSegments =
        geometryType === 'kitchen_linear'
          ? computeKitchenWallUnitSegments(
              item,
              walls,
              openings,
              'x',
              -w / 2,
              w / 2,
              -d / 2,
              -1,
              cabY - cabH / 2,
              cabY + cabH / 2
            )
          : [];
      return (
        <group>
          {/* Zoccolo rientrante scuro moderno */}
          <mesh position={[0, plinthH / 2, -0.02]} receiveShadow>
            <boxGeometry args={[w - 0.02, plinthH, d - 0.08]} />
            <meshStandardMaterial color="#272d36" roughness={0.6} metalness={0.25} />
          </mesh>
          {/* Basi */}
          <mesh position={[0, plinthH + bodyH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, bodyH, d - 0.03]} />
            {mainMat}
          </mesh>
          {/* Maniglie frontali ante basi */}
          {Array.from({ length: doorCount }).map((_, idx) => {
            const dx = -w / 2 + ((idx + 0.5) / doorCount) * w;
            return (
              <mesh key={`kd_${idx}`} position={[dx, h - topT - 0.09, d / 2 - 0.005]} castShadow>
                <boxGeometry args={[Math.min(0.16, (w / doorCount) * 0.4), 0.016, 0.02]} />
                {chromeMat}
              </mesh>
            );
          })}
          {/* Piano di lavoro quarzo/pietra smussato */}
          <RoundedBox
            args={[w + 0.02, topT, d]}
            radius={0.008}
            smoothness={2}
            position={[0, h - topT / 2, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color="#474c52" roughness={0.28} metalness={0.12} envMapIntensity={1.1} />
          </RoundedBox>
          {/* Lavello, miscelatore curvo, piano induzione e pensili per cucina lineare */}
          {geometryType === 'kitchen_linear' && (
            <>
              <mesh position={[-w * 0.28, h + 0.006, 0]}>
                <boxGeometry args={[Math.min(0.65, w * 0.25), 0.014, d * 0.66]} />
                {chromeMat}
              </mesh>
              {/* Miscelatore a collo d'oca */}
              <mesh position={[-w * 0.28, h + 0.14, -d * 0.3]} castShadow>
                <cylinderGeometry args={[0.014, 0.018, 0.28, 10]} />
                {chromeMat}
              </mesh>
              <mesh position={[-w * 0.28, h + 0.27, -d * 0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[0.012, 0.012, 0.16, 10]} />
                {chromeMat}
              </mesh>
              {/* Piano cottura vetroceramica */}
              <mesh position={[w * 0.26, h + 0.006, 0]}>
                <boxGeometry args={[Math.min(0.64, w * 0.25), 0.012, d * 0.72]} />
                <meshPhysicalMaterial color="#111622" roughness={0.1} metalness={0.35} clearcoat={1} />
              </mesh>
              {/* 4 zone induzione */}
              {[-0.14, 0.14].map((ox, i) =>
                [-0.12, 0.12].map((oz, j) => (
                  <mesh
                    key={`hz_${i}_${j}`}
                    position={[w * 0.26 + ox, h + 0.014, oz]}
                    rotation={[-Math.PI / 2, 0, 0]}
                  >
                    <ringGeometry args={[0.06, 0.072, 20]} />
                    <meshStandardMaterial color="#475569" roughness={0.4} />
                  </mesh>
                ))
              )}
              {/* Pensili superiori: si fermano automaticamente vicino alle finestre anche se le basi continuano sotto */}
              {linearUpperSegments.map(([sx, ex], idx) => {
                const segW = ex - sx;
                const segCenterX = (sx + ex) / 2;
                const segDoors = Math.max(1, Math.round(segW / 0.55));
                return (
                  <group key={`klin_u_${idx}`}>
                    <mesh
                      position={[segCenterX, cabY, -d / 2 + cabD / 2 + 0.01]}
                      castShadow
                      receiveShadow
                    >
                      <boxGeometry args={[segW, cabH, cabD]} />
                      {mainMat}
                    </mesh>
                    {Array.from({ length: segDoors }).map((_, di) => {
                      const hx = sx + ((di + 0.5) / segDoors) * segW;
                      return (
                        <mesh
                          key={`kh_${di}`}
                          position={[hx, cabY - cabH / 2 + 0.07, -d / 2 + cabD + 0.016]}
                        >
                          <boxGeometry args={[Math.min(0.14, (segW / segDoors) * 0.42), 0.014, 0.016]} />
                          {chromeMat}
                        </mesh>
                      );
                    })}
                  </group>
                );
              })}
            </>
          )}
        </group>
      );
    }

    case 'bed_single':
    case 'bed_double': {
      const frameH = 0.25;
      const mattressH = 0.22;
      const pillows = geometryType === 'bed_double' ? 2 : 1;
      const pillowW = (w - 0.24) / pillows - 0.05;
      return (
        <group>
          {/* Piedini letto */}
          {[-w / 2 + 0.08, w / 2 - 0.08].map((lx, i) =>
            [-d / 2 + 0.08, d / 2 - 0.08].map((lz, j) => (
              <mesh key={`bl_${i}_${j}`} position={[lx, 0.04, lz]} castShadow>
                <cylinderGeometry args={[0.022, 0.016, 0.08, 8]} />
                {legMat}
              </mesh>
            ))
          )}
          {/* Giroletto smussato */}
          <RoundedBox
            args={[w, frameH, d]}
            radius={0.03}
            smoothness={2}
            position={[0, frameH / 2 + 0.07, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color="#7d6046" roughness={0.62} />
          </RoundedBox>
          {/* Testata imbottita arrotondata */}
          <RoundedBox
            args={[w + 0.06, h, 0.11]}
            radius={0.04}
            smoothness={3}
            position={[0, h / 2, -d / 2 + 0.055]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color="#6e543d" roughness={0.72} />
          </RoundedBox>
          {/* Materasso con lenzuolo bianco fresco */}
          <RoundedBox
            args={[w - 0.07, mattressH, d - 0.14]}
            radius={0.045}
            smoothness={3}
            position={[0, frameH + 0.07 + mattressH / 2, 0.04]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color="#f8fafc" roughness={0.92} />
          </RoundedBox>
          {/* Piumone / copriletto soffice smussato */}
          <RoundedBox
            args={[w - 0.02, mattressH * 0.98, d * 0.64]}
            radius={0.055}
            smoothness={3}
            position={[0, frameH + 0.085 + mattressH / 2, d * 0.14]}
            castShadow
            receiveShadow
          >
            {mainMat}
          </RoundedBox>
          {/* Risvolto decorativo superiore del copriletto */}
          <RoundedBox
            args={[w - 0.01, 0.06, 0.2]}
            radius={0.025}
            smoothness={2}
            position={[0, frameH + 0.095 + mattressH, -d * 0.15]}
            castShadow
          >
            <meshStandardMaterial color="#f1f5f9" roughness={0.92} />
          </RoundedBox>
          {/* Cuscini soffici arrotondati */}
          {Array.from({ length: pillows }).map((_, i) => (
            <RoundedBox
              key={i}
              args={[pillowW, 0.14, 0.4]}
              radius={0.05}
              smoothness={3}
              position={[
                -w / 2 + 0.14 + pillowW / 2 + i * (pillowW + 0.08),
                frameH + 0.08 + mattressH + 0.065,
                -d / 2 + 0.34,
              ]}
              rotation={[0.14, 0, 0]}
              castShadow
            >
              <meshStandardMaterial color="#ffffff" roughness={0.9} />
            </RoundedBox>
          ))}
        </group>
      );
    }

    case 'nightstand':
    case 'dresser':
    case 'wardrobe': {
      const drawers = geometryType === 'wardrobe' ? 0 : geometryType === 'dresser' ? 4 : 2;
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            {mainMat}
          </mesh>
          {geometryType === 'wardrobe' ? (
            <>
              {/* Maniglie ante armadio */}
              <mesh position={[-0.08, h * 0.5, d / 2 + 0.015]} castShadow>
                <boxGeometry args={[0.02, 0.36, 0.025]} />
                {chromeMat}
              </mesh>
              <mesh position={[0.08, h * 0.5, d / 2 + 0.015]} castShadow>
                <boxGeometry args={[0.02, 0.36, 0.025]} />
                {chromeMat}
              </mesh>
            </>
          ) : (
            Array.from({ length: drawers }).map((_, i) => (
              <mesh
                key={i}
                position={[0, ((i + 0.5) / drawers) * (h - 0.08) + 0.04, d / 2 + 0.014]}
                castShadow
              >
                <boxGeometry args={[Math.min(0.18, w * 0.3), 0.02, 0.022]} />
                {chromeMat}
              </mesh>
            ))
          )}
        </group>
      );
    }

    case 'sink': {
      return (
        <group>
          {/* Mobile sospeso / base lavabo smussato */}
          <RoundedBox
            args={[w * 0.94, h * 0.72, d * 0.9]}
            radius={0.014}
            smoothness={2}
            position={[0, h * 0.48, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color="#dfd8ce" roughness={0.55} />
          </RoundedBox>
          {/* Maniglia cassetto */}
          <mesh position={[0, h * 0.68, d * 0.45 + 0.012]} castShadow>
            <boxGeometry args={[w * 0.32, 0.016, 0.018]} />
            {chromeMat}
          </mesh>
          {/* Top lavabo ceramica arrotondato */}
          <RoundedBox
            args={[w, h * 0.14, d]}
            radius={0.018}
            smoothness={2}
            position={[0, h * 0.91, 0]}
            castShadow
            receiveShadow
          >
            {mainMat}
          </RoundedBox>
          {/* Miscelatore */}
          <mesh position={[0, h + 0.08, -d * 0.34]} castShadow>
            <cylinderGeometry args={[0.015, 0.018, 0.16, 10]} />
            {chromeMat}
          </mesh>
          <mesh position={[0, h + 0.14, -d * 0.27]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.011, 0.011, 0.11, 10]} />
            {chromeMat}
          </mesh>
          {/* Specchio bagno retroilluminato a LED */}
          <mesh position={[0, h + 0.68, -d / 2 + 0.025]}>
            <boxGeometry args={[w * 0.96, 0.74, 0.018]} />
            <meshStandardMaterial
              color="#fff8ea"
              emissive="#ffefd2"
              emissiveIntensity={0.65}
              roughness={0.3}
            />
          </mesh>
          <mesh position={[0, h + 0.68, -d / 2 + 0.04]}>
            <boxGeometry args={[w * 0.9, 0.68, 0.012]} />
            <meshPhysicalMaterial
              color="#dbeafe"
              roughness={0.05}
              metalness={0.85}
              clearcoat={1}
              envMapIntensity={1.6}
            />
          </mesh>
        </group>
      );
    }

    case 'wc': {
      return (
        <group>
          {/* Cassetta */}
          <mesh position={[0, h * 0.55, -d / 2 + 0.1]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.92, h * 0.72, 0.18]} />
            {mainMat}
          </mesh>
          {/* Base + tazza */}
          <mesh position={[0, 0.21, 0.08]} castShadow receiveShadow>
            <cylinderGeometry args={[w * 0.44, w * 0.34, 0.42, 16]} />
            {mainMat}
          </mesh>
        </group>
      );
    }

    case 'shower': {
      return (
        <group>
          {/* Piatto doccia */}
          <mesh position={[0, 0.05, 0]} receiveShadow>
            <boxGeometry args={[w, 0.1, d]} />
            {mainMat}
          </mesh>
          {/* Pareti in vetro */}
          <mesh position={[w / 2 - 0.015, h / 2, 0]}>
            <boxGeometry args={[0.02, h - 0.1, d]} />
            <meshPhysicalMaterial color="#d6eef8" transparent opacity={0.28} roughness={0.08} />
          </mesh>
          <mesh position={[0, h / 2, d / 2 - 0.015]}>
            <boxGeometry args={[w, h - 0.1, 0.02]} />
            <meshPhysicalMaterial color="#d6eef8" transparent opacity={0.28} roughness={0.08} />
          </mesh>
          {/* Soffione */}
          <mesh position={[0, h - 0.14, -d / 2 + 0.15]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 0.025, 16]} />
            {chromeMat}
          </mesh>
        </group>
      );
    }

    case 'bathtub': {
      return (
        <group>
          {/* Bordo esterno */}
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            {mainMat}
          </mesh>
          {/* Cavità interna simulata */}
          <mesh position={[0, h - 0.04, 0]}>
            <boxGeometry args={[w - 0.16, 0.08, d - 0.16]} />
            <meshStandardMaterial color="#dce8f0" roughness={0.2} />
          </mesh>
          {/* Rubinetto */}
          <mesh position={[-w / 2 + 0.1, h + 0.08, 0]} castShadow>
            <cylinderGeometry args={[0.018, 0.022, 0.16, 10]} />
            {chromeMat}
          </mesh>
        </group>
      );
    }

    case 'washing_machine': {
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            {mainMat}
          </mesh>
          {/* Oblò frontale */}
          <mesh position={[0, h * 0.46, d / 2 + 0.01]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[w * 0.3, w * 0.3, 0.04, 20]} />
            <meshStandardMaterial color="#334155" roughness={0.25} metalness={0.6} />
          </mesh>
        </group>
      );
    }

    case 'plant': {
      const potH = h * 0.28;
      const potR = Math.min(w, d) * 0.34;
      return (
        <group>
          {/* Vaso in terracotta */}
          <mesh position={[0, potH / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[potR, potR * 0.72, potH, 16]} />
            <meshStandardMaterial color="#b36a4a" roughness={0.82} />
          </mesh>
          {/* Tronco */}
          <mesh position={[0, potH + h * 0.25, 0]} castShadow>
            <cylinderGeometry args={[0.025, 0.035, h * 0.45, 8]} />
            <meshStandardMaterial color="#5c4033" roughness={0.9} />
          </mesh>
          {/* Chioma */}
          <mesh position={[0, h * 0.7, 0]} castShadow>
            <dodecahedronGeometry args={[Math.min(w, d) * 0.48, 1]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
          <mesh position={[0.08, h * 0.82, 0.06]} castShadow>
            <dodecahedronGeometry args={[Math.min(w, d) * 0.32, 1]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
        </group>
      );
    }

    case 'stairs_straight': {
      const steps = 14;
      const stepD = d / steps;
      const stepH = h / steps;
      return (
        <group>
          {Array.from({ length: steps }).map((_, i) => {
            const curH = (i + 1) * stepH;
            const zPos = d / 2 - (i + 0.5) * stepD;
            return (
              <mesh key={i} position={[0, curH / 2, zPos]} castShadow receiveShadow>
                <boxGeometry args={[w, curH, stepD + 0.005]} />
                {mainMat}
              </mesh>
            );
          })}
          {/* Corrimano laterali */}
          {[-w / 2 + 0.04, w / 2 - 0.04].map((rx, idx) => (
            <group key={idx}>
              <mesh position={[rx, 0.52, d / 2 - 0.08]} castShadow>
                <cylinderGeometry args={[0.018, 0.018, 0.95, 8]} />
                {chromeMat}
              </mesh>
              <mesh position={[rx, h + 0.45, -d / 2 + 0.08]} castShadow>
                <cylinderGeometry args={[0.018, 0.018, 0.95, 8]} />
                {chromeMat}
              </mesh>
              <mesh
                position={[rx, h / 2 + 0.92, 0]}
                rotation={[Math.atan2(h, d), 0, 0]}
                castShadow
              >
                <boxGeometry args={[0.04, 0.04, Math.hypot(d, h)]} />
                {legMat}
              </mesh>
            </group>
          ))}
        </group>
      );
    }

    case 'stairs_l': {
      const landingW = w * 0.48;
      const landingD = d * 0.44;
      const landingY = h * 0.52;
      const stepsLower = 8;
      const stepsUpper = 7;
      const lowerRun = d - landingD;
      const upperRun = w - landingW;
      const firstIsRight = item.stairsFirstFlight === 'right';
      const landingCenterX = firstIsRight ? w / 2 - landingW / 2 : -w / 2 + landingW / 2;
      return (
        <group>
          {/* Pianerottolo intermedio */}
          <mesh
            position={[landingCenterX, landingY / 2, -d / 2 + landingD / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[landingW, landingY, landingD]} />
            {mainMat}
          </mesh>
          {/* 1ª rampa inferiore (sale da +Z verso il pianerottolo -Z) */}
          {Array.from({ length: stepsLower }).map((_, i) => {
            const curH = ((i + 1) / (stepsLower + 1)) * landingY;
            const sd = lowerRun / stepsLower;
            const zPos = d / 2 - (i + 0.5) * sd;
            return (
              <mesh
                key={`lo_${i}`}
                position={[landingCenterX, curH / 2, zPos]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[landingW, curH, sd + 0.005]} />
                {mainMat}
              </mesh>
            );
          })}
          {/* 2ª rampa superiore (sale dal pianerottolo verso +X o -X) */}
          {Array.from({ length: stepsUpper }).map((_, i) => {
            const curH = landingY + ((i + 1) / stepsUpper) * (h - landingY);
            const sw = upperRun / stepsUpper;
            const xPos = firstIsRight
              ? w / 2 - landingW - (i + 0.5) * sw
              : -w / 2 + landingW + (i + 0.5) * sw;
            return (
              <mesh
                key={`up_${i}`}
                position={[xPos, curH / 2, -d / 2 + landingD / 2]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[sw + 0.005, curH, landingD]} />
                {mainMat}
              </mesh>
            );
          })}
          {/* Parapetto sul pianerottolo */}
          <mesh position={[landingCenterX, landingY + 0.48, -d / 2 + 0.04]} castShadow>
            <boxGeometry args={[landingW, 0.92, 0.04]} />
            <meshPhysicalMaterial color="#dbeafe" transparent opacity={0.35} roughness={0.15} />
          </mesh>
        </group>
      );
    }

    case 'stairs_u': {
      const landingD = d * 0.35;
      const landingY = h * 0.5;
      const flightW = w * 0.45;
      const runLen = d - landingD;
      const stepsPerFlight = 8;
      const firstIsRight = item.stairsFirstFlight === 'right';
      const firstX = firstIsRight ? w / 2 - flightW / 2 : -w / 2 + flightW / 2;
      const secondX = firstIsRight ? -w / 2 + flightW / 2 : w / 2 - flightW / 2;
      return (
        <group>
          {/* Pianerottolo largo di fondo */}
          <mesh position={[0, landingY / 2, -d / 2 + landingD / 2]} castShadow receiveShadow>
            <boxGeometry args={[w, landingY, landingD]} />
            {mainMat}
          </mesh>
          {/* 1ª rampa (sinistra o destra, sale da +Z a -Z fino al pianerottolo) */}
          {Array.from({ length: stepsPerFlight }).map((_, i) => {
            const curH = ((i + 1) / (stepsPerFlight + 1)) * landingY;
            const sd = runLen / stepsPerFlight;
            const zPos = d / 2 - (i + 0.5) * sd;
            return (
              <mesh
                key={`u1_${i}`}
                position={[firstX, curH / 2, zPos]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[flightW, curH, sd + 0.005]} />
                {mainMat}
              </mesh>
            );
          })}
          {/* 2ª rampa (sale dal pianerottolo -Z verso +Z) */}
          {Array.from({ length: stepsPerFlight }).map((_, i) => {
            const curH = landingY + ((i + 1) / stepsPerFlight) * (h - landingY);
            const sd = runLen / stepsPerFlight;
            const zPos = -d / 2 + landingD + (i + 0.5) * sd;
            return (
              <mesh
                key={`u2_${i}`}
                position={[secondX, curH / 2, zPos]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[flightW, curH, sd + 0.005]} />
                {mainMat}
              </mesh>
            );
          })}
          {/* Ringhiera / parapetto centrale tra le due rampe */}
          <mesh position={[0, landingY + 0.42, landingD / 2]} castShadow>
            <boxGeometry args={[w * 0.06, 0.9, runLen]} />
            <meshStandardMaterial color="#64748b" roughness={0.4} metalness={0.5} />
          </mesh>
        </group>
      );
    }

    default:
      return (
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          {mainMat}
        </mesh>
      );
  }
};

export const FurnitureMesh3D: React.FC<{
  item: Furniture;
  centerX: number;
  centerZ: number;
  walls?: Wall[];
  openings?: Opening[];
}> = ({ item, centerX, centerZ, walls = EMPTY_WALLS, openings = EMPTY_OPENINGS }) => {
  const rotY = (-item.rotation * Math.PI) / 180;

  return (
    <group
      name={`Mobile_${item.name}`}
      position={[item.x - centerX, 0, item.y - centerZ]}
      rotation={[0, rotY, 0]}
    >
      {item.customGlbUrl ? (
        <Suspense fallback={<ProceduralFurniture item={item} walls={walls} openings={openings} />}>
          <CustomGlbModel
            url={item.customGlbUrl}
            width={item.width}
            depth={item.depth}
            height={item.height}
          />
        </Suspense>
      ) : (
        <ProceduralFurniture item={item} walls={walls} openings={openings} />
      )}
    </group>
  );
};

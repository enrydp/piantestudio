/**
 * Generatore procedurale di mobili 3D in Three.js con proporzioni credibili
 * + supporto opzionale per il caricamento di modelli .glb personalizzati.
 */
import React, { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { Furniture, FurnitureMaterial } from '../types/project';
import { getMarbleTexture } from '../utils/proceduralTextures';

function materialProps(mat: FurnitureMaterial): { roughness: number; metalness: number } {
  switch (mat) {
    case 'wood':
      return { roughness: 0.62, metalness: 0.04 };
    case 'marble':
      return { roughness: 0.14, metalness: 0.06 };
    case 'fabric':
      return { roughness: 0.92, metalness: 0.0 };
    case 'leather':
      return { roughness: 0.48, metalness: 0.05 };
    case 'metal':
      return { roughness: 0.28, metalness: 0.78 };
    case 'ceramic':
      return { roughness: 0.16, metalness: 0.08 };
    case 'matte':
    default:
      return { roughness: 0.75, metalness: 0.02 };
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
const ProceduralFurniture: React.FC<{ item: Furniture }> = ({ item }) => {
  const { width: w, depth: d, height: h, color, material, geometryType } = item;
  const mp = materialProps(material);

  const marbleTex = useMemo(
    () => (material === 'marble' ? getMarbleTexture(color) : null),
    [material, color]
  );

  useEffect(() => {
    return () => {
      marbleTex?.dispose();
    };
  }, [marbleTex]);

  const mainMat = marbleTex ? (
    <meshStandardMaterial
      key={`marble_${color}`}
      color="#ffffff"
      map={marbleTex}
      roughness={mp.roughness}
      metalness={mp.metalness}
    />
  ) : (
    <meshStandardMaterial color={color} roughness={mp.roughness} metalness={mp.metalness} />
  );
  const legMat = <meshStandardMaterial color="#3c2f25" roughness={0.6} metalness={0.15} />;
  const chromeMat = <meshStandardMaterial color="#cfd6de" roughness={0.22} metalness={0.85} />;

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

          {/* Pensili superiori lungo il lato principale */}
          <mesh position={[0, h + 0.92, -d / 2 + 0.18]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.72, 0.34]} />
            {mainMat}
          </mesh>
          {/* Pensili laterali solo per cucina ad angolo (non su penisola aperta) */}
          {geometryType === 'kitchen_l' && (
            <mesh
              position={[mx * (-w / 2 + 0.18), h + 0.92, -d / 2 + topD + sideLen / 2]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[0.34, 0.72, sideLen]} />
              {mainMat}
            </mesh>
          )}
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

    case 'sofa_2':
    case 'sofa_3':
    case 'armchair': {
      const legH = 0.08;
      const baseH = h * 0.3;
      const seatH = h * 0.16;
      const backH = h - legH - baseH * 0.5;
      const backD = d * 0.24;
      const armW = Math.min(0.18, w * 0.14);
      const cushions = geometryType === 'sofa_3' ? 3 : geometryType === 'sofa_2' ? 2 : 1;
      const cushionW = (w - armW * 2 - 0.02 * (cushions + 1)) / cushions;

      return (
        <group>
          {/* Struttura base */}
          <mesh position={[0, legH + baseH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, baseH, d]} />
            {mainMat}
          </mesh>
          {/* Schienale */}
          <mesh position={[0, legH + baseH * 0.5 + backH / 2, -d / 2 + backD / 2]} castShadow receiveShadow>
            <boxGeometry args={[w, backH, backD]} />
            {mainMat}
          </mesh>
          {/* Braccioli */}
          <mesh position={[-w / 2 + armW / 2, legH + baseH + h * 0.14, backD * 0.35]} castShadow receiveShadow>
            <boxGeometry args={[armW, h * 0.32, d - backD * 0.7]} />
            {mainMat}
          </mesh>
          <mesh position={[w / 2 - armW / 2, legH + baseH + h * 0.14, backD * 0.35]} castShadow receiveShadow>
            <boxGeometry args={[armW, h * 0.32, d - backD * 0.7]} />
            {mainMat}
          </mesh>
          {/* Cuscini seduta */}
          {Array.from({ length: cushions }).map((_, idx) => {
            const cx = -w / 2 + armW + 0.02 + cushionW / 2 + idx * (cushionW + 0.02);
            return (
              <mesh key={idx} position={[cx, legH + baseH + seatH / 2, backD * 0.45]} castShadow receiveShadow>
                <boxGeometry args={[cushionW, seatH, d - backD - 0.04]} />
                <meshStandardMaterial color={color} roughness={0.95} />
              </mesh>
            );
          })}
          {/* Piedini */}
          {[-w / 2 + 0.08, w / 2 - 0.08].map((lx, i) =>
            [-d / 2 + 0.08, d / 2 - 0.08].map((lz, j) => (
              <mesh key={`${i}_${j}`} position={[lx, legH / 2, lz]} castShadow>
                <cylinderGeometry args={[0.022, 0.018, legH, 8]} />
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
      const topT = 0.045;
      const legH = h - topT;
      const legR = geometryType === 'coffee_table' ? 0.022 : 0.028;
      return (
        <group>
          <mesh position={[0, h - topT / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, topT, d]} />
            {mainMat}
          </mesh>
          {[-w / 2 + 0.07, w / 2 - 0.07].map((lx, i) =>
            [-d / 2 + 0.07, d / 2 - 0.07].map((lz, j) => (
              <mesh key={`${i}_${j}`} position={[lx, legH / 2, lz]} castShadow>
                <boxGeometry args={[legR * 2, legH, legR * 2]} />
                {legMat}
              </mesh>
            ))
          )}
          {geometryType === 'desk' && (
            <mesh position={[w / 2 - 0.22, legH / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.38, legH - 0.04, d - 0.08]} />
              {mainMat}
            </mesh>
          )}
        </group>
      );
    }

    case 'chair': {
      const seatY = h * 0.52;
      const seatT = 0.04;
      return (
        <group>
          <mesh position={[0, seatY, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, seatT, d]} />
            {mainMat}
          </mesh>
          {/* Schienale */}
          <mesh position={[0, seatY + (h - seatY) / 2, -d / 2 + 0.025]} castShadow receiveShadow>
            <boxGeometry args={[w, h - seatY, 0.04]} />
            {mainMat}
          </mesh>
          {/* 4 gambe */}
          {[-w / 2 + 0.04, w / 2 - 0.04].map((lx, i) =>
            [-d / 2 + 0.04, d / 2 - 0.04].map((lz, j) => (
              <mesh key={`${i}_${j}`} position={[lx, seatY / 2, lz]} castShadow>
                <cylinderGeometry args={[0.018, 0.015, seatY, 8]} />
                {legMat}
              </mesh>
            ))
          )}
        </group>
      );
    }

    case 'tv_stand': {
      const tvW = Math.min(w * 0.78, 1.35);
      const tvH = tvW * 0.56;
      return (
        <group>
          {/* Mobile basso */}
          <mesh position={[0, h / 2 + 0.04, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h - 0.08, d]} />
            {mainMat}
          </mesh>
          {/* Piedistallo TV */}
          <mesh position={[0, h + 0.06, -d * 0.1]} castShadow>
            <boxGeometry args={[0.32, 0.12, 0.14]} />
            <meshStandardMaterial color="#1e293b" roughness={0.35} metalness={0.5} />
          </mesh>
          {/* Schermo TV */}
          <mesh position={[0, h + 0.1 + tvH / 2, -d * 0.1]} castShadow>
            <boxGeometry args={[tvW, tvH, 0.045]} />
            <meshStandardMaterial color="#0f172a" roughness={0.18} metalness={0.4} />
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
      const bodyH = h - topT;
      return (
        <group>
          {/* Basi */}
          <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, bodyH, d - 0.03]} />
            {mainMat}
          </mesh>
          {/* Piano di lavoro */}
          <mesh position={[0, h - topT / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w + 0.02, topT, d]} />
            <meshStandardMaterial color="#474c52" roughness={0.35} metalness={0.1} />
          </mesh>
          {/* Lavello e piano cottura per cucina lineare */}
          {geometryType === 'kitchen_linear' && (
            <>
              <mesh position={[-w * 0.28, h + 0.005, 0]}>
                <boxGeometry args={[Math.min(0.65, w * 0.25), 0.015, d * 0.68]} />
                {chromeMat}
              </mesh>
              <mesh position={[-w * 0.28, h + 0.14, -d * 0.28]} castShadow>
                <cylinderGeometry args={[0.015, 0.018, 0.28, 10]} />
                {chromeMat}
              </mesh>
              <mesh position={[w * 0.26, h + 0.006, 0]}>
                <boxGeometry args={[Math.min(0.62, w * 0.24), 0.012, d * 0.72]} />
                <meshStandardMaterial color="#181b20" roughness={0.2} metalness={0.5} />
              </mesh>
              {/* Pensili superiori */}
              <mesh position={[0, h + 0.92, -d / 2 + 0.18]} castShadow receiveShadow>
                <boxGeometry args={[w, 0.72, 0.34]} />
                {mainMat}
              </mesh>
            </>
          )}
        </group>
      );
    }

    case 'bed_single':
    case 'bed_double': {
      const frameH = 0.26;
      const mattressH = 0.22;
      const pillows = geometryType === 'bed_double' ? 2 : 1;
      const pillowW = (w - 0.24) / pillows - 0.04;
      return (
        <group>
          {/* Giroletto */}
          <mesh position={[0, frameH / 2 + 0.06, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, frameH, d]} />
            <meshStandardMaterial color="#7d6046" roughness={0.68} />
          </mesh>
          {/* Testata */}
          <mesh position={[0, h / 2, -d / 2 + 0.05]} castShadow receiveShadow>
            <boxGeometry args={[w + 0.04, h, 0.1]} />
            <meshStandardMaterial color="#6e543d" roughness={0.7} />
          </mesh>
          {/* Materasso + coperta */}
          <mesh position={[0, frameH + 0.06 + mattressH / 2, 0.04]} castShadow receiveShadow>
            <boxGeometry args={[w - 0.06, mattressH, d - 0.14]} />
            {mainMat}
          </mesh>
          {/* Copriletto */}
          <mesh position={[0, frameH + 0.08 + mattressH / 2, d * 0.14]} castShadow receiveShadow>
            <boxGeometry args={[w - 0.02, mattressH * 0.96, d * 0.62]} />
            <meshStandardMaterial color={color} roughness={0.92} />
          </mesh>
          {/* Cuscini */}
          {Array.from({ length: pillows }).map((_, i) => (
            <mesh
              key={i}
              position={[
                -w / 2 + 0.14 + pillowW / 2 + i * (pillowW + 0.08),
                frameH + 0.06 + mattressH + 0.06,
                -d / 2 + 0.32,
              ]}
              castShadow
            >
              <boxGeometry args={[pillowW, 0.12, 0.38]} />
              <meshStandardMaterial color="#ffffff" roughness={0.9} />
            </mesh>
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
          <mesh position={[0, h * 0.42, 0]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.92, h * 0.84, d * 0.9]} />
            <meshStandardMaterial color="#d8d3c9" roughness={0.6} />
          </mesh>
          <mesh position={[0, h * 0.89, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h * 0.14, d]} />
            {mainMat}
          </mesh>
          <mesh position={[0, h + 0.08, -d * 0.34]} castShadow>
            <cylinderGeometry args={[0.016, 0.02, 0.16, 10]} />
            {chromeMat}
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
}> = ({ item, centerX, centerZ }) => {
  const rotY = (-item.rotation * Math.PI) / 180;

  return (
    <group
      name={`Mobile_${item.name}`}
      position={[item.x - centerX, 0, item.y - centerZ]}
      rotation={[0, rotY, 0]}
    >
      {item.customGlbUrl ? (
        <Suspense fallback={<ProceduralFurniture item={item} />}>
          <CustomGlbModel
            url={item.customGlbUrl}
            width={item.width}
            depth={item.depth}
            height={item.height}
          />
        </Suspense>
      ) : (
        <ProceduralFurniture item={item} />
      )}
    </group>
  );
};

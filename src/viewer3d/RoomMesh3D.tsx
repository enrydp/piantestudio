/**
 * Mesh 3D strutturali della casa:
 * - Pavimento con texture procedurale (parquet, piastrelle, cemento) in scala metrica reale
 * - Muri con fori reali generati tramite CSG (three-bvh-csg)
 * - Infissi 3D realistici (porte con telaio, anta semiaperta secondo il verso e maniglia;
 *   finestre e portefinestre con telaio, traverso, davanzale e vetro traslucido)
 */
import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { FloorTextureType, Opening, Wall } from '../types/project';
import { buildWallGeometryWithCSG } from '../utils/csg';
import { getWallsBounds, wallAngleRad, wallLength } from '../utils/geometry';
import { getFloorTexture } from '../utils/proceduralTextures';

interface RoomMesh3DProps {
  walls: Wall[];
  openings: Opening[];
  floorTexture: FloorTextureType;
  floorColor?: string;
  wallColor: string;
  showRoof: boolean;
  showDemolishedWalls?: boolean;
}

const EMPTY_OPENINGS: Opening[] = [];

/** Singolo muro con fori CSG e relativi infissi (memoizzato: non viene toccato al cambio texture pavimento) */
const WallWithOpenings3D: React.FC<{
  wall: Wall;
  openings: Opening[];
  wallColor: string;
  centerX: number;
  centerZ: number;
}> = React.memo(({ wall, openings, wallColor, centerX, centerZ }) => {
  const len = wallLength(wall);
  const angle = wallAngleRad(wall);
  const midX = (wall.start.x + wall.end.x) / 2 - centerX;
  const midZ = (wall.start.y + wall.end.y) / 2 - centerZ;

  // Genera la geometria CSG solo quando cambiano muro o aperture del muro
  const geometry = useMemo(
    () => buildWallGeometryWithCSG(wall, openings),
    [wall, openings]
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <group position={[midX, 0, midZ]} rotation={[0, -angle, 0]}>
      {/* Muro con fori CSG */}
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color={wallColor} roughness={0.86} metalness={0.02} />
      </mesh>

      {/* Infissi per ciascuna apertura */}
      {openings.map((op) => {
        const clampedW = Math.min(op.width, Math.max(0.2, len - 0.08));
        const clampedSill = Math.max(0, Math.min(op.sillHeight, wall.height - 0.25));
        const clampedH = Math.min(op.height, wall.height - clampedSill - 0.04);
        const localX = (op.position - 0.5) * len;

        if (op.type === 'arch') {
          return null;
        }

        const frameThick = 0.055;
        const frameDepth = wall.thickness + 0.025;
        const isDoor = op.type === 'door_internal' || op.type === 'door_entrance';
        const isEntrance = op.type === 'door_entrance';
        const isWindow = op.type === 'window' || op.type === 'french_window';

        if (isDoor) {
          const style = op.doorStyle ?? 'single';
          const leafColor = op.color ?? (isEntrance ? '#4f3524' : '#f4efe6');
          const frameColor = op.color ?? (isEntrance ? '#3e2b1f' : '#e8e2d8');
          const leafW = Math.max(0.2, clampedW - frameThick * 2);
          const leafH = Math.max(0.4, clampedH - frameThick);
          const leafT = 0.042;

          const sideSign = op.swing === 'left_in' || op.swing === 'right_in' ? 1 : -1;
          const hingeLeft = op.swing === 'left_in' || op.swing === 'left_out';
          const hingeX = hingeLeft ? -leafW / 2 : leafW / 2;
          const hingeZ = sideSign * (wall.thickness / 2 - 0.02);

          const openAngle = 0.48 * (hingeLeft ? -sideSign : sideSign);
          const leafOffsetX = hingeLeft ? leafW / 2 : -leafW / 2;
          const handleOffsetX = hingeLeft ? leafW - 0.08 : -(leafW - 0.08);

          return (
            <group key={op.id} position={[localX, clampedSill, 0]}>
              {/* Stipite sinistro */}
              <mesh
                position={[-clampedW / 2 + frameThick / 2, clampedH / 2, 0]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[frameThick, clampedH, frameDepth]} />
                <meshStandardMaterial color={frameColor} roughness={0.6} />
              </mesh>
              {/* Stipite destro */}
              <mesh
                position={[clampedW / 2 - frameThick / 2, clampedH / 2, 0]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[frameThick, clampedH, frameDepth]} />
                <meshStandardMaterial color={frameColor} roughness={0.6} />
              </mesh>
              {/* Architrave */}
              <mesh
                position={[0, clampedH - frameThick / 2, 0]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[clampedW, frameThick, frameDepth]} />
                <meshStandardMaterial color={frameColor} roughness={0.6} />
              </mesh>

              {/* Porta scorrevole con binario superiore */}
              {style === 'sliding' && (
                <group position={[0, 0, sideSign * (wall.thickness / 2 + 0.035)]}>
                  <mesh position={[clampedW * 0.25, clampedH + 0.04, 0]} castShadow>
                    <boxGeometry args={[clampedW * 1.8, 0.045, 0.035]} />
                    <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.3} />
                  </mesh>
                  <mesh position={[clampedW * 0.35, leafH / 2, 0]} castShadow receiveShadow>
                    <boxGeometry args={[leafW + 0.06, leafH, leafT]} />
                    <meshStandardMaterial color={leafColor} roughness={0.55} />
                  </mesh>
                  <mesh position={[clampedW * 0.35 - leafW * 0.38, 1.0, sideSign * (leafT / 2 + 0.015)]}>
                    <boxGeometry args={[0.025, 0.22, 0.025]} />
                    <meshStandardMaterial color="#b8bec7" metalness={0.8} roughness={0.25} />
                  </mesh>
                </group>
              )}

              {/* Porta a doppia anta */}
              {style === 'double' && (() => {
                const singleW = leafW / 2 - 0.005;
                return (
                  <>
                    <group position={[-leafW / 2, 0, hingeZ]} rotation={[0, -0.45 * sideSign, 0]}>
                      <mesh position={[singleW / 2, leafH / 2, 0]} castShadow receiveShadow>
                        <boxGeometry args={[singleW, leafH, leafT]} />
                        <meshStandardMaterial color={leafColor} roughness={0.55} />
                      </mesh>
                      <mesh position={[singleW - 0.07, 1.0, leafT / 2 + 0.025]} castShadow>
                        <boxGeometry args={[0.1, 0.022, 0.04]} />
                        <meshStandardMaterial color="#b8bec7" metalness={0.8} roughness={0.25} />
                      </mesh>
                    </group>
                    <group position={[leafW / 2, 0, hingeZ]} rotation={[0, 0.45 * sideSign, 0]}>
                      <mesh position={[-singleW / 2, leafH / 2, 0]} castShadow receiveShadow>
                        <boxGeometry args={[singleW, leafH, leafT]} />
                        <meshStandardMaterial color={leafColor} roughness={0.55} />
                      </mesh>
                      <mesh position={[-(singleW - 0.07), 1.0, leafT / 2 + 0.025]} castShadow>
                        <boxGeometry args={[0.1, 0.022, 0.04]} />
                        <meshStandardMaterial color="#b8bec7" metalness={0.8} roughness={0.25} />
                      </mesh>
                    </group>
                  </>
                );
              })()}

              {/* Porta singola (piena o con pannello vetro) */}
              {(style === 'single' || style === 'glass') && (
                <group position={[hingeX, 0, hingeZ]} rotation={[0, openAngle, 0]}>
                  {style === 'glass' ? (
                    <>
                      {/* Cornice porta a vetro */}
                      <mesh position={[leafOffsetX, 0.25, 0]} castShadow receiveShadow>
                        <boxGeometry args={[leafW, 0.5, leafT]} />
                        <meshStandardMaterial color={leafColor} roughness={0.55} />
                      </mesh>
                      <mesh position={[leafOffsetX, leafH - 0.1, 0]} castShadow receiveShadow>
                        <boxGeometry args={[leafW, 0.2, leafT]} />
                        <meshStandardMaterial color={leafColor} roughness={0.55} />
                      </mesh>
                      <mesh position={[leafOffsetX - leafW / 2 + 0.06, leafH / 2, 0]} castShadow>
                        <boxGeometry args={[0.12, leafH, leafT]} />
                        <meshStandardMaterial color={leafColor} roughness={0.55} />
                      </mesh>
                      <mesh position={[leafOffsetX + leafW / 2 - 0.06, leafH / 2, 0]} castShadow>
                        <boxGeometry args={[0.12, leafH, leafT]} />
                        <meshStandardMaterial color={leafColor} roughness={0.55} />
                      </mesh>
                      {/* Vetro satinato centrale */}
                      <mesh position={[leafOffsetX, 0.5 + (leafH - 0.7) / 2, 0]}>
                        <boxGeometry args={[Math.max(0.15, leafW - 0.24), Math.max(0.3, leafH - 0.7), 0.014]} />
                        <meshPhysicalMaterial
                          color="#d9eef8"
                          transparent
                          opacity={0.42}
                          roughness={0.18}
                        />
                      </mesh>
                    </>
                  ) : (
                    <mesh position={[leafOffsetX, leafH / 2, 0]} castShadow receiveShadow>
                      <boxGeometry args={[leafW, leafH, leafT]} />
                      <meshStandardMaterial color={leafColor} roughness={0.55} />
                    </mesh>
                  )}
                  {/* Maniglia su entrambi i lati */}
                  <mesh position={[handleOffsetX, 1.0, leafT / 2 + 0.025]} castShadow>
                    <boxGeometry args={[0.11, 0.022, 0.04]} />
                    <meshStandardMaterial color="#b8bec7" metalness={0.8} roughness={0.25} />
                  </mesh>
                  <mesh position={[handleOffsetX, 1.0, -(leafT / 2 + 0.025)]} castShadow>
                    <boxGeometry args={[0.11, 0.022, 0.04]} />
                    <meshStandardMaterial color="#b8bec7" metalness={0.8} roughness={0.25} />
                  </mesh>
                </group>
              )}
            </group>
          );
        }

        if (isWindow) {
          const frameColor = op.color ?? '#f1f5f9';
          const innerW = Math.max(0.15, clampedW - frameThick * 2);
          const innerH = Math.max(0.15, clampedH - frameThick * 2);
          const hasCenterMullion = clampedW >= 1.0;

          return (
            <group key={op.id} position={[localX, clampedSill, 0]}>
              {/* Telaio perimetrale */}
              <mesh position={[-clampedW / 2 + frameThick / 2, clampedH / 2, 0]} castShadow>
                <boxGeometry args={[frameThick, clampedH, wall.thickness * 0.65]} />
                <meshStandardMaterial color={frameColor} roughness={0.4} />
              </mesh>
              <mesh position={[clampedW / 2 - frameThick / 2, clampedH / 2, 0]} castShadow>
                <boxGeometry args={[frameThick, clampedH, wall.thickness * 0.65]} />
                <meshStandardMaterial color={frameColor} roughness={0.4} />
              </mesh>
              <mesh position={[0, clampedH - frameThick / 2, 0]} castShadow>
                <boxGeometry args={[clampedW, frameThick, wall.thickness * 0.65]} />
                <meshStandardMaterial color={frameColor} roughness={0.4} />
              </mesh>
              <mesh position={[0, frameThick / 2, 0]} castShadow>
                <boxGeometry args={[clampedW, frameThick, wall.thickness * 0.65]} />
                <meshStandardMaterial color={frameColor} roughness={0.4} />
              </mesh>

              {/* Montante centrale per finestre a doppia anta */}
              {hasCenterMullion && (
                <mesh position={[0, clampedH / 2, 0]} castShadow>
                  <boxGeometry args={[0.042, innerH, wall.thickness * 0.5]} />
                  <meshStandardMaterial color={frameColor} roughness={0.4} />
                </mesh>
              )}

              {/* Davanzale in pietra per le finestre */}
              {op.type === 'window' && (
                <mesh position={[0, 0.015, 0]} castShadow receiveShadow>
                  <boxGeometry args={[clampedW + 0.06, 0.035, wall.thickness + 0.07]} />
                  <meshStandardMaterial color="#e5e0d8" roughness={0.7} />
                </mesh>
              )}

              {/* Vetro trasparente */}
              <mesh position={[0, clampedH / 2, 0]}>
                <boxGeometry args={[innerW, innerH, 0.014]} />
                <meshPhysicalMaterial
                  color="#cfe9f7"
                  transparent
                  opacity={0.34}
                  roughness={0.08}
                  metalness={0.1}
                  reflectivity={0.85}
                />
              </mesh>
            </group>
          );
        }

        return null;
      })}
    </group>
  );
});

WallWithOpenings3D.displayName = 'WallWithOpenings3D';

/** Soletta pavimento isolata dai muri così il cambio texture/colore agisce esclusivamente sul pavimento */
const FloorSlab3D: React.FC<{
  floorW: number;
  floorD: number;
  floorTexture: FloorTextureType;
  floorColor?: string;
}> = React.memo(({ floorW, floorD, floorTexture, floorColor }) => {
  const floorTex = useMemo(
    () => getFloorTexture(floorTexture, floorW / 1.8, floorD / 1.8, floorColor),
    [floorTexture, floorW, floorD, floorColor]
  );

  useEffect(() => {
    return () => {
      floorTex.dispose();
    };
  }, [floorTex]);

  return (
    <mesh position={[0, -0.02, 0]} receiveShadow>
      <boxGeometry args={[floorW, 0.04, floorD]} />
      <meshStandardMaterial
        key={floorTexture}
        color="#ffffff"
        map={floorTex}
        roughness={floorTexture === 'piastrelle' ? 0.45 : floorTexture === 'parquet' ? 0.6 : 0.78}
        metalness={0.03}
      />
    </mesh>
  );
});

FloorSlab3D.displayName = 'FloorSlab3D';

export const RoomMesh3D: React.FC<RoomMesh3DProps> = ({
  walls,
  openings,
  floorTexture,
  floorColor,
  wallColor,
  showRoof,
  showDemolishedWalls = false,
}) => {
  const bounds = useMemo(() => getWallsBounds(walls), [walls]);
  const activeWalls = useMemo(() => walls.filter((w) => !w.demolished), [walls]);
  const demolishedWalls = useMemo(() => walls.filter((w) => w.demolished), [walls]);
  const floorW = Math.max(2, bounds.width);
  const floorD = Math.max(2, bounds.height);

  // Raggruppa le aperture per muro
  const openingsByWall = useMemo(() => {
    const map = new Map<string, Opening[]>();
    for (const op of openings) {
      const list = map.get(op.wallId) ?? [];
      list.push(op);
      map.set(op.wallId, list);
    }
    return map;
  }, [openings]);

  const maxWallH = useMemo(
    () => walls.reduce((acc, w) => Math.max(acc, w.height), 2.7),
    [walls]
  );

  return (
    <group name="Casa_Struttura">
      {/* Piano terreno esterno di contesto */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#c6d0db" roughness={0.95} />
      </mesh>

      {/* Soletta pavimento dell'abitazione */}
      <FloorSlab3D
        floorW={floorW}
        floorD={floorD}
        floorTexture={floorTexture}
        floorColor={floorColor}
      />

      {/* Muri attivi con fori CSG (i muri abbattuti sono rimossi) */}
      {activeWalls.map((wall) => (
        <WallWithOpenings3D
          key={wall.id}
          wall={wall}
          openings={openingsByWall.get(wall.id) ?? EMPTY_OPENINGS}
          wallColor={wallColor}
          centerX={bounds.centerX}
          centerZ={bounds.centerY}
        />
      ))}

      {/* Traccia opzionale dei muri abbattuti per confronto ristrutturazione */}
      {showDemolishedWalls &&
        demolishedWalls.map((wall) => {
          const len = wallLength(wall);
          const angle = wallAngleRad(wall);
          const midX = (wall.start.x + wall.end.x) / 2 - bounds.centerX;
          const midZ = (wall.start.y + wall.end.y) / 2 - bounds.centerY;
          return (
            <mesh
              key={`ghost_${wall.id}`}
              position={[midX, wall.height / 2, midZ]}
              rotation={[0, -angle, 0]}
            >
              <boxGeometry args={[len, wall.height, wall.thickness]} />
              <meshStandardMaterial
                color="#ef4444"
                transparent
                opacity={0.18}
                depthWrite={false}
              />
            </mesh>
          );
        })}

      {/* Soffitto opzionale (nascosto in vista casa di bambola e dall'alto, visibile in prima persona) */}
      {showRoof && walls.length > 0 && (
        <mesh position={[0, maxWallH + 0.04, 0]} receiveShadow>
          <boxGeometry args={[floorW, 0.08, floorD]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.9} />
        </mesh>
      )}
    </group>
  );
};

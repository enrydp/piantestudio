/**
 * Layer Konva 2D per la visualizzazione, selezione, modifica vertici e tracciatura a polilinea dei muri.
 */
import React from 'react';
import { Circle, Group, Label, Line, Tag, Text } from 'react-konva';
import type { Point2D, Wall } from '../types/project';
import { formatMeters, metersToWorld, pointMetersToWorld } from '../utils/scale';
import { distance2D, wallAngleDeg, wallLength } from '../utils/geometry';

interface WallLayerProps {
  walls: Wall[];
  selectedWallId: string | null;
  isDark: boolean;
  interactive: boolean;
  demolishMode: boolean;
  canEditVertices: boolean;
  wallOpacity?: number;
  draftPoints: Point2D[];
  previewPoint: Point2D | null;
  snappedVertex: Point2D | null;
  defaultWallThickness: number;
  onSelectWall: (id: string) => void;
  onToggleDemolishWall: (id: string) => void;
  onVertexDragStart: () => void;
  onVertexDragMove: (wallId: string, endpoint: 'start' | 'end', posMeters: Point2D) => void;
  onVertexDragEnd: () => void;
}

export const WallLayer: React.FC<WallLayerProps> = ({
  walls,
  selectedWallId,
  isDark,
  interactive,
  demolishMode,
  canEditVertices,
  wallOpacity = 1,
  draftPoints,
  previewPoint,
  snappedVertex,
  defaultWallThickness,
  onSelectWall,
  onToggleDemolishWall,
  onVertexDragStart,
  onVertexDragMove,
  onVertexDragEnd,
}) => {
  const [hoveredWallId, setHoveredWallId] = React.useState<string | null>(null);
  const wallFill = isDark ? '#cbd5e1' : '#1e293b';
  const wallSelectedFill = '#2563eb';
  const labelBg = isDark ? '#0f172a' : '#ffffff';
  const labelText = isDark ? '#e2e8f0' : '#0f172a';
  const labelBorder = isDark ? '#334155' : '#cbd5e1';

  return (
    <Group>
      {/* Muri tracciati */}
      {walls.map((wall) => {
        const p1 = pointMetersToWorld(wall.start);
        const p2 = pointMetersToWorld(wall.end);
        const isSelected = wall.id === selectedWallId;
        const isDemolished = Boolean(wall.demolished);
        const isHoveredDemolish = demolishMode && hoveredWallId === wall.id;
        const strokeW = Math.max(4, metersToWorld(wall.thickness));
        const len = wallLength(wall);
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        // Calcola offset perpendicolare per l'etichetta lunghezza
        const angleRad = (wallAngleDeg(wall) * Math.PI) / 180;
        const nx = -Math.sin(angleRad);
        const ny = Math.cos(angleRad);
        const labelOffset = strokeW / 2 + 16;

        const handleWallClick = (e: { cancelBubble: boolean }) => {
          if (!interactive) return;
          e.cancelBubble = true;
          if (demolishMode) {
            onToggleDemolishWall(wall.id);
          } else {
            onSelectWall(wall.id);
          }
        };

        return (
          <Group key={wall.id}>
            {/* Corpo del muro (pieno o abbattuto tratteggiato rosso) */}
            {isDemolished ? (
              <>
                <Line
                  points={[p1.x, p1.y, p2.x, p2.y]}
                  stroke={isHoveredDemolish ? '#10b981' : '#ef4444'}
                  strokeWidth={strokeW}
                  opacity={isSelected ? 0.32 : 0.16}
                  lineCap="square"
                  hitStrokeWidth={Math.max(strokeW + 10, 22)}
                  listening={interactive}
                  onMouseEnter={() => demolishMode && setHoveredWallId(wall.id)}
                  onMouseLeave={() => setHoveredWallId((curr) => (curr === wall.id ? null : curr))}
                  onClick={handleWallClick}
                  onTap={handleWallClick}
                />
                <Line
                  points={[p1.x, p1.y, p2.x, p2.y]}
                  stroke={isHoveredDemolish ? '#059669' : isSelected ? '#2563eb' : '#dc2626'}
                  strokeWidth={2.5}
                  dash={[10, 7]}
                  listening={false}
                />
              </>
            ) : (
              <>
                <Line
                  points={[p1.x, p1.y, p2.x, p2.y]}
                  stroke={
                    isHoveredDemolish
                      ? '#dc2626'
                      : isSelected
                        ? wallSelectedFill
                        : wallFill
                  }
                  strokeWidth={strokeW}
                  opacity={
                    isSelected || isHoveredDemolish
                      ? Math.max(wallOpacity, 0.72)
                      : wallOpacity
                  }
                  lineCap="square"
                  hitStrokeWidth={Math.max(strokeW + 10, 22)}
                  listening={interactive}
                  onMouseEnter={() => demolishMode && setHoveredWallId(wall.id)}
                  onMouseLeave={() => setHoveredWallId((curr) => (curr === wall.id ? null : curr))}
                  onClick={handleWallClick}
                  onTap={handleWallClick}
                />
                {/* Linea guida sottile lungo l'asse del muro quando i muri sono sfumati */}
                {wallOpacity < 0.85 && !isSelected && !isHoveredDemolish && (
                  <Line
                    points={[p1.x, p1.y, p2.x, p2.y]}
                    stroke={isDark ? '#94a3b8' : '#334155'}
                    strokeWidth={1.2}
                    opacity={Math.min(0.6, wallOpacity + 0.2)}
                    dash={[6, 5]}
                    listening={false}
                  />
                )}
              </>
            )}

            {/* Asse centrale sottile sul muro selezionato */}
            {isSelected && !isDemolished && (
              <Line
                points={[p1.x, p1.y, p2.x, p2.y]}
                stroke="#93c5fd"
                strokeWidth={2}
                dash={[6, 4]}
                listening={false}
              />
            )}

            {/* Etichetta misura in metri (o badge Abbattuto) */}
            {len >= 0.2 && (
              <Label
                x={midX + nx * labelOffset}
                y={midY + ny * labelOffset}
                offsetX={isDemolished ? 34 : 24}
                offsetY={10}
                opacity={isSelected || isDemolished ? 1 : wallOpacity < 0.85 ? 0.65 : 1}
                listening={false}
              >
                <Tag
                  fill={isDemolished ? '#dc2626' : isSelected ? '#2563eb' : labelBg}
                  stroke={isDemolished ? '#991b1b' : isSelected ? '#1d4ed8' : labelBorder}
                  strokeWidth={1}
                  cornerRadius={4}
                />
                <Text
                  text={isDemolished ? `Abbattuto (${formatMeters(len)})` : formatMeters(len)}
                  fontSize={11}
                  fontStyle="600"
                  fill={isDemolished || isSelected ? '#ffffff' : labelText}
                  padding={4}
                />
              </Label>
            )}

            {/* Maniglie vertici spostabili nello Step 0 */}
            {canEditVertices && isSelected && (
              <>
                {(['start', 'end'] as const).map((ep) => {
                  const pt = ep === 'start' ? p1 : p2;
                  return (
                    <Circle
                      key={`${wall.id}_${ep}`}
                      x={pt.x}
                      y={pt.y}
                      radius={7}
                      fill="#ffffff"
                      stroke="#2563eb"
                      strokeWidth={3}
                      draggable
                      onDragStart={(e) => {
                        e.cancelBubble = true;
                        onVertexDragStart();
                      }}
                      onDragMove={(e) => {
                        e.cancelBubble = true;
                        const node = e.target;
                        onVertexDragMove(wall.id, ep, {
                          x: node.x() / 100,
                          y: node.y() / 100,
                        });
                      }}
                      onDragEnd={(e) => {
                        e.cancelBubble = true;
                        onVertexDragEnd();
                      }}
                    />
                  );
                })}
              </>
            )}
          </Group>
        );
      })}

      {/* Anteprima polilinea in corso di tracciatura */}
      {draftPoints.length > 0 && previewPoint && (
        <Group listening={false}>
          {(() => {
            const last = draftPoints[draftPoints.length - 1];
            const p1 = pointMetersToWorld(last);
            const p2 = pointMetersToWorld(previewPoint);
            const len = distance2D(last, previewPoint);
            return (
              <>
                <Line
                  points={[p1.x, p1.y, p2.x, p2.y]}
                  stroke="#3b82f6"
                  strokeWidth={Math.max(4, metersToWorld(defaultWallThickness))}
                  opacity={0.45}
                  lineCap="square"
                />
                <Line
                  points={[p1.x, p1.y, p2.x, p2.y]}
                  stroke="#2563eb"
                  strokeWidth={2}
                  dash={[8, 5]}
                />
                <Circle x={p1.x} y={p1.y} radius={5} fill="#2563eb" />
                <Circle x={p2.x} y={p2.y} radius={5} fill="#ffffff" stroke="#2563eb" strokeWidth={2} />
                {len > 0.05 && (
                  <Label x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 18}>
                    <Tag fill="#1d4ed8" cornerRadius={4} />
                    <Text
                      text={formatMeters(len)}
                      fontSize={12}
                      fontStyle="bold"
                      fill="#ffffff"
                      padding={4}
                    />
                  </Label>
                )}
              </>
            );
          })()}
        </Group>
      )}

      {/* Indicatore magnetico di snap su vertice esistente */}
      {snappedVertex && (
        <Circle
          x={metersToWorld(snappedVertex.x)}
          y={metersToWorld(snappedVertex.y)}
          radius={9}
          stroke="#10b981"
          strokeWidth={2.5}
          fill="rgba(16, 185, 129, 0.2)"
          listening={false}
        />
      )}
    </Group>
  );
};

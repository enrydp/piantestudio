/**
 * Layer Konva 2D per porte, finestre, portefinestre e archi.
 * Ogni apertura è automaticamente orientata lungo il muro ospite e trascinabile lungo i muri.
 */
import React from 'react';
import { Arc, Group, Line, Rect, Text } from 'react-konva';
import type { Opening, Point2D, Wall } from '../types/project';
import { OPENING_PRESETS } from '../types/project';
import { metersToWorld, pointMetersToWorld } from '../utils/scale';
import { getOpeningCenter, wallAngleDeg } from '../utils/geometry';

interface OpeningLayerProps {
  walls: Wall[];
  openings: Opening[];
  selectedOpeningId: string | null;
  interactive: boolean;
  isDark: boolean;
  onSelectOpening: (id: string) => void;
  onOpeningDragStart: () => void;
  onOpeningDragMove: (opening: Opening, pointerMeters: Point2D) => void;
  onOpeningDragEnd: () => void;
}

export const OpeningLayer: React.FC<OpeningLayerProps> = ({
  walls,
  openings,
  selectedOpeningId,
  interactive,
  isDark,
  onSelectOpening,
  onOpeningDragStart,
  onOpeningDragMove,
  onOpeningDragEnd,
}) => {
  const wallMap = new Map(walls.map((w) => [w.id, w]));
  const cutoutFill = isDark ? '#0f172a' : '#f8fafc';

  return (
    <Group>
      {openings.map((op) => {
        const wall = wallMap.get(op.wallId);
        if (!wall || wall.demolished) return null;

        const centerMeters = getOpeningCenter(op, wall);
        const center = pointMetersToWorld(centerMeters);
        const angleDeg = wallAngleDeg(wall);
        const wPx = metersToWorld(op.width);
        const tPx = Math.max(8, metersToWorld(wall.thickness));
        const isSelected = op.id === selectedOpeningId;

        const isDoor = op.type === 'door_internal' || op.type === 'door_entrance';
        const isWindow = op.type === 'window' || op.type === 'french_window';
        const isArch = op.type === 'arch';

        // Calcolo geometria arco di apertura porta
        const sideSign = op.swing === 'left_in' || op.swing === 'right_in' ? 1 : -1;
        const hingeLeft = op.swing === 'left_in' || op.swing === 'left_out';
        const hingeX = hingeLeft ? -wPx / 2 : wPx / 2;
        const hingeY = sideSign * (tPx / 2);

        // Angolo di partenza arco in Konva (0 = +X, 90 = +Y)
        let arcRotation = 0;
        if (hingeLeft && sideSign === 1) arcRotation = 0;
        if (!hingeLeft && sideSign === 1) arcRotation = 90;
        if (!hingeLeft && sideSign === -1) arcRotation = 180;
        if (hingeLeft && sideSign === -1) arcRotation = 270;

        const doorLeafEndY = hingeY + sideSign * wPx;

        return (
          <Group
            key={op.id}
            x={center.x}
            y={center.y}
            rotation={angleDeg}
            draggable={interactive}
            listening={interactive}
            onClick={(e) => {
              if (!interactive) return;
              e.cancelBubble = true;
              onSelectOpening(op.id);
            }}
            onTap={(e) => {
              if (!interactive) return;
              e.cancelBubble = true;
              onSelectOpening(op.id);
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              onSelectOpening(op.id);
              onOpeningDragStart();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const stage = e.target.getStage();
              const layer = e.target.getLayer();
              if (!stage || !layer) return;
              const transform = layer.getAbsoluteTransform().copy().invert();
              const pointer = stage.getPointerPosition();
              if (!pointer) return;
              const worldPt = transform.point(pointer);
              onOpeningDragMove(op, { x: worldPt.x / 100, y: worldPt.y / 100 });
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              // Riallinea il nodo Konva alla posizione reale agganciata sul muro
              const latestCenter = pointMetersToWorld(getOpeningCenter(op, wall));
              e.target.position(latestCenter);
              onOpeningDragEnd();
            }}
          >
            {/* Foro visivo sul muro */}
            <Rect
              x={-wPx / 2}
              y={-tPx / 2 - 1}
              width={wPx}
              height={tPx + 2}
              fill={cutoutFill}
              stroke={isSelected ? '#2563eb' : isDoor ? '#b45309' : isWindow ? '#0284c7' : '#7c3aed'}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />

            {/* Simbolo porta (battente singola, doppia anta, scorrevole, con vetro) */}
            {isDoor && (() => {
              const style = op.doorStyle ?? 'single';
              const doorStroke = op.type === 'door_entrance' ? '#7c2d12' : '#b45309';

              if (style === 'sliding') {
                const trackY = sideSign * (tPx / 2 + 4);
                return (
                  <>
                    {/* Binario porta scorrevole */}
                    <Line
                      points={[-wPx / 2 - 8, trackY, wPx / 2 + 8, trackY]}
                      stroke="#64748b"
                      strokeWidth={1.8}
                      dash={[4, 3]}
                      listening={false}
                    />
                    {/* Pannello scorrevole semiaperto */}
                    <Rect
                      x={-wPx * 0.15}
                      y={trackY - 3}
                      width={wPx * 0.92}
                      height={6}
                      cornerRadius={2}
                      fill={op.color ?? '#d97706'}
                      stroke={doorStroke}
                      strokeWidth={1.5}
                      listening={false}
                    />
                  </>
                );
              }

              if (style === 'double') {
                const halfW = wPx / 2;
                const leftArcRot = sideSign === 1 ? 0 : 270;
                const rightArcRot = sideSign === 1 ? 90 : 180;
                return (
                  <>
                    {/* Anta sinistra + arco */}
                    <Line
                      points={[-halfW, hingeY, -halfW, hingeY + sideSign * halfW]}
                      stroke={doorStroke}
                      strokeWidth={3.5}
                      lineCap="round"
                    />
                    <Arc
                      x={-halfW}
                      y={hingeY}
                      innerRadius={halfW - 1}
                      outerRadius={halfW}
                      angle={90}
                      rotation={leftArcRot}
                      stroke={isSelected ? '#2563eb' : '#d97706'}
                      strokeWidth={1.4}
                      dash={[5, 4]}
                      listening={false}
                    />
                    <Arc
                      x={-halfW}
                      y={hingeY}
                      innerRadius={0}
                      outerRadius={halfW}
                      angle={90}
                      rotation={leftArcRot}
                      fill="rgba(245, 158, 11, 0.08)"
                      listening={false}
                    />
                    {/* Anta destra + arco */}
                    <Line
                      points={[halfW, hingeY, halfW, hingeY + sideSign * halfW]}
                      stroke={doorStroke}
                      strokeWidth={3.5}
                      lineCap="round"
                    />
                    <Arc
                      x={halfW}
                      y={hingeY}
                      innerRadius={halfW - 1}
                      outerRadius={halfW}
                      angle={90}
                      rotation={rightArcRot}
                      stroke={isSelected ? '#2563eb' : '#d97706'}
                      strokeWidth={1.4}
                      dash={[5, 4]}
                      listening={false}
                    />
                    <Arc
                      x={halfW}
                      y={hingeY}
                      innerRadius={0}
                      outerRadius={halfW}
                      angle={90}
                      rotation={rightArcRot}
                      fill="rgba(245, 158, 11, 0.08)"
                      listening={false}
                    />
                  </>
                );
              }

              return (
                <>
                  <Line
                    points={[hingeX, hingeY, hingeX, doorLeafEndY]}
                    stroke={style === 'glass' ? '#0284c7' : doorStroke}
                    strokeWidth={op.type === 'door_entrance' ? 5 : 3.5}
                    lineCap="round"
                  />
                  <Arc
                    x={hingeX}
                    y={hingeY}
                    innerRadius={wPx - 1}
                    outerRadius={wPx}
                    angle={90}
                    rotation={arcRotation}
                    stroke={isSelected ? '#2563eb' : style === 'glass' ? '#0284c7' : '#d97706'}
                    strokeWidth={1.5}
                    dash={[5, 4]}
                    listening={false}
                  />
                  <Arc
                    x={hingeX}
                    y={hingeY}
                    innerRadius={0}
                    outerRadius={wPx}
                    angle={90}
                    rotation={arcRotation}
                    fill={style === 'glass' ? 'rgba(14, 165, 233, 0.08)' : 'rgba(245, 158, 11, 0.08)'}
                    listening={false}
                  />
                </>
              );
            })()}

            {/* Simbolo finestra / portafinestra */}
            {isWindow && (
              <>
                <Rect
                  x={-wPx / 2 + 2}
                  y={-tPx * 0.25}
                  width={Math.max(4, wPx - 4)}
                  height={tPx * 0.5}
                  fill="#bae6fd"
                  stroke="#0284c7"
                  strokeWidth={1.5}
                />
                <Line
                  points={[-wPx / 2 + 2, 0, wPx / 2 - 2, 0]}
                  stroke="#0369a1"
                  strokeWidth={op.type === 'french_window' ? 2.2 : 1.4}
                />
                {op.type === 'french_window' && (
                  <Line
                    points={[0, -tPx / 2, 0, tPx / 2]}
                    stroke="#0369a1"
                    strokeWidth={2}
                  />
                )}
              </>
            )}

            {/* Simbolo arco / apertura libera */}
            {isArch && (
              <>
                <Line
                  points={[-wPx / 2, -tPx / 2, wPx / 2, -tPx / 2]}
                  stroke="#7c3aed"
                  strokeWidth={1.5}
                  dash={[4, 4]}
                />
                <Line
                  points={[-wPx / 2, tPx / 2, wPx / 2, tPx / 2]}
                  stroke="#7c3aed"
                  strokeWidth={1.5}
                  dash={[4, 4]}
                />
              </>
            )}

            {/* Etichetta compatta solo quando selezionata */}
            {isSelected && (
              <Text
                x={-wPx / 2}
                y={-tPx / 2 - 18}
                width={wPx}
                align="center"
                text={`${OPENING_PRESETS[op.type].shortLabel} ${Math.round(op.width * 100)}×${Math.round(op.height * 100)}`}
                fontSize={10}
                fontStyle="bold"
                fill="#2563eb"
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
};

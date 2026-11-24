/**
 * Layer Konva 2D per i mobili:
 * - Disegno planimetrico riconoscibile per ogni categoria/tipologia
 * - Drag & drop con snap griglia e snap muri
 * - Maniglia grafica di rotazione sull'elemento selezionato
 * - Avviso visivo rosso in caso di sovrapposizione con altro mobile o blocco porta
 * - Supporto selezione multipla
 */
import React from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { Furniture, Point2D } from '../types/project';
import { metersToWorld, pointMetersToWorld } from '../utils/scale';

interface FurnitureLayerProps {
  furniture: Furniture[];
  selectedIds: string[];
  conflicts: Record<string, string>;
  interactive: boolean;
  isDark: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onDragStart: () => void;
  onDragMove: (item: Furniture, newCenterMeters: Point2D) => void;
  onDragEnd: () => void;
  onRotateStart: () => void;
  onRotateMove: (id: string, newRotationDeg: number) => void;
  onRotateEnd: () => void;
}

const L_SHAPED_TYPES = new Set([
  'kitchen_l',
  'kitchen_peninsula',
  'sofa_l',
  'wardrobe_corner',
]);

/** Calcola i punti del poligono a L in coordinate locali (-w/2..w/2, -d/2..d/2) */
function getLShapePoints(
  w: number,
  d: number,
  topDepth: number,
  sideWidth: number,
  mirrored: boolean
): number[] {
  const hw = w / 2;
  const hd = d / 2;
  if (!mirrored) {
    // Ala verticale a SINISTRA
    return [
      -hw, -hd,
      hw, -hd,
      hw, -hd + topDepth,
      -hw + sideWidth, -hd + topDepth,
      -hw + sideWidth, hd,
      -hw, hd,
    ];
  }
  // Ala verticale a DESTRA
  return [
    -hw, -hd,
    hw, -hd,
    hw, hd,
    hw - sideWidth, hd,
    hw - sideWidth, -hd + topDepth,
    -hw, -hd + topDepth,
  ];
}

/** Disegna dettagli planimetrici 2D specifici per ciascun tipo di mobile */
const FurniturePlanDetail: React.FC<{
  item: Furniture;
  w: number;
  d: number;
  stroke: string;
}> = ({ item, w, d, stroke }) => {
  const hw = w / 2;
  const hd = d / 2;
  const t = item.geometryType;
  const mirrored = Boolean(item.mirrored);

  if (t === 'sofa_l') {
    const topD = Math.min(d * 0.52, Math.max(40, d * 0.5));
    const sideW = Math.min(w * 0.4, Math.max(40, w * 0.36));
    const backD = Math.min(topD * 0.24, 18);
    const armW = 12;
    return (
      <Group scaleX={mirrored ? -1 : 1}>
        {/* Schienale lungo in alto */}
        <Rect x={-hw} y={-hd} width={w} height={backD} fill="rgba(0,0,0,0.16)" stroke={stroke} strokeWidth={1} />
        {/* Bracciolo sinistro + destro */}
        <Rect x={-hw} y={-hd + backD} width={armW} height={d - backD} fill="rgba(0,0,0,0.12)" stroke={stroke} strokeWidth={1} />
        <Rect x={hw - armW} y={-hd + backD} width={armW} height={topD - backD} fill="rgba(0,0,0,0.12)" stroke={stroke} strokeWidth={1} />
        {/* Divisioni cuscini */}
        <Line points={[-hw + sideW, -hd + backD, -hw + sideW, -hd + topD]} stroke={stroke} strokeWidth={1} opacity={0.65} />
        <Line points={[-hw + sideW + (w - sideW - armW) / 2, -hd + backD, -hw + sideW + (w - sideW - armW) / 2, -hd + topD]} stroke={stroke} strokeWidth={1} opacity={0.65} />
        <Line points={[-hw + armW, -hd + topD, -hw + sideW, -hd + topD]} stroke={stroke} strokeWidth={1} opacity={0.55} />
      </Group>
    );
  }

  if (t === 'kitchen_l' || t === 'kitchen_peninsula') {
    const topD = Math.min(d * 0.42, 68);
    const sideW = t === 'kitchen_peninsula' ? Math.min(w * 0.34, 72) : Math.min(w * 0.36, 68);
    const sinkW = Math.min(w * 0.24, 52);
    const hobW = Math.min(sideW - 14, 44);
    const hobH = Math.min((d - topD) * 0.42, 48);
    return (
      <Group scaleX={mirrored ? -1 : 1}>
        {/* Lavello sul lato superiore */}
        <Rect
          x={hw - sinkW - 18}
          y={-hd + 8}
          width={sinkW}
          height={Math.max(18, topD - 16)}
          cornerRadius={3}
          stroke={stroke}
          strokeWidth={1.2}
          fill="rgba(255,255,255,0.5)"
        />
        {/* Piano cottura con 4 fuochi sul lato ad angolo / penisola */}
        <Rect
          x={-hw + (sideW - hobW) / 2}
          y={-hd + topD + 14}
          width={Math.max(16, hobW)}
          height={Math.max(18, hobH)}
          cornerRadius={2}
          stroke={stroke}
          strokeWidth={1.2}
          fill="rgba(15,23,42,0.18)"
        />
        {[0.32, 0.68].map((fx, i) =>
          [0.32, 0.68].map((fy, j) => (
            <Circle
              key={`${i}_${j}`}
              x={-hw + (sideW - hobW) / 2 + Math.max(16, hobW) * fx}
              y={-hd + topD + 14 + Math.max(18, hobH) * fy}
              radius={4.5}
              stroke={stroke}
              strokeWidth={1}
            />
          ))
        )}
        {/* Linea giunzione angolo */}
        <Line points={[-hw + sideW, -hd, -hw + sideW, -hd + topD]} stroke={stroke} strokeWidth={0.9} dash={[4, 3]} opacity={0.5} />
        {/* Sgabelli indicativi sul bordo esterno per cucina con penisola */}
        {t === 'kitchen_peninsula' &&
          [0.35, 0.72].map((r, idx) => (
            <Circle
              key={`st_${idx}`}
              x={-hw + sideW + 10}
              y={-hd + topD + (d - topD) * r}
              radius={8}
              stroke={stroke}
              strokeWidth={1.1}
              fill="rgba(255,255,255,0.45)"
            />
          ))}
      </Group>
    );
  }

  if (t === 'wardrobe_corner') {
    const topD = Math.min(d * 0.45, 62);
    const sideW = Math.min(w * 0.35, 62);
    return (
      <Group scaleX={mirrored ? -1 : 1}>
        <Line points={[-hw + sideW, -hd + topD - 4, hw - 4, -hd + topD - 4]} stroke={stroke} strokeWidth={1.2} dash={[6, 4]} opacity={0.7} />
        <Line points={[-hw + sideW - 4, -hd + topD, -hw + sideW - 4, hd - 4]} stroke={stroke} strokeWidth={1.2} dash={[6, 4]} opacity={0.7} />
        <Line points={[-hw, -hd, -hw + sideW, -hd + topD]} stroke={stroke} strokeWidth={1} opacity={0.5} />
      </Group>
    );
  }

  if (t === 'fridge') {
    return (
      <>
        <Line points={[-hw + 4, hd - 6, hw - 4, hd - 6]} stroke={stroke} strokeWidth={2} />
        <Line points={[-hw + 10, -hd + 10, hw - 10, hd - 14]} stroke={stroke} strokeWidth={1} opacity={0.35} />
        <Line points={[hw - 10, -hd + 10, -hw + 10, hd - 14]} stroke={stroke} strokeWidth={1} opacity={0.35} />
      </>
    );
  }

  if (t === 'sideboard') {
    return (
      <>
        <Line points={[-w / 6, -hd, -w / 6, hd]} stroke={stroke} strokeWidth={1} opacity={0.55} />
        <Line points={[w / 6, -hd, w / 6, hd]} stroke={stroke} strokeWidth={1} opacity={0.55} />
        <Line points={[-hw + 6, hd - 4, hw - 6, hd - 4]} stroke={stroke} strokeWidth={1.4} opacity={0.6} />
      </>
    );
  }

  if (t === 'rug') {
    return (
      <Rect
        x={-hw + 8}
        y={-hd + 8}
        width={Math.max(10, w - 16)}
        height={Math.max(10, d - 16)}
        cornerRadius={2}
        stroke={stroke}
        strokeWidth={1}
        dash={[6, 4]}
        opacity={0.55}
      />
    );
  }

  if (t === 'dining_table_round') {
    return (
      <Circle
        x={0}
        y={0}
        radius={Math.max(6, Math.min(hw, hd) * 0.72)}
        stroke={stroke}
        strokeWidth={1}
        opacity={0.45}
      />
    );
  }

  if (t === 'bed_bunk') {
    const pillowH = Math.min(d * 0.18, 30);
    return (
      <>
        <Rect x={-hw} y={-hd} width={w} height={8} fill="rgba(0,0,0,0.22)" />
        <Rect x={-hw + 8} y={-hd + 12} width={Math.max(10, w - 16)} height={pillowH} cornerRadius={4} fill="#ffffff" opacity={0.85} stroke={stroke} strokeWidth={1} />
        <Line points={[-hw, -hd + pillowH + 22, hw, -hd + pillowH + 22]} stroke={stroke} strokeWidth={1.2} />
        {/* Scaletta laterale */}
        <Rect x={hw - 10} y={0} width={10} height={Math.min(46, d * 0.25)} fill="rgba(0,0,0,0.22)" stroke={stroke} strokeWidth={1} />
      </>
    );
  }

  if (t === 'bidet') {
    return (
      <>
        <Circle x={0} y={4} radius={Math.min(w, d) * 0.34} stroke={stroke} strokeWidth={1.2} fill="#ffffff" />
        <Circle x={0} y={-d * 0.26} radius={3.5} fill={stroke} />
      </>
    );
  }

  if (t === 'bathroom_vanity') {
    const basinW = Math.max(12, w * 0.34);
    const basinH = Math.max(10, d - 16);
    return (
      <>
        <Rect x={-hw + w * 0.09} y={-hd + 8} width={basinW} height={basinH} cornerRadius={8} stroke={stroke} strokeWidth={1.2} fill="rgba(255,255,255,0.65)" />
        <Rect x={hw - w * 0.09 - basinW} y={-hd + 8} width={basinW} height={basinH} cornerRadius={8} stroke={stroke} strokeWidth={1.2} fill="rgba(255,255,255,0.65)" />
      </>
    );
  }

  if (t === 'boiler') {
    return (
      <>
        <Circle x={0} y={0} radius={Math.min(hw, hd) * 0.45} stroke="#0284c7" strokeWidth={1.4} fill="rgba(14,165,233,0.12)" />
        <Line points={[-6, hd - 5, 6, hd - 5]} stroke="#ef4444" strokeWidth={2} />
      </>
    );
  }

  if (t === 'sofa_2' || t === 'sofa_3' || t === 'armchair') {
    const backD = Math.min(d * 0.25, 22);
    const armW = Math.min(w * 0.14, 16);
    const cushions = t === 'sofa_3' ? 3 : t === 'sofa_2' ? 2 : 1;
    const seatW = (w - armW * 2) / cushions;
    return (
      <>
        {/* Schienale */}
        <Rect x={-hw} y={-hd} width={w} height={backD} fill="rgba(0,0,0,0.14)" stroke={stroke} strokeWidth={1} />
        {/* Braccioli */}
        <Rect x={-hw} y={-hd + backD} width={armW} height={d - backD} fill="rgba(0,0,0,0.10)" stroke={stroke} strokeWidth={1} />
        <Rect x={hw - armW} y={-hd + backD} width={armW} height={d - backD} fill="rgba(0,0,0,0.10)" stroke={stroke} strokeWidth={1} />
        {/* Divisione cuscini */}
        {Array.from({ length: cushions - 1 }).map((_, idx) => {
          const lx = -hw + armW + seatW * (idx + 1);
          return (
            <Line
              key={idx}
              points={[lx, -hd + backD, lx, hd]}
              stroke={stroke}
              strokeWidth={1}
              opacity={0.65}
            />
          );
        })}
      </>
    );
  }

  if (t === 'bed_single' || t === 'bed_double') {
    const pillows = t === 'bed_double' ? 2 : 1;
    const pillowW = (w - 14) / pillows - 4;
    const pillowH = Math.min(d * 0.2, 34);
    return (
      <>
        {/* Testata */}
        <Rect x={-hw} y={-hd} width={w} height={8} fill="rgba(0,0,0,0.22)" />
        {/* Cuscini */}
        {Array.from({ length: pillows }).map((_, i) => (
          <Rect
            key={i}
            x={-hw + 7 + i * (pillowW + 6)}
            y={-hd + 12}
            width={Math.max(8, pillowW)}
            height={pillowH}
            cornerRadius={4}
            fill="#ffffff"
            opacity={0.85}
            stroke={stroke}
            strokeWidth={1}
          />
        ))}
        {/* Piumone */}
        <Line points={[-hw, -hd + pillowH + 22, hw, -hd + pillowH + 22]} stroke={stroke} strokeWidth={1.2} />
      </>
    );
  }

  if (t === 'kitchen_linear') {
    const sinkW = Math.min(w * 0.24, 52);
    const hobW = Math.min(w * 0.24, 52);
    return (
      <>
        {/* Lavello */}
        <Rect x={-hw + 12} y={-hd + 8} width={sinkW} height={d - 16} cornerRadius={3} stroke={stroke} strokeWidth={1.2} fill="rgba(255,255,255,0.45)" />
        {/* Piano cottura con 4 fuochi */}
        <Rect x={hw - hobW - 14} y={-hd + 8} width={hobW} height={d - 16} cornerRadius={2} stroke={stroke} strokeWidth={1.2} fill="rgba(15,23,42,0.18)" />
        {[0.3, 0.7].map((fx, i) =>
          [0.32, 0.68].map((fy, j) => (
            <Circle
              key={`${i}_${j}`}
              x={hw - hobW - 14 + hobW * fx}
              y={-hd + 8 + (d - 16) * fy}
              radius={5}
              stroke={stroke}
              strokeWidth={1}
            />
          ))
        )}
      </>
    );
  }

  if (t === 'wc') {
    return (
      <>
        <Rect x={-hw + 2} y={-hd + 2} width={w - 4} height={d * 0.3} cornerRadius={2} stroke={stroke} strokeWidth={1} fill="rgba(0,0,0,0.06)" />
        <Circle x={0} y={d * 0.14} radius={Math.min(w, d) * 0.34} stroke={stroke} strokeWidth={1.2} fill="#ffffff" />
      </>
    );
  }

  if (t === 'sink') {
    return (
      <Rect
        x={-hw + 8}
        y={-hd + 8}
        width={Math.max(8, w - 16)}
        height={Math.max(8, d - 16)}
        cornerRadius={8}
        stroke={stroke}
        strokeWidth={1.2}
        fill="rgba(255,255,255,0.6)"
      />
    );
  }

  if (t === 'shower') {
    return (
      <>
        <Line points={[-hw + 4, -hd + 4, hw - 4, hd - 4]} stroke={stroke} strokeWidth={1} opacity={0.5} />
        <Line points={[hw - 4, -hd + 4, -hw + 4, hd - 4]} stroke={stroke} strokeWidth={1} opacity={0.5} />
        <Circle x={0} y={0} radius={5} stroke={stroke} strokeWidth={1.2} />
      </>
    );
  }

  if (t === 'bathtub') {
    return (
      <Rect
        x={-hw + 8}
        y={-hd + 8}
        width={Math.max(10, w - 16)}
        height={Math.max(10, d - 16)}
        cornerRadius={16}
        stroke={stroke}
        strokeWidth={1.3}
        fill="rgba(255,255,255,0.5)"
      />
    );
  }

  if (t === 'plant') {
    return (
      <Circle
        x={0}
        y={0}
        radius={Math.min(hw, hd) * 0.85}
        fill="#3f7d52"
        stroke="#22543d"
        strokeWidth={1.5}
      />
    );
  }

  if (t === 'tv_stand') {
    return (
      <Rect
        x={-hw + 14}
        y={-4}
        width={Math.max(12, w - 28)}
        height={8}
        cornerRadius={2}
        fill="#0f172a"
      />
    );
  }

  if (t === 'stairs_straight') {
    const steps = 11;
    return (
      <>
        {Array.from({ length: steps }).map((_, i) => {
          const sy = -hd + ((i + 1) / (steps + 1)) * d;
          return (
            <Line
              key={i}
              points={[-hw, sy, hw, sy]}
              stroke={stroke}
              strokeWidth={1}
              opacity={0.7}
            />
          );
        })}
        {/* Freccia direzione salita */}
        <Line points={[0, hd - 10, 0, -hd + 10]} stroke={stroke} strokeWidth={1.6} />
        <Line points={[-6, -hd + 18, 0, -hd + 10, 6, -hd + 18]} stroke={stroke} strokeWidth={1.6} />
      </>
    );
  }

  if (t === 'stairs_l') {
    const landingW = w * 0.48;
    const landingH = d * 0.42;
    const firstIsRight = item.stairsFirstFlight === 'right';
    const landingX = firstIsRight ? hw - landingW : -hw;
    const upperStartX = firstIsRight ? -hw : -hw + landingW;
    const firstCenterX = landingX + landingW / 2;
    const midLandingY = -hd + landingH / 2;
    const endX = firstIsRight ? -hw + 8 : hw - 8;
    return (
      <>
        {/* Pianerottolo in alto (sinistra o destra in base alla 1ª rampa) */}
        <Rect
          x={landingX}
          y={-hd}
          width={landingW}
          height={landingH}
          fill="rgba(255,255,255,0.28)"
          stroke={stroke}
          strokeWidth={1.2}
        />
        {/* Gradini 1ª rampa verticale */}
        {Array.from({ length: 6 }).map((_, i) => {
          const sy = -hd + landingH + ((i + 1) / 7) * (d - landingH);
          return (
            <Line
              key={`v_${i}`}
              points={[landingX, sy, landingX + landingW, sy]}
              stroke={stroke}
              strokeWidth={1}
              opacity={0.75}
            />
          );
        })}
        {/* Gradini 2ª rampa orizzontale */}
        {Array.from({ length: 5 }).map((_, i) => {
          const sx = upperStartX + ((i + 1) / 6) * (w - landingW);
          return (
            <Line
              key={`h_${i}`}
              points={[sx, -hd, sx, -hd + landingH]}
              stroke={stroke}
              strokeWidth={1}
              opacity={0.75}
            />
          );
        })}
        {/* Freccia ad L con pallino inizio (1ª rampa) e punta salita */}
        <Circle x={firstCenterX} y={hd - 8} radius={3.2} fill={stroke} listening={false} />
        <Line
          points={[firstCenterX, hd - 8, firstCenterX, midLandingY, endX, midLandingY]}
          stroke={stroke}
          strokeWidth={1.6}
          listening={false}
        />
        <Line
          points={
            firstIsRight
              ? [endX + 6, midLandingY - 5, endX, midLandingY, endX + 6, midLandingY + 5]
              : [endX - 6, midLandingY - 5, endX, midLandingY, endX - 6, midLandingY + 5]
          }
          stroke={stroke}
          strokeWidth={1.6}
          listening={false}
        />
      </>
    );
  }

  if (t === 'stairs_u') {
    const landingH = d * 0.34;
    const flightW = w * 0.46;
    const firstIsRight = item.stairsFirstFlight === 'right';
    const firstCenterX = firstIsRight ? hw - flightW / 2 : -hw + flightW / 2;
    const secondCenterX = firstIsRight ? -hw + flightW / 2 : hw - flightW / 2;
    return (
      <>
        {/* Pianerottolo superiore */}
        <Rect
          x={-hw}
          y={-hd}
          width={w}
          height={landingH}
          fill="rgba(255,255,255,0.28)"
          stroke={stroke}
          strokeWidth={1.2}
        />
        {/* Evidenziazione leggera della 1ª rampa */}
        <Rect
          x={firstIsRight ? hw - flightW : -hw}
          y={-hd + landingH}
          width={flightW}
          height={d - landingH}
          fill="rgba(255,255,255,0.16)"
          listening={false}
        />
        {/* Divisorio centrale / tromba scale */}
        <Rect
          x={-w * 0.04}
          y={-hd + landingH}
          width={w * 0.08}
          height={d - landingH}
          fill="rgba(0,0,0,0.16)"
          stroke={stroke}
          strokeWidth={1}
        />
        {/* Gradini rampa sinistra e destra */}
        {Array.from({ length: 7 }).map((_, i) => {
          const sy = -hd + landingH + ((i + 1) / 8) * (d - landingH);
          return (
            <React.Fragment key={i}>
              <Line points={[-hw, sy, -hw + flightW, sy]} stroke={stroke} strokeWidth={1} opacity={0.75} />
              <Line points={[hw - flightW, sy, hw, sy]} stroke={stroke} strokeWidth={1} opacity={0.75} />
            </React.Fragment>
          );
        })}
        {/* Freccia a U con pallino di partenza sulla 1ª rampa e punta in uscita sulla 2ª */}
        <Circle x={firstCenterX} y={hd - 8} radius={3.2} fill={stroke} listening={false} />
        <Line
          points={[
            firstCenterX,
            hd - 8,
            firstCenterX,
            -hd + landingH / 2,
            secondCenterX,
            -hd + landingH / 2,
            secondCenterX,
            hd - 8,
          ]}
          stroke={stroke}
          strokeWidth={1.6}
          listening={false}
        />
        <Line
          points={[secondCenterX - 5, hd - 14, secondCenterX, hd - 8, secondCenterX + 5, hd - 14]}
          stroke={stroke}
          strokeWidth={1.6}
          listening={false}
        />
      </>
    );
  }

  return null;
};

export const FurnitureLayer: React.FC<FurnitureLayerProps> = ({
  furniture,
  selectedIds,
  conflicts,
  interactive,
  isDark,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRotateStart,
  onRotateMove,
  onRotateEnd,
}) => {
  const selectedSet = new Set(selectedIds);

  // Disegna sempre i tappeti sotto agli altri mobili così tavoli e divani risultano sopra
  const orderedFurniture = [...furniture].sort((a, b) => {
    const aRug = a.geometryType === 'rug' ? 0 : 1;
    const bRug = b.geometryType === 'rug' ? 0 : 1;
    return aRug - bRug;
  });

  return (
    <Group>
      {orderedFurniture.map((item) => {
        const pos = pointMetersToWorld({ x: item.x, y: item.y });
        const w = Math.max(16, metersToWorld(item.width));
        const d = Math.max(16, metersToWorld(item.depth));
        const isSelected = selectedSet.has(item.id);
        const conflictReason = conflicts[item.id];
        const hasConflict = Boolean(conflictReason);
        const isLShaped = L_SHAPED_TYPES.has(item.geometryType);
        const isRound = item.geometryType === 'plant' || item.geometryType === 'dining_table_round';
        const isRug = item.geometryType === 'rug';

        const lShapePts = isLShaped
          ? getLShapePoints(
              w,
              d,
              item.geometryType === 'sofa_l'
                ? Math.min(d * 0.52, Math.max(40, d * 0.5))
                : item.geometryType === 'wardrobe_corner'
                  ? Math.min(d * 0.45, 62)
                  : Math.min(d * 0.42, 68),
              item.geometryType === 'sofa_l'
                ? Math.min(w * 0.4, Math.max(40, w * 0.36))
                : item.geometryType === 'wardrobe_corner'
                  ? Math.min(w * 0.35, 62)
                  : item.geometryType === 'kitchen_peninsula'
                    ? Math.min(w * 0.34, 72)
                    : Math.min(w * 0.36, 68),
              Boolean(item.mirrored)
            )
          : null;

        const strokeColor = hasConflict
          ? '#dc2626'
          : isSelected
            ? '#2563eb'
            : isDark
              ? '#475569'
              : '#334155';

        const handleOffsetY = -d / 2 - 24;

        return (
          <Group
            key={item.id}
            x={pos.x}
            y={pos.y}
            rotation={item.rotation}
            draggable={interactive}
            listening={interactive}
            onClick={(e) => {
              if (!interactive) return;
              e.cancelBubble = true;
              onSelect(item.id, Boolean(e.evt.shiftKey));
            }}
            onTap={(e) => {
              if (!interactive) return;
              e.cancelBubble = true;
              onSelect(item.id, false);
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              if (!isSelected) {
                onSelect(item.id, false);
              }
              onDragStart();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const node = e.target;
              onDragMove(item, { x: node.x() / 100, y: node.y() / 100 });
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              onDragEnd();
            }}
          >
            {/* Ombra morbida sotto il mobile */}
            {!isRug && (
              isLShaped && lShapePts ? (
                <Line
                  points={lShapePts}
                  x={2}
                  y={3}
                  closed
                  fill="rgba(15, 23, 42, 0.14)"
                  listening={false}
                />
              ) : (
                <Rect
                  x={-w / 2 + 2}
                  y={-d / 2 + 3}
                  width={w}
                  height={d}
                  cornerRadius={isRound ? Math.min(w, d) / 2 : 4}
                  fill="rgba(15, 23, 42, 0.14)"
                  listening={false}
                />
              )
            )}

            {/* Sagoma base */}
            {isLShaped && lShapePts ? (
              <Line
                points={lShapePts}
                closed
                fill={hasConflict ? 'rgba(239, 68, 68, 0.28)' : item.color}
                opacity={hasConflict ? 1 : 0.9}
                stroke={strokeColor}
                strokeWidth={hasConflict || isSelected ? 2.5 : 1.3}
              />
            ) : (
              <Rect
                x={-w / 2}
                y={-d / 2}
                width={w}
                height={d}
                cornerRadius={isRound ? Math.min(w, d) / 2 : 4}
                fill={hasConflict ? 'rgba(239, 68, 68, 0.28)' : item.color}
                opacity={hasConflict ? 1 : isRug ? 0.58 : 0.88}
                stroke={strokeColor}
                strokeWidth={hasConflict || isSelected ? 2.5 : isRug ? 1 : 1.3}
              />
            )}

            {/* Dettaglio architettonico */}
            <FurniturePlanDetail item={item} w={w} d={d} stroke={strokeColor} />

            {/* Indicatore lato frontale */}
            <Line
              points={[-Math.min(10, w * 0.2), d / 2 - 3, Math.min(10, w * 0.2), d / 2 - 3]}
              stroke={strokeColor}
              strokeWidth={1.5}
              opacity={0.5}
              listening={false}
            />

            {/* Etichetta nome mobile */}
            <Text
              x={-w / 2 + 2}
              y={-7}
              width={Math.max(12, w - 4)}
              align="center"
              text={item.name}
              fontSize={Math.max(9, Math.min(11, w / 9))}
              fontStyle="600"
              fill={hasConflict ? '#991b1b' : '#0f172a'}
              listening={false}
              ellipsis
            />

            {/* Maniglia di rotazione quando è selezionato singolarmente */}
            {interactive && isSelected && selectedIds.length === 1 && (
              <Group>
                <Line
                  points={[0, -d / 2, 0, handleOffsetY + 6]}
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  listening={false}
                />
                <Circle
                  x={0}
                  y={handleOffsetY}
                  radius={7}
                  fill="#ffffff"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  draggable
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    onRotateStart();
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
                    const angleRad = Math.atan2(worldPt.y - pos.y, worldPt.x - pos.x);
                    // La maniglia si trova a -90° rispetto a +X
                    let deg = (angleRad * 180) / Math.PI + 90;
                    if (!e.evt.shiftKey) {
                      deg = Math.round(deg / 5) * 5;
                    }
                    deg = ((deg % 360) + 360) % 360;
                    // Mantieni la maniglia ancorata localmente
                    e.target.position({ x: 0, y: handleOffsetY });
                    onRotateMove(item.id, deg);
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    e.target.position({ x: 0, y: handleOffsetY });
                    onRotateEnd();
                  }}
                />
              </Group>
            )}
          </Group>
        );
      })}
    </Group>
  );
};

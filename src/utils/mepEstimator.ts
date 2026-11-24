/**
 * Motore di calcolo deterministico (pre-dimensionamento tecnico) per lo Step 4:
 * - Impianto Elettrico: punti luce, prese, scatole, metri di cavo per sezione (1,5 / 2,5 / 4 / 6 mm²) e corrugato
 * - Impianto Idraulico: rilevamento automatico punti acqua (bagni, cucina, lavatrice), metri di tubi
 *   (Multistrato / PEX / PPR / Rame) per fredda, calda e dorsale + tubi di scarico Ø40/50 e Ø110 mm
 * - Pittura / Vernice: m² netti pareti (sottratte porte e finestre) + soffitto opzionale, litri, kg di vernice,
 *   numero secchi e fissativo/primer
 */
import type { Furniture, Opening, Point2D, ProjectData, Wall } from '../types/project';
import { getOpeningCenter, getWallsBounds, wallLength } from './geometry';
import type { DetectedRoom } from './rooms';

export type CeiLevel = 'livello1' | 'livello2' | 'livello3';
export type PipeMaterial = 'multistrato' | 'pex' | 'ppr' | 'rame';
export type PaintType = 'lavabile' | 'traspirante' | 'smalto_murale';
export type WallSidesMode = 'auto' | 'single' | 'both';

export interface MepConfig {
  // Elettrico
  ceiLevel: CeiLevel;
  panelPosition: Point2D;
  includeInduction: boolean;
  includeAcLine: boolean;
  // Idraulico
  pipeMaterial: PipeMaterial;
  manifoldPosition: Point2D;
  includeHotWater: boolean;
  includeDrains: boolean;
  // Pittura / Vernice
  paintType: PaintType;
  wallSides: WallSidesMode;
  coats: 1 | 2 | 3;
  includeCeiling: boolean;
  includePrimer: boolean;
  yieldSqmPerLiter: number; // resa m²/L per singola mano
  paintDensityKgPerL: number; // densità media kg/L
  bucketKg: 5 | 14 | 20 | 25;
  // Margine sfrido comune (%)
  wastePct: number;
}

export const PIPE_MATERIAL_LABELS: Record<PipeMaterial, { label: string; desc: string }> = {
  multistrato: { label: 'Multistrato (Al-PEX)', desc: 'Standard per impianti idrici moderni (Ø16 / Ø20 mm)' },
  pex: { label: 'PEX reticolato', desc: 'Tubo flessibile sfilabile in guaina (Ø16 / Ø20 mm)' },
  ppr: { label: 'PPR termosaldabile', desc: 'Polipropilene rigido saldato (Ø20 / Ø25 mm)' },
  rame: { label: 'Rame rivestito', desc: 'Tubo in rame cotto/rigido con guaina (Ø14 / Ø18 mm)' },
};

export const PAINT_TYPE_PRESETS: Record<
  PaintType,
  { label: string; defaultYield: number; defaultDensity: number }
> = {
  lavabile: { label: 'Idropittura lavabile', defaultYield: 9, defaultDensity: 1.48 },
  traspirante: { label: 'Idropittura traspirante', defaultYield: 10, defaultDensity: 1.42 },
  smalto_murale: { label: 'Smalto murale ad acqua', defaultYield: 11, defaultDensity: 1.32 },
};

export interface RoomElectricalBreakdown {
  roomId: string;
  roomName: string;
  areaSqm: number;
  lightPoints: number;
  standardOutlets: number;
  dedicatedOutlets: number;
  tvDataPoints: number;
  distanceFromPanelM: number;
}

export interface CableSectionRow {
  sectionMm2: string;
  usage: string;
  conductors: number;
  meters: number;
  recommendedBreaker: string;
}

export interface PlumbingFixtureItem {
  id: string;
  name: string;
  roomName: string;
  x: number;
  y: number;
  needsCold: boolean;
  needsHot: boolean;
  drainDiameterMm: 40 | 50 | 110;
  distanceFromManifoldM: number;
  coldPipeM: number;
  hotPipeM: number;
  drainPipeM: number;
}

export interface MepEstimate {
  totalFloorAreaSqm: number;
  roomCount: number;
  electrical: {
    totalLightPoints: number;
    totalStandardOutlets: number;
    totalDedicatedOutlets: number;
    totalTvDataPoints: number;
    totalOutlets: number;
    boxes503: number;
    junctionBoxes: number;
    cables: CableSectionRow[];
    totalCableMeters: number;
    corrugated20M: number;
    corrugated25M: number;
    byRoom: RoomElectricalBreakdown[];
  };
  plumbing: {
    pipeMaterial: PipeMaterial;
    pipeMaterialLabel: string;
    fixtures: PlumbingFixtureItem[];
    coldBranchMeters: number;
    hotBranchMeters: number;
    mainSupplyMeters: number;
    totalSupplyMeters: number;
    drain40_50Meters: number;
    drain110Meters: number;
    totalDrainMeters: number;
    estimatedFittings: number;
    manifoldWaysCold: number;
    manifoldWaysHot: number;
  };
  paint: {
    grossWallSqm: number;
    openingsSubtractedSqm: number;
    netWallSqm: number;
    ceilingSqm: number;
    totalSurfaceSqm: number;
    coats: number;
    paintLiters: number;
    paintKg: number;
    bucketCount: number;
    bucketKg: number;
    primerLiters: number;
    primerKg: number;
  };
}

/** Stima posizione iniziale sensata per Quadro Elettrico (vicino porta d'ingresso) e Collettore Idrico (vicino bagno/cucina) */
export function getDefaultServicePoints(
  project: ProjectData,
  rooms: DetectedRoom[]
): { panelPosition: Point2D; manifoldPosition: Point2D } {
  const activeWalls = project.walls.filter((w) => !w.demolished);
  const bounds = getWallsBounds(activeWalls);
  const wallMap = new Map(activeWalls.map((w) => [w.id, w]));

  // Quadro elettrico: vicino alla porta d'ingresso se presente, altrimenti angolo in basso a sinistra
  let panelPosition: Point2D = {
    x: Number((bounds.minX + 0.5).toFixed(2)),
    y: Number((bounds.maxY - 0.5).toFixed(2)),
  };
  const entrance = project.openings.find((o) => o.type === 'door_entrance');
  if (entrance) {
    const w = wallMap.get(entrance.wallId);
    if (w) {
      const c = getOpeningCenter(entrance, w);
      panelPosition = { x: Number(c.x.toFixed(2)), y: Number(c.y.toFixed(2)) };
    }
  } else if (rooms.length > 0) {
    panelPosition = {
      x: Number((rooms[0].bounds.minX + 0.3).toFixed(2)),
      y: Number((rooms[0].bounds.maxY - 0.3).toFixed(2)),
    };
  }

  // Collettore / Caldaia: baricentro dei punti acqua (cucina/bagni) se presenti, altrimenti angolo in alto a destra
  const waterFixtures = project.furniture.filter((f) => isWaterFixture(f));
  let manifoldPosition: Point2D = {
    x: Number((bounds.maxX - 0.6).toFixed(2)),
    y: Number((bounds.minY + 0.6).toFixed(2)),
  };
  if (waterFixtures.length > 0) {
    const kitchen = waterFixtures.find(
      (f) => f.geometryType === 'kitchen_linear' || f.geometryType === 'kitchen_island'
    );
    if (kitchen) {
      manifoldPosition = { x: Number(kitchen.x.toFixed(2)), y: Number(kitchen.y.toFixed(2)) };
    } else {
      const avgX = waterFixtures.reduce((s, f) => s + f.x, 0) / waterFixtures.length;
      const avgY = waterFixtures.reduce((s, f) => s + f.y, 0) / waterFixtures.length;
      manifoldPosition = { x: Number(avgX.toFixed(2)), y: Number(avgY.toFixed(2)) };
    }
  }

  return { panelPosition, manifoldPosition };
}

export function isWaterFixture(f: Furniture): boolean {
  return (
    f.geometryType === 'sink' ||
    f.geometryType === 'wc' ||
    f.geometryType === 'shower' ||
    f.geometryType === 'bathtub' ||
    f.geometryType === 'kitchen_linear' ||
    f.geometryType === 'kitchen_island' ||
    f.geometryType === 'washing_machine'
  );
}

function manhattan(a: Point2D, b: Point2D): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Verifica se un muro è un tramezzo interno (confinante con 2 stanze distinte) o perimetrale (1 stanza) */
function detectWallPaintedFaces(wall: Wall, rooms: DetectedRoom[], mode: WallSidesMode): number {
  if (mode === 'single') return 1;
  if (mode === 'both') return 2;
  if (rooms.length <= 1) return 1;

  const len = wallLength(wall);
  if (len < 0.15) return 1;
  const nx = -(wall.end.y - wall.start.y) / len;
  const ny = (wall.end.x - wall.start.x) / len;
  const midX = (wall.start.x + wall.end.x) / 2;
  const midY = (wall.start.y + wall.end.y) / 2;
  const offset = Math.max(wall.thickness / 2 + 0.25, 0.35);

  const sideA = rooms.find((r) => r.containsPoint(midX + nx * offset, midY + ny * offset));
  const sideB = rooms.find((r) => r.containsPoint(midX - nx * offset, midY - ny * offset));

  if (sideA && sideB) return 2;
  return 1;
}

/** Esegue il calcolo completo di Impianto Elettrico, Impianto Idraulico e Vernice Pareti */
export function estimateMepAndPaint(
  project: ProjectData,
  rooms: DetectedRoom[],
  config: MepConfig
): MepEstimate {
  const activeWalls = project.walls.filter((w) => !w.demolished);
  const furnitureMap = new Map(project.furniture.map((f) => [f.id, f]));
  const wasteMult = 1 + Math.max(0, config.wastePct) / 100;

  const effectiveRooms: DetectedRoom[] =
    rooms.length > 0
      ? rooms
      : [
          {
            id: 'room_fallback',
            name: 'Ambiente unico',
            kind: 'generica',
            areaSqm: (() => {
              const b = getWallsBounds(activeWalls);
              return Number(Math.max(12, b.width * b.height).toFixed(2));
            })(),
            perimeterM: (() => {
              const b = getWallsBounds(activeWalls);
              return Number((2 * (b.width + b.height)).toFixed(2));
            })(),
            bounds: getWallsBounds(activeWalls),
            floorStrips: [],
            furnitureIds: project.furniture.map((f) => f.id),
            wallIds: activeWalls.map((w) => w.id),
            containsPoint: () => true,
          },
        ];

  const totalFloorAreaSqm = Number(
    effectiveRooms.reduce((sum, r) => sum + r.areaSqm, 0).toFixed(2)
  );

  // =========================================================================
  // 1. IMPIANTO ELETTRICO (CEI 64-8 indicativo + mobili reali + distanze)
  // =========================================================================
  const levelBonusLights = config.ceiLevel === 'livello3' ? 2 : config.ceiLevel === 'livello2' ? 1 : 0;
  const levelBonusOutlets = config.ceiLevel === 'livello3' ? 3 : config.ceiLevel === 'livello2' ? 1 : 0;

  const byRoom: RoomElectricalBreakdown[] = [];
  let cable15Raw = 0; // 1,5 mm² (luci)
  let cable25Raw = 0; // 2,5 mm² (prese FM)
  let cable40Raw = 0; // 4 mm² (carichi cucina / induzione / clima)
  let corr20Raw = 0;
  let corr25Raw = 0;

  for (const room of effectiveRooms) {
    const items = room.furnitureIds
      .map((id) => furnitureMap.get(id))
      .filter((f): f is Furniture => Boolean(f));

    const countType = (t: Furniture['geometryType']) =>
      items.filter((f) => f.geometryType === t).length;

    const distPanel = Math.max(
      1.5,
      manhattan(config.panelPosition, { x: room.bounds.centerX, y: room.bounds.centerY })
    );

    // Calcolo punti luce per ambiente (CEI 64-8 + arredi specifici)
    let lightPoints = room.areaSqm >= 22 ? 2 : 1;
    if (room.kind === 'bagno') {
      lightPoints = 2; // centro volta + punto specchio lavabo
    } else if (room.kind === 'cucina' || room.kind === 'soggiorno_cucina') {
      lightPoints += 1; // sottopensile / zona lavoro cucina
    }
    if (countType('sink') > 0 && room.kind !== 'bagno') lightPoints += 1;
    lightPoints += room.areaSqm >= 12 ? levelBonusLights : Math.min(1, levelBonusLights);

    // Calcolo prese standard (10A / 16A bivalenti) in base a mq, tipologia e mobili
    let standardOutlets = 3;
    if (room.kind === 'bagno') {
      standardOutlets = 2; // zona lavabo / asciugacapelli
    } else if (room.kind === 'cucina') {
      standardOutlets = 5; // piano di lavoro
    } else if (room.kind === 'soggiorno_cucina') {
      standardOutlets = Math.max(7, Math.ceil(room.areaSqm / 3.5));
    } else if (room.kind === 'soggiorno') {
      standardOutlets = Math.max(5, Math.ceil(room.areaSqm / 4));
    } else if (room.kind === 'camera') {
      standardOutlets = Math.max(4, Math.ceil(room.areaSqm / 3.5));
    } else if (room.kind === 'studio') {
      standardOutlets = 5;
    } else {
      standardOutlets = Math.max(3, Math.ceil(room.areaSqm / 5));
    }

    // Aggiunte intelligenti in base ai mobili effettivamente inseriti nella stanza
    standardOutlets += countType('nightstand'); // 1 presa per comodino
    if (countType('tv_stand') > 0) standardOutlets += 2; // gruppo TV / decoder / router
    if (countType('desk') > 0) standardOutlets += 2; // postazione PC
    standardOutlets += levelBonusOutlets;

    // Prese dedicate (elettrodomestici di potenza)
    let dedicatedOutlets = 0;
    const hasKitchen = countType('kitchen_linear') + countType('kitchen_island') > 0;
    if (hasKitchen) {
      dedicatedOutlets += 3; // frigorifero, forno, lavastoviglie/cappa
      if (config.includeInduction) dedicatedOutlets += 1;
    }
    dedicatedOutlets += countType('washing_machine');
    if (
      config.includeAcLine &&
      (room.kind === 'soggiorno' ||
        room.kind === 'soggiorno_cucina' ||
        room.kind === 'camera' ||
        room.kind === 'studio')
    ) {
      dedicatedOutlets += 1;
    }

    // Punti TV / Rete dati
    let tvDataPoints = 0;
    if (
      countType('tv_stand') > 0 ||
      room.kind === 'soggiorno' ||
      room.kind === 'soggiorno_cucina'
    ) {
      tvDataPoints += 2; // 1 TV + 1 RJ45
    } else if (room.kind === 'camera' || room.kind === 'studio' || countType('desk') > 0) {
      tvDataPoints += 1;
    }

    byRoom.push({
      roomId: room.id,
      roomName: room.name,
      areaSqm: room.areaSqm,
      lightPoints,
      standardOutlets,
      dedicatedOutlets,
      tvDataPoints,
      distanceFromPanelM: Number(distPanel.toFixed(1)),
    });

    // Lunghezza dorsale + diramazioni per questa stanza (in metri di percorso tubo)
    const avgRoomRun = Math.max(2.5, room.perimeterM * 0.32);
    const verticalDrop = 2.4; // salita/discesa media muro-soffitto/pavimento

    // Linea Luci 1,5 mm²: dorsale quadro->stanza + diramazioni punti luce e interruttori
    // Fattore 3.4 conduttori (Fase + Neutro + Terra + ritorno lampada/deviata)
    const lightTubeM = distPanel * 0.75 + lightPoints * (avgRoomRun * 0.45 + verticalDrop);
    cable15Raw += lightTubeM * 3.4;

    // Linea Prese FM 2,5 mm²: dorsale + entra-esci tra prese standard e lavatrice/forno base
    // 3 conduttori (Fase + Neutro + Terra)
    const fmOutletsCount = standardOutlets + Math.max(0, dedicatedOutlets - (config.includeInduction && hasKitchen ? 1 : 0));
    const fmTubeM = distPanel * 0.85 + fmOutletsCount * (Math.min(3.5, avgRoomRun * 0.28) + 1.2);
    cable25Raw += fmTubeM * 3;

    // Linea Potenza 4 mm² (induzione / dorsale cucina / clima dedicato)
    if (hasKitchen) {
      const kitchenDedicatedDist = distPanel + 2.8;
      cable40Raw += kitchenDedicatedDist * (config.includeInduction ? 2 : 1) * 3;
      corr25Raw += kitchenDedicatedDist;
    }
    if (
      config.includeAcLine &&
      (room.kind === 'soggiorno' || room.kind === 'soggiorno_cucina' || room.kind === 'camera')
    ) {
      const acDist = distPanel + 2.6;
      cable25Raw += acDist * 3;
      corr20Raw += acDist;
    }

    // Corrugati Ø20 (diramazioni) e Ø25 (dorsale dal quadro alla cassetta di stanza)
    corr20Raw += lightTubeM * 0.75 + fmTubeM * 0.7;
    corr25Raw += distPanel * 0.9;
  }

  const totalLightPoints = byRoom.reduce((s, r) => s + r.lightPoints, 0);
  const totalStandardOutlets = byRoom.reduce((s, r) => s + r.standardOutlets, 0);
  const totalDedicatedOutlets = byRoom.reduce((s, r) => s + r.dedicatedOutlets, 0);
  const totalTvDataPoints = byRoom.reduce((s, r) => s + r.tvDataPoints, 0);
  const totalOutlets = totalStandardOutlets + totalDedicatedOutlets;

  // Montante 6 mm² (contatore -> quadro elettrico, stimato min 8m di tratta × 3 conduttori)
  const montanteTubeM = Math.max(6, Math.min(14, Math.sqrt(totalFloorAreaSqm) * 1.1));
  const cable60Raw = montanteTubeM * 3;
  corr25Raw += montanteTubeM;

  const cable15M = Math.ceil(cable15Raw * wasteMult);
  const cable25M = Math.ceil(cable25Raw * wasteMult);
  const cable40M = Math.ceil(cable40Raw * wasteMult);
  const cable60M = Math.ceil(cable60Raw * wasteMult);

  const cables: CableSectionRow[] = [
    {
      sectionMm2: '1,5 mm²',
      usage: 'Punti luce, interruttori e deviatori (F + N + T + ritorni)',
      conductors: 3,
      meters: cable15M,
      recommendedBreaker: 'MT 10A',
    },
    {
      sectionMm2: '2,5 mm²',
      usage: 'Prese forza motrice 16A, elettrodomestici standard, clima',
      conductors: 3,
      meters: cable25M,
      recommendedBreaker: 'MT 16A',
    },
  ];
  if (cable40M > 0) {
    cables.push({
      sectionMm2: '4 mm²',
      usage: config.includeInduction
        ? 'Linea dedicata piano cottura induzione e dorsale cucina'
        : 'Dorsale di potenza cucina / carichi pesanti',
      conductors: 3,
      meters: cable40M,
      recommendedBreaker: config.includeInduction ? 'MT 25A / 32A' : 'MT 20A / 25A',
    });
  }
  cables.push({
    sectionMm2: '6 mm²',
    usage: 'Montante principale (contatore → quadro generale)',
    conductors: 3,
    meters: cable60M,
    recommendedBreaker: 'Gen. 32A + Diff. 30mA',
  });

  const boxes503 = totalLightPoints + Math.ceil(totalStandardOutlets * 0.75) + totalDedicatedOutlets + totalTvDataPoints;
  const junctionBoxes = Math.max(1, Math.ceil(effectiveRooms.length * 0.85));

  // =========================================================================
  // 2. IMPIANTO IDRAULICO (Multistrato / PEX / PPR / Rame + Scarichi)
  // =========================================================================
  const fixtures: PlumbingFixtureItem[] = [];

  for (const f of project.furniture) {
    if (!isWaterFixture(f)) continue;

    const ownerRoom =
      effectiveRooms.find((r) => r.furnitureIds.includes(f.id)) ??
      effectiveRooms.find((r) => r.containsPoint(f.x, f.y));

    const needsCold = true;
    const needsHot =
      config.includeHotWater &&
      (f.geometryType === 'sink' ||
        f.geometryType === 'shower' ||
        f.geometryType === 'bathtub' ||
        f.geometryType === 'kitchen_linear' ||
        f.geometryType === 'kitchen_island');

    const drainDiameterMm: 40 | 50 | 110 =
      f.geometryType === 'wc'
        ? 110
        : f.geometryType === 'kitchen_linear' || f.geometryType === 'kitchen_island' || f.geometryType === 'washing_machine'
          ? 50
          : 40;

    // Distanza reale Manhattan dal collettore/caldaia all'utenza + salita/discesa a muro
    const horizDist = Math.max(0.8, manhattan(config.manifoldPosition, { x: f.x, y: f.y }));
    const verticalRun = f.geometryType === 'shower' ? 2.6 : 1.8;
    const coldPipeM = Number(((horizDist + verticalRun) * wasteMult).toFixed(1));
    const hotPipeM = needsHot ? Number(((horizDist + verticalRun) * wasteMult).toFixed(1)) : 0;

    // Scarico: percorso verso colonna/collettore più vicino (stimato ~65% della distanza orizzontale + curva)
    const drainPipeM = config.includeDrains
      ? Number(((Math.max(1.2, horizDist * 0.65) + 0.6) * wasteMult).toFixed(1))
      : 0;

    fixtures.push({
      id: f.id,
      name: f.name,
      roomName: ownerRoom?.name ?? 'Ambiente',
      x: f.x,
      y: f.y,
      needsCold,
      needsHot,
      drainDiameterMm,
      distanceFromManifoldM: Number(horizDist.toFixed(1)),
      coldPipeM,
      hotPipeM,
      drainPipeM,
    });
  }

  const coldBranchMeters = Math.ceil(fixtures.reduce((s, fx) => s + fx.coldPipeM, 0));
  const hotBranchMeters = Math.ceil(fixtures.reduce((s, fx) => s + fx.hotPipeM, 0));
  // Dorsale principale Ø20 mm (ingresso acqua → caldaia/collettore)
  const mainSupplyMeters =
    fixtures.length > 0
      ? Math.ceil(
          (Math.max(3, manhattan(config.panelPosition, config.manifoldPosition) * 0.85) + 2) *
            wasteMult
        )
      : 0;
  const totalSupplyMeters = coldBranchMeters + hotBranchMeters + mainSupplyMeters;

  const drain40_50Meters = Math.ceil(
    fixtures
      .filter((fx) => fx.drainDiameterMm !== 110)
      .reduce((s, fx) => s + fx.drainPipeM, 0)
  );
  const drain110Meters = Math.ceil(
    fixtures
      .filter((fx) => fx.drainDiameterMm === 110)
      .reduce((s, fx) => s + fx.drainPipeM, 0)
  );
  const totalDrainMeters = drain40_50Meters + drain110Meters;

  const manifoldWaysCold = fixtures.filter((fx) => fx.needsCold).length;
  const manifoldWaysHot = fixtures.filter((fx) => fx.needsHot).length;
  // Stima raccordi (2 curve/gomiti + 1 raccordo collettore + 1 terminale muro per via)
  const estimatedFittings = (manifoldWaysCold + manifoldWaysHot) * 4 + (mainSupplyMeters > 0 ? 6 : 0);

  // =========================================================================
  // 3. PITTURA / VERNICE PARETI (m² netti, litri, kg, secchi, fissativo)
  // =========================================================================
  const openingsByWall = new Map<string, Opening[]>();
  for (const op of project.openings) {
    const list = openingsByWall.get(op.wallId) ?? [];
    list.push(op);
    openingsByWall.set(op.wallId, list);
  }

  let grossWallSqm = 0;
  let openingsSubtractedSqm = 0;

  for (const wall of activeWalls) {
    const len = wallLength(wall);
    if (len < 0.05) continue;
    const faces = detectWallPaintedFaces(wall, effectiveRooms, config.wallSides);
    const wallArea = len * wall.height * faces;
    grossWallSqm += wallArea;

    const wallOps = openingsByWall.get(wall.id) ?? [];
    for (const op of wallOps) {
      const clampedW = Math.min(op.width, len);
      const clampedH = Math.min(op.height, wall.height);
      openingsSubtractedSqm += clampedW * clampedH * faces;
    }
  }

  const netWallSqm = Math.max(0, grossWallSqm - openingsSubtractedSqm);
  const ceilingSqm = config.includeCeiling ? totalFloorAreaSqm : 0;
  const totalSurfaceSqm = netWallSqm + ceilingSqm;

  const safeYield = Math.max(2, config.yieldSqmPerLiter);
  const safeDensity = Math.max(0.9, config.paintDensityKgPerL);
  const paintLiters =
    totalSurfaceSqm > 0
      ? Number((((totalSurfaceSqm * config.coats) / safeYield) * wasteMult).toFixed(1))
      : 0;
  const paintKg = Number((paintLiters * safeDensity).toFixed(1));
  const bucketCount = paintKg > 0 ? Math.ceil(paintKg / config.bucketKg) : 0;

  // Fissativo isolante: 1 mano, resa media ~12 m²/L, densità ~1.05 kg/L
  const primerLiters =
    config.includePrimer && totalSurfaceSqm > 0
      ? Number(((totalSurfaceSqm / 12) * wasteMult).toFixed(1))
      : 0;
  const primerKg = Number((primerLiters * 1.05).toFixed(1));

  return {
    totalFloorAreaSqm,
    roomCount: effectiveRooms.length,
    electrical: {
      totalLightPoints,
      totalStandardOutlets,
      totalDedicatedOutlets,
      totalTvDataPoints,
      totalOutlets,
      boxes503,
      junctionBoxes,
      cables,
      totalCableMeters: cable15M + cable25M + cable40M + cable60M,
      corrugated20M: Math.ceil(corr20Raw * wasteMult),
      corrugated25M: Math.ceil(corr25Raw * wasteMult),
      byRoom,
    },
    plumbing: {
      pipeMaterial: config.pipeMaterial,
      pipeMaterialLabel: PIPE_MATERIAL_LABELS[config.pipeMaterial].label,
      fixtures,
      coldBranchMeters,
      hotBranchMeters,
      mainSupplyMeters,
      totalSupplyMeters,
      drain40_50Meters,
      drain110Meters,
      totalDrainMeters,
      estimatedFittings,
      manifoldWaysCold,
      manifoldWaysHot,
    },
    paint: {
      grossWallSqm: Number(grossWallSqm.toFixed(1)),
      openingsSubtractedSqm: Number(openingsSubtractedSqm.toFixed(1)),
      netWallSqm: Number(netWallSqm.toFixed(1)),
      ceilingSqm: Number(ceilingSqm.toFixed(1)),
      totalSurfaceSqm: Number(totalSurfaceSqm.toFixed(1)),
      coats: config.coats,
      paintLiters,
      paintKg,
      bucketCount,
      bucketKg: config.bucketKg,
      primerLiters,
      primerKg,
    },
  };
}

/** Genera un file CSV compatibile con Excel contenente l'intero computo stimato */
export function buildMepCsv(estimate: MepEstimate, projectName: string): string {
  const rows: string[][] = [
    ['PianteStudio - Computo Stimato Impianti e Pittura', projectName],
    ['Superficie calpestabile stimata (m²)', String(estimate.totalFloorAreaSqm)],
    ['Stanze rilevate', String(estimate.roomCount)],
    [],
    ['=== IMPIANTO ELETTRICO ==='],
    ['Voce', 'Dettaglio / Sezione', 'Quantità', 'Unità'],
    ['Punti luce totali', 'Soffitto / applique / sottopensili', String(estimate.electrical.totalLightPoints), 'n.'],
    ['Prese standard (10A/16A)', 'Prese generali + comodini + TV/scrivania', String(estimate.electrical.totalStandardOutlets), 'n.'],
    ['Prese dedicate', 'Cucina / lavatrice / clima', String(estimate.electrical.totalDedicatedOutlets), 'n.'],
    ['Punti TV / Rete dati', 'Coassiale / RJ45', String(estimate.electrical.totalTvDataPoints), 'n.'],
    ['Scatole portafrutti 503', 'Stima incasso', String(estimate.electrical.boxes503), 'n.'],
    ['Cassette di derivazione', 'Stima per stanze', String(estimate.electrical.junctionBoxes), 'n.'],
    ...estimate.electrical.cables.map((c) => [
      `Cavo unipolare FS17 ${c.sectionMm2}`,
      `${c.usage} (${c.recommendedBreaker})`,
      String(c.meters),
      'm',
    ]),
    ['Tubo corrugato Ø 20 mm', 'Diramazioni luci e prese', String(estimate.electrical.corrugated20M), 'm'],
    ['Tubo corrugato Ø 25 mm', 'Dorsali da quadro a cassette', String(estimate.electrical.corrugated25M), 'm'],
    [],
    ['=== IMPIANTO IDRAULICO ==='],
    ['Voce', 'Materiale / Diametro', 'Quantità', 'Unità'],
    ['Punti acqua rilevati', 'Sanitari / cucina / lavatrice', String(estimate.plumbing.fixtures.length), 'n.'],
    [`Tubo ${estimate.plumbing.pipeMaterialLabel} - Acqua Fredda`, 'Ø 16 mm (diramazioni)', String(estimate.plumbing.coldBranchMeters), 'm'],
    [`Tubo ${estimate.plumbing.pipeMaterialLabel} - Acqua Calda`, 'Ø 16 mm (diramazioni)', String(estimate.plumbing.hotBranchMeters), 'm'],
    [`Tubo ${estimate.plumbing.pipeMaterialLabel} - Dorsale`, 'Ø 20 mm (alimentazione principale)', String(estimate.plumbing.mainSupplyMeters), 'm'],
    ['Totale tubi adduzione', estimate.plumbing.pipeMaterialLabel, String(estimate.plumbing.totalSupplyMeters), 'm'],
    ['Tubi di scarico Ø 40/50 mm', 'Lavabi, docce, vasche, cucina, lavatrice', String(estimate.plumbing.drain40_50Meters), 'm'],
    ['Tubi di scarico Ø 110 mm', 'WC verso colonna', String(estimate.plumbing.drain110Meters), 'm'],
    ['Raccordi e terminali stimati', 'Curve, raccordi collettore, attacchi muro', String(estimate.plumbing.estimatedFittings), 'n.'],
    [],
    ['=== PITTURA / VERNICE PARETI ==='],
    ['Voce', 'Dettaglio', 'Quantità', 'Unità'],
    ['Superficie lorda pareti', 'Muri attivi', String(estimate.paint.grossWallSqm), 'm²'],
    ['Superficie aperture sottratte', 'Porte, finestre, archi', String(estimate.paint.openingsSubtractedSqm), 'm²'],
    ['Superficie netta pareti', 'Pareti da tinteggiare', String(estimate.paint.netWallSqm), 'm²'],
    ['Superficie soffitto', 'Se incluso nel calcolo', String(estimate.paint.ceilingSqm), 'm²'],
    ['Superficie totale da dipingere', `${estimate.paint.coats} mani`, String(estimate.paint.totalSurfaceSqm), 'm²'],
    ['Vernice stimata (kg)', `Secchi consigliati: ${estimate.paint.bucketCount} × ${estimate.paint.bucketKg} kg`, String(estimate.paint.paintKg), 'kg'],
    ['Vernice stimata (litri)', 'Incluso margine sfrido', String(estimate.paint.paintLiters), 'L'],
    ['Fissativo / Primer', '1 mano isolante (se attivo)', String(estimate.paint.primerKg), 'kg'],
  ];

  return rows
    .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
}

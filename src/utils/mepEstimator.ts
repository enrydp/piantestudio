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
export type HvacGeneratorOverride =
  | 'auto'
  | 'hp_monobloc_water'
  | 'hp_split_gas'
  | 'boiler_gas'
  | 'boiler_pellet';
export type SplitFluidMode = 'auto' | 'water' | 'gas';

export interface MepConfig {
  // Elettrico
  ceiLevel: CeiLevel;
  panelPosition: Point2D;
  includeInduction: boolean;
  includeAcLine: boolean;
  // Idraulico (Collettore Acqua Sanitaria)
  pipeMaterial: PipeMaterial;
  waterManifoldPosition: Point2D;
  includeHotWater: boolean;
  includeDrains: boolean;
  // Riscaldamento & Climatizzazione (Collettore Riscaldamento + Dorsale Primaria da PdC/Caldaia)
  heatingManifoldPosition: Point2D;
  primaryPipeDiameterMm: 26 | 32;
  hvacGeneratorOverride: HvacGeneratorOverride;
  splitFluidMode: SplitFluidMode;
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

export interface HvacGeneratorItem {
  id: string;
  name: string;
  kind: 'hp_monobloc' | 'hp_split' | 'boiler_gas' | 'boiler_pellet';
  roomName: string;
  x: number;
  y: number;
}

export interface HvacTerminalItem {
  id: string;
  name: string;
  kind: 'ac_split_high' | 'ac_split_low' | 'radiator' | 'towel_warmer';
  roomName: string;
  x: number;
  y: number;
  distanceM: number;
  circuitType: 'water' | 'gas';
  pipeDescription: string;
  pipeMeters: number;
  condensateMeters: number;
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
    /** Dorsale primaria ACS/acqua Ø20/26 mm tra Generatore (Caldaia/PdC) e Collettore Acqua */
    generatorToWaterManifoldMeters: number;
    totalSupplyMeters: number;
    drain40_50Meters: number;
    drain110Meters: number;
    totalDrainMeters: number;
    estimatedFittings: number;
    manifoldWaysCold: number;
    manifoldWaysHot: number;
  };
  hvac: {
    generators: HvacGeneratorItem[];
    terminals: HvacTerminalItem[];
    activeGeneratorSummary: string;
    splitFluid: 'water' | 'gas';
    hasMonoblocWater: boolean;
    hasSplitGas: boolean;
    hasBoilerGas: boolean;
    hasBoilerPellet: boolean;
    /** Diramazioni dal Collettore Riscaldamento ai termosifoni / split idronici (mandata + ritorno Ø16 mm) */
    heatingWaterPipeMeters: number;
    heatingWaterPipeLabel: string;
    /** Dorsale primaria di diametro maggiorato (Ø26/32 mm, mandata + ritorno) da Generatore (PdC / Caldaia) a Collettore Riscaldamento */
    primaryTrunkPipeMeters: number;
    primaryTrunkDiameterMm: 26 | 32;
    primaryTrunkDistanceM: number;
    primaryGeneratorAnchor: HvacGeneratorItem | null;
    /** Numero vie necessarie sul Collettore Riscaldamento */
    heatingManifoldWays: number;
    /** Compatibilità: dorsale primaria PdC Monoblocco */
    monoblocPrimaryPipeMeters: number;
    /** Coppia tubi in rame frigorifero coibentato (Ø 1/4" + Ø 3/8") per PdC Splittata / Split a gas */
    refrigerantCopperPairMeters: number;
    /** Scarico condensa Ø 20 mm per split e PdC */
    condensateDrainMeters: number;
    /** Tubo Gas certificato UNI 7129 (rame Ø18-22 / multistrato giallo) per Caldaia a Gas */
    gasPipeMeters: number;
    /** Canna fumaria (Ø80 pellet o coassiale Ø60/100 gas) */
    fluePipeMeters: number;
    fluePipeLabel: string;
    /** Cavo comunicazione / collegamento 4G1,5 mm² tra unità esterna e split */
    commCable4g15Meters: number;
    /** Valvole termostatiche + detentori per termosifoni/scaldasalviette */
    radiatorValveKits: number;
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

/** Stima posizione iniziale sensata per Quadro Elettrico (⚡), Collettore Acqua (💧) e Collettore Riscaldamento (🔥) */
export function getDefaultServicePoints(
  project: ProjectData,
  rooms: DetectedRoom[]
): {
  panelPosition: Point2D;
  waterManifoldPosition: Point2D;
  heatingManifoldPosition: Point2D;
  placedWaterManifoldId: string | null;
  placedHeatingManifoldId: string | null;
} {
  const activeWalls = project.walls.filter((w) => !w.demolished);
  const bounds = getWallsBounds(activeWalls);
  const wallMap = new Map(activeWalls.map((w) => [w.id, w]));

  // 1. Quadro elettrico: vicino alla porta d'ingresso se presente, altrimenti angolo in basso a sinistra
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
      x: Number((rooms[0].bounds.minX + 0.35).toFixed(2)),
      y: Number((rooms[0].bounds.maxY - 0.35).toFixed(2)),
    };
  }

  // 2. Collettore Acqua (Sanitario): se posizionato in pianta usa le sue coordinate reali
  const placedWater = project.furniture.find((f) => isWaterManifold(f)) ?? null;
  const placedHeating = project.furniture.find((f) => isHeatingManifold(f)) ?? null;

  const boilerItem = project.furniture.find(
    (f) =>
      f.geometryType === 'boiler' ||
      f.geometryType === 'boiler_pellet' ||
      f.geometryType === 'heat_pump_monobloc' ||
      f.geometryType === 'heat_pump_split'
  );
  const waterFixtures = project.furniture.filter((f) => isWaterFixture(f));
  const hvacTerminals = project.furniture.filter((f) => isHvacTerminal(f));

  let waterManifoldPosition: Point2D = {
    x: Number((bounds.maxX - 0.7).toFixed(2)),
    y: Number((bounds.minY + 0.7).toFixed(2)),
  };

  if (placedWater) {
    waterManifoldPosition = {
      x: Number(placedWater.x.toFixed(2)),
      y: Number(placedWater.y.toFixed(2)),
    };
  } else if (waterFixtures.length > 0) {
    const bathRoom = rooms.find((r) => r.kind === 'bagno');
    if (bathRoom) {
      waterManifoldPosition = {
        x: Number((bathRoom.bounds.minX + 0.35).toFixed(2)),
        y: Number((bathRoom.bounds.centerY).toFixed(2)),
      };
    } else {
      const avgX = waterFixtures.reduce((s, f) => s + f.x, 0) / waterFixtures.length;
      const avgY = waterFixtures.reduce((s, f) => s + f.y, 0) / waterFixtures.length;
      waterManifoldPosition = { x: Number(avgX.toFixed(2)), y: Number(avgY.toFixed(2)) };
    }
  } else if (boilerItem) {
    waterManifoldPosition = {
      x: Number((boilerItem.x + 0.5).toFixed(2)),
      y: Number((boilerItem.y + 0.4).toFixed(2)),
    };
  }

  // 3. Collettore Riscaldamento (Termico): se posizionato in pianta usa le sue coordinate reali,
  // altrimenti zona baricentrica/disimpegno tra generatore e termosifoni (distanziato dal collettore acqua)
  let heatingManifoldPosition: Point2D = {
    x: Number((bounds.centerX).toFixed(2)),
    y: Number((bounds.centerY).toFixed(2)),
  };

  if (placedHeating) {
    heatingManifoldPosition = {
      x: Number(placedHeating.x.toFixed(2)),
      y: Number(placedHeating.y.toFixed(2)),
    };
  } else if (hvacTerminals.length > 0) {
    const avgX = hvacTerminals.reduce((s, f) => s + f.x, 0) / hvacTerminals.length;
    const avgY = hvacTerminals.reduce((s, f) => s + f.y, 0) / hvacTerminals.length;
    heatingManifoldPosition = { x: Number(avgX.toFixed(2)), y: Number(avgY.toFixed(2)) };
  } else {
    const hallway = rooms.find((r) => r.kind === 'generica' && r.areaSqm < 12);
    if (hallway) {
      heatingManifoldPosition = {
        x: Number(hallway.bounds.centerX.toFixed(2)),
        y: Number(hallway.bounds.centerY.toFixed(2)),
      };
    }
  }

  // Evita sovrapposizione visiva tra Collettore Acqua e Collettore Riscaldamento se nessuno dei due è fisso
  if (
    !placedHeating &&
    Math.hypot(
      heatingManifoldPosition.x - waterManifoldPosition.x,
      heatingManifoldPosition.y - waterManifoldPosition.y
    ) < 0.75
  ) {
    heatingManifoldPosition = {
      x: Number((waterManifoldPosition.x + 0.85).toFixed(2)),
      y: Number((waterManifoldPosition.y + 0.35).toFixed(2)),
    };
  }

  return {
    panelPosition,
    waterManifoldPosition,
    heatingManifoldPosition,
    placedWaterManifoldId: placedWater?.id ?? null,
    placedHeatingManifoldId: placedHeating?.id ?? null,
  };
}

export function isWaterManifold(f: Furniture): boolean {
  return f.geometryType === 'manifold_water';
}

export function isHeatingManifold(f: Furniture): boolean {
  return f.geometryType === 'manifold_heating';
}

export function isWaterFixture(f: Furniture): boolean {
  return (
    f.geometryType === 'sink' ||
    f.geometryType === 'bathroom_vanity' ||
    f.geometryType === 'wc' ||
    f.geometryType === 'bidet' ||
    f.geometryType === 'shower' ||
    f.geometryType === 'bathtub' ||
    f.geometryType === 'kitchen_linear' ||
    f.geometryType === 'kitchen_l' ||
    f.geometryType === 'kitchen_peninsula' ||
    f.geometryType === 'kitchen_island' ||
    f.geometryType === 'washing_machine'
  );
}

export function isHvacGenerator(f: Furniture): boolean {
  return (
    f.geometryType === 'boiler' ||
    f.geometryType === 'boiler_pellet' ||
    f.geometryType === 'heat_pump_monobloc' ||
    f.geometryType === 'heat_pump_split'
  );
}

export function isHvacTerminal(f: Furniture): boolean {
  return (
    f.geometryType === 'ac_split_high' ||
    f.geometryType === 'ac_split_low' ||
    f.geometryType === 'radiator' ||
    f.geometryType === 'towel_warmer'
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
    const hasKitchen =
      countType('kitchen_linear') +
        countType('kitchen_l') +
        countType('kitchen_peninsula') +
        countType('kitchen_island') >
      0;
    if (hasKitchen) {
      dedicatedOutlets += 3; // frigorifero, forno, lavastoviglie/cappa
      if (config.includeInduction) dedicatedOutlets += 1;
    } else if (countType('fridge') > 0) {
      dedicatedOutlets += countType('fridge');
    }
    dedicatedOutlets += countType('washing_machine');
    dedicatedOutlets += countType('boiler') + countType('boiler_pellet') + countType('water_heater');
    dedicatedOutlets += countType('heat_pump_monobloc') + countType('heat_pump_split');
    const placedSplitsInRoom = countType('ac_split_high') + countType('ac_split_low');
    if (placedSplitsInRoom > 0) {
      dedicatedOutlets += placedSplitsInRoom;
    } else if (
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

  // Linee elettriche dedicate per Pompe di Calore e Caldaie posizionate in pianta
  const placedHeatPumps = project.furniture.filter(
    (f) => f.geometryType === 'heat_pump_monobloc' || f.geometryType === 'heat_pump_split'
  );
  const placedBoilers = project.furniture.filter(
    (f) =>
      f.geometryType === 'boiler' ||
      f.geometryType === 'boiler_pellet' ||
      f.geometryType === 'water_heater'
  );
  for (const hp of placedHeatPumps) {
    const dist = Math.max(2.5, manhattan(config.panelPosition, { x: hp.x, y: hp.y })) + 2.5;
    cable40Raw += dist * 3;
    corr25Raw += dist;
  }
  for (const bl of placedBoilers) {
    const dist = Math.max(2, manhattan(config.panelPosition, { x: bl.x, y: bl.y })) + 2.2;
    cable25Raw += dist * 3;
    corr20Raw += dist;
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
        f.geometryType === 'bathroom_vanity' ||
        f.geometryType === 'bidet' ||
        f.geometryType === 'shower' ||
        f.geometryType === 'bathtub' ||
        f.geometryType === 'kitchen_linear' ||
        f.geometryType === 'kitchen_l' ||
        f.geometryType === 'kitchen_peninsula' ||
        f.geometryType === 'kitchen_island');

    const drainDiameterMm: 40 | 50 | 110 =
      f.geometryType === 'wc'
        ? 110
        : f.geometryType === 'kitchen_linear' ||
            f.geometryType === 'kitchen_l' ||
            f.geometryType === 'kitchen_peninsula' ||
            f.geometryType === 'kitchen_island' ||
            f.geometryType === 'washing_machine'
          ? 50
          : 40;

    // Distanza reale Manhattan dal Collettore Acqua all'utenza + salita/discesa a muro
    const horizDist = Math.max(0.8, manhattan(config.waterManifoldPosition, { x: f.x, y: f.y }));
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

  // Generatore sanitario (priorità al Boiler acqua calda ACS se inserito, altrimenti caldaia / PdC)
  const placedWaterHeater = project.furniture.find((f) => f.geometryType === 'water_heater') ?? null;
  const allGeneratorsForSanitary = project.furniture.filter((f) => isHvacGenerator(f));
  const sanitaryGenerator =
    placedWaterHeater ??
    allGeneratorsForSanitary.find((g) => g.geometryType === 'boiler') ??
    allGeneratorsForSanitary.find((g) => g.geometryType === 'heat_pump_monobloc') ??
    allGeneratorsForSanitary.find((g) => g.geometryType === 'boiler_pellet') ??
    allGeneratorsForSanitary.find((g) => g.geometryType === 'heat_pump_split') ??
    null;

  // Dorsale primaria ACS + ingresso fredda Ø20/26 mm (Generatore ↔ Collettore Acqua)
  const generatorToWaterManifoldMeters =
    sanitaryGenerator && fixtures.length > 0
      ? Math.ceil(
          (Math.max(1.5, manhattan(sanitaryGenerator, config.waterManifoldPosition)) + 1.8) *
            (config.includeHotWater ? 2 : 1) *
            wasteMult
        )
      : 0;

  // Dorsale principale ingresso acqua Ø20/26 mm (contatore/ingresso → Collettore Acqua + eventuale tratta generatore)
  const mainSupplyMeters =
    fixtures.length > 0
      ? Math.ceil(
          (Math.max(3, manhattan(config.panelPosition, config.waterManifoldPosition) * 0.85) + 2) *
            wasteMult
        ) + generatorToWaterManifoldMeters
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
  // 2B. RISCALDAMENTO & CLIMATIZZAZIONE (PdC Monoblocco acqua / Splittata gas, Caldaia Gas / Pellet, Split, Termosifoni)
  // =========================================================================
  const generators: HvacGeneratorItem[] = [];
  for (const f of project.furniture) {
    if (!isHvacGenerator(f)) continue;
    const ownerRoom =
      effectiveRooms.find((r) => r.furnitureIds.includes(f.id)) ??
      effectiveRooms.find((r) => r.containsPoint(f.x, f.y));
    const kind: HvacGeneratorItem['kind'] =
      f.geometryType === 'heat_pump_monobloc'
        ? 'hp_monobloc'
        : f.geometryType === 'heat_pump_split'
          ? 'hp_split'
          : f.geometryType === 'boiler_pellet'
            ? 'boiler_pellet'
            : 'boiler_gas';
    generators.push({
      id: f.id,
      name: f.name,
      kind,
      roomName: ownerRoom?.name ?? 'Esterno / Locale tecnico',
      x: f.x,
      y: f.y,
    });
  }

  const hasMonoblocWater =
    config.hvacGeneratorOverride === 'hp_monobloc_water' ||
    (config.hvacGeneratorOverride === 'auto' &&
      generators.some((g) => g.kind === 'hp_monobloc'));
  const hasSplitGas =
    config.hvacGeneratorOverride === 'hp_split_gas' ||
    (config.hvacGeneratorOverride === 'auto' && generators.some((g) => g.kind === 'hp_split'));
  const hasBoilerGas =
    config.hvacGeneratorOverride === 'boiler_gas' ||
    (config.hvacGeneratorOverride === 'auto' && generators.some((g) => g.kind === 'boiler_gas'));
  const hasBoilerPellet =
    config.hvacGeneratorOverride === 'boiler_pellet' ||
    (config.hvacGeneratorOverride === 'auto' &&
      generators.some((g) => g.kind === 'boiler_pellet'));

  // Determina il fluido degli split (alti/bassi):
  // - Se forzato dall'utente -> usa la scelta
  // - In Auto: se è presente una PdC Monoblocco (acqua) senza PdC Splittata -> circolazione ad ACQUA (fan-coil idronici)
  // - Altrimenti -> circolazione a GAS refrigerante (rame frigorifero coibentato 1/4" + 3/8")
  const splitFluid: 'water' | 'gas' =
    config.splitFluidMode === 'water'
      ? 'water'
      : config.splitFluidMode === 'gas'
        ? 'gas'
        : hasMonoblocWater && !hasSplitGas
          ? 'water'
          : 'gas';

  const summaryParts: string[] = [];
  if (hasMonoblocWater) summaryParts.push('PdC Monoblocco (acqua)');
  if (hasSplitGas) summaryParts.push('PdC Splittata (gas)');
  if (hasBoilerGas) summaryParts.push('Caldaia a Gas');
  if (hasBoilerPellet) summaryParts.push('Caldaia / Stufa a Pellet');
  const activeGeneratorSummary =
    summaryParts.length > 0 ? summaryParts.join(' + ') : 'Nessun generatore posizionato (usa selettore o inseriscilo nello Step 2)';

  const splitOutdoorAnchor: Point2D =
    generators.find((g) => g.kind === 'hp_split') ??
    generators.find((g) => g.kind === 'hp_monobloc') ??
    config.heatingManifoldPosition;

  // Generatore termico principale per la DORSALE PRIMARIA (tubi più grandi Ø26/32 mm → Collettore Riscaldamento)
  const primaryGeneratorAnchor: HvacGeneratorItem | null =
    generators.find((g) => g.kind === 'hp_monobloc') ??
    generators.find((g) => g.kind === 'boiler_gas') ??
    generators.find((g) => g.kind === 'boiler_pellet') ??
    generators.find((g) => g.kind === 'hp_split') ??
    null;

  // I terminali ad acqua (termosifoni, scaldasalviette, split idronici) partono SEMPRE dal Collettore Riscaldamento!
  const waterHeatingAnchor: Point2D = config.heatingManifoldPosition;

  const heatingWaterPipeLabel = `${PIPE_MATERIAL_LABELS[config.pipeMaterial].label} coibentato Ø16 mm`;

  const hvacTerminals: HvacTerminalItem[] = [];
  let heatingWaterRaw = 0;
  let refrigerantPairRaw = 0;
  let condensateRaw = 0;
  let commCableRaw = 0;
  let radiatorValveKits = 0;

  for (const f of project.furniture) {
    if (!isHvacTerminal(f)) continue;
    const ownerRoom =
      effectiveRooms.find((r) => r.furnitureIds.includes(f.id)) ??
      effectiveRooms.find((r) => r.containsPoint(f.x, f.y));

    const kind = f.geometryType as HvacTerminalItem['kind'];
    const isRadiator = kind === 'radiator' || kind === 'towel_warmer';
    const circuitType: 'water' | 'gas' = isRadiator ? 'water' : splitFluid;

    const anchor = circuitType === 'gas' ? splitOutdoorAnchor : waterHeatingAnchor;
    const horizDist = Math.max(1.2, manhattan(anchor, { x: f.x, y: f.y }));

    if (circuitType === 'water') {
      // Andata + Ritorno (× 2) dal Collettore Riscaldamento + salite verticali
      const verticalPerLine = kind === 'ac_split_high' ? 2.5 : kind === 'towel_warmer' ? 1.5 : 1.0;
      const twoWayMeters = Number(((horizDist + verticalPerLine) * 2 * wasteMult).toFixed(1));
      const condMeters = isRadiator ? 0 : Number(((2.8 + horizDist * 0.35) * wasteMult).toFixed(1));
      heatingWaterRaw += twoWayMeters;
      condensateRaw += condMeters;
      if (isRadiator) radiatorValveKits += 1;

      hvacTerminals.push({
        id: f.id,
        name: f.name,
        kind,
        roomName: ownerRoom?.name ?? 'Ambiente',
        x: f.x,
        y: f.y,
        distanceM: Number(horizDist.toFixed(1)),
        circuitType: 'water',
        pipeDescription: `${heatingWaterPipeLabel} (A+R da collettore)`,
        pipeMeters: twoWayMeters,
        condensateMeters: condMeters,
      });
    } else {
      // Circolazione GAS refrigerante: coppia tubi rame coibentato (Ø 1/4" liquido + Ø 3/8" gas)
      const verticalRun = kind === 'ac_split_high' ? 2.6 : 1.2;
      const pairMeters = Number(((horizDist + verticalRun) * wasteMult).toFixed(1));
      const condMeters = Number(((2.8 + horizDist * 0.35) * wasteMult).toFixed(1));
      refrigerantPairRaw += pairMeters;
      condensateRaw += condMeters;
      commCableRaw += pairMeters;

      hvacTerminals.push({
        id: f.id,
        name: f.name,
        kind,
        roomName: ownerRoom?.name ?? 'Ambiente',
        x: f.x,
        y: f.y,
        distanceM: Number(horizDist.toFixed(1)),
        circuitType: 'gas',
        pipeDescription: 'Rame frigorifero coibentato (Ø 1/4" + 3/8")',
        pipeMeters: pairMeters,
        condensateMeters: condMeters,
      });
    }
  }

  const heatingManifoldWays = hvacTerminals.filter((t) => t.circuitType === 'water').length;
  const hasHydronicSystem =
    heatingManifoldWays > 0 || hasMonoblocWater || hasBoilerGas || hasBoilerPellet;

  // Dorsale primaria di diametro maggiorato (Ø26 o Ø32 mm coibentato, mandata + ritorno × 2)
  // collega la Pompa di Calore / Caldaia al Collettore Riscaldamento!
  const primaryTrunkDistanceM = primaryGeneratorAnchor
    ? Number(Math.max(1.5, manhattan(primaryGeneratorAnchor, config.heatingManifoldPosition)).toFixed(1))
    : hasHydronicSystem
      ? 4.0
      : 0;
  const primaryTrunkPipeMeters = hasHydronicSystem
    ? Math.ceil((primaryTrunkDistanceM + 1.8) * 2 * wasteMult)
    : 0;
  const monoblocPrimaryPipeMeters = primaryTrunkPipeMeters;

  // Se l'utente ha selezionato PdC Splittata (gas) senza ancora posizionare gli split, stima una tratta minima verso unità interna
  if (hasSplitGas && refrigerantPairRaw === 0) {
    refrigerantPairRaw = Number((6 * wasteMult).toFixed(1));
    condensateRaw += Number((3 * wasteMult).toFixed(1));
    commCableRaw += Number((6 * wasteMult).toFixed(1));
  }

  // Tubo Gas certificato UNI 7129 (solo se Caldaia a Gas attiva)
  const gasBoilerGen = generators.find((g) => g.kind === 'boiler_gas');
  const gasPipeMeters = hasBoilerGas
    ? Math.ceil(
        (Math.max(
          4,
          manhattan(config.panelPosition, gasBoilerGen ?? config.heatingManifoldPosition) * 0.9
        ) +
          2) *
          wasteMult
      )
    : 0;

  // Canna fumaria (Pellet Ø80 mm oppure Coassiale Ø60/100 mm per Caldaia a Gas)
  let fluePipeMeters = 0;
  let fluePipeLabel = 'Non richiesta (impianto elettrico PdC)';
  if (hasBoilerPellet && hasBoilerGas) {
    fluePipeMeters = 6;
    fluePipeLabel = 'Canna fumaria Pellet Ø80 mm (4,5 m) + Scarico fumi Gas Ø60/100 (1,5 m)';
  } else if (hasBoilerPellet) {
    fluePipeMeters = 5;
    fluePipeLabel = 'Canna fumaria inox doppia parete coibentata Ø 80 mm (Pellet)';
  } else if (hasBoilerGas) {
    fluePipeMeters = 2;
    fluePipeLabel = 'Kit scarico fumi coassiale Ø 60/100 mm (Caldaia a Gas)';
  }

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
      generatorToWaterManifoldMeters,
      totalSupplyMeters,
      drain40_50Meters,
      drain110Meters,
      totalDrainMeters,
      estimatedFittings,
      manifoldWaysCold,
      manifoldWaysHot,
    },
    hvac: {
      generators,
      terminals: hvacTerminals,
      activeGeneratorSummary,
      splitFluid,
      hasMonoblocWater,
      hasSplitGas,
      hasBoilerGas,
      hasBoilerPellet,
      heatingWaterPipeMeters: Math.ceil(heatingWaterRaw),
      heatingWaterPipeLabel,
      primaryTrunkPipeMeters,
      primaryTrunkDiameterMm: config.primaryPipeDiameterMm,
      primaryTrunkDistanceM,
      primaryGeneratorAnchor,
      heatingManifoldWays,
      monoblocPrimaryPipeMeters,
      refrigerantCopperPairMeters: Math.ceil(refrigerantPairRaw),
      condensateDrainMeters: Math.ceil(condensateRaw),
      gasPipeMeters,
      fluePipeMeters,
      fluePipeLabel,
      commCable4g15Meters: Math.ceil(commCableRaw),
      radiatorValveKits,
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
    ['=== RISCALDAMENTO & CLIMATIZZAZIONE ==='],
    ['Voce', 'Tipo tubo / Dettaglio', 'Quantità', 'Unità'],
    ['Generatore attivo', estimate.hvac.activeGeneratorSummary, String(estimate.hvac.generators.length), 'n.'],
    ['Terminali rilevati (split / termosifoni)', `Split a ${estimate.hvac.splitFluid === 'water' ? 'circolazione acqua' : 'gas refrigerante'}`, String(estimate.hvac.terminals.length), 'n.'],
    ['Dorsale primaria Generatore → Collettore Riscaldamento (A+R)', `Tubo maggiorato coibentato Ø ${estimate.hvac.primaryTrunkDiameterMm} mm`, String(estimate.hvac.primaryTrunkPipeMeters), 'm'],
    ['Diramazioni Collettore Riscaldamento → Terminali (A+R)', estimate.hvac.heatingWaterPipeLabel, String(estimate.hvac.heatingWaterPipeMeters), 'm'],
    ['Collettore Riscaldamento (vie richieste)', 'Mandata + Ritorno con flussimetri', String(estimate.hvac.heatingManifoldWays), 'vie'],
    ['Tubo rame frigorifero coibentato (coppia)', 'Linea liquido Ø 1/4" + gas Ø 3/8" (PdC Splittata / Split)', String(estimate.hvac.refrigerantCopperPairMeters), 'm'],
    ['Tubo scarico condensa Ø 20 mm', 'Per split a parete / fan-coil', String(estimate.hvac.condensateDrainMeters), 'm'],
    ['Cavo comunicazione 4G1,5 mm²', 'Collegamento unità esterna ↔ split', String(estimate.hvac.commCable4g15Meters), 'm'],
    ['Tubo Gas certificato UNI 7129', 'Rame Ø 18-22 / Multistrato giallo (Caldaia a Gas)', String(estimate.hvac.gasPipeMeters), 'm'],
    ['Scarico fumi / Canna fumaria', estimate.hvac.fluePipeLabel, String(estimate.hvac.fluePipeMeters), 'm'],
    ['Kit valvole + detentori radiatori', 'Per termosifoni e scaldasalviette', String(estimate.hvac.radiatorValveKits), 'kit'],
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

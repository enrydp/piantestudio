/**
 * Tipi TypeScript principali per PianteStudio.
 * Tutte le coordinate geometriche (muri, aperture, mobili) sono espresse in METRI REALI.
 */

export type WizardStep = 0 | 1 | 2 | 3;

export type Point2D = {
  /** Coordinata X in metri reali */
  x: number;
  /** Coordinata Y in metri reali */
  y: number;
};

/** Immagine della piantina di riferimento caricata nello Step 0 */
export interface FloorplanImage {
  /** Data URL base64 (PNG/JPEG o prima pagina PDF renderizzata) */
  dataUrl: string;
  /** Nome file originale */
  fileName: string;
  /** Larghezza originale dell'immagine in pixel */
  widthPx: number;
  /** Altezza originale dell'immagine in pixel */
  heightPx: number;
  /** Opacità di visualizzazione sul canvas (0..1) */
  opacity: number;
}

/** Dati di calibrazione della scala */
export interface CalibrationData {
  /** Primo punto cliccato sull'immagine (in pixel immagine) */
  pointA: Point2D | null;
  /** Secondo punto cliccato sull'immagine (in pixel immagine) */
  pointB: Point2D | null;
  /** Lunghezza reale inserita dall'utente in centimetri */
  realLengthCm: number | null;
  /** Scala risultante: quanti pixel immagine corrispondono a 1 metro reale */
  pixelsPerMeter: number;
  /** Indica se l'utente ha completato la calibrazione */
  isCalibrated: boolean;
}

/** Segmento muro tracciato in pianta */
export interface Wall {
  id: string;
  /** Punto iniziale in metri */
  start: Point2D;
  /** Punto finale in metri */
  end: Point2D;
  /** Spessore muro in metri (default 0.20 = 20 cm) */
  thickness: number;
  /** Altezza muro in metri (default 2.70 = 270 cm) */
  height: number;
  /** Se true, il muro è stato abbattuto (ristrutturazione: tratteggiato in 2D, rimosso in 3D) */
  demolished?: boolean;
}

/** Tipologie di aperture disponibili nello Step 1 */
export type OpeningType =
  | 'door_internal'
  | 'door_entrance'
  | 'window'
  | 'french_window'
  | 'arch';

/** Verso di apertura per le porte */
export type DoorSwing = 'left_in' | 'right_in' | 'left_out' | 'right_out';

/** Stile costruttivo per le porte */
export type DoorStyle = 'single' | 'double' | 'sliding' | 'glass';

/** Apertura (porta, finestra, portafinestra, arco) agganciata a un muro */
export interface Opening {
  id: string;
  /** ID del muro a cui è agganciata l'apertura */
  wallId: string;
  /** Tipologia apertura */
  type: OpeningType;
  /** Posizione normalizzata lungo il muro (0 = inizio, 1 = fine), riferita al centro dell'apertura */
  position: number;
  /** Larghezza apertura in metri */
  width: number;
  /** Altezza apertura in metri */
  height: number;
  /** Altezza da terra (davanzale) in metri */
  sillHeight: number;
  /** Verso di apertura (usato per le porte a battente) */
  swing: DoorSwing;
  /** Stile porta: singola, doppia anta, scorrevole, con vetro */
  doorStyle?: DoorStyle;
  /** Colore / finitura personalizzata HEX per porta o infisso */
  color?: string;
}

export type FurnitureCategory =
  | 'Soggiorno'
  | 'Cucina'
  | 'Camera'
  | 'Bagno'
  | 'Scale'
  | 'Altro';

export type FurnitureMaterial =
  | 'wood'
  | 'fabric'
  | 'leather'
  | 'metal'
  | 'ceramic'
  | 'matte';

export type FurnitureGeometryType =
  | 'sofa_2'
  | 'sofa_3'
  | 'armchair'
  | 'coffee_table'
  | 'tv_stand'
  | 'bookshelf'
  | 'kitchen_linear'
  | 'kitchen_island'
  | 'dining_table'
  | 'chair'
  | 'bed_single'
  | 'bed_double'
  | 'nightstand'
  | 'wardrobe'
  | 'dresser'
  | 'sink'
  | 'wc'
  | 'shower'
  | 'bathtub'
  | 'desk'
  | 'washing_machine'
  | 'plant'
  | 'stairs_straight'
  | 'stairs_l'
  | 'stairs_u';

/** Elemento del catalogo mobili JSON (dimensioni in cm) */
export interface FurnitureCatalogItem {
  id: string;
  nome: string;
  categoria: FurnitureCategory;
  dimensioni: {
    width: number;  // cm
    depth: number;  // cm
    height: number; // cm
  };
  coloreDefault: string;
  materialeDefault: FurnitureMaterial;
  tipoGeometria: FurnitureGeometryType;
  /** Percorso opzionale a modello .glb */
  glbUrl?: string;
}

export type StairsFirstFlight = 'left' | 'right';

/** Istanza di un mobile posizionata nella piantina */
export interface Furniture {
  id: string;
  /** Riferimento all'id del catalogo */
  catalogId: string;
  /** Nome visualizzato */
  name: string;
  /** Categoria */
  category: FurnitureCategory;
  /** Tipo di geometria procedurale */
  geometryType: FurnitureGeometryType;
  /** Centro X in metri */
  x: number;
  /** Centro Y in metri */
  y: number;
  /** Larghezza in metri */
  width: number;
  /** Profondità in metri */
  depth: number;
  /** Altezza in metri */
  height: number;
  /** Rotazione in gradi (oraria in vista 2D) */
  rotation: number;
  /** Colore principale HEX */
  color: string;
  /** Tipo materiale PBR */
  material: FurnitureMaterial;
  /** Lato della prima rampa per le scale a L e a U ('left' | 'right') */
  stairsFirstFlight?: StairsFirstFlight;
  /** URL / Data URL opzionale di un modello .glb personalizzato */
  customGlbUrl?: string;
  /** Nome file del modello .glb personalizzato */
  customGlbName?: string;
}

export type FloorTextureType = 'parquet' | 'piastrelle' | 'cemento';
export type CameraMode3D = 'orbit' | 'top' | 'dollhouse' | 'first_person';

/** Impostazioni di rendering 3D (Step 3) */
export interface RenderSettings {
  /** Ora del giorno (6..21) per direzione e colore del sole */
  timeOfDay: number;
  /** Modalità di vista 3D */
  cameraMode: CameraMode3D;
  /** Texture del pavimento */
  floorTexture: FloorTextureType;
  /** Colore principale del pavimento HEX (personalizzabile per piastrelle, parquet e cemento) */
  floorColor?: string;
  /** Colore pareti HEX */
  wallColor: string;
  /** Mostra griglia di riferimento */
  showGrid3D: boolean;
  /** Mostra sagoma traslucida dei muri abbattuti in 3D (confronto prima/dopo) */
  showDemolishedWalls3D?: boolean;
}

/** Strumenti attivi nell'editor 2D */
export type EditorTool =
  | 'select'
  | 'pan'
  | 'calibrate'
  | 'wall'
  | 'demolish'
  | 'place_opening';

/** Snapshot modificabile del progetto (salvato in Undo/Redo e JSON) */
export interface ProjectData {
  name: string;
  version: string;
  floorplan: FloorplanImage | null;
  calibration: CalibrationData;
  walls: Wall[];
  openings: Opening[];
  furniture: Furniture[];
  renderSettings: RenderSettings;
}

/** Configurazione di default per ogni tipo di apertura (misure in metri) */
export interface OpeningPreset {
  type: OpeningType;
  label: string;
  shortLabel: string;
  width: number;
  height: number;
  sillHeight: number;
  hasSwing: boolean;
}

export const OPENING_PRESETS: Record<OpeningType, OpeningPreset> = {
  door_internal: {
    type: 'door_internal',
    label: 'Porta interna',
    shortLabel: 'Porta int.',
    width: 0.8,
    height: 2.1,
    sillHeight: 0,
    hasSwing: true,
  },
  door_entrance: {
    type: 'door_entrance',
    label: "Porta d'ingresso",
    shortLabel: 'Ingresso',
    width: 0.9,
    height: 2.15,
    sillHeight: 0,
    hasSwing: true,
  },
  window: {
    type: 'window',
    label: 'Finestra',
    shortLabel: 'Finestra',
    width: 1.2,
    height: 1.4,
    sillHeight: 0.9,
    hasSwing: false,
  },
  french_window: {
    type: 'french_window',
    label: 'Portafinestra',
    shortLabel: 'Portafin.',
    width: 1.4,
    height: 2.2,
    sillHeight: 0,
    hasSwing: false,
  },
  arch: {
    type: 'arch',
    label: 'Arco / Apertura libera',
    shortLabel: 'Arco',
    width: 1.2,
    height: 2.2,
    sillHeight: 0,
    hasSwing: false,
  },
};

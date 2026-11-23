# PianteStudio

Applicazione web client-side per progettare planimetrie 2D a partire da una piantina (PNG, JPG o PDF), inserire porte e finestre, arredare gli ambienti con controllo collisioni e visualizzare/esportare il risultato in 3D realistico.

## Funzionalità principali

### Step 0 — Caricamento e preparazione
- **Upload drag & drop** di immagini (`PNG`, `JPG`, `WebP`) o **PDF (prima pagina)** renderizzato lato client con `pdfjs-dist`, più generatore di piantina d'esempio integrato.
- **Navigazione fluida** su canvas Konva 2D con zoom centrato sul cursore (rotella) e pan (trascinamento o `Spazio + trascina`).
- **Calibrazione scala reale**: clicca due punti su una quota nota e inserisci la lunghezza in `cm` per lavorare interamente in metri reali.
- **Tracciatura muri a polilinea**: snap automatico agli angoli di `90°` (disattivabile tenendo premuto `Shift`), snap ai vertici esistenti, spessore (default `20 cm`) e altezza (default `270 cm`) configurabili, spostamento vertici, eliminazione e Undo/Redo.

### Step 1 — Finestre e aperture
- **Palette aperture**: porta interna (`80×210 cm`), porta d'ingresso (`90×215 cm`), finestra (`120×140 cm`, davanzale `90 cm`), portafinestra (`140×220 cm`), arco / apertura libera (`120×220 cm`).
- **Aggancio automatico ai muri**: trascina o clicca su un muro per inserire e orientare automaticamente l'apertura lungo il segmento.
- **Proprietà modificabili**: larghezza, altezza, altezza da terra (davanzale), verso di apertura per le porte, duplicazione, eliminazione e Undo/Redo.

### Step 2 — Arredamento
- **Catalogo JSON estendibile** (`src/data/furnitureCatalog.json`) filtrabile per categoria (`Soggiorno`, `Cucina`, `Camera`, `Bagno`, `Altro`) e ricerca testuale.
- **Drag & drop** dal catalogo alla pianta con rotazione (maniglia grafica o tasti `R` / `Shift+R`), snap alla griglia (`10 cm`) e ai muri.
- **Avviso visivo rosso** in tempo reale in caso di sovrapposizione con altri mobili o blocco del raggio di apertura di una porta.
- **Proprietà modificabili**: colore, materiale, dimensioni, rotazione, caricamento opzionale di modelli 3D personalizzati `.glb`.
- **Selezione multipla**, copia/incolla (`Ctrl+C` / `Ctrl+V`), elimina e Undo/Redo.

### Step 3 — Rendering 3D
- **Geometria 3D automatica** con fori reali nei muri generati tramite CSG (`three-bvh-csg`), infissi con vetri/ante/maniglie e mobili procedurali Three.js (o `.glb` personalizzati).
- **Illuminazione realistica** con ombre morbide, environment map procedurale e slider dell'ora del giorno (`06:00–21:00`).
- **4 modalità di vista**: Orbita libera, Vista dall'alto, Casa di bambola (tetto nascosto), Prima persona con `WASD`.
- **Materiali**: texture pavimento (`Parquet`, `Piastrelle`, `Cemento`) e colore pareti personalizzabile.
- **Esportazioni**: immagine PNG ad alta risoluzione, modello 3D `.glb`, salvataggio/caricamento progetto `.json` e persistenza automatica in `localStorage`.

## Stack tecnologico
- React 18 + TypeScript + Vite
- Konva (`react-konva`) per l'editor 2D
- Three.js (`@react-three/fiber`, `@react-three/drei`, `three-bvh-csg`) per il 3D
- Zustand per lo stato globale e Undo/Redo
- Tailwind CSS v4 per l'interfaccia (tema chiaro/scuro)
- `pdfjs-dist` per il caricamento della prima pagina PDF

## Avvio in locale

```bash
npm install
npm run dev
```

L'applicazione sarà disponibile su `http://localhost:5173`.

Per compilare la versione di produzione:

```bash
npm run build
npm run preview
```

## Pubblicazione online (GitHub Pages)

Il progetto è interamente lato client e include il workflow automatico [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) per il deploy su **GitHub Pages** a ogni push sul branch `main`.
Dopo aver caricato il repository su GitHub, attiva **Settings → Pages → Source: GitHub Actions** per rendere l'app raggiungibile online su `https://<utente>.github.io/<nome-repo>/`.

## Struttura del codice

```text
src/
├── components/   # Wizard superiore, toolbar sinistra, pannello proprietà, toast, modali
├── editor2d/     # Canvas Konva 2D, layer muri, aperture e arredamento
├── viewer3d/     # Scena Three.js/R3F, muri CSG, infissi, mobili procedurali e .glb
├── store/        # Store Zustand globale con Undo/Redo e localStorage
├── data/         # Catalogo mobili JSON estendibile
├── types/        # Tipi TypeScript (Wall, Opening, Furniture, Project)
└── utils/        # Geometria 2D/SAT, scala, CSG, texture procedurali, PDF, export 3D
```

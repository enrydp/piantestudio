/**
 * Step 4 — Sezione "Impianti & Vernice":
 * - Mini-pianta interattiva per posizionare Quadro Elettrico (⚡) e Collettore/Caldaia (💧)
 * - Calcolo geometrico in tempo reale di:
 *   1) Impianto Elettrico: punti luce, prese, scatole, metri di cavo divisi per sezione (1,5 / 2,5 / 4 / 6 mm²) e corrugati
 *   2) Impianto Idraulico: tubi Multistrato / PEX / PPR / Rame (fredda, calda, dorsale) + scarichi Ø40/50 e Ø110 mm
 *   3) Pittura Pareti: m² netti (sottratte aperture), soffitto opzionale, kg di vernice, litri, secchi e fissativo
 * - Analisi avanzata opzionale tramite Google Gemini API Key (condivisa con la modale Foto AI)
 * - Esportazione immediata CSV (Excel) e Stampa / PDF
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Droplets,
  ExternalLink,
  KeyRound,
  Loader2,
  Paintbrush,
  Printer,
  Sparkles,
  Thermometer,
  Zap,
} from 'lucide-react';
import rawCatalog from '../data/furnitureCatalog.json';
import { useProjectStore } from '../store/useProjectStore';
import type { FurnitureCatalogItem, Point2D } from '../types/project';
import { detectRooms } from '../utils/rooms';
import {
  PAINT_TYPE_PRESETS,
  PIPE_MATERIAL_LABELS,
  buildMepCsv,
  estimateMepAndPaint,
  getDefaultServicePoints,
  type CeiLevel,
  type HvacGeneratorOverride,
  type MepConfig,
  type PaintType,
  type PipeMaterial,
  type SplitFluidMode,
  type WallSidesMode,
} from '../utils/mepEstimator';
import { MepBlueprintCanvas } from './MepBlueprintCanvas';

const CATALOG = rawCatalog as FurnitureCatalogItem[];

const GEMINI_KEY_STORAGE = 'piantestudio_gemini_api_key_v1';

export type MepTabId = 'all' | 'electrical' | 'plumbing' | 'hvac' | 'paint' | 'ai';

interface MepEstimatorViewProps {
  activeTab: MepTabId;
  onChangeTab: (tab: MepTabId) => void;
}

export const MepEstimatorView: React.FC<MepEstimatorViewProps> = ({
  activeTab,
  onChangeTab,
}) => {
  const {
    project,
    addFurnitureFromCatalog,
    updateFurniture,
    deleteFurnitureIds,
    showToast,
  } = useProjectStore();

  const rooms = useMemo(
    () => detectRooms(project.walls, project.furniture),
    [project.walls, project.furniture]
  );

  const defaults = useMemo(
    () => getDefaultServicePoints(project, rooms),
    [project, rooms]
  );

  const [config, setConfig] = useState<MepConfig>(() => ({
    ceiLevel: 'livello2',
    panelPosition: defaults.panelPosition,
    includeInduction: true,
    includeAcLine: true,
    pipeMaterial: 'multistrato',
    waterManifoldPosition: defaults.waterManifoldPosition,
    includeHotWater: true,
    includeDrains: true,
    heatingManifoldPosition: defaults.heatingManifoldPosition,
    primaryPipeDiameterMm: 26,
    hvacGeneratorOverride: 'auto',
    splitFluidMode: 'auto',
    paintType: 'lavabile',
    wallSides: 'auto',
    coats: 2,
    includeCeiling: true,
    includePrimer: true,
    yieldSqmPerLiter: PAINT_TYPE_PRESETS.lavabile.defaultYield,
    paintDensityKgPerL: PAINT_TYPE_PRESETS.lavabile.defaultDensity,
    bucketKg: 20,
    wastePct: 15,
  }));

  const [hasCustomPanel, setHasCustomPanel] = useState(false);
  const [hasCustomWaterManifold, setHasCustomWaterManifold] = useState(false);
  const [hasCustomHeatingManifold, setHasCustomHeatingManifold] = useState(false);
  const [waterManifoldRemoved, setWaterManifoldRemoved] = useState(false);
  const [heatingManifoldRemoved, setHeatingManifoldRemoved] = useState(false);

  // Se l'utente inserisce un collettore nello Step 2, riattivalo automaticamente anche in Step 4
  useEffect(() => {
    if (defaults.placedWaterManifoldId) setWaterManifoldRemoved(false);
  }, [defaults.placedWaterManifoldId]);

  useEffect(() => {
    if (defaults.placedHeatingManifoldId) setHeatingManifoldRemoved(false);
  }, [defaults.placedHeatingManifoldId]);

  // Mantieni sincronizzati i punti con i collettori reali posizionati in pianta (o default finché non spostati)
  useEffect(() => {
    setConfig((prev) => ({
      ...prev,
      panelPosition: hasCustomPanel ? prev.panelPosition : defaults.panelPosition,
      waterManifoldPosition:
        defaults.placedWaterManifoldId || !hasCustomWaterManifold
          ? defaults.waterManifoldPosition
          : prev.waterManifoldPosition,
      heatingManifoldPosition:
        defaults.placedHeatingManifoldId || !hasCustomHeatingManifold
          ? defaults.heatingManifoldPosition
          : prev.heatingManifoldPosition,
    }));
  }, [defaults, hasCustomPanel, hasCustomWaterManifold, hasCustomHeatingManifold]);

  const estimate = useMemo(
    () => estimateMepAndPaint(project, rooms, config),
    [project, rooms, config]
  );

  // Stato Google Gemini AI (stessa chiave usata nella modale Foto Realistica)
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem(GEMINI_KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  });
  const [aiNotes, setAiNotes] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [copiedAi, setCopiedAi] = useState(false);

  const handleSaveApiKey = (val: string) => {
    setApiKey(val);
    try {
      if (val.trim()) localStorage.setItem(GEMINI_KEY_STORAGE, val.trim());
      else localStorage.removeItem(GEMINI_KEY_STORAGE);
    } catch {
      // ignore
    }
  };

  const handleExportCsv = () => {
    const csv = buildMepCsv(estimate, project.name || 'PianteStudio');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (project.name || 'progetto').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `${safeName}-computo-impianti-vernice.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Computo esportato in CSV (compatibile Excel)!', 'success');
  };

  const handlePrintReport = () => {
    const win = window.open('', '_blank', 'width=900,height=720');
    if (!win) {
      window.print();
      return;
    }
    const cableRows = estimate.electrical.cables
      .map(
        (c) =>
          `<tr><td><strong>${c.sectionMm2}</strong></td><td>${c.usage}</td><td>${c.recommendedBreaker}</td><td style="text-align:right"><strong>${c.meters} m</strong></td></tr>`
      )
      .join('');
    const roomRows = estimate.electrical.byRoom
      .map(
        (r) =>
          `<tr><td>${r.roomName}</td><td>${r.areaSqm} m²</td><td style="text-align:center">${r.lightPoints}</td><td style="text-align:center">${r.standardOutlets}</td><td style="text-align:center">${r.dedicatedOutlets}</td><td style="text-align:center">${r.tvDataPoints}</td></tr>`
      )
      .join('');
    const fixtureRows = estimate.plumbing.fixtures
      .map(
        (f) =>
          `<tr><td>${f.name}</td><td>${f.roomName}</td><td style="text-align:right">${f.coldPipeM} m</td><td style="text-align:right">${f.hotPipeM} m</td><td style="text-align:right">${f.drainPipeM} m (Ø${f.drainDiameterMm})</td></tr>`
      )
      .join('');
    const hvacRows = estimate.hvac.terminals
      .map(
        (t) =>
          `<tr><td>${t.name}</td><td>${t.roomName}</td><td>${t.pipeDescription}</td><td style="text-align:right"><strong>${t.pipeMeters} m</strong></td><td style="text-align:right">${t.condensateMeters > 0 ? `${t.condensateMeters} m` : '—'}</td></tr>`
      )
      .join('');
    const aiHtml = aiReport
      ? `<h2>Analisi Tecnica Google Gemini AI</h2><div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #cbd5e1;padding:12px;border-radius:8px;font-size:12px;line-height:1.5">${aiReport.replace(/</g, '&lt;')}</div>`
      : '';

    win.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Computo ${project.name}</title>
      <style>
        body{font-family:system-ui,-apple-system,sans-serif;color:#0f172a;padding:24px;max-width:860px;margin:0 auto;}
        h1{margin:0 0 4px;font-size:22px;} h2{margin:22px 0 8px;font-size:15px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;}
        .meta{color:#475569;font-size:12px;margin-bottom:16px;}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px;}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;}
        th{background:#f1f5f9;}
        .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0;}
        .card{border:1px solid #cbd5e1;border-radius:8px;padding:10px;}
        .card small{color:#64748b;display:block;font-size:11px;}
        .card strong{font-size:18px;}
        .note{margin-top:18px;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:8px;}
      </style></head><body>
      <h1>Computo Impianti e Pittura — ${project.name}</h1>
      <div class="meta">Superficie calpestabile stimata: ${estimate.totalFloorAreaSqm} m² • Stanze rilevate: ${estimate.roomCount} • Margine sfrido: +${config.wastePct}%</div>
      <div class="kpi">
        <div class="card"><small>Punti luce / Prese</small><strong>${estimate.electrical.totalLightPoints} / ${estimate.electrical.totalOutlets}</strong></div>
        <div class="card"><small>Cavi elettrici totali</small><strong>${estimate.electrical.totalCableMeters} m</strong></div>
        <div class="card"><small>Tubi ${estimate.plumbing.pipeMaterialLabel}</small><strong>${estimate.plumbing.totalSupplyMeters} m</strong></div>
        <div class="card"><small>Vernice pareti (${config.coats} mani)</small><strong>${estimate.paint.paintKg} kg</strong></div>
      </div>
      <h2>1. Impianto Elettrico (${config.ceiLevel.toUpperCase()})</h2>
      <table><thead><tr><th>Sezione</th><th>Utilizzo</th><th>Protezione indicativa</th><th>Lunghezza</th></tr></thead><tbody>${cableRows}</tbody></table>
      <p style="font-size:12px">Corrugato Ø20 mm: <strong>${estimate.electrical.corrugated20M} m</strong> • Corrugato Ø25 mm: <strong>${estimate.electrical.corrugated25M} m</strong> • Scatole 503: <strong>${estimate.electrical.boxes503}</strong> • Cassette derivazione: <strong>${estimate.electrical.junctionBoxes}</strong></p>
      <table><thead><tr><th>Stanza</th><th>Area</th><th>Punti luce</th><th>Prese std</th><th>Prese ded.</th><th>TV/Dati</th></tr></thead><tbody>${roomRows}</tbody></table>
      <h2>2. Impianto Idraulico (${estimate.plumbing.pipeMaterialLabel})</h2>
      <p style="font-size:12px">Acqua fredda Ø16: <strong>${estimate.plumbing.coldBranchMeters} m</strong> • Acqua calda Ø16: <strong>${estimate.plumbing.hotBranchMeters} m</strong> • Dorsale Ø20: <strong>${estimate.plumbing.mainSupplyMeters} m</strong> • Scarichi Ø40/50: <strong>${estimate.plumbing.drain40_50Meters} m</strong> • Scarichi Ø110: <strong>${estimate.plumbing.drain110Meters} m</strong></p>
      ${fixtureRows ? `<table><thead><tr><th>Utenza</th><th>Stanza</th><th>Fredda</th><th>Calda</th><th>Scarico</th></tr></thead><tbody>${fixtureRows}</tbody></table>` : '<p style="font-size:12px">Nessun sanitario/punto acqua posizionato in pianta.</p>'}
      <h2>2B. Riscaldamento & Climatizzazione (${estimate.hvac.activeGeneratorSummary})</h2>
      <p style="font-size:12px">Tubo riscaldamento/idronico (A+R): <strong>${estimate.hvac.heatingWaterPipeMeters} m</strong> (${estimate.hvac.heatingWaterPipeLabel}) • Dorsale PdC Monoblocco Ø26: <strong>${estimate.hvac.monoblocPrimaryPipeMeters} m</strong> • Rame frigo coibentato 1/4"+3/8": <strong>${estimate.hvac.refrigerantCopperPairMeters} m</strong> • Condensa Ø20: <strong>${estimate.hvac.condensateDrainMeters} m</strong> • Tubo Gas UNI 7129: <strong>${estimate.hvac.gasPipeMeters} m</strong> • Scarico fumi: <strong>${estimate.hvac.fluePipeMeters} m</strong> (${estimate.hvac.fluePipeLabel})</p>
      ${hvacRows ? `<table><thead><tr><th>Terminale</th><th>Stanza</th><th>Tipo tubo</th><th>Lunghezza</th><th>Condensa</th></tr></thead><tbody>${hvacRows}</tbody></table>` : ''}
      <h2>3. Pittura Pareti (${PAINT_TYPE_PRESETS[config.paintType].label})</h2>
      <p style="font-size:12px">Pareti lorde: ${estimate.paint.grossWallSqm} m² • Aperture sottratte: -${estimate.paint.openingsSubtractedSqm} m² • Pareti nette: <strong>${estimate.paint.netWallSqm} m²</strong> • Soffitto: <strong>${estimate.paint.ceilingSqm} m²</strong> • Totale: <strong>${estimate.paint.totalSurfaceSqm} m²</strong> (${config.coats} mani)<br/>
      Vernice necessaria: <strong>${estimate.paint.paintKg} kg</strong> (${estimate.paint.paintLiters} L) → consigliati <strong>${estimate.paint.bucketCount} secchi da ${estimate.paint.bucketKg} kg</strong>${config.includePrimer ? ` • Fissativo: <strong>${estimate.paint.primerKg} kg</strong> (${estimate.paint.primerLiters} L)` : ''}.</p>
      ${aiHtml}
      <div class="note">Stima preliminare di cantiere generata da PianteStudio. Per l'esecuzione definitiva e le certificazioni (DiCo) fare sempre riferimento a tecnici e installatori abilitati.</div>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  /** Chiama Google Gemini API usando la stessa API Key dell'utente per una relazione tecnica dettagliata */
  const handleAnalyzeWithGemini = async () => {
    const key = apiKey.trim();
    if (!key) {
      setAiError('Inserisci la tua Google Gemini API Key per generare l’analisi tecnica con AI.');
      return;
    }

    setAiLoading(true);
    setAiError(null);

    const promptText = [
      'Sei un perito impiantista e tecnico di cantiere italiano esperto in ristrutturazioni residenziali (CEI 64-8, impianti idrici multistrato/PEX/rame, tinteggiatura).',
      'Analizza i dati geometrici reali del progetto estratti dalla piantina e fornisci un computo dettagliato, chiaro e pratico in italiano.',
      '',
      `PROGETTO: ${project.name}`,
      `Superficie calpestabile: ${estimate.totalFloorAreaSqm} m² (${estimate.roomCount} stanze)`,
      `Muri attivi: ${project.walls.filter((w) => !w.demolished).length}, Aperture: ${project.openings.length}, Mobili/Sanitari: ${project.furniture.length}`,
      '',
      'STANZE E PUNTI ELETTRICI STIMATI:',
      ...estimate.electrical.byRoom.map(
        (r) =>
          `- ${r.roomName} (${r.areaSqm} m², distanza dal quadro ${r.distanceFromPanelM} m): ${r.lightPoints} punti luce, ${r.standardOutlets} prese standard, ${r.dedicatedOutlets} prese dedicate, ${r.tvDataPoints} TV/dati`
      ),
      'CAVI ELETTRICI STIMATI:',
      ...estimate.electrical.cables.map(
        (c) => `- Sezione ${c.sectionMm2}: ${c.meters} m (${c.usage})`
      ),
      `Corrugati: Ø20 mm = ${estimate.electrical.corrugated20M} m, Ø25 mm = ${estimate.electrical.corrugated25M} m; Scatole 503 = ${estimate.electrical.boxes503}`,
      '',
      `IMPIANTO IDRAULICO (tubo scelto: ${estimate.plumbing.pipeMaterialLabel}):`,
      estimate.plumbing.fixtures.length > 0
        ? estimate.plumbing.fixtures
            .map(
              (f) =>
                `- ${f.name} (${f.roomName}, dist. collettore ${f.distanceFromManifoldM} m): fredda ${f.coldPipeM} m, calda ${f.hotPipeM} m, scarico Ø${f.drainDiameterMm} = ${f.drainPipeM} m`
            )
            .join('\n')
        : '- Nessun sanitario posizionato ancora in pianta',
      `Totali idraulica: fredda Ø16 = ${estimate.plumbing.coldBranchMeters} m, calda Ø16 = ${estimate.plumbing.hotBranchMeters} m, dorsale Ø20 = ${estimate.plumbing.mainSupplyMeters} m, scarichi Ø40/50 = ${estimate.plumbing.drain40_50Meters} m, Ø110 = ${estimate.plumbing.drain110Meters} m`,
      '',
      `RISCALDAMENTO & CLIMATIZZAZIONE (${estimate.hvac.activeGeneratorSummary}):`,
      `- Fluido split: ${estimate.hvac.splitFluid === 'water' ? 'Acqua (idronico/monoblocco)' : 'Gas refrigerante (splittata)'}`,
      `- Tubo riscaldamento/idronico (A+R): ${estimate.hvac.heatingWaterPipeMeters} m (${estimate.hvac.heatingWaterPipeLabel})`,
      `- Dorsale primaria PdC Monoblocco Ø26: ${estimate.hvac.monoblocPrimaryPipeMeters} m`,
      `- Rame frigorifero coibentato (coppia 1/4" + 3/8"): ${estimate.hvac.refrigerantCopperPairMeters} m, condensa Ø20: ${estimate.hvac.condensateDrainMeters} m, cavo 4G1,5: ${estimate.hvac.commCable4g15Meters} m`,
      `- Tubo Gas UNI 7129: ${estimate.hvac.gasPipeMeters} m, Fumi: ${estimate.hvac.fluePipeMeters} m (${estimate.hvac.fluePipeLabel})`,
      estimate.hvac.terminals.length > 0
        ? estimate.hvac.terminals.map((t) => `- Terminale: ${t.name} (${t.roomName}) → ${t.pipeMeters} m ${t.pipeDescription}`).join('\n')
        : '- Nessun terminale clima/termosifone posizionato',
      '',
      `PITTURA (${PAINT_TYPE_PRESETS[config.paintType].label}, ${config.coats} mani):`,
      `- Pareti nette: ${estimate.paint.netWallSqm} m² (sottratti ${estimate.paint.openingsSubtractedSqm} m² di aperture), Soffitto: ${estimate.paint.ceilingSqm} m², Totale: ${estimate.paint.totalSurfaceSqm} m²`,
      `- Vernice stimata: ${estimate.paint.paintKg} kg (${estimate.paint.paintLiters} L → ${estimate.paint.bucketCount} secchi da ${estimate.paint.bucketKg} kg), Fissativo: ${estimate.paint.primerKg} kg`,
      aiNotes.trim() ? `\nNOTE AGGIUNTIVE DELL'UTENTE: ${aiNotes.trim()}` : '',
      '',
      'Struttura la risposta in 4 sezioni concise con elenchi puntati:',
      '1. Verifica Impianto Elettrico e composizione consigliata del Quadro Elettrico (differenziali e magnetotermici).',
      '2. Lista materiali e raccordi per Impianto Idraulico (collettore, curve, valvole, scarichi) e suggerimenti pratici.',
      '3. Lista materiali per Pittura (secchi vernice in kg, fissativo, stucco, nastro, teli) e resa.',
      '4. Eventuali controlli/avvertenze normative (es. zone bagno, linee dedicate cucina/induzione).',
    ].join('\n');

    const preferredTextModels = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-2.5-pro',
      'gemini-1.5-flash',
    ];

    try {
      let modelsToTry = [...preferredTextModels];
      try {
        const listRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
        );
        if (listRes.ok) {
          const listJson = (await listRes.json()) as {
            models?: { name?: string; supportedGenerationMethods?: string[] }[];
          };
          const available = (listJson.models ?? [])
            .filter(
              (m) =>
                m.name &&
                m.supportedGenerationMethods?.includes('generateContent') &&
                /gemini/i.test(m.name) &&
                !/image|vision|embedding|aqa|tts/i.test(m.name)
            )
            .map((m) => m.name!.replace(/^models\//, ''));
          if (available.length > 0) {
            const ordered = preferredTextModels.filter((p) => available.includes(p));
            const extra = available.filter((a) => !ordered.includes(a));
            modelsToTry = [...ordered, ...extra].slice(0, 6);
          }
        }
      } catch {
        // usa la lista di default
      }

      let finalText: string | null = null;
      let lastErr = '';

      for (const model of modelsToTry) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
            }),
          }
        );

        const data = (await res.json()) as {
          error?: { message?: string };
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };

        if (!res.ok) {
          lastErr = `${model}: ${data?.error?.message || `HTTP ${res.status}`}`;
          continue;
        }

        const text = data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? '')
          .join('')
          .trim();

        if (text) {
          finalText = text;
          break;
        }
      }

      if (finalText) {
        setAiReport(finalText);
        showToast('Relazione tecnica generata con Google Gemini AI!', 'success');
      } else {
        setAiError(
          `Impossibile ottenere una risposta da Gemini. Verifica la API Key su Google AI Studio. (${lastErr || 'nessun modello disponibile'})`
        );
      }
    } catch (err) {
      setAiError(
        err instanceof Error
          ? err.message
          : 'Errore di rete durante la chiamata a Google Gemini.'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const activeWalls = useMemo(
    () => project.walls.filter((w) => !w.demolished),
    [project.walls]
  );

  const handleMovePanel = (pt: Point2D) => {
    setHasCustomPanel(true);
    setConfig((prev) => ({ ...prev, panelPosition: pt }));
    showToast('Quadro Elettrico spostato: cavi ricalcolati!', 'info');
  };

  const handlePlaceOrMoveWaterManifold = (pt: Point2D) => {
    setWaterManifoldRemoved(false);
    setHasCustomWaterManifold(true);
    setConfig((prev) => ({ ...prev, waterManifoldPosition: pt }));
    if (defaults.placedWaterManifoldId) {
      updateFurniture(defaults.placedWaterManifoldId, { x: pt.x, y: pt.y });
      showToast('Collettore Acqua spostato: tubi sanitari ricalcolati!', 'success');
    } else {
      const catItem = CATALOG.find((c) => c.id === 'manifold-water');
      if (catItem) {
        addFurnitureFromCatalog(catItem, pt.x, pt.y);
      }
      showToast('Collettore Acqua inserito sulla piantina: tubi sanitari collegati!', 'success');
    }
  };

  const handlePlaceOrMoveHeatingManifold = (pt: Point2D) => {
    setHeatingManifoldRemoved(false);
    setHasCustomHeatingManifold(true);
    setConfig((prev) => ({ ...prev, heatingManifoldPosition: pt }));
    if (defaults.placedHeatingManifoldId) {
      updateFurniture(defaults.placedHeatingManifoldId, { x: pt.x, y: pt.y });
      showToast('Collettore Riscaldamento spostato: dorsale e diramazioni ricalcolate!', 'success');
    } else {
      const catItem = CATALOG.find((c) => c.id === 'manifold-heating');
      if (catItem) {
        addFurnitureFromCatalog(catItem, pt.x, pt.y);
      }
      showToast('Collettore Riscaldamento inserito sulla piantina: tubi collegati!', 'success');
    }
  };

  const handleDeleteWaterManifold = () => {
    const ids = project.furniture
      .filter((f) => f.geometryType === 'manifold_water')
      .map((f) => f.id);
    if (ids.length > 0) {
      deleteFurnitureIds(ids);
    }
    setWaterManifoldRemoved(true);
    setHasCustomWaterManifold(false);
    showToast('Collettore Acqua rimosso dalla piantina (puoi reinserirlo quando vuoi)', 'info');
  };

  const handleDeleteHeatingManifold = () => {
    const ids = project.furniture
      .filter((f) => f.geometryType === 'manifold_heating')
      .map((f) => f.id);
    if (ids.length > 0) {
      deleteFurnitureIds(ids);
    }
    setHeatingManifoldRemoved(true);
    setHasCustomHeatingManifold(false);
    showToast(
      'Collettore Riscaldamento rimosso dalla piantina (puoi reinserirlo quando vuoi)',
      'info'
    );
  };

  const handleQuickPlaceCatalogItem = (item: FurnitureCatalogItem, pt: Point2D) => {
    addFurnitureFromCatalog(item, pt.x, pt.y);
    showToast(`${item.nome} inserito sulla piantina: impianto aggiornato!`, 'success');
  };

  const showElectrical = activeTab === 'all' || activeTab === 'electrical';
  const showPlumbing = activeTab === 'all' || activeTab === 'plumbing';
  const showHvac = activeTab === 'all' || activeTab === 'hvac';
  const showPaint = activeTab === 'all' || activeTab === 'paint';
  const showAi = activeTab === 'all' || activeTab === 'ai';

  return (
    <div className="flex-1 h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Intestazione + azioni export */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Computo Impianti & Pittura
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                {estimate.totalFloorAreaSqm} m² • {estimate.roomCount}{' '}
                {estimate.roomCount === 1 ? 'stanza' : 'stanze'}
              </span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Pre-dimensionamento automatico da muri reali, aperture e mobili/sanitari inseriti.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              Esporta CSV
            </button>
            <button
              type="button"
              onClick={handlePrintReport}
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              Stampa / PDF
            </button>
          </div>
        </div>

        {/* Avviso se mancano muri */}
        {activeWalls.length === 0 && (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              Non hai ancora tracciato muri nello <strong>Step 0</strong>. Traccia la pianta e inserisci bagni/mobili nello Step 2 per ottenere un calcolo basato sulle misure reali.
            </span>
          </div>
        )}

        {/* 5 KPI principali */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <button
            type="button"
            onClick={() => onChangeTab('electrical')}
            className="text-left p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-400 transition-colors cursor-pointer shadow-xs"
          >
            <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Punti Elettrici</span>
              <Zap className="w-4 h-4" />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">
              {estimate.electrical.totalLightPoints} luci • {estimate.electrical.totalOutlets} prese
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {estimate.electrical.totalCableMeters} m cavi (+{config.wastePct}% sfrido)
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('electrical')}
            className="text-left p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-400 transition-colors cursor-pointer shadow-xs"
          >
            <div className="flex items-center justify-between text-orange-600 dark:text-orange-400 mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Cavi & Corrugati</span>
              <Zap className="w-4 h-4" />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">
              {estimate.electrical.totalCableMeters} m
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Ø20: {estimate.electrical.corrugated20M} m • Ø25: {estimate.electrical.corrugated25M} m
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('plumbing')}
            className="text-left p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-sky-400 transition-colors cursor-pointer shadow-xs"
          >
            <div className="flex items-center justify-between text-sky-600 dark:text-sky-400 mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                Idraulico ({config.pipeMaterial === 'multistrato' ? 'Multistr.' : config.pipeMaterial.toUpperCase()})
              </span>
              <Droplets className="w-4 h-4" />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">
              {estimate.plumbing.totalSupplyMeters} m
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {estimate.plumbing.fixtures.length} punti acqua • Scarichi {estimate.plumbing.totalDrainMeters} m
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('hvac')}
            className="text-left p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-rose-400 transition-colors cursor-pointer shadow-xs"
          >
            <div className="flex items-center justify-between text-rose-600 dark:text-rose-400 mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Clima & Termo</span>
              <Thermometer className="w-4 h-4" />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">
              {estimate.hvac.heatingWaterPipeMeters + estimate.hvac.monoblocPrimaryPipeMeters} m H₂O /{' '}
              {estimate.hvac.refrigerantCopperPairMeters} m gas
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate">
              {estimate.hvac.terminals.length} terminali • {estimate.hvac.generators.length} generatori
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('paint')}
            className="text-left p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-400 transition-colors cursor-pointer shadow-xs"
          >
            <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Vernice Pareti</span>
              <Paintbrush className="w-4 h-4" />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">
              {estimate.paint.paintKg} kg
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {estimate.paint.paintLiters} L ({estimate.paint.bucketCount}×{estimate.paint.bucketKg} kg)
            </div>
          </button>
        </div>

        {/* Barra Tabs di navigazione interna + Sfrido globale */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900 p-2 rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { id: 'all', label: 'Tutto' },
                { id: 'electrical', label: '⚡ Elettrico' },
                { id: 'plumbing', label: '💧 Idraulico' },
                { id: 'hvac', label: '🌡️ Clima & Riscaldamento' },
                { id: 'paint', label: '🎨 Vernice' },
                { id: 'ai', label: '✨ Analisi Google AI' },
              ] as { id: MepTabId; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onChangeTab(t.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === t.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 px-2 text-xs text-slate-600 dark:text-slate-300">
            <span>Margine sfrido:</span>
            <select
              value={config.wastePct}
              onChange={(e) => setConfig((c) => ({ ...c, wastePct: Number(e.target.value) }))}
              className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold text-xs"
            >
              <option value={5}>+5%</option>
              <option value={10}>+10%</option>
              <option value={15}>+15% (consigliato)</option>
              <option value={20}>+20%</option>
              <option value={25}>+25%</option>
            </select>
          </div>
        </div>

        {/* Grande Schema Piantina Impianti interattivo (Acqua, Luce, Riscaldamento, Collettori e Dorsali) */}
        {activeWalls.length > 0 && (showElectrical || showPlumbing || showHvac) && (
          <MepBlueprintCanvas
            project={project}
            rooms={rooms}
            config={config}
            estimate={estimate}
            hasPlacedWaterManifold={Boolean(defaults.placedWaterManifoldId)}
            hasPlacedHeatingManifold={Boolean(defaults.placedHeatingManifoldId)}
            showWaterManifold={!waterManifoldRemoved}
            showHeatingManifold={!heatingManifoldRemoved}
            showElectricalDefault={showElectrical}
            showPlumbingDefault={showPlumbing}
            showHvacDefault={showHvac}
            onMovePanel={handleMovePanel}
            onPlaceOrMoveWaterManifold={handlePlaceOrMoveWaterManifold}
            onPlaceOrMoveHeatingManifold={handlePlaceOrMoveHeatingManifold}
            onDeleteWaterManifold={handleDeleteWaterManifold}
            onDeleteHeatingManifold={handleDeleteHeatingManifold}
            onQuickPlaceCatalogItem={handleQuickPlaceCatalogItem}
          />
        )}

        {/* ================= 1. IMPIANTO ELETTRICO ================= */}
        {showElectrical && (
          <section className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    1. Impianto Elettrico — Cavi, Sezioni, Punti Luce e Prese
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Dimensionamento indicativo secondo CEI 64-8 basato su stanze e mobili inseriti
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={config.ceiLevel}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, ceiLevel: e.target.value as CeiLevel }))
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium"
                >
                  <option value="livello1">CEI 64-8 Livello 1 (Base)</option>
                  <option value="livello2">CEI 64-8 Livello 2 (Standard)</option>
                  <option value="livello3">CEI 64-8 Livello 3 (Domotico)</option>
                </select>
                <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.includeInduction}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, includeInduction: e.target.checked }))
                    }
                    className="accent-blue-600"
                  />
                  <span>Induzione (4 mm²)</span>
                </label>
                <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.includeAcLine}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, includeAcLine: e.target.checked }))
                    }
                    className="accent-blue-600"
                  />
                  <span>Linea Clima</span>
                </label>
              </div>
            </div>

            {/* Tabella Cavi e Sezioni */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 px-3 text-left font-semibold">Sezione Cavo</th>
                    <th className="py-2 px-3 text-left font-semibold">Linea / Utilizzo</th>
                    <th className="py-2 px-3 text-left font-semibold">Interruttore quadro</th>
                    <th className="py-2 px-3 text-right font-semibold">Metri stimati</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {estimate.electrical.cables.map((row) => (
                    <tr key={row.sectionMm2}>
                      <td className="py-2.5 px-3 font-mono font-bold text-amber-700 dark:text-amber-300">
                        {row.sectionMm2}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">{row.usage}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[11px]">
                          {row.recommendedBreaker}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {row.meters} m
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Corrugati e Scatole */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Corrugato Ø 20 mm</div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.electrical.corrugated20M} m
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Corrugato Ø 25 mm</div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.electrical.corrugated25M} m
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Scatole portafrutti 503</div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.electrical.boxes503} pz
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Cassette derivazione</div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.electrical.junctionBoxes} pz
                </div>
              </div>
            </div>

            {/* Dettaglio punti luce e prese per singola stanza */}
            <div className="overflow-x-auto pt-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Dettaglio Punti Luce e Prese per Stanza
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/70 text-slate-500">
                    <th className="py-2 px-3 text-left rounded-l-lg">Stanza</th>
                    <th className="py-2 px-3 text-right">Area</th>
                    <th className="py-2 px-3 text-center">Punti luce</th>
                    <th className="py-2 px-3 text-center">Prese 10/16A</th>
                    <th className="py-2 px-3 text-center">Prese dedicate</th>
                    <th className="py-2 px-3 text-center rounded-r-lg">TV / Dati</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {estimate.electrical.byRoom.map((r) => (
                    <tr key={r.roomId}>
                      <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-100">
                        {r.roomName}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-500">
                        {r.areaSqm} m²
                      </td>
                      <td className="py-2 px-3 text-center font-mono font-semibold">
                        {r.lightPoints}
                      </td>
                      <td className="py-2 px-3 text-center font-mono font-semibold">
                        {r.standardOutlets}
                      </td>
                      <td className="py-2 px-3 text-center font-mono">
                        {r.dedicatedOutlets}
                      </td>
                      <td className="py-2 px-3 text-center font-mono text-slate-500">
                        {r.tvDataPoints}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ================= 2. IMPIANTO IDRAULICO ================= */}
        {showPlumbing && (
          <section className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                  <Droplets className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    2. Impianto Idraulico — Tubi {estimate.plumbing.pipeMaterialLabel} e Scarichi
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Calcolato dai sanitari, cucine e lavatrici posizionati in pianta
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={config.pipeMaterial}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, pipeMaterial: e.target.value as PipeMaterial }))
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium"
                >
                  {(Object.keys(PIPE_MATERIAL_LABELS) as PipeMaterial[]).map((k) => (
                    <option key={k} value={k}>
                      {PIPE_MATERIAL_LABELS[k].label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.includeHotWater}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, includeHotWater: e.target.checked }))
                    }
                    className="accent-blue-600"
                  />
                  <span>Acqua calda</span>
                </label>
                <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.includeDrains}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, includeDrains: e.target.checked }))
                    }
                    className="accent-blue-600"
                  />
                  <span>Scarichi</span>
                </label>
              </div>
            </div>

            {estimate.plumbing.fixtures.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 text-center">
                Nessun punto acqua rilevato (Lavabo, WC, Doccia, Vasca, Cucina o Lavatrice). Inseriscili nello <strong>Step 2 (Arredamento)</strong> per calcolare automaticamente i metri di tubo multistrato e gli scarichi.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800">
                    <div className="text-[11px] text-sky-700 dark:text-sky-300">Acqua Fredda Ø16</div>
                    <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                      {estimate.plumbing.coldBranchMeters} m
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800">
                    <div className="text-[11px] text-rose-700 dark:text-rose-300">Acqua Calda Ø16</div>
                    <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                      {estimate.plumbing.hotBranchMeters} m
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                    <div className="text-[11px] text-slate-500">Dorsale Ø20</div>
                    <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                      {estimate.plumbing.mainSupplyMeters} m
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                    <div className="text-[11px] text-slate-500">Scarichi Ø40 / Ø50</div>
                    <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                      {estimate.plumbing.drain40_50Meters} m
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                    <div className="text-[11px] text-slate-500">Scarico WC Ø110</div>
                    <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                      {estimate.plumbing.drain110Meters} m
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Collettore consigliato: <strong>{estimate.plumbing.manifoldWaysCold} vie fredda</strong> +{' '}
                  <strong>{estimate.plumbing.manifoldWaysHot} vie calda</strong> • Raccordi/curve/terminali stimati:{' '}
                  <strong>~{estimate.plumbing.estimatedFittings} pz</strong>.
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/70 text-slate-500">
                        <th className="py-2 px-3 text-left rounded-l-lg">Utenza idrica</th>
                        <th className="py-2 px-3 text-left">Stanza</th>
                        <th className="py-2 px-3 text-right">Dist. collettore</th>
                        <th className="py-2 px-3 text-right">Fredda</th>
                        <th className="py-2 px-3 text-right">Calda</th>
                        <th className="py-2 px-3 text-right rounded-r-lg">Scarico</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {estimate.plumbing.fixtures.map((fx) => (
                        <tr key={fx.id}>
                          <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-100">
                            {fx.name}
                          </td>
                          <td className="py-2 px-3 text-slate-500">{fx.roomName}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-500">
                            {fx.distanceFromManifoldM} m
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-sky-700 dark:text-sky-300">
                            {fx.coldPipeM} m
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-rose-600 dark:text-rose-400">
                            {fx.hotPipeM > 0 ? `${fx.hotPipeM} m` : '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-300">
                            {fx.drainPipeM > 0 ? `${fx.drainPipeM} m (Ø${fx.drainDiameterMm})` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {/* ================= 2B. RISCALDAMENTO & CLIMATIZZAZIONE ================= */}
        {showHvac && (
          <section className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                  <Thermometer className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    2B. Riscaldamento & Climatizzazione — PdC (Acqua/Gas), Caldaie, Split e Termosifoni
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Generatore attivo: <strong>{estimate.hvac.activeGeneratorSummary}</strong>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={config.primaryPipeDiameterMm}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      primaryPipeDiameterMm: Number(e.target.value) as 26 | 32,
                    }))
                  }
                  title="Diametro dorsale primaria tra Pompa di Calore / Caldaia e Collettore Riscaldamento"
                  className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 font-semibold"
                >
                  <option value={26}>Dorsale primaria: Ø 26 mm</option>
                  <option value={32}>Dorsale primaria: Ø 32 mm</option>
                </select>

                <select
                  value={config.hvacGeneratorOverride}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      hvacGeneratorOverride: e.target.value as HvacGeneratorOverride,
                    }))
                  }
                  title="Scegli il generatore oppure lascialo in rilevamento automatico dalla piantina"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium"
                >
                  <option value="auto">Generatore: Auto (da piantina)</option>
                  <option value="hp_monobloc_water">PdC Monoblocco (circolazione acqua)</option>
                  <option value="hp_split_gas">PdC Splittata (circolazione gas)</option>
                  <option value="boiler_gas">Caldaia a Gas</option>
                  <option value="boiler_pellet">Caldaia / Stufa a Pellet</option>
                </select>

                <select
                  value={config.splitFluidMode}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      splitFluidMode: e.target.value as SplitFluidMode,
                    }))
                  }
                  title="Tipo di tubazione verso gli split a parete alti/bassi"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium"
                >
                  <option value="auto">
                    Split: Auto ({estimate.hvac.splitFluid === 'water' ? 'Acqua' : 'Gas rame'})
                  </option>
                  <option value="water">Split a circolazione Acqua (Multistrato coib.)</option>
                  <option value="gas">Split a circolazione Gas (Rame 1/4&quot;+3/8&quot;)</option>
                </select>
              </div>
            </div>

            {/* Riepilogo tubazioni specifiche in base al sistema scelto */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-red-50/80 dark:bg-red-950/40 border border-red-300 dark:border-red-800">
                <div className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                  Dorsale Ø{estimate.hvac.primaryTrunkDiameterMm} (PdC/Caldaia → Coll.)
                </div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.hvac.primaryTrunkPipeMeters} m
                </div>
                <div className="text-[10px] text-slate-500">
                  Tubo grande A+R ({estimate.hvac.primaryTrunkDistanceM} m tratta)
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800">
                <div className="text-[11px] text-rose-700 dark:text-rose-300">
                  Diramazioni Coll. → Termo (Ø16)
                </div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.hvac.heatingWaterPipeMeters} m
                </div>
                <div className="text-[10px] text-slate-500 truncate" title={estimate.hvac.heatingWaterPipeLabel}>
                  A+R • {estimate.hvac.heatingManifoldWays} vie collettore
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-cyan-50/70 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800">
                <div className="text-[11px] text-cyan-700 dark:text-cyan-300">
                  Rame Frigo (1/4&quot;+3/8&quot;)
                </div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.hvac.refrigerantCopperPairMeters} m
                </div>
                <div className="text-[10px] text-slate-500">
                  {estimate.hvac.refrigerantCopperPairMeters > 0
                    ? `Coppia + 4G1,5 (${estimate.hvac.commCable4g15Meters} m)`
                    : 'Solo con gas refrigerante'}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Scarico Condensa Ø20</div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.hvac.condensateDrainMeters} m
                </div>
                <div className="text-[10px] text-slate-400">Split / Fan-coil</div>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <div className="text-[11px] text-amber-700 dark:text-amber-300">
                  Tubo Gas UNI 7129
                </div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.hvac.gasPipeMeters} m
                </div>
                <div className="text-[10px] text-slate-500">
                  {estimate.hvac.hasBoilerGas ? 'Rame Ø18-22 / Giallo gas' : 'Solo con Caldaia a Gas'}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Fumi / Canna Fumaria</div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.hvac.fluePipeMeters > 0 ? `${estimate.hvac.fluePipeMeters} m` : '—'}
                </div>
                <div className="text-[10px] text-slate-400 truncate" title={estimate.hvac.fluePipeLabel}>
                  {estimate.hvac.hasBoilerPellet
                    ? 'Inox Ø80 (Pellet)'
                    : estimate.hvac.hasBoilerGas
                      ? 'Coassiale Ø60/100'
                      : 'Nessuna'}
                </div>
              </div>
            </div>

            {estimate.hvac.terminals.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 text-center">
                Nessuno split o termosifone posizionato in pianta. Vai nello <strong>Step 2 → categoria &ldquo;Impianti&rdquo;</strong> per inserire <strong>Split alti/bassi</strong>, <strong>Termosifoni</strong>, <strong>Scaldasalviette</strong>, <strong>Pompa di calore (Monoblocco o Splittata)</strong> e <strong>Caldaia (Gas o Pellet)</strong>.
              </div>
            ) : (
              <>
                {estimate.hvac.radiatorValveKits > 0 && (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Accessori riscaldamento: <strong>{estimate.hvac.radiatorValveKits} kit valvola termostatica + detentore</strong> • Collettore riscaldamento consigliato:{' '}
                    <strong>
                      {estimate.hvac.terminals.filter((t) => t.circuitType === 'water').length} vie
                    </strong>
                    .
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/70 text-slate-500">
                        <th className="py-2 px-3 text-left rounded-l-lg">Terminale</th>
                        <th className="py-2 px-3 text-left">Stanza</th>
                        <th className="py-2 px-3 text-left">Tipo tubazione</th>
                        <th className="py-2 px-3 text-right">Dist. collettore</th>
                        <th className="py-2 px-3 text-right">Metri tubo</th>
                        <th className="py-2 px-3 text-right rounded-r-lg">Condensa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {estimate.hvac.terminals.map((t) => (
                        <tr key={t.id}>
                          <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-100">
                            {t.name}
                          </td>
                          <td className="py-2 px-3 text-slate-500">{t.roomName}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                                t.circuitType === 'water'
                                  ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300'
                                  : 'bg-cyan-50 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300'
                              }`}
                            >
                              {t.pipeDescription}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-500">
                            {t.distanceM} m
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {t.pipeMeters} m
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-500">
                            {t.condensateMeters > 0 ? `${t.condensateMeters} m` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {/* ================= 3. PITTURA / VERNICE PARETI ================= */}
        {showPaint && (
          <section className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Paintbrush className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    3. Vernice / Pittura Pareti — Calcolo m², Litri e Kg
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Sottrae automaticamente porte, finestre, portefinestre e archi dai muri attivi
                  </p>
                </div>
              </div>
            </div>

            {/* Parametri Pittura */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-500">Tipo pittura</span>
                <select
                  value={config.paintType}
                  onChange={(e) => {
                    const pt = e.target.value as PaintType;
                    setConfig((c) => ({
                      ...c,
                      paintType: pt,
                      yieldSqmPerLiter: PAINT_TYPE_PRESETS[pt].defaultYield,
                      paintDensityKgPerL: PAINT_TYPE_PRESETS[pt].defaultDensity,
                    }));
                  }}
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  {(Object.keys(PAINT_TYPE_PRESETS) as PaintType[]).map((k) => (
                    <option key={k} value={k}>
                      {PAINT_TYPE_PRESETS[k].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500">Mani di vernice</span>
                <select
                  value={config.coats}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, coats: Number(e.target.value) as 1 | 2 | 3 }))
                  }
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value={1}>1 mano</option>
                  <option value={2}>2 mani (standard)</option>
                  <option value={3}>3 mani (cambio colore)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500">Facce muri</span>
                <select
                  value={config.wallSides}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, wallSides: e.target.value as WallSidesMode }))
                  }
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="auto">Auto (perim. 1 / interni 2)</option>
                  <option value="single">Solo 1 lato</option>
                  <option value="both">Tutti ambo i lati</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500">Resa (m²/L)</span>
                <input
                  type="number"
                  min={4}
                  max={18}
                  step={0.5}
                  value={config.yieldSqmPerLiter}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      yieldSqmPerLiter: Math.max(2, Number(e.target.value) || 9),
                    }))
                  }
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500">Formato secchio</span>
                <select
                  value={config.bucketKg}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      bucketKg: Number(e.target.value) as 5 | 14 | 20 | 25,
                    }))
                  }
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value={5}>5 kg (~3,5 L)</option>
                  <option value={14}>14 kg (~10 L)</option>
                  <option value={20}>20 kg (~14 L)</option>
                  <option value={25}>25 kg (~17 L)</option>
                </select>
              </label>

              <div className="flex flex-col justify-center gap-1.5 pt-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.includeCeiling}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, includeCeiling: e.target.checked }))
                    }
                    className="accent-emerald-600"
                  />
                  <span>Includi soffitto</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.includePrimer}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, includePrimer: e.target.checked }))
                    }
                    className="accent-emerald-600"
                  />
                  <span>Fissativo / Primer</span>
                </label>
              </div>
            </div>

            {/* Risultati Pittura */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Superficie netta pareti</div>
                <div className="text-lg font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.paint.netWallSqm} m²
                </div>
                <div className="text-[10px] text-slate-400">
                  Lorde {estimate.paint.grossWallSqm} m² − aperture {estimate.paint.openingsSubtractedSqm} m²
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Totale da tinteggiare</div>
                <div className="text-lg font-bold font-mono text-slate-900 dark:text-white">
                  {estimate.paint.totalSurfaceSqm} m²
                </div>
                <div className="text-[10px] text-slate-400">
                  Soffitto: {estimate.paint.ceilingSqm} m² • {config.coats} mani
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">
                  Vernice necessaria (Kg)
                </div>
                <div className="text-xl font-bold font-mono text-emerald-800 dark:text-emerald-200">
                  {estimate.paint.paintKg} kg
                </div>
                <div className="text-[10px] text-emerald-700/80 dark:text-emerald-300/80">
                  {estimate.paint.paintLiters} litri → <strong>{estimate.paint.bucketCount} secchi da {estimate.paint.bucketKg} kg</strong>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Fissativo / Primer</div>
                <div className="text-lg font-bold font-mono text-slate-900 dark:text-white">
                  {config.includePrimer ? `${estimate.paint.primerKg} kg` : 'Escluso'}
                </div>
                <div className="text-[10px] text-slate-400">
                  {config.includePrimer ? `${estimate.paint.primerLiters} litri (1 mano)` : 'Attiva la spunta per calcolarlo'}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================= 4. ANALISI GOOGLE GEMINI AI ================= */}
        {showAi && (
          <section className="p-5 rounded-2xl bg-gradient-to-br from-violet-50/80 to-indigo-50/60 dark:from-violet-950/30 dark:to-indigo-950/20 border border-violet-200 dark:border-violet-800/70 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    Analisi Tecnica & Lista Materiali con Google Gemini AI
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Usa la tua Google Gemini API Key (condivisa con Foto AI) per ottenere schema quadro elettrico, raccordi idraulici e controlli normativi.
                  </p>
                </div>
              </div>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-violet-700 dark:text-violet-300 hover:underline flex items-center gap-1 font-medium"
              >
                Ottieni API Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <KeyRound className="w-3.5 h-3.5 text-violet-600" />
                  Google Gemini API Key (salvata solo nel browser)
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => handleSaveApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 font-mono text-xs"
                />
              </label>

              <label className="space-y-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Note opzionali per l’AI (es. tipo muratura, caldaia, domotica)
                </span>
                <input
                  type="text"
                  value={aiNotes}
                  onChange={(e) => setAiNotes(e.target.value)}
                  placeholder="Es. muratura in forati, 2 condizionatori, scaldasalviette in bagno..."
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 text-xs"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={aiLoading}
                onClick={handleAnalyzeWithGemini}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-2 shadow-sm cursor-pointer"
              >
                {aiLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Elaborazione con Google Gemini...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Genera analisi e lista materiali con Google AI
                  </>
                )}
              </button>

              {aiReport && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(aiReport);
                    setCopiedAi(true);
                    setTimeout(() => setCopiedAi(false), 2000);
                  }}
                  className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 text-xs font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedAi ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedAi ? 'Copiato!' : 'Copia relazione'}
                </button>
              )}
            </div>

            {aiError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                {aiError}
              </div>
            )}

            {aiReport && (
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-violet-200/80 dark:border-violet-800/60 text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed max-h-[420px] overflow-y-auto">
                {aiReport}
              </div>
            )}
          </section>
        )}

        <p className="text-[11px] text-slate-400 text-center pb-4">
          Nota: i valori sono una stima tecnica preliminare utile per preventivi e ordini di massima. Per la posa in opera e le certificazioni (DiCo) fare sempre riferimento a installatori abilitati.
        </p>
      </div>
    </div>
  );
};

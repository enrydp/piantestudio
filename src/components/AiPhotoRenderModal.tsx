/**
 * Modale "Foto Realistica AI" dallo Step 3:
 * - Cattura il rendering 3D corrente dal canvas WebGL
 * - Costruisce automaticamente un prompt fotografico fedele alla stanza (pavimento, pareti, luce, mobili)
 * - Genera direttamente una foto fotorealistica tramite Google Gemini Image API (client-side con API key opzionale)
 * - Oppure permette di copiare il prompt + scaricare il rendering per usarlo in qualsiasi strumento AI esterno
 */
import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';

const GEMINI_KEY_STORAGE = 'piantestudio_gemini_api_key_v1';

type PhotoStyle = 'faithful_natural' | 'modern_italian' | 'bright_daylight' | 'warm_evening';
type FidelityMode = 'strict' | 'enhanced';

const PHOTO_STYLES: { id: PhotoStyle; label: string; promptDesc: string }[] = [
  {
    id: 'faithful_natural',
    label: 'Naturale Fedele',
    promptDesc:
      'clean natural architectural photography with accurate neutral colors, soft realistic global illumination, crisp material micro-textures, and authentic reflections',
  },
  {
    id: 'modern_italian',
    label: 'Architettonico Caldo',
    promptDesc:
      'high-end Italian architectural photography look, subtle warm daylight balance, realistic matte plaster, tactile wood and fabric surfaces, soft natural shadows',
  },
  {
    id: 'bright_daylight',
    label: 'Luminoso Da Catalogo',
    promptDesc:
      'bright airy real-estate architectural photography, crisp clean daylight, soft diffused shadows, ultra-clean realistic finishes',
  },
  {
    id: 'warm_evening',
    label: 'Atmosfera Serale',
    promptDesc:
      'cozy golden-hour / warm evening architectural photography, soft warm ambient indoor bounce light, realistic specular highlights and gentle shadows',
  },
];

interface AiPhotoRenderModalProps {
  sourceRenderDataUrl: string;
  onClose: () => void;
}

export const AiPhotoRenderModal: React.FC<AiPhotoRenderModalProps> = ({
  sourceRenderDataUrl,
  onClose,
}) => {
  const { project, showToast } = useProjectStore();
  const [styleId, setStyleId] = useState<PhotoStyle>('faithful_natural');
  const [fidelityMode, setFidelityMode] = useState<FidelityMode>('strict');
  const [extraNotes, setExtraNotes] = useState('');
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem(GEMINI_KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const floorColorHex = project.renderSettings.floorColor;
  const floorLabel =
    project.renderSettings.floorTexture === 'parquet'
      ? `realistic oak wood parquet planks matching the exact tone in the image${floorColorHex ? ` (approx. ${floorColorHex})` : ''}`
      : project.renderSettings.floorTexture === 'piastrelle'
        ? `realistic matte porcelain stoneware floor tiles with subtle grout lines matching the exact tone in the image${floorColorHex ? ` (approx. ${floorColorHex})` : ''}`
        : `realistic smooth architectural micro-cement concrete flooring matching the exact tone in the image${floorColorHex ? ` (approx. ${floorColorHex})` : ''}`;

  const cameraModeDesc = useMemo(() => {
    switch (project.renderSettings.cameraMode) {
      case 'top':
        return 'The input image is a strict top-down 90-degree orthographic floorplan view (with no ceiling). Preserve this exact top-down orthographic camera angle and open-top layout — do NOT tilt the camera or add a roof/ceiling.';
      case 'dollhouse':
        return 'The input image is an elevated 3D cutaway / dollhouse architectural view (with no roof/ceiling). Preserve this EXACT elevated cutaway angle, exposed wall tops, and open-top composition — do NOT convert it to an eye-level shot and do NOT add a ceiling.';
      case 'orbit':
        return 'The input image is an elevated 3D perspective architectural cutaway view (with no ceiling). Preserve the EXACT camera angle, perspective, open wall tops, and framing — do NOT change the viewpoint or add a ceiling.';
      case 'first_person':
      default:
        return 'The input image is an eye-level interior view. Preserve the EXACT camera position, field of view, vanishing points, ceiling height, and framing.';
    }
  }, [project.renderSettings.cameraMode]);

  const timeDesc = useMemo(() => {
    if (project.renderSettings.renderPreset === 'evening') {
      return 'warm cozy evening lighting with realistic indoor light bounce';
    }
    const h = project.renderSettings.timeOfDay;
    if (h < 9.5) return 'soft morning sunlight';
    if (h > 17) return 'warm late-afternoon sunlight';
    return 'natural balanced midday daylight';
  }, [project.renderSettings.timeOfDay, project.renderSettings.renderPreset]);

  const builtPrompt = useMemo(() => {
    const style = PHOTO_STYLES.find((s) => s.id === styleId) ?? PHOTO_STYLES[0];
    const strictRules =
      fidelityMode === 'strict'
        ? [
            'TASK: Re-render the attached 3D architectural screenshot with photorealistic materials and lighting while keeping a 1:1 EXACT structural match.',
            'CRITICAL GEOMETRY LOCK: Treat the input image as a strict pixel-aligned structural template. Keep EVERY wall, corner, door, window, upper/lower cabinet, appliance, and piece of furniture in its EXACT pixel position, exact size, exact count, exact orientation, and original color.',
            'STRICT PROHIBITIONS: Do NOT add, invent, move, resize, rotate, duplicate, or remove ANY object. Do NOT add extra furniture, curtains, paintings, rugs, hanging lamps, decorative moldings, plants, people, or extra windows/doors that are not already present in the input image.',
          ]
        : [
            'TASK: Re-render the attached 3D architectural screenshot into a photorealistic interior render while faithfully preserving the exact room layout, camera angle, walls, doors, windows, and main furniture positions.',
            'Keep every existing wall, opening, and piece of furniture in the exact same position and proportion. You may subtly refine small realistic details (soft fabric folds, realistic handles, subtle reflections) without changing the layout or adding large objects.',
          ];

    const parts = [
      ...strictRules,
      cameraModeDesc,
      `Photographic finish: ${style.promptDesc}.`,
      `Surface materials (upgrade realism only, preserve exact colors from input): ${floorLabel}; painted plaster walls (${project.renderSettings.wallColor}); physically realistic wood grain, woven fabrics, ceramic, brushed metal, and reflective window glass; ${timeDesc} with soft contact shadows and ambient occlusion.`,
      'No text, no labels, no watermarks, no distorted geometry, no extra hallucinated objects.',
    ];
    if (extraNotes.trim()) {
      parts.push(`User requested details: ${extraNotes.trim()}.`);
    }
    return parts.join(' ');
  }, [
    styleId,
    fidelityMode,
    cameraModeDesc,
    floorLabel,
    project.renderSettings.wallColor,
    timeDesc,
    extraNotes,
  ]);

  const handleSaveApiKey = (val: string) => {
    setApiKey(val);
    try {
      if (val.trim()) localStorage.setItem(GEMINI_KEY_STORAGE, val.trim());
      else localStorage.removeItem(GEMINI_KEY_STORAGE);
    } catch {
      // ignore
    }
  };

  const handleGenerateWithGemini = async () => {
    const key = apiKey.trim();
    if (!key) {
      setErrorMsg(
        'Inserisci la tua Gemini API Key per generare la foto direttamente qui, oppure usa "Copia prompt" + "Scarica 3D" qui sotto.'
      );
      return;
    }

    setIsGenerating(true);
    setErrorMsg(null);

    const base64Data = sourceRenderDataUrl.split(',')[1];
    const preferredOrder = [
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-image-preview',
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-image-preview',
      'gemini-3-pro-image',
      'gemini-3-pro-image-preview',
    ];

    try {
      // Interroga ListModels per usare solo i modelli immagine realmente attivi sulla chiave API
      let modelsToTry: string[] = [...preferredOrder];
      try {
        const listRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
        );
        if (listRes.ok) {
          const listJson = (await listRes.json()) as {
            models?: { name?: string; supportedGenerationMethods?: string[] }[];
          };
          const discovered = (listJson.models ?? [])
            .filter(
              (m) =>
                m.name &&
                /gemini.*image/i.test(m.name) &&
                Array.isArray(m.supportedGenerationMethods) &&
                m.supportedGenerationMethods.includes('generateContent')
            )
            .map((m) => m.name!.replace(/^models\//, ''));

          if (discovered.length > 0) {
            const prioritized = preferredOrder.filter((id) => discovered.includes(id));
            const extras = discovered.filter((id) => !prioritized.includes(id));
            modelsToTry = [...prioritized, ...extras];
          }
        } else if (listRes.status === 400 || listRes.status === 401 || listRes.status === 403) {
          const errJson = await listRes.json().catch(() => null);
          const msg = errJson?.error?.message ?? `Chiave API non valida (HTTP ${listRes.status}).`;
          setErrorMsg(msg);
          return;
        }
      } catch {
        // Se ListModels fallisce per rete/CORS, usa comunque l'elenco aggiornato di fallback
      }

      let primaryError: string | null = null;
      let fallbackError = 'Risposta non valida dal servizio AI.';

      for (const model of modelsToTry) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'image/png',
                        data: base64Data,
                      },
                    },
                    { text: builtPrompt },
                  ],
                },
              ],
              generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
                temperature: fidelityMode === 'strict' ? 0.2 : 0.45,
              },
            }),
          }
        );

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const apiMsg: string = json?.error?.message ?? `Errore HTTP ${res.status}`;
          if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|API key not valid/i.test(apiMsg)) {
            setErrorMsg(`Chiave Gemini API non valida: ${apiMsg}`);
            return;
          }
          if (res.status !== 404 && !primaryError) {
            primaryError =
              res.status === 429 || /quota|billing|RESOURCE_EXHAUSTED/i.test(apiMsg)
                ? `Quota o fatturazione richiesta per ${model}: ${apiMsg} — Verifica il piano su Google AI Studio oppure usa "Scarica 3D" + "Copia prompt" qui sotto.`
                : `${model}: ${apiMsg}`;
          }
          fallbackError = `${model}: ${apiMsg}`;
          continue;
        }

        const parts = json?.candidates?.[0]?.content?.parts ?? [];
        const imgPart = parts.find(
          (p: {
            inlineData?: { data?: string; mimeType?: string };
            inline_data?: { data?: string; mime_type?: string };
          }) => p?.inlineData?.data || p?.inline_data?.data
        );

        const imgData = imgPart?.inlineData?.data ?? imgPart?.inline_data?.data;
        if (imgData) {
          const mime =
            imgPart?.inlineData?.mimeType ?? imgPart?.inline_data?.mime_type ?? 'image/png';
          setGeneratedImageUrl(`data:${mime};base64,${imgData}`);
          showToast('Foto fotorealistica AI generata con successo!', 'success');
          return;
        }
        if (!primaryError) {
          primaryError = `Il modello ${model} non ha restituito un’immagine. Riprova o cambia inquadratura.`;
        }
      }

      setErrorMsg(primaryError ?? fallbackError);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Errore di rete durante la chiamata a Gemini API.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  /** Copia testo negli appunti in modo sincrono + Clipboard API (funziona prima di window.open) */
  const copyTextReliably = (text: string): boolean => {
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      ok = false;
    }

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => {});
      ok = true;
    }
    return ok;
  };

  const handleCopyPrompt = () => {
    const ok = copyTextReliably(builtPrompt);
    if (ok) {
      setCopied(true);
      showToast('Prompt fotorealistico copiato negli appunti!', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      showToast('Impossibile copiare automaticamente: seleziona il testo del prompt', 'warning');
    }
  };

  const downloadDataUrl = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const handleOpenInGeminiWeb = () => {
    // 1. Copia PRIMA il prompt (mentre questa scheda ha ancora il focus!)
    const copiedOk = copyTextReliably(builtPrompt);
    if (copiedOk) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    }

    // 2. Scarica il rendering 3D
    downloadDataUrl(sourceRenderDataUrl, 'piantestudio-3d.png');

    // 3. Apri Gemini Web in una nuova scheda (rimane sincrono nel click -> nessun blocco popup)
    window.open('https://gemini.google.com/app', '_blank', 'noopener,noreferrer');

    showToast(
      copiedOk
        ? 'Prompt copiato e 3D scaricato! Su Gemini allega "piantestudio-3d.png" e premi Ctrl+V.'
        : '3D scaricato! Copia il prompt dal box qui sotto e incollalo su Gemini.',
      copiedOk ? 'success' : 'warning'
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                Trasforma il Rendering 3D in Foto Reale con AI
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                L’AI legge geometria, luci e mobili dal tuo rendering 3D e genera una fotografia fotorealistica.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Contenuto */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Confronto Prima (3D) / Dopo (Foto AI) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span>1. Rendering 3D di partenza</span>
                <button
                  type="button"
                  onClick={() => downloadDataUrl(sourceRenderDataUrl, 'piantestudio-3d.png')}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  Scarica 3D
                </button>
              </div>
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 aspect-video flex items-center justify-center">
                <img
                  src={sourceRenderDataUrl}
                  alt="Rendering 3D di partenza"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span>2. Foto Realistica generata da AI</span>
                {generatedImageUrl && (
                  <button
                    type="button"
                    onClick={() => downloadDataUrl(generatedImageUrl, 'piantestudio-foto-ai.png')}
                    className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    Scarica Foto AI
                  </button>
                )}
              </div>
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 aspect-video flex items-center justify-center relative">
                {isGenerating ? (
                  <div className="flex flex-col items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Loader2 className="w-7 h-7 animate-spin text-violet-600" />
                    <span>Generazione fotorealistica in corso (10–25 sec)...</span>
                  </div>
                ) : generatedImageUrl ? (
                  <img
                    src={generatedImageUrl}
                    alt="Foto fotorealistica AI"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center px-6 text-xs text-slate-500 dark:text-slate-400 space-y-2.5">
                    <Sparkles className="w-6 h-6 mx-auto text-blue-500 opacity-80" />
                    <p>
                      Scegli lo stile qui sotto e clicca <strong>Apri su Gemini</strong> per creare la foto con il tuo abbonamento.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenInGeminiWeb}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-semibold shadow-sm cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Apri su Gemini (con il tuo abbonamento)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stile fotografico & fedeltà al rendering */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div className="space-y-2.5">
              {/* Controllo Fedeltà al Rendering 3D */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                  Fedeltà al Rendering 3D
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFidelityMode('strict')}
                    className={`p-2 rounded-xl text-left border transition-colors cursor-pointer ${
                      fidelityMode === 'strict'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-[11px] font-bold">Ricalco Esatto 1:1</div>
                    <div
                      className={`text-[10px] leading-tight mt-0.5 ${
                        fidelityMode === 'strict' ? 'text-emerald-100' : 'text-slate-400'
                      }`}
                    >
                      Solo materiali/luci reali, non inventa mobili
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFidelityMode('enhanced')}
                    className={`p-2 rounded-xl text-left border transition-colors cursor-pointer ${
                      fidelityMode === 'enhanced'
                        ? 'bg-violet-600 text-white border-violet-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-[11px] font-bold">Rifinito</div>
                    <div
                      className={`text-[10px] leading-tight mt-0.5 ${
                        fidelityMode === 'enhanced' ? 'text-violet-100' : 'text-slate-400'
                      }`}
                    >
                      Mantiene il layout e rifinisce i dettagli
                    </div>
                  </button>
                </div>
              </div>

              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                Resa fotografica e luce
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PHOTO_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyleId(s.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                      styleId === s.id
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <label className="block space-y-1 pt-0.5">
                <span className="text-[11px] text-slate-500">
                  Dettagli extra opzionali (lascia vuoto per massima fedeltà al 3D)
                </span>
                <input
                  type="text"
                  value={extraNotes}
                  onChange={(e) => setExtraNotes(e.target.value)}
                  placeholder="es. luce naturale più morbida, legno più caldo..."
                  className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </label>
            </div>

            {/* Azione principale: Apri su Gemini Web + API Key opzionale */}
            <div className="space-y-3">
              {/* Usa il tuo abbonamento Gemini Web in 1 click */}
              <div className="space-y-2 p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/70">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    Usa il tuo abbonamento Gemini (consigliato)
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                  Scarica in automatico <strong>piantestudio-3d.png</strong>, copia il prompt e apre <strong>gemini.google.com</strong>: ti basta allegare la foto e premere <strong>Ctrl+V</strong>.
                </p>
                <button
                  type="button"
                  onClick={handleOpenInGeminiWeb}
                  className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  Apri su Gemini (scarica 3D + copia prompt)
                </button>
              </div>

              {/* Configurazione Gemini API Key (opzionale, per account API con billing attivo) */}
              <div className="space-y-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-violet-600" />
                    Generazione diretta con API Key (opzionale)
                  </span>
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                  >
                    AI Studio
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => handleSaveApiKey(e.target.value)}
                    placeholder="Google AI Studio API Key (con billing)"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-mono"
                  />
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={handleGenerateWithGemini}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    {isGenerating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5" />
                    )}
                    {isGenerating ? 'Genero...' : 'Genera'}
                  </button>
                </div>
                {errorMsg && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 leading-snug">
                    {errorMsg}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Prompt pronto da usare anche senza API key su Gemini/ChatGPT */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Oppure senza API Key: scarica il 3D e incolla questo prompt su Gemini / ChatGPT
              </span>
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-[11px] font-medium flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-emerald-600" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                {copied ? 'Copiato!' : 'Copia prompt'}
              </button>
            </div>
            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 leading-relaxed select-text">
              {builtPrompt}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

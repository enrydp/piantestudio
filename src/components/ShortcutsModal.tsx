/**
 * Modale con elenco completo delle scorciatoie da tastiera.
 */
import React from 'react';
import { Keyboard, X } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';

const SHORTCUTS: { group: string; items: { keys: string; desc: string }[] }[] = [
  {
    group: 'Generali',
    items: [
      { keys: 'Ctrl + Z', desc: 'Annulla ultima azione' },
      { keys: 'Ctrl + Y / Ctrl + Shift + Z', desc: 'Ripeti azione' },
      { keys: 'Canc / Backspace', desc: 'Elimina elemento selezionato' },
      { keys: 'Esc', desc: 'Termina polilinea o deseleziona' },
      { keys: '?', desc: 'Mostra / chiudi scorciatoie' },
    ],
  },
  {
    group: 'Navigazione Canvas 2D',
    items: [
      { keys: 'Rotella mouse', desc: 'Zoom centrato sul cursore' },
      { keys: 'V / H', desc: 'Strumento Selezione / Sposta vista (Pan)' },
      { keys: 'Spazio + Trascina', desc: 'Pan temporaneo sulla pianta' },
      { keys: 'W', desc: 'Strumento Polilinea Muri (Step 0)' },
      { keys: 'D', desc: 'Strumento Abbatti / Ripristina Muri (Step 0)' },
      { keys: 'Shift (tracciatura)', desc: 'Disattiva snap angolo 90°' },
    ],
  },
  {
    group: 'Arredamento (Step 2)',
    items: [
      { keys: 'R / Shift + R', desc: 'Ruota mobile +15° / -15°' },
      { keys: 'Shift + Click', desc: 'Selezione multipla mobili' },
      { keys: 'Ctrl + C / Ctrl + V', desc: 'Copia / Incolla mobili selezionati' },
    ],
  },
  {
    group: 'Rendering 3D (Step 3)',
    items: [
      { keys: 'W A S D / Frecce', desc: 'Cammina dentro casa (Prima persona)' },
      { keys: 'Trascina mouse', desc: 'Orbita camera o ruota sguardo' },
    ],
  },
];

export const ShortcutsModal: React.FC = () => {
  const { showShortcutsModal, setShowShortcutsModal } = useProjectStore();
  if (!showShortcutsModal) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={() => setShowShortcutsModal(false)}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-white">
            <Keyboard className="w-4 h-4 text-blue-600" />
            <span>Scorciatoie da tastiera</span>
          </div>
          <button
            type="button"
            onClick={() => setShowShortcutsModal(false)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {SHORTCUTS.map((sec) => (
            <div key={sec.group}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                {sec.group}
              </h3>
              <div className="space-y-1.5">
                {sec.items.map((item) => (
                  <div
                    key={item.keys}
                    className="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800/60 last:border-0"
                  >
                    <span className="text-slate-600 dark:text-slate-300">{item.desc}</span>
                    <kbd className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

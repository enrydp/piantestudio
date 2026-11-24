/**
 * Pannello catalogo mobili per lo Step 2 (Arredamento):
 * - Carica il catalogo JSON estendibile (src/data/furnitureCatalog.json)
 * - Filtrabile per categoria (Tutte, Soggiorno, Cucina, Camera, Bagno, Altro) e ricerca testuale
 * - Supporta sia Drag & Drop diretto sulla piantina (con fallback in store) sia click diretto sul mobile o su "+"
 */
import React, { useMemo, useState } from 'react';
import { GripVertical, Plus, Search } from 'lucide-react';
import rawCatalog from '../data/furnitureCatalog.json';
import type { FurnitureCatalogItem, FurnitureCategory } from '../types/project';
import { useProjectStore } from '../store/useProjectStore';

const CATALOG = rawCatalog as FurnitureCatalogItem[];

const CATEGORIES: ('Tutte' | FurnitureCategory)[] = [
  'Tutte',
  'Soggiorno',
  'Cucina',
  'Camera',
  'Bagno',
  'Impianti',
  'Scale',
  'Altro',
];

interface FurnitureCatalogPanelProps {
  onQuickAdd: (item: FurnitureCatalogItem) => void;
}

export const FurnitureCatalogPanel: React.FC<FurnitureCatalogPanelProps> = ({
  onQuickAdd,
}) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'Tutte' | FurnitureCategory>('Tutte');
  const setDraggingCatalogItem = useProjectStore((s) => s.setDraggingCatalogItem);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CATALOG.filter((item) => {
      const catOk = category === 'Tutte' || item.categoria === category;
      const textOk =
        !q ||
        item.nome.toLowerCase().includes(q) ||
        item.categoria.toLowerCase().includes(q);
      return catOk && textOk;
    });
  }, [search, category]);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Catalogo Mobili
        </span>
        <span className="text-[10px] text-slate-400">{filtered.length} elementi</span>
      </div>

      {/* Campo ricerca */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca divano, letto, scala..."
          className="w-full pl-8 pr-2.5 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Filtri categoria */}
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
              category === cat
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Lista trascinabile e cliccabile */}
      <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-0.5">
        {filtered.map((item) => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => {
              const payload = JSON.stringify(item);
              e.dataTransfer.setData('application/x-piantestudio-furniture', payload);
              e.dataTransfer.setData('text/plain', payload);
              e.dataTransfer.effectAllowed = 'copy';
              setDraggingCatalogItem(item);
            }}
            onDragEnd={() => {
              setDraggingCatalogItem(null);
            }}
            onClick={() => onQuickAdd(item)}
            title={`Clicca o trascina "${item.nome}" sulla piantina`}
            className="group flex items-center gap-2 p-2 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 hover:border-blue-400 dark:hover:border-blue-500 transition-all cursor-pointer active:scale-[0.99]"
          >
            <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0 cursor-grab" />
            <div
              className="w-5 h-5 rounded-md border border-slate-300 dark:border-slate-600 shrink-0"
              style={{ backgroundColor: item.coloreDefault }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">
                {item.nome}
              </div>
              <div className="text-[10px] text-slate-400">
                {item.dimensioni.width}×{item.dimensioni.depth}×{item.dimensioni.height} cm
              </div>
            </div>
            <button
              type="button"
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onQuickAdd(item);
              }}
              title={`Inserisci ${item.nome} nella pianta`}
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="text-center text-xs text-slate-400 py-4">
            Nessun mobile trovato per "{search}"
          </p>
        )}
      </div>

      <p className="text-[10px] text-slate-400 leading-snug">
        Clicca o trascina qualsiasi mobile sulla pianta per aggiungerne quanti vuoi. Usa <strong>R</strong> / <strong>Shift+R</strong> per ruotare.
      </p>
    </div>
  );
};

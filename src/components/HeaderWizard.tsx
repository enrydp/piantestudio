/**
 * Barra superiore del wizard PianteStudio:
 * - Logo e nome progetto editabile
 * - Navigazione libera tra i 4 step (senza perdita di dati)
 * - Undo/Redo, Import/Export JSON, Nuovo progetto, Scorciatoie, Tema chiaro/scuro
 */
import React, { useRef } from 'react';
import {
  Calculator,
  Compass,
  DoorOpen,
  Download,
  FilePlus2,
  HelpCircle,
  Home,
  Moon,
  Redo2,
  Sofa,
  Sun,
  Undo2,
  Upload,
  Box,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import type { WizardStep } from '../types/project';

const STEPS: { id: WizardStep; title: string; subtitle: string; icon: React.ReactNode }[] = [
  {
    id: 0,
    title: '0. Piantina e Muri',
    subtitle: 'Carica, calibra e traccia',
    icon: <Compass className="w-4 h-4" />,
  },
  {
    id: 1,
    title: '1. Aperture',
    subtitle: 'Porte, finestre, archi',
    icon: <DoorOpen className="w-4 h-4" />,
  },
  {
    id: 2,
    title: '2. Arredamento',
    subtitle: 'Catalogo e layout',
    icon: <Sofa className="w-4 h-4" />,
  },
  {
    id: 3,
    title: '3. Rendering 3D',
    subtitle: 'Esplora ed esporta',
    icon: <Box className="w-4 h-4" />,
  },
  {
    id: 4,
    title: '4. Impianti & Vernice',
    subtitle: 'Cavi, tubi e pittura',
    icon: <Calculator className="w-4 h-4" />,
  },
];

export const HeaderWizard: React.FC = () => {
  const {
    step,
    setStep,
    project,
    setProjectName,
    past,
    future,
    undo,
    redo,
    theme,
    toggleTheme,
    exportProjectJson,
    importProjectJson,
    resetProject,
    setShowShortcutsModal,
    showToast,
  } = useProjectStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportJson = () => {
    const data = exportProjectJson();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (project.name || 'progetto').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `${safeName}.piantestudio.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Progetto salvato in formato JSON', 'success');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importProjectJson(String(reader.result));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <header className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 flex items-center justify-between gap-2 z-30 select-none">
      {/* Brand + nome progetto */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
          <Home className="w-4 h-4" />
        </div>
        <div className="hidden sm:flex flex-col min-w-0">
          <span className="text-xs font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-none">
            PianteStudio
          </span>
          <input
            type="text"
            value={project.name}
            onChange={(e) => setProjectName(e.target.value)}
            aria-label="Nome progetto"
            className="text-[11px] text-slate-500 dark:text-slate-400 bg-transparent border-0 focus:outline-none focus:text-slate-900 dark:focus:text-white truncate max-w-[135px] mt-0.5"
            title="Clicca per rinominare il progetto"
          />
        </div>
      </div>

      {/* Barra di avanzamento Wizard a 4 Step */}
      <nav aria-label="Fasi del progetto" className="flex items-center gap-1 overflow-x-auto py-1">
        {STEPS.map((s, idx) => {
          const isActive = step === s.id;
          const isDone =
            (s.id === 0 && project.walls.length > 0) ||
            (s.id === 1 && project.openings.length > 0) ||
            (s.id === 2 && project.furniture.length > 0);

          return (
            <React.Fragment key={s.id}>
              <button
                type="button"
                onClick={() => setStep(s.id)}
                title={`${s.title} — ${s.subtitle}`}
                className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span
                  className={`flex items-center justify-center ${
                    isActive
                      ? 'text-white'
                      : isDone
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {s.icon}
                </span>
                <span>{s.title}</span>
                {isDone && !isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                )}
              </button>
              {idx < STEPS.length - 1 && (
                <div className="hidden lg:block w-4 h-px bg-slate-200 dark:bg-slate-700 shrink-0" />
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Azioni globali */}
      <div className="flex items-center gap-1 shrink-0">
        <div className="flex items-center border-r border-slate-200 dark:border-slate-800 pr-1.5 mr-0.5 gap-0.5">
          <button
            type="button"
            onClick={undo}
            disabled={past.length === 0}
            title="Annulla (Ctrl+Z)"
            aria-label="Annulla"
            className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={future.length === 0}
            title="Ripeti (Ctrl+Y / Ctrl+Shift+Z)"
            aria-label="Ripeti"
            className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImportFile}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Importa progetto JSON"
          aria-label="Importa JSON"
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <Upload className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleExportJson}
          title="Salva / Esporta progetto JSON"
          aria-label="Salva JSON"
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <Download className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            if (
              project.walls.length === 0 ||
              window.confirm('Vuoi creare un nuovo progetto vuoto? Le modifiche correnti possono essere annullate con Ctrl+Z.')
            ) {
              resetProject();
            }
          }}
          title="Nuovo progetto"
          aria-label="Nuovo progetto"
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <FilePlus2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setShowShortcutsModal(true)}
          title="Scorciatoie da tastiera (?)"
          aria-label="Scorciatoie da tastiera"
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'light' ? 'Attiva tema scuro' : 'Attiva tema chiaro'}
          aria-label="Cambia tema"
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
};

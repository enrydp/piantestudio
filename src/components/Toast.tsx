/**
 * Notifiche toast leggere in basso al centro.
 */
import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';

export const Toast: React.FC = () => {
  const { toast, clearToast } = useProjectStore();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(clearToast, 3600);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  if (!toast) return null;

  const styles = {
    info: 'bg-slate-900 dark:bg-slate-800 text-white border-slate-700',
    success: 'bg-emerald-600 text-white border-emerald-500',
    warning: 'bg-amber-600 text-white border-amber-500',
    error: 'bg-red-600 text-white border-red-500',
  }[toast.type];

  const Icon = {
    info: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    error: XCircle,
  }[toast.type];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
      <div
        className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-lg text-xs font-medium ${styles}`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span>{toast.text}</span>
        <button
          type="button"
          onClick={clearToast}
          className="ml-1 opacity-75 hover:opacity-100 cursor-pointer"
          aria-label="Chiudi notifica"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

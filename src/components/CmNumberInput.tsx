/**
 * Campo numerico in centimetri che consente di digitare liberamente da tastiera
 * (senza forzare il clamp a ogni singolo tasto) e di usare anche le frecce su/giù.
 */
import React, { useEffect, useState } from 'react';

interface CmNumberInputProps {
  value: number;
  min: number;
  max: number;
  onChangeValue: (nextCm: number) => void;
  className?: string;
  ariaLabel?: string;
}

export const CmNumberInput: React.FC<CmNumberInputProps> = ({
  value,
  min,
  max,
  onChangeValue,
  className = '',
  ariaLabel,
}) => {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // Sincronizza dal valore esterno solo quando non stiamo digitando attivamente
  useEffect(() => {
    if (!focused) {
      setDraft(String(value));
    }
  }, [value, focused]);

  const commitDraft = (raw: string) => {
    const parsed = Number(raw.replace(',', '.'));
    if (!Number.isFinite(parsed) || raw.trim() === '') {
      setDraft(String(value));
      return;
    }
    const clamped = Math.round(Math.max(min, Math.min(max, parsed)));
    setDraft(String(clamped));
    if (clamped !== value) {
      onChangeValue(clamped);
    }
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      aria-label={ariaLabel}
      value={draft}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const nextRaw = e.target.value;
        setDraft(nextRaw);
        if (nextRaw.trim() === '') return;
        const parsed = Number(nextRaw);
        // Aggiorna subito solo se è già nell'intervallo valido (es. clic sui tastini o numero completo)
        if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
          onChangeValue(Math.round(parsed));
        }
      }}
      onBlur={() => {
        setFocused(false);
        commitDraft(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commitDraft(draft);
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
};

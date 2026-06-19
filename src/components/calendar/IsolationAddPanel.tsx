'use client';

import { CellPopulation } from '@/types';

interface Props {
  population: CellPopulation;
  /** Existing event templates — same source as the popover's quick-add list. */
  eventTemplates: { label: string; color: string; durationH: number; offsetFromEndH: number }[];
  isMobile: boolean;
  onAddQuickEvent: (label: string, color: string, durationH: number, offsetFromEndH: number) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

/**
 * Floating "Add event" pane surfaced automatically in isolation mode. It hovers over
 * the dimmed (greyed-out) area so the user can add an event without dragging inside
 * the bar — either by picking an existing template or creating a fresh blank event.
 */
export default function IsolationAddPanel({
  population, eventTemplates, isMobile, onAddQuickEvent, onCreateNew, onClose,
}: Props) {
  const containerClasses = isMobile
    ? 'fixed inset-x-2 bottom-3 z-40 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3'
    : 'absolute bottom-6 right-6 z-40 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3';

  return (
    <div className={containerClasses}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-black/5" style={{ backgroundColor: population.color }} />
        <div className="flex-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
          Add event · {population.name || 'Untitled'}
        </div>
        <button
          onClick={onClose}
          aria-label="Dismiss add-event pane"
          title="Dismiss"
          className="-mr-1 w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden">
        {eventTemplates.length > 0 && (
          <div className="max-h-40 overflow-y-auto">
            {eventTemplates.map(t => (
              <button
                key={t.label}
                onClick={() => onAddQuickEvent(t.label, t.color, t.durationH, t.offsetFromEndH)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white transition-colors border-b border-slate-100 last:border-b-0"
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-black/5" style={{ backgroundColor: t.color }} />
                <span className="flex-1 truncate text-xs font-semibold text-slate-700">{t.label}</span>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={onCreateNew}
          className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-indigo-600 hover:bg-indigo-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span className="flex-1 text-xs font-bold">Create new</span>
        </button>
      </div>

      <div className="mt-2 text-[10px] font-medium text-slate-400 text-center">
        or drag inside the bar
      </div>
    </div>
  );
}

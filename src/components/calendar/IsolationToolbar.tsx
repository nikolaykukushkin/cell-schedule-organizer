'use client';

import { CellPopulation } from '@/types';

interface Props {
  population: CellPopulation;
  eventCount: number;
  onExit: () => void;
}

export default function IsolationToolbar({ population, eventCount, onExit }: Props) {
  return (
    <div className="flex items-center gap-3 bg-indigo-600 text-white px-4 py-2 border-b border-indigo-700 flex-shrink-0">
      <div className="w-2 h-6 rounded-full bg-white/40 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold uppercase tracking-wider opacity-80">Editing events</div>
        <div className="text-sm font-bold truncate">
          {population.name || 'Untitled'} · {eventCount} {eventCount === 1 ? 'event' : 'events'}
        </div>
      </div>
      <span className="hidden md:inline text-xs opacity-80 font-medium">
        Drag inside the bar to create an event
      </span>
      <button
        onClick={onExit}
        aria-label="Exit isolation mode"
        title="Exit (Esc)"
        className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 transition-colors flex-shrink-0"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

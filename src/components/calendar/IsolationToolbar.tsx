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
        aria-label="Done editing events"
        title="Done (Esc)"
        className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-white text-indigo-600 text-sm font-bold hover:bg-white/90 transition-colors flex-shrink-0"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Done
      </button>
    </div>
  );
}

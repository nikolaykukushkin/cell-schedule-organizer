'use client';

import { useEffect, useMemo, useRef } from 'react';
import { CellPopulation, SubEvent, densityUnit, platesLabel } from '@/types';

interface BaseProps {
  anchor: DOMRect | null;
  onClose: () => void;
  isMobile: boolean;
}

interface PopProps extends BaseProps {
  kind: 'pop';
  population: CellPopulation;
  eventCount: number;
  onEnterIsolation: () => void;
  onEditDetails: () => void;
  onDelete: () => void;
}

interface EvProps extends BaseProps {
  kind: 'event';
  subEvent: SubEvent;
  onEditDetails: () => void;
  onDelete: () => void;
}

export type ExperimentPopoverProps = PopProps | EvProps;

/**
 * Apple-style compact popover. Anchored to the bar's bounding rect on desktop;
 * slides up as a bottom sheet on mobile.
 */
export default function ExperimentPopover(props: ExperimentPopoverProps) {
  const { anchor, onClose, isMobile } = props;
  const ref = useRef<HTMLDivElement>(null);

  // Position the popover relative to the anchor on desktop. Recomputed on every
  // anchor/isMobile change — viewport reads are intentionally point-in-time;
  // parent re-emits anchor on resize/scroll via onLayoutChange.
  const pos = useMemo(() => {
    if (isMobile || !anchor) return null;
    const W = 280;
    const H = 200;
    const margin = 8;
    let left = anchor.left + anchor.width / 2 - W / 2;
    left = Math.max(margin, Math.min(window.innerWidth - W - margin, left));
    const spaceBelow = window.innerHeight - anchor.bottom;
    const placeBelow = spaceBelow > H + margin || anchor.top < H + margin;
    const top = placeBelow ? anchor.bottom + margin : Math.max(margin, anchor.top - H - margin);
    return { left, top, arrow: placeBelow ? 'top' : 'bottom' as const };
  }, [anchor, isMobile]);

  // Close on Esc + click-outside
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current) return;
      if (ref.current.contains(target)) return;
      // Don't close if click was on the anchor bar (lets the user re-click to deselect via Timeline's onDeselect)
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // Delay attaching mousedown so the opening click doesn't immediately close it
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onDown);
      window.addEventListener('touchstart', onDown);
    }, 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('touchstart', onDown);
    };
  }, [onClose]);

  const containerStyle: React.CSSProperties = isMobile
    ? {}
    : pos
      ? { left: pos.left, top: pos.top, width: 280 }
      : { left: -9999, top: -9999 };

  const containerClasses = isMobile
    ? 'fixed inset-x-2 bottom-3 z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4'
    : 'fixed z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3';

  if (props.kind === 'pop') {
    const { population: p, eventCount, onEnterIsolation, onEditDetails, onDelete } = props;
    return (
      <div ref={ref} className={containerClasses} style={containerStyle}>
        <div className="flex items-start gap-3 mb-3">
          <div className="w-2.5 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-800 truncate">{p.name || 'Untitled'}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {p.startDate} – {p.endDate}
            </div>
            <div className="text-xs text-slate-400 mt-0.5 truncate">
              {platesLabel(p.plateType, p.plateCount)}
              {p.cellDensity && ` · ${p.cellDensity} ${densityUnit(p.plateType)}`}
            </div>
            {p.experimentLabel && (
              <div className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-wider">{p.experimentLabel}</div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={onEnterIsolation}
            className="px-2 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex flex-col items-center gap-0.5"
          >
            <span>Events</span>
            <span className="text-[10px] opacity-80">({eventCount})</span>
          </button>
          <button
            onClick={onEditDetails}
            className="px-2 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            Edit details
          </button>
          <button
            onClick={onDelete}
            className="px-2 py-2 rounded-lg text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  // Sub-event popover
  const { subEvent: ev, onEditDetails, onDelete } = props;
  return (
    <div ref={ref} className={containerClasses} style={containerStyle}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-2.5 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: ev.color }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-slate-800 truncate">{ev.label || 'New event'}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {ev.startDate}
            {ev.allDay
              ? ' (all day)'
              : ` · ${String(ev.startHour).padStart(2, '0')}:00 – ${String(ev.endHour).padStart(2, '0')}:59`}
          </div>
          {ev.startDate !== ev.endDate && (
            <div className="text-xs text-slate-400 mt-0.5">to {ev.endDate}</div>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex-shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={onEditDetails}
          className="px-2 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
        >
          Edit details
        </button>
        <button
          onClick={onDelete}
          className="px-2 py-2 rounded-lg text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

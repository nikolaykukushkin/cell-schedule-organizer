'use client';

import { useCallback, useRef, useState } from 'react';
import { SubEvent, CellPopulation, PlateType, PLATE_LABELS, densityUnit } from '@/types';
import * as storage from '@/lib/storage';
import PlateVisual from './PlateVisual';
import AutocompleteInput from './AutocompleteInput';
import { pushToLabBook } from '@/lib/github-sync';

interface EventPanelProps {
  subEvent: SubEvent | null;
  population: CellPopulation | null;
  allEvents: SubEvent[];
  onUpdateSubEvent: (evt: SubEvent) => void;
  onDeleteSubEvent: (id: string) => void;
  onUpdatePopulation: (pop: CellPopulation) => void;
  onDeletePopulation: (id: string) => void;
  onRepeatNextWeek: (popId: string) => void;
  onClose: () => void;
  isMobile: boolean;
}

function HourInput({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        max={23}
        value={value}
        autoComplete="off"
        onChange={e => onChange(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
        className="w-16 border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800 text-center bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
      />
      <span className="text-xs text-slate-400 font-medium">h</span>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{children}</label>;
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-lpignore="true"
      data-form-type="other"
      {...props}
      className={`w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all ${props.className || ''}`}
    />
  );
}

export default function EventPanel({
  subEvent,
  population,
  allEvents,
  onUpdateSubEvent,
  onDeleteSubEvent,
  onUpdatePopulation,
  onDeletePopulation,
  onRepeatNextWeek,
  onClose,
  isMobile,
}: EventPanelProps) {
  const [labBookStatus, setLabBookStatus] = useState<'idle' | 'pushing' | 'done' | 'error'>('idle');

  // Draggable panel position (desktop only)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    if ((e.target as HTMLElement).closest('input, select, button, textarea, [data-no-drag]')) return;
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const currentX = pos?.x ?? rect.left;
    const currentY = pos?.y ?? rect.top;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: currentX, origY: currentY };
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({ x: dragRef.current.origX + (me.clientX - dragRef.current.startX), y: dragRef.current.origY + (me.clientY - dragRef.current.startY) });
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos, isMobile]);

  const handleAddToLabBook = useCallback(async () => {
    if (!population) return;
    setLabBookStatus('pushing');
    const popEvents = allEvents.filter(e => e.populationId === population.id);
    const result = await pushToLabBook(population, popEvents);
    setLabBookStatus(result.ok ? 'done' : 'error');
    if (result.ok) setTimeout(() => setLabBookStatus('idle'), 3000);
  }, [population, allEvents]);

  if (!subEvent && !population) return null;

  const desktopStyle = !isMobile && pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } as React.CSSProperties : {};

  // On mobile: render inline (not fixed). On desktop: floating panel.
  const panelClasses = isMobile
    ? 'bg-white border-t border-slate-200 p-4 overflow-y-auto flex-shrink-0'
    : 'fixed right-4 top-16 w-[340px] bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/60 p-5 overflow-y-auto z-40 max-h-[calc(100vh-5rem)]';

  const content = (
    <div ref={panelRef} className={panelClasses} style={desktopStyle} onMouseDown={handleDragStart}>
      {/* Drag handle (desktop) */}
      {!isMobile && <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-slate-200 cursor-grab active:cursor-grabbing" />}

      <div className="flex justify-between items-center mb-4 mt-1">
        <h3 className="text-base font-bold text-slate-800 tracking-tight">
          {subEvent ? 'Event' : 'Experiment'}
        </h3>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </div>

      {subEvent && (
        <div className="space-y-3">
          <div>
            <Label>Label</Label>
            <Input type="text" value={subEvent.label} onChange={e => onUpdateSubEvent({ ...subEvent, label: (e.target as HTMLInputElement).value })} placeholder="e.g. Wash, Treatment, SFM" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Start</Label>
              <input type="date" autoComplete="off" value={subEvent.startDate} onChange={e => onUpdateSubEvent({ ...subEvent, startDate: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800 bg-white focus:border-indigo-400 outline-none" />
            </div>
            <div>
              <Label>End</Label>
              <input type="date" autoComplete="off" value={subEvent.endDate} onChange={e => onUpdateSubEvent({ ...subEvent, endDate: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800 bg-white focus:border-indigo-400 outline-none" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={subEvent.allDay ?? true} onChange={e => onUpdateSubEvent({ ...subEvent, allDay: e.target.checked, startHour: 0, endHour: 23 })} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="text-sm text-slate-600 font-medium">All day</span>
            </label>
          </div>
          {!(subEvent.allDay ?? true) && (
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Label>Start Hour</Label><HourInput value={subEvent.startHour} onChange={h => onUpdateSubEvent({ ...subEvent, startHour: h })} /></div>
              <div className="flex-1"><Label>End Hour</Label><HourInput value={subEvent.endHour} onChange={h => onUpdateSubEvent({ ...subEvent, endHour: h })} /></div>
            </div>
          )}
          <div>
            <Label>Comments</Label>
            <textarea autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={subEvent.comments || ''} onChange={e => onUpdateSubEvent({ ...subEvent, comments: e.target.value })} placeholder="Notes about this event..." rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none resize-none" />
          </div>
          <div>
            <Label>Color</Label>
            <input type="color" value={subEvent.color} onChange={e => onUpdateSubEvent({ ...subEvent, color: e.target.value })} className="w-full h-9 border border-slate-200 rounded-lg cursor-pointer bg-white" />
          </div>
          <div className="pt-1 space-y-2">
            <button onClick={onClose} className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm">
              Done
            </button>
            <button onClick={() => onDeleteSubEvent(subEvent.id)} className="w-full px-3 py-2 rounded-lg text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition-colors">
              Delete Event
            </button>
          </div>
        </div>
      )}

      {population && !subEvent && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2"><Label>Experiment Name</Label><AutocompleteInput value={population.name} onChange={v => onUpdatePopulation({ ...population, name: v })} suggestions={storage.getAllExperimentNames()} placeholder="e.g. CRE-luc timecourse" /></div>
            <div className="col-span-2"><Label>Experiment ID</Label><Input type="text" value={population.experimentLabel || ''} onChange={e => onUpdatePopulation({ ...population, experimentLabel: (e.target as HTMLInputElement).value })} placeholder="e.g. Exp 042" /></div>
            <div>
              <Label>Cell Line</Label>
              <AutocompleteInput value={population.cellLine} onChange={v => onUpdatePopulation({ ...population, cellLine: v })} suggestions={storage.getAllCellLines()} placeholder="e.g. HEK-293T" />
            </div>
            <div><Label>Passage #</Label><Input type="text" value={population.passage} onChange={e => onUpdatePopulation({ ...population, passage: (e.target as HTMLInputElement).value })} placeholder="e.g. 12" /></div>
            <div><Label>Experimenter</Label><Input type="text" value={population.experimenter} onChange={e => onUpdatePopulation({ ...population, experimenter: (e.target as HTMLInputElement).value })} placeholder="e.g. Nikolay" /></div>
            <div>
              <Label>Plate Type</Label>
              <select autoComplete="off" value={population.plateType} onChange={e => onUpdatePopulation({ ...population, plateType: e.target.value as PlateType })} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800 bg-white focus:border-indigo-400 outline-none">
                {Object.entries(PLATE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><Label>Plate Count</Label><Input type="number" min={1} value={population.plateCount} onChange={e => onUpdatePopulation({ ...population, plateCount: parseInt((e.target as HTMLInputElement).value) || 1 })} /></div>
            <div><Label>Density ({densityUnit(population.plateType)})</Label><Input type="text" value={population.cellDensity} onChange={e => onUpdatePopulation({ ...population, cellDensity: (e.target as HTMLInputElement).value })} placeholder="e.g. 0.5" /></div>
          </div>
          <div className="flex items-center justify-center bg-slate-50 rounded-lg p-2">
            <PlateVisual plateType={population.plateType} count={population.plateCount} size={34} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Seed Date</Label>
              <input type="date" autoComplete="off" value={population.startDate} onChange={e => onUpdatePopulation({ ...population, startDate: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800 bg-white focus:border-indigo-400 outline-none" />
            </div>
            <div>
              <Label>Harvest Date</Label>
              <input type="date" autoComplete="off" value={population.endDate} onChange={e => onUpdatePopulation({ ...population, endDate: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800 bg-white focus:border-indigo-400 outline-none" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={population.allDay ?? true} onChange={e => onUpdatePopulation({ ...population, allDay: e.target.checked, startHour: 0, endHour: 23 })} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="text-sm text-slate-600 font-medium">All day</span>
            </label>
          </div>
          {!(population.allDay ?? true) && (
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Label>Start Hour</Label><HourInput value={population.startHour} onChange={h => onUpdatePopulation({ ...population, startHour: h })} /></div>
              <div className="flex-1"><Label>End Hour</Label><HourInput value={population.endHour} onChange={h => onUpdatePopulation({ ...population, endHour: h })} /></div>
            </div>
          )}
          <div>
            <Label>Comments</Label>
            <textarea autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={population.comments || ''} onChange={e => onUpdatePopulation({ ...population, comments: e.target.value })} placeholder="Notes about this experiment..." rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none resize-none" />
          </div>
          <div>
            <Label>Color</Label>
            <input type="color" value={population.color} onChange={e => onUpdatePopulation({ ...population, color: e.target.value })} className="w-full h-9 border border-slate-200 rounded-lg cursor-pointer bg-white" />
          </div>
          <div className="pt-1 space-y-2">
            <button onClick={onClose} className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm">
              Done
            </button>
            <button onClick={handleAddToLabBook} disabled={labBookStatus === 'pushing'} className="w-full px-3 py-2 rounded-lg text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 transition-colors disabled:opacity-50">
              {labBookStatus === 'pushing' ? 'Pushing...' : labBookStatus === 'done' ? 'Added!' : labBookStatus === 'error' ? 'Failed — retry?' : 'Add to Lab Book'}
            </button>
            <button onClick={() => onRepeatNextWeek(population.id)} className="w-full px-3 py-2 rounded-lg text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 transition-colors">
              Repeat Next Week
            </button>
            <button onClick={() => onDeletePopulation(population.id)} className="w-full px-3 py-2 rounded-lg text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition-colors">
              Delete Experiment
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return content;
}

'use client';

import { SubEvent, CellPopulation, PlateType, PLATE_LABELS, densityUnit } from '@/types';
import PlateVisual from './PlateVisual';

interface EventPanelProps {
  subEvent: SubEvent | null;
  population: CellPopulation | null;
  onUpdateSubEvent: (evt: SubEvent) => void;
  onDeleteSubEvent: (id: string) => void;
  onUpdatePopulation: (pop: CellPopulation) => void;
  onDeletePopulation: (id: string) => void;
  onRepeatNextWeek: (popId: string) => void;
  onClose: () => void;
}

function HourInput({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        max={23}
        value={value}
        onChange={e => onChange(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
        className="w-16 border border-slate-200 rounded-lg px-2 py-2.5 text-base text-slate-800 text-center bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
      />
      <span className="text-sm text-slate-400 font-medium">h</span>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{children}</label>;
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-base text-slate-800 bg-white placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all ${props.className || ''}`}
    />
  );
}

export default function EventPanel({
  subEvent,
  population,
  onUpdateSubEvent,
  onDeleteSubEvent,
  onUpdatePopulation,
  onDeletePopulation,
  onRepeatNextWeek,
  onClose,
}: EventPanelProps) {
  if (!subEvent && !population) return null;

  return (
    <>
    {/* Mobile backdrop */}
    <div className="hidden max-md:block fixed inset-0 bg-black/20 z-30" onClick={onClose} />
    <div className="
      fixed right-4 top-16 bottom-4 w-[340px] bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/60
      p-6 overflow-y-auto z-40
      max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:w-auto max-md:max-h-[55vh] max-md:rounded-b-none max-md:rounded-t-2xl max-md:right-0 max-md:border-0 max-md:shadow-[0_-8px_30px_rgba(0,0,0,0.12)]
    ">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-bold text-slate-800 tracking-tight">
          {subEvent ? 'Event' : 'Population'}
        </h3>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </div>

      {subEvent && (
        <div className="space-y-5">
          <div>
            <Label>Label</Label>
            <Input
              type="text"
              value={subEvent.label}
              onChange={e => onUpdateSubEvent({ ...subEvent, label: (e.target as HTMLInputElement).value })}
              placeholder="e.g. Wash, Treatment, SFM"
            />
          </div>

          <div>
            <Label>Start</Label>
            <div className="flex gap-2">
              <input
                type="date"
                value={subEvent.startDate}
                onChange={e => onUpdateSubEvent({ ...subEvent, startDate: e.target.value })}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-800 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
              />
              <HourInput value={subEvent.startHour} onChange={h => onUpdateSubEvent({ ...subEvent, startHour: h })} />
            </div>
          </div>

          <div>
            <Label>End</Label>
            <div className="flex gap-2">
              <input
                type="date"
                value={subEvent.endDate}
                onChange={e => onUpdateSubEvent({ ...subEvent, endDate: e.target.value })}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-800 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
              />
              <HourInput value={subEvent.endHour} onChange={h => onUpdateSubEvent({ ...subEvent, endHour: h })} />
            </div>
          </div>

          <div>
            <Label>Color</Label>
            <input
              type="color"
              value={subEvent.color}
              onChange={e => onUpdateSubEvent({ ...subEvent, color: e.target.value })}
              className="w-full h-10 border border-slate-200 rounded-lg cursor-pointer bg-white"
            />
          </div>

          <button
            onClick={() => onDeleteSubEvent(subEvent.id)}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition-colors"
          >
            Delete Event
          </button>
        </div>
      )}

      {population && !subEvent && (
        <div className="space-y-5">
          <div>
            <Label>Name</Label>
            <Input
              type="text"
              value={population.name}
              onChange={e => onUpdatePopulation({ ...population, name: (e.target as HTMLInputElement).value })}
            />
          </div>

          <div>
            <Label>Plate Type</Label>
            <select
              value={population.plateType}
              onChange={e => onUpdatePopulation({ ...population, plateType: e.target.value as PlateType })}
              className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-base text-slate-800 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
            >
              {Object.entries(PLATE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <Label>Plate Count</Label>
            <Input
              type="number"
              min={1}
              value={population.plateCount}
              onChange={e => onUpdatePopulation({ ...population, plateCount: parseInt((e.target as HTMLInputElement).value) || 1 })}
            />
          </div>

          <div className="py-1 flex items-center justify-center bg-slate-50 rounded-lg p-3">
            <PlateVisual plateType={population.plateType} count={population.plateCount} size={38} />
          </div>

          <div>
            <Label>Seeding Density ({densityUnit(population.plateType)})</Label>
            <Input
              type="text"
              value={population.cellDensity}
              onChange={e => onUpdatePopulation({ ...population, cellDensity: (e.target as HTMLInputElement).value })}
              placeholder="e.g. 0.5"
            />
          </div>

          <div>
            <Label>Start</Label>
            <div className="flex gap-2">
              <input
                type="date"
                value={population.startDate}
                onChange={e => onUpdatePopulation({ ...population, startDate: e.target.value })}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-800 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
              />
              <HourInput value={population.startHour} onChange={h => onUpdatePopulation({ ...population, startHour: h })} />
            </div>
          </div>

          <div>
            <Label>End</Label>
            <div className="flex gap-2">
              <input
                type="date"
                value={population.endDate}
                onChange={e => onUpdatePopulation({ ...population, endDate: e.target.value })}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-800 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
              />
              <HourInput value={population.endHour} onChange={h => onUpdatePopulation({ ...population, endHour: h })} />
            </div>
          </div>

          <div>
            <Label>Color</Label>
            <input
              type="color"
              value={population.color}
              onChange={e => onUpdatePopulation({ ...population, color: e.target.value })}
              className="w-full h-10 border border-slate-200 rounded-lg cursor-pointer bg-white"
            />
          </div>

          <div className="pt-2 space-y-2">
            <button
              onClick={() => onRepeatNextWeek(population.id)}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 transition-colors"
            >
              Repeat Next Week
            </button>
            <button
              onClick={() => onDeletePopulation(population.id)}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition-colors"
            >
              Delete Population
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

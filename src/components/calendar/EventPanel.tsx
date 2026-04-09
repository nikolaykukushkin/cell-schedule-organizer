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
  onClose: () => void;
}

function HourInput({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        max={23}
        value={value}
        onChange={e => onChange(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
        className="w-14 border border-gray-300 rounded-lg px-2 py-2 text-sm text-gray-900 text-center"
      />
      <span className="text-sm text-gray-500">h</span>
    </div>
  );
}

export default function EventPanel({
  subEvent,
  population,
  onUpdateSubEvent,
  onDeleteSubEvent,
  onUpdatePopulation,
  onDeletePopulation,
  onClose,
}: EventPanelProps) {
  if (!subEvent && !population) return null;

  return (
    <div className="w-80 border-l border-gray-200 bg-white p-5 overflow-y-auto flex-shrink-0">
      <div className="flex justify-between items-center mb-5">
        <h3 className="font-bold text-base text-gray-900">
          {subEvent ? 'Edit Sub-Event' : 'Edit Population'}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
      </div>

      {subEvent && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Label</label>
            <input
              type="text"
              value={subEvent.label}
              onChange={e => onUpdateSubEvent({ ...subEvent, label: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. Wash, Treatment, SFM"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Start</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={subEvent.startDate}
                onChange={e => onUpdateSubEvent({ ...subEvent, startDate: e.target.value })}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              />
              <HourInput value={subEvent.startHour} onChange={h => onUpdateSubEvent({ ...subEvent, startHour: h })} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">End</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={subEvent.endDate}
                onChange={e => onUpdateSubEvent({ ...subEvent, endDate: e.target.value })}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              />
              <HourInput value={subEvent.endHour} onChange={h => onUpdateSubEvent({ ...subEvent, endHour: h })} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Color</label>
            <input
              type="color"
              value={subEvent.color}
              onChange={e => onUpdateSubEvent({ ...subEvent, color: e.target.value })}
              className="w-full h-9 border border-gray-300 rounded-lg cursor-pointer"
            />
          </div>

          <button
            onClick={() => onDeleteSubEvent(subEvent.id)}
            className="w-full mt-2 px-3 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-100"
          >
            Delete Sub-Event
          </button>
        </div>
      )}

      {population && !subEvent && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Name</label>
            <input
              type="text"
              value={population.name}
              onChange={e => onUpdatePopulation({ ...population, name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Plate Type</label>
            <select
              value={population.plateType}
              onChange={e => onUpdatePopulation({ ...population, plateType: e.target.value as PlateType })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            >
              {Object.entries(PLATE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Number of Plates</label>
            <input
              type="number"
              min={1}
              value={population.plateCount}
              onChange={e => onUpdatePopulation({ ...population, plateCount: parseInt(e.target.value) || 1 })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            />
          </div>

          <div className="py-1">
            <PlateVisual plateType={population.plateType} count={population.plateCount} size={36} />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Seeding Density ({densityUnit(population.plateType)})
            </label>
            <input
              type="text"
              value={population.cellDensity}
              onChange={e => onUpdatePopulation({ ...population, cellDensity: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. 0.5"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Start</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={population.startDate}
                onChange={e => onUpdatePopulation({ ...population, startDate: e.target.value })}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              />
              <HourInput value={population.startHour} onChange={h => onUpdatePopulation({ ...population, startHour: h })} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">End</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={population.endDate}
                onChange={e => onUpdatePopulation({ ...population, endDate: e.target.value })}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              />
              <HourInput value={population.endHour} onChange={h => onUpdatePopulation({ ...population, endHour: h })} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Color</label>
            <input
              type="color"
              value={population.color}
              onChange={e => onUpdatePopulation({ ...population, color: e.target.value })}
              className="w-full h-9 border border-gray-300 rounded-lg cursor-pointer"
            />
          </div>

          <button
            onClick={() => onDeletePopulation(population.id)}
            className="w-full mt-2 px-3 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-100"
          >
            Delete Population
          </button>
        </div>
      )}
    </div>
  );
}

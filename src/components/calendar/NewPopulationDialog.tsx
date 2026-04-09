'use client';

import { useState } from 'react';
import { PlateType, PLATE_LABELS, densityUnit } from '@/types';
import PlateVisual from './PlateVisual';

interface NewPopulationDialogProps {
  startDate: string;
  endDate: string;
  onConfirm: (data: { name: string; plateType: PlateType; plateCount: number; cellDensity: string }) => void;
  onCancel: () => void;
}

export default function NewPopulationDialog({ startDate, endDate, onConfirm, onCancel }: NewPopulationDialogProps) {
  const [name, setName] = useState('');
  const [plateType, setPlateType] = useState<PlateType>('10cm');
  const [plateCount, setPlateCount] = useState(4);
  const [cellDensity, setCellDensity] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({ name: name.trim() || 'Untitled', plateType, plateCount, cellDensity });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-[420px]" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-1">New Cell Population</h3>
        <p className="text-sm text-gray-600 mb-5">{startDate} &rarr; {endDate}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. HEK293 passage 12"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Plate Type</label>
            <select
              value={plateType}
              onChange={e => setPlateType(e.target.value as PlateType)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900"
            >
              {Object.entries(PLATE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Number of Plates/Dishes</label>
            <input
              type="number"
              min={1}
              max={100}
              value={plateCount}
              onChange={e => setPlateCount(parseInt(e.target.value) || 1)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900"
            />
          </div>

          <div className="flex items-center gap-2 py-2">
            <PlateVisual plateType={plateType} count={plateCount} size={40} />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Seeding Density ({densityUnit(plateType)})
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={cellDensity}
                onChange={e => setCellDensity(e.target.value)}
                placeholder="e.g. 0.5"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400"
              />
              <span className="text-sm text-gray-700 font-semibold">{densityUnit(plateType)}</span>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700"
            >
              Create
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

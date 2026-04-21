'use client';

import { useState } from 'react';
import { PlateType, PLATE_LABELS, densityUnit } from '@/types';
import * as storage from '@/lib/storage';
import PlateVisual from './PlateVisual';
import AutocompleteInput from './AutocompleteInput';

interface NewPopulationDialogProps {
  startDate: string;
  endDate: string;
  onConfirm: (data: {
    name: string;
    cellLine: string;
    passage: string;
    plateType: PlateType;
    plateCount: number;
    cellDensity: string;
    experimenter: string;
    experimentLabel: string;
    comments: string;
  }) => void;
  onCancel: () => void;
}

export default function NewPopulationDialog({ startDate, endDate, onConfirm, onCancel }: NewPopulationDialogProps) {
  const [name, setName] = useState('');
  const [cellLine, setCellLine] = useState('');
  const [passage, setPassage] = useState('');
  const [plateType, setPlateType] = useState<PlateType>('10cm');
  const [plateCount, setPlateCount] = useState(4);
  const [cellDensity, setCellDensity] = useState('');
  const [experimenter, setExperimenter] = useState('');
  const [experimentLabel, setExperimentLabel] = useState('');
  const [comments, setComments] = useState('');

  const cellLineSuggestions = storage.getAllCellLines();
  const nameSuggestions = storage.getAllExperimentNames();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({
      name: name.trim() || 'Untitled',
      cellLine: cellLine.trim(),
      passage: passage.trim(),
      plateType,
      plateCount,
      cellDensity,
      experimenter: experimenter.trim(),
      experimentLabel: experimentLabel.trim(),
      comments: comments.trim(),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-[440px] max-md:w-[calc(100vw-24px)] max-md:mx-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-800 mb-1">New Experiment</h3>
        <p className="text-sm text-slate-500 mb-5">{startDate} &rarr; {endDate}</p>

        <form onSubmit={handleSubmit} className="space-y-3" autoComplete="off">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Experiment Name</label>
            <AutocompleteInput value={name} onChange={setName} suggestions={nameSuggestions} placeholder="e.g. CRE-luc timecourse" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Experiment ID</label>
            <input
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-form-type="other"
              value={experimentLabel}
              onChange={e => setExperimentLabel(e.target.value)}
              placeholder="e.g. Exp 042"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Cell Line</label>
              <AutocompleteInput value={cellLine} onChange={setCellLine} suggestions={cellLineSuggestions} placeholder="e.g. HEK-293T" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Passage #</label>
              <input
                type="text"
                autoComplete="off"
                value={passage}
                onChange={e => setPassage(e.target.value)}
                placeholder="e.g. 12"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Experimenter</label>
            <input
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-form-type="other"
              value={experimenter}
              onChange={e => setExperimenter(e.target.value)}
              placeholder="e.g. Nikolay"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Plate Type</label>
              <select
                value={plateType}
                onChange={e => setPlateType(e.target.value as PlateType)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
              >
                {Object.entries(PLATE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Plate Count</label>
              <input
                type="number"
                autoComplete="off"
                min={1}
                max={100}
                value={plateCount}
                onChange={e => setPlateCount(parseInt(e.target.value) || 1)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-center bg-slate-50 rounded-lg p-2.5">
            <PlateVisual plateType={plateType} count={plateCount} size={38} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Seeding Density ({densityUnit(plateType)})
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoComplete="off"
                value={cellDensity}
                onChange={e => setCellDensity(e.target.value)}
                placeholder="e.g. 0.5"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
              <span className="text-sm text-slate-500 font-semibold">{densityUnit(plateType)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Comments</label>
            <textarea
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={comments}
              onChange={e => setComments(e.target.value)}
              placeholder="Notes about this experiment..."
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors">
              Create
            </button>
            <button type="button" onClick={onCancel} className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

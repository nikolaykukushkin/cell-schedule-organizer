'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Experiment } from '@/types';
import * as storage from '@/lib/storage';

export default function Dashboard() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    setExperiments(storage.getExperiments());
  }, []);

  const handleCreate = () => {
    if (!newName.trim()) return;
    const experiment: Experiment = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      description: newDesc.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    storage.saveExperiment(experiment);
    setExperiments(prev => [...prev, experiment]);
    setNewName('');
    setNewDesc('');
    setShowNew(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this experiment and all its data?')) return;
    storage.deleteExperiment(id);
    setExperiments(prev => prev.filter(e => e.id !== id));
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cell Culture Scheduler</h1>
          <p className="text-sm text-gray-500 mt-1">
            Plan and visualize your cell culture experiment timelines
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
        >
          New Experiment
        </button>
      </div>

      {showNew && (
        <div className="mb-6 border border-indigo-200 rounded-lg p-4 bg-indigo-50">
          <h2 className="font-semibold text-sm mb-3">Create New Experiment</h2>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Experiment name"
            className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <textarea
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="px-4 py-1.5 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700"
            >
              Create
            </button>
            <button
              onClick={() => {
                setShowNew(false);
                setNewName('');
                setNewDesc('');
              }}
              className="px-4 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {experiments.length === 0 && !showNew ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">🧫</div>
          <p className="text-lg">No experiments yet</p>
          <p className="text-sm mt-1">Create your first experiment to get started</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {experiments.map(exp => (
            <div
              key={exp.id}
              className="border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between">
                <Link href={`/experiment/${exp.id}`} className="flex-1 group">
                  <h3 className="font-semibold text-gray-900 group-hover:text-indigo-600">
                    {exp.name}
                  </h3>
                  {exp.description && (
                    <p className="text-sm text-gray-500 mt-1">{exp.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    Created {new Date(exp.createdAt).toLocaleDateString()}
                  </p>
                </Link>
                <button
                  onClick={() => handleDelete(exp.id)}
                  className="text-gray-300 hover:text-red-500 text-sm ml-4"
                  title="Delete experiment"
                >
                  &times;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

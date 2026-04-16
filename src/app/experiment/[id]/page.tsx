'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExperimentGroup as Experiment } from '@/types';
import * as storage from '@/lib/storage';
import CalendarGrid from '@/components/calendar/CalendarGrid';

export default function ExperimentPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    const exp = storage.getExperiment(id);
    if (!exp) {
      router.push('/');
      return;
    }
    setExperiment(exp);
    setName(exp.name);
  }, [id, router]);

  const handleRename = () => {
    if (!experiment || !name.trim()) return;
    const updated = { ...experiment, name: name.trim(), updatedAt: new Date().toISOString() };
    storage.saveExperiment(updated);
    setExperiment(updated);
    setEditing(false);
  };

  if (!experiment) return null;

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b border-gray-200 bg-white px-4 py-2 flex items-center gap-3">
        <Link
          href="/"
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          &larr; Back
        </Link>
        <div className="w-px h-5 bg-gray-200" />
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRename()}
              className="border rounded px-2 py-1 text-sm font-semibold"
              autoFocus
            />
            <button onClick={handleRename} className="text-xs text-indigo-600 hover:text-indigo-800">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-gray-600">
              Cancel
            </button>
          </div>
        ) : (
          <h1
            className="font-semibold text-gray-900 cursor-pointer hover:text-indigo-600"
            onClick={() => setEditing(true)}
            title="Click to rename"
          >
            {experiment.name}
          </h1>
        )}
      </div>
      <CalendarGrid experimentId={id} />
    </div>
  );
}

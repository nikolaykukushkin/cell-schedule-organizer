'use client';

import { useEffect, useState } from 'react';
import { Experiment } from '@/types';
import * as storage from '@/lib/storage';
import CalendarGrid from '@/components/calendar/CalendarGrid';

const DEFAULT_EXPERIMENT_ID = 'default';

export default function Home() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Ensure a default experiment exists
    let exp = storage.getExperiment(DEFAULT_EXPERIMENT_ID);
    if (!exp) {
      exp = {
        id: DEFAULT_EXPERIMENT_ID,
        name: 'My Experiment',
        description: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      storage.saveExperiment(exp);
    }
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen">
      <CalendarGrid experimentId={DEFAULT_EXPERIMENT_ID} />
    </div>
  );
}

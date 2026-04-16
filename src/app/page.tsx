'use client';

import { useEffect, useState } from 'react';
import * as storage from '@/lib/storage';
import * as sync from '@/lib/sync';
import CalendarGrid from '@/components/calendar/CalendarGrid';

const DEFAULT_EXPERIMENT_ID = 'default';

export default function Home() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<string>('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Pull remote state first so we boot with whatever the server has
      await sync.pullFullSnapshot(DEFAULT_EXPERIMENT_ID);
      if (cancelled) return;
      // Ensure a default experiment exists locally (creates if missing — will also push to server)
      let exp = storage.getExperiment(DEFAULT_EXPERIMENT_ID);
      if (!exp) {
        exp = {
          id: DEFAULT_EXPERIMENT_ID,
          name: 'Lab Calendar',
          description: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        storage.saveExperiment(exp);
      }
      sync.startPolling(DEFAULT_EXPERIMENT_ID);
      const off = sync.onStatus(setStatus);
      setReady(true);
      return () => { off(); };
    })();
    return () => { cancelled = true; };
  }, []);

  if (!ready) return <div className="flex items-center justify-center h-screen text-slate-400 text-sm">Syncing…</div>;

  return (
    <div className="flex flex-col h-screen">
      <CalendarGrid experimentId={DEFAULT_EXPERIMENT_ID} syncStatus={status} />
    </div>
  );
}

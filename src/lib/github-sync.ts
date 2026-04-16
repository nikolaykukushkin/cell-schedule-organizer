import { CellPopulation, SubEvent, densityUnit } from '@/types';

const SYNC_DELAY_MS = 15 * 60 * 1000; // 15 minutes
const LAST_SYNC_KEY = 'cell-scheduler:last-sync-hash';

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Determine event type from a sub-event label */
function classifyEvent(label: string): 'seed' | 'treat' | 'harvest' | 'passage' | 'other' {
  const l = label.toLowerCase();
  if (l.includes('seed')) return 'seed';
  if (l.includes('harvest') || l.includes('collect')) return 'harvest';
  if (l.includes('passage') || l.includes('split')) return 'passage';
  if (l.includes('treat') || l.includes('sfm') || l.includes('wash') || l.includes('media')) return 'treat';
  return 'other';
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** Build a hash of the current schedule state to detect changes */
function hashState(populations: CellPopulation[], events: SubEvent[]): string {
  const data = JSON.stringify({ populations, events });
  let h = 0;
  for (let i = 0; i < data.length; i++) {
    h = ((h << 5) - h + data.charCodeAt(i)) | 0;
  }
  return String(h);
}

/** Generate the schedule events to push to GitHub */
function generateScheduleEvents(populations: CellPopulation[], events: SubEvent[]) {
  const result: {
    type: 'seed' | 'treat' | 'harvest' | 'passage' | 'other';
    cellLine: string;
    date: string;
    description: string;
    experimenter: string;
    experiment: string;
    plateType: string;
    plateCount: number;
    density: string;
    slug: string;
  }[] = [];

  for (const pop of populations) {
    // Population itself represents a seed-to-harvest timeline
    result.push({
      type: 'seed',
      cellLine: pop.name,
      date: pop.startDate,
      description: `Seed ${pop.name}: ${pop.plateCount}x ${pop.plateType}${pop.cellDensity ? `, ${pop.cellDensity} ${densityUnit(pop.plateType)}` : ''}. ${pop.startDate} to ${pop.endDate}.${pop.experimenter ? ` Experimenter: ${pop.experimenter}.` : ''}`,
      experimenter: pop.experimenter || '',
      experiment: pop.name,
      plateType: pop.plateType,
      plateCount: pop.plateCount,
      density: pop.cellDensity ? `${pop.cellDensity} ${densityUnit(pop.plateType)}` : '',
      slug: `seed-${slugify(pop.name)}-${pop.startDate}`,
    });

    // Harvest event
    result.push({
      type: 'harvest',
      cellLine: pop.name,
      date: pop.endDate,
      description: `Harvest ${pop.name}: ${pop.plateCount}x ${pop.plateType}. End of timeline.${pop.experimenter ? ` Experimenter: ${pop.experimenter}.` : ''}`,
      experimenter: pop.experimenter || '',
      experiment: pop.name,
      plateType: pop.plateType,
      plateCount: pop.plateCount,
      density: '',
      slug: `harvest-${slugify(pop.name)}-${pop.endDate}`,
    });

    // Sub-events within this population
    const popEvents = events.filter(e => e.populationId === pop.id);
    for (const ev of popEvents) {
      const evType = classifyEvent(ev.label);
      result.push({
        type: evType,
        cellLine: pop.name,
        date: ev.startDate,
        description: `${ev.label} for ${pop.name}: ${ev.startDate}${ev.startDate !== ev.endDate ? ` to ${ev.endDate}` : ''}.${pop.experimenter ? ` Experimenter: ${pop.experimenter}.` : ''}`,
        experimenter: pop.experimenter || '',
        experiment: pop.name,
        plateType: pop.plateType,
        plateCount: pop.plateCount,
        density: '',
        slug: `${slugify(ev.label)}-${slugify(pop.name)}-${ev.startDate}`,
      });
    }
  }

  return result;
}

/** Schedule a sync after 15 min of inactivity. Call on every data change. */
export function scheduleSync(populations: CellPopulation[], events: SubEvent[]) {
  if (syncTimer) clearTimeout(syncTimer);

  syncTimer = setTimeout(() => {
    doSync(populations, events);
  }, SYNC_DELAY_MS);
}

/** Actually push to GitHub */
async function doSync(populations: CellPopulation[], events: SubEvent[]) {
  if (populations.length === 0) return;

  // Check if state has changed since last sync
  const currentHash = hashState(populations, events);
  const lastHash = localStorage.getItem(LAST_SYNC_KEY);
  if (currentHash === lastHash) return;

  const scheduleEvents = generateScheduleEvents(populations, events);
  if (scheduleEvents.length === 0) return;

  try {
    const res = await fetch('/api/sync-github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: scheduleEvents }),
    });

    if (res.ok) {
      localStorage.setItem(LAST_SYNC_KEY, currentHash);
      console.log('[scheduler] Synced schedule to GitHub');
    } else {
      const err = await res.text();
      console.warn('[scheduler] GitHub sync failed:', err);
    }
  } catch (err) {
    console.warn('[scheduler] GitHub sync error:', err);
  }
}

/** Force an immediate sync (e.g. for manual trigger) */
export function forceSyncNow(populations: CellPopulation[], events: SubEvent[]) {
  if (syncTimer) clearTimeout(syncTimer);
  doSync(populations, events);
}

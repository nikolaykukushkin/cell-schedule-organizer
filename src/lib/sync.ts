import { CellPopulation, SubEvent, Connection, ExperimentGroup, Operator } from '@/types';

type Table = 'experiment_groups' | 'cell_populations' | 'sub_events' | 'connections' | 'operators';
type Op = 'upsert' | 'delete';
interface Mutation { table: Table; op: Op; row: Record<string, unknown> }

const LAST_SYNC_KEY = 'cell-scheduler:lastSyncAt';
const POLL_MS = 3000;
const FLUSH_DEBOUNCE_MS = 500;

let queue: Mutation[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let syncing = false;
let syncDisabled = false;
// IDs of records with un-acked local mutations. While an id is here, polls must NOT
// overwrite its local state — otherwise in-progress edits (e.g. typing a label) flash-revert
// to the server's stale value every 3 s.
const pendingIds = new Set<string>();

type Status = 'idle' | 'syncing' | 'error' | 'offline';
let status: Status = 'idle';
const statusListeners = new Set<(s: Status) => void>();
const changeListeners = new Set<() => void>();

function setStatus(s: Status) {
  status = s;
  statusListeners.forEach(cb => cb(s));
}

export function getStatus(): Status { return status; }
export function onStatus(cb: (s: Status) => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}
export function onRemoteChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

export function enqueue(m: Mutation) {
  if (syncDisabled) return;
  queue.push(m);
  const id = m.row.id as string | undefined;
  if (id) pendingIds.add(id);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
}

async function flush() {
  flushTimer = null;
  if (queue.length === 0 || syncDisabled) return;
  const batch = queue;
  queue = [];
  setStatus('syncing');
  try {
    const res = await fetch('/api/state/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations: batch }),
    });
    if (!res.ok) {
      queue = [...batch, ...queue];
      const body = await res.json().catch(() => ({}));
      if (res.status === 500 && body?.error?.includes('DATABASE_URL')) {
        syncDisabled = true;
        setStatus('offline');
        return;
      }
      setStatus('error');
      return;
    }
    // Successful flush: clear pending ids whose mutations are no longer in the queue
    // (i.e. no new edits arrived during the flight).
    for (const m of batch) {
      const id = m.row.id as string | undefined;
      if (!id) continue;
      if (!queue.some(qm => qm.row.id === id)) pendingIds.delete(id);
    }
    setStatus('idle');
  } catch {
    queue = [...batch, ...queue];
    setStatus('error');
  }
}

/** Push any remaining queued mutations now (e.g. before unload). */
export function flushNow() { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } return flush(); }

interface ServerRow { id: string; data?: unknown; updated_at?: string; deleted?: boolean }
interface StateResponse {
  ok: boolean;
  now: string;
  delta: boolean;
  groups: ServerRow[];
  populations: ServerRow[];
  subEvents: ServerRow[];
  connections: ServerRow[];
  operators?: ServerRow[];
  error?: string;
}

const OPERATORS_LS_KEY = 'cell-scheduler:operators';

/** Full snapshot. Overwrites localStorage. Called on boot. */
export async function pullFullSnapshot(experimentId: string): Promise<boolean> {
  if (syncDisabled) return false;
  setStatus('syncing');
  try {
    const res = await fetch(`/api/state?experimentId=${encodeURIComponent(experimentId)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 500 && body?.error?.includes('DATABASE_URL')) {
        syncDisabled = true;
        setStatus('offline');
        return false;
      }
      setStatus('error');
      return false;
    }
    const j = (await res.json()) as StateResponse;
    applyFullSnapshot(experimentId, j);
    localStorage.setItem(LAST_SYNC_KEY, j.now);
    setStatus('idle');
    return true;
  } catch {
    setStatus('error');
    return false;
  }
}

function applyFullSnapshot(experimentId: string, j: StateResponse) {
  const groups = j.groups.map(r => r.data as ExperimentGroup).filter(Boolean);
  // Merge experiments: keep other experiments in localStorage, replace this one
  const existing = JSON.parse(localStorage.getItem('cell-scheduler:experiments') || '[]') as ExperimentGroup[];
  const others = existing.filter(e => e.id !== experimentId);
  localStorage.setItem('cell-scheduler:experiments', JSON.stringify([...others, ...groups]));

  const pops = j.populations.map(r => r.data as CellPopulation).filter(Boolean);
  const existingPops = JSON.parse(localStorage.getItem('cell-scheduler:populations') || '[]') as CellPopulation[];
  const otherPops = existingPops.filter(p => p.experimentId !== experimentId);
  localStorage.setItem('cell-scheduler:populations', JSON.stringify([...otherPops, ...pops]));

  const popIds = new Set(pops.map(p => p.id));
  const events = j.subEvents.map(r => r.data as SubEvent).filter(Boolean);
  const existingEvents = JSON.parse(localStorage.getItem('cell-scheduler:subevents') || '[]') as SubEvent[];
  const otherEvents = existingEvents.filter(ev => !popIds.has(ev.populationId) && !pops.find(p => p.id === ev.populationId));
  localStorage.setItem('cell-scheduler:subevents', JSON.stringify([...otherEvents, ...events]));

  const conns = j.connections.map(r => r.data as Connection).filter(Boolean);
  const existingConns = JSON.parse(localStorage.getItem('cell-scheduler:connections') || '[]') as Connection[];
  const otherConns = existingConns.filter(c => c.experimentId !== experimentId);
  localStorage.setItem('cell-scheduler:connections', JSON.stringify([...otherConns, ...conns]));

  // Operators are global (not experiment-scoped) — replace the whole list.
  if (j.operators) {
    const ops = j.operators.map(r => r.data as Operator).filter(Boolean);
    localStorage.setItem(OPERATORS_LS_KEY, JSON.stringify(ops));
  }
}

/** True while a form field is focused — used to suppress poll-driven overwrites during typing. */
function isUserEditing(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/** Poll for deltas since last sync. Merges into localStorage. Emits change if anything changed. */
async function pollDelta(experimentId: string) {
  if (syncDisabled || syncing) return;
  // Skip polling while the user is actively editing a field — this is the main source of
  // visible glitching (typed chars flash-revert when a poll response overwrites local state).
  // This, combined with the pendingIds guard, matches how Google Calendar pauses pulls
  // while you have a panel open for edits.
  if (isUserEditing()) return;
  syncing = true;
  try {
    const since = localStorage.getItem(LAST_SYNC_KEY);
    const url = since
      ? `/api/state?experimentId=${encodeURIComponent(experimentId)}&since=${encodeURIComponent(since)}`
      : `/api/state?experimentId=${encodeURIComponent(experimentId)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const j = (await res.json()) as StateResponse;
    const changed = (j.groups.length + j.populations.length + j.subEvents.length + j.connections.length + (j.operators?.length ?? 0)) > 0;
    if (!j.delta) {
      applyFullSnapshot(experimentId, j);
    } else {
      applyDelta(j);
    }
    localStorage.setItem(LAST_SYNC_KEY, j.now);
    if (changed) changeListeners.forEach(cb => cb());
  } catch {
    // ignore transient errors
  } finally {
    syncing = false;
  }
}

function applyDelta(j: StateResponse) {
  // experiments
  if (j.groups.length) {
    const existing = JSON.parse(localStorage.getItem('cell-scheduler:experiments') || '[]') as ExperimentGroup[];
    const byId = new Map(existing.map(e => [e.id, e]));
    for (const r of j.groups) {
      if (pendingIds.has(r.id)) continue;
      if (r.deleted) byId.delete(r.id);
      else if (r.data) byId.set(r.id, r.data as ExperimentGroup);
    }
    localStorage.setItem('cell-scheduler:experiments', JSON.stringify([...byId.values()]));
  }
  if (j.populations.length) {
    const existing = JSON.parse(localStorage.getItem('cell-scheduler:populations') || '[]') as CellPopulation[];
    const byId = new Map(existing.map(p => [p.id, p]));
    for (const r of j.populations) {
      if (pendingIds.has(r.id)) continue;
      if (r.deleted) byId.delete(r.id);
      else if (r.data) byId.set(r.id, r.data as CellPopulation);
    }
    localStorage.setItem('cell-scheduler:populations', JSON.stringify([...byId.values()]));
  }
  if (j.subEvents.length) {
    const existing = JSON.parse(localStorage.getItem('cell-scheduler:subevents') || '[]') as SubEvent[];
    const byId = new Map(existing.map(e => [e.id, e]));
    for (const r of j.subEvents) {
      if (pendingIds.has(r.id)) continue;
      if (r.deleted) byId.delete(r.id);
      else if (r.data) byId.set(r.id, r.data as SubEvent);
    }
    localStorage.setItem('cell-scheduler:subevents', JSON.stringify([...byId.values()]));
  }
  if (j.connections.length) {
    const existing = JSON.parse(localStorage.getItem('cell-scheduler:connections') || '[]') as Connection[];
    const byId = new Map(existing.map(c => [c.id, c]));
    for (const r of j.connections) {
      if (pendingIds.has(r.id)) continue;
      if (r.deleted) byId.delete(r.id);
      else if (r.data) byId.set(r.id, r.data as Connection);
    }
    localStorage.setItem('cell-scheduler:connections', JSON.stringify([...byId.values()]));
  }
  if (j.operators && j.operators.length) {
    const existing = JSON.parse(localStorage.getItem(OPERATORS_LS_KEY) || '[]') as Operator[];
    const byId = new Map(existing.map(o => [o.id, o]));
    for (const r of j.operators) {
      if (pendingIds.has(r.id)) continue;
      if (r.deleted) byId.delete(r.id);
      else if (r.data) byId.set(r.id, r.data as Operator);
    }
    localStorage.setItem(OPERATORS_LS_KEY, JSON.stringify([...byId.values()]));
  }
}

/** Start background polling. Safe to call many times. */
export function startPolling(experimentId: string) {
  if (started || syncDisabled) return;
  started = true;
  pollTimer = setInterval(() => pollDelta(experimentId), POLL_MS);
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => { flushNow(); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pollDelta(experimentId);
    });
  }
}

export function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  started = false;
}

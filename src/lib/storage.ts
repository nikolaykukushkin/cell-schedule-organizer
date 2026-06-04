import { ExperimentGroup, CellPopulation, SubEvent, Connection, Operator, OPERATOR_COLORS, PRESET_CELL_LINES } from '@/types';
import { enqueue } from './sync';

// Re-export for backwards compat
type Experiment = ExperimentGroup;

const EXPERIMENTS_KEY = 'cell-scheduler:experiments';
const POPULATIONS_KEY = 'cell-scheduler:populations';
const SUBEVENTS_KEY = 'cell-scheduler:subevents';
const CONNECTIONS_KEY = 'cell-scheduler:connections';
const OPERATORS_KEY = 'cell-scheduler:operators';

export function getItems<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : [];
}

export function setItems<T>(key: string, items: T[]): void {
  localStorage.setItem(key, JSON.stringify(items));
}

// Experiments
export function getExperiments(): Experiment[] {
  return getItems<Experiment>(EXPERIMENTS_KEY);
}

export function getExperiment(id: string): Experiment | undefined {
  return getExperiments().find(e => e.id === id);
}

export function saveExperiment(experiment: Experiment): void {
  const all = getExperiments();
  const idx = all.findIndex(e => e.id === experiment.id);
  if (idx >= 0) all[idx] = experiment;
  else all.push(experiment);
  setItems(EXPERIMENTS_KEY, all);
  enqueue({ table: 'experiment_groups', op: 'upsert', row: experiment as unknown as Record<string, unknown> });
}

export function deleteExperiment(id: string): void {
  setItems(EXPERIMENTS_KEY, getExperiments().filter(e => e.id !== id));
  const pops = getPopulations(id);
  pops.forEach(p => deletePopulation(p.id));
  setItems(CONNECTIONS_KEY, getItems<Connection>(CONNECTIONS_KEY).filter(c => c.experimentId !== id));
  enqueue({ table: 'experiment_groups', op: 'delete', row: { id } });
}

// Populations
export function getPopulations(experimentId: string): CellPopulation[] {
  return getItems<CellPopulation>(POPULATIONS_KEY).filter(p => p.experimentId === experimentId);
}

export function savePopulation(population: CellPopulation): void {
  const all = getItems<CellPopulation>(POPULATIONS_KEY);
  const idx = all.findIndex(p => p.id === population.id);
  if (idx >= 0) all[idx] = population;
  else all.push(population);
  setItems(POPULATIONS_KEY, all);
  enqueue({ table: 'cell_populations', op: 'upsert', row: population as unknown as Record<string, unknown> });
}

export function deletePopulation(id: string): void {
  setItems(POPULATIONS_KEY, getItems<CellPopulation>(POPULATIONS_KEY).filter(p => p.id !== id));
  const childEvents = getItems<SubEvent>(SUBEVENTS_KEY).filter(e => e.populationId === id);
  setItems(SUBEVENTS_KEY, getItems<SubEvent>(SUBEVENTS_KEY).filter(e => e.populationId !== id));
  enqueue({ table: 'cell_populations', op: 'delete', row: { id } });
  childEvents.forEach(ev => enqueue({ table: 'sub_events', op: 'delete', row: { id: ev.id } }));
}

// SubEvents
export function getSubEvents(populationId: string): SubEvent[] {
  return getItems<SubEvent>(SUBEVENTS_KEY).filter(e => e.populationId === populationId);
}

export function getAllSubEvents(experimentId: string): SubEvent[] {
  const popIds = new Set(getPopulations(experimentId).map(p => p.id));
  return getItems<SubEvent>(SUBEVENTS_KEY).filter(e => popIds.has(e.populationId));
}

export function saveSubEvent(event: SubEvent): void {
  const all = getItems<SubEvent>(SUBEVENTS_KEY);
  const idx = all.findIndex(e => e.id === event.id);
  if (idx >= 0) all[idx] = event;
  else all.push(event);
  setItems(SUBEVENTS_KEY, all);
  enqueue({ table: 'sub_events', op: 'upsert', row: event as unknown as Record<string, unknown> });
}

export function deleteSubEvent(id: string): void {
  setItems(SUBEVENTS_KEY, getItems<SubEvent>(SUBEVENTS_KEY).filter(e => e.id !== id));
  enqueue({ table: 'sub_events', op: 'delete', row: { id } });
}

// Connections
export function getConnections(experimentId: string): Connection[] {
  return getItems<Connection>(CONNECTIONS_KEY).filter(c => c.experimentId === experimentId);
}

export function saveConnection(connection: Connection): void {
  const all = getItems<Connection>(CONNECTIONS_KEY);
  const idx = all.findIndex(c => c.id === connection.id);
  if (idx >= 0) all[idx] = connection;
  else all.push(connection);
  setItems(CONNECTIONS_KEY, all);
  enqueue({ table: 'connections', op: 'upsert', row: connection as unknown as Record<string, unknown> });
}

export function deleteConnection(id: string): void {
  setItems(CONNECTIONS_KEY, getItems<Connection>(CONNECTIONS_KEY).filter(c => c.id !== id));
  enqueue({ table: 'connections', op: 'delete', row: { id } });
}

// Operators (global — color owner for experiment bars, keyed by normalized name)
export function normalizeOperatorId(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getOperators(): Operator[] {
  return getItems<Operator>(OPERATORS_KEY);
}

export function getOperator(name: string): Operator | undefined {
  const id = normalizeOperatorId(name);
  if (!id) return undefined;
  return getOperators().find(o => o.id === id);
}

export function saveOperator(operator: Operator): void {
  const all = getOperators();
  const idx = all.findIndex(o => o.id === operator.id);
  if (idx >= 0) all[idx] = operator;
  else all.push(operator);
  setItems(OPERATORS_KEY, all);
  enqueue({ table: 'operators', op: 'upsert', row: operator as unknown as Record<string, unknown> });
}

/** Stable, random-looking default color: hash of the normalized name into the palette.
 *  Used both as the auto-assigned color for new operators and as the display fallback for
 *  an experimenter that has no stored operator record yet. */
export function defaultOperatorColor(name: string): string {
  const id = normalizeOperatorId(name);
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return OPERATOR_COLORS[Math.abs(h) % OPERATOR_COLORS.length];
}

/** Ensure an operator exists for `name`. Returns true if a new one was created. */
export function ensureOperator(name: string): boolean {
  const id = normalizeOperatorId(name);
  if (!id) return false;
  if (getOperators().some(o => o.id === id)) return false;
  saveOperator({ id, name: name.trim(), color: defaultOperatorColor(name) });
  return true;
}

/** Distinct operator colors, ordered by frequency (most used first) — for the picker palette. */
export function getAllOperatorColors(): string[] {
  const counts = new Map<string, number>();
  for (const o of getOperators()) if (o.color) counts.set(o.color, (counts.get(o.color) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** Distinct operator display names — for autocomplete. */
export function getAllOperatorNames(): string[] {
  return [...new Set(getOperators().map(o => o.name).filter(Boolean))];
}

// Export/Import
export function exportExperiment(experimentId: string): string {
  return JSON.stringify({
    experiment: getExperiment(experimentId),
    populations: getPopulations(experimentId),
    subEvents: getAllSubEvents(experimentId),
    connections: getConnections(experimentId),
  }, null, 2);
}

export function importExperiment(json: string): Experiment {
  const data = JSON.parse(json);
  saveExperiment(data.experiment);
  data.populations.forEach((p: CellPopulation) => savePopulation(p));
  data.subEvents.forEach((e: SubEvent) => saveSubEvent(e));
  data.connections.forEach((c: Connection) => saveConnection(c));
  return data.experiment;
}

// Autocomplete suggestions from past data
export function getAllCellLines(): string[] {
  const all = getItems<CellPopulation>(POPULATIONS_KEY);
  const fromData = all.map(p => p.cellLine).filter(Boolean);
  return [...new Set([...PRESET_CELL_LINES, ...fromData])];
}

export function getAllExperimentNames(): string[] {
  const all = getItems<CellPopulation>(POPULATIONS_KEY);
  const names = all.map(p => p.name).filter(Boolean);
  return [...new Set(names)];
}

/** Distinct colors currently used by populations, ordered by frequency (most used first). */
export function getAllPopulationColors(): string[] {
  const all = getItems<CellPopulation>(POPULATIONS_KEY);
  const counts = new Map<string, number>();
  for (const p of all) if (p.color) counts.set(p.color, (counts.get(p.color) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** Distinct colors currently used by sub-events, ordered by frequency. */
export function getAllSubEventColors(): string[] {
  const all = getItems<SubEvent>(SUBEVENTS_KEY);
  const counts = new Map<string, number>();
  for (const e of all) if (e.color) counts.set(e.color, (counts.get(e.color) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** Existing sub-event templates, one per distinct label. Color, duration, and
 *  offset-from-parent-end come from the most-recent occurrence. Returned in
 *  most-recent-first order so the dropdown surfaces what the user just used.
 *  `offsetFromEndH` is the gap (in hours) from the source event's end to its parent's
 *  end — used to anchor newly-pasted instances at the same relative position. */
export function getAllSubEventTemplates(): { label: string; color: string; durationH: number; offsetFromEndH: number }[] {
  const all = getItems<SubEvent>(SUBEVENTS_KEY);
  const populations = new Map<string, CellPopulation>(
    getItems<CellPopulation>(POPULATIONS_KEY).map(p => [p.id, p])
  );
  const absHours = (date: string, hour: number): number => {
    const [y, m, d] = date.split('-').map(Number);
    return Math.round(new Date(y, m - 1, d).getTime() / 3600_000) + hour;
  };
  const byLabel = new Map<string, SubEvent>();
  for (const e of all) {
    const label = (e.label || '').trim();
    if (!label) continue;
    const existing = byLabel.get(label);
    const isNewer = !existing
      || e.startDate > existing.startDate
      || (e.startDate === existing.startDate && e.startHour > existing.startHour);
    if (isNewer) byLabel.set(label, e);
  }
  const arr = [...byLabel.values()].sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? 1 : -1;
    return b.startHour - a.startHour;
  });
  return arr.map(e => {
    const startAbs = absHours(e.startDate, e.startHour);
    const endAbs = absHours(e.endDate, e.endHour);
    const durationH = Math.max(1, endAbs - startAbs + 1);
    const parent = populations.get(e.populationId);
    const offsetFromEndH = parent
      ? Math.max(0, absHours(parent.endDate, parent.endHour) - endAbs)
      : 0;
    return { label: e.label.trim(), color: e.color, durationH, offsetFromEndH };
  });
}

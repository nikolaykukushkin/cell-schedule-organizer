export type PlateType =
  | '10cm'
  | '6-well'
  | '8-well'
  | '12-well'
  | '24-well'
  | '48-well'
  | '96-well'
  | '35mm'
  | '60mm'
  | 'T25'
  | 'T75'
  | 'T175';

/** Top-level container (used internally for storage grouping) */
export interface ExperimentGroup {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

/** A timeline bar on the calendar — represents one experiment. */
export interface CellPopulation {
  id: string;
  experimentId: string;
  name: string; // experiment name
  cellLine: string;
  passage: string; // passage number as string (can be empty)
  color: string;
  plateType: PlateType;
  plateCount: number;
  /** Density in millions per well/dish */
  cellDensity: string;
  experimenter: string;
  comments: string;
  allDay: boolean;
  startDate: string; // YYYY-MM-DD — seed date
  startHour: number; // 0-23
  endDate: string;   // YYYY-MM-DD — harvest date
  endHour: number;   // 0-23
  /** Free-text ID the user assigns to this experiment (e.g. "Exp 042"). Separate from its seed/harvest dates. */
  experimentLabel?: string;
  /** Manual lane assignment (overrides greedy auto-layout). Set when the user drags to reorder. */
  lane?: number;
}

/** An event box within an experiment bar. */
export interface SubEvent {
  id: string;
  populationId: string;
  label: string;
  comments: string;
  allDay: boolean;
  startDate: string;
  startHour: number;
  endDate: string;
  endHour: number;
  color: string;
}

export interface Connection {
  id: string;
  experimentId: string;
  sourcePopulationId: string;
  targetPopulationId: string;
  type: 'transplant' | 'merge' | 'split';
}

export const PLATE_LABELS: Record<PlateType, string> = {
  '10cm': '10 cm Dish',
  '6-well': '6-Well Plate',
  '8-well': '8-Well Plate',
  '12-well': '12-Well Plate',
  '24-well': '24-Well Plate',
  '48-well': '48-Well Plate',
  '96-well': '96-Well Plate',
  '35mm': '35 mm Dish',
  '60mm': '60 mm Dish',
  'T25': 'T-25 Flask',
  'T75': 'T-75 Flask',
  'T175': 'T-175 Flask',
};

export function densityUnit(plateType: PlateType): string {
  if (plateType.endsWith('well')) return 'M/well';
  if (plateType.startsWith('T')) return 'M/flask';
  return 'M/dish';
}

/** Human-readable "4× 24-well plates" style label. */
export function platesLabel(plateType: PlateType, count: number): string {
  const base = PLATE_LABELS[plateType];
  if (count === 1) return `1× ${base}`;
  const plural = base.endsWith('Dish') ? base.replace('Dish', 'Dishes') : base + 's';
  return `${count}× ${plural}`;
}

export const POPULATION_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

export const SUB_EVENT_COLORS = [
  '#fbbf24', '#a78bfa', '#34d399', '#f87171',
  '#60a5fa', '#fb923c', '#e879f9', '#2dd4bf',
];

export const PRESET_CELL_LINES = [
  'HEK-293T',
  'HEK-293T-CRE-luc-C7',
];

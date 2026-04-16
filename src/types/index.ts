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

export interface Experiment {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

/** A cell population timeline bar on the calendar. */
export interface CellPopulation {
  id: string;
  experimentId: string;
  name: string;
  color: string;
  plateType: PlateType;
  plateCount: number;
  /** Density in millions per well/dish, e.g. "0.5" means 0.5M per well */
  cellDensity: string;
  experimenter: string;
  startDate: string; // YYYY-MM-DD
  startHour: number; // 0-23
  endDate: string;   // YYYY-MM-DD
  endHour: number;   // 0-23
}

/** A sub-event box within a population bar. Can span one or multiple days. */
export interface SubEvent {
  id: string;
  populationId: string;
  label: string;
  startDate: string; // YYYY-MM-DD
  startHour: number; // 0-23
  endDate: string;   // YYYY-MM-DD
  endHour: number;   // 0-23
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

/** Whether the plate type uses "per well" or "per dish/flask" for density */
export function densityUnit(plateType: PlateType): string {
  if (plateType.endsWith('well')) return 'M/well';
  if (plateType.startsWith('T')) return 'M/flask';
  return 'M/dish';
}

export const POPULATION_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

export const SUB_EVENT_COLORS = [
  '#fbbf24', '#a78bfa', '#34d399', '#f87171',
  '#60a5fa', '#fb923c', '#e879f9', '#2dd4bf',
];

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Calendar-based visual scheduler for cell culture experiments. Users click-and-drag across days to create population timeline bars (seed → harvest). Sub-events (wash, treatment, media exchange, etc.) are created by clicking and dragging within a bar.

Key domain concepts:
- **Cell populations**: colored bars on a month calendar spanning seed date to harvest date. Each has a plate type, plate count, and seeding density (expressed in M/well, M/dish, or M/flask depending on plate type).
- **Sub-events**: custom-labeled boxes within a population bar, spanning one or more days (e.g. "Wash" on day 2, "SFM" spanning days 3-4).
- **Plate types**: 10 cm, 6-well, 8-well, 12-well, 24-well, 48-well, 96-well, 35mm, 60mm, T25, T75, T175
- **Plate visuals**: SVG icons (petri dishes, well plates, flasks) displayed on the bar
- **Connections**: populations can be linked (transplant/merge/split)

## Development Commands

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Tech Stack

- **Next.js 16** (App Router) with TypeScript
- **Tailwind CSS v4**
- **localStorage** with JSON export/import for sharing

## Architecture

### Pages
- `/` — Dashboard: list/create/delete experiments
- `/experiment/[id]` — Full-screen calendar scheduler

### Calendar Components (`src/components/calendar/`)
- `CalendarGrid` — main component: month grid, click-drag to create population bars, sub-event creation by dragging within bars, bar slot layout to prevent overlap
- `CalendarHeader` — month/year navigation
- `EventPanel` — right side panel for editing population or sub-event properties
- `NewPopulationDialog` — modal after drag-to-create (plate type, count, density)
- `PlateVisual` — SVG petri dishes, well plates, flasks

### Data Layer (`src/lib/`)
- `storage.ts` — localStorage CRUD for experiments, populations, sub-events, connections
- `dates.ts` — month grid generation, date string helpers, range checks

### Types (`src/types/index.ts`)
- `Experiment`, `CellPopulation` (startDate=seed, endDate=harvest), `SubEvent` (label, startDate, endDate within parent), `Connection`
- `densityUnit(plateType)` returns "M/well", "M/dish", or "M/flask"

## Deployment

Target deployment is Vercel.

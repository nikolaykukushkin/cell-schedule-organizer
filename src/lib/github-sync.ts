import { CellPopulation, SubEvent, densityUnit } from '@/types';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function classifyEvent(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('seed')) return 'seed';
  if (l.includes('harvest') || l.includes('collect')) return 'harvest';
  if (l.includes('passage') || l.includes('split')) return 'passage';
  if (l.includes('treat') || l.includes('sfm') || l.includes('wash') || l.includes('media')) return 'treat';
  return 'other';
}

/** Generate a single markdown file for a population and its events */
function generateMarkdown(pop: CellPopulation, popEvents: SubEvent[]): { filename: string; content: string } {
  const expLabel = pop.experimentLabel || '';
  const slug = `${slugify(pop.name)}-${pop.startDate}`;
  const topics = ['scheduling', pop.cellLine, pop.name].filter(Boolean);

  let eventLines = '';
  if (popEvents.length > 0) {
    eventLines = '\n## Events\n\n';
    for (const ev of popEvents.sort((a, b) => a.startDate.localeCompare(b.startDate))) {
      const span = ev.startDate === ev.endDate ? ev.startDate : `${ev.startDate} to ${ev.endDate}`;
      eventLines += `- **${ev.label}** (${span})${ev.comments ? ` — ${ev.comments}` : ''}\n`;
    }
  }

  const content = `---
date: ${pop.startDate}
seed_date: ${pop.startDate}
harvest_date: ${pop.endDate}
experiment_id: ${expLabel}
slug: ${slug}
topics: [${topics.map(t => `"${t}"`).join(', ')}]
source: scheduler
profile: research
event_type: seed
cell_line: ${pop.cellLine || 'unknown'}
passage: ${pop.passage || 'unknown'}
experiment: ${pop.name}
experimenter: ${pop.experimenter || 'unknown'}
plate_type: ${pop.plateType}
plate_count: ${pop.plateCount}
density: ${pop.cellDensity ? `${pop.cellDensity} ${densityUnit(pop.plateType)}` : 'not specified'}
---

${pop.name}${pop.cellLine ? ` (${pop.cellLine}${pop.passage ? ` P${pop.passage}` : ''})` : ''}: ${pop.plateCount}x ${pop.plateType}${pop.cellDensity ? `, seeded at ${pop.cellDensity} ${densityUnit(pop.plateType)}` : ''}. Timeline ${pop.startDate} to ${pop.endDate}.${pop.experimenter ? ` Experimenter: ${pop.experimenter}.` : ''}
${pop.comments ? `\n## Notes\n\n${pop.comments}\n` : ''}${eventLines}`;

  return { filename: `inbox/${pop.startDate}-${slug}.md`, content };
}

/** Push a single population + its events to the lab book repo */
export async function pushToLabBook(
  pop: CellPopulation,
  popEvents: SubEvent[]
): Promise<{ ok: boolean; error?: string }> {
  const { filename, content } = generateMarkdown(pop, popEvents);

  try {
    const res = await fetch('/api/sync-github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content }),
    });

    if (res.ok) {
      return { ok: true };
    } else {
      const err = await res.text();
      return { ok: false, error: err };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

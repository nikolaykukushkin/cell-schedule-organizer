import { NextRequest, NextResponse } from 'next/server';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'nikolaykukushkin/experimental-data-analysis';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

interface ScheduleEvent {
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
}

export async function POST(req: NextRequest) {
  if (!GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 500 });
  }

  const { events } = (await req.json()) as { events: ScheduleEvent[] };
  if (!events || events.length === 0) {
    return NextResponse.json({ error: 'No events' }, { status: 400 });
  }

  const results: { file: string; status: string }[] = [];

  for (const evt of events) {
    const filename = `inbox/${evt.date}-${evt.slug}.md`;
    const topics = ['scheduling', evt.cellLine, evt.experiment].filter(Boolean);

    const content = `---
date: ${evt.date}
slug: ${evt.slug}
topics: [${topics.map(t => `"${t}"`).join(', ')}]
source: scheduler
profile: research
event_type: ${evt.type}
cell_line: ${evt.cellLine}
passage: unknown
experiment: ${evt.experiment}
experimenter: ${evt.experimenter}
plate_type: ${evt.plateType}
plate_count: ${evt.plateCount}
density: ${evt.density}
---

${evt.description}
`;

    const contentBase64 = Buffer.from(content).toString('base64');

    // Check if file already exists (to get sha for update)
    let sha: string | undefined;
    try {
      const existing = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}?ref=${GITHUB_BRANCH}`,
        { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
      );
      if (existing.ok) {
        const data = await existing.json();
        sha = data.sha;
      }
    } catch {
      // File doesn't exist, that's fine
    }

    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: `scheduler: ${evt.type} ${evt.cellLine} ${evt.date}`,
            content: contentBase64,
            branch: GITHUB_BRANCH,
            ...(sha ? { sha } : {}),
          }),
        }
      );

      if (res.ok) {
        results.push({ file: filename, status: 'ok' });
      } else {
        const err = await res.text();
        results.push({ file: filename, status: `error: ${res.status} ${err}` });
      }
    } catch (err) {
      results.push({ file: filename, status: `error: ${err}` });
    }
  }

  return NextResponse.json({ results });
}

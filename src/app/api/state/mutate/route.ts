import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

export const runtime = 'edge';

type Table = 'experiment_groups' | 'cell_populations' | 'sub_events' | 'connections';
type Op = 'upsert' | 'delete';

interface Mutation {
  table: Table;
  op: Op;
  row: Record<string, unknown>;
}

const ALLOWED: Set<Table> = new Set(['experiment_groups', 'cell_populations', 'sub_events', 'connections']);

// POST /api/state/mutate  body: { mutations: Mutation[] }
// Last-writer-wins: server stamps updated_at = now() for every mutation.
export async function POST(req: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ ok: false, error: 'DATABASE_URL not set' }, { status: 500 });

  let body: { mutations?: Mutation[] };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const mutations = body.mutations || [];
  if (!Array.isArray(mutations) || mutations.length === 0) {
    return NextResponse.json({ ok: false, error: 'No mutations' }, { status: 400 });
  }

  try {
    for (const m of mutations) {
      if (!ALLOWED.has(m.table)) throw new Error(`invalid table: ${m.table}`);
      const row = m.row as Record<string, unknown>;
      const id = row.id as string;
      if (!id) throw new Error('mutation missing row.id');

      if (m.op === 'delete') {
        if (m.table === 'experiment_groups')
          await sql`UPDATE experiment_groups SET deleted = true, updated_at = now() WHERE id = ${id}`;
        else if (m.table === 'cell_populations')
          await sql`UPDATE cell_populations SET deleted = true, updated_at = now() WHERE id = ${id}`;
        else if (m.table === 'sub_events')
          await sql`UPDATE sub_events SET deleted = true, updated_at = now() WHERE id = ${id}`;
        else
          await sql`UPDATE connections SET deleted = true, updated_at = now() WHERE id = ${id}`;
        continue;
      }

      // upsert
      const json = JSON.stringify(row);
      if (m.table === 'experiment_groups') {
        await sql`INSERT INTO experiment_groups (id, data, updated_at, deleted) VALUES (${id}, ${json}::jsonb, now(), false)
                  ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), deleted = false`;
      } else if (m.table === 'cell_populations') {
        const experimentId = (row.experimentId || 'default') as string;
        await sql`INSERT INTO cell_populations (id, experiment_id, data, updated_at, deleted) VALUES (${id}, ${experimentId}, ${json}::jsonb, now(), false)
                  ON CONFLICT (id) DO UPDATE SET experiment_id = EXCLUDED.experiment_id, data = EXCLUDED.data, updated_at = now(), deleted = false`;
      } else if (m.table === 'sub_events') {
        const populationId = row.populationId as string;
        await sql`INSERT INTO sub_events (id, population_id, data, updated_at, deleted) VALUES (${id}, ${populationId}, ${json}::jsonb, now(), false)
                  ON CONFLICT (id) DO UPDATE SET population_id = EXCLUDED.population_id, data = EXCLUDED.data, updated_at = now(), deleted = false`;
      } else {
        const experimentId = (row.experimentId || 'default') as string;
        await sql`INSERT INTO connections (id, experiment_id, data, updated_at, deleted) VALUES (${id}, ${experimentId}, ${json}::jsonb, now(), false)
                  ON CONFLICT (id) DO UPDATE SET experiment_id = EXCLUDED.experiment_id, data = EXCLUDED.data, updated_at = now(), deleted = false`;
      }
    }

    const now = (await sql`SELECT now() AS now`)[0].now as string;
    return NextResponse.json({ ok: true, now });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

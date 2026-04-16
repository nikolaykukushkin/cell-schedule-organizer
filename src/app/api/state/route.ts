import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

export const runtime = 'edge';

// GET /api/state?since=<iso>&experimentId=<id>
// Returns all rows with updated_at > since (deleted tombstones included).
// Without `since`, returns full snapshot excluding tombstones.
export async function GET(req: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ ok: false, error: 'DATABASE_URL not set' }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');
  const experimentId = searchParams.get('experimentId') || 'default';

  try {
    const now = (await sql`SELECT now() AS now`)[0].now as string;

    if (since) {
      const [groups, pops, events, conns] = await Promise.all([
        sql`SELECT id, data, updated_at, deleted FROM experiment_groups WHERE id = ${experimentId} AND updated_at > ${since}`,
        sql`SELECT id, data, updated_at, deleted FROM cell_populations WHERE experiment_id = ${experimentId} AND updated_at > ${since}`,
        sql`SELECT id, data, updated_at, deleted FROM sub_events WHERE updated_at > ${since} AND population_id IN (SELECT id FROM cell_populations WHERE experiment_id = ${experimentId})`,
        sql`SELECT id, data, updated_at, deleted FROM connections WHERE experiment_id = ${experimentId} AND updated_at > ${since}`,
      ]);
      return NextResponse.json({ ok: true, now, delta: true, groups, populations: pops, subEvents: events, connections: conns });
    }

    const [groups, pops, events, conns] = await Promise.all([
      sql`SELECT id, data FROM experiment_groups WHERE id = ${experimentId} AND deleted = false`,
      sql`SELECT id, data FROM cell_populations WHERE experiment_id = ${experimentId} AND deleted = false`,
      sql`SELECT id, data FROM sub_events WHERE deleted = false AND population_id IN (SELECT id FROM cell_populations WHERE experiment_id = ${experimentId})`,
      sql`SELECT id, data FROM connections WHERE experiment_id = ${experimentId} AND deleted = false`,
    ]);
    return NextResponse.json({ ok: true, now, delta: false, groups, populations: pops, subEvents: events, connections: conns });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

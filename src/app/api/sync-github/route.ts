import { NextRequest, NextResponse } from 'next/server';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'nikolaykukushkin/experimental-data-analysis';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

export async function POST(req: NextRequest) {
  if (!GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 500 });
  }

  const { filename, content } = (await req.json()) as { filename: string; content: string };
  if (!filename || !content) {
    return NextResponse.json({ error: 'Missing filename or content' }, { status: 400 });
  }

  const contentBase64 = Buffer.from(content).toString('base64');

  // Check if file exists (need sha for update)
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
    // File doesn't exist
  }

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
        message: `scheduler: add ${filename.split('/').pop()}`,
        content: contentBase64,
        branch: GITHUB_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    }
  );

  if (res.ok) {
    return NextResponse.json({ ok: true });
  } else {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }
}

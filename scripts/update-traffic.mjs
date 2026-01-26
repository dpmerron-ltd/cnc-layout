import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

if (!repo) {
  throw new Error('GITHUB_REPOSITORY is required');
}

if (!token) {
  throw new Error('GITHUB_TOKEN is required to query traffic endpoints.');
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'cnc-layout-analytics',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function fetchTraffic(resource) {
  const response = await fetch(`https://api.github.com/repos/${repo}/traffic/${resource}`, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error (${resource}): ${response.status} ${text}`);
  }
  return response.json();
}

const [views, clones] = await Promise.all([fetchTraffic('views'), fetchTraffic('clones')]);

const payload = {
  collectedAt: new Date().toISOString(),
  views: {
    count: views.count,
    uniques: views.uniques,
  },
  clones: {
    count: clones.count,
    uniques: clones.uniques,
  },
  dailyViews: views.views ?? [],
  dailyClones: clones.clones ?? [],
};

const outputPath = join(process.cwd(), 'docs', 'traffic.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Updated traffic metrics: ${payload.views.uniques} visitors in last 14 days.`);

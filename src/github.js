// Fetches a GitHub profile and turns it into city data:
// one entry per repo with its stars and its commit count for the last ACTIVITY_DAYS.

const API = 'https://api.github.com';
const DAY = 86_400_000;
const CACHE_TTL = 60 * 60 * 1000;
const MAX_REPO_PAGES = 3; // up to 300 buildings
const COMMIT_CONCURRENCY = 8;

export const ACTIVITY_DAYS = 90;

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function gh(path, token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(API + path, { headers });
  } catch {
    throw new GitHubError('Could not reach GitHub. Check your connection and try again.', 0);
  }
  if (res.ok) return { data: await res.json(), res };
  if (res.status === 409) return { data: [], res }; // empty repository

  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000);
    throw new GitHubError(
      `GitHub's rate limit is used up until ${reset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. ` +
        'Add a token in Settings to keep building, or try the demo city.',
      res.status,
    );
  }
  if (res.status === 401) throw new GitHubError('GitHub rejected that token. Check it in Settings.', 401);
  if (res.status === 404) throw new GitHubError('There is no GitHub user or org with that name.', 404);
  throw new GitHubError(`GitHub answered with an error (${res.status}). Try again in a moment.`, res.status);
}

function readCache(key) {
  try {
    const hit = JSON.parse(localStorage.getItem(key));
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL) return hit;
  } catch {}
  return null;
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export async function loadCity(login, { token = '', onProgress = () => {} } = {}) {
  const key = `githubcity:v2:${login.toLowerCase()}:${token ? 'auth' : 'anon'}`;
  const cached = readCache(key);
  if (cached) return cached;

  onProgress('Surveying the land…');
  const { data: user } = await gh(`/users/${encodeURIComponent(login)}`, token);

  onProgress('Laying foundations…');
  const raw = new Map();
  // The repo list can't sort by stars, so a big account mixes its most-starred
  // repos (from search) with its most recently pushed ones.
  const big = user.public_repos > MAX_REPO_PAGES * 100;
  if (big) {
    const qualifier = user.type === 'Organization' ? 'org' : 'user';
    for (let page = 1; page <= 2; page++) {
      const { data } = await gh(`/search/repositories?q=${qualifier}:${user.login}+fork:true&sort=stars&order=desc&per_page=100&page=${page}`, token);
      for (const r of data.items) raw.set(r.id, r);
    }
  }
  for (let page = 1; page <= (big ? 1 : MAX_REPO_PAGES); page++) {
    const { data } = await gh(`/users/${user.login}/repos?per_page=100&page=${page}&sort=pushed&type=owner`, token);
    for (const r of data) raw.set(r.id, r);
    if (data.length < 100) break;
  }

  const since = new Date(Date.now() - ACTIVITY_DAYS * DAY);
  const repos = [...raw.values()].map((r) => ({
    name: r.name,
    fullName: r.full_name,
    url: r.html_url,
    description: r.description,
    stars: r.stargazers_count,
    forks: r.forks_count,
    size: r.size,
    language: r.language,
    fork: r.fork,
    archived: r.archived,
    pushedAt: r.pushed_at,
    commits: 0,
  }));

  let source;
  if (token) {
    await countFromCommits(repos, since, token, onProgress);
    source = 'commits';
  } else {
    onProgress('Reading recent activity…');
    await countFromEvents(user.login, repos, since);
    source = 'events';
  }

  const city = {
    user: {
      login: user.login,
      name: user.name,
      avatar: user.avatar_url,
      url: user.html_url,
      type: user.type,
    },
    repos,
    source,
    fetchedAt: Date.now(),
  };
  writeCache(key, city);
  return city;
}

// Exact: one request per recently pushed repo, reading the page count from the Link header.
async function countFromCommits(repos, since, token, onProgress) {
  const active = repos.filter((r) => new Date(r.pushedAt) >= since).slice(0, 150);
  const iso = since.toISOString();
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < active.length) {
      const repo = active[next++];
      try {
        const { data, res } = await gh(`/repos/${repo.fullName}/commits?since=${iso}&per_page=1`, token);
        const last = res.headers.get('link')?.match(/[?&]page=(\d+)>;\s*rel="last"/);
        repo.commits = last ? Number(last[1]) : data.length;
      } catch (err) {
        if (err.status === 401 || err.status === 403 || err.status === 429) throw err;
      }
      onProgress(`Counting commits… ${++done}/${active.length}`);
    }
  }

  await Promise.all(Array.from({ length: COMMIT_CONCURRENCY }, worker));
}

// Estimate: no token means 60 requests an hour, so read the public event feed
// (at most 300 events) instead of asking every repo.
async function countFromEvents(login, repos, since) {
  const byName = new Map(repos.map((r) => [r.fullName.toLowerCase(), r]));
  for (let page = 1; page <= 3; page++) {
    let events;
    try {
      ({ data: events } = await gh(`/users/${login}/events/public?per_page=100&page=${page}`));
    } catch (err) {
      if (err.status === 403 || err.status === 429) throw err;
      break;
    }
    for (const e of events) {
      if (e.type !== 'PushEvent' || new Date(e.created_at) < since) continue;
      const repo = byName.get(e.repo.name.toLowerCase());
      if (!repo) continue;
      const p = e.payload ?? {};
      repo.commits += p.distinct_size ?? p.size ?? p.commits?.length ?? 1;
    }
    if (events.length < 100) break;
  }
  // A repo pushed recently but missing from the capped feed still shows a light on.
  for (const r of repos) {
    if (r.commits === 0 && new Date(r.pushedAt) >= since) r.commits = 1;
  }
}

// A made-up city for trying the app without spending API calls.
export function demoCity() {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const words = [
    'aurora', 'lexer', 'nimbus', 'quill', 'harbor', 'ember', 'atlas', 'pixel', 'relay', 'sparrow',
    'cinder', 'orbit', 'delta', 'fjord', 'lumen', 'mosaic', 'nectar', 'otter', 'prism', 'quartz',
    'raven', 'sable', 'tundra', 'umber', 'vortex', 'willow', 'zephyr', 'basalt', 'comet', 'dune',
  ];
  const kinds = ['db', 'cli', 'ui', 'kit', 'sdk', 'api', 'lab', 'bot', 'js', 'rs', 'dots', 'site'];
  const langs = ['TypeScript', 'Rust', 'Go', 'Python', 'JavaScript', 'Swift', 'C++', 'Kotlin', 'Shell', 'Ruby', 'Zig', null];

  const names = new Set();
  while (names.size < 46) names.add(`${words[Math.floor(rand() * words.length)]}-${kinds[Math.floor(rand() * kinds.length)]}`);

  const repos = [...names].map((name, i) => {
    const stars = i === 0 ? 18_400 : Math.floor(10 ** (rand() * rand() * 4.3) - 1);
    const commits = rand() < 0.35 ? 0 : Math.floor(rand() ** 2 * 90);
    return {
      name,
      fullName: `demo/${name}`,
      url: null,
      description: 'A building in the demo city.',
      stars,
      forks: Math.floor(stars * rand() * 0.15),
      size: Math.floor(10 ** (1 + rand() * 4)),
      language: langs[Math.floor(rand() * langs.length)],
      fork: false,
      archived: rand() < 0.06,
      pushedAt: new Date(Date.now() - rand() * 400 * DAY).toISOString(),
      commits,
    };
  });

  return {
    user: { login: 'demo', name: 'Demo City', avatar: null, url: null, type: 'User' },
    repos,
    source: 'demo',
    fetchedAt: Date.now(),
  };
}

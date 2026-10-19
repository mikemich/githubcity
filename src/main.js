import { City } from './city.js';
import { loadCity, demoCity, ACTIVITY_DAYS } from './github.js';
import { languageHex } from './languages.js';
import { buildPoster, shareText, summarize } from './poster.js';

const $ = (sel) => document.querySelector(sel);
const els = {
  form: $('#search'),
  input: $('#username'),
  hero: $('#hero'),
  status: $('#status'),
  stats: $('#stats'),
  card: $('#card'),
  tooltip: $('#tooltip'),
  legend: $('#legend'),
  orbit: $('#orbit'),
  post: $('#post'),
  settings: $('#settings'),
  token: $('#token'),
  forks: $('#forks'),
  scale: $('#scale'),
  poster: $('#poster'),
  posterImg: $('#poster-img'),
  download: $('#download'),
  copy: $('#copy'),
  share: $('#share'),
  tweet: $('#tweet'),
};

const number = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const settings = { token: '', includeForks: false, scale: 'log' };

const city = new City($('#stage'));
city.onUserOrbit = () => setOrbit(false);

let current = null;
let loadSeq = 0;
let posterFormat = 'wide';
let posterBlob = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function setStatus(message, kind = 'info') {
  els.status.hidden = !message;
  els.status.textContent = message ?? '';
  els.status.dataset.kind = kind;
}

function setOrbit(on) {
  city.autoRotate = on;
  els.orbit.setAttribute('aria-pressed', String(on));
}

function visibleRepos(data) {
  return data.repos.filter((r) => settings.includeForks || !r.fork);
}

async function show(login) {
  login = login.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//i, '').split('/')[0];
  if (!login) return;
  const seq = ++loadSeq;
  els.input.value = login;
  els.form.querySelector('button').disabled = true;
  setStatus('Surveying the land…');
  try {
    const data =
      login.toLowerCase() === 'demo'
        ? demoCity()
        : await loadCity(login, { token: settings.token, onProgress: (m) => seq === loadSeq && setStatus(m) });
    if (seq !== loadSeq) return;
    current = data;
    const url = new URL(location.href);
    url.searchParams.set('u', data.user.login);
    history.replaceState(null, '', url);
    document.title = `@${data.user.login} · githubcity`;
    render();
  } catch (err) {
    if (seq !== loadSeq) return;
    setStatus(err.message, 'error');
    // A broken shared link shouldn't leave an empty scene.
    if (!current && els.hero.hidden) {
      els.hero.hidden = false;
      city.build(demoCity().repos);
    }
  } finally {
    if (seq === loadSeq) els.form.querySelector('button').disabled = false;
  }
}

function render() {
  const repos = visibleRepos(current);
  hideCard();
  city.build(repos, { scale: settings.scale });
  setOrbit(true);
  els.hero.hidden = true;
  els.legend.hidden = false;
  els.post.disabled = repos.length === 0;
  renderStats(current, repos);
  setStatus(repos.length ? '' : 'No public repos yet, so this lot is still empty.');
}

function renderStats(data, repos) {
  const { stars, commits, tallest, buildings } = summarize(repos);
  const note = {
    events: `Lights are estimated from public activity. Add a token in Settings for exact commit counts.`,
    commits: `Lights count commits on each default branch in the last ${ACTIVITY_DAYS} days.`,
    demo: 'Made-up data. Enter a username to build a real city.',
  }[data.source];
  const avatar = data.user.avatar
    ? `<img src="${esc(data.user.avatar)}${data.user.avatar.includes('?') ? '&' : '?'}s=96" alt="" width="44" height="44">`
    : `<span class="avatar-fallback" aria-hidden="true">◼</span>`;
  const profile = data.user.url
    ? `<a href="${esc(data.user.url)}" target="_blank" rel="noopener">@${esc(data.user.login)}</a>`
    : `<span>@${esc(data.user.login)}</span>`;

  els.stats.innerHTML = `
    <div class="who">
      ${avatar}
      <div>
        <strong>${esc(data.user.name || data.user.login)}</strong>
        ${profile}
      </div>
    </div>
    <dl>
      <div><dt>Buildings</dt><dd>${number.format(buildings)}</dd></div>
      <div><dt>Stars</dt><dd>${compact.format(stars)}</dd></div>
      <div><dt>Commits · ${ACTIVITY_DAYS}d</dt><dd>${compact.format(commits)}</dd></div>
    </dl>
    ${tallest ? `<p class="tallest">Tallest: <button type="button" data-repo="${esc(tallest.fullName)}">${esc(tallest.name)}</button></p>` : ''}
    <p class="note">${note}</p>`;
  els.stats.hidden = false;
}

function relativeDays(iso) {
  const days = Math.round((Date.now() - new Date(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

function showCard(info) {
  const r = info.repo;
  els.card.innerHTML = `
    <button type="button" class="close ghost" aria-label="Close">✕</button>
    <h2>${esc(r.name)}</h2>
    ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
    <dl>
      <div><dt>Stars</dt><dd>${number.format(r.stars)}</dd></div>
      <div><dt>Commits · ${ACTIVITY_DAYS}d</dt><dd>${number.format(r.commits)}</dd></div>
      <div><dt>Forks</dt><dd>${number.format(r.forks)}</dd></div>
    </dl>
    <p class="meta">
      <span class="lang"><i style="background:${languageHex(r.language)}"></i>${esc(r.language ?? 'No language')}</span>
      <span>pushed ${relativeDays(r.pushedAt)}</span>
      ${r.archived ? '<span class="tag">archived</span>' : ''}
      ${r.fork ? '<span class="tag">fork</span>' : ''}
    </p>
    ${r.url ? `<a class="button primary" href="${esc(r.url)}" target="_blank" rel="noopener">Open repo</a>` : ''}`;
  els.card.hidden = false;
  els.card.querySelector('.close').onclick = hideCard;
}

function hideCard() {
  els.card.hidden = true;
}

function selectRepo(fullName) {
  const info = city.pickables.find((m) => m.userData.repo.fullName === fullName)?.userData;
  if (!info) return;
  setOrbit(false);
  city.setHighlight(info);
  city.flyTo(info);
  showCard(info);
}

// Hover tooltips and click-to-inspect, ignoring clicks that were really drags.
const canvas = city.renderer.domElement;
let down = null;
let hoverFrame = 0;

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(() => {
    const info = down ? null : city.pick(e.clientX, e.clientY);
    canvas.style.cursor = info ? 'pointer' : '';
    // While a repo card is open, its building keeps the highlight.
    if (els.card.hidden) city.setHighlight(info);
    if (!info) {
      els.tooltip.hidden = true;
      return;
    }
    const r = info.repo;
    els.tooltip.innerHTML = `<strong>${esc(r.name)}</strong><span>★ ${compact.format(r.stars)} · ${compact.format(r.commits)} commits</span>`;
    els.tooltip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 16}px)`;
    els.tooltip.hidden = false;
  });
});
canvas.addEventListener('pointerleave', () => {
  els.tooltip.hidden = true;
});
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY };
  els.tooltip.hidden = true;
});
canvas.addEventListener('pointerup', (e) => {
  const start = down;
  down = null;
  if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
  const info = city.pick(e.clientX, e.clientY);
  if (info) {
    selectRepo(info.repo.fullName);
  } else {
    hideCard();
    city.setHighlight(null);
  }
});

els.stats.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-repo]');
  if (btn) selectRepo(btn.dataset.repo);
});

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  show(els.input.value);
});

document.querySelectorAll('[data-user]').forEach((btn) => {
  btn.addEventListener('click', () => show(btn.dataset.user));
});

els.orbit.addEventListener('click', () => setOrbit(!city.autoRotate));

// Settings
$('#open-settings').addEventListener('click', () => {
  els.token.value = settings.token;
  els.forks.checked = settings.includeForks;
  els.scale.value = settings.scale;
  els.settings.showModal();
});
els.settings.addEventListener('close', () => {
  if (els.settings.returnValue !== 'apply') return;
  const token = els.token.value.trim();
  const tokenChanged = token !== settings.token;
  Object.assign(settings, { token, includeForks: els.forks.checked, scale: els.scale.value });
  if (!current) return;
  if (tokenChanged && current.source !== 'demo') show(current.user.login);
  else render();
});

// Poster
async function renderPoster() {
  els.posterImg.closest('.poster-frame').dataset.format = posterFormat;
  els.posterImg.removeAttribute('src');
  const repos = visibleRepos(current);
  const canvasOut = await buildPoster(city, current, repos, posterFormat);
  posterBlob = await new Promise((resolve) => canvasOut.toBlob(resolve, 'image/png'));
  els.posterImg.src = URL.createObjectURL(posterBlob);

  const text = shareText(current, repos);
  const link = new URL(location.href);
  const tweet = new URL('https://x.com/intent/post');
  tweet.searchParams.set('text', text);
  if (!['localhost', '127.0.0.1'].includes(link.hostname)) tweet.searchParams.set('url', link.href);
  els.tweet.href = tweet.href;
  const file = new File([posterBlob], `${current.user.login}-githubcity.png`, { type: 'image/png' });
  els.share.hidden = !navigator.canShare?.({ files: [file] });
}

els.post.addEventListener('click', async () => {
  if (!current) return;
  setOrbit(false);
  els.poster.showModal();
  await renderPoster();
});

els.poster.querySelectorAll('[data-format]').forEach((btn) => {
  btn.addEventListener('click', () => {
    posterFormat = btn.dataset.format;
    els.poster.querySelectorAll('[data-format]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    renderPoster();
  });
});

$('#close-poster').addEventListener('click', () => els.poster.close());

els.download.addEventListener('click', () => {
  if (!posterBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(posterBlob);
  a.download = `${current.user.login}-githubcity.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

els.copy.addEventListener('click', async () => {
  if (!posterBlob) return;
  const label = els.copy.textContent;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': posterBlob })]);
    els.copy.textContent = 'Copied';
  } catch {
    els.copy.textContent = 'Copy not allowed here';
  }
  setTimeout(() => (els.copy.textContent = label), 1600);
});

els.share.addEventListener('click', async () => {
  const file = new File([posterBlob], `${current.user.login}-githubcity.png`, { type: 'image/png' });
  try {
    await navigator.share({ files: [file], text: shareText(current, visibleRepos(current)) });
  } catch {}
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.card.hidden) {
    hideCard();
    city.setHighlight(null);
  }
});

// Start: a shared link builds that city; otherwise the demo city idles behind the intro.
const initial = new URL(location.href).searchParams.get('u');
if (initial) {
  els.hero.hidden = true;
  show(initial);
} else {
  city.build(demoCity().repos);
}

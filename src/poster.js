// Composes the shareable skyline image: the current camera view plus a caption.

export const FORMATS = {
  wide: [1600, 900],
  square: [1200, 1200],
};

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fitFont(ctx, text, weight, size, family, maxWidth) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    s -= 2;
  } while (ctx.measureText(text).width > maxWidth && s > 12);
}

export function summarize(repos) {
  const stars = repos.reduce((n, r) => n + r.stars, 0);
  const commits = repos.reduce((n, r) => n + r.commits, 0);
  const tallest = repos.reduce((best, r) => (!best || r.stars > best.stars ? r : best), null);
  return { stars, commits, tallest, buildings: repos.length };
}

export async function buildPoster(city, data, repos, format = 'wide') {
  const [W, H] = FORMATS[format];
  const shot = city.snapshot(W, H);
  const [avatar] = await Promise.all([
    loadImage(data.user.avatar ? `${data.user.avatar}${data.user.avatar.includes('?') ? '&' : '?'}s=200` : null),
    document.fonts.load('700 64px "Space Grotesk"'),
    document.fonts.load('500 24px "JetBrains Mono"'),
  ]);

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(shot, 0, 0);

  const shade = ctx.createLinearGradient(0, H * 0.5, 0, H);
  shade.addColorStop(0, 'rgba(4,5,14,0)');
  shade.addColorStop(1, 'rgba(4,5,14,0.9)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.16);
  top.addColorStop(0, 'rgba(4,5,14,0.6)');
  top.addColorStop(1, 'rgba(4,5,14,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.16);

  const pad = Math.round(W * 0.045);
  const mono = '"JetBrains Mono", ui-monospace, monospace';
  const sans = '"Space Grotesk", system-ui, sans-serif';
  const { stars, commits, tallest, buildings } = summarize(repos);

  // Header: wordmark and date.
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(232,235,255,0.85)';
  ctx.font = `500 22px ${mono}`;
  ctx.fillText('githubcity', pad, pad * 0.8);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(232,235,255,0.55)';
  ctx.fillText(new Date().toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }), W - pad, pad * 0.8);
  ctx.textAlign = 'left';

  // Stats row along the bottom.
  const stats = [
    [compact.format(stars), 'stars'],
    [compact.format(buildings), buildings === 1 ? 'building' : 'buildings'],
    [compact.format(commits), 'commits · 90 days'],
  ];
  const statY = H - pad - 30;
  let x = pad;
  ctx.textBaseline = 'alphabetic';
  for (const [value, label] of stats) {
    ctx.font = `700 40px ${sans}`;
    ctx.fillStyle = '#ffd58a';
    ctx.fillText(value, x, statY);
    const vw = ctx.measureText(value).width;
    ctx.font = `500 18px ${mono}`;
    ctx.fillStyle = 'rgba(232,235,255,0.7)';
    ctx.fillText(label, x, statY + 30);
    x += Math.max(vw, ctx.measureText(label).width) + pad * 0.9;
  }

  // Title block, above the stats.
  const avatarSize = format === 'wide' ? 84 : 96;
  const titleY = statY - 76;
  let tx = pad;
  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(pad + avatarSize / 2, titleY - avatarSize / 2 + 12, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, pad, titleY - avatarSize + 12, avatarSize, avatarSize);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,213,138,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(pad + avatarSize / 2, titleY - avatarSize / 2 + 12, avatarSize / 2, 0, Math.PI * 2);
    ctx.stroke();
    tx += avatarSize + 24;
  }
  const title = `@${data.user.login}`;
  fitFont(ctx, title, 700, format === 'wide' ? 76 : 84, sans, W - tx - pad);
  ctx.fillStyle = '#f4f5ff';
  ctx.fillText(title, tx, titleY);
  ctx.font = `500 20px ${mono}`;
  ctx.fillStyle = 'rgba(232,235,255,0.72)';
  const subtitle = tallest ? `tallest tower: ${tallest.name} (${compact.format(tallest.stars)}★)` : 'a city waiting to be built';
  ctx.fillText(subtitle, tx, titleY - (format === 'wide' ? 86 : 94));

  // Legend, bottom right.
  ctx.textAlign = 'right';
  ctx.font = `500 16px ${mono}`;
  ctx.fillStyle = 'rgba(232,235,255,0.5)';
  ctx.fillText('height = stars   lights = commits', W - pad, H - pad);
  ctx.textAlign = 'left';

  return c;
}

export function shareText(data, repos) {
  const { stars, commits, buildings } = summarize(repos);
  return `My GitHub as a city: ${buildings} buildings, ${compact.format(stars)}★, and ${compact.format(commits)} commits keeping the lights on.`;
}

// SEO build: run `npm run seo` after adding a game or changing seo/games.json or seo/config.json.
//
// - Writes the gallery tiles into public/index.html as static HTML (crawlable without JS)
// - Gives every game page a title, meta description, canonical URL, social preview tags and JSON-LD
// - Regenerates public/sitemap.xml and public/robots.txt
//
// Generated regions are wrapped in <!-- seo:... --> markers and are replaced on every run.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const games = JSON.parse(fs.readFileSync(path.join(__dirname, 'games.json'), 'utf8'));

const SITE = config.siteUrl.replace(/\/$/, '');
const abs = p => SITE + p;
const today = new Date().toISOString().slice(0, 10);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const json = obj => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

// Static pages besides the games (path -> file, title, description)
const PAGES = [
  { url: '/about.html', file: 'about.html', title: `About | ${config.siteName}`, meta: `About ${config.siteName}: free browser games you can play instantly on desktop and mobile, with no download or sign-up.`, priority: '0.4' },
  { url: '/privacy.html', file: 'privacy.html', title: `Privacy Policy | ${config.siteName}`, meta: `How ${config.siteName} handles your data: no accounts, no tracking cookies, and game progress saved only in your own browser.`, priority: '0.2' },
];

function replaceBetween(html, name, content, file) {
  const re = new RegExp(`(<!-- seo:${name} -->)[\\s\\S]*?(<!-- /seo:${name} -->)`);
  if (!re.test(html)) throw new Error(`${file}: missing <!-- seo:${name} --> markers`);
  return html.replace(re, `$1\n${content}\n$2`);
}

function commonHead({ title, description, url, image, imageAlt, type = 'website' }) {
  const tags = [
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(abs(url))}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<meta name="theme-color" content="#0b0a14" />`,
    `<link rel="icon" href="/favicon.ico" sizes="32x32" />`,
    `<link rel="icon" href="/icon.svg" type="image/svg+xml" />`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
    `<link rel="manifest" href="/manifest.webmanifest" />`,
    `<meta property="og:site_name" content="${esc(config.siteName)}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(abs(url))}" />`,
    `<meta property="og:image" content="${esc(abs(image))}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(abs(image))}" />`,
  ];
  if (config.twitterHandle) tags.push(`<meta name="twitter:site" content="${esc(config.twitterHandle)}" />`);
  if (config.googleSiteVerification) tags.push(`<meta name="google-site-verification" content="${esc(config.googleSiteVerification)}" />`);
  if (config.bingSiteVerification) tags.push(`<meta name="msvalidate.01" content="${esc(config.bingSiteVerification)}" />`);
  return tags;
}

// Head tags that the generator owns. Older copies of these outside the markers are removed.
const OWNED = [
  /\s*<meta\s+name="description"[^>]*>/gi,
  /\s*<link\s+rel="canonical"[^>]*>/gi,
  /\s*<meta\s+property="og:[^"]*"[^>]*>/gi,
  /\s*<meta\s+name="twitter:[^"]*"[^>]*>/gi,
  /\s*<meta\s+name="theme-color"[^>]*>/gi,
];

// Put a generated block into a page's <head>, right after <title>.
function setHead(file, title, tags) {
  const full = path.join(PUBLIC, file);
  let html = fs.readFileSync(full, 'utf8');
  const block = `<!-- seo:head -->\n${tags.join('\n')}\n<!-- /seo:head -->`;
  const hasBlock = /<!-- seo:head -->[\s\S]*?<!-- \/seo:head -->/.test(html);
  if (hasBlock) html = html.replace(/<!-- seo:head -->[\s\S]*?<!-- \/seo:head -->/, '\u0000SEO\u0000');
  for (const re of OWNED) html = html.replace(re, '');
  if (!/<title>[\s\S]*?<\/title>/i.test(html)) throw new Error(`${file}: no <title>`);
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  if (hasBlock) html = html.replace('\u0000SEO\u0000', block);
  else html = html.replace(/(<title>[\s\S]*?<\/title>)/i, `$1\n${block}`);
  fs.writeFileSync(full, html);
}

// ---------- game pages ----------
for (const g of games) {
  const title = `${g.name} – Play Free Online | ${config.siteName}`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoGame',
        name: g.name,
        description: g.meta,
        url: abs(g.url),
        image: abs(`/thumbs/${g.id}.webp`),
        genre: g.genre,
        gamePlatform: 'Web browser',
        applicationCategory: 'Game',
        operatingSystem: 'Any',
        playMode: g.id === 'tictactoe' ? 'MultiPlayer' : 'SinglePlayer',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
        isPartOf: { '@type': 'WebSite', name: config.siteName, url: abs('/') },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Games', item: abs('/') },
          { '@type': 'ListItem', position: 2, name: g.name, item: abs(g.url) },
        ],
      },
    ],
  };
  const tags = [
    ...commonHead({ title, description: g.meta, url: g.url, image: `/og/${g.id}.jpg`, imageAlt: `${g.name} gameplay`, type: 'website' }),
    `<script type="application/ld+json">\n${json(ld)}\n</script>`,
  ];
  setHead(g.file, title, tags);
}

// ---------- static pages ----------
for (const p of PAGES) {
  setHead(p.file, p.title, [
    ...commonHead({ title: p.title, description: p.meta, url: p.url, image: '/og/home.jpg', imageAlt: `${config.siteName}: a gallery of free browser games` }),
  ]);
}

// ---------- home page ----------
{
  const file = 'index.html';
  let html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(config.homeTitle)}</title>`);

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': abs('/#website'), name: config.siteName, url: abs('/'), description: config.homeDescription, inLanguage: 'en' },
      {
        '@type': 'ItemList',
        name: 'Free online games',
        numberOfItems: games.length,
        itemListElement: games.map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(g.url), name: g.name })),
      },
    ],
  };
  html = replaceBetween(html, 'head', [
    ...commonHead({ title: config.homeTitle, description: config.homeDescription, url: '/', image: '/og/home.jpg', imageAlt: `${config.siteName}: a gallery of free browser games` }),
    `<script type="application/ld+json">\n${json(ld)}\n</script>`,
  ].join('\n'), file);

  // Static tiles: the page script reads shape/tags/pos from these data attributes to lay them out
  const PLAY_ICON = '<svg viewBox="0 0 12 14" aria-hidden="true"><path d="M0 0l12 7-12 7z" fill="currentColor"/></svg>';
  const tiles = games.map((g, i) => {
    const badge = g.shape === 'hero' ? '<span class="badge feat">Featured</span>' : (g.tags.includes('3d') ? '<span class="badge">3D</span>' : '');
    const imgAttrs = [`src="/thumbs/${g.id}.webp"`, `alt="${esc(g.name)} gameplay screenshot"`, `width="${g.w}"`, `height="${g.h}"`, `decoding="async"`,
      i < 4 ? 'fetchpriority="high"' : (i > 11 ? 'loading="lazy"' : ''), g.pos ? `style="object-position:${g.pos}"` : ''].filter(Boolean).join(' ');
    return `      <a class="tile${g.shape === 'hero' ? ' hero' : ''}" href="${g.url}" data-shape="${g.shape}" data-tags="${g.tags.join(' ')}">` +
      `<img ${imgAttrs}>${badge}<div class="meta"><div class="txt"><h2 class="name">${esc(g.name)}</h2><p class="desc">${esc(g.desc)}</p></div><span class="play">${PLAY_ICON}</span></div></a>`;
  }).join('\n');
  html = replaceBetween(html, 'tiles', tiles, file);
  html = html.replace(/(<span id="count">)\d+(<\/span>)/, `$1${games.length}$2`);
  fs.writeFileSync(path.join(PUBLIC, file), html);
}

// ---------- sitemap.xml ----------
{
  const urls = [
    { loc: '/', priority: '1.0', images: games.map(g => ({ loc: `/thumbs/${g.id}.webp`, title: g.name })) },
    ...games.map(g => ({ loc: g.url, priority: g.shape === 'hero' ? '0.9' : '0.8', images: [{ loc: `/thumbs/${g.id}.webp`, title: g.name }] })),
    ...PAGES.map(p => ({ loc: p.url, priority: p.priority, images: [] })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(u => `  <url>
    <loc>${esc(abs(u.loc))}</loc>
    <lastmod>${today}</lastmod>
    <priority>${u.priority}</priority>
${u.images.map(im => `    <image:image><image:loc>${esc(abs(im.loc))}</image:loc></image:image>`).join('\n')}
  </url>`.replace(/\n\n/g, '\n')).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(PUBLIC, 'sitemap.xml'), xml);
}

// ---------- robots.txt ----------
fs.writeFileSync(path.join(PUBLIC, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /health

Sitemap: ${abs('/sitemap.xml')}
`);

console.log(`SEO build done: ${games.length} games, ${PAGES.length} pages, sitemap with ${games.length + PAGES.length + 1} URLs.`);

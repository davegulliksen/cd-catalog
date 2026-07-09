#!/usr/bin/env node
/**
 * generate-seo-pages.js
 * Generates per-album and per-series SEO landing pages + sitemap.xml
 * Run from the root of your cd-catalog repo:
 *   node generate-seo-pages.js
 *
 * Output:
 *   albums/[CatalogNumber].html   — one page per CD
 *   series/[series-slug].html     — one page per series
 *   sitemap.xml                   — all pages for Google/Bing
 */

const fs   = require('fs');
const path = require('path');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const JSONL_FILE    = 'catalog.jsonl';
const BASE_URL      = 'https://davegulliksen.github.io/cd-catalog';
const CATALOG_URL   = BASE_URL + '/';
const ALBUMS_DIR    = 'albums';
const SERIES_DIR    = 'series';
const COVERS_PATH   = '400x400covers';   // relative to site root
const THUMB_PATH    = 'thumb';
// ──────────────────────────────────────────────────────────────────────────────

// Ensure output directories exist
[ALBUMS_DIR, SERIES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Load and parse jsonl
const records = fs.readFileSync(JSONL_FILE, 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l)
  .map(l => JSON.parse(l));

// ── HELPERS ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function coverUrl(cd) {
  return `${BASE_URL}/${COVERS_PATH}/${cd['Unique CD Number']}_cover.jpg`;
}

function thumbUrl(cd) {
  return `${BASE_URL}/${THUMB_PATH}/${cd['Unique CD Number']}_cover.jpg`;
}

function albumPageUrl(cd) {
  return `${BASE_URL}/${ALBUMS_DIR}/${cd['Unique CD Number']}.html`;
}

function seriesPageUrl(seriesName) {
  return `${BASE_URL}/${SERIES_DIR}/${slugify(seriesName)}.html`;
}

const shippingHtml = `
<div class="shipping-info">
  <h3>Shipping</h3>
  <p>$5.00 for the first CD, $1.00 each additional in the same order.</p>
  <p>Free shipping when order total before shipping is $50.00 or more.</p>
  <p>Outside continental US: please inquire for rates.</p>
</div>`;

const buyNoticeAlbumHtml = `
<div class="buy-notice">
  <strong>To see pricing, condition details, and purchase this CD, you must use the full catalog page &mdash; where you'll also find more CDs available for sale, with new ones added regularly.</strong>
  <a href="${CATALOG_URL}" class="catalog-btn">Go to Full Catalog</a>
</div>`;

const buyNoticeSeriesHtml = `
<div class="buy-notice">
  <strong>To see pricing, condition details, and purchase these CDs, you must use the full catalog page &mdash; where you'll also find more CDs available for sale, with new ones added regularly.</strong>
  <a href="${CATALOG_URL}" class="catalog-btn">Go to Full Catalog</a>
</div>`;

const sharedCss = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #1a1a2e; color: #e0e0e0; line-height: 1.6; }
  a { color: #c9a96e; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .page-wrap { max-width: 860px; margin: 0 auto; padding: 2rem 1rem; }
  h1 { font-size: 1.6rem; color: #f0c070; margin-bottom: 0.4rem; }
  h2 { font-size: 1.3rem; color: #f0c070; margin: 1.5rem 0 0.5rem; }
  h3 { font-size: 1rem; color: #c9a96e; margin-bottom: 0.3rem; }
  .back-link { display: inline-block; margin-bottom: 1.5rem; font-size: 0.9rem; }
  .catalog-btn {
    display: inline-block; margin-top: 0.7rem;
    background: #c9a96e; color: #1a1a2e;
    padding: 0.5rem 1.2rem; border-radius: 4px; font-weight: bold;
  }
  .catalog-btn:hover { background: #f0c070; text-decoration: none; }
  .buy-notice {
    background: #2a2a4a; border: 2px solid #c9a96e;
    border-radius: 6px; padding: 1rem 1.2rem; margin: 1.5rem 0;
  }
  .buy-notice strong { display: block; margin-bottom: 0.3rem; color: #f0c070; }
  .shipping-info {
    background: #222240; border-radius: 6px;
    padding: 1rem 1.2rem; margin: 1rem 0;
  }
  .shipping-info p { margin: 0.2rem 0; font-size: 0.95rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
  td { padding: 0.35rem 0.5rem; vertical-align: top; border-bottom: 1px solid #333360; }
  td:first-child { color: #c9a96e; width: 160px; white-space: nowrap; }
  .cover-img { max-width: 400px; width: 100%; border-radius: 6px; margin: 1rem 0; display: block; }
  .series-grid { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 1rem; }
  .series-card {
    background: #222240; border-radius: 6px; padding: 0.8rem;
    width: calc(50% - 0.5rem); min-width: 220px;
  }
  .series-card img { width: 100%; border-radius: 4px; margin-bottom: 0.5rem; }
  .series-card .cd-title { font-weight: bold; font-size: 0.95rem; color: #f0c070; }
  .series-card .cd-price { color: #c9a96e; font-size: 0.9rem; margin-top: 0.2rem; }
  @media (max-width: 520px) { .series-card { width: 100%; } td:first-child { width: 110px; } }
`;

// ── PER-ALBUM PAGES ───────────────────────────────────────────────────────────

records.forEach(cd => {
  const id          = cd['Unique CD Number'];
  const title       = cd.Title || id;
  const series      = cd.Series || '';
  const label       = cd.Label || '';
  const year        = cd.Year || '';
  const runtime     = cd.Runtime || '';
  const description = cd.Description || '';
  const cover       = coverUrl(cd);
  const thumb       = thumbUrl(cd);
  const seriesSlug  = series ? slugify(series) : null;
  const seriesLink  = seriesSlug
    ? `<a href="../${SERIES_DIR}/${seriesSlug}.html">More ${esc(series)} CDs</a>`
    : '';

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": ["MusicAlbum", "Product"],
    "name": title,
    "image": cover,
    "description": description,
    "musicReleaseFormat": "CDFormat",
    "recordLabel": { "@type": "MusicGroup", "name": label },
    "datePublished": String(year),
    "offers": {
      "@type": "Offer",
      "price": cd.Price,
      "priceCurrency": "USD",
      "availability": "https://schema.org/InStock",
      "url": albumPageUrl(cd)
    },
    "inAlbum": series ? { "@type": "MusicAlbum", "name": series } : undefined
  }, null, 2);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} | Japanese Anime CD | Dave's Anime CD Catalog</title>
  <meta name="description" content="Buy ${esc(title)} — ${esc(series)} anime CD. ${esc(label)}, ${year}. ${esc(description)} Visit the full catalog for pricing and availability.">
  <meta name="keywords" content="${esc(title)}, ${esc(series)}, anime CD, Japanese anime music, ${esc(label)}, anime soundtrack">
  <link rel="canonical" href="${albumPageUrl(cd)}">
  <!-- Open Graph -->
  <meta property="og:type" content="product">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(series)} anime CD — ${esc(label)}, ${year}. Visit the full catalog for pricing.">
  <meta property="og:image" content="${cover}">
  <meta property="og:url" content="${albumPageUrl(cd)}">
  <meta property="og:site_name" content="Dave's Anime CD Catalog">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:image" content="${cover}">
  <script type="application/ld+json">${jsonLd}</script>
  <style>${sharedCss}</style>
</head>
<body>
<div class="page-wrap">
  <a class="back-link" href="${CATALOG_URL}">&larr; Back to Full Catalog</a>
  ${seriesLink ? `<span style="margin-left:1.5rem;">${seriesLink}</span>` : ''}

  <h1>${esc(title)}</h1>

  <img
    src="${cover}"
    alt="${esc(title)} — ${esc(series)} anime CD cover"
    class="cover-img"
    onerror="this.src='${thumb}'"
  >

  <table>
    <tr><td>Series</td><td>${esc(series)}</td></tr>
    <tr><td>Catalog #</td><td>${esc(id)}</td></tr>
    <tr><td>Label</td><td>${esc(label)}</td></tr>
    <tr><td>Year</td><td>${esc(String(year))}</td></tr>
    <tr><td>Runtime</td><td>${esc(runtime)}</td></tr>
    <tr><td>Contents</td><td>${esc(description)}</td></tr>
  </table>

  ${shippingHtml}
  ${buyNoticeAlbumHtml}

</div>
</body>
</html>`;

  fs.writeFileSync(path.join(ALBUMS_DIR, `${id}.html`), html, 'utf8');
});

console.log(`✔ Generated ${records.length} album pages → ${ALBUMS_DIR}/`);

// ── PER-SERIES PAGES ──────────────────────────────────────────────────────────

// Group records by series
const seriesMap = {};
records.forEach(cd => {
  const s = cd.Series || 'Uncategorized';
  if (!seriesMap[s]) seriesMap[s] = [];
  seriesMap[s].push(cd);
});

Object.entries(seriesMap).forEach(([seriesName, cds]) => {
  const slug      = slugify(seriesName);
  const pageUrl   = seriesPageUrl(seriesName);
  const firstCover = coverUrl(cds[0]);

  const cardsHtml = cds.map(cd => {
    return `
    <div class="series-card">
      <a href="../${ALBUMS_DIR}/${cd['Unique CD Number']}.html">
        <img
          src="${thumbUrl(cd)}"
          alt="${esc(cd.Title)} cover"
          loading="lazy"
        >
        <div class="cd-title">${esc(cd.Title)}</div>
      </a>
    </div>`;
  }).join('\n');

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": `${seriesName} Anime CDs`,
    "description": `Complete list of ${seriesName} Japanese anime CDs available for purchase.`,
    "url": pageUrl,
    "numberOfItems": cds.length,
    "itemListElement": cds.map((cd, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "url": albumPageUrl(cd),
      "name": cd.Title
    }))
  }, null, 2);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(seriesName)} Anime CDs | Dave's Anime CD Catalog</title>
  <meta name="description" content="Buy original Japanese ${esc(seriesName)} anime CDs. ${cds.length} title${cds.length !== 1 ? 's' : ''} available. Visit the full catalog for pricing and to purchase.">
  <meta name="keywords" content="${esc(seriesName)}, anime CD, Japanese anime music, anime soundtrack, buy anime CD">
  <link rel="canonical" href="${pageUrl}">
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(seriesName)} Anime CDs">
  <meta property="og:description" content="${cds.length} original Japanese ${esc(seriesName)} anime CDs available. Visit the full catalog for pricing.">
  <meta property="og:image" content="${firstCover}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:site_name" content="Dave's Anime CD Catalog">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(seriesName)} Anime CDs">
  <meta name="twitter:image" content="${firstCover}">
  <script type="application/ld+json">${jsonLd}</script>
  <style>${sharedCss}</style>
</head>
<body>
<div class="page-wrap">
  <a class="back-link" href="${CATALOG_URL}">&larr; Back to Full Catalog</a>

  <h1>${esc(seriesName)} Anime CDs</h1>
  <p style="margin:0.5rem 0 1rem;">${cds.length} title${cds.length !== 1 ? 's' : ''} available &mdash; click any cover for details.</p>

  ${shippingHtml}
  ${buyNoticeSeriesHtml}

  <h2>Available Titles</h2>
  <div class="series-grid">
    ${cardsHtml}
  </div>

</div>
</body>
</html>`;

  fs.writeFileSync(path.join(SERIES_DIR, `${slug}.html`), html, 'utf8');
});

console.log(`✔ Generated ${Object.keys(seriesMap).length} series pages → ${SERIES_DIR}/`);

// ── SITEMAP.XML ───────────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

const albumUrls = records.map(cd => `
  <url>
    <loc>${albumPageUrl(cd)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

const seriesUrls = Object.keys(seriesMap).map(s => `
  <url>
    <loc>${seriesPageUrl(s)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`).join('');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${CATALOG_URL}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
${albumUrls}
${seriesUrls}
</urlset>`;

fs.writeFileSync('sitemap.xml', sitemap, 'utf8');
console.log(`✔ Generated sitemap.xml`);
console.log(`\nDone! Submit sitemap.xml to Google Search Console and Bing Webmaster Tools.`);
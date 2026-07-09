// ===============================
// ERROR REPORTING SYSTEM
// ===============================
const errorList = [];
let bannerShown = false;

function logError(type, detail) {
  const entry = {
    type: type,
    detail: detail,
    time: new Date().toLocaleTimeString(),
    userAgent: navigator.userAgent,
    url: window.location.href
  };
  errorList.push(entry);
  showErrorBanner();
  const detailEl = document.getElementById('error-detail');
  if (detailEl) {
    detailEl.textContent = 'Diagnostics: ' + errorList.map(e => '[' + e.type + '] ' + e.detail).join(' | ');
  }
}

function showErrorBanner() {
  if (bannerShown) return;
  bannerShown = true;

  const banner = document.createElement('div');
  banner.id = 'error-banner';
  banner.style.cssText = [
    'position:fixed', 'bottom:70px', 'left:16px', 'right:16px',
    'background:#c62828', 'color:#fff', 'border-radius:8px',
    'padding:12px 16px', 'font-family:Arial,sans-serif', 'font-size:14px',
    'z-index:99999', 'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
    'display:flex', 'align-items:center', 'gap:12px'
  ].join(';');

  banner.innerHTML =
    '<div style="flex:1">' +
      '<div>Something did not load correctly on this page. Sorry for the inconvenience!</div>' +
      '<div id="error-detail" style="font-size:11px;margin-top:4px;opacity:0.85;word-break:break-all;"></div>' +
    '</div>' +
    '<button id="error-report-btn" style="background:#fff;color:#c62828;border:none;border-radius:6px;padding:6px 12px;font-size:13px;font-weight:bold;cursor:pointer;white-space:nowrap;">Report Problem</button>' +
    '<button id="error-dismiss-btn" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.5);border-radius:6px;padding:6px 10px;font-size:13px;cursor:pointer;">Dismiss</button>';

  document.body.appendChild(banner);

  document.getElementById('error-report-btn').addEventListener('click', function() {
    const errorText = errorList.map(e => e.time + ' [' + e.type + '] ' + e.detail).join('\n');
    const subject = encodeURIComponent('CD Catalog Problem Report');
    const body = encodeURIComponent(
      'Hi Dave,\n\nI ran into a problem on your CD catalog page:\n\n' +
      errorText + '\n\nPage: ' + errorList[0].url +
      '\nDevice: ' + errorList[0].userAgent + '\n\nHope this helps!'
    );
    window.location = 'mailto:DaveGUrgent@aol.com?subject=' + subject + '&body=' + body;
  });

  document.getElementById('error-dismiss-btn').addEventListener('click', function() {
    banner.remove();
  });
}

window.onerror = function(message, source, line) {
  logError('JS ERROR', message + ' (line ' + line + ')');
  return false;
};

window.onunhandledrejection = function(event) {
  logError('FETCH ERROR', String(event.reason));
};

// ===============================
// CATALOG STATE
// Declared here — before showScreen — so both showScreen and the
// catalog section below can reference these variables safely.
// ===============================

let allCDs          = [];           // complete parsed album array, populated once on load
let currentSort     = 'date-desc';  // matches sortSelect option values
let sortAllMode     = false;        // false = Series mode, true = Sort All mode
let selectedBucket  = null;         // value of the highlighted bucket item (string)
let selectedDiscrete = null;        // value of the highlighted discrete item
let gridOffset      = 0;            // index in currentList of the first visible grid card
let gridCols        = 0;            // computed from container width; 0 = not yet calculated
let gridRowHeight   = 0;            // computed card height in px; applied as grid-auto-rows
let currentList     = [];           // sorted/filtered album array driving the grid
let catalogDataReady    = false;    // true once catalog.jsonl has finished loading
let catalogFetchStarted = false;    // true once the fetch has been kicked off
const GRID_ROWS     = 4;            // grid is always exactly 4 rows tall

// ===============================
// SCREEN NAVIGATION
// ===============================
let suppressHashChange = false;
window.showScreen = function(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');

  suppressHashChange = true;
  window.location.hash = name;
  suppressHashChange = false;
  window.scrollTo(0, 0);

  if (name === 'coming' && !window.comingLoaded) {
    loadComing();
  }

  // Catalog screen needs special handling because the catalog layout has a
  // fixed pixel height based on clientWidth, which is 0 when the screen is hidden.
if (name === 'catalog') {
    if (!catalogFetchStarted) {
      // First visit to catalog — start the fetch now rather than at page load
      catalogFetchStarted = true;
      const msg = document.getElementById('loading-msg');
      if (msg) msg.classList.remove('hidden');
      loadCatalog();
    } else if (!catalogDataReady) {
      // Fetch is in progress but not done — keep message visible
      const msg = document.getElementById('loading-msg');
      if (msg) msg.classList.remove('hidden');
    } else if (gridCols === 0) {
      const dims = calcGridDimensions();
      gridCols = dims.cols;
      gridRowHeight = dims.rowHeight;
      rebuildCatalogUI();
    }
  }
};

// ===============================
// SHARED CART HELPERS
// ===============================
function getCart() {
  return JSON.parse(localStorage.getItem('cart')) || [];
}

function setCart(cart) {
  localStorage.setItem('cart', JSON.stringify(cart));
  document.dispatchEvent(new Event('cart-updated'));
}

function updateCartButton() {
  const btn = document.getElementById('cart-button');
  if (!btn) return;
  const cart = getCart();
  btn.textContent = cart.length > 0
    ? 'Cart (' + cart.length + ') \u2022 Ready to check out'
    : 'View Cart (0)';
}

function updateAddToCartButtons() {
  const cart = getCart();
  const cartIds = new Set(cart.map(item => item.CatalogNumber));
  const modalCartBtn = document.getElementById('modal-cart-btn');
  if (modalCartBtn && modalCartBtn.dataset.id) {
    if (cartIds.has(modalCartBtn.dataset.id)) {
      modalCartBtn.textContent = 'In Cart';
      modalCartBtn.classList.add('in-cart');
      modalCartBtn.disabled = true;
    } else {
      modalCartBtn.textContent = 'Add to Cart';
      modalCartBtn.classList.remove('in-cart');
      modalCartBtn.disabled = false;
    }
  }
}

document.addEventListener('cart-updated', () => {
  updateAddToCartButtons();
  updateCartButton();
});

// ===============================
// ADD CONFIRMATION FLASH
// ===============================
function showAddConfirmation(cdId) {
  try {
    const card = document.querySelector('.cd-thumb[data-id="' + cdId + '"]');
    if (!card) return;
    const el = card.querySelector('.add-confirmation');
    if (!el) return;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 900);
  } catch(e) {
    // Invalid selector — ignore
  }
}

// ===============================
// CD DETAIL MODAL
// ===============================
let currentModalCd = null;

function openModal(cd) {
  currentModalCd = cd;
  const cart = getCart();
  const inCart = cart.some(item => item.CatalogNumber === cd.CatalogNumber);

  document.getElementById('modal-image').src = cd.Thumbnail ? cd.Thumbnail : cd.Image;
  document.getElementById('modal-image').alt = cd.Title;
  document.getElementById('modal-title').textContent = cd.Title;
  document.getElementById('modal-catnum').textContent = cd.CatalogNumber + ' \u00b7 ' + cd.Label;
  document.getElementById('modal-label-year').textContent = 'Year: ' + cd.Year + ' \u00b7 Series: ' + cd.Series;
  document.getElementById('modal-runtime').textContent = 'Runtime: ' + cd.Runtime;
  document.getElementById('modal-price').textContent = '$' + cd.Price.toFixed(0);

  const badgeEl = document.getElementById('modal-badges');
  badgeEl.innerHTML = '';

  document.getElementById('modal-description').innerHTML =
    '<strong>Description</strong>' + cd.Description;
  document.getElementById('modal-condition').innerHTML =
    '<strong>Condition</strong>' + cd.Condition;

  document.getElementById('modal-email').href = cd.PurchaseEmail;
  document.getElementById('modal-fb').href = cd.PurchaseMessenger;

  const pdfBtn = document.getElementById('modal-pdf');
  if (cd.PDFScan) {
    pdfBtn.dataset.pdf = cd.PDFScan;
    pdfBtn.style.display = '';
  } else {
    pdfBtn.style.display = 'none';
  }

  const cartBtn = document.getElementById('modal-cart-btn');
  cartBtn.dataset.id = cd.CatalogNumber;
  if (inCart) {
    cartBtn.textContent = 'In Cart';
    cartBtn.classList.add('in-cart');
    cartBtn.disabled = true;
  } else {
    cartBtn.textContent = 'Add to Cart';
    cartBtn.classList.remove('in-cart');
    cartBtn.disabled = false;
  }

  fetch('https://cold-disk-5bd7.davegullik.workers.dev/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'modal_open',
      cd: cd.CatalogNumber,
      user: navigator.userAgent
    })
  }).catch(() => {}); // silent fail — logging should never disrupt the user

  document.getElementById('cd-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

window.closeModal = function() {
  document.getElementById('cd-modal').classList.add('hidden');
  document.body.style.overflow = '';
  currentModalCd = null;
};

document.getElementById('cd-modal').addEventListener('click', function(e) {
  if (e.target === this) window.closeModal();
});

// ===============================
// PDF ENVELOPE VIEWER
// ===============================
function openPdfEnvelope(e, anchor) {
  e.preventDefault();
  const pdfUrl = anchor.dataset.pdf;
  if (!pdfUrl) return;
  window.open('pdf-envelope.html?pdf=' + encodeURIComponent(pdfUrl), '_blank');
}

// Modal cart button
document.getElementById('modal-cart-btn').addEventListener('click', function() {
  if (!currentModalCd) return;
  const cart = getCart();
  if (!cart.some(item => item.CatalogNumber === currentModalCd.CatalogNumber)) {
    cart.push({
      Title:         currentModalCd.Title,
      CatalogNumber: currentModalCd.CatalogNumber,
      Price:         currentModalCd.Price,
      Image:         currentModalCd.Thumbnail,
      Series:        currentModalCd.Series
    });
    setCart(cart);
    showAddConfirmation(currentModalCd.CatalogNumber);
  }
  updateAddToCartButtons();
  updateCartButton();
});

// ===============================
// CATALOG LOADING
// ===============================

// Called the first time the user navigates to the catalog screen.
// Keeping the fetch deferred means the splash/faq/coming screens load
// instantly with no background network activity.
function loadCatalog() {
  // Show loading message after 400ms if data still hasn't arrived.
  // Since we already showed it immediately in showScreen, this timer
  // is a safety net for cases where it got hidden unexpectedly.
  const loadingTimer = setTimeout(() => {
    if (!catalogDataReady) {
      const msg = document.getElementById('loading-msg');
      if (msg) msg.classList.remove('hidden');
    }
  }, 400);

  fetch('catalog.jsonl?t=' + Date.now())
    .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status + ' loading catalog.jsonl');
      return response.text();
    })
    .then(text => {
      clearTimeout(loadingTimer);
      catalogDataReady = true;
      const msg = document.getElementById('loading-msg');
      if (msg) msg.classList.add('hidden');

      allCDs = text.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          try { return JSON.parse(line); }
          catch(e) {
            console.error('Skipping malformed JSONL line:', line);
            logError('CATALOG PARSE FAIL', 'Bad JSONL line: ' + line.slice(0, 80));
            return null;
          }
        })
        .filter(cd => cd !== null);

      const dims = calcGridDimensions();
      gridCols      = dims.cols;
      gridRowHeight = dims.rowHeight;
      if (gridCols > 0) {
        rebuildCatalogUI();
      }
    })
    .catch(err => {
      clearTimeout(loadingTimer);
      console.error('Error loading catalog:', err);
      logError('CATALOG LOAD FAIL', String(err));
    });
}

// ===============================
// GRID DIMENSION CALCULATION
// ===============================

// Derives card dimensions so the image portion is approximately square.
// Strategy: divide available height by 4 rows to get card height, subtract
// an estimated 2-line info strip to get the image height (= target card width),
// then compute how many such cards fit across the available width.
// Returns { cols, rowHeight } or { cols: 0, rowHeight: 0 } when hidden.
function calcGridDimensions() {
  const wrapper = document.querySelector('.grid-wrapper');
  if (!wrapper || wrapper.clientWidth === 0) return { cols: 0, rowHeight: 0 };

  const wrapperH  = wrapper.clientHeight;
  const wrapperW  = wrapper.clientWidth;
  const gap       = 8;   // matches .cd-grid gap in CSS
  const padH      = 20;  // 10px top + 10px bottom padding inside grid-wrapper
  const padW      = 20;  // 10px left + 10px right
  const infoStrip = 36;  // estimated height of 2-line info strip (price + cat number + padding)

  // Card height: fill 4 rows in the available vertical space
  const availH  = wrapperH - padH - (GRID_ROWS - 1) * gap;
  const cardH   = Math.max(60, availH / GRID_ROWS); // minimum 60px card

  // Target image size: card height minus info strip → the image portion is square
  // Card width = image width = image height = cardH - infoStrip
  const cardW = Math.max(60, Math.round(cardH - infoStrip));

  // How many square-ish cards fit across the available width?
  const availW = wrapperW - padW;
  const cols   = Math.max(2, Math.floor((availW + gap) / (cardW + gap)));

  return { cols, rowHeight: Math.round(cardH) };
}

// ===============================
// SORT HELPERS
// ===============================

// Returns a copy of allCDs sorted for the current mode and sort key.
// Series mode: primary sort is series name A-Z; secondary is the chosen sort.
// Sort All mode: a single global sort with no series grouping.
function getSortedList() {
  const sorted = [...allCDs];

  if (!sortAllMode) {
    // Series mode — group by series name, then sort within each group
    sorted.sort((a, b) => {
      const sc = (a.Series || '').localeCompare(b.Series || '');
      return sc !== 0 ? sc : secondaryCompare(a, b);
    });
  } else {
    // Sort All mode — global single-field sort
    applySingleSort(sorted);
  }

  return sorted;
}

// Secondary sort used within a series in Series mode
function secondaryCompare(a, b) {
  switch (currentSort) {
    case 'date-asc':    return new Date(a.DateAdded) - new Date(b.DateAdded);
    case 'date-desc':   return new Date(b.DateAdded) - new Date(a.DateAdded);
    case 'price-asc':   return a.Price - b.Price;
    case 'price-desc':  return b.Price - a.Price;
    case 'catalog':     return (a.CatalogNumber || '').localeCompare(b.CatalogNumber || '');
    default:            return 0;
  }
}

// Single global sort applied in Sort All mode
function applySingleSort(arr) {
  switch (currentSort) {
    case 'date-asc':   arr.sort((a, b) => new Date(a.DateAdded) - new Date(b.DateAdded));  break;
    case 'date-desc':  arr.sort((a, b) => new Date(b.DateAdded) - new Date(a.DateAdded));  break;
    case 'price-asc':  arr.sort((a, b) => a.Price - b.Price);                              break;
    case 'price-desc': arr.sort((a, b) => b.Price - a.Price);                              break;
    case 'catalog':    arr.sort((a, b) => (a.CatalogNumber || '').localeCompare(b.CatalogNumber || '')); break;
  }
}

// ===============================
// BUCKET BUILDERS
// Returns an array of bucket objects: { label, value, [bucketEnd, bucketIndex] }
// Only buckets that contain at least one album are included.
// ===============================

function buildBuckets() {
  if (!sortAllMode)                                          return buildLetterBuckets('series');
  if (currentSort === 'price-asc' || currentSort === 'price-desc') return buildPriceBuckets();
  if (currentSort === 'date-asc'  || currentSort === 'date-desc')  return buildDateBuckets();
  if (currentSort === 'catalog')                             return buildLetterBuckets('catalog');
  return [];
}

// Letter buckets for series names or catalog numbers.
// field = 'series' | 'catalog' — determines which CD property to read.
// Digits and symbols collapse to '#'; letters are returned in A-Z order.
function buildLetterBuckets(field) {
  const letters = new Set();
  allCDs.forEach(cd => {
    const str = field === 'series' ? (cd.Series || '') : (cd.CatalogNumber || '');
    if (!str) return;
    const first = str.trim()[0].toUpperCase();
    letters.add(/[A-Z]/.test(first) ? first : '#');
  });
  return [...letters]
    .sort((a, b) => a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b))
    .map(l => ({ label: l, value: l }));
}

// Price buckets: 26 evenly-spaced ranges across the full price span.
// bucketStart (value) and bucketEnd are the range boundaries.
// bucketIndex tracks the original 0-25 position so the last bucket
// (index 25) can use an inclusive upper-bound comparison for the max price.
function buildPriceBuckets() {
  const prices = allCDs.map(cd => cd.Price).filter(p => typeof p === 'number');
  if (prices.length === 0) return [];

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  // Edge case: all albums same price — one bucket covers it
  if (min === max) {
    return [{ label: String(Math.floor(min)), value: min, bucketEnd: min + 0.001, bucketIndex: 0 }];
  }

  const sliceWidth = (max - min) / 26;
  const buckets = [];

  for (let i = 0; i < 26; i++) {
    const bStart = min + i * sliceWidth;
    const bEnd   = min + (i + 1) * sliceWidth;
    const isLast = (i === 25);

    // Include this bucket only if at least one album's price falls in it
    const hasAlbum = allCDs.some(cd => {
      if (typeof cd.Price !== 'number') return false;
      return isLast
        ? cd.Price >= bStart && cd.Price <= bEnd  // last bucket: inclusive upper bound
        : cd.Price >= bStart && cd.Price < bEnd;
    });

    if (hasAlbum) {
      buckets.push({
        label:       String(Math.floor(bStart)), // whole dollars, no $ sign
        value:       bStart,
        bucketEnd:   bEnd,
        bucketIndex: i
      });
    }
  }

  // Reverse for high-to-low price sort so the most expensive bucket is at top
  return currentSort === 'price-desc' ? buckets.reverse() : buckets;
}

// Date buckets: up to 26 distinct mm/yy months that contain at least one album.
// If there are more than 26 distinct months, evenly sample 26 of them.
function buildDateBuckets() {
  const monthSet = new Set();

  allCDs.forEach(cd => {
    if (!cd.DateAdded) return;
    const d = new Date(cd.DateAdded);
    if (isNaN(d)) return;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(2);
    monthSet.add(mm + '/' + yy);
  });

  // Sort chronologically (oldest first)
  let months = [...monthSet].sort((a, b) => {
    const toNum = s => parseInt('20' + s.slice(3) + s.slice(0, 2), 10); // "mm/yy" → 20yyMM int
    return toNum(a) - toNum(b);
  });

  // If more than 26 months, evenly sample 26, preserving first and last
  if (months.length > 26) {
    const step = (months.length - 1) / 25;
    months = Array.from({ length: 26 }, (_, i) => months[Math.round(i * step)]);
    // step > 1 here (months.length > 26 implies step ≥ 1), so no duplicates
  }

  const buckets = months.map(m => ({ label: m, value: m }));
  // Reverse for newest-first sort
  return currentSort === 'date-desc' ? buckets.reverse() : buckets;
}

// ===============================
// DISCRETE LIST BUILDERS
// Returns an array of items: { label, value }
// ===============================

function buildDiscreteItems() {
  if (!sortAllMode)                                               return buildSeriesDiscrete();
  if (currentSort === 'price-asc' || currentSort === 'price-desc') return buildPriceDiscrete();
  if (currentSort === 'date-asc'  || currentSort === 'date-desc')  return buildDateDiscrete();
  if (currentSort === 'catalog')                                  return buildCatalogDiscrete();
  return [];
}

// Series discrete: unique series names with album count, A-Z
function buildSeriesDiscrete() {
  const counts = {};
  allCDs.forEach(cd => {
    if (cd.Series) counts[cd.Series] = (counts[cd.Series] || 0) + 1;
  });
  return Object.keys(counts)
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({ label: name + ' (' + counts[name] + ')', value: name }));
}

// Price discrete: unique prices that exist in the catalog, sorted by active direction
function buildPriceDiscrete() {
  const prices = [...new Set(allCDs.map(cd => cd.Price).filter(p => typeof p === 'number'))];
  prices.sort((a, b) => currentSort === 'price-desc' ? b - a : a - b);
  return prices.map(p => ({ label: '$' + p.toFixed(0), value: p }));
}

// Date discrete: unique mm/dd/yy dates that exist in the catalog, sorted by active direction
function buildDateDiscrete() {
  const seen = {};
  allCDs.forEach(cd => {
    if (!cd.DateAdded) return;
    const d = new Date(cd.DateAdded);
    if (isNaN(d)) return;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(2);
    const key = mm + '/' + dd + '/' + yy;
    seen[key] = true;
  });

  const dates = Object.keys(seen);
  dates.sort((a, b) => {
    // Parse "mm/dd/yy" → integer 20yymmdd for numeric sort
    const toNum = s => {
      const [m, d, y] = s.split('/');
      return parseInt('20' + y + m + d, 10);
    };
    return currentSort === 'date-desc' ? toNum(b) - toNum(a) : toNum(a) - toNum(b);
  });

  return dates.map(d => ({ label: d, value: d }));
}

// Catalog discrete: unique catalog numbers sorted alphabetically
function buildCatalogDiscrete() {
  const nums = [...new Set(allCDs.map(cd => cd.CatalogNumber).filter(Boolean))];
  nums.sort((a, b) => a.localeCompare(b));
  return nums.map(n => ({ label: n, value: n }));
}

// ===============================
// BUCKET-TO-DISCRETE MATCHING
// Given a discrete item, returns the value of the bucket it belongs to,
// or null if no bucket matches. Used to set data-bucket on discrete elements
// so scrollDiscreteToLetter can find them.
// ===============================

function getBucketForItem(item, buckets) {
  if (buckets.length === 0) return null;

  if (!sortAllMode || currentSort === 'catalog') {
    // Letter bucket: match first character of the value string
    const str   = String(item.value).trim();
    const first = str[0] ? str[0].toUpperCase() : '#';
    const letter = /[A-Z]/.test(first) ? first : '#';
    return buckets.some(b => b.value === letter) ? letter : null;
  }

  if (currentSort === 'price-asc' || currentSort === 'price-desc') {
    const price = item.value;
    for (const b of buckets) {
      const isLast = (b.bucketIndex === 25);
      const inRange = isLast
        ? price >= b.value && price <= b.bucketEnd
        : price >= b.value && price <  b.bucketEnd;
      if (inRange) return String(b.value); // return as string to match data-value attr
    }
    return null;
  }

  if (currentSort === 'date-asc' || currentSort === 'date-desc') {
    // Discrete date is "mm/dd/yy"; bucket is "mm/yy" — extract the month/year
    const parts = item.value.split('/');
    if (parts.length < 3) return null;
    const mmyy = parts[0] + '/' + parts[2]; // "mm" + "/" + "yy"
    return buckets.some(b => b.value === mmyy) ? mmyy : null;
  }

  return null;
}

// ===============================
// HALO MATCHING
// Returns true if cd should receive the gold halo border given the
// currently selected discrete value.
// ===============================

function matchesDiscrete(cd, discreteValue) {
  if (discreteValue === null || discreteValue === undefined) return false;

  if (!sortAllMode) {
    // Series mode: halo marks the selected series
    return cd.Series === discreteValue;
  }

  if (currentSort === 'price-asc' || currentSort === 'price-desc') {
    return cd.Price === discreteValue;
  }

  if (currentSort === 'date-asc' || currentSort === 'date-desc') {
    if (!cd.DateAdded) return false;
    const d = new Date(cd.DateAdded);
    if (isNaN(d)) return false;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(2);
    return (mm + '/' + dd + '/' + yy) === discreteValue;
  }

  if (currentSort === 'catalog') {
    return cd.CatalogNumber === discreteValue;
  }

  return false;
}

// ===============================
// RENDER: BUCKET COLUMN
// ===============================

function renderBuckets(buckets) {
  const col = document.getElementById('bucket-col');
  col.innerHTML = '';

  buckets.forEach(bucket => {
    const el = document.createElement('div');
    el.className  = 'bucket-item' + (String(bucket.value) === String(selectedBucket) ? ' active' : '');
    el.textContent = bucket.label;
    el.dataset.value = String(bucket.value); // stored as string for attribute lookup

    el.addEventListener('click', () => {
      // Highlight this bucket without redrawing the grid
      col.querySelectorAll('.bucket-item').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      selectedBucket = String(bucket.value);
      // Scroll the discrete column so the first item in this bucket is near the top
      scrollDiscreteToLetter(String(bucket.value));
    });

    col.appendChild(el);
  });
}

// Scrolls the discrete column to the first item tagged with the given bucket value
function scrollDiscreteToLetter(bucketValue) {
  const col = document.getElementById('discrete-col');
  if (!col) return;

  // Walk discrete items looking for the first one whose data-bucket matches
  const items = col.querySelectorAll('.discrete-item');
  for (const item of items) {
    if (item.dataset.bucket === bucketValue) {
      // A small offset of 4px keeps a sliver of the previous context visible
      col.scrollTop = Math.max(0, item.offsetTop - 4);
      return;
    }
  }
}

// ===============================
// RENDER: DISCRETE COLUMN
// ===============================

function renderDiscrete(items, buckets) {
  const col = document.getElementById('discrete-col');
  col.innerHTML = '';

  items.forEach(item => {
    const el = document.createElement('div');
    el.className   = 'discrete-item' + (item.value === selectedDiscrete ? ' active' : '');
    el.textContent = item.label;
    el.dataset.value = String(item.value);

    // Tag each item with its parent bucket so scrollDiscreteToLetter can find it
    const bucketVal = getBucketForItem(item, buckets);
    if (bucketVal !== null) el.dataset.bucket = String(bucketVal);

    el.addEventListener('click', () => {
      // Update active state on the discrete item without re-rendering the whole list
      col.querySelectorAll('.discrete-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      selectedDiscrete = item.value;

      // Also highlight the corresponding bucket
      if (el.dataset.bucket !== undefined) {
        const bktCol = document.getElementById('bucket-col');
        if (bktCol) {
          bktCol.querySelectorAll('.bucket-item').forEach(b => {
            b.classList.toggle('active', b.dataset.value === el.dataset.bucket);
          });
          selectedBucket = el.dataset.bucket;
        }
      }

      // Jump the grid to the first album that matches this selection.
      // Snap to the row boundary so the matching album starts at the left of a row.
      const matchIdx = currentList.findIndex(cd => matchesDiscrete(cd, item.value));
      gridOffset = matchIdx >= 0
        ? Math.floor(matchIdx / gridCols) * gridCols
        : 0;
      renderGrid();
    });

    col.appendChild(el);
  });

  // After rendering, scroll so the currently active item is visible (~1/3 from top)
  if (selectedDiscrete !== null) {
    setTimeout(() => {
      const active = col.querySelector('.discrete-item.active');
      if (active) col.scrollTop = Math.max(0, active.offsetTop - col.clientHeight / 3);
    }, 0);
  }
}

// ===============================
// RENDER: ALBUM GRID
// ===============================

function renderGrid() {
  // Don't attempt to render before column count is known
  if (gridCols === 0) return;

  const container = document.getElementById('catalog');
  if (!container) return;

  // Apply the JS-computed column count and row height.
  // grid-auto-rows sets each card to exactly gridRowHeight px; the image
  // (flex:1) fills the card minus the info strip, staying roughly square.
  container.style.gridTemplateColumns = 'repeat(' + gridCols + ', 1fr)';
  container.style.gridAutoRows        = gridRowHeight + 'px';
  container.innerHTML = '';

  // Slice exactly one page of albums from the current sorted list
  const pageSize = GRID_ROWS * gridCols;
  const slice    = currentList.slice(gridOffset, gridOffset + pageSize);

  slice.forEach(cd => {
    const isHalo  = matchesDiscrete(cd, selectedDiscrete);
    const div     = document.createElement('div');
    div.className = 'cd-thumb' + (isHalo ? ' cd-halo' : '');
    div.dataset.id = cd.CatalogNumber;

    const thumbSrc = cd.Thumbnail ? cd.Thumbnail : cd.Image;

    // "NEW ADD" badge for albums cataloged within the last 15 days
    const daysSince = (Date.now() - new Date(cd.DateAdded)) / (1000 * 60 * 60 * 24);
    const isNew     = cd.DateAdded && daysSince <= 15;

    // Images use data-src so they're only fetched when the observer fires,
    // keeping network usage to the visible page of cards only
    div.innerHTML =
      '<img class="cd-thumb-img" data-src="' + thumbSrc + '" alt="' + cd.Title + '">' +
      '<div class="add-confirmation">Added!</div>' +
      '<div class="cd-thumb-info">' +
        '<div class="cd-thumb-cat">' + cd['Unique CD Number'] + '</div>' +
        '<div class="cd-thumb-price-row">' +
          '<div class="cd-thumb-price">$' + cd.Price.toFixed(0) + '</div>' +
          (isNew
            ? '<span class="badge badge-new" style="font-size:8px;white-space:normal;max-width:36px;text-align:center;line-height:1.2;">NEW ADD</span>'
            : '') +
        '</div>' +
      '</div>';

    div.addEventListener('click', () => openModal(cd));
    container.appendChild(div);
  });

  // Lazy-load images for this page only using IntersectionObserver.
  // Because the grid is overflow-hidden the cards are technically all "visible"
  // in the document flow, so rootMargin: '0px' is sufficient.
  const imgs = container.querySelectorAll('img.cd-thumb-img');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.onerror = () => logError('IMAGE FAIL', img.dataset.src);
          img.src = img.dataset.src;
          observer.unobserve(img);
        }
      });
    }, { rootMargin: '50px 0px' });
    imgs.forEach(img => observer.observe(img));
  } else {
    // Fallback for browsers without IntersectionObserver
    imgs.forEach(img => {
      img.onerror = () => logError('IMAGE FAIL', img.dataset.src);
      img.src = img.dataset.src;
    });
  }

  updateAddToCartButtons();
}

// ===============================
// FULL UI REBUILD
// Called whenever sort or mode changes — rebuilds all three panels from scratch
// and resets selection state.
// ===============================

function rebuildCatalogUI() {
  // Re-sort the full album list for the new mode/sort combination
  currentList = getSortedList();

  // Preserve the current discrete selection across sort changes so the user
  // doesn't lose their place when changing sort order within Series mode.
  // After re-sorting, find where the selected item now appears and jump
  // gridOffset to that row. If the selection no longer exists in the new
  // context (e.g., after a mode switch from Series to All), findIndex
  // returns -1 and we do a silent clean reset instead.
  if (selectedDiscrete !== null) {
    const matchIdx = currentList.findIndex(cd => matchesDiscrete(cd, selectedDiscrete));
    if (matchIdx >= 0) {
      gridOffset = Math.floor(matchIdx / gridCols) * gridCols;
    } else {
      // Selection doesn't exist in the new context — clear it so no phantom halo appears
      selectedBucket   = null;
      selectedDiscrete = null;
      gridOffset       = 0;
    }
  } else {
    gridOffset = 0;
  }

  const buckets = buildBuckets();
  const items   = buildDiscreteItems();

  renderBuckets(buckets);
  renderDiscrete(items, buckets);
  renderGrid();
}

// ===============================
// NAVIGATION ARROWS
// Each function moves gridOffset by the appropriate amount and re-renders.
// Row Up/Down moves one row (gridCols items). Page Up/Down moves a full
// grid page (GRID_ROWS * gridCols items). First/Last jump to the endpoints.
// ===============================

function navFirst() {
  gridOffset = 0;
  renderGrid();
}

function navLast() {
  // Position the view so the very last album lands in the last grid slot.
  // Formula: offset = length - pageSize places the last album at position
  // (length-1) - offset = pageSize - 1, which is the last slot.
  const pageSize = GRID_ROWS * gridCols;
  gridOffset = Math.max(0, currentList.length - pageSize);
  renderGrid();
}

function navRowUp() {
  gridOffset = Math.max(0, gridOffset - gridCols);
  renderGrid();
}

function navRowDown() {
  // Stop when the last album's row is at the top of the grid — don't
  // scroll past a state where nothing would be in the first row
  const lastRowStart = Math.floor(Math.max(0, currentList.length - 1) / gridCols) * gridCols;
  gridOffset = Math.min(lastRowStart, gridOffset + gridCols);
  renderGrid();
}

function navPageUp() {
  gridOffset = Math.max(0, gridOffset - GRID_ROWS * gridCols);
  renderGrid();
}

function navPageDown() {
  const lastRowStart = Math.floor(Math.max(0, currentList.length - 1) / gridCols) * gridCols;
  gridOffset = Math.min(lastRowStart, gridOffset + GRID_ROWS * gridCols);
  renderGrid();
}

// Wire up the six arrow buttons
document.getElementById('nav-first'    ).addEventListener('click', navFirst);
document.getElementById('nav-page-up'  ).addEventListener('click', navPageUp);
document.getElementById('nav-row-up'   ).addEventListener('click', navRowUp);
document.getElementById('nav-row-down' ).addEventListener('click', navRowDown);
document.getElementById('nav-page-down').addEventListener('click', navPageDown);
document.getElementById('nav-last'     ).addEventListener('click', navLast);

// ===============================
// CATALOG CONTROLS
// Sort dropdown and Series|All tab — both trigger a full UI rebuild
// ===============================

document.getElementById('sortSelect').addEventListener('change', function() {
  currentSort = this.value;
  rebuildCatalogUI();
});

document.getElementById('tab-series').addEventListener('click', function() {
  if (sortAllMode) {
    sortAllMode = false;
    this.classList.add('active');
    document.getElementById('tab-all').classList.remove('active');
    rebuildCatalogUI();
  }
});

document.getElementById('tab-all').addEventListener('click', function() {
  if (!sortAllMode) {
    sortAllMode = true;
    this.classList.add('active');
    document.getElementById('tab-series').classList.remove('active');
    rebuildCatalogUI();
  }
});

// ===============================
// COMING CDs LOADING
// ===============================
window.comingLoaded = false;

function loadComing() {
  window.comingLoaded = true;
  fetch('coming.txt')
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' loading coming.txt');
      return r.text();
    })
    .then(text => {
      const container = document.getElementById('coming-list');
      const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');

      if (lines.length === 0) {
        container.textContent = 'No coming CDs listed yet.';
        return;
      }

      container.innerHTML = '';
      lines.forEach(line => {
        const clean = line.replace(/<br\s*\/?>/gi, '').trim();
        if (!clean) return;

        const div      = document.createElement('div');
        div.className  = 'coming-line';
        const textSpan = document.createElement('span');
        textSpan.className = 'coming-line-text';

        // Check for Foobar2000 YESLISTED / NOTLISTED suffix
        const isYesListed = clean.endsWith(' (YESLISTED)');
        const isNotListed = clean.endsWith(' (NOTLISTED)');
        let baseName = clean;
        if (isYesListed || isNotListed) baseName = clean.slice(0, -12).trim();

        textSpan.textContent = baseName;
        div.appendChild(textSpan);

        // Show badge only for YESLISTED — these are already in the catalog
        if (isYesListed) {
          const badge = document.createElement('span');
          badge.className  = 'badge badge-available';
          badge.textContent = 'Available Now';
          div.appendChild(badge);
        }

        container.appendChild(div);
      });
    })
    .catch(err => {
      document.getElementById('coming-list').textContent = 'Could not load coming CDs list.';
      console.error('Error loading coming.txt:', err);
      logError('COMING LIST LOAD FAIL', String(err));
    });
}

// ===============================
// CART BUTTON CLICK
// ===============================
document.getElementById('cart-button').addEventListener('click', () => {
  const cartModal = document.getElementById('cart-modal');
  if (cartModal) cartModal.classList.remove('hidden');
});

// Initialize cart display on page load
updateCartButton();

// ===============================
// INITIAL SCREEN FROM URL
// ===============================
function loadInitialScreen() {
  const hash = window.location.hash.replace('#', '');
  if (hash && document.getElementById('screen-' + hash)) {
    showScreen(hash);
  } else {
    showScreen('splash');
  }
}

// Handle browser back/forward navigation
window.addEventListener('hashchange', () => {
  if (suppressHashChange) return;

  const hash = window.location.hash.replace('#', '');
  const target = document.getElementById('screen-' + hash);

  // If the hash doesn't match a real screen, do nothing
  if (!target) return;

  // If the correct screen is already active, do nothing
  if (target.classList.contains('active')) return;

  showScreen(hash);
});


loadInitialScreen();
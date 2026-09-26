/* jiujitsu.bot — front end
   Reads event_listings.json (written by main.py) and renders three views
   that share one set of filters: Events (list), Map, and Calendar.
   No build step and no framework: drop these files next to the JSON. */
(() => {
  'use strict';

  // ---------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------
  const DATA_URL = 'event_listings.json';
  // Show dashed "Ad space" boxes where ads will go. Set to false before
  // launch if a slot has no ad code yet, or define window.JJB_renderAd.
  const SHOW_AD_PLACEHOLDERS = window.JJB_SHOW_AD_PLACEHOLDERS ?? true;
  const INFEED_AD_EVERY = 12; // rows between in-list ads on the Events view

  const PROMOS = {
    IBJJF: { full: 'International Brazilian Jiu-Jitsu Federation', color: 'var(--p-ibjjf)' },
    AJP:   { full: 'Abu Dhabi Jiu-Jitsu Pro', color: 'var(--p-ajp)' },
    AGF:   { full: 'American Grappling Federation', color: 'var(--p-agf)' },
    TCO:   { full: 'Tap Cancer Out', color: 'var(--p-tco)' },
    // Optional: add logo: 'logos/ibjjf.svg' to any promotion once you have
    // permission to use its logo; it will replace the colored dot.
    NAGA:     { full: 'North American Grappling Association', color: 'var(--p-naga)' },
    ADCC:     { full: 'Abu Dhabi Combat Club', color: 'var(--p-adcc)' },
    JJWL:     { full: 'Jiu Jitsu World League', color: 'var(--p-jjwl)' },
    FUJI:     { full: 'Fuji BJJ', color: 'var(--p-fuji)' },
    NEWBREED: { full: 'Newbreed Jiu Jitsu Federation', color: 'var(--p-newbreed)' },
  };
  const MINE_STYLE = { color: 'var(--p-mine)' };
  const AD_SIZES = { leaderboard: '728 × 90 desktop, 320 × 50 phone', infeed: 'In-list ad', default: '300 × 250' };

  // ---------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const escHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeURL = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  // Dates are "YYYY-MM-DD" strings, handled as local calendar days
  const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayISO = () => toISO(new Date());
  const fmt = {
    mon: new Intl.DateTimeFormat('en-US', { month: 'short' }),
    dow: new Intl.DateTimeFormat('en-US', { weekday: 'short' }),
    monthYear: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }),
    long: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    short: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };

  function hash(str) { // small stable id for events
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function milesBetween(a, b) {
    const R = 3958.8, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------
  // Data cleanup (the scraped data is a little uneven)
  // ---------------------------------------------------------------
  const KEEP_UPPER = new Set(['AJP', 'IBJJF', 'BJJ', 'AGF', 'TCO', 'NAGA', 'ADCC', 'JJWL', 'UAE', 'USA', 'UK', 'NYC', 'II', 'III', 'IV', 'DC']);
  function tidyName(name) {
    name = String(name || '').replace(/\s+/g, ' ').trim();
    const letters = name.replace(/[^A-Za-z]/g, '');
    const upper = letters.replace(/[^A-Z]/g, '');
    if (letters.length && upper.length / letters.length > 0.8) {
      // ALL-CAPS names (AJP) → title case, keeping acronyms
      name = name.split(' ').map((w) => w.split('-').map((p) => {
        if (KEEP_UPPER.has(p)) return p;
        if (p === 'GI') return 'Gi';
        return p.charAt(0) + p.slice(1).toLowerCase();
      }).join('-')).join(' ');
    }
    return name;
  }
  function tidyLocation(loc) {
    loc = String(loc || '')
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,\s*,/g, ',')
      .replace(/[\s,]+$/g, '')
      .trim();
    if (!loc || loc === 'INTL') return '';
    return loc;
  }

  const US_STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico' };

  function stateName(loc) { // "Houston, TX" → "Texas usa" so people can search by state name
    const m = loc.match(/,\s*([A-Z]{2})$/);
    return m && US_STATES[m[1]] ? `${US_STATES[m[1]]} usa united states` : '';
  }

  function normalize(raw) {
    const name = tidyName(raw.name);
    const location = tidyLocation(raw.location);
    const lat = parseFloat(raw.lat), lon = parseFloat(raw.lon);
    // main.py writes lat -90 / lon 0 when geocoding fails; treat as unknown
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon) && lat > -89;
    const nogi = /no[\s-]?gi/i.test(raw.name);
    const format = nogi ? 'nogi' : (raw.promotion === 'IBJJF' || raw.promotion === 'AJP') ? 'gi' : 'both';
    const kids = /\b(kids?|youth|juvenile|teens?)\b/i.test(raw.name);
    const promo = raw.promotion || 'Other';
    return {
      id: 'e' + hash(`${promo}|${raw.date}|${raw.name}`),
      promotion: promo,
      date: raw.date,
      name, location,
      lat: hasCoords ? lat : null,
      lon: hasCoords ? lon : null,
      link: safeURL(raw.link),
      format, kids,
      search: `${name} ${location} ${stateName(location)} ${promo} ${PROMOS[promo]?.full || ''} ${format === 'nogi' ? 'no-gi nogi' : 'gi'} ${kids ? 'kids youth' : ''}`.toLowerCase(),
    };
  }

  const styleVars = (e) => {
    const p = e.mine ? MINE_STYLE : (PROMOS[e.promotion] || { color: 'var(--muted)' });
    return `--c:${p.color};`;
  };
  const promoMark = (p) => (PROMOS[p]?.logo
    ? `<img class="promo-logo" src="${escHTML(PROMOS[p].logo)}" alt="" width="20" height="20">`
    : '<span class="swatch" aria-hidden="true"></span>');
  const formatLabel = (e) => ({ gi: 'Gi', nogi: 'No-Gi', both: 'Gi & No-Gi' }[e.format] || '');

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let EVENTS = [];
  let PROMO_LIST = [];
  const DEFAULTS = () => ({ q: '', promos: new Set(PROMO_LIST), format: '', kids: false, from: '', to: '', past: false, radius: '', sort: 'date' });
  let state = { q: '', promos: new Set(), format: '', kids: false, from: '', to: '', past: false, radius: '', sort: 'date' };
  let route = 'events';
  let origin = store.get('jjb.origin', null); // { lat, lon, label }
  let saved = new Set(store.get('jjb.saved', []));
  let custom = store.get('jjb.custom', []);   // [{ id, name, date, end, location, link, notes }]
  let calMonth = null;   // Date (first of month)
  let calSelected = null; // ISO day

  const persistMine = () => { store.set('jjb.saved', [...saved]); store.set('jjb.custom', custom); };

  // URL <-> state, so filtered views can be shared as links
  function readURL() {
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    route = ['events', 'map', 'calendar'].includes(path) ? path : 'events';
    const p = new URLSearchParams(qs || '');
    const s = DEFAULTS();
    s.q = p.get('q') || '';
    if (p.has('p')) s.promos = new Set(p.get('p').split(',').filter((x) => PROMO_LIST.includes(x)));
    s.format = ['gi', 'nogi'].includes(p.get('f')) ? p.get('f') : '';
    s.kids = p.get('k') === '1';
    s.from = /^\d{4}-\d{2}-\d{2}$/.test(p.get('from') || '') ? p.get('from') : '';
    s.to = /^\d{4}-\d{2}-\d{2}$/.test(p.get('to') || '') ? p.get('to') : '';
    s.past = p.get('past') === '1';
    s.radius = p.get('r') || '';
    s.sort = ['date', 'distance', 'name', 'promotion'].includes(p.get('s')) ? p.get('s') : 'date';
    state = s;
  }
  function writeURL() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.promos.size !== PROMO_LIST.length) p.set('p', [...state.promos].join(','));
    if (state.format) p.set('f', state.format);
    if (state.kids) p.set('k', '1');
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (state.past) p.set('past', '1');
    if (state.radius) p.set('r', state.radius);
    if (state.sort !== 'date') p.set('s', state.sort);
    const qs = p.toString();
    history.replaceState(null, '', `#/${route}${qs ? '?' + qs : ''}`);
    // keep nav links carrying the same filters
    $$('.tabs a').forEach((a) => { a.href = `#/${a.dataset.route}${qs ? '?' + qs : ''}`; });
  }

  // ---------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------
  function filterEvents({ ignorePast = false } = {}) {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const today = todayISO();
    const radius = parseFloat(state.radius);
    const out = [];
    for (const e of EVENTS) {
      if (!state.promos.has(e.promotion)) continue;
      if (state.format && e.format !== state.format && e.format !== 'both') continue;
      if (state.kids && !e.kids) continue;
      if (state.from && e.date < state.from) continue;
      if (state.to && e.date > state.to) continue;
      if (!ignorePast && !state.past && !state.from && e.date < today) continue;
      if (words.length && !words.every((w) => e.search.includes(w))) continue;
      e.dist = origin && e.lat != null ? milesBetween(origin, e) : null;
      if (origin && radius && (e.dist == null || e.dist > radius)) continue;
      out.push(e);
    }
    const byDate = (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name);
    const sorters = {
      date: byDate,
      name: (a, b) => a.name.localeCompare(b.name),
      promotion: (a, b) => a.promotion.localeCompare(b.promotion) || byDate(a, b),
      distance: (a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity) || byDate(a, b),
    };
    return out.sort(sorters[state.sort] || byDate);
  }

  function activeFilterCount() {
    let n = 0;
    if (state.promos.size !== PROMO_LIST.length) n++;
    if (state.format) n++;
    if (state.kids) n++;
    if (state.from || state.to) n++;
    if (state.past) n++;
    if (origin && state.radius) n++;
    return n;
  }

  // ---------------------------------------------------------------
  // Rendering: shared pieces
  // ---------------------------------------------------------------
  function dateTile(iso) {
    const d = parseDay(iso);
    return `<div class="date-tile" aria-hidden="true"><span class="mon">${fmt.mon.format(d)}</span><span class="day">${d.getDate()}</span><span class="dow">${fmt.dow.format(d)}</span></div>`;
  }

  function eventRow(e, { compact = false } = {}) {
    const d = parseDay(e.date);
    const past = e.date < todayISO() && !(e.end && e.end >= todayISO());
    const meta = [];
    meta.push(`<span class="promo">${escHTML(e.mine ? 'My event' : e.promotion)}</span>`);
    meta.push(`<span>${escHTML(e.location || 'Location to be announced')}</span>`);
    if (e.dist != null && origin) meta.push(`<span>${Math.round(e.dist).toLocaleString()} mi away</span>`);
    if (!compact && !e.mine) {
      meta.push(`<span class="tag">${formatLabel(e)}</span>`);
      if (e.kids) meta.push('<span class="tag">Kids</span>');
    }
    const nameHTML = e.link ? `<a href="${escHTML(e.link)}" target="_blank" rel="noopener">${escHTML(e.name)}</a>` : escHTML(e.name);
    const isSaved = saved.has(e.id);
    const actions = compact ? '' : `
      <div class="event-actions">
        ${e.link ? `<a class="btn btn-primary" href="${escHTML(e.link)}" target="_blank" rel="noopener">${e.mine ? 'Open link' : 'Register'}</a>` : ''}
        <details class="menu">
          <summary class="icon-btn" aria-label="Add ${escHTML(e.name)} to your calendar" title="Add to calendar">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm12 8H5v9h14zM11 12h2v2h2v2h-2v2h-2v-2H9v-2h2z"/></svg>
          </summary>
          <div class="menu-pop">
            <a href="${googleCalURL(e)}" target="_blank" rel="noopener">Add to Google Calendar</a>
            <button type="button" data-ics="${e.id}">Download for Apple or Outlook (.ics)</button>
          </div>
        </details>
        ${e.mine
          ? `<button class="icon-btn" type="button" data-remove="${e.id}" aria-label="Delete ${escHTML(e.name)}" title="Delete">
               <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z"/></svg></button>`
          : `<button class="icon-btn star" type="button" data-star="${e.id}" aria-pressed="${isSaved}" aria-label="${isSaved ? 'Remove from' : 'Save to'} my calendar" title="${isSaved ? 'Saved to my calendar' : 'Save to my calendar'}">
               <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg></button>`}
      </div>`;
    return `
      <article class="event${past ? ' past' : ''}" style="${styleVars(e)}" data-id="${e.id}">
        ${dateTile(e.date)}
        <div class="event-body">
          <h3 class="event-name">${nameHTML}</h3>
          <div class="event-meta"><span class="sr-only">${fmt.long.format(d)}.</span>${meta.join('')}</div>
        </div>
        ${actions}
      </article>`;
  }

  function emptyState(title, body) {
    return `<div class="empty"><h3>${title}</h3><p>${body}</p><button class="btn btn-outline" type="button" data-clear>Clear all filters</button></div>`;
  }
  function noResultsCopy() {
    if (origin && state.radius) return ['No tournaments in that radius', `Nothing matches within ${state.radius} miles of ${escHTML(origin.label)}. Try a wider radius or clear the filters.`];
    if (state.q) return ['No tournaments match that search', 'Check the spelling, or search for a city, state, country or promotion instead.'];
    return ['No tournaments match these filters', 'Loosen a filter or clear them to see everything.'];
  }

  function fillAds(root = document) {
    $$('.ad', root).forEach((el) => {
      if (el.dataset.filled) return;
      el.dataset.filled = '1';
      if (typeof window.JJB_renderAd === 'function') { window.JJB_renderAd(el, el.dataset.ad); return; }
      if (SHOW_AD_PLACEHOLDERS) {
        el.classList.add('placeholder');
        el.textContent = `Ad space, ${AD_SIZES[el.dataset.ad] || AD_SIZES.default}`;
      }
    });
  }

  // ---------------------------------------------------------------
  // Events view
  // ---------------------------------------------------------------
  function renderEvents() {
    const list = filterEvents();
    const upcomingOnly = !state.past && !state.from;
    $('#eventsCount').innerHTML = `<strong>${list.length}</strong> ${upcomingOnly ? 'upcoming ' : ''}tournament${list.length === 1 ? '' : 's'}${activeFilterCount() || state.q ? ' match' + (list.length === 1 ? 'es' : '') + ' your filters' : ''}`;
    $('#sort').value = state.sort;
    const distOpt = $('#sort option[value="distance"]');
    distOpt.disabled = !origin;
    distOpt.textContent = origin ? 'Distance' : 'Distance (set a location first)';

    if (!list.length) {
      const [t, b] = noResultsCopy();
      $('#eventList').innerHTML = emptyState(t, b);
    } else {
      let html = '', lastMonth = '', count = 0;
      const groupByMonth = state.sort === 'date';
      const monthCounts = {};
      if (groupByMonth) list.forEach((e) => { const k = e.date.slice(0, 7); monthCounts[k] = (monthCounts[k] || 0) + 1; });
      for (const e of list) {
        const m = e.date.slice(0, 7);
        if (groupByMonth && m !== lastMonth) {
          lastMonth = m;
          const n = monthCounts[m];
          html += `<h2 class="month-head">${fmt.monthYear.format(parseDay(m + '-01'))} <span>${n} event${n === 1 ? '' : 's'}</span></h2>`;
        }
        html += eventRow(e);
        count++;
        if (count % INFEED_AD_EVERY === 0 && count < list.length) html += '<div class="ad ad-infeed" data-ad="infeed" aria-label="Advertisement"></div>';
      }
      $('#eventList').innerHTML = html;
    }

    // legend with counts in the current results
    const counts = {};
    list.forEach((e) => { counts[e.promotion] = (counts[e.promotion] || 0) + 1; });
    $('#legend').innerHTML = PROMO_LIST.map((p) => `
      <li style="${styleVars({ promotion: p })}">${promoMark(p)}
        <span><strong>${escHTML(p)}</strong><br><span class="muted small">${escHTML(PROMOS[p]?.full || '')}</span></span>
        <span class="n">${counts[p] || 0}</span></li>`).join('');
    fillAds($('#eventList'));
  }

  // ---------------------------------------------------------------
  // Map view (Leaflet, loaded lazily the first time the view opens)
  // ---------------------------------------------------------------
  let map, tiles, cluster, originLayer, markersById = new Map(), mapNeedsFit = true;

  // OpenStreetMap's own tiles: no API key needed, just the attribution below.
  // Dark mode is done by inverting the tiles in styles.css.
  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  function initMap() {
    if (map || !window.L) return;
    map = L.map('map', { worldCopyJump: true, zoomControl: true }).setView([30, -40], 2);
    tiles = L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    cluster = L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 45,
      iconCreateFunction: (c) => {
        const n = c.getChildCount(), size = n < 10 ? 34 : n < 50 ? 42 : 50;
        return L.divIcon({ html: `<div class="cluster" style="width:${size}px;height:${size}px">${n}</div>`, className: '', iconSize: [size, size] });
      },
    }).addTo(map);
    originLayer = L.layerGroup().addTo(map);
    map.on('moveend', renderMapList);
  }

  function renderMap() {
    if (!window.L) {
      $('#map').innerHTML = '<div class="empty" style="margin:1rem">The map library didn\'t load. Check your connection and reload the page.</div>';
      renderMapList();
      return;
    }
    initMap();
    map.invalidateSize();
    const list = filterEvents();
    cluster.clearLayers(); markersById.clear();
    const pts = [];
    for (const e of list) {
      if (e.lat == null) continue;
      const m = L.marker([e.lat, e.lon], {
        icon: L.divIcon({ className: '', html: `<div class="pin" style="${styleVars(e)}"></div>`, iconSize: [16, 16] }),
        title: e.name, keyboard: true,
      });
      m.bindPopup(`<div class="popup"><h3>${escHTML(e.name)}</h3><p>${fmt.short.format(parseDay(e.date))}<br>${escHTML(e.location)}</p>${e.link ? `<a class="btn btn-primary" href="${escHTML(e.link)}" target="_blank" rel="noopener">Register</a>` : ''}</div>`);
      m.on('click', () => highlightMapRow(e.id));
      markersById.set(e.id, m);
      cluster.addLayer(m);
      pts.push([e.lat, e.lon]);
    }
    originLayer.clearLayers();
    if (origin) {
      L.circleMarker([origin.lat, origin.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#c0272d', fillOpacity: 1 })
        .bindTooltip(`You: ${escHTML(origin.label)}`).addTo(originLayer);
      if (state.radius) L.circle([origin.lat, origin.lon], { radius: parseFloat(state.radius) * 1609.34, color: '#c0272d', weight: 1.5, fillOpacity: 0.04 }).addTo(originLayer);
    }
    if (mapNeedsFit) {
      mapNeedsFit = false;
      if (origin && state.radius) map.fitBounds(L.latLng(origin.lat, origin.lon).toBounds(parseFloat(state.radius) * 1609.34 * 2), { padding: [20, 20] });
      else if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 9 });
    }
    renderMapList();
  }

  function renderMapList() {
    const all = filterEvents();
    const boundsOnly = $('#boundsOnly').checked && map;
    const bounds = map ? map.getBounds() : null;
    const list = boundsOnly ? all.filter((e) => e.lat != null && bounds.contains([e.lat, e.lon])) : all;
    const missing = all.filter((e) => e.lat == null).length;
    $('#mapCount').innerHTML = `<strong>${list.length}</strong> ${boundsOnly ? 'in this area' : 'matching'}`;
    if (!list.length) {
      $('#mapList').innerHTML = boundsOnly && all.length
        ? `<div class="empty"><h3>Nothing in this area</h3><p>Zoom out or drag the map to find more. ${all.length} matching tournaments are elsewhere.</p><button class="btn btn-outline" type="button" data-fit>Show all on map</button></div>`
        : emptyState(...noResultsCopy());
    } else {
      $('#mapList').innerHTML = list.map((e) => eventRow(e, { compact: true })).join('');
    }
    $('#mapMissing').textContent = boundsOnly && missing
      ? `${missing} matching event${missing === 1 ? ' has' : 's have'} no map location yet. You'll find ${missing === 1 ? 'it' : 'them'} on the Events list.`
      : '';
  }

  function highlightMapRow(id) {
    $$('#mapList .event.active').forEach((el) => el.classList.remove('active'));
    const row = $(`#mapList .event[data-id="${id}"]`);
    if (row) { row.classList.add('active'); row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  // ---------------------------------------------------------------
  // Calendar view
  // ---------------------------------------------------------------
  function customAsEvents() {
    return custom.map((c) => ({ ...c, mine: true, promotion: 'Mine', format: '', kids: false, lat: null, lon: null, dist: null }));
  }
  function myItems() {
    const savedEvents = EVENTS.filter((e) => saved.has(e.id));
    return [...savedEvents, ...customAsEvents()].sort((a, b) => a.date.localeCompare(b.date));
  }
  function calendarItems() {
    const mineOnly = $('#calMineOnly').checked;
    const base = mineOnly ? EVENTS.filter((e) => saved.has(e.id)) : filterEvents({ ignorePast: true });
    return [...base, ...customAsEvents()];
  }
  function itemsByDay(items) {
    const map = {};
    for (const e of items) {
      const start = parseDay(e.date);
      const end = e.end && e.end > e.date ? parseDay(e.end) : start;
      for (let d = start, i = 0; d <= end && i < 31; d = addDays(d, 1), i++) (map[toISO(d)] ||= []).push(e);
    }
    return map;
  }

  function renderCalendar() {
    if (!calMonth) {
      const t = new Date(); calMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    }
    $('#calTitle').textContent = fmt.monthYear.format(calMonth);
    const byDay = itemsByDay(calendarItems());
    const first = calMonth;
    const start = addDays(first, -((first.getDay() + 6) % 7)); // Monday start
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const end = addDays(last, (7 - ((last.getDay() + 6) % 7) - 1));
    const today = todayISO();
    let html = '';
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const iso = toISO(d);
      const items = (byDay[iso] || []).slice().sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (saved.has(b.id) ? 1 : 0) - (saved.has(a.id) ? 1 : 0));
      const out = d.getMonth() !== first.getMonth();
      const chips = items.slice(0, 3).map((e) => `<span class="cal-chip${e.mine || saved.has(e.id) ? ' mine' : ''}" style="${styleVars(e)}">${escHTML(e.name)}</span>`).join('');
      const more = items.length > 3 ? `<span class="cal-more">${items.length - 3} more</span>` : '';
      const dots = items.slice(0, 6).map((e) => `<i style="${styleVars(e)}"></i>`).join('');
      html += `<button type="button" role="gridcell" class="cal-cell${out ? ' out' : ''}${iso === today ? ' today' : ''}${iso === calSelected ? ' selected' : ''}" data-day="${iso}"
                 aria-label="${fmt.long.format(d)}, ${items.length ? items.length + ' event' + (items.length === 1 ? '' : 's') : 'no events'}">
                 <span class="cal-num">${d.getDate()}</span>${chips}${more}<span class="cal-dots">${dots}</span></button>`;
    }
    $('#calGrid').innerHTML = html;
    renderDayDetail(byDay);
    renderMine();
  }

  function renderDayDetail(byDay) {
    const el = $('#dayDetail');
    if (!calSelected) { el.innerHTML = '<p class="muted">Select a day to see its events.</p>'; return; }
    byDay ||= itemsByDay(calendarItems());
    const items = byDay[calSelected] || [];
    const label = fmt.long.format(parseDay(calSelected));
    el.innerHTML = `<h3>${label}</h3>` + (items.length
      ? `<div class="event-list">${items.map((e) => eventRow(e)).join('')}</div>`
      : `<p class="muted">Nothing on this day. <button class="linkish" type="button" data-add-on="${calSelected}">Add an event</button></p>`);
  }

  function renderMine() {
    const items = myItems();
    $('#mineList').innerHTML = items.length
      ? items.map((e) => `<li><span><button class="linkish" type="button" data-goto="${e.date}" style="color:inherit;text-decoration:none;text-align:left">${escHTML(e.name)}</button><span class="d">${fmt.short.format(parseDay(e.date))}${e.mine ? ', added by you' : ''}</span></span>
          <button type="button" ${e.mine ? `data-remove="${e.id}"` : `data-star="${e.id}"`} aria-label="Remove ${escHTML(e.name)}" title="Remove">✕</button></li>`).join('')
      : '<li class="muted small" style="display:block">Nothing saved yet. Tap the star on any event to add it.</li>';
  }

  // ---------------------------------------------------------------
  // Calendar export (.ics) and Google Calendar links
  // ---------------------------------------------------------------
  const icsDate = (iso) => iso.replace(/-/g, '');
  const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) { // RFC 5545: lines ≤ 75 octets
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const parts = []; let cur = '';
    for (const ch of line) {
      if (enc.encode(cur + ch).length > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; }
      cur += ch;
    }
    parts.push(cur);
    return parts.join('\r\n ');
  }
  function buildICS(items, calName) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//jiujitsu.bot//Tournament calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(calName)}`];
    for (const e of items) {
      const endExclusive = toISO(addDays(parseDay(e.end && e.end > e.date ? e.end : e.date), 1));
      const desc = [e.mine ? '' : `${e.promotion}${PROMOS[e.promotion] ? ' (' + PROMOS[e.promotion].full + ')' : ''}`, e.notes || '', e.link ? `Details and registration: ${e.link}` : '', e.mine ? '' : 'Listed on jiujitsu.bot. Confirm dates with the promotion.'].filter(Boolean).join('\n');
      L.push('BEGIN:VEVENT', `UID:${e.id}@jiujitsu.bot`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${icsDate(endExclusive)}`,
        `SUMMARY:${icsEsc(e.name)}`);
      if (e.location) L.push(`LOCATION:${icsEsc(e.location)}`);
      if (e.link) L.push(`URL:${e.link}`);
      if (desc) L.push(`DESCRIPTION:${icsEsc(desc)}`);
      L.push('TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportICS(kind) {
    let items, name, file;
    if (kind === 'mine') { items = myItems(); name = 'My jiu-jitsu calendar'; file = 'my-jiu-jitsu-calendar.ics'; }
    else if (kind === 'month') {
      const m = toISO(calMonth).slice(0, 7);
      items = calendarItems().filter((e) => e.date.slice(0, 7) === m || (e.end && e.end.slice(0, 7) >= m && e.date.slice(0, 7) <= m));
      name = `Jiu-jitsu tournaments, ${fmt.monthYear.format(calMonth)}`; file = `jiu-jitsu-${m}.ics`;
    } else { items = filterEvents(); name = 'Jiu-jitsu tournaments'; file = 'jiu-jitsu-tournaments.ics'; }
    if (!items.length) { toast(kind === 'mine' ? 'Your calendar is empty. Star events or add your own first.' : 'No events to export with these filters.'); return; }
    download(file, buildICS(items, name));
    toast(`Exported ${items.length} event${items.length === 1 ? '' : 's'}`);
  }
  function googleCalURL(e) {
    const end = toISO(addDays(parseDay(e.end && e.end > e.date ? e.end : e.date), 1));
    const p = new URLSearchParams({ action: 'TEMPLATE', text: e.name, dates: `${icsDate(e.date)}/${icsDate(end)}`, location: e.location || '', details: e.link ? `Details and registration: ${e.link}` : '' });
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  }

  // ---------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------
  function syncControls() {
    $('#q').value = state.q;
    $$('#promoChips .chip').forEach((c) => c.setAttribute('aria-pressed', state.promos.has(c.dataset.promo)));
    $$('#formatSeg input').forEach((i) => { i.checked = i.value === state.format; });
    $('#kidsOnly').checked = state.kids;
    $('#from').value = state.from; $('#to').value = state.to;
    $('#showPast').checked = state.past;
    $('#radius').value = state.radius;
    $('#radius').disabled = !origin;
    $('#nearStatus').innerHTML = origin
      ? `Near <strong>${escHTML(origin.label)}</strong>. <button class="linkish" type="button" id="clearOrigin">Clear</button>`
      : 'Set a location to sort and filter by distance.';
    const n = activeFilterCount();
    $('#filterCount').hidden = !n; $('#filterCount').textContent = n;
    renderActivePills();
    const shown = route === 'calendar' ? filterEvents({ ignorePast: true }).length : filterEvents().length;
    $('#closeFilters').textContent = `Show ${shown} result${shown === 1 ? '' : 's'}`;
  }

  function renderActivePills() {
    const x = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9z"/></svg>';
    const pills = [];
    const add = (key, label) => pills.push(`<button type="button" class="pill" data-unset="${key}" aria-label="Remove filter: ${escHTML(label)}">${escHTML(label)}${x}</button>`);
    if (state.promos.size !== PROMO_LIST.length) add('promos', [...state.promos].sort().join(', '));
    if (state.format) add('format', state.format === 'nogi' ? 'No-Gi' : 'Gi');
    if (state.kids) add('kids', 'Kids & youth');
    if (state.from || state.to) {
      const f = (iso) => fmt.short.format(parseDay(iso));
      add('dates', state.from && state.to ? `${f(state.from)} to ${f(state.to)}` : state.from ? `From ${f(state.from)}` : `Until ${f(state.to)}`);
    }
    if (state.past) add('past', 'Including past events');
    if (origin) add('origin', state.radius ? `Within ${state.radius} mi of ${origin.label}` : `Near ${origin.label}`);
    if (pills.length > 1) pills.push('<button type="button" class="pill-clear" data-clear>Clear all</button>');
    $('#activeFilters').innerHTML = pills.join('');
  }

  function render() {
    writeURL();
    syncControls();
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== route; });
    $$('.tabs a').forEach((a) => { if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (route === 'events') renderEvents();
    if (route === 'map') renderMap();
    if (route === 'calendar') renderCalendar();
    fillAds();
  }

  function update(changes, { refit = true } = {}) {
    Object.assign(state, changes);
    if (refit) mapNeedsFit = true;
    render();
  }

  function setOrigin(o) {
    origin = o;
    if (o) store.set('jjb.origin', o); else store.del('jjb.origin');
    const changes = {};
    if (o && state.sort === 'date' && route === 'events') changes.sort = 'distance';
    if (!o) { changes.radius = ''; if (state.sort === 'distance') changes.sort = 'date'; }
    update(changes);
  }

  function bindControls() {
    // shorter search hint on phones so it isn't cut off
    const narrow = matchMedia('(max-width: 520px)');
    const setHint = () => { $('#q').placeholder = narrow.matches ? 'Search tournaments' : 'Search by name, city, state, country or venue'; };
    setHint(); narrow.addEventListener('change', setHint);

    // promotions
    $('#promoChips').innerHTML = PROMO_LIST.map((p) => `
      <button type="button" class="chip" data-promo="${escHTML(p)}" aria-pressed="true" style="${styleVars({ promotion: p })}" title="${escHTML(PROMOS[p]?.full || p)}">
        ${promoMark(p)}${escHTML(p)}</button>`).join('');
    $('#promoChips').addEventListener('click', (ev) => {
      const c = ev.target.closest('.chip'); if (!c) return;
      const promos = new Set(state.promos);
      // if everything is on, a click means "just this one"
      if (promos.size === PROMO_LIST.length) { promos.clear(); promos.add(c.dataset.promo); }
      else if (promos.has(c.dataset.promo)) { promos.delete(c.dataset.promo); if (!promos.size) PROMO_LIST.forEach((p) => promos.add(p)); }
      else promos.add(c.dataset.promo);
      update({ promos });
    });

    let qTimer;
    $('#q').addEventListener('input', (ev) => { clearTimeout(qTimer); qTimer = setTimeout(() => update({ q: ev.target.value.trim() }), 180); });
    $('#formatSeg').addEventListener('change', (ev) => update({ format: ev.target.value }));
    $('#kidsOnly').addEventListener('change', (ev) => update({ kids: ev.target.checked }));
    $('#from').addEventListener('change', (ev) => update({ from: ev.target.value }));
    $('#to').addEventListener('change', (ev) => update({ to: ev.target.value }));
    $('#showPast').addEventListener('change', (ev) => update({ past: ev.target.checked }));
    $('#radius').addEventListener('change', (ev) => update({ radius: ev.target.value }));
    $('#sort').addEventListener('change', (ev) => update({ sort: ev.target.value }, { refit: false }));
    $('#clearFilters').addEventListener('click', () => { state = DEFAULTS(); mapNeedsFit = true; render(); });

    const setPanel = (open) => {
      $('#filterPanel').classList.toggle('open', open);
      $('#filtersToggle').setAttribute('aria-expanded', open);
    };
    $('#filtersToggle').addEventListener('click', () => setPanel(!$('#filterPanel').classList.contains('open')));
    $('#closeFilters').addEventListener('click', () => { setPanel(false); $('#main').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('#filterPanel').classList.contains('open')) { setPanel(false); $('#filtersToggle').focus(); } });

    $('#useLocation').addEventListener('click', () => {
      if (!navigator.geolocation) { $('#nearStatus').textContent = "This browser can't share its location. Type a city instead."; return; }
      $('#nearStatus').textContent = 'Finding your location…';
      navigator.geolocation.getCurrentPosition(
        (pos) => setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'your location' }),
        () => { $('#nearStatus').textContent = 'Location access was blocked. Type a city or postal code instead.'; },
        { timeout: 10000, maximumAge: 600000 },
      );
    });
    $('#nearForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const q = $('#nearInput').value.trim(); if (!q) return;
      $('#nearStatus').textContent = `Looking up ${q}…`;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
        const [hit] = await r.json();
        if (!hit) { $('#nearStatus').textContent = `Couldn't find "${q}". Try adding a state or country.`; return; }
        const label = hit.display_name.split(',').slice(0, 2).join(',').trim();
        $('#nearInput').value = '';
        setOrigin({ lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), label });
      } catch {
        $('#nearStatus').textContent = 'Location lookup is unavailable right now. Try "Use my location".';
      }
    });

    // Delegated clicks across the page
    document.addEventListener('click', (ev) => {
      const t = ev.target;
      // close any open popover menus when clicking elsewhere
      $$('details.menu[open]').forEach((d) => { if (!d.contains(t)) d.open = false; });

      const clearBtn = t.closest('[data-clear]');
      if (clearBtn) { state = DEFAULTS(); mapNeedsFit = true; render(); return; }
      if (t.closest('#clearOrigin')) { setOrigin(null); return; }
      const unset = t.closest('[data-unset]');
      if (unset) {
        const k = unset.dataset.unset;
        if (k === 'origin') { setOrigin(null); return; }
        const d = DEFAULTS();
        update(k === 'dates' ? { from: '', to: '' } : { [k]: d[k] });
        return;
      }
      if (t.closest('[data-fit]')) { mapNeedsFit = true; renderMap(); return; }

      const star = t.closest('[data-star]');
      if (star) {
        const id = star.dataset.star;
        if (saved.has(id)) { saved.delete(id); toast('Removed from my calendar'); } else { saved.add(id); toast('Saved to my calendar'); }
        persistMine(); render(); return;
      }
      const rm = t.closest('[data-remove]');
      if (rm) {
        const c = custom.find((x) => x.id === rm.dataset.remove);
        if (c && confirm(`Delete "${c.name}" from your calendar?`)) { custom = custom.filter((x) => x.id !== c.id); persistMine(); render(); toast('Event deleted'); }
        return;
      }
      const icsBtn = t.closest('[data-ics]');
      if (icsBtn) {
        const e = EVENTS.find((x) => x.id === icsBtn.dataset.ics) || customAsEvents().find((x) => x.id === icsBtn.dataset.ics);
        if (e) download(`${e.name.replace(/[^\w-]+/g, '-').slice(0, 60)}.ics`, buildICS([e], e.name));
        icsBtn.closest('details').open = false; return;
      }
      const exp = t.closest('[data-export]');
      if (exp) { exportICS(exp.dataset.export); exp.closest('details').open = false; return; }

      // map list → marker
      const mapRow = t.closest('#mapList .event');
      if (mapRow && !t.closest('a,button')) {
        const m = markersById.get(mapRow.dataset.id);
        if (m) cluster.zoomToShowLayer(m, () => m.openPopup());
        highlightMapRow(mapRow.dataset.id); return;
      }
      // calendar
      const cell = t.closest('.cal-cell');
      if (cell) { calSelected = cell.dataset.day; const d = parseDay(calSelected); if (d.getMonth() !== calMonth.getMonth()) calMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar(); return; }
      const go = t.closest('[data-goto]');
      if (go) { const d = parseDay(go.dataset.goto); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); calSelected = go.dataset.goto; renderCalendar(); $('#dayDetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const addOn = t.closest('[data-add-on]');
      if (addOn) { openAdd(addOn.dataset.addOn); }
    });

    $('#boundsOnly').addEventListener('change', renderMapList);
    $('#calPrev').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); });
    $('#calNext').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); });
    $('#calToday').addEventListener('click', () => { const t = new Date(); calMonth = new Date(t.getFullYear(), t.getMonth(), 1); calSelected = todayISO(); renderCalendar(); });
    $('#calMineOnly').addEventListener('change', renderCalendar);
    $('#openAdd').addEventListener('click', () => openAdd(calSelected || todayISO()));

    const dlg = $('#addDialog');
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'save') { $('#addForm').reset(); return; }
      const f = new FormData($('#addForm'));
      const date = f.get('date');
      let end = f.get('end') || '';
      if (end && end < date) end = '';
      const ev = {
        id: 'c' + Date.now().toString(36),
        name: String(f.get('name')).trim(), date, end,
        location: String(f.get('location') || '').trim(),
        link: safeURL(String(f.get('link') || '').trim()),
        notes: String(f.get('notes') || '').trim(),
      };
      custom.push(ev); persistMine();
      $('#addForm').reset();
      const d = parseDay(date); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); calSelected = date;
      renderCalendar(); toast('Event saved to my calendar');
    });

    $('#themeToggle').addEventListener('click', () => {
      const root = document.documentElement;
      const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      root.dataset.theme = current === 'dark' ? 'light' : 'dark';
      store.set('jjb.theme', root.dataset.theme);
    });

    window.addEventListener('hashchange', () => { readURL(); mapNeedsFit = true; render(); });
  }

  function openAdd(date) {
    const form = $('#addForm');
    form.reset();
    form.elements.date.value = date || todayISO();
    $('#addDialog').showModal();
    form.elements.name.focus();
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  const savedTheme = store.get('jjb.theme', null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  $('#eventList').innerHTML = '<p class="muted">Loading tournaments…</p>';

  const inline = window.JJB_EVENTS; // optional: data embedded by a build step
  (inline ? Promise.resolve(inline) : fetch(DATA_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }))
    .then((raw) => {
      EVENTS = raw.filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '')).map(normalize);
      // de-duplicate identical rows the scraper sometimes produces
      const seen = new Set();
      EVENTS = EVENTS.filter((e) => (seen.has(e.id) ? false : seen.add(e.id)));
      // alphabetical, so list order never implies a ranking
      PROMO_LIST = [...new Set(EVENTS.map((e) => e.promotion))].sort((a, b) => a.localeCompare(b));
      readURL();
      bindControls();
      render();
    })
    .catch(() => {
      $$('.view').forEach((v) => { v.hidden = v.dataset.view !== 'events'; });
      $('#eventList').innerHTML = `<div class="empty"><h3>The tournament list didn't load</h3>
        <p>Make sure <code>event_listings.json</code> sits next to this page. If you opened the file straight from your computer, browsers block that; run <code>python -m http.server</code> in this folder and visit http://localhost:8000 instead.</p></div>`;
    });
})();

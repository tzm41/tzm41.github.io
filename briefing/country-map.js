/**
 * Country Hover Map Tooltip — Zero-dependency TopoJSON continent renderer.
 * Lazy-loads world-atlas@2/countries-110m.json once on first hover.
 */

const ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const CONTINENT_META = {
  na: { label: "North America", bounds: [-168, -52, 7, 73] },
  sa: { label: "South America", bounds: [-84, -33, -57, 14] },
  eu: { label: "Europe", bounds: [-25, 45, 34, 72] },
  eurasia: { label: "Europe & Asia", bounds: [-10, 179, 34, 78] },
  af: { label: "Africa", bounds: [-20, 53, -36, 38] },
  as: { label: "Asia", bounds: [25, 150, -11, 56] },
  oc: { label: "Oceania", bounds: [110, 180, -48, 2] },
  world: { label: "Global", bounds: [-175, 178, -58, 78] },
};

const EU_ISO_IDS = [
  "040", "056", "100", "191", "196", "203", "208", "233", "246",
  "250", "276", "300", "348", "372", "380", "428", "440", "442",
  "470", "528", "616", "620", "642", "703", "705", "724", "752",
];

export const COUNTRY_META = {
  us: { name: "United States", capital: "Washington, D.C.", continent: "na", iso: "840" },
  ca: { name: "Canada", capital: "Ottawa", continent: "na", iso: "124" },
  mx: { name: "Mexico", capital: "Mexico City", continent: "na", iso: "484" },
  cu: { name: "Cuba", capital: "Havana", continent: "na", iso: "192" },
  sv: { name: "El Salvador", capital: "San Salvador", continent: "na", iso: "222", dot: [-88.9, 13.7] },
  pa: { name: "Panama", capital: "Panama City", continent: "na", iso: "591", dot: [-79.5, 9.0] },
  ht: { name: "Haiti", capital: "Port-au-Prince", continent: "na", iso: "332", dot: [-72.3, 18.5] },
  br: { name: "Brazil", capital: "Brasília", continent: "sa", iso: "076" },
  ar: { name: "Argentina", capital: "Buenos Aires", continent: "sa", iso: "032" },
  ve: { name: "Venezuela", capital: "Caracas", continent: "sa", iso: "862" },
  co: { name: "Colombia", capital: "Bogotá", continent: "sa", iso: "170" },
  cl: { name: "Chile", capital: "Santiago", continent: "sa", iso: "152" },
  pe: { name: "Peru", capital: "Lima", continent: "sa", iso: "604" },
  gb: { name: "United Kingdom", capital: "London", continent: "eu", iso: "826" },
  fr: { name: "France", capital: "Paris", continent: "eu", iso: "250" },
  de: { name: "Germany", capital: "Berlin", continent: "eu", iso: "276" },
  it: { name: "Italy", capital: "Rome", continent: "eu", iso: "380" },
  es: { name: "Spain", capital: "Madrid", continent: "eu", iso: "724" },
  pl: { name: "Poland", capital: "Warsaw", continent: "eu", iso: "616" },
  nl: { name: "Netherlands", capital: "Amsterdam", continent: "eu", iso: "528" },
  ch: { name: "Switzerland", capital: "Bern", continent: "eu", iso: "756" },
  se: { name: "Sweden", capital: "Stockholm", continent: "eu", iso: "752" },
  no: { name: "Norway", capital: "Oslo", continent: "eu", iso: "578" },
  fi: { name: "Finland", capital: "Helsinki", continent: "eu", iso: "246" },
  gr: { name: "Greece", capital: "Athens", continent: "eu", iso: "300" },
  ie: { name: "Ireland", capital: "Dublin", continent: "eu", iso: "372" },
  be: { name: "Belgium", capital: "Brussels", continent: "eu", iso: "056" },
  at: { name: "Austria", capital: "Vienna", continent: "eu", iso: "040" },
  pt: { name: "Portugal", capital: "Lisbon", continent: "eu", iso: "620" },
  dk: { name: "Denmark", capital: "Copenhagen", continent: "eu", iso: "208" },
  ua: { name: "Ukraine", capital: "Kyiv", continent: "eu", iso: "804" },
  by: { name: "Belarus", capital: "Minsk", continent: "eu", iso: "112" },
  hu: { name: "Hungary", capital: "Budapest", continent: "eu", iso: "348" },
  ro: { name: "Romania", capital: "Bucharest", continent: "eu", iso: "642" },
  ee: { name: "Estonia", capital: "Tallinn", continent: "eu", iso: "233" },
  lv: { name: "Latvia", capital: "Riga", continent: "eu", iso: "428" },
  lt: { name: "Lithuania", capital: "Vilnius", continent: "eu", iso: "440" },
  eu: { name: "European Union", capital: "Brussels (de facto)", continent: "eu", iso: EU_ISO_IDS },
  ru: { name: "Russia", capital: "Moscow", continent: "eurasia", iso: "643" },
  cn: { name: "China", capital: "Beijing", continent: "as", iso: "156" },
  tw: { name: "Taiwan", capital: "Taipei", continent: "as", iso: "158", dot: [121.5, 25.0] },
  hk: { name: "Hong Kong", capital: "Hong Kong", continent: "as", iso: null, dot: [114.2, 22.3] },
  jp: { name: "Japan", capital: "Tokyo", continent: "as", iso: "392" },
  kr: { name: "South Korea", capital: "Seoul", continent: "as", iso: "410" },
  kp: { name: "North Korea", capital: "Pyongyang", continent: "as", iso: "408" },
  in: { name: "India", capital: "New Delhi", continent: "as", iso: "356" },
  pk: { name: "Pakistan", capital: "Islamabad", continent: "as", iso: "586" },
  af: { name: "Afghanistan", capital: "Kabul", continent: "as", iso: "004" },
  bd: { name: "Bangladesh", capital: "Dhaka", continent: "as", iso: "050" },
  vn: { name: "Vietnam", capital: "Hanoi", continent: "as", iso: "704" },
  ph: { name: "Philippines", capital: "Manila", continent: "as", iso: "608" },
  id: { name: "Indonesia", capital: "Jakarta", continent: "as", iso: "360" },
  th: { name: "Thailand", capital: "Bangkok", continent: "as", iso: "764" },
  my: { name: "Malaysia", capital: "Kuala Lumpur", continent: "as", iso: "458" },
  mm: { name: "Myanmar", capital: "Naypyidaw", continent: "as", iso: "104" },
  kh: { name: "Cambodia", capital: "Phnom Penh", continent: "as", iso: "116" },
  sg: { name: "Singapore", capital: "Singapore", continent: "as", iso: null, dot: [103.8, 1.35] },
  il: { name: "Israel", capital: "Jerusalem", continent: "as", iso: "376", dot: [35.2, 31.8] },
  ps: { name: "Palestine / Gaza", capital: "Ramallah / Gaza", continent: "as", iso: "275", dot: [34.5, 31.5] },
  ir: { name: "Iran", capital: "Tehran", continent: "as", iso: "364" },
  sa: { name: "Saudi Arabia", capital: "Riyadh", continent: "as", iso: "682" },
  ye: { name: "Yemen", capital: "Sanaa", continent: "as", iso: "887" },
  lb: { name: "Lebanon", capital: "Beirut", continent: "as", iso: "422", dot: [35.5, 33.9] },
  sy: { name: "Syria", capital: "Damascus", continent: "as", iso: "760" },
  iq: { name: "Iraq", capital: "Baghdad", continent: "as", iso: "368" },
  tr: { name: "Turkey", capital: "Ankara", continent: "as", iso: "792" },
  ae: { name: "United Arab Emirates", capital: "Abu Dhabi", continent: "as", iso: "784", dot: [54.4, 24.5] },
  qa: { name: "Qatar", capital: "Doha", continent: "as", iso: "634", dot: [51.5, 25.3] },
  jo: { name: "Jordan", capital: "Amman", continent: "as", iso: "400" },
  eg: { name: "Egypt", capital: "Cairo", continent: "af", iso: "818" },
  ly: { name: "Libya", capital: "Tripoli", continent: "af", iso: "434" },
  ma: { name: "Morocco", capital: "Rabat", continent: "af", iso: "504" },
  dz: { name: "Algeria", capital: "Algiers", continent: "af", iso: "012" },
  tn: { name: "Tunisia", capital: "Tunis", continent: "af", iso: "788" },
  za: { name: "South Africa", capital: "Pretoria", continent: "af", iso: "710" },
  ng: { name: "Nigeria", capital: "Abuja", continent: "af", iso: "566" },
  sd: { name: "Sudan", capital: "Khartoum", continent: "af", iso: "729" },
  ss: { name: "South Sudan", capital: "Juba", continent: "af", iso: "728" },
  et: { name: "Ethiopia", capital: "Addis Ababa", continent: "af", iso: "231" },
  ke: { name: "Kenya", capital: "Nairobi", continent: "af", iso: "404" },
  ml: { name: "Mali", capital: "Bamako", continent: "af", iso: "466" },
  ne: { name: "Niger", capital: "Niamey", continent: "af", iso: "562" },
  bf: { name: "Burkina Faso", capital: "Ouagadougou", continent: "af", iso: "854" },
  cd: { name: "DR Congo", capital: "Kinshasa", continent: "af", iso: "180" },
  so: { name: "Somalia", capital: "Mogadishu", continent: "af", iso: "706" },
  td: { name: "Chad", capital: "N'Djamena", continent: "af", iso: "148" },
  lr: { name: "Liberia", capital: "Monrovia", continent: "af", iso: "430" },
  au: { name: "Australia", capital: "Canberra", continent: "oc", iso: "036" },
  nz: { name: "New Zealand", capital: "Wellington", continent: "oc", iso: "554" },
  sb: { name: "Solomon Islands", capital: "Honiara", continent: "oc", iso: "090", dot: [160.0, -9.4] },
  un: { name: "United Nations", capital: "New York (HQ)", continent: "world", iso: null, dot: [-74.0, 40.7] },
};

let atlasPromise = null;
const svgCache = new Map();

function decodeTopoJson(topo) {
  const { scale, translate } = topo.transform;
  const decodedArcs = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });

  const stitchRing = (ring) => {
    const coords = [];
    for (const idx of ring) {
      const pts = idx >= 0 ? decodedArcs[idx] : [...decodedArcs[~idx]].reverse();
      for (let i = coords.length ? 1 : 0; i < pts.length; i++) {
        coords.push(pts[i]);
      }
    }
    return coords;
  };

  const features = [];
  for (const g of topo.objects.countries.geometries) {
    const id = String(g.id ?? "").padStart(3, "0");
    let rings = [];
    if (g.type === "Polygon") {
      rings = g.arcs.map(stitchRing);
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.arcs) {
        for (const r of poly) rings.push(stitchRing(r));
      }
    }
    if (!rings.length) continue;
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const r of rings) {
      for (const [lon, lat] of r) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    features.push({ id, rings, bbox: [minLon, maxLon, minLat, maxLat] });
  }
  return features;
}

function loadAtlas() {
  if (!atlasPromise) {
    atlasPromise = fetch(ATLAS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Atlas HTTP ${r.status}`);
        return r.json();
      })
      .then(decodeTopoJson);
  }
  return atlasPromise;
}

function buildContinentSvg(features, code) {
  const meta = COUNTRY_META[code];
  if (!meta) return "";
  const cont = CONTINENT_META[meta.continent] || CONTINENT_META.world;
  const [minLon, maxLon, minLat, maxLat] = cont.bounds;
  const w = 220;
  const h = 124;
  const pad = 6;

  const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const cosLat = Math.max(0.45, Math.cos(midLatRad));
  const spanX = (maxLon - minLon) * cosLat;
  const spanY = maxLat - minLat;
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const offsetX = (w - spanX * scale) / 2;
  const offsetY = (h - spanY * scale) / 2;

  const proj = (lon, lat) => [
    offsetX + (lon - minLon) * cosLat * scale,
    offsetY + (maxLat - lat) * scale,
  ];

  const ringToPath = (ring) => {
    let d = "";
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      // Skip antimeridian wrap artifacts
      if (i > 0 && Math.abs(lon - ring[i - 1][0]) > 180) {
        const [x, y] = proj(lon, lat);
        d += `M${x.toFixed(1)},${y.toFixed(1)}`;
        continue;
      }
      const [x, y] = proj(lon, lat);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    return d ? `${d}Z` : "";
  };

  const targetIds = new Set(
    Array.isArray(meta.iso) ? meta.iso : meta.iso ? [meta.iso] : []
  );

  let bgPaths = "";
  let fgPaths = "";
  for (const f of features) {
    const [bMinLon, bMaxLon, bMinLat, bMaxLat] = f.bbox;
    if (bMaxLon < minLon - 5 || bMinLon > maxLon + 5 || bMaxLat < minLat - 5 || bMinLat > maxLat + 5) {
      continue;
    }
    const isTarget = targetIds.has(f.id);
    let pathStr = "";
    for (const r of f.rings) {
      // Skip antimeridian-crossing Alaska/Chukotka rings outside view
      const p = ringToPath(r);
      if (p) pathStr += p;
    }
    if (!pathStr) continue;
    if (isTarget) {
      fgPaths += pathStr;
    } else {
      bgPaths += pathStr;
    }
  }

  let dotSvg = "";
  if (meta.dot) {
    const [cx, cy] = proj(meta.dot[0], meta.dot[1]);
    dotSvg = `<circle class="cmap-dot-ring" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5"/><circle class="cmap-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.8"/>`;
  }

  return `
    <svg class="cmap-svg" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <clipPath id="cmap-clip-${code}"><rect x="0" y="0" width="${w}" height="${h}" rx="4"/></clipPath>
      <g clip-path="url(#cmap-clip-${code})">
        <path class="cmap-land" d="${bgPaths}"/>
        ${fgPaths ? `<path class="cmap-target" d="${fgPaths}"/>` : ""}
        ${dotSvg}
      </g>
    </svg>
  `;
}

export function initCountryMapTooltip(escapeHtml, renderFlagImg) {
  const card = document.createElement("div");
  card.className = "country-map-tip hidden";
  card.setAttribute("role", "tooltip");
  document.body.appendChild(card);

  let activeEl = null;
  let hideTimer = null;

  const hide = () => {
    card.classList.add("hidden");
    activeEl = null;
  };

  const positionCard = (el) => {
    const rect = el.getBoundingClientRect();
    const tipRect = card.getBoundingClientRect();
    const pad = 12;
    const left = Math.max(
      pad,
      Math.min(window.innerWidth - tipRect.width - pad, rect.left + rect.width / 2 - tipRect.width / 2)
    );
    let top = rect.top - tipRect.height - 10;
    if (top < pad) {
      top = Math.min(window.innerHeight - tipRect.height - pad, rect.bottom + 10);
    }
    card.style.left = `${left.toFixed(1)}px`;
    card.style.top = `${top.toFixed(1)}px`;
  };

  const show = async (el) => {
    clearTimeout(hideTimer);
    const code = el?.dataset?.countryCode;
    const meta = code ? COUNTRY_META[code] : null;
    if (!meta) return;
    activeEl = el;

    const contLabel = (CONTINENT_META[meta.continent] || CONTINENT_META.world).label;
    const capLabel = code === "un" ? "HQ" : "Capital";
    const cachedSvg = svgCache.get(code);
    card.innerHTML = `
      <div class="cmap-stage">${cachedSvg || `<div class="cmap-loading">Loading map…</div>`}</div>
      <div class="cmap-footer">
        <div class="cmap-title">${renderFlagImg(code)}<span>${escapeHtml(meta.name)}</span></div>
        <div class="cmap-meta"><span>${capLabel}: <strong>${escapeHtml(meta.capital)}</strong></span><span class="cmap-cont">${escapeHtml(contLabel)}</span></div>
      </div>
    `;
    card.classList.remove("hidden");
    positionCard(el);

    if (!cachedSvg) {
      try {
        const features = await loadAtlas();
        const svg = buildContinentSvg(features, code);
        svgCache.set(code, svg);
        if (activeEl === el && !card.classList.contains("hidden")) {
          const stage = card.querySelector(".cmap-stage");
          if (stage) stage.innerHTML = svg;
          positionCard(el);
        }
      } catch {
        const stage = card.querySelector(".cmap-stage");
        if (stage) stage.innerHTML = `<div class="cmap-loading">${escapeHtml(contLabel)}</div>`;
      }
    }
  };

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest(".country-mention[data-country-code]");
    if (el) show(el);
  });

  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest(".country-mention[data-country-code]");
    if (el && el === activeEl) {
      hideTimer = setTimeout(hide, 80);
    }
  });

  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.(".country-mention[data-country-code]");
    if (el) show(el);
  });

  document.addEventListener("focusout", (e) => {
    const el = e.target.closest?.(".country-mention[data-country-code]");
    if (el && el === activeEl) hide();
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = e.target.closest(".country-mention[data-country-code]");
      if (!el) {
        if (activeEl) hide();
        return;
      }
      if (e.pointerType === "touch") {
        if (activeEl === el && !card.classList.contains("hidden")) {
          hide();
        } else {
          show(el);
        }
      }
    },
    { passive: true }
  );

  window.addEventListener("scroll", hide, { passive: true });
}

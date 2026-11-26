/**
 * Country Metadata, Flag Aliases & Hover Continent Map Tooltip
 * Covers all 195 UN countries + major territories/blocs (EU, UN, Taiwan, Hong Kong, Macau, Palestine, Kosovo, Greenland, Puerto Rico).
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

// Compact table: code -> [name, capital, continent, isoNumericOrArray, aliases[], optionalDotLonLat]
const RAW_COUNTRIES = {
  // North & Central America + Caribbean
  us: ["United States", "Washington, D.C.", "na", "840", ["United States", "U.S.", "US", "American", "Americans", "美国"]],
  ca: ["Canada", "Ottawa", "na", "124", ["Canada", "Canadian", "Canadians", "加拿大"]],
  mx: ["Mexico", "Mexico City", "na", "484", ["Mexico", "Mexican", "Mexicans", "墨西哥"]],
  gt: ["Guatemala", "Guatemala City", "na", "320", ["Guatemala", "Guatemalan"], [-90.5, 14.6]],
  bz: ["Belize", "Belmopan", "na", "084", ["Belize", "Belizean"], [-88.8, 17.2]],
  hn: ["Honduras", "Tegucigalpa", "na", "340", ["Honduras", "Honduran"], [-87.2, 14.1]],
  sv: ["El Salvador", "San Salvador", "na", "222", ["El Salvador", "Salvadoran"], [-88.9, 13.7]],
  ni: ["Nicaragua", "Managua", "na", "558", ["Nicaragua", "Nicaraguan"], [-86.3, 12.1]],
  cr: ["Costa Rica", "San José", "na", "188", ["Costa Rica", "Costa Rican"], [-84.1, 9.9]],
  pa: ["Panama", "Panama City", "na", "591", ["Panama", "Panamanian"], [-79.5, 9.0]],
  cu: ["Cuba", "Havana", "na", "192", ["Cuba", "Cuban", "Cubans"]],
  jm: ["Jamaica", "Kingston", "na", "388", ["Jamaica", "Jamaican"], [-76.8, 18.0]],
  ht: ["Haiti", "Port-au-Prince", "na", "332", ["Haiti", "Haitian"], [-72.3, 18.5]],
  do: ["Dominican Republic", "Santo Domingo", "na", "214", ["Dominican Republic", "Dominican"], [-69.9, 18.5]],
  bs: ["Bahamas", "Nassau", "na", "044", ["Bahamas", "Bahamian"], [-77.3, 25.0]],
  tt: ["Trinidad and Tobago", "Port of Spain", "na", "780", ["Trinidad and Tobago", "Trinidad"], [-61.5, 10.6]],
  bb: ["Barbados", "Bridgetown", "na", null, ["Barbados", "Barbadian"], [-59.6, 13.1]],
  ag: ["Antigua and Barbuda", "St. John's", "na", null, ["Antigua and Barbuda"], [-61.8, 17.1]],
  dm: ["Dominica", "Roseau", "na", null, ["Dominica"], [-61.4, 15.3]],
  gd: ["Grenada", "St. George's", "na", null, ["Grenada"], [-61.7, 12.1]],
  kn: ["Saint Kitts and Nevis", "Basseterre", "na", null, ["Saint Kitts and Nevis"], [-62.7, 17.3]],
  lc: ["Saint Lucia", "Castries", "na", null, ["Saint Lucia"], [-61.0, 14.0]],
  vc: ["Saint Vincent and the Grenadines", "Kingstown", "na", null, ["Saint Vincent and the Grenadines"], [-61.2, 13.2]],
  pr: ["Puerto Rico", "San Juan", "na", "630", ["Puerto Rico", "Puerto Rican"], [-66.1, 18.4]],
  gl: ["Greenland", "Nuuk", "na", "304", ["Greenland", "Greenlandic"]],

  // South America
  br: ["Brazil", "Brasília", "sa", "076", ["Brazil", "Brazilian", "Brazilians", "巴西"]],
  ar: ["Argentina", "Buenos Aires", "sa", "032", ["Argentina", "Argentine", "Argentinian", "阿根廷"]],
  co: ["Colombia", "Bogotá", "sa", "170", ["Colombia", "Colombian"]],
  ve: ["Venezuela", "Caracas", "sa", "862", ["Venezuela", "Venezuelan"]],
  cl: ["Chile", "Santiago", "sa", "152", ["Chile", "Chilean"]],
  pe: ["Peru", "Lima", "sa", "604", ["Peru", "Peruvian"]],
  ec: ["Ecuador", "Quito", "sa", "218", ["Ecuador", "Ecuadorian"]],
  bo: ["Bolivia", "Sucre / La Paz", "sa", "068", ["Bolivia", "Bolivian"]],
  py: ["Paraguay", "Asunción", "sa", "600", ["Paraguay", "Paraguayan"]],
  uy: ["Uruguay", "Montevideo", "sa", "858", ["Uruguay", "Uruguayan"]],
  gy: ["Guyana", "Georgetown", "sa", "328", ["Guyana", "Guyanese"]],
  sr: ["Suriname", "Paramaribo", "sa", "740", ["Suriname", "Surinamese"]],

  // Europe & Blocs
  eu: ["European Union", "Brussels (de facto)", "eu", EU_ISO_IDS, ["European Union", "European", "Europeans", "EU", "欧盟"]],
  gb: ["United Kingdom", "London", "eu", "826", ["United Kingdom", "UK", "Britain", "British", "英国"]],
  ie: ["Ireland", "Dublin", "eu", "372", ["Ireland", "Irish"]],
  fr: ["France", "Paris", "eu", "250", ["France", "French", "法国"]],
  de: ["Germany", "Berlin", "eu", "276", ["Germany", "German", "Germans", "德国"]],
  it: ["Italy", "Rome", "eu", "380", ["Italy", "Italian", "Italians", "意大利"]],
  es: ["Spain", "Madrid", "eu", "724", ["Spain", "Spanish", "西班牙"]],
  pt: ["Portugal", "Lisbon", "eu", "620", ["Portugal", "Portuguese"]],
  nl: ["Netherlands", "Amsterdam", "eu", "528", ["Netherlands", "Dutch", "荷兰"]],
  be: ["Belgium", "Brussels", "eu", "056", ["Belgium", "Belgian"]],
  lu: ["Luxembourg", "Luxembourg City", "eu", "442", ["Luxembourg"], [6.1, 49.6]],
  ch: ["Switzerland", "Bern", "eu", "756", ["Switzerland", "Swiss", "瑞士"]],
  at: ["Austria", "Vienna", "eu", "040", ["Austria", "Austrian"]],
  pl: ["Poland", "Warsaw", "eu", "616", ["Poland", "Polish", "波兰"]],
  cz: ["Czech Republic", "Prague", "eu", "203", ["Czech Republic", "Czechia", "Czech"]],
  sk: ["Slovakia", "Bratislava", "eu", "703", ["Slovakia", "Slovak"]],
  hu: ["Hungary", "Budapest", "eu", "348", ["Hungary", "Hungarian"]],
  ro: ["Romania", "Bucharest", "eu", "642", ["Romania", "Romanian"]],
  bg: ["Bulgaria", "Sofia", "eu", "100", ["Bulgaria", "Bulgarian"]],
  gr: ["Greece", "Athens", "eu", "300", ["Greece", "Greek"]],
  se: ["Sweden", "Stockholm", "eu", "752", ["Sweden", "Swedish", "瑞典"]],
  no: ["Norway", "Oslo", "eu", "578", ["Norway", "Norwegian", "挪威"]],
  fi: ["Finland", "Helsinki", "eu", "246", ["Finland", "Finnish", "芬兰"]],
  dk: ["Denmark", "Copenhagen", "eu", "208", ["Denmark", "Danish", "丹麦"]],
  is: ["Iceland", "Reykjavík", "eu", "352", ["Iceland", "Icelandic"]],
  ee: ["Estonia", "Tallinn", "eu", "233", ["Estonia", "Estonian"]],
  lv: ["Latvia", "Riga", "eu", "428", ["Latvia", "Latvian"]],
  lt: ["Lithuania", "Vilnius", "eu", "440", ["Lithuania", "Lithuanian"]],
  ua: ["Ukraine", "Kyiv", "eu", "804", ["Ukraine", "Ukrainian", "Ukrainians", "乌克兰"]],
  by: ["Belarus", "Minsk", "eu", "112", ["Belarus", "Belarusian"]],
  md: ["Moldova", "Chișinău", "eu", "498", ["Moldova", "Moldovan"]],
  hr: ["Croatia", "Zagreb", "eu", "191", ["Croatia", "Croatian"]],
  si: ["Slovenia", "Ljubljana", "eu", "705", ["Slovenia", "Slovenian"]],
  rs: ["Serbia", "Belgrade", "eu", "688", ["Serbia", "Serbian"]],
  ba: ["Bosnia and Herzegovina", "Sarajevo", "eu", "070", ["Bosnia and Herzegovina", "Bosnia", "Bosnian"]],
  me: ["Montenegro", "Podgorica", "eu", "499", ["Montenegro", "Montenegrin"], [19.3, 42.4]],
  al: ["Albania", "Tirana", "eu", "008", ["Albania", "Albanian"]],
  mk: ["North Macedonia", "Skopje", "eu", "807", ["North Macedonia", "Macedonian"]],
  xk: ["Kosovo", "Pristina", "eu", null, ["Kosovo", "Kosovar"], [21.2, 42.7]],
  cy: ["Cyprus", "Nicosia", "eu", "196", ["Cyprus", "Cypriot"], [33.4, 35.2]],
  mt: ["Malta", "Valletta", "eu", null, ["Malta", "Maltese"], [14.5, 35.9]],
  ad: ["Andorra", "Andorra la Vella", "eu", null, ["Andorra"], [1.5, 42.5]],
  mc: ["Monaco", "Monaco", "eu", null, ["Monaco"], [7.4, 43.7]],
  li: ["Liechtenstein", "Vaduz", "eu", null, ["Liechtenstein"], [9.5, 47.1]],
  sm: ["San Marino", "San Marino", "eu", null, ["San Marino"], [12.4, 43.9]],
  va: ["Vatican City", "Vatican City", "eu", null, ["Vatican City", "Vatican"], [12.45, 41.9]],
  ru: ["Russia", "Moscow", "eurasia", "643", ["Russia", "Russian", "Russians", "俄罗斯"]],

  // Asia & Middle East
  cn: ["China", "Beijing", "as", "156", ["China", "Chinese", "中国大陆", "中国"]],
  tw: ["Taiwan", "Taipei", "as", "158", ["Taiwan", "Taiwanese", "台湾"], [121.5, 25.0]],
  hk: ["Hong Kong", "Hong Kong", "as", null, ["Hong Kong", "香港"], [114.2, 22.3]],
  mo: ["Macau", "Macau", "as", null, ["Macau", "Macao", "澳门"], [113.5, 22.2]],
  jp: ["Japan", "Tokyo", "as", "392", ["Japan", "Japanese", "日本"]],
  kr: ["South Korea", "Seoul", "as", "410", ["South Korea", "South Korean", "韩国"]],
  kp: ["North Korea", "Pyongyang", "as", "408", ["North Korea", "North Korean", "朝鲜"]],
  mn: ["Mongolia", "Ulaanbaatar", "as", "496", ["Mongolia", "Mongolian"]],
  in: ["India", "New Delhi", "as", "356", ["India", "Indian", "Indians", "印度"]],
  pk: ["Pakistan", "Islamabad", "as", "586", ["Pakistan", "Pakistani", "巴基斯坦"]],
  bd: ["Bangladesh", "Dhaka", "as", "050", ["Bangladesh", "Bangladeshi"]],
  lk: ["Sri Lanka", "Sri Jayawardenepura Kotte", "as", "144", ["Sri Lanka", "Sri Lankan"]],
  np: ["Nepal", "Kathmandu", "as", "524", ["Nepal", "Nepalese", "Nepali"]],
  bt: ["Bhutan", "Thimphu", "as", "064", ["Bhutan", "Bhutanese"], [89.6, 27.5]],
  mv: ["Maldives", "Malé", "as", null, ["Maldives", "Maldivian"], [73.5, 4.2]],
  af: ["Afghanistan", "Kabul", "as", "004", ["Afghanistan", "Afghan", "阿富汗"]],
  vn: ["Vietnam", "Hanoi", "as", "704", ["Vietnam", "Vietnamese", "越南"]],
  th: ["Thailand", "Bangkok", "as", "764", ["Thailand", "Thai", "泰国"]],
  my: ["Malaysia", "Kuala Lumpur", "as", "458", ["Malaysia", "Malaysian", "马来西亚"]],
  sg: ["Singapore", "Singapore", "as", null, ["Singapore", "Singaporean", "新加坡"], [103.8, 1.35]],
  id: ["Indonesia", "Jakarta", "as", "360", ["Indonesia", "Indonesian", "印尼", "印度尼西亚"]],
  ph: ["Philippines", "Manila", "as", "608", ["Philippines", "Philippine", "Filipino", "菲律宾"]],
  mm: ["Myanmar", "Naypyidaw", "as", "104", ["Myanmar", "Burma", "Burmese", "缅甸"]],
  kh: ["Cambodia", "Phnom Penh", "as", "116", ["Cambodia", "Cambodian"]],
  la: ["Laos", "Vientiane", "as", "418", ["Laos", "Laotian"]],
  bn: ["Brunei", "Bandar Seri Begawan", "as", "096", ["Brunei"], [114.9, 4.9]],
  tl: ["Timor-Leste", "Dili", "as", "626", ["Timor-Leste", "East Timor"], [125.6, -8.6]],
  kz: ["Kazakhstan", "Astana", "as", "398", ["Kazakhstan", "Kazakh"]],
  uz: ["Uzbekistan", "Tashkent", "as", "860", ["Uzbekistan", "Uzbek"]],
  tm: ["Turkmenistan", "Ashgabat", "as", "795", ["Turkmenistan"]],
  kg: ["Kyrgyzstan", "Bishkek", "as", "417", ["Kyrgyzstan", "Kyrgyz"]],
  tj: ["Tajikistan", "Dushanbe", "as", "762", ["Tajikistan", "Tajik"]],
  ge: ["Georgia", "Tbilisi", "as", "268", ["Republic of Georgia", "Georgian"]],
  am: ["Armenia", "Yerevan", "as", "051", ["Armenia", "Armenian"]],
  az: ["Azerbaijan", "Baku", "as", "031", ["Azerbaijan", "Azerbaijani"]],
  il: ["Israel", "Jerusalem", "as", "376", ["Israel", "Israeli", "Israelis", "以色列"], [35.2, 31.8]],
  ps: ["Palestine / Gaza", "Ramallah / Gaza", "as", "275", ["Palestine", "Palestinian", "Palestinians", "Gaza City", "Gaza", "加沙", "巴勒斯坦"], [34.5, 31.5]],
  ir: ["Iran", "Tehran", "as", "364", ["Iran", "Iranian", "Iranians", "伊朗"]],
  sa: ["Saudi Arabia", "Riyadh", "as", "682", ["Saudi Arabia", "Saudi", "沙特"]],
  ye: ["Yemen", "Sanaa", "as", "887", ["Yemen", "Yemeni", "也门"]],
  lb: ["Lebanon", "Beirut", "as", "422", ["Lebanon", "Lebanese", "黎巴嫩"], [35.5, 33.9]],
  sy: ["Syria", "Damascus", "as", "760", ["Syria", "Syrian", "叙利亚"]],
  iq: ["Iraq", "Baghdad", "as", "368", ["Iraq", "Iraqi", "伊拉克"]],
  tr: ["Turkey", "Ankara", "as", "792", ["Turkey", "Türkiye", "Turkish", "土耳其"]],
  ae: ["United Arab Emirates", "Abu Dhabi", "as", "784", ["United Arab Emirates", "UAE", "Emirati", "阿联酋"], [54.4, 24.5]],
  qa: ["Qatar", "Doha", "as", "634", ["Qatar", "Qatari", "卡塔尔"], [51.5, 25.3]],
  kw: ["Kuwait", "Kuwait City", "as", "414", ["Kuwait", "Kuwaiti"], [48.0, 29.4]],
  bh: ["Bahrain", "Manama", "as", null, ["Bahrain", "Bahraini"], [50.6, 26.2]],
  om: ["Oman", "Muscat", "as", "512", ["Oman", "Omani"]],
  jo: ["Jordan", "Amman", "as", "400", ["Jordan", "Jordanian"]],

  // Africa
  eg: ["Egypt", "Cairo", "af", "818", ["Egypt", "Egyptian", "埃及"]],
  ly: ["Libya", "Tripoli", "af", "434", ["Libya", "Libyan", "利比亚"]],
  tn: ["Tunisia", "Tunis", "af", "788", ["Tunisia", "Tunisian"]],
  dz: ["Algeria", "Algiers", "af", "012", ["Algeria", "Algerian"]],
  ma: ["Morocco", "Rabat", "af", "504", ["Morocco", "Moroccan"]],
  sd: ["Sudan", "Khartoum", "af", "729", ["Sudan", "Sudanese", "苏丹"]],
  ss: ["South Sudan", "Juba", "af", "728", ["South Sudan", "South Sudanese"]],
  et: ["Ethiopia", "Addis Ababa", "af", "231", ["Ethiopia", "Ethiopian"]],
  er: ["Eritrea", "Asmara", "af", "232", ["Eritrea", "Eritrean"]],
  dj: ["Djibouti", "Djibouti", "af", "262", ["Djibouti"], [43.1, 11.6]],
  so: ["Somalia", "Mogadishu", "af", "706", ["Somalia", "Somali"]],
  ke: ["Kenya", "Nairobi", "af", "404", ["Kenya", "Kenyan"]],
  ug: ["Uganda", "Kampala", "af", "800", ["Uganda", "Ugandan"]],
  tz: ["Tanzania", "Dodoma", "af", "834", ["Tanzania", "Tanzanian"]],
  rw: ["Rwanda", "Kigali", "af", "646", ["Rwanda", "Rwandan"], [30.1, -1.9]],
  bi: ["Burundi", "Gitega", "af", "108", ["Burundi", "Burundian"], [29.9, -3.4]],
  cd: ["DR Congo", "Kinshasa", "af", "180", ["Democratic Republic of the Congo", "DR Congo", "DRC", "Congo", "Congolese"]],
  cg: ["Republic of the Congo", "Brazzaville", "af", "178", ["Republic of the Congo"]],
  cf: ["Central African Republic", "Bangui", "af", "140", ["Central African Republic"]],
  td: ["Chad", "N'Djamena", "af", "148", ["Chad", "Chadian"]],
  cm: ["Cameroon", "Yaoundé", "af", "120", ["Cameroon", "Cameroonian"]],
  ga: ["Gabon", "Libreville", "af", "266", ["Gabon", "Gabonese"]],
  gq: ["Equatorial Guinea", "Malabo", "af", "226", ["Equatorial Guinea"], [8.8, 3.7]],
  st: ["São Tomé and Príncipe", "São Tomé", "af", null, ["São Tomé and Príncipe"], [6.7, 0.3]],
  ng: ["Nigeria", "Abuja", "af", "566", ["Nigeria", "Nigerian", "尼日利亚"]],
  ne: ["Niger", "Niamey", "af", "562", ["Niger", "Nigerien"]],
  ml: ["Mali", "Bamako", "af", "466", ["Mali", "Malian"]],
  bf: ["Burkina Faso", "Ouagadougou", "af", "854", ["Burkina Faso", "Burkinabé"]],
  mr: ["Mauritania", "Nouakchott", "af", "478", ["Mauritania", "Mauritanian"]],
  sn: ["Senegal", "Dakar", "af", "686", ["Senegal", "Senegalese"]],
  gm: ["Gambia", "Banjul", "af", "270", ["Gambia", "Gambian"], [-16.6, 13.4]],
  gw: ["Guinea-Bissau", "Bissau", "af", "624", ["Guinea-Bissau"], [-15.6, 11.9]],
  gn: ["Guinea", "Conakry", "af", "324", ["Guinea", "Guinean"]],
  sl: ["Sierra Leone", "Freetown", "af", "694", ["Sierra Leone"]],
  lr: ["Liberia", "Monrovia", "af", "430", ["Liberia", "Liberian"]],
  ci: ["Ivory Coast", "Yamoussoukro", "af", "384", ["Ivory Coast", "Côte d'Ivoire", "Ivorian"]],
  gh: ["Ghana", "Accra", "af", "288", ["Ghana", "Ghanaian"]],
  tg: ["Togo", "Lomé", "af", "768", ["Togo", "Togolese"]],
  bj: ["Benin", "Porto-Novo", "af", "204", ["Benin", "Beninese"]],
  cv: ["Cabo Verde", "Praia", "af", null, ["Cabo Verde", "Cape Verde"], [-23.5, 14.9]],
  za: ["South Africa", "Pretoria", "af", "710", ["South Africa", "South African", "南非"]],
  na: ["Namibia", "Windhoek", "af", "516", ["Namibia", "Namibian"]],
  bw: ["Botswana", "Gaborone", "af", "072", ["Botswana"]],
  zw: ["Zimbabwe", "Harare", "af", "716", ["Zimbabwe", "Zimbabwean"]],
  zm: ["Zambia", "Lusaka", "af", "894", ["Zambia", "Zambian"]],
  ao: ["Angola", "Luanda", "af", "024", ["Angola", "Angolan"]],
  mz: ["Mozambique", "Maputo", "af", "508", ["Mozambique", "Mozambican"]],
  mw: ["Malawi", "Lilongwe", "af", "454", ["Malawi", "Malawian"]],
  mg: ["Madagascar", "Antananarivo", "af", "450", ["Madagascar", "Malagasy"]],
  ls: ["Lesotho", "Maseru", "af", "426", ["Lesotho"], [27.5, -29.3]],
  sz: ["Eswatini", "Mbabane", "af", "748", ["Eswatini", "Swaziland"], [31.1, -26.3]],
  mu: ["Mauritius", "Port Louis", "af", null, ["Mauritius", "Mauritian"], [57.5, -20.2]],
  sc: ["Seychelles", "Victoria", "af", null, ["Seychelles"], [55.5, -4.6]],
  km: ["Comoros", "Moroni", "af", null, ["Comoros"], [43.3, -11.7]],

  // Oceania
  au: ["Australia", "Canberra", "oc", "036", ["Australia", "Australian", "Australians", "澳大利亚"]],
  nz: ["New Zealand", "Wellington", "oc", "554", ["New Zealand", "新西兰"]],
  pg: ["Papua New Guinea", "Port Moresby", "oc", "598", ["Papua New Guinea"]],
  fj: ["Fiji", "Suva", "oc", "242", ["Fiji", "Fijian"], [178.4, -18.1]],
  sb: ["Solomon Islands", "Honiara", "oc", "090", ["Solomon Islands"], [160.0, -9.4]],
  vu: ["Vanuatu", "Port Vila", "oc", "548", ["Vanuatu"], [168.3, -17.7]],
  ws: ["Samoa", "Apia", "oc", null, ["Samoa", "Samoan"], [-171.8, -13.8]],
  to: ["Tonga", "Nukuʻalofa", "oc", null, ["Tonga", "Tongan"], [-175.2, -21.1]],
  ki: ["Kiribati", "Tarawa", "oc", null, ["Kiribati"], [173.0, 1.3]],
  fm: ["Micronesia", "Palikir", "oc", null, ["Micronesia"], [158.2, 6.9]],
  mh: ["Marshall Islands", "Majuro", "oc", null, ["Marshall Islands"], [171.4, 7.1]],
  pw: ["Palau", "Ngerulmud", "oc", null, ["Palau"], [134.6, 7.5]],
  nr: ["Nauru", "Yaren", "oc", null, ["Nauru"], [166.9, -0.5]],
  tv: ["Tuvalu", "Funafuti", "oc", null, ["Tuvalu"], [179.2, -8.5]],

  // Global
  un: ["United Nations", "New York (HQ)", "world", null, ["United Nations", "UN", "联合国"], [-74.0, 40.7]],
};

export const COUNTRY_META = {};
export const COUNTRY_FLAGS = {};

for (const [code, [name, capital, continent, iso, aliases, dot]] of Object.entries(RAW_COUNTRIES)) {
  COUNTRY_META[code] = { name, capital, continent, iso, ...(dot ? { dot } : {}) };
  for (const alias of aliases) {
    COUNTRY_FLAGS[alias] = code;
  }
}

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
    let [cx, cy] = proj(meta.dot[0], meta.dot[1]);
    cx = Math.max(8, Math.min(w - 8, cx));
    cy = Math.max(8, Math.min(h - 8, cy));
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

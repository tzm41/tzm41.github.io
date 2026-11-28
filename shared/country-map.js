/**
 * Country, US State, Chinese Province & City (CA/GD) Hover Map Tooltip
 * - World countries/regions: world-atlas@2/countries-110m.json (continent view)
 * - US states & California cities: us-atlas@3/states-10m.json (US view)
 * - Chinese provinces & Guangdong cities: geojson-map-china (China view)
 * All topology files are lazy-loaded once on first hover and cached in memory.
 */

const WORLD_ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const US_ATLAS_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const CN_GEO_URL = "https://cdn.jsdelivr.net/gh/longwosion/geojson-map-china@master/china.json";
const CA_PROVINCES_GEO_URL = "https://cdn.jsdelivr.net/gh/codeforgermany/click_that_hood@main/public/data/canada.geojson";

const CONTINENT_META = {
  na: { label: "North America", bounds: [-168, -52, 7, 73] },
  sa: { label: "South America", bounds: [-84, -33, -57, 14] },
  eu: { label: "Europe", bounds: [-25, 45, 34, 72] },
  eurasia: { label: "Europe & Asia", bounds: [-10, 179, 34, 78] },
  af: { label: "Africa", bounds: [-20, 53, -36, 38] },
  as: { label: "Asia", bounds: [25, 150, -11, 56] },
  oc: { label: "Oceania", bounds: [110, 180, -48, 2] },
  an: { label: "Antarctica", bounds: [-175, 178, -85, -45] },
  world: { label: "Global", bounds: [-175, 178, -58, 78] },
};

const US_BOUNDS = [-126, -66, 24, 50];
const US_FULL_BOUNDS = [-172, -66, 18, 72];
const CN_BOUNDS = [73, 136, 18, 54];
const CA_BOUNDS = [-142, -52, 41, 75];

const EU_ISO_IDS = [
  "040", "056", "100", "191", "196", "203", "208", "233", "246",
  "250", "276", "300", "348", "372", "380", "428", "440", "442",
  "470", "528", "616", "620", "642", "703", "705", "724", "752",
];

// Countries: code -> [name, capital, continent, isoNumericOrArray, aliases[], optionalDotLonLat]
const RAW_COUNTRIES = {
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
  eu: ["European Union", "Brussels (de facto)", "eu", EU_ISO_IDS, ["European Union", "EU", "欧盟", "欧洲联盟"]],
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
  un: ["United Nations", "New York (HQ)", "world", null, ["United Nations", "UN", "联合国"], [-74.0, 40.7]],
};

// All 50 US States + DC: fips -> [name, capital, aliases[], optionalDotLonLat]
const RAW_US_STATES = [
  ["01", "Alabama", "Montgomery", ["Alabama"]],
  ["02", "Alaska", "Juneau", ["Alaska"]],
  ["04", "Arizona", "Phoenix", ["Arizona"]],
  ["05", "Arkansas", "Little Rock", ["Arkansas"]],
  ["06", "California", "Sacramento", ["California", "加州", "加利福尼亚"]],
  ["08", "Colorado", "Denver", ["Colorado"]],
  ["09", "Connecticut", "Hartford", ["Connecticut"]],
  ["10", "Delaware", "Dover", ["Delaware"], [-75.5, 39.0]],
  ["11", "Washington, D.C.", "Federal District", ["Washington, D.C.", "Washington D.C."], [-77.04, 38.91]],
  ["12", "Florida", "Tallahassee", ["Florida", "佛罗里达"]],
  ["13", "Georgia", "Atlanta", ["Georgia"]],
  ["15", "Hawaii", "Honolulu", ["Hawaii", "夏威夷"]],
  ["16", "Idaho", "Boise", ["Idaho"]],
  ["17", "Illinois", "Springfield", ["Illinois"]],
  ["18", "Indiana", "Indianapolis", ["Indiana"]],
  ["19", "Iowa", "Des Moines", ["Iowa"]],
  ["20", "Kansas", "Topeka", ["Kansas"]],
  ["21", "Kentucky", "Frankfort", ["Kentucky"]],
  ["22", "Louisiana", "Baton Rouge", ["Louisiana"]],
  ["23", "Maine", "Augusta", ["Maine"]],
  ["24", "Maryland", "Annapolis", ["Maryland"]],
  ["25", "Massachusetts", "Boston", ["Massachusetts"]],
  ["26", "Michigan", "Lansing", ["Michigan"]],
  ["27", "Minnesota", "Saint Paul", ["Minnesota"]],
  ["28", "Mississippi", "Jackson", ["Mississippi"]],
  ["29", "Missouri", "Jefferson City", ["Missouri"]],
  ["30", "Montana", "Helena", ["Montana"]],
  ["31", "Nebraska", "Lincoln", ["Nebraska"]],
  ["32", "Nevada", "Carson City", ["Nevada"]],
  ["33", "New Hampshire", "Concord", ["New Hampshire"]],
  ["34", "New Jersey", "Trenton", ["New Jersey"]],
  ["35", "New Mexico", "Santa Fe", ["New Mexico"]],
  ["36", "New York", "Albany", ["New York", "纽约"]],
  ["37", "North Carolina", "Raleigh", ["North Carolina"]],
  ["38", "North Dakota", "Bismarck", ["North Dakota"]],
  ["39", "Ohio", "Columbus", ["Ohio"]],
  ["40", "Oklahoma", "Oklahoma City", ["Oklahoma"]],
  ["41", "Oregon", "Salem", ["Oregon"]],
  ["42", "Pennsylvania", "Harrisburg", ["Pennsylvania"]],
  ["44", "Rhode Island", "Providence", ["Rhode Island"], [-71.5, 41.7]],
  ["45", "South Carolina", "Columbia", ["South Carolina"]],
  ["46", "South Dakota", "Pierre", ["South Dakota"]],
  ["47", "Tennessee", "Nashville", ["Tennessee"]],
  ["48", "Texas", "Austin", ["Texas", "德克萨斯", "德州"]],
  ["49", "Utah", "Salt Lake City", ["Utah"]],
  ["50", "Vermont", "Montpelier", ["Vermont"]],
  ["51", "Virginia", "Richmond", ["Virginia"]],
  ["53", "Washington", "Olympia", ["Washington State"]],
  ["54", "West Virginia", "Charleston", ["West Virginia"]],
  ["55", "Wisconsin", "Madison", ["Wisconsin"]],
  ["56", "Wyoming", "Cheyenne", ["Wyoming"]],
];

// All 31 Mainland Chinese Provinces / Municipalities / Autonomous Regions: gbId -> [name, capital, aliases[]]
const RAW_CN_PROVINCES = [
  ["11", "Beijing", "Beijing (Municipality)", ["Beijing", "北京"]],
  ["12", "Tianjin", "Tianjin (Municipality)", ["Tianjin", "天津"]],
  ["13", "Hebei", "Shijiazhuang", ["Hebei", "河北"]],
  ["14", "Shanxi", "Taiyuan", ["Shanxi", "山西"]],
  ["15", "Inner Mongolia", "Hohhot", ["Inner Mongolia", "内蒙古"]],
  ["21", "Liaoning", "Shenyang", ["Liaoning", "辽宁"]],
  ["22", "Jilin", "Changchun", ["Jilin", "吉林"]],
  ["23", "Heilongjiang", "Harbin", ["Heilongjiang", "黑龙江"]],
  ["31", "Shanghai", "Shanghai (Municipality)", ["Shanghai", "上海"]],
  ["32", "Jiangsu", "Nanjing", ["Jiangsu", "江苏"]],
  ["33", "Zhejiang", "Hangzhou", ["Zhejiang", "浙江"]],
  ["34", "Anhui", "Hefei", ["Anhui", "安徽"]],
  ["35", "Fujian", "Fuzhou", ["Fujian", "福建"]],
  ["36", "Jiangxi", "Nanchang", ["Jiangxi", "江西"]],
  ["37", "Shandong", "Jinan", ["Shandong", "山东"]],
  ["41", "Henan", "Zhengzhou", ["Henan", "河南"]],
  ["42", "Hubei", "Wuhan", ["Hubei", "湖北"]],
  ["43", "Hunan", "Changsha", ["Hunan", "湖南"]],
  ["44", "Guangdong", "Guangzhou", ["Guangdong", "广东"]],
  ["45", "Guangxi", "Nanning", ["Guangxi", "广西"]],
  ["46", "Hainan", "Haikou", ["Hainan", "海南"]],
  ["50", "Chongqing", "Chongqing (Municipality)", ["Chongqing", "重庆"]],
  ["51", "Sichuan", "Chengdu", ["Sichuan", "四川"]],
  ["52", "Guizhou", "Guiyang", ["Guizhou", "贵州"]],
  ["53", "Yunnan", "Kunming", ["Yunnan", "云南"]],
  ["54", "Tibet", "Lhasa", ["Tibet", "Xizang", "西藏"]],
  ["61", "Shaanxi", "Xi'an", ["Shaanxi", "陕西"]],
  ["62", "Gansu", "Lanzhou", ["Gansu", "甘肃"]],
  ["63", "Qinghai", "Xining", ["Qinghai", "青海"]],
  ["64", "Ningxia", "Yinchuan", ["Ningxia", "宁夏"]],
  ["65", "Xinjiang", "Ürümqi", ["Xinjiang", "新疆"]],
];

// All 21 Prefecture-Level Cities in Guangdong: [slug, name, lon, lat, aliases[]]
const RAW_GD_CITIES = [
  ["guangzhou", "Guangzhou", 113.26, 23.13, ["Guangzhou", "广州"]],
  ["shenzhen", "Shenzhen", 114.06, 22.54, ["Shenzhen", "深圳"]],
  ["dongguan", "Dongguan", 113.75, 23.02, ["Dongguan", "东莞"]],
  ["foshan", "Foshan", 113.12, 23.02, ["Foshan", "佛山"]],
  ["zhuhai", "Zhuhai", 113.58, 22.27, ["Zhuhai", "珠海"]],
  ["zhongshan", "Zhongshan", 113.38, 22.52, ["Zhongshan", "中山"]],
  ["huizhou", "Huizhou", 114.42, 23.11, ["Huizhou", "惠州"]],
  ["jiangmen", "Jiangmen", 113.08, 22.58, ["Jiangmen", "江门"]],
  ["shantou", "Shantou", 116.68, 23.35, ["Shantou", "汕头"]],
  ["zhanjiang", "Zhanjiang", 110.36, 21.27, ["Zhanjiang", "湛江"]],
  ["maoming", "Maoming", 110.92, 21.66, ["Maoming", "茂名"]],
  ["zhaoqing", "Zhaoqing", 112.46, 23.05, ["Zhaoqing", "肇庆"]],
  ["qingyuan", "Qingyuan", 113.06, 23.68, ["Qingyuan", "清远"]],
  ["shaoguan", "Shaoguan", 113.60, 24.81, ["Shaoguan", "韶关"]],
  ["meizhou", "Meizhou", 116.12, 24.29, ["Meizhou", "梅州"]],
  ["shanwei", "Shanwei", 115.37, 22.78, ["Shanwei", "汕尾"]],
  ["heyuan", "Heyuan", 114.70, 23.74, ["Heyuan", "河源"]],
  ["yangjiang", "Yangjiang", 111.98, 21.86, ["Yangjiang", "阳江"]],
  ["chaozhou", "Chaozhou", 116.62, 23.66, ["Chaozhou", "潮州"]],
  ["jieyang", "Jieyang", 116.37, 23.55, ["Jieyang", "揭阳"]],
  ["yunfu", "Yunfu", 112.04, 22.92, ["Yunfu", "云浮"]],
];

// Major Cities & Regions in California: [slug, name, lon, lat, aliases[]]
const RAW_CA_CITIES = [
  ["san-francisco", "San Francisco", -122.42, 37.77, ["San Francisco", "旧金山"]],
  ["san-jose", "San Jose", -121.89, 37.34, ["San Jose", "圣何塞"]],
  ["oakland", "Oakland", -122.27, 37.80, ["Oakland", "奥克兰"]],
  ["berkeley", "Berkeley", -122.27, 37.87, ["Berkeley"]],
  ["palo-alto", "Palo Alto", -122.14, 37.44, ["Palo Alto"]],
  ["mountain-view", "Mountain View", -122.08, 37.39, ["Mountain View"]],
  ["cupertino", "Cupertino", -122.03, 37.32, ["Cupertino"]],
  ["menlo-park", "Menlo Park", -122.18, 37.45, ["Menlo Park"]],
  ["sunnyvale", "Sunnyvale", -122.04, 37.37, ["Sunnyvale"]],
  ["santa-clara", "Santa Clara", -121.95, 37.35, ["Santa Clara"]],
  ["fremont", "Fremont", -121.99, 37.55, ["Fremont"]],
  ["redwood-city", "Redwood City", -122.23, 37.49, ["Redwood City"]],
  ["san-mateo", "San Mateo", -122.33, 37.56, ["San Mateo"]],
  ["silicon-valley", "Silicon Valley", -122.04, 37.38, ["Silicon Valley", "硅谷"]],
  ["bay-area", "Bay Area", -122.25, 37.75, ["Bay Area", "湾区"]],
  ["los-angeles", "Los Angeles", -118.24, 34.05, ["Los Angeles", "洛杉矶"]],
  ["san-diego", "San Diego", -117.16, 32.72, ["San Diego", "圣地亚哥"]],
  ["sacramento", "Sacramento", -121.49, 38.58, ["Sacramento", "萨克拉门托"]],
  ["fresno", "Fresno", -119.79, 36.74, ["Fresno"]],
  ["long-beach", "Long Beach", -118.19, 33.77, ["Long Beach"]],
  ["anaheim", "Anaheim", -117.91, 33.84, ["Anaheim"]],
  ["irvine", "Irvine", -117.83, 33.68, ["Irvine"]],
  ["santa-monica", "Santa Monica", -118.49, 34.02, ["Santa Monica"]],
  ["pasadena", "Pasadena", -118.14, 34.15, ["Pasadena"]],
  ["beverly-hills", "Beverly Hills", -118.40, 34.07, ["Beverly Hills"]],
  ["bakersfield", "Bakersfield", -119.02, 35.37, ["Bakersfield"]],
  ["riverside", "Riverside", -117.40, 33.98, ["Riverside"]],
  ["stockton", "Stockton", -121.29, 37.96, ["Stockton"]],
  ["santa-barbara", "Santa Barbara", -119.70, 34.42, ["Santa Barbara"]],
  ["santa-cruz", "Santa Cruz", -122.03, 36.97, ["Santa Cruz"]],
  ["monterey", "Monterey", -121.89, 36.60, ["Monterey"]],
  ["napa", "Napa", -122.29, 38.30, ["Napa"]],
];

// Remaining 26 Chinese Provincial & Autonomous Region Capitals (Guangzhou in RAW_GD_CITIES; Beijing/Tianjin/Shanghai/Chongqing in RAW_CN_PROVINCES):
// [slug, name, gbId, provinceName, lon, lat, aliases[]]
const RAW_CN_CAPITALS = [
  ["shijiazhuang", "Shijiazhuang", "13", "Hebei", 114.51, 38.04, ["Shijiazhuang", "石家庄"]],
  ["taiyuan", "Taiyuan", "14", "Shanxi", 112.55, 37.87, ["Taiyuan", "太原"]],
  ["hohhot", "Hohhot", "15", "Inner Mongolia", 111.75, 40.84, ["Hohhot", "呼和浩特"]],
  ["shenyang", "Shenyang", "21", "Liaoning", 123.43, 41.80, ["Shenyang", "沈阳"]],
  ["changchun", "Changchun", "22", "Jilin", 125.32, 43.82, ["Changchun", "长春"]],
  ["harbin", "Harbin", "23", "Heilongjiang", 126.53, 45.80, ["Harbin", "哈尔滨"]],
  ["nanjing", "Nanjing", "32", "Jiangsu", 118.80, 32.06, ["Nanjing", "南京"]],
  ["hangzhou", "Hangzhou", "33", "Zhejiang", 120.15, 30.27, ["Hangzhou", "杭州"]],
  ["hefei", "Hefei", "34", "Anhui", 117.23, 31.82, ["Hefei", "合肥"]],
  ["fuzhou", "Fuzhou", "35", "Fujian", 119.30, 26.07, ["Fuzhou", "福州"]],
  ["nanchang", "Nanchang", "36", "Jiangxi", 115.86, 28.68, ["Nanchang", "南昌"]],
  ["jinan", "Jinan", "37", "Shandong", 117.12, 36.65, ["Jinan", "济南"]],
  ["zhengzhou", "Zhengzhou", "41", "Henan", 113.63, 34.75, ["Zhengzhou", "郑州"]],
  ["wuhan", "Wuhan", "42", "Hubei", 114.30, 30.59, ["Wuhan", "武汉"]],
  ["changsha", "Changsha", "43", "Hunan", 112.94, 28.23, ["Changsha", "长沙"]],
  ["nanning", "Nanning", "45", "Guangxi", 108.37, 22.82, ["Nanning", "南宁"]],
  ["haikou", "Haikou", "46", "Hainan", 110.20, 20.04, ["Haikou", "海口"]],
  ["chengdu", "Chengdu", "51", "Sichuan", 104.07, 30.67, ["Chengdu", "成都"]],
  ["guiyang", "Guiyang", "52", "Guizhou", 106.63, 26.65, ["Guiyang", "贵阳"]],
  ["kunming", "Kunming", "53", "Yunnan", 102.83, 24.88, ["Kunming", "昆明"]],
  ["lhasa", "Lhasa", "54", "Tibet", 91.11, 29.65, ["Lhasa", "拉萨"]],
  ["xian", "Xi'an", "61", "Shaanxi", 108.94, 34.34, ["Xi'an", "Xian", "西安"]],
  ["lanzhou", "Lanzhou", "62", "Gansu", 103.83, 36.06, ["Lanzhou", "兰州"]],
  ["xining", "Xining", "63", "Qinghai", 101.78, 36.62, ["Xining", "西宁"]],
  ["yinchuan", "Yinchuan", "64", "Ningxia", 106.23, 38.49, ["Yinchuan", "银川"]],
  ["urumqi", "Ürümqi", "65", "Xinjiang", 87.62, 43.83, ["Ürümqi", "Urumqi", "乌鲁木齐"]],
];

// Remaining 49 US State Capitals (Sacramento in RAW_CA_CITIES):
// [slug, name, fips, stateName, lon, lat, aliases[]]
const RAW_US_CAPITALS = [
  ["montgomery", "Montgomery", "01", "Alabama", -86.30, 32.37, ["Montgomery"]],
  ["juneau", "Juneau", "02", "Alaska", -134.42, 58.30, ["Juneau"]],
  ["phoenix", "Phoenix", "04", "Arizona", -112.07, 33.45, ["Phoenix", "菲尼克斯", "凤凰城"]],
  ["little-rock", "Little Rock", "05", "Arkansas", -92.29, 34.75, ["Little Rock"]],
  ["denver", "Denver", "08", "Colorado", -104.99, 39.74, ["Denver", "丹佛"]],
  ["hartford", "Hartford", "09", "Connecticut", -72.68, 41.76, ["Hartford"]],
  ["dover", "Dover", "10", "Delaware", -75.52, 39.16, ["Dover"]],
  ["tallahassee", "Tallahassee", "12", "Florida", -84.28, 30.44, ["Tallahassee"]],
  ["atlanta", "Atlanta", "13", "Georgia", -84.39, 33.75, ["Atlanta", "亚特兰大"]],
  ["honolulu", "Honolulu", "15", "Hawaii", -157.86, 21.31, ["Honolulu", "檀香山", "火奴鲁鲁"]],
  ["boise", "Boise", "16", "Idaho", -116.20, 43.62, ["Boise"]],
  ["springfield", "Springfield", "17", "Illinois", -89.65, 39.78, ["Springfield"]],
  ["indianapolis", "Indianapolis", "18", "Indiana", -86.16, 39.77, ["Indianapolis", "印第安纳波利斯"]],
  ["des-moines", "Des Moines", "19", "Iowa", -93.61, 41.59, ["Des Moines"]],
  ["topeka", "Topeka", "20", "Kansas", -95.69, 39.05, ["Topeka"]],
  ["frankfort", "Frankfort", "21", "Kentucky", -84.87, 38.20, ["Frankfort"]],
  ["baton-rouge", "Baton Rouge", "22", "Louisiana", -91.19, 30.45, ["Baton Rouge"]],
  ["augusta", "Augusta", "23", "Maine", -69.78, 44.31, ["Augusta"]],
  ["annapolis", "Annapolis", "24", "Maryland", -76.49, 38.98, ["Annapolis"]],
  ["boston", "Boston", "25", "Massachusetts", -71.06, 42.36, ["Boston", "波士顿"]],
  ["lansing", "Lansing", "26", "Michigan", -84.56, 42.73, ["Lansing"]],
  ["saint-paul", "Saint Paul", "27", "Minnesota", -93.09, 44.95, ["Saint Paul", "St. Paul"]],
  ["jackson", "Jackson", "28", "Mississippi", -90.18, 32.30, ["Jackson"]],
  ["jefferson-city", "Jefferson City", "29", "Missouri", -92.17, 38.58, ["Jefferson City"]],
  ["helena", "Helena", "30", "Montana", -112.03, 46.59, ["Helena"]],
  ["lincoln", "Lincoln", "31", "Nebraska", -96.70, 40.81, ["Lincoln"]],
  ["carson-city", "Carson City", "32", "Nevada", -119.77, 39.16, ["Carson City"]],
  ["concord", "Concord", "33", "New Hampshire", -71.54, 43.21, ["Concord"]],
  ["trenton", "Trenton", "34", "New Jersey", -74.76, 40.22, ["Trenton"]],
  ["santa-fe", "Santa Fe", "35", "New Mexico", -105.94, 35.69, ["Santa Fe"]],
  ["albany", "Albany", "36", "New York", -73.76, 42.65, ["Albany", "奥尔巴尼"]],
  ["raleigh", "Raleigh", "37", "North Carolina", -78.64, 35.78, ["Raleigh", "罗利"]],
  ["bismarck", "Bismarck", "38", "North Dakota", -100.78, 46.81, ["Bismarck"]],
  ["columbus", "Columbus", "39", "Ohio", -83.00, 39.96, ["Columbus", "哥伦布"]],
  ["oklahoma-city", "Oklahoma City", "40", "Oklahoma", -97.52, 35.47, ["Oklahoma City"]],
  ["salem", "Salem", "41", "Oregon", -123.04, 44.94, ["Salem"]],
  ["harrisburg", "Harrisburg", "42", "Pennsylvania", -76.89, 40.27, ["Harrisburg"]],
  ["providence", "Providence", "44", "Rhode Island", -71.41, 41.82, ["Providence"]],
  ["columbia", "Columbia", "45", "South Carolina", -81.03, 34.00, ["Columbia"]],
  ["pierre", "Pierre", "46", "South Dakota", -100.35, 44.37, ["Pierre"]],
  ["nashville", "Nashville", "47", "Tennessee", -86.78, 36.16, ["Nashville", "纳什维尔"]],
  ["austin", "Austin", "48", "Texas", -97.74, 30.27, ["Austin", "奥斯汀"]],
  ["salt-lake-city", "Salt Lake City", "49", "Utah", -111.89, 40.76, ["Salt Lake City", "盐湖城"]],
  ["montpelier", "Montpelier", "50", "Vermont", -72.58, 44.26, ["Montpelier"]],
  ["richmond", "Richmond", "51", "Virginia", -77.44, 37.54, ["Richmond", "里士满"]],
  ["olympia", "Olympia", "53", "Washington", -122.90, 47.04, ["Olympia"]],
  ["charleston", "Charleston", "54", "West Virginia", -81.63, 38.35, ["Charleston"]],
  ["madison", "Madison", "55", "Wisconsin", -89.40, 43.07, ["Madison"]],
  ["cheyenne", "Cheyenne", "56", "Wyoming", -104.82, 41.14, ["Cheyenne"]],
];

export const PLACE_META = {};
export const PLACE_ALIASES = {};
export const COUNTRY_META = {};
export const COUNTRY_FLAGS = {};

// 1. Countries
for (const [code, [name, capital, continent, iso, aliases, dot]] of Object.entries(RAW_COUNTRIES)) {
  const entry = {
    kind: "country",
    flagCode: code,
    showInlineFlag: true,
    name,
    subtitle: capital,
    regionLabel: (CONTINENT_META[continent] || CONTINENT_META.world).label,
    continent,
    iso,
    ...(dot ? { dot } : {}),
  };
  COUNTRY_META[code] = entry;
  PLACE_META[code] = entry;
  for (const alias of aliases) {
    COUNTRY_FLAGS[alias] = code;
    PLACE_ALIASES[alias] = code;
  }
}

// 1b. Continents (all 7 continents; Europe distinct from EU unless semantically referring to EU)
const isosForContinent = (contKey, extra = []) => {
  const set = new Set(extra);
  for (const [code, [, , cont, iso]] of Object.entries(RAW_COUNTRIES)) {
    if (code !== "eu" && cont === contKey && typeof iso === "string") set.add(iso);
  }
  return [...set];
};

const RAW_CONTINENTS = [
  ["continent-europe", "Europe", "44 countries", "eu", isosForContinent("eu", ["643"]), ["Europe", "European", "Europeans", "欧洲"]],
  ["continent-asia", "Asia", "48 countries", "as", isosForContinent("as", ["643"]), ["Asia", "Asian", "Asians", "亚洲"]],
  ["continent-africa", "Africa", "54 countries", "af", isosForContinent("af"), ["Africa", "African", "Africans", "非洲"]],
  ["continent-north-america", "North America", "23 countries", "na", isosForContinent("na"), ["North America", "North American", "北美洲", "北美"]],
  ["continent-south-america", "South America", "12 countries", "sa", isosForContinent("sa"), ["South America", "South American", "南美洲", "南美"]],
  ["continent-oceania", "Oceania", "14 countries", "oc", isosForContinent("oc"), ["Oceania", "大洋洲"]],
  ["continent-antarctica", "Antarctica", "Polar continent", "an", ["010"], ["Antarctica", "Antarctic", "南极洲", "南极"]],
];

for (const [id, name, regionLabel, continent, iso, aliases] of RAW_CONTINENTS) {
  PLACE_META[id] = {
    kind: "continent",
    flagCode: null,
    showInlineFlag: false,
    name,
    subtitle: "Continent",
    regionLabel,
    continent,
    iso,
  };
  for (const alias of aliases) {
    PLACE_ALIASES[alias] = id;
  }
}

// 2. US States
for (const [fips, name, capital, aliases, dot] of RAW_US_STATES) {
  const id = `us-${fips}`;
  PLACE_META[id] = {
    kind: "us_state",
    flagCode: "us",
    showInlineFlag: false,
    name,
    subtitle: capital,
    regionLabel: "United States",
    fips,
    ...(dot ? { dot } : {}),
  };
  for (const alias of aliases) {
    PLACE_ALIASES[alias] = id;
  }
}

// 3. Chinese Provinces
for (const [gbId, name, capital, aliases] of RAW_CN_PROVINCES) {
  const id = `cn-${gbId}`;
  PLACE_META[id] = {
    kind: "cn_province",
    flagCode: "cn",
    showInlineFlag: false,
    name,
    subtitle: capital,
    regionLabel: "China",
    gbId,
  };
  for (const alias of aliases) {
    PLACE_ALIASES[alias] = id;
  }
}

// 4. Guangdong Cities
for (const [slug, name, lon, lat, aliases] of RAW_GD_CITIES) {
  const id = `gd-${slug}`;
  PLACE_META[id] = {
    kind: "gd_city",
    flagCode: "cn",
    showInlineFlag: false,
    name,
    subtitle: "Guangdong",
    regionLabel: "China",
    gbId: "44",
    dot: [lon, lat],
  };
  for (const alias of aliases) {
    PLACE_ALIASES[alias] = id;
  }
}

// 5. California Cities
for (const [slug, name, lon, lat, aliases] of RAW_CA_CITIES) {
  const id = `ca-${slug}`;
  PLACE_META[id] = {
    kind: "ca_city",
    flagCode: "us",
    showInlineFlag: false,
    name,
    subtitle: "California",
    regionLabel: "United States",
    fips: "06",
    dot: [lon, lat],
  };
  for (const alias of aliases) {
    PLACE_ALIASES[alias] = id;
  }
}

// 6. Chinese Provincial Capitals
for (const [slug, name, gbId, provinceName, lon, lat, aliases] of RAW_CN_CAPITALS) {
  const id = `cn-cap-${slug}`;
  PLACE_META[id] = {
    kind: "cn_city",
    flagCode: "cn",
    showInlineFlag: false,
    name,
    subtitle: provinceName,
    regionLabel: "China",
    gbId,
    dot: [lon, lat],
  };
  for (const alias of aliases) {
    PLACE_ALIASES[alias] = id;
  }
}

// 7. US State Capitals
for (const [slug, name, fips, stateName, lon, lat, aliases] of RAW_US_CAPITALS) {
  const id = `us-cap-${slug}`;
  PLACE_META[id] = {
    kind: "us_city",
    flagCode: "us",
    showInlineFlag: false,
    name,
    subtitle: stateName,
    regionLabel: "United States",
    fips,
    dot: [lon, lat],
  };
  for (const alias of aliases) {
    PLACE_ALIASES[alias] = id;
  }
}

// 8. Canadian Provinces & Territories (all 10 provinces + 3 territories)
// Format: [slug, name, geoName, capital, aliases[]]
const RAW_CA_PROVINCES = [
  ["on", "Ontario", "Ontario", "Toronto", ["Ontario", "安大略省", "安大略"]],
  ["qc", "Quebec", "Quebec", "Quebec City", ["Quebec", "Québec", "魁北克省", "魁北克"]],
  ["bc", "British Columbia", "British Columbia", "Victoria", ["British Columbia", "不列颠哥伦比亚省", "卑诗省"]],
  ["ab", "Alberta", "Alberta", "Edmonton", ["Alberta", "阿尔伯塔省", "艾伯塔省"]],
  ["mb", "Manitoba", "Manitoba", "Winnipeg", ["Manitoba", "马尼托巴省", "曼尼托巴省"]],
  ["sk", "Saskatchewan", "Saskatchewan", "Regina", ["Saskatchewan", "萨斯喀彻温省"]],
  ["ns", "Nova Scotia", "Nova Scotia", "Halifax", ["Nova Scotia", "新斯科舍省"]],
  ["nb", "New Brunswick", "New Brunswick", "Fredericton", ["New Brunswick", "新不伦瑞克省"]],
  ["nl", "Newfoundland and Labrador", "Newfoundland and Labrador", "St. John's", ["Newfoundland and Labrador", "Newfoundland", "纽芬兰与拉布拉多省", "纽芬兰"]],
  ["pe", "Prince Edward Island", "Prince Edward Island", "Charlottetown", ["Prince Edward Island", "爱德华王子岛"]],
  ["yt", "Yukon", "Yukon Territory", "Whitehorse", ["Yukon", "Yukon Territory", "育空"]],
  ["nt", "Northwest Territories", "Northwest Territories", "Yellowknife", ["Northwest Territories", "西北地区"]],
  ["nu", "Nunavut", "Nunavut", "Iqaluit", ["Nunavut", "努纳武特"]],
];

for (const [slug, name, geoName, capital, aliases] of RAW_CA_PROVINCES) {
  const id = `can-${slug}`;
  PLACE_META[id] = {
    kind: "ca_province",
    flagCode: "ca",
    showInlineFlag: false,
    name,
    subtitle: capital,
    regionLabel: "Canada",
    geoName,
  };
  for (const alias of aliases) {
    if (!(alias in PLACE_ALIASES)) PLACE_ALIASES[alias] = id;
  }
}

// 9. Major Canadian Cities & Provincial Capitals
// Format: [slug, name, geoName, provinceName, lon, lat, aliases[]]
const RAW_CA_PROV_CITIES = [
  ["ottawa", "Ottawa", "Ontario", "Ontario", -75.697, 45.421, ["Ottawa", "渥太华"]],
  ["toronto", "Toronto", "Ontario", "Ontario", -79.383, 43.653, ["Toronto", "多伦多"]],
  ["montreal", "Montreal", "Quebec", "Quebec", -73.567, 45.502, ["Montreal", "Montréal", "蒙特利尔"]],
  ["vancouver", "Vancouver", "British Columbia", "British Columbia", -123.121, 49.283, ["Vancouver", "温哥华"]],
  ["calgary", "Calgary", "Alberta", "Alberta", -114.072, 51.045, ["Calgary", "卡尔加里"]],
  ["edmonton", "Edmonton", "Alberta", "Alberta", -113.494, 53.546, ["Edmonton", "埃德蒙顿"]],
  ["winnipeg", "Winnipeg", "Manitoba", "Manitoba", -97.138, 49.895, ["Winnipeg", "温尼伯"]],
  ["quebec-city", "Quebec City", "Quebec", "Quebec", -71.208, 46.814, ["Quebec City", "Québec City", "魁北克城"]],
  ["halifax", "Halifax", "Nova Scotia", "Nova Scotia", -63.575, 44.649, ["Halifax", "哈利法克斯"]],
  ["saskatoon", "Saskatoon", "Saskatchewan", "Saskatchewan", -106.670, 52.133, ["Saskatoon", "萨斯卡通"]],
  ["regina", "Regina", "Saskatchewan", "Saskatchewan", -104.619, 50.445, ["Regina"]],
  ["st-johns", "St. John's", "Newfoundland and Labrador", "Newfoundland and Labrador", -52.713, 47.562, ["St. John's"]],
  ["fredericton", "Fredericton", "New Brunswick", "New Brunswick", -66.643, 45.964, ["Fredericton"]],
  ["charlottetown", "Charlottetown", "Prince Edward Island", "Prince Edward Island", -63.131, 46.238, ["Charlottetown"]],
  ["whitehorse", "Whitehorse", "Yukon Territory", "Yukon", -135.057, 60.721, ["Whitehorse"]],
  ["yellowknife", "Yellowknife", "Northwest Territories", "Northwest Territories", -114.372, 62.454, ["Yellowknife"]],
  ["iqaluit", "Iqaluit", "Nunavut", "Nunavut", -68.517, 63.747, ["Iqaluit"]],
];

for (const [slug, name, geoName, provinceName, lon, lat, aliases] of RAW_CA_PROV_CITIES) {
  const id = `can-city-${slug}`;
  PLACE_META[id] = {
    kind: "ca_prov_city",
    flagCode: "ca",
    showInlineFlag: false,
    name,
    subtitle: provinceName,
    regionLabel: "Canada",
    geoName,
    dot: [lon, lat],
  };
  for (const alias of aliases) {
    if (!(alias in PLACE_ALIASES)) PLACE_ALIASES[alias] = id;
  }
}

// 10. Major Non-Capital US Cities
const RAW_US_MAJOR_CITIES = [
  ["nyc", "New York City", "36", "New York", -74.006, 40.713, ["New York City", "NYC", "Manhattan", "Brooklyn", "纽约市", "纽约"]],
  ["chicago", "Chicago", "17", "Illinois", -87.630, 41.878, ["Chicago", "芝加哥"]],
  ["houston", "Houston", "48", "Texas", -95.370, 29.760, ["Houston", "休斯敦", "休斯顿"]],
  ["dallas", "Dallas", "48", "Texas", -96.797, 32.777, ["Dallas", "达拉斯"]],
  ["san-antonio", "San Antonio", "48", "Texas", -98.494, 29.424, ["San Antonio", "圣安东尼奥"]],
  ["seattle", "Seattle", "53", "Washington", -122.332, 47.606, ["Seattle", "西雅图"]],
  ["miami", "Miami", "12", "Florida", -80.192, 25.762, ["Miami", "迈阿密"]],
  ["orlando", "Orlando", "12", "Florida", -81.379, 28.538, ["Orlando", "奥兰多"]],
  ["tampa", "Tampa", "12", "Florida", -82.457, 27.951, ["Tampa", "坦帕"]],
  ["philadelphia", "Philadelphia", "42", "Pennsylvania", -75.165, 39.953, ["Philadelphia", "费城"]],
  ["pittsburgh", "Pittsburgh", "42", "Pennsylvania", -79.996, 40.441, ["Pittsburgh", "匹兹堡"]],
  ["detroit", "Detroit", "26", "Michigan", -83.046, 42.331, ["Detroit", "底特律"]],
  ["minneapolis", "Minneapolis", "27", "Minnesota", -93.265, 44.978, ["Minneapolis", "明尼阿波利斯"]],
  ["las-vegas", "Las Vegas", "32", "Nevada", -115.140, 36.170, ["Las Vegas", "拉斯维加斯"]],
  ["portland", "Portland", "41", "Oregon", -122.676, 45.523, ["Portland", "波特兰"]],
  ["new-orleans", "New Orleans", "22", "Louisiana", -90.072, 29.951, ["New Orleans", "新奥尔良"]],
  ["charlotte", "Charlotte", "37", "North Carolina", -80.843, 35.227, ["Charlotte", "夏洛特"]],
  ["cleveland", "Cleveland", "39", "Ohio", -81.694, 41.499, ["Cleveland", "克利夫兰"]],
  ["cincinnati", "Cincinnati", "39", "Ohio", -84.512, 39.103, ["Cincinnati", "辛辛那提"]],
  ["st-louis", "St. Louis", "29", "Missouri", -90.199, 38.627, ["St. Louis", "Saint Louis", "圣路易斯"]],
  ["kansas-city", "Kansas City", "29", "Missouri", -94.579, 39.100, ["Kansas City", "堪萨斯城"]],
  ["baltimore", "Baltimore", "24", "Maryland", -76.612, 39.290, ["Baltimore", "巴尔的摩"]],
  ["milwaukee", "Milwaukee", "55", "Wisconsin", -87.907, 43.039, ["Milwaukee", "密尔沃基"]],
  ["memphis", "Memphis", "47", "Tennessee", -90.049, 35.150, ["Memphis", "孟菲斯"]],
  ["anchorage", "Anchorage", "02", "Alaska", -149.900, 61.218, ["Anchorage", "安克雷奇"]],
  ["omaha", "Omaha", "31", "Nebraska", -95.935, 41.257, ["Omaha", "奥马哈"]],
  ["albuquerque", "Albuquerque", "35", "New Mexico", -106.650, 35.084, ["Albuquerque"]],
  ["tucson", "Tucson", "04", "Arizona", -110.975, 32.223, ["Tucson"]],
  ["louisville", "Louisville", "21", "Kentucky", -85.759, 38.253, ["Louisville"]],
  ["buffalo", "Buffalo", "36", "New York", -78.878, 42.886, ["Buffalo"]],
  ["newark", "Newark", "34", "New Jersey", -74.172, 40.736, ["Newark"]],
];

for (const [slug, name, fips, stateName, lon, lat, aliases] of RAW_US_MAJOR_CITIES) {
  const id = `us-city-${slug}`;
  PLACE_META[id] = {
    kind: "us_city",
    flagCode: "us",
    showInlineFlag: false,
    name,
    subtitle: stateName,
    regionLabel: "United States",
    fips,
    dot: [lon, lat],
  };
  for (const alias of aliases) {
    if (!(alias in PLACE_ALIASES)) PLACE_ALIASES[alias] = id;
  }
}

// 11. Major Non-Capital Chinese Cities
const RAW_CN_MAJOR_CITIES = [
  ["suzhou", "Suzhou", "32", "Jiangsu", 120.585, 31.299, ["Suzhou", "苏州"]],
  ["ningbo", "Ningbo", "33", "Zhejiang", 121.550, 29.868, ["Ningbo", "宁波"]],
  ["xiamen", "Xiamen", "35", "Fujian", 118.089, 24.480, ["Xiamen", "厦门"]],
  ["qingdao", "Qingdao", "37", "Shandong", 120.383, 36.067, ["Qingdao", "青岛"]],
  ["dalian", "Dalian", "21", "Liaoning", 121.615, 38.914, ["Dalian", "大连"]],
  ["wuxi", "Wuxi", "32", "Jiangsu", 120.312, 31.491, ["Wuxi", "无锡"]],
  ["wenzhou", "Wenzhou", "33", "Zhejiang", 120.699, 27.994, ["Wenzhou", "温州"]],
  ["quanzhou", "Quanzhou", "35", "Fujian", 118.676, 24.874, ["Quanzhou", "泉州"]],
  ["sanya", "Sanya", "46", "Hainan", 109.512, 18.253, ["Sanya", "三亚"]],
  ["guilin", "Guilin", "45", "Guangxi", 110.290, 25.274, ["Guilin", "桂林"]],
  ["kashgar", "Kashgar", "65", "Xinjiang", 75.990, 39.468, ["Kashgar", "喀什"]],
];

for (const [slug, name, gbId, provinceName, lon, lat, aliases] of RAW_CN_MAJOR_CITIES) {
  const id = `cn-city-${slug}`;
  PLACE_META[id] = {
    kind: "cn_city",
    flagCode: "cn",
    showInlineFlag: false,
    name,
    subtitle: provinceName,
    regionLabel: "China",
    gbId,
    dot: [lon, lat],
  };
  for (const alias of aliases) {
    if (!(alias in PLACE_ALIASES)) PLACE_ALIASES[alias] = id;
  }
}

// 12. World National Capitals & Major Global Cities
// Format: [slug, name, countryCode, lon, lat, aliases[]]
const RAW_WORLD_CITIES = [
  // Europe
  ["london", "London", "gb", -0.128, 51.507, ["London", "伦敦"]],
  ["manchester", "Manchester", "gb", -2.243, 53.481, ["Manchester", "曼彻斯特"]],
  ["edinburgh", "Edinburgh", "gb", -3.188, 55.953, ["Edinburgh", "爱丁堡"]],
  ["birmingham", "Birmingham", "gb", -1.890, 52.486, ["Birmingham", "伯明翰"]],
  ["liverpool", "Liverpool", "gb", -2.992, 53.408, ["Liverpool", "利物浦"]],
  ["glasgow", "Glasgow", "gb", -4.252, 55.864, ["Glasgow", "格拉斯哥"]],
  ["belfast", "Belfast", "gb", -5.930, 54.597, ["Belfast", "贝尔法斯特"]],
  ["dublin", "Dublin", "ie", -6.260, 53.350, ["Dublin", "都柏林"]],
  ["paris", "Paris", "fr", 2.352, 48.857, ["Paris", "巴黎"]],
  ["marseille", "Marseille", "fr", 5.370, 43.297, ["Marseille", "马赛"]],
  ["lyon", "Lyon", "fr", 4.836, 45.764, ["Lyon", "里昂"]],
  ["berlin", "Berlin", "de", 13.405, 52.520, ["Berlin", "柏林"]],
  ["munich", "Munich", "de", 11.582, 48.135, ["Munich", "München", "慕尼黑"]],
  ["frankfurt", "Frankfurt", "de", 8.682, 50.111, ["Frankfurt", "法兰克福"]],
  ["hamburg", "Hamburg", "de", 9.994, 53.551, ["Hamburg", "汉堡"]],
  ["cologne", "Cologne", "de", 6.960, 50.938, ["Cologne", "Köln", "科隆"]],
  ["rome", "Rome", "it", 12.496, 41.903, ["Rome", "Roma", "罗马"]],
  ["milan", "Milan", "it", 9.190, 45.464, ["Milan", "Milano", "米兰"]],
  ["naples", "Naples", "it", 14.268, 40.852, ["Naples", "Napoli", "那不勒斯"]],
  ["venice", "Venice", "it", 12.316, 45.441, ["Venice", "Venezia", "威尼斯"]],
  ["florence", "Florence", "it", 11.256, 43.770, ["Florence", "Firenze", "佛罗伦萨"]],
  ["madrid", "Madrid", "es", -3.704, 40.417, ["Madrid", "马德里"]],
  ["barcelona", "Barcelona", "es", 2.173, 41.385, ["Barcelona", "巴塞罗那"]],
  ["seville", "Seville", "es", -5.984, 37.389, ["Seville", "Sevilla", "塞维利亚"]],
  ["lisbon", "Lisbon", "pt", -9.139, 38.722, ["Lisbon", "里斯本"]],
  ["porto", "Porto", "pt", -8.629, 41.158, ["Porto", "波尔图"]],
  ["amsterdam", "Amsterdam", "nl", 4.904, 52.368, ["Amsterdam", "阿姆斯特丹"]],
  ["rotterdam", "Rotterdam", "nl", 4.478, 51.924, ["Rotterdam", "鹿特丹"]],
  ["the-hague", "The Hague", "nl", 4.301, 52.071, ["The Hague", "海牙"]],
  ["brussels", "Brussels", "be", 4.352, 50.850, ["Brussels", "布鲁塞尔"]],
  ["antwerp", "Antwerp", "be", 4.403, 51.219, ["Antwerp", "安特卫普"]],
  ["zurich", "Zurich", "ch", 8.542, 47.377, ["Zurich", "Zürich", "苏黎世"]],
  ["geneva", "Geneva", "ch", 6.143, 46.204, ["Geneva", "日内瓦"]],
  ["bern", "Bern", "ch", 7.447, 46.948, ["Bern", "伯尔尼"]],
  ["basel", "Basel", "ch", 7.589, 47.559, ["Basel", "巴塞尔"]],
  ["vienna", "Vienna", "at", 16.374, 48.208, ["Vienna", "维也纳"]],
  ["prague", "Prague", "cz", 14.438, 50.076, ["Prague", "布拉格"]],
  ["warsaw", "Warsaw", "pl", 21.012, 52.230, ["Warsaw", "华沙"]],
  ["krakow", "Krakow", "pl", 19.945, 50.065, ["Krakow", "Kraków", "克拉科夫"]],
  ["budapest", "Budapest", "hu", 19.040, 47.498, ["Budapest", "布达佩斯"]],
  ["bucharest", "Bucharest", "ro", 26.103, 44.427, ["Bucharest", "布加勒斯特"]],
  ["sofia", "Sofia", "bg", 23.322, 42.698, ["Sofia", "索非亚"]],
  ["athens", "Athens", "gr", 23.728, 37.984, ["Athens", "雅典"]],
  ["thessaloniki", "Thessaloniki", "gr", 22.944, 40.640, ["Thessaloniki"]],
  ["stockholm", "Stockholm", "se", 18.069, 59.329, ["Stockholm", "斯德哥尔摩"]],
  ["gothenburg", "Gothenburg", "se", 11.975, 57.709, ["Gothenburg", "哥德堡"]],
  ["oslo", "Oslo", "no", 10.752, 59.914, ["Oslo", "奥斯陆"]],
  ["copenhagen", "Copenhagen", "dk", 12.568, 55.676, ["Copenhagen", "哥本哈根"]],
  ["helsinki", "Helsinki", "fi", 24.938, 60.170, ["Helsinki", "赫尔辛基"]],
  ["reykjavik", "Reykjavík", "is", -21.943, 64.147, ["Reykjavik", "Reykjavík", "雷克雅未克"]],
  ["tallinn", "Tallinn", "ee", 24.754, 59.437, ["Tallinn", "塔林"]],
  ["riga", "Riga", "lv", 24.105, 56.950, ["Riga", "里加"]],
  ["vilnius", "Vilnius", "lt", 25.280, 54.687, ["Vilnius", "维尔纽斯"]],
  ["kyiv", "Kyiv", "ua", 30.523, 50.450, ["Kyiv", "Kiev", "基辅"]],
  ["odesa", "Odesa", "ua", 30.723, 46.483, ["Odesa", "Odessa", "敖德萨"]],
  ["lviv", "Lviv", "ua", 24.030, 49.839, ["Lviv", "利沃夫"]],
  ["kharkiv", "Kharkiv", "ua", 36.230, 49.994, ["Kharkiv", "哈尔科夫"]],
  ["minsk", "Minsk", "by", 27.562, 53.901, ["Minsk", "明斯克"]],
  ["chisinau", "Chișinău", "md", 28.864, 47.011, ["Chisinau", "Chișinău"]],
  ["bratislava", "Bratislava", "sk", 17.108, 48.149, ["Bratislava", "布拉迪斯拉发"]],
  ["zagreb", "Zagreb", "hr", 15.982, 45.815, ["Zagreb", "萨格勒布"]],
  ["ljubljana", "Ljubljana", "si", 14.506, 46.057, ["Ljubljana"]],
  ["belgrade", "Belgrade", "rs", 20.449, 44.787, ["Belgrade", "贝尔格莱德"]],
  ["sarajevo", "Sarajevo", "ba", 18.413, 43.856, ["Sarajevo", "萨拉热窝"]],
  ["podgorica", "Podgorica", "me", 19.263, 42.441, ["Podgorica"]],
  ["tirana", "Tirana", "al", 19.819, 41.328, ["Tirana"]],
  ["skopje", "Skopje", "mk", 21.425, 41.998, ["Skopje"]],
  ["pristina", "Pristina", "xk", 21.166, 42.663, ["Pristina"]],
  ["nicosia", "Nicosia", "cy", 33.382, 35.186, ["Nicosia"]],
  ["valletta", "Valletta", "mt", 14.515, 35.899, ["Valletta"]],
  ["luxembourg-city", "Luxembourg City", "lu", 6.132, 49.612, ["Luxembourg City"]],
  ["moscow", "Moscow", "ru", 37.617, 55.756, ["Moscow", "莫斯科"]],
  ["st-petersburg", "Saint Petersburg", "ru", 30.335, 59.934, ["Saint Petersburg", "St. Petersburg", "圣彼得堡"]],
  ["vladivostok", "Vladivostok", "ru", 131.886, 43.116, ["Vladivostok", "海参崴", "符拉迪沃斯托克"]],
  ["novosibirsk", "Novosibirsk", "ru", 82.920, 55.008, ["Novosibirsk", "新西伯利亚"]],

  // East, Southeast & South Asia
  ["tokyo", "Tokyo", "jp", 139.692, 35.690, ["Tokyo", "东京"]],
  ["osaka", "Osaka", "jp", 135.502, 34.694, ["Osaka", "大阪"]],
  ["kyoto", "Kyoto", "jp", 135.768, 35.012, ["Kyoto", "京都"]],
  ["yokohama", "Yokohama", "jp", 139.638, 35.444, ["Yokohama", "横滨"]],
  ["nagoya", "Nagoya", "jp", 136.907, 35.181, ["Nagoya", "名古屋"]],
  ["sapporo", "Sapporo", "jp", 141.354, 43.062, ["Sapporo", "札幌"]],
  ["fukuoka", "Fukuoka", "jp", 130.402, 33.590, ["Fukuoka", "福冈"]],
  ["hiroshima", "Hiroshima", "jp", 132.455, 34.385, ["Hiroshima", "广岛"]],
  ["seoul", "Seoul", "kr", 126.978, 37.567, ["Seoul", "首尔"]],
  ["busan", "Busan", "kr", 129.076, 35.180, ["Busan", "釜山"]],
  ["incheon", "Incheon", "kr", 126.705, 37.456, ["Incheon", "仁川"]],
  ["pyongyang", "Pyongyang", "kp", 125.763, 39.039, ["Pyongyang", "平壤"]],
  ["taipei", "Taipei", "tw", 121.565, 25.033, ["Taipei", "台北", "臺北"]],
  ["kaohsiung", "Kaohsiung", "tw", 120.301, 22.627, ["Kaohsiung", "高雄"]],
  ["bangkok", "Bangkok", "th", 100.502, 13.756, ["Bangkok", "曼谷"]],
  ["chiang-mai", "Chiang Mai", "th", 98.985, 18.788, ["Chiang Mai", "清迈"]],
  ["hanoi", "Hanoi", "vn", 105.834, 21.028, ["Hanoi", "河内"]],
  ["ho-chi-minh", "Ho Chi Minh City", "vn", 106.630, 10.823, ["Ho Chi Minh City", "Saigon", "胡志明市"]],
  ["manila", "Manila", "ph", 120.984, 14.600, ["Manila", "马尼拉"]],
  ["jakarta", "Jakarta", "id", 106.846, -6.209, ["Jakarta", "雅加达"]],
  ["bali", "Bali", "id", 115.189, -8.410, ["Bali", "巴厘岛"]],
  ["surabaya", "Surabaya", "id", 112.752, -7.258, ["Surabaya", "泗水"]],
  ["kuala-lumpur", "Kuala Lumpur", "my", 101.687, 3.139, ["Kuala Lumpur", "吉隆坡"]],
  ["penang", "Penang", "my", 100.333, 5.414, ["Penang", "槟城"]],
  ["phnom-penh", "Phnom Penh", "kh", 104.928, 11.556, ["Phnom Penh", "金边"]],
  ["vientiane", "Vientiane", "la", 102.633, 17.976, ["Vientiane", "万象"]],
  ["yangon", "Yangon", "mm", 96.195, 16.866, ["Yangon", "Rangoon", "仰光"]],
  ["naypyidaw", "Naypyidaw", "mm", 96.079, 19.763, ["Naypyidaw", "内比都"]],
  ["new-delhi", "New Delhi", "in", 77.209, 28.614, ["New Delhi", "Delhi", "新德里", "德里"]],
  ["mumbai", "Mumbai", "in", 72.878, 19.076, ["Mumbai", "Bombay", "孟买"]],
  ["bengaluru", "Bengaluru", "in", 77.595, 12.972, ["Bengaluru", "Bangalore", "班加罗尔"]],
  ["chennai", "Chennai", "in", 80.271, 13.083, ["Chennai", "金奈"]],
  ["kolkata", "Kolkata", "in", 88.364, 22.573, ["Kolkata", "Calcutta", "加尔各答"]],
  ["hyderabad", "Hyderabad", "in", 78.487, 17.385, ["Hyderabad", "海得拉巴"]],
  ["pune", "Pune", "in", 73.857, 18.520, ["Pune", "浦那"]],
  ["ahmedabad", "Ahmedabad", "in", 72.571, 23.023, ["Ahmedabad"]],
  ["karachi", "Karachi", "pk", 67.001, 24.861, ["Karachi", "卡拉奇"]],
  ["lahore", "Lahore", "pk", 74.359, 31.520, ["Lahore", "拉合尔"]],
  ["islamabad", "Islamabad", "pk", 73.048, 33.684, ["Islamabad", "伊斯兰堡"]],
  ["dhaka", "Dhaka", "bd", 90.413, 23.810, ["Dhaka", "达卡"]],
  ["colombo", "Colombo", "lk", 79.861, 6.927, ["Colombo", "科伦坡"]],
  ["kathmandu", "Kathmandu", "np", 85.324, 27.717, ["Kathmandu", "加德满都"]],
  ["thimphu", "Thimphu", "bt", 89.639, 27.473, ["Thimphu"]],
  ["kabul", "Kabul", "af", 69.208, 34.555, ["Kabul", "喀布尔"]],
  ["tashkent", "Tashkent", "uz", 69.240, 41.300, ["Tashkent", "塔什干"]],
  ["samarkand", "Samarkand", "uz", 66.959, 39.654, ["Samarkand", "撒马尔罕"]],
  ["almaty", "Almaty", "kz", 76.851, 43.222, ["Almaty", "阿拉木图"]],
  ["astana", "Astana", "kz", 71.470, 51.161, ["Astana", "阿斯塔纳"]],
  ["bishkek", "Bishkek", "kg", 74.569, 42.875, ["Bishkek", "比什凯克"]],
  ["dushanbe", "Dushanbe", "tj", 68.774, 38.560, ["Dushanbe", "杜尚别"]],
  ["ashgabat", "Ashgabat", "tm", 58.326, 37.960, ["Ashgabat", "阿什哈巴德"]],
  ["ulaanbaatar", "Ulaanbaatar", "mn", 106.906, 47.886, ["Ulaanbaatar", "乌兰巴托"]],
  ["baku", "Baku", "az", 49.867, 40.409, ["Baku", "巴库"]],
  ["tbilisi", "Tbilisi", "ge", 44.827, 41.715, ["Tbilisi", "第比利斯"]],
  ["yerevan", "Yerevan", "am", 44.515, 40.187, ["Yerevan", "埃里温"]],

  // Middle East
  ["istanbul", "Istanbul", "tr", 28.978, 41.008, ["Istanbul", "伊斯坦布尔"]],
  ["ankara", "Ankara", "tr", 32.860, 39.933, ["Ankara", "安卡拉"]],
  ["izmir", "Izmir", "tr", 27.143, 38.424, ["Izmir", "İzmir", "伊兹密尔"]],
  ["tehran", "Tehran", "ir", 51.389, 35.689, ["Tehran", "德黑兰"]],
  ["isfahan", "Isfahan", "ir", 51.666, 32.654, ["Isfahan", "伊斯法罕"]],
  ["baghdad", "Baghdad", "iq", 44.366, 33.315, ["Baghdad", "巴格达"]],
  ["mosul", "Mosul", "iq", 43.158, 36.349, ["Mosul", "摩苏尔"]],
  ["basra", "Basra", "iq", 47.783, 30.508, ["Basra", "巴士拉"]],
  ["damascus", "Damascus", "sy", 36.277, 33.514, ["Damascus", "大马士革"]],
  ["aleppo", "Aleppo", "sy", 37.134, 36.202, ["Aleppo", "阿勒颇"]],
  ["beirut", "Beirut", "lb", 35.502, 33.894, ["Beirut", "贝鲁特"]],
  ["amman", "Amman", "jo", 35.911, 31.954, ["Amman", "安曼"]],
  ["jerusalem", "Jerusalem", "il", 35.214, 31.768, ["Jerusalem", "耶路撒冷"]],
  ["tel-aviv", "Tel Aviv", "il", 34.782, 32.085, ["Tel Aviv", "特拉维夫"]],
  ["haifa", "Haifa", "il", 34.990, 32.794, ["Haifa", "海法"]],
  ["gaza-city", "Gaza City", "ps", 34.467, 31.502, ["Gaza City", "加沙城"]],
  ["riyadh", "Riyadh", "sa", 46.675, 24.714, ["Riyadh", "利雅得"]],
  ["jeddah", "Jeddah", "sa", 39.198, 21.486, ["Jeddah", "吉达"]],
  ["mecca", "Mecca", "sa", 39.858, 21.389, ["Mecca", "Makkah", "麦加"]],
  ["medina", "Medina", "sa", 39.569, 24.525, ["Medina", "麦地那"]],
  ["dubai", "Dubai", "ae", 55.271, 25.205, ["Dubai", "迪拜"]],
  ["abu-dhabi", "Abu Dhabi", "ae", 54.377, 24.454, ["Abu Dhabi", "阿布扎比"]],
  ["doha", "Doha", "qa", 51.531, 25.285, ["Doha", "多哈"]],
  ["kuwait-city", "Kuwait City", "kw", 47.977, 29.376, ["Kuwait City", "科威特城"]],
  ["manama", "Manama", "bh", 50.586, 26.229, ["Manama", "麦纳麦"]],
  ["muscat", "Muscat", "om", 58.406, 23.588, ["Muscat", "马斯喀特"]],
  ["sanaa", "Sanaa", "ye", 44.207, 15.369, ["Sanaa", "Sana'a", "萨那"]],
  ["aden", "Aden", "ye", 45.019, 12.785, ["Aden", "亚丁"]],

  // Africa
  ["cairo", "Cairo", "eg", 31.236, 30.044, ["Cairo", "开罗"]],
  ["alexandria", "Alexandria", "eg", 29.919, 31.200, ["Alexandria", "亚历山大港"]],
  ["luxor", "Luxor", "eg", 32.640, 25.687, ["Luxor", "卢克索"]],
  ["casablanca", "Casablanca", "ma", -7.590, 33.573, ["Casablanca", "卡萨布兰卡"]],
  ["rabat", "Rabat", "ma", -6.849, 34.021, ["Rabat", "拉巴特"]],
  ["marrakesh", "Marrakesh", "ma", -7.981, 31.630, ["Marrakesh", "Marrakech", "马拉喀什"]],
  ["fez", "Fez", "ma", -5.008, 34.018, ["Fez", "Fès", "非斯"]],
  ["algiers", "Algiers", "dz", 3.059, 36.754, ["Algiers", "阿尔及尔"]],
  ["tunis", "Tunis", "tn", 10.182, 36.807, ["Tunis", "突尼斯市"]],
  ["tripoli", "Tripoli", "ly", 13.191, 32.887, ["Tripoli", "的黎波里"]],
  ["benghazi", "Benghazi", "ly", 20.087, 32.119, ["Benghazi", "班加西"]],
  ["khartoum", "Khartoum", "sd", 32.560, 15.501, ["Khartoum", "喀土穆"]],
  ["addis-ababa", "Addis Ababa", "et", 38.747, 9.032, ["Addis Ababa", "亚的斯亚贝巴"]],
  ["nairobi", "Nairobi", "ke", 36.822, -1.292, ["Nairobi", "内罗毕"]],
  ["mombasa", "Mombasa", "ke", 39.668, -4.044, ["Mombasa"]],
  ["kampala", "Kampala", "ug", 32.583, 0.348, ["Kampala", "坎帕拉"]],
  ["kigali", "Kigali", "rw", 30.062, -1.944, ["Kigali", "基加利"]],
  ["dar-es-salaam", "Dar es Salaam", "tz", 39.208, -6.792, ["Dar es Salaam", "达累斯萨拉姆"]],
  ["dodoma", "Dodoma", "tz", 35.752, -6.163, ["Dodoma"]],
  ["lagos", "Lagos", "ng", 3.379, 6.524, ["Lagos", "拉各斯"]],
  ["abuja", "Abuja", "ng", 7.495, 9.058, ["Abuja", "阿布贾"]],
  ["accra", "Accra", "gh", -0.187, 5.604, ["Accra", "阿克拉"]],
  ["dakar", "Dakar", "sn", -17.447, 14.717, ["Dakar", "达喀尔"]],
  ["abidjan", "Abidjan", "ci", -4.008, 5.360, ["Abidjan", "阿比让"]],
  ["kinshasa", "Kinshasa", "cd", 15.266, -4.442, ["Kinshasa", "金沙萨"]],
  ["luanda", "Luanda", "ao", 13.234, -8.838, ["Luanda", "罗安达"]],
  ["lusaka", "Lusaka", "zm", 28.323, -15.388, ["Lusaka", "卢萨卡"]],
  ["harare", "Harare", "zw", 31.053, -17.825, ["Harare", "哈拉雷"]],
  ["gaborone", "Gaborone", "bw", 25.923, -24.628, ["Gaborone", "哈博罗内"]],
  ["windhoek", "Windhoek", "na", 17.066, -22.561, ["Windhoek", "温得和克"]],
  ["maputo", "Maputo", "mz", 32.573, -25.969, ["Maputo", "马普托"]],
  ["antananarivo", "Antananarivo", "mg", 47.508, -18.879, ["Antananarivo"]],
  ["johannesburg", "Johannesburg", "za", 28.047, -26.204, ["Johannesburg", "约翰内斯堡"]],
  ["cape-town", "Cape Town", "za", 18.424, -33.925, ["Cape Town", "开普敦"]],
  ["pretoria", "Pretoria", "za", 28.229, -25.748, ["Pretoria", "比勒陀利亚"]],
  ["durban", "Durban", "za", 31.022, -29.859, ["Durban", "德班"]],

  // Latin America & Caribbean
  ["mexico-city", "Mexico City", "mx", -99.133, 19.433, ["Mexico City", "墨西哥城"]],
  ["guadalajara", "Guadalajara", "mx", -103.350, 20.660, ["Guadalajara", "瓜达拉哈拉"]],
  ["monterrey", "Monterrey", "mx", -100.316, 25.687, ["Monterrey", "蒙特雷"]],
  ["oaxaca", "Oaxaca", "mx", -96.726, 17.073, ["Oaxaca", "瓦哈卡"]],
  ["cancun", "Cancún", "mx", -86.852, 21.162, ["Cancun", "Cancún", "坎昆"]],
  ["tijuana", "Tijuana", "mx", -117.038, 32.515, ["Tijuana", "蒂华纳"]],
  ["havana", "Havana", "cu", -82.367, 23.114, ["Havana", "哈瓦那"]],
  ["santo-domingo", "Santo Domingo", "do", -69.931, 18.486, ["Santo Domingo", "圣多明各"]],
  ["port-au-prince", "Port-au-Prince", "ht", -72.307, 18.594, ["Port-au-Prince", "太子港"]],
  ["san-juan", "San Juan", "pr", -66.106, 18.466, ["San Juan", "圣胡安"]],
  ["kingston", "Kingston", "jm", -76.809, 18.018, ["Kingston", "金斯敦"]],
  ["nassau", "Nassau", "bs", -77.355, 25.048, ["Nassau", "拿骚"]],
  ["guatemala-city", "Guatemala City", "gt", -90.507, 14.635, ["Guatemala City", "危地马拉城"]],
  ["san-salvador", "San Salvador", "sv", -89.218, 13.693, ["San Salvador", "圣萨尔瓦多"]],
  ["tegucigalpa", "Tegucigalpa", "hn", -87.192, 14.072, ["Tegucigalpa"]],
  ["managua", "Managua", "ni", -86.236, 12.115, ["Managua", "马那瓜"]],
  ["san-jose-cr", "San José", "cr", -84.091, 9.928, ["San José"]],
  ["panama-city", "Panama City", "pa", -79.519, 8.982, ["Panama City", "巴拿马城"]],
  ["bogota", "Bogotá", "co", -74.072, 4.711, ["Bogota", "Bogotá", "波哥大"]],
  ["medellin", "Medellín", "co", -75.564, 6.244, ["Medellin", "Medellín", "麦德林"]],
  ["cartagena", "Cartagena", "co", -75.479, 10.391, ["Cartagena"]],
  ["caracas", "Caracas", "ve", -66.904, 10.481, ["Caracas", "加拉加斯"]],
  ["quito", "Quito", "ec", -78.468, -0.181, ["Quito", "基多"]],
  ["guayaquil", "Guayaquil", "ec", -79.922, -2.189, ["Guayaquil"]],
  ["lima", "Lima", "pe", -77.043, -12.046, ["Lima", "利马"]],
  ["cusco", "Cusco", "pe", -71.968, -13.532, ["Cusco", "Cuzco", "库斯科"]],
  ["la-paz", "La Paz", "bo", -68.119, -16.490, ["La Paz", "拉巴斯"]],
  ["sucre", "Sucre", "bo", -65.263, -19.019, ["Sucre", "苏克雷"]],
  ["santiago", "Santiago", "cl", -70.669, -33.449, ["Santiago", "圣地亚哥"]],
  ["buenos-aires", "Buenos Aires", "ar", -58.382, -34.604, ["Buenos Aires", "布宜诺斯艾利斯"]],
  ["cordoba", "Córdoba", "ar", -64.189, -31.420, ["Córdoba"]],
  ["mendoza", "Mendoza", "ar", -68.846, -32.890, ["Mendoza"]],
  ["montevideo", "Montevideo", "uy", -56.165, -34.901, ["Montevideo", "蒙得维的亚"]],
  ["asuncion", "Asunción", "py", -57.576, -25.264, ["Asuncion", "Asunción", "亚松森"]],
  ["brasilia", "Brasília", "br", -47.929, -15.794, ["Brasilia", "Brasília", "巴西利亚"]],
  ["sao-paulo", "São Paulo", "br", -46.633, -23.551, ["Sao Paulo", "São Paulo", "圣保罗"]],
  ["rio-de-janeiro", "Rio de Janeiro", "br", -43.173, -22.907, ["Rio de Janeiro", "里约热内卢"]],
  ["belo-horizonte", "Belo Horizonte", "br", -43.938, -19.917, ["Belo Horizonte"]],

  // Oceania
  ["sydney", "Sydney", "au", 151.209, -33.869, ["Sydney", "悉尼"]],
  ["melbourne", "Melbourne", "au", 144.963, -37.814, ["Melbourne", "墨尔本"]],
  ["brisbane", "Brisbane", "au", 153.026, -27.470, ["Brisbane", "布里斯班"]],
  ["perth", "Perth", "au", 115.861, -31.951, ["Perth", "珀斯"]],
  ["adelaide", "Adelaide", "au", 138.601, -34.929, ["Adelaide", "阿德莱德"]],
  ["canberra", "Canberra", "au", 149.130, -35.281, ["Canberra", "堪培拉"]],
  ["auckland", "Auckland", "nz", 174.763, -36.849, ["Auckland", "奥克兰"]],
  ["wellington", "Wellington", "nz", 174.776, -41.287, ["Wellington", "惠灵顿"]],
  ["christchurch", "Christchurch", "nz", 172.636, -43.532, ["Christchurch", "基督城"]],
  ["suva", "Suva", "fj", 178.442, -18.142, ["Suva", "苏瓦"]],
  ["port-moresby", "Port Moresby", "pg", 147.180, -9.444, ["Port Moresby", "莫尔兹比港"]],
];

for (const [slug, name, countryCode, lon, lat, aliases] of RAW_WORLD_CITIES) {
  const parent = COUNTRY_META[countryCode];
  if (!parent) continue;
  const id = `city-${slug}`;
  PLACE_META[id] = {
    kind: "world_city",
    flagCode: countryCode,
    showInlineFlag: false,
    name,
    subtitle: parent.name,
    regionLabel: parent.regionLabel,
    continent: parent.continent,
    iso: parent.iso,
    dot: [lon, lat],
  };
  for (const alias of aliases) {
    if (!(alias in PLACE_ALIASES)) PLACE_ALIASES[alias] = id;
  }
}

/* ---------- Lazy Atlas Loaders & Geometry Decoders ---------- */

const atlasPromises = {};
const svgCache = new Map();

function computeRingsBbox(rings) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const r of rings) {
    for (const [lon, lat] of r) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, maxLon, minLat, maxLat];
}

function decodeTopoJson(topo, objectKey, padLen) {
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
  for (const g of topo.objects[objectKey].geometries) {
    const id = String(g.id ?? "").padStart(padLen, "0");
    let rings = [];
    if (g.type === "Polygon") {
      rings = g.arcs.map(stitchRing);
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.arcs) {
        for (const r of poly) rings.push(stitchRing(r));
      }
    }
    if (!rings.length) continue;
    features.push({ id, rings, bbox: computeRingsBbox(rings) });
  }
  return features;
}

function decodeGeoJson(geo, useNameKey = false) {
  const features = [];
  for (const f of geo.features || []) {
    const id = useNameKey
      ? String(f.properties?.name ?? f.id ?? "")
      : String(f.properties?.id ?? f.id ?? "").slice(0, 2);
    const geom = f.geometry;
    if (!geom) continue;
    let rings = [];
    if (geom.type === "Polygon") {
      rings = geom.coordinates || [];
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates || []) {
        for (const r of poly) rings.push(r);
      }
    }
    if (!rings.length) continue;
    features.push({ id, rings, bbox: computeRingsBbox(rings) });
  }
  return features;
}

function loadAtlas(kind) {
  const key =
    kind === "us_state" || kind === "ca_city" || kind === "us_city"
      ? "us"
      : kind === "cn_province" || kind === "gd_city" || kind === "cn_city"
      ? "cn"
      : kind === "ca_province" || kind === "ca_prov_city"
      ? "ca"
      : "world";

  if (!atlasPromises[key]) {
    if (key === "world") {
      atlasPromises[key] = fetch(WORLD_ATLAS_URL)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((t) => decodeTopoJson(t, "countries", 3));
    } else if (key === "us") {
      atlasPromises[key] = fetch(US_ATLAS_URL)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((t) => decodeTopoJson(t, "states", 2));
    } else if (key === "ca") {
      atlasPromises[key] = fetch(CA_PROVINCES_GEO_URL)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((g) => decodeGeoJson(g, true));
    } else {
      atlasPromises[key] = fetch(CN_GEO_URL)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((g) => decodeGeoJson(g, false));
    }
  }
  return atlasPromises[key];
}

export function loadWorldAtlas() {
  return loadAtlas("world");
}

function buildPlaceSvg(features, placeId) {
  const meta = PLACE_META[placeId];
  if (!meta) return "";

  let bounds;
  let targetIds = new Set();

  if (meta.kind === "country" || meta.kind === "continent") {
    bounds = (CONTINENT_META[meta.continent] || CONTINENT_META.world).bounds;
    if (Array.isArray(meta.iso)) meta.iso.forEach((x) => targetIds.add(x));
    else if (meta.iso) targetIds.add(meta.iso);
  } else if (meta.kind === "world_city") {
    if (Array.isArray(meta.iso)) meta.iso.forEach((x) => targetIds.add(x));
    else if (meta.iso) targetIds.add(meta.iso);
    const parentFeat = typeof meta.iso === "string" ? features.find((f) => f.id === meta.iso) : null;
    const [dotLon, dotLat] = meta.dot || [0, 0];
    if (parentFeat) {
      const [bMinLon, bMaxLon, bMinLat, bMaxLat] = parentFeat.bbox;
      const lonSpan = bMaxLon - bMinLon;
      const latSpan = bMaxLat - bMinLat;
      // For sprawling or overseas-territory countries (Russia, France, USA, etc.), frame regionally around the city
      if (lonSpan > 75 || latSpan > 50 || dotLon < bMinLon - 2 || dotLon > bMaxLon + 2) {
        bounds = [dotLon - 18, dotLon + 18, Math.max(-58, dotLat - 12), Math.min(78, dotLat + 12)];
      } else {
        const padLon = Math.max(3.5, lonSpan * 0.22);
        const padLat = Math.max(2.5, latSpan * 0.22);
        bounds = [bMinLon - padLon, bMaxLon + padLon, Math.max(-58, bMinLat - padLat), Math.min(78, bMaxLat + padLat)];
      }
    } else {
      bounds = [dotLon - 12, dotLon + 12, Math.max(-58, dotLat - 8), Math.min(78, dotLat + 8)];
    }
  } else if (meta.kind === "us_state") {
    bounds = meta.fips === "02" || meta.fips === "15" ? US_FULL_BOUNDS : US_BOUNDS;
    targetIds.add(meta.fips);
  } else if (meta.kind === "cn_province") {
    bounds = CN_BOUNDS;
    targetIds.add(meta.gbId);
  } else if (meta.kind === "ca_province") {
    bounds = CA_BOUNDS;
    targetIds.add(meta.geoName);
  } else if (meta.kind === "ca_prov_city") {
    targetIds.add(meta.geoName);
    const parentFeat = features.find((f) => f.id === meta.geoName);
    if (parentFeat) {
      const [bMinLon, bMaxLon, bMinLat, bMaxLat] = parentFeat.bbox;
      const padLon = Math.max(1.2, (bMaxLon - bMinLon) * 0.14);
      const padLat = Math.max(1.0, (bMaxLat - bMinLat) * 0.14);
      bounds = [bMinLon - padLon, bMaxLon + padLon, bMinLat - padLat, bMaxLat + padLat];
    } else {
      bounds = CA_BOUNDS;
    }
  } else {
    // City-level: zoom directly onto its parent state/province contour
    const isUsCity = meta.kind === "ca_city" || meta.kind === "us_city";
    const parentId = isUsCity ? meta.fips : meta.gbId;
    targetIds.add(parentId);
    const parentFeat = features.find((f) => f.id === parentId);
    if (isUsCity && meta.fips === "02") {
      // Alaska crosses the antimeridian, so clamp to main mainland/SE panhandle bounds
      bounds = [-172, -129, 51, 72];
    } else if (parentFeat) {
      const [bMinLon, bMaxLon, bMinLat, bMaxLat] = parentFeat.bbox;
      const padLon = Math.max(0.4, (bMaxLon - bMinLon) * 0.1);
      const padLat = Math.max(0.4, (bMaxLat - bMinLat) * 0.1);
      bounds = [bMinLon - padLon, bMaxLon + padLon, bMinLat - padLat, bMaxLat + padLat];
    } else {
      bounds = isUsCity ? US_BOUNDS : CN_BOUNDS;
    }
  }

  const [minLon, maxLon, minLat, maxLat] = bounds;
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

  const clipId = `cmap-clip-${placeId.replace(/[^a-z0-9-]/gi, "")}`;
  const isCityKind =
    meta.kind === "ca_city" ||
    meta.kind === "gd_city" ||
    meta.kind === "us_city" ||
    meta.kind === "cn_city" ||
    meta.kind === "ca_prov_city" ||
    meta.kind === "world_city";
  const targetClass = isCityKind ? "cmap-target is-region" : "cmap-target";
  return `
    <svg class="cmap-svg" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <clipPath id="${clipId}"><rect x="0" y="0" width="${w}" height="${h}" rx="4"/></clipPath>
      <g clip-path="url(#${clipId})">
        <path class="cmap-land" d="${bgPaths}"/>
        ${fgPaths ? `<path class="${targetClass}" d="${fgPaths}"/>` : ""}
        ${dotSvg}
      </g>
    </svg>
  `;
}

const PLACE_WIKI_OVERRIDES = {
  ge: "Georgia_(country)",
  "us-13": "Georgia_(U.S._state)",
  "us-36": "New_York_(state)",
  "us-53": "Washington_(state)",
  "us-11": "Washington,_D.C.",
  "us-city-nyc": "New_York_City",
  "ca-silicon-valley": "Silicon_Valley",
  "ca-bay-area": "San_Francisco_Bay_Area",
  "can-city-quebec-city": "Quebec_City",
  "city-san-jose-cr": "San_José,_Costa_Rica",
  "city-cordoba": "Córdoba,_Argentina",
  "city-santiago": "Santiago",
  "city-alexandria": "Alexandria",
  "city-fez": "Fez,_Morocco",
  "city-st-petersburg": "Saint_Petersburg",
};

function buildPlaceWikiUrl(placeId, meta) {
  if (!meta) return "";
  if (PLACE_WIKI_OVERRIDES[placeId]) {
    return `https://en.wikipedia.org/wiki/${PLACE_WIKI_OVERRIDES[placeId]}`;
  }
  const title =
    (meta.kind === "ca_city" || meta.kind === "us_city" || meta.kind === "ca_prov_city") && meta.subtitle
      ? `${meta.name}, ${meta.subtitle}`
      : meta.name;
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, "_"))}`;
}

export function initCountryMapTooltip(escapeHtml, renderFlagImg, getLeader = null) {
  const card = document.createElement("div");
  card.className = "country-map-tip hidden";
  card.setAttribute("role", "tooltip");
  document.body.appendChild(card);

  let activeEl = null;
  let hideTimer = null;

  const hide = () => {
    card.classList.add("hidden");
    card.classList.remove("is-touch");
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

  const show = async (el, includeWikiLink = false) => {
    clearTimeout(hideTimer);
    const placeId = el?.dataset?.countryCode;
    const meta = placeId ? PLACE_META[placeId] : null;
    if (!meta) return;
    activeEl = el;

    const cachedSvg = svgCache.get(placeId);
    const isCity =
      meta.kind === "ca_city" ||
      meta.kind === "gd_city" ||
      meta.kind === "us_city" ||
      meta.kind === "cn_city" ||
      meta.kind === "ca_prov_city" ||
      meta.kind === "world_city";
    const flagHtml = meta.flagCode ? renderFlagImg(meta.flagCode) : "";
    const wikiUrl = buildPlaceWikiUrl(placeId, meta);
    const wikiLinkHtml =
      includeWikiLink && wikiUrl
        ? `<div class="tip-wiki-row"><a class="tip-wiki-link" href="${wikiUrl}" target="_blank" rel="noopener noreferrer">Wikipedia &nearr;</a></div>`
        : "";
    const leaderText = (typeof getLeader === "function" ? getLeader(placeId) : null) || meta.leader || "";
    const leaderHtml = leaderText
      ? `<div class="cmap-leader"><span class="cmap-leader-k">Leader</span><span class="cmap-leader-v">${escapeHtml(leaderText)}</span></div>`
      : "";
    const footerHtml = isCity
      ? `<div class="cmap-title is-city">
           <span class="cmap-title-left">${flagHtml}<span>${escapeHtml(meta.name)}</span></span>
           <span class="cmap-cont">${escapeHtml(meta.subtitle)}</span>
         </div>${wikiLinkHtml}`
      : `<div class="cmap-title">${flagHtml}<span>${escapeHtml(meta.name)}</span></div>
         <div class="cmap-meta"><strong>${escapeHtml(meta.subtitle)}</strong><span class="cmap-cont">${escapeHtml(meta.regionLabel)}</span></div>${leaderHtml}${wikiLinkHtml}`;
    card.innerHTML = `
      <div class="cmap-stage">${cachedSvg || `<div class="cmap-loading">Loading map…</div>`}</div>
      <div class="cmap-footer">${footerHtml}</div>
    `;
    card.classList.toggle("is-touch", Boolean(includeWikiLink));
    card.classList.remove("hidden");
    positionCard(el);

    if (!cachedSvg) {
      try {
        const features = await loadAtlas(meta.kind);
        const svg = buildPlaceSvg(features, placeId);
        svgCache.set(placeId, svg);
        if (activeEl === el && !card.classList.contains("hidden")) {
          const stage = card.querySelector(".cmap-stage");
          if (stage) stage.innerHTML = svg;
          positionCard(el);
        }
      } catch {
        const stage = card.querySelector(".cmap-stage");
        if (stage) stage.innerHTML = `<div class="cmap-loading">${escapeHtml(meta.regionLabel)}</div>`;
      }
    }
  };

  const canHover = () => window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
  let lastPointerType = "mouse";

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch" || !canHover()) return;
    const el = e.target.closest(".country-mention[data-country-code]");
    if (el) show(el);
  });

  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch" || !canHover()) return;
    const el = e.target.closest(".country-mention[data-country-code]");
    if (el && el === activeEl) {
      hideTimer = setTimeout(hide, 80);
    }
  });

  document.addEventListener("focusin", (e) => {
    if (lastPointerType === "touch" || !canHover()) return;
    const el = e.target.closest?.(".country-mention[data-country-code]");
    if (el) show(el);
  });

  document.addEventListener("focusout", (e) => {
    if (lastPointerType === "touch" || !canHover()) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    const el = e.target.closest?.(".country-mention[data-country-code]");
    if (el && el === activeEl) hide();
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      lastPointerType = e.pointerType || "mouse";
      if (!card.contains(e.target) && !e.target.closest(".country-mention[data-country-code]") && activeEl) {
        hide();
      }
    },
    { passive: true }
  );

  document.addEventListener("click", (e) => {
    if (card.contains(e.target)) return;
    const el = e.target.closest(".country-mention[data-country-code]");
    if (!el) {
      if (activeEl) hide();
      return;
    }
    const isTouch = lastPointerType === "touch" || !canHover();
    if (!isTouch) {
      const placeId = el.dataset.countryCode;
      const meta = placeId ? PLACE_META[placeId] : null;
      const wikiUrl = buildPlaceWikiUrl(placeId, meta);
      if (wikiUrl) {
        e.preventDefault();
        e.stopPropagation();
        window.open(wikiUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (activeEl === el && !card.classList.contains("hidden")) {
      hide();
    } else {
      show(el, true);
    }
  });

  window.addEventListener("scroll", hide, { passive: true });
}

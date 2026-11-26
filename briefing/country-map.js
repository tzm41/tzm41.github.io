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

function decodeGeoJson(geo) {
  const features = [];
  for (const f of geo.features || []) {
    const id = String(f.properties?.id ?? f.id ?? "").slice(0, 2);
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
    } else {
      atlasPromises[key] = fetch(CN_GEO_URL)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(decodeGeoJson);
    }
  }
  return atlasPromises[key];
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
  } else if (meta.kind === "us_state") {
    bounds = meta.fips === "02" || meta.fips === "15" ? US_FULL_BOUNDS : US_BOUNDS;
    targetIds.add(meta.fips);
  } else if (meta.kind === "cn_province") {
    bounds = CN_BOUNDS;
    targetIds.add(meta.gbId);
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
    meta.kind === "cn_city";
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
    const placeId = el?.dataset?.countryCode;
    const meta = placeId ? PLACE_META[placeId] : null;
    if (!meta) return;
    activeEl = el;

    const cachedSvg = svgCache.get(placeId);
    const isCity =
      meta.kind === "ca_city" ||
      meta.kind === "gd_city" ||
      meta.kind === "us_city" ||
      meta.kind === "cn_city";
    const flagHtml = meta.flagCode ? renderFlagImg(meta.flagCode) : "";
    const footerHtml = isCity
      ? `<div class="cmap-title is-city">
           <span class="cmap-title-left">${flagHtml}<span>${escapeHtml(meta.name)}</span></span>
           <span class="cmap-cont">${escapeHtml(meta.subtitle)}</span>
         </div>`
      : `<div class="cmap-title">${flagHtml}<span>${escapeHtml(meta.name)}</span></div>
         <div class="cmap-meta"><strong>${escapeHtml(meta.subtitle)}</strong><span class="cmap-cont">${escapeHtml(meta.regionLabel)}</span></div>`;
    card.innerHTML = `
      <div class="cmap-stage">${cachedSvg || `<div class="cmap-loading">Loading map…</div>`}</div>
      <div class="cmap-footer">${footerHtml}</div>
    `;
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
    const el = e.target.closest?.(".country-mention[data-country-code]");
    if (el && el === activeEl) hide();
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      lastPointerType = e.pointerType || "mouse";
      if (!e.target.closest(".country-mention[data-country-code]") && activeEl) {
        hide();
      }
    },
    { passive: true }
  );

  document.addEventListener("click", (e) => {
    if (lastPointerType !== "touch" && canHover()) return;
    const el = e.target.closest(".country-mention[data-country-code]");
    if (!el) {
      if (activeEl) hide();
      return;
    }
    if (activeEl === el && !card.classList.contains("hidden")) {
      hide();
    } else {
      show(el);
    }
  });

  window.addEventListener("scroll", hide, { passive: true });
}

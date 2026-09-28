// Currencies a trip can use, by ISO 4217 code
export const CURRENCIES: Record<string, string> = {
  AED: 'UAE dirham',
  AFN: 'Afghan afghani',
  ALL: 'Albanian lek',
  AMD: 'Armenian dram',
  AOA: 'Angolan kwanza',
  ARS: 'Argentine peso',
  AUD: 'Australian dollar',
  AWG: 'Aruban florin',
  AZN: 'Azerbaijani manat',
  BAM: 'Bosnia-Herzegovina mark',
  BBD: 'Barbadian dollar',
  BDT: 'Bangladeshi taka',
  BHD: 'Bahraini dinar',
  BIF: 'Burundian franc',
  BMD: 'Bermudian dollar',
  BND: 'Brunei dollar',
  BOB: 'Bolivian boliviano',
  BRL: 'Brazilian real',
  BSD: 'Bahamian dollar',
  BTN: 'Bhutanese ngultrum',
  BWP: 'Botswana pula',
  BYN: 'Belarusian ruble',
  BZD: 'Belize dollar',
  CAD: 'Canadian dollar',
  CDF: 'Congolese franc',
  CHF: 'Swiss franc',
  CLP: 'Chilean peso',
  CNY: 'Chinese yuan',
  COP: 'Colombian peso',
  CRC: 'Costa Rican colón',
  CUP: 'Cuban peso',
  CVE: 'Cape Verdean escudo',
  CZK: 'Czech koruna',
  DJF: 'Djiboutian franc',
  DKK: 'Danish krone',
  DOP: 'Dominican peso',
  DZD: 'Algerian dinar',
  EGP: 'Egyptian pound',
  ERN: 'Eritrean nakfa',
  ETB: 'Ethiopian birr',
  EUR: 'Euro',
  FJD: 'Fijian dollar',
  FKP: 'Falkland Islands pound',
  GBP: 'British pound',
  GEL: 'Georgian lari',
  GHS: 'Ghanaian cedi',
  GIP: 'Gibraltar pound',
  GMD: 'Gambian dalasi',
  GNF: 'Guinean franc',
  GTQ: 'Guatemalan quetzal',
  GYD: 'Guyanese dollar',
  HKD: 'Hong Kong dollar',
  HNL: 'Honduran lempira',
  HTG: 'Haitian gourde',
  HUF: 'Hungarian forint',
  IDR: 'Indonesian rupiah',
  ILS: 'Israeli shekel',
  INR: 'Indian rupee',
  IQD: 'Iraqi dinar',
  IRR: 'Iranian rial',
  ISK: 'Icelandic króna',
  JMD: 'Jamaican dollar',
  JOD: 'Jordanian dinar',
  JPY: 'Japanese yen',
  KES: 'Kenyan shilling',
  KGS: 'Kyrgyzstani som',
  KHR: 'Cambodian riel',
  KMF: 'Comorian franc',
  KPW: 'North Korean won',
  KRW: 'South Korean won',
  KWD: 'Kuwaiti dinar',
  KYD: 'Cayman Islands dollar',
  KZT: 'Kazakhstani tenge',
  LAK: 'Lao kip',
  LBP: 'Lebanese pound',
  LKR: 'Sri Lankan rupee',
  LRD: 'Liberian dollar',
  LSL: 'Lesotho loti',
  LYD: 'Libyan dinar',
  MAD: 'Moroccan dirham',
  MDL: 'Moldovan leu',
  MGA: 'Malagasy ariary',
  MKD: 'Macedonian denar',
  MMK: 'Myanmar kyat',
  MNT: 'Mongolian tögrög',
  MOP: 'Macanese pataca',
  MRU: 'Mauritanian ouguiya',
  MUR: 'Mauritian rupee',
  MVR: 'Maldivian rufiyaa',
  MWK: 'Malawian kwacha',
  MXN: 'Mexican peso',
  MYR: 'Malaysian ringgit',
  MZN: 'Mozambican metical',
  NAD: 'Namibian dollar',
  NGN: 'Nigerian naira',
  NIO: 'Nicaraguan córdoba',
  NOK: 'Norwegian krone',
  NPR: 'Nepalese rupee',
  NZD: 'New Zealand dollar',
  OMR: 'Omani rial',
  PAB: 'Panamanian balboa',
  PEN: 'Peruvian sol',
  PGK: 'Papua New Guinean kina',
  PHP: 'Philippine peso',
  PKR: 'Pakistani rupee',
  PLN: 'Polish złoty',
  PYG: 'Paraguayan guaraní',
  QAR: 'Qatari riyal',
  RON: 'Romanian leu',
  RSD: 'Serbian dinar',
  RUB: 'Russian ruble',
  RWF: 'Rwandan franc',
  SAR: 'Saudi riyal',
  SBD: 'Solomon Islands dollar',
  SCR: 'Seychellois rupee',
  SDG: 'Sudanese pound',
  SEK: 'Swedish krona',
  SGD: 'Singapore dollar',
  SHP: 'Saint Helena pound',
  SLE: 'Sierra Leonean leone',
  SOS: 'Somali shilling',
  SRD: 'Surinamese dollar',
  SSP: 'South Sudanese pound',
  STN: 'São Tomé dobra',
  SYP: 'Syrian pound',
  SZL: 'Swazi lilangeni',
  THB: 'Thai baht',
  TJS: 'Tajikistani somoni',
  TMT: 'Turkmen manat',
  TND: 'Tunisian dinar',
  TOP: 'Tongan paʻanga',
  TRY: 'Turkish lira',
  TTD: 'Trinidad and Tobago dollar',
  TWD: 'New Taiwan dollar',
  TZS: 'Tanzanian shilling',
  UAH: 'Ukrainian hryvnia',
  UGX: 'Ugandan shilling',
  USD: 'US dollar',
  UYU: 'Uruguayan peso',
  UZS: 'Uzbekistani som',
  VES: 'Venezuelan bolívar',
  VND: 'Vietnamese đồng',
  VUV: 'Vanuatu vatu',
  WST: 'Samoan tālā',
  XAF: 'Central African CFA franc',
  XCD: 'East Caribbean dollar',
  XCG: 'Caribbean guilder',
  XOF: 'West African CFA franc',
  XPF: 'CFP franc',
  YER: 'Yemeni rial',
  ZAR: 'South African rand',
  ZMW: 'Zambian kwacha',
  ZWG: 'Zimbabwe gold',
};

// Shown first in the picker, before the full list
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CNY', 'KRW', 'THB', 'MXN'];

// "¥" for JPY, "$" for USD; empty when the device has no symbol shorter than the code
export function currencySymbol(code: string): string {
  try {
    const symbol =
      new Intl.NumberFormat(undefined, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? '';
    return symbol === code ? '' : symbol;
  } catch {
    return '';
  }
}

// Plain letters for matching, so "dong" finds "đồng" and "zloty" finds "złoty"
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đ]/g, 'd')
    .replace(/[ł]/g, 'l')
    .toLowerCase();
}

// Codes whose code or name contains the search, codes that start with it first
export function searchCurrencies(query: string): string[] {
  const q = fold(query.trim());
  const codes = Object.keys(CURRENCIES);
  if (!q) return codes;
  return codes
    .filter((code) => code.toLowerCase().includes(q) || fold(CURRENCIES[code]).includes(q))
    .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)));
}

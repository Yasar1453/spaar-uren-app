// ============================================================================
//  Pictogrammen voor afwezigheidstypes, in dezelfde stijl als Shiftbase.
//  Eén set, gedeeld door het beheerportaal en de monteur-app, zodat een type
//  overal hetzelfde beeld krijgt: in het rooster, de verlofaanvraag en het
//  overzicht.
//
//  Het zijn lijntekeningen die de kleur van het type overnemen (currentColor),
//  zodat één definitie werkt op een witte kaart én op een gekleurd roosterblok.
// ============================================================================

const PADEN = {
  // Vakantie — palmboom
  palm: '<path d="M11 21c.3-4.5.9-7.6 2-9.5"/><path d="M13 11.5c-1.5-2.5-4.6-3.3-7.3-1.9"/><path d="M13 11.5c1.5-2.5 4.6-3.3 7.3-1.9"/><path d="M13 11.5C12.3 8.7 10 6.8 7 6.8"/><path d="M13 11.5c.9-2.8 3.7-4.5 6.6-4.1"/><circle cx="13" cy="11.5" r="1" fill="currentColor" stroke="none"/><path d="M8 21h7"/>',
  // Ziek — thermometer
  thermometer: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
  // Nationale feestdag — vlag
  vlag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  // Bijzonder verlof — ster
  ster: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>',
  // Zwangerschapsverlof — kinderwagen
  kinderwagen: '<path d="M20 12a8 8 0 0 0-8-8v8"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M6 12a6 6 0 0 0 12 0"/><circle cx="8.5" cy="20" r="1.6"/><circle cx="16" cy="20" r="1.6"/>',
  // Zorgverlof — hart
  hart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.7z"/>',
  // Ouderschapsverlof — gezin
  gezin: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  // Onbetaald verlof — portemonnee
  portemonnee: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  // Medische afspraak — stethoscoop
  stethoscoop: '<path d="M5 3v5.5a5 5 0 0 0 10 0V3"/><path d="M3 3h3.5"/><path d="M13.5 3H17"/><path d="M10 13.5v1.5a4.5 4.5 0 0 0 8.6 1.9"/><circle cx="19.5" cy="14.5" r="2.3"/>',
  // School — studiehoed
  studiehoed: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
  // Te laat — klok
  klok: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  // Terugvaloptie voor zelf toegevoegde types
  kalender: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
};

// Keuzelijst voor het beheer: sleutel + leesbare naam.
export const ICOON_KEUZE = [
  ["palm", "Palmboom"], ["thermometer", "Thermometer"], ["vlag", "Vlag"],
  ["ster", "Ster"], ["kinderwagen", "Kinderwagen"], ["hart", "Hart"],
  ["gezin", "Gezin"], ["portemonnee", "Portemonnee"], ["stethoscoop", "Stethoscoop"],
  ["studiehoed", "Studiehoed"], ["klok", "Klok"], ["kalender", "Kalender"],
];

// Terugval voor types die nog geen icoon in de database hebben staan.
const PER_CODE = {
  vakantie: "palm", ziek: "thermometer", feestdag: "vlag", bijzonder: "ster",
  zwangerschap: "kinderwagen", zorg_kort: "hart", zorg_lang: "hart",
  ouderschap: "gezin", onbetaald: "portemonnee", medisch_lang: "stethoscoop",
  medisch_kort: "stethoscoop", school: "studiehoed", te_laat: "klok",
};

export function icoonSleutel(type) {
  if (!type) return "kalender";
  return PADEN[type.icoon] ? type.icoon : (PER_CODE[type.code] || "kalender");
}

// Levert de SVG. `kleur` mag weggelaten worden; dan erft hij de tekstkleur.
export function icoon(type, { maat = 16, kleur = null } = {}) {
  const paden = PADEN[icoonSleutel(type)];
  return `<svg class="afw-ico" viewBox="0 0 24 24" width="${maat}" height="${maat}"
    fill="none" stroke="${kleur || "currentColor"}" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paden}</svg>`;
}

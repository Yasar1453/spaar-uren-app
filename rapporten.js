// ============================================================================
//  Spaar Electra — Urenregistratie · de overige Shiftbase-rapportages
//
//  Twaalf overzichten die in Shiftbase wel bestonden en bij ons nog niet:
//  verlofsaldo (totaal en per mutatie), plus/min, detail per regel, totalen,
//  gepland versus gewerkt, periode-overzicht per week en per dag, dagboek,
//  personeelslijst, nieuw in dienst en benodigde diensten.
//
//  Ze staan in een eigen bestand omdat ze niets van het beheerscherm nodig
//  hebben behalve de opmaakhulpjes: één losse module blijft leesbaar en botst
//  niet met het werk in beheer.js. Alle DOM-id's beginnen daarom met "rp".
//
//  Drie dingen zijn overgenomen uit Shiftbase omdat kantoor er zo mee werkt:
//
//  1. GRONDSLAG. Een rapport gaat over het ROOSTER (wat er gepland stond) of
//     over de URENREGISTRATIE (wat er geklokt is). Dat is een knop bovenaan,
//     geen tweede rapport in de lijst — de vraag "hoeveel uur" heeft twee
//     antwoorden en je wilt er tussen kunnen wisselen zonder je plek kwijt te
//     raken.
//  2. FILTERBALK. Periode, medewerker, werkbon en contractvorm.
//  3. KOLOMKIEZER. De beheerder vinkt zelf aan wat hij ziet; tabel én CSV
//     volgen die keuze, en de keuze blijft per rapport bewaard. Het urenrapport
//     heeft ruim veertig kolommen — allemaal tonen maakt hem onleesbaar, en een
//     vaste selectie klopt nooit voor iedereen.
//
//  Alle rapporten delen dezelfde opbouw, zodat elk rapport een databasefout op
//  precies dezelfde manier meldt. Deze cijfers gaan naar de loonadministratie,
//  dus een mislukte query mag nooit als "niemand heeft gewerkt" op het scherm
//  belanden.
// ============================================================================

export function bouwRapporten(db, hulp) {
  const NODIG = [
    "esc", "komma", "urenTekst", "tijd", "rijLeeg", "csvDownload", "haalAlles",
    "statusBadge", "werkbonMetKleur", "typeLabel", "werkdagenTussen", "urenWeekTotaal",
    "DAG_KEYS", "isoDatum", "maandagVan", "toonMeld", "verberg",
  ];
  // Een ontbrekend hulpje is een fout in de koppeling, geen gegevensprobleem.
  // Meteen hard stoppen is dan beter dan een half werkend rapportagescherm.
  const ontbreekt = NODIG.filter((n) => hulp == null || hulp[n] == null);
  if (ontbreekt.length) {
    throw new Error("bouwRapporten mist deze gedeelde functies: " + ontbreekt.join(", "));
  }
  const {
    esc, komma, urenTekst, tijd, rijLeeg, csvDownload, haalAlles,
    statusBadge, werkbonMetKleur, typeLabel, werkdagenTussen, urenWeekTotaal,
    DAG_KEYS, isoDatum, maandagVan, toonMeld, verberg,
  } = hulp;

  const $ = (id) => document.getElementById(id);
  const blokkenVak = $("rpBlokken");
  if (!blokkenVak) {
    // De HTML is nog niet geplakt. Stil teruggeven zou een lege Rapportages-tab
    // opleveren die er hetzelfde uitziet als "er zijn geen gegevens".
    const bericht = "De rapportagesectie is niet gevonden. Plak de HTML uit app/rapporten.html.txt "
      + 'in <section data-view="rapporten"> van beheer.html.';
    const sectie = document.querySelector('[data-view="rapporten"]');
    if (sectie) {
      const vak = document.createElement("div");
      vak.className = "melding fout";
      vak.textContent = bericht;
      sectie.appendChild(vak);
    }
    console.error(bericht);
    return { toon() {}, kies() {} };
  }

  // Meer dan dit tekenen loopt vast op honderdduizenden tabelcellen. De export
  // krijgt wél alle regels: die gaat naar Excel en moet compleet zijn.
  const MAX_GETOOND = 2000;

  // ── Cellen ────────────────────────────────────────────────────────────────
  //  Elke cel draagt twee waarden: `t` is de opgemaakte HTML voor het scherm,
  //  `w` de kale waarde voor de CSV. Zo kan de export nooit uit de pas lopen
  //  met wat er getoond wordt, en gaan er geen opmaaktekens de loonadministratie
  //  in.
  const cel = (t, w, k) => ({ t, w: w === undefined || w === null ? "" : w, k: k || "" });
  const tekst = (v) => cel(v == null || v === "" ? "—" : esc(v), v == null ? "" : v);
  const sterk = (v) => cel(v == null || v === "" ? "—" : esc(v), v == null ? "" : v, "sterk");
  const getal = (v) => cel(v == null ? "—" : String(v), v == null ? "" : v, "mono");
  const komGetal = (v) => cel(v == null ? "—" : esc(komma(v)), v == null ? "" : komma(v), "mono");
  // Nul uren als streepje: in een lange lijst leest "0 min" als een ingevuld
  // getal, terwijl het meestal "niets geregistreerd" betekent.
  const uren = (v, dik) => cel(Number(v) ? urenTekst(v) : "—", v == null ? "" : komma(v), "mono" + (dik ? " sterk" : ""));
  const urenAltijd = (v, dik) => cel(urenTekst(v), komma(v), "mono" + (dik ? " sterk" : ""));
  const minuten = (v) => cel(Number(v) ? Number(v) + " min" : "—", v == null ? "" : v, "mono");
  const euro = (v) => cel(v == null ? "—" : "€ " + esc(komma(v)), v == null ? "" : komma(v), "mono");

  function getekend(v) {
    if (v == null) return cel("—", "");
    const n = Number(v) || 0;
    const kleur = n < 0 ? "var(--rood-donker)" : n > 0 ? "var(--groen)" : "inherit";
    const t = n ? (n > 0 ? "+" : "−") + urenTekst(Math.abs(n)) : "0 min";
    return cel(`<span style="color:${kleur}">${t}</span>`, komma(n), "mono");
  }
  function saldoCel(v) {
    const n = Number(v) || 0;
    return cel(`<span style="color:${n < 0 ? "var(--rood-donker)" : "inherit"}">${urenTekst(n)}</span>`,
      komma(n), "mono sterk");
  }

  const korteDatum = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("nl-NL",
    { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
  const langeDatum = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("nl-NL",
    { day: "numeric", month: "long", year: "numeric" }) : "");
  const dagNaam = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short" }) : "");
  const datumCel = (d) => cel(d ? esc(korteDatum(d)) : "—", d || "", "mono");
  const klok = (t) => (t ? String(t).slice(0, 5) : "");
  const klokCel = (t) => cel(t ? esc(klok(t)) : "—", klok(t), "mono");
  // Een tijdstempel binnen een dag: alleen de klok, want de datum staat ernaast.
  const stipCel = (iso) => cel(iso ? esc(tijd(iso)) : "—", iso || "", "mono");
  // Een tijdstempel dat over een andere dag kan gaan: datum én klok.
  const momentCel = (iso) => cel(iso
    ? esc(new Date(iso).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }))
    : "—", iso || "", "mono");
  const DAGDEEL_LABEL = { hele_dag: "hele dag", ochtend: "ochtend", middag: "middag" };
  const CONTRACT_LABEL = { vast: "Vast", tijdelijk: "Tijdelijk", oproep: "Oproep" };
  const BRON_LABEL = { klok: "Geklokt", handmatig: "Met de hand" };

  // ── Kolommen ──────────────────────────────────────────────────────────────
  //  Een kolom heeft een sleutel (blijft gelijk, ook als de kop verandert; daar
  //  hangt de bewaarde keuze aan), een kop, en of hij standaard uit staat.
  const kol = (s, k, uit) => ({ s, k, uit: !!uit });
  const rij = (c, klasse) => ({ c, klasse: klasse || "" });

  // localStorage kan geblokkeerd zijn (privémodus). De keuze onthouden is een
  // gemak, geen gegeven — dan maar per sessie in het geheugen.
  const kolomGeheugen = new Map();
  function leesKeuze(sleutel) {
    if (kolomGeheugen.has(sleutel)) return kolomGeheugen.get(sleutel);
    try {
      const rauw = localStorage.getItem("rp-kolommen:" + sleutel);
      const lijst = rauw ? JSON.parse(rauw) : null;
      return Array.isArray(lijst) ? lijst : null;
    } catch (_) { return null; }
  }
  function schrijfKeuze(sleutel, lijst) {
    kolomGeheugen.set(sleutel, lijst);
    try { localStorage.setItem("rp-kolommen:" + sleutel, JSON.stringify(lijst)); } catch (_) { /* geheugen volstaat */ }
  }
  function wisKeuze(sleutel) {
    kolomGeheugen.delete(sleutel);
    try { localStorage.removeItem("rp-kolommen:" + sleutel); } catch (_) { /* niets te wissen */ }
  }
  function zichtbareKolommen(blok) {
    const keuze = leesKeuze(blok.sleutel);
    const gekozen = keuze ? new Set(keuze) : null;
    const uit = blok.kolommen.filter((k) => (gekozen ? gekozen.has(k.s) : !k.uit));
    // Alles uitvinken levert een tabel zonder kolommen op; dan liever de
    // standaard terug dan een leeg vlak waarvan niemand snapt wat er stuk is.
    return uit.length ? uit : blok.kolommen.filter((k) => !k.uit);
  }

  // ── Lijsten voor de filterbalk ────────────────────────────────────────────
  let _medewerkers = [], _projecten = [], _vormen = [];
  let _lijstenFout = null;
  const vormVanMedewerker = new Map();

  async function laadFilterlijsten() {
    const [mw, pr, cv] = await Promise.all([
      haalAlles((a, b) => db.from("medewerkers")
        .select("id, naam, contractvorm_id, verwijderd_op").order("naam").range(a, b)),
      haalAlles((a, b) => db.from("projecten")
        .select("id, werkbon, naam").is("verwijderd_op", null).order("werkbon").range(a, b)),
      db.from("contractvormen").select("id, naam").order("naam"),
    ]);
    const fout = mw.error || pr.error || cv.error;
    if (fout) {
      // Zonder deze lijsten staan de filters leeg. Dat ziet eruit als "er zijn
      // geen monteurs" en dat is precies de verwarring die we niet willen.
      _lijstenFout = fout.message;
      return;
    }
    _lijstenFout = null;
    _medewerkers = mw.data || [];
    _projecten = pr.data || [];
    _vormen = cv.data || [];
    vormVanMedewerker.clear();
    _medewerkers.forEach((m) => vormVanMedewerker.set(m.id, m.contractvorm_id || ""));
    vulFilterKeuzes();
  }

  function vulFilterKeuzes() {
    const zet = (id, paren) => {
      const sel = $(id);
      const huidigeWaarde = sel.value;
      sel.innerHTML = paren.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
      sel.value = huidigeWaarde;
    };
    zet("rpFilterMedewerker", [["", "Alle monteurs"],
      ..._medewerkers.map((m) => [m.id, m.naam + (m.verwijderd_op ? " (uit dienst)" : "")])]);
    zet("rpFilterWerkbon", [["", "Alle werkbonnen"],
      ..._projecten.map((p) => [p.id, (p.werkbon ? p.werkbon + " · " : "") + p.naam])]);
    zet("rpFilterVorm", [["", "Alle contractvormen"], ..._vormen.map((v) => [v.id, v.naam])]);
  }

  function filters() {
    return {
      medewerker: $("rpFilterMedewerker").value || "",
      werkbon: $("rpFilterWerkbon").value || "",
      contractvorm: $("rpFilterVorm").value || "",
    };
  }

  // Filteren op de opgehaalde regels. Voor de optelrapporten is dat hetzelfde
  // antwoord als filteren in de database — ze tellen per monteur op — en het
  // scheelt vijf functiehandtekeningen die allemaal dezelfde drie parameters
  // moeten meeslepen. Alleen de twee detailrapporten filteren wél in de
  // database: die lijst kan duizenden regels lang zijn.
  function filterLokaal(lijst, velden) {
    const f = filters();
    if (!f.medewerker && !f.contractvorm && !f.werkbon) return lijst || [];
    const mVeld = velden.medewerker || "medewerker_id";
    const pVeld = velden.project || null;
    return (lijst || []).filter((r) => {
      const mid = r[mVeld];
      if (f.medewerker && mid !== f.medewerker) return false;
      if (f.contractvorm && (vormVanMedewerker.get(mid) || "") !== f.contractvorm) return false;
      if (f.werkbon && pVeld && r[pVeld] !== f.werkbon) return false;
      return true;
    });
  }

  function filterTekst() {
    const f = filters();
    const stukken = [];
    if (f.medewerker) stukken.push("monteur: " + (_medewerkers.find((m) => m.id === f.medewerker) || {}).naam);
    if (f.werkbon) {
      const p = _projecten.find((x) => x.id === f.werkbon) || {};
      stukken.push("werkbon: " + ((p.werkbon ? p.werkbon + " · " : "") + (p.naam || "")));
    }
    if (f.contractvorm) stukken.push("contractvorm: " + (_vormen.find((v) => v.id === f.contractvorm) || {}).naam);
    return stukken.length ? " Filter — " + stukken.join(", ") + "." : "";
  }

  // ── De twaalf rapporten ───────────────────────────────────────────────────
  //  `periode` bepaalt welke datumvelden zichtbaar zijn: een bereik, één dag,
  //  of geen — een verlofsaldo en een personeelslijst gelden op dit moment en
  //  niet over een periode.
  //  `filters` bepaalt welke keuzelijsten er iets doen: een werkbonfilter op
  //  een verlofsaldo heeft geen betekenis, dus die verbergen we liever dan hem
  //  te tonen en te negeren.
  const RAPPORTEN = [
    { code: "verlofsaldo", titel: "Verlofsaldo totalen", periode: "geen",
      filters: ["medewerker", "contractvorm"],
      uitleg: "Opbouw en opname per monteur, zoals het saldo er nu voor staat. Oud-medewerkers staan erbij: een restsaldo moet nog afgerekend worden.",
      haal: haalVerlofsaldo },
    { code: "verlofdetail", titel: "Verlofsaldo gedetailleerd", periode: "bereik",
      filters: ["medewerker", "contractvorm"],
      uitleg: "Elke mutatie apart, met het saldo dat er daarna stond. Het lopend saldo telt vanaf indiensttreding, niet vanaf het begin van de gekozen periode.",
      haal: haalVerlofdetail },
    { code: "plusmin", titel: "Plus/min per monteur", periode: "bereik",
      filters: ["medewerker", "contractvorm"],
      uitleg: "Gewerkt plus verlof min contracturen, voor de contractvormen die plus/min bijhouden. Dezelfde berekening als de uitbetaling.",
      haal: haalPlusmin },
    { code: "detail", titel: "Detail per regel", periode: "bereik",
      filters: ["medewerker", "werkbon", "contractvorm"],
      grondslagen: ["uren", "rooster"],
      uitleg: "Elke regel apart. Op grondslag urenregistratie is dit het volledige urenrapport; klik op Kolommen om te kiezen wat je ziet.",
      haal: haalDetail },
    { code: "totalen", titel: "Totalen", periode: "bereik",
      filters: ["medewerker", "werkbon", "contractvorm"],
      grondslagen: ["uren", "rooster"],
      uitleg: "Dezelfde regels, opgeteld per monteur en per werkbon.",
      haal: haalTotalen },
    { code: "geplandgewerkt", titel: "Gepland versus gewerkt", periode: "bereik",
      filters: ["medewerker", "contractvorm"],
      uitleg: "Wat er in het rooster stond tegenover wat er geklokt is, met de dagen waarop er niets tegenover stond. Dit rapport gebruikt beide grondslagen tegelijk.",
      haal: haalGeplandGewerkt },
    { code: "periodeweek", titel: "Periode-overzicht (per week)", periode: "bereik",
      filters: ["medewerker", "contractvorm"],
      uitleg: "Per monteur per week: gewerkt, verlof, contracturen en plus/min.",
      haal: (ctx) => haalPeriode(ctx, "week") },
    { code: "periodedag", titel: "Dagelijks periode-overzicht", periode: "bereik",
      filters: ["medewerker", "contractvorm"],
      uitleg: "Hetzelfde overzicht, maar per dag. Hooguit een kwartaal per keer.",
      haal: (ctx) => haalPeriode(ctx, "dag") },
    { code: "dagboek", titel: "Dagboek", periode: "dag",
      filters: ["medewerker", "werkbon"],
      uitleg: "Chronologisch alles wat er op één dag gebeurde: klokacties, verlof, goedkeuringen en wijzigingen.",
      haal: haalDagboek },
    { code: "personeel", titel: "Actieve en oud-medewerkers", periode: "geen",
      filters: ["medewerker", "contractvorm"],
      uitleg: "De hele personeelslijst, gesplitst in wie er in dienst is en wie uit dienst is gegaan.",
      haal: haalPersoneel },
    { code: "nieuwindienst", titel: "Nieuw in dienst", periode: "bereik",
      filters: ["medewerker", "contractvorm"],
      uitleg: "Wie er in de gekozen periode is begonnen, op datum in dienst of anders op de contractstartdatum.",
      haal: haalNieuwIndienst },
    { code: "benodigd", titel: "Benodigde diensten", periode: "bereik",
      filters: ["medewerker", "werkbon"],
      uitleg: "Geplande diensten waar feitelijk niemand op staat: geen monteur toegewezen, of de ingeplande monteur is afwezig of uit dienst.",
      haal: haalBenodigd },
  ];

  const GRONDSLAG_LABEL = { uren: "Urenregistratie", rooster: "Rooster" };

  let huidig = RAPPORTEN[0];
  let grondslag = "uren";
  let blokken = [];
  let periodeNaam = "";
  let getoondeTitel = "";
  // Doorklikken door de rapportlijst start meerdere ophaalacties tegelijk.
  // Zonder volgnummer kan een traag rapport de tabel van een sneller rapport
  // dat er ná hem is aangeklikt overschrijven — met de kop van het verkeerde
  // rapport erboven. Alleen het laatst gevraagde rapport mag tekenen.
  let verzoekNr = 0;

  // ── Rapport 1: verlofsaldo totalen ────────────────────────────────────────
  async function haalVerlofsaldo() {
    const { data, error } = await db.rpc("rapport_verlofsaldo");
    if (error) return { fout: "Het verlofsaldo kon niet worden berekend: " + error.message };
    const lijst = filterLokaal(data, {});
    return {
      blokken: [{
        sleutel: "verlofsaldo",
        titel: "Verlofsaldo per monteur",
        kolommen: [
          kol("naam", "Monteur"), kol("medewerker_id", "Gebruikers-id", true),
          kol("beleid", "Beleid"), kol("factor", "Opbouw per uur", true),
          kol("beginsaldo", "Beginsaldo"), kol("opgebouwd", "Opgebouwd"),
          kol("opgenomen", "Opgenomen"), kol("aangevraagd", "Aangevraagd"),
          kol("resterend", "Resterend"), kol("uit_dienst", "Uit dienst"),
          kol("waarschuwing", "Let op"),
        ],
        rijen: lijst.map((r) => rij({
          naam: sterk(r.naam),
          medewerker_id: cel(esc(r.medewerker_id), r.medewerker_id, "mono"),
          beleid: tekst(r.beleid),
          factor: cel(esc(Number(r.factor).toFixed(9)), r.factor, "mono"),
          beginsaldo: uren(r.beginsaldo),
          opgebouwd: uren(r.opgebouwd),
          opgenomen: uren(r.opgenomen),
          aangevraagd: uren(r.aangevraagd),
          resterend: saldoCel(r.resterend),
          uit_dienst: datumCel(r.uit_dienst_op),
          waarschuwing: tekst(r.waarschuwing),
        }, r.waarschuwing ? "rij-let-op" : "")),
        leegTekst: "Geen medewerkers die aan het filter voldoen.",
      }],
      letOp: telLetOp(lijst),
    };
  }

  // ── Rapport 2: verlofsaldo gedetailleerd ──────────────────────────────────
  async function haalVerlofdetail(ctx) {
    const { data, error } = await db.rpc("rapport_verlofmutaties", { p_van: ctx.van, p_tot: ctx.tot });
    if (error) return { fout: "De verlofmutaties konden niet worden opgehaald: " + error.message };
    const lijst = filterLokaal(data, {});
    return {
      blokken: [{
        sleutel: "verlofmutaties",
        titel: "Verlofmutaties",
        kolommen: [
          kol("naam", "Monteur"), kol("medewerker_id", "Gebruikers-id", true),
          kol("datum", "Datum"), kol("aard", "Aard"), kol("soort", "Soort"),
          kol("periode", "Verlofperiode"), kol("werkdagen", "Werkdagen", true),
          kol("mutatie", "Mutatie"), kol("saldo", "Saldo daarna"),
          kol("status", "Status"), kol("toelichting", "Toelichting"),
        ],
        rijen: lijst.map((r) => rij({
          naam: sterk(r.naam),
          medewerker_id: cel(esc(r.medewerker_id), r.medewerker_id, "mono"),
          datum: datumCel(r.datum),
          aard: tekst(r.aard),
          soort: r.soort ? cel(typeLabel(r.soort), r.soort_naam || r.soort) : cel("—", ""),
          periode: r.van_datum
            ? cel(esc(korteDatum(r.van_datum) + " t/m " + korteDatum(r.tot_datum)),
                r.van_datum + " t/m " + r.tot_datum, "mono")
            : cel("—", ""),
          werkdagen: r.van_datum ? getal(werkdagenTussen(r.van_datum, r.tot_datum)) : cel("—", ""),
          mutatie: getekend(r.mutatie),
          saldo: urenAltijd(r.saldo_na, true),
          status: cel(statusBadge(r.status), r.status),
          toelichting: tekst(r.toelichting),
        })),
        leegTekst: "Geen opbouw of opname in deze periode.",
      }],
      letOp: lijst.some((r) => r.aard === "Aangevraagd")
        ? "Aanvragen die nog niet zijn beoordeeld staan erbij, maar tellen niet mee in het saldo daarnaast."
        : "",
    };
  }

  // ── Rapport 3: plus/min per monteur ───────────────────────────────────────
  async function haalPlusmin(ctx) {
    const { data, error } = await db.rpc("rapport_plusmin", { p_van: ctx.van, p_tot: ctx.tot });
    if (error) return { fout: "De plus/min kon niet worden berekend: " + error.message };
    const lijst = filterLokaal(data, {});
    return {
      blokken: [{
        sleutel: "plusmin",
        titel: "Plus/min",
        kolommen: [
          kol("naam", "Monteur"), kol("medewerker_id", "Gebruikers-id", true),
          kol("contractvorm", "Contractvorm"), kol("gewerkt", "Gewerkt"),
          kol("verlof", "Verlof"), kol("contract", "Contract"),
          kol("pm_periode", "Plus/min in periode"), kol("pm_totaal", "Plus/min totaal"),
          kol("open", "Nog te keuren"), kol("waarschuwing", "Let op"),
        ],
        rijen: lijst.map((r) => rij({
          naam: sterk(r.naam),
          medewerker_id: cel(esc(r.medewerker_id), r.medewerker_id, "mono"),
          contractvorm: tekst(r.contractvorm),
          gewerkt: uren(r.gewerkt_uren),
          verlof: uren(r.verlof_uren),
          contract: uren(r.contract_uren),
          pm_periode: getekend(r.plusmin_periode),
          pm_totaal: getekend(r.plusmin_totaal),
          open: uren(r.open_uren),
          waarschuwing: tekst(r.waarschuwing),
        }, r.waarschuwing ? "rij-let-op" : "")),
        leegTekst: "Geen gegevens in deze periode.",
      }],
      letOp: telLetOp(lijst),
    };
  }

  // ── Rapport 4 en 5: detail en totalen, op beide grondslagen ───────────────
  //  De filters gaan hier wél de database in: op grondslag urenregistratie kan
  //  een kwartaal duizenden regels opleveren en die hoeven niet over de lijn om
  //  er daarna negentig procent van weg te gooien.
  function filterArgumenten(ctx) {
    return {
      p_van: ctx.van, p_tot: ctx.tot,
      p_medewerker: ctx.filters.medewerker || null,
      p_project: ctx.filters.werkbon || null,
      p_contractvorm: ctx.filters.contractvorm || null,
    };
  }

  async function haalRegels(ctx) {
    return db.rpc(ctx.grondslag === "rooster" ? "rapport_rooster" : "rapport_uren_detail",
      filterArgumenten(ctx));
  }

  const URENDETAIL_KOLOMMEN = [
    kol("naam", "Naam"), kol("personeelsnummer", "Personeelsnr", true),
    kol("medewerker_id", "Gebruikers-id", true),
    kol("datum", "Datum"), kol("dag", "Dag"),
    kol("start", "Starttijd"), kol("eind", "Eindtijd"),
    kol("ingeklokt", "Ingeklokt om", true), kol("uitgeklokt", "Uitgeklokt om", true),
    kol("pauze_onbetaald", "Onbetaalde pauze"), kol("pauze_betaald", "Betaalde pauze", true),
    kol("werkbon", "Dienst (werkbon)"), kol("project_naam", "Werkbonnaam", true),
    kol("locatie", "Locatie", true),
    kol("contract_type", "Contracttype", true), kol("contractvorm", "Contractvorm", true),
    kol("uitbetalingsbasis", "Uitbetalingsbasis", true),
    kol("contract_uren_week", "Contracturen per week", true),
    kol("gewerkt", "Gewerkt"),
    kol("overwerk", "Overwerk (dagtotaal)", true), kol("normaal", "Normale tijd (dagtotaal)", true),
    kol("km", "Kilometers", true), kol("maaltijden", "Maaltijden", true),
    kol("omschrijving", "Notitie", true), kol("status", "Status"),
    kol("bron", "Inklok type", true),
    kol("in_lat", "Inklok breedtegraad", true), kol("in_lng", "Inklok lengtegraad", true),
    kol("rooster_start", "Rooster starttijd", true), kol("rooster_eind", "Rooster eindtijd", true),
    kol("rooster_pauze_onbetaald", "Rooster onbetaalde pauze", true),
    kol("rooster_pauze_betaald", "Rooster betaalde pauze", true),
    kol("rooster_uren", "Rooster totaal", true), kol("rooster_verschil", "Rooster verschil", true),
    kol("aangemaakt_op", "Aangemaakt", true), kol("aangemaakt_door", "Aangemaakt door", true),
    kol("aangepast_op", "Bijgewerkt", true), kol("aangepast_door", "Gewijzigd door", true),
    kol("nagekeken_op", "Gekeurd", true), kol("nagekeken_door", "Gekeurd door", true),
    kol("verwerkt_op", "In loonrun", true),
    kol("uurloon", "Uurloon", true), kol("loonkosten", "Loonkosten", true),
    kol("urenregel_id", "Urenregistratie-id", true), kol("planning_id", "Rooster-id", true),
    kol("project_id", "Dienst-id", true), kol("contractvorm_id", "Contracttype-id", true),
  ];

  const ROOSTERDETAIL_KOLOMMEN = [
    kol("naam", "Naam"), kol("personeelsnummer", "Personeelsnr", true),
    kol("medewerker_id", "Gebruikers-id", true),
    kol("datum", "Datum"), kol("dag", "Dag"),
    kol("werkbon", "Dienst (werkbon)"), kol("project_naam", "Werkbonnaam", true),
    kol("locatie", "Locatie", true),
    kol("dagdeel", "Dagdeel"), kol("start", "Starttijd"), kol("eind", "Eindtijd"),
    kol("pauze_onbetaald", "Onbetaalde pauze", true), kol("pauze_betaald", "Betaalde pauze", true),
    kol("uren", "Rooster totaal"),
    kol("geklokt", "Geklokt"), kol("verschil", "Verschil"),
    kol("contract_type", "Contracttype", true), kol("contractvorm", "Contractvorm", true),
    kol("uitbetalingsbasis", "Uitbetalingsbasis", true),
    kol("contract_uren_week", "Contracturen per week", true),
    kol("aangemaakt_op", "Aangemaakt", true),
    kol("uurloon", "Uurloon", true), kol("loonkosten", "Loonkosten", true),
    kol("planning_id", "Rooster-id", true), kol("project_id", "Dienst-id", true),
    kol("contractvorm_id", "Contracttype-id", true),
  ];

  function urenRegelRij(r) {
    return rij({
      naam: sterk(r.naam),
      personeelsnummer: tekst(r.personeelsnummer),
      medewerker_id: cel(esc(r.medewerker_id), r.medewerker_id, "mono"),
      datum: datumCel(r.datum),
      dag: tekst(dagNaam(r.datum)),
      start: stipCel(r.start_tijd),
      eind: stipCel(r.eind_tijd),
      ingeklokt: stipCel(r.ingeklokt_om),
      uitgeklokt: stipCel(r.uitgeklokt_om),
      pauze_onbetaald: minuten(r.pauze_onbetaald_min),
      pauze_betaald: minuten(r.pauze_betaald_min),
      werkbon: werkbonCel(r),
      project_naam: tekst(r.project_naam),
      locatie: tekst(r.locatie),
      contract_type: tekst(CONTRACT_LABEL[r.contract_type] || r.contract_type),
      contractvorm: tekst(r.contractvorm),
      uitbetalingsbasis: tekst(r.uitbetalingsbasis),
      contract_uren_week: r.contract_uren_week != null ? urenAltijd(r.contract_uren_week) : cel("—", ""),
      gewerkt: uren(r.gewerkt_uren, true),
      overwerk: r.overwerk_dag == null ? cel("", "") : uren(r.overwerk_dag),
      normaal: r.normaal_dag == null ? cel("", "") : uren(r.normaal_dag),
      km: komGetal(r.km),
      maaltijden: getal(r.maaltijden),
      omschrijving: tekst(r.omschrijving),
      status: cel(statusBadge(r.status), r.status),
      bron: tekst(BRON_LABEL[r.bron] || r.bron),
      in_lat: komGetal(r.in_lat),
      in_lng: komGetal(r.in_lng),
      rooster_start: klokCel(r.rooster_start),
      rooster_eind: klokCel(r.rooster_eind),
      rooster_pauze_onbetaald: minuten(r.rooster_pauze_onbetaald_min),
      rooster_pauze_betaald: minuten(r.rooster_pauze_betaald_min),
      rooster_uren: uren(r.rooster_uren),
      rooster_verschil: getekend(r.rooster_verschil),
      aangemaakt_op: momentCel(r.aangemaakt_op),
      aangemaakt_door: tekst(r.aangemaakt_door),
      aangepast_op: momentCel(r.aangepast_op),
      aangepast_door: tekst(r.aangepast_door),
      nagekeken_op: momentCel(r.nagekeken_op),
      nagekeken_door: tekst(r.nagekeken_door),
      verwerkt_op: momentCel(r.verwerkt_op),
      uurloon: euro(r.uurloon),
      loonkosten: euro(r.loonkosten),
      urenregel_id: cel(esc(r.urenregel_id), r.urenregel_id, "mono"),
      planning_id: cel(esc(r.planning_id), r.planning_id, "mono"),
      project_id: cel(esc(r.project_id), r.project_id, "mono"),
      contractvorm_id: cel(esc(r.contractvorm_id), r.contractvorm_id, "mono"),
    }, r.status === "onbeslist" ? "rij-let-op" : "");
  }

  function roosterRegelRij(r) {
    return rij({
      naam: r.naam ? sterk(r.naam) : cel('<span class="leeg">niemand toegewezen</span>', ""),
      personeelsnummer: tekst(r.personeelsnummer),
      medewerker_id: cel(esc(r.medewerker_id), r.medewerker_id, "mono"),
      datum: datumCel(r.datum),
      dag: tekst(dagNaam(r.datum)),
      werkbon: werkbonCel(r),
      project_naam: tekst(r.project_naam),
      locatie: tekst(r.locatie),
      dagdeel: tekst(DAGDEEL_LABEL[r.dagdeel] || r.dagdeel),
      start: klokCel(r.start_tijd),
      eind: klokCel(r.eind_tijd),
      pauze_onbetaald: minuten(r.pauze_onbetaald_min),
      pauze_betaald: minuten(r.pauze_betaald_min),
      uren: uren(r.uren, true),
      geklokt: uren(r.geklokte_uren),
      verschil: getekend(r.verschil_uren),
      contract_type: tekst(CONTRACT_LABEL[r.contract_type] || r.contract_type),
      contractvorm: tekst(r.contractvorm),
      uitbetalingsbasis: tekst(r.uitbetalingsbasis),
      contract_uren_week: r.contract_uren_week != null ? urenAltijd(r.contract_uren_week) : cel("—", ""),
      aangemaakt_op: momentCel(r.aangemaakt_op),
      uurloon: euro(r.uurloon),
      loonkosten: euro(r.loonkosten),
      planning_id: cel(esc(r.planning_id), r.planning_id, "mono"),
      project_id: cel(esc(r.project_id), r.project_id, "mono"),
      contractvorm_id: cel(esc(r.contractvorm_id), r.contractvorm_id, "mono"),
    }, r.medewerker_id ? "" : "rij-let-op");
  }

  async function haalDetail(ctx) {
    const { data, error } = await haalRegels(ctx);
    if (error) {
      return { fout: (ctx.grondslag === "rooster" ? "Het rooster" : "De urenregistratie")
        + " kon niet worden opgehaald: " + error.message };
    }
    const lijst = data || [];
    const rooster = ctx.grondslag === "rooster";
    const totaal = lijst.reduce((s, r) => s + (Number(rooster ? r.uren : r.gewerkt_uren) || 0), 0);
    return {
      blokken: [{
        sleutel: rooster ? "rooster-detail" : "uren-detail",
        titel: rooster ? "Geplande diensten" : "Urenregels",
        kolommen: rooster ? ROOSTERDETAIL_KOLOMMEN : URENDETAIL_KOLOMMEN,
        rijen: lijst.map(rooster ? roosterRegelRij : urenRegelRij),
        leegTekst: rooster ? "Er staat niets ingepland in deze periode." : "Er zijn geen urenregels in deze periode.",
        voet: `${lijst.length} ${lijst.length === 1 ? "regel" : "regels"}, samen <b>${esc(urenTekst(totaal))}</b>.`
          + (rooster ? "" : " Overwerk en normale tijd staan per dag, op de eerste regel van die dag."),
      }],
      letOp: !rooster && lijst.some((r) => r.status === "onbeslist")
        ? "Er staan regels tussen die nog niet zijn beoordeeld; die tellen wel mee in de totalen."
        : "",
    };
  }

  // ── Rapport 5: totalen ────────────────────────────────────────────────────
  async function haalTotalen(ctx) {
    const { data, error } = await haalRegels(ctx);
    if (error) {
      return { fout: (ctx.grondslag === "rooster" ? "Het rooster" : "De urenregistratie")
        + " kon niet worden opgehaald: " + error.message };
    }
    const lijst = data || [];
    const rooster = ctx.grondslag === "rooster";
    const urenVan = (r) => Number(rooster ? r.uren : r.gewerkt_uren) || 0;

    // Op id groeperen en niet op naam: twee naamgenoten mogen niet samenvallen.
    const perMonteur = new Map();
    lijst.forEach((r) => {
      const sleutel = r.medewerker_id || "geen";
      if (!perMonteur.has(sleutel)) {
        perMonteur.set(sleutel, {
          id: r.medewerker_id, naam: r.naam || "niemand toegewezen",
          personeelsnummer: r.personeelsnummer, contractvorm: r.contractvorm,
          regels: 0, uren: 0, dagen: new Set(), bonnen: new Set(),
          km: 0, maaltijden: 0, overwerk: 0, loonkosten: 0, loonBekend: false,
        });
      }
      const m = perMonteur.get(sleutel);
      m.regels++;
      m.uren += urenVan(r);
      m.dagen.add(r.datum);
      if (r.werkbon) m.bonnen.add(r.werkbon);
      m.km += Number(r.km) || 0;
      m.maaltijden += Number(r.maaltijden) || 0;
      m.overwerk += Number(r.overwerk_dag) || 0;
      if (r.loonkosten != null) { m.loonkosten += Number(r.loonkosten) || 0; m.loonBekend = true; }
    });

    const perBon = new Map();
    lijst.forEach((r) => {
      const sleutel = r.project_id || (r.werkbon || "—");
      if (!perBon.has(sleutel)) {
        perBon.set(sleutel, {
          werkbon: r.werkbon, naam: r.project_naam, kleur: r.project_kleur,
          regels: 0, uren: 0, dagen: new Set(), monteurs: new Set(),
          km: 0, loonkosten: 0, loonBekend: false,
        });
      }
      const p = perBon.get(sleutel);
      p.regels++;
      p.uren += urenVan(r);
      p.dagen.add(r.datum);
      if (r.medewerker_id) p.monteurs.add(r.medewerker_id);
      p.km += Number(r.km) || 0;
      if (r.loonkosten != null) { p.loonkosten += Number(r.loonkosten) || 0; p.loonBekend = true; }
    });

    const eenheid = rooster ? "Diensten" : "Urenregels";
    const monteurBlok = {
      sleutel: rooster ? "rooster-totaal-monteur" : "uren-totaal-monteur",
      titel: "Per monteur",
      kolommen: [
        kol("naam", "Monteur"), kol("personeelsnummer", "Personeelsnr", true),
        kol("medewerker_id", "Gebruikers-id", true), kol("contractvorm", "Contractvorm", true),
        kol("regels", eenheid), kol("dagen", "Dagen"), kol("bonnen", "Werkbonnen"),
        kol("uren", rooster ? "Geplande uren" : "Gewerkte uren"),
        kol("overwerk", "Overwerk", rooster), kol("km", "Kilometers", true),
        kol("maaltijden", "Maaltijden", true), kol("loonkosten", "Loonkosten", true),
      ],
      rijen: [...perMonteur.values()].sort((a, b) => b.uren - a.uren).map((m) => rij({
        naam: sterk(m.naam),
        personeelsnummer: tekst(m.personeelsnummer),
        medewerker_id: cel(esc(m.id), m.id, "mono"),
        contractvorm: tekst(m.contractvorm),
        regels: getal(m.regels),
        dagen: getal(m.dagen.size),
        bonnen: getal(m.bonnen.size),
        uren: uren(m.uren, true),
        overwerk: rooster ? cel("—", "") : uren(m.overwerk),
        km: komGetal(m.km),
        maaltijden: getal(m.maaltijden),
        loonkosten: m.loonBekend ? euro(m.loonkosten) : cel("—", ""),
      })),
      leegTekst: "Niets gevonden in deze periode.",
    };

    const bonBlok = {
      sleutel: rooster ? "rooster-totaal-werkbon" : "uren-totaal-werkbon",
      titel: "Per werkbon",
      kolommen: [
        kol("werkbon", "Werkbon"), kol("naam", "Naam"), kol("project_id", "Dienst-id", true),
        kol("regels", eenheid), kol("dagen", "Dagen", true), kol("monteurs", "Monteurs"),
        kol("uren", rooster ? "Geplande uren" : "Gewerkte uren"),
        kol("km", "Kilometers", true), kol("loonkosten", "Loonkosten", true),
      ],
      rijen: [...perBon.entries()].sort((a, b) => b[1].uren - a[1].uren).map(([sleutel, p]) => rij({
        werkbon: cel(werkbonMetKleur({ werkbon: p.werkbon, naam: p.naam, kleur: p.kleur }),
          p.werkbon || "", "mono sterk"),
        naam: tekst(p.naam),
        project_id: cel(esc(sleutel), sleutel, "mono"),
        regels: getal(p.regels),
        dagen: getal(p.dagen.size),
        monteurs: getal(p.monteurs.size),
        uren: uren(p.uren, true),
        km: komGetal(p.km),
        loonkosten: p.loonBekend ? euro(p.loonkosten) : cel("—", ""),
      })),
      leegTekst: "Niets gevonden in deze periode.",
    };

    return { blokken: [monteurBlok, bonBlok] };
  }

  // ── Rapport 6: gepland versus gewerkt ─────────────────────────────────────
  async function haalGeplandGewerkt(ctx) {
    const { data, error } = await db.rpc("rapport_gepland_gewerkt", { p_van: ctx.van, p_tot: ctx.tot });
    if (error) return { fout: "Gepland versus gewerkt kon niet worden berekend: " + error.message };
    const lijst = filterLokaal(data, {});
    return {
      blokken: [{
        sleutel: "geplandgewerkt",
        titel: "Gepland versus gewerkt",
        kolommen: [
          kol("naam", "Monteur"), kol("medewerker_id", "Gebruikers-id", true),
          kol("diensten", "Diensten"), kol("gepland", "Gepland"), kol("geklokt", "Geklokt"),
          kol("open", "Nog te keuren"), kol("verschil", "Verschil"),
          kol("zonder_klok", "Dagen zonder klok"), kol("zonder_rooster", "Dagen zonder rooster"),
          kol("waarschuwing", "Let op"),
        ],
        rijen: lijst.map((r) => rij({
          naam: sterk(r.naam),
          medewerker_id: cel(esc(r.medewerker_id), r.medewerker_id, "mono"),
          diensten: getal(r.diensten),
          gepland: uren(r.geplande_uren),
          geklokt: uren(r.geklokte_uren),
          open: uren(r.open_uren),
          verschil: getekend(r.verschil_uren),
          zonder_klok: getal(r.dagen_zonder_klok),
          zonder_rooster: getal(r.dagen_zonder_rooster),
          waarschuwing: tekst(r.waarschuwing),
        }, r.waarschuwing ? "rij-let-op" : "")),
        leegTekst: "Geen rooster en geen uren in deze periode.",
        voet: "Geplande uren zijn netto: de onbetaalde pauzes zijn er af, net als bij de geklokte uren.",
      }],
      letOp: telLetOp(lijst),
    };
  }

  // ── Rapport 7 en 8: periode-overzicht per week en per dag ─────────────────
  async function haalPeriode(ctx, stap) {
    const { data, error } = await db.rpc("rapport_periode",
      { p_van: ctx.van, p_tot: ctx.tot, p_stap: stap });
    if (error) return { fout: "Het periode-overzicht kon niet worden berekend: " + error.message };
    const lijst = filterLokaal(data, {});
    const perWeek = stap === "week";
    return {
      blokken: [{
        sleutel: perWeek ? "periode-week" : "periode-dag",
        titel: perWeek ? "Per monteur per week" : "Per monteur per dag",
        kolommen: [
          kol("naam", "Monteur"), kol("medewerker_id", "Gebruikers-id", true),
          ...(perWeek ? [kol("label", "Week"), kol("van", "Van"), kol("tot", "Tot en met")]
                      : [kol("van", "Datum"), kol("dag", "Dag")]),
          kol("gewerkt", "Gewerkt"), kol("open", "Nog te keuren"), kol("verlof", "Verlof"),
          kol("contract", "Contract"), kol("plusmin", "Plus/min"),
        ],
        rijen: lijst.map((r) => rij({
          naam: sterk(r.naam),
          medewerker_id: cel(esc(r.medewerker_id), r.medewerker_id, "mono"),
          label: tekst(r.label),
          van: datumCel(r.bucket_van),
          tot: datumCel(r.bucket_tot),
          dag: tekst(dagNaam(r.bucket_van)),
          gewerkt: uren(r.gewerkt_uren),
          open: uren(r.open_uren),
          verlof: uren(r.verlof_uren),
          contract: uren(r.contract_uren),
          plusmin: r.plusmin_telt ? getekend(r.plusmin_uren) : cel('<span class="leeg">n.v.t.</span>', ""),
        })),
        leegTekst: "Geen uren, verlof of contracturen in deze periode.",
        voet: "Plus/min staat op n.v.t. bij contractvormen die er geen bijhouden, zoals ZZP.",
      }],
    };
  }

  // ── Rapport 9: dagboek ────────────────────────────────────────────────────
  async function haalDagboek(ctx) {
    const { data, error } = await db.rpc("dagboek", { p_datum: ctx.van });
    if (error) return { fout: "Het dagboek kon niet worden opgehaald: " + error.message };
    const lijst = filterLokaal(data, { project: "project_id" });
    return {
      blokken: [{
        sleutel: "dagboek",
        titel: "Wat er die dag gebeurde",
        kolommen: [
          kol("tijd", "Tijd"), kol("soort", "Soort"), kol("naam", "Monteur"),
          kol("medewerker_id", "Gebruikers-id", true),
          kol("gebeurtenis", "Gebeurtenis"), kol("werkbon", "Werkbon"),
          kol("toelichting", "Toelichting"),
        ],
        rijen: lijst.map((r) => rij({
          tijd: cel(esc(tijd(r.tijdstip)), String(r.tijdstip || "").slice(11, 16), "mono"),
          soort: cel(`<span class="badge grijs">${esc(r.soort)}</span>`, r.soort),
          naam: sterk(r.naam),
          medewerker_id: cel(esc(r.medewerker_id), r.medewerker_id, "mono"),
          gebeurtenis: tekst(r.gebeurtenis),
          werkbon: tekst(r.werkbon),
          toelichting: tekst(r.toelichting),
        })),
        leegTekst: "Er is die dag niets vastgelegd.",
        voet: "De tijden staan in Nederlandse tijd. Goedkeuringen en wijzigingen kunnen over een andere dag gaan; dat staat in de toelichting.",
      }],
    };
  }

  // ── Rapport 10 en 11: personeel ───────────────────────────────────────────
  //  In pagina's ophalen: de lijst groeit en een vaste limiet kapt hem stil af.
  async function haalPersoneelLijst() {
    return haalAlles((a, b) => db.from("medewerkers")
      .select("id, naam, personeelsnummer, functietitel, rol, actief, contract_type, contract_uren, "
        + "contract_start, contract_eind, datum_in_dienst, verwijderd_op, aangemaakt_op, "
        + "email, telefoon, mobiel, contractvorm_id, contractvormen(naam)")
      .order("naam").range(a, b));
  }

  const PERSONEEL_KOLOMMEN = [
    kol("naam", "Naam"), kol("personeelsnummer", "Personeelsnr"),
    kol("medewerker_id", "Gebruikers-id", true),
    kol("functietitel", "Functie"), kol("rol", "Rol", true),
    kol("contract_type", "Dienstverband"), kol("contractvorm", "Contractvorm"),
    kol("week", "Contracturen per week"), kol("per_dag", "Contracturen per dag", true),
    kol("in_dienst", "In dienst"), kol("contract_eind", "Contract tot", true),
    kol("uit_dienst", "Uit dienst"),
    kol("email", "E-mail"), kol("telefoon", "Telefoon"),
  ];

  function personeelRij(m) {
    const week = urenWeekTotaal(m.contract_uren);
    return rij({
      naam: sterk(m.naam),
      personeelsnummer: tekst(m.personeelsnummer),
      medewerker_id: cel(esc(m.id), m.id, "mono"),
      functietitel: tekst(m.functietitel),
      rol: tekst(m.rol),
      contract_type: tekst(CONTRACT_LABEL[m.contract_type] || m.contract_type),
      contractvorm: tekst(m.contractvormen?.naam),
      week: week != null ? urenAltijd(week) : cel("—", ""),
      per_dag: cel(esc(dagUrenTekst(m.contract_uren)), dagUrenTekst(m.contract_uren)),
      in_dienst: datumCel(inDienstOp(m)),
      contract_eind: datumCel(m.contract_eind),
      uit_dienst: datumCel(m.verwijderd_op ? String(m.verwijderd_op).slice(0, 10) : null),
      email: tekst(m.email),
      telefoon: tekst(m.mobiel || m.telefoon),
    }, m.verwijderd_op ? "rij-verwerkt" : "");
  }

  const dagUrenTekst = (u) => (u ? DAG_KEYS.filter((d) => u[d]).map((d) => d + " " + komma(u[d])).join(" · ") : "");

  // Zonder datum in dienst valt er niet te bepalen wanneer iemand begonnen is;
  // dan is het aanmaken van het record de enige aanwijzing die er is.
  function inDienstOp(m) {
    return m.datum_in_dienst || m.contract_start
      || (m.aangemaakt_op ? String(m.aangemaakt_op).slice(0, 10) : null);
  }

  async function haalPersoneel() {
    const { data, error } = await haalPersoneelLijst();
    if (error) return { fout: "De medewerkers konden niet worden opgehaald: " + error.message };
    const lijst = filterLokaal(data, { medewerker: "id" });
    const inDienst = lijst.filter((m) => !m.verwijderd_op);
    const uitDienst = lijst.filter((m) => m.verwijderd_op)
      .sort((a, b) => String(b.verwijderd_op).localeCompare(String(a.verwijderd_op)));
    const zonderDatum = inDienst.filter((m) => !m.datum_in_dienst && !m.contract_start).length;
    return {
      blokken: [
        { sleutel: "personeel-in", titel: "In dienst", kolommen: PERSONEEL_KOLOMMEN,
          rijen: inDienst.map(personeelRij), leegTekst: "Niemand die aan het filter voldoet." },
        { sleutel: "personeel-uit", titel: "Uit dienst", kolommen: PERSONEEL_KOLOMMEN,
          rijen: uitDienst.map(personeelRij), leegTekst: "Er is nog niemand uit dienst gegaan." },
      ],
      letOp: zonderDatum
        ? zonderDatum + (zonderDatum === 1 ? " medewerker heeft" : " medewerkers hebben")
          + " geen datum in dienst; daar staat de aanmaakdatum van het record."
        : "",
    };
  }

  async function haalNieuwIndienst(ctx) {
    const { data, error } = await haalPersoneelLijst();
    if (error) return { fout: "De medewerkers konden niet worden opgehaald: " + error.message };
    const lijst = filterLokaal(data, { medewerker: "id" })
      .filter((m) => {
        const d = inDienstOp(m);
        return d && d >= ctx.van && d <= ctx.tot;
      })
      .sort((a, b) => String(inDienstOp(a)).localeCompare(String(inDienstOp(b))));
    const geschat = lijst.filter((m) => !m.datum_in_dienst && !m.contract_start).length;
    return {
      blokken: [{
        sleutel: "nieuwindienst", titel: "Nieuw in dienst", kolommen: PERSONEEL_KOLOMMEN,
        rijen: lijst.map(personeelRij),
        leegTekst: "Er is in deze periode niemand begonnen.",
      }],
      letOp: geschat
        ? geschat + (geschat === 1 ? " regel staat" : " regels staan")
          + " hier op de aanmaakdatum van het record, want er is geen datum in dienst ingevuld."
        : "",
    };
  }

  // ── Rapport 12: benodigde diensten ────────────────────────────────────────
  async function haalBenodigd(ctx) {
    const { data, error } = await db.rpc("rapport_benodigde_diensten", { p_van: ctx.van, p_tot: ctx.tot });
    if (error) return { fout: "De benodigde diensten konden niet worden opgehaald: " + error.message };
    const lijst = filterLokaal(data, { project: "project_id" });
    const totaal = lijst.reduce((s, r) => s + (Number(r.uren) || 0), 0);
    return {
      blokken: [{
        sleutel: "benodigd",
        titel: "Diensten zonder bezetting",
        kolommen: [
          kol("datum", "Datum"), kol("dag", "Dag"), kol("werkbon", "Werkbon"),
          kol("project_naam", "Werkbonnaam", true),
          kol("dagdeel", "Dagdeel"), kol("tijden", "Tijden"), kol("uren", "Uren"),
          kol("ingepland_op", "Ingepland op"), kol("reden", "Reden"),
          kol("planning_id", "Rooster-id", true),
        ],
        rijen: lijst.map((r) => rij({
          datum: datumCel(r.datum),
          dag: tekst(dagNaam(r.datum)),
          werkbon: werkbonCel(r),
          project_naam: tekst(r.project_naam),
          dagdeel: tekst(DAGDEEL_LABEL[r.dagdeel] || r.dagdeel),
          tijden: cel(esc(klok(r.start_tijd) + "–" + klok(r.eind_tijd)),
            klok(r.start_tijd) + "-" + klok(r.eind_tijd), "mono"),
          uren: uren(r.uren),
          ingepland_op: tekst(r.ingepland_op),
          reden: tekst(r.reden),
          planning_id: cel(esc(r.planning_id), r.planning_id, "mono"),
        }, "rij-let-op")),
        leegTekst: "Elke geplande dienst heeft een monteur die ook beschikbaar is.",
        voet: lijst.length ? `Samen <b>${esc(urenTekst(totaal))}</b> die nog bemenst moet worden.` : "",
      }],
      letOp: lijst.length
        ? lijst.length + (lijst.length === 1 ? " dienst heeft" : " diensten hebben") + " nog geen bezetting."
        : "",
    };
  }

  function werkbonCel(r) {
    const p = { werkbon: r.werkbon, naam: r.project_naam, kleur: r.project_kleur };
    return cel(r.werkbon || r.project_naam ? werkbonMetKleur(p) : "—",
      (r.werkbon || "") + (r.project_naam ? " " + r.project_naam : ""), "mono");
  }

  function telLetOp(lijst) {
    const n = (lijst || []).filter((r) => r.waarschuwing).length;
    return n ? n + (n === 1 ? " regel vraagt" : " regels vragen") + " aandacht — zie de kolom Let op." : "";
  }

  // ── Tekenen ───────────────────────────────────────────────────────────────
  function tekenBlokken(lijst) {
    blokken = lijst;
    blokkenVak.innerHTML = lijst.map(blokHtml).join("");
  }

  function blokHtml(b, i) {
    const kolommen = zichtbareKolommen(b);
    const getoond = b.rijen.slice(0, MAX_GETOOND);
    const afgekapt = b.rijen.length - getoond.length;
    const lijf = getoond.length
      ? getoond.map((r) => `<tr${r.klasse ? ` class="${r.klasse}"` : ""}>${
          kolommen.map((k) => {
            const c = r.c[k.s] || cel("—", "");
            return `<td${c.k ? ` class="${c.k}"` : ""}>${c.t}</td>`;
          }).join("")}</tr>`).join("")
      : rijLeeg(kolommen.length, b.leegTekst || "Niets gevonden.");
    const voetstukken = [];
    if (afgekapt) {
      voetstukken.push(`Alleen de eerste ${MAX_GETOOND} regels staan hier; de export bevat alle `
        + `${b.rijen.length} regels.`);
    }
    if (b.voet) voetstukken.push(b.voet);
    return `
      <div class="rp-blok">
        <div class="kaart-kop">
          <h3>${esc(b.titel)}<span class="rp-telling">${b.rijen.length} ${b.rijen.length === 1 ? "regel" : "regels"}</span></h3>
          <div class="knoprij">
            <button class="btn btn-grijs btn-klein rp-kolomknop" data-rpblok="${i}">Kolommen (${kolommen.length}/${b.kolommen.length})</button>
            <button class="btn btn-grijs btn-klein rp-export" data-rpblok="${i}">Exporteer CSV</button>
          </div>
        </div>
        ${kiezerHtml(b, i)}
        <div class="tabelwrap"><table>
          <thead><tr>${kolommen.map((k) => `<th>${esc(k.k)}</th>`).join("")}</tr></thead>
          <tbody>${lijf}</tbody>
        </table></div>
        ${voetstukken.length ? `<div class="rp-voet">${voetstukken.join(" ")}</div>` : ""}
      </div>`;
  }

  function kiezerHtml(b, i) {
    const aan = new Set(zichtbareKolommen(b).map((k) => k.s));
    return `
      <div class="rp-kolomkiezer verborgen" data-rpkiezer="${i}">
        <div class="rp-kolomlijst">
          ${b.kolommen.map((k) => `<label><input type="checkbox" data-rpkol="${esc(k.s)}" data-rpblok="${i}"${
            aan.has(k.s) ? " checked" : ""}> ${esc(k.k)}</label>`).join("")}
        </div>
        <div class="knoprij">
          <button class="btn btn-grijs btn-klein rp-kol-standaard" data-rpblok="${i}">Standaardkolommen</button>
          <button class="btn btn-grijs btn-klein rp-kol-alles" data-rpblok="${i}">Alles aan</button>
        </div>
      </div>`;
  }

  // Eén blok opnieuw tekenen na een kolomwijziging: de gegevens staan al in het
  // geheugen, opnieuw ophalen zou alleen maar wachttijd toevoegen.
  function herteken(i, kiezerOpen) {
    const oud = blokkenVak.querySelectorAll(".rp-blok")[i];
    if (!oud) return;
    const nieuw = document.createElement("div");
    nieuw.innerHTML = blokHtml(blokken[i], i);
    const vervanger = nieuw.firstElementChild;
    oud.replaceWith(vervanger);
    if (kiezerOpen) vervanger.querySelector(".rp-kolomkiezer").classList.remove("verborgen");
  }

  function tekenLeeg(bericht) {
    blokken = [];
    blokkenVak.innerHTML = `<div class="rp-blok"><p class="leeg">${esc(bericht)}</p></div>`;
  }

  function tekenKeuze() {
    $("rpKeuze").innerHTML = RAPPORTEN.map((r) =>
      `<button type="button" class="rp-tab${r.code === huidig.code ? " actief" : ""}" data-rp="${r.code}">${esc(r.titel)}</button>`
    ).join("");
  }

  function tekenGrondslag() {
    const heeft = !!huidig.grondslagen;
    $("rpGrondslagVak").classList.toggle("verborgen", !heeft);
    if (!heeft) return;
    $("rpGrondslag").innerHTML = huidig.grondslagen.map((g) =>
      `<button type="button" class="modus${g === grondslag ? " actief" : ""}" data-rpgrond="${g}">${esc(GRONDSLAG_LABEL[g])}</button>`
    ).join("");
  }

  // ── Periode- en filterbalk ────────────────────────────────────────────────
  //  De kaart zelf blijft altijd staan: ook een rapport zonder periode moet je
  //  opnieuw kunnen ophalen, en dat gaat via dezelfde knop.
  function zetBalk() {
    const bereik = huidig.periode === "bereik";
    const eenDag = huidig.periode === "dag";
    $("rpVanVak").classList.toggle("verborgen", !bereik);
    $("rpTotVak").classList.toggle("verborgen", !bereik);
    $("rpDatumVak").classList.toggle("verborgen", !eenDag);
    $("rpSnelBalk").classList.toggle("verborgen", !bereik);
    $("rpGeenPeriode").classList.toggle("verborgen", huidig.periode !== "geen");
    $("rpToon").textContent = huidig.periode === "geen" ? "Ververs" : "Toon rapport";

    const kan = huidig.filters || [];
    $("rpFilterMedewerkerVak").classList.toggle("verborgen", !kan.includes("medewerker"));
    $("rpFilterWerkbonVak").classList.toggle("verborgen", !kan.includes("werkbon"));
    $("rpFilterVormVak").classList.toggle("verborgen", !kan.includes("contractvorm"));
    // Een filter dat dit rapport niet kent mag ook niet stilletjes blijven
    // staan: dan zou het lijken alsof er op gefilterd is.
    if (!kan.includes("medewerker")) $("rpFilterMedewerker").value = "";
    if (!kan.includes("werkbon")) $("rpFilterWerkbon").value = "";
    if (!kan.includes("contractvorm")) $("rpFilterVorm").value = "";
  }

  function standaardPeriode() {
    const nu = new Date();
    $("rpVan").value = isoDatum(new Date(nu.getFullYear(), nu.getMonth(), 1));
    $("rpTot").value = isoDatum(new Date(nu.getFullYear(), nu.getMonth() + 1, 0));
    $("rpDatum").value = isoDatum(nu);
  }

  function gekozenPeriode() {
    if (huidig.periode === "dag") {
      const d = $("rpDatum").value;
      return d ? { van: d, tot: d, naam: d } : null;
    }
    if (huidig.periode === "geen") return { van: null, tot: null, naam: isoDatum(new Date()) };
    const van = $("rpVan").value, tot = $("rpTot").value;
    if (!van || !tot) return null;
    if (tot < van) return { fout: "De einddatum ligt voor de begindatum." };
    return { van, tot, naam: van + "_" + tot };
  }

  // ── Ophalen en tonen ──────────────────────────────────────────────────────
  async function toon() {
    const melding = $("rpMelding");
    const periode = gekozenPeriode();
    if (!periode) {
      verberg(melding);
      tekenLeeg("Kies eerst een periode.");
      return;
    }
    if (periode.fout) {
      toonMeld(melding, "fout", periode.fout);
      tekenLeeg("Corrigeer de periode.");
      return;
    }
    const mijnNr = ++verzoekNr;
    const rapport = huidig;
    $("rpToon").disabled = true;
    try {
      $("rpTitel").textContent = rapport.titel
        + (rapport.grondslagen ? " — " + GRONDSLAG_LABEL[grondslag].toLowerCase() : "");
      $("rpUitleg").textContent = rapport.uitleg + " " + periodeTekst(rapport, periode) + filterTekst();
      tekenLeeg("Bezig met ophalen…");
      verberg(melding);

      const uitkomst = await rapport.haal({
        van: periode.van, tot: periode.tot,
        grondslag: rapport.grondslagen ? grondslag : null,
        filters: filters(),
      });
      if (mijnNr !== verzoekNr) return;

      // Een mislukte query en een lege lijst zien er op het scherm identiek uit.
      // Daarom hier altijd de foutmelding erbij, en geen tabel die suggereert
      // dat er niets te melden viel.
      if (uitkomst.fout) {
        toonMeld(melding, "fout", uitkomst.fout);
        tekenLeeg("Dit rapport is NIET compleet — het ophalen is mislukt.");
        return;
      }
      periodeNaam = periode.naam;
      getoondeTitel = rapport.titel + (rapport.grondslagen ? "-" + grondslag : "");
      tekenBlokken(uitkomst.blokken);
      const meldingen = [_lijstenFout
        ? "De filterlijsten konden niet worden geladen (" + _lijstenFout + "); filteren werkt daardoor niet."
        : "", uitkomst.letOp].filter(Boolean);
      if (_lijstenFout) toonMeld(melding, "fout", meldingen.join(" "));
      else if (uitkomst.letOp) toonMeld(melding, "amber", uitkomst.letOp);
      else verberg(melding);
    } catch (e) {
      if (mijnNr !== verzoekNr) return;
      toonMeld(melding, "fout", "Er ging iets mis bij het opbouwen van dit rapport: " + (e && e.message ? e.message : e));
      tekenLeeg("Dit rapport is NIET compleet.");
    } finally {
      if (mijnNr === verzoekNr) $("rpToon").disabled = false;
    }
  }

  function periodeTekst(rapport, periode) {
    if (rapport.periode === "geen") return "Stand van " + langeDatum(isoDatum(new Date())) + ".";
    if (rapport.periode === "dag") return langeDatum(periode.van) + ".";
    return langeDatum(periode.van) + " t/m " + langeDatum(periode.tot) + ".";
  }

  function kiesRapport(code) {
    const gekozen = RAPPORTEN.find((r) => r.code === code);
    if (!gekozen) return;
    huidig = gekozen;
    if (gekozen.grondslagen && !gekozen.grondslagen.includes(grondslag)) grondslag = gekozen.grondslagen[0];
    tekenKeuze();
    tekenGrondslag();
    zetBalk();
    toon();
  }

  // ── Knoppen ───────────────────────────────────────────────────────────────
  $("rpKeuze").addEventListener("click", (e) => {
    const knop = e.target.closest(".rp-tab");
    if (knop) kiesRapport(knop.dataset.rp);
  });
  $("rpGrondslag").addEventListener("click", (e) => {
    const knop = e.target.closest("[data-rpgrond]");
    if (!knop || knop.dataset.rpgrond === grondslag) return;
    grondslag = knop.dataset.rpgrond;
    tekenGrondslag();
    toon();
  });
  $("rpToon").addEventListener("click", toon);
  ["rpFilterMedewerker", "rpFilterWerkbon", "rpFilterVorm"].forEach((id) =>
    $(id).addEventListener("change", toon));
  $("rpFilterWissen").addEventListener("click", () => {
    $("rpFilterMedewerker").value = "";
    $("rpFilterWerkbon").value = "";
    $("rpFilterVorm").value = "";
    toon();
  });

  $("rpSnelBalk").addEventListener("click", (e) => {
    const knop = e.target.closest(".rp-snel");
    if (!knop) return;
    const nu = new Date();
    let van, tot;
    if (knop.dataset.rpsnel === "week") {
      van = maandagVan(nu); tot = new Date(van); tot.setDate(tot.getDate() + 6);
    } else if (knop.dataset.rpsnel === "vorige-week") {
      van = maandagVan(nu); van.setDate(van.getDate() - 7); tot = new Date(van); tot.setDate(tot.getDate() + 6);
    } else if (knop.dataset.rpsnel === "maand") {
      van = new Date(nu.getFullYear(), nu.getMonth(), 1); tot = new Date(nu.getFullYear(), nu.getMonth() + 1, 0);
    } else if (knop.dataset.rpsnel === "vorige-maand") {
      van = new Date(nu.getFullYear(), nu.getMonth() - 1, 1); tot = new Date(nu.getFullYear(), nu.getMonth(), 0);
    } else {
      van = new Date(nu.getFullYear(), 0, 1); tot = new Date(nu.getFullYear(), 11, 31);
    }
    $("rpVan").value = isoDatum(van);
    $("rpTot").value = isoDatum(tot);
    toon();
  });

  blokkenVak.addEventListener("click", (e) => {
    const exporteer = e.target.closest(".rp-export");
    if (exporteer) {
      const blok = blokken[Number(exporteer.dataset.rpblok)];
      if (!blok || !blok.rijen.length) return alert("Er is niets om te exporteren.");
      const kolommen = zichtbareKolommen(blok);
      csvDownload(kolommen.map((k) => k.k),
        blok.rijen.map((r) => kolommen.map((k) => (r.c[k.s] || cel("", "")).w)),
        bestandsnaam(blok.titel));
      return;
    }
    const kolomknop = e.target.closest(".rp-kolomknop");
    if (kolomknop) {
      const kiezer = blokkenVak.querySelector(`[data-rpkiezer="${kolomknop.dataset.rpblok}"]`);
      if (kiezer) kiezer.classList.toggle("verborgen");
      return;
    }
    const standaard = e.target.closest(".rp-kol-standaard");
    if (standaard) {
      const i = Number(standaard.dataset.rpblok);
      wisKeuze(blokken[i].sleutel);
      herteken(i, true);
      return;
    }
    const alles = e.target.closest(".rp-kol-alles");
    if (alles) {
      const i = Number(alles.dataset.rpblok);
      schrijfKeuze(blokken[i].sleutel, blokken[i].kolommen.map((k) => k.s));
      herteken(i, true);
    }
  });

  blokkenVak.addEventListener("change", (e) => {
    const vinkje = e.target.closest("[data-rpkol]");
    if (!vinkje) return;
    const i = Number(vinkje.dataset.rpblok);
    const blok = blokken[i];
    if (!blok) return;
    const aan = [...blokkenVak.querySelectorAll(`[data-rpkiezer="${i}"] [data-rpkol]`)]
      .filter((v) => v.checked).map((v) => v.dataset.rpkol);
    // De volgorde van de kolomlijst bepaalt de volgorde in de tabel, niet de
    // volgorde waarin je ze aanvinkt.
    schrijfKeuze(blok.sleutel, blok.kolommen.filter((k) => aan.includes(k.s)).map((k) => k.s));
    herteken(i, true);
  });

  function bestandsnaam(blokTitel) {
    const kaal = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const rapport = kaal(getoondeTitel);
    const blok = kaal(blokTitel);
    // Bij een rapport met één tabel heet het blok net zo als het rapport; dan
    // levert samenvoegen "plus-min-plus-min-2026-07" op.
    return (blok && blok !== rapport ? rapport + "-" + blok : rapport) + "-" + periodeNaam;
  }

  // ── Opstarten ─────────────────────────────────────────────────────────────
  standaardPeriode();
  tekenKeuze();
  tekenGrondslag();
  zetBalk();
  $("rpTitel").textContent = huidig.titel;
  $("rpUitleg").textContent = huidig.uitleg;
  tekenLeeg("Kies een rapport hierboven, of klik op Ververs.");
  // De filterlijsten alvast ophalen; een fout hierin komt bij het eerste
  // rapport zichtbaar in beeld en verdwijnt niet in de console.
  const lijstenKlaar = laadFilterlijsten();

  return {
    toon,
    kies: kiesRapport,
    lijstenKlaar,   // zodat een aanroeper kan wachten tot de filters gevuld zijn
  };
}

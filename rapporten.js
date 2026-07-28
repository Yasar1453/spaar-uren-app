// ============================================================================
//  Spaar Electra — Urenregistratie · de overige Shiftbase-rapportages
//
//  Twaalf overzichten die in Shiftbase wel bestonden en bij ons nog niet:
//  verlofsaldo (totaal en per mutatie), plus/min, rooster (detail en totalen),
//  gepland versus gewerkt, periode-overzicht per week en per dag, dagboek,
//  personeelslijst, nieuw in dienst en benodigde diensten.
//
//  Ze staan in een eigen bestand omdat ze niets van het beheerscherm nodig
//  hebben behalve de opmaakhulpjes: één losse module blijft leesbaar en botst
//  niet met het werk in beheer.js. Alle DOM-id's beginnen daarom met "rp".
//
//  Alle rapporten delen dezelfde opbouw — kies een rapport, kies een periode,
//  krijg één of meer tabellen met een eigen CSV-knop. Dat scheelt twaalf keer
//  dezelfde tabelcode, en belangrijker: elk rapport meldt een databasefout op
//  precies dezelfde manier. Deze cijfers gaan naar de loonadministratie, dus
//  een mislukte query mag nooit als "niemand heeft gewerkt" op het scherm
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
    const tekst = "De rapportagesectie is niet gevonden. Plak de HTML uit app/rapporten.html.txt "
      + 'in <section data-view="rapporten"> van beheer.html.';
    const sectie = document.querySelector('[data-view="rapporten"]');
    if (sectie) {
      const vak = document.createElement("div");
      vak.className = "melding fout";
      vak.textContent = tekst;
      sectie.appendChild(vak);
    }
    console.error(tekst);
    return { toon() {} };
  }

  // ── Cellen ────────────────────────────────────────────────────────────────
  //  Elke cel draagt twee waarden: `t` is de opgemaakte HTML voor het scherm,
  //  `w` de kale waarde voor de CSV. Zo kan de export nooit uit de pas lopen
  //  met wat er getoond wordt, en gaan er geen opmaaktekens de loonadministratie
  //  in.
  const cel = (t, w, k) => ({ t, w: w === undefined || w === null ? "" : w, k: k || "" });
  const tekst = (v) => cel(v == null || v === "" ? "—" : esc(v), v == null ? "" : v);
  const sterk = (v) => cel(v == null || v === "" ? "—" : esc(v), v == null ? "" : v, "sterk");
  const getal = (v) => cel(String(v == null ? 0 : v), v == null ? 0 : v, "mono");
  // Nul uren als streepje: in een lange lijst leest "0 min" als een ingevuld
  // getal, terwijl het meestal "niets geregistreerd" betekent.
  const uren = (v, dik) => cel(Number(v) ? urenTekst(v) : "—", komma(v), "mono" + (dik ? " sterk" : ""));
  const urenAltijd = (v, dik) => cel(urenTekst(v), komma(v), "mono" + (dik ? " sterk" : ""));

  function getekend(v) {
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
  const volleDatumCel = (d) => cel(d ? esc(korteDatum(d)) : "—", d || "", "mono");
  const klok = (t) => (t ? String(t).slice(0, 5) : "");
  const DAGDEEL_LABEL = { hele_dag: "hele dag", ochtend: "ochtend", middag: "middag" };

  // ── De twaalf rapporten ───────────────────────────────────────────────────
  //  `periode` bepaalt welke datumvelden zichtbaar zijn: een bereik, één dag,
  //  of geen — een verlofsaldo en een personeelslijst gelden op dit moment en
  //  niet over een periode.
  const RAPPORTEN = [
    { code: "verlofsaldo", titel: "Verlofsaldo totalen", periode: "geen",
      uitleg: "Opbouw en opname per monteur, zoals het saldo er nu voor staat. Oud-medewerkers staan erbij: een restsaldo moet nog afgerekend worden.",
      haal: haalVerlofsaldo },
    { code: "verlofdetail", titel: "Verlofsaldo gedetailleerd", periode: "bereik",
      uitleg: "Elke mutatie apart, met het saldo dat er daarna stond. Het lopend saldo telt vanaf indiensttreding, niet vanaf het begin van de gekozen periode.",
      haal: haalVerlofdetail },
    { code: "plusmin", titel: "Plus/min per monteur", periode: "bereik",
      uitleg: "Gewerkt plus verlof min contracturen, voor de contractvormen die plus/min bijhouden. Dezelfde berekening als de uitbetaling.",
      haal: haalPlusmin },
    { code: "roosterdetail", titel: "Roosterdetail", periode: "bereik",
      uitleg: "Alle geplande diensten, regel voor regel. De uren zijn netto: de onbetaalde pauzes zijn er al af.",
      haal: haalRoosterdetail },
    { code: "roostertotalen", titel: "Roostertotalen", periode: "bereik",
      uitleg: "Dezelfde diensten, opgeteld per monteur en per werkbon.",
      haal: haalRoostertotalen },
    { code: "geplandgewerkt", titel: "Gepland versus gewerkt", periode: "bereik",
      uitleg: "Wat er in het rooster stond tegenover wat er geklokt is, met de dagen waarop er niets tegenover stond.",
      haal: haalGeplandGewerkt },
    { code: "periodeweek", titel: "Periode-overzicht (per week)", periode: "bereik",
      uitleg: "Per monteur per week: gewerkt, verlof, contracturen en plus/min.",
      haal: (van, tot) => haalPeriode(van, tot, "week") },
    { code: "periodedag", titel: "Dagelijks periode-overzicht", periode: "bereik",
      uitleg: "Hetzelfde overzicht, maar per dag. Hooguit een kwartaal per keer.",
      haal: (van, tot) => haalPeriode(van, tot, "dag") },
    { code: "dagboek", titel: "Dagboek", periode: "dag",
      uitleg: "Chronologisch alles wat er op één dag gebeurde: klokacties, verlof, goedkeuringen en wijzigingen.",
      haal: haalDagboek },
    { code: "personeel", titel: "Actieve en oud-medewerkers", periode: "geen",
      uitleg: "De hele personeelslijst, gesplitst in wie er in dienst is en wie uit dienst is gegaan.",
      haal: haalPersoneel },
    { code: "nieuwindienst", titel: "Nieuw in dienst", periode: "bereik",
      uitleg: "Wie er in de gekozen periode is begonnen, op datum in dienst of anders op de contractstartdatum.",
      haal: haalNieuwIndienst },
    { code: "benodigd", titel: "Benodigde diensten", periode: "bereik",
      uitleg: "Geplande diensten waar feitelijk niemand op staat: geen monteur toegewezen, of de ingeplande monteur is afwezig of uit dienst.",
      haal: haalBenodigd },
  ];

  let huidig = RAPPORTEN[0];
  let blokken = [];
  let periodeNaam = "";      // vastgelegd bij het tekenen, zodat de CSV-naam bij de cijfers hoort
  let getoondeTitel = "";
  // Doorklikken door de rapportlijst start meerdere ophaalacties tegelijk. Zonder
  // volgnummer kan een traag rapport de tabel van een sneller rapport dat er
  // ná hem is aangeklikt overschrijven — met de kop van het verkeerde rapport
  // erboven. Alleen het laatst gevraagde rapport mag tekenen.
  let verzoekNr = 0;

  // ── Rapport 1: verlofsaldo totalen ────────────────────────────────────────
  async function haalVerlofsaldo() {
    const { data, error } = await db.rpc("rapport_verlofsaldo");
    if (error) return { fout: "Het verlofsaldo kon niet worden berekend: " + error.message };
    const rijen = (data || []).map((r) => ({
      klasse: r.waarschuwing ? "rij-let-op" : "",
      cellen: [
        sterk(r.naam),
        tekst(r.beleid),
        uren(r.beginsaldo),
        uren(r.opgebouwd),
        uren(r.opgenomen),
        uren(r.aangevraagd),
        saldoCel(r.resterend),
        volleDatumCel(r.uit_dienst_op),
        tekst(r.waarschuwing),
      ],
    }));
    return {
      blokken: [{
        titel: "Verlofsaldo per monteur",
        kolommen: ["Monteur", "Beleid", "Beginsaldo", "Opgebouwd", "Opgenomen", "Aangevraagd",
          "Resterend", "Uit dienst", "Let op"],
        rijen,
        leegTekst: "Er zijn nog geen medewerkers.",
      }],
      letOp: telLetOp(data),
    };
  }

  // ── Rapport 2: verlofsaldo gedetailleerd ──────────────────────────────────
  async function haalVerlofdetail(van, tot) {
    const { data, error } = await db.rpc("rapport_verlofmutaties", { p_van: van, p_tot: tot });
    if (error) return { fout: "De verlofmutaties konden niet worden opgehaald: " + error.message };
    const rijen = (data || []).map((r) => ({
      cellen: [
        sterk(r.naam),
        volleDatumCel(r.datum),
        tekst(r.aard),
        r.soort ? cel(typeLabel(r.soort), r.soort_naam || r.soort) : cel("—", ""),
        r.van_datum
          ? cel(esc(korteDatum(r.van_datum) + " t/m " + korteDatum(r.tot_datum)),
              r.van_datum + " t/m " + r.tot_datum, "mono")
          : cel("—", ""),
        r.van_datum ? getal(werkdagenTussen(r.van_datum, r.tot_datum)) : cel("—", ""),
        getekend(r.mutatie),
        urenAltijd(r.saldo_na, true),
        cel(statusBadge(r.status), r.status),
        tekst(r.toelichting),
      ],
    }));
    return {
      blokken: [{
        titel: "Verlofmutaties",
        kolommen: ["Monteur", "Datum", "Aard", "Soort", "Verlofperiode", "Werkdagen",
          "Mutatie", "Saldo daarna", "Status", "Toelichting"],
        rijen,
        leegTekst: "Geen opbouw of opname in deze periode.",
      }],
      letOp: (data || []).some((r) => r.aard === "Aangevraagd")
        ? "Aanvragen die nog niet zijn beoordeeld staan erbij, maar tellen niet mee in het saldo daarnaast."
        : "",
    };
  }

  // ── Rapport 3: plus/min per monteur ───────────────────────────────────────
  async function haalPlusmin(van, tot) {
    const { data, error } = await db.rpc("rapport_plusmin", { p_van: van, p_tot: tot });
    if (error) return { fout: "De plus/min kon niet worden berekend: " + error.message };
    const rijen = (data || []).map((r) => ({
      klasse: r.waarschuwing ? "rij-let-op" : "",
      cellen: [
        sterk(r.naam),
        tekst(r.contractvorm),
        uren(r.gewerkt_uren),
        uren(r.verlof_uren),
        uren(r.contract_uren),
        getekend(r.plusmin_periode),
        getekend(r.plusmin_totaal),
        uren(r.open_uren),
        tekst(r.waarschuwing),
      ],
    }));
    return {
      blokken: [{
        titel: "Plus/min",
        kolommen: ["Monteur", "Contractvorm", "Gewerkt", "Verlof", "Contract",
          "Plus/min in periode", "Plus/min totaal", "Nog te keuren", "Let op"],
        rijen,
        leegTekst: "Geen gegevens in deze periode.",
      }],
      letOp: telLetOp(data),
    };
  }

  // ── Rapport 4: roosterdetail ──────────────────────────────────────────────
  async function haalRooster(van, tot) {
    return db.rpc("rapport_rooster", { p_van: van, p_tot: tot });
  }

  async function haalRoosterdetail(van, tot) {
    const { data, error } = await haalRooster(van, tot);
    if (error) return { fout: "Het rooster kon niet worden opgehaald: " + error.message };
    const rijen = (data || []).map((r) => ({
      klasse: r.naam ? "" : "rij-let-op",
      cellen: [
        volleDatumCel(r.datum),
        tekst(dagNaam(r.datum)),
        r.naam ? sterk(r.naam) : cel('<span class="leeg">niemand toegewezen</span>', ""),
        werkbonCel(r),
        tekst(DAGDEEL_LABEL[r.dagdeel] || r.dagdeel),
        cel(esc(klok(r.start_tijd)), klok(r.start_tijd), "mono"),
        cel(esc(klok(r.eind_tijd)), klok(r.eind_tijd), "mono"),
        uren(r.uren, true),
      ],
    }));
    const totaal = (data || []).reduce((s, r) => s + (Number(r.uren) || 0), 0);
    return {
      blokken: [{
        titel: "Geplande diensten",
        kolommen: ["Datum", "Dag", "Monteur", "Werkbon", "Dagdeel", "Van", "Tot", "Uren"],
        rijen,
        leegTekst: "Er staat niets ingepland in deze periode.",
        voet: `${(data || []).length} diensten, samen <b>${esc(urenTekst(totaal))}</b>.`,
      }],
    };
  }

  // ── Rapport 5: roostertotalen ─────────────────────────────────────────────
  async function haalRoostertotalen(van, tot) {
    const { data, error } = await haalRooster(van, tot);
    if (error) return { fout: "Het rooster kon niet worden opgehaald: " + error.message };
    const regels = data || [];

    // Op id groeperen en niet op naam: twee naamgenoten mogen niet samenvallen.
    const perMonteur = new Map();
    regels.forEach((r) => {
      const sleutel = r.medewerker_id || "geen";
      if (!perMonteur.has(sleutel)) {
        perMonteur.set(sleutel, { naam: r.naam || "niemand toegewezen", diensten: 0, uren: 0, dagen: new Set(), bonnen: new Set() });
      }
      const m = perMonteur.get(sleutel);
      m.diensten++;
      m.uren += Number(r.uren) || 0;
      m.dagen.add(r.datum);
      if (r.werkbon) m.bonnen.add(r.werkbon);
    });

    const perBon = new Map();
    regels.forEach((r) => {
      const sleutel = (r.werkbon || "—") + "|" + (r.project_naam || "");
      if (!perBon.has(sleutel)) {
        perBon.set(sleutel, { werkbon: r.werkbon, naam: r.project_naam, kleur: r.project_kleur,
          diensten: 0, uren: 0, monteurs: new Set() });
      }
      const p = perBon.get(sleutel);
      p.diensten++;
      p.uren += Number(r.uren) || 0;
      if (r.medewerker_id) p.monteurs.add(r.medewerker_id);
    });

    const monteurRijen = [...perMonteur.values()]
      .sort((a, b) => b.uren - a.uren)
      .map((m) => ({ cellen: [sterk(m.naam), getal(m.diensten), getal(m.dagen.size), getal(m.bonnen.size), uren(m.uren, true)] }));
    const bonRijen = [...perBon.values()]
      .sort((a, b) => b.uren - a.uren)
      .map((p) => ({ cellen: [
        cel(werkbonMetKleur({ werkbon: p.werkbon, naam: p.naam, kleur: p.kleur }), p.werkbon || "", "mono sterk"),
        tekst(p.naam), getal(p.diensten), getal(p.monteurs.size), uren(p.uren, true),
      ] }));

    return {
      blokken: [
        { titel: "Per monteur", kolommen: ["Monteur", "Diensten", "Dagen", "Werkbonnen", "Geplande uren"],
          rijen: monteurRijen, leegTekst: "Er staat niets ingepland in deze periode." },
        { titel: "Per werkbon", kolommen: ["Werkbon", "Naam", "Diensten", "Monteurs", "Geplande uren"],
          rijen: bonRijen, leegTekst: "Er staat niets ingepland in deze periode." },
      ],
    };
  }

  // ── Rapport 6: gepland versus gewerkt ─────────────────────────────────────
  async function haalGeplandGewerkt(van, tot) {
    const { data, error } = await db.rpc("rapport_gepland_gewerkt", { p_van: van, p_tot: tot });
    if (error) return { fout: "Gepland versus gewerkt kon niet worden berekend: " + error.message };
    const rijen = (data || []).map((r) => ({
      klasse: r.waarschuwing ? "rij-let-op" : "",
      cellen: [
        sterk(r.naam),
        getal(r.diensten),
        uren(r.geplande_uren),
        uren(r.geklokte_uren),
        uren(r.open_uren),
        getekend(r.verschil_uren),
        getal(r.dagen_zonder_klok),
        getal(r.dagen_zonder_rooster),
        tekst(r.waarschuwing),
      ],
    }));
    return {
      blokken: [{
        titel: "Gepland versus gewerkt",
        kolommen: ["Monteur", "Diensten", "Gepland", "Geklokt", "Nog te keuren", "Verschil",
          "Dagen zonder klok", "Dagen zonder rooster", "Let op"],
        rijen,
        leegTekst: "Geen rooster en geen uren in deze periode.",
        voet: "Geplande uren zijn netto: de onbetaalde pauzes zijn er af, net als bij de geklokte uren.",
      }],
      letOp: telLetOp(data),
    };
  }

  // ── Rapport 7 en 8: periode-overzicht per week en per dag ─────────────────
  async function haalPeriode(van, tot, stap) {
    const { data, error } = await db.rpc("rapport_periode", { p_van: van, p_tot: tot, p_stap: stap });
    if (error) return { fout: "Het periode-overzicht kon niet worden berekend: " + error.message };
    const perWeek = stap === "week";
    const rijen = (data || []).map((r) => ({
      cellen: [
        sterk(r.naam),
        perWeek ? tekst(r.label) : volleDatumCel(r.bucket_van),
        perWeek ? volleDatumCel(r.bucket_van) : tekst(dagNaam(r.bucket_van)),
        ...(perWeek ? [volleDatumCel(r.bucket_tot)] : []),
        uren(r.gewerkt_uren),
        uren(r.open_uren),
        uren(r.verlof_uren),
        uren(r.contract_uren),
        r.plusmin_telt ? getekend(r.plusmin_uren) : cel('<span class="leeg">n.v.t.</span>', ""),
      ],
    }));
    return {
      blokken: [{
        titel: perWeek ? "Per monteur per week" : "Per monteur per dag",
        kolommen: perWeek
          ? ["Monteur", "Week", "Van", "Tot en met", "Gewerkt", "Nog te keuren", "Verlof", "Contract", "Plus/min"]
          : ["Monteur", "Datum", "Dag", "Gewerkt", "Nog te keuren", "Verlof", "Contract", "Plus/min"],
        rijen,
        leegTekst: "Geen uren, verlof of contracturen in deze periode.",
        voet: "Plus/min staat op n.v.t. bij contractvormen die er geen bijhouden, zoals ZZP.",
      }],
    };
  }

  // ── Rapport 9: dagboek ────────────────────────────────────────────────────
  async function haalDagboek(dag) {
    const { data, error } = await db.rpc("dagboek", { p_datum: dag });
    if (error) return { fout: "Het dagboek kon niet worden opgehaald: " + error.message };
    const rijen = (data || []).map((r) => ({
      cellen: [
        cel(esc(tijd(r.tijdstip)), String(r.tijdstip || "").slice(11, 16), "mono"),
        cel(`<span class="badge grijs">${esc(r.soort)}</span>`, r.soort),
        sterk(r.naam),
        tekst(r.gebeurtenis),
        tekst(r.werkbon),
        tekst(r.toelichting),
      ],
    }));
    return {
      blokken: [{
        titel: "Wat er die dag gebeurde",
        kolommen: ["Tijd", "Soort", "Monteur", "Gebeurtenis", "Werkbon", "Toelichting"],
        rijen,
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
        + "email, telefoon, mobiel, contractvormen(naam)")
      .order("naam").range(a, b));
  }

  const CONTRACT_LABEL = { vast: "Vast", tijdelijk: "Tijdelijk", oproep: "Oproep" };

  function personeelRij(m) {
    const week = urenWeekTotaal(m.contract_uren);
    return {
      cellen: [
        sterk(m.naam),
        tekst(m.personeelsnummer),
        tekst(m.functietitel),
        tekst(m.rol),
        tekst(CONTRACT_LABEL[m.contract_type] || m.contract_type),
        tekst(m.contractvormen?.naam),
        week != null ? urenAltijd(week) : cel("—", ""),
        volleDatumCel(inDienstOp(m)),
        volleDatumCel(m.contract_eind),
        volleDatumCel(m.verwijderd_op ? String(m.verwijderd_op).slice(0, 10) : null),
        tekst(m.email),
        tekst(m.mobiel || m.telefoon),
        // De contracturen per dag alleen in de export: op het scherm zouden het
        // zeven extra kolommen zijn die je zelden nodig hebt.
        cel("", DAG_KEYS.map((d) => d + " " + komma((m.contract_uren || {})[d] || 0)).join(" · ")),
      ],
    };
  }

  const PERSONEEL_KOLOMMEN = ["Naam", "Personeelsnr", "Functie", "Rol", "Dienstverband", "Contractvorm",
    "Contracturen per week", "In dienst", "Contract tot", "Uit dienst", "E-mail", "Telefoon",
    "Contracturen per dag"];

  // Zonder datum in dienst valt er niet te bepalen wanneer iemand begonnen is;
  // dan is het aanmaken van het record de enige aanwijzing die er is.
  function inDienstOp(m) {
    return m.datum_in_dienst || m.contract_start
      || (m.aangemaakt_op ? String(m.aangemaakt_op).slice(0, 10) : null);
  }

  async function haalPersoneel() {
    const { data, error } = await haalPersoneelLijst();
    if (error) return { fout: "De medewerkers konden niet worden opgehaald: " + error.message };
    const lijst = data || [];
    const inDienst = lijst.filter((m) => !m.verwijderd_op);
    const uitDienst = lijst.filter((m) => m.verwijderd_op)
      .sort((a, b) => String(b.verwijderd_op).localeCompare(String(a.verwijderd_op)));
    const zonderDatum = inDienst.filter((m) => !m.datum_in_dienst && !m.contract_start).length;
    return {
      blokken: [
        { titel: "In dienst", kolommen: PERSONEEL_KOLOMMEN, rijen: inDienst.map(personeelRij),
          leegTekst: "Er is niemand in dienst." },
        { titel: "Uit dienst", kolommen: PERSONEEL_KOLOMMEN, rijen: uitDienst.map(personeelRij),
          leegTekst: "Er is nog niemand uit dienst gegaan." },
      ],
      letOp: zonderDatum
        ? zonderDatum + (zonderDatum === 1 ? " medewerker heeft" : " medewerkers hebben")
          + " geen datum in dienst; daar staat de aanmaakdatum van het record."
        : "",
    };
  }

  async function haalNieuwIndienst(van, tot) {
    const { data, error } = await haalPersoneelLijst();
    if (error) return { fout: "De medewerkers konden niet worden opgehaald: " + error.message };
    const lijst = (data || []).filter((m) => {
      const d = inDienstOp(m);
      return d && d >= van && d <= tot;
    }).sort((a, b) => String(inDienstOp(a)).localeCompare(String(inDienstOp(b))));
    const geschat = lijst.filter((m) => !m.datum_in_dienst && !m.contract_start).length;
    return {
      blokken: [{
        titel: "Nieuw in dienst", kolommen: PERSONEEL_KOLOMMEN, rijen: lijst.map(personeelRij),
        leegTekst: "Er is in deze periode niemand begonnen.",
      }],
      letOp: geschat
        ? geschat + (geschat === 1 ? " regel staat" : " regels staan")
          + " hier op de aanmaakdatum van het record, want er is geen datum in dienst ingevuld."
        : "",
    };
  }

  // ── Rapport 12: benodigde diensten ────────────────────────────────────────
  async function haalBenodigd(van, tot) {
    const { data, error } = await db.rpc("rapport_benodigde_diensten", { p_van: van, p_tot: tot });
    if (error) return { fout: "De benodigde diensten konden niet worden opgehaald: " + error.message };
    const rijen = (data || []).map((r) => ({
      klasse: "rij-let-op",
      cellen: [
        volleDatumCel(r.datum),
        tekst(dagNaam(r.datum)),
        werkbonCel(r),
        tekst(DAGDEEL_LABEL[r.dagdeel] || r.dagdeel),
        cel(esc(klok(r.start_tijd) + "–" + klok(r.eind_tijd)), klok(r.start_tijd) + "-" + klok(r.eind_tijd), "mono"),
        uren(r.uren),
        tekst(r.ingepland_op),
        tekst(r.reden),
      ],
    }));
    const totaal = (data || []).reduce((s, r) => s + (Number(r.uren) || 0), 0);
    return {
      blokken: [{
        titel: "Diensten zonder bezetting",
        kolommen: ["Datum", "Dag", "Werkbon", "Dagdeel", "Tijden", "Uren", "Ingepland op", "Reden"],
        rijen,
        leegTekst: "Elke geplande dienst heeft een monteur die ook beschikbaar is.",
        voet: rijen.length ? `Samen <b>${esc(urenTekst(totaal))}</b> die nog bemenst moet worden.` : "",
      }],
      letOp: rijen.length
        ? rijen.length + (rijen.length === 1 ? " dienst heeft" : " diensten hebben") + " nog geen bezetting."
        : "",
    };
  }

  function werkbonCel(r) {
    const p = { werkbon: r.werkbon, naam: r.project_naam, kleur: r.project_kleur };
    return cel(r.werkbon || r.project_naam ? werkbonMetKleur(p) : "—",
      (r.werkbon || "") + (r.project_naam ? " " + r.project_naam : ""), "mono");
  }

  function telLetOp(data) {
    const n = (data || []).filter((r) => r.waarschuwing).length;
    return n ? n + (n === 1 ? " regel vraagt" : " regels vragen") + " aandacht — zie de kolom Let op." : "";
  }

  // ── Tekenen ───────────────────────────────────────────────────────────────
  function tekenBlokken(lijst) {
    blokken = lijst;
    blokkenVak.innerHTML = lijst.map((b, i) => `
      <div class="rp-blok">
        <div class="kaart-kop">
          <h3>${esc(b.titel)}<span class="rp-telling">${b.rijen.length} ${b.rijen.length === 1 ? "regel" : "regels"}</span></h3>
          <button class="btn btn-grijs btn-klein rp-export" data-rpblok="${i}">Exporteer CSV</button>
        </div>
        <div class="tabelwrap"><table>
          <thead><tr>${b.kolommen.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead>
          <tbody>${b.rijen.length
            ? b.rijen.map((r) => `<tr${r.klasse ? ` class="${r.klasse}"` : ""}>${
                r.cellen.map((c) => `<td${c.k ? ` class="${c.k}"` : ""}>${c.t}</td>`).join("")}</tr>`).join("")
            : rijLeeg(b.kolommen.length, b.leegTekst || "Niets gevonden.")}</tbody>
        </table></div>
        ${b.voet ? `<div class="rp-voet">${b.voet}</div>` : ""}
      </div>`).join("");
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

  // ── Periodebalk ───────────────────────────────────────────────────────────
  // De kaart zelf blijft altijd staan: ook een rapport zonder periode moet je
  // opnieuw kunnen ophalen, en dat gaat via dezelfde knop.
  function zetPeriodeVelden() {
    const bereik = huidig.periode === "bereik";
    const eenDag = huidig.periode === "dag";
    $("rpVanVak").classList.toggle("verborgen", !bereik);
    $("rpTotVak").classList.toggle("verborgen", !bereik);
    $("rpDatumVak").classList.toggle("verborgen", !eenDag);
    $("rpSnelBalk").classList.toggle("verborgen", !bereik);
    $("rpGeenPeriode").classList.toggle("verborgen", huidig.periode !== "geen");
    $("rpToon").textContent = huidig.periode === "geen" ? "Ververs" : "Toon rapport";
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
      $("rpTitel").textContent = rapport.titel;
      $("rpUitleg").textContent = rapport.uitleg + " " + periodeTekst(rapport, periode);
      tekenLeeg("Bezig met ophalen…");
      verberg(melding);

      const uitkomst = rapport.periode === "dag"
        ? await rapport.haal(periode.van)
        : await rapport.haal(periode.van, periode.tot);
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
      getoondeTitel = rapport.titel;
      tekenBlokken(uitkomst.blokken);
      if (uitkomst.letOp) toonMeld(melding, "amber", uitkomst.letOp);
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
    tekenKeuze();
    zetPeriodeVelden();
    toon();
  }

  // ── Knoppen ───────────────────────────────────────────────────────────────
  $("rpKeuze").addEventListener("click", (e) => {
    const knop = e.target.closest(".rp-tab");
    if (knop) kiesRapport(knop.dataset.rp);
  });
  $("rpToon").addEventListener("click", toon);

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
    const knop = e.target.closest(".rp-export");
    if (!knop) return;
    const blok = blokken[Number(knop.dataset.rpblok)];
    if (!blok || !blok.rijen.length) return alert("Er is niets om te exporteren.");
    csvDownload(blok.kolommen, blok.rijen.map((r) => r.cellen.map((c) => c.w)), bestandsnaam(blok.titel));
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
  zetPeriodeVelden();
  $("rpTitel").textContent = huidig.titel;
  $("rpUitleg").textContent = huidig.uitleg;
  tekenLeeg("Kies een rapport hierboven, of klik op Toon rapport.");

  return { toon, kies: kiesRapport };
}

// ============================================================================
//  Spaar Electra — Urenregistratie · periode sluiten
//
//  Kantoor sluit een periode; daarna kan er in die datums niets meer bij, af of
//  anders. Het echte slot zit in de database (migratie 130): dit scherm is
//  alleen de bediening ervan. Alles wat hier misgaat komt dus ook langs als de
//  knop wordt omzeild — en daarom laat dit scherm elke foutmelding uit de
//  database letterlijk zien in plaats van er een eigen tekst voor te verzinnen.
//
//  Wordt vanuit beheer.js aangeroepen: bouwPeriodes(db, hulp).
// ============================================================================

// Welke gedeelde hulpjes dit scherm uit beheer.js nodig heeft. Ontbreekt er
// een, dan gaat het scherm er niet half werkend uitzien maar meteen stuk met
// een leesbare fout — een half werkend afsluitscherm is gevaarlijker dan geen.
const NODIG = ["esc", "rijLeeg", "toonMeld", "verberg", "csvDownload", "urenTekst", "komma", "isoDatum"];

export function bouwPeriodes(db, hulp) {
  const ontbreekt = NODIG.filter((n) => typeof hulp?.[n] !== "function");
  if (ontbreekt.length) {
    throw new Error("periode.js kan niet starten: ontbrekende hulpfuncties uit beheer.js — " + ontbreekt.join(", "));
  }
  const { esc, rijLeeg, toonMeld, verberg, csvDownload, urenTekst, komma, isoDatum } = hulp;
  // Optioneel: laat de rest van het dashboard opnieuw laden na sluiten of
  // heropenen, want de urenlijst toont dan andere knoppen.
  const naVerandering = typeof hulp.naVerandering === "function" ? hulp.naVerandering : null;

  const $ = (id) => document.getElementById(id);
  const nodigInDom = ["pdVan", "pdTot", "pdReden", "pdSluit", "pdMelding", "pdTbPeriodes",
    "pdRapVan", "pdRapTot", "pdRapToon", "pdTbDagen", "pdTbVerschoven",
    "pdStandModal", "pdTbStand", "pdStandTitel"];
  const kwijt = nodigInDom.filter((id) => !$(id));
  if (kwijt.length) {
    throw new Error("periode.js kan niet starten: ontbrekende elementen in beheer.html — " + kwijt.join(", "));
  }

  let _periodes = [];        // alle afsluitingen, nieuwste eerst
  let _stand = [];           // de vastgelegde stand van de geopende afsluiting
  let _standNaam = "";       // bestandsnaam voor de CSV van die stand
  let _dagen = [];
  let _verschoven = [];

  const dv = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const dt = (iso) => (iso ? new Date(iso).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const euro = (n) => (n == null ? "—" : "€ " + komma(n));

  // ── Periode kiezen ────────────────────────────────────────────────────────
  // Vorige maand als startwaarde: dat is de periode die je in de praktijk
  // sluit. Deze maand staat nog open te lopen.
  function standaardPeriode() {
    const nu = new Date();
    const van = new Date(nu.getFullYear(), nu.getMonth() - 1, 1);
    const tot = new Date(nu.getFullYear(), nu.getMonth(), 0);
    $("pdVan").value = isoDatum(van);
    $("pdTot").value = isoDatum(tot);
    $("pdRapVan").value = isoDatum(van);
    $("pdRapTot").value = isoDatum(tot);
    // De datumkiezer laat morgen niet eens aanklikken. De database weigert het
    // ook, maar een grijze dag legt beter uit waarom dan een foutmelding:
    // een dag in de toekomst sluiten zou de monteur van morgen blokkeren.
    const vandaag = isoDatum(nu);
    $("pdVan").max = vandaag;
    $("pdTot").max = vandaag;
  }

  document.querySelectorAll(".pd-snel").forEach((b) => b.addEventListener("click", () => {
    const nu = new Date();
    let van, tot;
    if (b.dataset.pdSnel === "vorige-maand") {
      van = new Date(nu.getFullYear(), nu.getMonth() - 1, 1);
      tot = new Date(nu.getFullYear(), nu.getMonth(), 0);
    } else if (b.dataset.pdSnel === "deze-maand") {
      // Tot en met vandaag: verder mag de database niet, en terecht — een dag
      // in de toekomst sluiten zou de monteur van morgen blokkeren.
      van = new Date(nu.getFullYear(), nu.getMonth(), 1);
      tot = nu;
    } else {
      van = nu; tot = nu;
    }
    $("pdVan").value = isoDatum(van);
    $("pdTot").value = isoDatum(tot);
  }));

  // Een lijst die tegen zijn limiet aan loopt is onvolledig. Onvolledig zonder
  // het te zeggen is hier het gevaar: dan lijkt het alsof er niets verschoven
  // is of niets is afgesloten.
  function afgekaptRij(rijen, max, cols, wat) {
    return rijen.length >= max
      ? `<tr><td colspan="${cols}" class="leeg">Alleen de eerste ${max} ${wat} worden getoond; kies een kortere periode voor het volledige beeld.</td></tr>`
      : "";
  }

  $("pdSluit").addEventListener("click", async () => {
    const van = $("pdVan").value, tot = $("pdTot").value;
    const melding = $("pdMelding");
    verberg(melding);
    if (!van || !tot) return toonMeld(melding, "fout", "Vul een begin- en einddatum in.");
    if (tot < van) return toonMeld(melding, "fout", "De einddatum ligt voor de begindatum.");

    $("pdSluit").disabled = true;
    try {
      // Tellen laten we de database doen: over een maand met 25 monteurs loopt
      // een gewone lijst tegen de rijlimiet aan, en dan zou hier een te laag
      // aantal in de bevestiging staan.
      const { data: telling, error: telFout } = await db.rpc("periode_telling", { p_van: van, p_tot: tot });
      if (telFout) return toonMeld(melding, "fout", "Kon de periode niet nakijken: " + telFout.message);

      const tekst = `Periode ${dv(van)} t/m ${dv(tot)} sluiten?\n\n`
        + `${telling.regels} ${telling.regels === 1 ? "urenregel" : "urenregels"}, samen ${urenTekst(telling.uren)}.\n\n`
        + "Daarna kan niemand meer uren in deze periode toevoegen, wijzigen of verwijderen — jij ook niet, "
        + "tenzij je de periode eerst heropent. Alles wat goedgekeurd is wordt gemarkeerd als verwerkt in de loonrun, "
        + "en de uitbetalingsstand per medewerker wordt onveranderlijk vastgelegd.";
      if (!confirm(tekst)) return;

      // Tweede bevestiging alleen als er echt iets open staat. De database
      // weigert het anders sowieso; hier vragen we het in gewone taal.
      let ondanksOpen = false;
      if (Number(telling.open_uren) > 0) {
        ondanksOpen = confirm(
          `Let op: er staat nog ${urenTekst(telling.open_uren)} onbeoordeeld in deze periode `
          + `(${telling.open_regels} ${telling.open_regels === 1 ? "regel" : "regels"}).\n\n`
          + "Die uren gaan NIET mee in de vastgelegde uitbetaling, maar komen wel op slot te staan: "
          + "beoordelen kan daarna alleen nog na heropenen.\n\nToch sluiten?");
        if (!ondanksOpen) return;
      }

      const { data, error } = await db.rpc("sluit_periode", {
        p_van: van, p_tot: tot,
        p_reden: $("pdReden").value.trim() || null,
        p_ondanks_open: ondanksOpen,
      });
      if (error) return toonMeld(melding, "fout", "Sluiten mislukt: " + error.message);

      $("pdReden").value = "";
      toonMeld(melding, "ok",
        `Periode ${dv(van)} t/m ${dv(tot)} is gesloten. `
        + `${data.medewerkers} ${data.medewerkers === 1 ? "medewerker" : "medewerkers"} vastgelegd `
        + `(${urenTekst(data.uit_te_betalen)}, ${euro(data.bedrag)}); `
        + `${data.verwerkt_gemarkeerd} ${data.verwerkt_gemarkeerd === 1 ? "regel" : "regels"} gemarkeerd als verwerkt in de loonrun.`);
      await laadPeriodes();
      await toonRapport();
      if (naVerandering) naVerandering();
    } finally {
      $("pdSluit").disabled = false;
    }
  });

  // ── Lijst met afsluitingen ────────────────────────────────────────────────
  async function laadPeriodes() {
    const { data, error } = await db.from("gesloten_periodes")
      .select("id, van_datum, tot_datum, reden, gesloten_op, heropend_op, heropend_reden,"
        + " sluiter:medewerkers!gesloten_door(naam), heropener:medewerkers!heropend_door(naam)")
      .order("van_datum", { ascending: false }).limit(200);
    if (error) {
      // Nooit stil falen: een lege lijst betekent hier "niets staat op slot",
      // en dat is precies de verkeerde conclusie als de query kapot is.
      _periodes = [];
      $("pdTbPeriodes").innerHTML = rijLeeg(7, "Kon de afsluitingen niet laden: " + error.message);
      return;
    }
    _periodes = data || [];
    $("pdTbPeriodes").innerHTML = _periodes.length ? _periodes.map((p) => {
      const dicht = !p.heropend_op;
      const status = dicht
        ? `<span class="badge rood"><span class="dot"></span> gesloten</span>`
        : `<span class="badge amber">heropend</span>`;
      const toelichting = dicht
        ? (p.reden ? `<div class="mini-grijs">${esc(p.reden)}</div>` : "")
        : `<div class="mini-grijs">Heropend door ${esc(p.heropener?.naam || "onbekend")} op ${dt(p.heropend_op)} — ${esc(p.heropend_reden || "")}</div>`;
      return `<tr class="${dicht ? "" : "pd-heropend"}">
        <td class="mono sterk">${dv(p.van_datum)} t/m ${dv(p.tot_datum)}</td>
        <td>${status}</td>
        <td>${esc(p.sluiter?.naam || "onbekend")}</td>
        <td class="mono">${dt(p.gesloten_op)}</td>
        <td>${p.reden || !dicht ? toelichting : '<span class="mini-grijs">—</span>'}</td>
        <td><button class="btn btn-grijs btn-klein" data-pd-stand="${p.id}">Vastgelegde stand</button></td>
        <td>${dicht ? `<button class="btn btn-rood btn-klein" data-pd-heropen="${p.id}">Heropenen</button>` : ""}</td>
      </tr>`;
    }).join("") + afgekaptRij(_periodes, 200, 7, "afsluitingen") : rijLeeg(7, "Er is nog geen periode afgesloten.");

    document.querySelectorAll("[data-pd-stand]").forEach((b) =>
      b.addEventListener("click", () => toonStand(b.dataset.pdStand)));
    document.querySelectorAll("[data-pd-heropen]").forEach((b) =>
      b.addEventListener("click", () => heropen(b.dataset.pdHeropen)));
  }

  // ── Heropenen ─────────────────────────────────────────────────────────────
  async function heropen(id) {
    const p = _periodes.find((x) => x.id === id);
    if (!p) return;
    const melding = $("pdMelding");
    verberg(melding);
    if (!confirm(
      `Periode ${dv(p.van_datum)} t/m ${dv(p.tot_datum)} heropenen?\n\n`
      + "Daarna kunnen de uren in deze periode weer gewijzigd worden. De vastgelegde stand blijft bewaard, "
      + "en de markering “verwerkt in de loonrun” blijft staan zodat dezelfde uren niet twee keer betaald worden.\n\n"
      + "Er wordt vastgelegd dat jij deze periode hebt heropend.")) return;

    const reden = prompt("Waarom moet deze periode open? Dit wordt vastgelegd en is later terug te lezen.", "");
    if (reden === null) return;
    if (!reden.trim()) return toonMeld(melding, "fout", "Heropenen is niet doorgegaan: er is geen reden ingevuld.");

    const { data, error } = await db.rpc("heropen_periode", { p_id: id, p_reden: reden.trim() });
    if (error) return toonMeld(melding, "fout", "Heropenen mislukt: " + error.message);
    toonMeld(melding, "ok", `Periode ${dv(data.van)} t/m ${dv(data.tot)} is heropend en dat is vastgelegd.`);
    await laadPeriodes();
    await toonRapport();
    if (naVerandering) naVerandering();
  }

  // ── De vastgelegde stand ──────────────────────────────────────────────────
  async function toonStand(id) {
    const p = _periodes.find((x) => x.id === id);
    _standNaam = p ? "stand-" + p.van_datum + "_" + p.tot_datum : "stand";
    $("pdStandTitel").textContent = p
      ? `Vastgelegde stand — ${dv(p.van_datum)} t/m ${dv(p.tot_datum)}`
      : "Vastgelegde stand";
    $("pdTbStand").innerHTML = rijLeeg(9, "Bezig met laden…");
    $("pdStandModal").classList.remove("verborgen");

    const { data, error } = await db.from("gesloten_periode_stand")
      .select("naam, contractvorm, basis, gewerkt_uren, verlof_uren, contract_uren, uit_te_betalen, plusmin_uren, overwerk_uren, open_uren, uurloon, bedrag, waarschuwing, regels")
      .eq("periode_id", id).order("naam");
    if (error) {
      _stand = [];
      $("pdTbStand").innerHTML = rijLeeg(9, "Kon de vastgelegde stand niet laden: " + error.message);
      return;
    }
    _stand = data || [];
    $("pdTbStand").innerHTML = _stand.length ? _stand.map((r) => {
      const pm = Number(r.plusmin_uren) || 0;
      return `<tr${r.waarschuwing ? ' class="rij-let-op"' : ""}>
        <td class="sterk">${esc(r.naam)}${r.waarschuwing ? `<div class="rij-uitleg">${esc(r.waarschuwing)}</div>` : ""}</td>
        <td><span class="badge grijs">${esc(r.contractvorm || "—")}</span></td>
        <td class="mono">${r.regels}</td>
        <td class="mono">${urenTekst(r.gewerkt_uren)}</td>
        <td class="mono">${Number(r.verlof_uren) ? urenTekst(r.verlof_uren) : "—"}</td>
        <td class="mono">${urenTekst(r.contract_uren)}</td>
        <td class="mono sterk">${urenTekst(r.uit_te_betalen)}</td>
        <td class="mono">${pm ? (pm > 0 ? "+" : "−") + urenTekst(Math.abs(pm)) : "—"}</td>
        <td class="mono sterk">${r.uurloon != null ? euro(r.bedrag) : "—"}</td>
      </tr>`;
    }).join("") : rijLeeg(9, "Er is geen stand vastgelegd bij deze afsluiting.");
  }
  $("pdStandSluit")?.addEventListener("click", () => $("pdStandModal").classList.add("verborgen"));
  $("pdStandModal").addEventListener("click", (e) => {
    if (e.target === $("pdStandModal")) $("pdStandModal").classList.add("verborgen");
  });
  $("pdStandExport")?.addEventListener("click", () => {
    if (!_stand.length) return alert("Er is niets om te exporteren.");
    csvDownload(
      ["Monteur", "Contractvorm", "Basis", "Urenregels", "Gewerkte uren", "Verlofuren", "Contracturen",
       "Uit te betalen uren", "Plus/min uren", "Overwerk uren", "Nog te beoordelen", "Uurloon", "Bedrag", "Let op"],
      _stand.map((r) => [r.naam, r.contractvorm, r.basis, r.regels, komma(r.gewerkt_uren), komma(r.verlof_uren),
        komma(r.contract_uren), komma(r.uit_te_betalen), komma(r.plusmin_uren), komma(r.overwerk_uren),
        komma(r.open_uren), r.uurloon != null ? komma(r.uurloon) : "", r.bedrag != null ? komma(r.bedrag) : "",
        r.waarschuwing || ""]),
      _standNaam);
  });

  // ── Rapport "gesloten urenregistratie" ────────────────────────────────────
  async function toonRapport() {
    const van = $("pdRapVan").value, tot = $("pdRapTot").value;
    if (!van || !tot) return;
    const [{ data: dagen, error: dagFout }, { data: versch, error: vFout }] = await Promise.all([
      db.rpc("gesloten_dagen", { p_van: van, p_tot: tot }),
      // Filteren op verschoven_van en niet op datum: de vraag is "welke uren
      // hoorden in deze periode maar zijn elders geland". Op datum filteren zou
      // juist de regels missen die uit de getoonde periode zijn weggeschoven.
      db.from("urenregels")
        .select("id, datum, verschoven_van, uren, status, omschrijving, medewerkers!medewerker_id(naam), projecten(werkbon, naam)")
        .is("verwijderd_op", null).not("verschoven_van", "is", null)
        .gte("verschoven_van", van).lte("verschoven_van", tot)
        .order("verschoven_van", { ascending: false }).limit(500),
    ]);

    if (dagFout) {
      _dagen = [];
      $("pdTbDagen").innerHTML = rijLeeg(7, "Kon het overzicht niet ophalen: " + dagFout.message);
    } else {
      _dagen = dagen || [];
      $("pdTbDagen").innerHTML = _dagen.length ? _dagen.map((d) => `
        <tr class="${d.gesloten ? "pd-dicht" : ""}">
          <td class="mono sterk">${dv(d.datum)}</td>
          <td>${d.gesloten
            ? `<span class="badge rood"><span class="dot"></span> gesloten</span>`
            : `<span class="badge groen"><span class="dot"></span> open</span>`}</td>
          <td class="mono">${d.gesloten ? dv(d.periode_van) + " t/m " + dv(d.periode_tot) : "—"}</td>
          <td>${d.gesloten ? esc(d.gesloten_door || "onbekend") : "—"}${d.gesloten && d.reden ? `<div class="mini-grijs">${esc(d.reden)}</div>` : ""}</td>
          <td class="mono">${d.gesloten ? dt(d.gesloten_op) : "—"}</td>
          <td class="mono">${d.regels}${Number(d.open_regels) ? ` <span class="badge amber">${d.open_regels} nog te keuren</span>` : ""}${
            Number(d.verschoven) ? ` <span class="badge rood">${d.verschoven} weggeschoven</span>` : ""}</td>
          <td class="mono">${Number(d.uren) ? urenTekst(d.uren) : "—"}</td>
        </tr>`).join("") : rijLeeg(7, "Geen dagen in deze periode.");
    }

    if (vFout) {
      _verschoven = [];
      $("pdTbVerschoven").innerHTML = rijLeeg(6, "Kon de verschoven regels niet ophalen: " + vFout.message);
    } else {
      _verschoven = versch || [];
      $("pdTbVerschoven").innerHTML = _verschoven.length ? _verschoven.map((u) => `
        <tr class="rij-let-op">
          <td class="mono">${dv(u.verschoven_van)}</td>
          <td class="mono sterk">${dv(u.datum)}</td>
          <td class="sterk">${esc(u.medewerkers?.naam)}</td>
          <td class="mono">${esc((u.projecten?.werkbon ? u.projecten.werkbon + " · " : "") + (u.projecten?.naam || ""))}</td>
          <td class="mono">${urenTekst(u.uren)}</td>
          <td>${esc(u.omschrijving || "")}</td>
        </tr>`).join("") + afgekaptRij(_verschoven, 500, 6, "regels")
        : rijLeeg(6, "Geen regels verschoven — er is niemand tegen een gesloten dag aan gelopen.");
    }
  }
  $("pdRapToon").addEventListener("click", toonRapport);
  $("pdRapExport")?.addEventListener("click", () => {
    if (!_dagen.length) return alert("Toon eerst een overzicht.");
    csvDownload(
      ["Datum", "Stand", "Afsluiting van", "Afsluiting tot", "Gesloten door", "Gesloten op", "Reden",
       "Urenregels", "Uren (decimaal)", "Nog te beoordelen", "Verschoven regels"],
      _dagen.map((d) => [d.datum, d.gesloten ? "gesloten" : "open", d.periode_van || "", d.periode_tot || "",
        d.gesloten_door || "", d.gesloten_op || "", d.reden || "",
        d.regels, komma(d.uren), d.open_regels, d.verschoven]),
      "gesloten-urenregistratie-" + $("pdRapVan").value + "_" + $("pdRapTot").value);
  });

  // De zijbalk van beheer.js kent de titel van dit tabblad niet; die zet hij op
  // leeg. Deze luisteraar wordt ná die van beheer.js aangehangen en wint dus.
  const knop = document.querySelector('.nav[data-tab="periodes"]');
  if (knop) knop.addEventListener("click", () => {
    const titel = document.getElementById("paginaTitel");
    if (titel) titel.textContent = "Periode sluiten";
    toonRapport();
  });

  standaardPeriode();
  laadPeriodes();
  toonRapport();

  // Terug naar beheer.js, zodat het dashboard na een loonrun-export kan
  // verversen zonder de binnenkant van dit scherm te kennen.
  return { laadPeriodes, toonRapport };
}

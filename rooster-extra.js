// ============================================================================
//  Spaar Electra — Urenregistratie · roosteruitbreiding
//  Open diensten, beschikbaarheid, diensten ruilen en de dagweergave.
// ----------------------------------------------------------------------------
//  Losse module naast beheer.js en monteur.js, met eigen id-voorvoegsel `rx`.
//  Reden: aan die twee bestanden wordt tegelijk gewerkt; alles wat hier bij
//  komt mag daar geen regel in veranderen. De hulpfuncties (esc, meldingen,
//  kleuren) komen mee als argument zodat de opmaak identiek blijft, maar er
//  staat van elk een terugval in dit bestand — een ontbrekende hulpfunctie mag
//  nooit betekenen dat het halve rooster wit blijft.
//
//  Hoort bij migratie 120-rooster.sql.
// ============================================================================

// ── Terugvallen voor de gedeelde hulpfuncties ───────────────────────────────
function _esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function _toonMeld(el, soort, msg) {
  if (!el) return;
  el.className = "melding" + (soort ? " " + soort : "");
  el.textContent = msg;
  el.classList.remove("verborgen");
}
function _rijLeeg(cols, msg) { return `<tr><td colspan="${cols}" class="leeg">${msg}</td></tr>`; }
function _werkbonTekst(p) { return p ? (p.werkbon ? p.werkbon + " · " : "") + (p.naam || "") : ""; }
const _KLEUREN = [
  "#e11d48", "#db2777", "#c026d3", "#9333ea", "#7c3aed", "#4f46e5",
  "#2563eb", "#0284c7", "#0891b2", "#0d9488", "#059669", "#16a34a",
  "#65a30d", "#ca8a04", "#d97706", "#ea580c", "#dc2626", "#b91c1c",
];
function _kleurVan(p) {
  if (p && p.kleur) return p.kleur;
  const s = String(p?.id || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return _KLEUREN[h % _KLEUREN.length];
}
async function _haalAlles(bouw, paginaGrootte = 1000) {
  const alles = [];
  for (let start = 0; ; start += paginaGrootte) {
    const { data, error } = await bouw(start, start + paginaGrootte - 1);
    if (error) return { data: null, error };
    alles.push(...(data || []));
    if (!data || data.length < paginaGrootte) return { data: alles, error: null };
    if (alles.length >= 20000) {
      return { data: null, error: { message: "Te veel regels in deze periode; kies een kortere periode." } };
    }
  }
}
// Maakt van een technische fout een zin die op de bouwplaats te begrijpen is.
// Ruwe Postgres-tekst ("duplicate key value violates…") hoort niemand te zien.
// Alles waar databasejargon in staat, mag de monteur niet zien; de rest wel.
const _JARGON = /violates|constraint|duplicate key|permission denied|row-level|relation |column |syntax|null value|JWT|invalid input|PGRST/i;
function _netfout(e, standaard) {
  const m = String(e?.message || e || "").trim();
  const code = e?.code || "";
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "Geen internetverbinding. Zoek even een plek met bereik en probeer opnieuw.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(m)) {
    return "Geen verbinding met kantoor. Probeer het zo nog eens.";
  }
  // De triggers uit migratie 120 geven een kant-en-klare Nederlandse zin terug
  // ("Deze dienst is al volledig bezet"). Die is preciezer dan wat wij hier
  // kunnen verzinnen, dus die laten we staan zolang er geen jargon in zit.
  if (m && !_JARGON.test(m)) return m;
  if (code === "23505") return "Iemand was je net voor. Ververs het scherm om de actuele stand te zien.";
  if (code === "42501") return "Je hebt hier geen toegang toe. Neem contact op met kantoor.";
  if (code === "22023") return "Dit kan niet meer gewijzigd worden. Neem contact op met kantoor.";
  return standaard || "Er ging iets mis. Probeer het opnieuw.";
}

// ── Datum- en tekstjes ──────────────────────────────────────────────────────
function _isoDatum(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function maandagVan(d) {
  const x = new Date(d); const dag = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dag); x.setHours(0, 0, 0, 0);
  return x;
}
function plusDagen(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function datumUit(s) { return new Date(s + "T12:00:00"); }
function datumLang(s) {
  return datumUit(s).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
}
function datumKort(s) {
  return datumUit(s).toLocaleDateString("nl-NL", { weekday: "short", day: "2-digit", month: "short" });
}
function kortTijd(t) { return t ? String(t).slice(0, 5) : ""; }
function weeknummer(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const jaarStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil((((x - jaarStart) / 86400000) + 1) / 7);
}
const DAGEN = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const DAGDEEL_LABEL = { hele_dag: "hele dag", ochtend: "ochtend", middag: "middag" };
const DAGDEEL_TIJDEN = { hele_dag: ["07:00", "16:00"], ochtend: ["07:00", "12:00"], middag: ["12:30", "16:00"] };
const BESCHIKBAAR_LABEL = {
  beschikbaar: "Beschikbaar",
  liever_niet: "Liever niet",
  niet_beschikbaar: "Niet beschikbaar",
};
const REACTIE_LABEL = {
  uitgenodigd: "uitgenodigd", aangevraagd: "aangevraagd",
  afgewezen: "afgewezen", toegewezen: "toegewezen",
};
const REACTIE_KLEUR = {
  uitgenodigd: "grijs", aangevraagd: "amber", afgewezen: "rood", toegewezen: "groen",
};
const RUIL_LABEL = {
  aangeboden: "aangeboden", geclaimd: "wacht op kantoor",
  goedgekeurd: "goedgekeurd", afgewezen: "afgewezen", ingetrokken: "ingetrokken",
};
const RUIL_KLEUR = {
  aangeboden: "amber", geclaimd: "amber", goedgekeurd: "groen",
  afgewezen: "rood", ingetrokken: "grijs",
};

function tijdTekst(r) {
  return r.start_tijd ? kortTijd(r.start_tijd) + " – " + kortTijd(r.eind_tijd)
    : (DAGDEEL_LABEL[r.dagdeel] || r.dagdeel || "");
}
const $ = (id) => document.getElementById(id);
function verbergMeld(el) { if (el) el.classList.add("verborgen"); }

// ============================================================================
//  BEHEERKANT
// ============================================================================
export function bouwRoosterExtra(db, hulp = {}) {
  const esc = hulp.esc || _esc;
  const toonMeld = hulp.toonMeld || _toonMeld;
  const rijLeeg = hulp.rijLeeg || _rijLeeg;
  const kleurVan = hulp.kleurVan || _kleurVan;
  const werkbonTekst = hulp.werkbonTekst || _werkbonTekst;
  const haalAlles = hulp.haalAlles || _haalAlles;
  const isoDatum = hulp.isoDatum || _isoDatum;
  const ikBenId = () => (typeof hulp.ikBenId === "function" ? hulp.ikBenId() : hulp.ikBenId) || null;

  let _monteurs = [];
  let _bsWeek = maandagVan(new Date());
  let _dagDatum = isoDatum(new Date());

  // ── Basisgegevens die meerdere kaarten nodig hebben ───────────────────────
  async function laadBasis() {
    const [{ data: mws, error: fMw }, { data: prj, error: fPr }] = await Promise.all([
      db.from("medewerkers").select("id, naam").eq("rol", "monteur").is("verwijderd_op", null).order("naam"),
      db.from("projecten").select("id, werkbon, naam, kleur").is("verwijderd_op", null)
        .neq("status", "afgerond").order("naam"),
    ]);
    if (fMw || fPr) {
      toonMeld($("rxOdMeld"), "fout", "Kon monteurs of werkbonnen niet laden: " + ((fMw || fPr).message || ""));
      return;
    }
    _monteurs = mws || [];
    const sel = $("rxOdProject");
    if (sel && !sel.dataset.rxGevuld) {
      sel.innerHTML = (prj || []).map((p) => `<option value="${esc(p.id)}">${esc(werkbonTekst(p))}</option>`).join("");
      sel.dataset.rxGevuld = "1";
    }
  }

  // ── 1. Open diensten ──────────────────────────────────────────────────────
  async function laadOpenDiensten() {
    const lijst = $("rxOdLijst");
    if (!lijst) return;
    const vanaf = isoDatum(plusDagen(new Date(), -14));
    const { data, error } = await db.from("open_diensten")
      .select("id, datum, dagdeel, start_tijd, eind_tijd, aantal_nodig, toewijzing, opmerking, status, projecten(id, werkbon, naam, kleur), open_dienst_reacties(id, status, medewerker_id, gereageerd_op, medewerkers!medewerker_id(naam))")
      .is("verwijderd_op", null).gte("datum", vanaf)
      .order("datum");
    if (error) {
      // Nooit stil falen: een lege lijst en een kapotte query zien er anders
      // identiek uit, en dan denkt kantoor dat er niets openstaat.
      lijst.innerHTML = `<div class="leeg">Kon de open diensten niet laden: ${esc(error.message)}</div>`;
      return;
    }
    if (!data || !data.length) {
      lijst.innerHTML = `<div class="leeg">Er staan geen diensten open.</div>`;
      return;
    }
    lijst.innerHTML = data.map(tekenOpenDienst).join("");
  }

  function tekenOpenDienst(d) {
    const reacties = d.open_dienst_reacties || [];
    const toegewezen = reacties.filter((r) => r.status === "toegewezen");
    const nogVrij = Math.max(0, d.aantal_nodig - toegewezen.length);
    const uitgenodigdIds = new Set(reacties.map((r) => r.medewerker_id));
    const teKiezen = _monteurs.filter((m) => !uitgenodigdIds.has(m.id));
    const wijze = d.toewijzing === "eerste" ? "wie het eerst reageert" : "kantoor wijst toe";
    const statusKleur = { open: "amber", vervuld: "groen", ingetrokken: "grijs" }[d.status] || "grijs";

    const rijen = reacties.length ? reacties
      .slice()
      .sort((a, b) => (a.medewerkers?.naam || "").localeCompare(b.medewerkers?.naam || ""))
      .map((r) => {
        const knoppen = [];
        if (r.status !== "toegewezen" && d.status === "open" && nogVrij > 0) {
          knoppen.push(`<button class="btn btn-groen btn-klein" data-rx-toewijs="${esc(r.id)}">Toewijzen</button>`);
        }
        if (r.status === "aangevraagd" || r.status === "uitgenodigd") {
          knoppen.push(`<button class="btn btn-grijs btn-klein" data-rx-afwijs="${esc(r.id)}">Afwijzen</button>`);
        }
        return `<div class="rx-reactie">
          <span class="rx-reactie-naam">${esc(r.medewerkers?.naam || "onbekende monteur")}</span>
          <span class="badge ${REACTIE_KLEUR[r.status] || "grijs"}">${esc(REACTIE_LABEL[r.status] || r.status)}</span>
          <span class="rx-reactie-knoppen">${knoppen.join("")}</span>
        </div>`;
      }).join("")
      : `<div class="leeg">Nog niemand uitgenodigd.</div>`;

    const uitnodigen = d.status === "open" && teKiezen.length
      ? `<div class="rx-uitnodig">
           <select data-rx-kies="${esc(d.id)}" aria-label="Monteur uitnodigen">
             ${teKiezen.map((m) => `<option value="${esc(m.id)}">${esc(m.naam)}</option>`).join("")}
           </select>
           <button class="btn btn-grijs btn-klein" data-rx-uitnodig="${esc(d.id)}">Uitnodigen</button>
         </div>`
      : "";

    return `<div class="rx-dienst" style="border-left-color:${kleurVan(d.projecten)}">
      <div class="rx-dienst-kop">
        <span class="rx-dienst-titel">${esc(werkbonTekst(d.projecten))}</span>
        <span class="badge ${statusKleur}">${esc(d.status)}</span>
        <span class="rx-dienst-meta">${esc(datumKort(d.datum))} · ${esc(tijdTekst(d))} · ${toegewezen.length} van ${d.aantal_nodig} bezet · ${esc(wijze)}</span>
        <span class="rx-dienst-acties">
          ${d.status === "open" ? `<button class="btn btn-grijs btn-klein" data-rx-intrek="${esc(d.id)}">Intrekken</button>` : ""}
          <button class="btn btn-grijs btn-klein" data-rx-odweg="${esc(d.id)}">Verwijderen</button>
        </span>
      </div>
      ${d.opmerking ? `<div class="rx-dienst-opmerking">${esc(d.opmerking)}</div>` : ""}
      <div class="rx-reacties">${rijen}</div>
      ${uitnodigen}
    </div>`;
  }

  async function maakOpenDienst() {
    const meld = $("rxOdMeld");
    verbergMeld(meld);
    const project_id = $("rxOdProject")?.value;
    const datum = $("rxOdDatum")?.value;
    if (!project_id || !datum) return toonMeld(meld, "fout", "Kies een werkbon en een datum.");
    const aantal = parseInt($("rxOdAantal")?.value, 10) || 1;
    const knop = $("rxOdMaak");
    if (knop) knop.disabled = true;
    const { error } = await db.from("open_diensten").insert({
      project_id, datum,
      dagdeel: $("rxOdDagdeel")?.value || "hele_dag",
      start_tijd: $("rxOdStart")?.value || null,
      eind_tijd: $("rxOdEind")?.value || null,
      aantal_nodig: aantal,
      toewijzing: $("rxOdToewijzing")?.value || "kantoor",
      opmerking: $("rxOdOpmerking")?.value?.trim() || null,
      aangemaakt_door: ikBenId(),
    });
    if (knop) knop.disabled = false;
    if (error) return toonMeld(meld, "fout", "Open dienst aanmaken mislukt: " + error.message);
    toonMeld(meld, "ok", "De dienst staat open. Nodig hieronder de monteurs uit die ervoor in aanmerking komen.");
    if ($("rxOdOpmerking")) $("rxOdOpmerking").value = "";
    await laadOpenDiensten();
  }

  // ── 2. Beschikbaarheid ────────────────────────────────────────────────────
  async function laadRegels() {
    if (!$("rxBsMinDagen")) return;
    const { data, error } = await db.from("beschikbaarheid_regels").select("*").eq("id", 1).maybeSingle();
    if (error) return toonMeld($("rxBsRegelsMeld"), "fout", "Kon de beschikbaarheidsregels niet laden: " + error.message);
    if (!data) return;
    $("rxBsMinDagen").value = data.min_dagen_per_week;
    $("rxBsTermijn").value = data.wijzigen_tot_dagen_vooraf;
    if ($("rxBsWeken")) $("rxBsWeken").value = data.weken_vooruit;
  }

  async function bewaarRegels() {
    const meld = $("rxBsRegelsMeld");
    verbergMeld(meld);
    const { error } = await db.from("beschikbaarheid_regels").update({
      min_dagen_per_week: parseInt($("rxBsMinDagen").value, 10) || 0,
      wijzigen_tot_dagen_vooraf: parseInt($("rxBsTermijn").value, 10) || 0,
      weken_vooruit: parseInt($("rxBsWeken")?.value, 10) || 4,
      gewijzigd_op: new Date().toISOString(),
      gewijzigd_door: ikBenId(),
    }).eq("id", 1);
    if (error) return toonMeld(meld, "fout", "Opslaan mislukt: " + error.message);
    toonMeld(meld, "ok", "Regels opgeslagen.");
    await laadBeschikbaarheidWeek();
  }

  async function laadBeschikbaarheidWeek() {
    const grid = $("rxBsGrid");
    if (!grid) return;
    const van = isoDatum(_bsWeek);
    const tot = isoDatum(plusDagen(_bsWeek, 6));
    if ($("rxBsLabel")) {
      $("rxBsLabel").textContent = "Week " + weeknummer(_bsWeek) + " · " +
        van.slice(8) + "/" + van.slice(5, 7) + " – " + tot.slice(8) + "/" + tot.slice(5, 7);
    }
    const { data, error } = await haalAlles((a, b) => db.from("beschikbaarheid")
      .select("medewerker_id, datum, soort, toelichting")
      .gte("datum", van).lte("datum", tot).order("datum").range(a, b));
    if (error) {
      grid.querySelector("tbody").innerHTML = rijLeeg(8, "Kon de beschikbaarheid niet laden: " + esc(error.message));
      return;
    }
    const per = {};
    (data || []).forEach((b) => { per[b.medewerker_id + "|" + b.datum] = b; });

    const dagen = [...Array(7)].map((_, i) => plusDagen(_bsWeek, i));
    grid.querySelector("thead").innerHTML = `<tr><th class="rx-naamkop">Monteur</th>` +
      dagen.map((d, i) => `<th class="rx-dagkop${i >= 5 ? " rx-weekend" : ""}">
        <span>${DAGEN[i]}</span><span class="rx-dagnr">${d.getDate()}</span></th>`).join("") +
      `<th class="rx-dagkop">ingevuld</th></tr>`;

    grid.querySelector("tbody").innerHTML = _monteurs.map((m) => {
      let ingevuld = 0;
      const cellen = dagen.map((d, i) => {
        const b = per[m.id + "|" + isoDatum(d)];
        if (b) ingevuld++;
        const klas = b ? "rx-bs-" + b.soort : "rx-bs-leeg";
        const titel = b ? BESCHIKBAAR_LABEL[b.soort] + (b.toelichting ? " — " + b.toelichting : "") : "niet ingevuld";
        return `<td class="rx-bs-cel${i >= 5 ? " rx-weekend" : ""}"><span class="rx-bs-punt ${klas}" title="${esc(titel)}"></span></td>`;
      }).join("");
      return `<tr><td class="rx-naam">${esc(m.naam)}</td>${cellen}<td class="rx-bs-telling">${ingevuld}</td></tr>`;
    }).join("") || rijLeeg(9, "Nog geen monteurs.");

    await laadTekort(van, tot);
  }

  async function laadTekort(van, tot) {
    const el = $("rxBsTekort");
    if (!el) return;
    const { data, error } = await db.rpc("beschikbaarheid_tekort", { p_van: van, p_tot: tot });
    if (error) {
      el.innerHTML = `<div class="leeg">Kon de achterstand niet berekenen: ${esc(error.message)}</div>`;
      return;
    }
    const achter = (data || []).filter((r) => r.ingevuld < r.verplicht);
    if (!achter.length) {
      el.innerHTML = `<div class="leeg">Iedereen heeft genoeg dagen ingevuld voor deze week.</div>`;
      return;
    }
    el.innerHTML = `<div class="rx-tekort">` + achter.map((r) =>
      `<span class="chip rx-chip-rood">${esc(r.naam)} · ${r.ingevuld} van ${r.verplicht}</span>`).join("") + `</div>`;
  }

  // Waarschuwing naast het inplanformulier van beheer.js. Die code raken we
  // niet aan; we luisteren alleen mee op de velden die er al staan.
  async function toetsInplan() {
    const el = $("rxInplanWaarschuwing");
    const mid = $("rMedewerker")?.value;
    const datum = $("rDatum")?.value;
    if (!el) return;
    if (!mid || !datum) { el.classList.add("verborgen"); return; }
    const { data, error } = await db.from("beschikbaarheid")
      .select("soort, toelichting").eq("medewerker_id", mid).eq("datum", datum).maybeSingle();
    if (error) {
      toonMeld(el, "fout", "Kon de beschikbaarheid niet ophalen: " + error.message);
      return;
    }
    if (!data || data.soort === "beschikbaar") { el.classList.add("verborgen"); return; }
    const naam = $("rMedewerker")?.selectedOptions?.[0]?.textContent || "Deze monteur";
    const wat = data.soort === "niet_beschikbaar" ? "heeft aangegeven NIET te kunnen" : "geeft de voorkeur aan een andere dag";
    toonMeld(el, data.soort === "niet_beschikbaar" ? "fout" : "amber",
      `${naam} ${wat} op ${datumLang(datum)}${data.toelichting ? " — " + data.toelichting : ""}.`);
  }

  // ── 3. Ruilverzoeken ──────────────────────────────────────────────────────
  async function laadRuil() {
    const el = $("rxRuilLijst");
    if (!el) return;
    const { data, error } = await db.from("dienst_ruil")
      .select("id, status, datum, dagdeel, start_tijd, eind_tijd, reden, aangemaakt_op, aanbieder:medewerkers!aanbieder_id(naam), overnemer:medewerkers!overnemer_id(naam), projecten(id, werkbon, naam, kleur)")
      .gte("datum", isoDatum(plusDagen(new Date(), -30)))
      .order("datum");
    if (error) {
      el.innerHTML = `<div class="leeg">Kon de ruilverzoeken niet laden: ${esc(error.message)}</div>`;
      return;
    }
    if (!data || !data.length) {
      el.innerHTML = `<div class="leeg">Er zijn geen ruilverzoeken.</div>`;
      return;
    }
    el.innerHTML = data.map((r) => {
      const knoppen = [];
      if (r.status === "geclaimd") {
        knoppen.push(`<button class="btn btn-groen btn-klein" data-rx-ruilgoed="${esc(r.id)}">Goedkeuren</button>`);
      }
      if (r.status === "aangeboden" || r.status === "geclaimd") {
        knoppen.push(`<button class="btn btn-grijs btn-klein" data-rx-ruilaf="${esc(r.id)}">Afwijzen</button>`);
      }
      return `<div class="rx-dienst" style="border-left-color:${kleurVan(r.projecten)}">
        <div class="rx-dienst-kop">
          <span class="rx-dienst-titel">${esc(r.aanbieder?.naam || "onbekend")} &rarr; ${esc(r.overnemer?.naam || "nog niemand")}</span>
          <span class="badge ${RUIL_KLEUR[r.status] || "grijs"}">${esc(RUIL_LABEL[r.status] || r.status)}</span>
          <span class="rx-dienst-meta">${esc(datumKort(r.datum))} · ${esc(tijdTekst(r))} · ${esc(werkbonTekst(r.projecten))}</span>
          <span class="rx-dienst-acties">${knoppen.join("")}</span>
        </div>
        ${r.reden ? `<div class="rx-dienst-opmerking">${esc(r.reden)}</div>` : ""}
      </div>`;
    }).join("");
  }

  // ── 4. Dagweergave ────────────────────────────────────────────────────────
  async function laadDag() {
    const body = $("rxDagBody");
    if (!body) return;
    if ($("rxDagDatum") && $("rxDagDatum").value !== _dagDatum) $("rxDagDatum").value = _dagDatum;
    if ($("rxDagLabel")) $("rxDagLabel").textContent = datumLang(_dagDatum);
    body.innerHTML = rijLeeg(4, "Laden…");
    const { data, error } = await db.rpc("rooster_dag", { p_datum: _dagDatum });
    if (error) {
      body.innerHTML = rijLeeg(4, "Kon de dag niet laden: " + esc(error.message));
      return;
    }
    if (!data || !data.length) {
      body.innerHTML = rijLeeg(4, "Er zijn geen monteurs.");
      return;
    }
    body.innerHTML = data.map((r) => {
      const diensten = Array.isArray(r.diensten) ? r.diensten : [];
      const blokken = diensten.map((p) => `<span class="rx-blok" style="border-left-color:${kleurVan(p)}">
          <span class="rx-blok-naam">${esc(_werkbonTekst({ werkbon: p.werkbon, naam: p.project }))}</span>
          <span class="rx-blok-tijd">${esc(p.start_tijd ? kortTijd(p.start_tijd) + " – " + kortTijd(p.eind_tijd) : (DAGDEEL_LABEL[p.dagdeel] || p.dagdeel || ""))}</span>
        </span>`).join("");
      const vrij = r.afwezig
        ? `<span class="badge ${r.afwezig_status === "onbeslist" ? "amber" : "rood"}">${esc(r.afwezig)}${r.afwezig_status === "onbeslist" ? " (nog niet goedgekeurd)" : ""}</span>`
        : "";
      const bes = r.beschikbaar
        ? `<span class="badge ${r.beschikbaar === "niet_beschikbaar" ? "rood" : r.beschikbaar === "liever_niet" ? "amber" : "groen"}"
             title="${esc(r.toelichting || "")}">${esc(BESCHIKBAAR_LABEL[r.beschikbaar] || r.beschikbaar)}</span>`
        : `<span class="rx-stil">niet ingevuld</span>`;
      const waar = diensten.map((p) => p.locatie).filter(Boolean);
      return `<tr>
        <td class="rx-naam">${esc(r.naam)}</td>
        <td>${blokken || `<span class="rx-stil">niet ingepland</span>`}</td>
        <td>${esc([...new Set(waar)].join(", ")) || `<span class="rx-stil">—</span>`}</td>
        <td>${vrij || bes}</td>
      </tr>`;
    }).join("");
  }

  // ── Acties (gedelegeerd; de lijsten worden steeds opnieuw getekend) ───────
  async function doeActie(knop, uitvoeren, opnieuw) {
    const oud = knop.textContent;
    knop.disabled = true; knop.textContent = "Bezig…";
    const { error } = await uitvoeren();
    knop.disabled = false; knop.textContent = oud;
    if (error) {
      toonMeld($("rxOdMeld"), "fout", _netfout(error, "De actie is niet gelukt."));
      return false;
    }
    verbergMeld($("rxOdMeld"));
    await opnieuw();
    return true;
  }

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;

    if (t.dataset.rxUitnodig) {
      const sel = document.querySelector(`[data-rx-kies="${t.dataset.rxUitnodig}"]`);
      if (!sel || !sel.value) return;
      await doeActie(t, () => db.from("open_dienst_reacties").insert({
        open_dienst_id: t.dataset.rxUitnodig, medewerker_id: sel.value, status: "uitgenodigd",
      }), laadOpenDiensten);
    } else if (t.dataset.rxToewijs) {
      await doeActie(t, () => db.from("open_dienst_reacties")
        .update({ status: "toegewezen" }).eq("id", t.dataset.rxToewijs), laadOpenDiensten);
    } else if (t.dataset.rxAfwijs) {
      await doeActie(t, () => db.from("open_dienst_reacties")
        .update({ status: "afgewezen" }).eq("id", t.dataset.rxAfwijs), laadOpenDiensten);
    } else if (t.dataset.rxIntrek) {
      if (!confirm("Deze open dienst intrekken? Monteurs kunnen er dan niet meer op reageren.")) return;
      await doeActie(t, () => db.from("open_diensten")
        .update({ status: "ingetrokken" }).eq("id", t.dataset.rxIntrek), laadOpenDiensten);
    } else if (t.dataset.rxOdweg) {
      if (!confirm("Deze open dienst verwijderen? Al toegewezen diensten blijven gewoon in het rooster staan.")) return;
      await doeActie(t, () => db.from("open_diensten")
        .update({ verwijderd_op: new Date().toISOString() }).eq("id", t.dataset.rxOdweg), laadOpenDiensten);
    } else if (t.dataset.rxRuilgoed) {
      await doeActie(t, () => db.from("dienst_ruil")
        .update({ status: "goedgekeurd" }).eq("id", t.dataset.rxRuilgoed), async () => { await laadRuil(); await laadDag(); });
    } else if (t.dataset.rxRuilaf) {
      await doeActie(t, () => db.from("dienst_ruil")
        .update({ status: "afgewezen" }).eq("id", t.dataset.rxRuilaf), laadRuil);
    }
  });

  // ── Knoppen die vast in de HTML staan ─────────────────────────────────────
  $("rxOdMaak")?.addEventListener("click", maakOpenDienst);
  $("rxOdDagdeel")?.addEventListener("change", () => {
    const t = DAGDEEL_TIJDEN[$("rxOdDagdeel").value];
    if (t) { if ($("rxOdStart")) $("rxOdStart").value = t[0]; if ($("rxOdEind")) $("rxOdEind").value = t[1]; }
  });
  $("rxBsRegelsOpslaan")?.addEventListener("click", bewaarRegels);
  $("rxBsVorige")?.addEventListener("click", () => { _bsWeek = plusDagen(_bsWeek, -7); laadBeschikbaarheidWeek(); });
  $("rxBsVolgende")?.addEventListener("click", () => { _bsWeek = plusDagen(_bsWeek, 7); laadBeschikbaarheidWeek(); });
  $("rxDagVorige")?.addEventListener("click", () => { _dagDatum = isoDatum(plusDagen(datumUit(_dagDatum), -1)); laadDag(); });
  $("rxDagVolgende")?.addEventListener("click", () => { _dagDatum = isoDatum(plusDagen(datumUit(_dagDatum), 1)); laadDag(); });
  $("rxDagVandaag")?.addEventListener("click", () => { _dagDatum = isoDatum(new Date()); laadDag(); });
  $("rxDagDatum")?.addEventListener("change", () => {
    if ($("rxDagDatum").value) { _dagDatum = $("rxDagDatum").value; laadDag(); }
  });
  $("rMedewerker")?.addEventListener("change", toetsInplan);
  $("rDatum")?.addEventListener("change", toetsInplan);
  document.querySelectorAll('.nav[data-tab="rooster"]').forEach((b) => b.addEventListener("click", () => ververs()));

  async function ververs() {
    if (!$("rxOdDatum")?.value) { const el = $("rxOdDatum"); if (el) el.value = isoDatum(new Date()); }
    await laadBasis();
    await Promise.all([laadOpenDiensten(), laadRegels(), laadBeschikbaarheidWeek(), laadRuil(), laadDag()]);
  }

  // Bij het openen van de pagina is er nog geen sessie; dan wacht alles op de
  // eerste klik op Rooster. Is er wel een sessie, dan meteen laden.
  db.auth?.getSession?.().then(({ data }) => { if (data?.session) ververs(); }).catch(() => {});

  return { ververs, laadOpenDiensten, laadBeschikbaarheidWeek, laadRuil, laadDag, toetsInplan };
}

// ============================================================================
//  MONTEURKANT
// ============================================================================
export function bouwRoosterMonteur(db, hulp = {}) {
  const esc = hulp.esc || _esc;
  const netfout = hulp.netfout || _netfout;
  const toonMeld = hulp.toonMelding || hulp.toonMeld || _toonMeld;

  let _mijnId = null;
  let _regels = { min_dagen_per_week: 0, wijzigen_tot_dagen_vooraf: 0, weken_vooruit: 4 };

  async function mijnId() {
    const g = typeof hulp.mij === "function" ? hulp.mij() : hulp.mij;
    if (g?.medewerker_id) return g.medewerker_id;
    if (_mijnId) return _mijnId;
    const { data: auth } = await db.auth.getUser();
    if (!auth?.user) return null;
    const { data } = await db.from("medewerkers")
      .select("id").eq("auth_user_id", auth.user.id).is("verwijderd_op", null).maybeSingle();
    _mijnId = data?.id || null;
    return _mijnId;
  }

  // ── 1. Open diensten ──────────────────────────────────────────────────────
  async function laadOpenDiensten() {
    const el = $("rxMonOpen");
    if (!el) return;
    const { data, error } = await db.rpc("mijn_open_diensten");
    if (error) {
      el.innerHTML = `<div class="leeg">${esc(netfout(error, "De open diensten konden niet geladen worden."))}</div>`;
      return;
    }
    if (!data || !data.length) {
      el.innerHTML = `<div class="leeg">Er staan geen diensten voor je open.</div>`;
      return;
    }
    el.innerHTML = data.map((d) => {
      const vol = d.aantal_toegewezen >= d.aantal_nodig;
      const knoppen = [];
      if (d.status === "uitgenodigd" && d.dienst_status === "open" && !vol) {
        knoppen.push(`<button class="btn btn-rood rx-mon-knop" data-rx-wil="${esc(d.reactie_id)}">Ja, ik kan deze dienst</button>`);
      }
      if (d.status === "aangevraagd") {
        knoppen.push(`<button class="btn btn-grijs rx-mon-knop" data-rx-nietwil="${esc(d.reactie_id)}">Toch niet</button>`);
      }
      const uitleg = d.status === "toegewezen"
        ? "Deze dienst staat nu in je rooster."
        : d.status === "afgewezen" ? "Kantoor heeft deze dienst aan iemand anders gegeven."
          : d.status === "aangevraagd" ? (d.toewijzing === "eerste" ? "Iemand was je net voor." : "Kantoor bekijkt je aanvraag.")
            : vol ? "Alle plekken zijn inmiddels bezet."
              : d.toewijzing === "eerste" ? "Wie het eerst reageert, krijgt de dienst."
                : "Kantoor beslist wie de dienst krijgt.";
      return `<div class="rx-mon-kaart" style="border-left-color:${_kleurVan({ kleur: d.kleur, id: d.dienst_id })}">
        <div class="rx-mon-titel">${esc(_werkbonTekst({ werkbon: d.werkbon, naam: d.project }))}</div>
        <div class="rx-mon-sub">${esc(datumLang(d.datum))} · ${esc(tijdTekst(d))}${d.locatie ? " · " + esc(d.locatie) : ""}</div>
        <div class="rx-mon-sub">${d.aantal_toegewezen} van ${d.aantal_nodig} plekken bezet
          <span class="badge ${REACTIE_KLEUR[d.status] || "grijs"}">${esc(REACTIE_LABEL[d.status] || d.status)}</span></div>
        ${d.opmerking ? `<div class="rx-mon-sub">${esc(d.opmerking)}</div>` : ""}
        <div class="rx-mon-sub rx-stil">${esc(uitleg)}</div>
        ${knoppen.join("")}
      </div>`;
    }).join("");
  }

  // ── 2. Beschikbaarheid ────────────────────────────────────────────────────
  async function laadBeschikbaarheid() {
    const el = $("rxMonBesLijst");
    if (!el) return;
    const mid = await mijnId();
    if (!mid) { el.innerHTML = `<div class="leeg">Log opnieuw in om je beschikbaarheid door te geven.</div>`; return; }

    const { data: r } = await db.from("beschikbaarheid_regels").select("*").eq("id", 1).maybeSingle();
    if (r) _regels = r;
    const vanaf = maandagVan(new Date());
    const weken = Math.max(1, _regels.weken_vooruit || 4);
    const tot = plusDagen(vanaf, weken * 7 - 1);
    const { data, error } = await db.from("beschikbaarheid")
      .select("datum, soort, toelichting")
      .eq("medewerker_id", mid)
      .gte("datum", _isoDatum(vanaf)).lte("datum", _isoDatum(tot)).order("datum");
    if (error) {
      el.innerHTML = `<div class="leeg">${esc(netfout(error, "Je beschikbaarheid kon niet geladen worden."))}</div>`;
      return;
    }
    const per = {};
    (data || []).forEach((b) => { per[b.datum] = b; });

    const regelTekst = $("rxMonBesRegels");
    if (regelTekst) {
      const stukjes = [];
      if (_regels.min_dagen_per_week > 0) stukjes.push(`Vul per week minimaal ${_regels.min_dagen_per_week} ${_regels.min_dagen_per_week === 1 ? "dag" : "dagen"} in.`);
      if (_regels.wijzigen_tot_dagen_vooraf > 0) stukjes.push(`Wijzigen kan tot ${_regels.wijzigen_tot_dagen_vooraf} ${_regels.wijzigen_tot_dagen_vooraf === 1 ? "dag" : "dagen"} van tevoren.`);
      regelTekst.textContent = stukjes.join(" ") || "Geef door wanneer je wel en niet kunt.";
    }

    // Dagen waarvoor de wijzigingstermijn al voorbij is, zijn op slot. Ze
    // blijven wél zichtbaar: anders lijkt het alsof er niets is ingevuld.
    const grens = _isoDatum(plusDagen(new Date(), _regels.wijzigen_tot_dagen_vooraf || 0));
    let html = "";
    for (let w = 0; w < weken; w++) {
      const start = plusDagen(vanaf, w * 7);
      const dagen = [...Array(7)].map((_, i) => plusDagen(start, i));
      const ingevuld = dagen.filter((d) => per[_isoDatum(d)]).length;
      const tekort = _regels.min_dagen_per_week > 0 && ingevuld < _regels.min_dagen_per_week;
      html += `<div class="rx-mon-week">
        <div class="rx-mon-weekkop">
          <span>Week ${weeknummer(start)}</span>
          <span class="badge ${tekort ? "amber" : "groen"}">${ingevuld}${_regels.min_dagen_per_week > 0 ? " van " + _regels.min_dagen_per_week : ""} ingevuld</span>
        </div>` +
        dagen.map((d) => {
          const dat = _isoDatum(d);
          const b = per[dat];
          const opSlot = dat < grens;
          const knop = (soort, tekst) => `<button class="rx-bs-knop rx-bs-${soort}${b?.soort === soort ? " actief" : ""}"
              data-rx-bes="${dat}" data-rx-soort="${soort}" ${opSlot ? "disabled" : ""}>${tekst}</button>`;
          return `<div class="rx-mon-dag${opSlot ? " rx-op-slot" : ""}">
            <div class="rx-mon-dagnaam">${esc(datumKort(dat))}${opSlot ? ' <span class="rx-stil">op slot</span>' : ""}</div>
            <div class="rx-bs-knoppen">
              ${knop("beschikbaar", "Kan")}
              ${knop("liever_niet", "Liever niet")}
              ${knop("niet_beschikbaar", "Kan niet")}
            </div>
          </div>`;
        }).join("") + `</div>`;
    }
    el.innerHTML = html;
  }

  async function zetBeschikbaar(knop) {
    const meld = $("rxMonBesMeld");
    verbergMeld(meld);
    const mid = await mijnId();
    if (!mid) return toonMeld(meld, "fout", "Log opnieuw in en probeer het nog een keer.");
    const oud = knop.textContent;
    knop.disabled = true; knop.textContent = "…";
    const { error } = await db.from("beschikbaarheid").upsert({
      medewerker_id: mid, datum: knop.dataset.rxBes, soort: knop.dataset.rxSoort,
    }, { onConflict: "medewerker_id,datum" });
    knop.disabled = false; knop.textContent = oud;
    if (error) return toonMeld(meld, "fout", netfout(error, "Opslaan is niet gelukt. Probeer het zo nog eens."));
    toonMeld(meld, "ok", "Doorgegeven aan kantoor.");
    await laadBeschikbaarheid();
  }

  // ── 3. Diensten ruilen ────────────────────────────────────────────────────
  async function laadRuil() {
    const mijn = $("rxMonRuilMijn");
    const aanbod = $("rxMonRuilAanbod");
    if (!mijn && !aanbod) return;
    const mid = await mijnId();
    if (!mid) return;

    const [{ data: plan, error: fPlan }, { data: ruil, error: fRuil }] = await Promise.all([
      db.from("planning")
        .select("id, datum, dagdeel, start_tijd, eind_tijd, projecten(id, werkbon, naam, kleur, locatie)")
        .eq("medewerker_id", mid).gte("datum", _isoDatum(new Date()))
        .is("verwijderd_op", null).order("datum"),
      db.rpc("ruil_aanbod"),
    ]);

    if (mijn) {
      if (fPlan) {
        mijn.innerHTML = `<div class="leeg">${esc(netfout(fPlan, "Je diensten konden niet geladen worden."))}</div>`;
      } else if (!plan || !plan.length) {
        mijn.innerHTML = `<div class="leeg">Je staat de komende tijd niet ingepland.</div>`;
      } else {
        const lopend = new Set((ruil || []).filter((r) => r.rol === "aanbieder"
          && ["aangeboden", "geclaimd", "goedgekeurd"].includes(r.status)).map((r) => r.planning_id));
        mijn.innerHTML = plan.map((p) => `<div class="rx-mon-kaart" style="border-left-color:${_kleurVan(p.projecten)}">
          <div class="rx-mon-titel">${esc(_werkbonTekst(p.projecten))}</div>
          <div class="rx-mon-sub">${esc(datumLang(p.datum))} · ${esc(tijdTekst(p))}</div>
          ${lopend.has(p.id)
            ? `<div class="rx-mon-sub rx-stil">Je hebt deze dienst al aangeboden.</div>`
            : `<button class="btn btn-grijs rx-mon-knop" data-rx-aanbied="${esc(p.id)}">Deze dienst aanbieden</button>`}
        </div>`).join("");
      }
    }

    if (aanbod) {
      if (fRuil) {
        aanbod.innerHTML = `<div class="leeg">${esc(netfout(fRuil, "Het ruilaanbod kon niet geladen worden."))}</div>`;
        return;
      }
      const rijen = (ruil || []).filter((r) => r.rol !== "aanbieder" || r.status !== "ingetrokken");
      if (!rijen.length) {
        aanbod.innerHTML = `<div class="leeg">Er staan geen diensten open om over te nemen.</div>`;
        return;
      }
      aanbod.innerHTML = rijen.map((r) => {
        const knoppen = [];
        if (r.rol === "collega" && r.status === "aangeboden") {
          knoppen.push(`<button class="btn btn-rood rx-mon-knop" data-rx-overneem="${esc(r.id)}">Ik neem hem over</button>`);
        }
        if (r.rol === "aanbieder" && r.status === "aangeboden") {
          knoppen.push(`<button class="btn btn-grijs rx-mon-knop" data-rx-ruilintrek="${esc(r.id)}">Aanbod intrekken</button>`);
        }
        const wie = r.rol === "aanbieder" ? "Jouw aanbod" : "Van " + (r.aanbieder || "een collega");
        return `<div class="rx-mon-kaart" style="border-left-color:${_kleurVan({ kleur: r.kleur, id: r.id })}">
          <div class="rx-mon-titel">${esc(_werkbonTekst({ werkbon: r.werkbon, naam: r.project }))}</div>
          <div class="rx-mon-sub">${esc(datumLang(r.datum))} · ${esc(tijdTekst(r))}${r.locatie ? " · " + esc(r.locatie) : ""}</div>
          <div class="rx-mon-sub">${esc(wie)}
            <span class="badge ${RUIL_KLEUR[r.status] || "grijs"}">${esc(RUIL_LABEL[r.status] || r.status)}</span></div>
          ${r.reden ? `<div class="rx-mon-sub">${esc(r.reden)}</div>` : ""}
          ${r.status === "geclaimd" ? `<div class="rx-mon-sub rx-stil">Kantoor moet de ruil nog goedkeuren.</div>` : ""}
          ${knoppen.join("")}
        </div>`;
      }).join("");
    }
  }

  async function monteurActie(knop, meldEl, uitvoeren, standaardfout) {
    verbergMeld(meldEl);
    const oud = knop.textContent;
    knop.disabled = true; knop.textContent = "Bezig…";
    let fout = null;
    try {
      const { error } = await uitvoeren();
      fout = error;
    } catch (e) {
      fout = e;
    }
    knop.disabled = false; knop.textContent = oud;
    if (fout) { toonMeld(meldEl, "fout", netfout(fout, standaardfout)); return false; }
    return true;
  }

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;

    if (t.dataset.rxBes) {
      await zetBeschikbaar(t);
    } else if (t.dataset.rxWil) {
      const ok = await monteurActie(t, $("rxMonOpenMeld"), () => db.from("open_dienst_reacties")
        .update({ status: "aangevraagd" }).eq("id", t.dataset.rxWil), "Reageren is niet gelukt.");
      if (ok) { toonMeld($("rxMonOpenMeld"), "ok", "Je reactie is doorgegeven."); await laadOpenDiensten(); }
    } else if (t.dataset.rxNietwil) {
      const ok = await monteurActie(t, $("rxMonOpenMeld"), () => db.from("open_dienst_reacties")
        .update({ status: "uitgenodigd" }).eq("id", t.dataset.rxNietwil), "Intrekken is niet gelukt.");
      if (ok) { toonMeld($("rxMonOpenMeld"), "ok", "Je aanvraag is ingetrokken."); await laadOpenDiensten(); }
    } else if (t.dataset.rxAanbied) {
      const mid = await mijnId();
      if (!mid) return toonMeld($("rxMonRuilMeld"), "fout", "Log opnieuw in en probeer het nog een keer.");
      const reden = prompt("Waarom bied je deze dienst aan? (mag leeg blijven)") ?? "";
      const ok = await monteurActie(t, $("rxMonRuilMeld"), () => db.from("dienst_ruil").insert({
        planning_id: t.dataset.rxAanbied, aanbieder_id: mid, reden: reden.trim() || null,
      }), "Aanbieden is niet gelukt.");
      if (ok) { toonMeld($("rxMonRuilMeld"), "ok", "Je dienst staat aangeboden. Kantoor keurt de ruil goed."); await laadRuil(); }
    } else if (t.dataset.rxOverneem) {
      const mid = await mijnId();
      if (!mid) return toonMeld($("rxMonRuilMeld"), "fout", "Log opnieuw in en probeer het nog een keer.");
      const ok = await monteurActie(t, $("rxMonRuilMeld"), () => db.from("dienst_ruil")
        .update({ status: "geclaimd", overnemer_id: mid })
        .eq("id", t.dataset.rxOverneem).eq("status", "aangeboden"), "Overnemen is niet gelukt.");
      if (ok) { toonMeld($("rxMonRuilMeld"), "ok", "Doorgegeven. Kantoor moet de ruil nog goedkeuren."); await laadRuil(); }
    } else if (t.dataset.rxRuilintrek) {
      const ok = await monteurActie(t, $("rxMonRuilMeld"), () => db.from("dienst_ruil")
        .update({ status: "ingetrokken" }).eq("id", t.dataset.rxRuilintrek), "Intrekken is niet gelukt.");
      if (ok) { toonMeld($("rxMonRuilMeld"), "ok", "Je aanbod is ingetrokken."); await laadRuil(); }
    }
  });

  document.querySelectorAll('[data-mnav="rooster"]').forEach((b) => b.addEventListener("click", () => ververs()));

  async function ververs() {
    await Promise.all([laadOpenDiensten(), laadBeschikbaarheid(), laadRuil()]);
  }

  db.auth?.getSession?.().then(({ data }) => { if (data?.session) ververs(); }).catch(() => {});

  return { ververs, laadOpenDiensten, laadBeschikbaarheid, laadRuil };
}

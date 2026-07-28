// ============================================================================
//  Spaar Electra — Urenregistratie · instellingen (zes onderdelen)
//
//    1. Afwezigheidsbeperkingen — maximaal N tegelijk afwezig
//    2. Feestdagen instelbaar    — stonden hard in beheer.js en monteur.js
//    3. Vaardigheden             — VCA, hoogwerker, NEN 3140
//    4. Vrije velden             — eigen velden op medewerker en urenregel
//    5. Toegangsrechtgroepen     — losse rechten naast rol beheerder/monteur
//    6. Contracthistorie         — reeks contracten in plaats van er één
//
//  Het echte slot zit in migratie 150; dit bestand is de bediening ervan.
//  Alles wat hier misgaat komt dus ook langs als het scherm wordt omzeild, en
//  daarom laat elk scherm de foutmelding uit de database letterlijk zien in
//  plaats van er een eigen tekst voor te verzinnen. Bij een instellingenscherm
//  is een stille mislukking het ergste wat er kan gebeuren: je denkt dat de
//  grens aanstaat en hij staat er niet.
//
//  Wordt vanuit beheer.js aangeroepen: bouwInstellingen(db, hulp).
//  Vanuit monteur.js: bouwMonteurExtra(db, hulp).
// ============================================================================

// Welke gedeelde hulpjes uit beheer.js nodig zijn. Ontbreekt er een, dan gaat
// dit scherm niet half werkend open maar meteen stuk met een leesbare fout.
const NODIG = ["esc", "rijLeeg", "toonMeld", "vulSelect", "isoDatum"];

const DAG_KEYS_VAL = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const SOORT_LABEL = { tekst: "Tekst", getal: "Getal", datum: "Datum", keuze: "Keuzelijst", janee: "Ja/nee" };

// ── Feestdagen uit de database in de bestaande cache van de app ─────────────
//  beheer.js en monteur.js hebben allebei een `const _feestdagen = {}` waarin
//  feestdagen(jaar) zijn uitkomst per jaar bewaart. Door die cache vooraf te
//  vullen gaat de tabel gelden zonder dat er één regel aan de berekening
//  verandert: voor een jaar dat in de tabel staat komt hij er niet meer aan te
//  pas, voor een jaar dat er niet in staat rekent hij zoals altijd.
//  Dat is met opzet zo gedaan — een tweede plek waar feestdagen berekend worden
//  is precies hoe verlofsaldo's uit elkaar gaan lopen.
export async function koppelFeestdagen(db, cache) {
  if (!cache || typeof cache !== "object") throw new Error("koppelFeestdagen: geef de _feestdagen-cache mee.");
  const { data, error } = await db.from("feestdagen").select("datum, actief").eq("actief", true);
  if (error) {
    // Niet stil verdergaan: de app rekent dan met de oude vaste lijst en dat
    // geeft een ander aantal verlofdagen dan het beheer ziet.
    console.error("Feestdagen laden mislukt:", error.message);
    return { gelukt: false, fout: error.message, jaren: 0 };
  }
  const jaren = new Set();
  (data || []).forEach((r) => {
    const jaar = Number(String(r.datum).slice(0, 4));
    if (!cache[jaar]) cache[jaar] = new Set();
    cache[jaar].add(r.datum);
    jaren.add(jaar);
  });
  return { gelukt: true, fout: null, jaren: jaren.size };
}

// ── Gedeelde kleine dingen ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function iso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function datumNl(d) {
  return d ? new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}
function komma(n) {
  return n == null || n === "" ? "" : String(Math.round(Number(n) * 100) / 100).replace(".", ",");
}

// ============================================================================
//  BEHEER — het instellingenscherm met zes tabbladen
// ============================================================================
export function bouwInstellingen(db, hulp) {
  const ontbreekt = NODIG.filter((n) => typeof hulp?.[n] !== "function");
  if (ontbreekt.length) {
    throw new Error("instellingen-extra.js kan niet starten: ontbrekende hulpfuncties uit beheer.js — " + ontbreekt.join(", "));
  }
  const { esc, rijLeeg, toonMeld, vulSelect } = hulp;
  const isoDatum = hulp.isoDatum || iso;
  const DAG_KEYS = Array.isArray(hulp.DAG_KEYS) ? hulp.DAG_KEYS : DAG_KEYS_VAL;
  // Optioneel: laat het dashboard opnieuw laden als een instelling doorwerkt in
  // een ander scherm (bijvoorbeeld een gewijzigd contract in de urenlijst).
  const naVerandering = typeof hulp.naVerandering === "function" ? hulp.naVerandering : null;

  const nodigInDom = ["ixTabs", "ixBpMelding", "ixTbBeperkingen", "ixFdMelding", "ixTbFeestdagen",
    "ixVdMelding", "ixTbVaardigheden", "ixVvMelding", "ixTbVelden", "ixRgMelding", "ixRgLijst",
    "ixCtMelding", "ixCtTijdlijn"];
  const kwijt = nodigInDom.filter((id) => !$(id));
  if (kwijt.length) {
    throw new Error("instellingen-extra.js kan niet starten: ontbrekende elementen in beheer.html — " + kwijt.join(", "));
  }

  let _types = [];          // afwezigheid_types
  let _vaardigheden = [];
  let _rechten = [];
  let _groepen = [];
  let _groepRechten = [];
  let _velden = [];
  let _medewerkers = [];    // id + naam, voor de keuzelijsten
  let _vormen = [];         // contractvormen
  let _mijnRechten = new Set();

  // Kleine wikkel om elke databaseaanroep. Een mislukte instelling die niets
  // zegt is hier het gevaar: kantoor denkt dat de grens aanstaat.
  function fout(meldEl, wat, error) {
    toonMeld($(meldEl), "fout", wat + ": " + (error?.message || "onbekende fout"));
    return false;
  }
  function goed(meldEl, wat) {
    toonMeld($(meldEl), "ok", wat);
    return true;
  }

  // ── Tabbladen ─────────────────────────────────────────────────────────────
  document.querySelectorAll("[data-ixtab]").forEach((b) => b.addEventListener("click", () => {
    const naam = b.dataset.ixtab;
    document.querySelectorAll("[data-ixtab]").forEach((x) => x.classList.toggle("actief", x === b));
    document.querySelectorAll("[data-ixpaneel]").forEach((p) => p.classList.toggle("verborgen", p.dataset.ixpaneel !== naam));
    if (naam === "beperkingen") laadBeperkingen();
    if (naam === "feestdagen") laadFeestdagen();
    if (naam === "vaardigheden") laadVaardigheden();
    if (naam === "velden") laadVelden();
    if (naam === "rechten") laadRechten();
    if (naam === "contracten") laadContracten();
  }));

  // ==========================================================================
  //  1) AFWEZIGHEIDSBEPERKINGEN
  // ==========================================================================
  async function laadBeperkingen() {
    const [b, t] = await Promise.all([
      db.from("afwezigheid_beperkingen").select("*").order("naam"),
      db.from("afwezigheid_types").select("id, code, naam").order("volgorde"),
    ]);
    if (b.error) { $("ixTbBeperkingen").innerHTML = rijLeeg(7, "Kon de beperkingen niet laden: " + esc(b.error.message)); return; }
    _types = t.data || [];
    vulSelect("ixBpType", [["", "Alle afwezigheidstypes samen"]].concat(_types.map((x) => [x.id, x.naam])));

    const naamVanType = (id) => (_types.find((x) => x.id === id) || {}).naam || "—";
    $("ixTbBeperkingen").innerHTML = (b.data || []).map((r) => `<tr${r.actief ? "" : ' class="ix-rij-uit"'}>
      <td class="sterk">${esc(r.naam)}</td>
      <td>${r.type_id ? esc(naamVanType(r.type_id)) : '<span class="ix-mini">alle types</span>'}</td>
      <td class="ix-nowrap">${r.van_datum || r.tot_datum
        ? esc(datumNl(r.van_datum) + " – " + datumNl(r.tot_datum))
        : '<span class="ix-mini">het hele jaar</span>'}</td>
      <td class="ix-getal">${r.max_afwezig}</td>
      <td>${r.alleen_werkdagen ? '<span class="badge grijs">alleen werkdagen</span>' : '<span class="badge grijs">alle dagen</span>'}</td>
      <td>${r.actief ? '<span class="badge groen">aan</span>' : '<span class="badge grijs">uit</span>'}</td>
      <td class="ix-nowrap">
        <button class="btn btn-grijs btn-klein" data-ixbp-aan="${r.id}" data-nu="${r.actief}">${r.actief ? "Uitzetten" : "Aanzetten"}</button>
        <button class="btn btn-grijs btn-klein" data-ixbp-del="${r.id}">Verwijder</button>
      </td></tr>`).join("") || rijLeeg(7, "Nog geen beperkingen — er mag dan iedereen tegelijk vrij.");

    document.querySelectorAll("[data-ixbp-aan]").forEach((k) => k.addEventListener("click", async () => {
      const { error } = await db.from("afwezigheid_beperkingen")
        .update({ actief: k.dataset.nu !== "true" }).eq("id", k.dataset.ixbpAan);
      if (error) return fout("ixBpMelding", "Aanpassen mislukt", error);
      laadBeperkingen();
    }));
    document.querySelectorAll("[data-ixbp-del]").forEach((k) => k.addEventListener("click", async () => {
      if (!confirm("Deze beperking verwijderen? Er wordt dan niet meer op gecontroleerd bij het goedkeuren.")) return;
      const { error } = await db.from("afwezigheid_beperkingen").delete().eq("id", k.dataset.ixbpDel);
      if (error) return fout("ixBpMelding", "Verwijderen mislukt", error);
      goed("ixBpMelding", "Beperking verwijderd.");
      laadBeperkingen();
    }));
  }

  $("ixBpToevoegen")?.addEventListener("click", async () => {
    const naam = $("ixBpNaam").value.trim();
    const max = parseInt($("ixBpMax").value, 10);
    if (!naam) return toonMeld($("ixBpMelding"), "fout", "Geef de beperking een naam, bijvoorbeeld \"Bouwvak\".");
    if (isNaN(max) || max < 0) return toonMeld($("ixBpMelding"), "fout", "Vul in hoeveel monteurs er tegelijk weg mogen.");
    const van = $("ixBpVan").value || null, tot = $("ixBpTot").value || null;
    if (van && tot && tot < van) return toonMeld($("ixBpMelding"), "fout", "De einddatum ligt vóór de begindatum.");
    const { error } = await db.from("afwezigheid_beperkingen").insert({
      naam, type_id: $("ixBpType").value || null, van_datum: van, tot_datum: tot,
      max_afwezig: max, alleen_werkdagen: $("ixBpWerkdagen").checked,
    });
    if (error) return fout("ixBpMelding", "Opslaan mislukt", error);
    $("ixBpNaam").value = "";
    goed("ixBpMelding", `Beperking "${naam}" toegevoegd: maximaal ${max} tegelijk afwezig.`);
    laadBeperkingen();
  });

  // ── Bezetting per dag ─────────────────────────────────────────────────────
  $("ixBzToon")?.addEventListener("click", toonBezetting);
  async function toonBezetting() {
    const van = $("ixBzVan").value, tot = $("ixBzTot").value;
    const strook = $("ixBzStrook");
    if (!van || !tot) return toonMeld($("ixBpMelding"), "fout", "Kies een periode om de bezetting van te zien.");
    if (tot < van) return toonMeld($("ixBpMelding"), "fout", "De einddatum ligt vóór de begindatum.");
    const { data, error } = await db.rpc("afwezigheid_bezetting", { p_van: van, p_tot: tot, p_soort: null, p_negeer: null });
    if (error) { strook.innerHTML = ""; return fout("ixBpMelding", "Bezetting opvragen mislukt", error); }
    if (!data || !data.length) {
      strook.innerHTML = '<span class="leeg">Geen beperking die op deze dagen geldt.</span>';
      return;
    }
    // Meerdere beperkingen op dezelfde dag: de krapste bepaalt wat je ziet.
    const perDag = new Map();
    data.forEach((r) => {
      const bestaand = perDag.get(r.datum);
      const ruimte = r.maximum - r.bezet;
      if (!bestaand || ruimte < bestaand.maximum - bestaand.bezet) perDag.set(r.datum, r);
    });
    strook.innerHTML = [...perDag.values()].map((r) => {
      const vol = r.bezet >= r.maximum;
      const bijna = !vol && r.bezet >= r.maximum - 1;
      const d = new Date(r.datum + "T12:00:00");
      return `<div class="ix-dag${vol ? " ix-vol" : bijna ? " ix-bijna" : ""}" title="${esc(r.beperking)}">
        ${esc(d.toLocaleDateString("nl-NL", { weekday: "short" }))} ${d.getDate()}
        <b>${r.bezet}/${r.maximum}</b></div>`;
    }).join("");
  }

  // ==========================================================================
  //  2) FEESTDAGEN
  // ==========================================================================
  async function laadFeestdagen() {
    const jaar = $("ixFdJaar").value || String(new Date().getFullYear());
    const { data, error } = await db.from("feestdagen")
      .select("*").gte("datum", jaar + "-01-01").lte("datum", jaar + "-12-31").order("datum");
    if (error) { $("ixTbFeestdagen").innerHTML = rijLeeg(5, "Kon de feestdagen niet laden: " + esc(error.message)); return; }
    $("ixTbFeestdagen").innerHTML = (data || []).map((r) => `<tr${r.actief ? "" : ' class="ix-rij-uit"'}>
      <td class="mono sterk">${esc(datumNl(r.datum))}</td>
      <td>${esc(r.naam)}</td>
      <td>${r.bron === "handmatig" ? '<span class="badge amber">handmatig</span>' : '<span class="badge grijs">berekend</span>'}</td>
      <td><input type="checkbox" data-ixfd-actief="${r.id}" ${r.actief ? "checked" : ""}></td>
      <td class="ix-nowrap"><button class="btn btn-grijs btn-klein" data-ixfd-del="${r.id}">Verwijder</button></td>
    </tr>`).join("") || rijLeeg(5, `Nog geen feestdagen in ${esc(jaar)} — vul de komende jaren bij.`);

    document.querySelectorAll("[data-ixfd-actief]").forEach((c) => c.addEventListener("change", async () => {
      const { error: e } = await db.from("feestdagen").update({ actief: c.checked }).eq("id", c.dataset.ixfdActief);
      if (e) { c.checked = !c.checked; return fout("ixFdMelding", "Aanpassen mislukt", e); }
      // Een uitgezette feestdag telt weer als werkdag; het aantal verlofdagen
      // van een lopende aanvraag verandert daarmee mee.
      goed("ixFdMelding", "Aangepast. Let op: dit telt mee bij het aantal verlofdagen.");
      laadFeestdagen();
    }));
    document.querySelectorAll("[data-ixfd-del]").forEach((k) => k.addEventListener("click", async () => {
      if (!confirm("Deze dag verwijderen? Hij telt dan weer als gewone werkdag bij het tellen van verlof.")) return;
      const { error: e } = await db.from("feestdagen").delete().eq("id", k.dataset.ixfdDel);
      if (e) return fout("ixFdMelding", "Verwijderen mislukt", e);
      laadFeestdagen();
    }));
  }

  function vulJaarKeuze() {
    const nu = new Date().getFullYear();
    const jaren = [];
    for (let j = nu - 2; j <= nu + 5; j++) jaren.push([String(j), String(j)]);
    vulSelect("ixFdJaar", jaren);
    $("ixFdJaar").value = String(nu);
  }
  $("ixFdJaar")?.addEventListener("change", laadFeestdagen);

  $("ixFdToevoegen")?.addEventListener("click", async () => {
    const datum = $("ixFdDatum").value, naam = $("ixFdNaam").value.trim();
    if (!datum || !naam) return toonMeld($("ixFdMelding"), "fout", "Vul een datum en een naam in.");
    const { error } = await db.from("feestdagen").insert({ datum, naam, bron: "handmatig" });
    if (error) return fout("ixFdMelding", "Opslaan mislukt", error);
    $("ixFdNaam").value = "";
    goed("ixFdMelding", `"${naam}" toegevoegd. Ververs de app zodat het aantal verlofdagen opnieuw geteld wordt.`);
    $("ixFdJaar").value = datum.slice(0, 4);
    laadFeestdagen();
  });

  $("ixFdBijvullen")?.addEventListener("click", async () => {
    const tot = parseInt($("ixFdTotJaar").value, 10);
    if (isNaN(tot)) return toonMeld($("ixFdMelding"), "fout", "Vul in tot en met welk jaar er bijgevuld moet worden.");
    const { data, error } = await db.rpc("feestdagen_bijvullen", { p_tot_jaar: tot });
    if (error) return fout("ixFdMelding", "Bijvullen mislukt", error);
    goed("ixFdMelding", `Bijgevuld tot en met ${tot}: ${data ?? 0} dagen toegevoegd. Bestaande dagen zijn ongemoeid gelaten.`);
    laadFeestdagen();
  });

  // ==========================================================================
  //  3) VAARDIGHEDEN
  // ==========================================================================
  async function laadVaardigheden() {
    const [v, m, p] = await Promise.all([
      db.from("vaardigheden").select("*").order("volgorde").order("naam"),
      db.from("medewerkers").select("id, naam").is("verwijderd_op", null).order("naam"),
      db.from("projecten").select("id, werkbon, naam").is("verwijderd_op", null).neq("status", "afgerond").order("naam"),
    ]);
    if (v.error) { $("ixTbVaardigheden").innerHTML = rijLeeg(5, "Kon de vaardigheden niet laden: " + esc(v.error.message)); return; }
    _vaardigheden = v.data || [];
    _medewerkers = m.data || [];

    $("ixTbVaardigheden").innerHTML = _vaardigheden.map((r) => `<tr${r.actief ? "" : ' class="ix-rij-uit"'}>
      <td><span class="ix-stip" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(r.kleur)}"></span></td>
      <td class="sterk">${esc(r.naam)}</td>
      <td>${esc(r.omschrijving || "")}</td>
      <td>${r.verloopt ? '<span class="badge amber">verloopt</span>' : '<span class="badge grijs">blijvend</span>'}</td>
      <td class="ix-nowrap">
        <input type="checkbox" data-ixvd-actief="${r.id}" ${r.actief ? "checked" : ""} title="Actief">
        <button class="btn btn-grijs btn-klein" data-ixvd-del="${r.id}">Verwijder</button>
      </td></tr>`).join("") || rijLeeg(5, "Nog geen vaardigheden.");

    vulSelect("ixVdMedewerker", _medewerkers.map((x) => [x.id, x.naam]));
    vulSelect("ixVdKies", _vaardigheden.filter((x) => x.actief).map((x) => [x.id, x.naam]));
    vulSelect("ixVdProject", (p.data || []).map((x) => [x.id, (x.werkbon ? x.werkbon + " · " : "") + x.naam]));

    document.querySelectorAll("[data-ixvd-actief]").forEach((c) => c.addEventListener("change", async () => {
      const { error } = await db.from("vaardigheden").update({ actief: c.checked }).eq("id", c.dataset.ixvdActief);
      if (error) { c.checked = !c.checked; return fout("ixVdMelding", "Aanpassen mislukt", error); }
      laadVaardigheden();
    }));
    document.querySelectorAll("[data-ixvd-del]").forEach((k) => k.addEventListener("click", async () => {
      if (!confirm("Deze vaardigheid verwijderen? Hij verdwijnt ook bij alle monteurs en werkbonnen.")) return;
      const { error } = await db.from("vaardigheden").delete().eq("id", k.dataset.ixvdDel);
      if (error) return fout("ixVdMelding", "Verwijderen mislukt", error);
      laadVaardigheden();
    }));

    await Promise.all([toonMonteurVaardigheden(), toonProjectVaardigheden()]);
  }

  $("ixVdToevoegen")?.addEventListener("click", async () => {
    const naam = $("ixVdNaam").value.trim();
    if (!naam) return toonMeld($("ixVdMelding"), "fout", "Geef de vaardigheid een naam.");
    const { error } = await db.from("vaardigheden").insert({
      naam, omschrijving: $("ixVdOms").value.trim() || null, verloopt: $("ixVdVerloopt").checked,
    });
    if (error) return fout("ixVdMelding", "Opslaan mislukt", error);
    $("ixVdNaam").value = ""; $("ixVdOms").value = "";
    goed("ixVdMelding", `"${naam}" toegevoegd.`);
    laadVaardigheden();
  });

  // ── Wat kan deze monteur? ─────────────────────────────────────────────────
  $("ixVdMedewerker")?.addEventListener("change", toonMonteurVaardigheden);
  async function toonMonteurVaardigheden() {
    const mid = $("ixVdMedewerker").value;
    const vak = $("ixVdMedLijst");
    if (!mid) { vak.innerHTML = ""; return; }
    const { data, error } = await db.from("medewerker_vaardigheden")
      .select("vaardigheid_id, behaald_op, geldig_tot, vaardigheden(naam, kleur)")
      .eq("medewerker_id", mid);
    if (error) { vak.innerHTML = ""; return fout("ixVdMelding", "Vaardigheden ophalen mislukt", error); }
    const vandaag = isoDatum(new Date());
    // Bijna verlopen = binnen 60 dagen. Dat is net genoeg om een cursus te
    // plannen; korter erop wijzen heeft geen zin meer.
    const grens = new Date(); grens.setDate(grens.getDate() + 60);
    const grensIso = isoDatum(grens);
    vak.innerHTML = (data || []).map((r) => {
      const verlopen = r.geldig_tot && r.geldig_tot < vandaag;
      const bijna = !verlopen && r.geldig_tot && r.geldig_tot <= grensIso;
      const naam = r.vaardigheden?.naam || "—";
      const tot = r.geldig_tot ? " · t/m " + datumNl(r.geldig_tot) : "";
      return `<span class="ix-chip${verlopen ? " ix-verlopen" : bijna ? " ix-bijna-verlopen" : ""}">
        <span class="ix-stip" style="background:${esc(r.vaardigheden?.kleur || "#6d635f")}"></span>
        ${esc(naam + tot)}
        <button data-ixvd-los="${esc(r.vaardigheid_id)}" title="Weghalen">&times;</button></span>`;
    }).join("") || '<span class="leeg">Nog niets vastgelegd voor deze monteur.</span>';

    document.querySelectorAll("[data-ixvd-los]").forEach((k) => k.addEventListener("click", async () => {
      const { error: e } = await db.from("medewerker_vaardigheden").delete()
        .match({ medewerker_id: mid, vaardigheid_id: k.dataset.ixvdLos });
      if (e) return fout("ixVdMelding", "Weghalen mislukt", e);
      toonMonteurVaardigheden();
    }));
  }

  $("ixVdKoppel")?.addEventListener("click", async () => {
    const mid = $("ixVdMedewerker").value, vid = $("ixVdKies").value;
    if (!mid || !vid) return toonMeld($("ixVdMelding"), "fout", "Kies een monteur en een vaardigheid.");
    const rij = {
      medewerker_id: mid, vaardigheid_id: vid,
      behaald_op: $("ixVdBehaald").value || null,
      geldig_tot: $("ixVdGeldig").value || null,
    };
    // Opnieuw koppelen betekent in de praktijk "certificaat verlengd", niet
    // "fout, bestaat al". Daarom bijwerken in plaats van weigeren.
    const { error } = await db.from("medewerker_vaardigheden")
      .upsert(rij, { onConflict: "medewerker_id,vaardigheid_id" });
    if (error) return fout("ixVdMelding", "Koppelen mislukt", error);
    goed("ixVdMelding", "Vastgelegd.");
    toonMonteurVaardigheden();
  });

  // ── Wat vraagt deze werkbon? ──────────────────────────────────────────────
  $("ixVdProject")?.addEventListener("change", toonProjectVaardigheden);
  async function toonProjectVaardigheden() {
    const pid = $("ixVdProject").value;
    const vak = $("ixVdProjectRaster");
    if (!pid) { vak.innerHTML = ""; return; }
    const { data, error } = await db.from("project_vaardigheden").select("vaardigheid_id").eq("project_id", pid);
    if (error) { vak.innerHTML = ""; return fout("ixVdMelding", "Vereisten ophalen mislukt", error); }
    const gekozen = new Set((data || []).map((r) => r.vaardigheid_id));
    vak.innerHTML = _vaardigheden.filter((v) => v.actief).map((v) => `<label>
      <input type="checkbox" data-ixpv="${v.id}" ${gekozen.has(v.id) ? "checked" : ""}>
      <span>${esc(v.naam)}${v.omschrijving ? `<span class="ix-bij">${esc(v.omschrijving)}</span>` : ""}</span>
    </label>`).join("") || '<span class="leeg">Nog geen vaardigheden ingesteld.</span>';

    document.querySelectorAll("[data-ixpv]").forEach((c) => c.addEventListener("change", async () => {
      const sleutel = { project_id: pid, vaardigheid_id: c.dataset.ixpv };
      const { error: e } = c.checked
        ? await db.from("project_vaardigheden").insert(sleutel)
        : await db.from("project_vaardigheden").delete().match(sleutel);
      if (e) { c.checked = !c.checked; return fout("ixVdMelding", "Aanpassen mislukt", e); }
      goed("ixVdMelding", "Vereisten van deze werkbon aangepast.");
    }));
  }

  // ── Wie staat er ingepland zonder het papier? ─────────────────────────────
  $("ixVdWaarschuwToon")?.addEventListener("click", async () => {
    const van = $("ixVdWaarschuwVan").value, tot = $("ixVdWaarschuwTot").value;
    if (!van || !tot) return toonMeld($("ixVdMelding"), "fout", "Kies een periode.");
    const { data, error } = await db.rpc("planning_vaardigheid_waarschuwingen", { p_van: van, p_tot: tot });
    if (error) { $("ixTbVdWaarschuwingen").innerHTML = rijLeeg(5, "Mislukt: " + esc(error.message)); return; }
    $("ixTbVdWaarschuwingen").innerHTML = (data || []).map((r) => `<tr>
      <td class="mono">${esc(datumNl(r.datum))}</td>
      <td class="sterk">${esc(r.naam)}</td>
      <td>${esc((r.werkbon ? r.werkbon + " · " : "") + (r.project || ""))}</td>
      <td>${esc(r.vaardigheid)}</td>
      <td>${r.reden === "ontbreekt" ? '<span class="badge rood">ontbreekt</span>' : `<span class="badge amber">${esc(r.reden)}</span>`}</td>
    </tr>`).join("") || rijLeeg(5, "Niemand staat ingepland op een werkbon waarvoor hij het papier mist.");
  });

  // ==========================================================================
  //  4) VRIJE VELDEN
  // ==========================================================================
  async function laadVelden() {
    const { data, error } = await db.from("vrije_velden").select("*").order("doel").order("volgorde");
    if (error) { $("ixTbVelden").innerHTML = rijLeeg(7, "Kon de vrije velden niet laden: " + esc(error.message)); return; }
    _velden = data || [];
    $("ixTbVelden").innerHTML = _velden.map((r) => `<tr${r.actief ? "" : ' class="ix-rij-uit"'}>
      <td>${r.doel === "medewerker" ? "Medewerker" : "Urenregistratie"}</td>
      <td class="sterk">${esc(r.label)}${r.alleen_beheer ? '<span class="ix-alleen-kantoor">kantoor</span>' : ""}</td>
      <td class="mono">${esc(r.sleutel)}</td>
      <td>${esc(SOORT_LABEL[r.soort] || r.soort)}${r.soort === "keuze" ? `<span class="ix-bij ix-mini">${esc((r.keuzes || []).join(", "))}</span>` : ""}</td>
      <td>${r.verplicht ? '<span class="badge amber">verplicht</span>' : ""}</td>
      <td><input type="checkbox" data-ixvv-actief="${r.id}" ${r.actief ? "checked" : ""}></td>
      <td class="ix-nowrap"><button class="btn btn-grijs btn-klein" data-ixvv-del="${r.id}">Verwijder</button></td>
    </tr>`).join("") || rijLeeg(7, "Nog geen vrije velden.");

    document.querySelectorAll("[data-ixvv-actief]").forEach((c) => c.addEventListener("change", async () => {
      const { error: e } = await db.from("vrije_velden").update({ actief: c.checked }).eq("id", c.dataset.ixvvActief);
      if (e) { c.checked = !c.checked; return fout("ixVvMelding", "Aanpassen mislukt", e); }
      laadVelden();
    }));
    document.querySelectorAll("[data-ixvv-del]").forEach((k) => k.addEventListener("click", async () => {
      if (!confirm("Dit veld verwijderen? Alle ingevulde waarden gaan mee — ook in oude urenregistraties.")) return;
      const { error: e } = await db.from("vrije_velden").delete().eq("id", k.dataset.ixvvDel);
      if (e) return fout("ixVvMelding", "Verwijderen mislukt", e);
      goed("ixVvMelding", "Veld verwijderd.");
      laadVelden();
    }));
  }

  // De sleutel wordt de kolomkop in de export. Hem laten afleiden uit het label
  // scheelt een invulveld en voorkomt spaties en accenten in die kop.
  function sleutelUit(label) {
    return String(label || "").toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)
      .replace(/^([^a-z])/, "v$1");
  }
  $("ixVvLabel")?.addEventListener("input", () => {
    if (!$("ixVvSleutel").dataset.aangeraakt) $("ixVvSleutel").value = sleutelUit($("ixVvLabel").value);
  });
  $("ixVvSleutel")?.addEventListener("input", () => { $("ixVvSleutel").dataset.aangeraakt = "ja"; });
  $("ixVvSoort")?.addEventListener("change", () => {
    $("ixVvKeuzesRij").classList.toggle("verborgen", $("ixVvSoort").value !== "keuze");
  });

  $("ixVvToevoegen")?.addEventListener("click", async () => {
    const label = $("ixVvLabel").value.trim();
    const sleutel = ($("ixVvSleutel").value.trim() || sleutelUit(label));
    const soort = $("ixVvSoort").value;
    if (!label) return toonMeld($("ixVvMelding"), "fout", "Geef het veld een label.");
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(sleutel)) {
      return toonMeld($("ixVvMelding"), "fout", "De sleutel mag alleen kleine letters, cijfers en liggende streepjes bevatten en moet met een letter beginnen.");
    }
    const keuzes = soort === "keuze"
      ? $("ixVvKeuzes").value.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean)
      : null;
    if (soort === "keuze" && !keuzes.length) {
      return toonMeld($("ixVvMelding"), "fout", "Vul de keuzes in, gescheiden door komma's.");
    }
    const { error } = await db.from("vrije_velden").insert({
      doel: $("ixVvDoel").value, sleutel, label, soort, keuzes,
      hint: $("ixVvHint").value.trim() || null,
      verplicht: $("ixVvVerplicht").checked,
      alleen_beheer: $("ixVvAlleenBeheer").checked,
    });
    if (error) return fout("ixVvMelding", "Opslaan mislukt", error);
    $("ixVvLabel").value = ""; $("ixVvSleutel").value = ""; $("ixVvKeuzes").value = ""; $("ixVvHint").value = "";
    delete $("ixVvSleutel").dataset.aangeraakt;
    goed("ixVvMelding", `Veld "${label}" toegevoegd. Het verschijnt meteen in het bewerkvenster en in de export.`);
    laadVelden();
  });

  // ── De velden in een bewerkvenster ────────────────────────────────────────
  //  Wordt door beheer.js aangeroepen bij het openen en het opslaan van het
  //  medewerker- en het urenvenster. Bewust twee losse stappen: het opslaan
  //  moet pas gebeuren als de hoofdrij een id heeft (bij een nieuwe rij bestaat
  //  die pas ná het opslaan).
  async function velden(doel) {
    if (!_velden.length) {
      const { data } = await db.from("vrije_velden").select("*").eq("actief", true).order("volgorde");
      _velden = data || [];
    }
    return _velden.filter((v) => v.doel === doel && v.actief);
  }

  function veldInvoer(v, w) {
    const id = "ixvv_" + v.id;
    const gemeenschappelijk = `id="${id}" data-ixvv="${v.id}" data-soort="${esc(v.soort)}"`;
    if (v.soort === "janee") {
      return `<label class="ix-janee"><input type="checkbox" ${gemeenschappelijk} ${w?.waarde_janee ? "checked" : ""}> ${esc(v.label)}</label>`;
    }
    let invoer;
    if (v.soort === "getal") invoer = `<input type="number" step="0.01" ${gemeenschappelijk} value="${w?.waarde_getal ?? ""}">`;
    else if (v.soort === "datum") invoer = `<input type="date" ${gemeenschappelijk} value="${esc(w?.waarde_datum || "")}">`;
    else if (v.soort === "keuze") {
      invoer = `<select ${gemeenschappelijk}><option value="">—</option>` +
        (v.keuzes || []).map((k) => `<option value="${esc(k)}"${w?.waarde_tekst === k ? " selected" : ""}>${esc(k)}</option>`).join("") +
        `</select>`;
    } else invoer = `<input type="text" ${gemeenschappelijk} value="${esc(w?.waarde_tekst || "")}">`;
    return `<label for="${id}">${esc(v.label)}${v.verplicht ? ' <span class="ster">*</span>' : ""}${
      v.alleen_beheer ? '<span class="ix-alleen-kantoor">kantoor</span>' : ""}</label>${invoer}`;
  }

  async function toonVrijeVelden(doel, doelId, containerId) {
    const vak = $(containerId);
    if (!vak) return;
    const lijst = await velden(doel);
    if (!lijst.length) { vak.innerHTML = ""; vak.classList.add("verborgen"); return; }
    vak.classList.remove("verborgen");
    let waarden = [];
    if (doelId) {
      const kolom = doel === "medewerker" ? "medewerker_id" : "urenregel_id";
      const { data, error } = await db.from("vrije_waarden").select("*").eq(kolom, doelId);
      if (error) {
        vak.innerHTML = `<div class="melding fout">Eigen velden laden mislukt: ${esc(error.message)}</div>`;
        return;
      }
      waarden = data || [];
    }
    vak.innerHTML = `<div class="ix-vrijvak">
      <div class="ix-vrijvak-kop">Eigen velden</div>
      ${lijst.map((v) => `<div class="ix-veld">${veldInvoer(v, waarden.find((w) => w.veld_id === v.id))}${
        v.hint ? `<p class="ix-hint">${esc(v.hint)}</p>` : ""}</div>`).join("")}
    </div>`;
  }

  function leesVrijVeld(el) {
    const soort = el.dataset.soort;
    if (soort === "janee") return { waarde_janee: el.checked, leeg: false };
    const v = el.value.trim();
    if (v === "") return { leeg: true };
    if (soort === "getal") {
      const n = parseFloat(v.replace(",", "."));
      return isNaN(n) ? { fout: "geen geldig getal" } : { waarde_getal: n, leeg: false };
    }
    if (soort === "datum") return { waarde_datum: v, leeg: false };
    return { waarde_tekst: v, leeg: false };
  }

  //  Geen upsert: de uniekheid zit op een gedeeltelijke index en die kan
  //  PostgREST niet als conflictdoel gebruiken. Per veld bijwerken, toevoegen
  //  of weghalen is bovendien eerlijker — een leeggemaakt veld hoort te
  //  verdwijnen, niet als lege tekst te blijven staan.
  async function bewaarVrijeVelden(doel, doelId, containerId) {
    const vak = $(containerId);
    if (!vak || !doelId) return { gelukt: true, fout: null };
    const kolom = doel === "medewerker" ? "medewerker_id" : "urenregel_id";
    const { data: bestaand, error: leesFout } = await db.from("vrije_waarden").select("id, veld_id").eq(kolom, doelId);
    if (leesFout) return { gelukt: false, fout: leesFout.message };
    const perVeld = new Map((bestaand || []).map((r) => [r.veld_id, r.id]));

    for (const el of vak.querySelectorAll("[data-ixvv]")) {
      const veldId = el.dataset.ixvv;
      const gelezen = leesVrijVeld(el);
      if (gelezen.fout) return { gelukt: false, fout: `Eigen veld: ${gelezen.fout}.` };
      const bestaatId = perVeld.get(veldId);
      if (gelezen.leeg) {
        if (bestaatId) {
          const { error } = await db.from("vrije_waarden").delete().eq("id", bestaatId);
          if (error) return { gelukt: false, fout: error.message };
        }
        continue;
      }
      const rij = {
        veld_id: veldId, [kolom]: doelId,
        waarde_tekst: null, waarde_getal: null, waarde_datum: null, waarde_janee: null,
        ...gelezen,
      };
      delete rij.leeg;
      const { error } = bestaatId
        ? await db.from("vrije_waarden").update(rij).eq("id", bestaatId)
        : await db.from("vrije_waarden").insert(rij);
      if (error) return { gelukt: false, fout: error.message };
    }
    return { gelukt: true, fout: null };
  }

  // Voor de export: alle waarden van een reeks urenregels of medewerkers, als
  // { doelId: { sleutel: waarde } }. De kolomkoppen haal je uit velden(doel).
  async function vrijeVeldenVoorExport(doel, ids) {
    if (!ids || !ids.length) return {};
    const uit = {};
    // In brokken van 200: een lijst van duizend id's in één URL loopt tegen de
    // lengtegrens van PostgREST aan en mislukt dan zonder duidelijke reden.
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from("vrije_waarden_leesbaar")
        .select("doel_id, sleutel, waarde").eq("doel", doel).in("doel_id", ids.slice(i, i + 200));
      if (error) throw new Error("Eigen velden voor de export ophalen mislukt: " + error.message);
      (data || []).forEach((r) => {
        if (!uit[r.doel_id]) uit[r.doel_id] = {};
        uit[r.doel_id][r.sleutel] = r.waarde;
      });
    }
    return uit;
  }

  // ==========================================================================
  //  5) TOEGANGSRECHTGROEPEN
  // ==========================================================================
  async function laadRechten() {
    const [r, g, gr, m, lid] = await Promise.all([
      db.from("rechten").select("*").order("volgorde"),
      db.from("rechtgroepen").select("*").order("naam"),
      db.from("rechtgroep_rechten").select("*"),
      db.from("medewerkers").select("id, naam, rol").is("verwijderd_op", null).order("naam"),
      db.from("medewerker_rechtgroepen").select("medewerker_id, groep_id"),
    ]);
    if (g.error) { $("ixRgLijst").innerHTML = `<div class="melding fout">Kon de groepen niet laden: ${esc(g.error.message)}</div>`; return; }
    _rechten = r.data || []; _groepen = g.data || []; _groepRechten = gr.data || [];
    _medewerkers = m.data || [];
    const leden = lid.data || [];

    $("ixRgLijst").innerHTML = _groepen.map((groep) => {
      const eigen = new Set(_groepRechten.filter((x) => x.groep_id === groep.id).map((x) => x.recht_code));
      const aantal = leden.filter((x) => x.groep_id === groep.id).length;
      return `<div class="ix-groep${eigen.size ? "" : " ix-leeg"}">
        <div class="ix-groep-kop">
          <h3>${esc(groep.naam)}</h3>
          <span class="ix-tel">${aantal} ${aantal === 1 ? "medewerker" : "medewerkers"} · ${eigen.size} van ${_rechten.length} rechten</span>
          <span class="ix-knoppen">
            <button class="btn btn-grijs btn-klein" data-ixrg-aan="${groep.id}" data-nu="${groep.actief}">${groep.actief ? "Uitzetten" : "Aanzetten"}</button>
            <button class="btn btn-grijs btn-klein" data-ixrg-del="${groep.id}">Verwijder</button>
          </span>
        </div>
        ${groep.omschrijving ? `<p class="ix-uitleg">${esc(groep.omschrijving)}</p>` : ""}
        <div class="ix-raster">${_rechten.map((recht) => `<label>
          <input type="checkbox" data-ixrg-groep="${groep.id}" data-ixrg-recht="${esc(recht.code)}" ${eigen.has(recht.code) ? "checked" : ""}>
          <span>${esc(recht.naam)}<span class="ix-bij">${esc(recht.omschrijving || "")}</span></span>
        </label>`).join("")}</div>
      </div>`;
    }).join("") || '<div class="leeg">Nog geen groepen. Iedereen valt terug op zijn rol: beheerder of medewerker.</div>';

    // Alleen medewerkers zonder de rol beheerder: die heeft alles al, en hem in
    // een groep zetten wekt de indruk dat je er iets mee beperkt.
    vulSelect("ixRgMedewerker", _medewerkers.filter((x) => x.rol !== "beheerder").map((x) => [x.id, x.naam]));
    vulSelect("ixRgGroep", _groepen.filter((x) => x.actief).map((x) => [x.id, x.naam]));

    const naamVan = (id) => (_medewerkers.find((x) => x.id === id) || {}).naam || "—";
    const groepVan = (id) => (_groepen.find((x) => x.id === id) || {}).naam || "—";
    $("ixTbLeden").innerHTML = leden.map((x) => `<tr>
      <td class="sterk">${esc(naamVan(x.medewerker_id))}</td>
      <td>${esc(groepVan(x.groep_id))}</td>
      <td class="ix-nowrap"><button class="btn btn-grijs btn-klein"
        data-ixrg-los-med="${x.medewerker_id}" data-ixrg-los-groep="${x.groep_id}">Uit de groep</button></td>
    </tr>`).join("") || rijLeeg(3, "Nog niemand in een groep.");

    document.querySelectorAll("[data-ixrg-groep]").forEach((c) => c.addEventListener("change", async () => {
      const sleutel = { groep_id: c.dataset.ixrgGroep, recht_code: c.dataset.ixrgRecht };
      const { error } = c.checked
        ? await db.from("rechtgroep_rechten").insert(sleutel)
        : await db.from("rechtgroep_rechten").delete().match(sleutel);
      if (error) { c.checked = !c.checked; return fout("ixRgMelding", "Recht aanpassen mislukt", error); }
      goed("ixRgMelding", "Recht aangepast. Wie is ingelogd merkt het bij zijn volgende handeling.");
      laadRechten();
    }));
    document.querySelectorAll("[data-ixrg-aan]").forEach((k) => k.addEventListener("click", async () => {
      const { error } = await db.from("rechtgroepen").update({ actief: k.dataset.nu !== "true" }).eq("id", k.dataset.ixrgAan);
      if (error) return fout("ixRgMelding", "Aanpassen mislukt", error);
      laadRechten();
    }));
    document.querySelectorAll("[data-ixrg-del]").forEach((k) => k.addEventListener("click", async () => {
      if (!confirm("Deze groep verwijderen? De leden verliezen daarmee hun extra rechten.")) return;
      const { error } = await db.from("rechtgroepen").delete().eq("id", k.dataset.ixrgDel);
      if (error) return fout("ixRgMelding", "Verwijderen mislukt", error);
      goed("ixRgMelding", "Groep verwijderd.");
      laadRechten();
    }));
    document.querySelectorAll("[data-ixrg-los-med]").forEach((k) => k.addEventListener("click", async () => {
      const { error } = await db.from("medewerker_rechtgroepen").delete()
        .match({ medewerker_id: k.dataset.ixrgLosMed, groep_id: k.dataset.ixrgLosGroep });
      if (error) return fout("ixRgMelding", "Weghalen mislukt", error);
      laadRechten();
    }));
  }

  $("ixRgToevoegen")?.addEventListener("click", async () => {
    const naam = $("ixRgNaam").value.trim();
    if (!naam) return toonMeld($("ixRgMelding"), "fout", "Geef de groep een naam.");
    const { error } = await db.from("rechtgroepen").insert({ naam, omschrijving: $("ixRgOms").value.trim() || null });
    if (error) return fout("ixRgMelding", "Opslaan mislukt", error);
    $("ixRgNaam").value = ""; $("ixRgOms").value = "";
    goed("ixRgMelding", `Groep "${naam}" toegevoegd. Vink hieronder aan wat de groep mag.`);
    laadRechten();
  });

  $("ixRgKoppel")?.addEventListener("click", async () => {
    const mid = $("ixRgMedewerker").value, gid = $("ixRgGroep").value;
    if (!mid || !gid) return toonMeld($("ixRgMelding"), "fout", "Kies een medewerker en een groep.");
    const { error } = await db.from("medewerker_rechtgroepen").insert({ medewerker_id: mid, groep_id: gid });
    if (error) {
      // Dubbel toevoegen is geen fout die kantoor hoeft te lezen.
      if (String(error.code) === "23505") return goed("ixRgMelding", "Die medewerker zat al in deze groep.");
      return fout("ixRgMelding", "Toevoegen mislukt", error);
    }
    goed("ixRgMelding", "Toegevoegd aan de groep.");
    laadRechten();
  });

  // ==========================================================================
  //  6) CONTRACTHISTORIE
  // ==========================================================================
  function bouwUrenInvoer(containerId, waarden) {
    const c = $(containerId);
    if (!c) return;
    c.innerHTML = DAG_KEYS.map((d) =>
      `<div class="dag"><span>${d}</span><input data-ixdag="${d}" type="number" min="0" max="16" step="0.5" placeholder="0" value="${waarden && waarden[d] ? waarden[d] : ""}"></div>`
    ).join("") + `<div class="totaal" data-ixtotaal>0 u</div>`;
    const bij = () => {
      const t = DAG_KEYS.reduce((s, d) => s + (parseFloat(c.querySelector(`[data-ixdag="${d}"]`).value) || 0), 0);
      c.querySelector("[data-ixtotaal]").textContent = (Math.round(t * 10) / 10) + " u";
    };
    c.querySelectorAll("input").forEach((i) => i.addEventListener("input", bij));
    bij();
  }
  function leesUrenInvoer(containerId) {
    const c = $(containerId);
    const uit = {};
    let iets = false;
    DAG_KEYS.forEach((d) => {
      const v = parseFloat(c.querySelector(`[data-ixdag="${d}"]`).value);
      if (!isNaN(v) && v > 0) { uit[d] = v; iets = true; }
    });
    return iets ? uit : null;
  }
  function weekTotaal(u) {
    return u ? Math.round(DAG_KEYS.reduce((s, d) => s + (parseFloat(u[d]) || 0), 0) * 10) / 10 : 0;
  }

  async function laadContracten() {
    if (!_medewerkers.length || !_vormen.length) {
      const [m, cv] = await Promise.all([
        db.from("medewerkers").select("id, naam").is("verwijderd_op", null).order("naam"),
        db.from("contractvormen").select("id, naam").order("naam"),
      ]);
      _medewerkers = m.data || _medewerkers;
      _vormen = cv.data || [];
      vulSelect("ixCtMedewerker", _medewerkers.map((x) => [x.id, x.naam]));
      vulSelect("ixCtVorm", [["", "—"]].concat(_vormen.map((x) => [x.id, x.naam])));
      bouwUrenInvoer("ixCtUren", null);
    }
    await toonTijdlijn();
  }
  $("ixCtMedewerker")?.addEventListener("change", toonTijdlijn);

  async function toonTijdlijn() {
    const mid = $("ixCtMedewerker").value;
    const vak = $("ixCtTijdlijn");
    if (!mid) { vak.innerHTML = ""; return; }
    const { data, error } = await db.from("contracten")
      .select("*, contractvormen(naam)").eq("medewerker_id", mid).order("van_datum", { ascending: false });
    if (error) { vak.innerHTML = `<div class="melding fout">Contracten laden mislukt: ${esc(error.message)}</div>`; return; }
    const vandaag = isoDatum(new Date());
    // Het uurloon staat er alleen als het mag. De database geeft de rij dan
    // gewoon niet, maar een leeg vakje leest als een fout — dus zeg het.
    vak.innerHTML = `<ul class="ix-tijdlijn">${(data || []).map((c) => {
      const nu = c.van_datum <= vandaag && (!c.tot_datum || c.tot_datum >= vandaag);
      const uren = weekTotaal(c.uren);
      return `<li${nu ? ' class="ix-nu"' : ""}>
        <div class="ix-periode">${esc(datumNl(c.van_datum))} – ${c.tot_datum ? esc(datumNl(c.tot_datum)) : "heden"}${nu ? " · geldt nu" : ""}</div>
        <div class="ix-regel">
          ${esc(c.contractvormen?.naam || "geen contractvorm")}${c.contract_type ? " · " + esc(c.contract_type) : ""}
          ${c.functietitel ? " · " + esc(c.functietitel) : ""}
          · <b>${komma(uren)} u</b> per week
          · ${c.uurloon == null ? '<span class="ix-loon-verborgen">geen uurloon vastgelegd</span>' : "<b>&euro; " + komma(c.uurloon) + "</b> per uur"}
        </div>
        ${c.notitie ? `<div class="ix-mini">${esc(c.notitie)}</div>` : ""}
        <div class="ix-knoppen">
          <button class="btn btn-grijs btn-klein" data-ixct-eind="${c.id}">Beëindigen per…</button>
          <button class="btn btn-grijs btn-klein" data-ixct-del="${c.id}">Verwijder</button>
        </div>
      </li>`;
    }).join("")}</ul>` || "";
    if (!data || !data.length) {
      vak.innerHTML = '<div class="leeg">Nog geen contracthistorie voor deze medewerker.</div>';
    }

    document.querySelectorAll("[data-ixct-eind]").forEach((k) => k.addEventListener("click", async () => {
      const d = prompt("Beëindigen per welke datum? (jjjj-mm-dd)", vandaag);
      if (!d) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return toonMeld($("ixCtMelding"), "fout", "Vul de datum als jjjj-mm-dd in.");
      const { error: e } = await db.from("contracten").update({ tot_datum: d }).eq("id", k.dataset.ixctEind);
      if (e) return fout("ixCtMelding", "Beëindigen mislukt", e);
      goed("ixCtMelding", "Einddatum vastgelegd.");
      toonTijdlijn(); if (naVerandering) naVerandering();
    }));
    document.querySelectorAll("[data-ixct-del]").forEach((k) => k.addEventListener("click", async () => {
      if (!confirm("Dit contract verwijderen? De uitbetaling over die dagen valt daarmee terug op het contract ervoor.")) return;
      const { error: e } = await db.from("contracten").delete().eq("id", k.dataset.ixctDel);
      if (e) return fout("ixCtMelding", "Verwijderen mislukt", e);
      goed("ixCtMelding", "Contract verwijderd.");
      toonTijdlijn(); if (naVerandering) naVerandering();
    }));
  }

  $("ixCtToevoegen")?.addEventListener("click", async () => {
    const mid = $("ixCtMedewerker").value;
    const van = $("ixCtVan").value;
    if (!mid) return toonMeld($("ixCtMelding"), "fout", "Kies een medewerker.");
    if (!van) return toonMeld($("ixCtMelding"), "fout", "Vul de startdatum van het nieuwe contract in.");
    const uren = leesUrenInvoer("ixCtUren");
    if (!uren) return toonMeld($("ixCtMelding"), "fout", "Vul de contracturen per dag in.");
    const loon = $("ixCtUurloon").value === "" ? null : parseFloat($("ixCtUurloon").value.replace(",", "."));
    if (loon != null && isNaN(loon)) return toonMeld($("ixCtMelding"), "fout", "Het uurloon is geen geldig bedrag.");

    const { error } = await db.from("contracten").insert({
      medewerker_id: mid, van_datum: van, tot_datum: $("ixCtTot").value || null,
      contractvorm_id: $("ixCtVorm").value || null,
      contract_type: $("ixCtType").value || null,
      functietitel: $("ixCtFunctie").value.trim() || null,
      uren, uurloon: loon, loonheffing: $("ixCtLoonheffing").checked,
      notitie: $("ixCtNotitie").value.trim() || null,
    });
    if (error) {
      // De uitsluiting op overlap is de meest voorkomende weigering; die
      // foutmelding van Postgres is onleesbaar, dus hier in gewone taal.
      if (String(error.message || "").includes("contract_geed_overlap")
          || String(error.message || "").includes("contract_geen_overlap")) {
        return toonMeld($("ixCtMelding"), "fout",
          "Dit contract overlapt met een bestaand contract. Beëindig eerst het lopende contract per de dag vóór deze startdatum.");
      }
      return fout("ixCtMelding", "Opslaan mislukt", error);
    }
    $("ixCtNotitie").value = "";
    goed("ixCtMelding", "Contract toegevoegd. De uitbetaling rekent vanaf deze datum met de nieuwe gegevens.");
    toonTijdlijn();
    if (naVerandering) naVerandering();
  });

  // ── Opstarten ─────────────────────────────────────────────────────────────
  vulJaarKeuze();
  const nu = new Date();
  if ($("ixBzVan") && !$("ixBzVan").value) $("ixBzVan").value = isoDatum(new Date(nu.getFullYear(), nu.getMonth(), 1));
  if ($("ixBzTot") && !$("ixBzTot").value) $("ixBzTot").value = isoDatum(new Date(nu.getFullYear(), nu.getMonth() + 1, 0));
  if ($("ixFdTotJaar") && !$("ixFdTotJaar").value) $("ixFdTotJaar").value = String(nu.getFullYear() + 5);
  if ($("ixVdWaarschuwVan") && !$("ixVdWaarschuwVan").value) $("ixVdWaarschuwVan").value = isoDatum(nu);
  if ($("ixVdWaarschuwTot") && !$("ixVdWaarschuwTot").value) {
    $("ixVdWaarschuwTot").value = isoDatum(new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() + 28));
  }
  laadBeperkingen();

  // Wat mag ik zelf? Alleen om knoppen te kunnen verbergen — het echte oordeel
  // valt in de database, dus een verkeerd antwoord hier is hinderlijk, niet
  // gevaarlijk.
  db.rpc("mijn_rechten").then(({ data }) => {
    _mijnRechten = new Set((data || []).map((r) => r.code));
  });

  // De haken die beheer.js nodig heeft voor de vrije velden in de vensters.
  const api = {
    toonVrijeVelden, bewaarVrijeVelden, vrijeVeldenVoorExport, velden,
    magIk: (recht) => _mijnRechten.has(recht),
    herlaad: laadBeperkingen,
  };
  // Ook op window, zodat het aanhaken in beheer.js één regel per venster is.
  window.ixVrijeVelden = api;
  return api;
}

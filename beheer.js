// ============================================================================
//  Spaar Electra — Urenregistratie · beheer-dashboard
//  Shiftbase-indeling (zijbalk) in Spaar-huisstijl. Dashboard, Rooster,
//  Urenregistratie (met km/pauze), Verlof, Werkbonnen, Medewerkers, Rapportages.
// ============================================================================
import { beheerClient } from "./config.js?v=45";

const $ = (id) => document.getElementById(id);
import { icoon, ICOON_KEUZE } from "./iconen.js?v=45";
const db = beheerClient();
let tikker = null;
let ikBenId = null;        // medewerker-id van de ingelogde beheerder

const PAGINA_TITEL = {
  dashboard: "Dashboard", rooster: "Rooster", uren: "Urenregistratie",
  verlof: "Verlof", projecten: "Werkbonnen", medewerkers: "Medewerkers", beleid: "Verlofbeleid", pauzes: "Pauzes",
  rapporten: "Rapportages",
};
const SOORT_LABEL = { vakantie: "Vakantie", ziek: "Ziek", onbetaald: "Onbetaald verlof", bijzonder: "Bijzonder verlof" };

// ── Login ───────────────────────────────────────────────────────────────────
$("loginBtn").addEventListener("click", inloggen);
$("wachtwoord").addEventListener("keydown", (e) => { if (e.key === "Enter") inloggen(); });

async function inloggen() {
  verberg($("loginFout"));
  const email = $("email").value.trim();
  const password = $("wachtwoord").value;
  if (!email || !password) return toon($("loginFout"), "Vul e-mail en wachtwoord in.");
  $("loginBtn").disabled = true;
  const { error } = await db.auth.signInWithPassword({ email, password });
  $("loginBtn").disabled = false;
  if (error) return toon($("loginFout"), "Onjuiste inloggegevens.");
  naarDash();
}

(async function () {
  const { data } = await db.auth.getSession();
  if (data.session) naarDash();
})();

$("uitloggen").addEventListener("click", async () => { await db.auth.signOut(); location.reload(); });

async function naarDash() {
  $("loginScherm").classList.add("verborgen");
  $("app").classList.remove("verborgen");
  const { data } = await db.auth.getUser();
  if (data?.user) {
    $("wieBen").textContent = data.user.email;
    // Wie ben ik als medewerker? Nodig om vast te leggen wie goedkeurt.
    const { data: ik } = await db.from("medewerkers")
      .select("id").eq("auth_user_id", data.user.id).is("verwijderd_op", null).maybeSingle();
    ikBenId = ik?.id || null;
  }
  // Beleid eerst: verlof, rooster en typelabels halen hun naam, kleur en
  // pictogram uit _types, dus die lijst moet er zijn voordat er getekend wordt.
  await Promise.all([laadBeleid(), laadVormen()]);
  await Promise.all([laadIngeklokt(), laadUren(), laadProjecten(), laadMedewerkers(), laadRooster(), laadVerlof(), laadPauzes()]);
  standaardPeriode();
  toonRapport();
  if (tikker) clearInterval(tikker);
  tikker = setInterval(laadIngeklokt, 30000);
}

// Wisselt van weergave. Het medewerkerdossier heeft geen eigen knop in de
// zijbalk: je komt er via een rij in de medewerkerslijst.
function toonView(naam) {
  document.querySelectorAll("[data-view]").forEach((v) => v.classList.toggle("verborgen", v.dataset.view !== naam));
  const nav = document.querySelector(`.nav[data-tab="${naam === "medewerker" ? "medewerkers" : naam}"]`);
  document.querySelectorAll(".nav").forEach((x) => x.classList.remove("actief"));
  if (nav) nav.classList.add("actief");
  $("paginaTitel").textContent = naam === "medewerker" ? "Medewerker" : (PAGINA_TITEL[naam] || "");
  $("app").classList.remove("open");
}

// ── Navigatie (zijbalk) ──────────────────────────────────────────────────────
document.querySelectorAll(".nav").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".nav").forEach((x) => x.classList.remove("actief"));
  t.classList.add("actief");
  const tab = t.dataset.tab;
  document.querySelectorAll("[data-view]").forEach((v) => v.classList.toggle("verborgen", v.dataset.view !== tab));
  $("paginaTitel").textContent = PAGINA_TITEL[tab] || "";
  $("app").classList.remove("open"); // mobiel menu sluiten
  // Rapportages meteen invullen: een leeg scherm oogt als een storing.
  if (tab === "rapporten") toonRapport();
}));
$("menuKnop").addEventListener("click", () => $("app").classList.toggle("open"));
$("app").addEventListener("click", (e) => { if (e.target === $("app")) $("app").classList.remove("open"); });

// ── Nu ingeklokt + wie niet ─────────────────────────────────────────────────
async function laadIngeklokt() {
  const [{ data, error }, { data: monteurs }] = await Promise.all([
    db.from("kloksessies")
      .select("id, medewerker_id, project_id, ingeklokt_op, in_lat, in_lng, medewerkers!medewerker_id(naam), projecten(werkbon, naam)")
      .order("ingeklokt_op"),
    db.from("medewerkers").select("id, naam").eq("rol", "monteur").is("verwijderd_op", null).order("naam"),
  ]);
  const tb = $("tbIngeklokt");
  if (error) { tb.innerHTML = rijLeeg(5, "Kon niet laden."); return; }
  window._sessies = data || [];

  $("telIngeklokt").textContent = (data || []).length ? "(" + data.length + ")" : "";
  tb.innerHTML = (data || []).length
    ? data.map((k) => `<tr><td class="sterk">${esc(k.medewerkers?.naam)}</td>
        <td class="mono">${esc(werkbonTekst(k.projecten))}</td>
        <td class="mono">${tijd(k.ingeklokt_op)}${klokKnop(k.in_lat, k.in_lng, k.medewerkers?.naam, k.ingeklokt_op, werkbonTekst(k.projecten))}</td>
        <td><span class="badge groen"><span class="dot"></span> ${duurTekst(k.ingeklokt_op)}</span></td>
        <td><button class="btn btn-grijs btn-klein" data-forceer-uit="${k.id}">Uitklokken</button></td></tr>`).join("")
    : rijLeeg(5, "Niemand is nu ingeklokt.");
  koppelKlokKnoppen();

  // Beheerder klokt een vergeten sessie uit: urenregel (onbeslist) + sessie sluiten
  document.querySelectorAll("[data-forceer-uit]").forEach((b) => b.addEventListener("click", async () => {
    const s = (window._sessies || []).find((x) => x.id === b.dataset.forceerUit);
    if (!s) return;
    const duurUur = (Date.now() - new Date(s.ingeklokt_op).getTime()) / 3600000;
    if (!confirm(`${s.medewerkers?.naam} uitklokken?\n\nIngeklokt sinds ${tijd(s.ingeklokt_op)} (${duurUur.toFixed(1)} uur geleden). Er wordt een urenregel aangemaakt met status "onbeslist" die je daarna kunt aanpassen of afkeuren.`)) return;
    const start = new Date(s.ingeklokt_op);
    let eind = new Date();
    // Vergeet iemand vrijdag uit te klokken, dan is het maandag 65 uur. De
    // database weigert meer dan 24 uur, waarna de kloksessie open bleef — en
    // omdat er maar één open sessie mag zijn kon de monteur die dag helemaal
    // niet meer klokken. Dus vragen wat de echte eindtijd was.
    if (duurUur > 16) {
      const opgegeven = prompt(
        (s.medewerkers?.naam || "Deze monteur") + " staat sinds "
        + start.toLocaleString("nl-NL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
        + " ingeklokt.\n\nHoe laat is hij die dag gestopt? (bijvoorbeeld 16:00)", "16:00");
      if (opgegeven === null) return;
      const m = /^(\d{1,2})[:.](\d{2})$/.exec(opgegeven.trim());
      if (!m) return alert("Vul de eindtijd in als uu:mm, bijvoorbeeld 16:00.");
      eind = new Date(start);
      eind.setHours(Number(m[1]), Number(m[2]), 0, 0);
      if (eind <= start) eind.setDate(eind.getDate() + 1);   // dienst over middernacht
      if ((eind - start) / 3600000 > 24) return alert("Dat is meer dan 24 uur na de inkloktijd.");
    }
    const uren = urenUitMinuten(Math.round((eind - start) / 60000));
    const datumLokaal = start.getFullYear() + "-" + String(start.getMonth() + 1).padStart(2, "0") + "-" + String(start.getDate()).padStart(2, "0");
    const { error: e1 } = await db.from("urenregels").insert({
      medewerker_id: s.medewerker_id, project_id: s.project_id,
      datum: datumLokaal, start_tijd: s.ingeklokt_op, eind_tijd: eind.toISOString(),
      uren, omschrijving: "Door beheerder uitgeklokt (vergeten uit te klokken)",
      bron: "handmatig", in_lat: s.in_lat, in_lng: s.in_lng,
    });
    // Bestaat de regel al (23505), dan is dat geen reden om de sessie open te
    // laten staan; dat zou de monteur alsnog blokkeren.
    if (e1 && e1.code !== "23505") return alert("Uitklokken mislukt: " + e1.message);
    const { error: e2 } = await db.from("kloksessies").delete().eq("id", s.id);
    if (e2) return alert("Urenregel aangemaakt, maar sessie sluiten mislukte: " + e2.message);
    await Promise.all([laadIngeklokt(), laadUren()]);
  }));

  const bezet = new Set((data || []).map((k) => k.medewerker_id));
  const vrij = (monteurs || []).filter((m) => !bezet.has(m.id));
  $("telNietIngeklokt").textContent = vrij.length ? "(" + vrij.length + ")" : "";
  $("chipsNiet").innerHTML = vrij.length
    ? vrij.map((m) => `<span class="chip">${esc(m.naam)}</span>`).join("")
    : `<span class="leeg">Iedereen is ingeklokt.</span>`;
}

// ── Urenregistratie ──────────────────────────────────────────────────────────
let _uren = [];
let urenModus = "week";              // dag | week | maand
let urenAnker = new Date();          // dag binnen de getoonde periode

// Begin- en einddatum van de gekozen periode
function urenPeriode() {
  const d = new Date(urenAnker);
  if (urenModus === "dag") return { van: isoDatum(d), tot: isoDatum(d) };
  if (urenModus === "maand") {
    return {
      van: isoDatum(new Date(d.getFullYear(), d.getMonth(), 1)),
      tot: isoDatum(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    };
  }
  const ma = maandagVan(d);
  const zo = new Date(ma); zo.setDate(ma.getDate() + 6);
  return { van: isoDatum(ma), tot: isoDatum(zo) };
}
function urenPeriodeLabel() {
  const { van, tot } = urenPeriode();
  const lang = (s) => new Date(s + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  const kort = (s) => new Date(s + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  if (urenModus === "dag") {
    const dagnaam = new Date(van + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "long" });
    return dagnaam.charAt(0).toUpperCase() + dagnaam.slice(1) + " " + lang(van);
  }
  if (urenModus === "maand") {
    const m = new Date(van + "T12:00:00").toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  return kort(van) + " – " + kort(tot);
}
function verschuifPeriode(richting) {
  const d = new Date(urenAnker);
  if (urenModus === "dag") d.setDate(d.getDate() + richting);
  else if (urenModus === "maand") d.setMonth(d.getMonth() + richting);
  else d.setDate(d.getDate() + richting * 7);
  urenAnker = d;
  laadUren();
}
document.querySelectorAll("[data-uren-modus]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-uren-modus]").forEach((x) => x.classList.remove("actief"));
  b.classList.add("actief");
  urenModus = b.dataset.urenModus;
  laadUren();
}));
$("uVorige").addEventListener("click", () => verschuifPeriode(-1));
$("uVolgende").addEventListener("click", () => verschuifPeriode(1));
$("uVandaag").addEventListener("click", () => { urenAnker = new Date(); laadUren(); });

// Haalt een lijst in pagina's op tot hij op is. PostgREST geeft standaard
// maximaal 1000 rijen per verzoek; een vaste .limit() kapt dan stil af.
async function haalAlles(bouw, paginaGrootte = 1000) {
  const alles = [];
  for (let start = 0; ; start += paginaGrootte) {
    const { data, error } = await bouw(start, start + paginaGrootte - 1);
    if (error) return { data: null, error };
    alles.push(...(data || []));
    if (!data || data.length < paginaGrootte) return { data: alles, error: null };
    // Noodrem. Onvolledig teruggeven zonder het te zeggen is precies wat deze
    // functie moet voorkomen, dus het is hier een fout.
    if (alles.length >= 20000) {
      return { data: null, error: { message: "Meer dan 20.000 regels in deze periode; kies een kortere periode." } };
    }
  }
}

async function laadUren() {
  const { van, tot } = urenPeriode();
  $("uPeriodeLabel").textContent = urenPeriodeLabel();
  // In pagina's ophalen. Bij 23 monteurs zit een volle maand boven de 500
  // regels; met een vaste limiet vielen de oudste dagen er stilzwijgend af en
  // loog de balk "N regels wachten op beoordeling" over hoeveel er echt open
  // stonden. Dit scherm voedt de loonrun, dus het moet compleet zijn.
  const { data, error } = await haalAlles((van_, tot_) => db.from("urenregels")
    .select("id, datum, start_tijd, eind_tijd, uren, km, pauze_onbetaald_min, pauze_betaald_min, status, omschrijving, in_lat, in_lng, nagekeken_op, verwerkt_op, medewerkers!medewerker_id(naam), keurder:medewerkers!nagekeken_door(naam), projecten(id, werkbon, naam, kleur)")
    .is("verwijderd_op", null).gte("datum", van).lte("datum", tot)
    .order("datum", { ascending: false }).order("start_tijd", { ascending: false }).order("id")
    .range(van_, tot_));
  if (error) {
    // Nooit stil falen: een lege lijst en een kapotte query zien er anders identiek uit.
    $("tbRecent").innerHTML = rijLeeg(6, "Kon de uren niet laden: " + error.message);
    $("tbUren").innerHTML = rijLeeg(13, "Kon de uren niet laden: " + error.message);
    return;
  }
  _uren = data || [];
  // De dagweergave zet iedereen op een regel; de lijstweergave toont alleen
  // wat er geklokt is en is handiger over een week of maand.
  const isDag = urenModus === "dag";
  $("dagWeergave").classList.toggle("verborgen", !isDag);
  $("lijstWeergave").classList.toggle("verborgen", isDag);
  if (isDag) { await tekenDagOverzicht(); }
  $("tbUren").innerHTML = _uren.map(urenRij).join("") || rijLeeg(13, "Geen uren in deze periode.");
  laadRecenteUren();
  document.querySelectorAll("[data-keur]").forEach((b) => b.addEventListener("click", () => keur(b.dataset.id, b.dataset.keur)));
  document.querySelectorAll(".uren-kies").forEach((c) => c.addEventListener("change", werkBulkBalkBij));
  $("kiesAlles").checked = false;
  werkBulkBalkBij();
  koppelKlokKnoppen();
}

// ── Meerdere regels tegelijk beoordelen ─────────────────────────────────────
function gekozenIds() {
  return [...document.querySelectorAll(".uren-kies:checked")].map((c) => c.dataset.kies);
}
function werkBulkBalkBij() {
  const n = gekozenIds().length;
  const open = document.querySelectorAll(".uren-kies").length;
  $("bulkAantal").textContent = n
    ? `${n} van ${open} geselecteerd`
    : `${open} ${open === 1 ? "regel wacht" : "regels wachten"} op beoordeling`;
  $("bulkBalk").classList.toggle("verborgen", open === 0);
  $("bulkGoed").disabled = n === 0;
  $("bulkAf").disabled = n === 0;
}
$("kiesAlles").addEventListener("change", (e) => {
  document.querySelectorAll(".uren-kies").forEach((c) => { c.checked = e.target.checked; });
  werkBulkBalkBij();
});
// Zonder ikBenId komt er geen naam bij "nagekeken door" en is achteraf niet
// vast te stellen wie duizenden euro's aan uren heeft geaccordeerd.
function keurderBekend() {
  if (ikBenId) return true;
  alert("Je account is niet aan een medewerker gekoppeld, dus er kan niet worden vastgelegd wie de uren nakijkt. Ververs de pagina; blijft dit staan, neem dan contact op.");
  return false;
}
$("bulkGoed").addEventListener("click", () => {
  if (!keurderBekend()) return;
  const ids = gekozenIds();
  if (confirm(`${ids.length} ${ids.length === 1 ? "regel" : "regels"} goedkeuren?`)) keurMeerdere(ids, "goedgekeurd");
});
$("bulkAf").addEventListener("click", () => {
  const ids = gekozenIds();
  if (confirm(`${ids.length} ${ids.length === 1 ? "regel" : "regels"} afkeuren?`)) keurMeerdere(ids, "afgekeurd");
});
$("bulkAlles").addEventListener("click", async () => {
  if (!keurderBekend()) return;
  // Niet op de geladen rijen afgaan maar op de database: anders keurt "alles"
  // alleen goed wat toevallig in beeld staat, en blijft de rest onbeslist
  // terwijl hij wel meetelt in de rapportage.
  const { van, tot } = urenPeriode();
  const { count, error } = await db.from("urenregels")
    .select("id", { count: "exact", head: true })
    .is("verwijderd_op", null).eq("status", "onbeslist").gte("datum", van).lte("datum", tot);
  if (error) return alert("Tellen mislukt: " + error.message);
  if (!count) return alert("Er staan geen openstaande regels in " + urenPeriodeLabel() + ".");
  if (!confirm(`Alle ${count} openstaande ${count === 1 ? "regel" : "regels"} in ${urenPeriodeLabel()} goedkeuren?`)) return;

  const { error: fout } = await db.from("urenregels")
    .update({ status: "goedgekeurd", nagekeken_door: ikBenId, nagekeken_op: new Date().toISOString() })
    .is("verwijderd_op", null).eq("status", "onbeslist").gte("datum", van).lte("datum", tot);
  if (fout) return alert("Goedkeuren mislukt: " + fout.message);
  await laadUren();
});
// Dashboard toont altijd de laatste registraties, los van de gekozen periode.
async function laadRecenteUren() {
  const { data, error } = await db.from("urenregels")
    .select("datum, uren, status, omschrijving, medewerkers!medewerker_id(naam), projecten(id, werkbon, naam, kleur)")
    .is("verwijderd_op", null).order("datum", { ascending: false }).order("start_tijd", { ascending: false }).limit(8);
  if (error) { $("tbRecent").innerHTML = rijLeeg(6, "Kon de uren niet laden: " + error.message); return; }
  $("tbRecent").innerHTML = (data || []).map(recentRij).join("") || rijLeeg(6, "Nog geen uren.");
}

function statusBadge(s) {
  const st = { onbeslist: "amber", goedgekeurd: "groen", afgekeurd: "rood" }[s] || "grijs";
  return `<span class="badge ${st}">${s}</span>`;
}
function recentRij(u) {
  return `<tr><td class="mono">${datum(u.datum)}</td><td class="sterk">${esc(u.medewerkers?.naam)}</td>
    <td class="mono">${werkbonMetKleur(u.projecten)}</td>
    <td class="sterk mono">${urenTekst(u.uren)}</td>
    <td>${statusBadge(u.status)}</td><td>${esc(u.omschrijving || "")}</td></tr>`;
}
function pauzeTekst(u) {
  const o = u.pauze_onbetaald_min || 0, b = u.pauze_betaald_min || 0;
  if (!o && !b) return "—";
  return (o ? o + "m" : "") + (o && b ? " / " : "") + (b ? b + "m betaald" : "");
}
function klokKnop(lat, lng, naam, iso, werkbon) {
  if (lat == null || lng == null) return "";
  return ` <button class="klok-pin" title="Toon inklok-locatie" data-klok-lat="${lat}" data-klok-lng="${lng}" data-klok-naam="${esc(naam || "")}" data-klok-iso="${esc(iso || "")}" data-klok-werkbon="${esc(werkbon || "")}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg></button>`;
}
function urenRij(u) {
  const verwerkt = !!u.verwerkt_op;
  const actie = u.status === "onbeslist"
    ? `<td style="white-space:nowrap"><button class="btn btn-groen btn-klein" data-keur="goedgekeurd" data-id="${u.id}">Keur goed</button>
         <button class="btn btn-grijs btn-klein" data-keur="afgekeurd" data-id="${u.id}">Afkeuren</button></td>`
    : verwerkt
      ? `<td><span class="mini-grijs">in loonrun</span></td>`
      : `<td><button class="btn btn-grijs btn-klein" data-keur="onbeslist" data-id="${u.id}" title="Terug naar in behandeling">Terugdraaien</button></td>`;
  const keurInfo = u.status !== "onbeslist" && (u.keurder?.naam || u.nagekeken_op)
    ? `<div class="mini-grijs">${esc(u.keurder?.naam || "")}${u.nagekeken_op ? " · " + datum(u.nagekeken_op) : ""}</div>` : "";
  const kies = u.status === "onbeslist"
    ? `<input type="checkbox" class="uren-kies" data-kies="${u.id}" aria-label="Selecteer regel">` : "";
  return `<tr${verwerkt ? ' class="rij-verwerkt"' : ""}><td class="kies-cel">${kies}</td>
    <td class="mono">${datum(u.datum)}</td><td class="sterk">${esc(u.medewerkers?.naam)}</td>
    <td class="mono">${werkbonMetKleur(u.projecten)}</td>
    <td class="loc-cel">${klokKnop(u.in_lat, u.in_lng, u.medewerkers?.naam, u.start_tijd, werkbonTekst(u.projecten)) || '<span class="loc-geen" title="Geen locatie vastgelegd">–</span>'}</td>
    <td class="mono">${u.start_tijd ? tijd(u.start_tijd) : "—"}</td>
    <td class="mono">${u.eind_tijd ? tijd(u.eind_tijd) : "—"}</td>
    <td class="mono">${pauzeTekst(u)}</td>
    <td class="mono">${u.km != null ? u.km : "—"}</td>
    <td class="sterk mono">${urenTekst(u.uren)}</td>
    <td>${statusBadge(u.status)}${keurInfo}</td>
    <td>${esc(u.omschrijving || "")}</td>${actie}</tr>`;
}
async function keur(id, status) {
  const terug = status === "onbeslist";
  const { error } = await db.from("urenregels").update({
    status,
    nagekeken_op: terug ? null : new Date().toISOString(),
    nagekeken_door: terug ? null : ikBenId,
  }).eq("id", id);
  if (error) return alert("Beoordelen mislukt: " + error.message);
  await laadUren();
}

// Meerdere regels tegelijk beoordelen
async function keurMeerdere(ids, status) {
  if (!ids.length) return;
  const { error } = await db.from("urenregels").update({
    status, nagekeken_op: new Date().toISOString(), nagekeken_door: ikBenId,
  }).in("id", ids);
  if (error) return alert("Beoordelen mislukt: " + error.message);
  await laadUren();
}
$("urenExport").addEventListener("click", async () => {
  const { van, tot } = urenPeriode();
  const alleenGoed = $("urenExportSoort").value === "goedgekeurd";

  let q = db.from("urenregels")
    .select("id, datum, start_tijd, eind_tijd, uren, km, pauze_onbetaald_min, pauze_betaald_min, status, omschrijving, verwerkt_op, medewerker_id, medewerkers!medewerker_id(naam), projecten(werkbon, naam)")
    .is("verwijderd_op", null).gte("datum", van).lte("datum", tot);
  if (alleenGoed) q = q.eq("status", "goedgekeurd").is("verwerkt_op", null);

  // Ook hier pagineren: dit is de CSV die daadwerkelijk naar de loonrun gaat,
  // dus een stille afkapping betekent dat er te weinig wordt uitbetaald.
  const { data, error } = await haalAlles((a, b) =>
    q.order("datum").order("start_tijd").order("id").range(a, b));
  if (error) return alert("Exporteren mislukt: " + error.message);
  if (!data || !data.length) {
    return alert(alleenGoed
      ? "Er zijn in deze periode geen goedgekeurde uren die nog niet in een loonrun zaten."
      : "Geen uren in deze periode.");
  }

  const rijen = data.map((u) => [
    u.datum, u.medewerkers?.naam || "", u.medewerker_id, werkbonTekst(u.projecten),
    u.start_tijd ? tijd(u.start_tijd) : "", u.eind_tijd ? tijd(u.eind_tijd) : "",
    u.pauze_onbetaald_min || 0, u.pauze_betaald_min || 0, u.km != null ? u.km : "",
    komma(u.uren), urenTekst(u.uren), u.status, u.omschrijving || "",
  ]);
  csvDownload(
    ["Datum", "Monteur", "Medewerker-id", "Werkbon", "Start", "Eind",
     "Pauze onbetaald (min)", "Pauze betaald (min)", "Km", "Uren (decimaal)", "Uren", "Status", "Omschrijving"],
    rijen, (alleenGoed ? "loonrun" : "uren") + "-" + van + "_" + tot);

  // Na een loonrun-export markeren wat verwerkt is, zodat je dezelfde uren
  // niet twee keer uitbetaalt. De regels blijven zichtbaar, maar grijs.
  if (alleenGoed && confirm(
      `${data.length} ${data.length === 1 ? "regel" : "regels"} geëxporteerd.\n\n` +
      `Markeren als verwerkt in de loonrun? Ze verschijnen dan niet meer in een volgende export.`)) {
    const { error: mErr } = await db.from("urenregels")
      .update({ verwerkt_op: new Date().toISOString() }).in("id", data.map((u) => u.id));
    if (mErr) return alert("Markeren mislukt: " + mErr.message);
    laadUren();
  }
});

// ── Verlof / afwezigheid ─────────────────────────────────────────────────────
async function laadVerlof() {
  const [{ data: mws }, { data, error }] = await Promise.all([
    db.from("medewerkers").select("id, naam").eq("rol", "monteur").is("verwijderd_op", null).order("naam"),
    db.from("afwezigheid").select("id, soort, van_datum, tot_datum, reden, status, medewerkers!medewerker_id(naam)")
      .is("verwijderd_op", null).order("van_datum", { ascending: false }),
  ]);
  if (error) { $("tbVerlof").innerHTML = rijLeeg(8, "Kon verlof niet laden: " + error.message); return; }
  vulSelect("vMedewerker", (mws || []).map((m) => [m.id, m.naam]));

  const rijen = data || [];
  $("telVerlof").textContent = rijen.length ? "(" + rijen.length + ")" : "";
  const open = rijen.filter((r) => r.status === "onbeslist").length;
  const badge = $("verlofBadge");
  if (open) { badge.textContent = open; badge.classList.remove("verborgen"); } else badge.classList.add("verborgen");

  $("tbVerlof").innerHTML = rijen.length ? rijen.map((r) => {
    const actie = r.status === "onbeslist"
      ? `<button class="btn btn-groen btn-klein" data-vkeur="goedgekeurd" data-id="${r.id}">Goedkeuren</button>
         <button class="btn btn-grijs btn-klein" data-vkeur="afgekeurd" data-id="${r.id}">Afwijzen</button>`
      : `<button class="btn btn-grijs btn-klein" data-vdel="${r.id}">Verwijder</button>`;
    return `<tr><td class="sterk">${esc(r.medewerkers?.naam)}</td>
      <td>${typeLabel(r.soort)}</td>
      <td class="mono">${datum(r.van_datum)}</td><td class="mono">${datum(r.tot_datum)}</td>
      <td class="mono">${dagenTussen(r.van_datum, r.tot_datum)}</td>
      <td>${esc(r.reden || "")}</td><td>${statusBadge(r.status)}</td>
      <td style="white-space:nowrap">${actie}</td></tr>`;
  }).join("") : rijLeeg(8, "Nog geen verlof of afwezigheid.");

  document.querySelectorAll("[data-vkeur]").forEach((b) => b.addEventListener("click", async () => {
    const { error } = await db.from("afwezigheid")
      .update({ status: b.dataset.vkeur, nagekeken_door: ikBenId, nagekeken_op: new Date().toISOString() })
      .eq("id", b.dataset.id);
    if (error) return alert("Beoordelen mislukt: " + error.message);
    laadVerlof();
  }));
  document.querySelectorAll("[data-vdel]").forEach((b) => b.addEventListener("click", async () => {
    // Deze knop staat op de plek waar bij openstaande aanvragen "Goedkeuren"
    // stond; na het beoordelen van een rij verspringt hij onder de muis.
    if (!confirm("Deze afwezigheid verwijderen? Hij verdwijnt uit het rooster en uit het verlofsaldo.")) return;
    const { error } = await db.from("afwezigheid").update({ verwijderd_op: new Date().toISOString() }).eq("id", b.dataset.vdel);
    if (error) return alert("Verwijderen mislukt: " + error.message);
    laadVerlof();
  }));
}
$("vToevoegen").addEventListener("click", async () => {
  const medewerker_id = $("vMedewerker").value, soort = $("vSoort").value;
  const van = $("vVan").value, tot = $("vTot").value || $("vVan").value;
  if (!medewerker_id || !van) return alert("Kies een monteur en een begindatum.");
  if (tot < van) return alert("De einddatum ligt vóór de begindatum.");
  // overlapcontrole: bestaat er al (aangevraagd of goedgekeurd) verlof in deze periode?
  const { data: overlap } = await db.from("afwezigheid")
    .select("id, van_datum, tot_datum, soort")
    .eq("medewerker_id", medewerker_id).neq("status", "afgekeurd").is("verwijderd_op", null)
    .lte("van_datum", tot).gte("tot_datum", van).limit(1);
  if (overlap && overlap.length) {
    const o = overlap[0];
    return alert(`Deze monteur heeft al ${SOORT_LABEL[o.soort]?.toLowerCase() || "afwezigheid"} van ${datum(o.van_datum)} t/m ${datum(o.tot_datum)}. Verwijder die eerst of kies een andere periode.`);
  }
  const { error } = await db.from("afwezigheid").insert({
    medewerker_id, soort, van_datum: van, tot_datum: tot,
    reden: $("vReden").value.trim() || null, status: "goedgekeurd",
  });
  if (error) return alert("Mislukt: " + error.message);
  $("vReden").value = "";
  laadVerlof();
});

// ── Werkbonnen ──────────────────────────────────────────────────────────────
// Palet van goed te onderscheiden kleuren; nieuwe werkbonnen krijgen de eerste
// kleur die nog niet in gebruik is, zodat ze zoveel mogelijk verschillen.
const KLEUREN = [
  "#e11d48", "#db2777", "#c026d3", "#9333ea", "#7c3aed", "#4f46e5",
  "#2563eb", "#0284c7", "#0891b2", "#0d9488", "#059669", "#16a34a",
  "#65a30d", "#ca8a04", "#d97706", "#ea580c", "#dc2626", "#b91c1c",
  "#be185d", "#a21caf", "#6d28d9", "#1d4ed8", "#0369a1", "#15803d",
];
function kleurVan(p) {
  if (p && p.kleur) return p.kleur;
  // Nog geen kleur in de database? Kies er stabiel een op basis van het id.
  const s = String(p?.id || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return KLEUREN[h % KLEUREN.length];
}
function vrijeKleur() {
  const inGebruik = new Set((window._projecten || []).map((p) => (p.kleur || "").toLowerCase()));
  return KLEUREN.find((k) => !inGebruik.has(k)) || KLEUREN[inGebruik.size % KLEUREN.length];
}
async function laadProjecten() {
  const { data, error: projFout } = await db.from("projecten").select("*").is("verwijderd_op", null).order("naam");
  if (projFout) {
    $("tbProjecten").innerHTML = rijLeeg(6, "Kon de werkbonnen niet laden: " + projFout.message);
    return;
  }
  window._projecten = data || [];
  $("telProjecten").textContent = (data || []).length ? "(" + data.length + ")" : "";
  // Waarschuwen als er werkbonnen zonder locatie zijn: daar kan een monteur
  // overal inklokken, dus de locatiecontrole doet daar niets.
  const zonderLoc = (data || []).filter((p) => p.lat == null || p.lng == null);
  const w = $("projWaarschuwing");
  if (zonderLoc.length) {
    w.innerHTML = `<b>${zonderLoc.length} van de ${data.length} werkbonnen heeft geen locatie.</b> `
      + `Daar kan een monteur overal inklokken — de locatiecontrole werkt daar niet. `
      + `Klik bij die regels op "Locatie" om een adres in te stellen.`;
    w.className = "melding fout";
  } else {
    w.className = "melding verborgen";
  }
  $("tbProjecten").innerHTML = (data || []).map((p) =>
    `<tr style="border-left:5px solid ${kleurVan(p)}">
     <td><input type="color" class="kleur-kies" value="${kleurVan(p)}" data-kleur-project="${p.id}" title="Kleur van deze werkbon"></td>
     <td class="mono sterk">${esc(p.werkbon || "—")}</td><td>${esc(p.naam)}</td>
     <td>${esc(p.locatie || "")}</td>
     <td>${p.lat != null ? `<span class="badge groen">binnen ${p.radius_m} m</span>` : `<span class="badge rood">geen controle</span>`}</td>
     <td style="white-space:nowrap">
       <button class="btn btn-grijs btn-klein" data-loc-project="${p.id}" data-loc-adres="${esc(p.locatie || "")}" data-loc-naam="${esc(p.naam)}">Locatie</button>
       <button class="btn btn-grijs btn-klein" data-del-project="${p.id}">Verwijder</button>
     </td></tr>`
  ).join("") || rijLeeg(6, "Nog geen werkbonnen.");
  document.querySelectorAll("[data-del-project]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Deze werkbon verwijderen?")) return;
    const { error } = await db.from("projecten").update({ verwijderd_op: new Date().toISOString() }).eq("id", b.dataset.delProject);
    if (error) return alert("Verwijderen mislukt: " + error.message);
    laadProjecten();
  }));
  // Kleur wijzigen: direct opslaan zodra de beheerder een kleur kiest
  document.querySelectorAll("[data-kleur-project]").forEach((k) => k.addEventListener("change", async () => {
    const { error } = await db.from("projecten").update({ kleur: k.value }).eq("id", k.dataset.kleurProject);
    if (error) return alert("Kleur opslaan mislukt: " + error.message);
    laadProjecten(); laadRooster();
  }));
  document.querySelectorAll("[data-loc-project]").forEach((b) => b.addEventListener("click", () => {
    const p = (window._projecten || []).find((x) => x.id === b.dataset.locProject) || {};
    openLocatieKiezer({ id: b.dataset.locProject, naam: b.dataset.locNaam, adres: b.dataset.locAdres || "", lat: p.lat, lng: p.lng, radius_m: p.radius_m });
  }));
}
$("pToevoegen").addEventListener("click", async () => {
  const werkbon = $("pWerkbon").value.trim();
  const naam = $("pNaam").value.trim();
  const locatie = $("pLocatie").value.trim();
  const meld = $("pGeoMelding");

  // Alle velden zijn verplicht: een werkbon zonder nummer of adres is later niet
  // terug te vinden en kan geen inklok-controle krijgen.
  const ontbreekt = [];
  if (!werkbon) ontbreekt.push("werkbonnummer");
  if (!naam) ontbreekt.push("naam");
  if (!locatie) ontbreekt.push("locatie");
  if (ontbreekt.length) {
    markeerLeeg({ pWerkbon: !werkbon, pNaam: !naam, pLocatie: !locatie });
    return toonMeld(meld, "fout", "Vul nog in: " + ontbreekt.join(", ") + ".");
  }
  markeerLeeg({ pWerkbon: false, pNaam: false, pLocatie: false });

  $("pToevoegen").disabled = true;
  try {
    let lat = parseFloat($("pLat").value), lng = parseFloat($("pLng").value);
    // Nog geen coördinaten? Adres opzoeken — zonder locatie geen inklok-controle.
    if (isNaN(lat) || isNaN(lng)) {
      toonMeld(meld, "", "Adres opzoeken…");
      const r = await geocodeer(locatie).catch(() => null);
      if (!r) {
        markeerLeeg({ pLocatie: true });
        return toonMeld(meld, "fout", "Adres niet gevonden. Schrijf het voluit (bv. \"Poortland 34, Amsterdam\") of kies de locatie op de kaart.");
      }
      lat = r.lat; lng = r.lng;
    }
    const { error } = await db.from("projecten").insert({
      werkbon, naam, locatie, radius_m: parseInt($("pRadius").value) || 250,
      lat, lng, status: "lopend", kleur: vrijeKleur(),
    });
    if (error) {
      const msg = error.code === "23505"
        ? `Werkbonnummer ${werkbon} bestaat al.`
        : "Mislukt: " + error.message;
      return toonMeld(meld, "fout", msg);
    }
    ["pWerkbon", "pNaam", "pLocatie", "pLat", "pLng"].forEach((id) => $(id).value = "");
    $("pRadius").value = 250;
    toonMeld(meld, "ok", `Werkbon ${werkbon} toegevoegd.`);
    laadProjecten();
  } finally {
    $("pToevoegen").disabled = false;
  }
});

// Zet een rood randje om velden die nog leeg zijn
function markeerLeeg(velden) {
  Object.entries(velden).forEach(([id, leeg]) => {
    const el = $(id);
    if (el) el.classList.toggle("mist", !!leeg);
  });
}
// Zodra iemand begint te typen mag de rode markering weg
["pWerkbon", "pNaam", "pLocatie"].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("input", () => el.classList.remove("mist"));
});
$("pKaart").addEventListener("click", () => {
  openLocatieKiezer({ modus: "nieuw", naam: $("pNaam").value.trim() || "nieuwe werkbon", adres: $("pLocatie").value.trim(),
    lat: parseFloat($("pLat").value) || null, lng: parseFloat($("pLng").value) || null, radius_m: parseInt($("pRadius").value) || 250 });
});

// ── Medewerkers ─────────────────────────────────────────────────────────────
const DAG_KEYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const CONTRACT_LABEL = { vast: "Vast", tijdelijk: "Tijdelijk", oproep: "Oproep" };

// Bouwt de ma-t/m-zo ureninvoer in een container, met live weektotaal
function bouwUrenWeek(containerId, waarden) {
  const c = $(containerId);
  c.innerHTML = DAG_KEYS.map((d) =>
    `<div class="dag"><span>${d}</span><input data-dag="${d}" type="number" min="0" max="16" step="0.5" placeholder="0" value="${waarden && waarden[d] ? waarden[d] : ""}"></div>`
  ).join("") + `<div class="totaal" data-totaal>0 u</div>`;
  const upd = () => {
    const tot = DAG_KEYS.reduce((s, d) => s + (parseFloat(c.querySelector(`[data-dag="${d}"]`).value) || 0), 0);
    c.querySelector("[data-totaal]").textContent = (Math.round(tot * 10) / 10) + " u";
  };
  c.querySelectorAll("input").forEach((i) => i.addEventListener("input", upd));
  upd();
}
function leesUrenWeek(containerId) {
  const c = $(containerId);
  const uit = {};
  let iets = false;
  DAG_KEYS.forEach((d) => {
    const v = parseFloat(c.querySelector(`[data-dag="${d}"]`).value);
    if (!isNaN(v) && v > 0) { uit[d] = v; iets = true; }
  });
  return iets ? uit : null;
}
function urenWeekTotaal(u) {
  if (!u) return null;
  return Math.round(DAG_KEYS.reduce((s, d) => s + (parseFloat(u[d]) || 0), 0) * 10) / 10;
}

// ── Verlofdagen uit de contracturen ─────────────────────────────────────────
//  De opbouwfactor van het beleid is uitgedrukt per gewerkt uur. Uit de
//  contracturen volgt hoeveel er per jaar gewerkt wordt, en daaruit het
//  verlofrecht. Dat rekenen we hier uit in plaats van het aan de beheerder te
//  vragen, want een verkeerd getal hier werkt door in de loonadministratie.
const WEKEN_PER_JAAR = 52;

// "30 dagen van 8 u" leest prettiger dan "30,00 dagen van 8,00 u".
function netGetal(n) {
  const afgerond = Math.round((Number(n) || 0) * 100) / 100;
  return String(afgerond).replace(".", ",");
}

function verlofBerekening() {
  const week = urenWeekTotaal(leesUrenWeek("medUrenWeek"));
  if (!week) return null;
  const beleid = _beleid.find((b) => b.id === $("medBeleid").value);
  const factor = beleid ? Number(beleid.opbouw_per_uur) : 0;
  const jaarUren = week * WEKEN_PER_JAAR;
  const verlofUren = jaarUren * factor;
  // Een "dag" is hier de gemiddelde lengte van een werkdag, niet een vaste 8
  // uur: bij een vierdaagse week van 32 uur is een verlofdag 8 uur, bij vijf
  // dagen van 6 uur is dat er 6.
  const werkdagen = DAG_KEYS.filter((d) => (leesUrenWeek("medUrenWeek") || {})[d] > 0).length;
  const daglengte = werkdagen ? week / werkdagen : 0;
  return {
    week, beleid, factor, jaarUren, verlofUren, werkdagen, daglengte,
    dagen: daglengte ? verlofUren / daglengte : 0,
    // Wettelijk minimum: vier keer de wekelijkse arbeidsduur per jaar.
    minimumUren: week * 4,
  };
}

function toonVerlofBerekening() {
  const vak = $("medVerlofUitleg");
  if (!vak) return;
  const b = verlofBerekening();
  if (!b) {
    vak.innerHTML = '<span class="leeg">Vul eerst de contracturen per dag in op het tabblad Contract.</span>';
    return;
  }
  if (!b.beleid) {
    vak.innerHTML = '<span class="leeg">Kies een afwezigheidsbeleid om het verlofrecht te berekenen.</span>';
    return;
  }
  // Een factor van 0 betekent "dit beleid bouwt geen verlof op" — bij ZZP is dat
  // de bedoeling en geen fout. Alleen waarschuwen als er wél opgebouwd wordt,
  // maar minder dan de wet voorschrijft.
  const geenOpbouw = b.factor === 0;
  const tekort = !geenOpbouw && b.verlofUren + 0.01 < b.minimumUren;
  vak.innerHTML = `
    <div class="saldo-rij"><span>Contracturen</span><b>${netGetal(b.week)} u per week over ${b.werkdagen} dag${b.werkdagen === 1 ? "" : "en"}</b></div>
    <div class="saldo-rij"><span>Gewerkt per jaar (${WEKEN_PER_JAAR} weken)</span><b>${netGetal(b.jaarUren)} u</b></div>
    <div class="saldo-rij"><span>Opbouw volgens ${esc(b.beleid.naam)} (× ${Number(b.factor).toFixed(6)})</span><b>${geenOpbouw ? "0 u" : urenTekst(b.verlofUren)}</b></div>
    <div class="saldo-rij totaal"><span>Verlofrecht per jaar</span><b>${geenOpbouw ? "geen" : `${netGetal(b.dagen)} dagen van ${netGetal(b.daglengte)} u`}</b></div>
    ${geenOpbouw ? `<div class="melding" style="margin-top:10px">Onder ${esc(b.beleid.naam)} wordt geen verlof opgebouwd. Dat klopt voor ZZP: daar geldt geen wettelijk vakantierecht.</div>` : ""}
    ${tekort ? `<div class="melding fout" style="margin-top:10px">Dit is minder dan het wettelijk minimum van ${netGetal(b.minimumUren)} uur (vier keer de wekelijkse arbeidsduur). Controleer de opbouwfactor van het beleid.</div>` : ""}`;
}

// Het berekende aantal invullen, tenzij de beheerder er zelf iets neergezet heeft.
let verlofDagenHandmatig = false;
function vulVerlofDagen() {
  toonVerlofBerekening();
  if (verlofDagenHandmatig) { waarschuwAfwijkendVerlof(); return; }
  const b = verlofBerekening();
  $("medVerlofDagen").value = b && b.beleid && b.dagen ? Math.round(b.dagen * 10) / 10 : "";
  waarschuwAfwijkendVerlof();
}
// Staat er een handmatig getal dat niet meer klopt bij de contracturen, zeg dat
// dan — stil laten staan kost de monteur of het bedrijf vakantiedagen.
function waarschuwAfwijkendVerlof() {
  const vak = $("medVerlofAfwijking");
  if (!vak) return;
  const b = verlofBerekening();
  const ingevuld = parseFloat($("medVerlofDagen").value);
  if (!b || !b.beleid || !b.dagen || isNaN(ingevuld)) { vak.classList.add("verborgen"); return; }
  const berekend = Math.round(b.dagen * 10) / 10;
  if (Math.abs(berekend - ingevuld) < 0.05) { vak.classList.add("verborgen"); return; }
  vak.textContent = "Let op: ingevuld staat " + netGetal(ingevuld) + " dagen, maar uit de contracturen volgt "
    + netGetal(berekend) + ". Klik op Herberekenen om het gelijk te trekken.";
  vak.classList.remove("verborgen");
}
$("medVerlofHerbereken").addEventListener("click", () => {
  verlofDagenHandmatig = false;
  vulVerlofDagen();
});
$("medVerlofDagen").addEventListener("input", () => { verlofDagenHandmatig = true; });
$("medBeleid").addEventListener("change", vulVerlofDagen);
$("medUrenWeek").addEventListener("input", vulVerlofDagen);
// Bij het openen van het tabblad opnieuw rekenen: de contracturen kunnen net
// op een ander tabblad zijn aangepast.
document.querySelectorAll(".med-tab").forEach((t) =>
  t.addEventListener("click", () => { if (t.dataset.mtab === "afwezigheid") toonVerlofBerekening(); }));

// Een zelf aangemeld account heeft wel een inlog, maar mag nog niets tot de beheerder het vrijgeeft.
function wachtOpVrijgave(m) { return !!m.auth_user_id && !m.actief; }   // geblokkeerd: bovenaan tonen
function accountBadge(m) {
  if (!m.auth_user_id) return '<span class="badge grijs">nog niet aangemeld</span>';
  if (!m.actief) return '<span class="badge amber">geblokkeerd</span>';
  return '<span class="badge groen">actief</span>';
}
function vrijgeefKnop(m) {
  if (!m.auth_user_id) return "";
  return m.actief
    ? `<button class="btn btn-grijs btn-klein" data-vrijgeef="${m.id}" data-nu="true">Blokkeren</button>`
    : `<button class="btn btn-klein" data-vrijgeef="${m.id}" data-nu="false">Deblokkeren</button>`;
}
async function zetActief(id, aan) {
  const m = _medewerkers.find((x) => x.id === id);
  if (!aan && !confirm(`${m ? m.naam : "Deze medewerker"} blokkeren? Diegene kan dan niet meer inloggen of klokken.`)) return;
  const { error } = await db.from("medewerkers").update({ actief: aan }).eq("id", id);
  if (error) return alert((aan ? "Deblokkeren" : "Blokkeren") + " mislukt: " + error.message);
  await laadMedewerkers();
}
let _medewerkers = [];
async function laadMedewerkers() {
  const { data, error } = await db.from("medewerkers").select("*").is("verwijderd_op", null).order("naam");
  if (error) { $("tbMedewerkers").innerHTML = rijLeeg(8, "Medewerkers laden mislukt: " + error.message); return; }
  // Nieuwe aanmeldingen bovenaan: die wachten op actie van de beheerder.
  _medewerkers = (data || []).sort((a, b) =>
    (wachtOpVrijgave(b) ? 1 : 0) - (wachtOpVrijgave(a) ? 1 : 0) || a.naam.localeCompare(b.naam, "nl"));
  const wacht = _medewerkers.filter(wachtOpVrijgave).length;
  $("telMedewerkers").textContent = _medewerkers.length ? "(" + _medewerkers.length + ")" : "";
  const badge = $("badgeMedewerkers");
  if (badge) { badge.textContent = wacht || ""; badge.classList.toggle("verborgen", wacht === 0); }
  // Zonder geboortedatum kan een monteur zich niet legitimeren, dus verschijnt
  // hij niet in de aanmeldlijst. Dat is stil falen; daarom hier expliciet.
  const zonderDatum = _medewerkers.filter((m) => !m.auth_user_id && !m.geboortedatum);
  const waarschuwing = $("medGeenGeboorte");
  if (waarschuwing) {
    if (zonderDatum.length) {
      waarschuwing.textContent = zonderDatum.length === 1
        ? "1 medewerker heeft nog geen geboortedatum en kan zich daardoor niet aanmelden. Vul die in via Bewerken."
        : zonderDatum.length + " medewerkers hebben nog geen geboortedatum en kunnen zich daardoor niet aanmelden. Vul die in via Bewerken.";
      waarschuwing.classList.remove("verborgen");
    } else waarschuwing.classList.add("verborgen");
  }
  $("tbMedewerkers").innerHTML = _medewerkers.map((m) => {
    const tot = urenWeekTotaal(m.contract_uren);
    const contract = m.contract_type
      ? `<span class="badge grijs">${CONTRACT_LABEL[m.contract_type] || m.contract_type}</span>` +
        (m.contract_eind ? ` <span class="mono" style="font-size:12px;color:var(--grijs)">t/m ${datum(m.contract_eind)}</span>` : "")
      : "—";
    return `<tr><td class="sterk"><button class="naam-knop" data-dossier="${m.id}">${esc(m.naam)}</button></td>
     <td>${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : "—"}</td>
     <td class="mono">${esc(m.mobiel || m.telefoon || "—")}</td>
     <td><span class="badge grijs">${m.rol}</span></td>
     <td>${contract}</td>
     <td class="mono">${tot != null ? urenTekst(tot) : "—"}</td>
     <td class="mono">${m.verlof_dagen_per_jaar != null ? m.verlof_dagen_per_jaar + " dgn" : "—"}</td>
     <td class="mono">${m.geboortedatum ? datum(m.geboortedatum) : "—"}</td>
     <td>${accountBadge(m)}</td>
     <td class="knoprij"><button class="btn btn-klein" data-dossier="${m.id}">Openen</button>${vrijgeefKnop(m)}<button class="btn btn-grijs btn-klein" data-bewerk="${m.id}">Bewerken</button></td></tr>`;
  }).join("") || rijLeeg(10, "Nog geen medewerkers.");
  document.querySelectorAll("[data-bewerk]").forEach((b) => b.addEventListener("click", () => openMedewerker(b.dataset.bewerk)));
  document.querySelectorAll("[data-dossier]").forEach((b) => b.addEventListener("click", () => openDossier(b.dataset.dossier)));
  document.querySelectorAll("[data-vrijgeef]").forEach((b) => b.addEventListener("click", () => zetActief(b.dataset.vrijgeef, b.dataset.nu !== "true")));
}
// ── Medewerkervenster (toevoegen én bewerken) ───────────────────────────────
let medBewerkId = null;   // null = nieuwe medewerker

// Alle eenvoudige velden op één plek: zo kan invullen en uitlezen niet uit de
// pas lopen als er later een veld bijkomt.
const MED_VELDEN = {
  medVoornaam: "voornaam", medTussenvoegsel: "tussenvoegsel", medAchternaam: "achternaam",
  medEmail: "email", medTelefoon: "telefoon", medMobiel: "mobiel", medNoodnummer: "noodnummer",
  medAdres: "adres", medPostcode: "postcode", medPlaats: "plaats",
  medGeboortedatum: "geboortedatum", medGeboorteplaats: "geboorteplaats",
  medNationaliteit: "nationaliteit", medDatumInDienst: "datum_in_dienst",
  medPersoneelsnummer: "personeelsnummer", medRoosternotitie: "roosternotitie",
  medAfdeling: "afdeling", medContractType: "contract_type", medFunctietitel: "functietitel",
  medContractStart: "contract_start", medContractEind: "contract_eind",
  medContractnotitie: "contractnotitie", medRol: "rol",
};
const MED_PRIVE = { medBsn: "bsn", medIdNummer: "id_nummer", medBankrekening: "bankrekening" };
// Onthoudt of het ophalen van de identiteitsgegevens gelukt is. Faalde het, dan
// staan de velden leeg zonder dat "leeg" betekent — en zou opslaan een bestaand
// BSN of bankrekeningnummer met null overschrijven. Er is geen tweede bron.
let priveGeladen = false;
// Lege datums en getallen moeten null worden, geen lege tekst: anders klaagt Postgres.
const MED_DATUMS = new Set(["geboortedatum", "datum_in_dienst", "contract_start", "contract_eind"]);

function toonMedTab(naam) {
  document.querySelectorAll(".med-tab").forEach((t) => t.classList.toggle("actief", t.dataset.mtab === naam));
  document.querySelectorAll("[data-mpaneel]").forEach((p) => p.classList.toggle("verborgen", p.dataset.mpaneel !== naam));
}
document.querySelectorAll(".med-tab").forEach((t) => t.addEventListener("click", () => toonMedTab(t.dataset.mtab)));

function leegMedVenster() {
  Object.keys(MED_VELDEN).forEach((id) => { const e = $(id); if (e) e.value = ""; });
  Object.keys(MED_PRIVE).forEach((id) => { const e = $(id); if (e) e.value = ""; });
  $("medLoonheffing").checked = false;
  $("medUurloon").value = "";
  $("medStartUren").value = "0";
  $("medVerlofDagen").value = "";
  $("medRol").value = "monteur";
  $("medAfdeling").value = "Spaar Electra B.V.";
  $("medBeleid").value = "";
  Object.keys(MED_PRIVE).forEach((id) => { const e = $(id); if (e) e.disabled = false; });
  priveGeladen = true;   // niets om te overschrijven
  $("medSaldo").innerHTML = '<span class="leeg">Zichtbaar zodra de medewerker is opgeslagen.</span>';
  $("medAccountVak").classList.add("verborgen");
  vulSelect("medBeleid", [["", "— geen beleid —"], ..._beleid.map((b) => [b.id, b.naam])]);
  $("medBeleid").value = "";
  vulVormen("");
  bouwUrenWeek("medUrenWeek", null);
  toonVerlofBerekening();
  verberg($("medMelding"));
  toonMedTab("basis");
}

function nieuweMedewerker() {
  medBewerkId = null;
  verlofDagenHandmatig = false;
  leegMedVenster();
  $("medTitel").textContent = "Medewerker toevoegen";
  $("medUitDienst").classList.add("verborgen");
  $("medModal").classList.remove("verborgen");
  $("medVoornaam").focus();
}
$("medNieuw").addEventListener("click", nieuweMedewerker);

async function openMedewerker(id) {
  const m = _medewerkers.find((x) => x.id === id);
  if (!m) return;
  medBewerkId = id;
  leegMedVenster();
  $("medTitel").textContent = "Medewerker — " + m.naam;
  $("medUitDienst").classList.remove("verborgen");
  Object.entries(MED_VELDEN).forEach(([veldId, kolom]) => {
    const e = $(veldId); if (e) e.value = m[kolom] != null ? m[kolom] : "";
  });
  $("medLoonheffing").checked = !!m.loonheffing;
  $("medUurloon").value = m.uurloon != null ? m.uurloon : "";
  vulVormen(m.contractvorm_id);
  $("medBeleid").value = m.beleid_id || "";
  $("medStartUren").value = m.verlof_start_uren != null ? m.verlof_start_uren : 0;
  $("medVerlofDagen").value = m.verlof_dagen_per_jaar != null ? m.verlof_dagen_per_jaar : "";
  if (m.verlof_dagen_per_jaar != null) verlofDagenHandmatig = true;
  // Niet "er staat iets" maar "het wijkt af van de berekening" telt als
  // handmatige keuze. Anders bevriest het getal na de eerste keer opslaan.
  verlofDagenHandmatig = false;
  bouwUrenWeek("medUrenWeek", m.contract_uren);
  toonVerlofBerekening();
  waarschuwAfwijkendVerlof();
  $("medAccountVak").innerHTML = m.auth_user_id
    ? `Account gekoppeld. Status: ${m.actief ? "actief" : "geblokkeerd"}.`
    : "Nog geen account. De medewerker meldt zich aan via de uitnodigingslink.";
  $("medAccountVak").classList.remove("verborgen");
  toonSaldo(m.id);
  laadPrive(m.id);   // bewust niet awaited; laadPrive controleert zelf of het venster nog bij deze medewerker hoort
  $("medModal").classList.remove("verborgen");
}

// Haalt de privégegevens pas op als het venster openstaat: ze staan in een
// aparte tabel die alleen beheerders mogen lezen.
async function laadPrive(id) {
  priveGeladen = false;
  const { data, error } = await db.from("medewerker_privegegevens").select("*").eq("medewerker_id", id).maybeSingle();
  // Het venster kan intussen een andere medewerker tonen: sluit de beheerder
  // Ahmed en opent hij Bilal terwijl deze query nog loopt, dan zou Ahmeds BSN
  // en bankrekening in Bilals formulier belanden — en bij opslaan op zijn naam
  // worden weggeschreven.
  if (id !== medBewerkId) return;
  if (error) {
    Object.keys(MED_PRIVE).forEach((veldId) => { const e = $(veldId); if (e) { e.value = ""; e.disabled = true; } });
    toonMeld($("medMelding"), "fout", "De identiteitsgegevens konden niet worden opgehaald. Ze zijn nu vergrendeld, zodat opslaan ze niet leegmaakt.");
    return;
  }
  priveGeladen = true;
  Object.entries(MED_PRIVE).forEach(([veldId, kolom]) => {
    const e = $(veldId); if (e) { e.disabled = false; e.value = data && data[kolom] != null ? data[kolom] : ""; }
  });
}

function leesMedVelden() {
  const rij = {};
  Object.entries(MED_VELDEN).forEach(([veldId, kolom]) => {
    const e = $(veldId); if (!e) return;
    const w = e.value.trim();
    rij[kolom] = w === "" ? (MED_DATUMS.has(kolom) ? null : null) : w;
  });
  rij.loonheffing = $("medLoonheffing").checked;
  rij.uurloon = $("medUurloon").value === "" ? null : parseFloat($("medUurloon").value);
  rij.beleid_id = $("medBeleid").value || null;
  rij.verlof_start_uren = parseFloat($("medStartUren").value) || 0;
  rij.verlof_dagen_per_jaar = $("medVerlofDagen").value === "" ? null : parseFloat($("medVerlofDagen").value);
  rij.contract_uren = leesUrenWeek("medUrenWeek");
  rij.contractvorm_id = $("medContractvorm").value || null;
  return rij;
}

// Verlofsaldo van deze medewerker tonen in het bewerkvenster
async function toonSaldo(id) {
  const vak = $("medSaldo");
  vak.innerHTML = '<span class="leeg">Saldo berekenen…</span>';
  const { data, error } = await db.rpc("verlofsaldo", { p_medewerker: id });
  if (error || !data) { vak.innerHTML = '<span class="leeg">Saldo niet beschikbaar.</span>'; return; }
  vak.innerHTML = `
    <div class="saldo-rij"><span>Beginsaldo</span><b>${urenTekst(data.startsaldo)}</b></div>
    <div class="saldo-rij"><span>Opgebouwd (${urenTekst(data.gewerkt)} gewerkt × ${Number(data.factor).toFixed(6)})</span><b>${urenTekst(data.opgebouwd)}</b></div>
    <div class="saldo-rij"><span>Opgenomen</span><b>− ${urenTekst(data.opgenomen)}</b></div>
    ${Number(data.aangevraagd) > 0 ? `<div class="saldo-rij"><span>Aangevraagd (nog te beoordelen)</span><b>${urenTekst(data.aangevraagd)}</b></div>` : ""}
    <div class="saldo-rij totaal"><span>Saldo</span><b>${urenTekst(data.saldo)}</b></div>`;
}

function sluitMedModal() { $("medModal").classList.add("verborgen"); }
$("medSluit").addEventListener("click", sluitMedModal);
$("medAnnuleer").addEventListener("click", sluitMedModal);
$("medModal").addEventListener("click", (e) => { if (e.target === $("medModal")) sluitMedModal(); });

$("medOpslaan").addEventListener("click", async () => {
  const rij = leesMedVelden();
  // De naam en de geboortedatum zijn geen vrijblijvende velden: zonder naam
  // klopt het rooster niet, en zonder geboortedatum kan de monteur zich niet
  // legitimeren bij het aanmelden.
  if (!rij.voornaam || !rij.achternaam) { toonMedTab("basis"); return toonMeld($("medMelding"), "fout", "Vul voornaam en achternaam in."); }
  if (!rij.geboortedatum) { toonMedTab("details"); return toonMeld($("medMelding"), "fout", "Vul de geboortedatum in — daarmee meldt de monteur zich aan."); }
  if (!rij.contract_type) { toonMedTab("contract"); return toonMeld($("medMelding"), "fout", "Kies een dienstverband."); }
  // Zonder contractvorm is niet bepaald of iemand op contracturen of op
  // gewerkte uren wordt uitbetaald — dan klopt het loonbedrag niet.
  if (!rij.contractvorm_id) {
    toonMedTab("contract");
    return toonMeld($("medMelding"), "fout", _vormenFout
      ? "De contractvormen konden niet worden geladen (" + _vormenFout + "). Ververs de pagina en probeer opnieuw."
      : "Kies een contractvorm — die bepaalt of er op contracturen of op gewerkte uren wordt uitbetaald.");
  }
  // Zonder contracturen bouwt de medewerker geen verlof op en klopt zijn
  // plus/min niet. Het veld stond als verplicht gemarkeerd maar werd niet
  // gecontroleerd; het enige signaal was een streepje in de tabel.
  if (!rij.contract_uren) { toonMedTab("contract"); return toonMeld($("medMelding"), "fout", "Vul de contracturen per dag in — daarop worden verlofopbouw en plus/min berekend."); }
  if (!rij.beleid_id) { toonMedTab("afwezigheid"); return toonMeld($("medMelding"), "fout", "Kies een afwezigheidsbeleid."); }

  $("medOpslaan").disabled = true;
  try {
    let id = medBewerkId;
    if (id) {
      const { error } = await db.from("medewerkers").update(rij).eq("id", id);
      if (error) return toonMeld($("medMelding"), "fout", "Opslaan mislukt: " + error.message);
    } else {
      const { data, error } = await db.from("medewerkers").insert({ ...rij, actief: true }).select("id").single();
      if (error) return toonMeld($("medMelding"), "fout", "Toevoegen mislukt: " + error.message);
      id = data.id;
    }

    // Privégegevens alleen wegschrijven als er iets is ingevuld of al bestond.
    const prive = {};
    Object.entries(MED_PRIVE).forEach(([veldId, kolom]) => { prive[kolom] = $(veldId).value.trim() || null; });
    // Alleen wegschrijven als we weten wat er stond. Anders zetten we bij een
    // mislukte laadactie het BSN en de bankrekening op leeg.
    // Ook wegschrijven als álles is leeggemaakt: dat is een verwijderverzoek,
    // niet "niets veranderd". Met some() bleef het BSN gewoon staan.
    if (priveGeladen) {
      const { error } = await db.from("medewerker_privegegevens")
        .upsert({ medewerker_id: id, ...prive, bijgewerkt_op: new Date().toISOString() });
      if (error) return toonMeld($("medMelding"), "fout", "Identiteitsgegevens opslaan mislukt: " + error.message);
    }
    sluitMedModal();
    await laadMedewerkers();
    if (mdId && !document.querySelector('[data-view="medewerker"]').classList.contains("verborgen")) openDossier(mdId);
  } finally {
    $("medOpslaan").disabled = false;
  }
});


// ── Uitnodigingslink ────────────────────────────────────────────────────────
//  Eén link voor de hele ploeg: wie hem opent kiest zijn naam en bewijst met
//  zijn geboortedatum dat hij het is. De link verloopt na 30 dagen en kan
//  ingetrokken worden, zodat een doorgestuurde WhatsApp niet eeuwig geldig is.
$("uitnodigLink").addEventListener("click", async () => {
  const vak = $("uitnodigVak");
  vak.classList.remove("verborgen");
  vak.innerHTML = '<span class="leeg">Link ophalen…</span>';

  const { data: bestaand, error: leesFout } = await db.from("uitnodigingen")
    .select("token, verloopt_op").eq("ingetrokken", false).gt("verloopt_op", new Date().toISOString())
    .order("aangemaakt_op", { ascending: false }).limit(1);
  if (leesFout) { vak.innerHTML = "Ophalen mislukt: " + esc(leesFout.message); return; }

  let uit = bestaand && bestaand[0];
  if (!uit) {
    const { data, error } = await db.from("uitnodigingen")
      .insert({ omschrijving: "Aanmelden monteurs" }).select("token, verloopt_op").single();
    if (error) { vak.innerHTML = "Aanmaken mislukt: " + esc(error.message); return; }
    uit = data;
  }

  const link = location.origin + location.pathname.replace(/beheer\.html$/, "") + "aanmelden.html?code=" + uit.token;
  vak.innerHTML = `
    <div class="uitnodig-kop">Uitnodigingslink</div>
    <p>Stuur deze link naar je monteurs. Ze kiezen hun naam, vullen hun geboortedatum in en stellen een wachtwoord in.
       Daarna geef jij ze vrij. Geldig tot ${datum(uit.verloopt_op.slice(0, 10))}.</p>
    <div class="uitnodig-rij">
      <input id="uitnodigVeld" class="mono" readonly value="${esc(link)}">
      <button id="uitnodigKopie" class="btn btn-rood btn-klein">Kopieer</button>
      <button id="uitnodigNieuw" class="btn btn-grijs btn-klein">Nieuwe link</button>
    </div>`;
  $("uitnodigKopie").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      $("uitnodigKopie").textContent = "Gekopieerd";
      setTimeout(() => { $("uitnodigKopie").textContent = "Kopieer"; }, 2000);
    } catch (_) { $("uitnodigVeld").select(); }
  });
  $("uitnodigNieuw").addEventListener("click", async () => {
    if (!confirm("Een nieuwe link maken? De huidige link werkt daarna niet meer.")) return;
    const { error } = await db.from("uitnodigingen").update({ ingetrokken: true }).eq("token", uit.token);
    if (error) return alert("Intrekken mislukt: " + error.message);
    $("uitnodigLink").click();
  });
});

$("medUitDienst").addEventListener("click", async () => {
  const m = _medewerkers.find((x) => x.id === medBewerkId);
  if (!m) return;
  if (!confirm(m.naam + " uit dienst melden?\n\nDe monteur kan dan niet meer inloggen of inklokken. Geregistreerde uren blijven bewaard in de rapportages.")) return;
  const { error } = await db.from("medewerkers").update({ verwijderd_op: new Date().toISOString() }).eq("id", medBewerkId);
  if (error) return toonMeld($("medMelding"), "fout", "Mislukt: " + error.message);
  sluitMedModal();
  await Promise.all([laadMedewerkers(), laadIngeklokt(), laadRooster(), laadVerlof()]);
});

// ── Verlofbeleid en afwezigheidstypes ───────────────────────────────────────
// Zoekt het type bij een code, zodat pictogram en kleur overal gelijk zijn.
function typeVanCode(code) {
  return _types.find((t) => t.code === code) || { code, naam: SOORT_LABEL[code] || code, kleur: "#6d635f" };
}
// Naam met pictogram ervoor, in de kleur van het type.
function typeLabel(code) {
  const t = typeVanCode(code);
  return `<span class="afw-label">${icoon(t, { kleur: t.kleur })}${esc(t.naam)}</span>`;
}
let _beleid = [], _types = [], _beleidTypes = [];

async function laadBeleid() {
  const [b, t, bt, m] = await Promise.all([
    db.from("afwezigheid_beleid").select("*").order("naam"),
    db.from("afwezigheid_types").select("*").order("volgorde"),
    db.from("beleid_types").select("*"),
    db.from("medewerkers").select("id, beleid_id").is("verwijderd_op", null),
  ]);
  if (b.error) { $("tbBeleid").innerHTML = rijLeeg(6, "Kon het beleid niet laden: " + b.error.message); return; }
  _beleid = b.data || []; _types = t.data || []; _beleidTypes = bt.data || [];
  const tel = (id) => (m.data || []).filter((x) => x.beleid_id === id).length;

  $("tbBeleid").innerHTML = _beleid.map((x) => {
    const aantalTypes = _beleidTypes.filter((k) => k.beleid_id === x.id).length;
    return `<tr${x.actief ? "" : ' class="rij-verwerkt"'}>
      <td class="sterk">${esc(x.naam)}</td>
      <td><input type="number" step="0.000000001" min="0" value="${x.opbouw_per_uur}"
            data-factor="${x.id}" style="width:150px" class="mono"></td>
      <td class="mono">${urenTekst(Number(x.opbouw_per_uur) * 2080)}</td>
      <td class="mono">${tel(x.id)}</td>
      <td class="mono">${aantalTypes} van ${_types.length}</td>
      <td style="white-space:nowrap"><button class="btn btn-grijs btn-klein" data-beleid-del="${x.id}">Verwijder</button></td>
    </tr>`;
  }).join("") || rijLeeg(6, "Nog geen beleid.");

  // Kolomkoppen van de typetabel = de beleidsnamen
  $("kopBeleid1").textContent = _beleid[0]?.naam || "";
  $("kopBeleid2").textContent = _beleid[1]?.naam || "";

  $("tbTypes").innerHTML = _types.map((ty) => {
    const vink = (bId) => bId
      ? `<input type="checkbox" data-bt-beleid="${bId}" data-bt-type="${ty.id}"
           ${_beleidTypes.some((k) => k.beleid_id === bId && k.type_id === ty.id) ? "checked" : ""}>`
      : "";
    return `<tr${ty.actief ? "" : ' class="rij-verwerkt"'}>
      <td><span class="afw-ico-vak" style="color:${ty.kleur};background:${ty.kleur}1a">${icoon(ty, { maat: 18 })}</span></td>
      <td class="sterk">${esc(ty.naam)}</td>
      <td><select class="mini-select" data-type-icoon="${ty.id}">${
        ICOON_KEUZE.map(([k, n]) => `<option value="${k}"${(ty.icoon || "kalender") === k ? " selected" : ""}>${n}</option>`).join("")
      }</select></td>
      <td>${ty.gaat_van_saldo ? '<span class="badge amber">van saldo</span>' : '<span class="badge grijs">nee</span>'}</td>
      <td><input type="checkbox" data-type-actief="${ty.id}" ${ty.actief ? "checked" : ""}></td>
      <td class="kies-cel">${vink(_beleid[0]?.id)}</td>
      <td class="kies-cel">${vink(_beleid[1]?.id)}</td>
    </tr>`;
  }).join("") || rijLeeg(7, "Nog geen types.");

  // Opbouwfactor aanpassen
  document.querySelectorAll("[data-factor]").forEach((i) => i.addEventListener("change", async () => {
    const { error } = await db.from("afwezigheid_beleid")
      .update({ opbouw_per_uur: parseFloat(i.value) || 0 }).eq("id", i.dataset.factor);
    if (error) return toonMeld($("beleidMelding"), "fout", "Mislukt: " + error.message);
    toonMeld($("beleidMelding"), "ok", "Opbouw aangepast.");
    laadBeleid();
  }));
  // Type aan/uit per beleid
  document.querySelectorAll("[data-bt-beleid]").forEach((c) => c.addEventListener("change", async () => {
    const sleutel = { beleid_id: c.dataset.btBeleid, type_id: c.dataset.btType };
    const { error } = c.checked
      ? await db.from("beleid_types").insert(sleutel)
      : await db.from("beleid_types").delete().match(sleutel);
    if (error) { c.checked = !c.checked; return toonMeld($("beleidMelding"), "fout", "Mislukt: " + error.message); }
    laadBeleid();
  }));
  // Type helemaal aan/uit
  document.querySelectorAll("[data-type-icoon]").forEach((sel) => sel.addEventListener("change", async () => {
    const { error } = await db.from("afwezigheid_types").update({ icoon: sel.value }).eq("id", sel.dataset.typeIcoon);
    if (error) return toonMeld($("beleidMelding"), "fout", "Pictogram opslaan mislukt: " + error.message);
    laadBeleid();
  }));
  document.querySelectorAll("[data-type-actief]").forEach((c) => c.addEventListener("change", async () => {
    const { error } = await db.from("afwezigheid_types").update({ actief: c.checked }).eq("id", c.dataset.typeActief);
    if (error) { c.checked = !c.checked; return toonMeld($("beleidMelding"), "fout", "Mislukt: " + error.message); }
    laadBeleid(); laadVerlof();
  }));
  document.querySelectorAll("[data-beleid-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Dit beleid verwijderen? Medewerkers die eraan gekoppeld zijn houden geen beleid over.")) return;
    const { error } = await db.from("afwezigheid_beleid").delete().eq("id", b.dataset.beleidDel);
    if (error) return toonMeld($("beleidMelding"), "fout", "Mislukt: " + error.message);
    laadBeleid();
  }));
}
$("blToevoegen").addEventListener("click", async () => {
  const naam = $("blNaam").value.trim();
  if (!naam) return toonMeld($("beleidMelding"), "fout", "Geef het beleid een naam.");
  const { error } = await db.from("afwezigheid_beleid")
    .insert({ naam, opbouw_per_uur: parseFloat($("blFactor").value) || 0 });
  if (error) return toonMeld($("beleidMelding"), "fout", "Mislukt: " + error.message);
  $("blNaam").value = "";
  toonMeld($("beleidMelding"), "ok", `Beleid "${naam}" toegevoegd.`);
  laadBeleid();
});

// ── Pauzetijden ─────────────────────────────────────────────────────────────
async function laadPauzes() {
  const { data, error } = await db.from("pauze_instellingen").select("*").order("van_tijd");
  if (error) { $("tbPauzes").innerHTML = rijLeeg(7, "Kon de pauzes niet laden: " + error.message); return; }
  $("tbPauzes").innerHTML = (data || []).map((p) => {
    const min = Math.round((new Date("2000-01-01T" + p.tot_tijd) - new Date("2000-01-01T" + p.van_tijd)) / 60000);
    return `<tr${p.actief ? "" : ' class="rij-verwerkt"'}>
      <td class="mono sterk">${p.van_tijd.slice(0, 5)}</td>
      <td class="mono sterk">${p.tot_tijd.slice(0, 5)}</td>
      <td class="mono">${min} min</td>
      <td>${p.betaald ? '<span class="badge groen">betaald</span>' : '<span class="badge grijs">onbetaald</span>'}</td>
      <td>${esc(p.omschrijving || "")}</td>
      <td>${p.actief ? '<span class="badge groen">aan</span>' : '<span class="badge grijs">uit</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-grijs btn-klein" data-pauze-aan="${p.id}" data-nu="${p.actief}">${p.actief ? "Uitzetten" : "Aanzetten"}</button>
        <button class="btn btn-grijs btn-klein" data-pauze-del="${p.id}">Verwijder</button>
      </td></tr>`;
  }).join("") || rijLeeg(7, "Nog geen pauzetijden — er wordt dan niets afgetrokken.");

  document.querySelectorAll("[data-pauze-aan]").forEach((b) => b.addEventListener("click", async () => {
    const { error } = await db.from("pauze_instellingen")
      .update({ actief: b.dataset.nu !== "true" }).eq("id", b.dataset.pauzeAan);
    if (error) return toonMeld($("pauzeMelding"), "fout", "Mislukt: " + error.message);
    laadPauzes();
  }));
  document.querySelectorAll("[data-pauze-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Deze pauze verwijderen? Nieuwe registraties worden dan niet meer met deze pauze gecorrigeerd.")) return;
    const { error } = await db.from("pauze_instellingen").delete().eq("id", b.dataset.pauzeDel);
    if (error) return toonMeld($("pauzeMelding"), "fout", "Mislukt: " + error.message);
    laadPauzes();
  }));
}
$("pzToevoegen").addEventListener("click", async () => {
  const van = $("pzVan").value, tot = $("pzTot").value;
  const meld = $("pauzeMelding");
  if (!van || !tot) return toonMeld(meld, "fout", "Vul een begin- en eindtijd in.");
  if (tot <= van) return toonMeld(meld, "fout", "De eindtijd moet na de begintijd liggen.");
  const { error } = await db.from("pauze_instellingen").insert({
    van_tijd: van, tot_tijd: tot,
    betaald: $("pzSoort").value === "betaald",
    omschrijving: $("pzOms").value.trim() || null,
  });
  if (error) return toonMeld(meld, "fout", "Mislukt: " + error.message);
  $("pzOms").value = "";
  toonMeld(meld, "ok", `Pauze ${van} - ${tot} toegevoegd.`);
  laadPauzes();
});

// ── Rooster (weekplanning) ───────────────────────────────────────────────────
let weekStart = maandagVan(new Date());
let _weekAfwezig = [];   // verlof in de getoonde week

function maandagVan(d) {
  const x = new Date(d); const dag = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dag); x.setHours(0, 0, 0, 0);
  return x;
}
function isoDatum(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const DAGEN = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const DAGDEEL_LABEL = { hele_dag: "hele dag", ochtend: "ochtend", middag: "middag" };

async function laadRooster() {
  const [{ data: mws }, { data: prj }] = await Promise.all([
    db.from("medewerkers").select("id, naam").eq("rol", "monteur").is("verwijderd_op", null).order("naam"),
    db.from("projecten").select("id, werkbon, naam, kleur").is("verwijderd_op", null).neq("status", "afgerond").order("naam"),
  ]);
  vulSelect("rMedewerker", (mws || []).map((m) => [m.id, m.naam]));
  vulSelect("rProject", (prj || []).map((p) => [p.id, (p.werkbon ? p.werkbon + " · " : "") + p.naam]));
  if (!$("rDatum").value) $("rDatum").value = isoDatum(new Date());
  await tekenWeek(mws || []);
}

async function tekenWeek(mws) {
  if (!mws) {
    const { data } = await db.from("medewerkers").select("id, naam").eq("rol", "monteur").is("verwijderd_op", null).order("naam");
    mws = data || [];
  }
  const van = isoDatum(weekStart);
  const totD = new Date(weekStart); totD.setDate(totD.getDate() + 6);
  const tot = isoDatum(totD);
  $("rWeekLabel").textContent = van.slice(8) + "/" + van.slice(5, 7) + " – " + tot.slice(8) + "/" + tot.slice(5, 7);
  $("rWeekNr").textContent = "Week " + weeknummer(weekStart);

  // Rooster én afwezigheid ophalen: iemand die vrij is mag je niet inplannen.
  const [{ data: plan }, { data: afw }] = await Promise.all([
    db.from("planning")
      .select("id, medewerker_id, datum, dagdeel, start_tijd, eind_tijd, projecten(id, werkbon, naam, kleur)")
      .gte("datum", van).lte("datum", tot).is("verwijderd_op", null),
    db.from("afwezigheid")
      .select("medewerker_id, soort, van_datum, tot_datum, status")
      .lte("van_datum", tot).gte("tot_datum", van).is("verwijderd_op", null).neq("status", "afgekeurd"),
  ]);
  _weekAfwezig = afw || [];

  const dagen = [...Array(7)].map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const vandaag = isoDatum(new Date());
  const MAAND = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

  document.querySelector("#rGrid thead").innerHTML =
    `<tr><th class="r-naamkop">Monteur</th>` + dagen.map((d, i) => {
      const dat = isoDatum(d);
      return `<th class="r-dagkop${i >= 5 ? " weekend" : ""}${dat === vandaag ? " vandaag" : ""}">
        <span class="r-dagnaam">${DAGEN[i]}</span>
        <span class="r-dagnr">${d.getDate()} ${MAAND[d.getMonth()]}</span></th>`;
    }).join("") + "</tr>";

  const perCel = {};
  (plan || []).forEach((p) => {
    const k = p.medewerker_id + "|" + p.datum;
    (perCel[k] = perCel[k] || []).push(p);
  });

  document.querySelector("#rGrid tbody").innerHTML = mws.map((m) => {
    const cellen = dagen.map((d, i) => {
      const dat = isoDatum(d);
      const klas = "r-cel" + (i >= 5 ? " weekend" : "") + (dat === vandaag ? " vandaag" : "");
      const blokken = (perCel[m.id + "|" + dat] || []).map((p) => {
        const naam = p.projecten?.naam || "";
        const code = p.projecten?.werkbon || "";
        const tijden = p.start_tijd
          ? kortTijd(p.start_tijd) + " - " + kortTijd(p.eind_tijd)
          : (DAGDEEL_LABEL[p.dagdeel] || p.dagdeel);
        return `<span class="r-blok" style="border-left-color:${kleurVan(p.projecten)}" title="${esc((code ? code + " " : "") + naam)} — ${tijden}">
          <span class="r-blok-tekst">
            <span class="r-code">${esc(code)}${code && naam ? " " : ""}${esc(naam)}</span>
            <span class="r-tijd">${tijden}</span>
          </span>
          <button class="r-weg" data-plan-del="${p.id}" title="Uit het rooster halen" aria-label="Verwijderen">&times;</button></span>`;
      }).join("");
      // Verlof/afwezigheid als volle balk, net als in Shiftbase
      const vrij = _weekAfwezig.filter((a) => a.medewerker_id === m.id && dat >= a.van_datum && dat <= a.tot_datum);
      const vrijBlok = vrij.map((a) => {
        const t = typeVanCode(a.soort);
        const wacht = a.status === "onbeslist";
        return `<span class="r-vrij${wacht ? " wacht" : ""}" style="background:${t.kleur}1f;border-color:${t.kleur};color:${t.kleur}"
          title="${esc(t.naam)}${wacht ? " (nog niet goedgekeurd)" : ""}">${icoon(t, { maat: 13 })}<span class="r-vrij-tekst">${esc(t.naam)}</span>${wacht ? "<b>?</b>" : ""}</span>`;
      }).join("");
      return `<td class="${klas}">${vrijBlok}${blokken}</td>`;
    }).join("");
    return `<tr><td class="r-naam" title="${esc(m.naam)}"><div class="r-naam-binnen">
      <span class="r-avatar">${esc(initialen(m.naam))}</span>
      <span class="r-naamtekst">${esc(m.naam)}</span></div></td>${cellen}</tr>`;
  }).join("") || rijLeeg(8, "Nog geen monteurs.");

  document.querySelectorAll("[data-plan-del]").forEach((b) => b.addEventListener("click", async () => {
    const { error } = await db.from("planning").update({ verwijderd_op: new Date().toISOString() }).eq("id", b.dataset.planDel);
    if (error) return alert("Uit het rooster halen mislukt: " + error.message);
    tekenWeek();
  }));
}

// Hulpjes voor het rooster
function kortTijd(t) { return t ? String(t).slice(0, 5) : ""; }
function initialen(naam) {
  const d = String(naam || "").trim().split(/\s+/).filter(Boolean);
  return ((d[0]?.[0] || "") + (d.length > 1 ? d[d.length - 1][0] : "")).toUpperCase();
}
function weeknummer(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const jaarStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil((((x - jaarStart) / 86400000) + 1) / 7);
}

// Dagdeel kiezen vult de standaardtijden in (aan te passen)
const DAGDEEL_TIJDEN = { hele_dag: ["07:00", "16:00"], ochtend: ["07:00", "12:00"], middag: ["12:30", "16:00"] };
$("rDagdeel").addEventListener("change", () => {
  const t = DAGDEEL_TIJDEN[$("rDagdeel").value];
  if (t) { $("rStart").value = t[0]; $("rEind").value = t[1]; }
});

$("rInplannen").addEventListener("click", async () => {
  const knop = $("rInplannen"), melding = $("rPlanMelding");
  const medewerker_id = $("rMedewerker").value, project_id = $("rProject").value;
  const dagdeel = $("rDagdeel").value;
  const van = $("rDatum").value;
  // Leeg laten betekent één dag; zo blijft het gedrag hetzelfde voor wie geen
  // periode nodig heeft.
  const tot = $("rTotDatum").value || van;
  if (!medewerker_id || !project_id || !van) return toonMeld(melding, "fout", "Kies monteur, datum en werkbon.");
  if (tot < van) return toonMeld(melding, "fout", "De einddatum ligt voor de begindatum.");

  const alleenWerkdagen = $("rAlleenWerkdagen").checked;
  const dagen = [];
  for (const d = new Date(van + "T12:00:00"); isoDatum(d) <= tot; d.setDate(d.getDate() + 1)) {
    const iso = isoDatum(d);
    if (alleenWerkdagen && (d.getDay() === 0 || d.getDay() === 6)) continue;
    if (alleenWerkdagen && feestdagen(d.getFullYear()).has(iso)) continue;
    dagen.push(iso);
  }
  if (!dagen.length) return toonMeld(melding, "fout", "Er zitten geen werkdagen in deze periode.");
  if (dagen.length > 200) return toonMeld(melding, "fout", "Dat zijn meer dan 200 dagen; kies een kortere periode.");

  const naam = $("rMedewerker").selectedOptions[0]?.textContent || "Deze monteur";

  // Alles vooraf ophalen in plaats van per dag te bevragen: bij een periode van
  // een maand scheelt dat tientallen aanroepen, en de beheerder krijgt één
  // duidelijke vraag in plaats van twintig losse bevestigingen.
  const [{ data: bestaand, error: bf }, { data: vrij, error: vf }] = await Promise.all([
    db.from("planning").select("datum")
      .eq("medewerker_id", medewerker_id).eq("project_id", project_id)
      .gte("datum", van).lte("datum", tot).is("verwijderd_op", null),
    db.from("afwezigheid").select("soort, van_datum, tot_datum")
      .eq("medewerker_id", medewerker_id).lte("van_datum", tot).gte("tot_datum", van)
      .is("verwijderd_op", null).neq("status", "afgekeurd"),
  ]);
  if (bf || vf) return toonMeld(melding, "fout", "Controleren mislukt: " + (bf || vf).message);

  const alGepland = new Set((bestaand || []).map((p) => p.datum));
  const vrijeDagen = dagen.filter((d) => (vrij || []).some((a) => d >= a.van_datum && d <= a.tot_datum));
  const teDoen = dagen.filter((d) => !alGepland.has(d));

  if (!teDoen.length) return toonMeld(melding, "fout", naam + " staat op al deze dagen al op deze werkbon.");
  if (vrijeDagen.length) {
    const soort = typeVanCode((vrij[0] || {}).soort).naam.toLowerCase();
    if (!confirm(`${naam} heeft ${vrijeDagen.length} ${vrijeDagen.length === 1 ? "dag" : "dagen"} in deze periode ${soort}.\n\nToch de hele periode inplannen?`)) return;
  }

  knop.disabled = true;
  try {
    const { error } = await db.from("planning").insert(teDoen.map((datum) => ({
      medewerker_id, project_id, datum, dagdeel,
      start_tijd: $("rStart").value || null, eind_tijd: $("rEind").value || null,
    })));
    if (error) return toonMeld(melding, "fout", "Inplannen mislukt: " + error.message);

    const overgeslagen = dagen.length - teDoen.length;
    toonMeld(melding, "ok", teDoen.length + (teDoen.length === 1 ? " dag ingepland" : " dagen ingepland")
      + (overgeslagen ? ", " + overgeslagen + " overgeslagen omdat die al gepland stonden" : "") + ".");
    weekStart = maandagVan(new Date(van + "T12:00:00"));
    await Promise.all([tekenWeek(), laadVerlof()]);
  } finally {
    knop.disabled = false;
  }
});
// Einddatum meelopen met de begindatum, zodat één dag inplannen niets extra's vraagt.
$("rDatum").addEventListener("change", () => {
  if (!$("rTotDatum").value || $("rTotDatum").value < $("rDatum").value) $("rTotDatum").value = $("rDatum").value;
});
$("rVorige").addEventListener("click", () => { weekStart.setDate(weekStart.getDate() - 7); tekenWeek(); });
$("rVolgende").addEventListener("click", () => { weekStart.setDate(weekStart.getDate() + 7); tekenWeek(); });

// ── Rapportages ──────────────────────────────────────────────────────────────
let _rapMonteur = [];
let _rapPeriode = "";                 // periode waarvoor de cijfers zijn berekend
const komma = (n) => Number(n || 0).toFixed(2).replace(".", ",");
// Uren exact opslaan in decimalen, maar tonen als "2 u 16 min"
function urenUitMinuten(min) { return Math.round((Math.max(0, min) / 60) * 100) / 100; }
function urenTekst(u) {
  const totaal = Math.round((Number(u) || 0) * 60);
  const h = Math.floor(totaal / 60), m = totaal % 60;
  if (!h && !m) return "0 min";
  if (!h) return m + " min";
  if (!m) return h + " u";
  return h + " u " + m + " min";
} // Excel-NL leest zo als getal
function standaardPeriode() {
  const nu = new Date();
  const eerste = new Date(nu.getFullYear(), nu.getMonth(), 1);
  const laatste = new Date(nu.getFullYear(), nu.getMonth() + 1, 0);
  $("rapVan").value = isoDatum(eerste);
  $("rapTot").value = isoDatum(laatste);
}
document.querySelectorAll(".rap-snel").forEach((b) => b.addEventListener("click", () => {
  const nu = new Date();
  let van, tot;
  if (b.dataset.snel === "week") { van = maandagVan(nu); tot = new Date(van); tot.setDate(tot.getDate() + 6); }
  else if (b.dataset.snel === "maand") { van = new Date(nu.getFullYear(), nu.getMonth(), 1); tot = new Date(nu.getFullYear(), nu.getMonth() + 1, 0); }
  else { van = new Date(nu.getFullYear(), nu.getMonth() - 1, 1); tot = new Date(nu.getFullYear(), nu.getMonth(), 0); }
  $("rapVan").value = isoDatum(van); $("rapTot").value = isoDatum(tot);
  toonRapport();
}));
$("rapToon").addEventListener("click", toonRapport);


// ── Contractvormen en uitbetaling ───────────────────────────────────────────
//  Het verschil dat Spaar Electra in Shiftbase hanteert: vast personeel krijgt
//  contracturen betaald met het verschil in een plus/min-bank, ZZP krijgt wat
//  er geklokt is. Wij behandelden iedereen als "gewerkte uren", wat voor vast
//  personeel het verkeerde bedrag oplevert.
let _vormen = [];
let _vormenFout = null;
async function laadVormen() {
  const { data, error } = await db.from("contractvormen").select("*").order("naam");
  if (error) {
    // Zonder deze lijst valt er niets te kiezen, en blokkeert de controle bij
    // opslaan élke medewerker — ook een adreswijziging. Dat moet zichtbaar zijn.
    _vormenFout = error.message;
    return;
  }
  _vormenFout = null;
  _vormen = data || [];
}
function vulVormen(huidig) {
  vulSelect("medContractvorm", [["", "— kies —"], ..._vormen.map((v) => [v.id, v.naam])]);
  $("medContractvorm").value = huidig || "";
  toonVormUitleg();
}
function toonVormUitleg() {
  const v = _vormen.find((x) => x.id === $("medContractvorm").value);
  const vak = $("medVormUitleg");
  if (!vak) return;
  if (!v) { vak.textContent = ""; return; }
  const stukken = [
    v.uitbetalingsbasis === "contract" ? "wordt uitbetaald op contracturen" : "wordt uitbetaald op gewerkte uren",
    v.plusmin ? "houdt plus/min bij" : "geen plus/min",
  ];
  if (v.overwerk_na_uren) {
    stukken.push("overwerk na " + netGetal(v.overwerk_na_uren) + " u per dag naar "
      + (v.overwerk_naar === "plusmin" ? "plus/min" : "uitbetaling"));
  }
  vak.textContent = stukken.join(" · ") + ".";
}
$("medContractvorm").addEventListener("change", toonVormUitleg);

let _uitbetaling = [];
async function toonUitbetaling(van, tot) {
  const { data, error } = await db.rpc("uitbetaling", { p_van: van, p_tot: tot });
  if (error) {
    _uitbetaling = [];
    $("tbUitbetaling").innerHTML = rijLeeg(11, "Kon de uitbetaling niet berekenen: " + error.message);
    return;
  }
  _uitbetaling = data || [];
  $("tbUitbetaling").innerHTML = _uitbetaling.map((r) => {
    const pm = Number(r.plusmin_uren) || 0;
    return `<tr${r.waarschuwing ? ' class="rij-let-op"' : ""}>
      <td class="sterk">${esc(r.naam)}${r.waarschuwing ? `<div class="rij-uitleg">${esc(r.waarschuwing)}</div>` : ""}</td>
      <td><span class="badge grijs">${esc(r.contractvorm)}</span></td>
      <td class="mono">${urenTekst(r.gewerkt_uren)}</td>
      <td class="mono">${Number(r.verlof_uren) ? urenTekst(r.verlof_uren) : "—"}</td>
      <td class="mono">${urenTekst(r.contract_uren)}</td>
      <td class="mono sterk">${urenTekst(r.uit_te_betalen)}</td>
      <td class="mono" style="color:${pm < 0 ? "var(--rood-donker)" : pm > 0 ? "var(--groen)" : "inherit"}">${pm ? (pm > 0 ? "+" : "\u2212") + urenTekst(Math.abs(pm)) : "—"}</td>
      <td class="mono">${Number(r.overwerk_uren) ? urenTekst(r.overwerk_uren) : "—"}</td>
      <td class="mono">${Number(r.open_uren) ? `<span class="badge amber">${urenTekst(r.open_uren)}</span>` : "—"}</td>
      <td class="mono">${r.uurloon != null ? "\u20ac " + komma(r.uurloon) : "—"}</td>
      <td class="mono sterk">${r.uurloon != null ? "\u20ac " + komma(r.bedrag) : "—"}</td>
    </tr>`;
  }).join("") || rijLeeg(11, "Geen uitbetaling in deze periode.");

  const letOp = _uitbetaling.filter((r) => r.waarschuwing).length;
  const melding = $("uitbMelding");
  if (letOp) {
    toonMeld(melding, "fout", letOp + (letOp === 1 ? " regel vraagt" : " regels vragen")
      + " aandacht voordat je uitbetaalt — zie de toelichting onder de naam.");
  } else verberg(melding);
}

$("uitbExport").addEventListener("click", () => {
  if (!_uitbetaling.length) return alert("Er is nog niets om te exporteren.");
  csvDownload(
    ["Monteur", "Medewerker-id", "Contractvorm", "Basis", "Gewerkte uren", "Verlofuren",
     "Contracturen", "Uit te betalen uren", "Plus/min uren", "Overwerk uren",
     "Nog te beoordelen", "Uurloon", "Bedrag", "Let op"],
    _uitbetaling.map((r) => [r.naam, r.medewerker_id, r.contractvorm, r.basis,
      komma(r.gewerkt_uren), komma(r.verlof_uren), komma(r.contract_uren), komma(r.uit_te_betalen),
      komma(r.plusmin_uren), komma(r.overwerk_uren), komma(r.open_uren),
      r.uurloon != null ? komma(r.uurloon) : "", r.uurloon != null ? komma(r.bedrag) : "",
      r.waarschuwing || ""]),
    "uitbetaling-" + _rapPeriode);
});

async function toonRapport() {
  const van = $("rapVan").value, tot = $("rapTot").value;
  if (!van || !tot) return;
  _rapPeriode = van + "_" + tot;      // vastleggen zodat de CSV-naam bij de cijfers hoort
  toonUitbetaling(van, tot);
  // Dit scherm voedt de loonrun. Een mislukte query mag hier nooit als
  // "niemand heeft gewerkt" op het scherm komen — en in pagina's ophalen,
  // want een kwartaal loopt makkelijk over de duizend regels.
  const [{ data: uren, error: urenFout }, { data: afw, error: afwFout }] = await Promise.all([
    // afgekeurde regels tellen niet mee in de rapportage
    haalAlles((a, b) => db.from("urenregels").select("datum, uren, km, status, medewerker_id, medewerkers!medewerker_id(naam), projecten(werkbon, naam)")
      .is("verwijderd_op", null).neq("status", "afgekeurd").gte("datum", van).lte("datum", tot)
      .order("datum").order("id").range(a, b)),
    haalAlles((a, b) => db.from("afwezigheid").select("van_datum, tot_datum, soort, medewerker_id, medewerkers!medewerker_id(naam)")
      .is("verwijderd_op", null).eq("status", "goedgekeurd").lte("van_datum", tot).gte("tot_datum", van)
      .order("van_datum").order("id").range(a, b)),
  ]);
  if (urenFout || afwFout) {
    const m = (urenFout || afwFout).message;
    // Alles leegmaken: anders blijven de cijfers van de vórige periode staan
    // terwijl _rapPeriode al de nieuwe naam draagt — en exporteert de beheerder
    // juni-uren in een bestand dat "derde kwartaal" heet.
    _rapMonteur = []; _uitbetaling = [];
    $("tbRapMonteur").innerHTML = rijLeeg(8, "De rapportage kon niet worden opgehaald: " + m);
    $("tbRapProject").innerHTML = rijLeeg(3, "—");
    $("tbUitbetaling").innerHTML = rijLeeg(11, "—");
    if ($("rapWaarschuwing")) {
      $("rapWaarschuwing").textContent = "Let op: deze cijfers zijn NIET compleet — het ophalen is mislukt (" + m + ").";
      $("rapWaarschuwing").className = "melding fout";
    }
    return;
  }

  // Per monteur — groeperen op id (niet op naam: naamgenoten mogen niet samenvallen)
  const perM = {};
  const nieuw = (id, naam) => ({ id, naam, dagen: new Set(), uren: 0, open: 0, km: 0, vakantie: 0, ziek: 0, overig: 0 });
  (uren || []).forEach((u) => {
    const id = u.medewerker_id;
    perM[id] = perM[id] || nieuw(id, u.medewerkers?.naam || "onbekend");
    perM[id].dagen.add(u.datum);
    perM[id].uren += Number(u.uren) || 0;
    if (u.status === "onbeslist") perM[id].open += Number(u.uren) || 0;
    perM[id].km += Number(u.km) || 0;
  });
  (afw || []).forEach((a) => {
    const id = a.medewerker_id;
    perM[id] = perM[id] || nieuw(id, a.medewerkers?.naam || "onbekend");
    const d = overlapDagen(a.van_datum, a.tot_datum, van, tot);
    if (a.soort === "vakantie") perM[id].vakantie += d;
    else if (a.soort === "ziek") perM[id].ziek += d;
    else perM[id].overig += d;
  });
  _rapMonteur = Object.values(perM).sort((a, b) => a.naam.localeCompare(b.naam));
  const openTotaal = _rapMonteur.reduce((s, m) => s + m.open, 0);
  const dv = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  $("rapPeriodeTekst").textContent = `${dv(van)} t/m ${dv(tot)} — ${_rapMonteur.length} ${_rapMonteur.length === 1 ? "monteur" : "monteurs"} met registraties`;
  $("rapWaarschuwing").textContent = openTotaal > 0
    ? `Let op: ${urenTekst(openTotaal)} is nog niet goedgekeurd en telt wel mee in deze cijfers.` : "";
  $("rapWaarschuwing").classList.toggle("verborgen", openTotaal === 0);
  $("tbRapMonteur").innerHTML = _rapMonteur.length ? _rapMonteur.map((m) =>
    `<tr><td class="sterk">${esc(m.naam)}</td><td class="mono">${m.dagen.size}</td>
     <td class="sterk mono">${urenTekst(m.uren)}</td>
     <td class="mono">${m.open > 0 ? urenTekst(m.open) : "—"}</td>
     <td class="mono">${m.km || 0}</td>
     <td class="mono">${m.vakantie || 0}</td><td class="mono">${m.ziek || 0}</td>
     <td class="mono">${m.overig || 0}</td></tr>`).join("") : rijLeeg(8, "Geen gegevens in deze periode.");

  // Per werkbon
  const perP = {};
  (uren || []).forEach((u) => {
    const key = (u.projecten?.werkbon || "—") + "|" + (u.projecten?.naam || "");
    perP[key] = perP[key] || { werkbon: u.projecten?.werkbon || "—", naam: u.projecten?.naam || "", uren: 0 };
    perP[key].uren += Number(u.uren) || 0;
  });
  const projRijen = Object.values(perP).sort((a, b) => b.uren - a.uren);
  $("tbRapProject").innerHTML = projRijen.length ? projRijen.map((p) =>
    `<tr><td class="mono sterk">${esc(p.werkbon)}</td><td>${esc(p.naam)}</td><td class="sterk mono">${urenTekst(p.uren)}</td></tr>`).join("") : rijLeeg(3, "Geen gegevens in deze periode.");
}
$("rapExportMonteur").addEventListener("click", () => {
  if (!_rapMonteur.length) return alert("Toon eerst een overzicht.");
  const rijen = _rapMonteur.map((m) => [
    m.naam, m.id, m.dagen.size, komma(m.uren), urenTekst(m.uren), komma(m.open), m.km || 0,
    m.vakantie || 0, m.ziek || 0, m.overig || 0,
  ]);
  csvDownload(["Monteur", "Medewerker-id", "Dagen gewerkt", "Uren (decimaal)", "Uren", "Nog te keuren", "Km", "Vakantiedagen", "Ziektedagen", "Overig verlof"],
    rijen, "rapport-" + _rapPeriode);
});

// ── Kaart-kiezer (Leaflet) ───────────────────────────────────────────────────
let locMap = null, locMarker = null, locCirkel = null, locProjectId = null, locModus = "bestaand";
const AMS = [52.3676, 4.9041];

function openLocatieKiezer(p) {
  locModus = p.modus === "nieuw" ? "nieuw" : "bestaand";
  locProjectId = p.id || null;
  $("locTitel").textContent = "Locatie — " + (p.naam || "");
  $("locAdres").value = p.adres || "";
  $("locRadius").value = p.radius_m || 250;
  verberg($("locMelding"));
  $("locModal").classList.remove("verborgen");

  const heeftPunt = p.lat != null && p.lng != null && !isNaN(p.lat) && !isNaN(p.lng);
  const start = heeftPunt ? [p.lat, p.lng] : AMS;
  if (!locMap) {
    locMap = L.map("locKaart");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(locMap);
    locMap.on("click", (e) => zetSpeld(e.latlng.lat, e.latlng.lng, false));
  }
  locMap.setView(start, heeftPunt ? 16 : 12);
  if (heeftPunt) zetSpeld(p.lat, p.lng, false);
  else if (locMarker) { locMap.removeLayer(locMarker); locMap.removeLayer(locCirkel); locMarker = null; locCirkel = null; }
  setTimeout(() => locMap.invalidateSize(), 60);
}
function zetSpeld(lat, lng, herschik) {
  if (!locMarker) {
    locMarker = L.marker([lat, lng], { draggable: true }).addTo(locMap);
    locCirkel = L.circle([lat, lng], { radius: radiusNu(), color: "#e10410", weight: 1, fillColor: "#e10410", fillOpacity: .12 }).addTo(locMap);
    locMarker.on("drag", (e) => locCirkel.setLatLng(e.target.getLatLng()));
  } else { locMarker.setLatLng([lat, lng]); locCirkel.setLatLng([lat, lng]); }
  if (herschik) locMap.setView([lat, lng], Math.max(locMap.getZoom(), 16));
}
function radiusNu() { return parseInt($("locRadius").value) || 250; }
$("locRadius").addEventListener("input", () => { if (locCirkel) locCirkel.setRadius(radiusNu()); });
$("locZoek").addEventListener("click", async () => {
  const adres = $("locAdres").value.trim();
  const meld = $("locMelding");
  if (!adres) return toonMeld(meld, "fout", "Typ eerst een adres.");
  toonMeld(meld, "", "Adres opzoeken…");
  try {
    const r = await geocodeer(adres);
    if (!r) return toonMeld(meld, "fout", "Adres niet gevonden. Probeer het voluit, bv. \"Poortland 34, Amsterdam\".");
    zetSpeld(r.lat, r.lng, true);
    toonMeld(meld, "ok", "Gevonden: " + r.naam);
  } catch (_) { toonMeld(meld, "fout", "Opzoeken mislukt. Controleer je internetverbinding."); }
});
$("locAdres").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("locZoek").click(); } });
function sluitLocModal() { $("locModal").classList.add("verborgen"); }
$("locSluit").addEventListener("click", sluitLocModal);
$("locAnnuleer").addEventListener("click", sluitLocModal);
$("locModal").addEventListener("click", (e) => { if (e.target === $("locModal")) sluitLocModal(); });
$("locGeen").addEventListener("click", async () => {
  if (!confirm("Locatie-eis weghalen?\n\nDeze monteur kan dan overal inklokken op deze werkbon — er wordt niet meer gecontroleerd of hij op de bouwplaats is.")) return;
  if (locModus === "nieuw") {
    $("pLat").value = ""; $("pLng").value = ""; $("pRadius").value = radiusNu();
    toonMeld($("pGeoMelding"), "", "Geen locatie-eis voor deze werkbon.");
    return sluitLocModal();
  }
  await db.from("projecten").update({ lat: null, lng: null, radius_m: radiusNu() }).eq("id", locProjectId);
  sluitLocModal(); laadProjecten();
});
$("locOpslaan").addEventListener("click", async () => {
  if (!locMarker) return toonMeld($("locMelding"), "fout", "Zet eerst een speld (zoek een adres of klik op de kaart).");
  const ll = locMarker.getLatLng();
  const lat = +ll.lat.toFixed(6), lng = +ll.lng.toFixed(6), adres = $("locAdres").value.trim();
  if (locModus === "nieuw") {
    $("pLat").value = lat; $("pLng").value = lng; $("pRadius").value = radiusNu();
    if (adres) $("pLocatie").value = adres;
    toonMeld($("pGeoMelding"), "ok", "Locatie gekozen. Klik op Toevoegen om de werkbon op te slaan.");
    return sluitLocModal();
  }
  const upd = { lat, lng, radius_m: radiusNu() };
  if (adres) upd.locatie = adres;
  const { error } = await db.from("projecten").update(upd).eq("id", locProjectId);
  if (error) return toonMeld($("locMelding"), "fout", "Opslaan mislukt: " + error.message);
  sluitLocModal(); laadProjecten();
});

// ── Klok-plattegrond: waar heeft de monteur ingeklokt? ──────────────────────
let klokMap = null, klokMarker = null;
function koppelKlokKnoppen() {
  document.querySelectorAll("[data-klok-lat]").forEach((b) => {
    if (b.dataset.gekoppeld) return;
    b.dataset.gekoppeld = "1";
    b.addEventListener("click", () => toonKlokKaart(
      parseFloat(b.dataset.klokLat), parseFloat(b.dataset.klokLng),
      b.dataset.klokNaam, b.dataset.klokIso, b.dataset.klokWerkbon));
  });
}
function tijdSec(iso) { return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function toonKlokKaart(lat, lng, naam, iso, werkbon) {
  $("klokNaam").textContent = naam || "—";
  $("klokTijd").textContent = iso ? tijdSec(iso) + " via de app" : "—";
  $("klokWerkbon").textContent = werkbon || "—";
  $("klokModal").classList.remove("verborgen");
  if (!klokMap) {
    klokMap = L.map("klokKaart");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(klokMap);
  }
  klokMap.setView([lat, lng], 17);
  if (klokMarker) klokMarker.setLatLng([lat, lng]);
  else klokMarker = L.marker([lat, lng]).addTo(klokMap);
  setTimeout(() => klokMap.invalidateSize(), 60);
}
function sluitKlokModal() { $("klokModal").classList.add("verborgen"); }
$("klokSluit").addEventListener("click", sluitKlokModal);
$("klokModal").addEventListener("click", (e) => { if (e.target === $("klokModal")) sluitKlokModal(); });

async function geocodeer(adres) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl&q=" + encodeURIComponent(adres);
  const res = await fetch(url, { headers: { "Accept-Language": "nl" } });
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), naam: data[0].display_name };
}

// ── Hulpjes ─────────────────────────────────────────────────────────────────
function csvDownload(koppen, rijen, naam) {
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const csv = "﻿" + [koppen, ...rijen].map((r) => r.map(q).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = naam + ".csv"; a.click();
  URL.revokeObjectURL(url);
}
// ── Verlofdagen tellen: alleen werkdagen (za/zo en feestdagen tellen niet) ──
// Nederlandse feestdagen; Pasen-afhankelijke dagen worden berekend.
function paasZondag(jaar) {
  const a = jaar % 19, b = Math.floor(jaar / 100), c = jaar % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const maand = Math.floor((h + l - 7 * m + 114) / 31);
  const dag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(jaar, maand - 1, dag);
}
const _feestdagen = {};
function feestdagen(jaar) {
  if (_feestdagen[jaar]) return _feestdagen[jaar];
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const plus = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const pasen = paasZondag(jaar);
  const set = new Set([
    `${jaar}-01-01`,                    // Nieuwjaarsdag
    iso(plus(pasen, -2)),               // Goede Vrijdag
    iso(plus(pasen, 1)),                // Tweede paasdag
    iso(plus(pasen, 39)),               // Hemelvaartsdag
    iso(plus(pasen, 50)),               // Tweede pinksterdag
    `${jaar}-12-25`, `${jaar}-12-26`,   // Kerst
  ]);
  // Koningsdag: 27 april, op zondag een dag eerder
  const kd = new Date(jaar, 3, 27);
  set.add(iso(kd.getDay() === 0 ? plus(kd, -1) : kd));
  // Bevrijdingsdag is alleen in lustrumjaren een vrije dag voor de meeste cao's
  if (jaar % 5 === 0) set.add(`${jaar}-05-05`);
  _feestdagen[jaar] = set;
  return set;
}
function werkdagenTussen(van, tot) {
  const a = new Date(van + "T12:00:00"), b = new Date(tot + "T12:00:00");
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  let n = 0;
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    const dag = d.getDay();
    if (dag === 0 || dag === 6) continue; // zondag/zaterdag
    const s = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    if (feestdagen(d.getFullYear()).has(s)) continue;
    n++;
  }
  return n;
}
function dagenTussen(van, tot) {
  return Math.max(werkdagenTussen(van, tot), 0);
}
// Werkdagen van een verlofperiode die binnen de rapportageperiode vallen
function overlapDagen(van, tot, pVan, pTot) {
  const a = van > pVan ? van : pVan;
  const b = tot < pTot ? tot : pTot;
  return werkdagenTussen(a, b);
}
function toonMeld(el, soort, msg) { el.className = "melding" + (soort ? " " + soort : ""); el.textContent = msg; el.classList.remove("verborgen"); }
function vulSelect(id, paren) {
  const sel = $(id); const huidig = sel.value; sel.innerHTML = "";
  paren.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
  if (huidig) sel.value = huidig;
}
function werkbonTekst(p) { return p ? (p.werkbon ? p.werkbon + " · " : "") + p.naam : ""; }
// Werkbon met gekleurd bolletje ervoor (voor in tabellen)
function werkbonMetKleur(p) {
  if (!p) return "";
  return `<span class="wb-stip" style="background:${kleurVan(p)}"></span>${esc(werkbonTekst(p))}`;
}
function tijd(iso) { return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }); }
function datum(d) { return new Date(d).toLocaleDateString("nl-NL", { day: "2-digit", month: "short" }); }
function duurTekst(iso) { const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0"); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function rijLeeg(cols, msg) { return `<tr><td colspan="${cols}" class="leeg">${msg}</td></tr>`; }
function toon(el, m) { el.textContent = m; el.classList.remove("verborgen"); }
function verberg(el) { el.classList.add("verborgen"); }

// Splitst een volledige naam in voornaam, tussenvoegsel en achternaam. Zonder
// dit belandt "Donny Melvin van der Laan" in zijn geheel in het achternaamveld.
const TUSSENVOEGSELS = ["van", "de", "der", "den", "het", "ten", "ter", "te", "op", "aan",
  "bij", "in", "onder", "over", "uit", "voor", "'t", "d'", "el", "al", "bin", "ben", "da", "di", "du", "la", "le"];
function splitsNaam(volledig) {
  const delen = String(volledig || "").trim().split(/\s+/).filter(Boolean);
  if (delen.length < 2) return { voornaam: delen[0] || "", tussenvoegsel: "", achternaam: "" };
  // Eerste tussenvoegsel zoeken, maar niet op plek 0 — dat is de voornaam.
  let i = -1;
  for (let k = 1; k < delen.length - 1; k++) {
    if (TUSSENVOEGSELS.includes(delen[k].toLowerCase())) { i = k; break; }
  }
  if (i === -1) return { voornaam: delen[0], tussenvoegsel: "", achternaam: delen.slice(1).join(" ") };
  return {
    voornaam: delen.slice(0, i).join(" "),
    tussenvoegsel: delen.slice(i, delen.length - 1).join(" "),
    achternaam: delen[delen.length - 1],
  };
}

// ── Medewerkerdossier ───────────────────────────────────────────────────────
//  Eén pagina per medewerker met tabbladen, zoals Shiftbase die heeft: wat er
//  gepland staat, wat er geklokt is, welk verlof er loopt, het plus/min-saldo
//  en het contract. Voorheen zag je alleen een rij in een tabel en moest je in
//  vier schermen zoeken om één monteur te beoordelen.
let mdId = null;
let mdMaand = new Date();

function toonMdTab(naam) {
  document.querySelectorAll(".md-tab").forEach((t) => t.classList.toggle("actief", t.dataset.mdtab === naam));
  document.querySelectorAll("[data-mdpaneel]").forEach((p) => p.classList.toggle("verborgen", p.dataset.mdpaneel !== naam));
}
document.querySelectorAll(".md-tab").forEach((t) => t.addEventListener("click", () => {
  toonMdTab(t.dataset.mdtab);
  if (t.dataset.mdtab === "rooster") mdRooster();
  if (t.dataset.mdtab === "uren") mdUren();
  if (t.dataset.mdtab === "afwezigheid") mdAfwezigheid();
  if (t.dataset.mdtab === "plusmin") mdPlusmin();
}));

$("mdTerug").addEventListener("click", () => toonView("medewerkers"));
$("mdBewerk").addEventListener("click", () => { if (mdId) openMedewerker(mdId); });
$("mdRoosterVorige").addEventListener("click", () => { mdMaand.setMonth(mdMaand.getMonth() - 1); mdRooster(); });
$("mdRoosterVolgende").addEventListener("click", () => { mdMaand.setMonth(mdMaand.getMonth() + 1); mdRooster(); });

function mdMedewerker() { return _medewerkers.find((m) => m.id === mdId); }
function mdMaandGrenzen() {
  const van = new Date(mdMaand.getFullYear(), mdMaand.getMonth(), 1);
  const tot = new Date(mdMaand.getFullYear(), mdMaand.getMonth() + 1, 0);
  return { van: isoDatum(van), tot: isoDatum(tot),
           label: van.toLocaleDateString("nl-NL", { month: "long", year: "numeric" }) };
}

async function openDossier(id) {
  mdId = id;
  mdMaand = new Date();
  const m = mdMedewerker();
  if (!m) return;
  toonView("medewerker");
  $("mdAvatar").textContent = initialen(m.naam);
  $("mdNaam").textContent = m.naam;
  $("mdSub").textContent = [m.functietitel, CONTRACT_LABEL[m.contract_type] || m.contract_type,
                            m.email].filter(Boolean).join(" · ");
  toonMdTab("overzicht");

  const regel = (kop, waarde) =>
    `<div class="md-veld"><span class="md-label">${kop}</span><span class="md-waarde">${waarde || "—"}</span></div>`;
  $("mdGegevens").innerHTML = [
    regel("E-mail", m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ""),
    regel("Mobiel", esc(m.mobiel || "")),
    regel("Telefoon", esc(m.telefoon || "")),
    regel("Noodnummer", esc(m.noodnummer || "")),
    regel("Adres", esc([m.adres, [m.postcode, m.plaats].filter(Boolean).join(" ")].filter(Boolean).join(", "))),
    regel("Geboortedatum", m.geboortedatum ? datum(m.geboortedatum) : ""),
    regel("Geboorteplaats", esc(m.geboorteplaats || "")),
    regel("Nationaliteit", esc(m.nationaliteit || "")),
    regel("In dienst", m.datum_in_dienst ? datum(m.datum_in_dienst) : ""),
    regel("Personeelsnummer", esc(m.personeelsnummer || "")),
    regel("Rol", `<span class="badge grijs">${esc(m.rol)}</span>`),
    regel("Account", accountBadge(m)),
    regel("Roosternotitie", esc(m.roosternotitie || "")),
  ].join("");

  mdContract(m);
}

function mdContract(m) {
  const cv = _vormen.find((v) => v.id === m.contractvorm_id);
  const week = urenWeekTotaal(m.contract_uren);
  $("mdContract").innerHTML = `<tr>
    <td class="sterk">${esc(cv ? cv.naam : "—")}</td>
    <td>${m.contract_type ? `<span class="badge grijs">${CONTRACT_LABEL[m.contract_type] || m.contract_type}</span>` : "—"}</td>
    <td>${esc(m.functietitel || "—")}</td>
    <td>${cv ? (cv.plusmin ? "ja" : "nee") : "—"}</td>
    <td>${cv ? (cv.uitbetalingsbasis === "contract" ? "contracturen" : "gewerkte uren") : "—"}</td>
    <td class="mono">${week != null ? urenTekst(week) : "—"}</td>
    <td class="mono">${m.uurloon != null ? "€ " + komma(m.uurloon) : "—"}</td>
    <td class="mono">${m.contract_start ? datum(m.contract_start) : "—"}</td>
    <td class="mono">${m.contract_eind ? datum(m.contract_eind) : "—"}</td>
  </tr>`;
  const u = m.contract_uren || {};
  $("mdContractUren").innerHTML = DAG_KEYS.map((d) =>
    `<div class="md-veld"><span class="md-label">${d}</span><span class="md-waarde mono">${u[d] ? urenTekst(u[d]) : "—"}</span></div>`
  ).join("") + `<div class="md-veld"><span class="md-label">totaal</span><span class="md-waarde mono sterk">${
    urenWeekTotaal(m.contract_uren) != null ? urenTekst(urenWeekTotaal(m.contract_uren)) : "—"}</span></div>`;
}

async function mdRooster() {
  const { van, tot, label } = mdMaandGrenzen();
  $("mdRoosterPeriode").textContent = label;
  const [{ data: plan, error: pf }, { data: afw }] = await Promise.all([
    db.from("planning").select("datum, dagdeel, start_tijd, eind_tijd, projecten(werkbon, naam, kleur)")
      .eq("medewerker_id", mdId).gte("datum", van).lte("datum", tot).is("verwijderd_op", null).order("datum"),
    db.from("afwezigheid").select("soort, van_datum, tot_datum, status")
      .eq("medewerker_id", mdId).lte("van_datum", tot).gte("tot_datum", van).is("verwijderd_op", null),
  ]);
  if (pf) { $("mdRooster").innerHTML = `<div class="leeg">Kon het rooster niet laden: ${esc(pf.message)}</div>`; return; }

  const perDag = {};
  (plan || []).forEach((p) => (perDag[p.datum] = perDag[p.datum] || []).push(p));
  const eerste = new Date(van + "T12:00:00");
  const start = new Date(eerste); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const laatste = new Date(tot + "T12:00:00");
  const vandaag = isoDatum(new Date());

  let html = `<div class="md-maand-kop">${["ma","di","wo","do","vr","za","zo"].map((d) => `<span>${d}</span>`).join("")}</div><div class="md-maand-raster">`;
  for (let d = new Date(start); d <= laatste || d.getDay() !== 1; d.setDate(d.getDate() + 1)) {
    const iso = isoDatum(d);
    const buiten = d.getMonth() !== eerste.getMonth();
    const vrij = (afw || []).filter((a) => iso >= a.van_datum && iso <= a.tot_datum);
    const blokken = (perDag[iso] || []).map((p) => {
      const t = p.start_tijd ? `${kortTijd(p.start_tijd)} – ${kortTijd(p.eind_tijd)}` : (p.dagdeel || "");
      return `<span class="md-blok" style="border-left-color:${esc(kleurVan(p.projecten))}">
        <b>${esc(werkbonTekst(p.projecten))}</b><span>${esc(t)}</span></span>`;
    }).join("");
    const vrijBlok = vrij.map((a) => {
      const ty = typeVanCode(a.soort);
      return `<span class="md-vrij" style="background:${ty.kleur}1f;border-color:${ty.kleur};color:${ty.kleur}">${esc(ty.naam)}</span>`;
    }).join("");
    html += `<div class="md-dag${buiten ? " buiten" : ""}${iso === vandaag ? " vandaag" : ""}">
      <span class="md-dagnr">${d.getDate()}</span>${vrijBlok}${blokken}</div>`;
    if (d > laatste && d.getDay() === 0) break;
  }
  $("mdRooster").innerHTML = html + "</div>";
}

async function mdUren() {
  const { van, tot, label } = mdMaandGrenzen();
  $("mdUrenPeriode").textContent = label;
  const { data, error } = await db.from("urenregels")
    .select("datum, start_tijd, eind_tijd, uren, km, status, omschrijving, projecten(werkbon, naam)")
    .eq("medewerker_id", mdId).gte("datum", van).lte("datum", tot).is("verwijderd_op", null)
    .order("datum").order("start_tijd");
  if (error) { $("mdUren").innerHTML = rijLeeg(8, "Kon de uren niet laden: " + error.message); return; }
  const rijen = data || [];
  const totaal = rijen.filter((u) => u.status !== "afgekeurd").reduce((s, u) => s + (Number(u.uren) || 0), 0);
  const km = rijen.reduce((s, u) => s + (Number(u.km) || 0), 0);
  const m = mdMedewerker();
  const bedrag = m && m.uurloon != null ? totaal * Number(m.uurloon) : null;
  $("mdUrenCijfers").innerHTML = [
    ["Diensten", rijen.length], ["Uren", urenTekst(totaal)], ["Kilometers", komma(km)],
    ["Loon (indicatie)", bedrag != null ? "€ " + komma(bedrag) : "—"],
  ].map(([k, v]) => `<div class="md-cijfer"><span>${k}</span><b>${v}</b></div>`).join("");
  $("mdUren").innerHTML = rijen.map((u) => `<tr>
    <td class="mono">${datum(u.datum)}</td>
    <td class="mono">${u.start_tijd ? tijd(u.start_tijd) : "—"}</td>
    <td class="mono">${u.eind_tijd ? tijd(u.eind_tijd) : "—"}</td>
    <td>${werkbonMetKleur(u.projecten)}</td>
    <td class="mono">${u.km != null ? komma(u.km) : "—"}</td>
    <td class="mono sterk">${urenTekst(u.uren)}</td>
    <td>${statusBadge(u.status)}</td>
    <td>${esc(u.omschrijving || "")}</td></tr>`).join("") || rijLeeg(8, "Geen uren in deze maand.");
}

async function mdAfwezigheid() {
  const jaar = new Date().getFullYear();
  $("mdAfwJaar").textContent = String(jaar);
  const { data, error } = await db.from("afwezigheid")
    .select("soort, van_datum, tot_datum, status, reden")
    .eq("medewerker_id", mdId).is("verwijderd_op", null).order("van_datum", { ascending: false });
  if (error) { $("mdAfw").innerHTML = rijLeeg(6, "Kon de afwezigheid niet laden: " + error.message); return; }
  const rijen = data || [];
  const perSoort = {};
  rijen.filter((r) => r.status === "goedgekeurd" && r.tot_datum >= jaar + "-01-01" && r.van_datum <= jaar + "-12-31")
    .forEach((r) => {
      const v = r.van_datum > jaar + "-01-01" ? r.van_datum : jaar + "-01-01";
      const t = r.tot_datum < jaar + "-12-31" ? r.tot_datum : jaar + "-12-31";
      perSoort[r.soort] = (perSoort[r.soort] || 0) + werkdagenTussen(v, t);
    });
  $("mdAfwVerdeling").innerHTML = Object.keys(perSoort).length
    ? Object.entries(perSoort).map(([s, n]) => `<span class="chip">${typeLabel(s)}: <b style="margin-left:4px">${n} ${n === 1 ? "dag" : "dagen"}</b></span>`).join("")
    : `<span class="leeg">Nog geen goedgekeurde afwezigheid in ${jaar}.</span>`;
  $("mdAfw").innerHTML = rijen.map((r) => `<tr>
    <td>${typeLabel(r.soort)}</td>
    <td class="mono">${datum(r.van_datum)}</td>
    <td class="mono">${datum(r.tot_datum)}</td>
    <td class="mono">${werkdagenTussen(r.van_datum, r.tot_datum)}</td>
    <td>${statusBadge(r.status)}</td>
    <td>${esc(r.reden || "")}</td></tr>`).join("") || rijLeeg(6, "Nog geen afwezigheid.");

  const { data: saldo } = await db.rpc("verlofsaldo", { p_medewerker: mdId });
  $("mdSaldo").innerHTML = saldo ? `
    <div class="saldo-rij"><span>Beginsaldo</span><b>${urenTekst(saldo.startsaldo)}</b></div>
    <div class="saldo-rij"><span>Opgebouwd</span><b>${urenTekst(saldo.opgebouwd)}</b></div>
    <div class="saldo-rij"><span>Opgenomen</span><b>&minus; ${urenTekst(saldo.opgenomen)}</b></div>
    ${Number(saldo.aangevraagd) > 0 ? `<div class="saldo-rij"><span>Aangevraagd</span><b>${urenTekst(saldo.aangevraagd)}</b></div>` : ""}
    <div class="saldo-rij totaal"><span>Resterend</span><b>${urenTekst(saldo.saldo)}</b></div>`
    : `<span class="leeg">Geen verlofsaldo beschikbaar; controleer of er een afwezigheidsbeleid is gekoppeld.</span>`;
}

async function mdPlusmin() {
  const { van, tot, label } = mdMaandGrenzen();
  $("mdPmPeriode").textContent = label;
  $("mdPlusmin").innerHTML = '<span class="leeg">Berekenen…</span>';
  const { data, error } = await db.rpc("uitbetaling", { p_van: van, p_tot: tot });
  if (error) { $("mdPlusmin").innerHTML = `<span class="leeg">Kon het saldo niet berekenen: ${esc(error.message)}</span>`; return; }
  const r = (data || []).find((x) => x.medewerker_id === mdId);
  if (!r) { $("mdPlusmin").innerHTML = '<span class="leeg">Geen gegevens in deze maand.</span>'; return; }
  const pm = Number(r.plusmin_uren) || 0;
  $("mdPlusmin").innerHTML = `
    <div class="saldo-rij"><span>Geklokt</span><b>${urenTekst(r.gewerkt_uren)}</b></div>
    <div class="saldo-rij"><span>Goedgekeurd verlof</span><b>${urenTekst(r.verlof_uren)}</b></div>
    <div class="saldo-rij"><span>Contracturen</span><b>${urenTekst(r.contract_uren)}</b></div>
    ${Number(r.overwerk_uren) ? `<div class="saldo-rij"><span>Waarvan overwerk</span><b>${urenTekst(r.overwerk_uren)}</b></div>` : ""}
    ${Number(r.open_uren) ? `<div class="saldo-rij"><span>Nog te beoordelen</span><b>${urenTekst(r.open_uren)}</b></div>` : ""}
    <div class="saldo-rij totaal"><span>Plus/min</span><b style="color:${pm < 0 ? "var(--rood-donker)" : pm > 0 ? "var(--groen)" : "inherit"}">${
      pm ? (pm > 0 ? "+" : "−") + urenTekst(Math.abs(pm)) : "0 min"}</b></div>
    ${r.waarschuwing ? `<div class="melding fout" style="margin-top:10px">${esc(r.waarschuwing)}</div>` : ""}`;
}

// ── Urenregistratie: dagweergave ────────────────────────────────────────────
//  In de lijstweergave zie je alleen wie er geklokt heeft. Op een dag waarop de
//  helft van de ploeg vrij is, of iemand vergeten is te klokken, valt dat niet
//  op — je ziet een korte lijst en gaat verder. Deze weergave zet iedereen op
//  een regel, met wat hij die dag deed of waarom hij er niet was, en wat het
//  kost. Zo is een gat meteen zichtbaar.
async function tekenDagOverzicht() {
  const { van } = urenPeriode();
  const [{ data: regels, error: rf }, { data: vrij, error: vf }] = await Promise.all([
    db.from("urenregels")
      .select("id, medewerker_id, project_id, start_tijd, eind_tijd, uren, km, status, omschrijving, verwerkt_op, projecten(werkbon, naam, kleur)")
      .eq("datum", van).is("verwijderd_op", null).order("start_tijd"),
    db.from("afwezigheid").select("medewerker_id, soort, status")
      .lte("van_datum", van).gte("tot_datum", van).is("verwijderd_op", null).neq("status", "afgekeurd"),
  ]);
  if (rf || vf) {
    $("tbDag").innerHTML = rijLeeg(9, "Kon de dag niet laden: " + (rf || vf).message);
    return;
  }

  const perMw = {};
  (regels || []).forEach((r) => (perMw[r.medewerker_id] = perMw[r.medewerker_id] || []).push(r));
  const vrijPerMw = {};
  (vrij || []).forEach((a) => (vrijPerMw[a.medewerker_id] = vrijPerMw[a.medewerker_id] || []).push(a));

  const dagKey = DAG_KEYS[(new Date(van + "T12:00:00").getDay() + 6) % 7];
  const monteurs = _medewerkers.filter((m) => m.actief);
  const bonOpties = (gekozen) => (window._projecten || [])
    .map((p) => `<option value="${esc(p.id)}"${p.id === gekozen ? " selected" : ""}>${esc(werkbonTekst(p))}</option>`).join("");

  let totUren = 0, totBedrag = 0;
  const rijen = monteurs.map((m) => {
    const eigen = perMw[m.id] || [];
    const afwezig = vrijPerMw[m.id] || [];
    const contract = Number((m.contract_uren || {})[dagKey]) || 0;
    const gewerkt = eigen.filter((r) => r.status !== "afgekeurd").reduce((s, r) => s + (Number(r.uren) || 0), 0);
    const verschil = gewerkt - contract;
    const bedrag = m.uurloon != null ? gewerkt * Number(m.uurloon) : null;
    totUren += gewerkt;
    if (bedrag != null) totBedrag += bedrag;

    const naamCel = `<td class="dag-naam">
      <span class="r-avatar">${esc(initialen(m.naam))}</span>
      <span class="dag-naam-tekst">
        <b>${esc(m.naam)}</b>
        <span class="dag-contract">${contract ? urenTekst(contract) : "geen contracturen"}${
          contract ? ` <em class="${verschil < 0 ? "min" : verschil > 0 ? "plus" : ""}">${
            verschil ? (verschil > 0 ? "+" : "−") + urenTekst(Math.abs(verschil)) : ""}</em>` : ""}</span>
      </span></td>`;

    // Niets geklokt: dan is de vraag waaróm niet. Verlof tonen, of een gat.
    if (!eigen.length) {
      const uitleg = afwezig.length
        ? afwezig.map((a) => {
            const t = typeVanCode(a.soort);
            return `<span class="dag-vrij" style="background:${t.kleur}1f;border-color:${t.kleur};color:${t.kleur}">${esc(t.naam)}</span>`
              + (a.status === "onbeslist" ? ' <span class="badge amber">nog niet goedgekeurd</span>' : "");
          }).join(" ")
        : `<span class="dag-gat">Niet geklokt</span>`;
      return `<tr class="${afwezig.length ? "dag-afwezig" : "dag-leeg"}">
        ${naamCel}<td colspan="4" class="dag-uitleg">${uitleg}</td>
        <td class="dag-uitleg"></td>
        <td class="mono">${contract && afwezig.length ? urenTekst(contract) : "—"}</td>
        <td class="mono">—</td>
        <td><button class="btn btn-grijs btn-klein" data-dag-toevoegen="${m.id}">Uren toevoegen</button></td></tr>`;
    }

    return eigen.map((r, i) => {
      const vast = !!r.verwerkt_op;
      const bedragRij = m.uurloon != null ? Number(r.uren) * Number(m.uurloon) : null;
      return `<tr class="dag-rij ${r.status}">
        ${i === 0 ? naamCel : '<td class="dag-naam vervolg"></td>'}
        <td><input type="time" class="dag-veld" data-veld="start_tijd" data-id="${r.id}"
             value="${r.start_tijd ? tijd(r.start_tijd) : ""}"${vast ? " disabled" : ""}></td>
        <td><input type="time" class="dag-veld" data-veld="eind_tijd" data-id="${r.id}"
             value="${r.eind_tijd ? tijd(r.eind_tijd) : ""}"${vast ? " disabled" : ""}></td>
        <td><select class="dag-veld dag-bon" data-veld="project_id" data-id="${r.id}"${vast ? " disabled" : ""}>${bonOpties(r.project_id)}</select></td>
        <td><input type="text" inputmode="decimal" class="dag-veld dag-km" data-veld="km" data-id="${r.id}"
             value="${r.km != null ? komma(r.km) : ""}"${vast ? " disabled" : ""}></td>
        <td class="dag-uitleg">${esc(r.omschrijving || "")}${vast ? ' <span class="mini-grijs">in loonrun</span>' : ""}</td>
        <td class="mono sterk">${urenTekst(r.uren)}</td>
        <td class="mono">${bedragRij != null ? "€ " + komma(bedragRij) : "—"}</td>
        <td class="knoprij">${
          r.status === "onbeslist"
            ? `<button class="btn btn-groen btn-klein" data-keur="goedgekeurd" data-id="${r.id}" title="Goedkeuren">&check;</button>
               <button class="btn btn-grijs btn-klein" data-keur="afgekeurd" data-id="${r.id}" title="Afkeuren">&times;</button>`
            : statusBadge(r.status)}${vast ? "" : `<button class="btn btn-grijs btn-klein" data-dag-bewerk="${r.id}" title="Aanpassen">&#9998;</button>`}</td></tr>`;
    }).join("");
  }).join("");

  $("tbDag").innerHTML = rijen || rijLeeg(9, "Nog geen monteurs.");
  $("dagTotaal").innerHTML = `<span>Totaal deze dag</span>
    <b class="mono">${urenTekst(totUren)}</b>
    <b class="mono">${totBedrag ? "€ " + komma(totBedrag) : ""}</b>`;

  document.querySelectorAll("[data-keur]").forEach((b) => b.addEventListener("click", () => keur(b.dataset.id, b.dataset.keur)));
  document.querySelectorAll(".dag-veld").forEach((e) => e.addEventListener("change", () => slaDagVeldOp(e)));
  document.querySelectorAll("[data-dag-toevoegen]").forEach((b) => b.addEventListener("click", () =>
    openUurVenster({ medewerker: b.dataset.dagToevoegen, datum: urenPeriode().van })));
  document.querySelectorAll("[data-dag-bewerk]").forEach((b) => b.addEventListener("click", () =>
    openUurVenster({ id: b.dataset.dagBewerk })));
}

// Direct opslaan bij het verlaten van het veld. De database rekent uren en
// pauze zelf opnieuw uit de tijden, dus die sturen we bewust niet mee.
async function slaDagVeldOp(el) {
  const id = el.dataset.id, veld = el.dataset.veld;
  const { van } = urenPeriode();
  let waarde = el.value;
  if (veld === "km") {
    const n = parseFloat(String(waarde).replace(",", "."));
    waarde = isNaN(n) || n < 0 ? 0 : Math.round(n * 10) / 10;
  } else if (veld === "start_tijd" || veld === "eind_tijd") {
    if (!waarde) return;
    // De tijd hoort bij de dag die in beeld staat, niet bij vandaag.
    waarde = new Date(van + "T" + waarde + ":00").toISOString();
  }
  el.classList.add("bezig");
  const { error } = await db.from("urenregels").update({ [veld]: waarde }).eq("id", id);
  el.classList.remove("bezig");
  if (error) {
    el.classList.add("mist");
    return alert("Opslaan mislukt: " + error.message);
  }
  el.classList.remove("mist");
  await laadUren();
}

// ── Uren handmatig toevoegen of corrigeren ──────────────────────────────────
//  Tot nu toe kon de beheerder alleen goed- of afkeuren. Elke correctie — een
//  vergeten klok, een verkeerde werkbon, een dag die op papier stond — moest via
//  de database. Dat is precies het soort ingreep dat je juist wilt vastleggen.
let uurBewerkId = null;

function openUurVenster({ id = null, medewerker = "", datum: dat = "" } = {}) {
  uurBewerkId = id;
  vulSelect("uurMedewerker", _medewerkers.filter((m) => m.actief).map((m) => [m.id, m.naam]));
  vulSelect("uurProject", (window._projecten || []).map((p) => [p.id, werkbonTekst(p)]));
  verberg($("uurMelding"));
  $("uurVerwijder").classList.toggle("verborgen", !id);

  if (id) {
    const r = _uren.find((u) => u.id === id);
    if (!r) return;
    $("uurTitel").textContent = "Uren aanpassen";
    $("uurMedewerker").value = r.medewerker_id;
    $("uurDatum").value = r.datum;
    $("uurProject").value = r.projecten?.id || "";
    $("uurStart").value = r.start_tijd ? tijd(r.start_tijd) : "";
    $("uurEind").value = r.eind_tijd ? tijd(r.eind_tijd) : "";
    $("uurKm").value = r.km != null ? komma(r.km) : "";
    $("uurOmschrijving").value = r.omschrijving || "";
  } else {
    $("uurTitel").textContent = "Uren toevoegen";
    if (medewerker) $("uurMedewerker").value = medewerker;
    $("uurDatum").value = dat || urenPeriode().van;
    $("uurStart").value = "07:00";
    $("uurEind").value = "16:00";
    $("uurKm").value = "";
    $("uurOmschrijving").value = "";
  }
  $("uurModal").classList.remove("verborgen");
}
function sluitUurVenster() { $("uurModal").classList.add("verborgen"); }
$("uurSluit").addEventListener("click", sluitUurVenster);
$("uurAnnuleer").addEventListener("click", sluitUurVenster);
$("uurModal").addEventListener("click", (e) => { if (e.target === $("uurModal")) sluitUurVenster(); });

$("uurOpslaan").addEventListener("click", async () => {
  const melding = $("uurMelding");
  const medewerker_id = $("uurMedewerker").value, project_id = $("uurProject").value;
  const dat = $("uurDatum").value, start = $("uurStart").value, eind = $("uurEind").value;
  if (!medewerker_id || !project_id || !dat || !start || !eind) {
    return toonMeld(melding, "fout", "Vul monteur, datum, werkbon, start en eind in.");
  }
  const startTijd = new Date(dat + "T" + start + ":00");
  let eindTijd = new Date(dat + "T" + eind + ":00");
  // Een dienst die na middernacht eindigt hoort bij de dag waarop hij begon.
  if (eindTijd <= startTijd) eindTijd.setDate(eindTijd.getDate() + 1);
  if ((eindTijd - startTijd) / 3600000 > 24) {
    return toonMeld(melding, "fout", "Dat is meer dan 24 uur; controleer de tijden.");
  }
  const n = parseFloat(String($("uurKm").value).replace(",", "."));
  const rij = {
    medewerker_id, project_id, datum: dat,
    start_tijd: startTijd.toISOString(), eind_tijd: eindTijd.toISOString(),
    km: isNaN(n) || n < 0 ? 0 : Math.round(n * 10) / 10,
    omschrijving: $("uurOmschrijving").value.trim() || null,
    bron: "handmatig",
  };

  $("uurOpslaan").disabled = true;
  try {
    const { error } = uurBewerkId
      ? await db.from("urenregels").update(rij).eq("id", uurBewerkId)
      : await db.from("urenregels").insert({ ...rij, status: "onbeslist", aangemaakt_door: ikBenId });
    if (error) {
      // Deze twee komen vaak voor en zijn met een uitleg meteen op te lossen.
      const uitleg = error.code === "23505"
        ? "Er staat al een regel met deze starttijd voor deze monteur."
        : error.message;
      return toonMeld(melding, "fout", (uurBewerkId ? "Opslaan" : "Toevoegen") + " mislukt: " + uitleg);
    }
    sluitUurVenster();
    await laadUren();
  } finally {
    $("uurOpslaan").disabled = false;
  }
});

$("uurVerwijder").addEventListener("click", async () => {
  if (!uurBewerkId) return;
  if (!confirm("Deze urenregel verwijderen?\n\nHij verdwijnt uit de rapportage en uit de loonrun. De registratie blijft bewaard in de database.")) return;
  const { error } = await db.from("urenregels")
    .update({ verwijderd_op: new Date().toISOString() }).eq("id", uurBewerkId);
  if (error) return toonMeld($("uurMelding"), "fout", "Verwijderen mislukt: " + error.message);
  sluitUurVenster();
  await laadUren();
});

$("uurNieuw").addEventListener("click", () => openUurVenster({ datum: urenPeriode().van }));

// ============================================================================
//  Spaar Electra — Urenregistratie · beheer-dashboard
//  Shiftbase-indeling (zijbalk) in Spaar-huisstijl. Dashboard, Rooster,
//  Urenregistratie (met km/pauze), Verlof, Werkbonnen, Medewerkers, Rapportages.
// ============================================================================
import { beheerClient } from "./config.js";

const $ = (id) => document.getElementById(id);
const db = beheerClient();
let tikker = null;

const PAGINA_TITEL = {
  dashboard: "Dashboard", rooster: "Rooster", uren: "Urenregistratie",
  verlof: "Verlof", projecten: "Werkbonnen", medewerkers: "Medewerkers",
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
  if (data?.user) $("wieBen").textContent = data.user.email;
  await Promise.all([laadIngeklokt(), laadUren(), laadProjecten(), laadMedewerkers(), laadRooster(), laadVerlof()]);
  standaardPeriode();
  if (tikker) clearInterval(tikker);
  tikker = setInterval(laadIngeklokt, 30000);
}

// ── Navigatie (zijbalk) ──────────────────────────────────────────────────────
document.querySelectorAll(".nav").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".nav").forEach((x) => x.classList.remove("actief"));
  t.classList.add("actief");
  const tab = t.dataset.tab;
  document.querySelectorAll("[data-view]").forEach((v) => v.classList.toggle("verborgen", v.dataset.view !== tab));
  $("paginaTitel").textContent = PAGINA_TITEL[tab] || "";
  $("app").classList.remove("open"); // mobiel menu sluiten
}));
$("menuKnop").addEventListener("click", () => $("app").classList.toggle("open"));
$("app").addEventListener("click", (e) => { if (e.target === $("app")) $("app").classList.remove("open"); });

// ── Nu ingeklokt + wie niet ─────────────────────────────────────────────────
async function laadIngeklokt() {
  const [{ data, error }, { data: monteurs }] = await Promise.all([
    db.from("kloksessies")
      .select("id, medewerker_id, ingeklokt_op, medewerkers(naam), projecten(werkbon, naam)")
      .order("ingeklokt_op"),
    db.from("medewerkers").select("id, naam").eq("rol", "monteur").is("verwijderd_op", null).order("naam"),
  ]);
  const tb = $("tbIngeklokt");
  if (error) { tb.innerHTML = rijLeeg(4, "Kon niet laden."); return; }

  $("telIngeklokt").textContent = (data || []).length ? "(" + data.length + ")" : "";
  tb.innerHTML = (data || []).length
    ? data.map((k) => `<tr><td class="sterk">${esc(k.medewerkers?.naam)}</td>
        <td class="mono">${esc(werkbonTekst(k.projecten))}</td>
        <td class="mono">${tijd(k.ingeklokt_op)}</td>
        <td><span class="badge groen"><span class="dot"></span> ${duurTekst(k.ingeklokt_op)}</span></td></tr>`).join("")
    : rijLeeg(4, "Niemand is nu ingeklokt.");

  const bezet = new Set((data || []).map((k) => k.medewerker_id));
  const vrij = (monteurs || []).filter((m) => !bezet.has(m.id));
  $("telNietIngeklokt").textContent = vrij.length ? "(" + vrij.length + ")" : "";
  $("chipsNiet").innerHTML = vrij.length
    ? vrij.map((m) => `<span class="chip">${esc(m.naam)}</span>`).join("")
    : `<span class="leeg">Iedereen is ingeklokt.</span>`;
}

// ── Urenregistratie ──────────────────────────────────────────────────────────
let _uren = [];
async function laadUren() {
  const { data, error } = await db.from("urenregels")
    .select("id, datum, start_tijd, eind_tijd, uren, km, pauze_onbetaald_min, pauze_betaald_min, status, omschrijving, medewerkers(naam), projecten(werkbon, naam)")
    .is("verwijderd_op", null).order("datum", { ascending: false }).order("start_tijd", { ascending: false }).limit(400);
  if (error) return;
  _uren = data || [];
  $("tbRecent").innerHTML = _uren.slice(0, 8).map(recentRij).join("") || rijLeeg(6, "Nog geen uren.");
  $("tbUren").innerHTML = _uren.map(urenRij).join("") || rijLeeg(11, "Nog geen uren.");
  document.querySelectorAll("[data-keur]").forEach((b) => b.addEventListener("click", () => keur(b.dataset.id, b.dataset.keur)));
}
function statusBadge(s) {
  const st = { onbeslist: "amber", goedgekeurd: "groen", afgekeurd: "rood" }[s] || "grijs";
  return `<span class="badge ${st}">${s}</span>`;
}
function recentRij(u) {
  return `<tr><td class="mono">${datum(u.datum)}</td><td class="sterk">${esc(u.medewerkers?.naam)}</td>
    <td class="mono">${esc(werkbonTekst(u.projecten))}</td>
    <td class="sterk mono">${Number(u.uren).toFixed(2)} u</td>
    <td>${statusBadge(u.status)}</td><td>${esc(u.omschrijving || "")}</td></tr>`;
}
function pauzeTekst(u) {
  const o = u.pauze_onbetaald_min || 0, b = u.pauze_betaald_min || 0;
  if (!o && !b) return "—";
  return (o ? o + "m" : "") + (o && b ? " / " : "") + (b ? b + "m betaald" : "");
}
function urenRij(u) {
  const actie = u.status === "onbeslist"
    ? `<td style="white-space:nowrap"><button class="btn btn-groen btn-klein" data-keur="goedgekeurd" data-id="${u.id}">Keur goed</button>
         <button class="btn btn-grijs btn-klein" data-keur="afgekeurd" data-id="${u.id}">Afkeuren</button></td>`
    : "<td></td>";
  return `<tr><td class="mono">${datum(u.datum)}</td><td class="sterk">${esc(u.medewerkers?.naam)}</td>
    <td class="mono">${esc(werkbonTekst(u.projecten))}</td>
    <td class="mono">${u.start_tijd ? tijd(u.start_tijd) : "—"}</td>
    <td class="mono">${u.eind_tijd ? tijd(u.eind_tijd) : "—"}</td>
    <td class="mono">${pauzeTekst(u)}</td>
    <td class="mono">${u.km != null ? u.km : "—"}</td>
    <td class="sterk mono">${Number(u.uren).toFixed(2)}</td>
    <td>${statusBadge(u.status)}</td>
    <td>${esc(u.omschrijving || "")}</td>${actie}</tr>`;
}
async function keur(id, status) {
  await db.from("urenregels").update({ status, nagekeken_op: new Date().toISOString() }).eq("id", id);
  await laadUren();
}
$("urenExport").addEventListener("click", () => {
  const rijen = _uren.map((u) => [
    u.datum, u.medewerkers?.naam || "", werkbonTekst(u.projecten),
    u.start_tijd ? tijd(u.start_tijd) : "", u.eind_tijd ? tijd(u.eind_tijd) : "",
    u.pauze_onbetaald_min || 0, u.pauze_betaald_min || 0, u.km != null ? u.km : "",
    Number(u.uren).toFixed(2), u.status, u.omschrijving || "",
  ]);
  csvDownload(["Datum", "Monteur", "Werkbon", "Start", "Eind", "Pauze onbetaald (min)", "Pauze betaald (min)", "Km", "Uren", "Status", "Omschrijving"], rijen, "uren");
});

// ── Verlof / afwezigheid ─────────────────────────────────────────────────────
async function laadVerlof() {
  const [{ data: mws }, { data }] = await Promise.all([
    db.from("medewerkers").select("id, naam").eq("rol", "monteur").is("verwijderd_op", null).order("naam"),
    db.from("afwezigheid").select("id, soort, van_datum, tot_datum, reden, status, medewerkers(naam)")
      .is("verwijderd_op", null).order("van_datum", { ascending: false }),
  ]);
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
      <td>${SOORT_LABEL[r.soort] || r.soort}</td>
      <td class="mono">${datum(r.van_datum)}</td><td class="mono">${datum(r.tot_datum)}</td>
      <td class="mono">${dagenTussen(r.van_datum, r.tot_datum)}</td>
      <td>${esc(r.reden || "")}</td><td>${statusBadge(r.status)}</td>
      <td style="white-space:nowrap">${actie}</td></tr>`;
  }).join("") : rijLeeg(8, "Nog geen verlof of afwezigheid.");

  document.querySelectorAll("[data-vkeur]").forEach((b) => b.addEventListener("click", async () => {
    await db.from("afwezigheid").update({ status: b.dataset.vkeur }).eq("id", b.dataset.id);
    laadVerlof();
  }));
  document.querySelectorAll("[data-vdel]").forEach((b) => b.addEventListener("click", async () => {
    await db.from("afwezigheid").update({ verwijderd_op: new Date().toISOString() }).eq("id", b.dataset.vdel);
    laadVerlof();
  }));
}
$("vToevoegen").addEventListener("click", async () => {
  const medewerker_id = $("vMedewerker").value, soort = $("vSoort").value;
  const van = $("vVan").value, tot = $("vTot").value || $("vVan").value;
  if (!medewerker_id || !van) return alert("Kies een monteur en een begindatum.");
  if (tot < van) return alert("De einddatum ligt vóór de begindatum.");
  const { error } = await db.from("afwezigheid").insert({
    medewerker_id, soort, van_datum: van, tot_datum: tot,
    reden: $("vReden").value.trim() || null, status: "goedgekeurd",
  });
  if (error) return alert("Mislukt: " + error.message);
  $("vReden").value = "";
  laadVerlof();
});

// ── Werkbonnen ──────────────────────────────────────────────────────────────
async function laadProjecten() {
  const { data } = await db.from("projecten").select("*").is("verwijderd_op", null).order("naam");
  window._projecten = data || [];
  $("telProjecten").textContent = (data || []).length ? "(" + data.length + ")" : "";
  $("tbProjecten").innerHTML = (data || []).map((p) =>
    `<tr><td class="mono sterk">${esc(p.werkbon || "—")}</td><td>${esc(p.naam)}</td>
     <td>${esc(p.locatie || "")}</td>
     <td>${p.lat != null ? `<span class="badge groen">binnen ${p.radius_m} m</span>` : `<span class="badge grijs">geen</span>`}</td>
     <td style="white-space:nowrap">
       <button class="btn btn-grijs btn-klein" data-loc-project="${p.id}" data-loc-adres="${esc(p.locatie || "")}" data-loc-naam="${esc(p.naam)}">Locatie</button>
       <button class="btn btn-grijs btn-klein" data-del-project="${p.id}">Verwijder</button>
     </td></tr>`
  ).join("") || rijLeeg(5, "Nog geen werkbonnen.");
  document.querySelectorAll("[data-del-project]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Deze werkbon verwijderen?")) return;
    await db.from("projecten").update({ verwijderd_op: new Date().toISOString() }).eq("id", b.dataset.delProject);
    laadProjecten();
  }));
  document.querySelectorAll("[data-loc-project]").forEach((b) => b.addEventListener("click", () => {
    const p = (window._projecten || []).find((x) => x.id === b.dataset.locProject) || {};
    openLocatieKiezer({ id: b.dataset.locProject, naam: b.dataset.locNaam, adres: b.dataset.locAdres || "", lat: p.lat, lng: p.lng, radius_m: p.radius_m });
  }));
}
$("pToevoegen").addEventListener("click", async () => {
  const naam = $("pNaam").value.trim();
  if (!naam) return alert("Geef de werkbon een naam.");
  let lat = parseFloat($("pLat").value), lng = parseFloat($("pLng").value);
  const locatie = $("pLocatie").value.trim();
  // Geen coördinaten maar wel adres? Dan automatisch opzoeken.
  if ((isNaN(lat) || isNaN(lng)) && locatie) {
    const r = await geocodeer(locatie).catch(() => null);
    if (r) { lat = r.lat; lng = r.lng; }
  }
  const { error } = await db.from("projecten").insert({
    werkbon: $("pWerkbon").value.trim() || null, naam,
    locatie: locatie || null, radius_m: parseInt($("pRadius").value) || 250,
    lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng, status: "lopend",
  });
  if (error) return alert("Mislukt: " + error.message);
  ["pWerkbon", "pNaam", "pLocatie", "pLat", "pLng"].forEach((id) => $(id).value = "");
  $("pRadius").value = 250;
  verberg($("pGeoMelding"));
  laadProjecten();
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
bouwUrenWeek("mUrenWeek", null);

let _medewerkers = [];
async function laadMedewerkers() {
  const { data } = await db.from("medewerkers").select("*").is("verwijderd_op", null).order("naam");
  _medewerkers = data || [];
  $("telMedewerkers").textContent = _medewerkers.length ? "(" + _medewerkers.length + ")" : "";
  $("tbMedewerkers").innerHTML = _medewerkers.map((m) => {
    const tot = urenWeekTotaal(m.contract_uren);
    const contract = m.contract_type
      ? `<span class="badge grijs">${CONTRACT_LABEL[m.contract_type] || m.contract_type}</span>` +
        (m.contract_eind ? ` <span class="mono" style="font-size:12px;color:var(--grijs)">t/m ${datum(m.contract_eind)}</span>` : "")
      : "—";
    return `<tr><td class="sterk">${esc(m.naam)}</td>
     <td><span class="badge grijs">${m.rol}</span></td>
     <td>${contract}</td>
     <td class="mono">${tot != null ? tot + " u" : "—"}</td>
     <td>${m.pin_hash ? '<span class="badge groen">ingesteld</span>' : '<span class="badge amber">geen pin</span>'}</td>
     <td style="white-space:nowrap">
       <button class="btn btn-grijs btn-klein" data-bewerk="${m.id}">Bewerken</button>
       <button class="btn btn-grijs btn-klein" data-pin="${m.id}" data-naam="${esc(m.naam)}">Pin wijzigen</button>
     </td></tr>`;
  }).join("") || rijLeeg(6, "Nog geen medewerkers.");
  document.querySelectorAll("[data-pin]").forEach((b) => b.addEventListener("click", async () => {
    const pin = prompt("Nieuwe pincode voor " + b.dataset.naam + " (4-6 cijfers):");
    if (!pin) return;
    const { error } = await db.rpc("set_pin", { p_medewerker: b.dataset.pin, p_pin: pin });
    if (error) return alert("Mislukt: " + error.message);
    laadMedewerkers();
  }));
  document.querySelectorAll("[data-bewerk]").forEach((b) => b.addEventListener("click", () => openMedewerker(b.dataset.bewerk)));
}
$("mToevoegen").addEventListener("click", async () => {
  const naam = $("mNaam").value.trim();
  const pin = $("mPin").value.trim();
  if (!naam) return alert("Vul een naam in.");
  const rij = {
    naam, rol: "monteur",
    contract_type: $("mContractType").value || null,
    contract_start: $("mContractStart").value || null,
    contract_eind: $("mContractEind").value || null,
    contract_uren: leesUrenWeek("mUrenWeek"),
  };
  let { data, error } = await db.from("medewerkers").insert(rij).select("id").single();
  if (error && /contract/i.test(error.message)) {
    // Contractkolommen bestaan nog niet (SQL-migratie niet gedraaid): sla dan zonder contract op.
    ({ data, error } = await db.from("medewerkers").insert({ naam, rol: "monteur" }).select("id").single());
    if (!error) alert("Let op: de contractvelden zijn nog niet opgeslagen omdat de database-migratie (contract-en-fix.sql) nog niet is uitgevoerd.");
  }
  if (error) return alert("Mislukt: " + error.message);
  if (/^\d{4,6}$/.test(pin)) await db.rpc("set_pin", { p_medewerker: data.id, p_pin: pin });
  $("mNaam").value = ""; $("mPin").value = ""; $("mContractStart").value = ""; $("mContractEind").value = "";
  $("mContractType").value = "vast";
  bouwUrenWeek("mUrenWeek", null);
  laadMedewerkers();
});

// Bewerk-venster
let medBewerkId = null;
function openMedewerker(id) {
  const m = _medewerkers.find((x) => x.id === id);
  if (!m) return;
  medBewerkId = id;
  $("medTitel").textContent = "Medewerker — " + m.naam;
  $("medNaam").value = m.naam || "";
  $("medGeboortedatum").value = m.geboortedatum || "";
  $("medContractType").value = m.contract_type || "";
  $("medContractStart").value = m.contract_start || "";
  $("medContractEind").value = m.contract_eind || "";
  bouwUrenWeek("medUrenWeek", m.contract_uren);
  verberg($("medMelding"));
  $("medModal").classList.remove("verborgen");
}
function sluitMedModal() { $("medModal").classList.add("verborgen"); }
$("medSluit").addEventListener("click", sluitMedModal);
$("medAnnuleer").addEventListener("click", sluitMedModal);
$("medModal").addEventListener("click", (e) => { if (e.target === $("medModal")) sluitMedModal(); });

$("medOpslaan").addEventListener("click", async () => {
  const naam = $("medNaam").value.trim();
  if (!naam) return toonMeld($("medMelding"), "fout", "De naam mag niet leeg zijn.");
  const { error } = await db.from("medewerkers").update({
    naam,
    geboortedatum: $("medGeboortedatum").value || null,
    contract_type: $("medContractType").value || null,
    contract_start: $("medContractStart").value || null,
    contract_eind: $("medContractEind").value || null,
    contract_uren: leesUrenWeek("medUrenWeek"),
  }).eq("id", medBewerkId);
  if (error) {
    const hint = /contract|geboortedatum/i.test(error.message)
      ? " (Draai eerst de database-migratie contract-en-fix.sql in de Supabase SQL-editor.)" : "";
    return toonMeld($("medMelding"), "fout", "Opslaan mislukt: " + error.message + hint);
  }
  sluitMedModal();
  laadMedewerkers();
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

// ── Rooster (weekplanning) ───────────────────────────────────────────────────
let weekStart = maandagVan(new Date());

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
    db.from("projecten").select("id, werkbon, naam").is("verwijderd_op", null).neq("status", "afgerond").order("naam"),
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

  const { data: plan } = await db.from("planning")
    .select("id, medewerker_id, datum, dagdeel, projecten(werkbon, naam)")
    .gte("datum", van).lte("datum", tot).is("verwijderd_op", null);

  const dagen = [...Array(7)].map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  document.querySelector("#rGrid thead").innerHTML =
    "<tr><th>Monteur</th>" + dagen.map((d, i) => `<th>${DAGEN[i]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}</th>`).join("") + "</tr>";

  document.querySelector("#rGrid tbody").innerHTML = mws.map((m) => {
    const cellen = dagen.map((d) => {
      const dat = isoDatum(d);
      const items = (plan || []).filter((p) => p.medewerker_id === m.id && p.datum === dat);
      const badges = items.map((p) =>
        `<span class="badge grijs" style="margin:1px 0;display:inline-flex;gap:4px">${esc(p.projecten?.werkbon || p.projecten?.naam || "?")} · ${DAGDEEL_LABEL[p.dagdeel] || p.dagdeel}
         <button data-plan-del="${p.id}" style="border:none;background:none;cursor:pointer;color:inherit;padding:0;font-weight:700">&times;</button></span>`
      ).join("<br>");
      return `<td>${badges || ""}</td>`;
    }).join("");
    return `<tr><td class="sterk">${esc(m.naam)}</td>${cellen}</tr>`;
  }).join("") || rijLeeg(8, "Nog geen monteurs.");

  document.querySelectorAll("[data-plan-del]").forEach((b) => b.addEventListener("click", async () => {
    await db.from("planning").update({ verwijderd_op: new Date().toISOString() }).eq("id", b.dataset.planDel);
    tekenWeek();
  }));
}

$("rInplannen").addEventListener("click", async () => {
  const medewerker_id = $("rMedewerker").value, project_id = $("rProject").value;
  const datum = $("rDatum").value, dagdeel = $("rDagdeel").value;
  if (!medewerker_id || !project_id || !datum) return alert("Kies monteur, datum en werkbon.");
  const { error } = await db.from("planning").insert({ medewerker_id, project_id, datum, dagdeel });
  if (error) return alert("Inplannen mislukt: " + error.message);
  weekStart = maandagVan(new Date(datum + "T12:00:00"));
  tekenWeek();
});
$("rVorige").addEventListener("click", () => { weekStart.setDate(weekStart.getDate() - 7); tekenWeek(); });
$("rVolgende").addEventListener("click", () => { weekStart.setDate(weekStart.getDate() + 7); tekenWeek(); });

// ── Rapportages ──────────────────────────────────────────────────────────────
let _rapMonteur = [];
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

async function toonRapport() {
  const van = $("rapVan").value, tot = $("rapTot").value;
  if (!van || !tot) return alert("Kies een periode.");
  const [{ data: uren }, { data: afw }] = await Promise.all([
    db.from("urenregels").select("datum, uren, km, medewerkers(naam), projecten(werkbon, naam)")
      .is("verwijderd_op", null).gte("datum", van).lte("datum", tot),
    db.from("afwezigheid").select("van_datum, tot_datum, medewerkers(naam)")
      .is("verwijderd_op", null).eq("status", "goedgekeurd").lte("van_datum", tot).gte("tot_datum", van),
  ]);

  // Per monteur
  const perM = {};
  (uren || []).forEach((u) => {
    const naam = u.medewerkers?.naam || "onbekend";
    perM[naam] = perM[naam] || { naam, dagen: new Set(), uren: 0, km: 0, verlof: 0 };
    perM[naam].dagen.add(u.datum);
    perM[naam].uren += Number(u.uren) || 0;
    perM[naam].km += Number(u.km) || 0;
  });
  (afw || []).forEach((a) => {
    const naam = a.medewerkers?.naam || "onbekend";
    perM[naam] = perM[naam] || { naam, dagen: new Set(), uren: 0, km: 0, verlof: 0 };
    perM[naam].verlof += overlapDagen(a.van_datum, a.tot_datum, van, tot);
  });
  _rapMonteur = Object.values(perM).sort((a, b) => a.naam.localeCompare(b.naam));
  $("tbRapMonteur").innerHTML = _rapMonteur.length ? _rapMonteur.map((m) =>
    `<tr><td class="sterk">${esc(m.naam)}</td><td class="mono">${m.dagen.size}</td>
     <td class="sterk mono">${m.uren.toFixed(2)}</td><td class="mono">${m.km || 0}</td>
     <td class="mono">${m.verlof || 0}</td></tr>`).join("") : rijLeeg(5, "Geen gegevens in deze periode.");

  // Per werkbon
  const perP = {};
  (uren || []).forEach((u) => {
    const key = (u.projecten?.werkbon || "—") + "|" + (u.projecten?.naam || "");
    perP[key] = perP[key] || { werkbon: u.projecten?.werkbon || "—", naam: u.projecten?.naam || "", uren: 0 };
    perP[key].uren += Number(u.uren) || 0;
  });
  const projRijen = Object.values(perP).sort((a, b) => b.uren - a.uren);
  $("tbRapProject").innerHTML = projRijen.length ? projRijen.map((p) =>
    `<tr><td class="mono sterk">${esc(p.werkbon)}</td><td>${esc(p.naam)}</td><td class="sterk mono">${p.uren.toFixed(2)}</td></tr>`).join("") : rijLeeg(3, "Geen gegevens in deze periode.");
}
$("rapExportMonteur").addEventListener("click", () => {
  if (!_rapMonteur.length) return alert("Toon eerst een overzicht.");
  const rijen = _rapMonteur.map((m) => [m.naam, m.dagen.size, m.uren.toFixed(2), m.km || 0, m.verlof || 0]);
  csvDownload(["Monteur", "Dagen gewerkt", "Uren", "Km", "Verlofdagen"], rijen, "rapport-" + $("rapVan").value + "_" + $("rapTot").value);
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
function dagenTussen(van, tot) {
  const d = Math.round((new Date(tot) - new Date(van)) / 86400000) + 1;
  return d > 0 ? d : 1;
}
function overlapDagen(van, tot, pVan, pTot) {
  const a = new Date(Math.max(new Date(van), new Date(pVan)));
  const b = new Date(Math.min(new Date(tot), new Date(pTot)));
  const d = Math.round((b - a) / 86400000) + 1;
  return d > 0 ? d : 0;
}
function toonMeld(el, soort, msg) { el.className = "melding" + (soort ? " " + soort : ""); el.textContent = msg; el.classList.remove("verborgen"); }
function vulSelect(id, paren) {
  const sel = $(id); const huidig = sel.value; sel.innerHTML = "";
  paren.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
  if (huidig) sel.value = huidig;
}
function werkbonTekst(p) { return p ? (p.werkbon ? p.werkbon + " · " : "") + p.naam : ""; }
function tijd(iso) { return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }); }
function datum(d) { return new Date(d).toLocaleDateString("nl-NL", { day: "2-digit", month: "short" }); }
function duurTekst(iso) { const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0"); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function rijLeeg(cols, msg) { return `<tr><td colspan="${cols}" class="leeg">${msg}</td></tr>`; }
function toon(el, m) { el.textContent = m; el.classList.remove("verborgen"); }
function verberg(el) { el.classList.add("verborgen"); }

// ============================================================================
//  Spaar Electra — Urenregistratie · beheer-dashboard
//  Beheerder logt in (Supabase e-mail/wachtwoord). "Nu ingeklokt" live,
//  uren bekijken/goedkeuren, werkbonnen en medewerkers beheren.
//  Bouwt voort op ../../admin.js, nu op Supabase.
// ============================================================================
import { beheerClient } from "./config.js";

const $ = (id) => document.getElementById(id);
const db = beheerClient();
let tikker = null;

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

// Sessie al actief?
(async function () {
  const { data } = await db.auth.getSession();
  if (data.session) naarDash();
})();

$("uitloggen").addEventListener("click", async () => { await db.auth.signOut(); location.reload(); });

async function naarDash() {
  $("login").classList.add("verborgen");
  $("dash").classList.remove("verborgen");
  $("uitloggen").classList.remove("verborgen");
  const { data } = await db.auth.getUser();
  if (data?.user) { $("wieBen").textContent = data.user.email; $("wieBen").classList.remove("verborgen"); }
  await Promise.all([laadIngeklokt(), laadUren(), laadProjecten(), laadMedewerkers(), laadRooster()]);
  if (tikker) clearInterval(tikker);
  tikker = setInterval(laadIngeklokt, 30000);
}

// ── Tabs ────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.remove("actief"));
  t.classList.add("actief");
  document.querySelectorAll("[data-view]").forEach((v) =>
    v.classList.toggle("verborgen", v.dataset.view !== t.dataset.tab));
}));

// ── Nu ingeklokt ────────────────────────────────────────────────────────────
async function laadIngeklokt() {
  const { data, error } = await db.from("kloksessies")
    .select("id, ingeklokt_op, medewerkers(naam), projecten(werkbon, naam)")
    .order("ingeklokt_op");
  const tb = $("tbIngeklokt");
  if (error) { tb.innerHTML = rijLeeg(4, "Kon niet laden."); return; }
  $("telIngeklokt").textContent = (data || []).length ? "(" + data.length + ")" : "";
  tb.innerHTML = (data || []).length
    ? data.map((k) => `<tr><td class="sterk">${esc(k.medewerkers?.naam)}</td>
        <td class="mono">${esc(werkbonTekst(k.projecten))}</td>
        <td class="mono">${tijd(k.ingeklokt_op)}</td>
        <td><span class="badge groen"><span class="dot"></span> ${duurTekst(k.ingeklokt_op)}</span></td></tr>`).join("")
    : rijLeeg(4, "Niemand is nu ingeklokt.");
}

// ── Uren (recent + alle) ────────────────────────────────────────────────────
async function laadUren() {
  const { data, error } = await db.from("v_urenregels").select("*").order("datum", { ascending: false }).limit(200);
  if (error) return;
  const rijen = (data || []);
  $("tbRecent").innerHTML = rijen.slice(0, 8).map(urenRij).join("") || rijLeeg(6, "Nog geen uren.");
  $("tbUren").innerHTML = rijen.map((u) => urenRij(u, true)).join("") || rijLeeg(7, "Nog geen uren.");
  // knoppen koppelen
  document.querySelectorAll("[data-keur]").forEach((b) => b.addEventListener("click", () => keur(b.dataset.id, b.dataset.keur)));
}
function urenRij(u, metActie) {
  const st = { onbeslist: "amber", goedgekeurd: "groen", afgekeurd: "rood" }[u.status] || "grijs";
  const actie = metActie && u.status === "onbeslist"
    ? `<td><button class="btn btn-groen btn-klein" data-keur="goedgekeurd" data-id="${u.id}">Keur goed</button>
         <button class="btn btn-grijs btn-klein" data-keur="afgekeurd" data-id="${u.id}">Afkeuren</button></td>`
    : (metActie ? "<td></td>" : "");
  return `<tr><td class="mono">${datum(u.datum)}</td><td class="sterk">${esc(u.medewerker_naam)}</td>
    <td class="mono">${esc(u.werkbon || "")} ${esc(u.project_naam)}</td>
    <td class="sterk mono">${Number(u.uren).toFixed(2)} u</td>
    <td><span class="badge ${st}">${u.status}</span></td>
    <td>${esc(u.omschrijving || "")}</td>${actie}</tr>`;
}
async function keur(id, status) {
  const { data: me } = await db.auth.getUser();
  await db.from("urenregels").update({
    status, nagekeken_op: new Date().toISOString(),
  }).eq("id", id);
  await laadUren();
}

// ── Werkbonnen ──────────────────────────────────────────────────────────────
async function laadProjecten() {
  const { data } = await db.from("projecten").select("*").is("verwijderd_op", null).order("naam");
  window._projecten = data || [];
  $("telProjecten").textContent = (data || []).length ? "(" + data.length + ")" : "";
  $("tbProjecten").innerHTML = (data || []).map((p) =>
    `<tr><td class="mono sterk">${esc(p.werkbon || "—")}</td><td>${esc(p.naam)}</td>
     <td>${esc(p.locatie || "")}</td>
     <td>${p.lat != null ? `<span class="badge groen">geofence ${p.radius_m}m</span>` : `<span class="badge grijs">geen</span>`}</td>
     <td style="white-space:nowrap">
       <button class="btn btn-grijs btn-klein" data-loc-project="${p.id}" data-loc-adres="${esc(p.locatie || "")}" data-loc-naam="${esc(p.naam)}">&#128205; Locatie</button>
       <button class="btn btn-grijs btn-klein" data-del-project="${p.id}">Verwijder</button>
     </td></tr>`
  ).join("") || rijLeeg(5, "Nog geen werkbonnen.");
  document.querySelectorAll("[data-del-project]").forEach((b) => b.addEventListener("click", async () => {
    await db.from("projecten").update({ verwijderd_op: new Date().toISOString() }).eq("id", b.dataset.delProject);
    laadProjecten();
  }));
  // Locatie instellen op een bestaande werkbon: kaart-kiezer openen
  document.querySelectorAll("[data-loc-project]").forEach((b) => b.addEventListener("click", () => {
    const p = (window._projecten || []).find((x) => x.id === b.dataset.locProject) || {};
    openLocatieKiezer({
      id: b.dataset.locProject,
      naam: b.dataset.locNaam,
      adres: b.dataset.locAdres || "",
      lat: p.lat, lng: p.lng, radius_m: p.radius_m,
    });
  }));
}
$("pToevoegen").addEventListener("click", async () => {
  const naam = $("pNaam").value.trim();
  if (!naam) return alert("Geef de werkbon een naam.");
  const lat = parseFloat($("pLat").value), lng = parseFloat($("pLng").value);
  const { error } = await db.from("projecten").insert({
    werkbon: $("pWerkbon").value.trim() || null,
    naam,
    locatie: $("pLocatie").value.trim() || null,
    radius_m: parseInt($("pRadius").value) || 250,
    lat: isNaN(lat) ? null : lat,
    lng: isNaN(lng) ? null : lng,
    status: "lopend",
  });
  if (error) return alert("Mislukt: " + error.message);
  ["pWerkbon", "pNaam", "pLocatie", "pLat", "pLng"].forEach((id) => $(id).value = "");
  laadProjecten();
});

// ── Medewerkers ─────────────────────────────────────────────────────────────
async function laadMedewerkers() {
  const { data } = await db.from("medewerkers").select("*").is("verwijderd_op", null).order("naam");
  $("telMedewerkers").textContent = (data || []).length ? "(" + data.length + ")" : "";
  $("tbMedewerkers").innerHTML = (data || []).map((m) =>
    `<tr><td class="sterk">${esc(m.naam)}</td>
     <td><span class="badge grijs">${m.rol}</span></td>
     <td>${m.pin_hash ? '<span class="badge groen">ingesteld</span>' : '<span class="badge amber">geen pin</span>'}</td>
     <td><button class="btn btn-grijs btn-klein" data-pin="${m.id}" data-naam="${esc(m.naam)}">Pin wijzigen</button></td></tr>`
  ).join("") || rijLeeg(4, "Nog geen medewerkers.");
  document.querySelectorAll("[data-pin]").forEach((b) => b.addEventListener("click", async () => {
    const pin = prompt("Nieuwe pincode voor " + b.dataset.naam + " (4-6 cijfers):");
    if (!pin) return;
    const { error } = await db.rpc("set_pin", { p_medewerker: b.dataset.pin, p_pin: pin });
    if (error) return alert("Mislukt: " + error.message);
    laadMedewerkers();
  }));
}
$("mToevoegen").addEventListener("click", async () => {
  const naam = $("mNaam").value.trim();
  const pin = $("mPin").value.trim();
  if (!naam) return alert("Vul een naam in.");
  const { data, error } = await db.from("medewerkers").insert({ naam, rol: "monteur" }).select("id").single();
  if (error) return alert("Mislukt: " + error.message);
  if (/^\d{4,6}$/.test(pin)) await db.rpc("set_pin", { p_medewerker: data.id, p_pin: pin });
  $("mNaam").value = ""; $("mPin").value = "";
  laadMedewerkers();
});

// ── Rooster (weekplanning, zoals Shiftbase) ─────────────────────────────────
let weekStart = maandagVan(new Date());

function maandagVan(d) {
  const x = new Date(d); const dag = (x.getDay() + 6) % 7; // ma=0
  x.setDate(x.getDate() - dag); x.setHours(0, 0, 0, 0);
  return x;
}
function isoDatum(d) {
  // lokale datum (niet UTC) — anders schuift de week 's zomers een dag op
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const DAGEN = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const DAGDEEL_LABEL = { hele_dag: "hele dag", ochtend: "ochtend", middag: "middag" };

async function laadRooster() {
  // selects vullen (monteurs + werkbonnen)
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

  // kop
  const dagen = [...Array(7)].map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  document.querySelector("#rGrid thead").innerHTML =
    "<tr><th>Monteur</th>" + dagen.map((d, i) => `<th>${DAGEN[i]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}</th>`).join("") + "</tr>";

  // rijen
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
  // spring naar de week van de geplande datum
  weekStart = maandagVan(new Date(datum + "T12:00:00"));
  tekenWeek();
});
$("rVorige").addEventListener("click", () => { weekStart.setDate(weekStart.getDate() - 7); tekenWeek(); });
$("rVolgende").addEventListener("click", () => { weekStart.setDate(weekStart.getDate() + 7); tekenWeek(); });

// ── Locatie instellen zoals Shiftbase: adres typen → coördinaten ────────────
// Geocoderen via OpenStreetMap Nominatim (gratis, geen sleutel).
async function geocodeer(adres) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl&q=" + encodeURIComponent(adres);
  const res = await fetch(url, { headers: { "Accept-Language": "nl" } });
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), naam: data[0].display_name };
}

// ── Kaart-kiezer (Leaflet): adres zoeken of speld slepen ────────────────────
let locMap = null, locMarker = null, locCirkel = null, locProjectId = null;
const AMS = [52.3676, 4.9041];

function openLocatieKiezer(p) {
  locProjectId = p.id;
  $("locTitel").textContent = "Locatie — " + p.naam;
  $("locAdres").value = p.adres || "";
  $("locRadius").value = p.radius_m || 250;
  verberg($("locMelding"));
  $("locModal").classList.remove("verborgen");

  const heeftPunt = p.lat != null && p.lng != null;
  const start = heeftPunt ? [p.lat, p.lng] : AMS;
  const zoom = heeftPunt ? 16 : 12;

  if (!locMap) {
    locMap = L.map("locKaart");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap",
    }).addTo(locMap);
    locMap.on("click", (e) => zetSpeld(e.latlng.lat, e.latlng.lng, false));
  }
  locMap.setView(start, zoom);
  if (heeftPunt) zetSpeld(p.lat, p.lng, false);
  else if (locMarker) { locMap.removeLayer(locMarker); locMap.removeLayer(locCirkel); locMarker = null; locCirkel = null; }

  // Leaflet moet z'n grootte opnieuw meten nadat de modal zichtbaar is
  setTimeout(() => locMap.invalidateSize(), 60);
}

function zetSpeld(lat, lng, herschik) {
  if (!locMarker) {
    locMarker = L.marker([lat, lng], { draggable: true }).addTo(locMap);
    locCirkel = L.circle([lat, lng], { radius: radiusNu(), color: "#e10410", weight: 1, fillColor: "#e10410", fillOpacity: .12 }).addTo(locMap);
    locMarker.on("drag", (e) => { const ll = e.target.getLatLng(); locCirkel.setLatLng(ll); });
  } else {
    locMarker.setLatLng([lat, lng]);
    locCirkel.setLatLng([lat, lng]);
  }
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
  } catch (_) {
    toonMeld(meld, "fout", "Opzoeken mislukt. Controleer je internetverbinding.");
  }
});
$("locAdres").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("locZoek").click(); } });

function sluitLocModal() { $("locModal").classList.add("verborgen"); }
$("locSluit").addEventListener("click", sluitLocModal);
$("locAnnuleer").addEventListener("click", sluitLocModal);
$("locModal").addEventListener("click", (e) => { if (e.target === $("locModal")) sluitLocModal(); });

$("locGeen").addEventListener("click", async () => {
  await db.from("projecten").update({ lat: null, lng: null, radius_m: radiusNu() }).eq("id", locProjectId);
  sluitLocModal();
  laadProjecten();
});

$("locOpslaan").addEventListener("click", async () => {
  if (!locMarker) return toonMeld($("locMelding"), "fout", "Zet eerst een speld op de kaart (zoek een adres of klik op de kaart).");
  const ll = locMarker.getLatLng();
  const upd = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), radius_m: radiusNu() };
  const adres = $("locAdres").value.trim();
  if (adres) upd.locatie = adres;
  const { error } = await db.from("projecten").update(upd).eq("id", locProjectId);
  if (error) return toonMeld($("locMelding"), "fout", "Opslaan mislukt: " + error.message);
  sluitLocModal();
  laadProjecten();
});

$("pZoekAdres").addEventListener("click", async () => {
  const adres = $("pLocatie").value.trim();
  const meld = $("pGeoMelding");
  if (!adres) { toonMeld(meld, "fout", "Typ eerst het adres in het veld Locatie."); return; }
  toonMeld(meld, "", "Adres opzoeken…");
  try {
    const r = await geocodeer(adres);
    if (!r) return toonMeld(meld, "fout", "Adres niet gevonden. Probeer het voluit, bv. \"Poortland 34, Amsterdam\".");
    $("pLat").value = r.lat.toFixed(6);
    $("pLng").value = r.lng.toFixed(6);
    toonMeld(meld, "ok", "Gevonden: " + r.naam);
  } catch (_) {
    toonMeld(meld, "fout", "Opzoeken mislukt. Controleer je internetverbinding.");
  }
});

// Huidige locatie in het werkbon-formulier zetten (geofence instellen op locatie)
$("pMijnLocatie").addEventListener("click", () => {
  if (!("geolocation" in navigator)) return alert("Geen GPS beschikbaar in deze browser.");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      $("pLat").value = p.coords.latitude.toFixed(6);
      $("pLng").value = p.coords.longitude.toFixed(6);
      toonMeld($("pGeoMelding"), "ok", "Huidige locatie ingevuld.");
    },
    () => alert("Kon je locatie niet bepalen. Zet locatietoegang aan voor deze site."),
    { enableHighAccuracy: true, timeout: 12000 },
  );
});

function toonMeld(el, soort, msg) {
  el.className = "melding" + (soort ? " " + soort : "");
  el.textContent = msg;
  el.classList.remove("verborgen");
}

function vulSelect(id, paren) {
  const sel = $(id); sel.innerHTML = "";
  paren.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
}

// ── Hulpjes ─────────────────────────────────────────────────────────────────
function werkbonTekst(p) { return p ? (p.werkbon ? p.werkbon + " · " : "") + p.naam : ""; }
function tijd(iso) { return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }); }
function datum(d) { return new Date(d).toLocaleDateString("nl-NL", { day: "2-digit", month: "short" }); }
function duurTekst(iso) { const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0"); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function rijLeeg(cols, msg) { return `<tr><td colspan="${cols}" class="leeg">${msg}</td></tr>`; }
function toon(el, m) { el.textContent = m; el.classList.remove("verborgen"); }
function verberg(el) { el.classList.add("verborgen"); }

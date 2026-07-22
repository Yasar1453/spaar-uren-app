// ============================================================================
//  Spaar Electra — Urenregistratie · monteur-app
//  Pincode → werkbon kiezen → inklokken (met GPS-check) → uitklokken.
//  Bouwt voort op de logica uit ../../werknemer.js, nu gekoppeld aan Supabase.
// ============================================================================
import { anonClient, monteurClient, PIN_LOGIN_URL } from "./config.js";

const $ = (id) => document.getElementById(id);
let db = null;            // ingelogde monteur-client
let mij = null;          // { medewerker_id, naam }
let openSessie = null;   // huidige open kloksessie (of null)
let tikker = null;

// ── Inlogscherm vullen met namen ────────────────────────────────────────────
(async function init() {
  try {
    const { data, error } = await anonClient().rpc("monteur_namen");
    if (error) throw error;
    const sel = $("naam");
    (data || []).forEach((m) => {
      const o = document.createElement("option");
      o.value = m.id; o.textContent = m.naam; sel.appendChild(o);
    });
  } catch (e) {
    toon($("inlogFout"), "Kon de namenlijst niet laden. Is de configuratie ingevuld?");
  }
})();

// ── Inloggen met pincode ────────────────────────────────────────────────────
$("inlogBtn").addEventListener("click", inloggen);
$("pin").addEventListener("keydown", (e) => { if (e.key === "Enter") inloggen(); });

async function inloggen() {
  const medewerker_id = $("naam").value;
  const pin = $("pin").value.trim();
  verberg($("inlogFout"));
  if (!medewerker_id) return toon($("inlogFout"), "Kies eerst je naam.");
  if (!/^\d{4,6}$/.test(pin)) return toon($("inlogFout"), "Vul je pincode in (4 tot 6 cijfers).");

  $("inlogBtn").disabled = true;
  try {
    const res = await fetch(PIN_LOGIN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ medewerker_id, pin }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || "Inloggen mislukt.");

    db = monteurClient(out.token);
    mij = { medewerker_id: out.medewerker_id, naam: out.naam };
    sessionStorage.setItem("spaar-uren-monteur", JSON.stringify({ token: out.token, mij }));
    await naarStatus();
  } catch (e) {
    toon($("inlogFout"), e.message);
  } finally {
    $("inlogBtn").disabled = false;
  }
}

// Sessie herstellen bij herladen
(function herstel() {
  const raw = sessionStorage.getItem("spaar-uren-monteur");
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    db = monteurClient(s.token); mij = s.mij;
    naarStatus();
  } catch (_) { sessionStorage.removeItem("spaar-uren-monteur"); }
})();

$("uitloggen").addEventListener("click", () => {
  sessionStorage.removeItem("spaar-uren-monteur");
  location.reload();
});

// ── Statusscherm ────────────────────────────────────────────────────────────
async function naarStatus() {
  $("inlog").classList.add("verborgen");
  $("status").classList.remove("verborgen");
  $("uitloggen").classList.remove("verborgen");
  $("mMenuKnop").classList.remove("verborgen");
  $("ladeNaam").textContent = mij.naam;
  await verversStatus();
  laadMijnVerlof();
}

// ── Inklapbaar menu ─────────────────────────────────────────────────────────
const MVIEW_TITEL = { klok: "Inklokken", verlof: "Verlof" };
$("mMenuKnop").addEventListener("click", () => $("mLade").classList.remove("verborgen"));
$("mLade").addEventListener("click", (e) => { if (e.target === $("mLade")) $("mLade").classList.add("verborgen"); });
document.querySelectorAll("[data-mnav]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-mnav]").forEach((x) => x.classList.remove("actief"));
  b.classList.add("actief");
  const view = b.dataset.mnav;
  document.querySelectorAll("[data-mview]").forEach((v) => v.classList.toggle("verborgen", v.dataset.mview !== view));
  $("mTitel").textContent = MVIEW_TITEL[view] || "";
  $("mLade").classList.add("verborgen");
  if (view === "verlof") laadMijnVerlof();
}));
$("ladeUitloggen").addEventListener("click", () => {
  sessionStorage.removeItem("spaar-uren-monteur");
  location.reload();
});

async function verversStatus() {
  verberg($("statusFout"));
  const { data, error } = await db.from("kloksessies").select("*").limit(1);
  if (error) return toon($("statusFout"), "Kon je status niet ophalen.");
  openSessie = (data && data[0]) || null;

  if (openSessie) toonIngeklokt();
  else await toonUitgeklokt();
}

function toonIngeklokt() {
  $("uitgeklokt").classList.add("verborgen");
  $("ingeklokt").classList.remove("verborgen");
  laadProjectNaam(openSessie.project_id).then((naam) => {
    $("ingeklokOp").textContent = "op " + naam + " · sinds " + tijd(openSessie.ingeklokt_op);
  });
  if (tikker) clearInterval(tikker);
  const upd = () => { $("lopendeDuur").textContent = duurTekst(openSessie.ingeklokt_op); };
  upd(); tikker = setInterval(upd, 1000 * 30);
}

async function toonUitgeklokt() {
  $("ingeklokt").classList.add("verborgen");
  $("uitgeklokt").classList.remove("verborgen");
  if (tikker) clearInterval(tikker);
  $("welkom").textContent = "Hoi " + mij.naam + " 👋";

  const sel = $("werkbon");
  sel.innerHTML = "";
  const { data, error } = await db.from("projecten")
    .select("id, werkbon, naam, lat, lng, radius_m")
    .is("verwijderd_op", null).neq("status", "afgerond").order("naam");
  if (error) return toon($("statusFout"), "Kon de werkbonnen niet laden.");
  window._projecten = data || [];
  (data || []).forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = (p.werkbon ? p.werkbon + " · " : "") + p.naam;
    sel.appendChild(o);
  });

  // Rooster: staat er voor vandaag een planning? Toon 'm en selecteer de werkbon vast.
  const nu = new Date();
  const vandaag = nu.getFullYear() + "-" + String(nu.getMonth() + 1).padStart(2, "0") + "-" + String(nu.getDate()).padStart(2, "0");
  const { data: plan } = await db.from("planning")
    .select("project_id, dagdeel, projecten(werkbon, naam)")
    .eq("datum", vandaag).is("verwijderd_op", null).limit(1);
  const banner = $("planBanner");
  if (plan && plan.length) {
    const p = plan[0];
    const naam = (p.projecten?.werkbon ? p.projecten.werkbon + " · " : "") + (p.projecten?.naam || "");
    const dd = { hele_dag: "hele dag", ochtend: "ochtend", middag: "middag" }[p.dagdeel] || p.dagdeel;
    banner.textContent = "📅 Vandaag sta je gepland op " + naam + " (" + dd + ").";
    banner.classList.remove("verborgen");
    if ([...sel.options].some((o) => o.value === p.project_id)) sel.value = p.project_id;
  } else {
    banner.classList.add("verborgen");
  }
}

// ── Inklokken (met GPS-geofence) ────────────────────────────────────────────
$("inklokBtn").addEventListener("click", async () => {
  const projectId = $("werkbon").value;
  const project = (window._projecten || []).find((p) => p.id === projectId);
  const gm = $("gpsMelding");
  if (!project) return toonMelding(gm, "fout", "Kies eerst een werkbon. Staat er geen? Vraag de beheerder er een aan te maken.");
  $("inklokBtn").disabled = true;

  try {
    let pos = null;
    if (project.lat != null && project.lng != null) {
      toonMelding(gm, "", "Locatie controleren…");
      pos = await locatie();
      const m = afstandMeter(pos.lat, pos.lng, project.lat, project.lng);
      if (m > (project.radius_m || 250)) {
        throw new Error("Je bent ~" + Math.round(m) + " m van de bouwplaats. Inklokken kan alleen op locatie.");
      }
    }
    const { error } = await db.from("kloksessies").insert({
      medewerker_id: mij.medewerker_id,
      project_id: projectId,
      in_lat: pos ? pos.lat : null,
      in_lng: pos ? pos.lng : null,
      in_bron: "app",
    });
    if (error) throw error;
    verberg(gm);
    await verversStatus();
  } catch (e) {
    toonMelding(gm, "fout", e.message);
  } finally {
    $("inklokBtn").disabled = false;
  }
});

// ── Uitklokken ──────────────────────────────────────────────────────────────
$("uitklokBtn").addEventListener("click", async () => {
  if (!openSessie) return;
  $("uitklokBtn").disabled = true;
  try {
    const start = new Date(openSessie.ingeklokt_op);
    const uren = Math.max(0.25, Math.round(((Date.now() - start.getTime()) / 3600000) * 4) / 4); // kwartier
    // Lokale kalenderdatum (niet UTC) — anders belandt een late/nachtdienst op de verkeerde dag.
    const datumLokaal = start.getFullYear() + "-" + String(start.getMonth() + 1).padStart(2, "0") + "-" + String(start.getDate()).padStart(2, "0");
    const { error: e1 } = await db.from("urenregels").insert({
      medewerker_id: mij.medewerker_id,
      project_id: openSessie.project_id,
      datum: datumLokaal,
      start_tijd: openSessie.ingeklokt_op,
      eind_tijd: new Date().toISOString(),
      uren,
      omschrijving: $("omschrijving").value.trim() || null,
      km: parseInt($("km").value) || null,
      bron: "klok",
      in_lat: openSessie.in_lat,
      in_lng: openSessie.in_lng,
      aangemaakt_door: mij.medewerker_id,
    });
    if (e1) throw e1;
    const { error: e2 } = await db.from("kloksessies").delete().eq("id", openSessie.id);
    if (e2) throw e2;
    $("omschrijving").value = "";
    $("km").value = "";
    await verversStatus();
  } catch (e) {
    toon($("statusFout"), "Uitklokken mislukt: " + e.message);
  } finally {
    $("uitklokBtn").disabled = false;
  }
});

// ── Verlof aanvragen ────────────────────────────────────────────────────────
const SOORT_LABEL = { vakantie: "Vakantie", ziek: "Ziek", onbetaald: "Onbetaald verlof", bijzonder: "Bijzonder verlof" };

$("vaVerstuur").addEventListener("click", async () => {
  const meld = $("verlofMelding");
  const soort = $("vaSoort").value;
  const van = $("vaVan").value, tot = $("vaTot").value || $("vaVan").value;
  if (!van) return toonMelding(meld, "fout", "Kies een begindatum.");
  if (tot < van) return toonMelding(meld, "fout", "De einddatum ligt vóór de begindatum.");
  $("vaVerstuur").disabled = true;
  try {
    const { error } = await db.from("afwezigheid").insert({
      medewerker_id: mij.medewerker_id, soort,
      van_datum: van, tot_datum: tot,
      reden: $("vaReden").value.trim() || null,
      status: "onbeslist",
      aangemaakt_door: mij.medewerker_id,
    });
    if (error) throw error;
    toonMelding(meld, "ok", "Aanvraag verstuurd. Je ziet hieronder de status zodra ernaar gekeken is.");
    $("vaVan").value = ""; $("vaTot").value = ""; $("vaReden").value = "";
    laadMijnVerlof();
  } catch (e) {
    toonMelding(meld, "fout", "Versturen mislukt: " + e.message);
  } finally {
    $("vaVerstuur").disabled = false;
  }
});

async function laadMijnVerlof() {
  const { data } = await db.from("afwezigheid")
    .select("soort, van_datum, tot_datum, status")
    .is("verwijderd_op", null).order("van_datum", { ascending: false }).limit(10);
  const el = $("mijnVerlof");
  if (!data || !data.length) { el.innerHTML = ""; return; }
  const badge = (s) => {
    const kleur = { onbeslist: "amber", goedgekeurd: "groen", afgekeurd: "rood" }[s] || "grijs";
    const tekst = { onbeslist: "in behandeling", goedgekeurd: "goedgekeurd", afgekeurd: "afgewezen" }[s] || s;
    return `<span class="badge ${kleur}">${tekst}</span>`;
  };
  el.innerHTML = `<label style="margin-top:0">Mijn aanvragen</label>` + data.map((r) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--lijn);font-size:14px">
       <span style="flex:1">${SOORT_LABEL[r.soort] || r.soort} · <span class="mono">${datumKort(r.van_datum)}${r.van_datum !== r.tot_datum ? " – " + datumKort(r.tot_datum) : ""}</span></span>
       ${badge(r.status)}
     </div>`).join("");
}
function datumKort(d) { return new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "2-digit", month: "short" }); }

// ── Hulpjes ─────────────────────────────────────────────────────────────────
async function laadProjectNaam(id) {
  const { data } = await db.from("projecten").select("werkbon, naam").eq("id", id).single();
  if (!data) return "onbekend project";
  return (data.werkbon ? data.werkbon + " · " : "") + data.naam;
}
function locatie() {
  return new Promise((res, rej) => {
    if (!("geolocation" in navigator)) return rej(new Error("Geen GPS beschikbaar op dit apparaat."));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => rej(new Error("Kon je locatie niet bepalen. Zet locatie aan en probeer opnieuw.")),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  });
}
function afstandMeter(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function tijd(iso) { return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }); }
function duurTekst(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return Math.floor(min / 60) + ":" + String(min % 60).padStart(2, "0");
}
function toon(el, msg) { el.textContent = msg; el.classList.remove("verborgen"); }
function verberg(el) { el.classList.add("verborgen"); }
function toonMelding(el, soort, msg) {
  el.className = "melding" + (soort ? " " + soort : "");
  el.textContent = msg; el.classList.remove("verborgen");
}

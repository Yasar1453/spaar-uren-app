// ============================================================================
//  Spaar Electra — Urenregistratie · monteur-app
//  Pincode → werkbon kiezen → inklokken (met GPS-check) → uitklokken.
//  Bouwt voort op de logica uit ../../werknemer.js, nu gekoppeld aan Supabase.
// ============================================================================
import { anonClient, monteurClient, PIN_LOGIN_URL, VAPID_PUBLIC } from "./config.js";

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
    toon($("inlogFout"), netfout(e, "Inloggen mislukt."));
  } finally {
    $("inlogBtn").disabled = false;
  }
}

// Maakt van een technische fout een begrijpelijke melding voor de bouwplaats.
function netfout(e, standaard) {
  const m = String(e?.message || e || "");
  if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test(m)) {
    return "Geen internetverbinding. Zoek even een plek met bereik en probeer opnieuw.";
  }
  return m || standaard;
}

// ── Registreren (eerste keer) ───────────────────────────────────────────────
$("naarRegistreer").addEventListener("click", () => {
  $("inlog").classList.add("verborgen");
  $("registreer").classList.remove("verborgen");
});
$("naarInlog").addEventListener("click", () => {
  $("registreer").classList.add("verborgen");
  $("inlog").classList.remove("verborgen");
});

$("regBtn").addEventListener("click", async () => {
  verberg($("regFout")); verberg($("regOk"));
  const voornaam = $("regVoornaam").value.trim();
  const achternaam = $("regAchternaam").value.trim();
  const email = $("regEmail").value.trim().toLowerCase();
  const wachtwoord = $("regWachtwoord").value;
  if (!voornaam || !achternaam) return toon($("regFout"), "Vul je voor- en achternaam in.");
  if (!/^[^@\s]+@spaarelectra\.nl$/.test(email)) return toon($("regFout"), "Gebruik je Spaar Electra-mailadres (eindigt op @spaarelectra.nl).");
  if (wachtwoord.length < 8) return toon($("regFout"), "Kies een wachtwoord van minimaal 8 tekens.");

  $("regBtn").disabled = true;
  try {
    const { data, error } = await anonClient().auth.signUp({
      email,
      password: wachtwoord,
      options: { data: { naam: voornaam + " " + achternaam } },
    });
    if (error) {
      const msg = /already registered|already exists/i.test(error.message)
        ? "Er bestaat al een account met dit e-mailadres."
        : "Registreren mislukt: " + error.message;
      return toon($("regFout"), msg);
    }
    const bevestigen = !data.session; // e-mailbevestiging vereist?
    toon($("regOk"), "Je account is aangemaakt en je staat nu bij de beheerder in de medewerkerslijst."
      + (bevestigen ? " Bevestig ook even je e-mailadres via de link in je inbox." : "")
      + " Zodra de beheerder je een pincode heeft gegeven, kun je hiernaast inloggen en inklokken.");
    $("regVoornaam").value = ""; $("regAchternaam").value = ""; $("regEmail").value = ""; $("regWachtwoord").value = "";
  } catch (e) {
    toon($("regFout"), "Registreren mislukt. Controleer je internetverbinding.");
  } finally {
    $("regBtn").disabled = false;
  }
});

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
  $("tabbalk").classList.remove("verborgen");
  document.getElementById("appWrap").classList.add("met-tabbalk");
  await verversStatus();
  laadMijnVerlof();
  laadHome();
  regelMeldingKaart();
}

// ── Push-meldingen (herinnering in/uit te klokken) ──────────────────────────
function pushOndersteund() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
async function regelMeldingKaart() {
  const kaart = $("meldKaart");
  if (!pushOndersteund()) { kaart.classList.add("verborgen"); return; }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    // Al aan (abonnement + toestemming)? Dan de kaart niet tonen.
    if (sub && Notification.permission === "granted") { kaart.classList.add("verborgen"); return; }
  } catch (_) {}
  kaart.classList.remove("verborgen");
}
function base64UrlNaarUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
$("meldAanBtn").addEventListener("click", async () => {
  const meld = $("meldMelding");
  if (!pushOndersteund()) return toonMelding(meld, "fout", "Meldingen werken niet in deze browser. Zet de app op je beginscherm en probeer opnieuw.");
  $("meldAanBtn").disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toonMelding(meld, "fout", "Meldingen zijn niet toegestaan. Zet ze aan in de instellingen van je telefoon."); return; }
    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlNaarUint8(VAPID_PUBLIC),
      });
    }
    const j = sub.toJSON();
    const { error } = await db.from("push_abonnementen").upsert({
      medewerker_id: mij.medewerker_id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    }, { onConflict: "endpoint" });
    if (error) throw error;
    toonMelding(meld, "ok", "Meldingen staan aan. Je krijgt een seintje als je vergeet in of uit te klokken.");
    setTimeout(() => $("meldKaart").classList.add("verborgen"), 2500);
  } catch (e) {
    toonMelding(meld, "fout", "Aanzetten mislukt: " + e.message);
  } finally {
    $("meldAanBtn").disabled = false;
  }
});

// ── Home-kaarten (zoals Shiftbase) ──────────────────────────────────────────
async function laadHome() {
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const vandaag = new Date();

  // Mijn rooster (eerstvolgende 3)
  try {
    const tot = new Date(); tot.setDate(tot.getDate() + 13);
    const { data } = await db.from("planning")
      .select("datum, dagdeel, projecten(werkbon, naam)")
      .gte("datum", iso(vandaag)).lte("datum", iso(tot))
      .is("verwijderd_op", null).order("datum").limit(3);
    const DD = { hele_dag: "hele dag", ochtend: "ochtend", middag: "middag" };
    $("homeRooster").innerHTML = (data && data.length)
      ? data.map((p) => {
          const d = new Date(p.datum + "T12:00:00");
          const naam = (p.projecten?.werkbon ? p.projecten.werkbon + " · " : "") + (p.projecten?.naam || "");
          return `<div class="lijst-rij">
            <div class="lijst-datum"><span class="ld-dag">${d.toLocaleDateString("nl-NL", { weekday: "short" })}</span><span class="ld-nr">${d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short" })}</span></div>
            <div class="lijst-body"><span class="lb-titel">${esc(naam)}</span><span class="lb-sub">${DD[p.dagdeel] || p.dagdeel}</span></div>
          </div>`;
        }).join("")
      : `<div class="leeg">Je rooster is leeg.</div>`;
    $("homeRoosterKaart").classList.remove("verborgen");
  } catch (_) {}

  // Mijn gewerkte uren (laatste 3)
  try {
    const { data } = await db.from("urenregels")
      .select("datum, start_tijd, eind_tijd, uren, projecten(werkbon, naam)")
      .is("verwijderd_op", null).order("datum", { ascending: false }).limit(3);
    $("homeUren").innerHTML = (data && data.length)
      ? data.map((u) => {
          const d = new Date(u.datum + "T12:00:00");
          const naam = (u.projecten?.werkbon ? u.projecten.werkbon + " · " : "") + (u.projecten?.naam || "");
          return `<div class="lijst-rij">
            <div class="lijst-datum"><span class="ld-dag">${d.toLocaleDateString("nl-NL", { weekday: "short" })}</span><span class="ld-nr">${d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short" })}</span></div>
            <div class="lijst-body"><span class="lb-titel">${(u.start_tijd ? tijd(u.start_tijd) : "—") + " – " + (u.eind_tijd ? tijd(u.eind_tijd) : "—")} · ${urenTekst(u.uren)}</span>
              <span class="lb-sub">${esc(naam)}</span></div>
          </div>`;
        }).join("")
      : `<div class="leeg">Nog geen geregistreerde uren.</div>`;
    $("homeUrenKaart").classList.remove("verborgen");
  } catch (_) {}

  // Mijn afwezigheid dit jaar (goedgekeurde dagen per soort)
  try {
    const jaar = vandaag.getFullYear();
    $("homeAfwTitel").textContent = "Mijn afwezigheid " + jaar;
    const { data } = await db.from("afwezigheid")
      .select("soort, van_datum, tot_datum, status").is("verwijderd_op", null);
    const perSoort = {};
    (data || []).filter((r) => r.status === "goedgekeurd" && r.van_datum.startsWith(String(jaar))).forEach((r) => {
      const dagen = werkdagenTussen(r.van_datum, r.tot_datum);
      perSoort[r.soort] = (perSoort[r.soort] || 0) + dagen;
    });
    const soorten = Object.keys(perSoort);
    $("homeAfw").innerHTML = soorten.length
      ? soorten.map((s) => `<span class="chip">${SOORT_LABEL[s] || s}: <b style="margin-left:4px">${perSoort[s]} ${perSoort[s] === 1 ? "dag" : "dagen"}</b></span>`).join("")
      : `<span class="leeg">Nog geen goedgekeurde afwezigheid in ${jaar}.</span>`;
    $("homeAfwKaart").classList.remove("verborgen");
  } catch (_) {}

  // Afwezigheid collega's (RPC; verschijnt pas als de databasefunctie bestaat)
  try {
    const { data, error } = await db.rpc("afwezigheid_collegas");
    if (!error && data) {
      $("homeCollegas").innerHTML = data.length
        ? data.slice(0, 6).map((r) => `<div class="lijst-rij">
            <div class="lijst-body"><span class="lb-titel">${esc(r.naam)}</span>
              <span class="lb-sub">${r.soort === "vakantie" ? "Vakantie" : "Afwezig"} · ${datumKort(r.van_datum)}${r.van_datum !== r.tot_datum ? " – " + datumKort(r.tot_datum) : ""}</span></div>
          </div>`).join("") + (data.length > 6 ? `<div class="leeg">+ ${data.length - 6} meer</div>` : "")
        : `<div class="leeg">Niemand afwezig.</div>`;
      $("homeCollegasKaart").classList.remove("verborgen");
    }
  } catch (_) {}

  // Verjaardagen (RPC; komende 60 dagen)
  try {
    const { data, error } = await db.rpc("verjaardagen");
    if (!error && data && data.length) {
      const nu = new Date(); nu.setHours(0, 0, 0, 0);
      const komend = data.map((p) => {
        const g = new Date(p.geboortedatum + "T12:00:00");
        const ditJaar = new Date(nu.getFullYear(), g.getMonth(), g.getDate());
        if (ditJaar < nu) ditJaar.setFullYear(ditJaar.getFullYear() + 1);
        return { naam: p.naam, dag: ditJaar, leeftijd: ditJaar.getFullYear() - g.getFullYear() };
      }).filter((p) => (p.dag - nu) / 86400000 <= 60).sort((a, b) => a.dag - b.dag);
      if (komend.length) {
        $("homeJarig").innerHTML = komend.slice(0, 5).map((p) => `<div class="lijst-rij">
          <div class="lijst-datum"><span class="ld-dag">${p.dag.toLocaleDateString("nl-NL", { weekday: "short" })}</span><span class="ld-nr">${p.dag.toLocaleDateString("nl-NL", { day: "2-digit", month: "short" })}</span></div>
          <div class="lijst-body"><span class="lb-titel">${esc(p.naam)}</span><span class="lb-sub">wordt ${p.leeftijd}</span></div>
        </div>`).join("");
        $("homeJarigKaart").classList.remove("verborgen");
      }
    }
  } catch (_) {}
}

// ── Tabbalk (zoals Shiftbase) ───────────────────────────────────────────────
const MVIEW_TITEL = { klok: "Inklokken", rooster: "Mijn rooster", uren: "Mijn uren", verlof: "Verlof" };
document.querySelectorAll("[data-mnav]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-mnav]").forEach((x) => x.classList.remove("actief"));
  b.classList.add("actief");
  const view = b.dataset.mnav;
  document.querySelectorAll("[data-mview]").forEach((v) => v.classList.toggle("verborgen", v.dataset.mview !== view));
  $("mTitel").textContent = MVIEW_TITEL[view] || "";
  if (view === "verlof") laadMijnVerlof();
  if (view === "rooster") laadMijnRooster();
  if (view === "uren") laadMijnUren();
}));

// ── Mijn rooster (komende 2 weken) ──────────────────────────────────────────
async function laadMijnRooster() {
  const el = $("mijnRooster");
  el.innerHTML = `<div class="leeg">Laden…</div>`;
  const van = new Date();
  const tot = new Date(); tot.setDate(tot.getDate() + 13);
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const { data, error } = await db.from("planning")
    .select("datum, dagdeel, projecten(werkbon, naam, locatie)")
    .gte("datum", iso(van)).lte("datum", iso(tot))
    .is("verwijderd_op", null).order("datum");
  if (error) { el.innerHTML = `<div class="leeg">Kon het rooster niet laden.</div>`; return; }
  if (!data || !data.length) { el.innerHTML = `<div class="leeg">Je staat de komende 2 weken niet ingepland.</div>`; return; }
  const DD = { hele_dag: "hele dag", ochtend: "ochtend", middag: "middag" };
  el.innerHTML = data.map((p) => {
    const d = new Date(p.datum + "T12:00:00");
    const dagNaam = d.toLocaleDateString("nl-NL", { weekday: "short" });
    const dagNr = d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short" });
    const naam = (p.projecten?.werkbon ? p.projecten.werkbon + " · " : "") + (p.projecten?.naam || "");
    return `<div class="lijst-rij">
      <div class="lijst-datum"><span class="ld-dag">${dagNaam}</span><span class="ld-nr">${dagNr}</span></div>
      <div class="lijst-body"><span class="lb-titel">${esc(naam)}</span>
        <span class="lb-sub">${DD[p.dagdeel] || p.dagdeel}${p.projecten?.locatie ? " · " + esc(p.projecten.locatie) : ""}</span></div>
    </div>`;
  }).join("");
}

// ── Eigen profiel (contracturen + verlofrecht) ──────────────────────────────
let _profiel;
async function haalMijnProfiel() {
  if (_profiel !== undefined) return _profiel;
  try {
    const { data, error } = await db.from("medewerkers")
      .select("contract_uren, verlof_dagen_per_jaar")
      .eq("id", mij.medewerker_id).single();
    _profiel = error ? null : data;
  } catch (_) { _profiel = null; }
  return _profiel;
}
function contractWeekUren(cu) {
  if (!cu) return null;
  const t = ["ma", "di", "wo", "do", "vr", "za", "zo"].reduce((s, d) => s + (parseFloat(cu[d]) || 0), 0);
  return t > 0 ? Math.round(t * 10) / 10 : null;
}

// ── Mijn uren (laatste 30 dagen + weektotalen) ──────────────────────────────
async function laadMijnUren() {
  const el = $("mijnUren");
  el.innerHTML = `<div class="leeg">Laden…</div>`;
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const van = new Date(); van.setDate(van.getDate() - 30);
  const { data, error } = await db.from("urenregels")
    .select("datum, start_tijd, eind_tijd, uren, km, status, omschrijving, projecten(werkbon, naam)")
    .gte("datum", iso(van)).is("verwijderd_op", null)
    .order("datum", { ascending: false }).order("start_tijd", { ascending: false }).limit(60);
  if (error) { el.innerHTML = `<div class="leeg">Kon je uren niet laden.</div>`; return; }

  // Weektotalen
  const nu = new Date();
  const maandag = new Date(nu); maandag.setDate(nu.getDate() - ((nu.getDay() + 6) % 7)); maandag.setHours(0, 0, 0, 0);
  const vorigeMa = new Date(maandag); vorigeMa.setDate(maandag.getDate() - 7);
  // afgekeurde regels tellen niet mee in de totalen (staan wel in de lijst, met badge)
  const telbaar = (data || []).filter((u) => u.status !== "afgekeurd");
  const dezeWeek = telbaar.filter((u) => u.datum >= iso(maandag)).reduce((s, u) => s + Number(u.uren || 0), 0);
  const vorigeWeek = telbaar.filter((u) => u.datum >= iso(vorigeMa) && u.datum < iso(maandag)).reduce((s, u) => s + Number(u.uren || 0), 0);
  $("urenDezeWeek").textContent = urenTekst(dezeWeek);
  $("urenVorigeWeek").textContent = urenTekst(vorigeWeek);

  // Plus/min-saldo t.o.v. contracturen (verschijnt alleen als contracturen zijn ingevuld)
  const profiel = await haalMijnProfiel();
  const contract = contractWeekUren(profiel?.contract_uren);
  if (contract != null) {
    const saldo = Math.round((vorigeWeek - contract) * 100) / 100;
    $("wtContract").textContent = urenTekst(contract);
    $("wtSaldo").textContent = (saldo >= 0 ? "+" : "-") + urenTekst(Math.abs(saldo));
    $("wtSaldo").style.color = saldo >= 0 ? "var(--groen)" : "var(--rood-donker)";
    $("saldoKaart").classList.remove("verborgen");
  } else {
    $("saldoKaart").classList.add("verborgen");
  }

  if (!data || !data.length) { el.innerHTML = `<div class="leeg">Nog geen uren in de laatste 30 dagen.</div>`; return; }
  const badge = (s) => {
    const kleur = { onbeslist: "amber", goedgekeurd: "groen", afgekeurd: "rood" }[s] || "grijs";
    const tekst = { onbeslist: "in behandeling", goedgekeurd: "goedgekeurd", afgekeurd: "afgekeurd" }[s] || s;
    return `<span class="badge ${kleur}">${tekst}</span>`;
  };
  el.innerHTML = data.map((u) => {
    const d = new Date(u.datum + "T12:00:00");
    const dagNaam = d.toLocaleDateString("nl-NL", { weekday: "short" });
    const dagNr = d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short" });
    const naam = (u.projecten?.werkbon ? u.projecten.werkbon + " · " : "") + (u.projecten?.naam || "");
    const tijden = (u.start_tijd ? tijd(u.start_tijd) : "—") + " – " + (u.eind_tijd ? tijd(u.eind_tijd) : "—");
    return `<div class="lijst-rij">
      <div class="lijst-datum"><span class="ld-dag">${dagNaam}</span><span class="ld-nr">${dagNr}</span></div>
      <div class="lijst-body"><span class="lb-titel">${tijden} · ${urenTekst(u.uren)}</span>
        <span class="lb-sub">${esc(naam)}${u.km ? " · " + u.km + " km" : ""}</span></div>
      <div>${badge(u.status)}</div>
    </div>`;
  }).join("");
}

async function verversStatus() {
  verberg($("statusFout"));
  const { data, error } = await db.from("kloksessies").select("*").limit(1);
  if (error) {
    // Verlopen token (na 12 uur)? Netjes terug naar het inlogscherm.
    if (/jwt|expired|token|401/i.test(error.message || "")) {
      sessionStorage.removeItem("spaar-uren-monteur");
      location.reload();
      return;
    }
    return toon($("statusFout"), "Kon je status niet ophalen.");
  }
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
  $("welkom").textContent = "Hoi " + mij.naam;

  const sel = $("werkbon");
  // lege eerste optie: de monteur moet BEWUST een werkbon kiezen — anders zou
  // een klik op Inklokken stilzwijgend de eerste werkbon (alfabetisch) pakken
  sel.innerHTML = '<option value=""></option>';
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
  kiesWerkbon(""); // start zonder keuze; het rooster mag 'm hieronder invullen

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
    banner.textContent = "Vandaag sta je gepland op " + naam + " (" + dd + ").";
    banner.classList.remove("verborgen");
    if ([...sel.options].some((o) => o.value === p.project_id)) { sel.value = p.project_id; kiesWerkbon(p.project_id); }
  } else {
    banner.classList.add("verborgen");
  }
}

// ── Mooie werkbon-keuzelijst met zoekveld ───────────────────────────────────
function kiesWerkbon(id) {
  $("werkbon").value = id || "";
  const p = (window._projecten || []).find((x) => x.id === id);
  const knop = $("werkbonKnop");
  if (p) {
    $("werkbonLabel").textContent = (p.werkbon ? p.werkbon + " · " : "") + p.naam;
    knop.classList.remove("leeg");
  } else {
    $("werkbonLabel").textContent = "Kies een werkbon…";
    knop.classList.add("leeg");
  }
}
function renderWerkbonOpties(filter) {
  const q = (filter || "").trim().toLowerCase();
  const gekozen = $("werkbon").value;
  const lijst = (window._projecten || []).filter((p) => {
    if (!q) return true;
    return ((p.werkbon || "") + " " + (p.naam || "")).toLowerCase().includes(q);
  });
  $("werkbonOpties").innerHTML = lijst.length
    ? lijst.map((p) => `<button type="button" class="kies-optie${p.id === gekozen ? " gekozen" : ""}" data-id="${p.id}">
        ${p.werkbon ? `<span class="nr">${esc(p.werkbon)}</span>` : ""}<span class="nm">${esc(p.naam)}</span></button>`).join("")
    : `<div class="kies-leeg">Geen werkbon gevonden</div>`;
}
$("werkbonKnop").addEventListener("click", () => {
  const paneel = $("werkbonPaneel");
  if (!paneel.classList.contains("verborgen")) { paneel.classList.add("verborgen"); return; }
  renderWerkbonOpties("");
  $("werkbonZoek").value = "";
  paneel.classList.remove("verborgen");
  setTimeout(() => $("werkbonZoek").focus(), 40);
});
$("werkbonZoek").addEventListener("input", (e) => renderWerkbonOpties(e.target.value));
$("werkbonOpties").addEventListener("click", (e) => {
  const b = e.target.closest(".kies-optie");
  if (!b) return;
  kiesWerkbon(b.dataset.id);
  $("werkbonPaneel").classList.add("verborgen");
});
document.addEventListener("click", (e) => {
  if ($("werkbonKies") && !$("werkbonKies").contains(e.target)) $("werkbonPaneel").classList.add("verborgen");
});

// ── Inklokken (met GPS-geofence) ────────────────────────────────────────────
$("inklokBtn").addEventListener("click", async () => {
  const projectId = $("werkbon").value;
  const project = (window._projecten || []).find((p) => p.id === projectId);
  const gm = $("gpsMelding");
  if (!project) return toonMelding(gm, "fout", "Kies eerst een werkbon. Staat er geen? Vraag de beheerder er een aan te maken.");
  $("inklokBtn").disabled = true;

  try {
    let pos = null;
    const heeftGeofence = project.lat != null && project.lng != null;
    toonMelding(gm, "", "Locatie bepalen…");
    // Altijd proberen de locatie vast te leggen, zodat de beheerder kan zien
    // waar er is ingeklokt. Zonder geofence is het optioneel (geen blokkade).
    try {
      pos = await locatie();
    } catch (e) {
      if (heeftGeofence) throw e; // bij een geofence is locatie verplicht
      pos = null;                 // zonder geofence: gewoon zonder locatie doorgaan
    }
    if (heeftGeofence && pos) {
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
    toonMelding(gm, "fout", netfout(e, "Inklokken mislukt."));
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
    // Exacte tijd op de minuut — geen kwartierafronding, geen minimum.
    const uren = urenUitMinuten(Math.round((Date.now() - start.getTime()) / 60000));
    // Lokale kalenderdatum (niet UTC) — anders belandt een late/nachtdienst op de verkeerde dag.
    const datumLokaal = start.getFullYear() + "-" + String(start.getMonth() + 1).padStart(2, "0") + "-" + String(start.getDate()).padStart(2, "0");
    // Als de urenregel bij een vorige poging al is opgeslagen (maar de sessie
    // sluiten mislukte), niet nogmaals boeken — anders staan de uren dubbel.
    const alGeboekt = sessionStorage.getItem("uitklok-" + openSessie.id);
    if (!alGeboekt) {
      const { error: e1 } = await db.from("urenregels").insert({
        medewerker_id: mij.medewerker_id,
        project_id: openSessie.project_id,
        datum: datumLokaal,
        start_tijd: openSessie.ingeklokt_op,
        eind_tijd: new Date().toISOString(),
        uren,
        omschrijving: $("omschrijving").value.trim() || null,
        km: Math.max(0, Math.round((parseFloat(String($("km").value).replace(",", ".")) || 0) * 10) / 10),
        bron: "klok",
        in_lat: openSessie.in_lat,
        in_lng: openSessie.in_lng,
        aangemaakt_door: mij.medewerker_id,
      });
      if (e1) throw e1;
      sessionStorage.setItem("uitklok-" + openSessie.id, "1");
    }
    const { error: e2 } = await db.from("kloksessies").delete().eq("id", openSessie.id);
    if (e2) throw e2;
    sessionStorage.removeItem("uitklok-" + openSessie.id);
    $("omschrijving").value = "";
    $("km").value = "";
    await verversStatus();
    laadHome();
  } catch (e) {
    toon($("statusFout"), netfout(e, "Uitklokken mislukt. Probeer het opnieuw."));
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
  // overlapcontrole: nog niet nogmaals aanvragen over dezelfde periode
  const { data: overlap } = await db.from("afwezigheid")
    .select("van_datum, tot_datum, status")
    .neq("status", "afgekeurd").is("verwijderd_op", null)
    .lte("van_datum", tot).gte("tot_datum", van).limit(1);
  if (overlap && overlap.length) {
    const o = overlap[0];
    return toonMelding(meld, "fout", "Je hebt al een aanvraag of goedgekeurd verlof van " + datumKort(o.van_datum) + " t/m " + datumKort(o.tot_datum) + ".");
  }
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
    .is("verwijderd_op", null).order("van_datum", { ascending: false }).limit(50);

  // Jaaroverzicht: goedgekeurde dagen per soort in het huidige jaar
  const jaar = new Date().getFullYear();
  const perSoort = {};
  (data || []).filter((r) => r.status === "goedgekeurd" && r.van_datum.startsWith(String(jaar))).forEach((r) => {
    const dagen = Math.max(1, Math.round((new Date(r.tot_datum) - new Date(r.van_datum)) / 86400000) + 1);
    perSoort[r.soort] = (perSoort[r.soort] || 0) + dagen;
  });
  const ov = $("verlofOverzicht");
  const soorten = Object.keys(perSoort);
  ov.innerHTML = soorten.length
    ? soorten.map((s) => `<span class="chip">${SOORT_LABEL[s] || s}: <b style="margin-left:4px">${perSoort[s]} ${perSoort[s] === 1 ? "dag" : "dagen"}</b></span>`).join("")
    : `<span class="leeg">Nog geen goedgekeurde afwezigheid in ${jaar}.</span>`;

  // Verlofsaldo (verschijnt alleen als de beheerder een jaarrecht heeft ingevuld)
  const profiel = await haalMijnProfiel();
  if (profiel?.verlof_dagen_per_jaar != null) {
    const recht = Number(profiel.verlof_dagen_per_jaar);
    const opgenomen = perSoort.vakantie || 0;
    const over = Math.round((recht - opgenomen) * 10) / 10;
    $("verlofSaldoTitel").textContent = "Verlofsaldo " + jaar;
    $("vsRecht").textContent = String(recht).replace(".", ",");
    $("vsOpgenomen").textContent = String(opgenomen);
    $("vsOver").textContent = String(over).replace(".", ",");
    $("vsOver").style.color = over >= 0 ? "var(--groen)" : "var(--rood-donker)";
    $("verlofSaldoKaart").classList.remove("verborgen");
  } else {
    $("verlofSaldoKaart").classList.add("verborgen");
  }

  const el = $("mijnVerlof");
  if (!data || !data.length) { el.innerHTML = ""; return; }
  const badge = (s) => {
    const kleur = { onbeslist: "amber", goedgekeurd: "groen", afgekeurd: "rood" }[s] || "grijs";
    const tekst = { onbeslist: "in behandeling", goedgekeurd: "goedgekeurd", afgekeurd: "afgekeurd" }[s] || s;
    return `<span class="badge ${kleur}">${tekst}</span>`;
  };
  el.innerHTML = `<label style="margin-top:0">Mijn aanvragen</label>` + data.map((r) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--lijn);font-size:14px">
       <span style="flex:1">${SOORT_LABEL[r.soort] || r.soort} · <span class="mono">${datumKort(r.van_datum)}${r.van_datum !== r.tot_datum ? " – " + datumKort(r.tot_datum) : ""}</span></span>
       ${badge(r.status)}
     </div>`).join("");
}
function datumKort(d) { return new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "2-digit", month: "short" }); }

// ── Uren: exact opslaan in decimalen, tonen als "2 u 16 min" ────────────────
function urenUitMinuten(min) { return Math.round((Math.max(0, min) / 60) * 100) / 100; }
function urenTekst(u) {
  const totaal = Math.round((Number(u) || 0) * 60);
  const h = Math.floor(totaal / 60), m = totaal % 60;
  if (!h && !m) return "0 min";
  if (!h) return m + " min";
  if (!m) return h + " u";
  return h + " u " + m + " min";
}

// ── Verlofdagen tellen: alleen werkdagen (za/zo en feestdagen tellen niet) ──
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
    `${jaar}-01-01`, iso(plus(pasen, -2)), iso(plus(pasen, 1)),
    iso(plus(pasen, 39)), iso(plus(pasen, 50)), `${jaar}-12-25`, `${jaar}-12-26`,
  ]);
  const kd = new Date(jaar, 3, 27);
  set.add(iso(kd.getDay() === 0 ? plus(kd, -1) : kd));
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
    if (dag === 0 || dag === 6) continue;
    const s = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    if (feestdagen(d.getFullYear()).has(s)) continue;
    n++;
  }
  return n;
}

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
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function toonMelding(el, soort, msg) {
  el.className = "melding" + (soort ? " " + soort : "");
  el.textContent = msg; el.classList.remove("verborgen");
}

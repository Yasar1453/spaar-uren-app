// ============================================================================
//  Spaar Electra — Urenregistratie · monteur-app
//  Pincode → werkbon kiezen → inklokken (met GPS-check) → uitklokken.
//  Bouwt voort op de logica uit ../../werknemer.js, nu gekoppeld aan Supabase.
// ============================================================================
import { monteurClient, VAPID_PUBLIC } from "./config.js?v=46";
import { icoon } from "./iconen.js?v=46";
import { bouwNieuwsMonteur } from "./communicatie.js?v=46";
import { bouwRoosterMonteur } from "./rooster-extra.js?v=46";

const $ = (id) => document.getElementById(id);
const db = monteurClient();   // eigen sessie, blijft bewaard tussen bezoeken
let mij = null;          // { medewerker_id, naam }
let openSessie = null;   // huidige open kloksessie (of null)
let tikker = null;

// ── Inloggen met e-mail en wachtwoord ───────────────────────────────────────
$("inlogBtn").addEventListener("click", inloggen);
$("inlogWachtwoord").addEventListener("keydown", (e) => { if (e.key === "Enter") inloggen(); });

async function inloggen() {
  const email = $("inlogEmail").value.trim().toLowerCase();
  const wachtwoord = $("inlogWachtwoord").value;
  verberg($("inlogFout"));
  if (!email || !wachtwoord) return toon($("inlogFout"), "Vul je e-mail en wachtwoord in.");

  $("inlogBtn").disabled = true;
  try {
    const { error } = await db.auth.signInWithPassword({ email, password: wachtwoord });
    if (error) {
      const m = /email not confirmed/i.test(error.message)
        ? "Je hebt je e-mailadres nog niet bevestigd. Open de link in de mail die je van ons kreeg."
        : /invalid login/i.test(error.message)
          ? "E-mail of wachtwoord klopt niet."
          : netfout(error, "Inloggen mislukt.");
      return toon($("inlogFout"), m);
    }
    if (!(await haalMijOp())) return;
    $("inlogWachtwoord").value = "";
    await naarStatus();
  } catch (e) {
    toon($("inlogFout"), netfout(e, "Inloggen mislukt."));
  } finally {
    $("inlogBtn").disabled = false;
  }
}

// Zoekt het medewerkersrecord dat bij het ingelogde account hoort
async function haalMijOp() {
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return false;
  const { data, error } = await db.from("medewerkers")
    .select("id, naam").eq("auth_user_id", auth.user.id).is("verwijderd_op", null).maybeSingle();
  if (error && !/[Rr]esults contain 0 rows|PGRST116/.test(error.message || "")) {
    // Netwerkstoring: de sessie laten staan, anders moet de monteur op de
    // bouwplaats opnieuw inloggen met een wachtwoord dat hij niet paraat heeft.
    toon($("inlogFout"), netfout(error, "Verbinding mislukt. Probeer het zo nog eens."));
    return false;
  }
  if (!data) {
    await db.auth.signOut();
    // RLS verbergt de rij zowel bij "geblokkeerd" als bij "nog niet gekoppeld";
    // de app kan die twee niet uit elkaar houden, dus houden we het algemeen.
    toon($("inlogFout"), "Dit account hoort nog niet bij een medewerker, of is geblokkeerd. Neem contact op met kantoor.");
    return false;
  }
  mij = { medewerker_id: data.id, naam: data.naam };
  return true;
}

// Maakt van een technische fout een begrijpelijke melding voor de bouwplaats.
function netfout(e, standaard) {
  const m = String(e?.message || e || "");
  const code = e?.code || "";
  if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test(m)) {
    return "Geen internetverbinding. Zoek even een plek met bereik en probeer opnieuw.";
  }
  // Bekende databasefouten vertalen. Zonder dit kreeg de monteur letterlijk
  // "duplicate key value violates unique constraint" te zien.
  if (code === "23505") return "Dit is al geregistreerd. Ververs de app om de actuele stand te zien.";
  if (code === "23514") return "Deze gegevens kloppen niet. Neem contact op met kantoor.";
  if (code === "42501") return "Je hebt hier geen toegang toe. Neem contact op met kantoor.";
  return standaard || m;
}

// Zelfregistratie is vervallen: kantoor legt de medewerker aan en stuurt een
// uitnodigingslink (aanmelden.html), waar de monteur zijn wachtwoord instelt.

$("vaSoort").addEventListener("change", toonSoortIcoon);

// ── Ruimte onder de laatste kaart ───────────────────────────────────────────
//  De tabbalk zweeft boven de pagina, dus de inhoud heeft onderaan evenveel
//  ruimte nodig als de balk hoog is. Die hoogte is niet vast: hij groeit mee
//  met de thuisknop-balk van de iPhone en met een grotere systeemletter. Een
//  vast getal in de stijl viel daardoor op de ene telefoon te krap uit en
//  schoof de laatste kaart onder de balk. Daarom meten we hem gewoon.
function stelRuimteOnderIn() {
  const balk = $("tabbalk"), wrap = $("appWrap");
  if (!balk || !wrap || balk.classList.contains("verborgen")) return;
  wrap.style.paddingBottom = Math.round(balk.getBoundingClientRect().height) + 24 + "px";
}
addEventListener("resize", stelRuimteOnderIn);
addEventListener("orientationchange", stelRuimteOnderIn);
if (window.ResizeObserver && $("tabbalk")) new ResizeObserver(stelRuimteOnderIn).observe($("tabbalk"));

// ── Zonder bereik kunnen starten ────────────────────────────────────────────
//  De service worker werd tot nu toe pas geregistreerd als de monteur meldingen
//  aanzette, dus de meesten hadden er geen. Daardoor haalde de app haar code bij
//  elke start van het net en bleef het scherm leeg op een bouwplaats zonder
//  signaal. Nu meteen registreren; de meldingen komen er los bij.
if ("serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* niet fataal */ });
  });
}

// ── Zelf bijwerken ──────────────────────────────────────────────────────────
//  GitHub Pages geeft de HTML tien minuten cache mee en de pagina kan zichzelf
//  niet cache-bustend laden. Een monteur die de app op zijn beginscherm heeft
//  staan blijft daardoor op een oude versie hangen. Daarom vragen we bij het
//  starten het versienummer op (langs de cache heen) en herladen we eenmalig
//  als er iets nieuwers staat. De vlag in sessionStorage voorkomt een lus als
//  het herladen om welke reden dan ook niet aanslaat.
const APP_VERSIE = 46;
async function controleerVersie() {
  try {
    const r = await fetch("versie.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const { versie } = await r.json();
    if (!(versie > APP_VERSIE)) { sessionStorage.removeItem("spaar-herladen"); return; }
    // De vlag bevat het versienummer, niet een kale "1". Anders bleef hij na
    // een mislukte controle staan en werd élke volgende versie overgeslagen —
    // op een telefoon met de app op het beginscherm dagen tot weken lang.
    if (sessionStorage.getItem("spaar-herladen") === String(versie)) return;
    sessionStorage.setItem("spaar-herladen", String(versie));
    location.replace(location.pathname + "?v=" + versie);
  } catch (_) { /* geen bereik: gewoon doorwerken op wat er staat */ }
}
controleerVersie();

// Al ingelogd? Meteen door naar het klokscherm.
(async function herstel() {
  const { data } = await db.auth.getSession();
  if (!data.session) return;
  if (await haalMijOp()) naarStatus();
})();

$("uitloggen").addEventListener("click", async () => {
  await db.auth.signOut();
  location.reload();
});

// ── Statusscherm ────────────────────────────────────────────────────────────
async function naarStatus() {
  $("inlog").classList.add("verborgen");
  $("status").classList.remove("verborgen");
  $("uitloggen").classList.remove("verborgen");
  $("tabbalk").classList.remove("verborgen");
  $("appWrap").classList.add("met-tabbalk");
  stelRuimteOnderIn();
  await verversStatus();
  await vulVerlofSoorten();
  laadMijnVerlof();
  laadHome();
  regelMeldingKaart();

  // monteur.js noemt zijn meldingfunctie toonMelding; de module verwacht
  // toonMeld, dus die geven we onder de juiste naam door.
  bouwNieuwsMonteur(db, {
    esc, netfout, toonMeld: toonMelding,
    mijnId: () => (mij ? mij.medewerker_id : null),
  }).laad();
  bouwRoosterMonteur(db, { esc, netfout, toonMelding, mij: () => mij });
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
    const { data, error } = await db.from("planning")
      .select("datum, dagdeel, projecten(werkbon, naam)")
      .eq("medewerker_id", mij.medewerker_id)
      .gte("datum", iso(vandaag)).lte("datum", iso(tot))
      .is("verwijderd_op", null).order("datum").limit(3);
    if (error) { $("homeRooster").innerHTML = `<div class="leeg">Kon je rooster niet laden. Probeer het zo nog eens.</div>`; $("homeRoosterKaart").classList.remove("verborgen"); return; }
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
    const { data, error } = await db.from("urenregels")
      .select("datum, start_tijd, eind_tijd, uren, projecten(werkbon, naam)")
      .eq("medewerker_id", mij.medewerker_id).is("verwijderd_op", null).order("datum", { ascending: false }).limit(3);
    if (error) { $("homeUren").innerHTML = `<div class="leeg">Kon je uren niet laden. Probeer het zo nog eens.</div>`; $("homeUrenKaart").classList.remove("verborgen"); return; }
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
    const { data, error } = await db.from("afwezigheid")
      .select("soort, van_datum, tot_datum, status")
      .eq("medewerker_id", mij.medewerker_id).is("verwijderd_op", null);
    if (error) { $("homeAfw").innerHTML = `<div class="leeg">Kon je afwezigheid niet laden.</div>`; $("homeAfwKaart").classList.remove("verborgen"); return; }
    const perSoort = {};
    (data || []).filter((r) => r.status === "goedgekeurd" && r.tot_datum >= jaar + "-01-01" && r.van_datum <= jaar + "-12-31").forEach((r) => {
      const dagen = werkdagenTussen(r.van_datum, r.tot_datum);
      perSoort[r.soort] = (perSoort[r.soort] || 0) + dagen;
    });
    const soorten = Object.keys(perSoort);
    $("homeAfw").innerHTML = soorten.length
      ? soorten.map((s) => `<span class="chip">${typeLabel(s)}: <b style="margin-left:4px">${perSoort[s]} ${perSoort[s] === 1 ? "dag" : "dagen"}</b></span>`).join("")
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

  // Verjaardagen (komende 60 dagen).
  //  De RPC geeft bewust alleen dag en maand terug, geen jaartal: de volledige
  //  geboortedatum is het bewijsmiddel waarmee een monteur zich bij het
  //  aanmelden legitimeert. Daarom staat de leeftijd hier niet meer bij.
  try {
    const { data, error } = await db.rpc("verjaardagen");
    if (error) { $("homeJarig").innerHTML = '<div class="leeg">Verjaardagen konden niet worden geladen.</div>'; $("homeJarigKaart").classList.remove("verborgen"); }
    else if (data && data.length) {
      const nu = new Date(); nu.setHours(0, 0, 0, 0);
      const komend = data.map((p) => {
        // 29 februari bestaat niet elk jaar; new Date(2026,1,29) wordt 1 maart.
        const schrikkel = p.maand === 2 && p.dag === 29;
        const dagInJaar = (j) => new Date(j, p.maand - 1,
          schrikkel && !(j % 4 === 0 && (j % 100 !== 0 || j % 400 === 0)) ? 28 : p.dag);
        const ditJaar = dagInJaar(nu.getFullYear());
        const dag = ditJaar < nu ? dagInJaar(nu.getFullYear() + 1) : ditJaar;
        return { naam: p.naam, dag };
      }).filter((p) => (p.dag - nu) / 86400000 <= 60).sort((a, b) => a.dag - b.dag);
      if (komend.length) {
        $("homeJarig").innerHTML = komend.slice(0, 5).map((p) => `<div class="lijst-rij">
          <div class="lijst-datum"><span class="ld-dag">${p.dag.toLocaleDateString("nl-NL", { weekday: "short" })}</span><span class="ld-nr">${p.dag.toLocaleDateString("nl-NL", { day: "2-digit", month: "short" })}</span></div>
          <div class="lijst-body"><span class="lb-titel">${esc(p.naam)}</span><span class="lb-sub">jarig</span></div>
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
  if (view === "verlof") { vulVerlofSoorten(); laadMijnVerlof(); }
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
    .eq("medewerker_id", mij.medewerker_id)
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
    // Een storing niet cachen als "geen gegevens": dan verdwijnt de plus/min-
    // kaart de rest van de sessie zonder dat iemand weet waarom.
    if (error) return null;
    _profiel = data;
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
    .eq("medewerker_id", mij.medewerker_id)
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
  const { data, error } = await db.from("kloksessies").select("*").eq("medewerker_id", mij.medewerker_id).limit(1);
  if (error) {
    // Sessie verlopen? Netjes terug naar het inlogscherm.
    if (/jwt|expired|token|401/i.test(error.message || "")) {
      await db.auth.signOut();
      location.reload();
      return;
    }
    return toon($("statusFout"), netfout(error, "Kon je status niet ophalen."));
  }
  openSessie = (data && data[0]) || null;

  if (openSessie) toonIngeklokt();
  else await toonUitgeklokt();
}

// Pauzetijden ophalen (voor het voorbeeld dat de monteur ziet)
let _pauzes = null;
async function haalPauzes() {
  if (_pauzes) return _pauzes;
  const { data, error } = await db.from("pauze_instellingen").select("van_tijd, tot_tijd, betaald").eq("actief", true);
  // Bij een fout NIET cachen: [] is truthy, dus een eenmalige bereikdip zou
  // de pauzeaftrek voor de rest van de dag uit het voorbeeld halen — terwijl
  // de database hem wel toepast.
  if (error) return [];
  _pauzes = data || [];
  return _pauzes;
}
// Minuten die van de gewerkte tijd afgaan door onbetaalde pauzes
function pauzeMinuten(start, eind, pauzes) {
  const opDag = (d, tijd) => {
    const [u, m] = String(tijd).split(":").map(Number);
    const x = new Date(d); x.setHours(u, m, 0, 0); return x;
  };
  return (pauzes || []).filter((p) => !p.betaald).reduce((som, p) => {
    const van = opDag(start, p.van_tijd), tot = opDag(start, p.tot_tijd);
    const overlap = Math.min(eind, tot) - Math.max(start, van);
    return som + Math.max(0, Math.floor(overlap / 60000));
  }, 0);
}
// Toont: "Wordt geboekt: 8 u (9 u gewerkt − 1 u pauze)"
async function toonBoekVoorbeeld() {
  const vak = $("boekVoorbeeld");
  if (!openSessie) { vak.classList.add("verborgen"); return; }
  const pauzes = await haalPauzes();
  const start = new Date(openSessie.ingeklokt_op), nu = new Date();
  const gewerkt = Math.max(0, Math.round((nu - start) / 60000));
  const pauze = Math.min(gewerkt, pauzeMinuten(start, nu, pauzes));
  const netto = urenUitMinuten(gewerkt - pauze);
  vak.innerHTML = pauze > 0
    ? `<b>Wordt geboekt: ${urenTekst(netto)}</b><span>${urenTekst(urenUitMinuten(gewerkt))} gewerkt − ${pauze} min pauze</span>`
    : `<b>Wordt geboekt: ${urenTekst(netto)}</b>`;
  vak.classList.remove("verborgen");
}

function toonIngeklokt() {
  $("uitgeklokt").classList.add("verborgen");
  $("ingeklokt").classList.remove("verborgen");
  laadProjectNaam(openSessie.project_id).then((naam) => {
    $("ingeklokOp").textContent = "op " + naam + " · sinds " + tijd(openSessie.ingeklokt_op);
  });
  if (tikker) clearInterval(tikker);
  const upd = () => { $("lopendeDuur").textContent = duurTekst(openSessie.ingeklokt_op); toonBoekVoorbeeld(); };
  upd(); tikker = setInterval(upd, 1000 * 30);
}

async function toonUitgeklokt() {
  $("boekVoorbeeld").classList.add("verborgen");
  $("ingeklokt").classList.add("verborgen");
  $("uitgeklokt").classList.remove("verborgen");
  if (tikker) clearInterval(tikker);
  $("welkom").textContent = "Hoi " + mij.naam;

  const sel = $("werkbon");
  // lege eerste optie: de monteur moet BEWUST een werkbon kiezen — anders zou
  // een klik op Inklokken stilzwijgend de eerste werkbon (alfabetisch) pakken
  sel.innerHTML = '<option value=""></option>';
  const { data, error } = await db.from("projecten")
    .select("id, werkbon, naam, lat, lng, radius_m, kleur")
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
    .eq("medewerker_id", mij.medewerker_id)
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
    $("werkbonLabel").innerHTML = `<span class="wb-stip" style="background:${kleurVan(p)}"></span>` + esc((p.werkbon ? p.werkbon + " · " : "") + p.naam);
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
    ? lijst.map((p) => `<button type="button" class="kies-optie${p.id === gekozen ? " gekozen" : ""}" data-id="${p.id}" style="border-left:4px solid ${esc(kleurVan(p))}">
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
$("inklokBtn").addEventListener("click", () => klokIn($("werkbon").value, $("gpsMelding"), $("inklokBtn")));

// Losgetrokken uit de knop, want het wisselen van werkbon gebruikt hetzelfde:
// uitklokken op de ene bon en meteen inklokken op de volgende.
async function klokIn(projectId, gm, knop) {
  const project = (window._projecten || []).find((p) => p.id === projectId);
  if (!project) { toonMelding(gm, "fout", "Kies eerst een werkbon. Staat er geen? Vraag de beheerder er een aan te maken."); return false; }
  if (knop) knop.disabled = true;

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
    return true;
  } catch (e) {
    // Bij een dubbele poging (23505) is hij in werkelijkheid wél ingeklokt:
    // het antwoord op de eerste poging kwam alleen niet terug. Meteen de echte
    // stand ophalen in plaats van "mislukt" tonen.
    if (e && e.code === "23505") { await verversStatus(); return true; }
    toonMelding(gm, "fout", netfout(e, "Inklokken mislukt."));
    return false;
  } finally {
    if (knop) knop.disabled = false;
  }
}

// Het invoerveld staat op type="text" met een decimaal toetsenbord: bij
// type="number" levert de browser voor "24,5" een lege string, waardoor een rit
// zonder waarschuwing als 0 km werd geboekt.
function kmWaarde() {
  const ruw = String($("km").value).trim().replace(",", ".");
  const n = parseFloat(ruw);
  return isNaN(n) || n < 0 ? 0 : Math.round(n * 10) / 10;
}

// ── Uitklokken ──────────────────────────────────────────────────────────────
$("uitklokBtn").addEventListener("click", () => klokUit());

// Ook losgetrokken: het wisselen van werkbon boekt eerst deze bon af.
async function klokUit(daarnaWisselen = false) {
  if (!openSessie) return false;
  $("uitklokBtn").disabled = true;
  try {
    const start = new Date(openSessie.ingeklokt_op);
    let eind = new Date();
    // Vergeten uit te klokken? Dan is "nu" niet de eindtijd. De database
    // weigert een regel van meer dan 24 uur, en omdat er maar één open
    // kloksessie per monteur mag bestaan zou hij daarna ook niet meer kunnen
    // inklokken — muurvast op de bouwplaats. Dus hier vragen wat de echte
    // eindtijd was.
    const urenOpen = (eind - start) / 3600000;
    if (urenOpen > 16) {
      const opgegeven = prompt(
        "Je staat sinds " + start.toLocaleString("nl-NL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
        + " ingeklokt.\n\nHoe laat ben je die dag gestopt? (bijvoorbeeld 16:00)", "16:00");
      if (opgegeven === null) return;
      const m = /^(\d{1,2})[:.](\d{2})$/.exec(opgegeven.trim());
      if (!m) return toon($("statusFout"), "Vul de eindtijd in als uu:mm, bijvoorbeeld 16:00.");
      eind = new Date(start);
      eind.setHours(Number(m[1]), Number(m[2]), 0, 0);
      // Een storingsdienst die om 22:00 begint en om 02:00 eindigt, eindigt de
      // volgende dag. Zonder deze correctie werd elke juiste invoer geweigerd
      // en bleef de kloksessie open — waarna hij ook niet meer kon inklokken.
      if (eind <= start) eind.setDate(eind.getDate() + 1);
      if ((eind - start) / 3600000 > 24) {
        return toon($("statusFout"), "Dat is meer dan 24 uur na je inkloktijd. Neem contact op met kantoor.");
      }
    }
    // Exacte tijd op de minuut — geen kwartierafronding, geen minimum.
    const uren = urenUitMinuten(Math.round((eind.getTime() - start.getTime()) / 60000));
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
        eind_tijd: eind.toISOString(),
        uren,
        omschrijving: $("omschrijving").value.trim() || null,
        km: kmWaarde(),
        bron: "klok",
        in_lat: openSessie.in_lat,
        in_lng: openSessie.in_lng,
        aangemaakt_door: mij.medewerker_id,
      });
      // De unieke index gaat over (medewerker, starttijd). Een 23505 betekent
      // dus alleen dat er al een regel met deze starttijd staat — niet dat die
      // dezelfde eindtijd, kilometers en omschrijving heeft. Bij een tweede
      // poging met een gecorrigeerde eindtijd zou stil de oude blijven staan.
      if (e1 && e1.code === "23505") {
        const { data: bestaand } = await db.from("urenregels")
          .select("id, eind_tijd, uren, status")
          .eq("medewerker_id", mij.medewerker_id).eq("start_tijd", openSessie.ingeklokt_op)
          .is("verwijderd_op", null).maybeSingle();
        if (bestaand && bestaand.status === "onbeslist") {
          // Nog niet beoordeeld: bijwerken mag, dus de correctie telt alsnog.
          const { error: e3 } = await db.from("urenregels").update({
            eind_tijd: eind.toISOString(),
            omschrijving: $("omschrijving").value.trim() || null,
            km: kmWaarde(),
          }).eq("id", bestaand.id);
          if (e3) throw e3;
        } else if (bestaand) {
          toon($("statusFout"), "Deze dienst was al geboekt en is inmiddels beoordeeld door kantoor. "
            + "Er staat " + urenTekst(bestaand.uren) + " geregistreerd. Neem contact op als dat niet klopt.");
        }
      } else if (e1) throw e1;
      sessionStorage.setItem("uitklok-" + openSessie.id, "1");
    }
    const { error: e2 } = await db.from("kloksessies").delete().eq("id", openSessie.id);
    if (e2) throw e2;
    sessionStorage.removeItem("uitklok-" + openSessie.id);
    $("omschrijving").value = "";
    $("km").value = "";
    if (!daarnaWisselen) {
      await verversStatus();
      laadHome();
    }
    return true;
  } catch (e) {
    toon($("statusFout"), netfout(e, "Uitklokken mislukt. Probeer het opnieuw."));
    return false;
  } finally {
    $("uitklokBtn").disabled = false;
  }
}

// ── Wisselen van werkbon ────────────────────────────────────────────────────
//  Een monteur rijdt op één dag vaak van klus naar klus. Zonder deze knop moest
//  hij uitklokken, wachten tot het scherm omsloeg, opnieuw een werkbon zoeken en
//  weer inklokken — vier handelingen op een telefoon met natte handschoenen. Nu
//  boekt hij de lopende bon af en klokt hij in één keer in op de volgende.
$("wisselBtn").addEventListener("click", () => {
  const paneel = $("wisselPaneel");
  const open = !paneel.classList.contains("verborgen");
  paneel.classList.toggle("verborgen", open);
  if (!open) {
    vulWisselOpties("");
    $("wisselZoek").value = "";
    setTimeout(() => $("wisselZoek").focus(), 40);
  }
});
$("wisselZoek").addEventListener("input", (e) => vulWisselOpties(e.target.value));

function vulWisselOpties(zoek) {
  const q = (zoek || "").toLowerCase().trim();
  // De bon waarop hij nu staat weglaten: daarnaar wisselen heeft geen zin.
  const lijst = (window._projecten || []).filter((p) =>
    p.id !== (openSessie && openSessie.project_id) &&
    (!q || ((p.werkbon || "") + " " + (p.naam || "")).toLowerCase().includes(q)));
  $("wisselOpties").innerHTML = lijst.length
    ? lijst.map((p) => `<button type="button" class="kies-optie" data-wissel="${esc(p.id)}" style="border-left:4px solid ${esc(kleurVan(p))}">
        ${p.werkbon ? `<span class="nr">${esc(p.werkbon)}</span>` : ""}<span class="nm">${esc(p.naam)}</span></button>`).join("")
    : `<div class="kies-leeg">Geen andere werkbon gevonden</div>`;
}

$("wisselOpties").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-wissel]");
  if (!b || !openSessie) return;
  const nieuw = b.dataset.wissel;
  const p = (window._projecten || []).find((x) => x.id === nieuw);
  const naam = p ? ((p.werkbon ? p.werkbon + " · " : "") + p.naam) : "deze werkbon";
  if (!confirm(`Overstappen naar ${naam}?\n\nJe huidige uren worden geboekt en je klokt meteen in op de nieuwe werkbon.`)) return;

  $("wisselPaneel").classList.add("verborgen");
  const gm = $("gpsMelding");
  toonMelding(gm, "", "Overstappen…");
  // Eerst afboeken. Lukt dat niet, dan niet doorgaan — anders staan er straks
  // twee open sessies of verdwijnen de gewerkte uren.
  const uit = await klokUit(true);
  if (!uit) { verberg(gm); return; }
  openSessie = null;
  const in_ = await klokIn(nieuw, gm, $("wisselBtn"));
  if (!in_) {
    // Afgeboekt maar niet ingeklokt: zeg dat er niets verloren is, anders denkt
    // hij dat zijn uren weg zijn.
    toonMelding(gm, "fout", "Je uren zijn geboekt, maar inklokken op de nieuwe werkbon lukte niet. Klok handmatig in.");
    await verversStatus();
  }
  laadHome();
});

// ── Verlof aanvragen ────────────────────────────────────────────────────────
const SOORT_LABEL = { vakantie: "Vakantie", ziek: "Ziek", onbetaald: "Onbetaald verlof", bijzonder: "Bijzonder verlof" };

// Welke soorten verlof mag deze monteur aanvragen? Volgt uit zijn beleid.
async function vulVerlofSoorten() {
  const sel = $("vaSoort");
  const { data: ik } = await db.from("medewerkers").select("beleid_id").eq("id", mij.medewerker_id).maybeSingle();
  let types = [];
  if (ik?.beleid_id) {
    const { data } = await db.from("beleid_types")
      .select("afwezigheid_types(code, naam, kleur, icoon, volgorde, actief)").eq("beleid_id", ik.beleid_id);
    types = (data || []).map((r) => r.afwezigheid_types).filter((t) => t && t.actief);
  } else {
    const { data } = await db.from("afwezigheid_types").select("code, naam, kleur, icoon, volgorde, actief").eq("actief", true);
    types = data || [];
  }
  types.sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0));
  const huidig = sel.value;
  sel.innerHTML = "";
  types.forEach((t) => {
    const o = document.createElement("option");
    o.value = t.code; o.textContent = t.naam; sel.appendChild(o);
  });
  if (huidig && types.some((t) => t.code === huidig)) sel.value = huidig;
  SOORT_NAAM = Object.fromEntries(types.map((t) => [t.code, t.naam]));
  SOORT_TYPE = Object.fromEntries(types.map((t) => [t.code, t]));
  toonSoortIcoon();
}
let SOORT_NAAM = {};
let SOORT_TYPE = {};
// Een <select> kan geen tekening bevatten, dus staat het pictogram ernaast.
function toonSoortIcoon() {
  const vak = $("vaSoortIcoon");
  if (!vak) return;
  const t = typeVanCode($("vaSoort").value);
  vak.innerHTML = icoon(t, { maat: 18, kleur: t.kleur });
}
function typeVanCode(code) {
  return SOORT_TYPE[code] || { code, naam: SOORT_NAAM[code] || SOORT_LABEL[code] || code, kleur: "#6d635f" };
}
// Naam met pictogram ervoor, in de kleur van het type.
function typeLabel(code) {
  const t = typeVanCode(code);
  return `<span class="afw-label">${icoon(t, { kleur: t.kleur })}${esc(t.naam)}</span>`;
}

$("vaVerstuur").addEventListener("click", async () => {
  const meld = $("verlofMelding");
  const soort = $("vaSoort").value;
  const van = $("vaVan").value, tot = $("vaTot").value || $("vaVan").value;
  if (!van) return toonMelding(meld, "fout", "Kies een begindatum.");
  if (tot < van) return toonMelding(meld, "fout", "De einddatum ligt vóór de begindatum.");
  // overlapcontrole: nog niet nogmaals aanvragen over dezelfde periode
  const { data: overlap } = await db.from("afwezigheid")
    .select("van_datum, tot_datum, status")
    .eq("medewerker_id", mij.medewerker_id)
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
    .eq("medewerker_id", mij.medewerker_id)
    .is("verwijderd_op", null).order("van_datum", { ascending: false }).limit(50);

  // Jaaroverzicht: goedgekeurde dagen per soort in het huidige jaar
  const jaar = new Date().getFullYear();
  const perSoort = {};
  (data || []).filter((r) => r.status === "goedgekeurd" && r.tot_datum >= jaar + "-01-01" && r.van_datum <= jaar + "-12-31").forEach((r) => {
    // Zelfde telling als op het startscherm: werkdagen, geen kalenderdagen.
    // Anders stond een week vakantie hier op 7 en daar op 5 dagen.
    // Een vakantie van 28 dec t/m 5 jan hoort in beide jaren voor zijn eigen
    // deel te tellen, niet volledig in het beginjaar.
    const van = r.van_datum > jaar + "-01-01" ? r.van_datum : jaar + "-01-01";
    const tot = r.tot_datum < jaar + "-12-31" ? r.tot_datum : jaar + "-12-31";
    const dagen = werkdagenTussen(van, tot);
    perSoort[r.soort] = (perSoort[r.soort] || 0) + dagen;
  });
  const ov = $("verlofOverzicht");
  const soorten = Object.keys(perSoort);
  ov.innerHTML = soorten.length
    ? soorten.map((s) => `<span class="chip">${typeLabel(s)}: <b style="margin-left:4px">${perSoort[s]} ${perSoort[s] === 1 ? "dag" : "dagen"}</b></span>`).join("")
    : `<span class="leeg">Nog geen goedgekeurde afwezigheid in ${jaar}.</span>`;

  // Verlofsaldo in uren, opgebouwd uit de gewerkte uren
  const { data: saldo } = await db.rpc("verlofsaldo", { p_medewerker: mij.medewerker_id });
  if (saldo) {
    $("verlofSaldoTitel").textContent = "Verlofsaldo" + (saldo.beleid ? " · " + saldo.beleid : "");
    $("vsRecht").textContent = urenTekst(saldo.opgebouwd);
    $("vsOpgenomen").textContent = urenTekst(saldo.opgenomen);
    $("vsOver").textContent = urenTekst(saldo.saldo);
    $("vsOver").style.color = Number(saldo.saldo) >= 0 ? "var(--groen)" : "var(--rood-donker)";
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
       <span style="flex:1">${typeLabel(r.soort)} · <span class="mono">${datumKort(r.van_datum)}${r.van_datum !== r.tot_datum ? " – " + datumKort(r.tot_datum) : ""}</span></span>
       ${badge(r.status)}
     </div>`).join("");
}
function datumKort(d) { return new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "2-digit", month: "short" }); }

// ── Uren: exact opslaan in decimalen, tonen als "2 u 16 min" ────────────────
const KLEUREN = [
  "#e11d48", "#db2777", "#c026d3", "#9333ea", "#7c3aed", "#4f46e5",
  "#2563eb", "#0284c7", "#0891b2", "#0d9488", "#059669", "#16a34a",
  "#65a30d", "#ca8a04", "#d97706", "#ea580c", "#dc2626", "#b91c1c",
  "#be185d", "#a21caf", "#6d28d9", "#1d4ed8", "#0369a1", "#15803d",
];
function kleurVan(p) {
  if (p && p.kleur) return p.kleur;
  const s = String(p?.id || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return KLEUREN[h % KLEUREN.length];
}
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

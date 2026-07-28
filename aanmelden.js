// ============================================================================
//  Aanmelden via de uitnodigingslink.
//
//  De monteur bestaat al als personeelsrecord; hij koppelt hier alleen zijn
//  eigen inlog eraan. Volgorde: eerst een account bij Supabase Auth, daarna de
//  koppeling via koppel_account() — die controleert de code uit de link én de
//  geboortedatum. Het account blijft inactief tot kantoor het vrijgeeft.
// ============================================================================
import { monteurClient } from "./config.js?v=53";

const $ = (id) => document.getElementById(id);
const db = monteurClient();
const code = new URLSearchParams(location.search).get("code") || "";

function toon(el, tekst) { el.textContent = tekst; el.classList.remove("verborgen"); }
function verberg(el) { el.classList.add("verborgen"); }

// ── Namenlijst ophalen ──────────────────────────────────────────────────────
(async function vulNamen() {
  const sel = $("wie");
  if (!code) {
    sel.innerHTML = "<option value=''>—</option>";
    $("formulier").classList.add("verborgen");
    return toon($("fout"), "Deze link is niet compleet. Vraag kantoor om de uitnodigingslink opnieuw te sturen.");
  }
  const { data, error } = await db.rpc("open_medewerkers", { p_token: code });
  if (error) {
    sel.innerHTML = "<option value=''>—</option>";
    return toon($("fout"), "De lijst kon niet worden geladen. Controleer je internetverbinding en probeer het opnieuw.");
  }
  if (!data || !data.length) {
    sel.innerHTML = "<option value=''>—</option>";
    $("formulier").classList.add("verborgen");
    return toon($("fout"), "Deze link is verlopen, of iedereen heeft zich al aangemeld. Neem contact op met kantoor.");
  }
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  sel.innerHTML = "<option value=''>Kies je naam…</option>"
    + data.map((m) => `<option value="${esc(m.id)}">${esc(m.naam)}</option>`).join("");
})();

// ── Aanmelden ───────────────────────────────────────────────────────────────
$("aanmeldBtn").addEventListener("click", async () => {
  verberg($("fout")); verberg($("ok"));
  const medewerker = $("wie").value;
  const geboortedatum = $("geboortedatum").value;
  const email = $("email").value.trim().toLowerCase();
  const wachtwoord = $("wachtwoord").value;

  if (!medewerker) return toon($("fout"), "Kies je naam uit de lijst.");
  if (!geboortedatum) return toon($("fout"), "Vul je geboortedatum in.");
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return toon($("fout"), "Vul een geldig e-mailadres in.");
  if (wachtwoord.length < 8) return toon($("fout"), "Kies een wachtwoord van minimaal 8 tekens.");

  $("aanmeldBtn").disabled = true;
  try {
    // 1) Inlog aanmaken. Bestaat het adres al, dan proberen we ermee in te
    //    loggen: iemand die halverwege afhaakte kan zo gewoon verder.
    let { error } = await db.auth.signUp({ email, password: wachtwoord });
    if (error && /already registered|already exists/i.test(error.message)) {
      const poging = await db.auth.signInWithPassword({ email, password: wachtwoord });
      if (poging.error) {
        return toon($("fout"), "Er bestaat al een account met dit e-mailadres. Gebruik een ander adres, of log in met je bestaande wachtwoord.");
      }
      error = null;
    }
    if (error) return toon($("fout"), "Account aanmaken mislukt: " + error.message);

    // 2) Bevestiging per e-mail staat uit, dus signUp levert meteen een sessie.
    //    Blijft die toch weg, dan is er iets mis met de instelling; dan liever
    //    een eerlijke melding dan een half aangemaakt account.
    const { data: sessie } = await db.auth.getSession();
    if (!sessie.session) {
      return toon($("fout"), "Je account is aangemaakt, maar aanmelden lukte niet in één keer. Probeer in te loggen met je e-mailadres en wachtwoord, of neem contact op met kantoor.");
    }

    // 3) Inlog aan het personeelsrecord hangen.
    const { data: uitkomst, error: koppelFout } =
      await db.rpc("koppel_account", { p_token: code, p_medewerker: medewerker, p_geboortedatum: geboortedatum });
    if (koppelFout) return toon($("fout"), "Koppelen mislukt: " + koppelFout.message);

    if (uitkomst === "gekoppeld" || uitkomst === "al_gekoppeld") {
      $("formulier").classList.add("verborgen");
      // Meteen door: hij is al ingelogd, dus de app kan direct open.
      toon($("ok"), "Gelukt. Je bent ingelogd — je gaat nu door naar de app.");
      setTimeout(() => location.replace("index.html"), 1200);
      return;
    }
    if (uitkomst === "link_ongeldig") return toon($("fout"), "Deze link is verlopen. Vraag kantoor om een nieuwe.");
    // "geen_match" dekt bewust drie gevallen tegelijk, zodat je er geen
    // geboortedata mee kunt raden.
    return toon($("fout"), "De geboortedatum klopt niet met de gekozen naam, of die collega heeft zich al aangemeld.");
  } catch (e) {
    toon($("fout"), "Aanmelden mislukt. Controleer je internetverbinding en probeer het opnieuw.");
  } finally {
    $("aanmeldBtn").disabled = false;
  }
});

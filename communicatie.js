// ============================================================================
//  Spaar Electra — Urenregistratie · communicatie
//  Nieuwsberichten (met reacties) en gedeelde bestanden — de vervanger van
//  /communications/news en /communications/files uit Shiftbase.
//
//  De 1-op-1 chat uit Shiftbase zit hier bewust NIET in: die nemen ze zelf ook
//  niet af en de ploeg gebruikt WhatsApp. Een halve chat ernaast levert alleen
//  een tweede plek op waar je een bericht kunt missen.
//
//  Twee ingangen, één bestand, omdat beide kanten dezelfde tabellen en dezelfde
//  ontsnappingsregels gebruiken:
//    bouwNieuwsBeheer(db, hulp)   — kantoor: plaatsen, modereren, uploaden
//    bouwNieuwsMonteur(db, hulp)  — telefoon: lezen, reageren, downloaden
//
//  `hulp` is de verzameling functies die al in beheer.js/monteur.js staat. Zo
//  blijft de opmaak van datums, meldingen en foutteksten overal gelijk en hoeft
//  dit bestand niets te dupliceren. Welke er nodig zijn: zie VEREIST hieronder.
//
//  Alles wat een gebruiker heeft ingetypt gaat door esc(). Nieuwsberichten en
//  reacties zijn vrije tekst van 25 mensen; dat is hier de kern van de
//  beveiliging aan de clientkant, geen formaliteit.
// ============================================================================

const $ = (id) => document.getElementById(id);

const BUCKET = "bestanden";
const MAX_BYTES = 20 * 1024 * 1024;      // gelijk aan file_size_limit op de bucket
const URL_GELDIG_SEC = 120;              // ondertekende download-URL: kort houden

// ── VEREIST in `hulp` ───────────────────────────────────────────────────────
//  Beide kanten : esc, toonMeld, mijnId
//  Beheer extra : rijLeeg, datum, tijd, haalAlles, initialen
//  Monteur extra: netfout
//  Ontbreekt een van de optionele, dan valt dit bestand terug op een eigen
//  versie — maar de drie verplichte niet: die halen we niet stilzwijgend uit
//  onze duim, want dan wijkt de app op één scherm af van de rest.
function vulAan(hulp, kant) {
  const h = Object.assign({}, hulp || {});
  const mist = ["esc", "toonMeld", "mijnId"].filter((n) => typeof h[n] !== "function");
  if (mist.length) {
    throw new Error("communicatie.js (" + kant + "): hulpfuncties ontbreken: " + mist.join(", "));
  }
  if (typeof h.netfout !== "function") h.netfout = eigenNetfout;
  if (typeof h.datum !== "function") h.datum = (d) => new Date(d).toLocaleDateString("nl-NL", { day: "2-digit", month: "short" });
  if (typeof h.tijd !== "function") h.tijd = (iso) => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  if (typeof h.rijLeeg !== "function") h.rijLeeg = (cols, msg) => `<tr><td colspan="${cols}" class="leeg">${msg}</td></tr>`;
  if (typeof h.initialen !== "function") h.initialen = eigenInitialen;
  if (typeof h.haalAlles !== "function") h.haalAlles = (bouw) => bouw(0, 999);
  return h;
}

// Terugval als de aanroeper geen netfout() meegeeft. Zelfde bedoeling als die
// in monteur.js: een monteur op de bouwplaats moet kunnen lezen wat er mis is.
function eigenNetfout(e, standaard) {
  const m = String((e && e.message) || e || "");
  const code = (e && e.code) || "";
  if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test(m)) {
    return "Geen internetverbinding. Zoek even een plek met bereik en probeer opnieuw.";
  }
  if (code === "42501") return "Je hebt hier geen toegang toe. Neem contact op met kantoor.";
  if (code === "23505") return "Dit is al geregistreerd. Ververs de app om de actuele stand te zien.";
  return standaard || m;
}

function eigenInitialen(naam) {
  const d = String(naam || "").trim().split(/\s+/).filter(Boolean);
  if (!d.length) return "?";
  return (d[0][0] + (d.length > 1 ? d[d.length - 1][0] : "")).toUpperCase();
}

// ── Kleine hulpjes ──────────────────────────────────────────────────────────

// Eerst ontsnappen, dan pas de regelovergangen omzetten. Andersom zou een
// bericht met <br> erin door de ontsnapping worden platgeslagen — of erger:
// zou een < uit de gebruikerstekst als opmaak eindigen.
function alinea(esc, tekst) {
  return esc(tekst).replace(/\r\n|\r|\n/g, "<br>");
}

// "vandaag 14:05" / "gisteren 08:12" / "12 jul 14:05" — op een telefoon leest
// dat sneller dan een volledige datum.
function wanneer(h, iso) {
  const d = new Date(iso);
  const nu = new Date();
  const dag = (x) => x.getFullYear() + "-" + x.getMonth() + "-" + x.getDate();
  const gister = new Date(nu); gister.setDate(nu.getDate() - 1);
  if (dag(d) === dag(nu)) return "vandaag " + h.tijd(iso);
  if (dag(d) === dag(gister)) return "gisteren " + h.tijd(iso);
  return h.datum(iso) + " " + h.tijd(iso);
}

function isoVandaag() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function grootteTekst(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " kB";
  return (n / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB";
}

// Bestandsnaam die veilig in een pad past. Spaties, accenten en schuine strepen
// uit een telefoonnaam maken anders een pad dat niet meer overeenkomt met de
// map waarop de Storage-policy oordeelt.
function veiligeNaam(naam) {
  const schoon = String(naam || "bestand")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-").replace(/^[-.]+/, "");
  return (schoon || "bestand").slice(-80);
}

function uniekeSleutel() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// Pad in de bucket. Dit is niet alleen ordening: de Storage-policy leest de
// eigenaar uit de eerste twee mapnamen, en de check-constraint op `bestanden`
// eist dezelfde vorm. Wijkt dit af, dan weigert de database de rij — precies
// de bedoeling, want dan zou een document bij de verkeerde persoon belanden.
function bouwPad(medewerkerId, bestandsnaam) {
  const staart = uniekeSleutel() + "-" + veiligeNaam(bestandsnaam);
  return medewerkerId ? "medewerker/" + medewerkerId + "/" + staart : "algemeen/" + staart;
}

// Downloaden gaat via een korte ondertekende URL met Content-Disposition, zodat
// de telefoon het bestand ophaalt zonder de app te verlaten. Een pop-up openen
// na een await wordt op iOS geblokkeerd; dit niet.
async function haalBestandOp(db, h, rij, meldEl) {
  const { data, error } = await db.storage.from(BUCKET)
    .createSignedUrl(rij.pad, URL_GELDIG_SEC, { download: rij.bestandsnaam || true });
  if (error || !data || !data.signedUrl) {
    return h.toonMeld(meldEl, "fout", h.netfout(error, "Dit bestand kon niet worden opgehaald. Probeer het zo nog eens."));
  }
  window.location.href = data.signedUrl;
}

// ============================================================================
//  KANTOOR
// ============================================================================
export function bouwNieuwsBeheer(db, hulp) {
  const h = vulAan(hulp, "beheer");

  // Staat de HTML nog niet in beheer.html, dan is dat een installatiefout en
  // geen storing. Luid melden in de console en verder niets kapotmaken.
  if (!$("cmPlaatsBtn") || !$("cmTbBerichten")) {
    console.error("communicatie.js: de beheer-HTML uit app/communicatie.html.txt staat nog niet in beheer.html.");
    return { laad() {}, laadBerichten() {}, laadBestanden() {} };
  }

  let _berichten = [];
  let _bestanden = [];
  let _reactiesVan = null;    // bericht-id waarvan de reacties openstaan

  // ── Nieuws plaatsen ───────────────────────────────────────────────────────
  $("cmPlaatsBtn").addEventListener("click", plaatsBericht);

  async function plaatsBericht() {
    const meld = $("cmNieuwMelding");
    const titel = $("cmNieuwTitel").value.trim();
    const tekst = $("cmNieuwTekst").value.trim();
    const geldig = $("cmNieuwGeldig").value || null;
    const metPush = $("cmNieuwPush").checked;

    if (!titel) return h.toonMeld(meld, "fout", "Geef het bericht een kop.");
    if (!tekst) return h.toonMeld(meld, "fout", "Het bericht is nog leeg.");
    if (geldig && geldig < isoVandaag()) {
      return h.toonMeld(meld, "fout", "De geldigheidsdatum ligt in het verleden; het bericht zou meteen verdwijnen.");
    }

    $("cmPlaatsBtn").disabled = true;
    h.toonMeld(meld, "", "Bezig met plaatsen…");
    try {
      // De afzender wordt in de database uit het token gehaald (trigger), dus
      // die sturen we hier bewust niet mee.
      const { data, error } = await db.from("nieuwsberichten")
        .insert({ titel, bericht: tekst, geldig_tot: geldig })
        .select("id").single();
      if (error) return h.toonMeld(meld, "fout", "Plaatsen mislukt: " + error.message);

      $("cmNieuwTitel").value = "";
      $("cmNieuwTekst").value = "";
      $("cmNieuwGeldig").value = "";
      $("cmNieuwPush").checked = false;

      if (metPush) {
        const uitkomst = await stuurPush(data.id);
        h.toonMeld(meld, uitkomst.ok ? "ok" : "fout", "Bericht geplaatst. " + uitkomst.tekst);
      } else {
        h.toonMeld(meld, "ok", "Bericht geplaatst.");
      }
      await laadBerichten();
    } catch (e) {
      h.toonMeld(meld, "fout", h.netfout(e, "Plaatsen mislukt."));
    } finally {
      $("cmPlaatsBtn").disabled = false;
    }
  }

  // De Edge Function 'nieuws-push' verstuurt met de service-role; wij sturen
  // alleen het bericht-id mee. Mislukt dat, dan staat het bericht er nog steeds
  // — en dat zeggen we er ook bij, anders lijkt het of er niets is gebeurd.
  async function stuurPush(berichtId) {
    try {
      const { data, error } = await db.functions.invoke("nieuws-push", { body: { bericht_id: berichtId } });
      if (error) return { ok: false, tekst: "De pushmelding is niet verstuurd (" + error.message + "). Het bericht staat wel in de app." };
      if (data && data.verstuurd === 0) {
        return { ok: false, tekst: "Niemand heeft meldingen aanstaan, dus er is geen push verstuurd. Het bericht staat wel in de app." };
      }
      return { ok: true, tekst: "Pushmelding verstuurd naar " + ((data && data.verstuurd) || 0) + " telefoon(s)." };
    } catch (e) {
      return { ok: false, tekst: h.netfout(e, "De pushmelding is niet verstuurd. Het bericht staat wel in de app.") };
    }
  }

  // ── Berichtenlijst ────────────────────────────────────────────────────────
  async function laadBerichten() {
    const tb = $("cmTbBerichten");
    const { data, error } = await db.from("v_nieuws")
      .select("id, titel, bericht, geldig_tot, auteur_naam, aangemaakt_op, push_verstuurd_op, verlopen, aantal_reacties")
      .order("aangemaakt_op", { ascending: false });
    if (error) {
      // Nooit stil falen: een lege tabel en een kapotte query zien er anders
      // hetzelfde uit, en dan denkt kantoor dat er niets geplaatst is.
      tb.innerHTML = h.rijLeeg(5, "Kon de berichten niet laden: " + h.esc(error.message));
      return;
    }
    _berichten = data || [];
    $("cmTelBerichten").textContent = _berichten.length ? "(" + _berichten.length + ")" : "";

    tb.innerHTML = _berichten.length ? _berichten.map((b) => `<tr${b.verlopen ? ' class="cm-verlopen"' : ""}>
      <td class="mono">${h.datum(b.aangemaakt_op)}</td>
      <td class="sterk">${h.esc(b.titel)}
        <div class="cm-fragment">${h.esc(fragment(b.bericht))}</div></td>
      <td>${b.geldig_tot ? h.datum(b.geldig_tot) + (b.verlopen ? ' <span class="badge grijs">verlopen</span>' : "") : '<span class="cm-zwak">blijft staan</span>'}</td>
      <td>${h.esc(b.auteur_naam)}${b.push_verstuurd_op ? ' <span class="badge grijs">push</span>' : ""}</td>
      <td class="knoprij">
        <button class="btn btn-grijs btn-klein" data-cm-reacties="${b.id}">Reacties (${Number(b.aantal_reacties || 0)})</button>
        <button class="btn btn-grijs btn-klein" data-cm-weg="${b.id}">Verwijderen</button>
      </td></tr>`).join("") : h.rijLeeg(5, "Nog geen berichten geplaatst.");

    tb.querySelectorAll("[data-cm-reacties]").forEach((b) =>
      b.addEventListener("click", () => openReacties(b.dataset.cmReacties)));
    tb.querySelectorAll("[data-cm-weg]").forEach((b) =>
      b.addEventListener("click", () => verwijderBericht(b.dataset.cmWeg)));
  }

  function fragment(tekst) {
    const t = String(tekst || "").replace(/\s+/g, " ").trim();
    return t.length > 110 ? t.slice(0, 110) + "…" : t;
  }

  async function verwijderBericht(id) {
    const b = _berichten.find((x) => x.id === id);
    if (!b) return;
    if (!confirm(`"${b.titel}" verwijderen?\n\nHet bericht verdwijnt bij iedereen, samen met de reacties eronder.`)) return;
    // Zacht verwijderen, zoals de rest van dit systeem: bij een discussie over
    // wat er gecommuniceerd is, is het bericht dan nog terug te halen.
    const { error } = await db.from("nieuwsberichten").update({ verwijderd_op: new Date().toISOString() }).eq("id", id);
    if (error) return h.toonMeld($("cmNieuwMelding"), "fout", "Verwijderen mislukt: " + error.message);
    h.toonMeld($("cmNieuwMelding"), "ok", "Bericht verwijderd.");
    await laadBerichten();
  }

  // ── Reacties bekijken en modereren ────────────────────────────────────────
  $("cmReactiesX").addEventListener("click", sluitReacties);
  $("cmReactiesVenster").addEventListener("click", (e) => { if (e.target === $("cmReactiesVenster")) sluitReacties(); });

  function sluitReacties() { _reactiesVan = null; $("cmReactiesVenster").classList.add("verborgen"); }

  async function openReacties(berichtId) {
    const b = _berichten.find((x) => x.id === berichtId);
    _reactiesVan = berichtId;
    $("cmReactiesTitel").textContent = b ? b.titel : "Reacties";
    $("cmReactiesLijst").innerHTML = `<div class="leeg">Bezig met laden…</div>`;
    $("cmReactiesMelding").classList.add("verborgen");
    $("cmReactiesVenster").classList.remove("verborgen");
    await laadReacties();
  }

  async function laadReacties() {
    if (!_reactiesVan) return;
    const lijst = $("cmReactiesLijst");
    const { data, error } = await db.from("nieuws_reacties")
      .select("id, tekst, auteur_naam, aangemaakt_op, gewijzigd_op")
      .eq("bericht_id", _reactiesVan).order("aangemaakt_op");
    if (error) {
      lijst.innerHTML = `<div class="leeg">Kon de reacties niet laden: ${h.esc(error.message)}</div>`;
      return;
    }
    lijst.innerHTML = (data || []).length ? data.map((r) => `<div class="cm-reactie">
        <span class="cm-avatar">${h.esc(h.initialen(r.auteur_naam))}</span>
        <div class="cm-reactie-body">
          <div class="cm-reactie-kop">${h.esc(r.auteur_naam)}
            <span class="cm-zwak">${wanneer(h, r.aangemaakt_op)}${r.gewijzigd_op ? " · aangepast" : ""}</span></div>
          <div class="cm-reactie-tekst">${alinea(h.esc, r.tekst)}</div>
        </div>
        <button class="btn btn-grijs btn-klein" data-cm-reactie-weg="${r.id}">Weghalen</button>
      </div>`).join("") : `<div class="leeg">Nog geen reacties op dit bericht.</div>`;

    lijst.querySelectorAll("[data-cm-reactie-weg]").forEach((b) =>
      b.addEventListener("click", () => verwijderReactie(b.dataset.cmReactieWeg)));
  }

  async function verwijderReactie(id) {
    if (!confirm("Deze reactie weghalen?\n\nDat is voor iedereen zichtbaar: de reactie verdwijnt onder het bericht.")) return;
    const { error } = await db.from("nieuws_reacties").delete().eq("id", id);
    if (error) return h.toonMeld($("cmReactiesMelding"), "fout", "Weghalen mislukt: " + error.message);
    h.toonMeld($("cmReactiesMelding"), "ok", "Reactie weggehaald.");
    await laadReacties();
    await laadBerichten();
  }

  // ── Bestanden ─────────────────────────────────────────────────────────────
  $("cmBestBtn").addEventListener("click", uploadBestand);

  async function vulMedewerkers() {
    const sel = $("cmBestVoor");
    const { data, error } = await db.from("medewerkers")
      .select("id, naam").is("verwijderd_op", null).order("naam");
    if (error) {
      h.toonMeld($("cmBestMelding"), "fout", "De medewerkerslijst kon niet worden geladen: " + error.message
        + " Je kunt nu alleen een bestand voor de hele ploeg delen.");
      return;
    }
    sel.innerHTML = `<option value="">Hele ploeg (algemeen bestand)</option>`
      + (data || []).map((m) => `<option value="${h.esc(m.id)}">${h.esc(m.naam)} — persoonlijk document</option>`).join("");
  }

  async function uploadBestand() {
    const meld = $("cmBestMelding");
    const titel = $("cmBestTitel").value.trim();
    const omschrijving = $("cmBestOmschrijving").value.trim() || null;
    const voor = $("cmBestVoor").value || null;
    const invoer = $("cmBestInvoer");
    const bestand = invoer.files && invoer.files[0];

    if (!titel) return h.toonMeld(meld, "fout", "Geef het bestand een naam die de monteur begrijpt.");
    if (!bestand) return h.toonMeld(meld, "fout", "Kies een bestand.");
    if (bestand.size > MAX_BYTES) {
      return h.toonMeld(meld, "fout", "Dit bestand is " + grootteTekst(bestand.size) + "; de grens ligt op 20 MB.");
    }

    const pad = bouwPad(voor, bestand.name);
    $("cmBestBtn").disabled = true;
    h.toonMeld(meld, "", "Bezig met uploaden…");
    try {
      const op = await db.storage.from(BUCKET).upload(pad, bestand, {
        contentType: bestand.type || "application/octet-stream", upsert: false,
      });
      if (op.error) return h.toonMeld(meld, "fout", "Uploaden mislukt: " + op.error.message);

      const { error } = await db.from("bestanden").insert({
        titel, omschrijving, pad, bestandsnaam: bestand.name,
        grootte: bestand.size, mime: bestand.type || null, medewerker_id: voor,
      });
      if (error) {
        // Het bestand staat dan wel in de bucket maar hoort bij niemand. Zo'n
        // wees is onzichtbaar in de app en blijft opslag kosten — meteen weg.
        await db.storage.from(BUCKET).remove([pad]);
        return h.toonMeld(meld, "fout", "Opslaan mislukt: " + error.message + " Het geüploade bestand is weer weggehaald.");
      }

      $("cmBestTitel").value = "";
      $("cmBestOmschrijving").value = "";
      invoer.value = "";
      h.toonMeld(meld, "ok", voor ? "Document toegevoegd; alleen deze medewerker ziet het." : "Bestand gedeeld met de hele ploeg.");
      await laadBestanden();
    } catch (e) {
      h.toonMeld(meld, "fout", h.netfout(e, "Uploaden mislukt."));
    } finally {
      $("cmBestBtn").disabled = false;
    }
  }

  async function laadBestanden() {
    const tb = $("cmTbBestanden");
    // De verwijzing expliciet op medewerker_id: `bestanden` heeft twee
    // koppelingen naar medewerkers (de eigenaar en wie het uploadde), en zonder
    // die aanwijzing weigert PostgREST de vraag als dubbelzinnig.
    const { data, error } = await h.haalAlles((van, tot) => db.from("bestanden")
      .select("id, titel, omschrijving, pad, bestandsnaam, grootte, mime, medewerker_id, aangemaakt_op, medewerkers!medewerker_id(naam)")
      .order("aangemaakt_op", { ascending: false }).range(van, tot));
    if (error) {
      tb.innerHTML = h.rijLeeg(5, "Kon de bestanden niet laden: " + h.esc(error.message));
      return;
    }
    _bestanden = data || [];
    $("cmTelBestanden").textContent = _bestanden.length ? "(" + _bestanden.length + ")" : "";

    tb.innerHTML = _bestanden.length ? _bestanden.map((r) => `<tr>
      <td class="sterk">${h.esc(r.titel)}
        ${r.omschrijving ? `<div class="cm-fragment">${h.esc(r.omschrijving)}</div>` : ""}</td>
      <td>${r.medewerker_id
        ? `<span class="badge amber">${h.esc((r.medewerkers && r.medewerkers.naam) || "medewerker")}</span>`
        : `<span class="badge groen">Hele ploeg</span>`}</td>
      <td class="mono">${h.esc(r.bestandsnaam)}<div class="cm-zwak">${grootteTekst(r.grootte)}</div></td>
      <td class="mono">${h.datum(r.aangemaakt_op)}</td>
      <td class="knoprij">
        <button class="btn btn-grijs btn-klein" data-cm-download="${r.id}">Openen</button>
        <button class="btn btn-grijs btn-klein" data-cm-best-weg="${r.id}">Verwijderen</button>
      </td></tr>`).join("") : h.rijLeeg(5, "Nog geen bestanden gedeeld.");

    tb.querySelectorAll("[data-cm-download]").forEach((b) => b.addEventListener("click", () => {
      const r = _bestanden.find((x) => x.id === b.dataset.cmDownload);
      if (r) haalBestandOp(db, h, r, $("cmBestMelding"));
    }));
    tb.querySelectorAll("[data-cm-best-weg]").forEach((b) =>
      b.addEventListener("click", () => verwijderBestand(b.dataset.cmBestWeg)));
  }

  async function verwijderBestand(id) {
    const r = _bestanden.find((x) => x.id === id);
    if (!r) return;
    if (!confirm(`"${r.titel}" verwijderen?\n\nHet bestand wordt echt weggegooid en is daarna niet meer terug te halen.`)) return;
    // Eerst de rij, dan het bestand: mislukt het tweede, dan is het document in
    // elk geval nergens meer opvraagbaar — dat is de veilige kant om op te
    // falen bij een contract of certificaat.
    const { error } = await db.from("bestanden").delete().eq("id", id);
    if (error) return h.toonMeld($("cmBestMelding"), "fout", "Verwijderen mislukt: " + error.message);
    const weg = await db.storage.from(BUCKET).remove([r.pad]);
    if (weg.error) {
      h.toonMeld($("cmBestMelding"), "fout",
        "De vermelding is weg, maar het bestand zelf staat nog in de opslag (" + weg.error.message
        + "). Haal het weg via Storage in het Supabase-dashboard.");
    } else {
      h.toonMeld($("cmBestMelding"), "ok", "Bestand verwijderd.");
    }
    await laadBestanden();
  }

  // ── Paginatitel ───────────────────────────────────────────────────────────
  //  beheer.js kent "communicatie" niet in zijn titeltabel, dus die zetten we
  //  hier. Deze luisteraar komt ná die van beheer.js en wint daarmee.
  const navKnop = document.querySelector('.nav[data-tab="communicatie"]');
  if (navKnop) {
    navKnop.addEventListener("click", () => {
      const t = $("paginaTitel");
      if (t) t.textContent = "Communicatie";
    });
  }

  async function laad() {
    await Promise.all([vulMedewerkers(), laadBerichten(), laadBestanden()]);
  }

  return { laad, laadBerichten, laadBestanden };
}

// ============================================================================
//  MONTEUR (telefoon op de bouwplaats)
// ============================================================================
export function bouwNieuwsMonteur(db, hulp) {
  const h = vulAan(hulp, "monteur");

  if (!$("cmNieuwsKaart") || !$("cmDetail")) {
    console.error("communicatie.js: de monteur-HTML uit app/communicatie.html.txt staat nog niet in monteur.html.");
    return { laad() {}, ongelezen: () => 0 };
  }

  let _berichten = [];
  let _open = null;        // bericht dat nu openstaat
  let _bewerkt = null;     // reactie-id dat wordt aangepast, of null

  // ── Berichten op het startscherm ──────────────────────────────────────────
  async function laadNieuws() {
    const el = $("cmNieuws");
    const kaart = $("cmNieuwsKaart");
    kaart.classList.remove("verborgen");
    try {
      const { data, error } = await db.from("v_nieuws")
        .select("id, titel, bericht, auteur_naam, aangemaakt_op, aantal_reacties, gelezen")
        .order("aangemaakt_op", { ascending: false }).limit(25);
      if (error) {
        el.innerHTML = `<div class="leeg">Kon het nieuws niet laden. ${h.esc(h.netfout(error, "Probeer het zo nog eens."))}</div>`;
        return;
      }
      _berichten = data || [];
      const ongelezen = _berichten.filter((b) => !b.gelezen).length;
      const tel = $("cmNieuwsTelling");
      tel.textContent = ongelezen ? String(ongelezen) + " nieuw" : "";
      tel.classList.toggle("verborgen", ongelezen === 0);

      el.innerHTML = _berichten.length ? _berichten.map((b) => `
        <button type="button" class="cm-bericht${b.gelezen ? "" : " cm-ongelezen"}" data-cm-open="${b.id}">
          <span class="cm-stip" aria-hidden="true"></span>
          <span class="cm-bericht-body">
            <span class="cm-bericht-titel">${h.esc(b.titel)}</span>
            <span class="cm-bericht-fragment">${h.esc(kort(b.bericht))}</span>
            <span class="cm-bericht-voet">${h.esc(b.auteur_naam)} · ${wanneer(h, b.aangemaakt_op)}${
              Number(b.aantal_reacties) ? " · " + Number(b.aantal_reacties) + " reactie" + (Number(b.aantal_reacties) === 1 ? "" : "s") : ""
            }</span>
          </span>
        </button>`).join("") : `<div class="leeg">Er is nog geen nieuws van kantoor.</div>`;

      el.querySelectorAll("[data-cm-open]").forEach((k) =>
        k.addEventListener("click", () => openBericht(k.dataset.cmOpen)));
    } catch (e) {
      el.innerHTML = `<div class="leeg">${h.esc(h.netfout(e, "Kon het nieuws niet laden."))}</div>`;
    }
  }

  function kort(tekst) {
    const t = String(tekst || "").replace(/\s+/g, " ").trim();
    return t.length > 90 ? t.slice(0, 90) + "…" : t;
  }

  // ── Bericht openen ────────────────────────────────────────────────────────
  $("cmDetailX").addEventListener("click", sluitBericht);
  $("cmDetail").addEventListener("click", (e) => { if (e.target === $("cmDetail")) sluitBericht(); });

  function sluitBericht() {
    _open = null; _bewerkt = null;
    $("cmDetail").classList.add("verborgen");
  }

  async function openBericht(id) {
    const b = _berichten.find((x) => x.id === id);
    if (!b) return;
    _open = b; _bewerkt = null;
    $("cmDetailTitel").textContent = b.titel;
    $("cmDetailMeta").textContent = b.auteur_naam + " · " + wanneer(h, b.aangemaakt_op);
    $("cmDetailTekst").innerHTML = alinea(h.esc, b.bericht);
    $("cmDetailReacties").innerHTML = `<div class="leeg">Bezig met laden…</div>`;
    $("cmReactieMelding").classList.add("verborgen");
    $("cmReactieTekst").value = "";
    zetKnopTekst();
    $("cmDetail").classList.remove("verborgen");
    await Promise.all([laadReacties(), markeerGelezen(b.id)]);
  }

  // Gelezen-markering. Lukt dit niet, dan blijft het bericht als nieuw staan —
  // hinderlijk maar onschadelijk, dus geen melding over de tekst heen.
  async function markeerGelezen(berichtId) {
    const { error } = await db.from("nieuws_gelezen")
      .upsert({ bericht_id: berichtId, medewerker_id: h.mijnId() }, { onConflict: "bericht_id,medewerker_id" });
    if (error) { console.warn("nieuws_gelezen kon niet worden bijgewerkt:", error.message); return; }
    const b = _berichten.find((x) => x.id === berichtId);
    if (b) b.gelezen = true;
    werkTellingBij();
  }

  function werkTellingBij() {
    const ongelezen = _berichten.filter((b) => !b.gelezen).length;
    const tel = $("cmNieuwsTelling");
    tel.textContent = ongelezen ? String(ongelezen) + " nieuw" : "";
    tel.classList.toggle("verborgen", ongelezen === 0);
    const knop = document.querySelector('[data-cm-open="' + (_open ? _open.id : "") + '"]');
    if (knop) knop.classList.remove("cm-ongelezen");
  }

  // ── Reacties ──────────────────────────────────────────────────────────────
  async function laadReacties() {
    if (!_open) return;
    const el = $("cmDetailReacties");
    const { data, error } = await db.from("nieuws_reacties")
      .select("id, tekst, auteur_naam, medewerker_id, aangemaakt_op, gewijzigd_op")
      .eq("bericht_id", _open.id).order("aangemaakt_op");
    if (error) {
      el.innerHTML = `<div class="leeg">${h.esc(h.netfout(error, "De reacties konden niet worden geladen."))}</div>`;
      return;
    }
    const ik = h.mijnId();
    el.innerHTML = (data || []).length ? data.map((r) => {
      const vanMij = r.medewerker_id === ik;
      return `<div class="cm-reactie${vanMij ? " cm-van-mij" : ""}">
        <span class="cm-avatar">${h.esc(h.initialen(r.auteur_naam))}</span>
        <div class="cm-reactie-body">
          <div class="cm-reactie-kop">${h.esc(vanMij ? "Jij" : r.auteur_naam)}
            <span class="cm-zwak">${wanneer(h, r.aangemaakt_op)}${r.gewijzigd_op ? " · aangepast" : ""}</span></div>
          <div class="cm-reactie-tekst">${alinea(h.esc, r.tekst)}</div>
          ${vanMij ? `<div class="cm-reactie-acties">
            <button type="button" class="cm-link" data-cm-wijzig="${r.id}">Aanpassen</button>
            <button type="button" class="cm-link" data-cm-weg="${r.id}">Verwijderen</button>
          </div>` : ""}
        </div>
      </div>`;
    }).join("") : `<div class="leeg">Nog geen reacties. Jij mag de eerste zijn.</div>`;

    // Alleen eigen reacties krijgen knoppen; de database weigert de rest ook,
    // maar een knop die je niet mag indrukken hoort er niet te staan.
    el.querySelectorAll("[data-cm-wijzig]").forEach((k) => k.addEventListener("click", () => {
      const r = (data || []).find((x) => x.id === k.dataset.cmWijzig);
      if (!r) return;
      _bewerkt = r.id;
      $("cmReactieTekst").value = r.tekst;
      $("cmReactieTekst").focus();
      zetKnopTekst();
    }));
    el.querySelectorAll("[data-cm-weg]").forEach((k) =>
      k.addEventListener("click", () => verwijderReactie(k.dataset.cmWeg)));
  }

  function zetKnopTekst() {
    $("cmReactieBtn").textContent = _bewerkt ? "Reactie bijwerken" : "Reactie plaatsen";
    $("cmReactieAnnuleer").classList.toggle("verborgen", !_bewerkt);
  }

  $("cmReactieAnnuleer").addEventListener("click", () => {
    _bewerkt = null;
    $("cmReactieTekst").value = "";
    $("cmReactieMelding").classList.add("verborgen");
    zetKnopTekst();
  });

  $("cmReactieBtn").addEventListener("click", verstuurReactie);

  async function verstuurReactie() {
    const meld = $("cmReactieMelding");
    const tekst = $("cmReactieTekst").value.trim();
    if (!_open) return;
    if (!tekst) return h.toonMeld(meld, "fout", "Typ eerst je reactie.");
    if (tekst.length > 2000) return h.toonMeld(meld, "fout", "Je reactie is te lang; maximaal 2000 tekens.");

    $("cmReactieBtn").disabled = true;
    h.toonMeld(meld, "", _bewerkt ? "Bezig met bijwerken…" : "Bezig met plaatsen…");
    try {
      let fout;
      if (_bewerkt) {
        ({ error: fout } = await db.from("nieuws_reacties").update({ tekst }).eq("id", _bewerkt));
      } else {
        // medewerker_id moet mee voor de policy; de database overschrijft hem
        // alsnog met wie er echt is ingelogd.
        ({ error: fout } = await db.from("nieuws_reacties")
          .insert({ bericht_id: _open.id, medewerker_id: h.mijnId(), tekst }));
      }
      if (fout) {
        return h.toonMeld(meld, "fout", h.netfout(fout,
          _bewerkt ? "Bijwerken mislukt. Probeer het zo nog eens." : "Je reactie is niet geplaatst. Probeer het zo nog eens."));
      }
      _bewerkt = null;
      $("cmReactieTekst").value = "";
      zetKnopTekst();
      h.toonMeld(meld, "ok", "Je reactie staat erbij. Iedereen kan hem lezen.");
      await Promise.all([laadReacties(), laadNieuws()]);
    } catch (e) {
      h.toonMeld(meld, "fout", h.netfout(e, "Je reactie is niet geplaatst."));
    } finally {
      $("cmReactieBtn").disabled = false;
    }
  }

  async function verwijderReactie(id) {
    if (!confirm("Je reactie verwijderen?")) return;
    const meld = $("cmReactieMelding");
    const { error } = await db.from("nieuws_reacties").delete().eq("id", id);
    if (error) return h.toonMeld(meld, "fout", h.netfout(error, "Verwijderen mislukt. Probeer het zo nog eens."));
    if (_bewerkt === id) { _bewerkt = null; $("cmReactieTekst").value = ""; zetKnopTekst(); }
    h.toonMeld(meld, "ok", "Reactie verwijderd.");
    await Promise.all([laadReacties(), laadNieuws()]);
  }

  // ── Bestanden ─────────────────────────────────────────────────────────────
  async function laadBestanden() {
    const el = $("cmBestanden");
    const kaart = $("cmBestandenKaart");
    kaart.classList.remove("verborgen");
    try {
      // Geen filter op medewerker_id nodig: de policy laat alleen algemene
      // bestanden en de eigen documenten door. Zelf filteren zou suggereren dat
      // de afscherming aan deze kant zit, en dat is precies de aanname die je
      // hier niet wilt maken.
      const { data, error } = await db.from("bestanden")
        .select("id, titel, omschrijving, pad, bestandsnaam, grootte, medewerker_id, aangemaakt_op")
        .order("aangemaakt_op", { ascending: false });
      if (error) {
        el.innerHTML = `<div class="leeg">${h.esc(h.netfout(error, "Kon de bestanden niet laden. Probeer het zo nog eens."))}</div>`;
        return;
      }
      const alles = data || [];
      const algemeen = alles.filter((r) => !r.medewerker_id);
      const eigen = alles.filter((r) => r.medewerker_id);

      if (!alles.length) {
        el.innerHTML = `<div class="leeg">Er staan nog geen bestanden voor je klaar.</div>`;
        return;
      }
      el.innerHTML =
        (algemeen.length ? `<div class="cm-groep">Voor de hele ploeg</div>` + algemeen.map(bestandRij).join("") : "")
        + (eigen.length ? `<div class="cm-groep">Mijn documenten</div>` + eigen.map(bestandRij).join("") : "");

      el.querySelectorAll("[data-cm-haal]").forEach((k) => k.addEventListener("click", () => {
        const r = alles.find((x) => x.id === k.dataset.cmHaal);
        if (r) haalBestandOp(db, h, r, $("cmBestandMelding"));
      }));
    } catch (e) {
      el.innerHTML = `<div class="leeg">${h.esc(h.netfout(e, "Kon de bestanden niet laden."))}</div>`;
    }
  }

  function bestandRij(r) {
    return `<button type="button" class="cm-bestand" data-cm-haal="${r.id}">
      <span class="cm-bestand-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </span>
      <span class="cm-bestand-body">
        <span class="cm-bestand-titel">${h.esc(r.titel)}</span>
        <span class="cm-bestand-sub">${h.esc(r.omschrijving || r.bestandsnaam)}${grootteTekst(r.grootte) ? " · " + grootteTekst(r.grootte) : ""}</span>
      </span>
      <span class="cm-bestand-pijl" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"/><polyline points="7 11 12 16 17 11"/><path d="M5 20h14"/></svg>
      </span>
    </button>`;
  }

  async function laad() {
    await Promise.all([laadNieuws(), laadBestanden()]);
  }

  return { laad, laadNieuws, laadBestanden, ongelezen: () => _berichten.filter((b) => !b.gelezen).length };
}

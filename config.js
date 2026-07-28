// ============================================================================
//  Spaar Electra — Urenregistratie · configuratie
// ----------------------------------------------------------------------------
//  Vul hieronder de drie waarden in uit je Supabase-project
//  (Project Settings → API). Deze drie zijn openbaar/veilig voor de app.
//  De geheime service_role-sleutel hoort HIER NIET — die leeft alleen in de
//  Edge Function als secret.
// ============================================================================
// Lokaal meegeleverd in plaats van bij esm.sh opgehaald. Twee redenen: zonder
// bereik faalde die import en startte de app helemaal niet — precies op de
// bouwplaats waar geklokt moet worden — en "@2" haalde elke nieuwe minor
// ongezien binnen. Nu een vaste versie die met de app meegaat.
import { createClient } from "./vendor/supabase-js.js";

export const SUPABASE_URL = "https://otesjqpjocauonvqngff.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_7rL7nMLExoh_XuRqRj342g_yILqb6CX";
// URL van de pin-login functie: <SUPABASE_URL>/functions/v1/pin-login
export const PIN_LOGIN_URL = SUPABASE_URL + "/functions/v1/pin-login";
// Publieke VAPID-sleutel voor Web Push (de geheime helft leeft als Edge-secret).
export const VAPID_PUBLIC = "BDN8IVDcU3WFHNwQU4ykPE85_o61TqIWgJykir5EibBbd4GxcYi6-8s2M91zzqWENcp1sA9vCBGjd2rhCa7lwsM";

// Anonieme client (voor het inlogscherm van de monteur en voor de beheerder-login).
export function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

// Client voor de MONTEUR: logt in met e-mail + wachtwoord (Supabase Auth).
// Eigen opslagsleutel zodat een beheerder op dezelfde computer niet in de weg zit.
export function monteurClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, storageKey: "spaar-uren-monteur-sessie", autoRefreshToken: true },
  });
}

// Client die de BEHEERDER-sessie gebruikt (Supabase e-mail/wachtwoord login).
export function beheerClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, storageKey: "spaar-uren-beheer" },
  });
}

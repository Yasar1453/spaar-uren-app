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

export const SUPABASE_URL = "https://uren-api.spaarelectra.nl";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzk0ODM0NDE3LCJleHAiOjE5NTI1MTQ0MTd9.A7vNColcioVLtiMbIiF7pszVqxtQx0QMezcRS4YLAzU";
// URL van de pin-login functie: <SUPABASE_URL>/functions/v1/pin-login
export const PIN_LOGIN_URL = SUPABASE_URL + "/functions/v1/pin-login";
// Publieke VAPID-sleutel voor Web Push (de geheime helft leeft als Edge-secret).
export const VAPID_PUBLIC = "BJuJ821Vxva6f05LV5CPEo0vWdzBp2lKmt8_pHT2fFKOc6gNM4bDpcIvWOkQcjkE7YekZSd4y6_fz4scdFI9VsE";

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

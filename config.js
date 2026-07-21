// ============================================================================
//  Spaar Electra — Urenregistratie · configuratie
// ----------------------------------------------------------------------------
//  Vul hieronder de drie waarden in uit je Supabase-project
//  (Project Settings → API). Deze drie zijn openbaar/veilig voor de app.
//  De geheime service_role-sleutel hoort HIER NIET — die leeft alleen in de
//  Edge Function als secret.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://otesjqpjocauonvqngff.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_7rL7nMLExoh_XuRqRj342g_yILqb6CX";
// URL van de pin-login functie: <SUPABASE_URL>/functions/v1/pin-login
export const PIN_LOGIN_URL = SUPABASE_URL + "/functions/v1/pin-login";

// Anonieme client (voor het inlogscherm van de monteur en voor de beheerder-login).
export function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

// Client die namens een ingelogde MONTEUR praat (token uit pin-login).
export function monteurClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false },
  });
}

// Client die de BEHEERDER-sessie gebruikt (Supabase e-mail/wachtwoord login).
export function beheerClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, storageKey: "spaar-uren-beheer" },
  });
}

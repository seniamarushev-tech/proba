import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export function getSupabase() {
  const cfg = window.TRUST_CONFIG;
  if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON_KEY) {
    throw new Error("Нет SUPABASE_URL / SUPABASE_ANON_KEY в config.js");
  }
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
}

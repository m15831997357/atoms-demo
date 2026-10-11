import { createClient } from "@supabase/supabase-js";

export function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false },
  });
}

export function getOwner(req: Request) {
  const id = req.headers.get("x-owner-id") ?? "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}
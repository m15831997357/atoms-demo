import { db, getOwner } from "@/lib/supabase";

export async function GET(req: Request) {
  const owner = getOwner(req);
  if (!owner) return Response.json({ error: "缺少用户标识" }, { status: 401 });
  const { data, error } = await db()
    .from("projects")
    .select("id,title,updated_at")
    .eq("owner_id", owner)
    .order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(req: Request) {
  const owner = getOwner(req);
  if (!owner) return Response.json({ error: "缺少用户标识" }, { status: 401 });
  const { title } = await req.json();
  const { data, error } = await db()
    .from("projects")
    .insert({ owner_id: owner, title: String(title || "未命名项目").slice(0, 40) })
    .select("id,title,updated_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
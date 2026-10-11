import { db, getOwner } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const owner = getOwner(req);
  if (!owner) return Response.json({ error: "缺少用户标识" }, { status: 401 });
  const { id } = await params;
  const client = db();
  const { data: p } = await client
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("owner_id", owner)
    .maybeSingle();
  if (!p) return Response.json({ error: "项目不存在" }, { status: 404 });

  const { data, error } = await client
    .from("versions")
    .select("id,prompt,html,created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
import { db, getOwner } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

async function ownsProject(owner: string, id: string) {
  const { data } = await db()
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("owner_id", owner)
    .maybeSingle();
  return !!data;
}

export async function GET(req: Request, { params }: Ctx) {
  const owner = getOwner(req);
  if (!owner) return Response.json({ error: "缺少用户标识" }, { status: 401 });
  const { id } = await params;
  if (!(await ownsProject(owner, id))) return Response.json({ error: "项目不存在" }, { status: 404 });

  const client = db();
  const [msgs, ver] = await Promise.all([
    client.from("messages").select("role,content").eq("project_id", id).order("created_at", { ascending: true }),
    client.from("versions").select("html").eq("project_id", id).order("created_at", { ascending: false }).limit(1),
  ]);
  return Response.json({ messages: msgs.data ?? [], html: ver.data?.[0]?.html ?? "" });
}

export async function POST(req: Request, { params }: Ctx) {
  const owner = getOwner(req);
  if (!owner) return Response.json({ error: "缺少用户标识" }, { status: 401 });
  const { id } = await params;
  if (!(await ownsProject(owner, id))) return Response.json({ error: "项目不存在" }, { status: 404 });

  const { userMessage, assistantMessage, html } = await req.json();
  const client = db();
  const t = Date.now(); // 两条消息要有先后，不能用同一个默认时间
  const m = await client.from("messages").insert([
    { project_id: id, role: "user", content: userMessage, created_at: new Date(t).toISOString() },
    { project_id: id, role: "assistant", content: assistantMessage, created_at: new Date(t + 1).toISOString() },
  ]);
  const v = await client.from("versions").insert({ project_id: id, prompt: userMessage, html });
  await client.from("projects").update({ updated_at: new Date().toISOString() }).eq("id", id);

  if (m.error || v.error) {
    return Response.json({ error: m.error?.message ?? v.error?.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
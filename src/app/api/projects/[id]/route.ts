import { getProject, parseId } from "@/lib/pipeline";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  const p = id && getProject(id);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  let script: unknown = null;
  try {
    script = p.script ? JSON.parse(p.script) : null;
  } catch {
    script = null;
  }
  return Response.json({ ...p, script });
}

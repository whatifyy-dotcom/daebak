import { cancelProject, getProject, parseId } from "@/lib/pipeline";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id || !getProject(id)) return Response.json({ error: "not found" }, { status: 404 });
  cancelProject(id);
  return Response.json({ ok: true });
}

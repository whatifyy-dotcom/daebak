import { BUSY, enqueueRender, getProject, parseId } from "@/lib/pipeline";

type Ctx = { params: Promise<{ id: string }> };

/** 대본 승인 후 렌더 큐에 등록 (1건씩 순차 처리) */
export async function POST(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  const p = id && getProject(id);
  if (!id || !p) return Response.json({ error: "not found" }, { status: 404 });
  if (BUSY.has(p.status)) return Response.json({ error: `이미 작업 중(${p.status})` }, { status: 409 });
  if (!p.script) return Response.json({ error: "대본 없음" }, { status: 400 });
  if (!p.source_path) return Response.json({ error: "원본 없음" }, { status: 400 });
  enqueueRender(id);
  return Response.json({ ok: true });
}

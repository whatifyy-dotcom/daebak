import { BUSY, getProject, normalizeScript, parseId, saveScript, startScript } from "@/lib/pipeline";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/** 대본 생성 시작 (백그라운드) */
export async function POST(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  const p = id && getProject(id);
  if (!id || !p) return Response.json({ error: "not found" }, { status: 404 });
  if (BUSY.has(p.status)) return Response.json({ error: `이미 작업 중(${p.status})` }, { status: 409 });
  if (!p.source_path) return Response.json({ error: "원본 업로드 먼저" }, { status: 400 });
  startScript(id);
  return Response.json({ ok: true });
}

/** 사용자가 수정한 대본 저장 */
export async function PUT(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  const p = id && getProject(id);
  if (!id || !p) return Response.json({ error: "not found" }, { status: 404 });
  if (BUSY.has(p.status)) return Response.json({ error: `작업 중(${p.status})에는 수정 불가` }, { status: 409 });
  const s = normalizeScript(await req.json().catch(() => null));
  if (!s) return Response.json({ error: "narration:[{text}] 1개 이상 필요" }, { status: 400 });
  saveScript(id, s);
  if (p.status === "draft" || p.status === "failed" || p.status === "canceled") {
    db.prepare("UPDATE projects SET status = 'script_ready', error = NULL WHERE id = ?").run(id);
  }
  return Response.json({ ok: true });
}

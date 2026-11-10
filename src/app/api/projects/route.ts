import { db } from "@/lib/db";

export async function GET() {
  return Response.json(db.prepare("SELECT * FROM projects ORDER BY id DESC").all());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const { title, style, language, durationSec } = body as Record<string, unknown>;
  if (!title || typeof title !== "string") return Response.json({ error: "title required" }, { status: 400 });
  const d = Number(durationSec);
  const dur = Number.isFinite(d) && d > 0 ? Math.round(Math.min(59, Math.max(10, d))) : 58;
  const r = db
    .prepare("INSERT INTO projects (title, style, language, duration_sec) VALUES (?, ?, ?, ?)")
    .run(title, typeof style === "string" ? style : null, typeof language === "string" && language ? language : "ko", dur);
  return Response.json({ id: Number(r.lastInsertRowid) }, { status: 201 });
}

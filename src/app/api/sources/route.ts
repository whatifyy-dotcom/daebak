import { db } from "@/lib/db";

export async function GET() {
  return Response.json(db.prepare("SELECT * FROM sources ORDER BY id DESC").all());
}

export async function POST(req: Request) {
  const { platform, url, title, views, durationSec, keyword } = await req.json();
  if (!url) return Response.json({ error: "url required" }, { status: 400 });
  const r = db
    .prepare(
      "INSERT OR IGNORE INTO sources (platform, url, title, views, duration_sec, keyword) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(platform ?? "youtube", url, title ?? null, Number(views) || 0, durationSec ?? null, keyword ?? null);
  if (r.changes === 0) {
    const row = db.prepare("SELECT id FROM sources WHERE url = ?").get(url) as { id: number };
    return Response.json({ id: Number(row.id) });
  }
  return Response.json({ id: Number(r.lastInsertRowid) }, { status: 201 });
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "id required" }, { status: 400 });
  const r = db.prepare("DELETE FROM sources WHERE id = ?").run(id);
  return Response.json({ deleted: Number(r.changes) });
}

import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { probe } from "@/lib/media";
import { streamFilePart, UploadError } from "@/lib/multipart";
import { BUSY, getProject, parseId, uploadDir } from "@/lib/pipeline";

type Ctx = { params: Promise<{ id: string }> };

const EXTS = new Set(["mp4", "mov", "mkv", "webm"]);
const MAX = 4 * 1024 ** 3;

export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  const p = id && getProject(id);
  if (!id || !p) return Response.json({ error: "not found" }, { status: 404 });
  if (BUSY.has(p.status)) return Response.json({ error: `작업 중(${p.status})에는 업로드 불가` }, { status: 409 });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX + 1024 * 1024) return Response.json({ error: "파일이 너무 큼 (최대 4GB)" }, { status: 413 });

  const dir = uploadDir(id);
  fs.mkdirSync(dir, { recursive: true });
  let ext = "";
  const tmp = path.join(dir, `upload-${Date.now()}.tmp`);
  try {
    await streamFilePart(req, {
      field: "file",
      maxBytes: MAX,
      destFor: (filename) => {
        ext = path.extname(filename).slice(1).toLowerCase();
        if (!EXTS.has(ext)) throw new UploadError("mp4/mov/mkv/webm만 가능");
        return tmp;
      },
    });
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let durationSec: number;
  try {
    const info = await probe(tmp);
    if (!info.duration || !info.width) throw new Error("no video");
    durationSec = Math.round(info.duration * 100) / 100;
  } catch {
    fs.rmSync(tmp, { force: true });
    return Response.json({ error: "영상 파일을 읽을 수 없음" }, { status: 400 });
  }

  for (const f of fs.readdirSync(dir)) if (f.startsWith("original.") || f === "thumb.jpg") fs.rmSync(path.join(dir, f), { force: true });
  const dest = path.join(dir, `original.${ext}`);
  fs.renameSync(tmp, dest);
  db.prepare("UPDATE projects SET source_path = ?, original_duration = ?, error = NULL WHERE id = ?").run(dest, durationSec, id);
  return Response.json({ ok: true, durationSec });
}

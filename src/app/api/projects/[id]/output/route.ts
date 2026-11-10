import fs from "node:fs";
import { Readable } from "node:stream";
import { getProject, parseId } from "@/lib/pipeline";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  const p = id && getProject(id);
  if (!p || !p.output_path || !fs.existsSync(p.output_path)) return Response.json({ error: "not found" }, { status: 404 });
  const size = fs.statSync(p.output_path).size;
  const base = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="short-${p.id}.mp4"`,
    "Cache-Control": "no-store",
  };
  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && m && (m[1] || m[2])) {
    let start: number;
    let end: number;
    if (m[1]) {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(p.output_path, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(p.output_path)) as ReadableStream;
  return new Response(stream, { headers: { ...base, "Content-Length": String(size) } });
}

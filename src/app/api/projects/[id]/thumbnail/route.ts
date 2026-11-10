import fs from "node:fs";
import path from "node:path";
import { extractFrame, probe } from "@/lib/media";
import { getProject, outputDir, parseId, uploadDir } from "@/lib/pipeline";

type Ctx = { params: Promise<{ id: string }> };

/** 결과물이 있으면 결과물, 없으면 원본의 중간 프레임 jpg (캐시) */
export async function GET(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  const p = id && getProject(id);
  if (!id || !p) return Response.json({ error: "not found" }, { status: 404 });
  const useOutput = !!p.output_path && fs.existsSync(p.output_path);
  const src = useOutput ? p.output_path! : p.source_path;
  if (!src || !fs.existsSync(src)) return Response.json({ error: "영상 없음" }, { status: 404 });
  const thumb = path.join(useOutput ? outputDir(id) : uploadDir(id), "thumb.jpg");
  if (!fs.existsSync(thumb)) {
    try {
      const { duration } = await probe(src);
      await extractFrame(src, duration / 2, thumb, useOutput ? 540 : 640);
    } catch {
      return Response.json({ error: "썸네일 생성 실패" }, { status: 500 });
    }
  }
  return new Response(new Uint8Array(fs.readFileSync(thumb)), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  });
}

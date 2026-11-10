import { searchYoutube } from "@/lib/ytSearch";

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim();
  if (!q) return Response.json({ error: "q required" }, { status: 400 });
  try {
    const results = await searchYoutube({
      q,
      minViews: num(sp.get("minViews")),
      maxDuration: num(sp.get("maxDuration")),
      limit: num(sp.get("limit")) ?? 20,
    });
    return Response.json(results);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

import { spawn } from "node:child_process";

export type SearchResult = {
  platform: "youtube";
  url: string;
  title: string;
  views: number;
  durationSec: number | null;
  thumbnail: string | null;
  channel: string | null;
};

const TIMEOUT_MS = 90_000;

function runYtDlp(query: string, count: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.PYTHON_BIN || "python",
      ["-m", "yt_dlp", `ytsearch${count}:${query}`, "-j", "--skip-download", "--no-warnings", "--ignore-errors"],
      {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      },
    );
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("yt-dlp timeout"));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      // --ignore-errors: 개별 영상 실패(ERROR: [youtube] <id>: ...)만 있으면 code=1이어도 정상 취급.
      const onlyItemErrors = /ERROR: \[youtube\] [\w-]{11}:/.test(stderr);
      if (code !== 0 && !stdout.trim() && !onlyItemErrors) {
        reject(new Error(`yt-dlp exit ${code}: ${stderr.slice(0, 500)}`));
      } else resolve(stdout);
    });
  });
}

export async function searchYoutube(opts: {
  q: string;
  minViews?: number;
  maxDuration?: number;
  limit?: number;
}): Promise<SearchResult[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const stdout = await runYtDlp(opts.q, limit * 2);
  const results: SearchResult[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const url = (j.webpage_url as string) || (j.id ? `https://www.youtube.com/watch?v=${j.id}` : "");
    if (!url) continue;
    results.push({
      platform: "youtube",
      url,
      title: (j.title as string) ?? "",
      views: typeof j.view_count === "number" ? j.view_count : 0,
      durationSec: typeof j.duration === "number" ? Math.round(j.duration) : null,
      thumbnail: (j.thumbnail as string) ?? null,
      channel: ((j.channel ?? j.uploader) as string) ?? null,
    });
  }
  return results
    .filter((r) => (opts.minViews ? r.views >= opts.minViews : true))
    .filter((r) => (opts.maxDuration ? r.durationSec != null && r.durationSec <= opts.maxDuration : true))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

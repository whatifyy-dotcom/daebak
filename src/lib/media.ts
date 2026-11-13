// ffmpeg/ffprobe/python 호출 유틸. 외부 alias import 없이 node 내장만 사용.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assColor, getStyle, type RenderStyle, type TextStyle } from "./styles";

export type RunOpts = {
  cwd?: string;
  onSpawn?: (p: ChildProcess) => void;
  timeoutMs?: number;
  input?: string; // stdin으로 넘길 UTF-8 텍스트 (긴 프롬프트/한글 인자 이스케이프 회피)
  env?: NodeJS.ProcessEnv;
};

export function run(cmd: string, args: string[], opts: RunOpts = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true, env: opts.env });
    opts.onSpawn?.(p);
    let stdout = "";
    let stderr = "";
    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");
    p.stdin.on("error", () => {});
    if (opts.input !== undefined) p.stdin.end(opts.input, "utf8");
    else p.stdin.end();
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          p.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;
    p.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else if (timedOut) reject(new Error(`${cmd} 시간 초과 (${Math.round(opts.timeoutMs! / 1000)}초)`));
      else {
        const err = new Error(`${cmd} 실패 (code=${code}${signal ? `, signal=${signal}` : ""}): ${(stderr.trim() || stdout.trim()).split("\n").slice(-5).join(" | ").slice(0, 800)}`);
        reject(err);
      }
    });
  });
}

export const PYTHON = process.env.PYTHON_BIN || "python";

export async function probe(file: string): Promise<{ duration: number; hasAudio: boolean; width: number; height: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]);
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number }[];
  };
  const streams = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  return {
    duration: Number(j.format?.duration ?? 0) || 0,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
  };
}

export async function extractFrame(input: string, t: number, out: string, width = 512, opts: RunOpts = {}) {
  await run(
    "ffmpeg",
    ["-y", "-v", "error", "-ss", t.toFixed(3), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "5", out],
    opts,
  );
}

export async function pythonHasModule(mod: string): Promise<boolean> {
  try {
    await run(PYTHON, ["-c", `import importlib.util,sys; sys.exit(0 if importlib.util.find_spec(${JSON.stringify(mod)}) else 1)`], {
      timeoutMs: 20_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** faster-whisper 또는 whisper가 있으면 전사 텍스트 반환, 없으면 null */
export async function transcribe(input: string, workDir: string, language: string, opts: RunOpts = {}): Promise<string | null> {
  const wav = path.join(workDir, "audio.wav");
  let backend: "faster_whisper" | "whisper" | null = null;
  if (await pythonHasModule("faster_whisper")) backend = "faster_whisper";
  else if (await pythonHasModule("whisper")) backend = "whisper";
  if (!backend) return null;
  const info = await probe(input);
  if (!info.hasAudio) return null;
  await run("ffmpeg", ["-y", "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-t", "600", wav], opts);
  const script =
    backend === "faster_whisper"
      ? `import sys\nfrom faster_whisper import WhisperModel\nm=WhisperModel("small",device="auto",compute_type="int8")\nsegs,_=m.transcribe(sys.argv[1])\nsys.stdout.reconfigure(encoding="utf-8")\nprint(" ".join(s.text.strip() for s in segs))`
      : `import sys,whisper\nm=whisper.load_model("small")\nr=m.transcribe(sys.argv[1])\nsys.stdout.reconfigure(encoding="utf-8")\nprint(r["text"].strip())`;
  const pyFile = path.join(workDir, "transcribe.py");
  fs.writeFileSync(pyFile, script, "utf8");
  try {
    const { stdout } = await run(PYTHON, ["-I", pyFile, wav], { ...opts, timeoutMs: 15 * 60_000 });
    void language;
    return stdout.trim() || null;
  } catch {
    return null; // 전사는 선택 기능: 실패해도 진행
  }
}

// ---------- 렌더 ----------

export type Cue = { start: number; end: number; text: string };

function assTime(t: number) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function assEscape(s: string) {
  return s.replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
}

/** 한 줄 최대 글자수 기준 줄바꿈 (공백 우선) */
function wrap(text: string, max: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
    while (cur.length > max * 1.4) {
      lines.push(cur.slice(0, max));
      cur = cur.slice(max);
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\\N");
}

function assStyleLine(name: string, font: string, t: TextStyle, alignment: number, defMarginH: number) {
  const m = t.marginH ?? defMarginH;
  return `Style: ${name},${font},${t.size},${assColor(t.color)},${assColor(t.color)},${assColor(t.borderColor, t.borderOpacity ?? 1)},${assColor(t.shadowColor ?? "#000000", t.shadowOpacity ?? 0.5)},${t.bold ? 1 : 0},0,0,0,100,100,0,0,${t.border === "box" ? 3 : 1},${t.borderSize},${t.shadow},${alignment},${m},${m},${t.marginV},1`;
}

export function buildAss(opts: { headline1: string; headline2: string; cues: Cue[]; total: number; fontName?: string; style?: RenderStyle }) {
  const font = opts.fontName ?? "Malgun Gothic";
  const st = opts.style ?? getStyle(null);
  const bars = st.bars ?? [];
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${assStyleLine("H1", font, st.h1, 8, 60)}
${assStyleLine("H2", font, st.h2, 8, 60)}
${assStyleLine("Sub", font, st.sub, 2, 80)}
Style: Bar,${font},20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const end = assTime(opts.total);
  const lines: string[] = [];
  for (const b of bars) {
    const c = assColor(b.color, b.opacity ?? 1); // &HAABBGGRR
    const alpha = `&H${c.slice(2, 4)}&`;
    const bgr = `&H${c.slice(4)}&`;
    lines.push(
      `Dialogue: 0,${assTime(0)},${end},Bar,,0,0,0,,{\\an7\\pos(0,${b.y})\\bord0\\shad0\\1c${bgr}\\1a${alpha}\\p1}m 0 0 l 1080 0 l 1080 ${b.height} l 0 ${b.height}{\\p0}`,
    );
  }
  if (opts.headline1) lines.push(`Dialogue: 2,${assTime(0)},${end},H1,,0,0,0,,${assEscape(opts.headline1)}`);
  if (opts.headline2) lines.push(`Dialogue: 2,${assTime(0)},${end},H2,,0,0,0,,${assEscape(opts.headline2)}`);
  for (const c of opts.cues) {
    if (c.start >= opts.total) break;
    lines.push(`Dialogue: 1,${assTime(c.start)},${assTime(Math.min(c.end, opts.total))},Sub,,0,0,0,,${wrap(assEscape(c.text), st.subWrap)}`);
  }
  return header + lines.join("\n") + "\n";
}

/**
 * 9:16 블러배경 + 중앙 원본 + ASS 자막 + 나레이션 믹스.
 * cwd=workDir 에서 실행 (subs.ass, fonts/ 상대경로 사용 → 필터 경로 이스케이프 회피)
 */
export async function composeShort(opts: {
  input: string;
  inputHasAudio: boolean;
  narration: string | null; // 나레이션 오디오 (wav/mp3). null이면 원본 소리만
  workDir: string; // subs.ass, fonts/ 가 있는 곳
  output: string;
  total: number;
  encode?: { preset: string; crf: number }; // 기본 veryfast/23
  runOpts?: RunOpts;
}) {
  const v =
    "[0:v]fps=30,split=2[a][b];" +
    "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:4,eq=brightness=-0.08[bg];" +
    "[b]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg];" +
    "[bg][fg]overlay=(W-w)/2:(H-h)/2,subtitles=subs.ass:fontsdir=fonts,format=yuv420p[v]";
  // 입력1: 나레이션 또는 무음 (원본에 오디오가 없을 때도 오디오 트랙 보장)
  const second = opts.narration ? ["-i", opts.narration] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
  let a: string;
  if (opts.narration) {
    a = opts.inputHasAudio
      ? "[0:a]volume=0.15[oa];[1:a]volume=1.0,apad[na];[oa][na]amix=inputs=2:duration=longest:normalize=0[aout]"
      : "[1:a]apad[aout]";
  } else {
    a = opts.inputHasAudio ? "[0:a]anull[aout]" : "[1:a]anull[aout]";
  }
  const args = [
    "-y", "-v", "error",
    "-stream_loop", "-1", "-i", opts.input,
    ...second,
    "-filter_complex", `${v};${a}`,
    "-map", "[v]", "-map", "[aout]",
    "-t", opts.total.toFixed(3),
    "-c:v", "libx264", "-preset", opts.encode?.preset ?? "veryfast", "-crf", String(opts.encode?.crf ?? 23),
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
    "-movflags", "+faststart",
    opts.output,
  ];
  await run("ffmpeg", args, { ...opts.runOpts, cwd: opts.workDir });
}

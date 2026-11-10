// 원본 → 대본(AI) → 렌더 백그라운드 파이프라인. 로컬 전용, 프로세스 메모리 큐.
import fs from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { db } from "@/lib/db";
import { buildAss, composeShort, extractFrame, probe, pythonHasModule, run, transcribe, PYTHON, type Cue } from "@/lib/media";

export const DATA_DIR = path.join(process.cwd(), "data");
export const uploadDir = (id: number) => path.join(DATA_DIR, "uploads", String(id));
export const outputDir = (id: number) => path.join(DATA_DIR, "outputs", String(id));
export const workDir = (id: number, kind: string) => path.join(DATA_DIR, "work", String(id), kind);

const FONT_FILE = "C:\\Windows\\Fonts\\malgun.ttf";

export type Narration = { text: string };
export type Script = { headline1: string; headline2: string; ytTitle: string; narration: Narration[] };

export type ProjectRow = {
  id: number;
  title: string;
  source_path: string | null;
  style: string | null;
  language: string | null;
  script: string | null;
  status: string;
  output_path: string | null;
  created_at: string;
  duration_sec: number | null;
  error: string | null;
  headline1: string | null;
  headline2: string | null;
  yt_title: string | null;
  original_duration: number | null;
};

export function getProject(id: number): ProjectRow | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const BUSY = new Set(["scripting", "rendering"]);

/** 들어온 대본을 검증/정규화. 실패 시 null */
export function normalizeScript(x: unknown): Script | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const narr = Array.isArray(o.narration)
    ? o.narration
        .map((n) => (typeof n === "string" ? n : n && typeof n === "object" ? (n as { text?: unknown }).text : ""))
        .map(str)
        .filter(Boolean)
        .map((text) => ({ text }))
    : [];
  if (!narr.length) return null;
  return { headline1: str(o.headline1), headline2: str(o.headline2), ytTitle: str(o.ytTitle), narration: narr };
}

export function saveScript(id: number, s: Script) {
  db.prepare("UPDATE projects SET script = ?, headline1 = ?, headline2 = ?, yt_title = ? WHERE id = ?").run(
    JSON.stringify(s),
    s.headline1,
    s.headline2,
    s.ytTitle,
    id,
  );
}

// ---------- 실행 중 작업 관리 (HMR에도 유지되도록 globalThis) ----------
type JobState = {
  procs: Map<number, Set<ChildProcess>>;
  renderQueue: Promise<void>;
};
const g = globalThis as unknown as { _jobs?: JobState };
const jobs: JobState = (g._jobs ??= { procs: new Map(), renderQueue: Promise.resolve() });

function track(id: number) {
  return (p: ChildProcess) => {
    let set = jobs.procs.get(id);
    if (!set) jobs.procs.set(id, (set = new Set()));
    set.add(p);
    p.on("close", () => set!.delete(p));
  };
}

class Canceled extends Error {}

function ensureActive(id: number, status: string) {
  const p = getProject(id);
  if (!p || p.status !== status) throw new Canceled();
}

function fail(id: number, from: string, e: unknown) {
  if (e instanceof Canceled) return;
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[pipeline] project ${id} ${from} 실패:`, msg);
  db.prepare("UPDATE projects SET status = 'failed', error = ? WHERE id = ? AND status = ?").run(msg.slice(0, 2000), id, from);
}

export function cancelProject(id: number) {
  db.prepare("UPDATE projects SET status = 'canceled' WHERE id = ?").run(id);
  for (const p of jobs.procs.get(id) ?? []) p.kill("SIGKILL");
}

// ---------- 대본 생성 ----------

const LANG_NAME: Record<string, string> = { ko: "한국어", en: "English", ja: "日本語", zh: "中文", es: "Español" };

export function startScript(id: number) {
  db.prepare("UPDATE projects SET status = 'scripting', error = NULL, job_pid = ? WHERE id = ?").run(process.pid, id);
  void generateScript(id).catch((e) => fail(id, "scripting", e));
}

const CLI_TIMEOUT = 5 * 60_000;

function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // 로그인 세션을 쓰도록 키 제거, 상위 Claude Code 세션 표식 제거(중첩 실행 방지 회피)
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

/** 로컬 CLI(claude | codex)로 대본 생성. 프롬프트는 stdin(UTF-8)으로 전달. 최종 텍스트 반환 */
async function runScriptEngine(prompt: string, frames: string[], dir: string, opts: { onSpawn: (p: ChildProcess) => void }) {
  const engine = (process.env.SCRIPT_ENGINE || "claude").toLowerCase();
  const base = { cwd: dir, env: cliEnv(), input: prompt, timeoutMs: CLI_TIMEOUT, onSpawn: opts.onSpawn };
  const wrapErr = (name: string, e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ENOENT/.test(msg)) return new Error(`${name} CLI를 찾을 수 없음 (PATH 확인, SCRIPT_ENGINE=${engine})`);
    return new Error(`${name} CLI 대본 생성 실패: ${msg}`);
  };
  if (engine === "codex") {
    const last = path.join(dir, "codex-last.txt");
    const args = ["exec", "--skip-git-repo-check", "-s", "read-only", "-C", dir, "-o", last];
    for (const f of frames) args.push("-i", f);
    args.push("--", "-");
    try {
      const { stdout } = await run(process.env.CODEX_BIN || "codex", args, base);
      return fs.existsSync(last) ? fs.readFileSync(last, "utf8") : stdout;
    } catch (e) {
      throw wrapErr("codex", e);
    }
  }
  if (engine !== "claude") throw new Error(`알 수 없는 SCRIPT_ENGINE: ${engine} (claude|codex)`);
  try {
    const { stdout } = await run(
      process.env.CLAUDE_BIN || "claude",
      ["-p", "--output-format", "text", "--allowedTools", "Read", "--add-dir", dir],
      base,
    );
    return stdout;
  } catch (e) {
    throw wrapErr("claude", e);
  }
}

async function generateScript(id: number) {
  const p = getProject(id);
  if (!p) return;
  if (!p.source_path || !fs.existsSync(p.source_path)) throw new Error("원본 영상이 없음 (업로드 먼저)");
  const onSpawn = track(id);
  const dir = workDir(id, "script");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const dur = p.original_duration || (await probe(p.source_path)).duration;
  const frames: string[] = [];
  for (let i = 0; i < 8; i++) {
    const t = dur > 0 ? (dur * (i + 0.5)) / 8 : 0;
    const f = path.join(dir, `frame_${i}.jpg`);
    await extractFrame(p.source_path, t, f, 512, { onSpawn });
    if (fs.existsSync(f)) frames.push(f);
  }
  ensureActive(id, "scripting");
  if (!frames.length) throw new Error("프레임 추출 실패");

  const lang = p.language || "ko";
  const transcript = await transcribe(p.source_path, dir, lang, { onSpawn });
  ensureActive(id, "scripting");

  const target = p.duration_sec || 58;
  const charsPerSec = lang === "ko" || lang === "ja" || lang === "zh" ? 6.5 : 2.6; // ko/ja/zh=글자, 그 외=단어
  const budget = Math.floor((target - 2) * charsPerSec);
  const unit = charsPerSec > 3 ? "글자(공백 제외)" : "단어";

  const prompt = `너는 유튜브 쇼츠 나레이션 작가다. 아래 이미지 파일들은 원본 영상에서 시간 순서로 균등하게 뽑은 프레임 ${frames.length}장이다 (원본 길이 ${dur.toFixed(1)}초). 첨부돼 있지 않다면 Read 도구로 모두 열어서 보고 판단해라.
${frames.map((f, i) => `- 프레임 ${i + 1}: ${f}`).join("\n")}
프로젝트 제목: ${p.title}
스타일: ${p.style || "기본(정보 전달 + 흥미 유발)"}
출력 언어: ${LANG_NAME[lang] ?? lang}
목표 쇼츠 길이: ${target}초 이내
${transcript ? `원본 음성 전사:\n"""${transcript.slice(0, 6000)}"""\n` : "원본 음성 전사: 없음 (프레임만 보고 판단)\n"}
요구사항:
- headline1, headline2: 화면 상단에 고정될 후킹 문구 2줄, 각 14자 내외.
- ytTitle: 유튜브 업로드 제목 (해시태그 1~2개 포함 가능, 60자 이내).
- narration: 문장 단위 배열. 전체 분량은 약 ${budget}${unit} 이하 (빠른 TTS로 ${target - 2}초 안에 읽혀야 함). 첫 문장은 강한 후킹. 문장은 짧게.
- 모든 텍스트는 ${LANG_NAME[lang] ?? lang}로.
파일 수정이나 다른 작업은 하지 말고, 마크다운 코드블록·설명 없이 아래 형태의 JSON 한 개만 최종 출력:
{"headline1":"...","headline2":"...","ytTitle":"...","narration":[{"text":"..."}]}`;

  const text = await runScriptEngine(prompt, frames, dir, { onSpawn });
  ensureActive(id, "scripting");
  const m = text.match(/\{[\s\S]*\}/);
  let parsed: unknown = null;
  try {
    parsed = m ? JSON.parse(m[0]) : null;
  } catch {
    parsed = null;
  }
  const script = normalizeScript(parsed);
  if (!script) throw new Error(`AI 응답 JSON 파싱 실패: ${text.slice(0, 300)}`);
  saveScript(id, script);
  db.prepare("UPDATE projects SET status = 'script_ready', error = NULL WHERE id = ? AND status = 'scripting'").run(id);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- 렌더 ----------

const VOICES: Record<string, string> = {
  ko: "ko-KR-SunHiNeural",
  en: "en-US-JennyNeural",
  ja: "ja-JP-NanamiNeural",
  zh: "zh-CN-XiaoxiaoNeural",
  es: "es-ES-ElviraNeural",
};

export function enqueueRender(id: number) {
  db.prepare("UPDATE projects SET status = 'rendering', error = NULL, output_path = NULL, job_pid = ? WHERE id = ?").run(process.pid, id);
  jobs.renderQueue = jobs.renderQueue.then(() => renderProject(id).catch((e) => fail(id, "rendering", e)));
}

async function renderProject(id: number) {
  const p = getProject(id);
  if (!p || p.status !== "rendering") return; // 대기 중 취소됨
  const script = normalizeScript(p.script ? JSON.parse(p.script) : null);
  if (!script) throw new Error("대본 없음");
  if (!p.source_path || !fs.existsSync(p.source_path)) throw new Error("원본 영상이 없음");
  const hasTts = await pythonHasModule("edge_tts");

  const onSpawn = track(id);
  const dir = workDir(id, "render");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "fonts"), { recursive: true });
  if (fs.existsSync(FONT_FILE)) fs.copyFileSync(FONT_FILE, path.join(dir, "fonts", "malgun.ttf"));

  const GAP = 0.25;
  const maxDur = p.duration_sec || 58;
  const lang = p.language || "ko";
  let narration: string | null = null;
  let warning: string | null = null;
  const segs: { dur: number; text: string }[] = [];

  if (hasTts) {
    // 1) 문장별 TTS
    const voice = VOICES[lang] ?? VOICES.ko;
    const files: string[] = [];
    for (let i = 0; i < script.narration.length; i++) {
      const text = script.narration[i].text;
      const txt = path.join(dir, `n${i}.txt`);
      const mp3 = path.join(dir, `n${i}.mp3`);
      fs.writeFileSync(txt, text, "utf8");
      await run(PYTHON, ["-m", "edge_tts", "--voice", voice, "--rate", "+10%", "-f", txt, "--write-media", mp3], {
        onSpawn,
        timeoutMs: 120_000,
      });
      ensureActive(id, "rendering");
      files.push(mp3);
      segs.push({ dur: (await probe(mp3)).duration, text });
    }
    // 2) 나레이션 이어붙이기 (문장 사이 GAP)
    const inputs = files.flatMap((f) => ["-i", f]);
    const filt =
      files.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=stereo,apad=pad_dur=${GAP}[s${i}]`).join(";") +
      ";" +
      files.map((_, i) => `[s${i}]`).join("") +
      `concat=n=${files.length}:v=0:a=1[out]`;
    narration = path.join(dir, "narration.wav");
    await run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", filt, "-map", "[out]", narration], { onSpawn });
    ensureActive(id, "rendering");
  } else {
    // TTS 없음: 읽기 속도 추정으로 자막 타이밍만 잡고 원본 소리로 완성
    warning = "TTS(edge-tts) 미설치: 나레이션 음성 없이 자막+원본 소리로 렌더함";
    const cjk = lang === "ko" || lang === "ja" || lang === "zh";
    for (const n of script.narration) {
      const units = cjk ? n.text.replace(/\s/g, "").length / 6.5 : n.text.split(/\s+/).length / 2.6;
      segs.push({ dur: Math.max(1.2, units), text: n.text });
    }
    const est = segs.reduce((a, s) => a + s.dur + GAP, 0);
    const scale = est > maxDur - 0.3 ? (maxDur - 0.3) / est : 1;
    for (const s of segs) s.dur *= scale;
  }

  const cues: Cue[] = [];
  let t = 0;
  for (const s of segs) {
    cues.push({ start: t, end: t + s.dur, text: s.text });
    t += s.dur + GAP;
  }
  const total = Math.max(1, Math.min(maxDur, t + 0.3));

  // 3) 자막(ASS) + 합성
  fs.writeFileSync(
    path.join(dir, "subs.ass"),
    buildAss({ headline1: script.headline1, headline2: script.headline2, cues, total }),
    "utf8",
  );
  const info = await probe(p.source_path);
  const out = outputDir(id);
  fs.mkdirSync(out, { recursive: true });
  const tmpOut = path.join(out, "final.tmp.mp4");
  await composeShort({
    input: p.source_path,
    inputHasAudio: info.hasAudio,
    narration,
    workDir: dir,
    output: tmpOut,
    total,
    runOpts: { onSpawn },
  });
  ensureActive(id, "rendering");
  const finalPath = path.join(out, "final.mp4");
  fs.rmSync(path.join(out, "thumb.jpg"), { force: true });
  fs.renameSync(tmpOut, finalPath);
  db.prepare("UPDATE projects SET status = 'done', output_path = ?, error = ? WHERE id = ? AND status = 'rendering'").run(
    finalPath,
    warning,
    id,
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

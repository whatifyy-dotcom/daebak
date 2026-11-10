"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const LANGUAGES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "영어" },
  { value: "ja", label: "일본어" },
  { value: "zh", label: "중국어" },
  { value: "es", label: "스페인어" },
];

const STYLES = [
  { value: "basic", label: "기본" },
  { value: "clean_sub", label: "깔끔 자막" },
  { value: "bold_red", label: "강렬 빨강" },
  { value: "news", label: "뉴스형" },
  { value: "pastel", label: "파스텔" },
  { value: "quick", label: "빠른 확인" },
];

const DURATIONS = [30, 45, 58];
const ACCEPT_EXT = [".mp4", ".mov", ".mkv", ".webm"];

type Step = "idle" | "creating" | "uploading" | "scripting";

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // 본문이 JSON이 아니면 기본 메시지 사용
  }
  return `요청 실패 (${res.status})`;
}

// fetch는 업로드 진행률을 못 주므로 XHR로 업로드한다.
function uploadFile(id: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${id}/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let msg = `업로드 실패 (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        if (body && typeof body.error === "string") msg = body.error;
      } catch {
        // JSON이 아니면 기본 메시지 사용
      }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("네트워크 오류로 업로드에 실패했어"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export default function CreatePage() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("ko");
  const [style, setStyle] = useState("basic");
  const [durationSec, setDurationSec] = useState(58);

  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const busy = step !== "idle";

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (f) {
      const dot = f.name.lastIndexOf(".");
      const ext = dot >= 0 ? f.name.slice(dot).toLowerCase() : "";
      if (!ACCEPT_EXT.includes(ext)) {
        setFile(null);
        e.target.value = "";
        setError("mp4, mov, mkv, webm 파일만 선택할 수 있어");
        return;
      }
    }
    setFile(f);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;

    const t = title.trim();
    if (!t) {
      setError("제목을 입력해줘");
      return;
    }
    if (!file) {
      setError("원본 파일을 선택해줘");
      return;
    }

    setError(null);
    setProgress(0);
    setProjectId(null);
    try {
      setStep("creating");
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, style, language, durationSec }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const created = (await res.json()) as { id: number | string };
      const id = String(created.id);
      setProjectId(id);

      setStep("uploading");
      await uploadFile(id, file, setProgress);

      setStep("scripting");
      const scriptRes = await fetch(`/api/projects/${id}/script`, { method: "POST" });
      if (!scriptRes.ok) throw new Error(await readError(scriptRes));

      // 성공 시 버튼 비활성 상태를 유지한 채 이동한다.
      router.push(`/projects/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "제작 시작에 실패했어");
      setStep("idle");
    }
  }

  const inputClass =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-500";

  const labelClass = "mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400";

  const stepText: Record<Step, string> = {
    idle: "",
    creating: "프로젝트 만드는 중...",
    uploading: `업로드 중... ${progress}%`,
    scripting: "대본 생성 요청 중...",
  };

  return (
    <main className="mx-auto max-w-3xl space-y-10 p-6 md:p-8">
      <header>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">쇼츠 만들기</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          원본 영상을 올리면 대본을 만들어줄게.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* 제목 */}
        <section className="space-y-2">
          <label className="block">
            <span className={labelClass}>제목</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              placeholder="영상 제목"
              className={inputClass}
            />
          </label>
        </section>

        {/* 원본 파일 */}
        <section className="space-y-2">
          <label className="block">
            <span className={labelClass}>원본 파일 (mp4 · mov · mkv · webm)</span>
            <input
              type="file"
              accept=".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm"
              onChange={handleFile}
              disabled={busy}
              className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-neutral-800 hover:file:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:file:border-neutral-700 dark:file:bg-neutral-900 dark:file:text-neutral-200 dark:hover:file:bg-neutral-800"
            />
          </label>
          {file && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB
            </p>
          )}
        </section>

        {/* 제작 언어 */}
        <section className="space-y-2">
          <span className={labelClass}>제작 언어</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={busy}
            className={inputClass}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </section>

        {/* 스타일 */}
        <section className="space-y-2">
          <span className={labelClass}>스타일</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {STYLES.map((s) => {
              const selected = style === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setStyle(s.value)}
                  disabled={busy}
                  className={`rounded-xl border px-4 py-6 text-sm font-medium disabled:opacity-50 ${
                    selected
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                      : "border-neutral-200 text-neutral-800 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* 길이 */}
        <section className="space-y-2">
          <span className={labelClass}>길이 (초)</span>
          <div className="flex gap-2">
            {DURATIONS.map((d) => {
              const selected = durationSec === d;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDurationSec(d)}
                  disabled={busy}
                  className={`rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                    selected
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                      : "border-neutral-300 text-neutral-800 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  }`}
                >
                  {d}초
                </button>
              );
            })}
          </div>
        </section>

        {/* 진행 / 에러 */}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {busy && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{stepText[step]}</p>
            {step === "uploading" && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                <div
                  className="h-full bg-neutral-900 transition-all dark:bg-neutral-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {!busy && projectId && (
          <p className="text-sm">
            <Link href={`/projects/${projectId}`} className="underline text-neutral-700 dark:text-neutral-300">
              만든 프로젝트 보기
            </Link>
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {busy ? "제작 중..." : "제작 시작"}
        </button>
      </form>
    </main>
  );
}

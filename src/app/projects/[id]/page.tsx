"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";

type Status = "draft" | "scripting" | "script_ready" | "rendering" | "done" | "failed" | "canceled";

type Script = {
  headline1: string;
  headline2: string;
  ytTitle: string;
  narration: { text: string }[];
};

type Project = {
  id: number | string;
  title: string;
  style: string | null;
  language: string;
  status: Status;
  error: string | null;
  duration_sec: number | null;
  headline1: string | null;
  headline2: string | null;
  yt_title: string | null;
  script: Script | null;
  output_path: string | null;
};

type Draft = {
  headline1: string;
  headline2: string;
  ytTitle: string;
  narration: string; // 한 줄 = 나레이션 문장 하나
};

type Busy = "save" | "script" | "render" | "cancel" | null;

const POLL_MS = 2000;

const STATUS_LABEL: Record<Status, string> = {
  draft: "준비 중",
  scripting: "대본 생성 중",
  script_ready: "대본 확인 대기",
  rendering: "렌더링 중",
  done: "완성",
  failed: "실패",
  canceled: "취소됨",
};

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // 본문이 JSON이 아니면 기본 메시지 사용
  }
  return `요청 실패 (${res.status})`;
}

function toDraft(s: Script): Draft {
  return {
    headline1: s.headline1 ?? "",
    headline2: s.headline2 ?? "",
    ytTitle: s.ytTitle ?? "",
    narration: (s.narration ?? []).map((n) => n.text).join("\n"),
  };
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const id = encodeURIComponent(rawId);
  const base = `/api/projects/${id}`;

  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // 사용자가 수정한 대본. null이면 서버 대본을 그대로 보여준다.
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      setProject((await res.json()) as Project);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "프로젝트를 불러오지 못했어");
    }
  }, [base]);

  // 2초마다 폴링
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      await load();
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  async function post(path: string) {
    const res = await fetch(`${base}${path}`, { method: "POST" });
    if (!res.ok) throw new Error(await readError(res));
  }

  async function runAction(kind: Exclude<Busy, null>, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "요청에 실패했어");
    } finally {
      setBusy(null);
      await load();
    }
  }

  const serverDraft = project?.script ? toDraft(project.script) : null;
  const form = draft ?? serverDraft;

  function patch(p: Partial<Draft>) {
    if (!form) return;
    setDraft({ ...form, ...p });
  }

  function confirmScript() {
    return runAction("save", async () => {
      if (!form) throw new Error("대본이 없어");
      const narration = form.narration
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((text) => ({ text }));
      if (narration.length === 0) throw new Error("나레이션 문장을 한 줄 이상 입력해줘");

      const putRes = await fetch(`${base}/script`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline1: form.headline1,
          headline2: form.headline2,
          ytTitle: form.ytTitle,
          narration,
        }),
      });
      if (!putRes.ok) throw new Error(await readError(putRes));

      await post("/render");
      setDraft(null);
    });
  }

  const status = project?.status;
  const inProgress =
    status === "draft" || status === "scripting" || status === "script_ready" || status === "rendering";

  const inputClass =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-500";
  const labelClass = "mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400";
  const btnPrimary =
    "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300";
  const btnGhost =
    "rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";

  const cancelButton = inProgress ? (
    <button
      type="button"
      onClick={() => runAction("cancel", () => post("/cancel"))}
      disabled={busy !== null}
      className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-neutral-700 dark:text-red-400 dark:hover:bg-red-950"
    >
      {busy === "cancel" ? "취소 중..." : "취소"}
    </button>
  ) : null;

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6 md:p-8">
      <header className="space-y-2">
        <Link href="/projects" className="text-sm text-neutral-500 hover:underline dark:text-neutral-400">
          ← 내 영상
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {project?.title ?? "불러오는 중..."}
        </h1>
        {project && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            상태: {STATUS_LABEL[project.status] ?? project.status}
          </p>
        )}
      </header>

      {loadError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {loadError}
        </p>
      )}

      {actionError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {actionError}
        </p>
      )}

      {project && (
        <section className="space-y-4">
          {(status === "draft" || status === "scripting") && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                {status === "scripting" ? "대본 생성 중이야. 끝나면 자동으로 바뀌어." : "준비 중이야."}
              </p>
              {cancelButton}
            </div>
          )}

          {status === "script_ready" && form && (
            <div className="space-y-5 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                대본을 확인하고 필요하면 고쳐줘.
              </p>

              <label className="block">
                <span className={labelClass}>헤드라인 1</span>
                <input
                  type="text"
                  value={form.headline1}
                  onChange={(e) => patch({ headline1: e.target.value })}
                  disabled={busy !== null}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className={labelClass}>헤드라인 2</span>
                <input
                  type="text"
                  value={form.headline2}
                  onChange={(e) => patch({ headline2: e.target.value })}
                  disabled={busy !== null}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className={labelClass}>유튜브 제목</span>
                <input
                  type="text"
                  value={form.ytTitle}
                  onChange={(e) => patch({ ytTitle: e.target.value })}
                  disabled={busy !== null}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className={labelClass}>나레이션 (한 줄에 문장 하나)</span>
                <textarea
                  value={form.narration}
                  onChange={(e) => patch({ narration: e.target.value })}
                  disabled={busy !== null}
                  rows={10}
                  className={inputClass}
                />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={confirmScript}
                  disabled={busy !== null}
                  className={btnPrimary}
                >
                  {busy === "save" ? "진행 중..." : "이 대본으로 진행"}
                </button>
                {cancelButton}
              </div>
            </div>
          )}

          {status === "rendering" && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">렌더링 중이야. 잠시만 기다려줘.</p>
              {cancelButton}
            </div>
          )}

          {status === "done" && (
            <div className="space-y-4">
              <video
                controls
                src={`${base}/output`}
                className="w-full rounded-xl bg-black"
              />
              <div className="flex flex-wrap items-center gap-3">
                <a href={`${base}/output`} download className={btnGhost}>
                  mp4 다운로드
                </a>
              </div>
              {project.yt_title && (
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                  유튜브 제목: {project.yt_title}
                </p>
              )}
              <div>
                <p className={labelClass}>썸네일</p>
                {/* 서버 응답 이미지라 next/image 대신 img 사용 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${base}/thumbnail`}
                  alt="썸네일"
                  className="w-full max-w-md rounded-xl border border-neutral-200 dark:border-neutral-800"
                />
              </div>
            </div>
          )}

          {status === "failed" && (
            <div className="space-y-4 rounded-xl border border-red-200 p-4 dark:border-red-900">
              <p className="text-sm text-red-600 dark:text-red-400">
                {project.error ?? "알 수 없는 오류로 실패했어."}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    runAction("script", async () => {
                      setDraft(null);
                      await post("/script");
                    })
                  }
                  disabled={busy !== null}
                  className={btnGhost}
                >
                  {busy === "script" ? "요청 중..." : "대본 다시 만들기"}
                </button>
                <button
                  type="button"
                  onClick={() => runAction("render", () => post("/render"))}
                  disabled={busy !== null}
                  className={btnGhost}
                >
                  {busy === "render" ? "요청 중..." : "다시 렌더"}
                </button>
              </div>
            </div>
          )}

          {status === "canceled" && (
            <p className="text-sm text-neutral-700 dark:text-neutral-300">취소된 작업이야.</p>
          )}
        </section>
      )}
    </main>
  );
}

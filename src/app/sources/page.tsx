"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type SearchItem = {
  platform: string;
  url: string;
  title: string;
  views: number;
  durationSec: number;
  thumbnail: string;
  channel: string;
};

type SavedItem = Omit<SearchItem, "thumbnail"> & {
  id: number | string;
  thumbnail?: string;
};

function formatViews(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const trim = (v: number) => v.toFixed(1).replace(/\.0$/, "");
  if (n >= 100_000_000) return `${trim(n / 100_000_000)}억`;
  if (n >= 10_000) return `${trim(n / 10_000)}만`;
  return n.toLocaleString("ko-KR");
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "-";
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // 본문이 JSON이 아니면 기본 메시지 사용
  }
  return `요청 실패 (${res.status})`;
}

export default function SourcesPage() {
  const [keyword, setKeyword] = useState("");
  const [minViews, setMinViews] = useState("");
  const [maxDuration, setMaxDuration] = useState("");

  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [searchedKeyword, setSearchedKeyword] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [addingUrl, setAddingUrl] = useState<string | null>(null);
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);

  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | string | null>(null);

  const loadSaved = useCallback(async () => {
    setLoadingSaved(true);
    setSavedError(null);
    try {
      const res = await fetch("/api/sources", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as SavedItem[];
      setSaved(Array.isArray(data) ? data : []);
    } catch (e) {
      setSavedError(e instanceof Error ? e.message : "저장 목록을 불러오지 못했어");
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  async function handleSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = keyword.trim();
    if (!q) {
      setSearchError("키워드를 입력해줘");
      return;
    }

    const params = new URLSearchParams({ q, limit: "20" });
    if (minViews.trim() !== "") params.set("minViews", minViews.trim());
    if (maxDuration.trim() !== "") params.set("maxDuration", maxDuration.trim());

    setSearching(true);
    setSearchError(null);
    setAddError(null);
    try {
      const res = await fetch(`/api/sources/search?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as SearchItem[];
      setResults(Array.isArray(data) ? data : []);
      setSearchedKeyword(q);
    } catch (err) {
      setResults(null);
      setSearchError(err instanceof Error ? err.message : "검색에 실패했어");
    } finally {
      setSearching(false);
    }
  }

  async function handleAdd(item: SearchItem) {
    setAddingUrl(item.url);
    setAddError(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: item.platform,
          url: item.url,
          title: item.title,
          views: item.views,
          durationSec: item.durationSec,
          keyword: searchedKeyword,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setAddedUrls((prev) => new Set(prev).add(item.url));
      await loadSaved();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "추가에 실패했어");
    } finally {
      setAddingUrl(null);
    }
  }

  async function handleDelete(id: number | string) {
    setDeletingId(id);
    setSavedError(null);
    try {
      const res = await fetch(`/api/sources?id=${encodeURIComponent(String(id))}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res));
      await loadSaved();
    } catch (err) {
      setSavedError(err instanceof Error ? err.message : "삭제에 실패했어");
    } finally {
      setDeletingId(null);
    }
  }

  const inputClass =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-500";

  return (
    <main className="mx-auto max-w-5xl space-y-10 p-6 md:p-8">
      <header>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">소스 발굴</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          키워드로 유튜브 영상을 찾아 소스로 저장해.
        </p>
      </header>

      {/* 검색 */}
      <section>
        <form
          onSubmit={handleSearch}
          className="grid gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800 md:grid-cols-[1fr_9rem_9rem_auto] md:items-end"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">키워드</span>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="예: 자취 요리"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">최소 조회수</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={minViews}
              onChange={(e) => setMinViews(e.target.value)}
              placeholder="0"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">최대 길이(초)</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={maxDuration}
              onChange={(e) => setMaxDuration(e.target.value)}
              placeholder="60"
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            disabled={searching}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {searching ? "검색 중..." : "검색"}
          </button>
        </form>

        <div className="mt-6">
          {searching && <p className="text-sm text-neutral-500 dark:text-neutral-400">검색 중...</p>}

          {searchError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {searchError}
            </p>
          )}

          {addError && (
            <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
              {addError}
            </p>
          )}

          {!searching && !searchError && results !== null && results.length === 0 && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">검색 결과가 없어</p>
          )}

          {!searching && results !== null && results.length > 0 && (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((item, idx) => {
                const added = addedUrls.has(item.url);
                const adding = addingUrl === item.url;
                return (
                  <li
                    key={`${item.url}-${idx}`}
                    className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative block aspect-video bg-neutral-200 dark:bg-neutral-800"
                    >
                      {item.thumbnail ? (
                        // 외부 썸네일 URL이라 next/image 대신 img 사용
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnail}
                          alt={item.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                      <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white">
                        {formatDuration(item.durationSec)}
                      </span>
                    </a>
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-2 text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
                      >
                        {item.title}
                      </a>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">{item.channel}</p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        조회수 {formatViews(item.views)}
                      </p>
                      <div className="mt-auto pt-2">
                        <button
                          type="button"
                          onClick={() => handleAdd(item)}
                          disabled={adding || added}
                          className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          {added ? "추가됨" : adding ? "추가 중..." : "추가"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* 저장한 소스 */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">저장한 소스</h2>

        {loadingSaved && <p className="text-sm text-neutral-500 dark:text-neutral-400">불러오는 중...</p>}

        {savedError && (
          <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
            {savedError}
          </p>
        )}

        {!loadingSaved && !savedError && saved.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">저장한 소스가 없어</p>
        )}

        {!loadingSaved && saved.length > 0 && (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {saved.map((item) => {
              const deleting = deletingId === item.id;
              return (
                <li key={String(item.id)} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                    >
                      {item.title}
                    </a>
                    <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {item.channel} · 조회수 {formatViews(item.views)} · {formatDuration(item.durationSec)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    disabled={deleting}
                    className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-neutral-700 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    {deleting ? "삭제 중..." : "삭제"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

import Link from "next/link";

const cards = [
  { href: "/sources", t: "소스 발굴", d: "키워드로 해외 영상 검색" },
  { href: "/create", t: "쇼츠 만들기", d: "원본 업로드 → 대본 → 완성" },
  { href: "/projects", t: "내 영상", d: "만든 프로젝트 목록" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold">youtube_daebak</h1>
      <p className="mt-2 text-neutral-500">쇼츠 제작 도구 (로컬 전용)</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="rounded-xl border p-5 hover:bg-neutral-100 dark:hover:bg-neutral-900">
            <div className="font-semibold">{c.t}</div>
            <div className="mt-1 text-sm text-neutral-500">{c.d}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}

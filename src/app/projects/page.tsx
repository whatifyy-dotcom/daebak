import Link from "next/link";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function Page() {
  const rows = db.prepare("SELECT id, title, status, created_at FROM projects ORDER BY id DESC").all() as {
    id: number; title: string; status: string; created_at: string;
  }[];
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold">내 영상</h1>
      <ul className="mt-6 divide-y">
        {rows.length === 0 && <li className="py-3 text-neutral-500">아직 없음</li>}
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/projects/${r.id}`} className="flex justify-between py-3 hover:underline">
              <span>{r.title}</span>
              <span className="text-sm text-neutral-500">{r.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

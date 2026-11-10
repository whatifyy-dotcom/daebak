// 최소 스트리밍 multipart 파서: 지정 필드의 첫 파일 파트만 디스크로 바로 기록 (메모리 버퍼링 없음).
import fs from "node:fs";

export class UploadError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function streamFilePart(
  req: Request,
  opts: { field: string; maxBytes: number; destFor: (filename: string) => string },
): Promise<{ filename: string; path: string; bytes: number }> {
  const ct = req.headers.get("content-type") || "";
  const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!/^multipart\/form-data/i.test(ct) || !bm) throw new UploadError("multipart/form-data 필요");
  if (!req.body) throw new UploadError("본문 없음");
  const boundary = Buffer.from(`\r\n--${bm[1] ?? bm[2]}`);
  const reader = req.body.getReader();

  // 첫 경계 앞에 CRLF가 없으므로 가상으로 붙여서 일관 처리
  let buf: Buffer = Buffer.from("\r\n");
  let done = false;
  const pull = async () => {
    const r = await reader.read();
    if (r.done) done = true;
    else buf = buf.length ? Buffer.concat([buf, Buffer.from(r.value)]) : Buffer.from(r.value);
  };

  let out: fs.WriteStream | null = null;
  let outPath = "";
  let filename = "";
  let bytes = 0;

  const cleanup = () => {
    out?.destroy();
    if (outPath) fs.rmSync(outPath, { force: true });
  };

  try {
    // 파트 순회
    for (;;) {
      // 경계 찾기
      let idx: number;
      while ((idx = buf.indexOf(boundary)) < 0) {
        if (done) throw new UploadError(`'${opts.field}' 파일 파트 없음`);
        if (buf.length > boundary.length) buf = buf.subarray(buf.length - boundary.length);
        await pull();
      }
      buf = buf.subarray(idx + boundary.length);
      while (buf.length < 2 && !done) await pull();
      if (buf.subarray(0, 2).toString() === "--") throw new UploadError(`'${opts.field}' 파일 파트 없음`);
      // 헤더
      let hEnd: number;
      while ((hEnd = buf.indexOf("\r\n\r\n")) < 0) {
        if (done || buf.length > 16384) throw new UploadError("잘못된 multipart 헤더");
        await pull();
      }
      const headers = buf.subarray(0, hEnd).toString("utf8");
      buf = buf.subarray(hEnd + 4);
      const disp = headers.match(/content-disposition:[^\r\n]*/i)?.[0] ?? "";
      const name = disp.match(/\bname="([^"]*)"/i)?.[1];
      const fnStar = disp.match(/filename\*=UTF-8''([^;\r\n]+)/i)?.[1];
      const fn = fnStar ? decodeURIComponent(fnStar) : disp.match(/\bfilename="([^"]*)"/i)?.[1];
      if (name !== opts.field || fn === undefined) continue; // 다른 필드는 건너뜀

      filename = fn;
      outPath = opts.destFor(filename); // 확장자 검증 실패 시 여기서 throw
      out = fs.createWriteStream(outPath);
      const write = (chunk: Buffer) =>
        new Promise<void>((res, rej) => {
          bytes += chunk.length;
          if (bytes > opts.maxBytes) return rej(new UploadError("파일이 너무 큼 (최대 4GB)", 413));
          out!.write(chunk, (e) => (e ? rej(e) : res()));
        });
      for (;;) {
        const i = buf.indexOf(boundary);
        if (i >= 0) {
          if (i > 0) await write(buf.subarray(0, i));
          break;
        }
        if (done) throw new UploadError("업로드가 중간에 끊김");
        const safe = buf.length - boundary.length;
        if (safe > 0) {
          await write(buf.subarray(0, safe));
          buf = buf.subarray(safe);
        }
        await pull();
      }
      await new Promise<void>((res, rej) => out!.end((e?: Error | null) => (e ? rej(e) : res())));
      void reader.cancel().catch(() => {});
      return { filename, path: outPath, bytes };
    }
  } catch (e) {
    cleanup();
    void reader.cancel().catch(() => {});
    throw e;
  }
}

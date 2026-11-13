// 렌더 스타일 정의 (projects.style 값 → ASS 자막/헤드라인 모양 + 인코딩 품질).
// 새 스타일은 STYLES에 항목 하나 추가하면 끝. 모르는 값은 basic으로 폴백.
// media.ts가 상대경로로 import하므로 이 파일도 외부 alias import 금지.

/** "#RRGGBB" + 불투명도(0~1) → ASS 색 &HAABBGGRR (ASS alpha는 00=불투명) */
export function assColor(hex: string, opacity = 1): string {
  const h = hex.replace("#", "");
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  const a = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)
    .toString(16)
    .padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

export type TextStyle = {
  size: number;
  color: string; // 글자색 "#RRGGBB"
  bold: boolean;
  /** outline: 외곽선 / box: 줄 단위 배경 박스(ASS BorderStyle 3) */
  border: "outline" | "box";
  /** outline이면 외곽선 색, box면 박스 색 */
  borderColor: string;
  borderOpacity?: number; // 기본 1
  /** outline이면 외곽선 두께, box면 박스 안쪽 여백(px) */
  borderSize: number;
  shadow: number;
  shadowColor?: string; // 기본 검정
  shadowOpacity?: number; // 기본 0.5
  marginV: number; // H1/H2는 위에서, Sub는 아래에서의 거리
  marginH?: number; // 좌우 여백 (기본 H=60, Sub=80)
};

/** 화면 전체 폭 사각형 바 (헤드라인 배경 등). 렌더 내내 표시 */
export type Bar = { y: number; height: number; color: string; opacity?: number };

export type RenderStyle = {
  id: string;
  label: string;
  h1: TextStyle;
  h2: TextStyle;
  sub: TextStyle;
  subWrap: number; // 자막 한 줄 최대 글자수
  bars?: Bar[];
  encode: { preset: string; crf: number };
};

const ENCODE_DEFAULT = { preset: "veryfast", crf: 23 };

const basic: RenderStyle = {
  id: "basic",
  label: "기본",
  h1: { size: 86, color: "#FFFFFF", bold: true, border: "outline", borderColor: "#000000", borderSize: 6, shadow: 2, marginV: 150 },
  h2: { size: 86, color: "#FFE500", bold: true, border: "outline", borderColor: "#000000", borderSize: 6, shadow: 2, marginV: 260 },
  sub: { size: 64, color: "#FFFFFF", bold: true, border: "outline", borderColor: "#000000", borderSize: 5, shadow: 2, shadowOpacity: 0.4, marginV: 430 },
  subWrap: 16,
  encode: ENCODE_DEFAULT,
};

export const STYLES: Record<string, RenderStyle> = {
  basic,
  clean_sub: {
    id: "clean_sub",
    label: "깔끔 자막",
    h1: { size: 62, color: "#FFFFFF", bold: false, border: "outline", borderColor: "#000000", borderSize: 2, shadow: 0, marginV: 160 },
    h2: { size: 62, color: "#F2F2F2", bold: false, border: "outline", borderColor: "#000000", borderSize: 2, shadow: 0, marginV: 240 },
    sub: { size: 58, color: "#FFFFFF", bold: false, border: "outline", borderColor: "#000000", borderOpacity: 0.7, borderSize: 2, shadow: 1, shadowOpacity: 0.3, marginV: 430 },
    subWrap: 18,
    encode: ENCODE_DEFAULT,
  },
  bold_red: {
    id: "bold_red",
    label: "강렬 빨강",
    h1: { size: 90, color: "#FFFFFF", bold: true, border: "box", borderColor: "#E01B1B", borderSize: 16, shadow: 0, marginV: 150 },
    h2: { size: 90, color: "#FFFFFF", bold: true, border: "box", borderColor: "#E01B1B", borderSize: 16, shadow: 0, marginV: 290 },
    sub: { size: 72, color: "#FFE500", bold: true, border: "outline", borderColor: "#000000", borderSize: 7, shadow: 3, shadowOpacity: 0.6, marginV: 430 },
    subWrap: 14,
    encode: ENCODE_DEFAULT,
  },
  news: {
    id: "news",
    label: "뉴스형",
    // 상단 파란 바(120~380) 안에 헤드라인 2줄
    bars: [{ y: 120, height: 260, color: "#1450B4", opacity: 0.92 }],
    h1: { size: 76, color: "#FFFFFF", bold: true, border: "outline", borderColor: "#0A2A66", borderSize: 2, shadow: 0, marginV: 150 },
    h2: { size: 76, color: "#FFE500", bold: true, border: "outline", borderColor: "#0A2A66", borderSize: 2, shadow: 0, marginV: 258 },
    sub: { size: 60, color: "#FFFFFF", bold: true, border: "box", borderColor: "#000000", borderOpacity: 0.6, borderSize: 18, shadow: 0, marginV: 300, marginH: 40 },
    subWrap: 18,
    encode: ENCODE_DEFAULT,
  },
  pastel: {
    id: "pastel",
    label: "파스텔",
    h1: { size: 80, color: "#3A3A3A", bold: true, border: "box", borderColor: "#FFD6E0", borderSize: 18, shadow: 0, marginV: 150 },
    h2: { size: 80, color: "#3A3A3A", bold: true, border: "box", borderColor: "#CDEFE3", borderSize: 18, shadow: 0, marginV: 290 },
    sub: { size: 62, color: "#3A3A3A", bold: true, border: "box", borderColor: "#FFF4D6", borderOpacity: 0.92, borderSize: 16, shadow: 0, marginV: 430 },
    subWrap: 16,
    encode: ENCODE_DEFAULT,
  },
  quick: {
    ...basic,
    id: "quick",
    label: "빠른 확인",
    encode: { preset: "ultrafast", crf: 32 },
  },
};

/** projects.style 값 → 스타일. 없거나 모르는 값이면 basic */
export function getStyle(id: string | null | undefined): RenderStyle {
  return (id && Object.prototype.hasOwnProperty.call(STYLES, id) ? STYLES[id] : undefined) ?? basic;
}

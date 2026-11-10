# 릴박스 구조 분석 (공개 랜딩 페이지의 네트워크/번들 관찰)

## 스택
- 프론트: Vite + React SPA (assets/index-*.js, 코드 스플릿), react-router, zustand, axios
- 타임라인 편집기: Konva (vendor-konva) 캔버스 기반, color-picker, lucide 아이콘, react-toastify
- 호스팅: Vercel (/_vercel/insights, speed-insights)
- 파일 저장: Supabase Storage (공개 버킷 landing/: 데모 mp4, webp)
- 백엔드: 별도 API 서버 api.reelbox.ai (REST, /api/*)

## API 영역 (번들에서 추출한 경로)
- 인증: auth/login, register, refresh, me, verify-email, forgot/reset-password
- 채널: channels
- 생성: generate/images, generate/tts, generate/video, generate/thumbnails, scripts, pipeline/start, pipeline/tasks
- 자동 제작: auto-generation/configs, runs, uploads
- 영상/에셋: videos, assets, upload, thumbnails/extract-frames
- 유튜브: youtube-uploads/(schedule, auto-schedule, calendar), youtube/(analytics, top-videos, insights, recommendations, channel-metrics)
- 과금/알림: credits/pricing, me/credits/balances, notifications, plans

## 우리 앱에 주는 시사점
- 작업(run/task) 단위 비동기 파이프라인 + 상태 폴링 구조 → 우리 projects 상태 머신과 같은 방향
- 타임라인 편집은 Konva 캔버스 → 나중에 편집기 만들 때 같은 선택지
- 로그인/크레딧/알림/통계는 로컬 전용이라 제외

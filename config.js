// Firebase 콘솔 > 프로젝트 설정 > 내 앱 에서 복사한 값
export const firebaseConfig = {
  apiKey: "AIzaSyDCqDOL7pHwN0JPi9LxIG82666Oh5C132w",
  authDomain: "test1-c23d3.firebaseapp.com",
  projectId: "test1-c23d3",
  storageBucket: "test1-c23d3.firebasestorage.app",
  messagingSenderId: "370710335931",
  appId: "1:370710335931:web:6dd790a463624fda38749e"
};
// 코치 로그인 아이디 (영문 소문자/숫자)
export const COACH_ID = "choicoach";
// 아이디를 로그인 이메일로 바꿀 때 쓰는 도메인 (실제 메일 주소 아님)
export const ID_DOMAIN = "ptnote.app";
// AI 식단 분석에 쓸 Gemini 모델 (앞에서부터 시도)
export const AI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"];
// 앱 이름과 코치 기본 프로필 (설정 > 내 프로필에서 바꾼 값이 있으면 그 값이 우선)
export const BRAND = "최코치의 PT노트";
export const COACH_DEFAULT = {
  name: "최효준 트레이너",
  tagline: "체형 분석 기반 자세 교정 PT",
  intro: "",
  poster: "coach-poster.jpg",
  careers: [
    "생활스포츠지도사 2급 (보디빌딩)",
    "KACEP 대한운동사 정회원",
    "KACEP 운동사",
    "개인운동학 자격",
    "임상운동학 자격",
    "운동손상학 자격",
    "FISAF KOREA 퍼스널트레이닝 자격",
    "Body Sculpting",
    "Fundamental Training",
    "Session Program",
    "Clockgym Nutritions Management",
    "Clockgym Customer Service",
    "Clockgym Personal Training",
    "전) 조이 휘트니스 트레이너",
    "전) ING 휘트니스 구로점 매니저",
    "전) 노보텔 휘트니스클럽",
    "전) 강남, 독산 트레이너",
    "현) 100g훈련소 트레이닝센터",
    "현) 클락짐 당산점 퍼스널트레이너"
  ]
};

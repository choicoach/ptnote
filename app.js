import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig, COACH_ID, ID_DOMAIN, AI_MODELS, BRAND, COACH_DEFAULT } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let fs;
try { fs = initializeFirestore(app, { localCache: persistentLocalCache() }); } catch (e) { fs = initializeFirestore(app, {}); }

const COLS = ["sessions", "meals", "body", "workouts"];
const S = { members: [], sessions: [], meals: [], body: [], workouts: [], notes: {}, peers: [], requests: [], bookings: [] };
let pendingSignup = null;
let me = null; // {role:'coach'} | {role:'member', memberId}
let unsubs = [];
let ui = { coachMember: null, tab: "sessions", mtab: "home" };
try { const s = JSON.parse(localStorage.getItem("ptnote-ui") || "null"); if (s) ui = Object.assign(ui, s); } catch (e) {}
const saveUi = () => { try { localStorage.setItem("ptnote-ui", JSON.stringify(ui)); } catch (e) {} };

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const daysSince = d => d ? Math.floor((new Date(today()) - new Date(d)) / 864e5) : null;
const fmtD = d => { if (!d) return ""; const [, m, dd] = d.split("-"); const w = "일월화수목금토"[new Date(d).getDay()]; return `${+m}/${+dd} (${w})`; };
const by = (arr, k, dir = -1) => [...arr].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
const of = (col, mid) => S[col].filter(x => x.memberId === mid);
const idToEmail = id => `${id.trim().toLowerCase()}@${ID_DOMAIN}`;
const isCoach = () => me && me.role === "coach";
function toast(t) { const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2000); }

function errMsg(e) {
  const c = e && e.code || "";
  if (c.includes("permission")) return "권한이 없어 저장하지 못했어요.";
  if (c.includes("resource-exhausted")) return "무료 사용량을 넘었어요. 코치님께 알려 주세요.";
  if (c.includes("invalid-argument")) return "사진이 너무 커요. 다른 사진으로 시도해 주세요.";
  return "저장하지 못했어요. 인터넷 연결을 확인해 주세요.";
}
async function create(col, id, data, merge) {
  data.updatedAt = new Date().toISOString();
  try { await setDoc(doc(fs, col, id), data, merge ? { merge: true } : undefined); return true; } catch (e) { console.error(e); toast(errMsg(e)); return false; }
}
async function patch(col, id, data) {
  data.updatedAt = new Date().toISOString();
  try { await updateDoc(doc(fs, col, id), data); return true; } catch (e) { console.error(e); toast(errMsg(e)); return false; }
}
async function del(col, id) {
  try { await deleteDoc(doc(fs, col, id)); return true; } catch (e) { console.error(e); toast(errMsg(e)); return false; }
}

/* ---------- auth ---------- */
let coachProfile;
async function getCoachProfile(force) {
  if (coachProfile !== undefined && !force) return coachProfile;
  try { const d = await getDoc(doc(fs, "public", "coach")); coachProfile = d.exists() ? d.data() : null; } catch (e) { coachProfile = null; }
  return coachProfile;
}
const prof = () => { const p = Object.assign({}, COACH_DEFAULT, Object.fromEntries(Object.entries(coachProfile || {}).filter(([, v]) => v))); if (!Array.isArray(p.careers)) p.careers = String(p.careers || "").split("\n").filter(Boolean); return p; };
function coachCard(p, big) {
  p = p || prof();
  if (big) return `<div class="hero">
    <img class="hero-poster" draggable="false" src="${p.poster}" alt="${esc(p.name)} 소개 포스터">
    <div class="hero-brand">${esc(BRAND)}</div>
    ${p.tagline ? `<div class="hero-nm">${esc(p.name)} · ${esc(p.tagline)}</div>` : ""}
    ${p.intro ? `<div class="coach-intro">${esc(p.intro)}</div>` : ""}
  </div>`;
  return `<button type="button" class="ghost about-btn" data-act="coachAbout">담당 코치 ${esc(p.name)} · 이력 보기 ›</button>`;
}
function coachAboutSheet() {
  const p = prof();
  openSheet(`<div class="row between"><h2>${esc(BRAND)}</h2><button class="ghost sm" data-act="close">닫기</button></div>
  <img class="hero-poster" draggable="false" src="${p.poster}" alt="${esc(p.name)} 소개 포스터">
  <div class="hero-brand" style="text-align:center">${esc(BRAND)}</div>
  ${p.tagline ? `<div class="hero-nm" style="text-align:center">${esc(p.name)} · ${esc(p.tagline)}</div>` : ""}
  ${p.intro ? `<div class="fb">${esc(p.intro)}</div>` : ""}
  <div class="made-by">이 앱은 ${esc(p.name)}가 회원 관리를 위해 직접 기획하고 만들었어요.</div>`);
}
const madeBy = () => `<div class="made-by">${esc(BRAND)} · ${esc(prof().name)}가 직접 만든 회원 관리 앱</div>`;
function loginView(msg) {
  $("#bnav").hidden = true; $("#hdrRight").innerHTML = "";
  $("#app").innerHTML = `<div class="login">
    <div id="lg-head"><div class="login-mark"><img src="icon-192.png" alt="" width="72" height="72"></div>
    <h1>PT노트</h1></div>
    <p class="muted">아이디와 비밀번호로 로그인하세요.</p>
    <form id="loginForm" class="stack">
      <label class="f" for="lg-id">아이디<input id="lg-id" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
      <label class="f" for="lg-pw">비밀번호<input id="lg-pw" type="password" autocomplete="current-password" required minlength="6"></label>
      <button class="pri" type="submit">로그인</button>
      <div id="lg-msg" class="muted" style="font-size:13px">${esc(msg || "")}</div>
    </form>
    <button type="button" class="ghost" id="toSignup">처음이세요? 회원 가입 신청하기</button>
    <details class="install"><summary>홈 화면에 앱 아이콘 만들기</summary>
      <p><b>아이폰</b>: 사파리(또는 크롬)에서 이 주소를 열고 공유 버튼(□↑) → "홈 화면에 추가" → 추가</p>
      <p><b>갤럭시</b>: 크롬에서 열고 메뉴(⋮) → "홈 화면에 추가" 또는 "앱 설치"</p>
      <p>카카오톡 등 다른 앱 안에서 열었다면 먼저 "다른 브라우저로 열기"를 눌러 주세요.</p>
    </details>
  </div>`;
  $("#toSignup").onclick = signupView;
  $("#lg-head").innerHTML = coachCard(null, true);
  getCoachProfile().then(() => { const h = $("#lg-head"); if (h) h.innerHTML = coachCard(null, true); });
  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("#lg-id").value.trim().toLowerCase(), pw = $("#lg-pw").value;
    const m = $("#lg-msg"); m.textContent = "로그인 중…";
    try { await signInWithEmailAndPassword(auth, idToEmail(id), pw); }
    catch (err) {
      const c = err.code || "";
      if (id === COACH_ID && (c.includes("invalid-credential") || c.includes("user-not-found"))) {
        m.innerHTML = `코치 계정이 아직 없다면 지금 이 비밀번호로 만들 수 있어요. <button type="button" class="sm" id="mkCoach">코치 계정 만들기</button>`;
        $("#mkCoach").onclick = async () => {
          try { await createUserWithEmailAndPassword(auth, idToEmail(id), pw); }
          catch (e2) { m.textContent = (e2.code || "").includes("email-already") ? "비밀번호가 틀렸어요." : (e2.code || "").includes("weak-password") ? "비밀번호는 6자 이상이어야 해요." : "계정을 만들지 못했어요."; }
        };
      } else if (c.includes("too-many")) m.textContent = "시도가 너무 많아요. 잠시 후 다시 해 주세요.";
      else if (c.includes("network")) m.textContent = "인터넷 연결을 확인해 주세요.";
      else m.textContent = "아이디 또는 비밀번호가 맞지 않아요.";
    }
  });
}

function signupView() {
  $("#bnav").hidden = true; $("#hdrRight").innerHTML = "";
  $("#app").innerHTML = `<div class="login">
    <h1>가입 신청</h1>
    <p class="muted">신청하면 코치님이 확인 후 승인해요. 승인되면 바로 앱을 쓸 수 있어요.</p>
    <p class="muted" style="font-size:12px">안내: 식단 사진은 영양 분석을 위해 외부 AI 서비스(Google Gemini)로 보내질 수 있어요. 얼굴이나 다른 사람이 나오지 않게 음식만 찍어 주세요.</p>
    <form id="suForm" class="stack">
      <label class="f" for="su-name">이름<input id="su-name" required maxlength="20" placeholder="예: 송재민"></label>
      <label class="f" for="su-id">사용할 아이디 (영문 소문자·숫자 3~20자)<input id="su-id" required autocapitalize="off" spellcheck="false" autocomplete="username" placeholder="예: jaemin"></label>
      <label class="f" for="su-pw">비밀번호 (6자 이상)<input id="su-pw" type="password" required minlength="6" autocomplete="new-password"></label>
      <label class="f" for="su-pw2">비밀번호 확인<input id="su-pw2" type="password" required minlength="6" autocomplete="new-password"></label>
      <label class="f" for="su-goal">운동 목표 (선택)<input id="su-goal" maxlength="40" placeholder="예: 체지방 감량, 허리 통증 개선"></label>
      <button class="pri" type="submit">가입 신청</button>
      <div id="su-msg" class="muted" style="font-size:13px"></div>
    </form>
    <button type="button" class="ghost" id="toLogin">이미 아이디가 있어요 · 로그인</button>
  </div>`;
  $("#toLogin").onclick = () => loginView();
  $("#suForm").addEventListener("submit", async e => {
    e.preventDefault();
    const m = $("#su-msg");
    const name = $("#su-name").value.trim(), id = $("#su-id").value.trim().toLowerCase(), pw = $("#su-pw").value, pw2 = $("#su-pw2").value, goal = $("#su-goal").value.trim();
    if (!name) { m.textContent = "이름을 적어 주세요."; return; }
    if (!/^[a-z0-9]{3,20}$/.test(id) || id === COACH_ID) { m.textContent = "아이디는 영문 소문자·숫자 3~20자로 정해 주세요."; return; }
    if (pw.length < 6) { m.textContent = "비밀번호는 6자 이상이어야 해요."; return; }
    if (pw !== pw2) { m.textContent = "비밀번호 확인이 맞지 않아요."; return; }
    m.textContent = "신청하는 중…";
    pendingSignup = { name, goal, loginId: id };
    try { await createUserWithEmailAndPassword(auth, idToEmail(id), pw); }
    catch (err) { pendingSignup = null; const c = err.code || ""; m.textContent = c.includes("email-already") ? "이미 쓰고 있는 아이디예요. 다른 아이디를 정해 주세요." : c.includes("network") ? "인터넷 연결을 확인해 주세요." : "신청하지 못했어요. 다시 시도해 주세요."; }
  });
}
async function waitingView(user) {
  const loginId = (user.email || "").split("@")[0];
  if (pendingSignup) {
    try { await setDoc(doc(fs, "requests", user.uid), Object.assign({}, pendingSignup, { createdAt: new Date().toISOString() })); } catch (e) { console.error(e); }
    pendingSignup = null;
  }
  let r = null; try { r = await getDoc(doc(fs, "requests", user.uid)); } catch (e) {}
  $("#bnav").hidden = true;
  $("#hdrRight").innerHTML = `<button class="ghost sm" data-act="logout">로그아웃</button>`;
  if (r && r.exists()) {
    $("#app").innerHTML = `<div class="login">
      <div class="login-mark"><img src="icon-192.png" alt="" width="72" height="72"></div>
      <h1>승인 기다리는 중</h1>
      <p class="muted">${esc(r.data().name)}님의 가입 신청이 접수됐어요. 코치님이 승인하면 이 화면이 자동으로 바뀌어요.</p>
      <p class="muted" style="font-size:13px">아이디 <span class="num">${esc(loginId)}</span></p>
    </div>`;
  } else {
    $("#app").innerHTML = `<div class="login">
      <h1>가입 신청이 필요해요</h1>
      <p class="muted">아직 코치님 승인을 받지 않은 아이디예요. 이름을 적어 신청해 주세요.</p>
      <form id="rqForm" class="stack">
        <label class="f" for="rq-name">이름<input id="rq-name" required maxlength="20"></label>
        <label class="f" for="rq-goal">운동 목표 (선택)<input id="rq-goal" maxlength="40"></label>
        <button class="pri" type="submit">가입 신청</button>
      </form>
    </div>`;
    $("#rqForm").addEventListener("submit", async e => {
      e.preventDefault();
      pendingSignup = { name: $("#rq-name").value.trim(), goal: $("#rq-goal").value.trim(), loginId };
      if (!pendingSignup.name) return;
      waitingView(user);
    });
  }
  listen(doc(fs, "users", user.uid), d => { if (d.exists()) location.reload(); });
}

const LS = {};
function rebuild(col) { const m = new Map(); Object.values(LS).filter(r => r.col === col).forEach(r => r.rows.forEach(x => m.set(x.id, x))); S[col] = [...m.values()]; }
function stopQ(name) { const r = LS[name]; if (!r) return; try { r.unsub(); } catch (e) {} delete LS[name]; rebuild(r.col); }
function stopPrefix(p) { Object.keys(LS).filter(k => k.startsWith(p)).forEach(stopQ); }
function listenQ(name, col, q) {
  stopQ(name);
  const rec = { col, rows: [] }; LS[name] = rec;
  rec.unsub = onSnapshot(q, s => { rec.rows = rows(s); rebuild(col); render(); }, err => { console.error(err); toast("기록을 불러오지 못했어요."); });
}
function stopListening() { unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = []; Object.keys(LS).forEach(stopQ); }
function listen(q, cb) { unsubs.push(onSnapshot(q, cb, err => { console.error(err); toast("기록을 불러오지 못했어요."); })); }
const rows = snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
function openDetail(mid) {
  stopPrefix("d-");
  if (!mid) return;
  COLS.forEach(c => listenQ("d-" + c, c, query(collection(fs, c), where("memberId", "==", mid))));
}

onAuthStateChanged(auth, async user => {
  stopListening();
  Object.assign(S, { members: [], sessions: [], meals: [], body: [], workouts: [], notes: {}, peers: [], requests: [], bookings: [] });
  me = null;
  if (!user) return loginView();
  $("#app").innerHTML = `<div class="section"><div class="empty">기록을 불러오는 중…</div></div>`;
  if (user.email === idToEmail(COACH_ID)) {
    me = { role: "coach" };
    listenQ("g-members", "members", collection(fs, "members"));
    listenQ("g-sessions", "sessions", query(collection(fs, "sessions"), where("date", ">=", daysAgo(60))));
    listenQ("g-meals", "meals", query(collection(fs, "meals"), where("date", ">=", daysAgo(14))));
    listenQ("g-workouts", "workouts", query(collection(fs, "workouts"), where("date", ">=", daysAgo(30))));
    listenQ("g-requests", "requests", collection(fs, "requests"));
    listenQ("g-bookings", "bookings", query(collection(fs, "bookings"), where("date", ">=", daysAgo(35))));
    if (ui.coachMember) openDetail(ui.coachMember);
    listen(collection(fs, "coachNotes"), s => { S.notes = {}; s.docs.forEach(d => S.notes[d.id] = d.data()); });
    render();
    return;
  }
  let u;
  try { u = await getDoc(doc(fs, "users", user.uid)); } catch (e) { u = null; }
  if (!u || !u.exists()) return waitingView(user);
  const mid = u.data().memberId;
  me = { role: "member", memberId: mid };
  listen(doc(fs, "members", mid), d => { S.members = d.exists() ? [Object.assign({ id: d.id }, d.data())] : []; render(); });
  listen(query(collection(fs, "members"), where("shared", "==", true)), s => { S.peers = rows(s).filter(x => x.id !== mid); render(); });
  COLS.forEach(c => listen(query(collection(fs, c), where("memberId", "==", mid)), s => { S[c] = rows(s); render(); }));
  listen(query(collection(fs, "bookings"), where("memberId", "==", mid)), s => { S.bookings = rows(s); render(); });
  render();
});

/* ---------- header ---------- */
function renderHeader() {
  const r = $("#hdrRight");
  if (!me) { r.innerHTML = ""; return; }
  r.innerHTML = `<button class="ghost sm" data-act="settings">${isCoach() ? "최 코치" : esc((S.members[0] || {}).name || "내 정보")} ⚙</button>`;
}

/* ---------- status helpers ---------- */
function memberStatus(m) {
  const meals = of("meals", m.id), sess = of("sessions", m.id);
  const lastMeal = by(meals, "date")[0]?.date, lastSess = by(sess, "date")[0]?.date;
  const unreadFb = sess.filter(s => s.memberFb && !s.fbSeen).length;
  const uncommented = meals.filter(x => !x.coachComment && !x.seen).length;
  const mealGap = daysSince(lastMeal);
  const bs = m.bodySummary || (me && me.role === "member" ? bodySummaryFor(m.id) : null) || {};
  const wDelta = bs.n > 1 && bs.fw != null && bs.lw != null ? bs.lw - bs.fw : null;
  return { lastMeal, lastSess, unreadFb, uncommented, mealGap, wDelta, lastW: bs.lw ?? null };
}
function bodySummaryFor(mid) {
  const r = by(of("body", mid), "date", 1).filter(x => x.weight != null || x.smm != null);
  if (!r.length) return null;
  const f = r[0], l = r[r.length - 1];
  return { fw: f.weight ?? null, lw: l.weight ?? null, fs: f.smm ?? null, ls: l.smm ?? null, n: r.length };
}

/* ---------- COACH ---------- */
function coachHome() {
  const act = S.members.filter(m => m.status !== "ended");
  const sts = act.map(m => ({ m, s: memberStatus(m) }));
  const needs = sts.filter(x => x.s.unreadFb || x.s.uncommented || (x.s.mealGap !== null && x.s.mealGap >= 2) || x.s.lastMeal == null);
  const weekSess = S.sessions.filter(s => { const d = daysSince(s.date); return d !== null && d < 7 && d >= 0; }).length;
  const order = x => (x.s.unreadFb ? 4 : 0) + (x.s.uncommented ? 2 : 0) + ((x.s.mealGap ?? 9) >= 2 ? 1 : 0);
  sts.sort((a, b) => order(b) - order(a) || a.m.name.localeCompare(b.m.name, "ko"));
  const ended = S.members.filter(m => m.status === "ended");
  const reqs = by(S.requests, "createdAt", 1);
  const unlinked = S.members.filter(m => !m.uid && m.status !== "ended");
  return `${viewSwitch()}
  <div class="section">
    <div class="row between"><div><div class="eyebrow">${fmtD(today())}</div><h1>오늘의 회원 관리</h1></div>
    <div class="row"><button class="ghost" data-act="invite">회원 초대</button><button class="pri" data-act="newMember">+ 회원 등록</button></div></div>
    ${(() => { const n = S.meals.filter(x => !x.seen && !x.coachComment).length; return n ? `<button class="pri feed-btn" data-act="openFeed">📷 확인할 식단 ${n}장 모아보기</button>` : `<div class="muted" style="font-size:13px">확인할 새 식단이 없어요.</div>`; })()}
    <div class="stats">
      <div class="stat"><b>${act.length}</b><span>관리 중인 회원</span></div>
      <div class="stat"><b>${needs.length}</b><span>확인 필요</span></div>
      <div class="stat"><b>${weekSess}</b><span>최근 7일 수업</span></div>
    </div>
  </div>
  ${reqs.length ? `<div class="section">
    <div class="row between"><h2>가입 신청</h2><span class="chip new">${reqs.length}명 대기</span></div>
    <div class="roster">${reqs.map(r => `<div class="mem">
      <span class="av">${esc((r.name || "?").slice(0, 1))}</span>
      <span style="min-width:0"><span class="nm">${esc(r.name)}</span> <span class="sub">${esc(r.goal || "")}</span>
        <span class="sub" style="display:block">아이디 <span class="num">${esc(r.loginId)}</span>${r.createdAt ? " · " + fmtD(r.createdAt.slice(0, 10)) + " 신청" : ""}</span></span>
      <span class="row" style="flex-wrap:nowrap"><button class="sm ghost" data-act="rejectReq" data-id="${esc(r.id)}">거절</button><button class="sm pri" data-act="approveReq" data-id="${esc(r.id)}">승인</button></span>
      ${unlinked.length ? `<label class="f" style="grid-column:2/4" for="lk-${esc(r.id)}">승인할 때 연결
        <select id="lk-${esc(r.id)}"><option value="">새 회원으로 등록</option>${unlinked.map(m => `<option value="${esc(m.id)}" ${m.name === r.name ? "selected" : ""}>기존 기록과 연결: ${esc(m.name)}</option>`).join("")}</select></label>` : ""}
    </div>`).join("")}</div></div>` : ""}
  <div class="section">
    <div class="row between"><h2>회원 목록</h2><span class="muted" style="font-size:13px">확인할 게 많은 순</span></div>
    ${sts.length ? `<div class="roster">${sts.map(({ m, s }) => {
      const chips = [];
      if (s.unreadFb) chips.push(`<span class="chip new">회원 피드백 ${s.unreadFb}</span>`);
      if (s.uncommented) chips.push(`<span class="chip warn">식단 확인 ${s.uncommented}</span>`);
      if (s.lastMeal == null) chips.push(`<span class="chip">최근 2주 식단 없음</span>`);
      else if (s.mealGap >= 2) chips.push(`<span class="chip bad">식단 ${s.mealGap}일째 없음</span>`);
      if (m.shared) chips.push(`<span class="chip ok">기록 공개</span>`);
      const sk = streakOf(m.id); if (sk >= 2) chips.push(streakBadge(sk));
      const nb = nextBooking(m.id); if (nb) chips.push(`<span class="chip">다음 수업 ${shortD(nb.date)} ${esc(nb.start)}</span>`);
      const tr = s.wDelta == null ? (s.lastW ? `<div class="num">${s.lastW}kg</div>` : "") : `<div class="num">${s.lastW}kg</div><div class="${s.wDelta > 0 ? "up" : "down"}">${s.wDelta > 0 ? "+" : ""}${s.wDelta.toFixed(1)}</div>`;
      return `<button class="mem" data-act="openMember" data-id="${esc(m.id)}">
        <span class="av">${esc((m.name || "?").slice(0, 1))}</span>
        <span style="min-width:0"><span class="nm">${esc(m.name)}</span> <span class="sub">${esc(m.goal || "")}</span>
          <span class="sub" style="display:block">마지막 수업 ${s.lastSess ? fmtD(s.lastSess) : "-"}</span>
          <span class="chips">${chips.join("")}</span></span>
        <span class="trend">${tr}</span></button>`;
    }).join("")}</div>`
      : `<div class="empty">아직 등록된 회원이 없어요.<br><b>회원 등록</b>으로 회원 아이디를 만들어 주세요.</div>`}
  </div>
  ${ended.length ? `<div class="section"><h2>종료된 회원</h2><div class="roster">${ended.map(m => `<button class="mem" data-act="openMember" data-id="${esc(m.id)}"><span class="av">${esc(m.name.slice(0, 1))}</span><span class="nm">${esc(m.name)}</span><span></span></button>`).join("")}</div></div>` : ""}`;
}
function coachMember(m) {
  const tabs = [["sessions", "수업일지"], ["meals", "식단"], ["body", "체성분"], ["workouts", "개인운동"]];
  const note = S.notes[m.id]?.memo;
  return `<div class="section">
    <button class="back" data-act="home">← 회원 목록</button>
    <div class="row between">
      <div class="row"><span class="av">${esc(m.name.slice(0, 1))}</span><div><h1>${esc(m.name)}</h1><div class="muted" style="font-size:13px">${esc(m.goal || "목표 미입력")}${m.start ? " · " + fmtD(m.start) + " 시작" : ""} · 아이디 <span class="num">${esc(m.loginId || "-")}</span></div></div></div>
      <button class="ghost sm" data-act="editMember" data-id="${esc(m.id)}">정보 수정</button>
    </div>
    ${note ? `<div class="banner" style="white-space:pre-wrap"><b>코치 메모</b> ${esc(note)}</div>` : ""}
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${ui.tab === k}" data-act="tab" data-k="${k}">${l}</button>`).join("")}</div>
  </div>
  <div class="section">${tabBody(m, ui.tab, true)}</div>`;
}
function tabBody(m, tab, coach) {
  if (tab === "sessions") return sessionsView(m, coach);
  if (tab === "meals") return mealsView(m, coach);
  if (tab === "body") return bodyView(m, coach);
  if (tab === "workouts") return workoutsView(m, coach);
  return "";
}
function exTable(ex) {
  if (!ex || !ex.length) return "";
  return `<div class="tbl-wrap"><table><thead><tr><th>운동</th><th class="n">세트</th><th class="n">횟수</th><th class="n">무게</th></tr></thead><tbody>${ex.map(e => `<tr><td>${esc(e.name)}</td><td class="n">${esc(e.sets || "-")}</td><td class="n">${esc(e.reps || "-")}</td><td class="n">${e.kg ? esc(e.kg) + "kg" : "-"}</td></tr>`).join("")}</tbody></table></div>`;
}
function sessionsView(m, coach) {
  const list = by(of("sessions", m.id), "date");
  return `<div class="row between"><h2>수업일지</h2>${coach ? `<button class="pri sm" data-act="newSession">+ 오늘 수업 기록</button>` : ""}</div>
  ${list.length ? list.map(s => `<article class="card stack">
    <div class="sess-h"><span class="sess-date">${fmtD(s.date)}</span>
      <span class="row">${coach && s.memberFb && !s.fbSeen ? `<span class="chip new">새 피드백</span>` : ""}${coach ? `<button class="ghost sm" data-act="editSession" data-id="${esc(s.id)}">수정</button>` : ""}</span></div>
    ${exTable(s.exercises)}
    ${s.coachFb ? `<div><div class="fb-label">강사 피드백</div><div class="fb">${esc(s.coachFb)}</div></div>` : ""}
    ${s.memberFb ? `<div><div class="fb-label">회원 피드백</div><div class="fb mine">${esc(s.memberFb)}</div></div>` : (coach ? `<div class="muted" style="font-size:13px">회원 피드백 아직 없음</div>` : "")}
    ${!coach ? `<div class="stack"><label class="f" for="mfb-${esc(s.id)}">${s.memberFb ? "피드백 고치기" : "오늘 수업 어땠나요?"}</label><textarea id="mfb-${esc(s.id)}" placeholder="컨디션, 힘들었던 동작, 통증이 있었던 부위를 적어 주세요">${esc(s.memberFb || "")}</textarea><button class="pri" data-act="saveMemberFb" data-id="${esc(s.id)}">피드백 보내기</button></div>` : ""}
    ${coach && s.memberFb && !s.fbSeen ? `<button class="sm" data-act="markFb" data-id="${esc(s.id)}">확인 완료</button>` : ""}
  </article>`).join("") : `<div class="empty">${coach ? "아직 수업 기록이 없어요. <b>오늘 수업 기록</b>으로 운동과 피드백을 남겨 보세요." : "코치님이 수업 기록을 남기면 여기에 표시돼요."}</div>`}`;
}
/* ---------- meal management ---------- */
const DEFAULT_QUICK = ["👍 잘 드셨어요!", "단백질을 조금 더 추가해 주세요 (닭가슴살·계란·두부)", "채소를 한 줌 더 곁들여 주세요", "소스·드레싱은 따로 덜어서 반만", "밥 양을 2/3 공기로 줄여 볼게요", "물을 충분히 드세요 (하루 2L)", "튀김 대신 굽거나 찐 조리로 바꿔 볼게요", "간식은 과일·견과류 한 줌으로"];
const quickList = () => { const t = S.notes && S.notes._templates && S.notes._templates.items; return Array.isArray(t) && t.length ? t : DEFAULT_QUICK; };
const quickChips = () => `<div class="qc-row">${quickList().map(t => `<button type="button" class="qc" data-act="qc" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
const mealKcal = x => x.nutrition && x.nutrition.total ? (x.nutrition.total.adjKcal || x.nutrition.total.kcal || 0) : null;
const mealNut = (x, k) => x.nutrition && x.nutrition.total ? (+x.nutrition.total[k] || 0) : 0;
function dayStats(mid, date) {
  const items = S.meals.filter(x => x.memberId === mid && x.date === date);
  const an = items.filter(x => mealKcal(x) != null);
  const sum = k => an.reduce((a, x) => a + mealNut(x, k), 0);
  return { n: items.length, analyzed: an.length, kcal: an.reduce((a, x) => a + mealKcal(x), 0), carbs: sum("carbs"), protein: sum("protein"), fat: sum("fat") };
}
const shiftDate = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return iso(x); };
function streakOf(mid) {
  const days = new Set(S.meals.filter(x => x.memberId === mid).map(x => x.date));
  let d = days.has(today()) ? today() : shiftDate(today(), -1), n = 0;
  while (days.has(d)) { n++; d = shiftDate(d, -1); }
  return n;
}
/* daily goal: { kcal, carbs, protein, fat, ratio:{c,p,f} } — older goals had kcalMin/kcalMax/protein */
function goalT(m) {
  const g = m && m.mealGoal; if (!g) return null;
  if (g.kcal) return g;
  if (g.kcalMax || g.protein) return { kcal: g.kcalMax ? Math.round(((g.kcalMin || g.kcalMax) + g.kcalMax) / 2) : null, protein: g.protein || null, carbs: null, fat: null };
  return null;
}
const gState = (v, t) => v > t * 1.1 ? "over" : v >= t * 0.9 ? "ok" : "under";
function goalBar(label, val, target, unit) {
  if (!target) return "";
  const pct = Math.round(val / target * 100), st = gState(val, target);
  return `<div class="gbar"><span class="gl">${label}</span><span class="gt"><i class="${st}" style="width:${Math.min(100, pct)}%"></i></span><span class="gv num">${Math.round(val).toLocaleString()} / ${Math.round(target).toLocaleString()}${unit} <em class="${st}">${pct}%</em></span></div>`;
}
function dayGoalHtml(m, date) {
  const g = goalT(m), st = dayStats(m.id, date);
  if (!st.analyzed || !g) return "";
  return `<div class="gwrap">${goalBar("칼로리", st.kcal, g.kcal, "kcal")}${goalBar("탄수화물", st.carbs, g.carbs, "g")}${goalBar("단백질", st.protein, g.protein, "g")}${goalBar("지방", st.fat, g.fat, "g")}${st.analyzed < st.n ? `<div class="muted" style="font-size:11px">분석한 ${st.analyzed}/${st.n}끼 기준</div>` : ""}</div>`;
}
function goalCard(m, coach) {
  const g = goalT(m);
  if (!g) return coach ? `<div class="card row between"><span class="muted" style="font-size:13px">하루 식단 목표가 아직 없어요.</span><button class="sm pri" data-act="goalCalc" data-id="${esc(m.id)}">목표 정하기</button></div>` : "";
  const r = g.ratio || {}, cell = (lab, v, pc) => v ? `<div><b class="num">${Math.round(v)}g</b><span>${lab}${pc ? ` ${pc}%` : ""}</span></div>` : "";
  return `<div class="card stack goal-card"><div class="row between"><b>하루 식단 목표</b>${coach ? `<button class="sm" data-act="goalCalc" data-id="${esc(m.id)}">목표 바꾸기</button>` : `<span class="muted" style="font-size:12px">코치님이 정한 목표</span>`}</div>
    <div class="wstats">${g.kcal ? `<div><b class="num">${Math.round(g.kcal).toLocaleString()}</b><span>kcal</span></div>` : ""}${cell("탄수화물", g.carbs, r.c)}${cell("단백질", g.protein, r.p)}${cell("지방", g.fat, r.f)}</div>
    <div class="muted" style="font-size:11px">초록 = 목표의 90~110% · 파랑 = 부족 · 빨강 = 초과</div></div>`;
}
function weekReport(m, coach) {
  const off = ui.wkOff || 0, end = shiftDate(today(), -7 * off), start = shiftDate(end, -6);
  const meals = S.meals.filter(x => x.memberId === m.id && x.date >= start && x.date <= end);
  const days = [...Array(7)].map((_, i) => shiftDate(start, i));
  const per = days.map(d => ({ d, ...dayStats(m.id, d) }));
  const rec = per.filter(p => p.n).length, an = per.filter(p => p.analyzed && !(off === 0 && p.d === today()));   // today is still in progress
  const g = goalT(m) || {};
  const avg = k => an.length ? an.reduce((a, p) => a + p[k], 0) / an.length : null;
  const avgK = avg("kcal"), avgP = avg("protein");
  const kOk = g.kcal ? an.filter(p => gState(p.kcal, g.kcal) === "ok").length : null;
  const pOk = g.protein ? an.filter(p => p.protein >= g.protein * 0.9).length : null;
  const score = p => ["kcal", "carbs", "protein", "fat"].reduce((a, k) => a + (g[k] ? Math.abs(p[k] - g[k]) / g[k] : 0), 0);
  const ranked = (g.kcal || g.protein) && an.length >= 2 ? [...an].sort((a, b) => score(a) - score(b)) : [];
  const fb = meals.filter(x => x.coachComment).length;
  const bars = per.map(p => { const h = p.n ? Math.max(14, Math.min(100, (p.analyzed && g.kcal ? p.kcal / g.kcal / 1.3 : p.n / 4) * 100)) : 0;
    const cls = p.analyzed && g.kcal ? " " + gState(p.kcal, g.kcal) : "";
    return `<div class="wb"><span class="wbar${cls}" style="height:${h}%"></span><span class="wd2">${"일월화수목금토"[new Date(p.d + "T00:00:00").getDay()]}</span><span class="wn num">${p.n || ""}</span></div>`; }).join("");
  return `<div class="card stack wrep">
    <div class="row between"><b>주간 식단 리포트</b><span class="row"><button class="sm ghost" data-act="wkNav" data-k="1" aria-label="이전 주">‹</button><span class="muted num" style="font-size:13px">${shortD(start)}~${shortD(end)}</span><button class="sm ghost" data-act="wkNav" data-k="-1" aria-label="다음 주" ${off ? "" : "disabled"}>›</button></span></div>
    <div class="wbars${g.kcal ? " has-goal" : ""}">${bars}</div>
    <div class="wstats">
      <div><b class="num">${rec}/7</b><span>기록한 날</span></div>
      <div><b class="num">${meals.length}</b><span>올린 끼니</span></div>
      <div><b class="num">${avgK != null ? Math.round(avgK).toLocaleString() : "-"}</b><span>하루 평균 kcal</span></div>
      <div><b class="num">${avgP != null ? Math.round(avgP) + "g" : "-"}</b><span>하루 평균 단백질</span></div>
    </div>
    ${g.kcal || g.protein ? `<div class="muted" style="font-size:13px">${kOk != null ? `칼로리 목표 달성 ${kOk}/${an.length}일` : ""}${kOk != null && pOk != null ? " · " : ""}${pOk != null ? `단백질 목표 달성 ${pOk}/${an.length}일` : ""}</div>` : `<div class="muted" style="font-size:12px">${coach ? "식단 목표를 정하면 달성률이 나와요." : "코치님이 식단 목표를 정하면 달성률이 나와요."}</div>`}
    ${ranked.length ? `<div class="muted" style="font-size:13px">가장 잘한 날 <b>${fmtD(ranked[0].d)}</b> · 아쉬운 날 <b>${fmtD(ranked[ranked.length - 1].d)}</b></div>` : ""}
    <div class="muted" style="font-size:12px">코치 코멘트 ${fb}개 · 평균·달성률은 AI 분석한 날${off === 0 ? "(오늘 제외)" : ""} ${an.length}일 기준</div>
  </div>`;
}
/* ---------- goal calculator (coach only) ---------- */
const CALC_DEF = { cutSlow: -10, cutNormal: -20, cutFast: -25, bulk: 10, recomp: -5, pCut: 2.2, pBulk: 2.0, pKeep: 1.8, pRecomp: 2.2, fatPct: 25 };
const calcConf = () => Object.assign({}, CALC_DEF, (S.notes && S.notes._calc) || {});
const ACTS = [["1.2", "거의 안 움직임 (사무직, 운동 주 1회 이하)"], ["1.375", "가볍게 (운동 주 2~3회)"], ["1.55", "보통 (운동 주 4~5회)"], ["1.725", "많이 (매일 운동·육체 노동)"]];
const GOALS = [["cut", "체지방 감량"], ["keep", "유지"], ["bulk", "근육 증가"], ["recomp", "바디 리컴프 (근육↑ 지방↓)"]];
function calcGoal(v) {
  const c = calcConf();
  const lbm = v.lbm || (v.weight && v.fat ? v.weight - v.fat : null);
  const bmr = v.bmr || (lbm ? 370 + 21.6 * lbm : null);
  if (!bmr || !lbm) return null;
  const adj = v.goal === "cut" ? (v.speed === "slow" ? c.cutSlow : v.speed === "fast" ? c.cutFast : c.cutNormal) : v.goal === "bulk" ? c.bulk : v.goal === "recomp" ? c.recomp : 0;
  let kcal = bmr * v.act * (1 + adj / 100);
  if (adj < 0) kcal = Math.max(kcal, bmr);
  kcal = Math.round(kcal / 10) * 10;
  const ppk = { cut: c.pCut, bulk: c.pBulk, keep: c.pKeep, recomp: c.pRecomp }[v.goal];
  const pP = Math.round(lbm * ppk * 4 / kcal * 100), fP = Math.round(c.fatPct);
  return { kcal, p: pP, f: fP, c: Math.max(0, 100 - pP - fP), bmr: Math.round(bmr), lbm: Math.round(lbm * 10) / 10, tdee: Math.round(bmr * v.act) };
}
function goalSheet(m) {
  if (!isCoach()) return;
  const r = by(of("body", m.id), "date")[0] || {};
  const bs = (S.notes[m.id] && S.notes[m.id].goalBasis) || {};
  const g = m.mealGoal && m.mealGoal.kcal ? m.mealGoal : null;
  const lbm0 = r.lbm ?? (r.weight != null && r.fat != null ? Math.round((r.weight - r.fat) * 10) / 10 : "");
  const opt = (arr, cur) => arr.map(([v, t]) => `<option value="${v}" ${String(cur) === v ? "selected" : ""}>${t}</option>`).join("");
  openSheet(`<div class="row between"><h2>식단 목표 · ${esc(m.name)}</h2><button class="ghost sm" data-act="close">닫기</button></div>
  <div class="muted" style="font-size:12px">이 화면은 코치 계정에서만 보여요. 회원에게는 저장한 목표 숫자만 보여요.</div>
  <div class="eyebrow">인바디 ${r.date ? `(${fmtD(r.date)} 기록)` : "(기록 없음 · 직접 입력)"}</div>
  <div class="grid2">
    <label class="f" for="gc-w">체중 (kg)<input id="gc-w" inputmode="decimal" value="${esc(r.weight ?? "")}"></label>
    <label class="f" for="gc-fat">체지방량 (kg)<input id="gc-fat" inputmode="decimal" value="${esc(r.fat ?? "")}"></label>
    <label class="f" for="gc-lbm">제지방량 (kg)<input id="gc-lbm" inputmode="decimal" value="${esc(lbm0)}"></label>
    <label class="f" for="gc-bmr">기초대사량 (kcal)<input id="gc-bmr" inputmode="numeric" value="${esc(r.bmr ?? "")}" placeholder="비우면 제지방량으로 추정"></label>
  </div>
  <label class="f" for="gc-goal">운동 목표 (회원과 상의한 내용)<select id="gc-goal">${opt(GOALS, bs.goal || "cut")}</select></label>
  <label class="f" for="gc-speed" id="gc-speed-w">감량 속도<select id="gc-speed">${opt([["slow", "완만하게"], ["normal", "보통"], ["fast", "빠르게"]], bs.speed || "normal")}</select></label>
  <label class="f" for="gc-act">평소 활동량<select id="gc-act">${opt(ACTS, bs.act || "1.375")}</select></label>
  <div id="gc-info" class="muted num" style="font-size:12px"></div>
  <div class="eyebrow">하루 목표 (숫자를 고쳐도 돼요)</div>
  <label class="f" for="gc-kcal">칼로리 (kcal)<input id="gc-kcal" inputmode="numeric" value="${esc(g ? g.kcal : "")}"></label>
  <div class="grid3">
    <label class="f" for="gc-c">탄수화물 %<input id="gc-c" inputmode="numeric" value="${esc(g?.ratio?.c ?? "")}"></label>
    <label class="f" for="gc-p">단백질 %<input id="gc-p" inputmode="numeric" value="${esc(g?.ratio?.p ?? "")}"></label>
    <label class="f" for="gc-f">지방 %<input id="gc-f" inputmode="numeric" value="${esc(g?.ratio?.f ?? "")}"></label>
  </div>
  <div id="gc-out" class="wstats"></div>
  <div id="gc-msg" class="muted" style="font-size:13px"></div>
  <div class="row">${g || m.mealGoal ? `<button class="ghost" data-act="goalClear" data-id="${esc(m.id)}">목표 지우기</button>` : ""}<button class="ghost" data-act="goalRecalc" style="flex:1">다시 계산</button><button class="pri" data-act="goalSave" data-id="${esc(m.id)}" style="flex:2">저장</button></div>`, sh => {
    const recalc = () => {
      const v = { weight: numOrNull($("#gc-w").value), fat: numOrNull($("#gc-fat").value), lbm: numOrNull($("#gc-lbm").value), bmr: numOrNull($("#gc-bmr").value), goal: $("#gc-goal").value, speed: $("#gc-speed").value, act: +$("#gc-act").value };
      const res = calcGoal(v);
      if (!res) { $("#gc-info").textContent = "제지방량(또는 체중+체지방량)을 입력하면 계산돼요."; return; }
      $("#gc-kcal").value = res.kcal; $("#gc-c").value = res.c; $("#gc-p").value = res.p; $("#gc-f").value = res.f;
      $("#gc-info").textContent = `기초대사량 ${res.bmr.toLocaleString()}${v.bmr ? "" : "(추정)"} · 활동 포함 소비 약 ${res.tdee.toLocaleString()}kcal · 제지방량 ${res.lbm}kg`;
      grams();
    };
    const grams = () => {
      const k = numOrNull($("#gc-kcal").value) || 0, c = numOrNull($("#gc-c").value) || 0, p = numOrNull($("#gc-p").value) || 0, f = numOrNull($("#gc-f").value) || 0;
      const sum = c + p + f;
      $("#gc-out").innerHTML = k ? `<div><b class="num">${k.toLocaleString()}</b><span>kcal</span></div><div><b class="num">${Math.round(k * c / 400)}g</b><span>탄수화물</span></div><div><b class="num">${Math.round(k * p / 400)}g</b><span>단백질</span></div><div><b class="num">${Math.round(k * f / 900)}g</b><span>지방</span></div>` : "";
      $("#gc-msg").textContent = k && sum !== 100 ? `비율 합계가 ${sum}%예요. 100%로 맞춰 주세요.` : "";
    };
    const showSpeed = () => { $("#gc-speed-w").hidden = $("#gc-goal").value !== "cut"; };
    showSpeed();
    sh.addEventListener("change", e => { if (["gc-goal", "gc-speed", "gc-act"].includes(e.target.id)) { showSpeed(); recalc(); } });
    sh.addEventListener("input", e => { if (["gc-w", "gc-fat", "gc-lbm", "gc-bmr"].includes(e.target.id)) recalc(); else if (["gc-kcal", "gc-c", "gc-p", "gc-f"].includes(e.target.id)) grams(); });
    sh._recalc = recalc;
    if (g) { grams(); const res = calcGoal({ weight: numOrNull($("#gc-w").value), fat: numOrNull($("#gc-fat").value), lbm: numOrNull($("#gc-lbm").value), bmr: numOrNull($("#gc-bmr").value), goal: $("#gc-goal").value, speed: $("#gc-speed").value, act: +$("#gc-act").value }); if (res) $("#gc-info").textContent = `지금 인바디 기준 계산값: ${res.kcal.toLocaleString()}kcal · 탄 ${res.c}% · 단 ${res.p}% · 지 ${res.f}% (다시 계산을 누르면 적용)`; }
    else recalc();
  });
}
function streakBadge(n) { return n >= 2 ? `<span class="chip fire">🔥 ${n}일 연속</span>` : ""; }

/* ---------- meal review feed (coach) ---------- */
let feed = null;
function openFeed() {
  const q = S.meals.filter(x => !x.seen && !x.coachComment).sort((a, b) => (a.date + (a.updatedAt || "")) < (b.date + (b.updatedAt || "")) ? -1 : 1).map(x => x.id);
  feed = { q, i: 0 }; renderFeed();
}
function renderFeed() {
  if (!feed) return;
  const q = feed.q.filter(id => find("meals", id)); feed.q = q;
  if (feed.i >= q.length) feed.i = Math.max(0, q.length - 1);
  if (!q.length) { openSheet(`<div class="row between"><h2>식단 확인</h2><button class="ghost sm" data-act="closeFeed">닫기</button></div><div class="empty">확인할 식단을 다 봤어요 👏</div>`); return; }
  const x = find("meals", q[feed.i]); const m = S.members.find(z => z.id === x.memberId) || { name: "회원", id: x.memberId };
  const st = dayStats(m.id, x.date), sk = streakOf(m.id), shown = x.thumb || x.photo;
  pendingNutrition = null;
  openSheet(`<div class="row between"><h2>식단 확인 <span class="muted num" style="font-size:15px">${feed.i + 1} / ${q.length}</span></h2><button class="ghost sm" data-act="closeFeed">닫기</button></div>
    <div class="row between"><div><b>${esc(m.name)}</b> <span class="muted">${fmtD(x.date)} · ${esc(x.type || "")}</span></div>${streakBadge(sk)}</div>
    <div class="muted" style="font-size:13px">이날 ${st.n}끼${st.analyzed ? ` · 분석한 ${st.analyzed}끼 약 ${Math.round(st.kcal).toLocaleString()}kcal · 단백질 ${Math.round(st.protein)}g` : ""}</div>
    ${dayGoalHtml(m, x.date)}
    ${shown ? `<img id="meal-big" class="big-img feed-img" src="${shown}" alt="식사 사진">` : `<div class="empty">사진 없음</div>`}
    ${x.memo ? `<div><div class="fb-label">회원 메모</div><div class="fb mine">${esc(x.memo)}</div></div>` : ""}
    ${shown ? `<div class="row between"><span class="muted" style="font-size:13px">칼로리·탄단지 추정</span><button class="sm" data-act="aiMeal" data-id="${esc(x.id)}">AI 분석</button></div><div id="ai-msg" class="muted" style="font-size:13px"></div>` : ""}
    ${quickChips()}
    <label class="f" for="fmc">코치 코멘트<textarea id="fmc" rows="4" placeholder="빠른 코멘트를 누르거나 직접 적어 주세요"></textarea></label>
    <div class="row"><button class="ghost" data-act="feedPrev" ${feed.i ? "" : "disabled"} aria-label="이전">‹</button><button class="ghost" data-act="markMealSeen" data-id="${esc(x.id)}" style="flex:1">확인만</button><button class="pri" data-act="saveMealComment" data-id="${esc(x.id)}" style="flex:2">저장하고 다음</button><button class="ghost" data-act="feedNext" ${feed.i < q.length - 1 ? "" : "disabled"} aria-label="다음">›</button></div>`);
  showFull(x, "#meal-big");
}

function mealsView(m, coach) {
  const meals = of("meals", m.id);
  const days = [...new Set(meals.map(x => x.date))].sort().reverse();
  const order = { "아침": 1, "점심": 2, "저녁": 3, "간식": 4 };
  return `<div class="row between"><h2>식단일지 ${streakBadge(streakOf(m.id))}</h2>${!coach ? `<button class="pri sm" data-act="newMeal">+ 식사 올리기</button>` : ""}</div>
  ${goalCard(m, coach)}
  ${meals.length ? weekReport(m, coach) : ""}
  ${!coach ? `<div class="muted" style="font-size:13px">물 이외에 먹은 것은 모두 사진으로 남겨 주세요. 식사 전에 찍어 두고 저녁에 한 번에 올려도 괜찮아요.</div>` : ""}
  ${days.length ? days.map(d => {
    const items = meals.filter(x => x.date === d).sort((a, b) => (order[a.type] || 9) - (order[b.type] || 9));
    return `<div class="day"><div class="row between"><h3 class="num">${fmtD(d)}</h3><span class="muted num" style="font-size:13px">${(() => { const t = items.filter(i => i.nutrition?.total); if (!t.length) return items.length + "끼"; const k = t.reduce((a, i) => a + (i.nutrition.total.adjKcal || i.nutrition.total.kcal || 0), 0), pr = t.reduce((a, i) => a + (i.nutrition.total.protein || 0), 0); return `${items.length}끼 · 약 ${Math.round(k).toLocaleString()}kcal · 단백질 ${Math.round(pr)}g${t.length < items.length ? " (일부)" : ""}`; })()}</span></div>
    ${dayGoalHtml(m, d)}
    <div class="meals">${items.map(x => `<button class="meal" data-act="openMeal" data-id="${esc(x.id)}">
      ${(x.thumb || x.photo) ? `<img src="${x.thumb || x.photo}" alt="${esc(x.type)} 사진" loading="lazy">` : `<div class="noimg">${esc(x.memo || "사진 없음")}</div>`}
      ${x.coachComment ? `<span class="dot chip ok">코멘트</span>` : (coach && !x.seen ? `<span class="dot chip new">NEW</span>` : "")}
      <span class="cap"><b>${esc(x.type)}</b><span>${esc((x.memo || "").slice(0, 12))}</span></span></button>`).join("")}</div></div>`;
  }).join("") : `<div class="empty">${coach ? "회원이 아직 식단을 올리지 않았어요." : "첫 식사 사진을 올려 보세요."}</div>`}`;
}
function spark(rowsArr, key, cls) {
  const lab = { weight: "체중", smm: "골격근량", fat: "체지방량" }[key];
  const pts = rowsArr.filter(r => r[key] != null && r[key] !== "").map(r => ({ d: r.date, v: +r[key] }));
  if (!pts.length) return `<div class="chart ${cls}"><div class="k"><span class="eyebrow">${lab}</span></div><div class="muted" style="font-size:13px;margin-top:8px">기록 없음</div></div>`;
  const last = pts[pts.length - 1], first = pts[0], dv = last.v - first.v;
  const W = 240, H = 90, px = 8, pt = 12, pb = 18;
  let mn = Math.min(...pts.map(p => p.v)), mx = Math.max(...pts.map(p => p.v));
  if (mx - mn < 1) { mn -= 0.5; mx += 0.5; }
  const x = i => pts.length === 1 ? W / 2 : px + i * (W - 2 * px) / (pts.length - 1);
  const y = v => pt + (mx - v) * (H - pt - pb) / (mx - mn);
  const col = key === "weight" ? "var(--accent)" : key === "smm" ? "var(--c-smm)" : "var(--c-fat)";
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = pts.length > 1 ? `${line}L${x(pts.length - 1).toFixed(1)},${H - pb}L${x(0).toFixed(1)},${H - pb}Z` : "";
  return `<div class="chart ${cls}"><div class="k"><span class="eyebrow">${lab}</span>${pts.length > 1 ? `<span class="d ${dv > 0 ? "up" : dv < 0 ? "down" : ""}">${dv > 0 ? "+" : ""}${dv.toFixed(1)}kg</span>` : ""}</div>
  <div class="v">${last.v}<span class="muted" style="font-size:13px"> kg</span></div>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${lab} 추이">
    <line x1="${px}" x2="${W - px}" y1="${y(mx)}" y2="${y(mx)}" stroke="var(--line)" stroke-dasharray="2 3"/>
    <line x1="${px}" x2="${W - px}" y1="${y(mn)}" y2="${y(mn)}" stroke="var(--line)" stroke-dasharray="2 3"/>
    ${area ? `<path d="${area}" fill="${col}" fill-opacity=".12"/>` : ""}
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="${i === pts.length - 1 ? 3.5 : 2}" fill="${col}"/>`).join("")}
    <text x="${px}" y="${H - 4}" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${first.d.slice(5).replace("-", "/")}</text>
    <text x="${W - px}" y="${H - 4}" font-size="10" fill="var(--muted)" text-anchor="end" font-family="IBM Plex Mono,monospace">${last.d.slice(5).replace("-", "/")}</text>
    <text x="${W - px}" y="${y(mx) - 3}" font-size="9" fill="var(--muted)" text-anchor="end" font-family="IBM Plex Mono,monospace">${mx.toFixed(1)}</text>
    <text x="${W - px}" y="${y(mn) + 10}" font-size="9" fill="var(--muted)" text-anchor="end" font-family="IBM Plex Mono,monospace">${mn.toFixed(1)}</text>
  </svg></div>`;
}
function bodyView(m) {
  const r = by(of("body", m.id), "date", 1);
  return `<div class="row between"><h2>체성분 추이</h2><button class="pri sm" data-act="newBody">+ 인바디 기록</button></div>
  <div class="charts">${spark(r, "weight", "w")}${spark(r, "smm", "smm")}${spark(r, "fat", "fat")}</div>
  ${r.length ? `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>날짜</th><th class="n">체중</th><th class="n">골격근</th><th class="n">체지방</th><th class="n">체지방률</th><th class="n">제지방</th><th class="n">기초대사</th><th></th></tr></thead><tbody>
  ${[...r].reverse().map(x => `<tr><td class="num">${esc(x.date.slice(2).replace(/-/g, "."))}</td><td class="n">${x.weight ?? "-"}</td><td class="n">${x.smm ?? "-"}</td><td class="n">${x.fat ?? "-"}</td><td class="n">${x.pbf != null && x.pbf !== "" ? x.pbf + "%" : "-"}</td><td class="n">${x.lbm ?? "-"}</td><td class="n">${x.bmr ?? "-"}</td><td class="n"><button class="sm ghost" data-act="editBody" data-id="${esc(x.id)}">수정</button></td></tr>`).join("")}
  </tbody></table></div></div>` : `<div class="empty">인바디 결과지의 체중·골격근량·체지방량을 입력하면 그래프가 그려져요.</div>`}`;
}
function workoutsView(m, coach) {
  const list = by(of("workouts", m.id), "date");
  return `<div class="row between"><h2>개인운동</h2>${!coach ? `<button class="pri sm" data-act="newWorkout">+ 운동 기록</button>` : ""}</div>
  ${list.length ? list.map(w => `<article class="card stack"><div class="sess-h"><span class="sess-date">${fmtD(w.date)}</span><span class="row">${w.minutes ? `<span class="chip">${esc(w.minutes)}분</span>` : ""}${!coach ? `<button class="ghost sm" data-act="editWorkout" data-id="${esc(w.id)}">수정</button>` : ""}</span></div>
  ${exTable(w.exercises)}${w.note ? `<div style="white-space:pre-wrap">${esc(w.note)}</div>` : ""}
  ${w.coachComment ? `<div><div class="fb-label">코치 코멘트</div><div class="fb">${esc(w.coachComment)}</div></div>` : ""}
  ${coach ? `<div class="row"><input id="wc-${esc(w.id)}" placeholder="코멘트 남기기" value="${esc(w.coachComment || "")}" style="flex:1;min-width:0"><button class="sm" data-act="saveWComment" data-id="${esc(w.id)}">저장</button></div>` : ""}
  </article>`).join("") : `<div class="empty">${coach ? "회원이 기록한 개인운동이 없어요. 기록은 선택 사항이에요." : "수업 없는 날 한 운동을 남겨 두면 코치님이 함께 봐요. 안 써도 괜찮아요."}</div>`}`;
}

/* ---------- MEMBER ---------- */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  meals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 2M9 3h6"/></svg>',
  body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 18l5-6 4 3 8-9"/><path d="M15 6h5v5"/></svg>',
  workouts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12h3M19 12h3M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8"/></svg>'
};
function memberHome(m) {
  const s = memberStatus(m);
  const last = by(of("sessions", m.id), "date")[0];
  const pend = of("sessions", m.id).filter(x => !x.memberFb).length;
  const tMeals = of("meals", m.id).filter(x => x.date === today()).length;
  const peers = S.peers.filter(x => x.status !== "ended");
  const fmtDelta = (a, b, goodUp) => { if (a == null || b == null) return "-"; const d = b - a; const good = goodUp ? d >= 0 : d <= 0; return `<span class="${good ? "down" : "up"}">${d > 0 ? "+" : ""}${d.toFixed(1)}</span>`; };
  if (coachProfile === undefined) getCoachProfile().then(() => render());
  return `<div class="section"><div class="eyebrow">${fmtD(today())}</div><h1>${esc(m.name)}님, 안녕하세요</h1>
  <div class="muted">${esc(m.goal || "")}</div></div>
  ${memberSchedule(m)}
  <div class="section"><div class="stats">
    <div class="stat"><b>${tMeals}${streakOf(m.id) >= 2 ? ` <small class="num" style="font-size:13px">🔥${streakOf(m.id)}</small>` : ""}</b><span>오늘 올린 식사</span></div>
    <div class="stat"><b>${s.lastW ?? "-"}</b><span>최근 체중 kg</span></div>
    <div class="stat"><b>${pend}</b><span>피드백 남길 수업</span></div>
  </div>
  ${dayGoalHtml(m, today())}
  <div class="row"><button class="pri" data-act="newMeal" style="flex:1">식사 사진 올리기</button><button data-act="newBody" style="flex:1">인바디 입력</button></div></div>
  <div class="section"><h2>최근 수업</h2>
  ${last ? `<article class="card stack"><div class="sess-h"><span class="sess-date">${fmtD(last.date)}</span></div>${exTable(last.exercises)}
   ${last.coachFb ? `<div><div class="fb-label">강사 피드백</div><div class="fb">${esc(last.coachFb)}</div></div>` : ""}
   <button class="${last.memberFb ? "ghost" : "pri"}" data-act="mtab" data-k="sessions">${last.memberFb ? "수업 기록 전체 보기" : "내 피드백 남기기"}</button></article>`
    : `<div class="empty">코치님이 첫 수업을 기록하면 여기에 보여요.</div>`}
  ${last ? `<button class="ghost" data-act="mtab" data-k="sessions">지난 수업 모두 보기</button>` : ""}</div>
  <div class="section"><h2>기록 공개</h2>
   <div class="card switch"><div><b>다른 회원에게 내 체성분 변화 보여주기</b><div class="muted" style="font-size:13px">켜면 기록을 공개한 회원끼리 체중·근육량 변화만 볼 수 있어요. 식단과 피드백은 공개되지 않아요.</div></div>
   <input type="checkbox" id="shareToggle" ${m.shared ? "checked" : ""} aria-label="기록 공개"></div>
   ${m.shared && peers.length ? `<div class="stack">${peers.map(p => { const b = p.bodySummary || {};
     return `<div class="card row between"><b>${esc((p.name || "?").slice(0, 1))}○○님</b><span class="num" style="font-size:13px">체중 ${fmtDelta(b.fw, b.lw, false)} · 근육 ${fmtDelta(b.fs, b.ls, true)}</span></div>`; }).join("")}</div>`
     : (m.shared ? `<div class="muted" style="font-size:13px">아직 기록을 공개한 다른 회원이 없어요.</div>` : "")}
  </div>`;
}
function renderBnav() {
  const show = me && me.role === "member";
  $("#bnav").hidden = !show; if (!show) return;
  const t = [["home", "홈"], ["meals", "식단"], ["body", "체성분"], ["workouts", "개인운동"]];
  $("#bnavIn").innerHTML = t.map(([k, l]) => `<button data-act="mtab" data-k="${k}" aria-selected="${ui.mtab === k || (ui.mtab === "sessions" && k === "home")}">${ICONS[k]}${l}</button>`).join("");
}

/* ---------- schedule ---------- */
const BST = { requested: ["요청", "warn"], confirmed: ["확정", "ok"], done: ["완료", ""], cancelled: ["취소", "bad"] };
const shortD = d => { const [, m, dd] = d.split("-"); return `${+m}/${+dd}`; };
const toMin = t => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
const endT = b => { const e = toMin(b.start) + (+b.minutes || 50); return `${String(Math.floor(e / 60) % 24).padStart(2, "0")}:${String(e % 60).padStart(2, "0")}`; };
const nowKey = () => today() + " " + new Date().toTimeString().slice(0, 5);
function nextBooking(mid) {
  return by(S.bookings.filter(b => b.memberId === mid && b.status === "confirmed" && (b.date + " " + b.start) >= nowKey()).map(b => Object.assign({ k: b.date + b.start }, b)), "k", 1)[0];
}
function overlaps(b, exceptId) {
  const s0 = toMin(b.start), e0 = s0 + (+b.minutes || 50);
  return S.bookings.filter(x => x.id !== exceptId && x.date === b.date && (x.status === "confirmed") && toMin(x.start) < e0 && s0 < toMin(x.start) + (+x.minutes || 50));
}
const memName = id => (S.members.find(m => m.id === id) || {}).name || "회원";
function viewSwitch() {
  const pend = S.bookings.filter(b => b.status === "requested" || (b.cancelReq && b.status === "confirmed")).length;
  return `<div class="section"><div class="tabs" role="tablist">
    <button role="tab" aria-selected="${ui.coachView !== "schedule"}" data-act="cview" data-k="members">회원</button>
    <button role="tab" aria-selected="${ui.coachView === "schedule"}" data-act="cview" data-k="schedule">일정${pend ? ` <span class="chip new">${pend}</span>` : ""}</button>
  </div></div>`;
}
function weekStart(d) { const x = new Date(d + "T00:00:00"); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; }
const iso = x => new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
function bookingRow(b, coach) {
  const [lab, cls] = BST[b.status] || ["", ""];
  const acts = [];
  if (coach) {
    if (b.status === "requested") acts.push(`<button class="sm pri" data-act="bkConfirm" data-id="${esc(b.id)}">확정</button>`);
    if (b.status === "confirmed") acts.push(`<button class="sm" data-act="bkDone" data-id="${esc(b.id)}">수업 기록</button>`);
    acts.push(`<button class="sm ghost" data-act="bkEdit" data-id="${esc(b.id)}">수정</button>`);
  } else {
    if (b.status === "confirmed" && !b.cancelReq && (b.date + " " + b.start) >= nowKey()) acts.push(`<button class="sm ghost" data-act="bkCancelReq" data-id="${esc(b.id)}">취소 요청</button>`);
    if (b.status === "requested") acts.push(`<button class="sm ghost" data-act="bkWithdraw" data-id="${esc(b.id)}">요청 취소</button>`);
  }
  return `<div class="bk ${b.status}">
    <div class="bk-t num"><b>${esc(b.start)}</b><span>${esc(endT(b))}</span></div>
    <div style="min-width:0"><div class="row"><b>${coach ? esc(memName(b.memberId)) : fmtD(b.date)}</b><span class="chip ${cls}">${lab}</span>${b.cancelReq && b.status === "confirmed" ? `<span class="chip bad">취소 요청</span>` : ""}</div>
      ${b.note ? `<div class="muted" style="font-size:13px">${esc(b.note)}</div>` : ""}</div>
    <div class="row" style="justify-content:flex-end">${acts.join("")}</div></div>`;
}
function coachSchedule() {
  const sel = ui.schedDay || today();
  const ws = weekStart(sel);
  const days = [...Array(7)].map((_, i) => { const x = new Date(ws); x.setDate(ws.getDate() + i); return iso(x); });
  const live = S.bookings.filter(b => b.status !== "cancelled");
  const pending = by(S.bookings.filter(b => b.status === "requested" || (b.cancelReq && b.status === "confirmed")).map(b => Object.assign({ k: b.date + b.start }, b)), "k", 1);
  const list = by(S.bookings.filter(b => b.date === sel).map(b => Object.assign({ k: b.start }, b)), "k", 1);
  const conf = list.filter(b => b.status === "confirmed" || b.status === "done");
  return `${viewSwitch()}
  ${pending.length ? `<div class="section"><h2>확인할 요청</h2><div class="stack" style="gap:8px">${pending.map(b => `<div class="card">${bookingRow(b, true).replace('<div class="bk', '<div class="bk flat').replace(`<b>${esc(memName(b.memberId))}</b>`, `<b>${esc(memName(b.memberId))}</b> <span class="muted num">${shortD(b.date)}</span>`)}
    ${b.cancelReq && b.status === "confirmed" ? `<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="sm ghost" data-act="bkKeep" data-id="${esc(b.id)}">취소 거절</button><button class="sm" data-act="bkCancel" data-id="${esc(b.id)}" style="color:var(--bad)">취소 승인</button></div>` : ""}</div>`).join("")}</div></div>` : ""}
  <div class="section">
    <div class="row between"><h2 class="num">${shortD(days[0])} ~ ${shortD(days[6])}</h2>
      <div class="row"><button class="sm ghost" data-act="wk" data-k="-7" aria-label="이전 주">‹</button><button class="sm ghost" data-act="wk" data-k="0">오늘</button><button class="sm ghost" data-act="wk" data-k="7" aria-label="다음 주">›</button></div></div>
    <div class="week">${days.map(d => { const n = live.filter(b => b.date === d).length; const dt = new Date(d + "T00:00:00");
      return `<button class="wd${d === sel ? " on" : ""}${d === today() ? " today" : ""}" data-act="pickDay" data-k="${d}"><span>${"일월화수목금토"[dt.getDay()]}</span><b class="num">${dt.getDate()}</b><i>${n ? n + "건" : ""}</i></button>`; }).join("")}</div>
  </div>
  <div class="section">
    <div class="row between"><h2>${fmtD(sel)} 수업 ${conf.length}건</h2><button class="pri sm" data-act="bkNew">+ 예약 추가</button></div>
    ${list.length ? `<div class="roster">${list.map(b => bookingRow(b, true)).join("")}</div>` : `<div class="empty">이 날은 예약이 없어요. <b>예약 추가</b>로 수업을 잡아 보세요.</div>`}
  </div>`;
}
function memberSchedule(m) {
  const up = by(S.bookings.filter(b => b.status !== "cancelled" && b.status !== "done" && (b.date + " " + b.start) >= nowKey()).map(b => Object.assign({ k: b.date + b.start }, b)), "k", 1).slice(0, 5);
  const nb = up.find(b => b.status === "confirmed");
  return `<div class="section"><div class="row between"><h2>수업 일정</h2><button class="sm" data-act="bkRequest">예약 요청</button></div>
    ${nb ? `<div class="banner"><b>다음 수업</b> ${fmtD(nb.date)} ${esc(nb.start)}~${esc(endT(nb))}</div>` : ""}
    ${up.length ? `<div class="roster">${up.map(b => bookingRow(b, false)).join("")}</div>` : `<div class="empty">잡힌 수업이 없어요. 원하는 날짜와 시간으로 <b>예약 요청</b>을 보내 보세요.</div>`}</div>`;
}
function bookingSheet(b, asMember) {
  b = b || {};
  const act = by(S.members.filter(m => m.status !== "ended"), "name", 1);
  openSheet(`<h2>${asMember ? "수업 예약 요청" : b.id ? "예약 수정" : "예약 추가"}</h2>
  ${asMember ? `<div class="muted" style="font-size:13px">원하는 시간으로 요청하면 코치님이 확정해 드려요.</div>` : `<label class="f" for="bk-mem">회원<select id="bk-mem">${act.map(m => `<option value="${esc(m.id)}" ${m.id === (b.memberId || ui.coachMember) ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>`}
  <div class="grid2"><label class="f" for="bk-date">날짜<input type="date" id="bk-date" value="${esc(b.date || ui.schedDay || today())}"></label>
  <label class="f" for="bk-start">시작 시간<input type="time" id="bk-start" step="600" value="${esc(b.start || "19:00")}"></label></div>
  ${asMember ? "" : `<label class="f" for="bk-min">수업 시간<select id="bk-min">${[30, 50, 60, 90].map(n => `<option value="${n}" ${(+b.minutes || 50) === n ? "selected" : ""}>${n}분</option>`).join("")}</select></label>`}
  <label class="f" for="bk-note">메모<input id="bk-note" maxlength="60" value="${esc(b.note || "")}" placeholder="${asMember ? "예: 이 시간이 안 되면 20시도 괜찮아요" : "예: 하체, 인바디 측정"}"></label>
  <div id="bk-msg" class="muted" style="font-size:13px"></div>
  <div class="row">${b.id && !asMember ? `<button class="ghost" data-act="bkCancel" data-id="${esc(b.id)}" style="color:var(--bad)">예약 취소</button>` : ""}<button class="ghost" data-act="close" style="flex:1">닫기</button><button class="pri" data-act="${asMember ? "bkSendReq" : "bkSave"}" data-id="${esc(b.id || "")}" style="flex:2">${asMember ? "요청 보내기" : "저장"}</button></div>`);
}

/* ---------- render ---------- */
function render() {
  if (!me) return;
  renderHeader();
  const app = $("#app");
  if (me.role === "member") {
    const m = S.members.find(x => x.id === me.memberId);
    if (!m) { app.innerHTML = `<div class="section"><div class="empty">기록을 불러오는 중…</div></div>`; return; }
    app.innerHTML = (ui.mtab === "home" ? memberHome(m) : `<div class="section">${tabBody(m, ui.mtab, false)}</div>`) + madeBy();
  } else {
    const m = ui.coachMember && S.members.find(x => x.id === ui.coachMember);
    app.innerHTML = m ? coachMember(m) : (ui.coachView === "schedule" ? coachSchedule() : coachHome());
  }
  renderBnav();
}

/* ---------- sheets ---------- */
function openSheet(html, onMount) {
  $("#layer").innerHTML = `<div class="scrim" data-act="closeScrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  onMount && onMount($("#layer .sheet"));
}
const closeSheet = () => { $("#layer").innerHTML = ""; };
const curMember = () => me.role === "member" ? me.memberId : ui.coachMember;
const find = (col, id) => S[col].find(x => x.id === id);

function memberSheet(m) {
  const isNew = !m; m = m || {};
  const note = (m.id && S.notes[m.id]?.memo) || "";
  openSheet(`<h2>${isNew ? "회원 등록" : "회원 정보 수정"}</h2>
  <label class="f" for="fm-name">이름<input id="fm-name" value="${esc(m.name || "")}" placeholder="예: 송재민"></label>
  ${isNew ? `<div class="grid2"><label class="f" for="fm-id">로그인 아이디<input id="fm-id" autocapitalize="off" spellcheck="false" placeholder="예: jaemin"></label>
  <label class="f" for="fm-pw">첫 비밀번호 (6자 이상)<input id="fm-pw" placeholder="예: 생일 6자리"></label></div>
  <div class="muted" style="font-size:12px">아이디는 영문 소문자·숫자로 정해 주세요. 회원에게 아이디와 비밀번호를 알려 주면 바로 로그인할 수 있어요.</div>` : ""}
  <label class="f" for="fm-goal">목표<input id="fm-goal" value="${esc(m.goal || "")}" placeholder="예: 체지방 감량, 무릎 통증 개선"></label>
  <div class="grid2"><label class="f" for="fm-start">시작일<input type="date" id="fm-start" value="${esc(m.start || today())}"></label>
  <label class="f" for="fm-status">상태<select id="fm-status"><option value="active">진행 중</option><option value="ended" ${m.status === "ended" ? "selected" : ""}>종료</option></select></label></div>
  ${isNew ? "" : `<div class="row between"><span class="muted" style="font-size:13px">식단 목표 ${goalT(m) && goalT(m).kcal ? `<b class="num">${Math.round(goalT(m).kcal).toLocaleString()}kcal</b>` : "없음"}</span><button type="button" class="sm" data-act="goalCalc" data-id="${esc(m.id)}">식단 목표 계산</button></div>`}
  <label class="f" for="fm-memo">코치 메모 (회원에게 안 보임)<textarea id="fm-memo" placeholder="체형 특이사항, 통증 이력 등">${esc(note)}</textarea></label>
  <div id="fm-msg" class="muted" style="font-size:13px"></div>
  <div class="row"><button class="ghost" data-act="close" style="flex:1">취소</button><button class="pri" data-act="saveMember" data-id="${esc(m.id || "")}" style="flex:2">${isNew ? "등록하고 아이디 만들기" : "저장"}</button></div>
  ${isNew ? "" : `<div class="danger-box stack">
    <b>회원 삭제</b>
    <div class="muted" style="font-size:13px">수업일지, 피드백, 식단 사진, 체성분, 개인운동 기록이 모두 지워지고 되돌릴 수 없어요. 기록을 남겨 두려면 위 <b>상태</b>를 "종료"로 바꾸세요.</div>
    <label class="f" for="del-confirm">삭제하려면 회원 이름 <b>${esc(m.name)}</b>을(를) 입력하세요<input id="del-confirm" autocomplete="off"></label>
    <button class="ghost" data-act="delMember" data-id="${esc(m.id)}" style="color:var(--bad);border-color:var(--bad)">이 회원과 모든 기록 삭제</button>
    <div id="del-msg" class="muted" style="font-size:13px"></div>
  </div>`}`);
}
async function createMemberAccount(loginId, pw) {
  const sec = initializeApp(firebaseConfig, "sec-" + Date.now());
  const sa = getAuth(sec);
  try { const cred = await createUserWithEmailAndPassword(sa, idToEmail(loginId), pw); const u = cred.user.uid; await signOut(sa); return u; }
  finally { try { await sec.delete?.(); } catch (e) {} }
}
function exRowsHtml(ex) {
  return (ex.length ? ex : [{}]).map(e => `<div class="ex-row"><input aria-label="운동 이름" class="ex-n" list="exList" value="${esc(e.name || "")}" placeholder="운동"><input aria-label="세트" class="ex-s" inputmode="numeric" value="${esc(e.sets || "")}" placeholder="세트"><input aria-label="횟수" class="ex-r" value="${esc(e.reps || "")}" placeholder="횟수"><input aria-label="무게" class="ex-k" inputmode="decimal" value="${esc(e.kg || "")}" placeholder="kg"><button data-act="rmEx" aria-label="삭제">✕</button></div>`).join("");
}
const readEx = () => [...document.querySelectorAll("#layer .ex-row:not(.ex-head)")].map(r => ({ name: r.querySelector(".ex-n").value.trim(), sets: r.querySelector(".ex-s").value.trim(), reps: r.querySelector(".ex-r").value.trim(), kg: r.querySelector(".ex-k").value.trim() })).filter(e => e.name);
function exDatalist() {
  const names = [...new Set([...S.sessions, ...S.workouts].flatMap(x => (x.exercises || []).map(e => e.name)))].slice(0, 60);
  return `<datalist id="exList">${names.map(n => `<option value="${esc(n)}">`).join("")}</datalist>`;
}
function sessionSheet(s) {
  s = s || {};
  const prev = !s.id ? by(of("sessions", curMember()), "date")[0] : null;
  openSheet(`<h2>${s.id ? "수업 기록 수정" : "수업 기록"}</h2>
  <label class="f" for="fs-date">날짜<input type="date" id="fs-date" value="${esc(s.date || today())}"></label>
  <div class="row between"><span class="eyebrow">운동</span>${prev && prev.exercises?.length ? `<button class="sm ghost" data-act="copyPrev">지난 수업 불러오기</button>` : ""}</div>
  <div class="ex-row ex-head"><span>운동</span><span>세트</span><span>횟수</span><span>kg</span><span></span></div>
  <div id="exRows" class="stack" style="gap:6px">${exRowsHtml(s.exercises || [])}</div>${exDatalist()}
  <button class="sm" data-act="addEx">+ 운동 추가</button>
  <label class="f" for="fs-fb">강사 피드백<textarea id="fs-fb" placeholder="자세, 보상작용, 다음 수업 방향">${esc(s.coachFb || "")}</textarea></label>
  <div class="row">${s.id ? `<button class="ghost" data-act="delSession" data-id="${esc(s.id)}">삭제</button>` : ""}<button class="ghost" data-act="close" style="flex:1">취소</button><button class="pri" data-act="saveSession" data-id="${esc(s.id || "")}" style="flex:2">저장</button></div>`);
}
async function loadImg(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = r.result; }; r.onerror = rej; r.readAsDataURL(file); });
}
function shrink(img, max, q, limit) {
  let out = "";
  for (let t = 0; t < 7; t++) {
    const sc = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL("image/jpeg", q);
    if (out.length < limit) break; max *= .8; q -= .06;
  }
  return out;
}
async function makePhotos(file) {
  const img = await loadImg(file);
  return { full: shrink(img, 1000, .72, 190000), thumb: shrink(img, 320, .6, 24000) };
}
async function showFull(x, sel) {
  if (!x.hasPhoto) return;
  try { const d = await getDoc(doc(fs, "photos", x.id)); const el = document.querySelector(sel); if (d.exists() && el) el.src = d.data().data; } catch (e) {}
}
let pendingPhoto = null;
function mealSheet(x) {
  x = x || {}; pendingPhoto = null;
  const shown = x.thumb || x.photo;
  if (isCoach()) {
    openSheet(`<div class="row between"><h2>${fmtD(x.date)} ${esc(x.type)}</h2><button class="ghost sm" data-act="close">닫기</button></div>
    ${shown ? `<img id="meal-big" class="big-img" src="${shown}" alt="식사 사진">` : ""}
    ${x.memo ? `<div><div class="fb-label">회원 메모</div><div class="fb mine">${esc(x.memo)}</div></div>` : ""}
    ${shown ? `<div class="row between"><span class="muted" style="font-size:13px">사진으로 칼로리·탄단지를 추정해 코멘트에 채워요</span><button class="sm" data-act="aiMeal" data-id="${esc(x.id)}">AI 분석</button></div><div id="ai-msg" class="muted" style="font-size:13px"></div>` : ""}
    ${quickChips()}
    <label class="f" for="fmc">코치 코멘트<textarea id="fmc" rows="6" placeholder="단백질 양, 조리법, 대체 메뉴 등">${esc(x.coachComment || "")}</textarea></label>
    <div class="row"><button class="ghost" data-act="markMealSeen" data-id="${esc(x.id)}" style="flex:1">확인만</button><button class="pri" data-act="saveMealComment" data-id="${esc(x.id)}" style="flex:2">코멘트 저장</button></div>`);
    showFull(x, "#meal-big");
    return;
  }
  openSheet(`<h2>${x.id ? "식사 수정" : "식사 올리기"}</h2>
  <div class="grid2"><label class="f" for="fml-date">날짜<input type="date" id="fml-date" value="${esc(x.date || today())}"></label>
  <label class="f" for="fml-type">구분<select id="fml-type">${["아침", "점심", "저녁", "간식"].map(t => `<option ${x.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
  <label class="f" for="fml-photo">사진<input type="file" id="fml-photo" accept="image/*"></label>
  <img id="fml-prev" class="big-img" ${shown ? `src="${shown}"` : "hidden"} alt="미리보기">
  <label class="f" for="fml-memo">메모<input id="fml-memo" value="${esc(x.memo || "")}" placeholder="예: 닭가슴살 샐러드, 소스 반만"></label>
  ${x.coachComment ? `<div><div class="fb-label">코치 코멘트</div><div class="fb">${esc(x.coachComment)}</div></div>` : ""}
  <div class="row">${x.id ? `<button class="ghost" data-act="delMeal" data-id="${esc(x.id)}">삭제</button>` : ""}<button class="ghost" data-act="close" style="flex:1">취소</button><button class="pri" data-act="saveMeal" data-id="${esc(x.id || "")}" style="flex:2">올리기</button></div>`,
    sh => {
      if (x.id) showFull(x, "#fml-prev");
      sh.querySelector("#fml-photo").addEventListener("change", async e => {
        const f = e.target.files[0]; if (!f) return;
        try { pendingPhoto = await makePhotos(f); const p = sh.querySelector("#fml-prev"); p.src = pendingPhoto.full; p.hidden = false; }
        catch (err) { toast("사진을 열 수 없어요. 다른 사진으로 시도해 주세요."); }
      });
    });
}
function bodySheet(r) {
  r = r || {};
  openSheet(`<h2>${r.id ? "인바디 수정" : "인바디 기록"}</h2>
  <label class="f" for="fb-date">측정일<input type="date" id="fb-date" value="${esc(r.date || today())}"></label>
  <div class="grid2">
   <label class="f" for="fb-w">체중 (kg)<input id="fb-w" inputmode="decimal" value="${esc(r.weight ?? "")}"></label>
   <label class="f" for="fb-smm">골격근량 (kg)<input id="fb-smm" inputmode="decimal" value="${esc(r.smm ?? "")}"></label>
   <label class="f" for="fb-fat">체지방량 (kg)<input id="fb-fat" inputmode="decimal" value="${esc(r.fat ?? "")}"></label>
   <label class="f" for="fb-pbf">체지방률 (%)<input id="fb-pbf" inputmode="decimal" value="${esc(r.pbf ?? "")}"></label>
   <label class="f" for="fb-lbm">제지방량 (kg)<input id="fb-lbm" inputmode="decimal" value="${esc(r.lbm ?? "")}"></label>
   <label class="f" for="fb-bmr">기초대사량 (kcal)<input id="fb-bmr" inputmode="numeric" value="${esc(r.bmr ?? "")}"></label>
  </div>
  <div class="row">${r.id ? `<button class="ghost" data-act="delBody" data-id="${esc(r.id)}">삭제</button>` : ""}<button class="ghost" data-act="close" style="flex:1">취소</button><button class="pri" data-act="saveBody" data-id="${esc(r.id || "")}" style="flex:2">저장</button></div>`);
}
function workoutSheet(w) {
  w = w || {};
  openSheet(`<h2>${w.id ? "개인운동 수정" : "개인운동 기록"}</h2>
  <div class="grid2"><label class="f" for="fw-date">날짜<input type="date" id="fw-date" value="${esc(w.date || today())}"></label>
  <label class="f" for="fw-min">운동 시간 (분)<input id="fw-min" inputmode="numeric" value="${esc(w.minutes || "")}"></label></div>
  <div class="ex-row ex-head"><span>운동</span><span>세트</span><span>횟수</span><span>kg</span><span></span></div>
  <div id="exRows" class="stack" style="gap:6px">${exRowsHtml(w.exercises || [])}</div>${exDatalist()}
  <button class="sm" data-act="addEx">+ 운동 추가</button>
  <label class="f" for="fw-note">메모<textarea id="fw-note" placeholder="러닝 30분, 컨디션, 불편했던 부위 등">${esc(w.note || "")}</textarea></label>
  <div class="row">${w.id ? `<button class="ghost" data-act="delWorkout" data-id="${esc(w.id)}">삭제</button>` : ""}<button class="ghost" data-act="close" style="flex:1">취소</button><button class="pri" data-act="saveWorkout" data-id="${esc(w.id || "")}" style="flex:2">저장</button></div>`);
}
async function runImport(file, msg) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { msg.textContent = "파일을 읽을 수 없어요. 받은 가져오기 파일이 맞는지 확인해 주세요."; return; }
  const list = (data && data.members) || [];
  if (!list.length) { msg.textContent = "파일에 회원 자료가 없어요."; return; }
  const sid = s => String(s).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || uid();
  let n = 0, fail = 0;
  const step = async (ok) => { n++; if (!ok) fail++; msg.textContent = `옮기는 중… ${n}건`; };
  for (const m of list) {
    const mid = "imp-" + sid(m.key || m.name);
    const base = { name: m.name, goal: m.goal || "", start: m.start || today(), status: m.status || "active" };
    if (find("members", mid)) await step(await patch("members", mid, base));
    else await step(await create("members", mid, Object.assign(base, { shared: false, bodySummary: null })));
    if (m.memo) await step(await create("coachNotes", mid, { memo: m.memo }));
    for (const [i, x] of (m.sessions || []).entries())
      await step(await create("sessions", `${mid}-s${i}`, { memberId: mid, date: x.date, exercises: x.exercises || [], coachFb: x.coachFb || "", memberFb: x.memberFb || "", fbSeen: true }));
    for (const [i, x] of (m.meals || []).entries()) {
      const id = `${mid}-m${i}`;
      if (x.full) await step(await create("photos", id, { memberId: mid, date: x.date, data: x.full }));
      await step(await create("meals", id, { memberId: mid, date: x.date, type: x.type || "식사", memo: x.memo || "", thumb: x.thumb || null, hasPhoto: !!x.full, coachComment: x.coachComment || "", seen: true }));
    }
    for (const [i, x] of (m.body || []).entries())
      await step(await create("body", `${mid}-b${i}`, { memberId: mid, date: x.date, weight: x.weight ?? null, smm: x.smm ?? null, fat: x.fat ?? null, pbf: x.pbf ?? null }));
    for (const [i, x] of (m.workouts || []).entries())
      await step(await create("workouts", `${mid}-w${i}`, { memberId: mid, date: x.date, minutes: x.minutes || "", exercises: x.exercises || [], note: x.note || "" }));
    const b = (m.body || []).filter(x => x.weight != null || x.smm != null).sort((a, c) => a.date < c.date ? -1 : 1);
    if (b.length) await patch("members", mid, { bodySummary: { fw: b[0].weight ?? null, lw: b[b.length - 1].weight ?? null, fs: b[0].smm ?? null, ls: b[b.length - 1].smm ?? null, n: b.length } });
  }
  msg.textContent = fail ? `${n - fail}건을 옮겼고 ${fail}건은 실패했어요. 파일을 한 번 더 올려 주세요.` : `회원 ${list.length}명, 기록 ${n}건을 옮겼어요.`;
}
let pendingProfilePhoto = null;
let pendingNutrition = null, aiMod = null;
const r1 = v => Math.round((+v || 0) * 10) / 10;
const aiKey = () => (S.notes && S.notes._ai && S.notes._ai.key) || "";
/* direct Gemini API call with the coach's AI Studio key (key lives in coach-only Firestore doc, never in the code) */
async function geminiDirect(key, name, prompt, b64, mime) {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }) });
  } catch (e) { throw new Error("Failed to fetch"); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`[${res.status}] ${(j.error && (j.error.status + " " + j.error.message)) || res.statusText}`);
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  return parts.map(x => x.text || "").join("");
}
async function analyzeMeal(src, memo, type) {
  const key = aiKey();
  let ai = null;
  if (!key) { if (!aiMod) aiMod = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-ai.js"); ai = aiMod.getAI(app, { backend: new aiMod.GoogleAIBackend() }); }
  const b64 = src.split(",")[1], mime = (src.match(/^data:([^;]+)/) || [])[1] || "image/jpeg";
  const prompt = `당신은 스포츠 영양 코치입니다. 사진 속 한 끼(${type || "식사"}) 식단을 분석하세요.${memo ? ` 회원 메모: "${memo}"` : ""}
음식마다 이름(한국어), 추정 무게(g), 탄수화물·단백질·지방(g)을 추정하세요. 조리 과정의 기름·소스·드레싱을 반영한 보정 칼로리(adjKcal)도 추정하세요.
1인분이 아닌 공유 접시라면 사진에서 이 사람이 먹었을 양으로 추정하세요. 음식이 아니면 items를 빈 배열로 두세요.
아래 JSON만 답하세요:
{"items":[{"name":"","grams":0,"carbs":0,"protein":0,"fat":0,"adjKcal":0}],"comment":"코치 관점의 한 줄 조언(단백질·채소·조리법 중심)"}`;
  let last;
  for (const name of AI_MODELS) {
    try {
      let text;
      if (key) text = await geminiDirect(key, name, prompt, b64, mime);
      else { const model = aiMod.getGenerativeModel(ai, { model: name, generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }); text = (await model.generateContent([prompt, { inlineData: { data: b64, mimeType: mime } }])).response.text(); }
      const j = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
      const items = (j.items || []).map(i => { const c = r1(i.carbs), p = r1(i.protein), f = r1(i.fat), kcal = Math.round(c * 4 + p * 4 + f * 9); return { name: String(i.name || "음식").slice(0, 30), grams: Math.round(+i.grams || 0), carbs: c, protein: p, fat: f, kcal, adjKcal: Math.max(kcal, Math.round(+i.adjKcal || kcal)) }; });
      const total = items.reduce((t, i) => ({ grams: t.grams + i.grams, carbs: r1(t.carbs + i.carbs), protein: r1(t.protein + i.protein), fat: r1(t.fat + i.fat), kcal: t.kcal + i.kcal, adjKcal: t.adjKcal + i.adjKcal }), { grams: 0, carbs: 0, protein: 0, fat: 0, kcal: 0, adjKcal: 0 });
      return { items, total, comment: String(j.comment || "").slice(0, 200), model: name, at: new Date().toISOString() };
    } catch (e) { last = e; e.model = name; const m = String(e && (e.message || e.code) || ""); if (!/not.?found|\b404\b|unsupported|not supported|\b429\b|quota|resource.?exhausted|too many requests|\b503\b|overloaded|unavailable/i.test(m)) throw e; }
  }
  throw last;
}
function nutritionText(r) {
  if (!r.items.length) return "AI 분석: 사진에서 음식을 찾지 못했어요.";
  const t = r.total;
  return ["🍽 AI 식단 분석 (사진 추정치)",
    ...r.items.map(i => `• ${i.name} ${i.grams}g | 탄 ${i.carbs} · 단 ${i.protein} · 지 ${i.fat}g | ${i.kcal}kcal`),
    `합계 | 탄 ${t.carbs} · 단 ${t.protein} · 지 ${t.fat}g | ${t.kcal}kcal`,
    `조리(기름·소스) 반영 시 약 ${t.adjKcal}kcal`,
    r.comment ? `💬 ${r.comment}` : ""].filter(Boolean).join("\n");
}
function aiError(e) {
  const m = String(e && (e.message || e.code) || "");
  const raw = m.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
  const tail = raw ? `\n(오류 내용${e && e.model ? ` · ${e.model}` : ""}: ${raw})` : "";
  let t;
  if (/\b429\b|quota|resource.?exhausted|too many requests|rate.?limit/i.test(m)) t = /per.?day|daily|PerDay/i.test(m) ? "오늘 무료 분석 한도를 다 썼어요. 내일 다시 시도해 주세요." : "잠깐 동안 요청이 많았어요. 1분 뒤 다시 눌러 주세요.";
  else if (/\b503\b|overloaded|unavailable/i.test(m)) t = "AI 서버가 지금 붐벼요. 잠시 후 다시 시도해 주세요.";
  else if (/API_KEY_INVALID|API key not valid|UNAUTHENTICATED|\b401\b/i.test(m)) t = "AI 분석 키가 맞지 않아요. 설정 → AI 분석 키를 다시 확인해 주세요.";
  else if (/api.?not.?enabled|has not been used|PERMISSION_DENIED|\b403\b|firebasevertexai|firebaseml|AI Logic|API key/i.test(m)) t = "Firebase에서 AI Logic(Gemini Developer API) 설정이 아직 안 끝났거나 반영 중이에요. 몇 분 뒤 다시 시도해 주세요.";
  else if (/Failed to fetch|network|Failed to load|dynamically imported/i.test(m)) t = "인터넷 연결을 확인하고 다시 시도해 주세요.";
  else t = "분석하지 못했어요. 잠시 후 다시 시도해 주세요.";
  return t + tail;
}
async function squarePhoto(file) {
  const img = await loadImg(file); const n = Math.min(img.width, img.height), size = 360;
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d").drawImage(img, (img.width - n) / 2, (img.height - n) / 2, n, n, 0, 0, size, size);
  return c.toDataURL("image/jpeg", .8);
}
const APP_URL = "https://choicoach.github.io/ptnote/";
const INVITE_TEXT = `안녕하세요, 최코치입니다 😊
앞으로 운동일지·식단·체성분·수업 예약은 '최코치의 PT노트'로 함께 관리할게요.

1. 아래 주소를 사파리(아이폰) 또는 크롬(갤럭시)으로 열어 주세요
2. '처음이세요? 회원 가입 신청하기'를 눌러 신청해 주세요
3. 제가 승인하면 바로 쓰실 수 있어요

📱 홈 화면에 추가: 아이폰은 공유 → 홈 화면에 추가 / 갤럭시는 메뉴(점 3개) → 홈 화면에 추가
카톡에서 열리면 오른쪽 아래 메뉴에서 '다른 브라우저로 열기'를 눌러 주세요.`;
function inviteSheet() {
  openSheet(`<div class="row between"><h2>회원 초대</h2><button class="ghost sm" data-act="close">닫기</button></div>
  <div class="muted" style="font-size:13px">회원이 이 QR을 휴대폰 카메라로 찍으면 가입 신청 화면이 열려요.</div>
  <div class="qr-box"><img src="qr.png" alt="최코치의 PT노트 QR코드" draggable="false"></div>
  <div class="row between card" style="padding:10px 12px"><span class="num" style="font-size:14px;word-break:break-all">${APP_URL}</span><button class="sm" data-act="copyUrl">주소 복사</button></div>
  <button class="pri" data-act="shareInvite">카톡·문자로 안내 보내기</button>
  <details class="install"><summary>보낼 안내 문구 보기</summary><p style="white-space:pre-wrap">${esc(INVITE_TEXT)}\n${APP_URL}</p></details>
  <div id="inv-msg" class="muted" style="font-size:13px"></div>`);
}
function settingsSheet() {
  if (isCoach() && coachProfile === undefined) { getCoachProfile().then(() => { if ($("#layer").innerHTML) settingsSheet(); }); }
  openSheet(`<div class="row between"><h2>설정</h2><button class="ghost sm" data-act="close">닫기</button></div>
  <div class="muted" style="font-size:13px">로그인 아이디 <span class="num">${esc((auth.currentUser?.email || "").split("@")[0])}</span></div>
  <h3>비밀번호 바꾸기</h3>
  <label class="f" for="st-old">지금 비밀번호<input id="st-old" type="password" autocomplete="current-password"></label>
  <label class="f" for="st-new">새 비밀번호 (6자 이상)<input id="st-new" type="password" autocomplete="new-password"></label>
  <button data-act="changePw">비밀번호 바꾸기</button>
  <div id="st-msg" class="muted" style="font-size:13px"></div>
  ${isCoach() ? `<h3>내 프로필 (로그인 화면·회원 홈에 보여요)</h3>
  <img id="pf-prev" class="big-img" src="${prof().poster}" alt="소개 이미지 미리보기" style="max-height:260px;object-fit:contain">
  <label class="f" for="pf-photo">소개 이미지 바꾸기 (포스터·사진 전체가 그대로 보여요)<input type="file" id="pf-photo" accept="image/*"></label>
  <label class="f" for="pf-name">표시 이름<input id="pf-name" maxlength="30" value="${esc(coachProfile?.name || "")}" placeholder="${esc(COACH_DEFAULT.name)}"></label>
  <label class="f" for="pf-intro">소개 (2~3줄)<textarea id="pf-intro" maxlength="200" placeholder="예: 경력 16년 · 체형 분석 기반 PT · 생활스포츠지도사 2급 · KACEP 운동사">${esc(coachProfile?.intro || "")}</textarea></label>
  <label class="f" for="pf-tag">한 줄 소개 (이름 옆에 보여요)<input id="pf-tag" maxlength="40" value="${esc(coachProfile?.tagline || "")}" placeholder="${esc(COACH_DEFAULT.tagline)}"></label>
  <label class="f" for="pf-careers">자격·경력 (한 줄에 하나씩, 비워 두면 기본 이력)<textarea id="pf-careers" rows="6" placeholder="${esc(COACH_DEFAULT.careers.slice(0, 3).join("\n"))}">${esc(Array.isArray(coachProfile?.careers) ? coachProfile.careers.join("\n") : (coachProfile?.careers || ""))}</textarea></label>
  <div class="muted" style="font-size:12px">비워 둔 칸은 기본값(포스터 내용)이 보여요.</div>
  <button data-act="saveProfile">프로필 저장</button>
  <h3>빠른 코멘트 문구</h3>
  <label class="f" for="st-quick">한 줄에 하나씩 (식단 코멘트 버튼으로 나와요)<textarea id="st-quick" rows="6">${esc(quickList().join("\n"))}</textarea></label>
  <button data-act="saveQuick">빠른 코멘트 저장</button>
  <h3>AI 분석 키</h3>
  <div class="muted" style="font-size:12px">Google AI Studio에서 만든 키를 넣으면 식단 AI 분석에 써요. 키는 코치 계정만 볼 수 있는 곳에 저장되고 회원에게는 안 보여요.${aiKey() ? ` 지금 저장된 키: <span class="num">${esc(aiKey().slice(0, 6))}…${esc(aiKey().slice(-4))}</span>` : ""}</div>
  <label class="f" for="st-aikey">키 붙여넣기<input id="st-aikey" type="password" autocomplete="off" spellcheck="false" placeholder="AQ. 또는 AIza 로 시작"></label>
  <div class="row"><button data-act="saveAiKey" style="flex:2">키 저장</button>${aiKey() ? `<button class="ghost" data-act="delAiKey" style="flex:1">키 지우기</button>` : ""}</div>
  <h3>식단 목표 계산 기준</h3>
  <div class="muted" style="font-size:12px">하루 칼로리 = 기초대사량 × 활동량 × (1 + 조정%). 감량은 기초대사량 아래로 내려가지 않아요. 단백질은 제지방량 1kg당, 지방은 칼로리의 %, 나머지가 탄수화물이에요.</div>
  <div class="grid3">${[["cutSlow", "감량 완만 %"], ["cutNormal", "감량 보통 %"], ["cutFast", "감량 빠르게 %"], ["bulk", "근육 증가 %"], ["recomp", "리컴프 %"], ["fatPct", "지방 비율 %"], ["pCut", "단백질 감량 g/kg"], ["pBulk", "단백질 증가 g/kg"], ["pKeep", "단백질 유지 g/kg"], ["pRecomp", "단백질 리컴프 g/kg"]].map(([k, t]) => `<label class="f" for="cc-${k}">${t}<input id="cc-${k}" data-k="${k}" class="cc" inputmode="decimal" value="${esc(calcConf()[k])}"></label>`).join("")}</div>
  <div class="row"><button data-act="saveCalc" style="flex:2">계산 기준 저장</button><button class="ghost" data-act="resetCalc" style="flex:1">기본값</button></div>
  <h3>저장 공간 관리</h3>
  <div class="muted" style="font-size:13px">식사 원본 사진이 저장 공간 대부분을 차지해요. 오래된 원본을 지워도 목록의 작은 사진과 메모, 코멘트는 남아요.</div>
  <div class="row"><select id="st-days" style="width:auto"><option value="90">90일 지난 사진</option><option value="180" selected>180일 지난 사진</option><option value="365">1년 지난 사진</option></select>
  <button data-act="cleanPhotos">오래된 원본 사진 정리</button></div>
  <div id="st-clean" class="muted" style="font-size:13px"></div>
  <h3>자료 가져오기</h3>
  <div class="muted" style="font-size:13px">구글시트에서 옮긴 가져오기 파일(.json)을 올리면 회원, 수업일지, 피드백, 식단 사진이 한꺼번에 들어가요. 같은 파일을 두 번 올려도 기록이 겹치지 않아요.</div>
  <input type="file" id="st-import" accept=".json,application/json" aria-label="가져오기 파일">
  <div id="st-imp-msg" class="muted" style="font-size:13px"></div>` : ""}
  <button class="ghost" data-act="logout">로그아웃</button>`);
}
const numOrNull = v => { v = String(v).trim().replace(",", "."); return v === "" || isNaN(+v) ? null : +v; };
async function syncSummary(mid) {
  const m = S.members.find(x => x.id === mid); if (!m) return;
  const sum = bodySummaryFor(mid);
  if (JSON.stringify(sum) !== JSON.stringify(m.bodySummary || null)) await patch("members", mid, { bodySummary: sum });
}
function confirmDel(b) { if (b.dataset.confirm) return true; b.dataset.confirm = 1; b.textContent = "한 번 더 누르면 삭제"; b.style.color = "var(--bad)"; return false; }

/* ---------- actions ---------- */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === "closeScrim") { if (e.target === b) { feed = null; closeSheet(); } return; }
  if (a === "close") { feed = null; return closeSheet(); }
  if (a === "settings") return settingsSheet();
  if (a === "coachAbout") return coachAboutSheet();
  if (a === "invite") return inviteSheet();
  if (a === "copyUrl" || a === "shareInvite") {
    const msg = $("#inv-msg"), full = INVITE_TEXT + "\n" + APP_URL;
    if (a === "shareInvite" && navigator.share) {
      try { await navigator.share({ title: "최코치의 PT노트", text: INVITE_TEXT, url: APP_URL }); msg.textContent = ""; return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(a === "copyUrl" ? APP_URL : full); msg.textContent = a === "copyUrl" ? "주소를 복사했어요." : "안내 문구를 복사했어요. 카톡이나 문자에 붙여 넣어 보내 주세요."; }
    catch (e) { msg.textContent = "복사하지 못했어요. 아래 '보낼 안내 문구 보기'를 길게 눌러 복사해 주세요."; }
    return;
  }
  if (a === "approveReq") {
    const r = S.requests.find(x => x.id === id); if (!r) return;
    b.disabled = true;
    const link = document.getElementById("lk-" + id)?.value || "";
    const mid = link || uid();
    const ok = (link
        ? await patch("members", mid, Object.assign({ loginId: r.loginId, uid: id }, r.goal && !find("members", mid)?.goal ? { goal: r.goal } : {}))
        : await create("members", mid, { name: r.name, goal: r.goal || "", start: today(), status: "active", loginId: r.loginId, uid: id, shared: false, bodySummary: null }))
      && await create("users", id, { memberId: mid, loginId: r.loginId });
    if (ok) { await del("requests", id); toast(`${r.name}님을 승인했어요`); } else b.disabled = false;
    return;
  }
  if (a === "rejectReq") {
    if (!b.dataset.confirm) { b.dataset.confirm = 1; b.textContent = "정말 거절"; b.style.color = "var(--bad)"; return; }
    if (await del("requests", id)) toast("신청을 거절했어요");
    return;
  }
  if (a === "logout") { closeSheet(); ui = { coachMember: null, tab: "sessions", mtab: "home" }; saveUi(); return signOut(auth); }
  if (a === "saveProfile") {
    const data = { name: $("#pf-name").value.trim(), intro: $("#pf-intro").value.trim(), tagline: $("#pf-tag").value.trim(), careers: $("#pf-careers").value.split("\n").map(x => x.trim()).filter(Boolean), poster: pendingProfilePhoto || coachProfile?.poster || null };
    b.disabled = true;
    if (await create("public", "coach", data)) { coachProfile = data; pendingProfilePhoto = null; toast("프로필을 저장했어요"); }
    b.disabled = false; return;
  }
  if (a === "changePw") {
    const o = $("#st-old").value, n = $("#st-new").value, msg = $("#st-msg");
    if (n.length < 6) { msg.textContent = "새 비밀번호는 6자 이상이어야 해요."; return; }
    try { await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, o)); await updatePassword(auth.currentUser, n); msg.textContent = "비밀번호를 바꿨어요."; }
    catch (err) { msg.textContent = (err.code || "").includes("credential") || (err.code || "").includes("wrong") ? "지금 비밀번호가 맞지 않아요." : "바꾸지 못했어요. 다시 시도해 주세요."; }
    return;
  }
  if (a === "home") { ui.coachMember = null; saveUi(); openDetail(null); render(); return window.scrollTo(0, 0); }
  if (a === "openMember") { ui.coachMember = id; ui.tab = "sessions"; saveUi(); openDetail(id); render(); return window.scrollTo(0, 0); }
  if (a === "cleanPhotos") {
    const days = +$("#st-days").value, msg = $("#st-clean");
    if (!b.dataset.confirm) { b.dataset.confirm = 1; b.textContent = `${days}일 지난 원본 사진 삭제 — 한 번 더 누르세요`; b.style.color = "var(--bad)"; return; }
    b.disabled = true; msg.textContent = "찾는 중…";
    try {
      const snap = await getDocs(query(collection(fs, "photos"), where("date", "<", daysAgo(days))));
      let n = 0; for (const d of snap.docs) { await deleteDoc(d.ref); n++; msg.textContent = `정리 중… ${n}/${snap.size}`; }
      msg.textContent = n ? `원본 사진 ${n}장을 정리했어요. 목록의 작은 사진은 그대로 남아요.` : "정리할 사진이 없어요.";
    } catch (e) { console.error(e); msg.textContent = "정리하지 못했어요. 다시 시도해 주세요."; }
    b.disabled = false; delete b.dataset.confirm; b.style.color = ""; b.textContent = "오래된 원본 사진 정리";
    return;
  }
  if (a === "tab") { ui.tab = b.dataset.k; saveUi(); return render(); }
  if (a === "mtab") { ui.mtab = b.dataset.k; saveUi(); render(); return window.scrollTo(0, 0); }
  if (a === "newMember") return memberSheet();
  if (a === "editMember") return memberSheet(S.members.find(x => x.id === id));
  if (a === "delMember") {
    const m = S.members.find(x => x.id === id); if (!m) return;
    const msg = $("#del-msg");
    if ($("#del-confirm").value.trim() !== m.name) { msg.textContent = "이름이 맞지 않아요. 정확히 입력해 주세요."; return; }
    b.disabled = true; let n = 0, fail = 0;
    try {
      for (const c of [...COLS, "photos"]) {
        const snap = await getDocs(query(collection(fs, c), where("memberId", "==", id)));
        for (const d of snap.docs) { try { await deleteDoc(d.ref); n++; } catch (e) { fail++; } msg.textContent = `삭제 중… ${n}건`; }
      }
      try { await deleteDoc(doc(fs, "coachNotes", id)); } catch (e) {}
      if (m.uid) { try { await deleteDoc(doc(fs, "users", m.uid)); } catch (e) { fail++; } }
      if (fail) { msg.textContent = `${fail}건을 지우지 못했어요. 다시 눌러 주세요.`; b.disabled = false; return; }
      await deleteDoc(doc(fs, "members", id));
      closeSheet(); ui.coachMember = null; saveUi(); openDetail(null); render(); toast(`${m.name}님과 기록 ${n}건을 삭제했어요`);
    } catch (e) { console.error(e); msg.textContent = "삭제하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."; b.disabled = false; }
    return;
  }
  if (a === "saveMember") {
    const name = $("#fm-name").value.trim(); const msg = $("#fm-msg");
    if (!name) { msg.textContent = "이름을 입력해 주세요."; return; }
    const base = { name, goal: $("#fm-goal").value.trim(), start: $("#fm-start").value, status: $("#fm-status").value };
    const memo = $("#fm-memo").value.trim();
    b.disabled = true;
    try {
      if (!id) {
        const loginId = $("#fm-id").value.trim().toLowerCase(), pw = $("#fm-pw").value;
        if (!/^[a-z0-9]{3,20}$/.test(loginId)) { msg.textContent = "아이디는 영문 소문자·숫자 3~20자로 정해 주세요."; return; }
        if (loginId === COACH_ID) { msg.textContent = "코치 아이디와 다른 아이디를 써 주세요."; return; }
        if (pw.length < 6) { msg.textContent = "비밀번호는 6자 이상이어야 해요."; return; }
        msg.textContent = "아이디를 만드는 중…";
        let newUid;
        try { newUid = await createMemberAccount(loginId, pw); }
        catch (err) { msg.textContent = (err.code || "").includes("email-already") ? "이미 쓰고 있는 아이디예요." : "아이디를 만들지 못했어요."; return; }
        const mid = uid();
        if (!(await create("members", mid, Object.assign(base, { loginId, uid: newUid, shared: false, bodySummary: null })))) return;
        await create("users", newUid, { memberId: mid, loginId });
        if (memo) await create("coachNotes", mid, { memo });
        closeSheet(); toast(`${name}님 등록 완료 · 아이디 ${loginId}`);
      } else {
        if (await patch("members", id, base)) { await create("coachNotes", id, { memo }, true); closeSheet(); toast("저장했어요"); }
      }
    } finally { b.disabled = false; }
    return;
  }
  if (a === "newSession") return sessionSheet();
  if (a === "cview") { ui.coachView = b.dataset.k; saveUi(); render(); return window.scrollTo(0, 0); }
  if (a === "pickDay") { ui.schedDay = b.dataset.k; saveUi(); return render(); }
  if (a === "wk") { const k = +b.dataset.k; if (!k) ui.schedDay = today(); else { const x = new Date((ui.schedDay || today()) + "T00:00:00"); x.setDate(x.getDate() + k); ui.schedDay = iso(x); } saveUi(); return render(); }
  if (a === "bkNew") return bookingSheet();
  if (a === "bkEdit") return bookingSheet(find("bookings", id));
  if (a === "bkRequest") return bookingSheet(null, true);
  if (a === "bkSave" || a === "bkSendReq") {
    const asM = a === "bkSendReq", msg = $("#bk-msg");
    const data = { memberId: asM ? me.memberId : $("#bk-mem").value, date: $("#bk-date").value, start: $("#bk-start").value, minutes: asM ? 50 : +$("#bk-min").value, note: $("#bk-note").value.trim() };
    if (!data.memberId || !data.date || !data.start) { msg.textContent = "날짜와 시간을 정해 주세요."; return; }
    if (!asM) {
      const clash = overlaps(data, id);
      if (clash.length && !b.dataset.confirm) { b.dataset.confirm = 1; msg.innerHTML = `<span style="color:var(--bad)">${esc(clash.map(c => memName(c.memberId) + " " + c.start).join(", "))} 수업과 시간이 겹쳐요.</span> 그래도 저장하려면 한 번 더 누르세요.`; return; }
    }
    b.disabled = true;
    const ok = asM ? await create("bookings", uid(), Object.assign(data, { status: "requested", by: "member" }))
      : id ? await patch("bookings", id, data) : await create("bookings", uid(), Object.assign(data, { status: "confirmed", by: "coach" }));
    b.disabled = false; if (ok) { closeSheet(); toast(asM ? "예약 요청을 보냈어요" : "예약을 저장했어요"); }
    return;
  }
  if (a === "bkConfirm") {
    const x = find("bookings", id); const clash = overlaps(x, id);
    if (clash.length && !b.dataset.confirm) { b.dataset.confirm = 1; b.textContent = "겹침 · 그래도 확정"; toast(`${clash.map(c => memName(c.memberId) + " " + c.start).join(", ")} 수업과 겹쳐요`); return; }
    if (await patch("bookings", id, { status: "confirmed" })) toast("예약을 확정했어요"); return;
  }
  if (a === "bkCancel") { if (!b.dataset.confirm) { b.dataset.confirm = 1; b.textContent = "정말 취소"; return; } if (await patch("bookings", id, { status: "cancelled", cancelReq: false })) { closeSheet(); toast("예약을 취소했어요"); } return; }
  if (a === "bkKeep") { if (await patch("bookings", id, { cancelReq: false })) toast("취소 요청을 거절했어요"); return; }
  if (a === "bkCancelReq") { if (!b.dataset.confirm) { b.dataset.confirm = 1; b.textContent = "정말 취소 요청"; return; } if (await patch("bookings", id, { cancelReq: true })) toast("코치님께 취소 요청을 보냈어요"); return; }
  if (a === "bkWithdraw") { if (await del("bookings", id)) toast("요청을 취소했어요"); return; }
  if (a === "bkDone") {
    const x = find("bookings", id); if (!x) return;
    await patch("bookings", id, { status: "done" });
    ui.coachMember = x.memberId; ui.tab = "sessions"; saveUi(); openDetail(x.memberId); render();
    return sessionSheet({ date: x.date });
  }
  if (a === "editSession") return sessionSheet(find("sessions", id));
  if (a === "addEx") { $("#exRows").insertAdjacentHTML("beforeend", exRowsHtml([{}])); $("#exRows").lastElementChild.querySelector(".ex-n").focus(); return; }
  if (a === "rmEx") { const r = document.querySelectorAll("#exRows .ex-row"); if (r.length > 1) b.closest(".ex-row").remove(); else b.closest(".ex-row").querySelectorAll("input").forEach(i => i.value = ""); return; }
  if (a === "copyPrev") { const p = by(of("sessions", curMember()), "date")[0]; $("#exRows").innerHTML = exRowsHtml(p.exercises || []); return; }
  if (a === "saveSession") {
    const data = { date: $("#fs-date").value || today(), exercises: readEx(), coachFb: $("#fs-fb").value.trim() };
    b.disabled = true;
    const ok = id ? await patch("sessions", id, data) : await create("sessions", uid(), Object.assign(data, { memberId: curMember(), memberFb: "", fbSeen: false }));
    b.disabled = false; if (ok) { closeSheet(); toast("수업을 기록했어요"); }
    return;
  }
  if (a === "delSession") { if (confirmDel(b) && await del("sessions", id)) { closeSheet(); toast("삭제했어요"); } return; }
  if (a === "saveMemberFb") {
    const v = $("#mfb-" + id).value.trim(); if (!v) return toast("내용을 적어 주세요.");
    b.disabled = true; if (await patch("sessions", id, { memberFb: v, fbSeen: false })) toast("코치님께 보냈어요"); b.disabled = false; return;
  }
  if (a === "markFb") { await patch("sessions", id, { fbSeen: true }); return; }
  if (a === "newMeal") return mealSheet();
  if (a === "openMeal") return mealSheet(find("meals", id));
  if (a === "saveMeal") {
    const memo = $("#fml-memo").value.trim();
    const old = id ? find("meals", id) : null;
    if (!pendingPhoto && !memo && !(old && (old.thumb || old.photo))) return toast("사진이나 메모 중 하나는 있어야 해요.");
    const data = { date: $("#fml-date").value || today(), type: $("#fml-type").value, memo, seen: false };
    const mid = old ? old.memberId : curMember();
    const mealId = id || uid();
    b.disabled = true; b.textContent = "올리는 중…";
    let ok = true;
    if (pendingPhoto) {
      ok = await create("photos", mealId, { memberId: mid, date: data.date, data: pendingPhoto.full });
      Object.assign(data, { thumb: pendingPhoto.thumb, hasPhoto: true, photo: null });
    }
    if (ok) ok = id ? await patch("meals", id, data) : await create("meals", mealId, Object.assign(data, { memberId: mid }));
    b.disabled = false; b.textContent = "올리기"; if (ok) { closeSheet(); toast("식사를 올렸어요"); }
    return;
  }
  if (a === "delMeal") {
    if (confirmDel(b)) { const x = find("meals", id); if (await del("meals", id)) { if (x && x.hasPhoto) { try { await deleteDoc(doc(fs, "photos", id)); } catch (e) {} } closeSheet(); toast("삭제했어요"); } }
    return;
  }
  if (a === "openFeed") return openFeed();
  if (a === "closeFeed") { feed = null; return closeSheet(); }
  if (a === "feedPrev" || a === "feedNext") { feed.i += a === "feedNext" ? 1 : -1; return renderFeed(); }
  if (a === "qc") { const ta = $("#fmc"); const t = b.dataset.t; ta.value = ta.value.trim() ? ta.value.trim() + "\n" + t : t; b.classList.add("on"); return; }
  if (a === "wkNav") { ui.wkOff = Math.max(0, (ui.wkOff || 0) + (+b.dataset.k)); saveUi(); return render(); }
  if (a === "goalCalc") { if (!isCoach()) return; const m = S.members.find(x => x.id === id); return m && goalSheet(m); }
  if (a === "goalRecalc") { const sh = $("#layer .sheet"); return sh && sh._recalc && sh._recalc(); }
  if (a === "goalSave") {
    if (!isCoach()) return;
    const k = numOrNull($("#gc-kcal").value), c = numOrNull($("#gc-c").value), p = numOrNull($("#gc-p").value), f = numOrNull($("#gc-f").value);
    if (!k || c == null || p == null || f == null) { $("#gc-msg").textContent = "칼로리와 비율을 모두 입력해 주세요."; return; }
    if (c + p + f !== 100) { $("#gc-msg").textContent = `비율 합계가 ${c + p + f}%예요. 100%로 맞춰 주세요.`; return; }
    const mealGoal = { kcal: Math.round(k), ratio: { c, p, f }, carbs: Math.round(k * c / 400), protein: Math.round(k * p / 400), fat: Math.round(k * f / 900), setAt: today() };
    b.disabled = true;
    const ok = await patch("members", id, { mealGoal });
    if (ok) {
      await create("coachNotes", id, { goalBasis: { goal: $("#gc-goal").value, speed: $("#gc-speed").value, act: $("#gc-act").value, weight: numOrNull($("#gc-w").value), lbm: numOrNull($("#gc-lbm").value), bmr: numOrNull($("#gc-bmr").value), at: today() } }, true);
      closeSheet(); toast("식단 목표를 저장했어요");
    }
    b.disabled = false; return;
  }
  if (a === "goalClear") { if (!isCoach() || !confirmDel(b)) return; if (await patch("members", id, { mealGoal: null })) { closeSheet(); toast("식단 목표를 지웠어요"); } return; }
  if (a === "saveCalc" || a === "resetCalc") {
    const v = {}; if (a === "saveCalc") { for (const el of document.querySelectorAll(".cc")) { const n = numOrNull(el.value); if (n == null) return toast("숫자로 입력해 주세요."); v[el.dataset.k] = n; } } else Object.assign(v, CALC_DEF);
    if (await create("coachNotes", "_calc", v)) { toast(a === "saveCalc" ? "계산 기준을 저장했어요" : "기본값으로 되돌렸어요"); if (a === "resetCalc") for (const el of document.querySelectorAll(".cc")) el.value = CALC_DEF[el.dataset.k]; }
    return;
  }
  if (a === "saveAiKey" || a === "delAiKey") {
    if (!isCoach()) return;
    const key = a === "saveAiKey" ? $("#st-aikey").value.trim().replace(/\s+/g, "") : "";
    if (a === "saveAiKey" && !/^(AQ\.|AIza)[\w.\-]{20,}$/.test(key)) return toast("키 모양이 맞지 않아요. 키 복사 버튼으로 다시 복사해 주세요.");
    if (await create("coachNotes", "_ai", { key })) { toast(key ? "AI 분석 키를 저장했어요" : "키를 지웠어요"); setTimeout(settingsSheet, 400); }
    return;
  }
  if (a === "saveQuick") {
    const items = $("#st-quick").value.split("\n").map(x => x.trim()).filter(Boolean).slice(0, 20);
    if (await create("coachNotes", "_templates", { items })) toast("빠른 코멘트를 저장했어요");
    return;
  }
  if (a === "aiMeal") {
    const x = find("meals", id), msg = $("#ai-msg"), img = $("#meal-big");
    if (!x || !img) return;
    b.disabled = true; msg.textContent = "사진을 분석하는 중… (10~20초)";
    try {
      const r = await analyzeMeal(img.src, x.memo, x.type);
      pendingNutrition = { id, data: r };
      const ta = $("#fmc"), txt = nutritionText(r);
      ta.value = ta.value.trim() ? ta.value.trim() + "\n\n" + txt : txt;
      msg.textContent = "추정치를 채웠어요. 확인하고 고친 뒤 코멘트 저장을 눌러 주세요.";
    } catch (e) { console.error(e); msg.textContent = aiError(e); }
    b.disabled = false; return;
  }
  if (a === "saveMealComment" || a === "markMealSeen") {
    const p = { seen: true }; if (a === "saveMealComment") { p.coachComment = $("#fmc").value.trim(); if (pendingNutrition && pendingNutrition.id === id) p.nutrition = pendingNutrition.data; }
    if (a === "saveMealComment" && !p.coachComment) { toast("코멘트를 적거나 '확인만'을 눌러 주세요."); return; }
    if (await patch("meals", id, p)) {
      toast(a === "saveMealComment" ? "코멘트를 남겼어요" : "확인했어요");
      if (feed) { feed.q = feed.q.filter(z => z !== id); renderFeed(); } else closeSheet();
    }
    return;
  }
  if (a === "newBody") return bodySheet();
  if (a === "editBody") return bodySheet(find("body", id));
  if (a === "saveBody") {
    const w = numOrNull($("#fb-w").value), smm = numOrNull($("#fb-smm").value), fat = numOrNull($("#fb-fat").value), pbf = numOrNull($("#fb-pbf").value), lbm = numOrNull($("#fb-lbm").value), bmr = numOrNull($("#fb-bmr").value);
    if (w == null && smm == null && fat == null) return toast("체중, 골격근량, 체지방량 중 하나는 입력해 주세요.");
    const mid = id ? find("body", id).memberId : curMember();
    const data = { date: $("#fb-date").value || today(), weight: w, smm, fat, pbf, lbm, bmr };
    b.disabled = true;
    const ok = id ? await patch("body", id, data) : await create("body", uid(), Object.assign(data, { memberId: mid }));
    b.disabled = false;
    if (ok) { closeSheet(); toast("체성분을 저장했어요"); setTimeout(() => syncSummary(mid), 800); }
    return;
  }
  if (a === "delBody") { const mid = find("body", id)?.memberId; if (confirmDel(b) && await del("body", id)) { closeSheet(); toast("삭제했어요"); setTimeout(() => syncSummary(mid), 800); } return; }
  if (a === "newWorkout") return workoutSheet();
  if (a === "editWorkout") return workoutSheet(find("workouts", id));
  if (a === "saveWorkout") {
    const ex = readEx(), note = $("#fw-note").value.trim(); if (!ex.length && !note) return toast("운동이나 메모를 입력해 주세요.");
    const data = { date: $("#fw-date").value || today(), minutes: $("#fw-min").value.trim(), exercises: ex, note };
    b.disabled = true;
    const ok = id ? await patch("workouts", id, data) : await create("workouts", uid(), Object.assign(data, { memberId: curMember() }));
    b.disabled = false; if (ok) { closeSheet(); toast("운동을 기록했어요"); }
    return;
  }
  if (a === "delWorkout") { if (confirmDel(b) && await del("workouts", id)) { closeSheet(); toast("삭제했어요"); } return; }
  if (a === "saveWComment") { if (await patch("workouts", id, { coachComment: $("#wc-" + id).value.trim() })) toast("코멘트를 남겼어요"); return; }
});
document.addEventListener("change", async e => {
  if (e.target.id === "pf-photo" && e.target.files[0]) { try { pendingProfilePhoto = shrink(await loadImg(e.target.files[0]), 900, .82, 600000); const p = $("#pf-prev"); p.src = pendingProfilePhoto; p.hidden = false; } catch (err) { toast("사진을 열 수 없어요."); } return; }
  if (e.target.id === "st-import" && e.target.files[0]) { e.target.disabled = true; await runImport(e.target.files[0], $("#st-imp-msg")); e.target.disabled = false; e.target.value = ""; return; }
  if (e.target.id === "shareToggle") {
    const mid = me.memberId;
    if (await patch("members", mid, { shared: e.target.checked, bodySummary: bodySummaryFor(mid) })) toast(e.target.checked ? "체성분 변화를 공개했어요" : "공개를 껐어요");
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

// block pinch / double-tap zoom (iOS Safari ignores user-scalable=no)
["gesturestart", "gesturechange"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener("touchmove", e => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });

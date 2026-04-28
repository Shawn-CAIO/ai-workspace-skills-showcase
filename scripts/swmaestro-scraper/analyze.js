/**
 * analyze.js — 수집된 강의 목록 분석
 * 사용: node analyze.js [path-to-json]
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, 'output');

const argv = process.argv.slice(2);
const catArg = argv.find((a) => a.startsWith('--category='))?.split('=')[1] || '멘토특강';
const inputPath = argv.find((a) => !a.startsWith('--')) || (() => {
  const files = readdirSync(OUTPUT_DIR).filter((f) => f.startsWith('lectures-') && f.endsWith('.json')).sort();
  return resolve(OUTPUT_DIR, files[files.length - 1]);
})();

console.log(`입력: ${inputPath}\n`);
const data = JSON.parse(readFileSync(inputPath, 'utf-8'));

function parseCapacity(cap) {
  const m = cap.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  return { applied: parseInt(m[1], 10), max: parseInt(m[2], 10) };
}

function parseSchedule(sched) {
  // "2026-05-04(월) 15:00 ~ 17:00"
  const dateM = sched.match(/(\d{4}-\d{2}-\d{2})\(([월화수목금토일])\)/);
  const timeM = sched.match(/(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/);
  if (!dateM || !timeM) return null;
  const [, date, dow] = dateM;
  const [, sH, sM, eH, eM] = timeM;
  const startHour = parseInt(sH, 10);
  const endHour = parseInt(eH, 10);
  const durationMin = (endHour * 60 + parseInt(eM, 10)) - (startHour * 60 + parseInt(sM, 10));
  return { date, dow, startHour, endHour, startTime: `${sH.padStart(2,'0')}:${sM}`, endTime: `${eH.padStart(2,'0')}:${eM}`, durationMin };
}

// 행 정규화
const rows = data.map((r) => {
  const c = parseCapacity(r.capacity);
  const s = parseSchedule(r.schedule);
  return {
    ...r,
    applied: c?.applied ?? null,
    max: c?.max ?? null,
    fillRate: c && c.max > 0 ? c.applied / c.max : null,
    scheduleDate: s?.date ?? null,
    dow: s?.dow ?? null,
    startHour: s?.startHour ?? null,
    endHour: s?.endHour ?? null,
    startTime: s?.startTime ?? null,
    durationMin: s?.durationMin ?? null,
  };
});

// "완료된" 강의만 분석 대상 (접수가 끝나서 신청률이 의미가 있는 것)
const completed = rows.filter((r) => r.status && !r.status.includes('접수중'));
const lectures = completed.filter((r) => r.category === catArg && r.applied !== null && r.max !== null);

console.log('='.repeat(70));
console.log(`📊 ${catArg} 분석 (접수 마감된 건만 집계)`);
console.log('='.repeat(70));
console.log(`${catArg}: ${lectures.length}건`);
console.log();

function summarizeByKey(rows, keyFn, label, topN = 20) {
  const groups = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null || k === undefined) continue;
    groups[k] ||= { count: 0, applied: 0, max: 0, full: 0 };
    groups[k].count++;
    groups[k].applied += r.applied;
    groups[k].max += r.max;
    if (r.fillRate >= 1.0) groups[k].full++;
  }
  const arr = Object.entries(groups).map(([k, v]) => ({
    key: k,
    count: v.count,
    avgFill: v.max > 0 ? v.applied / v.max : 0,
    fullRate: v.count > 0 ? v.full / v.count : 0,
    fullCount: v.full,
  }));
  arr.sort((a, b) => b.avgFill - a.avgFill);
  console.log(`\n${label}`);
  console.log('-'.repeat(70));
  console.log(`${'key'.padEnd(20)} ${'건수'.padStart(6)} ${'평균신청률'.padStart(10)} ${'만석율'.padStart(10)} ${'만석/총'.padStart(10)}`);
  for (const row of arr.slice(0, topN)) {
    console.log(
      `${row.key.padEnd(20)} ${String(row.count).padStart(6)} ${(row.avgFill * 100).toFixed(0).padStart(9)}% ${(row.fullRate * 100).toFixed(0).padStart(9)}% ${(row.fullCount + '/' + row.count).padStart(10)}`
    );
  }
  return arr;
}

console.log('\n\n' + '█'.repeat(70));
console.log(`📚 ${catArg} 분석`);
console.log('█'.repeat(70));

summarizeByKey(lectures, (r) => r.dow, '요일별');
summarizeByKey(lectures, (r) => {
  const h = r.startHour;
  if (h === null) return null;
  if (h < 9) return '아침(~09)';
  if (h < 12) return '오전(09-12)';
  if (h < 14) return '점심(12-14)';
  if (h < 18) return '오후(14-18)';
  if (h < 20) return '저녁(18-20)';
  if (h < 22) return '야간(20-22)';
  return '심야(22~)';
}, '시간대별');
summarizeByKey(lectures, (r) => r.startHour !== null ? `${String(r.startHour).padStart(2,'0')}시` : null, '시작시각별 (1시간 단위)');
summarizeByKey(lectures, (r) => {
  if (r.durationMin === null) return null;
  if (r.durationMin <= 60) return '1시간';
  if (r.durationMin <= 90) return '1.5시간';
  if (r.durationMin <= 120) return '2시간';
  if (r.durationMin <= 180) return '3시간';
  return '3시간+';
}, '소요시간별');

// 토픽 분석: 제목에서 키워드 추출
const TOPIC_KEYWORDS = [
  ['LLM/GPT', /LLM|GPT|Claude|Gemini|Llama|Qwen|프롬프트|prompt/i],
  ['멀티모달/VLM', /VLM|멀티모달|multimodal|이미지\s*생성|vision/i],
  ['RAG/검색', /RAG|retrieval|벡터|embedding|임베딩/i],
  ['에이전트', /agent|에이전트|agentic/i],
  ['MCP', /MCP/i],
  ['Physical AI/로봇', /physical\s*ai|로봇|robot|센서|sensor/i],
  ['LoRA/파인튜닝', /LoRA|fine.?tun|파인튜닝|SFT|RLHF|DPO/i],
  ['추천/RecSys', /추천|recommend|RecSys/i],
  ['NLP', /NLP|자연어/i],
  ['CV/영상', /CV|computer\s*vision|영상|detection|segmentation/i],
  ['음성', /음성|voice|STT|TTS|ASR/i],
  ['MLOps/배포', /MLOps|배포|deploy|docker|k8s|serving/i],
  ['데이터/수집', /데이터|data|크롤링|crawl/i],
  ['개발/코딩', /Cursor|vibe|AI\s*코딩|AI.*개발|vibe.?cod/i],
  ['창업/비즈니스', /창업|스타트업|startup|비즈니스|business|투자|PMF/i],
  ['취업/커리어', /취업|커리어|포트폴리오|이력서|면접/i],
  ['논문/연구', /논문|paper|arXiv|연구|research/i],
  ['UX/디자인', /UX|디자인|design|피그마|Figma/i],
  ['프레젠테이션', /발표|프레젠테이션|presentation|피칭|pitch/i],
];

function topicOf(title) {
  const hits = [];
  for (const [name, re] of TOPIC_KEYWORDS) {
    if (re.test(title)) hits.push(name);
  }
  return hits.length > 0 ? hits : ['기타'];
}

const topicStats = {};
for (const r of lectures) {
  const topics = topicOf(r.title);
  for (const t of topics) {
    topicStats[t] ||= { count: 0, applied: 0, max: 0, full: 0 };
    topicStats[t].count++;
    topicStats[t].applied += r.applied;
    topicStats[t].max += r.max;
    if (r.fillRate >= 1.0) topicStats[t].full++;
  }
}
const topicArr = Object.entries(topicStats).map(([k, v]) => ({
  key: k,
  count: v.count,
  avgFill: v.max > 0 ? v.applied / v.max : 0,
  fullRate: v.count > 0 ? v.full / v.count : 0,
  fullCount: v.full,
}));

// 신청률 × 건수 (표본 3건 미만 제외)
const topicFiltered = topicArr.filter((t) => t.count >= 3).sort((a, b) => b.avgFill - a.avgFill);
console.log('\n토픽별 (표본 3건 이상)');
console.log('-'.repeat(70));
console.log(`${'토픽'.padEnd(20)} ${'건수'.padStart(6)} ${'평균신청률'.padStart(10)} ${'만석율'.padStart(10)}`);
for (const row of topicFiltered) {
  console.log(
    `${row.key.padEnd(20)} ${String(row.count).padStart(6)} ${(row.avgFill * 100).toFixed(0).padStart(9)}% ${(row.fullRate * 100).toFixed(0).padStart(9)}%`
  );
}

// Top-10 가장 인기 있었던 개별 강의
console.log('\n\n' + '█'.repeat(70));
console.log(`🏆 만석 + 인기 Top 20 ${catArg}`);
console.log('█'.repeat(70));
const ranked = [...lectures]
  .filter((r) => r.max >= 3)
  .sort((a, b) => {
    if (b.fillRate !== a.fillRate) return b.fillRate - a.fillRate;
    return b.max - a.max;
  });
for (const r of ranked.slice(0, 20)) {
  console.log(`[${(r.fillRate * 100).toFixed(0).padStart(3)}%] ${r.applied}/${r.max} ${r.dow} ${r.startTime} — ${r.title.replace('[멘토 특강] ', '')}`);
}

// Bottom — 안 채워진 강의
console.log('\n\n' + '█'.repeat(70));
console.log(`📉 신청 저조 Bottom 15 ${catArg} (정원 3 이상)`);
console.log('█'.repeat(70));
const bottom = ranked.slice().reverse();
for (const r of bottom.slice(0, 15)) {
  console.log(`[${(r.fillRate * 100).toFixed(0).padStart(3)}%] ${r.applied}/${r.max} ${r.dow} ${r.startTime} — ${r.title.replace('[멘토 특강] ', '')}`);
}

// 요일 × 시간대 교차표 (${catArg})
console.log('\n\n' + '█'.repeat(70));
console.log('🗓️  요일 × 시간대 교차표 (${catArg} 평균 신청률 %)');
console.log('█'.repeat(70));
const dows = ['월', '화', '수', '목', '금', '토', '일'];
const slots = [
  ['오전(~12)', (h) => h < 12],
  ['점심(12-14)', (h) => h >= 12 && h < 14],
  ['오후(14-18)', (h) => h >= 14 && h < 18],
  ['저녁(18-20)', (h) => h >= 18 && h < 20],
  ['야간(20-22)', (h) => h >= 20 && h < 22],
  ['심야(22~)', (h) => h >= 22],
];
let header = '요일'.padEnd(6);
for (const [name] of slots) header += name.padStart(14);
console.log(header);
for (const d of dows) {
  let line = d.padEnd(6);
  for (const [, fn] of slots) {
    const subset = lectures.filter((r) => r.dow === d && r.startHour !== null && fn(r.startHour));
    if (subset.length === 0) {
      line += '-'.padStart(14);
    } else {
      const totalApplied = subset.reduce((s, r) => s + r.applied, 0);
      const totalMax = subset.reduce((s, r) => s + r.max, 0);
      const rate = totalMax > 0 ? (totalApplied / totalMax * 100).toFixed(0) + '%' : '-';
      line += `${rate}(${subset.length})`.padStart(14);
    }
  }
  console.log(line);
}
console.log('(괄호는 표본 강의 수)');

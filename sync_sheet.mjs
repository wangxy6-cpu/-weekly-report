#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = path.join(__dirname, 'index.html');
const SPREADSHEET_TOKEN = 'CKN8swAnghxr8ktIXOXckTW0nid';
const SHEETS = [
  { id: '81134b', name: '摘星工作室' },
  { id: 'f5psbj', name: '不二工作室' },
  { id: 'Vl0yzi', name: 'INJOY工作室' },
  { id: 'rwfbmn', name: '三重奏工作室' },
  { id: 'B6jvo9', name: '吉趣社' },
  { id: 'U0Yknm', name: '技术中台基建类需求' },
  { id: 'mDKiN1', name: '用增需求' },
];

function larkApi(url) {
  try {
    const out = execSync(`lark-cli api GET "${url}" --as user`, {
      encoding: 'utf-8', stdio: ['pipe','pipe','pipe'], maxBuffer: 20*1024*1024,
    });
    return JSON.parse(out);
  } catch(e) {
    process.stderr.write(`[WARN] ${url}\n${e.stderr||e.message}\n`);
    return null;
  }
}

function excelToStr(serial) {
  if (typeof serial !== 'number') return '';
  try {
    const ms = (serial - 25569) * 86400 * 1000; // Excel epoch to Unix
    const d = new Date(ms);
    const bj = new Date(ms + 8*3600*1000);
    return `${bj.getUTCFullYear()}.${String(bj.getUTCMonth()+1).padStart(2,'0')}.${String(bj.getUTCDate()).padStart(2,'0')}`;
  } catch { return ''; }
}

function getText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'string') return cell.trim();
  if (typeof cell === 'number') return excelToStr(cell);
  if (Array.isArray(cell)) return cell.map(s => (s && typeof s === 'object') ? (s.text||'') : '').join('').trim();
  if (typeof cell === 'object') return (cell.text || cell.name || '').trim();
  return String(cell).trim();
}

function getLink(cell) {
  if (!Array.isArray(cell)) return '';
  for (const s of cell) {
    if (s && typeof s === 'object' && s.link) return s.link;
  }
  return '';
}

function getName(cell) {
  if (!cell) return '';
  if (typeof cell === 'object' && !Array.isArray(cell) && cell.mentionType === 0) return cell.name || '';
  if (Array.isArray(cell)) {
    for (const s of cell) {
      if (s && typeof s === 'object' && s.mentionType === 0) return s.name || '';
    }
  }
  return getText(cell);
}

const allRecords = [];

for (const sheet of SHEETS) {
  const url = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${sheet.id}!A1:T500`;
  process.stderr.write(`读取 ${sheet.name}...\n`);
  const resp = larkApi(url);
  if (!resp || resp.code !== 0) {
    process.stderr.write(`  [WARN] 失败\n`); continue;
  }
  const rows = resp.data.valueRange.values || [];

  // 표 구조: 게임명행 → 헤더행 → 데이터행 이 반복됨
  // 전체 행을 순회하며 동적으로 처리
  let currentGame = ''; let hmap = {}; let cnt = 0;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row.some(c => c != null)) continue;

    const texts = row.map(getText);

    // 헤더 행 감지 (任务描述 포함)
    if (texts.includes('任务描述')) {
      hmap = {};
      texts.forEach((t, j) => { if (t) hmap[t] = j; });
      continue;
    }

    const firstText = getText(row[0]);
    const subIdx = hmap['提单人'] ?? 1;
    const hasSub = subIdx < row.length && row[subIdx] &&
      typeof row[subIdx] === 'object' && (row[subIdx].mentionType === 0 || row[subIdx].category === 'at-user-block');

    // 게임명 행: 첫 번째 셀에 텍스트, 제출자 없음, 나머지 비어있음
    if (firstText && !hasSub && [1,2,3,4].every(k => k >= row.length || row[k] == null)) {
      currentGame = firstText; continue;
    }

    const col = (n, fb) => { const i = hmap[n] ?? fb; return (i == null || i >= row.length) ? null : row[i]; };

    const taskCell = col('任务描述', 0);
    const submitter = getName(col('提单人', 1));
    const taskName = getText(taskCell);
    if (!taskName || !submitter) continue;

    const utCell = col('进度更新时间', 4);
    const ecCell = col('期望完成时间（需求方）', hmap['期望完成时间（需求方）'] ?? 5);
    const etaCell = col('预计对外时间（技术中台）', hmap['预计对外时间（技术中台）'] ?? 6);
    const anCell = col('异常情况', hmap['异常情况'] ?? 7);

    allRecords.push({
      studio: sheet.name,
      game: currentGame,
      task: taskName,
      link: getLink(taskCell),
      submitter,
      avatar: '',
      status: getText(col('实际进度', 2)),
      update: getText(col('本周情况同步', 3)),
      updateDate: typeof utCell === 'number' ? excelToStr(utCell) : '',
      expect: typeof ecCell === 'number' ? excelToStr(ecCell) : getText(ecCell),
      eta: typeof etaCell === 'number' ? excelToStr(etaCell) : getText(etaCell),
      anomaly: getText(anCell) || '无',
    });
    cnt++;
  }
  process.stderr.write(`  → ${cnt} 条\n`);
}

process.stderr.write(`\n共 ${allRecords.length} 条记录\n`);

// 更新 index.html
let html = readFileSync(INDEX_FILE, 'utf-8');
const syncVersion = Date.now().toString();
const newBlock = `const ALL_DATA = ${JSON.stringify(allRecords, null, 2)};`;
let newHtml = html.replace(/const ALL_DATA = \[[\s\S]*?\n\];/, newBlock);

// 同时更新数据版本号
newHtml = newHtml.replace(/const DATA_VERSION = '[^']*';/, `const DATA_VERSION = '${syncVersion}';`);

// 重建 f-submitter 下拉选项（确保包含所有提单人）
const submitters = [...new Set(allRecords.map(r => r.submitter).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
const submitterOptions = '<option value="">全部提单人</option>' +
  submitters.map(s => `<option value="${s}">${s}</option>`).join('');
newHtml = newHtml.replace(
  /(<select[^>]+id="f-submitter"[^>]*>)[\s\S]*?(<\/select>)/,
  `$1\n            ${submitterOptions}\n          $2`
);

if (newHtml === html) {
  process.stderr.write('❌ 未匹配到 ALL_DATA\n'); process.exit(1);
}
writeFileSync(INDEX_FILE, newHtml, 'utf-8');
process.stderr.write('✅ index.html 更新完成\n');

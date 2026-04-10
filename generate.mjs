#!/usr/bin/env node
/**
 * 平台排期汇总 · 数据同步脚本
 * 从飞书多维表格读取数据，更新 index.html 中的 ALL_DATA
 *
 * 用法：node generate.mjs
 * 依赖：lark-cli（已配置 user 身份：lark-cli auth login --scope "bitable:app:readonly"）
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 配置 ──────────────────────────────────────────────────────────────
const APP_TOKEN  = 'I33LbfLL2aUYjVs6supcv5TLnzb';
const TABLE_ID   = 'tblUHcWb0EUDdmS7';
const VIEW_ID    = 'vewYfz7dCu';
const INDEX_FILE = path.join(__dirname, 'index.html');

// 已完成类状态截止日（毫秒，北京时间 2026-03-15 00:00:00）
const CUTOFF_TS = new Date('2026-03-15T00:00:00+08:00').getTime();

// ── 工具函数 ──────────────────────────────────────────────────────────

function larkApi(urlPath) {
  try {
    const out = execSync(`lark-cli api GET "${urlPath}" --as user`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (e) {
    process.stderr.write(`[WARN] API 失败: ${urlPath}\n${e.stderr || e.message}\n`);
    return null;
  }
}

function formatDate(ts) {
  if (!ts || isNaN(ts)) return '';
  // Bitable 日期字段：毫秒时间戳；如果值 < 1e10 则为秒
  const ms = ts < 1e10 ? ts * 1000 : ts;
  const d = new Date(ms);
  if (isNaN(d)) return '';
  // 转北京时间
  const bj = new Date(ms + 8 * 3600 * 1000);
  const y  = bj.getUTCFullYear();
  const m  = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(bj.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${dy}`;
}

function extractText(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    return val.map(v => {
      if (!v) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return v.text || v.value || v.name || v.display_value || '';
      return '';
    }).filter(Boolean).join('、');
  }
  if (typeof val === 'object') {
    return val.text || val.value || val.name || val.display_value || '';
  }
  return String(val);
}

function extractPerson(val) {
  if (!val) return '';
  if (Array.isArray(val)) {
    return val.map(p => (p && p.name) ? p.name : '').filter(Boolean).join('、');
  }
  if (typeof val === 'object') return val.name || '';
  return extractText(val);
}

// 判断是否为子任务：父任务唯一-ID 或 父记录 字段有值
function isChildRecord(fields) {
  const parentId = fields['父任务唯一-ID'];
  if (parentId) {
    if (Array.isArray(parentId) && parentId.length > 0) return true;
    if (typeof parentId === 'string' && parentId.trim() !== '') return true;
  }
  const parentRec = fields['父记录'];
  if (parentRec) {
    if (Array.isArray(parentRec) && parentRec.length > 0) return true;
    if (typeof parentRec === 'string' && parentRec.trim() !== '') return true;
  }
  return false;
}

// ── 分页拉取（带过滤、防死循环） ──────────────────────────────────────

function fetchWithFilter(filterFormula, label) {
  const records = [];
  let pageToken = '';
  let hasMore   = true;
  let page      = 0;
  const MAX_PAGES = 100; // 安全上限：100页 × 500条 = 50,000条

  process.stderr.write(`\n[${label}] 开始拉取...\n`);

  while (hasMore && page < MAX_PAGES) {
    page++;
    const params = new URLSearchParams({
      view_id: VIEW_ID,
      page_size: '500',
    });
    if (filterFormula) params.set('filter', filterFormula);
    if (pageToken)     params.set('page_token', pageToken);

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?${params.toString()}`;
    process.stderr.write(`  [第${page}页] 请求中...\n`);

    const resp = larkApi(url);
    if (!resp) break;
    if (resp.code !== 0) {
      process.stderr.write(`  [ERR] code=${resp.code} msg=${resp.msg}\n`);
      break;
    }

    const items = resp.data?.items || [];
    records.push(...items);
    process.stderr.write(`  → 本页 ${items.length} 条，累计 ${records.length} 条\n`);

    const newToken = resp.data?.page_token || '';
    hasMore = resp.data?.has_more || false;

    // 防止 page_token 不变导致死循环
    if (newToken && newToken === pageToken) {
      process.stderr.write(`  [WARN] page_token 未变化（${newToken}），停止分页\n`);
      break;
    }
    pageToken = newToken;
  }

  if (page >= MAX_PAGES) {
    process.stderr.write(`  [WARN] 已达最大分页限制 ${MAX_PAGES} 页\n`);
  }

  process.stderr.write(`[${label}] 完成，共 ${records.length} 条\n`);
  return records;
}

// ── 数据读取：分两次查询 ──────────────────────────────────────────────

function fetchAllRelevantRecords() {
  const cutoffStr = String(CUTOFF_TS);
  // 父级需求条件：父记录为空
  const isParent = 'IsEmpty(CurrentValue.[父记录])';

  // 查询1：父级 + 待上线
  const pendingRecords = fetchWithFilter(
    `AND(${isParent},CurrentValue.[上线状态]="待上线")`,
    '待上线'
  );

  // 查询2：父级 + 已上线/已完成 且 发版日 >= 截止日期
  const doneRecords = fetchWithFilter(
    `AND(${isParent},OR(CurrentValue.[上线状态]="已上线",CurrentValue.[上线状态]="已完成（无需发布）"),OR(CurrentValue.[版本发版日（服务端）]>=${cutoffStr},CurrentValue.[版本发版日（客户端）]>=${cutoffStr}))`,
    '已上线/已完成'
  );

  return [...pendingRecords, ...doneRecords];
}

// ── 字段转换 ──────────────────────────────────────────────────────────

function transformRecord(rec) {
  const f = rec.fields;

  // 发版时间：服务端 / 客户端
  const serverTs = typeof f['版本发版日（服务端）'] === 'number' ? f['版本发版日（服务端）'] : null;
  const clientTs = typeof f['版本发版日（客户端）'] === 'number' ? f['版本发版日（客户端）'] : null;
  const serverStr = formatDate(serverTs);
  const clientStr = formatDate(clientTs);
  let eta = '';
  if (serverStr && clientStr) {
    eta = serverStr === clientStr
      ? serverStr
      : `服务端:${serverStr} / 客户端:${clientStr}`;
  } else {
    eta = serverStr || clientStr || '';
  }

  // 预期对外时间
  const expectTs = typeof f['预期对外时间'] === 'number' ? f['预期对外时间'] : null;
  const expect = formatDate(expectTs);

  // 最后更新时间 → updateDate
  const updateTs = typeof f['最后更新时间'] === 'number' ? f['最后更新时间'] : null;
  const updateDate = formatDate(updateTs);

  // 工作室（需求来源部门）
  const studio = extractText(f['需求来源部门']) || '';

  // 提单人（需求提单人）
  const submitter = extractPerson(f['需求提单人']) || '';

  // 本周进展（手动填写，不强制覆盖）
  const update = extractText(f['本周进展']) || '';

  // 异常情况
  const anomaly = extractText(f['异常情况']) || '无';

  // 任务卡链接（飞书 Base 记录直链）
  const link = `https://leiting.feishu.cn/base/${APP_TOKEN}?table=${TABLE_ID}&record=${rec.record_id}`;

  // 任务描述（可能是富文本对象）
  let task = '';
  const taskField = f['任务描述'];
  if (taskField && typeof taskField === 'object' && taskField.text) {
    task = taskField.text;
  } else {
    task = extractText(taskField);
  }

  return {
    studio,
    game:       '',          // 新数据源无独立游戏字段，暂留空
    task,
    link,
    submitter,
    avatar:     '',
    status:     extractText(f['上线状态']) || '',
    update,
    expect,
    eta,
    anomaly,
    updateDate,
  };
}

// ── 更新 index.html ───────────────────────────────────────────────────

function updateIndexHtml(data) {
  let html = readFileSync(INDEX_FILE, 'utf-8');

  const dataJson = JSON.stringify(data, null, 2);
  const newBlock = `const ALL_DATA = ${dataJson};`;

  // 用明确的起止标记替换，避免贪婪匹配吃掉后续 JS 代码
  // 匹配：从 "const ALL_DATA = [" 开始，到独占一行的 "];" 结束
  const replaced = html.replace(
    /const ALL_DATA = \[[\s\S]*?\n\];/,
    newBlock
  );

  if (replaced === html) {
    process.stderr.write('[WARN] 未找到 ALL_DATA 替换目标，请检查 index.html 格式\n');
    return false;
  }

  writeFileSync(INDEX_FILE, replaced, 'utf-8');
  return true;
}

// ── 主流程 ────────────────────────────────────────────────────────────

process.stderr.write(`截止日期：2026-03-15（时间戳 ${CUTOFF_TS}）\n`);

const rawRecords = fetchAllRelevantRecords();
process.stderr.write(`\n原始拉取：${rawRecords.length} 条\n`);

// 转换字段
const data = rawRecords
  .map(transformRecord)
  .filter(r => r.task && r.submitter);
process.stderr.write(`有效记录（任务+提单人非空）：${data.length} 条\n`);

// 统计
const statusCounts = {};
data.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
process.stderr.write('\n状态分布：\n');
Object.entries(statusCounts).forEach(([s, n]) => process.stderr.write(`  ${s}: ${n} 条\n`));

const ok = updateIndexHtml(data);
if (ok) {
  process.stderr.write(`\n✅ index.html ALL_DATA 已更新，共 ${data.length} 条记录\n`);
} else {
  process.stderr.write('\n❌ index.html 更新失败\n');
  process.exit(1);
}

// 清理临时文件
try { execSync('rm -f bitable_resp.json bitable_resp2.json', { cwd: __dirname }); } catch {}

#!/usr/bin/env node
// 扫描 ALL_DATA 所有 submitter，批量查 open_id 并写入 .user_cache.json
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '.user_cache.json');
const INDEX_FILE = path.join(__dirname, 'index.html');

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}

const html = fs.readFileSync(INDEX_FILE, 'utf8');
const m = html.match(/const ALL_DATA = (\[[\s\S]*?\n\]);/);
const data = JSON.parse(m[1]);
const submitters = [...new Set(data.map(r => r.submitter).filter(Boolean))];

// 再合并排期表提单人
const aMatch = html.match(/const ACCEPTED_SUBMITTERS = (\[.*?\]);/);
if (aMatch) {
  const accepted = JSON.parse(aMatch[1]);
  for (const n of accepted) if (!submitters.includes(n)) submitters.push(n);
}

const todo = submitters.filter(n => !cache[n]);
console.log(`共 ${submitters.length} 提单人，已缓存 ${submitters.length - todo.length}，待查 ${todo.length}`);

function searchUser(query) {
  try {
    const out = execSync(
      `lark-cli contact +search-user --query ${JSON.stringify(query)} --page-size 20 --as user`,
      { encoding: 'utf8', shell: 'bash', stdio: ['pipe','pipe','pipe'] }
    );
    const r = JSON.parse(out);
    return r?.data?.users || [];
  } catch (e) {
    return [];
  }
}

const failed = [];
for (const name of todo) {
  // 1. 原名精确匹配
  let users = searchUser(name);
  let matches = users.filter(u => (u.name || '').trim() === name);

  // 2. 若无精确匹配，尝试"-"后面的部分（例如 兔力-陈勉 -> 陈勉）
  if (matches.length === 0 && name.includes('-')) {
    const shortName = name.split('-').pop().trim();
    users = searchUser(shortName);
    matches = users.filter(u => (u.name || '').trim() === shortName);
  }

  // 3. 若无精确匹配，尝试去括号内容（小新-李楠（lin4） -> 李楠）
  if (matches.length === 0) {
    const stripped = name.replace(/（[^）]*）|\([^)]*\)/g, '').replace(/^[\w\d]+-/, '').trim();
    if (stripped && stripped !== name) {
      users = searchUser(stripped);
      matches = users.filter(u => (u.name || '').trim() === stripped);
    }
  }

  if (matches.length === 1) {
    cache[name] = matches[0].open_id;
    console.log(`  ✅ ${name} → ${matches[0].open_id}`);
  } else if (matches.length > 1) {
    cache[name] = matches[0].open_id; // 取第一个，但警告
    console.log(`  ⚠️  ${name} 多个匹配(${matches.length})，取第一个 ${matches[0].open_id}`);
  } else {
    failed.push(name);
    console.log(`  ❌ ${name} 未找到`);
  }
}

fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
console.log(`\n缓存已更新，未解析 ${failed.length} 个：${failed.join('、') || '（无）'}`);

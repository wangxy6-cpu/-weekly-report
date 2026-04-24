/**
 * 技术中台周报发送脚本
 * 流程：先发预览卡片到你的飞书 DM → 点击卡片上的"发送到群"按钮 → 自动推送至对应工作室群
 * 用法：node send_weekly.mjs
 */

import fs from 'fs';
import { execSync, spawn } from 'child_process';
import readline from 'readline';

// ─── 配置 ───────────────────────────────────────────────
const MY_OPEN_ID = 'ou_348e9babdc1075b1e4dc12dca7233662'; // 王星宇

const GROUPS = [
  { studio: '摘星工作室', chat_id: 'oc_927cc30fa1c0e1ca816f2c239f3850f1' },
  { studio: '不二工作室', chat_id: 'oc_0489d11402ca51c4cf814835b717629f' },
];

const USER_MAP = {};

// ─── 工具函数 ────────────────────────────────────────────
const STATUS_ORDER = ['已上线','已完成','已完成（无需发布）','待上线','进行中','已排期','已停滞','停滞','已取消'];
const STATUS_EMOJI = {'已上线':'🟢','已完成':'🟢','已完成（无需发布）':'🟢','待上线':'🔵','进行中':'🔄','已排期':'🟣','已停滞':'🔴','停滞':'🔴','已取消':'⚫'};
const rank = s => { const i = STATUS_ORDER.indexOf(s); return i === -1 ? 99 : i; };

// 本地缓存：避免每次重启都重新解析所有提单人
const CACHE_FILE = new URL('./.user_cache.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
let USER_CACHE = {};
try { USER_CACHE = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}

function resolveOpenId(name) {
  if (USER_MAP[name]) return USER_MAP[name];
  if (USER_CACHE[name] !== undefined) return USER_CACHE[name] || null;
  try {
    const out = execSync(
      `lark-cli contact +search-user --query ${JSON.stringify(name)} --page-size 10 --as user`,
      { encoding: 'utf8', shell: 'bash', stdio: ['pipe','pipe','pipe'] }
    );
    const r = JSON.parse(out);
    const users = r?.data?.users || [];
    const exact = users.find(u => (u.name || '').trim() === name);
    const id = exact?.open_id || null;
    USER_CACHE[name] = id || '';
    fs.writeFileSync(CACHE_FILE, JSON.stringify(USER_CACHE, null, 2), 'utf8');
    return id;
  } catch (e) {
    console.error(`[WARN] 查询 ${name} 失败：${e.message?.slice(0,120)}`);
    USER_CACHE[name] = '';
    return null;
  }
}

function prewarmUsers(names) {
  const todo = [...new Set(names)].filter(n => n && !USER_MAP[n] && USER_CACHE[n] === undefined);
  if (!todo.length) return;
  console.log(`🔍 解析 ${todo.length} 个新提单人 open_id...`);
  todo.forEach(n => {
    const id = resolveOpenId(n);
    console.log(`  ${id ? '✅' : '⚠️ '} ${n}${id ? '' : '（未找到）'}`);
  });
}

function atUser(name) {
  const id = USER_MAP[name] || USER_CACHE[name];
  if (!id) console.error(`[WARN] @ 失败：${name} 无 open_id`);
  return id ? `<at id=${id}></at>` : name;
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
  return { start: mon, end: sun, label: `${fmt(mon)}~${fmt(sun)}` };
}

function inWeek(d, start, end) {
  if (!d) return false;
  const p = d.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (!p) return false;
  const dt = new Date(+p[1], +p[2]-1, +p[3]);
  return dt >= start && dt <= end;
}

function buildStudioCard(studio, items, weekLabel) {
  const submitterMap = {};
  items.forEach(r => {
    const s = r.submitter || '未知', g = r.game || '未分类';
    if (!submitterMap[s]) submitterMap[s] = {};
    if (!submitterMap[s][g]) submitterMap[s][g] = [];
    submitterMap[s][g].push(r);
  });
  Object.values(submitterMap).forEach(gm =>
    Object.values(gm).forEach(t => t.sort((a,b) => rank(a.status) - rank(b.status)))
  );

  const statusCnt = {};
  items.forEach(r => statusCnt[r.status] = (statusCnt[r.status]||0)+1);
  const summary = STATUS_ORDER.filter(s => statusCnt[s])
    .map(s => STATUS_EMOJI[s]+' '+s+' **'+statusCnt[s]+'条**').join('　');

  const elements = [];
  elements.push({ tag:'div', text:{ tag:'lark_md', content:`本周共更新 **${items.length} 条**\n${summary}` }});
  elements.push({ tag:'hr' });

  Object.entries(submitterMap).forEach(([submitter, gameMap]) => {
    let md = atUser(submitter) + '\n';
    Object.entries(gameMap).forEach(([game, tasks]) => {
      md += `**${game}**\n`;
      tasks.forEach(r => {
        const emoji = STATUS_EMOJI[r.status] || '⚪';
        const upd = (r.update||'').replace(/\n/g,' ').trim().slice(0,60) || '—';
        md += `　${emoji} ` + (r.link ? `[${r.task}](${r.link})` : r.task) + ` — ${upd}\n`;
      });
    });
    elements.push({ tag:'div', text:{ tag:'lark_md', content: md.trim() }});
    elements.push({ tag:'hr' });
  });
  elements.pop();
  elements.push({ tag:'note', elements:[{ tag:'plain_text', content:`数据来源：技术中台周进度报告 全部工作室·本周动态 | ${new Date().toLocaleDateString('zh-CN')} 自动推送` }]});

  return {
    config: { wide_screen_mode: true },
    header: { title: { tag:'plain_text', content:`📊 ${studio} · 本周动态（${weekLabel}）` }, template:'blue' },
    elements
  };
}

function buildPreviewCard(studioList, weekLabel) {
  const elements = [];
  elements.push({ tag:'div', text:{ tag:'lark_md', content:`以下内容将分别发送至 **${studioList.length}** 个工作室群，请逐个确认后点击发送。` }});
  elements.push({ tag:'hr' });

  studioList.forEach(({ studio, count, chat_id }) => {
    elements.push({
      tag: 'div',
      fields: [
        { is_short: true, text: { tag:'lark_md', content: `**${studio}**\n本周更新 ${count} 条` }},
        { is_short: true, text: { tag:'lark_md', content: ' ' }},
      ]
    });
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag:'plain_text', content: `发送至 ${studio} 群` },
        type: 'primary',
        value: { action:'send_weekly', studio, chat_id }
      }]
    });
    elements.push({ tag:'hr' });
  });
  elements.pop();

  return {
    config: { wide_screen_mode: true },
    header: { title: { tag:'plain_text', content:`📋 周报发送确认 （${weekLabel}）` }, template:'orange' },
    elements
  };
}

function larkSend(args) {
  const result = execSync(`lark-cli im +messages-send ${args}`, { encoding:'utf8', shell:'bash' });
  return JSON.parse(result);
}

// ─── 主流程 ──────────────────────────────────────────────
const html = fs.readFileSync(new URL('./index.html', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), 'utf8');
const m = html.match(/const ALL_DATA = (\[[\s\S]*?\]);/);
const ALL_DATA = JSON.parse(m[1]);

const { start, end, label: weekLabel } = getWeekRange();
const weekly = ALL_DATA.filter(r => inWeek(r.updateDate, start, end));

// 只处理机器人已加入且有数据的群
const targets = GROUPS.map(g => {
  const items = weekly.filter(r => r.studio === g.studio);
  return { ...g, items, count: items.length };
}).filter(g => g.count > 0);

if (!targets.length) {
  console.log('本周暂无数据，无需发送。');
  process.exit(0);
}

console.log(`\n📋 本周数据：${targets.map(t => `${t.studio}(${t.count}条)`).join(' · ')}`);

// 预热：把所有提单人的 open_id 一次性查回来缓存
prewarmUsers(targets.flatMap(t => t.items.map(r => r.submitter)));

console.log('🚀 正在发送预览至你的飞书...\n');

// 1. 给用户发每个工作室的预览卡片
targets.forEach(({ studio, items }) => {
  const card = buildStudioCard(studio, items, weekLabel);
  larkSend(`--user-id ${MY_OPEN_ID} --msg-type interactive --content ${JSON.stringify(JSON.stringify(card))} --as bot`);
  console.log(`  ✅ 预览已发送：${studio}`);
});

// 2. 发送确认操作卡片（带发送按钮）
const previewCard = buildPreviewCard(targets, weekLabel);
const previewMsg = larkSend(`--user-id ${MY_OPEN_ID} --msg-type interactive --content ${JSON.stringify(JSON.stringify(previewCard))} --as bot`);
console.log(`\n✅ 确认卡片已发送，等待你点击按钮...\n`);

// 3. 监听 card.action.trigger 事件
const sent = new Set();
const total = targets.length;

const listener = spawn('lark-cli event +subscribe --event-types card.action.trigger --compact --quiet --as bot', [], {
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

const rl = readline.createInterface({ input: listener.stdout });

listener.stderr.on('data', d => {
  const msg = d.toString().trim();
  if (msg) console.error('[event]', msg);
});

rl.on('line', line => {
  try {
    const event = JSON.parse(line);
    // card.action.trigger 的 value 在 action.value 或直接 value 字段
    const value = event?.action?.value || event?.value || {};
    if (value.action !== 'send_weekly') return;

    const { studio, chat_id } = value;
    if (!studio || !chat_id) return;
    if (sent.has(studio)) { console.log(`⚠️  ${studio} 已发送，跳过`); return; }

    const target = targets.find(t => t.studio === studio);
    if (!target) return;

    console.log(`📤 正在发送 → ${studio} 群...`);
    const card = buildStudioCard(studio, target.items, weekLabel);
    const r = larkSend(`--chat-id ${chat_id} --msg-type interactive --content ${JSON.stringify(JSON.stringify(card))} --as bot`);
    if (r.ok) {
      sent.add(studio);
      console.log(`  ✅ 发送成功：${studio}（${r.data.message_id}）`);
    } else {
      console.log(`  ❌ 发送失败：${studio}`);
    }

    if (sent.size >= total) {
      console.log('\n🎉 全部工作室已发送完成！');
      listener.kill();
      process.exit(0);
    }
  } catch(e) {
    // 忽略非 JSON 行
  }
});

listener.on('close', () => {
  if (sent.size < total) {
    const unsent = targets.filter(t => !sent.has(t.studio)).map(t => t.studio);
    console.log(`\n⚠️  监听已结束，以下群未发送：${unsent.join('、')}`);
  }
  process.exit(0);
});

// 10 分钟超时自动退出
setTimeout(() => {
  console.log('\n⏰ 超时（10分钟），自动退出。');
  listener.kill();
  process.exit(0);
}, 10 * 60 * 1000);

console.log('🔔 监听中... 请在飞书点击"发送至xxx群"按钮（10分钟内有效）\n');

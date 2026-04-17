/**
 * 周报飞书发送本地服务
 * 启动：node local_server.mjs
 * 监听 http://localhost:3891
 */
import { createServer } from 'http';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3891;

// 当前用户 open_id（接收预览消息）
const MY_OPEN_ID = 'ou_348e9babdc1075b1e4dc12dca7233662';

// 工作室 → 飞书群映射
const STUDIO_GROUPS = {
  '摘星工作室': [
    { name: '【摘星工作室】外部需求进度同步群（每周五更新）', chatId: 'oc_be292024db8ef99609e30c8a322a64af' },
    { name: '【摘星工作室】进度同步测试群',                  chatId: 'oc_927cc30fa1c0e1ca816f2c239f3850f1' },
  ],
  '不二工作室': [
    { name: '【不二工作室】外部需求进度同步群（每周五更新）', chatId: 'oc_63603eb5f299369f76ed487c57bcd62e' },
    { name: '【不二工作室】进度通知测试群',                  chatId: 'oc_0489d11402ca51c4cf814835b717629f' },
  ],
  'INJOY工作室': [
    { name: '【INJOY工作室】外部需求进度同步群（每周五更新）', chatId: 'oc_55078a69c6fc9ec91e9f054fcbdb0093' },
  ],
  '三重奏工作室': [
    { name: '【三重奏工作室】外部需求进度同步群（每周五更新）', chatId: 'oc_eee01fa98f25aa732d44b8b601f866ae' },
  ],
  '技术中台基建类需求': [
    { name: '【中台基建】外部需求进度同步群（每周五更新）', chatId: 'oc_f87631bc9fec63af453c4b4673baf2d5' },
  ],
  '用增需求': [
    { name: '【用户增长部】外部需求进度同步群（每周五更新）', chatId: 'oc_a6004fa9594efdf46d29a798b9126933' },
  ],
};

// 提单人姓名 → open_id 映射
const SUBMITTER_OPEN_IDS = {
  '聂小慧':        'ou_52c2139d2a1c4c3a903b054d6f86a92b',
  '卓奕敏':        'ou_38a6720c9354f9cb6fbbfc0fd31c7033',
  '陈洁':          'ou_254e5e30be7f350740d262f2d3d31e90',
  '孙乐':          'ou_04639a67c7ad81702d542070637c26c8',
  '郑龙':          'ou_240630b12d457a2e6d3ebc368a45393d',
  '李文政':        'ou_2cca5e9ad9c9914d6b70c225d08dab7a',
  '郑少鹏':        'ou_84e6b0ca3a0a446c9d28469a765f53f1',
  '曹鹏':          'ou_e4dc3c0620715790188fdff3d45f1b14',
  '郭婉菁':        'ou_04ec2d32ecfa2bb293d73dc18b12ea3f',
  '潘虹余':        'ou_8354222cc7c2c0eab9cc527831584ca6',
  '谢誉瑾':        'ou_52fe0a0a93dca27d05dc5bba1a6cf51d',
  '杨晓婕':        'ou_f216fec53be956068c8a15c400d8dfc7',
  '段旭':          'ou_946d6cf5a01f78a97846fb95f5b38d0b',
  '林庆钿':        'ou_03c6708f662fcef4a1fe0c31598220b4',
  '徐浩':          'ou_759c07867f05d38a5e65220e1acdbab3',
  '蔡宸浩':        'ou_95499a96023d8f9f5db5d4740a958c15',
  '林志伟':        'ou_8fd57c7f41c633cc423bab9a0638d84d',
  '范洁敏':        'ou_b5fd844d48029a2839e833f030d16bd4',
  '李宣敬':        'ou_ea4adb570b6cd63f93d1e637ff53fe36',
  '林联玮':        'ou_99df3ce4099211d9683db87e4793dc72',
  '朱力行':        'ou_c619c205a45c4c77e89efc1f8d71d801',
  '兔力-陈勉':     'ou_222c734386cb13d468e0d3b246cee6bb',
  '陈禄发':        'ou_7a577174165cb74ec64b5f9345dce98d',
  '小新-李楠（lin4）': 'ou_a9f13aec410387178a37737a01e1342b',
  '王俊杰':        'ou_d1ad31490147c277769f0d10203dbede',
  '刘宇航':        'ou_51222d58ad38eac803922cc17a46b003',
  '李逸欢':        'ou_fd419eabda2b2286231f1f56bf348c89',
  '曾文森':        'ou_7a9e72f955afa05550fdb010e0decffa',
  '刘阳':          'ou_256691b05115c751c579537e1e3c2a8e',
  '彭思源':        'ou_d7b4b3326d9f71e0bf4200c77eb28be0',
  '林雪':          'ou_5bb451a1a9b44aadef2878e2a47fdd29',
  '喻泽远':        'ou_a649d725d2f314163d244e5c96160ba5',
  '周明哲':        'ou_9bf72dbf13c496f3542624de1f348c84',
  '侯钦瀚':        'ou_31847658aba087cd1cf82a8e1a991432',
  '王哲':          'ou_e7f24b9ed07ad6d9082e0c0ec47a130c',
  '冯晓阳':        'ou_413d4fe9b253fa2621f802982da25c8e',
  '卓超':          'ou_9143b6f91c389c782db7859d60c4afc1',
  '张世鑫':        'ou_ad6c1d06615023b1c8d3d4222276c034',
  '彭鑫尧':        'ou_cd4da786b0ff0aab4842e9a881a1086a',
  '徐梓健':        'ou_7c228490ee7023be170d50e4fe27443f',
  '方涛':          'ou_e42f20043933ccc1aa0e35389e6d876b',
  '林丽娟':        'ou_09d90a230a8caf2e646241c326cafb14',
  '汪博':          'ou_b0a789ad8575a8e17e5c21653c812cfe',
  '温敏怡':        'ou_a0620d2d2b576a3b4521301be2d19f01',
  '王统军':        'ou_21d8676133579ceff0b22bbba205c518',
  '邱单娜':        'ou_e91042efa1917c4bc27651103448cfe7',
  '邹志鹏':        'ou_bb798ace5c5a2cd4b5dc6285776e4920',
  '钟超平':        'ou_6f1f044103fafe29721868f74d0ca19f',
  '钱智强':        'ou_ecd889d2d7e98155c74f5fc73c7ac35a',
  '高志威':        'ou_7aa5f6615e915626e9cad0896be8a5d7',
  '魏于博':        'ou_f55e40284e1a92f3f89a154cd9ea758a',
};

// 状态配置（顺序即排序优先级）
const STATUS_CATS = [
  { label: '已上线', statuses: ['已上线', '已完成'], icon: '🟢' },
  { label: '待上线', statuses: ['待上线'],           icon: '🔵' },
  { label: '进行中', statuses: ['进行中'],           icon: '🔷' },
  { label: '已排期', statuses: ['已排期'],           icon: '🟣' },
  { label: '已停滞', statuses: ['停滞', '已停滞'],   icon: '🔴' },
  { label: '已取消', statuses: ['已取消'],           icon: '⚫' },
];

function getCat(status) {
  return STATUS_CATS.find(c => c.statuses.includes(status)) || { label: status || '其他', icon: '⚪' };
}
function statusOrder(status) {
  const i = STATUS_CATS.findIndex(c => c.statuses.includes(status));
  return i === -1 ? 99 : i;
}

// ─── 构建飞书互动卡片 JSON ───────────────────────────────────────────────────
function buildCard(studioName, items, weekRange, today) {
  // 状态统计摘要
  const catCounts = {};
  items.forEach(r => {
    const cat = getCat(r.status);
    catCounts[cat.label] = (catCounts[cat.label] || 0) + 1;
  });
  const summaryLine = STATUS_CATS
    .filter(c => catCounts[c.label])
    .map(c => `${c.icon} ${c.label} ${catCounts[c.label]}条`)
    .join('    ');

  // 按提单人 → 游戏 分组
  const submitterMap = {};
  items.forEach(r => {
    const sub = r.submitter || '未知';
    if (!submitterMap[sub]) submitterMap[sub] = {};
    const game = r.game || '（未分类）';
    if (!submitterMap[sub][game]) submitterMap[sub][game] = [];
    submitterMap[sub][game].push(r);
  });
  // 每个游戏内按状态排序
  for (const sub of Object.keys(submitterMap)) {
    for (const game of Object.keys(submitterMap[sub])) {
      submitterMap[sub][game].sort((a, b) => statusOrder(a.status) - statusOrder(b.status));
    }
  }

  const elements = [];

  // 摘要块（无空行）
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: `本周共更新 **${items.length}** 条\n${summaryLine}` }
  });
  elements.push({ tag: 'hr' });

  // 提单人分组内容（每人之间加分隔线）
  const submitters = Object.entries(submitterMap);
  for (let i = 0; i < submitters.length; i++) {
    const [submitter, gameMap] = submitters[i];
    if (i > 0) elements.push({ tag: 'hr' });
    const openId = SUBMITTER_OPEN_IDS[submitter];
    const mentionText = openId
      ? `<at id="${openId}"></at>`
      : `@${submitter}`;
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: mentionText } });

    for (const [game, tasks] of Object.entries(gameMap)) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${game}**` } });

      const taskLines = tasks.map(t => {
        const cat = getCat(t.status);
        const rawName = t.task.trim().replace(/\s+/g, ' ');
        const update = (t.update || '—').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        const taskText = t.link ? `[${rawName}](${t.link})` : rawName;
        return `${cat.icon} ${taskText} — ${update}`;
      });
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: taskLines.join('\n') } });
    }
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'note',
    elements: [{
      tag: 'plain_text',
      content: `数据来源：技术中台周进度报告 全部工作室·本周动态 | ${today} 自动推送`
    }]
  });

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${studioName}·本周动态（${weekRange}）` },
      template: 'blue'
    },
    elements
  };
}

// ─── 调用 lark-cli 发送卡片 ──────────────────────────────────────────────────
function larkSend(target, cardJson, isUser = false) {
  return new Promise((resolve, reject) => {
    const tmpFile = join(__dirname, `.lark_tmp_${Date.now()}.json`);
    const bashPath = tmpFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
    writeFileSync(tmpFile, JSON.stringify(cardJson), 'utf8');

    const flag = isUser ? `--user-id "${target}"` : `--chat-id "${target}"`;
    const cmd = `lark-cli im +messages-send ${flag} --content "$(cat '${bashPath}')" --msg-type interactive --as bot`;

    let out = '', err = '';
    const proc = spawn('bash', ['-c', cmd]);
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      try { unlinkSync(tmpFile); } catch {}
      if (code === 0) {
        try { resolve(JSON.parse(out)); } catch { resolve({ raw: out }); }
      } else {
        reject(new Error((err + '\n' + out).trim() || `lark-cli exit ${code}`));
      }
    });
  });
}

// ─── HTTP 服务 ───────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
  'Content-Type': 'application/json',
};

function reply(res, data, status = 200) {
  res.writeHead(status, CORS);
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/api/ping') {
    return reply(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/groups') {
    return reply(res, { ok: true, data: STUDIO_GROUPS });
  }

  // /api/preview  → 发给自己（预览）
  if (req.method === 'POST' && url.pathname === '/api/preview') {
    const body = await readBody(req);
    const { studioName, items, weekRange, today } = body;
    if (!studioName || !items || !weekRange) {
      return reply(res, { ok: false, error: '缺少必要参数' }, 400);
    }
    try {
      const card = buildCard(studioName, items, weekRange, today);
      const result = await larkSend(MY_OPEN_ID, card, true);
      reply(res, { ok: true, result });
    } catch (e) {
      reply(res, { ok: false, error: e.message }, 500);
    }
    return;
  }

  // /api/send  → 发到群（正式）
  if (req.method === 'POST' && url.pathname === '/api/send') {
    const body = await readBody(req);
    const { studioName, items, weekRange, today, chatId } = body;
    if (!studioName || !items || !weekRange || !chatId) {
      return reply(res, { ok: false, error: '缺少必要参数' }, 400);
    }
    try {
      const card = buildCard(studioName, items, weekRange, today);
      const result = await larkSend(chatId, card, false);
      reply(res, { ok: true, result });
    } catch (e) {
      reply(res, { ok: false, error: e.message }, 500);
    }
    return;
  }

  reply(res, { ok: false, error: 'Not found' }, 404);
});

server.listen(PORT, () => {
  console.log(`\n📡  周报发送服务已启动：http://localhost:${PORT}`);
  console.log(`    打开 web app → 使用「发送周报」按钮（admin 可见）`);
  console.log(`    按 Ctrl+C 停止\n`);
});

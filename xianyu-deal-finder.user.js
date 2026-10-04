// ==UserScript==
// @name         闲鱼好价分析助手
// @namespace    https://github.com/5huji/xianyu-deal-finder
// @version      1.3.0
// @description  在闲鱼搜索页一键分析：过滤求购、单只补配、钓鱼价等无效商品，输出最低价 Top10 与性价比推荐
// @author       5huji
// @match        https://www.goofish.com/search*
// @match        https://goofish.com/search*
// @grant        none
// @run-at       document-start
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/5huji/xianyu-deal-finder/main/xianyu-deal-finder.user.js
// @downloadURL  https://raw.githubusercontent.com/5huji/xianyu-deal-finder/main/xianyu-deal-finder.user.js
// ==/UserScript==

/*
 * 闲鱼好价分析助手 v1.3.0
 * 在闲鱼网页版搜索页运行：自动滚动加载多页搜索结果，过滤无效商品，
 * 输出「价格最低 Top10」与「性价比 Top5」，附推荐理由与直达链接。
 * 纯本地运行，不上传任何数据。
 */

(function () {
  'use strict';

  /* ================= 1. 网络拦截：捕获闲鱼搜索接口的结构化数据 ================= */
  const apiItems = new Map(); // id -> {id,title,price,url,image,seller,source}

  function findItems(obj, out) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach((v) => findItems(v, out)); return; }
    const itemId = obj.itemId || obj.item_id;
    const title = obj.title || obj.itemTitle;
    const price = obj.price || obj.soldPrice || obj.currentPrice;
    if (itemId && title && price != null) {
      const p = parseFloat(String(price).replace(/[¥￥,]/g, '').trim());
      if (!isNaN(p) && p > 0 && !out.has(String(itemId))) {
        out.set(String(itemId), {
          id: String(itemId),
          title: String(title).trim(),
          price: p,
          url: 'https://www.goofish.com/item?id=' + itemId,
          image: obj.picUrl || obj.imgUrl || obj.image || '',
          seller: obj.sellerNick || obj.nick || '',
          source: 'api',
        });
      }
    }
    Object.values(obj).forEach((v) => findItems(v, out));
  }

  function hookNetwork() {
    const isIdleApi = (u) => typeof u === 'string' && u.indexOf('mtop') > -1 && u.indexOf('idle') > -1;
    try {
      const origFetch = window.fetch;
      window.fetch = function () {
        const args = arguments;
        const u = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
        return origFetch.apply(this, args).then((res) => {
          if (isIdleApi(u)) {
            res.clone().json().then((d) => findItems(d, apiItems)).catch(() => {});
          }
          return res;
        });
      };
    } catch (e) { /* ignore */ }
    try {
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        this._xyUrl = url;
        return origOpen.apply(this, arguments);
      };
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function () {
        this.addEventListener('load', function () {
          try {
            if (isIdleApi(this._xyUrl) && this.responseText) {
              findItems(JSON.parse(this.responseText), apiItems);
            }
          } catch (e) { /* ignore */ }
        });
        return origSend.apply(this, arguments);
      };
    } catch (e) { /* ignore */ }
  }
  hookNetwork();

  /* ================= 2. DOM 兜底抓取 ================= */
  // 找到商品链接所属的最小单品卡片：往上爬，直到祖先里恰好只包含这一个商品链接
  function cardOf(a) {
    let node = a, card = a;
    while (node.parentElement && node.parentElement !== document.body) {
      node = node.parentElement;
      let n = 0;
      try { n = node.querySelectorAll('a[href*="/item?id="]').length; } catch (e) { break; }
      if (n === 1) { card = node; } else { break; }
    }
    return card;
  }

  function collectDomItems() {
    const out = new Map();
    document.querySelectorAll('a[href*="/item?id="]').forEach((a) => {
      const m = a.href.match(/id=(\d+)/);
      if (!m) return;
      const id = m[1];
      const el = cardOf(a);
      const text = (el.innerText || '').replace(/\n{2,}/g, '\n');
      const pm = text.match(/¥\s*([\d,]+(?:\.\d+)?)/);
      if (!pm) return;
      const price = parseFloat(pm[1].replace(/,/g, ''));
      if (!(price > 0)) return;
      const lines = text.split('\n').map((s) => s.trim()).filter((s) => s && s.indexOf('¥') === -1);
      lines.sort((x, y) => y.length - x.length);
      const title = lines[0] || '';
      if (!title) return;
      const img = el.querySelector('img');
      out.set(id, {
        id: id,
        title: title,
        price: price,
        url: 'https://www.goofish.com/item?id=' + id,
        image: img ? (img.src || img.getAttribute('data-src') || '') : '',
        seller: '',
        source: 'dom',
      });
    });
    return out;
  }

  /* ================= 3. 分析逻辑 ================= */
  const BLOCKLIST = ['求购', '高价收', '回收', '出租', '租赁', '拼单', '换物', '互换',
    '免费送', '领养', '赠送', '单只', '补配', '单耳'];
  const OTHER_BRANDS = ['soundcore', '华为', 'huawei', '小米', 'xiaomi', '三星', 'samsung',
    'bose', '索尼', 'sony', 'vivo', 'oppo', '一加', 'oneplus', '联想', 'lenovo',
    '森海', 'sennheiser', '罗技', 'logi', '漫步者', 'edifier', 'jbl', 'beats',
    '荣耀', 'honor', '红米', 'redmi', '魅族', 'meizu', 'sanag', '塞那', 'ikf'];
  const CONDITION_RULES = [
    [['全新未拆', '未拆封', '全新未激活', '全新国行'], 1.3, '全新未拆封'],
    [['几乎全新', '箱说齐全', '箱说全', '充新', '99新', '仅拆封'], 1.2, '接近全新'],
    [['九成新', '9成新', '9.5成新', '95新'], 1.15, '九成新'],
    [['八成新', '8成新', '85新'], 1.0, '八成新'],
    [['使用痕迹', '有划痕', '小瑕疵', '有瑕疵', '边角磨损'], 0.9, '有使用痕迹'],
    [['维修', '换屏', '换电池', '拆修', '进水'], 0.7, '有维修史'],
  ];

  function fmtPrice(n) { return (n % 1 === 0) ? String(n) : n.toFixed(2); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function analyze(items, keyword) {
    const models = (keyword.match(/[A-Za-z0-9][A-Za-z0-9\-_]{2,}/g) || []).map((s) => s.toLowerCase());
    const cjk = (keyword.match(/[\u4e00-\u9fff]+/g) || []).join('');
    const extraBlock = [];
    if (/降噪/.test(keyword)) extraBlock.push('普通款', '普通版', '非降噪', '不带降噪', '无降噪');

    const stats = { irrelevant: 0, blocked: 0, bait: 0 };
    const valid = [];
    const seenUrl = new Set();

    // 归一化：价格转数字、标题兼容 title/name 字段
    const norm = [];
    for (const p of items) {
      const price = Number(p.price) || 0;
      const title = p.title || p.name || '';
      if (price > 0 && title) {
        norm.push({
          title: title, price: price, url: p.url || '',
          image: p.image || '', seller: p.seller || p.brand || '',
        });
      }
    }

    for (const p of norm) {
      if (!p.url || seenUrl.has(p.url)) continue;
      seenUrl.add(p.url);
      const title = p.title;
      if (BLOCKLIST.some((w) => title.indexOf(w) > -1) || extraBlock.some((w) => title.indexOf(w) > -1)) {
        stats.blocked++; continue;
      }
      const tl = title.toLowerCase();
      if (OTHER_BRANDS.some((b) => tl.indexOf(b) > -1) && tl.indexOf('airpod') === -1 && title.indexOf('苹果') === -1) {
        stats.irrelevant++; continue;
      }
      let rel = 0;
      if (models.length && models.some((m) => tl.indexOf(m) > -1)) rel = 1;
      else if (cjk) {
        let hit = 0;
        for (const ch of cjk) if (title.indexOf(ch) > -1) hit++;
        rel = hit / cjk.length;
      }
      if (rel < 0.6) { stats.irrelevant++; continue; }
      valid.push(p);
    }

    if (!valid.length) {
      return { total: items.length, valid: 0, median: 0, filters: stats, cheapest: [], best: [] };
    }
    const prices = valid.map((v) => v.price).sort((a, b) => a - b);
    const median = prices.length % 2
      ? prices[(prices.length - 1) / 2]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
    const baitLine = median * 0.03;
    const pool = valid.filter((v) => v.price >= baitLine);
    stats.bait = valid.length - pool.length;
    const use = pool.length ? pool : valid;

    for (const v of use) {
      const vTitle = v.title || v.name || '';
      let cw = 1, cl = '成色未注明';
      for (const rule of CONDITION_RULES) {
        if (rule[0].some((k) => vTitle.indexOf(k) > -1)) { cw = rule[1]; cl = rule[2]; break; }
      }
      const pct = ((median - v.price) / median) * 100;
      const reasons = [];
      reasons.push(pct > 0
        ? '¥' + fmtPrice(v.price) + '，比同类中位价¥' + fmtPrice(median) + '低' + pct.toFixed(1) + '%'
        : '¥' + fmtPrice(v.price) + '（同类中位价¥' + fmtPrice(median) + '）');
      reasons.push('成色：' + cl);
      v._reasons = reasons;
      v._score = (median / v.price) * cw;
    }
    const cheapest = use.slice().sort((a, b) => a.price - b.price).slice(0, 10);
    const best = use.slice().sort((a, b) => b._score - a._score).slice(0, 5);
    return { total: items.length, valid: use.length, median: median, filters: stats, cheapest: cheapest, best: best };
  }

  /* ================= 4. 界面 ================= */
  const CSS = [
    '#xy-deal-btn{position:fixed;right:16px;bottom:170px;z-index:999999;background:#ff6a00;color:#fff;',
    'border:none;border-radius:24px;padding:12px 18px;font-size:14px;cursor:pointer;',
    'box-shadow:0 4px 14px rgba(0,0,0,.25);font-family:inherit;white-space:nowrap;',
    'animation:xyPulse 1.2s ease-in-out 3;}',
    '#xy-deal-btn:hover{background:#e55e00;}',
    '@keyframes xyPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}',
    '@media (max-width:640px){#xy-deal-btn{padding:16px 22px;font-size:16px;}}',
    '#xy-deal-panel{position:fixed;top:0;right:0;width:460px;max-width:94vw;height:100vh;z-index:1000000;',
    'background:#fff;box-shadow:-4px 0 18px rgba(0,0,0,.18);display:flex;flex-direction:column;',
    'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#222;}',
    '#xy-deal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;',
    'border-bottom:1px solid #eee;}',
    '#xy-deal-head h3{margin:0;font-size:16px;}',
    '#xy-deal-close{border:none;background:#f2f2f2;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px;}',
    '#xy-deal-body{flex:1;overflow-y:auto;padding:14px 16px;}',
    '#xy-deal-log{background:#f7f8fa;border-radius:8px;padding:10px 12px;font-size:12px;color:#666;margin-bottom:12px;}',
    '.xy-sec{margin-bottom:14px;}',
    '.xy-sec h4{margin:0 0 8px;font-size:14px;}',
    '.xy-stats{font-size:13px;color:#555;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;}',
    '.xy-stats b{color:#c2410c;}',
    '.xy-item{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f0f0f0;}',
    '.xy-item img{width:64px;height:64px;object-fit:cover;border-radius:8px;background:#f5f5f5;flex-shrink:0;}',
    '.xy-item .xy-info{flex:1;min-width:0;}',
    '.xy-item .xy-title{font-size:13px;line-height:1.45;display:block;color:#222;text-decoration:none;',
    'overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}',
    '.xy-item .xy-title:hover{color:#ff6a00;}',
    '.xy-item .xy-price{color:#e4393c;font-weight:bold;font-size:15px;margin-top:4px;}',
    '.xy-item .xy-reason{font-size:12px;color:#888;margin-top:2px;}',
    '.xy-rank{display:inline-block;min-width:20px;height:20px;line-height:20px;text-align:center;',
    'background:#ff6a00;color:#fff;border-radius:10px;font-size:12px;margin-right:6px;padding:0 4px;}',
    '.xy-foot{padding:10px 16px;border-top:1px solid #eee;font-size:11px;color:#aaa;}',
    '.xy-risk{font-size:12px;margin-top:4px;padding:5px 8px;border-radius:6px;line-height:1.5;}',
    '.xy-risk.high{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;}',
    '.xy-risk.med{background:#fffbeb;color:#b45309;border:1px solid #fde68a;}',
    '.xy-trust{font-size:12px;margin-top:3px;color:#15803d;}',
    '#xy-verify-btn{display:block;width:100%;margin:2px 0 10px;padding:12px;border:none;border-radius:10px;',
    'background:#16a34a;color:#fff;font-size:14px;cursor:pointer;font-family:inherit;}',
    '#xy-verify-btn:disabled{background:#9ca3af;cursor:default;}',
  ].join('\n');

  let panelEl = null, btnEl = null;

  function ensureUI() {
    if (document.getElementById('xy-deal-btn')) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    btnEl = document.createElement('button');
    btnEl.id = 'xy-deal-btn';
    btnEl.textContent = '🔍 好价分析';
    btnEl.addEventListener('click', runAnalysis);
    document.body.appendChild(btnEl);
  }

  function showPanel() {
    if (panelEl) { panelEl.style.display = 'flex'; return; }
    panelEl = document.createElement('div');
    panelEl.id = 'xy-deal-panel';
    panelEl.style.display = 'flex';
    panelEl.innerHTML =
      '<div id="xy-deal-head"><h3>🐟 闲鱼好价分析</h3>' +
      '<button id="xy-deal-close" title="关闭">✕</button></div>' +
      '<div id="xy-deal-body"></div>' +
      '<div class="xy-foot">纯本地分析，不上传数据 · 价格为抓取时刻快照，下单前请核对详情页</div>';
    document.body.appendChild(panelEl);
    panelEl.querySelector('#xy-deal-close').addEventListener('click', () => {
      panelEl.style.display = 'none';
    });
  }

  function setLog(html) {
    const body = panelEl.querySelector('#xy-deal-body');
    let log = panelEl.querySelector('#xy-deal-log');
    if (!log) {
      body.innerHTML = '<div id="xy-deal-log"></div><div id="xy-deal-result"></div>';
      log = panelEl.querySelector('#xy-deal-log');
    }
    log.innerHTML = html;
  }

  function itemHTML(v, i) {
    const img = v.image ? '<img src="' + esc(v.image) + '" loading="lazy" onerror="this.style.display=\'none\'">' : '';
    let extra = '';
    const vf = v._verify;
    if (vf && !vf.error) {
      (vf.risks || []).forEach((rk) => {
        extra += '<div class="xy-risk ' + (rk.level === 'high' ? 'high' : 'med') + '">' +
          (rk.level === 'high' ? '🚫 ' : '⚠️ ') + esc(rk.text) + '</div>';
      });
      if (vf.trust && vf.trust.length) {
        extra += '<div class="xy-trust">✅ ' + esc(vf.trust.join(' · ')) + '</div>';
      }
      const bits = [];
      if (vf.want != null) bits.push(vf.want + '人想要');
      if (vf.credit) bits.push('芝麻信用' + vf.credit);
      if (vf.publishAgo) bits.push(vf.publishAgo + '发布');
      if (bits.length) extra += '<div class="xy-reason">📋 ' + esc(bits.join(' · ')) + '</div>';
    } else if (vf && vf.error) {
      extra += '<div class="xy-reason">（详情核验失败，请手动点进去看）</div>';
    }
    return '<div class="xy-item"><span class="xy-rank">' + (i + 1) + '</span>' + img +
      '<div class="xy-info"><a class="xy-title" href="' + esc(v.url) + '" target="_blank" rel="noopener">' +
      esc(v.title) + '</a><div class="xy-price">¥' + fmtPrice(v.price) + '</div>' +
      '<div class="xy-reason">' + esc(v._reasons.join('；')) + '</div>' + extra + '</div></div>';
  }

  let lastResult = null, lastKeyword = '', verifyDone = false;
  function renderResult(r, keyword) {
    lastResult = r; lastKeyword = keyword;
    const box = panelEl.querySelector('#xy-deal-result');
    if (!r.valid) {
      box.innerHTML = '<div class="xy-sec"><div class="xy-stats">共抓取 ' + r.total +
        ' 条，没有符合 "' + esc(keyword) + '" 的有效商品。换个关键词试试。</div></div>';
      return;
    }
    let h = '<div class="xy-sec"><div class="xy-stats">关键词 <b>' + esc(keyword) + '</b> · 共抓取 ' +
      r.total + ' 条 · 有效 <b>' + r.valid + '</b> 条 · 中位价 <b>¥' + fmtPrice(r.median) + '</b><br>' +
      '已过滤：求购/补配 ' + r.filters.blocked + ' · 无关 ' + r.filters.irrelevant +
      ' · 疑似钓鱼价 ' + r.filters.bait + '</div></div>';
    h += '<div class="xy-sec"><button id="xy-verify-btn"' + (verifyDone ? ' disabled' : '') + '>' +
      (verifyDone ? '✅ 已核验 Top 候选' : '🛡️ 核验 Top 候选详情页（约需1分钟）') + '</button>' +
      '<div class="xy-reason" style="margin-bottom:6px">逐个打开候选商品详情，核验价格一致性、想要人数、卖家信用并标记风险。</div></div>';
    h += '<div class="xy-sec"><h4>💰 价格最低 Top10</h4>' +
      r.cheapest.map((v, i) => itemHTML(v, i)).join('') + '</div>';
    h += '<div class="xy-sec"><h4>✨ 性价比 Top5</h4>' +
      r.best.map((v, i) => itemHTML(v, i)).join('') + '</div>';
    box.innerHTML = h;
    const vb = panelEl.querySelector('#xy-verify-btn');
    if (vb && !verifyDone) vb.addEventListener('click', startVerify);
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // 单次收集：DOM + 已拦截到的接口数据，返回新增条数
  function collectOnce(seen) {
    let added = 0;
    collectDomItems().forEach((v, k) => { if (!seen.has(k)) { seen.add(k); added++; } });
    apiItems.forEach((v, k) => { if (!seen.has(k)) { seen.add(k); added++; } });
    return added;
  }

  // 找分页器的"下一页"按钮（桌面版式）。找不到返回 null。
  function findNextPage() {
    const els = document.querySelectorAll('a,button');
    for (const el of els) {
      if (!el.offsetParent) continue; // 不可见
      const t = (el.textContent || '').trim();
      if (t !== '下一页' && t !== '>') continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const cls = (el.className || '').toString();
      if (/disabl/i.test(cls)) continue;
      const ptxt = el.parentElement ? (el.parentElement.textContent || '') : '';
      if (!/\d\D+\d/.test(ptxt)) continue; // 父容器里至少有两个被隔开的数字才是分页器
      return el;
    }
    return null;
  }

  let running = false;
  let verifying = false;

  /* ================= 5. 详情页核验 ================= */
  // 从详情页文本提取信任信号（用文本模式匹配，不依赖具体 DOM 结构）
  function extractSignals(text, v) {
    const info = { risks: [], trust: [] };
    let m;
    m = text.match(/(\d+)\s*人想要/);
    info.want = m ? parseInt(m[1], 10) : null;
    m = text.match(/(\d+)\s*(天|小时|分钟)前发布/) || text.match(/发布于?\s*(\d+)\s*(天|小时|分钟)前/);
    info.publishAgo = m ? m[1] + m[2] : null;
    m = text.match(/芝麻信用[：:\s]*([极好优秀良好中等较差]{2})/);
    info.credit = m ? m[1] : null;
    info.realNamed = /已实名|实名认证/.test(text);
    m = text.match(/¥\s*([\d,]+(?:\.\d+)?)/);
    info.detailPrice = m ? parseFloat(m[1].replace(/,/g, '')) : null;
    if (info.detailPrice != null && Math.abs(info.detailPrice - v.price) > 0.01) {
      info.risks.push({ level: 'high',
        text: '点进详情价格变了（列表¥' + fmtPrice(v.price) + '，详情¥' + fmtPrice(info.detailPrice) + '），疑似引流价' });
    }
    if (/(微信号|QQ号|加微信|加QQ|微信交易|线下付款|脱离平台)/i.test(text)) {
      info.risks.push({ level: 'high', text: '详情含站外交易关键词，谨防诈骗，务必走平台付款' });
    }
    return info;
  }

  // 结合中位价做风险评级
  function riskLevel(v, info, median) {
    if (info.error) return info;
    if (median > 0 && v.price < median * 0.5 && (info.want == null || info.want < 10)) {
      info.risks.push({ level: 'med',
        text: '价格仅为中位价的' + Math.round(v.price / median * 100) + '%，且' +
              (info.want == null ? '暂无想要人数' : '仅' + info.want + '人想要') + '，下手前请仔细甄别' });
    }
    if (info.want != null && info.want >= 50) info.trust.push(info.want + '人想要');
    if (info.credit && /极好|优秀/.test(info.credit)) info.trust.push('芝麻信用' + info.credit);
    if (info.realNamed) info.trust.push('卖家已实名');
    return info;
  }

  // 在隐藏的同源 iframe 里打开详情页，读取渲染后的文本
  function verifyOne(v) {
    return new Promise((resolve) => {
      const idm = (v.url || '').match(/id=(\d+)/);
      if (!idm) { resolve({ error: true, risks: [], trust: [] }); return; }
      const iframe = document.createElement('iframe');
      // 沙箱：允许脚本与同源访问，但禁止跳出顶层页面
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;visibility:hidden;';
      let done = false;
      const finish = (info) => {
        if (done) return; done = true;
        try { iframe.remove(); } catch (e) {}
        resolve(info);
      };
      const timer = setTimeout(() => finish({ error: true, risks: [], trust: [] }), 25000);
      iframe.onload = () => {
        setTimeout(() => {
          clearTimeout(timer);
          try {
            const doc = iframe.contentDocument;
            const text = doc && doc.body ? (doc.body.innerText || '') : '';
            if (!text) { finish({ error: true, risks: [], trust: [] }); return; }
            finish(extractSignals(text, v));
          } catch (e) { finish({ error: true, risks: [], trust: [] }); }
        }, 3000); // 等 SPA 渲染
      };
      iframe.onerror = () => { clearTimeout(timer); finish({ error: true, risks: [], trust: [] }); };
      iframe.src = 'https://www.goofish.com/item?id=' + idm[1];
      document.body.appendChild(iframe);
    });
  }

  async function startVerify() {
    if (verifying || !lastResult || !lastResult.valid) return;
    verifying = true;
    verifyDone = false;
    const btn = panelEl.querySelector('#xy-verify-btn');
    if (btn) { btn.disabled = true; btn.textContent = '核验中，请稍候…'; }
    // 候选：去重合并 Top10 + Top5，上限 12 个
    const seenU = new Set(), cands = [];
    lastResult.cheapest.concat(lastResult.best).forEach((v) => {
      if (v.url && !seenU.has(v.url) && cands.length < 12) { seenU.add(v.url); cands.push(v); }
    });
    setLog('🛡️ 正在逐个核验 ' + cands.length + ' 个候选商品的详情页，请稍候…');
    let i = 0;
    for (const v of cands) {
      i++;
      setLog('🛡️ 核验中 ' + i + '/' + cands.length + '：' + esc(v.title.slice(0, 18)) + '…');
      try {
        v._verify = riskLevel(v, await verifyOne(v), lastResult.median);
      } catch (e) {
        v._verify = { error: true, risks: [], trust: [] };
      }
      await sleep(1500); // 降低访问频率
    }
    verifyDone = true;
    setLog('核验完成 ✅（' + cands.length + ' 个候选，风险标记已更新到列表中）');
    renderResult(lastResult, lastKeyword);
    verifying = false;
  }
  async function runAnalysis() {
    if (running) return;
    running = true;
    verifyDone = false;
    try {
      showPanel();
      const bodyText = document.body.innerText || '';
      if (/扫码登录/.test(bodyText) && document.querySelector('[class*="login"]')) {
        setLog('⚠️ 检测到登录弹窗，请先完成闲鱼登录后再点「好价分析」。');
        running = false;
        return;
      }
      apiItems.clear();
      const seen = new Set();
      collectOnce(seen);
      setLog('开始抓取…已抓取 ' + seen.size + ' 条');

      if (findNextPage()) {
        // 桌面版式：点翻页，最多抓 8 页
        setLog('检测到翻页条，正在逐页抓取…');
        let noNew = 0;
        for (let p = 0; p < 7; p++) {
          const btn = findNextPage();
          if (!btn) break;
          btn.click();
          await sleep(3200); // 等新一页的接口返回
          const added = collectOnce(seen);
          setLog('正在抓取第 ' + (p + 2) + ' 页…已抓取 ' + seen.size + ' 条');
          if (added === 0) { noNew++; if (noNew >= 2) break; } else { noNew = 0; }
        }
      } else {
        // 移动版式：自动滚动加载
        setLog('自动滚动加载搜索结果…');
        let noNew = 0;
        const ROUNDS = 8;
        for (let i = 0; i < ROUNDS; i++) {
          window.scrollTo(0, document.body.scrollHeight);
          await sleep(2200);
          const added = collectOnce(seen);
          setLog('正在加载…已抓取 ' + seen.size + ' 条');
          if (added === 0) { noNew++; if (noNew >= 2) break; } else { noNew = 0; }
        }
      }
      setLog('抓取完成，共 ' + seen.size + ' 条，正在分析…');
      await sleep(300);
      const merged = new Map();
      collectDomItems().forEach((v, k) => merged.set(k, v));
      apiItems.forEach((v, k) => merged.set(k, v)); // 接口数据优先
      const keyword = new URLSearchParams(location.search).get('q') || '';
      const r = analyze(Array.from(merged.values()), keyword);
      setLog('分析完成 ✅（数据为当前页面快照）');
      renderResult(r, keyword);
    } catch (e) {
      setLog('出错了：' + esc(e.message || e));
    }
    running = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUI);
  } else {
    ensureUI();
  }
})();

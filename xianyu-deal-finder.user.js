// ==UserScript==
// @name         闲鱼好价分析助手
// @namespace    https://github.com/5huji/xianyu-deal-finder
// @version      1.0.0
// @description  在闲鱼搜索页一键分析：过滤求购、单只补配、钓鱼价等无效商品，输出最低价 Top10 与性价比推荐
// @author       5huji
// @match        https://www.goofish.com/search*
// @grant        none
// @run-at       document-start
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/5huji/xianyu-deal-finder/main/xianyu-deal-finder.user.js
// @downloadURL  https://raw.githubusercontent.com/5huji/xianyu-deal-finder/main/xianyu-deal-finder.user.js
// ==/UserScript==

/*
 * 闲鱼好价分析助手 v1.0.0
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
  function collectDomItems() {
    const out = new Map();
    document.querySelectorAll('a[href*="/item?id="]').forEach((a) => {
      const m = a.href.match(/id=(\d+)/);
      if (!m) return;
      const id = m[1];
      let el = a;
      for (let i = 0; i < 5 && el.parentElement; i++) el = el.parentElement;
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
    '#xy-deal-btn{position:fixed;right:18px;bottom:90px;z-index:999999;background:#ff6a00;color:#fff;',
    'border:none;border-radius:24px;padding:12px 18px;font-size:14px;cursor:pointer;',
    'box-shadow:0 4px 14px rgba(0,0,0,.25);font-family:inherit;}',
    '#xy-deal-btn:hover{background:#e55e00;}',
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
    return '<div class="xy-item"><span class="xy-rank">' + (i + 1) + '</span>' + img +
      '<div class="xy-info"><a class="xy-title" href="' + esc(v.url) + '" target="_blank" rel="noopener">' +
      esc(v.title) + '</a><div class="xy-price">¥' + fmtPrice(v.price) + '</div>' +
      '<div class="xy-reason">' + esc(v._reasons.join('；')) + '</div></div></div>';
  }

  function renderResult(r, keyword) {
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
    h += '<div class="xy-sec"><h4>💰 价格最低 Top10</h4>' +
      r.cheapest.map((v, i) => itemHTML(v, i)).join('') + '</div>';
    h += '<div class="xy-sec"><h4>✨ 性价比 Top5</h4>' +
      r.best.map((v, i) => itemHTML(v, i)).join('') + '</div>';
    box.innerHTML = h;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  let running = false;
  async function runAnalysis() {
    if (running) return;
    running = true;
    try {
      showPanel();
      const bodyText = document.body.innerText || '';
      if (/扫码登录/.test(bodyText) && document.querySelector('[class*="login"]')) {
        setLog('⚠️ 检测到登录弹窗，请先完成闲鱼登录后再点「好价分析」。');
        running = false;
        return;
      }
      apiItems.clear();
      setLog('开始抓取：自动滚动加载搜索结果…');
      const seen = new Set();
      let noNew = 0;
      const ROUNDS = 8;
      for (let i = 0; i < ROUNDS; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(2200);
        let added = 0;
        collectDomItems().forEach((v, k) => { if (!seen.has(k)) { seen.add(k); added++; } });
        apiItems.forEach((v, k) => { if (!seen.has(k)) { seen.add(k); added++; } });
        setLog('正在加载第 ' + (i + 1) + '/' + ROUNDS + ' 页…已抓取 ' + seen.size + ' 条');
        if (added === 0) { noNew++; if (noNew >= 2) break; } else { noNew = 0; }
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

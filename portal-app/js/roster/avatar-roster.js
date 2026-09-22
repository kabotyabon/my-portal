/**
 * AvatarRoster — Perxona アバター一覧（avatars.html）
 *
 * Connect API の GET /assets/avatars を Publishable Key で取得し、
 * 5 秒ごとに順番に表示する。「このアバターを使う」で PerxonaConfig に Avatar ID を保存する。
 * ※ Publishable Key の Allowed Domains に登録済みのドメインから開く必要がある。
 */
const ROSTER_INTERVAL_MS = 5000;

(function () {
  const $ = (id) => document.getElementById(id);
  const state = { items: [], index: 0, playing: true, startedAt: 0 };

  async function fetchAllAvatars(key) {
    const base = `https://console.perxona.ai/${PerxonaConfig.REGION}/api/v1/connect/assets/avatars`;
    const items = [];
    let page = 1, pages = 1;
    do {
      const res = await fetch(`${base}?page=${page}&size=100`, { headers: { 'X-Connect-Key': key } });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).details || ''; } catch (e) { /* 本文なし */ }
        throw new Error(`HTTP ${res.status} ${detail}`.trim());
      }
      const json = await res.json();
      pages = json.pages || 1;
      json.items.forEach((a) => {
        const t = a.thumbnail_urls || {};
        items.push({ id: a.avatar_id, name: a.name, img: t.upper_body || t.default || t.full_body || '' });
      });
      page++;
    } while (page <= pages);
    return items;
  }

  function show(i) {
    const n = state.items.length;
    state.index = (i + n) % n;
    const a = state.items[state.index];
    const current = PerxonaConfig.getAvatarId();
    $('roster-img').src = a.img;
    $('roster-img').alt = a.name;
    $('roster-cur').textContent = state.index + 1;
    $('roster-name').textContent = a.name;
    $('roster-id').value = a.id;

    const tags = [];
    if (/female/i.test(a.name)) tags.push('<span class="roster-tag">女性</span>');
    else if (/male/i.test(a.name)) tags.push('<span class="roster-tag">男性</span>');
    if (a.id === current) tags.push('<span class="roster-tag live">アプリで使用中</span>');
    $('roster-tags').innerHTML = tags.join('');

    [...$('roster-grid').children].forEach((el, k) => {
      if (k === state.index) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });
  }

  function restartTimer() {
    state.startedAt = performance.now();
    $('roster-prog').style.width = '0%';
  }

  function go(delta) {
    show(state.index + delta);
    $('roster-msg').textContent = '';
    restartTimer();
  }

  function tick(now) {
    if (state.playing) {
      const p = (now - state.startedAt) / ROSTER_INTERVAL_MS;
      if (p >= 1) { show(state.index + 1); restartTimer(); }
      else $('roster-prog').style.width = `${(p * 100).toFixed(1)}%`;
    }
    requestAnimationFrame(tick);
  }

  function togglePlay() {
    state.playing = !state.playing;
    $('roster-play').textContent = state.playing ? '⏸ 一時停止' : '▶ 再生';
    restartTimer();
  }

  async function copyId() {
    const id = state.items[state.index].id;
    let ok = false;
    try { await navigator.clipboard.writeText(id); ok = true; } catch (e) { /* フォールバックへ */ }
    if (!ok) { $('roster-id').select(); try { ok = document.execCommand('copy'); } catch (e) { /* 手動コピー */ } }
    $('roster-msg').textContent = ok ? `コピーしました: ${id}` : '上の欄を選択して手動でコピーしてください';
  }

  function useAvatar() {
    const a = state.items[state.index];
    PerxonaConfig.setAvatarId(a.id);
    show(state.index);
    [...$('roster-grid').children].forEach((el, k) => el.classList.toggle('live', state.items[k].id === a.id));
    $('roster-msg').textContent = `${a.name} を設定しました。ポータルに戻ると反映されます。`;
  }

  function buildGrid() {
    const current = PerxonaConfig.getAvatarId();
    const grid = $('roster-grid');
    state.items.forEach((a, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'roster-th' + (a.id === current ? ' live' : '');
      b.setAttribute('aria-label', a.name);
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = a.img;
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(k + 1).padStart(2, '0');
      b.append(img, n);
      b.addEventListener('click', () => go(k - state.index));
      grid.appendChild(b);
    });
  }

  async function init() {
    const status = $('roster-status');
    const key = PerxonaConfig.getKey();
    if (!key) {
      status.className = 'roster-status error';
      status.textContent = 'ポータルの設定画面で Perxona Publishable Key を設定してください。';
      return;
    }
    try {
      state.items = await fetchAllAvatars(key);
    } catch (e) {
      status.className = 'roster-status error';
      status.textContent = `アバター一覧を取得できません（${e.message}）。Key と Allowed Domains（このページのドメイン）を確認してください。`;
      return;
    }
    if (!state.items.length) {
      status.textContent = '利用できるアバターがありません。';
      return;
    }
    status.hidden = true;
    $('roster-count').textContent = `${state.items.length} 体`;
    $('roster-tot').textContent = state.items.length;
    $('roster-viewer').hidden = false;
    buildGrid();

    $('roster-prev').onclick = () => go(-1);
    $('roster-next').onclick = () => go(1);
    $('roster-play').onclick = togglePlay;
    $('roster-copy').onclick = copyId;
    $('roster-use').onclick = useAvatar;
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); }
    });

    show(0);
    restartTimer();
    requestAnimationFrame(tick);
  }

  init();
})();

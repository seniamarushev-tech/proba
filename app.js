import { getSupabase } from "./supabaseClient.js";
import { getTelegramUser, haptic } from "./telegram.js";

let supabase;
const cfg = window.TRUST_CONFIG;

const elMain = document.getElementById("main");
const elRole = document.getElementById("pillRole");
const elStars = document.getElementById("pillStars");
const elToast = document.getElementById("toast");
const elModal = document.getElementById("modal");
const elSheet = document.getElementById("sheet");

let me = null;       // row from users
let myArtist = null; // row from artists if role=artist
let currentTab = "trust";
let cachedArtists = [];

function toast(msg) {
  elToast.textContent = msg;
  elToast.classList.add("on");
  setTimeout(() => elToast.classList.remove("on"), 2400);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function renderHP(hp) {
  const bits = [];
  const on = clamp(hp, 0, 100);
  for (let i = 0; i < 100; i++) {
    bits.push(`<div class="hpBit ${i < on ? "on" : ""}"></div>`);
  }
  return `<div class="hpWrap">${bits.join("")}</div>`;
}

function trendIcon(trend) {
  if (trend === "up") return "▲";
  if (trend === "down") return "▼";
  return "▬";
}

function trendClass(trend) {
  if (trend === "up") return "up";
  if (trend === "down") return "down";
  return "flat";
}

/** ========= BOOT ========= **/
supabase = getSupabase();
async function boot() {
  const tgUser = getTelegramUser();

  // 1) upsert user by telegram_id
  me = await ensureUser(tgUser);

  elRole.textContent = `роль: ${me.role === "artist" ? "АРТИСТ" : "ФАНАТ"}`;
  elStars.textContent = `★ ${me.stars_balance ?? 0}`;

  // 2) if artist: ensure artist profile exists
  if (me.role === "artist") {
    myArtist = await ensureArtistForMe();
  }

  // 3) bind tabs
  bindTabs();

  // 4) first render
  await loadAndRender();
}

async function ensureUser(tgUser) {
  // try read
  const telegram_id = String(tgUser.id);

  let { data: existing, error } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .maybeSingle();

  if (error) {
    console.error(error);
    toast("Supabase: ошибка чтения users");
  }

  if (!existing) {
    // Onboarding role (once)
    const role = await pickRoleUI();
    const insert = {
      telegram_id,
      role,
      fan_level: 1,
      fan_hp: 15,          // небольшой стартовый HP, чтобы “вау”
      stars_balance: 0,
      entry_active: false, // вход 250★ позже
    };

    const { data: created, error: insErr } = await supabase
      .from("users")
      .insert(insert)
      .select("*")
      .single();

    if (insErr) {
      console.error(insErr);
      toast("Не удалось создать пользователя");
      throw insErr;
    }
    toast("Профиль создан. Добро пожаловать в TRUST.");
    return created;
  }

  // If role is missing or wrong - keep.
  return existing;
}

function pickRoleUI() {
  return new Promise((resolve) => {
    elMain.innerHTML = `
      <div class="card">
        <div class="h1">Кто ты сегодня? 📟</div>
        <div class="muted small" style="margin-top:6px">
          TRUST — игра доверия. Артисты растут как активы. HP — твоя “жизнь”. Уровни — X1, X2…
        </div>
        <div class="hr"></div>

        <div class="row" style="gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="pickFan">🎧 Фанат</button>
          <button class="btn hot" id="pickArtist">🎤 Артист</button>
        </div>

        <div class="hr"></div>
        <div class="small muted">
          (Роль сохранится. Поменять можно потом в Профиле.)
        </div>
      </div>
    `;

    document.getElementById("pickFan").onclick = () => {
      haptic("light");
      resolve("fan");
    };
    document.getElementById("pickArtist").onclick = () => {
      haptic("medium");
      resolve("artist");
    };
  });
}

async function ensureArtistForMe() {
  let { data: existing, error } = await supabase
    .from("artists")
    .select("*")
    .eq("user_id", me.id)
    .maybeSingle();

  if (error) {
    console.error(error);
    toast("Supabase: ошибка artists");
  }
  if (existing) return existing;

  // create minimal artist
  const draft = {
    user_id: me.id,
    project_name: "NEW",
    currency_name: "MANTA",
    comment: "закрытые демо • доступ 100★",
    private_link: "",
    trust_score: 10,
    level: 1,
    hp: 20,
    votes_total: 0,
    supporters_count: 0,
    trend: "flat",
  };

  const { data: created, error: insErr } = await supabase
    .from("artists")
    .insert(draft)
    .select("*")
    .single();

  if (insErr) {
    console.error(insErr);
    toast("Не удалось создать профиль артиста");
    throw insErr;
  }
  toast("Профиль артиста создан.");
  return created;
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = async () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      currentTab = t.dataset.tab;
      await loadAndRender();
    };
  });
}

async function loadAndRender() {
  if (currentTab === "trust") {
    await renderTrustTab();
  } else if (currentTab === "growth") {
    await renderGrowthTab();
  } else {
    await renderProfileTab();
  }
}

/** ========= TRUST TAB ========= **/
async function renderTrustTab() {
  const { data: artists, error } = await supabase
    .from("artists")
    .select("*")
    .order("trust_score", { ascending: false })
    .limit(200);

  if (error) {
    console.error(error);
    elMain.innerHTML = `<div class="card">Ошибка загрузки чарта.</div>`;
    return;
  }
  cachedArtists = artists || [];

  const myHP = me.role === "artist" ? (myArtist?.hp ?? 0) : (me.fan_hp ?? 0);
  const myLevel = me.role === "artist" ? (myArtist?.level ?? 1) : (me.fan_level ?? 1);

  elMain.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">TRUST Чарт</div>
          <div class="small muted">как крипто-кошелёк, только вместо монет — артисты. Nokia-режим включён.</div>
        </div>
        <div class="pixelTag">X${myLevel} • HP ${clamp(myHP,0,100)}/100</div>
      </div>
      <div style="margin-top:10px">${renderHP(myHP)}</div>

      <div class="hr"></div>

      <div class="row" style="gap:10px; flex-wrap:wrap">
        <button class="btn" id="btnRefresh">🔄 Обновить</button>
        <button class="btn ghost" id="btnHint">🕹 Как играть</button>
      </div>
    </div>

    ${artists.map(a => renderAssetRow(a)).join("")}
  `;

  document.getElementById("btnRefresh").onclick = async () => {
    haptic("light");
    await renderTrustTab();
  };

  document.getElementById("btnHint").onclick = () => {
    toast("Поддержка ↑ рост. Демо открывается отдельно за 100★. HP — жизнь. Перешёл 100 → уровень X+1.");
  };

  // bind row click
  document.querySelectorAll("[data-artist]").forEach((row) => {
    row.onclick = () => {
      const id = row.dataset.artist;
      const a = cachedArtists.find(x => x.id === id);
      if (a) openArtistModal(a);
    };
  });
}

function renderAssetRow(a) {
  const icon = trendIcon(a.trend);
  const cls = trendClass(a.trend);
  const kpi = a.trust_score ?? 0;
  const subtitle = `${a.currency_name} • ${a.comment || "без описания"}`;

  return `
    <div class="card" style="padding:10px">
      <div class="asset" data-artist="${a.id}">
        <div class="badge">${icon}</div>
        <div class="tnames">
          <b>${escapeHTML(a.project_name)} <span class="muted">(${escapeHTML(a.currency_name)})</span></b>
          <span>${escapeHTML(subtitle)}</span>
        </div>
        <div class="right">
          <div class="kpi">${kpi}</div>
          <div class="delta ${cls}">${cls === "flat" ? "0%" : (cls === "up" ? "+?" : "-?")}</div>
        </div>
      </div>
    </div>
  `;
}

/** ========= ARTIST MODAL ========= **/
async function openArtistModal(a) {
  haptic("light");

  // refresh artist (latest)
  const { data: artist, error } = await supabase
    .from("artists")
    .select("*")
    .eq("id", a.id)
    .single();

  if (error) {
    console.error(error);
    toast("Не удалось открыть профиль артиста");
    return;
  }

  const isMe = (me.role === "artist" && myArtist?.id === artist.id);

  // check demo access
  const { data: purchase } = await supabase
    .from("demo_purchases")
    .select("*")
    .eq("user_id", me.id)
    .eq("artist_id", artist.id)
    .maybeSingle();

  const hasDemo = !!purchase || isMe;

  // load tracks if has demo
  let tracks = [];
  if (hasDemo) {
    const { data: t } = await supabase
      .from("tracks")
      .select("*")
      .eq("artist_id", artist.id)
      .order("created_at", { ascending: false });
    tracks = t || [];
  }

  elSheet.innerHTML = `
    <div class="sheetHeader">
      <div>
        <div class="h1">${escapeHTML(artist.project_name)} <span class="muted">(${escapeHTML(artist.currency_name)})</span></div>
        <div class="small muted">${escapeHTML(artist.comment || "…")}</div>
      </div>
      <button class="close" id="closeModal">✕</button>
    </div>

    <div class="card">
      <div class="row">
        <div class="pixelTag">X${artist.level} • HP ${clamp(artist.hp,0,100)}/100</div>
        <div class="pixelTag">TRUST ${artist.trust_score}</div>
      </div>
      <div style="margin-top:10px">${renderHP(artist.hp)}</div>

      <div class="hr"></div>

      <div class="grid2">
        <button class="btn primary" id="btnSupport">🔥 Поддержать (+1)</button>
        <button class="btn hot" id="btnDemo">${hasDemo ? "🎧 Демо открыто" : `🔒 Открыть демо (${cfg.DEMO_PRICE_STARS}★)`}</button>
      </div>

      <div class="hr"></div>

      <div class="small muted">
        Поддержка влияет на рост. Демо открывается отдельно за ${cfg.DEMO_PRICE_STARS}★.
      </div>
    </div>

    <div class="card">
      <div class="h2">Ссылки</div>
      ${renderLinksBlock(artist, hasDemo, isMe)}
    </div>

    <div class="card">
      <div class="h2">Демо-треки</div>
      ${hasDemo ? renderTracks(tracks) : `<div class="muted small">🔒 Купи доступ к демо, чтобы слушать прямо здесь.</div>`}
    </div>
  `;

  document.getElementById("closeModal").onclick = closeModal;
  document.getElementById("btnSupport").onclick = async () => {
    await supportArtist(artist);
  };
  document.getElementById("btnDemo").onclick = async () => {
    if (hasDemo) return toast("Доступ уже открыт.");
    await unlockDemo(artist);
  };

  // bind track play
  document.querySelectorAll("[data-track]").forEach((btn) => {
    btn.onclick = async () => {
      const trackId = btn.dataset.track;
      const t = tracks.find(x => x.id === trackId);
      if (!t) return;
      await playTrack(t);
    };
  });

  document.querySelectorAll("[data-stop]").forEach((btn) => {
    btn.onclick = stopTrack;
  });

  elModal.classList.add("on");
  elModal.onclick = (e) => {
    if (e.target === elModal) closeModal();
  };
}

function renderLinksBlock(artist, hasDemo, isMe) {
  const priv = artist.private_link?.trim();
  const showPriv = isMe || hasDemo;

  return `
    <div class="small muted">Закрытое сообщество:</div>
    <div style="margin-top:8px">
      ${
        showPriv && priv
          ? `<a href="${escapeAttr(priv)}" target="_blank">🔗 Открыть закрытый канал</a>`
          : `<span class="muted small">🔒 Ссылка скрыта (откроется после демо)</span>`
      }
    </div>
  `;
}

function renderTracks(tracks) {
  if (!tracks.length) {
    return `<div class="muted small">У артиста пока нет загруженных демо.</div>`;
  }
  return `
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px">
      ${tracks.map(t => `
        <div class="asset" style="cursor:default">
          <div class="badge">🎵</div>
          <div class="tnames">
            <b>${escapeHTML(t.title)}</b>
            <span class="muted">слушать внутри TRUST</span>
          </div>
          <div class="right" style="display:flex; gap:8px; justify-content:flex-end">
            <button class="btn" data-track="${t.id}">▶︎</button>
            <button class="btn" data-stop="1">⏹</button>
          </div>
        </div>
      `).join("")}
      <audio id="audioPlayer" controls style="width:100%; margin-top:10px; display:none;"></audio>
      <div class="small muted" id="audioHint"></div>
    </div>
  `;
}

function closeModal() {
  elModal.classList.remove("on");
  elSheet.innerHTML = "";
  stopTrack();
}

/** ========= ACTIONS ========= **/
async function supportArtist(artist) {
  haptic("medium");

  // 1) insert vote
  const { error: voteErr } = await supabase
    .from("votes")
    .insert({ fan_user_id: me.id, artist_id: artist.id, amount: 1 });

  if (voteErr) {
    console.error(voteErr);
    return toast("Не удалось проголосовать (votes).");
  }

  // 2) update artist growth (MVP math)
  // +1 trust_score, +5 hp, if hp >= 100 => level+1 and hp -= 100
  const newTrust = (artist.trust_score ?? 0) + 1;
  let newHp = (artist.hp ?? 0) + 5;
  let newLevel = artist.level ?? 1;

  if (newHp >= 100) {
    newLevel += Math.floor(newHp / 100);
    newHp = newHp % 100;
  }

  const { error: upErr, data: updated } = await supabase
    .from("artists")
    .update({
      trust_score: newTrust,
      hp: newHp,
      level: newLevel,
      votes_total: (artist.votes_total ?? 0) + 1,
      trend: "up",
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", artist.id)
    .select("*")
    .single();

  if (upErr) {
    console.error(upErr);
    return toast("Не удалось обновить рост артиста.");
  }

  toast("🔥 Поддержка засчитана. Рост пошёл.");
  // refresh myArtist if needed
  if (me.role === "artist" && myArtist?.id === updated.id) myArtist = updated;
  // reopen modal with updated data
  await openArtistModal(updated);
}

async function unlockDemo(artist) {
  haptic("light");

  // пока заглушка вместо Stars — просто создаём запись demo_purchases
  const { error } = await supabase
    .from("demo_purchases")
    .insert({
      user_id: me.id,
      artist_id: artist.id,
      stars_amount: cfg.DEMO_PRICE_STARS,
    });

  if (error) {
    // если unique conflict — значит уже есть
    if (String(error.message || "").toLowerCase().includes("duplicate")) {
      toast("Демо уже открыто.");
      return openArtistModal(artist);
    }
    console.error(error);
    return toast("Не удалось открыть демо (demo_purchases).");
  }

  toast(`🎧 Демо открыто (тест). Позже подключим Stars ${cfg.DEMO_PRICE_STARS}★.`);
  await openArtistModal(artist);
}

async function playTrack(track) {
  const audio = document.getElementById("audioPlayer");
  const hint = document.getElementById("audioHint");
  if (!audio) return;

  audio.style.display = "block";
  hint.textContent = "Загрузка…";

  // Private bucket: пробуем signed URL (может потребовать policy)
  const bucket = cfg.DEMO_BUCKET;
  const { data, error } = await supabase
    .storage
    .from(bucket)
    .createSignedUrl(track.storage_path, 60 * 10); // 10 минут

  if (error) {
    console.error(error);
    hint.textContent =
      "Не удалось получить доступ к файлу. Для теста включи Public bucket или позже сделаем выдачу signed URL через сервер/edge function.";
    toast("Storage доступ: нужна настройка (см. подсказку).");
    return;
  }

  audio.src = data.signedUrl;
  audio.play().catch(() => {});
  hint.textContent = `▶︎ Играет: ${track.title}`;
  toast("▶︎ Play");
}

function stopTrack() {
  const audio = document.getElementById("audioPlayer");
  const hint = document.getElementById("audioHint");
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {}
  if (hint) hint.textContent = "";
}

/** ========= GROWTH TAB ========= **/
async function renderGrowthTab() {
  // MVP: показываем “фид” по топ-5 артистам + твой статус
  const top = cachedArtists.length ? cachedArtists.slice(0, 8) : [];

  elMain.innerHTML = `
    <div class="card">
      <div class="h1">Рост / Фид</div>
      <div class="small muted">здесь люди “залипают” как в кошельке: кто вырос, кто упал, что делать.</div>
      <div class="hr"></div>

      <div class="small">Твой статус:</div>
      <div style="margin-top:8px">
        <div class="pixelTag">${me.role === "artist" ? "АРТИСТ" : "ФАНАТ"} • X${me.role === "artist" ? (myArtist?.level ?? 1) : (me.fan_level ?? 1)}</div>
      </div>
    </div>

    <div class="card">
      <div class="h2">Сейчас в топе</div>
      <div class="small muted">Маленькая лента событий (MVP). Позже сделаем реальный лог.</div>
      <div class="hr"></div>

      <div style="display:flex; flex-direction:column; gap:10px">
        ${top.map(a => `
          <div class="asset" data-artist="${a.id}">
            <div class="badge">${trendIcon(a.trend)}</div>
            <div class="tnames">
              <b>${escapeHTML(a.project_name)}</b>
              <span>${escapeHTML(a.comment || "…")}</span>
            </div>
            <div class="right">
              <div class="kpi">${a.trust_score}</div>
              <div class="delta ${trendClass(a.trend)}">${a.trend === "up" ? "рост" : (a.trend === "down" ? "падение" : "ровно")}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  document.querySelectorAll("[data-artist]").forEach((row) => {
    row.onclick = () => {
      const id = row.dataset.artist;
      const a = cachedArtists.find(x => x.id === id) || top.find(x => x.id === id);
      if (a) openArtistModal(a);
    };
  });
}

/** ========= PROFILE TAB ========= **/
async function renderProfileTab() {
  const isArtist = me.role === "artist";
  const hp = isArtist ? (myArtist?.hp ?? 0) : (me.fan_hp ?? 0);
  const level = isArtist ? (myArtist?.level ?? 1) : (me.fan_level ?? 1);

  elMain.innerHTML = `
    <div class="card">
      <div class="h1">Мой профиль</div>
      <div class="small muted">Редактирование — только здесь. Как Telegram: “я в своём аккаунте”.</div>
      <div class="hr"></div>

      <div class="row">
        <div class="pixelTag">роль: ${isArtist ? "АРТИСТ" : "ФАНАТ"}</div>
        <button class="btn" id="btnSwitchRole">♻ сменить роль</button>
      </div>

      <div style="margin-top:10px">${renderHP(hp)}</div>
      <div class="row" style="margin-top:10px">
        <div class="pixelTag">X${level}</div>
        <div class="pixelTag">★ ${me.stars_balance ?? 0}</div>
        <div class="pixelTag">Вход: ${me.entry_active ? "активен" : "заглушка"}</div>
      </div>
    </div>

    ${isArtist ? renderArtistEditor() : renderFanPanel()}
  `;

  document.getElementById("btnSwitchRole").onclick = async () => {
    await switchRole();
  };

  if (isArtist) {
    document.getElementById("btnSaveArtist").onclick = async () => {
      await saveArtistProfile();
    };
  }
}

function renderArtistEditor() {
  const a = myArtist;
  return `
    <div class="card">
      <div class="h2">Профиль артиста</div>
      <div class="small muted">Название ≤10 символов. Валюта ≤10. Оффер — коротко.</div>
      <div class="hr"></div>

      <div class="grid2">
        <div>
          <div class="small muted">Project name</div>
          <input class="input" id="inProject" maxlength="10" value="${escapeAttr(a?.project_name || "")}" />
        </div>
        <div>
          <div class="small muted">Currency</div>
          <input class="input" id="inCurrency" maxlength="10" value="${escapeAttr(a?.currency_name || "")}" />
        </div>
      </div>

      <div style="margin-top:10px">
        <div class="small muted">Комментарий (коротко)</div>
        <input class="input" id="inComment" maxlength="60" value="${escapeAttr(a?.comment || "")}" />
      </div>

      <div style="margin-top:10px">
        <div class="small muted">Ссылка на закрытое сообщество</div>
        <input class="input" id="inPrivate" placeholder="https://t.me/..." value="${escapeAttr(a?.private_link || "")}" />
      </div>

      <div class="hr"></div>
      <button class="btn primary" id="btnSaveArtist">💾 Сохранить</button>

      <div class="hr"></div>
      <div class="small muted">
        Демо-треки добавляются в таблицу <b>tracks</b> (пока вручную). Следующим шагом сделаем загрузку трека прямо из приложения.
      </div>
    </div>
  `;
}

function renderFanPanel() {
  return `
    <div class="card">
      <div class="h2">Панель фаната</div>
      <div class="small muted">Фанат тоже качается: выбирай растущих — получай бонусы (позже).</div>
      <div class="hr"></div>

      <div class="row">
        <div class="pixelTag">Fan Trust: X${me.fan_level ?? 1}</div>
        <div class="pixelTag">HP ${clamp(me.fan_hp ?? 0,0,100)}/100</div>
      </div>

      <div class="hr"></div>
      <div class="small muted">
        Вход 250★ и расчёт “следующий месяц бесплатно” включим после Stars.
      </div>
    </div>
  `;
}

async function saveArtistProfile() {
  const project_name = (document.getElementById("inProject").value || "").trim();
  const currency_name = (document.getElementById("inCurrency").value || "").trim();
  const comment = (document.getElementById("inComment").value || "").trim();
  const private_link = (document.getElementById("inPrivate").value || "").trim();

  if (!project_name || !currency_name) return toast("Заполни project и currency.");
  if (project_name.length > 10 || currency_name.length > 10) return toast("Слишком длинно (≤10).");

  const { data, error } = await supabase
    .from("artists")
    .update({ project_name, currency_name, comment, private_link, updated_at: new Date().toISOString() })
    .eq("id", myArtist.id)
    .select("*")
    .single();

  if (error) {
    console.error(error);
    return toast("Не удалось сохранить профиль.");
  }

  myArtist = data;
  toast("Сохранено.");
  await renderProfileTab();
}

async function switchRole() {
  // простой MVP: переключаем role, перезагружаем страницу
  const next = me.role === "artist" ? "fan" : "artist";
  const { data, error } = await supabase
    .from("users")
    .update({ role: next, updated_at: new Date().toISOString() })
    .eq("id", me.id)
    .select("*")
    .single();

  if (error) {
    console.error(error);
    return toast("Не удалось сменить роль.");
  }
  me = data;
  toast("Роль изменена. Перезагрузка…");
  setTimeout(() => location.reload(), 800);
}

/** ========= helpers ========= **/
function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) {
  return escapeHTML(s).replaceAll("\n", " ");
}

// Boot
boot().catch((e) => {
  console.error(e);
  elMain.innerHTML = `
    <div class="card">
      <div class="h1">Ошибка запуска</div>
      <div class="small muted">Проверь config.js (SUPABASE_URL/ANON_KEY) и наличие таблиц.</div>
      <div class="hr"></div>
      <pre class="small muted" style="white-space:pre-wrap">${escapeHTML(e.message || String(e))}</pre>
    </div>
  `;
});

import { listPublicMusicTracks } from "./supabase.js?v=20261103-2";

const sidebar = document.querySelector(".home-sidebar");
const footer = sidebar?.querySelector(".home-sidebar-footer");
if (!sidebar || !footer) {
  throw new Error("音乐播放器需要博客侧边栏。");
}
sidebar.classList.add("has-music-player");

const player = document.createElement("section");
player.className = "sidebar-music";
player.setAttribute("aria-label", "音乐播放器");
player.dataset.sourceType = "";
player.innerHTML = `
  <div class="sidebar-music-heading">
    <span class="sidebar-music-note" aria-hidden="true">♫</span>
    <h2>音乐</h2>
    <button class="sidebar-music-list-toggle" type="button" aria-expanded="false" aria-controls="sidebar-music-list">
      歌单列表
    </button>
  </div>
  <p class="sidebar-music-current" data-music-current>正在加载歌单…</p>
  <div class="sidebar-music-controls" data-music-controls></div>
  <div class="sidebar-music-transport" data-music-transport></div>
  <ol class="sidebar-music-list" data-music-list></ol>
  <p class="sidebar-music-status" data-music-status role="status" aria-live="polite"></p>
`;
sidebar.insertBefore(player, footer);

const currentTitle = player.querySelector("[data-music-current]");
const controls = player.querySelector("[data-music-controls]");
const transport = player.querySelector("[data-music-transport]");
const trackList = player.querySelector("[data-music-list]");
const status = player.querySelector("[data-music-status]");
const listToggle = player.querySelector(".sidebar-music-list-toggle");
trackList.id = "sidebar-music-list";
transport.hidden = true;
trackList.hidden = true;
listToggle.hidden = true;
listToggle.addEventListener("click", () => {
  const expanded = listToggle.getAttribute("aria-expanded") !== "true";
  listToggle.setAttribute("aria-expanded", String(expanded));
  listToggle.textContent = expanded ? "收起歌单" : "歌单列表";
  trackList.hidden = !expanded;
});
let tracks = [];
let currentIndex = 0;
let activeAudio = null;
let playbackRate = 1;
const playbackRates = [0.75, 0.8, 0.9, 1, 1.25, 1.5, 2];

const icons = {
  play: '<path d="m8 5 12 7-12 7z"/>',
  pause: '<path d="M8 5h3v14H8z"/><path d="M15 5h3v14h-3z"/>',
};

function setButtonIcon(button, icon, label) {
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `<svg class="music-icon-${icon}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[icon]}</svg>`;
}

const playPause = document.createElement("button");
playPause.type = "button";
playPause.className = "sidebar-music-skip sidebar-music-play";
setButtonIcon(playPause, "play", "播放");
playPause.disabled = true;
playPause.addEventListener("click", () => {
  if (!activeAudio) return;
  if (activeAudio.paused) {
    activeAudio.play().catch(() => {
      status.textContent = "无法播放此音频，请检查文件或浏览器设置。";
    });
  } else {
    activeAudio.pause();
  }
});
const speedButton = document.createElement("button");
speedButton.type = "button";
speedButton.className = "sidebar-music-speed";
speedButton.textContent = "1×";
speedButton.setAttribute("aria-label", "播放速度 1 倍");
speedButton.title = "切换播放速度";
speedButton.hidden = true;
speedButton.addEventListener("click", () => {
  const rateIndex = playbackRates.indexOf(playbackRate);
  playbackRate = playbackRates[(rateIndex + 1) % playbackRates.length];
  if (activeAudio) activeAudio.playbackRate = playbackRate;
  speedButton.textContent = `${playbackRate}×`;
  speedButton.setAttribute("aria-label", `播放速度 ${playbackRate} 倍`);
});

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getNeteaseEmbed(source) {
  let url;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (!["music.163.com", "www.music.163.com", "y.music.163.com"].includes(url.hostname)) {
    return null;
  }

  const path = url.pathname.toLowerCase();
  const match = path.match(/\/(song|playlist)\/(\d+)/);
  const hashQuery = url.hash.includes("?")
    ? new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1))
    : new URLSearchParams();
  const id = url.searchParams.get("id") || hashQuery.get("id") || match?.[2];
  if (!id || !/^\d+$/.test(id)) return null;
  const isPlaylist =
    url.searchParams.get("type") === "0" ||
    hashQuery.get("type") === "0" ||
    path.includes("playlist") ||
    url.hash.toLowerCase().includes("playlist");
  const type = isPlaylist ? "0" : "2";
  const embed = new URL("https://music.163.com/outchain/player");
  embed.searchParams.set("type", type);
  embed.searchParams.set("id", id);
  embed.searchParams.set("auto", "0");
  embed.searchParams.set("height", "150");
  return embed.toString();
}

function getAudioUrl(source) {
  if (source.startsWith("/") && !source.startsWith("//")) {
    return new URL(source, location.origin).toString();
  }
  try {
    const url = new URL(source);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function showTrack(index, { autoplay = false } = {}) {
  currentIndex = (index + tracks.length) % tracks.length;
  const track = tracks[currentIndex];
  currentTitle.textContent = track.title;
  currentTitle.hidden = true;
  player.dataset.sourceType = track.source_type;
  controls.replaceChildren();
  activeAudio = null;
  transport.hidden = true;

  if (track.source_type === "netease") {
    currentTitle.hidden = true;
    const embedUrl = getNeteaseEmbed(track.source);
    if (!embedUrl) {
      status.textContent = `无法解析网易云音乐链接：${track.title}`;
      return;
    }
    const frame = document.createElement("iframe");
    frame.className = "sidebar-music-embed";
    frame.src = embedUrl;
    frame.title = `网易云音乐：${track.title}`;
    frame.loading = "lazy";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "autoplay";
    const frameViewport = document.createElement("div");
    frameViewport.className = "sidebar-music-embed-viewport";
    frameViewport.append(frame);
    controls.append(frameViewport);
  } else {
    currentTitle.hidden = true;
    const audioUrl = getAudioUrl(track.source);
    if (!audioUrl) {
      status.textContent = `本地音频地址无效：${track.title}`;
      return;
    }
    const audio = document.createElement("audio");
    audio.className = "sidebar-music-audio";
    audio.hidden = true;
    audio.preload = "none";
    audio.src = audioUrl;
    audio.playbackRate = playbackRate;
    activeAudio = audio;
    playPause.disabled = false;
    speedButton.hidden = false;

    const localPlayer = document.createElement("div");
    localPlayer.className = "sidebar-music-local-player";
    const cover = document.createElement("div");
    cover.className = "sidebar-music-local-cover";
    cover.setAttribute("aria-hidden", "true");
    cover.textContent = "♫";
    const body = document.createElement("div");
    body.className = "sidebar-music-local-body";
    const title = document.createElement("p");
    title.className = "sidebar-music-local-title";
    title.textContent = track.title;
    const progress = document.createElement("input");
    progress.className = "sidebar-music-progress";
    progress.type = "range";
    progress.min = "0";
    progress.max = "1000";
    progress.value = "0";
    progress.setAttribute("aria-label", `播放进度：${track.title}`);
    const actions = document.createElement("div");
    actions.className = "sidebar-music-local-actions";
    const elapsed = document.createElement("span");
    elapsed.textContent = "0:00";
    const duration = document.createElement("span");
    duration.textContent = "0:00";
    const time = document.createElement("div");
    time.className = "sidebar-music-local-time";
    time.append(elapsed, duration);

    progress.addEventListener("input", () => {
      if (Number.isFinite(audio.duration)) {
        audio.currentTime = (Number(progress.value) / 1000) * audio.duration;
      }
    });
    audio.addEventListener("loadedmetadata", () => {
      duration.textContent = formatTime(audio.duration);
    });
    audio.addEventListener("durationchange", () => {
      duration.textContent = formatTime(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
      elapsed.textContent = formatTime(audio.currentTime);
      progress.value = Number.isFinite(audio.duration) && audio.duration > 0
        ? String(Math.round((audio.currentTime / audio.duration) * 1000))
        : "0";
    });
    audio.addEventListener("play", () => setButtonIcon(playPause, "pause", "暂停"));
    audio.addEventListener("pause", () => setButtonIcon(playPause, "play", "播放"));
    audio.addEventListener("ended", () => showTrack(currentIndex + 1, { autoplay: true }));
    audio.addEventListener("error", () => {
      status.textContent = `音频无法播放，请检查文件路径：${track.title}`;
    }, { once: true });
    actions.append(time, playPause, speedButton);
    body.append(title, progress, actions);
    localPlayer.append(cover, body);
    controls.append(localPlayer, audio);
    if (autoplay) {
      audio.play().catch(() => {
        status.textContent = "浏览器阻止了自动播放，请点击播放按钮。";
      });
    }
  }

  for (const [trackIndex, button] of [...trackList.querySelectorAll("button")].entries()) {
    const selected = trackIndex === currentIndex;
    button.classList.toggle("is-current", selected);
    button.setAttribute("aria-current", selected ? "true" : "false");
  }
  trackList.hidden = true;
  listToggle.setAttribute("aria-expanded", "false");
  listToggle.textContent = "歌单列表";
  status.textContent = "";
}

async function loadTracks() {
  try {
    tracks = await listPublicMusicTracks();
    trackList.replaceChildren();
    if (!tracks.length) {
      currentTitle.textContent = "歌单还是空的";
      currentTitle.hidden = false;
      return;
    }
    listToggle.hidden = false;

    for (const [index, track] of tracks.entries()) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = track.title;
      button.addEventListener("click", () => showTrack(index));
      item.append(button);
      trackList.append(item);
    }
    showTrack(0);
  } catch (error) {
    currentTitle.textContent = "歌单暂不可用";
    currentTitle.hidden = false;
    status.textContent = error.message;
  }
}

loadTracks();

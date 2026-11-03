import { listPublicMusicTracks } from "./supabase.js?v=20261103-1";

const sidebar = document.querySelector(".home-sidebar");
const footer = sidebar?.querySelector(".home-sidebar-footer");
if (!sidebar || !footer) {
  throw new Error("音乐播放器需要博客侧边栏。");
}
sidebar.classList.add("has-music-player");

const player = document.createElement("section");
player.className = "sidebar-music";
player.setAttribute("aria-label", "音乐播放器");
player.innerHTML = `
  <div class="sidebar-music-heading">
    <span class="sidebar-music-note" aria-hidden="true">♫</span>
    <h2>音乐</h2>
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
transport.hidden = true;
const trackList = player.querySelector("[data-music-list]");
const status = player.querySelector("[data-music-status]");
let tracks = [];
let currentIndex = 0;

const previous = document.createElement("button");
previous.type = "button";
previous.className = "sidebar-music-skip";
previous.setAttribute("aria-label", "上一首");
previous.textContent = "‹";
previous.disabled = true;
previous.addEventListener("click", () => showTrack(currentIndex - 1));
const next = document.createElement("button");
next.type = "button";
next.className = "sidebar-music-skip";
next.setAttribute("aria-label", "下一首");
next.textContent = "›";
next.disabled = true;
next.addEventListener("click", () => showTrack(currentIndex + 1));
transport.append(previous, next);

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
  embed.searchParams.set("height", "86");
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
  controls.replaceChildren();

  if (track.source_type === "netease") {
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
    controls.append(frame);
  } else {
    const audioUrl = getAudioUrl(track.source);
    if (!audioUrl) {
      status.textContent = `本地音频地址无效：${track.title}`;
      return;
    }
    const audio = document.createElement("audio");
    audio.className = "sidebar-music-audio";
    audio.controls = true;
    audio.preload = "none";
    audio.src = audioUrl;
    audio.addEventListener("ended", () => showTrack(currentIndex + 1, { autoplay: true }));
    audio.addEventListener("error", () => {
      status.textContent = `音频无法播放，请检查文件路径：${track.title}`;
    }, { once: true });
    controls.append(audio);
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
  status.textContent = "";
}

async function loadTracks() {
  try {
    tracks = await listPublicMusicTracks();
    trackList.replaceChildren();
    if (!tracks.length) {
      currentTitle.textContent = "歌单还是空的";
      status.textContent = "管理员可在后台添加网易云歌曲或音频文件。";
      return;
    }
    transport.hidden = false;
    previous.disabled = false;
    next.disabled = false;

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
    status.textContent = error.message;
  }
}

loadTracks();

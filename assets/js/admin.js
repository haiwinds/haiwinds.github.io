import {
  getSession,
  getConfigurationError,
  isBlogAdmin,
  isConfigured,
  addMusicTrack,
  deleteUploadedMusicAudio,
  deleteMusicTrack,
  listAdminImages,
  listAdminMusicTracks,
  reorderMusicTracks,
  listAdminPosts,
  publicImageUrl,
  publishPost,
  setPostPublished,
  attachPostImage,
  signIn,
  signOut,
  uploadImage,
  uploadMusicAudio,
} from "./supabase.js?v=20261105-2";

const loginPanel = document.querySelector("[data-login-panel]");
const dashboard = document.querySelector("[data-dashboard]");
const staticPublishPanel = document.querySelector("[data-static-publish-panel]");
const staticPublishDashboardSlot = document.querySelector("[data-static-publish-dashboard-slot]");
const loginForm = document.querySelector("[data-login-form]");
const publishForm = document.querySelector("[data-publish-form]");
const uploadForm = document.querySelector("[data-upload-form]");
const loginMessage = document.querySelector("[data-login-message]");
const pageMessage = document.querySelector("[data-page-message]");
const publishMessage = document.querySelector("[data-publish-message]");
const uploadMessage = document.querySelector("[data-upload-message]");
const adminEmail = document.querySelector("[data-admin-email]");
const postList = document.querySelector("[data-admin-posts]");
const imageList = document.querySelector("[data-admin-images]");
const imageInput = document.querySelector("#image-files");
const publishImageInput = document.querySelector("#post-image-files");
const inlineImageInput = document.querySelector("#inline-image-file");
const inlineImageButton = document.querySelector("[data-insert-inline-image]");
const postContentInput = document.querySelector("#post-content");
const selectedImage = document.querySelector("[data-selected-image]");
const selectedImageCount = document.querySelector("[data-selected-image-count]");
const selectedImageList = document.querySelector("[data-selected-image-list]");
const existingPostSelect = document.querySelector("[data-image-post-select]");
const existingImageSelection = document.querySelector("[data-existing-image-selection]");
const attachExistingImageButton = document.querySelector("[data-attach-existing-image]");
const logoutButton = document.querySelector("[data-logout]");
const musicTrackForm = document.querySelector("[data-music-track-form]");
const musicTrackMessage = document.querySelector("[data-music-track-message]");
const musicTrackList = document.querySelector("[data-admin-music-tracks]");

let session = null;
let pendingExistingImagePath = "";
let selectedNewImagePaths = [];
let selectedLocalFiles = [];
let inlineSelection = null;
let musicTracks = [];
let isSavingMusicOrder = false;
let draggedMusicTrackId = "";
const uploadedInlineImagePaths = new Map();

function setSelectedLocalFiles(files) {
  const transfer = new DataTransfer();
  for (const { file } of files) transfer.items.add(file);
  publishImageInput.files = transfer.files;
  selectedLocalFiles = [...files];
}

function insertInlineImageMarker(marker) {
  const content = postContentInput.value;
  const start = inlineSelection?.start ?? postContentInput.selectionStart;
  const end = inlineSelection?.end ?? postContentInput.selectionEnd;
  inlineSelection = null;
  const before = start > 0 && content[start - 1] !== "\n" ? "\n" : "";
  const after = end < content.length && content[end] !== "\n" ? "\n" : "";
  const insertion = `${before}${marker}${after}`;
  if (content.length - (end - start) + insertion.length > postContentInput.maxLength) {
    setMessage(publishMessage, "正文已达到字数上限，无法插入图片。", true);
    return false;
  }
  postContentInput.setRangeText(insertion, start, end, "end");
  postContentInput.focus();
  return true;
}

function resolveInlineImageMarkers(content) {
  const resolved = content.replace(
    /\{\{image:(local|library):([^}]+)\}\}/g,
    (marker, type, value) => {
      let path;
      if (type === "local") {
        path = uploadedInlineImagePaths.get(value);
      } else {
        try {
          path = decodeURIComponent(value);
        } catch {
          throw new Error("正文中的图库图片标记无效，请重新插入图片。");
        }
      }
      if (!path) {
        throw new Error("正文中的图片尚未上传完成，请重新选择并插入图片。");
      }
      return `{{image:${encodeURIComponent(path)}}}`;
    },
  );
  if (resolved.length > 10000) {
    throw new Error("插入图片后正文超过 10000 字，请删减部分文字。");
  }
  return resolved;
}

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function validateMusicSource(sourceType, source) {
  if (sourceType === "netease") {
    let url;
    try {
      url = new URL(source);
    } catch {
      throw new Error("请输入有效的网易云音乐歌曲或歌单链接。");
    }
    if (
      url.protocol !== "https:" ||
      !["music.163.com", "www.music.163.com", "y.music.163.com"].includes(url.hostname)
    ) {
      throw new Error("网易云音源请使用 music.163.com 的歌曲或歌单分享链接。");
    }
    const match = url.pathname.match(/\/(song|playlist)\/(\d+)/i);
    const id = url.searchParams.get("id") || match?.[2];
    if (!id || !/^\d+$/.test(id)) {
      throw new Error("链接中没有找到网易云歌曲或歌单 ID。");
    }
    return url.toString();
  }

  if (sourceType !== "audio") {
    throw new Error("请选择网易云音乐或音频文件作为音源类型。");
  }
  if (source.startsWith("/") && !source.startsWith("//")) {
    const url = new URL(source, location.origin);
    if (url.origin !== location.origin) {
      throw new Error("本地音频路径必须指向当前网站。");
    }
    return `${url.pathname}${url.search}${url.hash}`;
  }
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("本地音频请输入以 / 开头的网站路径，或 HTTPS 音频链接。");
  }
  if (url.protocol !== "https:") {
    throw new Error("音频链接必须使用 HTTPS。");
  }
  return url.toString();
}

function createMusicTrackRow(track, index) {
  const row = document.createElement("div");
  row.className = "admin-music-track-row";
  row.draggable = !isSavingMusicOrder;
  row.dataset.trackId = track.id;
  const details = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = track.title;
  const source = document.createElement("span");
  source.textContent = `${track.source_type === "netease" ? "网易云音乐" : "音频文件"} · ${track.source}`;
  details.append(title, source);

  const actions = document.createElement("div");
  actions.className = "admin-music-track-actions";
  const dragHandle = document.createElement("span");
  dragHandle.className = "admin-music-track-drag-handle";
  dragHandle.setAttribute("aria-hidden", "true");
  dragHandle.textContent = "⠿";
  dragHandle.title = "拖动调整顺序";

  const moveUp = document.createElement("button");
  moveUp.type = "button";
  moveUp.className = "admin-button admin-button-secondary admin-music-track-move";
  moveUp.textContent = "上移";
  moveUp.setAttribute("aria-label", `上移「${track.title}」`);
  moveUp.disabled = index === 0 || isSavingMusicOrder;
  moveUp.addEventListener("click", () => moveMusicTrack(track.id, -1));

  const moveDown = document.createElement("button");
  moveDown.type = "button";
  moveDown.className = "admin-button admin-button-secondary admin-music-track-move";
  moveDown.textContent = "下移";
  moveDown.setAttribute("aria-label", `下移「${track.title}」`);
  moveDown.disabled = index === musicTracks.length - 1 || isSavingMusicOrder;
  moveDown.addEventListener("click", () => moveMusicTrack(track.id, 1));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "admin-button admin-button-secondary";
  remove.textContent = "从歌单移除";
  remove.disabled = isSavingMusicOrder;
  remove.addEventListener("click", async () => {
    if (!window.confirm(`确定从公共歌单移除「${track.title}」吗？`)) return;
    remove.disabled = true;
    let trackDeleted = false;
    try {
      await deleteMusicTrack(session, track.id);
      trackDeleted = true;
      let cleanupWarning = "";
      if (track.source_type === "audio") {
        try {
          await deleteUploadedMusicAudio(session, track.source);
        } catch (error) {
          cleanupWarning = ` 音频文件清理失败：${error.message}`;
        }
      }
      await refreshMusicTracks();
      setMessage(
        musicTrackMessage,
        `已从歌单移除「${track.title}」。${cleanupWarning}`,
        Boolean(cleanupWarning),
      );
    } catch (error) {
      setMessage(
        musicTrackMessage,
        trackDeleted ? `歌曲已移除，但歌单刷新失败：${error.message}` : error.message,
        true,
      );
      if (!trackDeleted) remove.disabled = false;
    }
  });
  actions.append(dragHandle, moveUp, moveDown, remove);
  row.append(details, actions);
  return row;
}

function renderMusicTracks() {
  musicTrackList.replaceChildren(...musicTracks.map(createMusicTrackRow));
  if (!musicTracks.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "歌单还是空的，添加歌曲后会显示在网站侧栏。";
    musicTrackList.append(empty);
  }
}

async function refreshMusicTracks() {
  musicTracks = await listAdminMusicTracks(session);
  renderMusicTracks();
}

async function saveMusicTrackOrder(orderedTracks) {
  if (isSavingMusicOrder) return;
  const previousTracks = musicTracks;
  musicTracks = orderedTracks;
  isSavingMusicOrder = true;
  musicTrackList.setAttribute("aria-busy", "true");
  renderMusicTracks();
  setMessage(musicTrackMessage, "正在保存歌单顺序…");
  try {
    await reorderMusicTracks(session, musicTracks.map((track) => track.id));
    setMessage(musicTrackMessage, "歌单顺序已保存。");
  } catch (error) {
    musicTracks = previousTracks;
    setMessage(musicTrackMessage, `歌单顺序保存失败：${error.message}`, true);
    try {
      await refreshMusicTracks();
    } catch (refreshError) {
      setMessage(
        musicTrackMessage,
        `歌单顺序保存失败：${error.message}；重新加载歌单也失败：${refreshError.message}`,
        true,
      );
    }
  } finally {
    isSavingMusicOrder = false;
    musicTrackList.removeAttribute("aria-busy");
    renderMusicTracks();
  }
}

async function moveMusicTrack(trackId, offset) {
  const index = musicTracks.findIndex((track) => track.id === trackId);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= musicTracks.length) return;
  const orderedTracks = [...musicTracks];
  [orderedTracks[index], orderedTracks[targetIndex]] = [orderedTracks[targetIndex], orderedTracks[index]];
  await saveMusicTrackOrder(orderedTracks);
}

musicTrackList.addEventListener("dragstart", (event) => {
  if (isSavingMusicOrder) {
    event.preventDefault();
    return;
  }
  const row = event.target.closest(".admin-music-track-row");
  if (!row) return;
  draggedMusicTrackId = row.dataset.trackId;
  row.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedMusicTrackId);
});

musicTrackList.addEventListener("dragover", (event) => {
  if (!draggedMusicTrackId || isSavingMusicOrder) return;
  const target = event.target.closest(".admin-music-track-row");
  if (!target || target.dataset.trackId === draggedMusicTrackId) return;
  event.preventDefault();
  const draggedRow = [...musicTrackList.querySelectorAll(".admin-music-track-row")]
    .find((row) => row.dataset.trackId === draggedMusicTrackId);
  if (!draggedRow) return;
  const bounds = target.getBoundingClientRect();
  musicTrackList.insertBefore(
    draggedRow,
    event.clientY < bounds.top + bounds.height / 2 ? target : target.nextSibling,
  );
});

musicTrackList.addEventListener("drop", async (event) => {
  if (!draggedMusicTrackId || isSavingMusicOrder) return;
  event.preventDefault();
  const orderedIds = [...musicTrackList.querySelectorAll(".admin-music-track-row")]
    .map((row) => row.dataset.trackId);
  const tracksById = new Map(musicTracks.map((track) => [track.id, track]));
  const orderedTracks = orderedIds.map((id) => tracksById.get(id)).filter(Boolean);
  draggedMusicTrackId = "";
  if (orderedTracks.length === musicTracks.length) {
    await saveMusicTrackOrder(orderedTracks);
  } else {
    renderMusicTracks();
  }
});

musicTrackList.addEventListener("dragend", () => {
  draggedMusicTrackId = "";
  musicTrackList.querySelector(".is-dragging")?.classList.remove("is-dragging");
  if (!isSavingMusicOrder) renderMusicTracks();
});

function updateSelectedImageMessage() {
  const localCount = publishImageInput.files.length;
  const total = localCount + selectedNewImagePaths.length;
  selectedImageCount.textContent = `${selectedNewImagePaths.length} 张图库图片、${localCount} 张本地图片（共 ${total}/10 张）。`;
  selectedImage.hidden = total === 0;
  selectedImageList.replaceChildren();

  for (const [index, path] of selectedNewImagePaths.entries()) {
    const item = document.createElement("div");
    item.className = "admin-selected-image-item";
    const name = document.createElement("span");
    name.textContent = `图库图片 ${index + 1}：${path.split("/").at(-1)}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "admin-selected-image-remove";
    remove.setAttribute("aria-label", `取消选择图库图片 ${path.split("/").at(-1)}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      selectedNewImagePaths = selectedNewImagePaths.filter((selectedPath) => selectedPath !== path);
      postContentInput.value = postContentInput.value.replaceAll(
        `{{image:library:${encodeURIComponent(path)}}}`,
        "",
      );
      updateSelectedImageMessage();
    });
    item.append(name, remove);
    selectedImageList.append(item);
  }

  for (const record of selectedLocalFiles) {
    const item = document.createElement("div");
    item.className = "admin-selected-image-item";
    const name = document.createElement("span");
    name.textContent = `本地图片：${record.file.name}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "admin-selected-image-remove";
    remove.setAttribute("aria-label", `取消选择本地图片 ${record.file.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      setSelectedLocalFiles(selectedLocalFiles.filter((selected) => selected !== record));
      uploadedInlineImagePaths.delete(record.inlineId);
      postContentInput.value = postContentInput.value.replaceAll(
        `{{image:local:${record.inlineId}}}`,
        "",
      );
      updateSelectedImageMessage();
    });
    item.append(name, remove);
    selectedImageList.append(item);
  }
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function createAdminPost(post) {
  const item = document.createElement("article");
  item.className = "admin-post-row";

  const details = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = post.title || "动态";
  const date = document.createElement("time");
  date.dateTime = post.created_at;
  date.textContent = formatDate(post.created_at);
  const content = document.createElement("p");
  content.textContent = post.content;
  details.append(title, date, content);
  if (post.images.length) {
    const previews = document.createElement("div");
    previews.className = "admin-post-images";
    for (const [index, path] of post.images.entries()) {
      const image = document.createElement("img");
      image.className = "admin-post-image-preview";
      image.src = publicImageUrl(path);
      image.alt = `${post.title || "动态"} 配图 ${index + 1}`;
      image.loading = "lazy";
      previews.append(image);
    }
    details.append(previews);
  }

  const actions = document.createElement("div");
  actions.className = "admin-post-actions";
  const visibility = document.createElement("span");
  visibility.className = post.published ? "admin-badge" : "admin-badge is-muted";
  visibility.textContent = post.published ? "已发布" : "已下架";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "admin-button admin-button-secondary";
  toggle.textContent = post.published ? "下架" : "重新发布";
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      await setPostPublished(session, post.id, !post.published);
      await refreshPosts();
    } catch (error) {
      setMessage(pageMessage, error.message, true);
      toggle.disabled = false;
    }
  });
  actions.append(visibility, toggle);
  item.append(details, actions);
  return item;
}

function createImageCard(object) {
  const path = object.path;
  const card = document.createElement("article");
  card.className = "admin-image-card";

  const image = document.createElement("img");
  image.src = publicImageUrl(path);
  image.alt = object.name;
  image.loading = "lazy";

  const name = document.createElement("p");
  name.className = "admin-image-name";
  name.textContent = object.name;

  const actions = document.createElement("div");
  actions.className = "admin-image-actions";
  const download = document.createElement("a");
  download.className = "admin-button admin-button-secondary";
  download.href = publicImageUrl(path, true);
  download.textContent = "下载";

  const attach = document.createElement("button");
  attach.type = "button";
  attach.className = "admin-button admin-button-secondary";
  attach.textContent = "用于新动态";
  attach.addEventListener("click", () => {
    if (selectedNewImagePaths.includes(path)) return;
    if (selectedNewImagePaths.length + publishImageInput.files.length >= 10) {
      setMessage(publishMessage, "每条动态最多添加 10 张图片。", true);
      return;
    }
    selectedNewImagePaths.push(path);
    updateSelectedImageMessage();
  });
  const insertInline = document.createElement("button");
  insertInline.type = "button";
  insertInline.className = "admin-button admin-button-secondary";
  insertInline.textContent = "插入到正文";
  insertInline.addEventListener("click", () => {
    if (!selectedNewImagePaths.includes(path)) {
      if (selectedNewImagePaths.length + selectedLocalFiles.length >= 10) {
        setMessage(publishMessage, "每条动态最多添加 10 张图片。", true);
        return;
      }
      selectedNewImagePaths.push(path);
      updateSelectedImageMessage();
    }
    insertInlineImageMarker(`{{image:library:${encodeURIComponent(path)}}}`);
  });
  const attachExisting = document.createElement("button");
  attachExisting.type = "button";
  attachExisting.className = "admin-button admin-button-secondary";
  attachExisting.textContent = "用于已有动态";
  attachExisting.addEventListener("click", () => {
    pendingExistingImagePath = path;
    setMessage(existingImageSelection, `已选择图片：${object.name}`);
  });
  actions.append(download, attach, insertInline, attachExisting);
  card.append(image, name, actions);
  return card;
}

async function refreshPosts() {
  const posts = await listAdminPosts(session);
  const selectedId = existingPostSelect.value;
  existingPostSelect.replaceChildren();
  for (const post of posts) {
    const option = document.createElement("option");
    option.value = post.id;
    option.textContent = post.title || `动态 · ${formatDate(post.created_at)}`;
    existingPostSelect.append(option);
  }
  if (posts.some((post) => post.id === selectedId)) {
    existingPostSelect.value = selectedId;
  }
  postList.replaceChildren(...posts.map(createAdminPost));
  if (!posts.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "还没有动态。发布第一条动态后会显示在这里。";
    postList.append(empty);
  }
}

attachExistingImageButton.addEventListener("click", async () => {
  if (!pendingExistingImagePath || !existingPostSelect.value) {
    setMessage(existingImageSelection, "请先选择一张图片和要添加图片的动态。", true);
    return;
  }

  attachExistingImageButton.disabled = true;
  setMessage(existingImageSelection, "正在添加图片到动态…");
  try {
    await attachPostImage(session, existingPostSelect.value, pendingExistingImagePath);
    setMessage(existingImageSelection, "图片已添加到动态相册。");
    await refreshPosts();
  } catch (error) {
    setMessage(existingImageSelection, error.message, true);
  } finally {
    attachExistingImageButton.disabled = false;
  }
});

async function refreshImages() {
  const images = await listAdminImages(session);
  const cards = images
    .filter((item) => item.id && item.name)
    .map(createImageCard);
  imageList.replaceChildren(...cards);
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "图库为空。上传图片后即可在动态中使用。";
    imageList.append(empty);
  }
}

async function showDashboard(currentSession) {
  session = currentSession;
  setMessage(loginMessage, "邮箱密码验证成功，正在检查管理员权限…");
  let allowed;
  try {
    allowed = await isBlogAdmin(session);
  } catch (error) {
    loginPanel.hidden = false;
    dashboard.hidden = true;
    setMessage(
      loginMessage,
      `账号已登录，但管理员权限检查失败：${error.message}`,
      true,
    );
    return;
  }

  if (!allowed) {
    await signOut();
    session = null;
    loginPanel.hidden = false;
    dashboard.hidden = true;
    setMessage(loginMessage, "此账号没有博客管理员权限。请使用管理员账号登录。", true);
    return;
  }

  loginPanel.hidden = true;
  dashboard.hidden = false;
  staticPublishDashboardSlot.append(staticPublishPanel);
  adminEmail.textContent = session.user.email || "管理员";
  setMessage(pageMessage, "");
  try {
    await Promise.all([refreshPosts(), refreshImages(), refreshMusicTracks()]);
  } catch (error) {
    setMessage(pageMessage, error.message, true);
  }
}

musicTrackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = musicTrackForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  let uploadedAudioUrl = "";
  let trackSaved = false;
  try {
    const data = new FormData(musicTrackForm);
    const title = String(data.get("title")).trim();
    if (!title) throw new Error("请填写歌曲名称。");
    const sourceType = String(data.get("sourceType"));
    const sourceInput = String(data.get("source")).trim();
    const audioFile = data.get("audioFile");
    let source;
    if (audioFile instanceof File && audioFile.size) {
      if (sourceType !== "audio") {
        throw new Error("上传音频文件时，请将音源类型设为“网站音频文件 / HTTPS 音频链接”。");
      }
      if (sourceInput) {
        throw new Error("请上传文件或填写音频链接，不能同时填写两者。");
      }
      setMessage(musicTrackMessage, `正在上传音频 ${audioFile.name}…`);
      uploadedAudioUrl = await uploadMusicAudio(session, audioFile);
      source = uploadedAudioUrl;
    } else {
      if (!sourceInput) throw new Error("请填写歌曲链接或选择音频文件。");
      setMessage(musicTrackMessage, "正在添加到公共歌单…");
      source = validateMusicSource(sourceType, sourceInput);
    }
    await addMusicTrack(session, {
      title,
      sourceType,
      source,
      sortOrder: Math.max(-1, ...musicTracks.map((track) => track.sort_order)) + 1,
    });
    trackSaved = true;
    musicTrackForm.reset();
    setMessage(musicTrackMessage, "已添加到公共歌单。");
    await refreshMusicTracks();
  } catch (error) {
    let detail = error.message;
    if (uploadedAudioUrl && !trackSaved) {
      try {
        await deleteUploadedMusicAudio(session, uploadedAudioUrl);
      } catch (cleanupError) {
        detail += ` 音频已上传但未加入歌单，且清理失败：${cleanupError.message}`;
      }
    } else if (trackSaved) {
      detail = `歌曲已添加，但歌单刷新失败：${error.message}`;
    }
    setMessage(musicTrackMessage, detail, true);
  } finally {
    submit.disabled = false;
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  setMessage(loginMessage, "正在连接 Supabase 并验证账号…");
  try {
    const data = new FormData(loginForm);
    const currentSession = await signIn(
      String(data.get("email")).trim(),
      String(data.get("password")),
    );
    await showDashboard(currentSession);
    loginForm.reset();
  } catch (error) {
    setMessage(loginMessage, `登录未完成：${error.message}`, true);
  } finally {
    submit.disabled = false;
  }
});

publishForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = publishForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  setMessage(publishMessage, "正在发布…");
  const uploadedPaths = [];
  try {
    const data = new FormData(publishForm);
    const files = [...selectedLocalFiles];
    if (files.length + selectedNewImagePaths.length > 10) {
      throw new Error("每条动态最多添加 10 张图片。");
    }
    const imagePaths = [...selectedNewImagePaths];
    for (const [index, record] of files.entries()) {
      setMessage(publishMessage, `正在上传图片（${index + 1}/${files.length}）…`);
      const path = await uploadImage(session, record.file);
      imagePaths.push(path);
      uploadedPaths.push(path);
      uploadedInlineImagePaths.set(record.inlineId, path);
    }
    setMessage(publishMessage, "图片上传完成，正在保存动态…");
    await publishPost(session, {
      title: String(data.get("title")).trim(),
      content: resolveInlineImageMarkers(String(data.get("content")).trim()),
      imagePaths,
    });
    publishForm.reset();
    selectedNewImagePaths = [];
    selectedLocalFiles = [];
    uploadedInlineImagePaths.clear();
    updateSelectedImageMessage();
    setMessage(publishMessage, "已发布，公开页面会自动显示这条动态。");
    try {
      await refreshPosts();
    } catch (error) {
      setMessage(publishMessage, `动态已发布，但列表刷新失败：${error.message}`, true);
    }
  } catch (error) {
    selectedNewImagePaths = [...new Set([...selectedNewImagePaths, ...uploadedPaths])];
    if (uploadedPaths.length) {
      setSelectedLocalFiles(files.slice(uploadedPaths.length));
    }
    updateSelectedImageMessage();
    setMessage(
      publishMessage,
      `${error.message}${uploadedPaths.length ? ` 已上传的 ${uploadedPaths.length} 张图片已保留在图库选择中，可重新提交。` : ""}`,
      true,
    );
  } finally {
    submit.disabled = false;
  }
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = [...imageInput.files];
  if (!files.length) {
    setMessage(uploadMessage, "请先选择至少一张图片。", true);
    return;
  }
  if (files.length > 10) {
    setMessage(uploadMessage, "每条动态最多选择 10 张图片。", true);
    return;
  }

  const submit = uploadForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  let uploaded = 0;
  try {
    const imagePaths = [];
    for (const file of files) {
      setMessage(uploadMessage, `正在上传 ${file.name}（${uploaded + 1}/${files.length}）…`);
      imagePaths.push(await uploadImage(session, file));
      uploaded += 1;
    }
    setMessage(uploadMessage, "图片已上传，正在创建相册动态…");
    await publishPost(session, {
      title: "图片分享",
      content: "",
      imagePaths,
    });
    imageInput.value = "";
    setMessage(uploadMessage, `已成功将 ${uploaded} 张图片发布为一条相册动态。`);
    try {
      await Promise.all([refreshPosts(), refreshImages()]);
    } catch (error) {
      setMessage(uploadMessage, `相册已发布，但列表刷新失败：${error.message}`, true);
    }
  } catch (error) {
    setMessage(
      uploadMessage,
      `相册发布未完成（已上传 ${uploaded}/${files.length} 张）：${error.message}${uploaded ? " 已上传的图片仍保存在图库中。" : ""}`,
      true,
    );
  } finally {
    submit.disabled = false;
  }
});

publishImageInput.addEventListener("change", () => {
  const newlyChosen = [...publishImageInput.files].filter(
    (file) =>
      !selectedLocalFiles.some(
        ({ file: selected }) =>
          selected.name === file.name &&
          selected.size === file.size &&
          selected.lastModified === file.lastModified,
      ),
  );
  const availableSlots = Math.max(
    0,
    10 - selectedNewImagePaths.length - selectedLocalFiles.length,
  );
  setSelectedLocalFiles([
    ...selectedLocalFiles,
    ...newlyChosen.slice(0, availableSlots).map((file) => ({
      file,
      inlineId: crypto.randomUUID(),
    })),
  ]);
  if (newlyChosen.length > availableSlots) {
    setMessage(publishMessage, "每条动态最多添加 10 张图片，超出的图片未加入。", true);
  }
  updateSelectedImageMessage();
});

inlineImageButton.addEventListener("click", () => {
  inlineSelection = {
    start: postContentInput.selectionStart,
    end: postContentInput.selectionEnd,
  };
  inlineImageInput.click();
});

inlineImageInput.addEventListener("change", () => {
  const [file] = inlineImageInput.files;
  inlineImageInput.value = "";
  if (!file) return;
  if (selectedNewImagePaths.length + selectedLocalFiles.length >= 10) {
    setMessage(publishMessage, "每条动态最多添加 10 张图片。", true);
    return;
  }
  const record = { file, inlineId: crypto.randomUUID() };
  if (insertInlineImageMarker(`{{image:local:${record.inlineId}}}`)) {
    setSelectedLocalFiles([...selectedLocalFiles, record]);
    updateSelectedImageMessage();
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await signOut();
    session = null;
    loginPanel.after(staticPublishPanel);
    dashboard.hidden = true;
    loginPanel.hidden = false;
    loginForm.reset();
    setMessage(loginMessage, "已安全退出。");
  } catch (error) {
    setMessage(pageMessage, error.message, true);
  } finally {
    logoutButton.disabled = false;
  }
});

if (!isConfigured()) {
  setMessage(loginMessage, getConfigurationError(), true);
  loginForm.querySelector('button[type="submit"]').disabled = true;
} else {
  try {
    const currentSession = await getSession();
    if (currentSession) await showDashboard(currentSession);
  } catch (error) {
    setMessage(loginMessage, error.message, true);
  }
}

import {
  getSession,
  getConfigurationError,
  isBlogAdmin,
  isConfigured,
  listAdminImages,
  listAdminPosts,
  publicImageUrl,
  publishPost,
  setPostPublished,
  setPostImage,
  signIn,
  signOut,
  uploadImage,
} from "./supabase.js?v=20261023-4";

const loginPanel = document.querySelector("[data-login-panel]");
const dashboard = document.querySelector("[data-dashboard]");
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
const selectedImage = document.querySelector("[data-selected-image]");
const selectedImagePath = document.querySelector("#selected-image-path");
const existingPostSelect = document.querySelector("[data-image-post-select]");
const existingImageSelection = document.querySelector("[data-existing-image-selection]");
const attachExistingImageButton = document.querySelector("[data-attach-existing-image]");
const logoutButton = document.querySelector("[data-logout]");

let session = null;
let pendingExistingImagePath = "";

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);
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
  if (post.image_path) {
    const image = document.createElement("img");
    image.className = "admin-post-image-preview";
    image.src = publicImageUrl(post.image_path);
    image.alt = post.title ? `${post.title} 配图` : "动态图片";
    image.loading = "lazy";
    details.append(image);
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
    selectedImagePath.value = path;
    selectedImage.textContent = `已选择：${object.name}`;
    selectedImage.hidden = false;
  });
  const attachExisting = document.createElement("button");
  attachExisting.type = "button";
  attachExisting.className = "admin-button admin-button-secondary";
  attachExisting.textContent = "用于已有动态";
  attachExisting.addEventListener("click", () => {
    pendingExistingImagePath = path;
    setMessage(existingImageSelection, `已选择图片：${object.name}`);
  });
  actions.append(download, attach, attachExisting);
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
    setMessage(existingImageSelection, "请先选择一张图片和要配图的动态。", true);
    return;
  }

  attachExistingImageButton.disabled = true;
  setMessage(existingImageSelection, "正在更新动态配图…");
  try {
    await setPostImage(session, existingPostSelect.value, pendingExistingImagePath);
    setMessage(existingImageSelection, "配图已添加到动态。");
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
  adminEmail.textContent = session.user.email || "管理员";
  setMessage(pageMessage, "");
  try {
    await Promise.all([refreshPosts(), refreshImages()]);
  } catch (error) {
    setMessage(pageMessage, error.message, true);
  }
}

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
  try {
    const data = new FormData(publishForm);
    await publishPost(session, {
      title: String(data.get("title")).trim(),
      content: String(data.get("content")).trim(),
      imagePath: selectedImagePath.value,
    });
    publishForm.reset();
    selectedImagePath.value = "";
    selectedImage.hidden = true;
    setMessage(publishMessage, "已发布，公开页面会自动显示这条动态。");
    await refreshPosts();
  } catch (error) {
    setMessage(publishMessage, error.message, true);
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

  const submit = uploadForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  const failures = [];
  let uploaded = 0;
  for (const file of files) {
    setMessage(uploadMessage, `正在上传 ${file.name}…`);
    try {
      const path = await uploadImage(session, file);
      uploaded += 1;
      selectedImagePath.value = path;
      selectedImage.textContent = `已选择：${file.name}（发布动态时会附上这张图片）`;
      selectedImage.hidden = false;
    } catch (error) {
      failures.push(error.message);
    }
  }

  imageInput.value = "";
  try {
    await refreshImages();
  } catch (error) {
    failures.push(error.message);
  }
  setMessage(
    uploadMessage,
    failures.length
      ? `成功上传 ${uploaded}/${files.length} 张。${failures.join("；")}`
      : `已成功上传 ${uploaded} 张图片。`,
    failures.length > 0,
  );
  submit.disabled = false;
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await signOut();
    session = null;
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

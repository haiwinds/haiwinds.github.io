import { staticPublishConfig } from "./static-publish-config.js?v=20261025-1";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGES = 10;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_SIZE = 25 * 1024 * 1024;
const PUBLISH_ENDPOINT_KEY = "haiwind-static-publish-endpoint";

const form = document.querySelector("[data-static-publish-form]");
const message = document.querySelector("[data-static-publish-message]");
const imageInput = document.querySelector("#static-post-images");
const successLink = document.querySelector("[data-static-publish-link]");
const endpointInput = document.querySelector("#static-publish-endpoint");
const usernameInput = document.querySelector("#static-publish-username");
const passwordInput = document.querySelector("#static-publish-password");
endpointInput.value =
  staticPublishConfig.endpoint ||
  localStorage.getItem(PUBLISH_ENDPOINT_KEY) ||
  "";

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function createImageId() {
  return `static-${crypto.randomUUID()}`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  successLink.hidden = true;
  const files = [...imageInput.files];
  if (files.length > MAX_IMAGES) {
    setMessage(`每条动态最多选择 ${MAX_IMAGES} 张图片。`, true);
    return;
  }
  const invalidFile = files.find(
    (file) =>
      !ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_SIZE,
  );
  if (invalidFile) {
    setMessage(
      `${invalidFile.name}：仅支持 JPG、PNG、WebP 或 GIF，单张不能超过 10 MB。`,
      true,
    );
    return;
  }
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  if (totalSize > MAX_TOTAL_IMAGE_SIZE) {
    setMessage("所选图片总大小不能超过 25 MB。", true);
    return;
  }
  let endpoint;
  try {
    endpoint = new URL(endpointInput.value);
  } catch {
    setMessage("请填写有效的 Cloudflare Worker HTTPS 地址。", true);
    return;
  }
  if (endpoint.protocol !== "https:") {
    setMessage("发布服务地址必须使用 HTTPS。", true);
    return;
  }
  if (!usernameInput.value || !passwordInput.value) {
    setMessage("请输入 Cloudflare 发布服务的账号和密码。", true);
    return;
  }

  const data = new FormData(form);
  const title = String(data.get("title")).trim();
  const content = String(data.get("content")).trim();
  if (!title && !content && !files.length) {
    setMessage("请填写标题或内容，或至少选择一张图片。", true);
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  const id = createImageId();
  setMessage("正在准备动态和图片…");
  try {
    localStorage.setItem(PUBLISH_ENDPOINT_KEY, endpoint.toString());
    const images = [];
    for (const [index, file] of files.entries()) {
      setMessage(`正在准备图片（${index + 1}/${files.length}）…`);
      images.push({
        name: file.name,
        type: file.type,
        data: await fileToBase64(file),
      });
    }

    setMessage("正在安全提交到 GitHub…");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value,
        post: {
          id,
          title: title || (files.length ? "图片分享" : "动态"),
          content: content || (files.length ? `分享了 ${files.length} 张图片。` : ""),
        },
        images,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `发布失败（HTTP ${response.status}）。`);
    }

    form.reset();
    endpointInput.value = endpoint.toString();
    passwordInput.value = "";
    setMessage(
      "动态已直接提交到 GitHub。GitHub Pages 部署通常需要几分钟。",
    );
    if (result.commit) {
      successLink.href = `https://github.com/haiwinds/haiwinds.github.io/commit/${encodeURIComponent(result.commit)}`;
      successLink.hidden = false;
    }
  } catch (error) {
    const detail =
      error instanceof TypeError
        ? "无法连接发布服务。请检查 Worker 地址、Cloudflare 部署状态和允许的站点域名。"
        : error.message;
    setMessage(`直接发布失败：${detail}`, true);
  } finally {
    submit.disabled = false;
  }
});

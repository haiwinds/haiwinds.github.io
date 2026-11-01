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
const inlineImageInput = document.querySelector("#static-inline-image-file");
const inlineImageButton = document.querySelector("[data-static-insert-inline-image]");
const contentInput = document.querySelector("#static-post-content");
const successLink = document.querySelector("[data-static-publish-link]");
const endpointInput = document.querySelector("#static-publish-endpoint");
const usernameInput = document.querySelector("#static-publish-username");
const passwordInput = document.querySelector("#static-publish-password");
let selectedImages = [];
let inlineSelection = null;
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

function setSelectedImages(images) {
  const transfer = new DataTransfer();
  for (const image of images) transfer.items.add(image.file);
  imageInput.files = transfer.files;
  selectedImages = images;
}

function insertInlineMarker(marker) {
  const content = contentInput.value;
  const start = inlineSelection?.start ?? contentInput.selectionStart;
  const end = inlineSelection?.end ?? contentInput.selectionEnd;
  inlineSelection = null;
  const before = start > 0 && content[start - 1] !== "\n" ? "\n" : "";
  const after = end < content.length && content[end] !== "\n" ? "\n" : "";
  const insertion = `${before}${marker}${after}`;
  if (content.length - (end - start) + insertion.length > contentInput.maxLength) {
    setMessage("正文已达到字数上限，无法插入图片。", true);
    return false;
  }
  contentInput.setRangeText(insertion, start, end, "end");
  contentInput.focus();
  return true;
}

imageInput.addEventListener("change", () => {
  const newlyChosen = [...imageInput.files].filter(
    (file) =>
      !selectedImages.some(
        ({ file: selected }) =>
          selected.name === file.name &&
          selected.size === file.size &&
          selected.lastModified === file.lastModified,
      ),
  );
  const availableSlots = Math.max(0, MAX_IMAGES - selectedImages.length);
  setSelectedImages([
    ...selectedImages,
    ...newlyChosen.slice(0, availableSlots).map((file) => ({
      file,
      inlineId: crypto.randomUUID(),
    })),
  ]);
  if (newlyChosen.length > availableSlots) {
    setMessage(`每条动态最多选择 ${MAX_IMAGES} 张图片，超出的图片未加入。`, true);
  }
});

inlineImageButton.addEventListener("click", () => {
  inlineSelection = {
    start: contentInput.selectionStart,
    end: contentInput.selectionEnd,
  };
  inlineImageInput.click();
});

inlineImageInput.addEventListener("change", () => {
  const [file] = inlineImageInput.files;
  inlineImageInput.value = "";
  if (!file) return;
  if (selectedImages.length >= MAX_IMAGES) {
    inlineSelection = null;
    setMessage(`每条动态最多选择 ${MAX_IMAGES} 张图片。`, true);
    return;
  }
  const image = { file, inlineId: crypto.randomUUID() };
  if (insertInlineMarker(`{{image:local:${image.inlineId}}}`)) {
    setSelectedImages([...selectedImages, image]);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  successLink.hidden = true;
  const files = [...selectedImages];
  if (files.length > MAX_IMAGES) {
    setMessage(`每条动态最多选择 ${MAX_IMAGES} 张图片。`, true);
    return;
  }
  const invalidFile = files.find(
    ({ file }) =>
      !ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_SIZE,
  );
  if (invalidFile) {
    setMessage(
      `${invalidFile.file.name}：仅支持 JPG、PNG、WebP 或 GIF，单张不能超过 10 MB。`,
      true,
    );
    return;
  }
  const totalSize = files.reduce((total, { file }) => total + file.size, 0);
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
  let content = String(data.get("content")).trim();
  let invalidInlineImage = false;
  content = content.replace(/\{\{image:local:([^}]+)\}\}/g, (marker, inlineId) => {
    const imageIndex = selectedImages.findIndex((image) => image.inlineId === inlineId);
    if (imageIndex < 0) {
      invalidInlineImage = true;
      return marker;
    }
    return `{{image:${imageIndex}}}`;
  });
  if (invalidInlineImage) {
    setMessage("正文中的图片未加入发布列表，请重新选择并插入图片。", true);
    return;
  }
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
    for (const [index, record] of files.entries()) {
      const { file } = record;
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
    selectedImages = [];
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

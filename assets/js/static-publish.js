const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGES = 10;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

const form = document.querySelector("[data-static-publish-form]");
const message = document.querySelector("[data-static-publish-message]");
const imageInput = document.querySelector("#static-post-images");
const result = document.querySelector("[data-static-export-result]");
const postDownload = document.querySelector("[data-static-post-download]");
const imageDownloads = document.querySelector("[data-static-image-downloads]");
let objectUrls = [];

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

function safeFilename(value) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-80) || "image"
  );
}

function downloadUrl(blob, filename) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  return link;
}

function clearExport() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
  result.hidden = true;
  postDownload.replaceChildren();
  imageDownloads.replaceChildren();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearExport();

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

  const data = new FormData(form);
  const id = `static-${crypto.randomUUID()}`;
  const title = String(data.get("title")).trim();
  const content = String(data.get("content")).trim();
  if (!title && !content && !files.length) {
    setMessage("请填写标题或内容，或至少选择一张图片。", true);
    return;
  }

  const images = files.map((file, index) => {
    const filename = `${id.slice(7, 19)}-${String(index + 1).padStart(2, "0")}-${safeFilename(file.name)}`;
    const path = `/images/posts/${filename}`;
    const link = downloadUrl(file, filename);
    link.textContent = `下载图片 ${index + 1}：${file.name}`;
    imageDownloads.append(link);
    return path;
  });
  const post = {
    id,
    title: title || (images.length ? "图片分享" : "动态"),
    content: content || (images.length ? `分享了 ${images.length} 张图片。` : ""),
    created_at: new Date().toISOString(),
    images,
  };

  const postFile = downloadUrl(
    new Blob([`${JSON.stringify(post, null, 2)}\n`], {
      type: "application/json",
    }),
    `${id}.json`,
  );
  postFile.textContent = `下载动态数据：${post.title}`;
  postDownload.append(postFile);
  result.hidden = false;
  setMessage("备用发布文件已生成。按下方步骤把数据和图片加入 GitHub 仓库并提交。");
});

form.addEventListener("reset", clearExport);
window.addEventListener("pagehide", clearExport);

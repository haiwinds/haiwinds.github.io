import {
  isConfigured,
  listPublicImages,
  publicImageUrl,
} from "./supabase.js?v=20261023-7";

const grid = document.querySelector("[data-gallery-grid]");
const status = document.querySelector("[data-gallery-status]");
const count = document.querySelector("[data-gallery-count]");

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function createImageCard(image) {
  const link = document.createElement("a");
  link.className = "gallery-card";
  link.href = publicImageUrl(image.path);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `查看原图：${image.name}`);

  const preview = document.createElement("div");
  preview.className = "gallery-image-wrap";
  const img = document.createElement("img");
  img.src = publicImageUrl(image.path);
  img.alt = image.name || "博客图片";
  img.loading = "lazy";
  preview.append(img);

  const caption = document.createElement("div");
  caption.className = "gallery-card-caption";
  const name = document.createElement("span");
  name.textContent = image.name || "图片";
  caption.append(name);

  const dateText = formatDate(image.created_at);
  if (dateText) {
    const date = document.createElement("time");
    date.dateTime = image.created_at;
    date.textContent = dateText;
    caption.append(date);
  }

  link.append(preview, caption);
  return link;
}

async function loadGallery() {
  if (!grid || !status) return;
  if (!isConfigured()) {
    status.textContent = "图片浏览功能尚未配置 Supabase。";
    return;
  }

  try {
    const images = await listPublicImages();
    grid.replaceChildren(...images.map(createImageCard));
    count.textContent = `${images.length} 张`;
    status.textContent = images.length
      ? ""
      : "相册还没有图片。上传到博客的图片会显示在这里。";
  } catch (error) {
    status.textContent = `暂时无法加载相册：${error.message}。请确认 Supabase 已执行最新的 supabase/schema.sql。`;
  }
}

loadGallery();

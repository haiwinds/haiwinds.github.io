import {
  listPublicImages,
  publicImageUrl,
} from "./supabase.js?v=20261102-3";

const grid = document.querySelector("[data-gallery-grid]");
const status = document.querySelector("[data-gallery-status]");
const count = document.querySelector("[data-gallery-count]");
const searchForm = document.querySelector("[data-site-search]");
const searchInput = searchForm?.querySelector("input");
let imagesLoaded = false;

function filterImages() {
  if (!imagesLoaded || !searchInput) return;
  const searchTerm = searchInput.value.trim().toLocaleLowerCase("zh-CN");
  let visibleImages = 0;
  for (const card of grid.children) {
    const matches = card.dataset.searchText.includes(searchTerm);
    card.hidden = !matches;
    if (matches) visibleImages += 1;
  }
  status.textContent =
    searchTerm && visibleImages === 0
      ? "没有找到匹配的图片。"
      : "";
}

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
  link.dataset.searchText = `${image.name || ""} ${formatDate(image.created_at)}`.toLocaleLowerCase("zh-CN");
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

  const dateText = formatDate(image.created_at);
  let date;
  if (dateText) {
    date = document.createElement("time");
    date.className = "gallery-card-date";
    date.dateTime = image.created_at;
    date.textContent = dateText;
  }

  link.append(preview);
  if (date) link.append(date);
  return link;
}

async function loadGallery() {
  if (!grid || !status) return;
  if (searchInput) {
    searchInput.value = new URLSearchParams(location.search).get("q") || "";
  }
  try {
    const images = await listPublicImages();
    grid.replaceChildren(...images.map(createImageCard));
    imagesLoaded = true;
    count.textContent = `${images.length} 张`;
    if (images.length) {
      filterImages();
    } else {
      status.textContent = "相册还没有图片。上传到博客的图片会显示在这里。";
    }
  } catch (error) {
    status.textContent = `暂时无法加载相册：${error.message}。请确认 Supabase 已执行最新的 supabase/schema.sql。`;
  }
}

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  filterImages();
});

searchInput?.addEventListener("input", filterImages);

loadGallery();

import {
  isConfigured,
  listPublicPosts,
  publicImageUrl,
  searchPublicPosts,
} from "./supabase.js?v=20261023-10";

const feed = document.querySelector("[data-live-feed]");
const status = document.querySelector("[data-live-feed-status]");
const searchForm = document.querySelector("[data-site-search]");
const searchInput = searchForm?.querySelector("input");
let postsLoaded = false;
let defaultPosts = [];
let searchRequest = 0;
let searchTimeout;

function renderFeed(posts) {
  feed.replaceChildren(...posts.map(renderPost));
}

async function searchFeed() {
  if (!postsLoaded || !searchInput || !feed || !status) return;
  const searchTerm = searchInput.value.trim().toLocaleLowerCase("zh-CN");
  const requestId = ++searchRequest;
  if (!searchTerm) {
    renderFeed(defaultPosts);
    status.textContent = defaultPosts.length ? "" : "还没有发布动态。";
    return;
  }

  status.textContent = "正在搜索已发布动态…";
  try {
    const posts = await searchPublicPosts(searchTerm);
    if (requestId !== searchRequest) return;
    renderFeed(posts);
    status.textContent = posts.length ? "" : "没有找到匹配的动态。";
  } catch (error) {
    if (requestId !== searchRequest) return;
    status.textContent = `搜索动态失败：${error.message}`;
  }
}

function renderPost(post) {
  const card = document.createElement("a");
  card.className = "live-post";
  if (post.image_path) card.classList.add("has-image");
  card.href = `/post/view/?id=${encodeURIComponent(post.id)}`;
  card.setAttribute("aria-label", `阅读全文：${post.title || "动态"}`);

  if (post.image_path) {
    const image = document.createElement("img");
    image.src = publicImageUrl(post.image_path);
    image.alt = post.title ? `${post.title} 配图` : "动态图片";
    image.loading = "lazy";
    card.append(image);
  }

  const heading = document.createElement("h3");
  heading.textContent = post.title || "动态";
  card.append(heading);

  const date = document.createElement("time");
  date.className = "live-post-date";
  date.dateTime = post.created_at;
  date.textContent = new Date(post.created_at).toLocaleString("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  card.append(date);

  const content = document.createElement("p");
  content.className = "live-post-content";
  content.textContent = post.content;
  card.append(content);

  const more = document.createElement("span");
  more.className = "live-post-more";
  more.textContent = "查看动态 →";
  card.append(more);

  return card;
}

async function loadFeed() {
  if (!feed || !status) return;
  if (searchInput) {
    searchInput.value = new URLSearchParams(location.search).get("q") || "";
  }
  if (!isConfigured()) {
    status.textContent = "动态发布功能尚未配置 Supabase。";
    return;
  }

  status.textContent = "正在加载动态…";
  try {
    const requestedLimit = Number(feed.dataset.postLimit);
    const posts = await listPublicPosts(
      Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 6,
    );
    defaultPosts = posts;
    renderFeed(posts);
    postsLoaded = true;
    if (searchInput?.value.trim()) {
      searchFeed();
    } else if (posts.length) {
      status.textContent = "";
    } else {
      status.textContent = "还没有发布动态。";
    }
  } catch (error) {
    status.textContent = `暂时无法加载动态：${error.message}`;
  }
}

searchForm?.addEventListener("submit", (event) => {
  if (!feed) return;
  event.preventDefault();
  clearTimeout(searchTimeout);
  searchFeed();
  document.querySelector("#latest-updates")?.scrollIntoView({ behavior: "smooth" });
});

searchInput?.addEventListener("input", () => {
  searchRequest += 1;
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(searchFeed, 250);
});

loadFeed();

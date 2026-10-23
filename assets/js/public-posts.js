import {
  isConfigured,
  listPublicPosts,
  publicImageUrl,
} from "./supabase.js?v=20261023-7";

const feed = document.querySelector("[data-live-feed]");
const status = document.querySelector("[data-live-feed-status]");
const searchForm = document.querySelector("[data-home-search]");
const searchInput = searchForm?.querySelector("input");
let postsLoaded = false;

function filterFeed() {
  if (!postsLoaded || !searchInput) return;
  const searchTerm = searchInput.value.trim().toLocaleLowerCase("zh-CN");
  let visiblePosts = 0;
  for (const card of feed.children) {
    const matches = card.textContent.toLocaleLowerCase("zh-CN").includes(searchTerm);
    card.hidden = !matches;
    if (matches) visiblePosts += 1;
  }
  status.textContent =
    searchTerm && visiblePosts === 0
      ? "没有找到匹配的动态。"
      : "";
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
    feed.replaceChildren(...posts.map(renderPost));
    postsLoaded = true;
    if (posts.length) {
      filterFeed();
    } else {
      status.textContent = "还没有发布动态。";
    }
  } catch (error) {
    status.textContent = `暂时无法加载动态：${error.message}`;
  }
}

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  filterFeed();
  document.querySelector("#latest-updates")?.scrollIntoView({ behavior: "smooth" });
});

searchInput?.addEventListener("input", filterFeed);

loadFeed();

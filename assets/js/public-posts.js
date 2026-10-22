import {
  isConfigured,
  listPublicPosts,
  publicImageUrl,
} from "./supabase.js?v=20261023-4";

const feed = document.querySelector("[data-live-feed]");
const status = document.querySelector("[data-live-feed-status]");

function renderPost(post) {
  const card = document.createElement("a");
  card.className = "live-post";
  card.href = `/post/view/?id=${encodeURIComponent(post.id)}`;
  card.setAttribute("aria-label", `阅读全文：${post.title || "动态"}`);

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

  if (post.image_path) {
    const image = document.createElement("img");
    image.src = publicImageUrl(post.image_path);
    image.alt = post.title ? `${post.title} 配图` : "动态图片";
    image.loading = "lazy";
    card.append(image);
  }

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
    const posts = await listPublicPosts();
    feed.replaceChildren(...posts.map(renderPost));
    status.textContent = posts.length ? "" : "还没有发布动态。";
  } catch (error) {
    status.textContent = `暂时无法加载动态：${error.message}`;
  }
}

loadFeed();

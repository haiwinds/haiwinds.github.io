import {
  getPublicPost,
  isConfigured,
  publicImageUrl,
} from "./supabase.js?v=20261023-7";

const status = document.querySelector("[data-post-status]");
const article = document.querySelector("[data-post-content]");
const title = document.querySelector("[data-post-title]");
const date = document.querySelector("[data-post-date]");
const body = document.querySelector("[data-post-body]");
const image = document.querySelector("[data-post-image]");
const download = document.querySelector("[data-post-download]");
const postId = new URLSearchParams(location.search).get("id");

function showMessage(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
  status.hidden = false;
}

async function loadPost() {
  if (!postId || !/^[0-9a-f-]{36}$/i.test(postId)) {
    showMessage("动态链接无效。", true);
    return;
  }
  if (!isConfigured()) {
    showMessage("动态服务尚未配置。请稍后再试。", true);
    return;
  }

  try {
    const post = await getPublicPost(postId);
    if (!post) {
      showMessage("这条动态不存在，或已被作者下架。", true);
      return;
    }

    title.textContent = post.title || "动态";
    date.dateTime = post.created_at;
    date.textContent = new Date(post.created_at).toLocaleString("zh-CN", {
      dateStyle: "long",
      timeStyle: "short",
    });
    body.textContent = post.content;

    if (post.image_path) {
      image.src = publicImageUrl(post.image_path);
      image.alt = post.title ? `${post.title} 配图` : "动态图片";
      image.hidden = false;
      download.href = publicImageUrl(post.image_path, true);
      download.hidden = false;
    }

    article.hidden = false;
    status.hidden = true;
    document.title = `${post.title || "动态"} | Haiwind`;
  } catch (error) {
    showMessage(`加载动态失败：${error.message}`, true);
  }
}

loadPost();

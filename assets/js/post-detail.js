import {
  getPublicPost,
  isConfigured,
  publicImageUrl,
} from "./supabase.js?v=20261023-11";

const status = document.querySelector("[data-post-status]");
const article = document.querySelector("[data-post-content]");
const title = document.querySelector("[data-post-title]");
const date = document.querySelector("[data-post-date]");
const body = document.querySelector("[data-post-body]");
const images = document.querySelector("[data-post-images]");
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

    for (const [index, path] of post.images.entries()) {
      const figure = document.createElement("figure");
      figure.className = "post-detail-photo";
      const imageLink = document.createElement("a");
      imageLink.href = publicImageUrl(path);
      imageLink.target = "_blank";
      imageLink.rel = "noopener noreferrer";
      imageLink.setAttribute("aria-label", `在新窗口查看图片 ${index + 1}`);
      const image = document.createElement("img");
      image.className = "post-detail-image";
      image.src = publicImageUrl(path);
      image.alt = `${post.title || "动态"} 配图 ${index + 1}`;
      image.loading = "lazy";
      image.addEventListener("error", () => {
        figure.remove();
        if (!images.querySelector(".post-detail-photo")) {
          images.textContent = "图片暂时无法加载，请确认图片仍保存在 Supabase Storage 中。";
          images.classList.add("post-detail-image-error");
        }
      }, { once: true });
      imageLink.append(image);
      const download = document.createElement("a");
      download.className = "admin-button admin-button-secondary post-image-download";
      download.href = publicImageUrl(path, true);
      download.textContent = `下载图片 ${index + 1}`;
      figure.append(imageLink, download);
      images.append(figure);
    }

    article.hidden = false;
    status.hidden = true;
    document.title = `${post.title || "动态"} | Haiwind`;
  } catch (error) {
    showMessage(`加载动态失败：${error.message}`, true);
  }
}

loadPost();

const STATIC_POSTS_URL = "/data/static-posts.json";

export async function listStaticPosts() {
  const response = await fetch(STATIC_POSTS_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`静态动态文件读取失败（HTTP ${response.status}）。`);
  }

  const posts = await response.json();
  if (!Array.isArray(posts)) {
    throw new Error("data/static-posts.json 格式无效，预期内容为动态数组。");
  }

  return posts.map(normalizeStaticPost);
}

function normalizeStaticPost(post) {
  if (
    !post ||
    typeof post.id !== "string" ||
    !/^static-[a-z0-9-]+$/i.test(post.id) ||
    typeof post.title !== "string" ||
    typeof post.content !== "string" ||
    typeof post.created_at !== "string" ||
    Number.isNaN(Date.parse(post.created_at))
  ) {
    throw new Error("静态动态记录格式无效，请检查 data/static-posts.json。");
  }

  const images = post.images ?? (post.image_path ? [post.image_path] : []);
  if (
    !Array.isArray(images) ||
    images.length > 10 ||
    images.some(
      (path) =>
        typeof path !== "string" ||
        !path.startsWith("/images/posts/") ||
        path.includes("..") ||
        path.includes("\\"),
    )
  ) {
    throw new Error(`静态动态“${post.title || post.id}”的图片路径无效。`);
  }

  return {
    id: post.id,
    title: post.title,
    content: post.content,
    created_at: post.created_at,
    image_path: images[0] || null,
    images,
    published: true,
    is_static: true,
  };
}

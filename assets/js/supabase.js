import { listStaticPosts } from "./static-posts.js?v=20261024-1";
import { supabaseConfig } from "./supabase-config.js?v=20261023-11";

const SESSION_KEY = "haiwind-supabase-session";
const PUBLIC_POSTS_CACHE_KEY = "haiwind-public-posts";
const PUBLIC_POSTS_CACHE_MS = 30000;
const PUBLIC_IMAGES_CACHE_KEY = "haiwind-public-images";
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function mergePosts(...groups) {
  const postsById = new Map();
  for (const posts of groups) {
    for (const post of posts) postsById.set(post.id, post);
  }
  return [...postsById.values()].sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  );
}

async function getStaticPosts() {
  try {
    return await listStaticPosts();
  } catch (error) {
    console.error("Could not load GitHub Pages backup posts:", error);
    return [];
  }
}

function staticPostImages(posts) {
  return posts.flatMap((post) =>
    post.images.map((path, index) => ({
      id: `${post.id}-${index}`,
      name: path.split("/").at(-1),
      path,
      created_at: post.created_at,
    })),
  );
}

export function isConfigured() {
  return getConfigurationError() === null;
}

export function getConfigurationError() {
  let projectUrl;
  try {
    projectUrl = new URL(supabaseConfig.url);
  } catch {
    return "Supabase Project URL 无效。请从项目 API 设置中复制 Project URL。";
  }

  if (
    projectUrl.protocol !== "https:" ||
    !projectUrl.hostname.endsWith(".supabase.co") ||
    (projectUrl.pathname !== "" && projectUrl.pathname !== "/") ||
    projectUrl.search ||
    projectUrl.hash
  ) {
    return "Supabase Project URL 应为 https://<项目编号>.supabase.co，不要包含 /dashboard、/rest/v1 等路径。请从 Supabase 项目的 Settings → API 中复制 Project URL。";
  }

  if (!supabaseConfig.anonKey || supabaseConfig.anonKey.startsWith("YOUR_")) {
    return "请在 assets/js/supabase-config.js 中填写 Supabase publishable/anon key。";
  }

  return null;
}

function requireConfiguration() {
  const error = getConfigurationError();
  if (error) throw new Error(error);
}

async function request(path, { method = "GET", body, token, headers = {} } = {}) {
  requireConfiguration();
  const requestHeaders = {
    apikey: supabaseConfig.anonKey,
    Authorization: `Bearer ${token || supabaseConfig.anonKey}`,
    ...headers,
  };

  let requestBody = body;
  if (
    body !== undefined &&
    !(body instanceof FormData) &&
    !(body instanceof Blob)
  ) {
    requestHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  const baseUrl = new URL(supabaseConfig.url).origin;
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error("Supabase 响应超时（20 秒）。请稍后重试，并检查项目是否正在休眠。");
    }
    if (error instanceof TypeError) {
      throw new Error("无法连接 Supabase。请检查网络、Project URL 以及 Supabase 项目状态。");
    }
    throw error;
  }
  if (!response.ok) {
    let detail = "";
    try {
      const result = await response.json();
      detail = result.message || result.msg || result.error_description || result.error || "";
    } catch {
      detail = "";
    }
    if (/invalid login credentials/i.test(detail)) {
      detail = "邮箱或密码不正确。请确认使用的是 Supabase Authentication 用户账号，而不是 Supabase 控制台账号。";
    } else if (/email not confirmed/i.test(detail)) {
      detail = "该邮箱尚未确认。请在 Supabase Authentication → Users 中确认用户邮箱后再登录。";
    } else if (/too many requests|rate limit/i.test(detail)) {
      detail = "登录尝试过于频繁，请稍等几分钟后重试。";
    } else if (/function .*is_blog_admin.*(not found|does not exist)/i.test(detail)) {
      detail = "Supabase 数据库结构未更新。请在 SQL Editor 重新执行仓库中的 supabase/schema.sql。";
    } else if (/function .*publish_post.*(not found|schema cache)/i.test(detail)) {
      detail = "Supabase 发布函数尚未更新。请在 SQL Editor 重新执行仓库中的 supabase/schema.sql，然后刷新管理页面。";
    }
    throw new Error(detail || `Supabase 请求失败（HTTP ${response.status}）。`);
  }

  if (response.status === 204) return null;
  const responseText = await response.text();
  if (!responseText) return null;
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export async function getSession() {
  requireConfiguration();
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;

  let session;
  try {
    session = JSON.parse(stored);
  } catch {
    clearSession();
    return null;
  }

  if (!session.access_token || !session.refresh_token || !session.user?.id) {
    clearSession();
    return null;
  }

  if (session.expires_at <= Math.floor(Date.now() / 1000) + 60) {
    try {
      const refreshed = await request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: session.refresh_token },
      });
      session = {
        ...refreshed,
        expires_at:
          refreshed.expires_at ||
          Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600),
      };
      saveSession(session);
    } catch (error) {
      clearSession();
      throw new Error(`登录已过期，请重新登录。${error.message}`);
    }
  }

  return session;
}

export async function signIn(email, password) {
  const session = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  const completeSession = {
    ...session,
    expires_at:
      session.expires_at ||
      Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
  };
  saveSession(completeSession);
  return completeSession;
}

export async function signOut() {
  const session = await getSession();
  if (!session) return;
  try {
    await request("/auth/v1/logout", {
      method: "POST",
      token: session.access_token,
    });
  } finally {
    clearSession();
  }
}

export async function isBlogAdmin(session) {
  const result = await request("/rest/v1/rpc/is_blog_admin", {
    method: "POST",
    body: {},
    token: session.access_token,
  });
  return result === true;
}

export function publicImageUrl(path, download = false) {
  if (path.startsWith("/") && !path.startsWith("//")) {
    return new URL(path, location.origin).toString();
  }
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(
    `/storage/v1/object/public/blog-images/${encodedPath}`,
    supabaseConfig.url,
  );
  if (download) url.searchParams.set("download", path.split("/").at(-1) || "image");
  return url.toString();
}

function withPostImages(post) {
  const images = (post.post_images || [])
    .sort((left, right) => left.position - right.position)
    .map((image) => image.image_path)
    .filter(Boolean);
  if (post.image_path && !images.includes(post.image_path)) {
    images.unshift(post.image_path);
  }
  return { ...post, images: [...new Set(images)] };
}

export async function listPublicPosts(limit = 6) {
  const staticPosts = await getStaticPosts();
  const cacheKey = `${PUBLIC_POSTS_CACHE_KEY}-${limit}`;
  const cachedValue = sessionStorage.getItem(cacheKey);
  let cachedPosts = [];
  if (cachedValue) {
    try {
      const cached = JSON.parse(cachedValue);
      if (Array.isArray(cached.posts)) {
        cachedPosts = cached.posts.map(withPostImages);
        if (Date.now() - cached.savedAt < PUBLIC_POSTS_CACHE_MS) {
          return mergePosts(staticPosts, cachedPosts).slice(0, limit);
        }
      }
    } catch {
      sessionStorage.removeItem(cacheKey);
    }
  }

  const query = new URLSearchParams({
    select: "id,title,content,image_path,created_at,post_images(image_path,position)",
    published: "eq.true",
    order: "created_at.desc",
    limit: String(limit),
  });
  try {
    const posts = (await request(`/rest/v1/posts?${query}`)).map(withPostImages);
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ posts, savedAt: Date.now() }),
    );
    return mergePosts(staticPosts, posts).slice(0, limit);
  } catch (error) {
    const fallbackPosts = mergePosts(staticPosts, cachedPosts);
    if (fallbackPosts.length) return fallbackPosts.slice(0, limit);
    throw error;
  }
}

export async function searchPublicPosts(searchTerm) {
  const staticPosts = await getStaticPosts();
  const normalizedTerm = searchTerm.trim().toLocaleLowerCase("zh-CN");
  const staticMatches = staticPosts.filter((post) =>
    `${post.title}\n${post.content}`
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedTerm),
  );
  const escapedTerm = searchTerm
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("*", "\\*");
  const pattern = `"*${escapedTerm}*"`;
  const pageSize = 1000;
  const posts = [];
  let offset = 0;

  try {
    while (true) {
      const query = new URLSearchParams({
        select: "id,title,content,image_path,created_at,post_images(image_path,position)",
        published: "eq.true",
        or: `(title.ilike.${pattern},content.ilike.${pattern})`,
        order: "created_at.desc,id.desc",
        limit: String(pageSize),
        offset: String(offset),
      });
      const page = await request(`/rest/v1/posts?${query}`);
      posts.push(...page.map(withPostImages));
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  } catch (error) {
    if (staticPosts.length) return staticMatches;
    throw error;
  }

  return mergePosts(staticMatches, posts);
}

export async function listPublicImages() {
  const staticImages = staticPostImages(await getStaticPosts());
  const cachedValue = sessionStorage.getItem(PUBLIC_IMAGES_CACHE_KEY);
  if (cachedValue) {
    try {
      const cached = JSON.parse(cachedValue);
      if (
        Array.isArray(cached.images) &&
        Date.now() - cached.savedAt < PUBLIC_POSTS_CACHE_MS
      ) {
        return mergeImages(staticImages, cached.images);
      }
    } catch {
      sessionStorage.removeItem(PUBLIC_IMAGES_CACHE_KEY);
    }
  }

  if (!isConfigured()) return staticImages;
  try {
    const images = await listStorageImages("");
    images.sort((left, right) =>
      (right.created_at || "").localeCompare(left.created_at || ""),
    );
    sessionStorage.setItem(
      PUBLIC_IMAGES_CACHE_KEY,
      JSON.stringify({ images, savedAt: Date.now() }),
    );
    return mergeImages(staticImages, images);
  } catch (error) {
    if (staticImages.length) return staticImages;
    throw error;
  }
}

function mergeImages(...groups) {
  const imagesByPath = new Map();
  for (const images of groups) {
    for (const image of images) imagesByPath.set(image.path, image);
  }
  return [...imagesByPath.values()].sort((left, right) =>
    (right.created_at || "").localeCompare(left.created_at || ""),
  );
}

async function listStorageImages(prefix, token, depth = 0) {
  if (depth > 8) {
    throw new Error("图片目录层级异常，无法读取图库。");
  }

  const pageSize = 100;
  const entries = [];
  let offset = 0;
  while (true) {
    const page = await request("/storage/v1/object/list/blog-images", {
      method: "POST",
      body: {
        prefix,
        limit: pageSize,
        offset,
        sortBy: { column: "created_at", order: "desc" },
      },
      token,
    });
    entries.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  const files = entries.filter((entry) => entry.id);
  const folders = entries.filter((entry) => !entry.id && entry.name);
  const nestedImages = await Promise.all(
    folders.map((folder) =>
      listStorageImages(
        prefix ? `${prefix}/${folder.name}` : folder.name,
        token,
        depth + 1,
      ),
    ),
  );
  const images = [...nestedImages.flat()];
  for (const entry of files) {
    images.push({
      ...entry,
      path: prefix ? `${prefix}/${entry.name}` : entry.name,
    });
  }
  return images;
}

export async function getPublicPost(postId) {
  const staticPost = (await getStaticPosts()).find((post) => post.id === postId);
  if (staticPost) return staticPost;
  const query = new URLSearchParams({
    select: "id,title,content,image_path,created_at,post_images(image_path,position)",
    id: `eq.${postId}`,
    published: "eq.true",
    limit: "1",
  });
  const posts = await request(`/rest/v1/posts?${query}`);
  return posts[0] ? withPostImages(posts[0]) : null;
}

export async function listAdminPosts(session) {
  const query = new URLSearchParams({
    select: "id,title,content,image_path,published,created_at,post_images(image_path,position)",
    order: "created_at.desc",
    limit: "50",
  });
  const posts = await request(`/rest/v1/posts?${query}`, { token: session.access_token });
  return posts.map(withPostImages);
}

export async function setPostPublished(session, postId, published) {
  const query = new URLSearchParams({ id: `eq.${postId}` });
  const result = await request(`/rest/v1/posts?${query}`, {
    method: "PATCH",
    body: { published },
    token: session.access_token,
    headers: { Prefer: "return=minimal" },
  });
  clearPublicPostsCache();
  return result;
}

export async function attachPostImage(session, postId, imagePath) {
  const query = new URLSearchParams({
    select: "image_path,position",
    post_id: `eq.${postId}`,
    order: "position.desc",
  });
  const existing = await request(`/rest/v1/post_images?${query}`, {
    token: session.access_token,
  });
  if (existing.some((image) => image.image_path === imagePath)) return;
  if (existing.length >= 10) {
    throw new Error("每条动态最多添加 10 张图片。");
  }

  const result = await request("/rest/v1/post_images", {
    method: "POST",
    body: {
      post_id: postId,
      image_path: imagePath,
      position: existing.length ? existing[0].position + 1 : 0,
    },
    token: session.access_token,
    headers: { Prefer: "return=minimal" },
  });
  clearPublicPostsCache();
  return result;
}

export async function publishPost(
  session,
  { title, content, imagePath, imagePaths = [] },
) {
  const paths = [...new Set([...imagePaths, imagePath].filter(Boolean))];
  if (paths.length > 10) {
    throw new Error("每条动态最多添加 10 张图片。");
  }
  const postTitle = title.trim() || (paths.length ? "图片分享" : "");
  const postContent =
    content.trim() || (paths.length ? `分享了 ${paths.length} 张图片。` : "");
  if (!postContent) {
    throw new Error("请填写动态内容，或先选择一张图片。");
  }

  const result = await request("/rest/v1/rpc/publish_post", {
    method: "POST",
    body: {
      p_title: postTitle,
      p_content: postContent,
      p_image_paths: paths,
    },
    token: session.access_token,
  });
  clearPublicPostsCache();
  return result;
}

function clearPublicPostsCache() {
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(PUBLIC_POSTS_CACHE_KEY)) {
      sessionStorage.removeItem(key);
    }
  }
}

export async function uploadImage(session, file) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error(`${file.name}：仅支持 JPG、PNG、WebP 或 GIF 图片。`);
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error(`${file.name}：图片不能超过 10 MB。`);
  }

  const safeName =
    file.name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-100) || "image";
  const date = new Date().toISOString().slice(0, 10);
  const path = `${session.user.id}/${date}/${crypto.randomUUID()}-${safeName}`;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  await request(`/storage/v1/object/blog-images/${encodedPath}`, {
    method: "POST",
    body: file,
    token: session.access_token,
    headers: { "Content-Type": file.type, "x-upsert": "false" },
  });
  sessionStorage.removeItem(PUBLIC_IMAGES_CACHE_KEY);
  return path;
}

export async function listAdminImages(session) {
  return listStorageImages(session.user.id, session.access_token);
}

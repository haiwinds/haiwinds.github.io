const MAX_IMAGES = 10;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_SIZE = 25 * 1024 * 1024;
const MAX_REQUEST_SIZE = 36 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJsonBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw createError("请求内容为空。");

  const chunks = [];
  let totalSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > MAX_REQUEST_SIZE) {
      await reader.cancel();
      throw createError("图片总大小不能超过 25 MB。", 413);
    }
    chunks.push(value);
  }

  let body = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  chunks.length = 0;
  const text = new TextDecoder().decode(body);
  body = null;
  try {
    return JSON.parse(text);
  } catch {
    throw createError("请求内容不是有效的 JSON。");
  }
}

function imageSignatureMatches(bytes, type) {
  if (type === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte,
    );
  }
  if (type === "image/gif") {
    return (
      new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF87a" ||
      new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF89a"
    );
  }
  if (type === "image/webp") {
    return (
      new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
    );
  }
  return false;
}
function corsHeaders(origin, env) {
  if (!origin || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin, env),
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function credentialsMatch(username, password, env) {
  return (
    typeof username === "string" &&
    typeof password === "string" &&
    constantTimeEqual(username, env.PUBLISH_USERNAME || "") &&
    constantTimeEqual(password, env.PUBLISH_PASSWORD || "")
  );
}

function constantTimeEqual(left, right) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left.charCodeAt(index % Math.max(left.length, 1)) || 0) ^
      (right.charCodeAt(index % Math.max(right.length, 1)) || 0);
  }
  return difference === 0;
}

async function recordFailedAttempt(env, address) {
  const id = env.PUBLISH_RATE_LIMITER.idFromName(address);
  const limiter = env.PUBLISH_RATE_LIMITER.get(id);
  const response = await limiter.fetch("https://rate-limit/failure", {
    method: "POST",
  });
  return (await response.json()).limited;
}

async function clearFailedAttempts(env, address) {
  const id = env.PUBLISH_RATE_LIMITER.idFromName(address);
  const limiter = env.PUBLISH_RATE_LIMITER.get(id);
  await limiter.fetch("https://rate-limit/success", { method: "POST" });
}

function decodeBase64(value, label) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(MAX_IMAGE_SIZE / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw createError(`${label} 图片数据无效。`);
  }
  const binary = atob(value);
  if (binary.length > MAX_IMAGE_SIZE) {
    throw createError(`${label} 图片超过 10 MB。`, 413);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64Text(value) {
  const binary = atob(value.replace(/\s/g, ""));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function safeImageName(value) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-80) || "image"
  );
}

async function githubRequest(env, path, options = {}) {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`,
    {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "haiwind-static-publisher",
        ...options.headers,
      },
    },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw createError(
      detail.message || `GitHub API 请求失败（HTTP ${response.status}）。`,
      502,
    );
  }
  return response.status === 204 ? null : response.json();
}

async function createBlob(env, bytes) {
  return githubRequest(env, "/git/blobs", {
    method: "POST",
    body: JSON.stringify({
      content: toBase64(bytes),
      encoding: "base64",
    }),
  });
}

async function publishCommit(env, post, imageFiles) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reference = await githubRequest(
      env,
      `/git/ref/heads/${encodeURIComponent(env.GITHUB_BRANCH)}`,
    );
    const parentSha = reference.object.sha;
    const parent = await githubRequest(env, `/git/commits/${parentSha}`);
    const currentFile = await githubRequest(
      env,
      `/contents/data/static-posts.json?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`,
    );
    let content = currentFile.content;
    if (!content && currentFile.sha) {
      const blob = await githubRequest(env, `/git/blobs/${currentFile.sha}`);
      content = blob.content;
    }
    if (!content) {
      throw createError("无法读取 data/static-posts.json 的内容。", 502);
    }
    const currentPosts = JSON.parse(fromBase64Text(content));
    if (!Array.isArray(currentPosts)) {
      throw createError("data/static-posts.json 不是有效的动态数组。", 502);
    }
    if (currentPosts.some((existing) => existing.id === post.id)) {
      throw createError("这条动态已发布，请勿重复提交。", 409);
    }

    const entries = [];
    for (const image of imageFiles) {
      const blob = await createBlob(env, image.bytes);
      entries.push({
        path: image.path.slice(1),
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    const postBlob = await createBlob(
      env,
      new TextEncoder().encode(
        `${JSON.stringify([...currentPosts, post], null, 2)}\n`,
      ),
    );
    entries.push({
      path: "data/static-posts.json",
      mode: "100644",
      type: "blob",
      sha: postBlob.sha,
    });

    const tree = await githubRequest(env, "/git/trees", {
      method: "POST",
      body: JSON.stringify({ base_tree: parent.commit.tree.sha, tree: entries }),
    });
    const commit = await githubRequest(env, "/git/commits", {
      method: "POST",
      body: JSON.stringify({
        message: `Publish static post: ${post.title.slice(0, 70)}`,
        tree: tree.sha,
        parents: [parentSha],
      }),
    });

    const update = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/refs/heads/${encodeURIComponent(env.GITHUB_BRANCH)}`,
      {
        method: "PATCH",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "haiwind-static-publisher",
        },
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
    );
    if (update.ok) return commit.sha;
    if (update.status !== 409 && update.status !== 422) {
      const detail = await update.json().catch(() => ({}));
      throw createError(
        detail.message || `无法更新 GitHub 分支（HTTP ${update.status}）。`,
        502,
      );
    }
  }

  throw createError(
    "GitHub 分支连续发生更新冲突，请稍等片刻后重试。",
    409,
  );
}

function validatePost(input, imageCount) {
  if (
    !input ||
    typeof input.id !== "string" ||
    !/^static-[a-f0-9-]{36}$/i.test(input.id) ||
    typeof input.title !== "string" ||
    input.title.length > 120 ||
    typeof input.content !== "string" ||
    input.content.length > 10000 ||
    (!input.title.trim() && !input.content.trim() && imageCount === 0)
  ) {
    throw createError("动态内容无效。");
  }

  return {
    id: input.id,
    title: input.title.trim() || (imageCount ? "图片分享" : "动态"),
    content: input.content.trim() ||
      (imageCount ? `分享了 ${imageCount} 张图片。` : ""),
    created_at: new Date().toISOString(),
    images: [],
  };
}

async function handlePublish(request, env, origin) {
  if (
    !env.GITHUB_TOKEN ||
    !env.PUBLISH_USERNAME ||
    !env.PUBLISH_PASSWORD ||
    !env.PUBLISH_RATE_LIMITER ||
    !env.GITHUB_OWNER ||
    !env.GITHUB_REPO ||
    !env.GITHUB_BRANCH
  ) {
    return jsonResponse({ error: "发布服务尚未配置完整。" }, 503, origin, env);
  }

  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const size = Number(request.headers.get("Content-Length") || 0);
  if (size > MAX_REQUEST_SIZE) {
    return jsonResponse(
      { error: "图片总大小不能超过 25 MB。" },
      413,
      origin,
      env,
    );
  }

  const payload = await readJsonBody(request);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createError("请求内容无效。");
  }
  if (!credentialsMatch(payload.username, payload.password, env)) {
    const limited = await recordFailedAttempt(env, address);
    return jsonResponse(
      { error: limited ? "登录尝试过多，请 15 分钟后重试。" : "发布账号或密码不正确。" },
      limited ? 429 : 401,
      origin,
      env,
    );
  }
  await clearFailedAttempts(env, address);

  if (!Array.isArray(payload.images) || payload.images.length > MAX_IMAGES) {
    throw createError("图片数量无效，或超过 10 张。");
  }
  const post = validatePost(payload.post, payload.images.length);
  const imageFiles = [];
  let totalSize = 0;
  for (const [index, input] of payload.images.entries()) {
    if (
      !input ||
      typeof input !== "object" ||
      !ALLOWED_IMAGE_TYPES.has(input.type) ||
      typeof input.name !== "string" ||
      input.name.length > 255
    ) {
      throw createError(`第 ${index + 1} 张图片格式不支持。`);
    }
    const bytes = decodeBase64(input.data, `第 ${index + 1} 张`);
    input.data = "";
    if (!imageSignatureMatches(bytes, input.type)) {
      throw createError(`第 ${index + 1} 张图片内容与格式不匹配。`);
    }
    totalSize += bytes.length;
    if (totalSize > MAX_TOTAL_IMAGE_SIZE) {
      throw createError("图片总大小不能超过 25 MB。", 413);
    }
    const extension = ALLOWED_IMAGE_TYPES.get(input.type);
    const filename = `${post.id.slice(7, 19)}-${String(index + 1).padStart(2, "0")}-${safeImageName(input.name).replace(/\.[^.]*$/, "")}.${extension}`;
    const path = `/images/posts/${filename}`;
    post.images.push(path);
    imageFiles.push({ path, bytes });
  }

  const commit = await publishCommit(env, post, imageFiles);
  return jsonResponse(
    {
      post: { ...post, is_static: true },
      commit,
      message: "动态已提交到 GitHub，Pages 部署后即可访问。",
    },
    201,
    origin,
    env,
  );
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      if (origin !== env.ALLOWED_ORIGIN) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env),
      });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "不支持此请求方法。" }, 405, origin, env);
    }
    if (!origin || origin !== env.ALLOWED_ORIGIN) {
      return jsonResponse({ error: "请求来源不受允许。" }, 403, origin, env);
    }

    try {
      return await handlePublish(request, env, origin);
    } catch (error) {
      return jsonResponse(
        { error: error.message },
        error.status ?? 500,
        origin,
        env,
      );
    }
  },
};

export class PublisherRateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== "POST") {
      return new Response(null, { status: 405 });
    }

    if (new URL(request.url).pathname === "/success") {
      await this.state.storage.delete("failed-attempts");
      return Response.json({ ok: true });
    }

    const now = Date.now();
    const attempts = await this.state.storage.get("failed-attempts");
    if (!attempts || now - attempts.startedAt >= 15 * 60 * 1000) {
      await this.state.storage.put("failed-attempts", {
        startedAt: now,
        count: 1,
      });
      return Response.json({ limited: false });
    }

    attempts.count += 1;
    await this.state.storage.put("failed-attempts", attempts);
    return Response.json({ limited: attempts.count > 10 });
  }
}

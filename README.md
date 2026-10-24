# Haiwind 个人博客

博客地址：[https://haiwinds.github.io/](https://haiwinds.github.io/)

此仓库包含 GitHub Pages 使用的静态站点，以及基于 Supabase 的动态发布功能。博客前端仍由 GitHub Pages 托管，Supabase 提供管理员认证、Postgres 数据库和图片存储。

## 启用 Supabase 后端

1. 创建 Supabase 项目，在 SQL Editor 中执行 [`supabase/schema.sql`](supabase/schema.sql)。更新网站后也请重新运行此 SQL：它会创建动态图片关联表，并把旧动态的单张配图迁移到新相册结构。
2. 在 Supabase Authentication 中创建管理员用户并确认邮箱。关闭公开用户注册，避免他人创建账号。
3. 在 SQL Editor 中将管理员的用户 UUID 加入白名单：

   ```sql
   insert into public.blog_admins (user_id)
   select id from auth.users where email = '你的管理员邮箱'
   on conflict (user_id) do nothing;
   ```

4. 从 Supabase 项目设置中复制 Project URL 和 **publishable key**（旧项目也可使用 anon key），填写 [`assets/js/supabase-config.js`](assets/js/supabase-config.js) 中的 `url` 和 `anonKey`。
5. 发布仓库静态文件到 GitHub Pages，打开 `/admin/`，使用已授权的管理员账号登录。

Supabase publishable/anon key 会出现在浏览器中，这是预期行为；数据库 RLS 和存储策略负责权限控制。**不要**将 `service_role` 或其他服务端密钥放进网站文件。管理后台可上传和下载图片、发布动态，以及下架和重新发布动态；已发布动态会出现在首页和动态列表，点击卡片可进入详情页。“文章”页面展示最近 100 条已发布动态；“相册”页面展示图片存储桶中的全部图片。每条动态最多关联 10 张图片；发布时可同时选择本地图片和图库图片，所有图片会组成同一条动态的相册，详情页可逐张查看和下载。单独通过图片管理批量上传时，所选图片也会合并为一条图片动态；已有图片可逐张添加到已有动态。公开动态和图片列表会在当前浏览器标签缓存 30 秒，减少重复打开页面时的等待；新发布、下架或更新图片后会清除动态缓存。图片存储桶设为公开，以便访客查看、下载和浏览图片，请勿上传私人或敏感图片。相册需要公开列出图片对象，请在 Supabase SQL Editor 重新执行更新后的 `supabase/schema.sql`。

## Supabase 故障时直接发布

GitHub Pages 只能托管静态文件，不能让浏览器直接写入 GitHub 仓库。备用发布使用 Cloudflare Worker 作为安全中转：管理员在 `/admin/` 填写 Worker 地址、发布账号和密码并点“直接发布”，Worker 将动态与图片作为一次 Git 提交写入 `main`，不需要手动下载、上传文件或运行 `git` 命令。GitHub Pages 收到提交后会自动部署。凭据由 Cloudflare Worker 校验；GitHub token 只保存在 Cloudflare Worker Secrets，不会放在网页代码里。

**首次启用（需要 Node.js 和 Cloudflare 账号）：**

1. 在 GitHub 创建一个 fine-grained personal access token，仅授权 `haiwinds/haiwinds.github.io` 仓库，并设置 **Contents: Read and write**。不要把 token 发给任何人或提交到仓库。
2. 在仓库根目录运行 `npx wrangler login` 登录 Cloudflare。
3. 在 PowerShell 中依次设置 Worker Secrets（每条命令会提示输入值；账号和密码请自行设置为高强度且不同于 GitHub 密码）：

   ```powershell
   npx wrangler secret put GITHUB_TOKEN --config cloudflare/wrangler.toml
   npx wrangler secret put PUBLISH_USERNAME --config cloudflare/wrangler.toml
   npx wrangler secret put PUBLISH_PASSWORD --config cloudflare/wrangler.toml
   ```

4. 部署发布服务：`npx wrangler deploy --config cloudflare/wrangler.toml`。首次部署会创建发布所用的 Durable Object；Wrangler 会显示 Worker URL。
5. 打开 `/admin/` 的备用发布区域，填写 Worker URL、`PUBLISH_USERNAME` 和 `PUBLISH_PASSWORD`，即可直接发布。Worker URL 会保存在当前浏览器中；账号/密码不会由网页保存。可以在 Cloudflare Worker Logs 中查看发布状态，但不要记录或公开凭据。

单张图片最大 10 MB、每条动态最多 10 张、总大小最多 25 MB。Worker 只允许来自 `https://haiwinds.github.io` 的浏览器请求，并对连续错误凭据启用按 IP 计数的限流。静态动态会写入 `data/static-posts.json`，图片放在 `images/posts/`；首页、文章列表、动态详情和相册会与 Supabase 数据合并显示。若暂时无法部署 Cloudflare Worker，也可手动将动态 JSON 和图片提交到上述文件路径。公开仓库中的静态内容和图片对所有人可见，请勿发布私人或敏感内容。

左侧栏头像可在 [`assets/js/site-settings.js`](assets/js/site-settings.js) 中通过 `avatarUrl` 更换为仓库内图片路径或可公开访问的图片 URL；支持的格式取决于访客浏览器（常见格式包括 JPG、PNG、WebP、GIF 和 SVG）。

## 仓库说明

当前仓库保存的是静态页面，没有 Hugo 配置、主题源码或文章源文件。

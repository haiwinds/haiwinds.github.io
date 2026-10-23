# Haiwind 个人博客

博客地址：[https://haiwinds.github.io/](https://haiwinds.github.io/)

此仓库包含 GitHub Pages 使用的静态站点，以及基于 Supabase 的动态发布功能。博客前端仍由 GitHub Pages 托管，Supabase 提供管理员认证、Postgres 数据库和图片存储。

## 启用 Supabase 后端

1. 创建 Supabase 项目，在 SQL Editor 中执行 [`supabase/schema.sql`](supabase/schema.sql)。若已经配置过旧版后台，更新网站后也请重新运行此 SQL，以开放管理员为已有动态添加配图的权限。
2. 在 Supabase Authentication 中创建管理员用户并确认邮箱。关闭公开用户注册，避免他人创建账号。
3. 在 SQL Editor 中将管理员的用户 UUID 加入白名单：

   ```sql
   insert into public.blog_admins (user_id)
   select id from auth.users where email = '你的管理员邮箱'
   on conflict (user_id) do nothing;
   ```

4. 从 Supabase 项目设置中复制 Project URL 和 **publishable key**（旧项目也可使用 anon key），填写 [`assets/js/supabase-config.js`](assets/js/supabase-config.js) 中的 `url` 和 `anonKey`。
5. 发布仓库静态文件到 GitHub Pages，打开 `/admin/`，使用已授权的管理员账号登录。

Supabase publishable/anon key 会出现在浏览器中，这是预期行为；数据库 RLS 和存储策略负责权限控制。**不要**将 `service_role` 或其他服务端密钥放进网站文件。管理后台可上传和下载图片、发布动态，以及下架和重新发布动态；已发布动态会出现在首页和动态列表，点击卡片可进入详情页。图库会包含已上传图片；可将图片附加到新动态，或选中图片和已有动态后添加配图。公开动态列表会在当前浏览器标签缓存 30 秒，减少重复打开页面时的等待；新发布、下架或更新配图后会清除缓存。图片存储桶设为公开，以便访客查看和下载文章配图，请勿上传私人或敏感图片。

## 仓库说明

当前仓库保存的是静态页面，没有 Hugo 配置、主题源码或文章源文件。

create table if not exists public.blog_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.blog_admins enable row level security;
revoke all on public.blog_admins from public, anon, authenticated;

create or replace function public.is_blog_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.blog_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_blog_admin() from public, anon, authenticated;
grant execute on function public.is_blog_admin() to anon, authenticated;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null default '' check (char_length(title) <= 120),
  content text not null check (char_length(content) between 1 and 10000),
  image_path text,
  published boolean not null default true,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists posts_published_created_at_idx
  on public.posts (created_at desc)
  where published;

create table if not exists public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  image_path text not null,
  position smallint not null default 0 check (position between 0 and 9),
  created_at timestamptz not null default now(),
  unique (post_id, image_path)
);

create index if not exists post_images_post_position_idx
  on public.post_images (post_id, position);

insert into public.post_images (post_id, image_path, position)
select id, image_path, 0
from public.posts
where image_path is not null
on conflict (post_id, image_path) do nothing;

create or replace function public.enforce_post_image_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  image_count integer;
begin
  perform 1
  from public.posts
  where id = new.post_id
  for update;

  if tg_op = 'UPDATE' then
    if old.post_id = new.post_id then
      return new;
    end if;
  end if;

  select count(*)
  into image_count
  from public.post_images
  where post_id = new.post_id;

  if image_count >= 10 then
    raise exception 'A post can contain no more than 10 images.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_post_image_limit() from public, anon, authenticated;

drop trigger if exists enforce_post_image_limit on public.post_images;
create trigger enforce_post_image_limit
  before insert or update of post_id on public.post_images
  for each row execute function public.enforce_post_image_limit();

alter table public.post_images enable row level security;
revoke all on public.post_images from public, anon, authenticated;
grant select on public.post_images to anon, authenticated;
grant insert (post_id, image_path, position) on public.post_images to authenticated;

drop policy if exists "Anyone can read images from published posts" on public.post_images;
create policy "Anyone can read images from published posts"
  on public.post_images for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.posts
      where id = post_id
        and (published or (select public.is_blog_admin()))
    )
  );

drop policy if exists "Admins can add images to their posts" on public.post_images;
create policy "Admins can add images to their posts"
  on public.post_images for insert
  to authenticated
  with check (
    (select public.is_blog_admin())
    and exists (
      select 1
      from public.posts
      where id = post_id
        and created_by = (select auth.uid())
    )
  );

alter table public.posts enable row level security;
revoke all on public.posts from public, anon, authenticated;
grant select on public.posts to anon, authenticated;
grant insert (title, content, image_path, created_by) on public.posts to authenticated;
grant update (image_path, published) on public.posts to authenticated;

drop policy if exists "Anyone can read published posts" on public.posts;
create policy "Anyone can read published posts"
  on public.posts for select
  to anon, authenticated
  using (published or (select public.is_blog_admin()));

drop policy if exists "Admins can create their own posts" on public.posts;
create policy "Admins can create their own posts"
  on public.posts for insert
  to authenticated
  with check (
    (select public.is_blog_admin())
    and created_by = (select auth.uid())
  );

drop policy if exists "Admins can update posts" on public.posts;
create policy "Admins can update posts"
  on public.posts for update
  to authenticated
  using ((select public.is_blog_admin()))
  with check ((select public.is_blog_admin()));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'blog-images',
  'blog-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can list public blog images" on storage.objects;
create policy "Anyone can list public blog images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'blog-images');

drop policy if exists "Admins can list their blog images" on storage.objects;
create policy "Admins can list their blog images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'blog-images'
    and (select public.is_blog_admin())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Admins can upload their blog images" on storage.objects;
create policy "Admins can upload their blog images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'blog-images'
    and (select public.is_blog_admin())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Admins can update their blog images" on storage.objects;
create policy "Admins can update their blog images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'blog-images'
    and (select public.is_blog_admin())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'blog-images'
    and (select public.is_blog_admin())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Admins can delete their blog images" on storage.objects;
create policy "Admins can delete their blog images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'blog-images'
    and (select public.is_blog_admin())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

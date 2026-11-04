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

drop trigger if exists enforce_post_image_limit on public.post_images;

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

create or replace function public.publish_post(
  p_title text,
  p_content text,
  p_image_paths text[]
)
returns public.posts
language plpgsql
set search_path = ''
as $$
declare
  created_post public.posts;
begin
  if coalesce(cardinality(p_image_paths), 0) > 10 then
    raise exception 'A post can contain no more than 10 images.'
      using errcode = 'check_violation';
  end if;

  insert into public.posts (title, content, image_path, created_by)
  values (
    p_title,
    p_content,
    p_image_paths[1],
    (select auth.uid())
  )
  returning * into created_post;

  insert into public.post_images (post_id, image_path, position)
  select created_post.id, image_path, (ordinality - 1)::smallint
  from unnest(coalesce(p_image_paths, array[]::text[]))
    with ordinality as images(image_path, ordinality);

  return created_post;
end;
$$;

revoke all on function public.publish_post(text, text, text[]) from public, anon, authenticated;
grant execute on function public.publish_post(text, text, text[]) to authenticated;

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

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'music-files',
  'music-files',
  true,
  52428800,
  array[
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/ogg',
    'application/ogg',
    'audio/wav',
    'audio/x-wav',
    'audio/vnd.wave',
    'audio/flac',
    'audio/x-flac'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can upload their music files" on storage.objects;
create policy "Admins can upload their music files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'music-files'
    and (select public.is_blog_admin())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Admins can delete their music files" on storage.objects;
create policy "Admins can delete their music files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'music-files'
    and (select public.is_blog_admin())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  source_type text not null check (source_type in ('netease', 'audio')),
  source text not null check (char_length(source) between 1 and 2048),
  created_by uuid not null references auth.users (id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.music_tracks
  add column if not exists sort_order integer;

with ranked_tracks as (
  select id, (row_number() over (order by created_at, id) - 1)::integer as sort_order
  from public.music_tracks
  where sort_order is null
)
update public.music_tracks as tracks
set sort_order = ranked_tracks.sort_order
from ranked_tracks
where tracks.id = ranked_tracks.id;

alter table public.music_tracks
  alter column sort_order set default 0,
  alter column sort_order set not null;

create index if not exists music_tracks_created_at_idx
  on public.music_tracks (created_at, id);
create index if not exists music_tracks_sort_order_idx
  on public.music_tracks (sort_order, id);

alter table public.music_tracks enable row level security;
revoke all on public.music_tracks from public, anon, authenticated;
revoke select on public.music_tracks from anon, authenticated;
grant select (id, title, source_type, source, created_at, sort_order)
  on public.music_tracks to anon, authenticated;
grant insert (title, source_type, source, created_by, sort_order) on public.music_tracks to authenticated;
grant update (sort_order) on public.music_tracks to authenticated;
grant delete on public.music_tracks to authenticated;

drop policy if exists "Anyone can read music tracks" on public.music_tracks;
create policy "Anyone can read music tracks"
  on public.music_tracks for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins can add music tracks" on public.music_tracks;
create policy "Admins can add music tracks"
  on public.music_tracks for insert
  to authenticated
  with check (
    (select public.is_blog_admin())
    and created_by = (select auth.uid())
  );

drop policy if exists "Admins can reorder music tracks" on public.music_tracks;
create policy "Admins can reorder music tracks"
  on public.music_tracks for update
  to authenticated
  using ((select public.is_blog_admin()))
  with check ((select public.is_blog_admin()));

drop policy if exists "Admins can delete music tracks" on public.music_tracks;
create policy "Admins can delete music tracks"
  on public.music_tracks for delete
  to authenticated
  using ((select public.is_blog_admin()));

create or replace function public.reorder_music_tracks(track_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  track_count integer;
begin
  if not public.is_blog_admin() then
    raise exception 'Only blog admins can reorder music tracks'
      using errcode = '42501';
  end if;

  select count(*) into track_count from public.music_tracks;
  if cardinality(track_ids) is null
    or cardinality(track_ids) <> track_count
    or cardinality(track_ids) <> (
      select count(distinct requested.id)
      from unnest(track_ids) as requested(id)
    )
    or exists (
      select 1
      from unnest(track_ids) as requested(id)
      left join public.music_tracks as tracks on tracks.id = requested.id
      where tracks.id is null
    )
  then
    raise exception 'Track order must include every music track exactly once'
      using errcode = '22023';
  end if;

  update public.music_tracks as tracks
  set sort_order = requested.ordinality - 1
  from unnest(track_ids) with ordinality as requested(id, ordinality)
  where tracks.id = requested.id;
end;
$$;

revoke all on function public.reorder_music_tracks(uuid[]) from public, anon;
grant execute on function public.reorder_music_tracks(uuid[]) to authenticated;

notify pgrst, 'reload schema';

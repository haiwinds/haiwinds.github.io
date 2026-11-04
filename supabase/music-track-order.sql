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

create index if not exists music_tracks_sort_order_idx
  on public.music_tracks (sort_order, id);

grant select (sort_order) on public.music_tracks to anon, authenticated;
grant insert (sort_order) on public.music_tracks to authenticated;
grant update (sort_order) on public.music_tracks to authenticated;

drop policy if exists "Admins can reorder music tracks" on public.music_tracks;
create policy "Admins can reorder music tracks"
  on public.music_tracks for update
  to authenticated
  using ((select public.is_blog_admin()))
  with check ((select public.is_blog_admin()));

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

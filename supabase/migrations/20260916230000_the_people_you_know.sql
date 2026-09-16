-- The people you know: citizens, friends and letters.
--
-- This island has had more than one person on it since the day it was made,
-- and nothing anywhere that lets two of them mean anything to each other. A
-- settlement has exactly one inhabitant — `deed.founded_by`, and every
-- permission on the land reads it — so the only thing two people can do
-- together is stand on the same tile and type in the open. There is no way to
-- say *this one is mine*: no roll of citizens, no list of friends, no word said
-- to one person that the whole island does not hear, and nothing said at all
-- to somebody who is not looking at the screen when you say it.
--
-- Three tables, and one existing rule widened.
--
-- ## A settlement with more than one person in it
--
-- `deed_member` is the roll, keyed by the founder because that is how a deed
-- is keyed: `deed`'s primary key is `(world_id, founded_by)`. Both new deed
-- tables hang off it by foreign key, so a disband takes the roll and the
-- outstanding invitations with it and nothing has to remember to.
--
-- The widening is `deed_of` — *the deed you founded, or the one you belong to*
-- — and the two names the rest of the island already asks by: `my_deed`, which
-- eleven rules read, and `on_my_deed`, which nine read. May I build here, is
-- this crate mine, whose stores are these, whose water is this, will this
-- wildermon work this ground: twenty rules, two lines, and a citizen has a
-- citizen's life everywhere the question is asked.
--
-- `on_my_deed` had to be moved *by hand* even so, which is the whole argument
-- for measuring rather than reasoning: it did not read `my_deed` at all, it
-- wrote `founded_by = p_uid` out again. The first run of this had a citizen of
-- Ravenhold standing on their own token with `on_my_deed` answering false.
--
-- What does **not** widen, deliberately: disbanding, upgrading and renaming
-- (`perform_settlement` and `settlement_refusal` read `founded_by` for
-- themselves); setting wildermon to work, because `worker_cap` is the deed's
-- allowance and one per citizen would not be an allowance; and recall,
-- breeding, the bounty cast and a second companion, each of which asks "have
-- you a settlement" in its own words. Those are five more decisions and not
-- this one's to make.
--
-- `deed_of` prefers the deed you founded when somehow you have both, and
-- founding is now refused while you are somebody's citizen — two deeds at once
-- is the one state it cannot answer honestly about.
--
-- ## Friends, and where they are
--
-- One row per direction, so "my friends" and "who has asked me" are both one
-- index scan rather than an or-across-two-columns. Asking writes one row as
-- `asked`; accepting flips it to `friends` and writes the mirror. A friend's
-- place on the island comes with them when they are at the keyboard, and not
-- at all when they are away — the island knows where everybody is every
-- second of every day, and handing that out for anybody at all would make a
-- window that is a radar.
--
-- ## Letters that are still there tomorrow
--
-- `event` already carries a line to one person and only that person, over
-- Realtime, and a letter is delivered that way — instantly, to a tab that is
-- open. But `event` is pruned, and a thing that is pruned is not a letter. So
-- the letter is a row of its own, kept, read back as a thread, and marked read
-- when it is read; the `tell` beside it is the knock at the door.

create table if not exists deed_member (
  world_id uuid not null,
  -- Which settlement, named by whoever founded it: `deed` is keyed that way.
  founder uuid not null,
  uid uuid not null,
  joined_at timestamptz not null default now(),
  primary key (world_id, uid),
  foreign key (world_id, founder) references deed(world_id, founded_by) on delete cascade
);
create index if not exists deed_member_roll on deed_member (world_id, founder);

create table if not exists deed_invite (
  world_id uuid not null,
  founder uuid not null,
  uid uuid not null,
  made_at timestamptz not null default now(),
  primary key (world_id, founder, uid),
  foreign key (world_id, founder) references deed(world_id, founded_by) on delete cascade
);
create index if not exists deed_invite_for on deed_invite (world_id, uid);

create table if not exists friend (
  world_id uuid not null,
  -- Whose list this row is on, and who is on it. Two rows for two friends.
  uid uuid not null,
  other uuid not null,
  state text not null default 'asked',
  at timestamptz not null default now(),
  primary key (world_id, uid, other),
  constraint friend_not_self check (uid <> other),
  constraint friend_state check (state in ('asked', 'friends'))
);
create index if not exists friend_asked_of on friend (world_id, other, state);

create table if not exists letter (
  world_id uuid not null,
  n bigint generated always as identity,
  sender uuid not null,
  reader uuid not null,
  text text not null,
  at timestamptz not null default now(),
  read_at timestamptz,
  primary key (world_id, n),
  constraint letter_length check (length(text) between 1 and 400)
);
create index if not exists letter_inbox on letter (world_id, reader, read_at);
create index if not exists letter_thread on letter (world_id, sender, reader, n);

alter table deed_member enable row level security;
alter table deed_invite enable row level security;
alter table friend enable row level security;
alter table letter enable row level security;

-- Who lives where is not a secret: the token has the name written on it and
-- the border is drawn on the ground.
drop policy if exists deed_member_read on deed_member;
create policy deed_member_read on deed_member for select to authenticated
  using ((select private.on_island(deed_member.world_id)));

-- An invitation is between the two of them.
drop policy if exists deed_invite_read on deed_invite;
create policy deed_invite_read on deed_invite for select to authenticated
  using (uid = (select auth.uid()) or founder = (select auth.uid()));

drop policy if exists friend_read on friend;
create policy friend_read on friend for select to authenticated
  using (uid = (select auth.uid()) or other = (select auth.uid()));

drop policy if exists letter_read on letter;
create policy letter_read on letter for select to authenticated
  using (sender = (select auth.uid()) or reader = (select auth.uid()));

/**
 * The settlement this body belongs to: the one it founded, or the one it was
 * invited into.
 *
 * Founded first, because holding both would otherwise be a coin toss over
 * which deed your building permissions belong to — and because disbanding and
 * upgrading are the founder's, and those read `founded_by` for themselves.
 */
create or replace function deed_of(p_world uuid, p_uid uuid) returns deed
  language sql stable as $fn$
  select d.* from deed d
   where d.world_id = p_world
     and (d.founded_by = p_uid
          or exists (select 1 from deed_member m
                      where m.world_id = p_world and m.uid = p_uid
                        and m.founder = d.founded_by))
   order by (d.founded_by = p_uid) desc, d.founded_at
   limit 1
$fn$;

/*
 * And the name every other rule on this island already asks by.
 *
 * `on_my_deed` — may I build here, is this crate mine, whose stores are these,
 * will this wildermon work this ground — reads this, and so do eleven other
 * rules directly. One line, and a citizen has a citizen's life everywhere the
 * question is asked, instead of twenty-six call sites each being taught about
 * membership one at a time and one of them being missed.
 */
create or replace function my_deed(p_world uuid, p_uid uuid) returns deed
  language sql stable as $fn$ select deed_of(p_world, p_uid) $fn$;

/*
 * And the question itself, which asked for itself rather than through
 * `my_deed`: `founded_by = p_uid` written out again, so pointing `my_deed` at
 * the roll moved eleven rules and left the nine that matter most exactly where
 * they were. Measured, not assumed — the first run of this had a citizen of
 * Ravenhold standing on the token with `on_my_deed` answering false.
 */
create or replace function on_my_deed(p_world uuid, p_uid uuid, p_x integer, p_y integer)
  returns boolean language sql stable as $fn$
  select coalesce((select d.world_id is not null
                     and abs(p_x - d.x) <= d.radius and abs(p_y - d.y) <= d.radius
                   from deed_of(p_world, p_uid) d), false)
$fn$;

/** Whether somebody is at the keyboard, rather than a body left standing. */
create or replace function afoot(p_world uuid, p_uid uuid) returns boolean
  language sql stable as $fn$
  select exists (select 1 from player p
                  where p.world_id = p_world and p.uid = p_uid and not p.away
                    and p.seen_at > now() - make_interval(secs => idle_logout()))
$fn$;

/** What somebody is called, preferring the name they can prove. */
create or replace function folk_name(p_world uuid, p_uid uuid) returns text
  language sql stable as $fn$
  select coalesce(account_name(p_uid),
                  (select p.name from player p where p.world_id = p_world and p.uid = p_uid),
                  'somebody')
$fn$;

/**
 * Somebody, as a window draws them — and where they are only when they are
 * there to be found.
 *
 * `p_near` is whether this reader is allowed to know: a friend or somebody off
 * the same roll. Without it a social window is a radar over the whole island,
 * which is a different feature and not one anybody asked for.
 */
create or replace function folk_row(p_world uuid, p_uid uuid, p_near boolean default false)
  returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'uid', p_uid,
    'name', folk_name(p_world, p_uid),
    'online', afoot(p_world, p_uid))
    || case when p_near and afoot(p_world, p_uid)
            then coalesce((select jsonb_build_object('x', floor(p.x)::int, 'y', floor(p.y)::int)
                           from player p where p.world_id = p_world and p.uid = p_uid), '{}'::jsonb)
            else '{}'::jsonb end
$fn$;

/*
 * And founding, which now has to ask whether you are already somebody's
 * citizen. Two deeds at once is the one state `deed_of` cannot answer honestly
 * about, so it is refused at the door rather than resolved afterwards.
 */
CREATE OR REPLACE FUNCTION public.deed_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; tx int; ty int; want int := 5; other deed; mine deed;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  if exists (select 1 from deed d where d.world_id = p_world and d.founded_by = p_uid) then
    return 'You already hold a settlement. Disband it first.';
  end if;
  -- A citizen of somewhere else cannot hold land of their own: every
  -- permission on this island asks which one deed is yours.
  if exists (select 1 from deed_member m where m.world_id = p_world and m.uid = p_uid) then
    mine := deed_of(p_world, p_uid);
    return 'You are a citizen of ' || coalesce(mine.name, 'a settlement')
        || '. Leave it before founding your own.';
  end if;
  if pack_count(p_world, p_uid, 'deed_stake') <= 0 then return 'You have no deed stake.'; end if;
  if tx - want < 0 or ty - want < 0
     or not in_bounds(p_world, tx + want, ty + want) then
    return 'Too close to the edge of the world.';
  end if;
  if has_water(p_world, tx, ty) then return 'The token must stand on dry land.'; end if;
  if not passable(p_world, tx, ty) then return 'The token needs a clear tile.'; end if;
  -- Two squares overlap when their centres are closer than the sum of their
  -- reaches, on either axis.
  select * into other from deed d
   where d.world_id = p_world
     and abs(tx - d.x) <= want + d.radius
     and abs(ty - d.y) <= want + d.radius
   order by d.founded_at limit 1;
  if found then
    return other.name || ' stands too close. Settlements may not overlap, and yours would '
        || 'reach ' || want || ' tiles from here. Walk further out.';
  end if;
  return null;
end $function$;

/**
 * Ask somebody to come and live on your land.
 *
 * The founder's alone, and only for somebody standing on the same island with
 * no settlement of their own. An invitation already out is left where it is
 * rather than refreshed — pestering somebody who has not answered is not a
 * thing this door should make easy.
 */
create or replace function rpc_invite(p_world uuid, p_uid uuid) returns jsonb
  language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); d deed; v_name text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if p_uid is null or p_uid = me then
    return jsonb_build_object('why', 'You are already here.');
  end if;
  select * into d from deed where world_id = p_world and founded_by = me;
  if not found then
    return jsonb_build_object('why', 'You hold no settlement to invite anybody to.');
  end if;
  if not exists (select 1 from player where world_id = p_world and uid = p_uid) then
    return jsonb_build_object('why', 'Nobody by that name is on this island.');
  end if;
  v_name := folk_name(p_world, p_uid);
  if exists (select 1 from deed_member m where m.world_id = p_world and m.uid = p_uid
               and m.founder = me) then
    return jsonb_build_object('why', v_name || ' already lives here.');
  end if;
  if exists (select 1 from deed_member m where m.world_id = p_world and m.uid = p_uid) then
    return jsonb_build_object('why', v_name || ' is a citizen somewhere else.');
  end if;
  if exists (select 1 from deed d2 where d2.world_id = p_world and d2.founded_by = p_uid) then
    return jsonb_build_object('why', v_name || ' holds a settlement of their own.');
  end if;
  if exists (select 1 from deed_invite i where i.world_id = p_world and i.founder = me
               and i.uid = p_uid) then
    return jsonb_build_object('why', v_name || ' has already been asked, and has not answered.');
  end if;
  insert into deed_invite (world_id, founder, uid) values (p_world, me, p_uid);
  perform tell(p_world, p_uid, folk_name(p_world, me) || ' invites you to live at '
    || d.name || '. (Social, to answer)', 'system');
  return jsonb_build_object('asked', v_name, 'deed', d.name);
end $fn$;

/**
 * Yes or no to an invitation.
 *
 * Saying yes while you hold land of your own is refused rather than resolved:
 * which deed your building permissions belong to is not a thing to decide for
 * somebody by dropping one of them.
 */
create or replace function rpc_invite_answer(p_world uuid, p_founder uuid, p_yes boolean)
  returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); d deed;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into d from deed where world_id = p_world and founded_by = p_founder;
  if not found or not exists (select 1 from deed_invite i
        where i.world_id = p_world and i.founder = p_founder and i.uid = me) then
    return jsonb_build_object('why', 'There is no invitation waiting from there.');
  end if;
  delete from deed_invite where world_id = p_world and founder = p_founder and uid = me;
  if not coalesce(p_yes, false) then
    perform tell(p_world, p_founder, folk_name(p_world, me) || ' will not come to '
      || d.name || '.', 'event');
    return jsonb_build_object('joined', false, 'deed', d.name);
  end if;
  if exists (select 1 from deed d2 where d2.world_id = p_world and d2.founded_by = me) then
    return jsonb_build_object('why', 'You hold a settlement of your own. Disband it first.');
  end if;
  if exists (select 1 from deed_member m where m.world_id = p_world and m.uid = me) then
    return jsonb_build_object('why', 'You are already a citizen somewhere. Leave there first.');
  end if;
  insert into deed_member (world_id, founder, uid) values (p_world, p_founder, me);
  perform tell(p_world, me, 'You are a citizen of ' || d.name
    || '. Its land is yours to work.', 'system');
  perform tell(p_world, p_founder, folk_name(p_world, me) || ' has come to live at '
    || d.name || '.', 'system');
  return jsonb_build_object('joined', true, 'deed', d.name);
end $fn$;

/**
 * Off the roll: yourself, or somebody the founder is sending away.
 *
 * One door for both, because they are the same write and the rule between them
 * is one line — nobody may put anybody off a roll but their own.
 */
create or replace function rpc_leave_deed(p_world uuid, p_uid uuid default null) returns jsonb
  language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); who uuid; m deed_member; d deed;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  who := coalesce(p_uid, me);
  select * into m from deed_member where world_id = p_world and uid = who;
  if not found then return jsonb_build_object('why', 'Nobody there to send away.'); end if;
  if who <> me and m.founder <> me then
    return jsonb_build_object('why', 'That is not your settlement to empty.');
  end if;
  select * into d from deed where world_id = p_world and founded_by = m.founder;
  delete from deed_member where world_id = p_world and uid = who;
  if who = me then
    perform tell(p_world, me, 'You are no longer a citizen of ' || d.name || '.', 'system');
    if m.founder <> me then
      perform tell(p_world, m.founder, folk_name(p_world, me) || ' has left ' || d.name || '.', 'event');
    end if;
  else
    perform tell(p_world, who, 'You are no longer welcome at ' || d.name || '.', 'error');
    perform tell(p_world, me, folk_name(p_world, who) || ' is off the roll of ' || d.name || '.', 'event');
  end if;
  return jsonb_build_object('left', d.name);
end $fn$;

/**
 * Ask somebody to be a friend — or say yes, when they asked first.
 *
 * One door for both because from where the caller stands they are the same
 * thing: you have picked somebody and said *this one*. Whether that makes a
 * question or an answer depends on what is already on the island's side, which
 * is the island's to know.
 */
create or replace function rpc_friend(p_world uuid, p_uid uuid) returns jsonb
  language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); v_name text; theirs friend;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if p_uid is null or p_uid = me then
    return jsonb_build_object('why', 'You will have to find somebody else.');
  end if;
  if not exists (select 1 from player where world_id = p_world and uid = p_uid) then
    return jsonb_build_object('why', 'Nobody by that name is on this island.');
  end if;
  v_name := folk_name(p_world, p_uid);
  select * into theirs from friend f
   where f.world_id = p_world and f.uid = p_uid and f.other = me;
  if found and theirs.state = 'friends' then
    -- They already count you; make it mutual without asking again.
    insert into friend (world_id, uid, other, state) values (p_world, me, p_uid, 'friends')
      on conflict (world_id, uid, other) do update set state = 'friends', at = now();
    return jsonb_build_object('friends', v_name);
  end if;
  if found then
    update friend set state = 'friends', at = now()
      where world_id = p_world and uid = p_uid and other = me;
    insert into friend (world_id, uid, other, state) values (p_world, me, p_uid, 'friends')
      on conflict (world_id, uid, other) do update set state = 'friends', at = now();
    perform tell(p_world, p_uid, folk_name(p_world, me) || ' is your friend now.', 'system');
    perform tell(p_world, me, v_name || ' is your friend now.', 'system');
    return jsonb_build_object('friends', v_name);
  end if;
  if exists (select 1 from friend f where f.world_id = p_world and f.uid = me
               and f.other = p_uid and f.state = 'friends') then
    return jsonb_build_object('why', v_name || ' is already a friend.');
  end if;
  if exists (select 1 from friend f where f.world_id = p_world and f.uid = me
               and f.other = p_uid) then
    return jsonb_build_object('why', v_name || ' has been asked, and has not answered.');
  end if;
  insert into friend (world_id, uid, other, state) values (p_world, me, p_uid, 'asked');
  perform tell(p_world, p_uid, folk_name(p_world, me)
    || ' would like to be your friend. (Social, to answer)', 'system');
  return jsonb_build_object('asked', v_name);
end $fn$;

/** No, or not any more. Takes the row both ways, whichever it was. */
create or replace function rpc_unfriend(p_world uuid, p_uid uuid) returns jsonb
  language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); v_was boolean;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  v_was := exists (select 1 from friend f where f.world_id = p_world
                     and f.uid = me and f.other = p_uid and f.state = 'friends');
  delete from friend where world_id = p_world
    and ((uid = me and other = p_uid) or (uid = p_uid and other = me));
  if v_was then
    perform tell(p_world, p_uid, folk_name(p_world, me)
      || ' is no longer on your list of friends.', 'event');
  end if;
  return jsonb_build_object('dropped', folk_name(p_world, p_uid));
end $fn$;

/**
 * A word to one person, which is still there tomorrow.
 *
 * Two writes on purpose. The `letter` row is the thing kept — read back as a
 * thread, marked read when it is read, and outliving the pruning that `event`
 * is subject to. The `tell` beside it is delivery: `event` is what Realtime
 * carries to one person and only that person, and it is already wired up at
 * both ends, so a letter reaches an open tab the same second it is written.
 */
create or replace function rpc_letter(p_world uuid, p_uid uuid, p_text text) returns jsonb
  language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); v_text text; v_n bigint; v_recent int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  if p_uid is null or p_uid = me
     or not exists (select 1 from player where world_id = p_world and uid = p_uid) then
    return jsonb_build_object('why', 'There is nobody there to write to.');
  end if;
  v_text := btrim(regexp_replace(
    regexp_replace(coalesce(p_text, ''), '[\r\n\t]+', ' ', 'g'), '\s{2,}', ' ', 'g'));
  v_text := left(v_text, 400);
  if v_text = '' then return jsonb_build_object('why', 'Nothing to say.'); end if;
  -- The same allowance talking out loud gets, counted over letters alone.
  select count(*) into v_recent from letter l
   where l.world_id = p_world and l.sender = me and l.at > now() - interval '1 minute';
  if v_recent >= say_a_minute()::int then
    return jsonb_build_object('why', 'That is a great deal of writing. Give it a moment.');
  end if;
  insert into letter (world_id, sender, reader, text) values (p_world, me, p_uid, v_text)
    returning n into v_n;
  perform tell(p_world, p_uid, '[' || folk_name(p_world, me) || '] ' || v_text, 'letter');
  return jsonb_build_object('n', v_n, 'sent', v_text, 'to', folk_name(p_world, p_uid));
end $fn$;

/**
 * One conversation, newest last, and read once it has been read.
 *
 * Both directions in one list, because that is what a conversation is. Marking
 * read happens here rather than on a door of its own: opening the thread *is*
 * the reading, and a second call to say so is a round trip for nothing.
 */
create or replace function rpc_letters(p_world uuid, p_with uuid, p_limit integer default 60)
  returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); v_rows jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'n', q.n, 'mine', q.sender = me, 'text', q.text,
           'at', extract(epoch from q.at)) order by q.n), '[]'::jsonb)
    into v_rows
    from (select l.* from letter l
           where l.world_id = p_world
             and ((l.sender = me and l.reader = p_with) or (l.sender = p_with and l.reader = me))
           order by l.n desc limit greatest(1, least(200, coalesce(p_limit, 60)))) q;
  update letter set read_at = now()
   where world_id = p_world and reader = me and sender = p_with and read_at is null;
  return jsonb_build_object('with', folk_name(p_world, p_with), 'letters', v_rows);
end $fn$;

/**
 * Everything the social window draws, in one ask.
 *
 * One door rather than six because it is one window: it opens showing all of
 * it at once, and six round trips to fill one page is six chances for the page
 * to be half one moment and half another.
 *
 * `here` is everybody on the island by name, which is what the window offers
 * to invite and befriend from — without their whereabouts. Where somebody is
 * comes only with `friends` and `folk`, and only while they are at the
 * keyboard.
 */
create or replace function rpc_social(p_world uuid) returns jsonb
  language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); d deed;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  d := deed_of(p_world, me);
  return jsonb_build_object(
    'deed', case when d.world_id is null then null else jsonb_build_object(
      'name', d.name, 'x', d.x, 'y', d.y, 'level', d.level, 'radius', d.radius,
      'founder', d.founded_by, 'by', folk_name(p_world, d.founded_by),
      'mine', d.founded_by = me) end,
    -- The roll of wherever you live, founder included, with their whereabouts:
    -- people off the same land are near by definition.
    'folk', case when d.world_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(folk_row(p_world, q.uid, true) order by q.ord, folk_name(p_world, q.uid))
        from (select d.founded_by as uid, 0 as ord
              union all
              select m.uid, 1 from deed_member m
               where m.world_id = p_world and m.founder = d.founded_by) q
        where q.uid <> me), '[]'::jsonb) end,
    -- Asked to live somewhere, and waiting on you.
    'invites', coalesce((select jsonb_agg(jsonb_build_object(
        'founder', i.founder, 'by', folk_name(p_world, i.founder),
        'deed', dd.name, 'at', extract(epoch from i.made_at)) order by i.made_at)
      from deed_invite i join deed dd
        on dd.world_id = i.world_id and dd.founded_by = i.founder
      where i.world_id = p_world and i.uid = me), '[]'::jsonb),
    -- And the ones you have out, which only a founder ever has.
    'sent', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', i.uid, 'name', folk_name(p_world, i.uid),
        'at', extract(epoch from i.made_at)) order by i.made_at)
      from deed_invite i where i.world_id = p_world and i.founder = me), '[]'::jsonb),
    'friends', coalesce((select jsonb_agg(folk_row(p_world, f.other, true)
        order by afoot(p_world, f.other) desc, folk_name(p_world, f.other))
      from friend f where f.world_id = p_world and f.uid = me and f.state = 'friends'), '[]'::jsonb),
    'asked', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', f.uid, 'name', folk_name(p_world, f.uid),
        'at', extract(epoch from f.at)) order by f.at)
      from friend f where f.world_id = p_world and f.other = me and f.state = 'asked'), '[]'::jsonb),
    'asking', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', f.other, 'name', folk_name(p_world, f.other),
        'at', extract(epoch from f.at)) order by f.at)
      from friend f where f.world_id = p_world and f.uid = me and f.state = 'asked'), '[]'::jsonb),
    -- Letters waiting, by whoever wrote them, so the window can put a number
    -- against a name rather than a bare total nobody can act on.
    'unread', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', q.sender, 'name', folk_name(p_world, q.sender), 'n', q.n) order by q.n desc)
      from (select l.sender, count(*)::int as n from letter l
             where l.world_id = p_world and l.reader = me and l.read_at is null
             group by l.sender) q), '[]'::jsonb),
    -- And everybody ashore, for the window to pick from. No whereabouts: a
    -- list of every body on the island with a position beside it is a radar.
    'here', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', q.uid, 'name', folk_name(p_world, q.uid), 'online', q.online)
        order by q.online desc, folk_name(p_world, q.uid))
      from (select p.uid, afoot(p_world, p.uid) as online from player p
             where p.world_id = p_world and p.uid <> me
             order by afoot(p_world, p.uid) desc, p.name limit 200) q), '[]'::jsonb));
end $fn$;

select private.lock_doors();

notify pgrst, 'reload schema';

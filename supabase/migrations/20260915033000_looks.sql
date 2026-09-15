-- A face, and where it is kept.
--
-- Everybody on this island has been the same figure with the same brown hair
-- since the first sprite was drawn. Now a look is eight short strings, chosen
-- on the landing page between making an account and stepping ashore, and it
-- travels with you: saved with the body, sent to everybody else on the island,
-- and read back off your own row when you come back to one you have been on
-- before.
--
-- ## Why it is ids and not colours
--
-- A look goes from a stranger's browser, through this database, into
-- `ctx.fillStyle` on everybody else's machine. A free-text colour on that path
-- is a hole with a view of the whole island. So every field is an id out of
-- `look_option`, and `look_clean()` replaces anything that is not — which
-- means the worst a crafted look can do is come out looking ordinary.
--
-- The browser clamps the same way, in `src/game/look.ts`, and that clamp is
-- worth nothing: it runs on the client. This one is the control.
--
-- ## Why `look_option` is generated and empty here
--
-- It is filled by the generated definitions, the same as every other table of
-- constants, because ten skin tones and twenty haircuts are numbers and the
-- numbers live in TypeScript. The table is *created* here because the
-- generated migration is stamped by the wall clock and this one by hand, and
-- the two clocks cross: whichever lands first has to be able to create it, so
-- both say `if not exists` and neither cares which won.
--
-- Nothing calls `look_clean()` between the two, so an empty table in between
-- is a state nobody is ever in.
create table if not exists look_option (
  kind text not null,
  id text not null,
  ord int not null,
  name text not null,
  /** What it looks like, for the swatches. Null for a shape rather than a colour. */
  colour text,
  /** The one to fall back on when a look asks for something that is not here. */
  fallback boolean not null default false,
  primary key (kind, id)
);

/** The eight questions a look answers, in the order the creator asks them. */
create or replace function look_kinds() returns text[] language sql immutable as $$
  select array['gender', 'skin', 'hair', 'hairColour', 'eyes', 'beard', 'shirt', 'trousers']
$$;

/**
 * A look with everything unrecognised replaced.
 *
 * Total, deliberately: it never raises and never returns a partial look, so
 * there is no path anywhere in this database where a body has half a face. A
 * field that names nothing falls to the kind's own fallback, and if that is
 * somehow missing too, to the first of the list — which is one more step than
 * should ever be needed and cheaper than the alternative, which is a null in a
 * colour on somebody else's screen.
 */
create or replace function look_clean(p_look jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(k, coalesce(
           (select o.id from look_option o where o.kind = k and o.id = p_look ->> k),
           (select o.id from look_option o where o.kind = k and o.fallback order by o.ord limit 1),
           (select o.id from look_option o where o.kind = k order by o.ord limit 1))), '{}'::jsonb)
  from unnest(look_kinds()) k
$$;

/**
 * Somebody, at random.
 *
 * What a body with nobody behind it is given — an anonymous browser, or one
 * that came ashore before it ever saw the creator. Better than the default for
 * the same reason a crowd of identical people is worse than a crowd.
 *
 * It draws from `gen_random_uuid()` rather than from `random()`, and that is
 * not fussiness. The suite seeds `random()` once at the top so that a roll
 * that reads differently from last time is a change in the rules rather than
 * the luck of the draw — and every join now rolls a face, so drawing from the
 * seeded stream shifted every dig, swing and cast that came after it. A
 * hundred and forty-six measurements moved and not one of them was about
 * faces. Postgres's uuid source is its own, so this takes nothing out of the
 * sequence the island is measured with.
 */
create or replace function look_random() returns jsonb language sql volatile as $$
  select coalesce(jsonb_object_agg(k, (
    select o.id from look_option o where o.kind = k
    order by md5(gen_random_uuid()::text) limit 1)), '{}'::jsonb)
  from unnest(look_kinds()) k
$$;

/** What you chose, kept with the account, so it follows you between islands. */
alter table account add column if not exists look jsonb;
/** And what the body on this island looks like, which is what everybody else reads. */
alter table player add column if not exists look jsonb not null default '{}'::jsonb;

/**
 * Choose a face.
 *
 * Cleaned before it is stored rather than on the way out, so that what is in
 * the row is already true and everything downstream — the join, the roster,
 * somebody else's renderer — can read it without asking again.
 *
 * It writes through to every body you already have ashore. A look you change
 * and then have to travel to collect is a look that is wrong everywhere you
 * are not standing.
 */
create or replace function rpc_set_look(p_look jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_look jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_look := look_clean(p_look);
  -- Asking your own name is what files the account row, and a face belongs on
  -- one. Doing it here means the creator works on the first visit, before
  -- anything else has had a reason to ask.
  perform rpc_my_name();
  update account set look = v_look where uid = v_uid;
  if not found then raise exception 'no account to put a face on'; end if;
  update player set look = v_look where uid = v_uid;
  return v_look;
end $$;

/** The face on your account, or null if you have not chosen one yet. */
create or replace function rpc_my_look() returns jsonb
  language sql stable security definer set search_path = public as $$
  select a.look from account a where a.uid = (select auth.uid())
$$;

/**
 * Coming ashore, now with a face on.
 *
 * A new body takes the account's look; one that has no account takes a random
 * one, so that nobody is ever the default figure. A body that is already here
 * is brought up to whatever the account says now, which is what makes the
 * creator work from anywhere: change your hair on the landing page and the
 * island you were standing on has it before you get back.
 */
create or replace function rpc_join(p_world uuid, p_name text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w world; p player; born boolean := false; v_look jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then raise exception 'no such island'; end if;
  if not w.ready then raise exception 'that island is still being laid down'; end if;
  select a.look into v_look from account a where a.uid = me;

  select * into p from player where world_id = p_world and uid = me;
  if not found then
    insert into player (world_id, uid, name, x, y, stats, look)
    values (p_world, me, coalesce(nullif(trim(p_name), ''), 'Wanderer'), w.spawn_x + 0.5, w.spawn_y + 0.5,
            '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb,
            look_clean(coalesce(v_look, look_random())))
    returning * into p;
    born := true;
    perform starter_kit(p_world, me);
    perform tell(p_world, me, 'You wash ashore on an untouched island with a few tools and your wits.', 'system');
  else
    update player set seen_at = now(), name = coalesce(nullif(trim(p_name), ''), name),
           look = look_clean(coalesce(v_look, nullif(player.look, '{}'::jsonb), look_random()))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, 'Your journey continues where you left off.', 'system');
  end if;

  return jsonb_build_object(
    'world', to_jsonb(w) - 'made_by',
    'you', to_jsonb(p),
    'new', born,
    'time', world_time(p_world));
end $$;

select private.lock_doors();

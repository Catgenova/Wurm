-- The kit everybody washes ashore with, which was not the kit.
--
-- ## A knife that was never in the game
--
-- The port handed every new player nine things, one of which was a `knife`.
-- There is no `knife` in this game — there is a carving knife, a hunting
-- knife and a butchering knife — so every player on this island has been
-- carrying a thing with no definition behind it since the first migration: no
-- name, no weight, no description, no material. Nothing noticed, because
-- nothing had ever asked one of them a question.
--
-- `examine_item` asked. It builds its sentence out of the item's definition
-- and got nothing back, and a null in a concatenation is a null all the way
-- out — so the action died on a not-null constraint rather than saying a
-- word. The live smoke test found it by looking at the first thing in the
-- pack, which the local suite had never done because it always examined
-- something it had put there itself.
--
-- While the kit is open: the browser hands out twelve things, not nine, and
-- every one of them has a material on it. Copper heads on pine handles, which
-- is the poorest of everything — the first bronze tool you cast for yourself
-- is already better than any of it.

create or replace function starter_kit(p_world uuid, p_uid uuid) returns void
  language plpgsql as $$
declare r record;
begin
  for r in select * from (values
      ('hatchet', 20, 'Copper'), ('shovel', 20, 'Copper'), ('pickaxe', 20, 'Copper'),
      ('carving_knife', 20, 'Copper'), ('chisel', 15, 'Copper'), ('mallet', 20, 'Pine'),
      ('trowel', 20, 'Copper'), ('saw', 20, 'Copper'), ('butchering_knife', 20, 'Copper'),
      ('rake', 20, 'Copper'), ('water_skin', 30, null)) v(def, ql, made)
  loop
    insert into item (world_id, holder, holder_uid, def, ql, extra, issued, charges)
    values (p_world, 'player', p_uid, r.def, r.ql, r.made, true,
            (select charges from item_def where id = r.def));
  end loop;
  -- And the stake, which is the only thing in the kit that is not a tool.
  insert into item (world_id, holder, holder_uid, def, ql, extra)
  values (p_world, 'player', p_uid, 'deed_stake', 50, 'Pine');
end $$;

/**
 * Anything already carrying the knife that never was.
 *
 * Migrations are append-only and this island has people on it, so the ones who
 * came ashore before this is applied are holding a thing with nothing behind
 * it. It becomes the carving knife it was always meant to be.
 */
update item set def = 'carving_knife', extra = coalesce(extra, 'Copper') where def = 'knife';

create or replace function rpc_join(p_world uuid, p_name text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w world; p player; born boolean := false;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then raise exception 'no such island'; end if;
  if not w.ready then raise exception 'that island is still being laid down'; end if;

  select * into p from player where world_id = p_world and uid = me;
  if not found then
    insert into player (world_id, uid, name, x, y, stats)
    values (p_world, me, coalesce(nullif(trim(p_name), ''), 'Wanderer'), w.spawn_x + 0.5, w.spawn_y + 0.5,
            '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb)
    returning * into p;
    born := true;
    -- Issued, so no one can better it into something it was never meant to be.
    perform starter_kit(p_world, me);
    perform tell(p_world, me, 'You wash ashore on an untouched island with a few tools and your wits.', 'system');
  else
    update player set seen_at = now(), name = coalesce(nullif(trim(p_name), ''), name)
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

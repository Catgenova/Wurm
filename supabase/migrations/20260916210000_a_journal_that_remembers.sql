-- A journal that remembers, which this island has never had.
--
-- Eighty-five goals in the journal, and forty-six of them ask the same
-- question: `did('tree')`, `did('ore')`, `did('brew')` — a count of things you
-- have done, kept in `game.tally`. Twelve more ask the ledger what has come
-- off your bench. **Not one of them can ever tick on an island.**
--
-- Three separate reasons, and every one of them fatal on its own.
--
--   * **Nothing notes.** `g.note('tree')` is written into the browser's own
--     performer for felling a tree, and on an island the island fells it.
--     Forty-odd keys, every one of them set by code that does not run.
--
--   * **Nothing keeps.** `tally`, `ledger` and `ticked` live in the local
--     save, and `main.ts` starts the save loop behind `if (!island)`. An
--     island session never saves at all, so whatever a guest did manage to
--     note went when the tab did.
--
--   * **Nothing was ever asked for.** No function down here mentions a
--     journal or a ledger, and `player` had no column for either.
--
-- So the island notes, the island keeps, and the beat carries it — behind the
-- same cursor the skill book is behind, because a tally only moves when
-- something is noted and a browser that has just opened holds none of it.
--
-- ## Where the notes go
--
-- At the point the island already knows the thing happened, which is the
-- point the browser's own note sits at: inside the success branch, not at the
-- dispatcher. Reaching `act_perform` means the action was *allowed*, and
-- allowed is not done — a taming that fails, a trap that holds nothing, a net
-- that comes up with weed. Forty-seven notes in seventeen functions, each one
-- a line next to the `tell` that says the same thing in words.
--
-- Forty of the forty-six keys the journal asks about are covered. The six
-- that are not are honest about why: `reach` and `laden` are sailing, and the
-- browser still owns how a hull moves through the water; `wounded` is noted
-- by nothing that reads it. Both sailing keys stay browser-side, which is why
-- the browser *merges* the island's tally into its own rather than replacing
-- it — the island's keys win, and a key only the browser knows about survives
-- the beat.
--
-- ## Where the ticking stays
--
-- In the browser. A goal is a question about everything at once — the book,
-- the pack, the ground, the settlement, what is standing on it — and
-- eighty-five of those predicates are eighty-five ports for another day. What
-- the island takes is the *record*: `rpc_settle` now takes the ids the
-- browser has just worked out are met, folds them into `player.ticked`, and
-- hands the whole list back. Done stays done through a refresh and a change
-- of machine, which is the half that was actually broken.
--
-- ## The ledger
--
-- `journal_made` is `Game.madeIt` term for term: the count, the best ever,
-- how many came off rare, and the two lines worth saying — the first of a
-- kind you will ever make, and the best. `first` and `bestAt` are stamped in
-- epoch seconds here where the browser stamped game time; nothing on either
-- side reads them, and a record that says *when* is worth keeping even while
-- nothing asks.

alter table player add column if not exists tally jsonb not null default '{}'::jsonb;
alter table player add column if not exists ledger jsonb not null default '{}'::jsonb;
alter table player add column if not exists ticked jsonb not null default '[]'::jsonb;
-- The same pair of hands the skill book is behind: stamped when something is
-- noted, cleared when the browser has been told.
alter table player add column if not exists tally_at timestamptz;
alter table player add column if not exists tally_seen timestamptz;

/**
 * Note that something was done, once.
 *
 * `Game.note`, and nothing more: a running count of goes, read by the journal
 * and by nothing else in the game. Deliberately not guarded — there is no
 * rule here to break, only a list of things somebody thought worth doing.
 */
create or replace function journal_note(p_world uuid, p_uid uuid, p_key text, p_n int default 1)
  returns void language sql as $fn$
  update player set
      tally = jsonb_set(coalesce(tally, '{}'::jsonb), array[p_key],
                to_jsonb(coalesce((tally->>p_key)::int, 0) + greatest(1, p_n))),
      tally_at = now()
    where world_id = p_world and uid = p_uid
      and p_uid is not null and p_key is not null and p_key <> '';
$fn$;

/**
 * Write a finished thing into the ledger, and say so when it is the best of
 * its kind you have ever managed.
 *
 * A first one is worth saying too: it is the only time you will ever make
 * your first of anything. `Game.madeIt`, term for term, down to the two
 * sentences and the threshold between them.
 */
create or replace function journal_made(p_world uuid, p_uid uuid, p_def text,
                                        p_ql double precision, p_count int, p_rare text)
  returns void language plpgsql as $fn$
declare p player; had jsonb; was double precision; v_n int; v_now double precision; v_name text;
begin
  if p_uid is null or p_def is null then return; end if;
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  had := p.ledger -> p_def;
  was := coalesce((had->>'best')::double precision, 0);
  v_n := coalesce((had->>'n')::int, 0) + greatest(1, p_count);
  v_now := extract(epoch from now());
  update player set
      ledger = jsonb_set(coalesce(ledger, '{}'::jsonb), array[p_def], jsonb_build_object(
        'n', v_n,
        'best', greatest(was, p_ql),
        'rare', coalesce((had->>'rare')::int, 0)
                + case when p_rare is not null then greatest(1, p_count) else 0 end,
        'first', coalesce(had->'first', to_jsonb(v_now)),
        'bestAt', case when p_ql > was then to_jsonb(v_now)
                       else coalesce(had->'bestAt', to_jsonb(v_now)) end)),
      tally_at = now()
    where world_id = p_world and uid = p_uid;
  perform journal_note(p_world, p_uid, 'made', greatest(1, p_count));
  perform journal_note(p_world, p_uid, 'made:' || p_def, greatest(1, p_count));
  v_name := lower((select coalesce(name, p_def) from item_def where id = p_def));
  if had is null then
    perform tell(p_world, p_uid, 'The first ' || v_name
      || ' you have ever made. (Ledger, J)', 'skill');
  elsif p_ql > was + 0.05 and v_n > 1 then
    perform tell(p_world, p_uid, 'The best ' || v_name || ' you have made: QL '
      || to_char(p_ql, 'FM990.0') || ', over ' || to_char(was, 'FM990.0') || '.', 'skill');
  end if;
end $fn$;

CREATE OR REPLACE FUNCTION public.perform_terrain(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; cx int; cy int; tx int; ty int; t tile_def; r rock_def;
        s double precision; tq double precision; yields text; made_ql double precision;
        gained double precision; tool_id bigint; here int;
begin
  select * into d from action_def where id = p_action;
  cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
  tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  if d.tool is not null then
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'mine' then
    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'The rock is hard and you fail to loosen anything.', 'event');
      return;
    end if;
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform give(p_world, p_uid, yields, 1, made_ql);
    perform tell(p_world, p_uid,
      case when yields like '%lump' then 'You chip a ' else 'You mine some ' end
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || case when yields like '%lump' then ' out of the vein.' else '.' end
      || ' (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    -- Cutting the face back is its own job. Now and again one comes down anyway.
    if random() < 0.01 then
      perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
      perform land_set_dirt(p_world, cx, cy, 0);
      perform reconcile_around(p_world, cx, cy);
      perform tell(p_world, p_uid, 'A slab breaks away of its own accord and the face drops.', 'event');
    end if;
    gained := skill_raise(p_world, p_uid, 'mining', 1);

  elsif p_action = 'chip_corner' then
    if random() >= 0.25 then
      perform tell(p_world, p_uid, 'You work at the corner and find no line in it. The face holds.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    perform land_set_dirt(p_world, cx, cy, 0);
    perform reconcile_around(p_world, cx, cy);
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform give(p_world, p_uid, yields, 1, made_ql);
    perform tell(p_world, p_uid, 'The corner breaks away and drops a step. You gather the '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    gained := skill_raise(p_world, p_uid, 'mining', 1);

  elsif p_action = 'pack' then
    here := land_tile(p_world, tx, ty);
    perform land_set_tile(p_world, tx, ty, 2);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when here <> 1
      then 'You cut the turf away and tread the ground down firm.'
      else 'You pack the dirt down firmly.' end, 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'cultivate' then
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You break up the packed earth.', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'pave_gravel' then
    if not consume(p_world, p_uid, 'rock_shards', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 13);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You spread the crushed rock into a gravel surface.', 'event');
    gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'pave_cobble' then
    if not consume(p_world, p_uid, 'stone_brick', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 14);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay the cobblestones.', 'event');
    gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'drop_dirt_here' then
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform land_set_dirt(p_world, cx, cy, land_dirt(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    perform tell(p_world, p_uid, 'You drop the dirt at your feet, raising the ground.', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);
  end if;

  if gained > 0 and d.skill is not null then
    perform tell(p_world, p_uid,
      initcap(replace(d.skill, '_', ' ')) || ' increased by ' || to_char(gained, 'FM0.0000')
      || ' to ' || to_char(skill_of(p_world, p_uid, d.skill), 'FM990.0000') || '.', 'skill');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_gather(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tx int; ty int; here int; data int; t tile_def; tool_id bigint;
        s double precision; tq double precision; made_ql double precision;
        species int; logs int; tree tree_def; gained double precision;
        passes int; i int; found text[] := '{}'; got text; yields text;
begin
  select * into d from action_def where id = p_action;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  data := land_data(p_world, tx, ty);
  select * into t from tile_def where id = here;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  if d.tool is not null then
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = d.tool
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'cut_down' then
    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    if here = tile_id('Bush') then
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You hack the bush down.', 'event');
    else
      species := tree_species(data);
      select * into tree from tree_def where id = species;
      -- An old tree is worth one log more than a grown one.
      logs := tree.logs + case when tree_age(data) = 2 then 1 else 0 end;
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      made_ql := product_ql(s, tq);
      perform give(p_world, p_uid, 'log', logs, made_ql, tree.name);
      perform journal_note(p_world, p_uid, 'tree');
      perform tell(p_world, p_uid, 'The ' || lower(tree.name) || ' tree falls. You get ' || logs
        || case when logs = 1 then ' log' else ' logs' end || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    end if;
    gained := skill_raise(p_world, p_uid, 'woodcutting', 1);

  elsif p_action in ('forage', 'botanize') then
    perform mark_foraged(p_world, tx, ty, p_action);
    -- A practised eye goes over the same ground more than once.
    passes := rolls_at(s);
    for i in 1..passes loop
      if random() < 0.2 or not skill_check(s, 5, 0) then continue; end if;
      got := roll_table(p_action, random());
      made_ql := product_ql(s, 0);
      perform give(p_world, p_uid, got, 1, made_ql);
      found := found || (lower((select coalesce(name, got) from item_def where id = got))
        || ' (QL ' || to_char(made_ql, 'FM990.0') || ')');
    end loop;
    if array_length(found, 1) is null then
      perform tell(p_world, p_uid, case when passes > 1
        then 'You go over the ground ' || passes || ' times and find nothing'
             || case when p_action = 'forage' then ' edible.' else ' of interest.' end
        else case when p_action = 'forage' then 'You find nothing edible.' else 'You find nothing of interest.' end
        end, 'event');
    else
      perform tell(p_world, p_uid, 'You find some ' || list_of(found) || '.', 'event');
    end if;
    gained := skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'collect' then
    yields := t.dig_yield;
    if yields is null then return; end if;
    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'Your shovel comes up with nothing but a smear of '
        || lower(t.name) || '.', 'event');
      return;
    end if;
    made_ql := product_ql(s, tq);
    perform give(p_world, p_uid, yields, 1, made_ql);
    perform tell(p_world, p_uid, 'You fill a shovel with '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || ' off the top of the bed. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);
  end if;

  if gained > 0 and d.skill is not null then
    perform tell(p_world, p_uid,
      initcap(replace(d.skill, '_', ' ')) || ' increased by ' || to_char(gained, 'FM0.0000')
      || ' to ' || to_char(skill_of(p_world, p_uid, d.skill), 'FM990.0000') || '.', 'skill');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_ground(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        v_skill double precision; v_tool double precision; v_ql double precision; v_n int;
        v_gained double precision; v_slab item; v_kind int; v_target int; v_hi record; v_lo record;
        v_rock rock_def; v_rad int; v_tiles int[] := '{}'; v_names text[] := '{}'; v_row record;
        v_id bigint; v_species int; v_sprout item; v_buried text; v_size int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);

  if p_action = 'flatten' then
    v_target := flatten_target(p_world, p_uid, tx, ty);
    -- The corners furthest above and below the height we are working towards.
    select c.cx, c.cy into v_hi from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) > v_target
      order by land_height(p_world, c.cx, c.cy) desc limit 1;
    select c.cx, c.cy into v_lo from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) < v_target
      order by land_height(p_world, c.cx, c.cy) limit 1;
    if v_hi.cx is null and v_lo.cx is null then return; end if;
    -- Only soil can be moved with a shovel; bedrock needs a pickaxe.
    if v_hi.cx is not null and land_dirt(p_world, v_hi.cx, v_hi.cy) <= 0 then
      perform tell(p_world, p_uid, 'The high corner is bare rock. Mine it down instead.', 'error');
      return;
    end if;
    if v_hi.cx is not null and v_lo.cx is not null then
      -- One corner down and one up: the dirt simply moves across the tile.
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
      perform tell(p_world, p_uid, 'You move some dirt across the tile.', 'event');
    elsif v_hi.cx is not null then
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform give(p_world, p_uid, 'dirt', 1,
        product_ql(skill_of(p_world, p_uid, 'digging'), tool_ql(p_world, p_uid, 'shovel')));
      perform tell(p_world, p_uid, 'You scrape the ground down and pocket the dirt.', 'event');
    else
      if not consume(p_world, p_uid, 'dirt', 1) then
        perform tell(p_world, p_uid, 'You need dirt to bring this ground up to your level.', 'error');
        return;
      end if;
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
      perform tell(p_world, p_uid, 'You pack dirt in to bring the ground up.', 'event');
    end if;
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    if not needs_flattening(p_world, p_uid, tx, ty) then
      perform tell(p_world, p_uid,
        case when floor((select x from player where world_id = p_world and uid = p_uid))::int = tx
              and floor((select y from player where world_id = p_world and uid = p_uid))::int = ty
             then 'The tile is now flat at its lowest corner.'
             else 'The tile is now flat and level with the ground you stand on.' end, 'event');
    end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    perform raise_corner(p_world, cx, cy, 1);
    if here in (0, 20) then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You drop the dirt on the ' || corner_name(tx, ty, cx, cy)
      || ' corner, raising the ground.', 'event');

  elsif p_action = 'pave_slabs' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = nullif(p_target->>'uid', '')::bigint) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    if not skill_check(skill_of(p_world, p_uid, 'paving'), 10, v_slab.ql) then
      perform tell(p_world, p_uid,
        'The slab rocks on its bed however you set it. You leave it for now.', 'event');
      return;
    end if;
    if not consume(p_world, p_uid, v_slab.def, 1, v_slab.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 21);
    perform land_set_data(p_world, tx, ty, v_kind);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You bed the '
      || lower((select name from item_def where id = v_slab.def)) || ' down flat and true.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'remove_paving' then
    -- A slab comes up whole more often than not; gravel and cobbles do not.
    v_kind := case when here = 21 then v_data & 3 else null end;
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    if v_kind is not null and random() < 0.6 then
      v_ql := product_ql(skill_of(p_world, p_uid, 'paving'));
      perform give(p_world, p_uid, (select item from slab_def where id = v_kind), 1, v_ql);
      perform tell(p_world, p_uid, 'You lever the '
        || regexp_replace(lower((select name from slab_def where id = v_kind)), 's$', '')
        || ' up whole. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    else
      perform tell(p_world, p_uid, 'You break up the paving, leaving bare dirt.', 'event');
    end if;
    v_gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'cut_grass' then
    perform mark_foraged(p_world, tx, ty, 'grass');
    perform give(p_world, p_uid, 'mixed_grass', 2, product_ql(skill_of(p_world, p_uid, 'foraging')));
    perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_reeds' then
    perform mark_foraged(p_world, tx, ty, 'reed');
    v_skill := skill_of(p_world, p_uid, 'foraging');
    v_n := 2 + case when random() < v_skill / 140 then 1 else 0 end;
    perform give(p_world, p_uid, 'reed', v_n,
      product_ql(v_skill, tool_ql(p_world, p_uid, 'carving_knife')));
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' reeds out of the bed.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'pick_fruit' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- An old tree carries more than one only just come into bearing.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_n := greatest(1, round(case when tree_age(v_data) = 2 then 5 else 3 end
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int);
    v_ql := product_ql(v_skill);
    perform give(p_world, p_uid, v_tree.fruit, v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You pick ' || v_n || ' '
      || lower((select name from item_def where id = v_tree.fruit))
      || case when v_n = 1 then '' else 's' end
      || ' off the ' || lower(v_tree.name) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'pick_sprout' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not skill_check(skill_of(p_world, p_uid, 'forestry'), 15) then
      perform tell(p_world, p_uid, 'You find no sprout worth picking.', 'event');
      return;
    end if;
    perform give(p_world, p_uid, 'sprout', 1,
      product_ql(skill_of(p_world, p_uid, 'forestry')), v_tree.name);
    perform tell(p_world, p_uid, 'You pick a ' || lower(v_tree.name) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'plant' then
    select * into v_sprout from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'sprout' and not locked order by id limit 1;
    if not found then return; end if;
    v_species := coalesce((select id from tree_def where name = v_sprout.extra), 0);
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 16);
    -- Species in the low nibble, age in the two bits above it: a planted tree
    -- starts as a sapling and grows on the same clock as one that seeded itself.
    perform land_set_data(p_world, tx, ty, v_species & 15);
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'planted');
    if (select fruit from tree_def where id = v_species) is not null then
      perform journal_note(p_world, p_uid, 'orchard');
    end if;
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'dig_worms' then
    v_gained := skill_raise(p_world, p_uid, 'digging', 0.2);
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id, 0.4); end if;
    -- Damp ground gives more than dry: a marsh is full of them.
    v_n := floor(random() * case when t.rich_worms then 5 else 3 end)::int
           + case when t.rich_worms then 1 else 0 end;
    if v_n = 0 then
      perform tell(p_world, p_uid, 'You turn a spadeful over and nothing is moving in it.', 'event');
      return;
    end if;
    perform give(p_world, p_uid, 'worm', v_n, 20 + random() * 40);
    perform journal_note(p_world, p_uid, 'worms');
    perform tell(p_world, p_uid, 'You turn the dirt over and pick ' || v_n || ' worm'
      || case when v_n > 1 then 's' else '' end || ' out of it.', 'event');

  elsif p_action = 'prospect' then
    v_skill := skill_of(p_world, p_uid, 'prospecting');
    v_rad := prospect_radius(v_skill);
    v_size := (select size from world where id = p_world);
    -- Metal counts wherever it lies: bare, under soil, or below water.
    for v_row in select x, y, (bedrock_at(p_world, x, y)).name as nm
      from generate_series(greatest(0, tx - v_rad), least(v_size - 1, tx + v_rad)) x
      cross join generate_series(greatest(0, ty - v_rad), least(v_size - 1, ty + v_rad)) y
      where (bedrock_at(p_world, x, y)).ore
      order by y, x
    loop
      v_tiles := v_tiles || (v_row.y * v_size + v_row.x);
      v_names := v_names || lower(v_row.nm);
    end loop;
    perform mark_prospected(p_world, p_uid, v_tiles);

    -- Sampling where you stand tells you what that particular rock holds.
    v_rock := bedrock_at(p_world, tx, ty);
    v_ql := ore_max_ql((select seed from world where id = p_world), tx, ty);
    v_buried := case when here = 4 then ''
      else ' It lies under ' || greatest(1, land_dirt(p_world, tx, ty)) || ' of ground.' end;
    if v_rock.ore then
      perform tell(p_world, p_uid, 'You sample the ' || lower(v_rock.name)
        || '. It needs mining ' || to_char(v_rock.level, 'FM990')
        || ' to work' || case when skill_of(p_world, p_uid, 'mining') >= v_rock.level
                              then ', which you have' else '' end
        || ', and will give up nothing finer than quality ' || to_char(v_ql, 'FM990')
        || '.' || v_buried, 'event');
    else
      perform tell(p_world, p_uid, 'Plain ' || lower(v_rock.name)
        || ' beneath you, with no metal in it, and nothing finer than quality '
        || to_char(v_ql, 'FM990') || ' in the stone.' || v_buried, 'event');
    end if;

    if coalesce(array_length(v_tiles, 1), 0) = 0 then
      perform tell(p_world, p_uid, 'You read the ground ' || v_rad
        || ' tiles about you and find no sign of metal.', 'event');
    else
      perform tell(p_world, p_uid, 'Within ' || v_rad || ' tiles you read '
        || (select string_agg(case when n > 1 then n || ' tiles of ' || nm
                                   else 'a tile of ' || nm end, ' and ' order by nm)
            from (select nm, count(*) as n from unnest(v_names) nm group by nm) q)
        || ', buried or bare. They are marked for a while.', 'event');
    end if;
    v_gained := skill_raise(p_world, p_uid, 'prospecting', 1);
  end if;

  if v_gained > 0 then
    perform tell(p_world, p_uid, (select name from skill_def where id =
        (select skill from action_def where id = p_action))
      || ' increased by ' || to_char(v_gained, 'FM0.0000') || ' to '
      || to_char(skill_of(p_world, p_uid, (select skill from action_def where id = p_action)),
                 'FM990.0000'), 'skill');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r recipe; i record; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        weight double precision := 0; one double precision; gained double precision;
begin
  select * into r from recipe where id = p_recipe;
  prefer := nullif(p_target->>'uid', '')::bigint;
  mat := craft_material(p_world, p_uid, p_recipe, prefer);
  s := skill_of(p_world, p_uid, r.skill);
  tq := case when r.tool is null then 0 else tool_ql(p_world, p_uid, r.tool) end;
  -- Oak and the deep metals fight the hands that shape them.
  hard := coalesce(r.difficulty, 0) + coalesce((select difficulty from material_def where id = mat), 0);

  if r.difficulty is not null and not skill_check(s, hard, tq) then
    if r.consume_on_fail then
      for i in select * from recipe_input where recipe = p_recipe order by ord loop
        perform consume(p_world, p_uid, i.item, i.count, prefer, mat);
      end loop;
      -- The batch is wasted, not the vessel: you tip the ruin out and keep the
      -- bucket. Salvage if the recipe names any, otherwise whatever it returns.
      for i in
        select g.item, g.count from recipe_gives g
        where g.recipe = p_recipe
          and g.kind = (case when exists (select 1 from recipe_gives where recipe = p_recipe and kind = 'salvage')
                             then 'salvage' else 'return' end)
      loop
        perform give(p_world, p_uid, i.item, i.count, 20);
      end loop;
    end if;
    perform tell(p_world, p_uid, coalesce(r.fail,
      'You fail to make ' || lower((select coalesce(name, r.result) from item_def where id = r.result)) || '.'), 'event');
    return;
  end if;

  -- The quality of what is about to be used up, worked out before it is used
  -- up, since using it up changes the answer.
  if r.ql_from_inputs then
    for i in select * from recipe_input where recipe = p_recipe order by ord loop
      select it.ql into one from item it
        where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = i.item
        order by it.id limit 1;
      if one is not null then
        total := total + one * i.count;
        weight := weight + i.count;
      end if;
    end loop;
  end if;

  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    if not consume(p_world, p_uid, i.item, i.count, prefer, mat) then return; end if;
  end loop;

  if r.ql_from_inputs then
    made_ql := greatest(1, least(100, (case when weight > 0 then total / weight else 1 end) * (0.78 + s / 460)));
  else
    made_ql := product_ql(s, tq);
  end if;
  rare := rarity_roll();
  perform give(p_world, p_uid, r.result, r.count, made_ql, coalesce(r.extra, mat), rare);
  -- Into the ledger, which is the only memory this island has of what you have
  -- made. It says so when it is your first of a kind or your best.
  perform journal_made(p_world, p_uid, r.result, made_ql, r.count, rare);
  if rare is not null then
    perform journal_note(p_world, p_uid, rare);
    perform tell(p_world, p_uid, rarity_word(rare), 'skill');
  end if;
  for i in select g.item, g.count from recipe_gives g where g.recipe = p_recipe and g.kind = 'return' loop
    perform give(p_world, p_uid, i.item, i.count, 20);
  end loop;

  gained := skill_raise(p_world, p_uid, r.skill, 1);
  -- Working a thing out with your hands is what sharpens the head.
  perform skill_raise(p_world, p_uid, 'mind_logic', 0.25);
  perform tell(p_world, p_uid, r.done || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  if gained > 0 then
    perform tell(p_world, p_uid,
      initcap(replace(r.skill, '_', ' ')) || ' increased by ' || to_char(gained, 'FM0.0000')
      || ' to ' || to_char(skill_of(p_world, p_uid, r.skill), 'FM990.0000') || '.', 'skill');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_forge(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item; m metal_def;
        v_per double precision; v_room double precision; v_fits int; v_whole int;
        v_ql double precision; v_mould_ql double precision; v_hard double precision;
        v_rare text; v_made bigint; v_broke boolean; v_sz int[]; v_sx int; v_sy int;
        v_gained double precision; v_left double precision;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    perform placed_settle((p_target->>'id')::bigint);
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;

    if p_action = 'fuel_oven' then
      select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and not locked and fuel_value(def) is not null
        and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
        order by id limit 1;
      if not found then return; end if;
      v_per := fuel_value(it.def);
      v_room := greatest(0, oven_capacity() - p.fuel);
      v_fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                                  ceil(v_room / v_per)::int));
      if not consume(p_world, p_uid, it.def, v_fits, it.id) then return; end if;
      update placed set fuel = least(oven_capacity(), p.fuel + v_per * v_fits), since = now()
        where id = p.id;
      perform tell(p_world, p_uid, 'You feed '
        || case when v_fits > 1 then v_fits || ' × ' else 'a ' end
        || lower((select name from item_def where id = it.def)) || ' into the oven. '
        || oven_burns_for(least(oven_capacity(), p.fuel + v_per * v_fits)) || ' of fuel.', 'event');

    elsif p_action = 'light_oven' then
      update placed set lit = true, since = now() where id = p.id;
      perform tell(p_world, p_uid, 'The oven draws and the fire takes hold. '
        || oven_burns_for(p.fuel) || ' of fuel.', 'event');

    elsif p_action = 'put_out_oven' then
      update placed set lit = false, since = now() where id = p.id;
      perform tell(p_world, p_uid,
        'You rake the fire out of the oven. It will keep its heat for nobody.', 'event');

    elsif p_action = 'take_ashes_oven' then
      v_whole := floor(p.ash)::int;
      update placed set ash = p.ash - v_whole, since = now() where id = p.id;
      perform give(p_world, p_uid, 'ash', v_whole, 20);
      perform tell(p_world, p_uid, 'You rake ' || v_whole
        || case when v_whole = 1 then ' lot' else ' lots' end
        || ' of ashes out of the oven. (QL 20)', 'event');
    end if;
    return;
  end if;

  if p_action in ('candle_lantern', 'light_lantern', 'douse_lantern') then
    perform lantern_settle((p_target->>'uid')::bigint);
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint;
    if not found then return; end if;
    if p_action = 'candle_lantern' then
      if not consume(p_world, p_uid, 'candle', 1) then return; end if;
      update item set charges = round(candle_burn(it.ql))::int, lit = false, lit_at = null
        where id = it.id;
      perform tell(p_world, p_uid, 'You set a candle in the lantern. '
        || ceil(candle_burn(it.ql) / 60) || ' minutes of it, at a guess.', 'event');
    elsif p_action = 'light_lantern' then
      -- A torch is wound and then lit; the pitch in it only starts burning at
      -- the moment it catches, so its clock starts here rather than at the bench.
      if it.def = 'torch' and candle_left(it) <= 0 then
        update item set charges = round(torch_burn(it.ql))::int where id = it.id;
        select * into it from item where id = it.id;
      end if;
      update item set lit = true, lit_at = now() where id = it.id;
      perform tell(p_world, p_uid, case when it.def = 'torch'
        then 'You touch the torch to the ' || flame_near(p_world, p_uid, it.id)
             || ' and it takes. ' || ceil(candle_left(it) / 60) || ' minutes of it, throwing '
             || held_reach(it.def, it.ql) || ' tiles.'
        else 'You take a light off the ' || flame_near(p_world, p_uid, it.id)
             || ' and the lantern throws it ' || held_reach(it.def, it.ql) || ' tiles.' end, 'event');
    else
      v_left := candle_left(it);
      update item set lit = false, lit_at = null, charges = round(v_left)::int where id = it.id;
      perform tell(p_world, p_uid, case when it.def = 'torch'
        then 'You smother the torch. ' || ceil(v_left / 60)
             || ' minutes of it left, if it will take again.'
        else 'You pinch the wick out. ' || ceil(v_left / 60) || ' minutes of candle saved.' end, 'event');
    end if;
    return;
  end if;

  if p_action = 'place_anvil' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'anvil' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
      order by id limit 1;
    if not found then return; end if;
    v_sx := least(subtiles() - anvil_subtiles(), greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - anvil_subtiles(), greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, 'anvil', coalesce(it.extra, 'copper'),
            (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 1.0) / subtiles(),
            (p_target->>'y')::int + (v_sy + 1.0) / subtiles(), it.ql, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' || lower(anvil_name(p))
      || ' down. Bring a filled mould to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_anvil' then
    perform give(p_world, p_uid, 'anvil', 1, p.ql, p.sub);
    perform tell(p_world, p_uid, 'You heave the ' || lower(anvil_name(p))
      || ' up onto your shoulder.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  -- Smithing: the mould, the metal, the anvil and the hands, in that order.
  select * into v_mould from item where world_id = p_world
    and id = nullif(p_target->>'mould', '')::bigint;
  select * into d from mould_def where id = v_mould.def;
  v_lump := smith_lump(p_world, p_uid, nullif(p_target->>'uid', '')::bigint);
  select * into m from metal_def where lump = v_lump.def;
  if v_mould.id is null or d.id is null or v_lump.id is null or m.id is null
     or v_lump.count < d.lumps then return; end if;
  if not consume(p_world, p_uid, v_lump.def, d.lumps, v_lump.id) then return; end if;

  v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg / 2);
  -- Every filling wears the mould, and a hard metal takes more out of it.
  v_broke := v_mould.dmg + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30) >= 100;
  if v_broke then
    delete from item where id = v_mould.id;
  else
    update item set dmg = least(100, v_mould.dmg
        + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30))
      where id = v_mould.id;
  end if;

  -- The deeper the seam it came out of, the harder it is to beat into shape.
  v_hard := d.difficulty + (mat_of(v_lump.extra)).difficulty;
  if not skill_check(skill_of(p_world, p_uid, d.skill), v_hard, anvil_ql(p),
                     mind_ease(p_world, p_uid)) then
    v_gained := skill_raise(p_world, p_uid, d.skill, 0.25);
    perform tell(p_world, p_uid, 'The '
      || lower((select name from item_def where id = d.makes))
      || ' comes out misshapen and you throw the metal back.'
      || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                                || ' cracks through.' else '' end, 'event');
    return;
  end if;

  v_ql := smith_ql(p_world, p_uid, d.skill, v_mould_ql, v_lump.ql, anvil_ql(p));
  v_gained := skill_raise(p_world, p_uid, d.skill, 0.5);
  v_rare := rarity_roll();
  v_made := give(p_world, p_uid, d.makes, d.per, v_ql, m.name, v_rare);
  perform journal_made(p_world, p_uid, d.makes, v_ql, d.per, v_rare);
  perform journal_note(p_world, p_uid, 'smithed');
  -- The four that come out of the deep seams, which are worth a line of their own.
  if m.id in ('adamantine', 'glimmersteel', 'mithril', 'seryll') then
    perform journal_note(p_world, p_uid, 'moonmetal');
  end if;
  if v_rare is not null then
    perform journal_note(p_world, p_uid, v_rare);
    perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
  end if;
  perform tell(p_world, p_uid, 'You beat out '
    || case when d.per > 1 then d.per || ' ' else 'a ' end
    || lower(m.name) || ' '
    || case when d.per > 1 and right(lower((select name from item_def where id = d.makes)), 1) <> 's'
            then lower((select name from item_def where id = d.makes)) || 's'
            else lower((select name from item_def where id = d.makes)) end
    || ' on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')'
    || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                              || ' cracks through and is done.'
            else ' The mould has ' || mould_uses_left(v_mould.ql, v_mould.dmg
                   + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30))
                 || ' fillings left.' end, 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.perform_creature(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; food text; n int; made_ql double precision;
        gained double precision; chance double precision; warm double precision; nm text;
        held int; brush_id bigint; top double precision; before double precision; skill double precision;
        dd deed;
begin
  c := target_creature(p_world, p_target);
  if c.world_id is null then return; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born);

  if p_action = 'examine_creature' then
    if c.mode = 'wild' and d.monster then
      perform tell(p_world, p_uid, 'A ' || lower(d.name) || ': ' || d.description
        || ' It has ' || ceil(c.health) || ' of ' || max_health(c) || ' in it and hits for '
        || to_char(attack_of(c), 'FM990') || '. It cannot be tamed. Kill it and butcher it, or keep well clear.', 'error');
    elsif c.mode = 'wild' then
      warm := coax_bonus(c);
      perform tell(p_world, p_uid, 'A wild ' || lower(d.name) || ': ' || d.description
        || ' It eats ' || diet_text(c.species) || '.'
        || case when warm > 0 then ' It has taken ' ||
             case when c.coaxed = 1 then 'an offering' else c.coaxed || ' offerings' end
             || ' from your hand and is ' || to_char(warm * 100, 'FM990') || '% readier for the next.'
           else '' end
        || ' You would have to tame it to learn more.', 'event');
    else
      perform tell(p_world, p_uid, c.name || ' (' || c.sex || ' ' || lower(d.name) || ', ' || a.name
        || '): ' || d.description || ' Level ' || creature_level(c.skills)
        || '. Health ' || ceil(c.health) || '/' || max_health(c) || '. It is ' || care_word(c.care)
        || ' and carries ' || trait_names(c.traits) || '. '
        || case when c.hunger < 0.3 then 'It looks hungry.' when c.hunger < 0.6 then 'It could eat.'
                else 'It looks well fed.' end
        || ' It eats ' || diet_text(c.species) || '.', 'event');
    end if;

  elsif p_action = 'tame' then
    food := bait_in_pack(p_world, p_uid, c.species);
    if food is null or not consume(p_world, p_uid, food, 1) then return; end if;
    chance := tame_chance(p_world, p_uid, c);
    update creature set hunger = least(1, hunger + 0.25) where world_id = p_world and id = c.id;
    if random() < chance then
      held := companion_of(p_world, p_uid);
      update creature set
          mode = case when held is null then 'active' else 'stored' end,
          stance = 'defensive', keeper = p_uid, coaxed = 0, coaxed_at = null
        where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' takes the '
        || material_name(food, 1) || ' from your hand and trusts you. '
        || case when held is null then c.name || ' now follows you.'
             else 'As you already travel with a companion, it is kept at the token of '
                  || coalesce((select name from deed where world_id = p_world and founded_by = p_uid), 'your settlement') || '.' end, 'system');
      perform journal_note(p_world, p_uid, 'tamed');
      perform skill_told(p_world, p_uid, 'taming', 0.7);
      perform skill_told(p_world, p_uid, 'soul_strength', 0.4);
    else
      -- It refused, but it stayed for the offering, and that is worth
      -- something to the next one.
      update creature set coaxed = coaxed + 1, coaxed_at = now()
        where world_id = p_world and id = c.id returning * into c;
      warm := coax_bonus(c);
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' '
        || replace(d.tame_fail, '{food}', material_name(food, 1)) || '.'
        -- No ceiling on it any more, so nothing here says there is one: this
        -- read "as used to you as it will get" from the fourth offering on,
        -- which was true then and is not now.
        || case when warm > 0 then ' It is growing used to you: '
             || to_char(warm * 100, 'FM990') || '% readier than the first time.'
           else '' end, 'event');
      perform skill_told(p_world, p_uid, 'taming', 0.35);
      perform skill_told(p_world, p_uid, 'soul_strength', 0.2);
    end if;

  elsif p_action = 'feed' then
    food := bait_in_pack(p_world, p_uid, c.species);
    if food is null or not consume(p_world, p_uid, food, 1) then return; end if;
    update creature set hunger = least(1, hunger + 0.5) where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' gobbles up the ' || material_name(food, 1) || '.', 'event');

  elsif p_action = 'groom' then
    select i.id into brush_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'brush'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    skill := skill_of(p_world, p_uid, 'animal_husbandry');
    before := c.care;
    top := max_health(c);
    update creature set
        care = least(1, care + 0.18 + (skill / 100) * 0.34
                          + (least(100, tool_ql(p_world, p_uid, 'brush')) / 100) * 0.22),
        -- A brushing is also a looking-over: it finds the small hurts.
        health = least(top, health + top * 0.06)
      where world_id = p_world and id = c.id returning * into c;
    if brush_id is not null then perform wear_tool(brush_id, 3); end if;
    perform journal_note(p_world, p_uid, 'groom');
    if c.care >= 0.995 then perform journal_note(p_world, p_uid, 'groomfull'); end if;
    gained := skill_told(p_world, p_uid, 'animal_husbandry', 0.4);
    perform tell(p_world, p_uid, case when before < 0.12 and c.care >= 0.12
        then 'You work the dust out of ' || c.name || '''s coat. It leans into the brush. ('
        else 'You brush ' || c.name || ' down. (' end || care_word(c.care) || ')', 'event');

  elsif p_action = 'shear' then
    -- A full fleece is three, a half-grown one is one, and quality follows the fleece.
    n := greatest(1, round(c.fleece * case when coalesce(d.shear_yield, 'wool') = 'wool' then 3 else 6 end)::int);
    made_ql := greatest(1, least(100, 15 + c.fleece * 45 + skill_of(p_world, p_uid, 'tailoring') * 0.4));
    perform give(p_world, p_uid, coalesce(d.shear_yield, 'wool'), n, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'tailoring', 0.4);
    perform skill_told(p_world, p_uid, 'taming', 0.1);
    perform tell(p_world, p_uid, 'You '
      || case when coalesce(d.shear_yield, 'wool') = 'wool' then 'shear' else 'pluck' end
      || ' ' || c.name || ' and come away with ' || n || ' '
      || lower((select coalesce(name, 'wool') from item_def where id = coalesce(d.shear_yield, 'wool')))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ') It will grow back.', 'event');

  elsif p_action = 'milk_creature' then
    if not consume(p_world, p_uid, 'bucket', 1) then return; end if;
    -- What it has been fed on is what comes out of it.
    made_ql := greatest(1, least(100, 20 + c.fleece * 40 + c.hunger * 30));
    perform give(p_world, p_uid, 'milk_bucket', 1, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'farming', 0.3);
    perform tell(p_world, p_uid, 'You milk ' || c.name || ' into the bucket. (QL '
      || to_char(made_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'set_stance' then
    update creature set stance = p_target->>'stance' where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will be ' || (p_target->>'stance') || '.', 'info');

  elsif p_action = 'rename_creature' then
    nm := left(btrim(p_target->>'name'), 24);
    update creature set name = nm where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'It answers to ' || nm || ' now.', 'info');

  elsif p_action = 'take_creature' then
    held := companion_of(p_world, p_uid);
    if held is not null then
      update creature set mode = 'stored' where world_id = p_world and id = held;
      perform tell(p_world, p_uid,
        (select name from creature where world_id = p_world and id = held)
        || ' stays at the token for now.', 'info');
    end if;
    update creature set mode = 'active', keeper = p_uid, settled_at = now()
      where world_id = p_world and id = c.id;
    perform creature_settle(p_world, c.id);
    perform tell(p_world, p_uid, c.name || ' now follows you.', 'system');

  elsif p_action = 'store_creature' then
    update creature set mode = 'stored', settled_at = now() where world_id = p_world and id = c.id;
    perform creature_settle(p_world, c.id);
    perform tell(p_world, p_uid, c.name || ' is kept at the token of '
      || (select name from deed where world_id = p_world and founded_by = p_uid) || '.', 'system');

  elsif p_action = 'assign_deed' then
    -- The same key, missed in the same place: this is the token the wildermon
    -- is being put to work around, so it is the caller's own, not whichever
    -- one the planner happened to hand back first. On an island with two
    -- settlements it teleported a stored beast to a stranger's token.
    dd := my_deed(p_world, p_uid);
    update creature set mode = 'deed', keeper = p_uid, phase = 'idle', job = d.gathers,
        work_x = null, work_y = null, carrying = null,
        from_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        from_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        to_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        to_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select plain from gather_def where id = d.gathers), 'stay around the settlement')
      || ' within ' || work_range(c) || ' tiles of the token and bring what it finds to the crate.', 'system');

  elsif p_action = 'release_creature' then
    -- Blood takes generations to build and a moment to walk away.
    update creature set mode = 'wild', stance = 'passive', keeper = null,
        name = d.name, coaxed = 0, coaxed_at = null, until = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' ' || d.leaves || '.', 'system');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_fish(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; spot record; skill double precision; rod_ql double precision;
        bait text; got text; made_ql double precision; tool_id bigint; gained double precision;
        haul int; i int; parts text[] := '{}'; one text; counted jsonb := '{}'::jsonb; k text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  skill := skill_of(p_world, p_uid, 'fishing');

  if p_action = 'fish' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, cast_range());
    if spot.depth is null then return; end if;
    rod_ql := tool_ql(p_world, p_uid, 'fishing_rod');
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = 'fishing_rod'
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id, 0.5); end if;
    gained := skill_raise(p_world, p_uid, 'fishing', 0.4);

    -- Something goes on the hook if anything worth using is in the pack.
    bait := bait_for(p_world, p_uid, spot.depth, skill);
    if bait is not null and not consume(p_world, p_uid, bait, 1) then return; end if;

    got := catch_fish(spot.depth, skill, rod_ql, bait);
    if got is null then
      perform tell(p_world, p_uid, case when bait is null then 'Something takes it and comes off again.'
        else 'Something takes the ' || lower((select coalesce(name, bait) from item_def where id = bait))
             || ' and comes off again.' end, 'event');
    else
      made_ql := product_ql(skill, rod_ql);
      perform give(p_world, p_uid, got, 1, made_ql);
      perform journal_note(p_world, p_uid, 'fish:' || got);
      if bait is not null then perform journal_note(p_world, p_uid, 'baited'); end if;
      perform tell(p_world, p_uid, 'You land '
        || case when lower((select name from fish_def where id = got)) ~ '^[aeiou]' then 'an ' else 'a ' end
        || lower((select name from fish_def where id = got))
        || case when bait is null then '' else ' on the '
             || lower((select coalesce(name, bait) from item_def where id = bait)) end
        || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    end if;

  elsif p_action = 'drag_net' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, net_range());
    if spot.depth is null then return; end if;
    rod_ql := tool_ql(p_world, p_uid, 'fishing_net');
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = 'fishing_net'
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id, 1.4); end if;
    gained := skill_raise(p_world, p_uid, 'fishing', 0.55);

    if not exists (select 1 from fish_here(spot.depth, skill)) then
      perform tell(p_world, p_uid, 'The net comes up with nothing in it but weed.', 'event');
      return;
    end if;
    -- A net takes numbers, not size: the big fish go round it or through it.
    haul := 1 + floor(random() * (1 + 4 * (0.3 + least(100, rod_ql) / 160)))::int;
    for i in 1..haul loop
      one := pick_fish(spot.depth, skill, null, random());
      -- Anything that lives deeper than a net reaches mostly avoids it.
      if one is not null and ((select depth from fish_def where id = one) <= 8 or random() < 0.12) then
        counted := jsonb_set(counted, array[one], to_jsonb(coalesce((counted->>one)::int, 0) + 1));
      end if;
    end loop;
    if counted = '{}'::jsonb then
      perform tell(p_world, p_uid, 'The net comes up empty.', 'event');
      return;
    end if;
    made_ql := product_ql(skill, rod_ql);
    perform journal_note(p_world, p_uid, 'netted');
    for k in select jsonb_object_keys(counted) loop
      perform give(p_world, p_uid, k, (counted->>k)::int, made_ql);
      perform journal_note(p_world, p_uid, 'fish:' || k, (counted->>k)::int);
      parts := parts || ((counted->>k) || ' × ' || lower((select coalesce(name, k) from item_def where id = k)));
    end loop;
    perform tell(p_world, p_uid, 'You walk the net round and haul it in: '
      || array_to_string(parts, ', ') || '.', 'event');
  end if;

  if gained > 0 then
    perform tell(p_world, p_uid, 'Fishing increased by ' || to_char(gained, 'FM0.0000')
      || ' to ' || to_char(skill_of(p_world, p_uid, 'fishing'), 'FM990.0000') || '.', 'skill');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_trap(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; d trap_def; it item; c creature; s species_def; dd deed;
        v_sx int; v_sy int; v_names text; v_comers int; v_clean boolean; v_back bigint;
begin
  if p_action = 'set_trap' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and not locked and exists (select 1 from trap_def td where td.id = item.def)
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
      order by id limit 1;
    if not found then return; end if;
    select * into d from trap_def where id = it.def;
    v_sx := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, material, x, y, sx, sy, cx, cy, ql, dmg, made_by)
    values (p_world, 'trap', it.def, it.extra, (p_target->>'x')::int, (p_target->>'y')::int,
            v_sx, v_sy, (p_target->>'x')::int + (v_sx + 0.5) / subtiles(),
            (p_target->>'y')::int + (v_sy + 0.5) / subtiles(), it.ql, it.dmg, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, case when d.water
      then 'You sink the ' || lower(trap_name(p)) || ' and make the line fast. It will fish about '
           || round(trap_life(p.sub, p.ql) / 60) || ' minutes and holds ' || coalesce(d.hold, 8) || '. Bait it.'
      else 'You set the ' || lower(trap_name(p)) || ' and cover the sign of it. It will stand about '
           || round(trap_life(p.sub, p.ql) / 60) || ' minutes and will hold anything up to taming '
           || to_char(trap_holds(p), 'FM990') || '. Bait it.' end, 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;
  select * into d from trap_def where id = p.sub;

  if p_action = 'bait_trap' then
    it := bait_in_pack(p_world, p_uid, d.water);
    if it.id is null then return; end if;
    -- Whatever was in it goes back in the pack rather than on the ground.
    if p.bait is not null then perform give(p_world, p_uid, p.bait, 1, coalesce(p.bait_ql, 20)); end if;
    if not consume(p_world, p_uid, it.def, 1, it.id) then return; end if;
    update placed set bait = it.def, bait_ql = it.ql, since = now() where id = p.id;
    if d.water then
      perform tell(p_world, p_uid, 'You put the '
        || lower((select name from item_def where id = it.def))
        || ' in the creel and sink it again. '
        || coalesce((select note from bait_def where id = it.def), ''), 'event');
    else
      select count(*) into v_comers from species_def sp
        where exists (select 1 from species_diet sd where sd.species = sp.id and sd.item = it.def)
          and sp.tame_level <= trap_holds(p);
      perform tell(p_world, p_uid, 'You lay the '
        || lower((select name from item_def where id = it.def)) || ' in the ' || lower(trap_name(p))
        || '. ' || case when v_comers = 0 then 'Nothing this trap will hold eats that.'
                        when v_comers = 1 then 'One sort would come to that.'
                        else v_comers || ' sorts would come to that.' end, 'event');
    end if;

  elsif p_action = 'take_catch' then
    select * into c from creature where world_id = p_world and id = p.caught;
    if not found then return; end if;
    select * into s from species_def where id = c.species;
    -- It is held, not willing. Getting it out without being bitten is the skill.
    v_clean := skill_check(skill_of(p_world, p_uid, 'taming'), s.tame_level + 10, p.ql,
                           mind_ease(p_world, p_uid));
    perform skill_raise(p_world, p_uid, 'taming', 1.1);
    if not v_clean then
      perform tell(p_world, p_uid, 'The ' || lower(s.name)
        || ' thrashes and you cannot get a hand on it. It is still held.', 'error');
      return;
    end if;
    update placed set caught = null, bait = null, bait_ql = null where id = p.id;
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    if not exists (select 1 from creature q where q.world_id = p_world and q.mode = 'active'
                     and q.keeper = p_uid) then
      update creature set trapped = null, mode = 'active', keeper = p_uid, until = now()
        where world_id = p_world and id = c.id;
      perform journal_note(p_world, p_uid, 'trapped');
      perform tell(p_world, p_uid, 'You get the noose off the ' || lower(s.name)
        || ' and it stays. It comes with you.', 'event');
    elsif dd.world_id is not null then
      update creature set trapped = null, mode = 'stored', keeper = p_uid,
          from_x = dd.x + 0.5, from_y = dd.y + 1.5, to_x = dd.x + 0.5, to_y = dd.y + 1.5,
          leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
        where world_id = p_world and id = c.id;
      perform journal_note(p_world, p_uid, 'trapped');
      perform tell(p_world, p_uid, 'You get it out of the trap and walk it home to the token of '
        || dd.name || '.', 'event');
    end if;

  elsif p_action = 'free_catch' then
    perform spring_trap(p.id,
      'You lift the board and it is gone into the grass before you have straightened up.');

  elsif p_action = 'empty_creel' then
    select string_agg(i.count || ' × ' || lower(f.name), ', ' order by f.name), count(*)
      into v_names, v_comers
      from item i join item_def f on f.id = i.def
      where i.holder = 'trap' and i.placed = p.id;
    if v_comers = 0 then return; end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where holder = 'trap' and placed = p.id;
    perform skill_raise(p_world, p_uid, 'fishing', 0.5);
    perform journal_note(p_world, p_uid, 'creeled');
    perform tell(p_world, p_uid, 'You lift the creel and tip it out: ' || v_names || '.', 'event');

  elsif p_action = 'pick_up_trap' then
    if p.bait is not null then perform give(p_world, p_uid, p.bait, 1, coalesce(p.bait_ql, 20)); end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where holder = 'trap' and placed = p.id;
    v_back := give(p_world, p_uid, p.sub, 1, p.ql, p.material);
    update item set dmg = trap_dmg(p) where id = v_back;
    perform tell(p_world, p_uid, 'You take the ' || lower(trap_name(p)) || ' up'
      || case when p.bait is not null then ' and pocket the bait' else '' end || '.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_faith(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; pc placed; faith double precision; hour double precision;
        gained double precision; cap double precision; got double precision;
        was double precision; med double precision; sit record; v_step path_step;
        v_way text; r record;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'pray' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    faith := skill_of(p_world, p_uid, faith_skill());
    hour := hour_of_day(p_world);
    cap := favour_cap(faith);
    got := least(cap, favour_settle(p_world, p_uid) + prayer_worth(pc.ql, hour, faith));
    update player set favour = got, favour_at = now(), prayed_at = now()
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'prayed');
    perform skill_raise(p_world, p_uid, faith_skill(), 1.4);
    perform tell(p_world, p_uid,
      case when abs(hour - 6) < 2 or abs(hour - 20) < 2
           then 'You kneel in the half light and it goes better than it usually does.'
           else 'You kneel at the stone.' end
      || ' Favour ' || floor(got) || ' of ' || floor(cap) || '.', 'event');

  elsif p_action = 'cast' then
    if cast_reason(p_world, p_uid, p_target->>'spell', nullif(p_target->>'uid', '')::bigint) is not null then
      return;
    end if;
    perform journal_note(p_world, p_uid, 'cast:' || (p_target->>'spell'));
    perform tell(p_world, p_uid,
      do_cast(p_world, p_uid, p_target->>'spell', nullif(p_target->>'uid', '')::bigint), 'event');

  elsif p_action = 'meditate' then
    select * into sit from sitting_worth(p_world, p_uid);
    was := skill_of(p_world, p_uid, meditation_skill());
    update player set sat_at = now() where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'sat');
    perform skill_raise(p_world, p_uid, meditation_skill(), sit.gain);
    med := skill_of(p_world, p_uid, meditation_skill());
    perform tell(p_world, p_uid, sit.said, 'event');
    if p.way is null and med >= choose_at() and was < choose_at() then
      perform tell(p_world, p_uid, 'Something settles. Three ways of looking at all this have '
        || 'become clear, and you may walk exactly one of them. Choose from the rug.', 'system');
    end if;
    if p.way is not null then
      for r in select s.*, d.name as path_name from path_step s join path_def d on d.id = s.path
        where s.path = p.way and was < s.at and med >= s.at order by s.n
      loop
        perform tell(p_world, p_uid, r.path_name || ': ' || r.name || '. ' || r.note, 'system');
      end loop;
    end if;

  elsif p_action = 'choose_path' then
    v_way := p_target->>'material';
    if p.way is not null or not exists (select 1 from path_def where id = v_way) then return; end if;
    update player set way = v_way where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You take the path of '
      || (select name from path_def where id = v_way) || '. '
      || (select note from path_def where id = v_way), 'system');

  elsif p_action = 'use_ability' then
    v_step := ability_of(p_world, p_uid, p_target->>'material');
    if v_step.path is null then return; end if;
    update player set used_at = jsonb_set(used_at, array[v_step.ability], to_jsonb(now()))
      where world_id = p_world and uid = p_uid;
    perform skill_raise(p_world, p_uid, meditation_skill(), 0.2);
    perform tell(p_world, p_uid, work_ability(p_world, p_uid, v_step.ability), 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_last(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        dam creature; sire creature; it item; dye item; bd brew_def; dd dye_def;
        v_kind text; v_id bigint; v_h int; v_n int; v_left int; v_want text; v_back jsonb;
        v_parts text[]; v_half int; e record; r record; v_skill double precision;
        v_care double precision; v_one bigint; v_stock item; v_ql double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    if bridge_reason(p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
         (p_target->>'x')::int, (p_target->>'y')::int) is not null then return; end if;
    select * into d from bridge_def where id = v_kind;
    v_h := round((centre_height(p_world, floor(p.x)::int, floor(p.y)::int)
                + centre_height(p_world, (p_target->>'x')::int, (p_target->>'y')::int)) / 2);
    insert into bridge (world_id, kind, ax, ay, bx, by, height, material, made_by)
    values (p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
            (p_target->>'x')::int, (p_target->>'y')::int, v_h,
            case when v_kind = 'stone' then null else 'Oak' end, p_uid)
    returning id into v_id;
    insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select p_world, v_id, t.n, t.x, t.y, span_bill(v_kind), span_bill(v_kind)
    from span_tiles(floor(p.x)::int, floor(p.y)::int,
                    (p_target->>'x')::int, (p_target->>'y')::int) t;
    select count(*)::int into v_n from bridge_span sp where sp.world_id = p_world and sp.bridge = v_id;
    perform journal_note(p_world, p_uid, 'planned_bridge');
    perform skill_raise(p_world, p_uid, d.skill, 0.4);
    perform tell(p_world, p_uid, 'You set out a ' || lower(d.name) || ' of ' || v_n || ' span'
      || case when v_n > 1 then 's' else '' end || ' across. Each one wants '
      || span_wants(span_bill(v_kind)) || '. ' || d.note, 'system');

  elsif p_action = 'build_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into d from bridge_def where id = b.kind;
    select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
      and not span_done(sp.needed) order by sp.n limit 1;
    if not found then return; end if;
    -- One unit of one thing per go, as with a wall.
    select e2.key into v_want from jsonb_each(s.needed) e2
      where (e2.value)::int > 0 and pack_count(p_world, p_uid, e2.key) > 0 order by e2.key limit 1;
    if v_want is null then return; end if;
    if not consume(p_world, p_uid, v_want, 1) then return; end if;
    update bridge_span sp set needed = jsonb_set(sp.needed, array[v_want],
        to_jsonb(greatest(0, (sp.needed->>v_want)::int - 1)))
      where sp.world_id = p_world and sp.bridge = b.id and sp.n = s.n
      returning * into s;
    perform skill_raise(p_world, p_uid, d.skill, 0.5);
    perform wear_tool((select i.id from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1), 0.4);
    if span_done(s.needed) then
      v_left := bridge_left(p_world, b.id);
      if v_left > 0 then
        perform tell(p_world, p_uid, 'That span is decked. ' || v_left || ' still open.', 'event');
      else
        perform journal_note(p_world, p_uid, 'bridged');
        perform tell(p_world, p_uid, 'The last span is decked and the ' || lower(bridge_name(b))
          || ' is open. ' || case when d.carts then 'A cart will cross it.'
                                  else 'Foot traffic only; nothing with a wheel.' end, 'system');
      end if;
    else
      perform tell(p_world, p_uid, 'You work a '
        || lower((select coalesce(name, v_want) from item_def where id = v_want))
        || ' into the span. It still wants ' || span_wants(s.needed) || '.', 'event');
    end if;

  elsif p_action = 'demolish_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    -- Half of what went into it comes back, which is what pulling a thing down
    -- is worth anywhere else in the world.
    v_parts := '{}';
    for e in
      select k.key as item, sum((k.value)::int - coalesce((sp.needed->>k.key)::int, 0))::int as used
      from bridge_span sp cross join lateral jsonb_each(sp.total) k
      where sp.world_id = p_world and sp.bridge = b.id
      group by k.key order by k.key
    loop
      v_half := floor(e.used / 2.0)::int;
      if v_half > 0 then
        perform give(p_world, p_uid, e.item, v_half, 20);
        v_parts := v_parts || (v_half || ' ' ||
          lower((select coalesce(name, e.item) from item_def where id = e.item)));
      end if;
    end loop;
    delete from bridge_span where world_id = p_world and bridge = b.id;
    delete from bridge where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, case when array_length(v_parts, 1) > 0
      then 'You take the ' || lower(bridge_name(b)) || ' down and save '
           || array_to_string(v_parts, ', ') || '.'
      else 'You take the ' || lower(bridge_name(b)) || ' down.' end, 'event');

  elsif p_action = 'sleep' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    -- A well-made bed is a better night than a cot with a thin mattress.
    perform journal_note(p_world, p_uid, 'slept');
    perform sleep_until_morning(p_world, p_uid,
      (select bed from furniture_def where id = pc.sub) * (0.6 + pc.ql / 250),
      lower(placed_name(pc)));

  elsif p_action = 'set_home' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    update player set home_x = pc.x, home_y = pc.y where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You make up the ' || lower(placed_name(pc))
      || '. This is where you will wake, whatever happens to you.', 'event');

  elsif p_action = 'pair_creature' then
    c := target_creature(p_world, p_target);
    mate := mate_for(p_world, c);
    if c.world_id is null or mate.id is null or pair_refuses(p_world, c, mate) is not null then return; end if;
    if c.sex = 'female' then dam := c; sire := mate; else dam := mate; sire := c; end if;
    v_skill := skill_of(p_world, p_uid, 'animal_husbandry');
    v_care := (dam.care + sire.care) / 2;
    perform skill_raise(p_world, p_uid, 'animal_husbandry', 0.9);
    if random() >= breed_chance(v_skill, v_care) then
      -- A failed pairing costs both of them a rest, but only half of one.
      update creature set bred_at = now() - make_interval(secs => breed_rest() / 2)
        where world_id = p_world and id in (dam.id, sire.id);
      perform tell(p_world, p_uid, dam.name || ' and ' || sire.name
        || ' will have nothing to do with one another. Brush them, feed them, and try again.', 'error');
      return;
    end if;
    perform pair_them(p_world, dam.id, sire.id, v_skill);
    perform journal_note(p_world, p_uid, 'paired');
    perform tell(p_world, p_uid, sire.name || ' is put to ' || dam.name
      || '. She is in young and will drop in about ' || clock_left(gestation())
      || '. Between them they carry '
      || trait_names((select array_agg(distinct t) from unnest(sire.traits || dam.traits) t))
      || '.', 'event');

  elsif p_action = 'read_blood' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    perform tell(p_world, p_uid, blood_read(p_world, p_uid, c), 'event');

  elsif p_action = 'dye_item' then
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint;
    dye := pick_dye(p_world, p_uid);
    if it.id is null or dye.id is null then return; end if;
    select * into dd from dye_def where name = dye.extra;
    if not consume(p_world, p_uid, 'dye', 1) then return; end if;
    -- One pot does one thing. A stack is split so the rest stays as it was.
    if it.count > 1 then
      update item set count = count - 1 where id = it.id;
      insert into item (world_id, holder, holder_uid, def, ql, dmg, count, extra, rare, dye)
      values (p_world, it.holder, it.holder_uid, it.def, it.ql, it.dmg, 1, it.extra, it.rare, dd.id);
    else
      update item set dye = dd.id where id = it.id;
    end if;
    perform journal_note(p_world, p_uid, 'dyed');
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work the ' || lower(dd.name)
      || ' through it. It comes out ' || dd.word || '.', 'event');

  elsif p_action = 'strip_dye' then
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint;
    if it.id is null then return; end if;
    select * into dye from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = 'lye_bucket' order by i.id limit 1;
    if dye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, dye.ql);
    update item set dye = null where id = it.id;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.2);
    perform tell(p_world, p_uid, 'You boil it out in lye. It is back to the colour of '
      || lower((select coalesce(name, it.def) from item_def where id = it.def)) || '.', 'event');

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if bd.id is null or pc.id is null
       or brew_reason(p_world, p_uid, pc, bd) is not null then return; end if;
    -- What goes in decides most of what comes out; the hand only decides how
    -- much of it survives the working.
    select * into v_stock from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = bd.input order by i.id limit 1;
    v_ql := coalesce(v_stock.ql, 20);
    if not consume(p_world, p_uid, bd.input, bd.count) then return; end if;
    if not skill_check(skill_of(p_world, p_uid, 'brewing'), bd.difficulty, 0) then
      update placed set litres = greatest(0, placed_litres(pc) - bd.litres), since = now()
        where id = pc.id;
      update placed set liquid = null where id = pc.id and litres <= 0;
      perform skill_raise(p_world, p_uid, 'brewing', 0.3);
      perform tell(p_world, p_uid, 'It will not take. You tip the whole soured lot out of the '
        || lower(placed_name(pc)) || '.', 'event');
      return;
    end if;
    update placed set litres = bd.litres, liquid = bd.id, ferment = bd.seconds, since = now(),
        ql = greatest(1, least(100, (v_ql + skill_of(p_world, p_uid, 'brewing')) / 2))
      where id = pc.id;
    perform journal_note(p_world, p_uid, 'brew');
    perform journal_note(p_world, p_uid, 'brew:' || bd.id);
    perform skill_raise(p_world, p_uid, 'brewing', 0.6);
    perform tell(p_world, p_uid, bd.done || ' (about ' || round(bd.seconds / 60) || ' minutes)', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_crate(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_tx int; v_ty int; v_sx int; v_sy int; v_new_id int;
        v_want int; v_names text[] := '{}'; v_r record; v_kind text;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    select * into v_it from item where id = (p_target->>'itemUid')::bigint;
    v_kind := crate_kind_of_item(v_it.def);
    if v_kind is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    select coalesce(max(id), 0) + 1 into v_new_id from crate where world_id = p_world;
    insert into crate (world_id, id, kind, x, y, sx, sy, material, made_by)
    values (p_world, v_new_id, v_kind, v_tx, v_ty, v_sx, v_sy, v_it.extra, p_uid);
    select * into v_c from crate where world_id = p_world and id = v_new_id;
    perform journal_note(p_world, p_uid, 'crate');
    perform tell(p_world, p_uid, 'You set the ' || lower(crate_name(v_c)) || ' down.', 'event');

  elsif p_action = 'pick_up_crate' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null or crate_units(p_world, v_c.id) > 0 then return; end if;
    delete from crate where world_id = p_world and id = v_c.id;
    perform give(p_world, p_uid, (select item from crate_def where crate_def.kind = v_c.kind), 1, 20, v_c.material);
    perform tell(p_world, p_uid, 'You pick up the '
      || lower((select name from crate_def where crate_def.kind = v_c.kind)) || '.'
      || case when v_c.deed then ' Deed workers will leave their finds by the token until a deed crate stands again.'
              else '' end, 'event');

  elsif p_action = 'crate_take_all' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return; end if;
    for v_r in select * from item where world_id = p_world and holder = 'crate' and crate = v_c.id order by id loop
      v_names := v_names || (case when v_r.count > 1 then v_r.count || ' × ' else '' end
        || lower((select coalesce(name, v_r.def) from item_def where id = v_r.def)));
      update item set holder = 'player', holder_uid = p_uid, crate = null, gx = null, gy = null
        where id = v_r.id;
    end loop;
    if array_length(v_names, 1) is null then return; end if;
    perform tell(p_world, p_uid, 'You take ' || array_to_string(v_names, ', ') || ' from the crate.', 'event');

  elsif p_action = 'store_in_crate' then
    v_c := nearest_crate(p_world, v_p.x, v_p.y);
    select * into v_it from item where id = (p_target->>'uid')::bigint;
    if v_c.id is null or not found then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if not crate_add(p_world, v_c.id, v_it.def, v_want, v_it.ql, v_it.extra) then
      perform tell(p_world, p_uid, 'The crate is full.', 'error');
      return;
    end if;
    if v_want >= v_it.count then delete from item where id = v_it.id;
    else update item set count = count - v_want where id = v_it.id; end if;
    perform tell(p_world, p_uid, 'You put ' || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || lower((select coalesce(name, v_it.def) from item_def where id = v_it.def))
      || ' in the ' || lower((select name from crate_def where crate_def.kind = v_c.kind)) || '.', 'event');

  elsif p_action = 'take_from_store' then
    select * into v_it from item where id = (p_target->>'uid')::bigint and world_id = p_world;
    if not found or v_it.holder not in ('crate', 'furniture', 'bag') then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    -- `move_part` splits the stack, merges into one you already carry, and
    -- clears whichever of `crate` and `placed` was holding it.
    if move_part(v_it.id, v_want, 'player', p_uid, null, null) is null then return; end if;
    perform tell(p_world, p_uid, 'You take '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || lower((select coalesce(name, v_it.def) from item_def where id = v_it.def))
      || ' out.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_fire(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; sz int[]; ax int; ay int; per double precision; room double precision;
        fits int; whole int; sub text; made bigint; back text;
begin
  if p_action = 'build_campfire' then
    ax := least(subtiles() - 2, greatest(0, (p_target->>'sx')::int));
    ay := least(subtiles() - 2, greatest(0, (p_target->>'sy')::int));
    if not consume(p_world, p_uid, 'shaft', 2) then return; end if;
    insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel, made_by)
    values (p_world, 'campfire', (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + 1.0) / subtiles(), (p_target->>'y')::int + (ay + 1.0) / subtiles(),
            120, p_uid);
    perform tell(p_world, p_uid, 'You lay a campfire from 2 shafts. Light it, or feed it more wood first.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  if p_action in ('place_smelter', 'place_furniture', 'place_kiln') then
    select * into it from item where id = nullif(p_target->>'uid', '')::bigint;
    sub := case when p_action = 'place_furniture' then replace(it.def, 'furniture_', '') end;
    sz := placed_size(case p_action when 'place_smelter' then 'smelter'
                                    when 'place_kiln' then 'kiln' else 'furniture' end, sub);
    ax := least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0)));
    ay := least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, case p_action when 'place_smelter' then 'smelter'
                                   when 'place_kiln' then 'kiln' else 'furniture' end, sub,
            (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + sz[1] / 2.0) / subtiles(),
            (p_target->>'y')::int + (ay + sz[2] / 2.0) / subtiles(),
            it.ql, p_uid)
    returning id into made;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' ||
      lower(coalesce((select name from furniture_def where id = sub),
        case when p_action = 'place_kiln' then 'kiln' else 'smelter' end)) || ' down.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  perform placed_settle(nullif(p_target->>'id', '')::bigint);
  p := target_placed(p_world, p_target);
  if p.id is null then return; end if;

  if p_action in ('light_campfire', 'light_smelter', 'light_kiln') then
    update placed set lit = true, since = now() where id = p.id;
    if p_action = 'light_campfire' then perform journal_note(p_world, p_uid, 'fire'); end if;
    perform tell(p_world, p_uid, 'The kindling catches and the ' || p.kind || ' burns. It has '
      || burns_for(p.fuel) || ' of fuel.', 'event');
  elsif p_action in ('put_out_campfire', 'damp_smelter', 'damp_kiln') then
    update placed set lit = false, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You smother the fire. The wood is saved for later.', 'event');
  elsif p_action in ('fuel_campfire', 'fuel_smelter', 'fuel_kiln') then
    select * into it from item
      where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and (id = nullif(p_target->>'uid', '')::bigint or fuel_value(def) is not null)
      order by (id = nullif(p_target->>'uid', '')::bigint) desc limit 1;
    per := fuel_value(it.def);
    room := greatest(0, fire_capacity() - p.fuel);
    fits := greatest(1, least(it.count, ceil(room / per)::int));
    if not consume(p_world, p_uid, it.def, fits, it.id) then return; end if;
    update placed set fuel = least(fire_capacity(), p.fuel + per * fits), since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You feed ' || case when fits > 1 then fits || ' × ' else 'a ' end
      || lower((select name from item_def where id = it.def)) || ' to the fire. '
      || burns_for(least(fire_capacity(), p.fuel + per * fits)) || ' of fuel.', 'event');
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter', 'take_ashes_kiln') then
    whole := floor(p.ash)::int;
    update placed set ash = p.ash - whole, since = now() where id = p.id;
    perform give(p_world, p_uid, 'ash', whole, 20);
    perform tell(p_world, p_uid, 'You rake ' || whole || case when whole = 1 then ' lot' else ' lots' end
      || ' of ashes out of the ' || p.kind || '. (QL 20)', 'event');
  elsif p_action = 'take_apart_campfire' then
    -- Coal burns but is never got back, so a pile of logs cannot be turned
    -- into coal by rebuilding the fire.
    delete from placed where id = p.id;
    perform give(p_world, p_uid, 'shaft', 2, 20);
    perform tell(p_world, p_uid, 'You take the campfire apart and save what will burn again.', 'event');
    perform land_announce(p_world, p.x, p.y);
  elsif p_action in ('pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    back := case p.kind when 'smelter' then 'smelter' when 'kiln' then 'kiln'
                        else 'furniture_' || p.sub end;
    delete from placed where id = p.id;
    perform give(p_world, p_uid, back, 1, p.ql);
    perform tell(p_world, p_uid, 'You take up the ' || lower(coalesce(p.sub, p.kind)) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_ride(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; p placed; v vehicle_def; r record; v_names text; v_short text; v_n int;
        v_was bigint; v_shore record; v_sail boolean;
begin
  if ride_beast_action(p_action) then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;

    if p_action = 'tack_creature' then
      for r in select item from tack_def order by ord loop
        if not consume(p_world, p_uid, r.item, 1) then return; end if;
      end loop;
      update creature set tacked = true where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You saddle ' || c.name
        || ' and slip the bit into its mouth. It stands for it.', 'event');

    elsif p_action = 'untack_creature' then
      update creature set tacked = false where world_id = p_world and id = c.id;
      for r in select item from tack_def order by ord loop
        perform give(p_world, p_uid, r.item, 1, 40);
      end loop;
      perform tell(p_world, p_uid, 'You strip the saddle and bridle off ' || c.name || '.', 'event');

    elsif p_action = 'mount_creature' then
      -- One seat at a time: whoever was up gets down without being asked.
      update creature set rider = null where world_id = p_world and rider = p_uid;
      update creature set rider = p_uid, enemy = null, hunting = null,
          from_x = pl.x, from_y = pl.y, to_x = pl.x, to_y = pl.y,
          leg_at = now(), leg_ends = now(), settled_at = now()
        from player pl
        where creature.world_id = p_world and creature.id = c.id
          and pl.world_id = p_world and pl.uid = p_uid;
      perform journal_note(p_world, p_uid, 'mounted');
      perform tell(p_world, p_uid, 'You take a fistful of mane and swing up onto '
        || c.name || '.', 'event');

    elsif p_action = 'dismount_creature' then
      update creature set rider = null where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You swing down off ' || c.name || '.', 'event');

    elsif p_action = 'hitch_creature' then
      p := vehicle_for(p_world, p_uid, c);
      if p.id is null or not hitch_up(p_world, c.id, p.id) then return; end if;
      select * into v from vehicle_def where id = p.sub;
      v_n := team_size(p_world, p.id);
      v_short := case when v_n < v.needs
        then ' It needs ' || (v.needs - v_n) || ' more before it will move.' else '' end;
      perform journal_note(p_world, p_uid, 'hitched');
      perform tell(p_world, p_uid, 'You back ' || c.name || ' into a yoke of the '
        || lower(placed_name(p)) || '. ' || v_n || ' of ' || v.yokes || ' filled.' || v_short, 'event');

    elsif p_action = 'unhitch_creature' then
      v_was := unhitch_one(p_world, c.id);
      perform tell(p_world, p_uid, 'You unbuckle ' || c.name || ' from the '
        || coalesce(lower((select placed_name(q) from placed q where q.id = v_was)), 'traces') || '.', 'event');
    end if;
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pull_cart' then
    update placed set puller = p_uid where world_id = p_world and id = p.id;
    perform tell(p_world, p_uid, 'You take up the shafts of the ' || lower(placed_name(p))
      || '. It will follow you now.', 'event');

  elsif p_action = 'drop_cart' then
    update placed set puller = null where world_id = p_world and id = p.id;
    perform tell(p_world, p_uid, 'You set the ' || lower(placed_name(p))
      || ' down and let go of the shafts.', 'event');

  elsif p_action = 'board_vehicle' then
    update placed set driver = p_uid where world_id = p_world and id = p.id;
    if is_boat(p) then
      select sail into v_sail from boat_def where id = p.sub;
      perform tell(p_world, p_uid, 'You push off and climb into the ' || lower(placed_name(p)) || '. '
        || case when v_sail then 'The sail fills and she comes round.'
                else 'You ship the oars and take a stroke.' end, 'event');
      return;
    end if;
    select string_agg(t.name, ' and ' order by t.id) into v_names from team_of(p_world, p.id) t;
    perform tell(p_world, p_uid, 'You climb onto the ' || lower(placed_name(p)) || ' and take the reins. '
      || coalesce(v_names, 'Nothing') || ' lean into the traces.', 'event');

  elsif p_action = 'leave_vehicle' then
    if is_boat(p) then
      select s.x, s.y into v_shore from player pl, lateral shore_near(p_world, pl.x, pl.y) s
        where pl.world_id = p_world and pl.uid = p_uid;
      perform leave_vehicle(p_world, p.id);
      if v_shore.x is not null then
        update player set x = v_shore.x + 0.5, y = v_shore.y + 0.5, moved_at = now()
          where world_id = p_world and uid = p_uid;
      end if;
      perform tell(p_world, p_uid, 'You bring the ' || lower(placed_name(p))
        || ' alongside and step ashore.', 'event');
      return;
    end if;
    perform leave_vehicle(p_world, p.id);
    perform tell(p_world, p_uid, 'You climb down off the ' || lower(placed_name(p)) || '.', 'event');

  elsif p_action = 'unhitch_team' then
    v_n := unhitch_all(p_world, p.id);
    perform tell(p_world, p_uid, 'You let ' || case when v_n = 1 then 'it' else 'them' end
      || ' out of the traces of the ' || lower(placed_name(p)) || '.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_settlement(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare dd deed; p placed; it item; c creature; v_name text; v_level int; v_sx int; v_sy int;
        v_freed int := 0; v_tipped int := 0; cr crate; r record;
begin
  if p_action = 'upgrade_deed' then
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    v_level := dd.level + 1;
    update deed set level = v_level, radius = deed_radius(v_level)
      where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, dd.name || ' grows to level ' || v_level
      || '. The border reaches ' || deed_radius(v_level) || ' tiles from the token and '
      || worker_cap(p_world, p_uid) || ' wildermon may work here.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'rename_deed' then
    v_name := left(btrim(p_target->>'name'), 32);
    update deed set name = v_name where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, 'The settlement is now called ' || v_name || '.', 'system');

  elsif p_action = 'disband_deed' then
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    -- Everything kept here runs wild, and what it was carrying goes on the
    -- ground where it stood rather than with it.
    for c in select * from creature where world_id = p_world and keeper = p_uid and mode in ('stored', 'deed') loop
      if c.carrying is not null then
        perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
          c.carrying->>'def', (c.carrying->>'ql')::double precision, c.carrying->>'extra',
          (c.carrying->>'count')::int);
      end if;
      update creature set mode = 'wild', phase = 'idle', job = null, post = null, carrying = null,
          name = (select name from species_def where id = c.species)
        where world_id = p_world and id = c.id;
      v_freed := v_freed + 1;
    end loop;
    -- The settlement's own crate goes with the settlement, and whatever was in
    -- it is tipped out where it stood rather than vanishing with it.
    cr := deed_crate(p_world, p_uid);
    if cr.id is not null then
      for r in select * from item where world_id = p_world and crate = cr.id loop
        update item set holder = 'ground', holder_uid = null, crate = null, gx = cr.x, gy = cr.y
          where id = r.id;
        v_tipped := v_tipped + 1;
      end loop;
      delete from crate where world_id = p_world and id = cr.id;
    end if;
    /*
     * Yours, and not the island's.
     *
     * Reported by somebody whose settlement was gone while his crate still
     * stood and who had not disbanded anything: somebody else had, at the
     * other end of the island, and this line took every settlement on it. The
     * deed crate is the tell — the disbanding tips out and removes the
     * *caller's* crate, so everybody else was left with an orphan standing in
     * a field and nothing to say what it had belonged to.
     *
     * `deed` was keyed on the island alone until a day ago, when it became
     * `(world_id, founded_by)`. The reads either side of this were re-scoped
     * with the key; the delete was not, and a delete is the one statement
     * where the whole island being in range does not read as a mistake.
     */
    delete from deed where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, dd.name || ' is disbanded. '
      || v_freed || case when v_freed = 1 then ' wildermon runs' else ' wildermon run' end
      || ' wild and ' || v_tipped
      || case when v_tipped = 1 then ' thing is' else ' things are' end
      || ' tipped out where the crate stood.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'place_post' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'work_post' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
      order by id limit 1;
    if not found then return; end if;
    v_sx := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, 'post', it.extra, (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 0.5) / subtiles(),
            (p_target->>'y')::int + (v_sy + 0.5) / subtiles(), it.ql, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You drive the post in and tack the ribbon to it. It will stand about '
      || round(post_life(p.ql) / 60) || ' minutes and reach ' || post_radius(p.ql)
      || ' tiles. Set a wildermon to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  if p_action in ('upgrade_deed', 'rename_deed', 'disband_deed') then return; end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_post' then
    -- Half rotten by now, most likely, and it comes up as it went in.
    perform give(p_world, p_uid, 'work_post', 1,
      greatest(1, p.ql * (1 - post_dmg(p) / 100)), p.sub);
    update creature set post = null, phase = 'idle' where world_id = p_world and post = p.id;
    delete from placed where id = p.id;
    perform tell(p_world, p_uid, 'You pull the post up and coil the ribbon round it.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action = 'assign_post' then
    select * into c from creature where world_id = p_world and id = (p_target->>'creature')::int;
    if not found then return; end if;
    update creature set post = p.id, mode = 'deed', phase = 'idle', enemy = null, hunting = null,
        from_x = p.cx, from_y = p.cy + 0.6, to_x = p.cx, to_y = p.cy + 0.6,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform journal_note(p_world, p_uid, 'posted');
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select g.plain from gather_def g
                   where g.id = (select gathers from species_def where id = c.species)),
                  'keep to the post')
      || ' within ' || least(work_range(c), post_radius(p.ql))
      || ' tiles of the post while it stands. (' || post_state(p) || ')', 'system');

  elsif p_action = 'unassign_post' then
    select * into c from creature where world_id = p_world and post = p.id limit 1;
    if not found then return; end if;
    select * into dd from deed where world_id = p_world and founded_by = c.keeper;
    update creature set post = null, phase = 'idle',
        from_x = coalesce(dd.x + 0.5, p.cx), from_y = coalesce(dd.y + 1.5, p.cy),
        to_x = coalesce(dd.x + 0.5, p.cx), to_y = coalesce(dd.y + 1.5, p.cy),
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' is called off the post.', 'system');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_fight(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p player; slot text; shield item; c creature; d species_def; w weapon_def;
        bow weapon_def; arrow item; held item; dist double precision; dmg double precision;
        bane double precision; before double precision; died boolean; reach double precision;
        corpse item; sp species_def; knife_ql double precision; v_share double precision;
        made_ql double precision; taken text[] := '{}'; r record; v_n int; lumps text[] := '{}';
        hurt jsonb; use item; suits boolean; clean boolean; healed double precision;
        top double precision; out_w jsonb; one jsonb; lye item; got text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'equip' then
    select * into it from item where id = (p_target->>'uid')::bigint;
    slot := slot_of(it.def);
    update player set equipped = jsonb_set(equipped, array[slot], to_jsonb(it.id))
      where world_id = p_world and uid = p_uid returning * into p;
    -- Both hands on it means nothing else in them.
    if slot = 'weapon' and coalesce((select two_handed from weapon_def where id = it.def), false) then
      shield := worn(p_world, p_uid, 'offhand');
      if shield.id is not null then
        update player set equipped = equipped - 'offhand' where world_id = p_world and uid = p_uid;
        perform tell(p_world, p_uid, 'You need both hands for that, so the '
          || lower((select name from item_def where id = shield.def)) || ' goes on your back.', 'info');
      end if;
    end if;
    perform tell(p_world, p_uid, 'You '
      || case when slot in ('weapon', 'offhand') then 'take up' else 'put on' end
      || ' the ' || lower((select name from item_def where id = it.def)) || '.', 'info');

  elsif p_action = 'unequip' then
    select * into it from item where id = (p_target->>'uid')::bigint;
    slot := slot_of(it.def);
    update player set equipped = equipped - slot where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You put the '
      || lower((select name from item_def where id = it.def)) || ' away.', 'info');

  elsif p_action = 'attack_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    w := swung_with(p_world, p_uid);
    held := swung_item(p_world, p_uid);
    before := c.health;
    perform skill_raise(p_world, p_uid, 'fighting', 0.3);
    perform skill_raise(p_world, p_uid, w.kind, 0.45);
    perform skill_raise(p_world, p_uid, 'body_strength', 0.05);
    if random() > hit_chance(p_world, p_uid, w.kind) then
      perform tell(p_world, p_uid, 'You swing at the ' || lower(d.name)
        || case when held.id is null then '' else ' with your '
             || lower((select name from item_def where id = held.def)) end || ' and miss.', 'event');
    else
      bane := case when held.id is not null and mat_bane(held.extra) and d.glow is not null
                   then bane_bonus() else 1 end;
      dmg := weapon_damage(p_world, p_uid, w, held) * bane * (0.75 + random() * 0.5);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      if held.id is not null then perform damage_item(held.id, 0.35); end if;
      if not died then
        perform tell(p_world, p_uid, 'You strike the ' || lower(d.name)
          || case when held.id is null then '' else ' with your '
               || lower((select name from item_def where id = held.def)) end
          || '. It is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'event');
      end if;
    end if;
    -- A cornered animal gets a swipe in, and the defensive sorts never miss their chance.
    if not coalesce(died, false) and (d.defensive or random() < 0.35) then
      perform hurt_player(p_world, p_uid, attack_of(c) * 0.012,
        'The ' || lower(d.name) || case when d.defensive then ' comes straight back at you'
                                        else ' turns on you' end,
        coalesce(d.wound, 'bite'));
    end if;

  elsif p_action = 'shoot_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    held := worn(p_world, p_uid, 'weapon');
    select bw.* into bow from weapon_def bw where bw.id = held.def and bw.ammo is not null;
    if not found then return; end if;
    select i.* into arrow from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = bow.ammo
      order by i.ql desc limit 1;
    if arrow.id is null or not consume(p_world, p_uid, bow.ammo, 1, arrow.id) then return; end if;
    dist := (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2)
             from player pl where pl.world_id = p_world and pl.uid = p_uid);
    perform skill_raise(p_world, p_uid, 'fighting', 0.2);
    perform skill_raise(p_world, p_uid, 'archery', 0.5);
    -- The far end of a bow's range is a far harder shot than the near end.
    if random() > hit_chance(p_world, p_uid, 'archery') * (1 - (dist / coalesce(bow.range, 6)) * 0.35) then
      perform tell(p_world, p_uid, 'Your arrow goes wide of the ' || lower(d.name) || '.', 'event');
    else
      -- The stave throws it; the head is what goes in. Both have a say.
      bane := case when mat_bane(arrow.extra) and d.glow is not null then bane_bonus() else 1 end;
      dmg := weapon_damage(p_world, p_uid, bow, held) * mat_edge(arrow.extra) * bane
             * (0.6 + arrow.ql / 140) * (0.8 + random() * 0.4);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      perform damage_item(held.id, 0.25);
      if not died then
        perform tell(p_world, p_uid, 'Your arrow goes home. The ' || lower(d.name)
          || ' is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'event');
      end if;
    end if;

  elsif p_action = 'butcher' then
    corpse := target_corpse(p_world, p_uid, p_target);
    sp := corpse_species(corpse.extra);
    if corpse.id is null or sp.id is null then return; end if;
    knife_ql := nullif(tool_ql(p_world, p_uid, 'butchering_knife'), 0);
    v_share := butcher_yield(skill_of(p_world, p_uid, 'butchering'), knife_ql);
    made_ql := product_ql(skill_of(p_world, p_uid, 'butchering'), coalesce(knife_ql, 0))
               * (0.6 + corpse.ql / 250);
    -- What it was sleeping on, which is not a part of it at all.
    for r in select sb.n from species_butcher sb where sb.species = sp.id and sb.part = 'hoard' loop
      for v_n in 1..round(r.n * (4 + v_share * 6))::int loop
        select item into got from hoard_metal order by random() limit 1;
        perform give(p_world, p_uid, got, 1, greatest(20, least(100, 40 + random() * 55)));
        lumps := lumps || lower((select name from item_def where id = got));
      end loop;
    end loop;
    if array_length(lumps, 1) > 0 then
      perform journal_note(p_world, p_uid, 'hoard');
      perform tell(p_world, p_uid, 'Something rattles as the belly opens: ' || array_length(lumps, 1)
        || ' lumps of what it had been sleeping on. '
        || (select string_agg(distinct l, ', ') from unnest(lumps) l) || '.', 'event');
    end if;
    /* `n` was a plpgsql variable here and `species_butcher.n` a column, and
     * Postgres would not guess which was meant. That is the fourth time on
     * this island — `land_tile.y`, `crop.y`, `trait_def.tier` — so the locals
     * that could collide carry a prefix. */
    for r in select b.part, b.item, sb.n from butcher_part b
             join species_butcher sb on sb.part = b.part and sb.species = sp.id
             order by b.ord loop
      v_n := floor(r.n * v_share)::int;
      -- The remainder is a chance at one more, so a poor job still gives something.
      if random() < r.n * v_share - v_n then v_n := v_n + 1; end if;
      -- Glands are the rare part: only a steady hand finds them intact.
      if r.part = 'gland' and v_n > 0 and random() > 0.35 * (0.5 + v_share) then v_n := 0; end if;
      if v_n <= 0 then continue; end if;
      perform give(p_world, p_uid, r.item, v_n, greatest(1, least(100, made_ql)));
      taken := taken || (case when v_n > 1 then v_n || ' × ' else '' end
        || lower((select name from item_def where id = r.item)));
    end loop;
    delete from item where id = corpse.id;
    if array_length(taken, 1) is null then
      perform tell(p_world, p_uid, 'You make a mess of the ' || lower(sp.name)
        || ' carcass and salvage nothing.', 'event');
    else
      perform tell(p_world, p_uid, 'You butcher the ' || lower(sp.name) || ' and take '
        || array_to_string(taken, ', ') || '.'
        || case when knife_ql is null then ' Bare hands waste most of a carcass.' else '' end, 'event');
    end if;

  elsif p_action = 'bind_wound' then
    select * into p from player where world_id = p_world and uid = p_uid;
    hurt := worst_wound(p.wounds);
    if hurt is null or (hurt->>'infected')::boolean then return; end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null or not consume(p_world, p_uid, use.def, 1, use.id) then return; end if;
    got := case when use.def = 'cover' then lower(coalesce(use.extra, '')) else '' end;
    suits := got = (select herb from wound_kind_def where id = hurt->>'kind');
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 10, use.ql);
    -- Cloth holds a dressing on. The right herb closes the wound.
    healed := (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end)
              * (case when suits then 1.5 when got <> '' then 1.1 else 1 end);
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(p.wounds) loop
      if one = hurt then
        one := jsonb_set(one, '{severity}', to_jsonb(greatest(0, (one->>'severity')::double precision - healed)));
        if clean then one := jsonb_set(jsonb_set(one, '{dressing}', to_jsonb(got)), '{bleeding}', 'false'); end if;
      end if;
      if (one->>'severity')::double precision > 0.004 or (one->>'infected')::boolean then
        out_w := out_w || one;
      end if;
    end loop;
    update player set wounds = out_w,
        stats = jsonb_set(p.stats, '{health}',
          to_jsonb(least(1, coalesce((p.stats->>'health')::double precision, 1) + healed)))
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'dressed');
    if clean and suits then perform journal_note(p_world, p_uid, 'covered'); end if;
    perform skill_raise(p_world, p_uid, 'first_aid', 0.35);
    perform tell(p_world, p_uid, case
      when not clean then 'The dressing slips and you make a poor job of it. You still have '
        || wound_text(hurt) || '.'
      when suits then 'You lay the ' || got
        || ' cover on and bind it. The bleeding stops at once and it is already closing.'
      when got <> '' then 'You bind the ' || got || ' cover over it. It is the wrong herb for a '
        || (select name from wound_kind_def where id = hurt->>'kind')
        || ', but it holds and the bleeding stops.'
      else 'You clean it and bind it with cloth. The bleeding stops, though it will be slow to close.'
      end, 'event');

  elsif p_action = 'clean_wound' then
    select * into p from player where world_id = p_world and uid = p_uid;
    select i.* into lye from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'lye_bucket'
      order by i.ql desc limit 1;
    if lye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1, lye.id) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, lye.ql);
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 26, lye.ql);
    perform journal_note(p_world, p_uid, 'cleaned');
    perform skill_raise(p_world, p_uid, 'first_aid', 0.8);
    select x into hurt from jsonb_array_elements(p.wounds) x where (x->>'infected')::boolean limit 1;
    if not clean then
      perform tell(p_world, p_uid, 'You scour the '
        || (select name from wound_kind_def where id = hurt->>'kind')
        || ' out and it is no better for it. The lye is gone.', 'error');
      return;
    end if;
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(p.wounds) loop
      if one = hurt then
        one := jsonb_set(jsonb_set(jsonb_set(one, '{infected}', 'false'),
          '{bleeding}', 'true'), '{dressing}', 'null'::jsonb);
      end if;
      out_w := out_w || one;
    end loop;
    update player set wounds = out_w where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You scour the '
      || (select name from wound_kind_def where id = hurt->>'kind') || ' on your '
      || part_name(hurt->>'part') || ' out with lye. It is open and clean again, and bleeding. Dress it.', 'event');

  elsif p_action = 'treat_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select i.* into use from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'bandage'
      order by i.ql desc limit 1;
    if use.id is null or not consume(p_world, p_uid, 'bandage', 1, use.id) then return; end if;
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 14, use.ql);
    top := max_health(c);
    healed := top * (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end);
    update creature set health = least(top, health + healed)
      where world_id = p_world and id = c.id returning * into c;
    perform skill_raise(p_world, p_uid, 'first_aid', 0.35);
    perform tell(p_world, p_uid, case when clean
      then 'You dress ' || c.name || '''s wounds with the '
        || lower((select name from item_def where id = 'bandage')) || '. It is up to '
      else c.name || ' will not hold still and the dressing goes on badly. It is up to '
      end || ceil(c.health) || ' of ' || top || '.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.earn_knacks(p_world uuid, p_uid uuid, p_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; v_id text; had int;
begin
  if random() >= 1.0 / knack_odds() then return; end if;
  if random() < knack_home() then
    v_id := p_id;
  else
    select k.skill into v_id from knack_kin k
     where k.family = (select family from knack_kin where skill = p_id)
     order by random() limit 1;
    v_id := coalesce(v_id, p_id);
  end if;
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  had := coalesce((p.knacks->>v_id)::int, 0);
  if had >= knack_cap() then return; end if;
  update player set knacks = jsonb_set(coalesce(knacks, '{}'::jsonb), array[v_id], to_jsonb(had + 1)),
         skills_at = now()
    where world_id = p_world and uid = p_uid;
  perform journal_note(p_world, p_uid, 'knack');
  perform tell(p_world, p_uid, 'You have a knack for '
    || lower((select name from skill_def where id = v_id)) || ' now. It goes in '
    || round(knack_bonus(had + 1) * 100) || '% faster.', 'skill');
end $function$;

CREATE OR REPLACE FUNCTION public.earn_titles(p_world uuid, p_uid uuid, p_id text, p_before double precision, p_after double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; t title_def;
begin
  if floor(p_after) <= floor(p_before) then return; end if;
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  for t in select * from title_def where skill = p_id and p_after >= at and p_before < at order by at loop
    if coalesce(p.titles, '[]'::jsonb) ? t.id then continue; end if;
    update player set titles = coalesce(titles, '[]'::jsonb) || to_jsonb(t.id),
           title = coalesce(title, t.id)
      where world_id = p_world and uid = p_uid returning * into p;
    perform journal_note(p_world, p_uid, 'title');
    perform tell(p_world, p_uid, 'They will call you ' || t.name
      || ' for that. (Skills, to wear it)', 'skill');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.wound_beast(p_world uuid, p_id integer, p_dmg double precision, p_from_x double precision DEFAULT NULL::double precision, p_from_y double precision DEFAULT NULL::double precision, p_teller uuid DEFAULT NULL::uuid, p_by integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; cx double precision; cy double precision;
        v_len double precision; v_size double precision; v_killer creature;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);

  update creature set health = c.health - p_dmg, hurt_at = now(), hurt_by = p_by,
      coaxed = 0, coaxed_at = null,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      settled_at = now()
    where world_id = p_world and id = p_id;

  if c.health - p_dmg > 0 then
    if c.mode = 'wild' and d.timid and p_from_x is not null then
      v_len := greatest(0.001, sqrt((cx - p_from_x) ^ 2 + (cy - p_from_y) ^ 2));
      update creature set to_x = cx + ((cx - p_from_x) / v_len) * 5, to_y = cy + ((cy - p_from_y) / v_len) * 5,
          leg_ends = now() + interval '3 seconds', until = now() + interval '3 seconds'
        where world_id = p_world and id = p_id;
    end if;
    return false;
  end if;

  -- What the carcass is worth follows the size of the thing that left it.
  v_size := (age_row(c.born)).yield;
  delete from creature where world_id = p_world and id = p_id;
  -- Nothing goes on fighting something that is no longer there.
  update creature set enemy = null where world_id = p_world and enemy = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * v_size, d.name);

  -- A hunter marks where its kill went down and comes back for it.
  if p_by is not null then
    select * into v_killer from creature where world_id = p_world and id = p_by;
    if found and v_killer.carrying is null
       and (select gathers from species_def where id = v_killer.species) = 'hunt' then
      update creature set work_x = floor(cx)::int, work_y = floor(cy)::int
        where world_id = p_world and id = p_by;
      perform worker_learn(p_world, p_by, 'fighting', 0.4);
    end if;
  end if;

  if p_teller is not null then
    perform journal_note(p_world, p_teller, 'slew:' || c.species);
    if d.monster then
      perform tell(p_world, p_teller, 'The ' || lower(d.name)
        || ' goes down. Butcher it before it rots: there is a great deal on it.', 'system');
    else
      perform tell(p_world, p_teller, 'You kill the wild ' || lower(d.name)
        || '. Its corpse lies where it fell.', 'event');
    end if;
  end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.trap_settle(p_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare p placed; d trap_def; v_dmg double precision; v_n int; v_best creature;
        v_chance double precision; v_odds double precision; s species_def;
        v_depth double precision; v_got text; v_held int; v_ql double precision; v_new bigint;
begin
  select * into p from placed where id = p_id and kind = 'trap' for update;
  if not found then return false; end if;
  select * into d from trap_def where id = p.sub;

  v_dmg := trap_dmg(p);
  if v_dmg >= 100 then
    if p.caught is not null then
      perform spring_trap(p_id, 'The ' || lower(trap_name(p))
        || ' rots through and whatever was in it walks away.');
    end if;
    if p.made_by is not null then
      perform tell(p.world_id, p.made_by, 'A ' || lower(trap_name(p))
        || ' has rotted through out in the country.', 'system');
    end if;
    delete from item where holder = 'trap' and placed = p_id;
    delete from placed where id = p_id;
    return true;
  end if;

  -- How many rolls there were between then and now, bounded by its own life.
  v_n := floor(least(extract(epoch from (now() - p.since)), trap_life(p.sub, p.ql))
               / trap_check_every())::int;
  update placed set dmg = v_dmg, since = now() where id = p_id;
  if p.bait is null or v_n < 1 then return false; end if;

  if d.water then
    v_held := coalesce((select sum(i.count)::int from item i
                        where i.holder = 'trap' and i.placed = p_id), 0);
    if v_held >= coalesce(d.hold, 8) then return false; end if;
    v_depth := water_depth(p.world_id, p.x, p.y);
    v_odds := d.odds * (0.6 + least(100, greatest(1, p.ql)) / 250);
    -- One roll standing for all of them, then one fish for each success it is
    -- still willing to hold.
    for v_n in 1..least(v_n, coalesce(d.hold, 8) - v_held) loop
      exit when random() >= v_odds;
      v_got := pick_fish(v_depth, 40, p.bait, random());
      exit when v_got is null;
      v_ql := greatest(1, least(100, p.ql * (0.5 + random() * 0.7)));
      insert into item (world_id, holder, placed, def, ql, count)
      values (p.world_id, 'trap', p_id, v_got, v_ql, 1);
      -- Every so often the bait is worked out of it and it goes on empty.
      if random() < 0.14 then
        update placed set bait = null, bait_ql = null where id = p_id;
        if p.made_by is not null then
          perform tell(p.world_id, p.made_by, 'The bait is gone out of a creel. '
            || 'It will take nothing more until it is baited again.', 'system');
        end if;
        exit;
      end if;
    end loop;
    return false;
  end if;

  if p.caught is not null then return false; end if;
  -- The likeliest thing in reach that would come to what is laid, and is not
  -- so wary that it simply takes the bait and goes.
  for v_best in select c.* from creature c
    where c.world_id = p.world_id and c.mode = 'wild' and c.trapped is null
      and sqrt((creature_x(c) - p.cx) ^ 2 + (creature_y(c) - p.cy) ^ 2) <= d.reach
    order by catch_chance(p, c) desc, c.id
  loop
    select * into s from species_def where id = v_best.species;
    if s.monster or not exists (select 1 from species_diet sd
          where sd.species = s.id and sd.item = p.bait) then
      continue;
    end if;
    if s.tame_level > trap_holds(p) then
      -- Too much trap for: a third of a chance a roll that it lifts the bait.
      if random() < 1 - power(0.7, v_n) then
        update placed set bait = null, bait_ql = null where id = p_id;
        if p.made_by is not null then
          perform tell(p.world_id, p.made_by, 'Something took the bait out of your '
            || lower(trap_name(p)) || ' and was gone. It was too much trap for.', 'system');
        end if;
        return false;
      end if;
      continue;
    end if;
    v_chance := catch_chance(p, v_best);
    exit;
  end loop;
  if v_best.id is null or v_chance is null then return false; end if;

  -- The one roll that stands for all of them.
  if random() >= 1 - power(1 - v_chance, v_n) then return false; end if;
  update creature set trapped = p_id,
      from_x = p.cx, from_y = p.cy, to_x = p.cx, to_y = p.cy,
      leg_at = now(), leg_ends = now(), until = now() + interval '1 hour',
      hunting = null, enemy = null, settled_at = now()
    where world_id = p.world_id and id = v_best.id;
  update placed set caught = v_best.id where id = p_id;
  if p.made_by is not null then
    -- The browser's own words, and it says them the instant the board falls.
    -- Here nobody was there for the instant, so it is said when somebody next
    -- looks — which is the whole of what a trap is for.
    perform journal_note(p.world_id, p.made_by, 'caught');
    perform tell(p.world_id, p.made_by, 'Your ' || lower(trap_name(p))
      || ' has sprung. There is a ' || lower(s.name) || ' in it.', 'event');
  end if;
  return false;
end $function$;

CREATE OR REPLACE FUNCTION public.give_birth(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
/*
 * Every local prefixed, and the ninth and tenth times this class has bitten
 * were both in this one function: `born` is a column of `creature` and so is
 * `traits`, and an unprefixed local of either name inside `update creature` is
 * not a local at all. The rule is not "prefix the ones that have bitten", it
 * is "prefix all of them", and it has to be applied while writing rather than
 * while debugging.
 */
declare v_dam creature; v_d species_def; v_nx double precision; v_ny double precision;
        v_born int; v_coming jsonb; v_traits text[]; v_home record;
begin
  select * into v_dam from creature where world_id = p_world and id = p_id for update;
  if not found or v_dam.due is null or v_dam.due > now() then return 0; end if;
  v_coming := v_dam.unborn;
  update creature set unborn = null, due = null where world_id = p_world and id = p_id;
  if v_coming is null then return 0; end if;
  select * into v_d from species_def where id = v_dam.species;
  v_nx := creature_x(v_dam); v_ny := creature_y(v_dam);
  if v_dam.mode = 'stored' then
    select dd.x + 0.5 as x, dd.y + 1.5 as y into v_home from deed dd where dd.world_id = p_world and dd.founded_by = v_dam.keeper;
    if found then v_nx := v_home.x; v_ny := v_home.y; end if;
  end if;
  v_born := creature_spawn(p_world, v_dam.species, v_nx, v_ny, 'stored', now());
  select array_agg(t) into v_traits from jsonb_array_elements_text(v_coming->'traits') t;
  update creature set traits = coalesce(v_traits, '{}'), sex = v_coming->>'sex',
      hunger = 0.9, care = 0.5
    where world_id = p_world and id = v_born;
  update creature c set health = max_health(c) where c.world_id = p_world and c.id = v_born;
  if v_dam.keeper is not null then
    perform journal_note(p_world, v_dam.keeper, 'bred');
    -- Blood worth keeping, which is the whole point of putting two together.
    if exists (select 1 from unnest(coalesce(v_traits, '{}')) t
               join trait_def td on td.id = t where td.tier in ('supreme', 'fantastic')) then
      perform journal_note(p_world, v_dam.keeper, 'goodblood');
    end if;
    perform tell(p_world, v_dam.keeper, v_dam.name || ' drops a young ' || lower(v_d.name)
      || ' (' || (v_coming->>'sex') || '): ' || trait_names(coalesce(v_traits, '{}'))
      || '. It is at the token until it is grown.', 'event');
  end if;
  return v_born;
end $function$;
CREATE OR REPLACE FUNCTION public.rpc_settle(p_seen bigint DEFAULT NULL::bigint, p_world uuid DEFAULT NULL::uuid, p_said bigint DEFAULT NULL::bigint, p_book boolean DEFAULT false, p_ticked jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); r record; n int := 0; p player; v_world uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;

  /*
   * Which island this is a heartbeat for, settled before anything is written.
   *
   * It used to be `order by seen_at desc limit 1` over every row with your uid
   * on it, and the update above it had no world in its `where` either — so one
   * beat set `seen_at` to the same instant on every island you have ever
   * joined, and then picked between them with a sort that had nothing left to
   * sort by. Three rows, one timestamp, no tie-break: the answer is whichever
   * one Postgres happens to hand back, and that is a choice of plan rather
   * than a fact about you.
   *
   * The same answer carries the hour and the bars, so when the choice moved,
   * both moved together — reported as "occasionally it switches randomly to
   * nighttime and hunger/thirst plummet until refreshed". A refresh put it
   * right because `rpc_join` names its island, and the next beat broke it
   * again because this one did not.
   *
   * So the browser says where it is standing. `rpc_settle` was the only door
   * of the twenty that did not take a `p_world`, and it is the one that runs
   * every minute of every session.
   */
  if p_world is not null then
    select world_id into v_world from player where uid = me and world_id = p_world;
  end if;
  if v_world is null then
    -- A page that has not been redeployed yet, and does not say. The best
    -- guess is still a guess, but `world_id` breaks the tie, so a session gets
    -- the same wrong island every beat rather than a different one each time.
    select world_id into v_world from player where uid = me
      order by seen_at desc, world_id limit 1;
  end if;
  if v_world is null then return jsonb_build_object('settled', 0); end if;

  -- Standing here, and only here. Keeping `seen_at` fresh on every island at
  -- once told each of them you were present, which is how a body could be left
  -- standing on an island you walked away from an hour ago.
  update player set seen_at = now(), away = false,
         seen_change = greatest(seen_change, coalesce(p_seen, 0))
    where uid = me and world_id = v_world
      and (away or seen_at < now() - interval '5 seconds' or coalesce(p_seen, 0) > seen_change);
  /*
   * And anything newly ticked off the journal.
   *
   * The ticking itself stays in the browser, because a goal is a question
   * about everything at once — the book, the pack, the ground, what is
   * standing on it — and eighty-five of those predicates are eighty-five
   * ports for another day. What the island owns is the *record*: which ones
   * are done, so that they stay done through a refresh and a change of
   * machine. An id nobody knows is kept as it is rather than refused; the
   * journal is a list of things somebody thought worth doing and there is
   * nothing here worth guarding.
   */
  if p_ticked is not null and jsonb_typeof(p_ticked) = 'array'
     and jsonb_array_length(p_ticked) > 0 then
    update player set
        ticked = (select coalesce(jsonb_agg(distinct g), '[]'::jsonb)
                  from (select jsonb_array_elements_text(coalesce(ticked, '[]'::jsonb)) as g
                        union
                        select jsonb_array_elements_text(p_ticked)) u),
        tally_at = now()
      where uid = me and world_id = v_world
        and not (coalesce(ticked, '[]'::jsonb) @> p_ticked);
  end if;
  for r in select world_id from player
    where uid = me and world_id = v_world and act is not null and act_ends <= now()
  loop
    n := n + settle(r.world_id, me);
  end loop;
  /*
   * And the body itself, which nothing had ever brought up to date.
   *
   * `settle` above runs only for somebody with a job whose time is up, and
   * `world_tick` only for the same — so a body standing still never got
   * hungry, never got its wind back and never healed. This is the heartbeat
   * every browser makes anyway, once a minute, and it is where a body that is
   * only standing there lives.
   */
  perform body_settle(v_world, me);
  select * into p from player where world_id = v_world and uid = me;
  -- Said before the row is read back, so what goes out is what was true when
  -- it was read rather than what was true a statement ago.
  if p.skills_at is not null and (p.skills_seen is null or p.skills_at > p.skills_seen) then
    update player set skills_seen = now() where world_id = v_world and uid = me;
  end if;
  if p.tally_at is not null and (p.tally_seen is null or p.tally_at > p.tally_seen) then
    update player set tally_seen = now() where world_id = v_world and uid = me;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'settled', n,
    'act', p.act,
    'ends', p.act_ends,
    'left', p.act_left,
    -- And how many were asked for, which nothing wrote down until now. The bar
    -- says "3 of 10" off this and `left`; the browser used to keep its own
    -- tally, which is a second opinion about a number the island owns — and it
    -- only ever heard one for a job that *started*, never for one that waited
    -- its turn in the queue.
    'goes', p.act_goes,
    'secs', case when p.act_ends is null then null
                 else greatest(0, extract(epoch from (p.act_ends - now()))) end,
    'total', case when p.act_ends is null or p.act_started is null then null
                  else greatest(0.001, extract(epoch from (p.act_ends - p.act_started))) end,
    -- What is lined up behind it, and how much room is left in your head.
    'queue', coalesce((select jsonb_agg(jsonb_build_object(
                         'action', q->>'action',
                         'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                       from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb),
    'cap', case when v_world is null then null else queue_capacity(v_world, me) end,
    -- The bars, which have been the ones you came ashore with until now.
    'stats', p.stats,
    /*
     * And what you are carrying, which has never gone out at all.
     *
     * The island has kept wounds since they were ported — `wounds_settle`
     * drains your health from them, turns them bad, closes them over and says
     * so — and no door has ever mentioned them. So on an island the wound
     * window was empty however cut about you were, `bleeding()` was false, and
     * a bandage or a healing cover had nothing to be put on. The health you
     * were losing to them arrived as a number going down for no stated reason.
     *
     * Sent every beat rather than when they change, unlike the skill book
     * above: this is a column of the row that has already been read, not an
     * aggregate over a table, so there is nothing to save by leaving it out —
     * and `[]` has to be able to mean "they have all closed".
     */
    'wounds', coalesce(p.wounds, '[]'::jsonb),
    /*
     * And the rest of what you are, which the row has kept all along.
     *
     * Rest, the dishes favouring a trade, the knacks, the titles and what is
     * on your table: every one of them is a column the browser draws and none
     * of them has ever crossed. A hud saying "Rested 12m · everything ×2" off
     * a number the island never sent is a hud making it up.
     */
    'rested', coalesce(p.rested, 0),
    'boons', coalesce(p.boons, '[]'::jsonb),
    'knacks', coalesce(p.knacks, '{}'::jsonb),
    'titles', coalesce(p.titles, '[]'::jsonb),
    'title', p.title,
    'nutrition', coalesce(p.nutrition, '{}'::jsonb),
    /*
     * Every skill, but only when one of them has moved.
     *
     * The log says one went up and the window said it did not, which is why
     * this is here — and it was aggregating the whole book on every beat,
     * standing still, to hand back the forty numbers it handed back last time.
     * `skill_raise` stamps the player now, so a quiet beat costs nothing and a
     * busy one costs what it always did.
     *
     * Left out rather than emptied when nothing moved, and the browser applies
     * only the keys it is given.
     *
     * And `p_book`, which is the whole of what this got wrong. The stamp is on
     * the *player*, not on the session — so a browser that had just opened,
     * holding nothing but the starting value of every skill, was told nothing,
     * because the last session had already been told. Reported as mining
     * refusing an iron vein: "Iron vein needs mining 5 to work. Yours is 1.0",
     * with the island's own log line saying 13.26 two lines above it. Worse
     * than wrong — it locks: the seam you cannot start is the seam that would
     * have raised the skill that says you can.
     *
     * So the browser says whether it holds a book, the same way it says how
     * much of the talk it has heard. It asks once, gets the lot, and every
     * beat after that is the delta this was written for.
     */
    'skills', case when not coalesce(p_book, false)
                        and p.skills_seen is not null and p.skills_at is not null
                        and p.skills_at <= p.skills_seen then null
                   else coalesce((select jsonb_object_agg(s.id, s.value) from skill s
                                  where s.world_id = v_world and s.uid = me), '{}'::jsonb) end,
    /*
     * And the journal: what you have done, what you have made, and what is
     * ticked off.
     *
     * Behind the same cursor the book is behind, and for the same reason: it
     * only moves when something is noted, and a browser that has just opened
     * holds none of it. Three fields rather than one because they are three
     * different things — a count of goes, a record of a bench, and a list of
     * ids — and because the browser applies each of them differently.
     */
    'tally', case when not coalesce(p_book, false)
                       and p.tally_seen is not null and p.tally_at is not null
                       and p.tally_at <= p.tally_seen then null
                  else coalesce(p.tally, '{}'::jsonb) end,
    'ledger', case when not coalesce(p_book, false)
                        and p.tally_seen is not null and p.tally_at is not null
                        and p.tally_at <= p.tally_seen then null
                   else coalesce(p.ledger, '{}'::jsonb) end,
    'ticked', case when not coalesce(p_book, false)
                        and p.tally_seen is not null and p.tally_at is not null
                        and p.tally_at <= p.tally_seen then null
                   else coalesce(p.ticked, '[]'::jsonb) end,
    /*
     * And anything said since you last heard.
     *
     * Talk and the island's own lines arrive over Realtime, which is fast and
     * is not a promise: a channel that dropped for a moment loses them for
     * good, and `event` was the one table with no way to catch up. The browser
     * carries the highest `n` it has seen and gets whatever is newer, so a
     * dropped line is twenty seconds late rather than gone.
     */
    'said', case when p_said is null then null
                 when p_said <= 0 then '[]'::jsonb
                 else coalesce((select jsonb_agg(jsonb_build_object(
                        'n', e.n, 'text', e.text, 'kind', e.kind) order by e.n)
                      from event e
                      where e.world_id = v_world and e.n > p_said
                        and (e.uid is null or e.uid = me)
                      limit 60), '[]'::jsonb) end,
    /*
     * And where the talk had got to when you arrived.
     *
     * The catch-up above is for a channel that dropped, and it is counted from
     * the highest line the browser has heard. A browser that has just opened
     * has heard none, carries a nought, and was handed the *oldest* sixty
     * lines on the island — "You wash ashore on an untouched island", measured
     * on a body that came ashore a week ago — and then the next sixty on the
     * beat after that, walking forward through its own history while somebody
     * watched.
     *
     * So a nought means "I have just got here" rather than "from the
     * beginning": nothing is missed yet, and the mark to count from comes back
     * instead. What was said before you arrived is `rpc_chat`'s job and it
     * already does it, sixty lines of talk, which is a different question from
     * this one.
     */
    'saidTo', case when coalesce(p_said, 1) > 0 then null
                   else coalesce((select max(e.n) from event e where e.world_id = v_world), 0) end,
    -- The ore a prospector read, and how much longer it is lit for.
    'marks', case when jsonb_typeof(p.stats->'prospected') <> 'object' then null
                  else jsonb_build_object(
                    'tiles', p.stats->'prospected'->'tiles',
                    'secs', greatest(0, (p.stats->'prospected'->>'until')::double precision
                                        - extract(epoch from now()))) end,
    'queued', coalesce(jsonb_array_length(p.act_queue), 0),
    -- And what hour it is out there, which the browser had been keeping for
    -- itself. Seconds since the island began, so the browser works the hour
    -- out the way it always did rather than being handed a picture to draw.
    'time', case when v_world is null then null else world_time(v_world) end,
    -- The island's own reading of the same clock. Nothing draws from this: it
    -- is here so that two ends disagreeing about whether it is dark can be
    -- seen, rather than found out by a lantern that would not light.
    'night', case when v_world is null then null else is_night(v_world) end));
end $function$;

-- The four-argument door goes, or PostgREST keeps both and picks whichever it
-- feels like: a `create or replace` with a new argument list makes a *second*
-- function, and the one without `p_ticked` would quietly drop every tick.
drop function if exists rpc_settle(bigint, uuid, bigint, boolean);

notify pgrst, 'reload schema';

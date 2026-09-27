/*
 * Springs: ponds above the sea, and the streams and falls between them.
 *
 * Asked for: player-made ponds at any height, and streams made of ponds one
 * below the next, with a waterfall wherever a step down is a tall one.
 *
 * A spring is dug at the bottom of a hollow. Its water fills the hollow to
 * the height of its lowest lip, runs over that lip and down the slope to the
 * next hollow, fills that, and so on until it reaches the sea, runs further
 * than a spring's water carries, or comes to a hollow too wide to fill.
 * Where all of that stands is worked out from the shape of the ground once,
 * when the spring is dug and again whenever the ground it looked at changes,
 * and kept: nothing about it is ever worked out on the clock. The browser
 * does the same steps in `settleChain` (`src/world/springs.ts`), in the same
 * order, and `supabase/test/springs.ts` holds the two to the same answer.
 *
 * What a pond is, to everything that asks about water: `has_water`,
 * `water_depth` and `in_deep_water` read `spring_tile` beside the sea, so a
 * bucket fills from a pond, a line is cast into one, a beast drinks from one,
 * nothing is built or planted in one, and somebody out of their depth in one
 * swims.
 */

set local lock_timeout = '3s';

-- The same numbers as `src/world/springs.ts`.
create or replace function spring_reach() returns int language sql immutable as 'select 40';
create or replace function pond_most() returns int language sql immutable as 'select 576';
create or replace function chain_most() returns int language sql immutable as 'select 12';
create or replace function run_most() returns int language sql immutable as 'select 60';
create or replace function spring_depth() returns int language sql immutable as 'select 3';
create or replace function springs_each() returns int language sql immutable as 'select 4';
create or replace function fill_rate() returns double precision language sql immutable as 'select 2::double precision';
create or replace function run_rate() returns double precision language sql immutable as 'select 4::double precision';

create table if not exists spring (
  id bigserial primary key,
  world_id uuid not null references world(id) on delete cascade,
  -- The tile it was dug in, and the corner its water rises at: the tile's lowest.
  x int not null,
  y int not null,
  cx int not null,
  cy int not null,
  made_by uuid,
  made_at timestamptz not null default now(),
  -- Its ponds and streams, as `settle_chain` lays them out, each pond with
  -- the level it rose from and when, for drawing it rising.
  chain jsonb not null default '{}'::jsonb,
  -- The corners the settling looked at: a change to ground outside them changes nothing.
  lo_x int not null default 0,
  lo_y int not null default 0,
  hi_x int not null default 0,
  hi_y int not null default 0,
  -- Counted up every time it is settled, so a browser asks for a chain only when it has changed.
  ver int not null default 1
);
create index if not exists spring_world on spring (world_id);
create index if not exists spring_box on spring (world_id, lo_x, hi_x);

-- Every tile a pond covers, for the questions asked of one tile at a time.
create table if not exists spring_tile (
  world_id uuid not null,
  x int not null,
  y int not null,
  spring_id bigint not null references spring(id) on delete cascade,
  pond int not null,
  level int not null,
  primary key (world_id, x, y, spring_id, pond)
);
create index if not exists spring_tile_spring on spring_tile (spring_id);

-- A pool dug in a foundation (`Foundation.pool`): water `pool_lip` under its top over a floor `pool_depth` under it.
alter table foundation add column if not exists pool boolean not null default false;
create or replace function pool_depth() returns int language sql immutable as 'select 20';
create or replace function pool_lip() returns int language sql immutable as 'select 2';
-- The concrete it takes to fill one back in: a barrowful a step of its depth (`POOL_FILL`).
create or replace function pool_fill() returns int language sql immutable as 'select pool_depth()';

alter table spring enable row level security;
alter table spring_tile enable row level security;

/*
 * The ponds and streams one spring's water makes, from the ground as it is.
 *
 * `settleChain` in `src/world/springs.ts`, step for step: the same window of
 * `spring_reach` corners either way, the same order of neighbours (above,
 * left, right, below), the same heap order (lowest, then first reached), the
 * same way downhill (lowest, then first by row and column). A corner off the
 * map, or one the island has no height for, is ground the water cannot get
 * over. Answers `{"refused": "flat"}` for a hollow that holds less than
 * `spring_depth`, `{"refused": "wide"}` for one it would never fill.
 */
create or replace function settle_chain(p_world uuid, p_sx int, p_sy int, p_tx int default null, p_ty int default null) returns jsonb
  language plpgsql stable as $fn$
declare
  v_reach int := spring_reach();
  W int := 2 * spring_reach() + 1;
  n int := (2 * spring_reach() + 1) * (2 * spring_reach() + 1);
  x0 int := p_sx - spring_reach();
  y0 int := p_sy - spring_reach();
  v_size int;
  h int[];
  onm boolean[];
  pushed int[];
  parent int[];
  ord int[];
  own int[];
  hp int[];
  hs int := 0;
  cnt int := 0;
  round int := 0;
  lo_i int := spring_reach(); lo_j int := spring_reach();
  hi_i int := spring_reach(); hi_j int := spring_reach();
  -- One filling.
  seed int; cur int; c int; m int; d int; p int; q int; lt int; rt int; t int; dir int;
  v_level int; cells int[]; v_over int; v_lip int; v_wide boolean;
  wet int[]; v_floor int; across int[];
  -- The chain.
  first boolean := true;
  ponds jsonb := '[]'::jsonb;
  streams jsonb := '[]'::jsonb;
  stream_to int[] := '{}';
  v_from int := 0;
  path int[];
  v_to text;
  np int := 0;
  zz int;
  -- A spring dug in a pool: the foundations in the window by tile, top and whether a pool is dug in it.
  v_slab foundation;
  fr record;
  st int[];
  sp boolean[];
  seen boolean[];
  inb boolean[];
  qx int[]; qy int[]; qi int; bxs int[]; bys int[];
  v_tx int; v_ty int; v_top int; nx int; ny int; ti int; kk int;
  ea_x int; ea_y int; eb_x int; eb_y int; ka int; kb int;
  c_to int; c_kind text; c_fx int; c_fy int; c_px int; c_py int;
  b_to int; b_kind text; b_ax int; b_ay int; b_bx int; b_by int; b_fx int; b_fy int; b_px int; b_py int;
  v_run boolean := false;
begin
  select size into v_size from world where id = p_world;
  -- The window of ground, row by row, NULL where there is none.
  select array_agg(case when lc.heights is null or x0 + ii.i < 0 or x0 + ii.i > v_size then null
                        else b_i16(lc.heights, x0 + ii.i) end order by jj.j, ii.i)
    into h
  from generate_series(0, W - 1) as jj(j)
  cross join generate_series(0, W - 1) as ii(i)
  left join land_corner lc on lc.world_id = p_world and lc.y = y0 + jj.j and lc.y between 0 and v_size;
  onm := array_fill(false, array[n]);
  for k in 1 .. n loop
    if h[k] is not null then onm[k] := true; else h[k] := 0; end if;
  end loop;
  pushed := array_fill(0, array[n]);
  parent := array_fill(0, array[n]);
  ord := array_fill(0, array[n]);
  own := array_fill(0, array[n]);
  hp := array_fill(0, array[n]);
  seed := v_reach * W + v_reach;

  /*
   * A spring dug in a pool begins with the pool (`settleChain`, step for
   * step): every pool joined to it poured to the same top, its water over the
   * edge with the lowest thing beyond it, pool to pool, and down the ground
   * from the foot of the last. A foundation with no pool in it buries one.
   */
  if p_tx is not null then
    select * into v_slab from foundation fo
     where fo.world_id = p_world and fo.x = p_tx and fo.y = p_ty and bill_done(fo.needed);
    if found and not v_slab.pool then return jsonb_build_object('refused', 'buried'); end if;
    if found then
      st := array_fill(null::int, array[(W - 1) * (W - 1)]);
      sp := array_fill(false, array[(W - 1) * (W - 1)]);
      for fr in select fo.x, fo.y, fo.top, fo.pool from foundation fo
          where fo.world_id = p_world and bill_done(fo.needed)
            and fo.x between x0 and x0 + W - 2 and fo.y between y0 and y0 + W - 2 loop
        st[(fr.y - y0) * (W - 1) + (fr.x - x0) + 1] := fr.top;
        sp[(fr.y - y0) * (W - 1) + (fr.x - x0) + 1] := fr.pool;
      end loop;
      v_tx := p_tx; v_ty := p_ty; v_top := v_slab.top;
      loop
        -- The pool and every pool joined to it poured to the same top, as the browser's `basin`.
        seen := array_fill(false, array[(W - 1) * (W - 1)]);
        seen[(v_ty - y0) * (W - 1) + (v_tx - x0) + 1] := true;
        qx := array[v_tx]; qy := array[v_ty]; qi := 1;
        while qi <= cardinality(qx) and cardinality(qx) <= pond_most() loop
          lo_i := least(lo_i, qx[qi] - x0); lo_j := least(lo_j, qy[qi] - y0);
          hi_i := greatest(hi_i, qx[qi] + 1 - x0); hi_j := greatest(hi_j, qy[qi] + 1 - y0);
          for dir in 1 .. 4 loop
            nx := qx[qi] + case dir when 2 then -1 when 3 then 1 else 0 end;
            ny := qy[qi] + case dir when 1 then -1 when 4 then 1 else 0 end;
            continue when nx < x0 or ny < y0 or nx + 1 >= x0 + W or ny + 1 >= y0 + W;
            ti := (ny - y0) * (W - 1) + (nx - x0) + 1;
            continue when seen[ti];
            seen[ti] := true;
            if sp[ti] and st[ti] = v_top then qx := qx || nx; qy := qy || ny; end if;
          end loop;
          qi := qi + 1;
        end loop;
        select array_agg(u.x order by u.y, u.x), array_agg(u.y order by u.y, u.x) into bxs, bys from unnest(qx, qy) u(x, y);
        inb := array_fill(false, array[(W - 1) * (W - 1)]);
        for kk in 1 .. cardinality(bxs) loop inb[(bys[kk] - y0) * (W - 1) + (bxs[kk] - x0) + 1] := true; end loop;
        v_level := v_top - pool_lip();
        -- Over the edge with the lowest thing beyond it, as the browser's `outlet`.
        b_kind := null; b_to := null;
        for kk in 1 .. cardinality(bxs) loop
          for dir in 1 .. 4 loop
            nx := bxs[kk] + case dir when 2 then -1 when 3 then 1 else 0 end;
            ny := bys[kk] + case dir when 1 then -1 when 4 then 1 else 0 end;
            ea_x := bxs[kk] + case dir when 3 then 1 else 0 end;
            ea_y := bys[kk] + case dir when 4 then 1 else 0 end;
            eb_x := bxs[kk] + case dir when 2 then 0 else 1 end;
            eb_y := bys[kk] + case dir when 1 then 0 else 1 end;
            continue when nx < x0 or ny < y0 or nx + 1 >= x0 + W or ny + 1 >= y0 + W;
            ti := (ny - y0) * (W - 1) + (nx - x0) + 1;
            continue when inb[ti];
            c_kind := null;
            if st[ti] is not null then
              -- A foundation is a wall, unless there is a pool in it lower than this one.
              if sp[ti] and st[ti] - pool_lip() < v_level then
                c_kind := 'pool'; c_to := st[ti] - pool_lip(); c_px := nx; c_py := ny;
              end if;
            else
              ka := (ea_y - y0) * W + (ea_x - x0);
              kb := (eb_y - y0) * W + (eb_x - x0);
              lo_i := least(lo_i, ea_x - x0, eb_x - x0); lo_j := least(lo_j, ea_y - y0, eb_y - y0);
              hi_i := greatest(hi_i, ea_x - x0, eb_x - x0); hi_j := greatest(hi_j, ea_y - y0, eb_y - y0);
              continue when not onm[ka + 1] or not onm[kb + 1];
              if least(h[ka + 1], h[kb + 1]) < v_level then
                c_kind := 'ground'; c_to := least(h[ka + 1], h[kb + 1]);
                if h[kb + 1] < h[ka + 1] then c_fx := eb_x; c_fy := eb_y; else c_fx := ea_x; c_fy := ea_y; end if;
              end if;
            end if;
            if c_kind is not null and (b_kind is null or c_to < b_to) then
              b_kind := c_kind; b_to := c_to; b_ax := ea_x; b_ay := ea_y; b_bx := eb_x; b_by := eb_y;
              b_fx := c_fx; b_fy := c_fy; b_px := c_px; b_py := c_py;
            end if;
          end loop;
        end loop;
        ponds := ponds || jsonb_build_array(jsonb_build_object(
          'level', v_level, 'floor', v_top - pool_depth(), 'wet', '[]'::jsonb,
          'lip', case when b_kind is null then jsonb_build_array(v_tx, v_ty) else jsonb_build_array(b_ax, b_ay) end,
          'over', case when b_kind = 'ground' then jsonb_build_array(b_fx, b_fy)
                       when b_kind is null then jsonb_build_array(v_tx, v_ty) else jsonb_build_array(b_ax, b_ay) end,
          'tiles', (select jsonb_agg(v order by o, s) from unnest(bxs, bys) with ordinality u(x, y, o),
                      lateral (values (1, u.x), (2, u.y)) e(s, v)))
          || case when b_kind is null then '{}'::jsonb
                  else jsonb_build_object('spill', jsonb_build_object(
                    'edge', jsonb_build_array(b_ax, b_ay, b_bx, b_by), 'to', b_to)) end);
        np := np + 1;
        if b_kind is null then
          return jsonb_build_object('ponds', ponds, 'streams', streams,
            'box', jsonb_build_array(x0 + lo_i, y0 + lo_j, x0 + hi_i, y0 + hi_j));
        end if;
        if b_kind = 'pool' then
          streams := streams || jsonb_build_array(jsonb_build_object('from', np - 1,
            'path', jsonb_build_array(b_ax, b_ay), 'to', case when np >= chain_most() then to_jsonb('lost'::text) else to_jsonb(np) end));
          if np >= chain_most() then
            return jsonb_build_object('ponds', ponds, 'streams', streams,
              'box', jsonb_build_array(x0 + lo_i, y0 + lo_j, x0 + hi_i, y0 + hi_j));
          end if;
          v_tx := b_px; v_ty := b_py; v_top := b_to + pool_lip();
          continue;
        end if;
        -- Onto the ground at the foot of the slab, and down it as any stream runs.
        v_from := np - 1;
        c := (b_fy - y0) * W + (b_fx - x0);
        path := array[c];
        first := false;
        v_run := true;
        exit;
      end loop;
    end if;
  end if;

  <<hollows>>
  loop
    if v_run then
      v_run := false;
    else
    -- Fill from `seed`: lowest corner next to the water first, the first reached among equals.
    round := round + 1;
    hs := 0; cnt := 0;
    v_level := h[seed + 1];
    cells := array[seed];
    pushed[seed + 1] := round;
    lo_i := least(lo_i, seed % W); lo_j := least(lo_j, seed / W);
    hi_i := greatest(hi_i, seed % W); hi_j := greatest(hi_j, seed / W);
    cur := seed;
    v_wide := false;
    v_over := null;
    loop
      for dir in 1 .. 4 loop
        m := case dir when 1 then case when cur >= W then cur - W end
                      when 2 then case when cur % W > 0 then cur - 1 end
                      when 3 then case when cur % W < W - 1 then cur + 1 end
                      else case when cur < n - W then cur + W end end;
        continue when m is null or not onm[m + 1] or pushed[m + 1] = round;
        pushed[m + 1] := round;
        parent[m + 1] := cur;
        lo_i := least(lo_i, m % W); lo_j := least(lo_j, m / W);
        hi_i := greatest(hi_i, m % W); hi_j := greatest(hi_j, m / W);
        hs := hs + 1; hp[hs] := m; ord[m + 1] := cnt; cnt := cnt + 1;
        p := hs;
        while p > 1 loop
          q := p / 2;
          exit when not (h[hp[p] + 1] < h[hp[q] + 1]
                         or (h[hp[p] + 1] = h[hp[q] + 1] and ord[hp[p] + 1] < ord[hp[q] + 1]));
          t := hp[p]; hp[p] := hp[q]; hp[q] := t; p := q;
        end loop;
      end loop;
      if hs = 0 then v_wide := true; exit; end if;
      c := hp[1]; hp[1] := hp[hs]; hs := hs - 1;
      p := 1;
      loop
        lt := 2 * p; rt := 2 * p + 1; q := p;
        if lt <= hs and (h[hp[lt] + 1] < h[hp[q] + 1]
                         or (h[hp[lt] + 1] = h[hp[q] + 1] and ord[hp[lt] + 1] < ord[hp[q] + 1])) then q := lt; end if;
        if rt <= hs and (h[hp[rt] + 1] < h[hp[q] + 1]
                         or (h[hp[rt] + 1] = h[hp[q] + 1] and ord[hp[rt] + 1] < ord[hp[q] + 1])) then q := rt; end if;
        exit when q = p;
        t := hp[p]; hp[p] := hp[q]; hp[q] := t; p := q;
      end loop;
      if h[c + 1] < v_level then v_over := c; v_lip := parent[c + 1]; exit; end if;
      if h[c + 1] > v_level then v_level := h[c + 1]; end if;
      cells := cells || c;
      if cardinality(cells) > pond_most() then v_wide := true; exit; end if;
      cur := c;
    end loop;

    if not v_wide then
      select coalesce(array_agg(z order by z), '{}') into wet from unnest(cells) z where h[z + 1] < v_level;
    end if;
    if first then
      if v_wide then return jsonb_build_object('refused', 'wide'); end if;
      if cardinality(wet) = 0 then return jsonb_build_object('refused', 'flat'); end if;
      select min(h[z + 1]) into v_floor from unnest(wet) z;
      if v_level - v_floor < spring_depth() then return jsonb_build_object('refused', 'flat'); end if;
      first := false;
    elsif v_wide then
      v_to := 'lost';
    elsif cardinality(wet) = 0 then
      -- Level ground: the water crosses it to where it goes over the edge, and runs on down from there.
      across := '{}';
      t := v_lip;
      while t <> seed loop across := t || across; t := parent[t + 1]; end loop;
      path := path || across || v_over;
      c := v_over;
      if cardinality(path) > run_most() then v_to := 'lost'; end if;
    else
      -- A pond: the stream that came down here ends in it.
      streams := streams || jsonb_build_array(jsonb_build_object('from', v_from,
        'path', (select jsonb_agg(v order by o, s) from unnest(path) with ordinality u(z, o),
                   lateral (values (1, x0 + z % W), (2, y0 + z / W)) e(s, v)),
        'to', np));
      stream_to := stream_to || np;
      foreach zz in array path loop
        if own[zz + 1] = 0 then own[zz + 1] := -cardinality(stream_to); end if;
      end loop;
    end if;

    if v_to is not null then
      streams := streams || jsonb_build_array(jsonb_build_object('from', v_from,
        'path', (select jsonb_agg(v order by o, s) from unnest(path) with ordinality u(z, o),
                   lateral (values (1, x0 + z % W), (2, y0 + z / W)) e(s, v)),
        'to', v_to));
      exit hollows;
    end if;

    if cardinality(wet) > 0 and not v_wide then
      select min(h[z + 1]) into v_floor from unnest(wet) z;
      ponds := ponds || jsonb_build_array(jsonb_build_object(
        'level', v_level, 'floor', v_floor,
        'wet', (select jsonb_agg(v order by z, s) from unnest(wet) z,
                  lateral (values (1, x0 + z % W), (2, y0 + z / W)) e(s, v)),
        'lip', jsonb_build_array(x0 + v_lip % W, y0 + v_lip / W),
        'over', jsonb_build_array(x0 + v_over % W, y0 + v_over / W)));
      foreach zz in array wet loop own[zz + 1] := np + 1; end loop;
      v_from := np;
      np := np + 1;
      path := array[v_lip, v_over];
      c := v_over;
    end if;
    end if;

    -- Down the slope, to the sea, into water already made, or to the bottom of a hollow.
    loop
      if h[c + 1] < 0 then v_to := 'sea';
      elsif own[c + 1] > 0 then v_to := (own[c + 1] - 1)::text;
      elsif own[c + 1] < 0 then v_to := stream_to[-own[c + 1]]::text;
      end if;
      exit when v_to is not null;
      d := -1;
      for dir in 1 .. 4 loop
        m := case dir when 1 then case when c >= W then c - W end
                      when 2 then case when c % W > 0 then c - 1 end
                      when 3 then case when c % W < W - 1 then c + 1 end
                      else case when c < n - W then c + W end end;
        continue when m is null or not onm[m + 1];
        lo_i := least(lo_i, m % W); lo_j := least(lo_j, m / W);
        hi_i := greatest(hi_i, m % W); hi_j := greatest(hi_j, m / W);
        continue when h[m + 1] >= h[c + 1];
        if d < 0 or h[m + 1] < h[d + 1] or (h[m + 1] = h[d + 1] and m < d) then d := m; end if;
      end loop;
      exit when d < 0;
      path := path || d;
      c := d;
      if cardinality(path) > run_most() then v_to := 'lost'; exit; end if;
    end loop;

    if v_to is null and np >= chain_most() then v_to := 'lost'; end if;
    if v_to is not null then
      streams := streams || jsonb_build_array(jsonb_build_object('from', v_from,
        'path', (select jsonb_agg(v order by o, s) from unnest(path) with ordinality u(z, o),
                   lateral (values (1, x0 + z % W), (2, y0 + z / W)) e(s, v)),
        'to', case when v_to ~ '^[0-9]+$' then to_jsonb(v_to::int) else to_jsonb(v_to) end));
      exit hollows;
    end if;
    seed := c;
  end loop;

  return jsonb_build_object('ponds', ponds, 'streams', streams,
    'box', jsonb_build_array(x0 + lo_i, y0 + lo_j, x0 + hi_i, y0 + hi_j));
end $fn$;

/* ---- A spring's water, kept ------------------------------------------------------------------ */

-- The corner a spring dug in a tile rises at: its lowest, the first by row and column among equals (`springCorner`).
create or replace function spring_corner(p_world uuid, p_x int, p_y int) returns int[]
  language sql stable as $$
  select array[v.x, v.y] from (values (p_x, p_y), (p_x + 1, p_y), (p_x, p_y + 1), (p_x + 1, p_y + 1)) v(x, y)
  order by land_height(p_world, v.x, v.y), v.y, v.x limit 1
$$;

-- The corners of a pond as the chain writes them, one row a corner.
create or replace function pond_corners(p_pond jsonb) returns table (x int, y int)
  language sql immutable as $$
  select (p_pond->'wet'->>(2 * k))::int, (p_pond->'wet'->>(2 * k + 1))::int
  from generate_series(0, jsonb_array_length(p_pond->'wet') / 2 - 1) k
$$;

/*
 * Settle one spring on the ground as it is now, and keep what its water does.
 *
 * Each pond is kept with the level it rises from and when, for the browser to
 * draw it rising: one whose ground was under this spring's water before goes
 * on from the level that stood there, and a new one rises from its floor once
 * the pond above it is full and the water has run down to it (`fillings` in
 * `src/game/springs.ts`). A spring whose hollow has been filled in, or dug out
 * too wide to fill, stops: it and all its water go.
 */
create or replace function settle_spring(p_world uuid, p_id bigint) returns void
  language plpgsql as $$
declare s spring; v_chain jsonb; v_ponds jsonb := '[]'::jsonb; v_pond jsonb; i int := 0;
        v_old int; v_from int; v_since timestamptz; v_ready timestamptz := now(); v_full timestamptz; v_run jsonb;
        v_size int;
begin
  select * into s from spring where world_id = p_world and id = p_id for update;
  if not found then return; end if;
  v_chain := settle_chain(p_world, s.cx, s.cy, s.x, s.y);
  if v_chain ? 'refused' then
    delete from spring where id = s.id;
    return;
  end if;
  for v_pond in select value from jsonb_array_elements(v_chain->'ponds') loop
    select max(t.level) into v_old from spring_tile t, pond_corners(v_pond) c
      where t.world_id = p_world and t.spring_id = s.id and t.x = c.x and t.y = c.y;
    v_from := coalesce(v_old, (v_pond->>'floor')::int);
    v_since := case when v_old is not null then now() else greatest(now(), v_ready) end;
    v_full := v_since + make_interval(secs => abs((v_pond->>'level')::int - v_from) / fill_rate());
    select st into v_run from jsonb_array_elements(v_chain->'streams') st where (st->>'from')::int = i limit 1;
    v_ready := v_full + make_interval(secs => coalesce(jsonb_array_length(v_run->'path') / 2, 0) / run_rate());
    v_ponds := v_ponds || jsonb_build_array(v_pond || jsonb_build_object('from', v_from, 'since', v_since));
    i := i + 1;
  end loop;
  select size into v_size from world where id = p_world;
  delete from spring_tile where spring_id = s.id;
  insert into spring_tile (world_id, x, y, spring_id, pond, level)
  select distinct p_world, t.x, t.y, s.id, q.n - 1, (q.pond->>'level')::int
  from jsonb_array_elements(v_ponds) with ordinality q(pond, n)
  cross join lateral pond_corners(q.pond) c
  cross join lateral (values (c.x - 1, c.y - 1), (c.x, c.y - 1), (c.x - 1, c.y), (c.x, c.y)) t(x, y)
  where t.x between 0 and v_size - 1 and t.y between 0 and v_size - 1;
  update spring set chain = jsonb_set(v_chain, '{ponds}', v_ponds),
         lo_x = (v_chain->'box'->>0)::int, lo_y = (v_chain->'box'->>1)::int,
         hi_x = (v_chain->'box'->>2)::int, hi_y = (v_chain->'box'->>3)::int,
         ver = ver + 1
   where id = s.id;
end $$;

-- The ground changed at a corner: every spring that looked at it is settled again.
create or replace function spring_touch(p_world uuid, p_x int, p_y int) returns void
  language plpgsql as $$
declare v_id bigint;
begin
  for v_id in select id from spring
      where world_id = p_world and lo_x <= p_x and p_x <= hi_x and lo_y <= p_y and p_y <= hi_y
      order by id loop
    perform settle_spring(p_world, v_id);
  end loop;
end $$;

-- Every height written goes through here, so this is where a spring hears of it.
create or replace function land_set_height(p_world uuid, p_x int, p_y int, p_v int) returns void language sql as $$
  update land_corner c set heights = b_put_i16(c.heights, p_x, greatest(-32768, least(32767, p_v)))
  where c.world_id = p_world and c.y = p_y;
  select land_chunk_forget(p_world, p_x, p_y, true);
  select spring_touch(p_world, p_x, p_y);
$$;

/* ---- A pond is water to everything that asks ---------------------------------------------------- */

--
-- Costed as what it is, five lookups. Until it asked about ponds it was simple
-- enough for the planner to fold into the query it was called from, and so
-- was always tried after the cheaper `in_bounds` beside it; a subquery stops
-- that, and at the default cost a query that tries a tile's bounds only after
-- its water would read a corner off the edge of the island.
create or replace function has_water(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable cost 500 as $$
  select least(land_height(p_world, p_x, p_y), land_height(p_world, p_x + 1, p_y),
               land_height(p_world, p_x + 1, p_y + 1), land_height(p_world, p_x, p_y + 1)) < 0
      or exists (select 1 from spring_tile t where t.world_id = p_world and t.x = p_x and t.y = p_y)
      or exists (select 1 from foundation fo where fo.world_id = p_world and fo.x = p_x and fo.y = p_y and fo.pool)
$$;

-- How high the water over a tile stands: the highest pond or pool on it, and the sea's nothing everywhere else (`World.surfaceAt`).
create or replace function water_surface(p_world uuid, p_x int, p_y int) returns int
  language sql stable as $$
  select coalesce(greatest(
    (select max(t.level) from spring_tile t where t.world_id = p_world and t.x = p_x and t.y = p_y),
    (select fo.top - pool_lip() from foundation fo where fo.world_id = p_world and fo.x = p_x and fo.y = p_y and fo.pool)), 0)
$$;

-- The bottom of the water in the middle of a tile: a pool's floor, or the ground (`World.bedCenter`).
create or replace function water_bed(p_world uuid, p_x int, p_y int) returns double precision
  language sql stable as $$
  select coalesce((select (fo.top - pool_depth())::double precision from foundation fo
                    where fo.world_id = p_world and fo.x = p_x and fo.y = p_y and fo.pool),
                  centre_height(p_world, p_x, p_y))
$$;

-- How deep the water on a tile is, down from the sea's surface or a pond's; nought on dry land (`waterDepth`).
create or replace function water_depth(p_world uuid, p_x int, p_y int) returns double precision
  language sql stable as $$
  select case when s is not null then greatest(0, s - coalesce(f, (a + b + c + d) / 4.0))
              when least(a, b, c, d) < 0 then greatest(0, -((a + b + c + d) / 4.0))
              else 0 end
  from (select land_height(p_world, p_x, p_y) a, land_height(p_world, p_x + 1, p_y) b,
               land_height(p_world, p_x + 1, p_y + 1) c, land_height(p_world, p_x, p_y + 1) d,
               greatest((select max(t.level) from spring_tile t where t.world_id = p_world and t.x = p_x and t.y = p_y),
                        (select fo.top - pool_lip() from foundation fo where fo.world_id = p_world and fo.x = p_x and fo.y = p_y and fo.pool)) s,
               (select fo.top - pool_depth() from foundation fo where fo.world_id = p_world and fo.x = p_x and fo.y = p_y and fo.pool) f) q
$$;

/* ---- Digging a spring, and stopping one up ------------------------------------------------------ */

create or replace function spring_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('dig_spring', 'stop_spring')
$$;

-- What is said when a spring is dug (`springSays`): how deep its pond will stand, and where its water goes after that.
create or replace function spring_says(p_chain jsonb) returns text
  language sql immutable as $$
  select case
    when p_chain->'ponds'->0 ? 'tiles' and not (p_chain->'ponds'->0 ? 'spill') then
      'Water wells up in the pool. Nothing beside it is lower than its water, so it stays full and goes nowhere.'
    when p_chain->'ponds'->0 ? 'tiles' then
      'Water wells up in the pool and spills over its lowest edge, falling '
      || to_char(((p_chain->'ponds'->0->>'level')::int - (p_chain->'ponds'->0->'spill'->>'to')::int) / 10.0, 'FM990.0')
      || ' m ' || case when p_chain->'ponds'->1 ? 'tiles'
                        and (p_chain->'ponds'->0->'spill'->>'to')::int = (p_chain->'ponds'->1->>'level')::int
                       then 'into the pool below' else 'to the ground' end
      || ', and runs '
      || case when p_chain->'ponds'->-1 ? 'tiles' and not (p_chain->'ponds'->-1 ? 'spill') then
           'down into ' || (jsonb_array_length(p_chain->'ponds') - 1)
           || ' more pond' || case when jsonb_array_length(p_chain->'ponds') = 2 then '' else 's' end
           || ' below it, where it stays'
         else
           case when jsonb_array_length(p_chain->'ponds') > 1
                then 'down into ' || (jsonb_array_length(p_chain->'ponds') - 1)
                     || ' more pond' || case when jsonb_array_length(p_chain->'ponds') = 2 then '' else 's' end
                     || ' below it, and from the last of those '
                else '' end
           || case p_chain->'streams'->-1->>'to' when 'sea' then 'on into the sea'
                                                  when 'lost' then 'away into the ground'
                                                  else 'back into a pond of its own' end
         end
      || '.'
    else
  'Water wells up at the bottom of the hollow. It will stand '
      || to_char(((p_chain->'ponds'->0->>'level')::int - (p_chain->'ponds'->0->>'floor')::int) / 10.0, 'FM990.0')
      || ' m deep over ' || jsonb_array_length(p_chain->'ponds'->0->'wet') / 2
      || ' corners, then spill over the lowest point of its rim and run '
      || case when jsonb_array_length(p_chain->'ponds') > 1
              then 'down into ' || (jsonb_array_length(p_chain->'ponds') - 1)
                   || ' more pond' || case when jsonb_array_length(p_chain->'ponds') = 2 then '' else 's' end
                   || ' below it, and from the last of those '
              else '' end
      || case p_chain->'streams'->-1->>'to' when 'sea' then 'on into the sea'
                                             when 'lost' then 'away into the ground'
                                             else 'back into a pond of its own' end
      || '.'
  end
$$;

create or replace function spring_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
  language plpgsql stable as $$
declare d action_def; p player; tx int; ty int; v_c int[]; v_chain jsonb; s spring; v_slab foundation;
begin
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_target->>'kind' is distinct from 'tile' then return 'Choose the ground.'; end if;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if not in_bounds(p_world, tx, ty) then return 'There is nothing there.'; end if;
  if not in_reach(p.x, p.y, p_target, false, d.range) then return 'You are too far away from that.'; end if;
  if tool_ql(p_world, p_uid, 'shovel') <= 0 then
    return 'You need a shovel to ' || case when p_action = 'dig_spring' then 'dig for a spring' else 'stop up a spring' end || '.';
  end if;
  if p_action = 'stop_spring' then
    select * into s from spring where world_id = p_world and x = tx and y = ty order by id limit 1;
    if not found then return 'There is no spring here.'; end if;
    -- Whoever dug it may stop it; on a settlement, so may whoever may shape its ground.
    if s.made_by is distinct from p_uid
       and not exists (select 1 from deed_covering(p_world, tx, ty) dd where may_shape(p_world, p_uid, tx, ty)) then
      return 'Only whoever dug this spring may stop it up.';
    end if;
    return null;
  end if;
  if exists (select 1 from building_tile b where b.world_id = p_world and b.x = tx and b.y = ty) then
    return 'You cannot do that inside a building.';
  end if;
  -- A spring under a slab has nowhere to rise; one in a pool dug in it rises in the pool.
  v_slab := slab_at(p_world, tx, ty);
  if v_slab.id is not null and not v_slab.pool then
    return 'Dig a pool in the foundation first: a spring under a slab has nowhere to rise.';
  end if;
  if v_slab.id is null and has_water(p_world, tx, ty) then return 'There is water here already.'; end if;
  if (select count(*) from spring where world_id = p_world and made_by = p_uid) >= springs_each() then
    return 'You keep ' || springs_each() || ' springs already. Stop one up before you dig another.';
  end if;
  v_c := spring_corner(p_world, tx, ty);
  v_chain := settle_chain(p_world, v_c[1], v_c[2], tx, ty);
  if v_slab.id is not null and not (v_chain ? 'refused') then
    -- One spring to a pool: a second would only send the same water over the same edge.
    if exists (select 1 from spring sp, generate_series(0, jsonb_array_length(v_chain->'ponds'->0->'tiles') / 2 - 1) k
                where sp.world_id = p_world
                  and sp.x = (v_chain->'ponds'->0->'tiles'->>(2 * k))::int
                  and sp.y = (v_chain->'ponds'->0->'tiles'->>(2 * k + 1))::int) then
      return 'A spring rises in this pool already.';
    end if;
    return null;
  end if;
  if v_chain->>'refused' = 'flat' then
    return 'Water here would run straight off downhill. Dig a spring at the bottom of a hollow that holds '
        || to_char(spring_depth() / 10.0, 'FM990.0') || ' m of water or more.';
  end if;
  if v_chain->>'refused' = 'wide' then
    return 'This hollow is too wide for a spring ever to fill: a pond spreads over ' || pond_most() || ' corners at most.';
  end if;
  return null;
end $$;

create or replace function perform_spring(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
  language plpgsql as $$
declare tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int; v_c int[]; v_id bigint; v_tool bigint;
        v_chain jsonb;
begin
  select i.id into v_tool from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
    order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
  if v_tool is not null then perform wear_tool(v_tool); end if;
  if p_action = 'dig_spring' then
    v_c := spring_corner(p_world, tx, ty);
    insert into spring (world_id, x, y, cx, cy, made_by) values (p_world, tx, ty, v_c[1], v_c[2], p_uid)
      returning id into v_id;
    perform settle_spring(p_world, v_id);
    select chain into v_chain from spring where id = v_id;
    if v_chain is null then return; end if;
    perform skill_raise(p_world, p_uid, 'digging', 1);
    perform tell(p_world, p_uid, spring_says(v_chain), 'event');
  else
    delete from spring where world_id = p_world and x = tx and y = ty;
    perform tell(p_world, p_uid, 'You pack the spring shut. Its water sinks away, and the ponds it kept go dry.', 'event');
  end if;
end $$;

/*
 * The springs near you, and the water of any this browser has not seen as it
 * is now: `p_known` is what it holds, `{"id": ver}`. Asked on its own beat
 * rather than with the ground, because a spring changes only when somebody
 * digs, and the chains are the one large thing it could carry.
 */
create or replace function rpc_springs(p_world uuid, p_range double precision default 40, p_known jsonb default '{}'::jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  return (select jsonb_build_object(
      'near', coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ver', s.ver) order by s.id), '[]'::jsonb),
      'chains', coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'x', s.x, 'y', s.y, 'cx', s.cx, 'cy', s.cy,
            'mine', coalesce(s.made_by = me, false), 'ver', s.ver, 'chain', s.chain) order by s.id)
          filter (where coalesce((p_known->>(s.id::text))::int, -1) <> s.ver), '[]'::jsonb))
    from spring s
    where s.world_id = p_world
      and s.hi_x >= p.x - p_range and s.lo_x <= p.x + p_range
      and s.hi_y >= p.y - p_range and s.lo_y <= p.y + p_range);
end $$;

/* ---- Where the rest of the island hears of them ------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.act_refusal_rules(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d action_def; p player; cx int; cy int; tx int; ty int; t tile_def; aimed text;
begin
  select * into d from action_def where id = p_action;
  if not found then return 'There is no such thing as ' || p_action || '.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  -- Deliberately not "are you busy": asked of queued jobs too. That is rpc_act's.
  if not act_ported(p_action) then
    return 'You cannot ' || lower(d.label) || ' on this island yet.';
  end if;

  -- A crate with a wildermon in it is carried, set down or opened, and that is all.
  aimed := occupied_crate_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- Whose ground it is, before anything about what it is made of.
  aimed := ground_deed_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- A spring answers for its own reach, its own tool and whose spring it is.
  if spring_action(p_action) then
    return spring_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The last ten answer for their own reach, every one of them: a bridge is
  -- worked from either bank, a bed is furniture, and a beast is not at a tile.
  -- First of all, because a map is an item and every other family that takes
  -- an item wants one it can name a use for. This one is aimed at the map.
  if treasure_action(p_action) then
    return treasure_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if last_action(p_action) then
    return last_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the only family that does not care what it is
  -- pointed at: a prayer wants an altar, a cast wants a name, and the other
  -- three want nothing but the ground you are sitting on.
  if faith_action(p_action) then
    return faith_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the ones asked of a beast, which is not at a
  -- tile, and half of a cart, which is furniture and would otherwise be handed
  -- to the code that lights fires. Both answer for their own reach.
  if ride_action(p_action) then
    return ride_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if hands_action(p_action) then
    return hands_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Before the one that lights fires, which is what pointing at furniture has
  -- meant up to now: a barrel is furniture too, and tipping it out is not a fire.
  if liquid_action(p_action) then
    return liquid_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Also before the one that lights fires: an oven is furniture and an anvil
  -- is pointed at the same way a kiln is, and neither wants that route.
  if forge_action(p_action) then
    return forge_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if holding_action(p_action) then
    return holding_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The token is under your feet and a post answers for its own reach, so
  -- neither wants the reach check below.
  if settlement_action(p_action) then
    return settlement_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if dig_action(p_action) then
    return dig_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A trap answers for its own reach, and rolls itself forward before it
  -- answers anything at all.
  if trap_action(p_action) then
    return trap_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Working the ground answers for its own reach for the same reason: a
  -- corner is a place rather than a thing, and `drop_dirt` names one.
  if ground_action(p_action) then
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
    if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
      return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
    end if;
    return ground_refusal(p_world, p_uid, p_action, p_target);
  end if;
  /*
   * A furnace is brought up to date before anything asks it a question: its
   * fire and its queue together, so that "is anything finished" is answered
   * about now rather than about whenever somebody last stood here.
   */
  if aimed in ('smelter', 'kiln') then
    perform furnace_settle(p_world, nullif(p_target->>'id', '')::bigint);
  end if;
  if item_action(p_action) then
    return item_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if firing_action(p_action) then
    return firing_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if aimed in ('campfire', 'smelter', 'kiln', 'furniture', 'anvil') or fire_action(p_action) then
    return fire_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A crate is reached for rather than stood in front of, so it answers for
  -- its own reach the way the creatures do.
  if crate_action(p_action) then
    return crate_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Fitting a padlock and taking one off: aimed at a crate or at a piece of
  -- furniture, so it sits beside the family that answers for crates.
  if p_action in ('fit_lock', 'take_off_lock') then
    return lock_refusal_for(p_world, p_uid, p_action, p_target);
  end if;
  -- The stake is in your hand and the ground is under your feet: nothing to reach for.
  if p_action = 'found_settlement' then
    return deed_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A creature is not at a tile, it is wherever its last leg left it, so the
  -- reach check below cannot answer for it. Both of these do their own; the
  -- fighting ones reach as far as what is in your hand, which is further.
  if creature_action(p_action) then
    return creature_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if fight_action(p_action) then
    return fight_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A line and a net reach as far as their Fisher casts and drags them (a Long Cast, a Wide Net).
  if not in_reach(p.x, p.y, p_target, d.corner, case p_action when 'fish' then cast_reach(p_world, p_uid)::real
                                                                when 'drag_net' then net_reach(p_world, p_uid)::real
                                                                else d.range end) then
    return 'You are too far away from that.';
  end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
  end if;
  if foundation_action(p_action) then
    return foundation_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if build_action(p_action) then
    return build_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble', 'drop_dirt_here') then
    return terrain_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    return gather_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if farm_action(p_action) then
    return farm_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('fish', 'drag_net') then
    return fish_refusal(p_world, p_uid, p_action, p_target);
  end if;

  if exists (select 1 from recipe where id = p_action) then
    return craft_refusal(p_world, p_uid, p_action, target_item(p_target));
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    /*
     * The same depth a pick works to. This was the exact line `terrain_refusal`
     * condemns in its own comment — `<= 0` refuses a corner standing at the
     * waterline, where no water is drawn — and mining was fixed for it while
     * digging was left with it.
     */
    -- Deeper for a Terraformer who wades.
    if land_height(p_world, cx, cy) < -pk(p.class_mul, 'depth:dig', mine_depth()) then
      return 'The water is too deep here to work in.';
    end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
  end if;
  -- A Miner's Pan: sand with water at one of its corners, and the perk to work it.
  if p_action = 'pan' then
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    if pk(p.class_mul, 'pan', 0) <= 0 then
      return 'That wants a Miner who has learned to pan.';
    end if;
    if land_tile(p_world, tx, ty) <> tile_id('Sand') then return 'Panning is done on sand.'; end if;
    if not exists (select 1 from tile_corners(tx, ty) c where land_height(p_world, c.cx, c.cy) < 0) then
      return 'There is no water at this sand to wash it in.';
    end if;
    return null;
  end if;
  -- A Terraformer's Dig out the tile: every corner of it asked what a dig asks.
  if p_action = 'dig_tile' then
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    if pk(p.class_mul, 'dig_tile', 0) <= 0 then
      return 'That wants a Terraformer who has learned to dig out a whole tile.';
    end if;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    for cx, cy in select c.cx, c.cy from tile_corners(tx, ty) c loop
      aimed := corner_under_building(p_world, cx, cy);
      if aimed is not null then return aimed; end if;
      if land_height(p_world, cx, cy) < -pk(p.class_mul, 'depth:dig', mine_depth()) then
        return 'The water is too deep here to work in.';
      end if;
      if land_dirt(p_world, cx, cy) <= 0 then
        return 'A corner of it is bare rock. Only a pickaxe will take that lower.';
      end if;
      aimed := coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                        slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
      if aimed is not null then return aimed; end if;
    end loop;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; tool_id bigint;
begin
  if spring_action(p_action) then
    perform perform_spring(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if last_action(p_action) then
    perform perform_last(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if faith_action(p_action) then
    perform perform_faith(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ride_action(p_action) then
    perform perform_ride(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if hands_action(p_action) then
    perform perform_hands(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if liquid_action(p_action) then
    perform perform_liquid(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if forge_action(p_action) then
    perform perform_forge(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if holding_action(p_action) then
    perform perform_holding(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if settlement_action(p_action) then
    perform perform_settlement(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if dig_action(p_action) then
    perform perform_dig(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if trap_action(p_action) then
    perform perform_trap(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ground_action(p_action) then
    perform perform_ground(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if foundation_action(p_action) then
    perform perform_foundation(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if build_action(p_action) then
    perform perform_building(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action = 'found_settlement' then
    perform perform_deed(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if creature_action(p_action) then
    perform perform_creature(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fight_action(p_action) then
    perform perform_fight(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fit_lock', 'take_off_lock') then
    perform perform_lock(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if crate_action(p_action) then
    perform perform_crate(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if item_action(p_action) then
    perform perform_item(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if firing_action(p_action) then
    perform perform_firing(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fire_action(p_action) then
    perform perform_fire(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if treasure_action(p_action) then
    perform perform_treasure(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble', 'drop_dirt_here') then
    perform perform_terrain(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    perform perform_gather(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if farm_action(p_action) then
    perform perform_farm(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fish', 'drag_net') then
    perform perform_fish(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if exists (select 1 from recipe where id = p_action) then
    perform perform_craft(p_world, p_uid, p_action, p_target);
    return;
  end if;

  select * into d from action_def where id = p_action;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;

  if p_action = 'dig_tile' then
    perform perform_dig_tile(p_world, p_uid, p_target);
    return;
  end if;
  if p_action = 'pan' then
    perform perform_pan(p_world, p_uid, p_target);
    return;
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'You fail to dig anything useful.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    left_dirt := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, left_dirt);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    -- Dug to the rock, the tile becomes rock and shows the seam under it.
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    if left_dirt <= 0 then
      perform tell(p_world, p_uid, 'Your shovel grates on bare rock.', 'event');
    end if;
    yield := coalesce(t.dig_yield, 'dirt');
    -- Cleaner for a Terraformer's Clean Earth, and now and then rare.
    made_ql := least(100, product_ql(s, tq) * pkx('ql:dig', 1));
    perform gather(p_world, p_uid, yield, 1, made_ql, null, perk_rare(pkx('rare:dig', 0)));
    -- And one spadeful in a thousand that is not dirt at all.
    perform maybe_map(p_world, p_uid, s, tq);
    perform skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.act_ported(p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (select 1 from recipe where id = p_action)
      or last_action(p_action)
      or spring_action(p_action)
      or faith_action(p_action)
      or ride_action(p_action)
      or trap_action(p_action)
      or dig_action(p_action)
      or treasure_action(p_action)
      or settlement_action(p_action)
      or holding_action(p_action)
      or forge_action(p_action)
      or liquid_action(p_action)
      or hands_action(p_action)
      or ground_action(p_action)
      or item_action(p_action)
      or firing_action(p_action)
      or fire_action(p_action)
      or crate_action(p_action)
      -- Fitting a padlock, and taking one off again.
      or p_action in ('fit_lock', 'take_off_lock')
      or build_action(p_action)
      or creature_action(p_action)
      or fight_action(p_action)
      or foundation_action(p_action)
      or farm_action(p_action)
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work', 'dig_tile', 'pan')
$function$;

CREATE OR REPLACE FUNCTION public.shapes_ground(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('dig', 'dredge', 'flatten', 'drop_dirt', 'drop_dirt_here', 'raise_rock',
                      'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'pave_slabs', 'remove_paving',
                      'plan_foundation', 'pour_foundation', 'strike_foundation',
                      'dig_spring', 'stop_spring', 'dig_pool', 'fill_pool')
$function$;

CREATE OR REPLACE FUNCTION public.in_deep_water(p_world uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select case
    -- A bridge deck or a mine floor is not the ground, and not the water.
    when p.level <> 0 then false
    /*
     * The cheap question first: almost everybody, almost always, is on dry
     * ground. And coalesced, because `land_height` answers NULL for ground
     * nothing has been written for, a NULL guard matches no `when`, and the
     * `else` below is a yes — so an unread height used to mean *swimming*, and
     * a swimmer spends wind rather than getting it back. Fourteen checks of
     * the live run failed with "You are too exhausted to do that" and the body
     * never recovered, because there was nothing to recover from but this.
     */
    -- Out of your depth in a pond as much as in the sea: measured down from whichever water is here.
    when coalesce(water_bed(p_world, floor(p.x)::int, floor(p.y)::int), 0)
         >= water_surface(p_world, floor(p.x)::int, floor(p.y)::int) - swim_depth()
      then false
    -- A hull, a cart bed or a saddle: something else is holding you up.
    when exists (select 1 from placed q where q.world_id = p_world and q.driver = p_uid) then false
    -- A passenger stands on a deck.
    when p.aboard is not null then false
    when exists (select 1 from creature c where c.world_id = p_world and c.rider = p_uid) then false
    else bridge_at(p_world, floor(p.x)::int, floor(p.y)::int) is null
  end
  from player p where p.world_id = p_world and p.uid = p_uid
$function$;


/* ---- Pools dug in foundations -------------------------------------------------------------------- */

-- The ground changed under or beside a whole tile -- a slab poured, a pool dug or filled in: every spring whose water looked at it settles again.
create or replace function spring_touch_tile(p_world uuid, p_x int, p_y int) returns void
  language plpgsql as $$
declare v_id bigint;
begin
  for v_id in select id from spring
      where world_id = p_world and lo_x <= p_x + 1 and p_x <= hi_x and lo_y <= p_y + 1 and p_y <= hi_y
      order by id loop
    perform settle_spring(p_world, v_id);
  end loop;
end $$;

-- Why a pool cannot be dug in the foundation on a tile, or null (`Game.poolReason`).
create or replace function pool_reason(p_world uuid, p_x int, p_y int) returns text
  language plpgsql stable as $$
declare f foundation; v_name text;
begin
  f := slab_at(p_world, p_x, p_y);
  if f.id is null then return 'Dig a pool in a poured foundation.'; end if;
  if f.pool then return 'There is a pool here already.'; end if;
  select b.name into v_name from building b
   where b.world_id = p_world
     and exists (select 1 from building_tile bt where bt.world_id = p_world and bt.building = b.id and bt.x = p_x and bt.y = p_y)
   order by b.id limit 1;
  if v_name is not null then return v_name || ' stands on it.'; end if;
  if is_token(p_world, p_x, p_y) then return 'The settlement token stands there.'; end if;
  if bridge_at(p_world, p_x, p_y) is not null then return 'A bridge is carried over that tile.'; end if;
  if exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground' and i.gx = p_x and i.gy = p_y) then
    return 'Clear away the things lying there first: they would go into the water.';
  end if;
  if exists (select 1 from placed q where q.world_id = p_world and q.x = p_x and q.y = p_y)
     or exists (select 1 from crate c where c.world_id = p_world and c.x = p_x and c.y = p_y) then
    return 'Move what stands on the slab first: it would go into the water.';
  end if;
  return null;
end $$;

create or replace function foundation_action(p_action text)
returns boolean language sql immutable as $fn$
  select p_action in ('plan_foundation', 'pour_foundation', 'strike_foundation', 'dig_pool', 'fill_pool')
$fn$;

create or replace function foundation_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns text language plpgsql stable as $fn$
declare tx int; ty int; f foundation; v_tool text;
begin
  if p_target->>'kind' is distinct from 'tile' then return 'Point at a tile.'; end if;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  f := foundation_at(p_world, tx, ty);
  -- A pool dug in a poured slab (`dig_pool`, `fill_pool` in src/game/foundations.ts).
  if p_action = 'dig_pool' then
    if need_tool(p_world, p_uid, 'pickaxe') is not null then return 'You need a pickaxe to break out a pool.'; end if;
    return pool_reason(p_world, tx, ty);
  end if;
  if p_action = 'fill_pool' then
    if not coalesce((slab_at(p_world, tx, ty)).pool, false) then return 'There is no pool here.'; end if;
    if need_tool(p_world, p_uid, 'trowel') is not null then return 'You need a trowel to work concrete.'; end if;
    if pack_count(p_world, p_uid, 'concrete') < pool_fill() then
      return 'Filling it in wants ' || pool_fill() || ' concrete, and you have ' || pack_count(p_world, p_uid, 'concrete') || '.';
    end if;
    return null;
  end if;
  if p_action = 'plan_foundation' then
    v_tool := need_tool(p_world, p_uid, 'mallet');
    if v_tool is not null then return v_tool; end if;
    if tile_slope(p_world, tx, ty) = 0 then
      return 'That tile is already level. A foundation is for ground that is not.';
    end if;
    return foundation_reason(p_world, p_uid, tx, ty, foundation_top(p_world, p_uid, tx, ty));
  end if;
  if f.id is null then return 'There is no shuttering here.'; end if;
  if p_action = 'strike_foundation' then
    if bill_done(f.needed) then return 'It is poured. That is a floor now, not a plan.'; end if;
    return null;
  end if;
  -- Pouring.
  if bill_done(f.needed) then return 'It is poured.'; end if;
  v_tool := need_tool(p_world, p_uid, 'trowel');
  if v_tool is not null then return 'You need a trowel to work concrete.'; end if;
  if pack_count(p_world, p_uid, 'concrete') < 1 then return 'You have no concrete.'; end if;
  return null;
end $fn$;

create or replace function perform_foundation(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns void language plpgsql as $fn$
declare tx int; ty int; f foundation; v_top int; v_want int; v_left int; v_back int; v_id bigint;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  f := foundation_at(p_world, tx, ty);

  if p_action = 'plan_foundation' then
    v_top := foundation_top(p_world, p_uid, tx, ty);
    if foundation_reason(p_world, p_uid, tx, ty, v_top) is not null then return; end if;
    v_want := concrete_for(p_world, tx, ty, v_top);
    select coalesce(max(fo.id), 0) + 1 into v_id from foundation fo where fo.world_id = p_world;
    insert into foundation (world_id, id, x, y, top, needed, total, made_by)
      values (p_world, v_id, tx, ty, v_top,
              jsonb_build_object('concrete', v_want), jsonb_build_object('concrete', v_want), p_uid);
    perform journal_note(p_world, p_uid, 'planned_foundation', 1);
    perform tell(p_world, p_uid,
      'You shutter a foundation over the tile, to be poured level at ' || v_top
      || '. It wants ' || v_want || ' concrete. The ground around it will not move: the slab fills the hole instead.',
      'system');
    perform land_announce(p_world, tx, ty);
    return;
  end if;

  if f.id is null then return; end if;

  if p_action = 'dig_pool' then
    if pool_reason(p_world, tx, ty) is not null then return; end if;
    update foundation fo set pool = true where fo.world_id = p_world and fo.id = f.id;
    perform skill_raise(p_world, p_uid, 'masonry', 1);
    perform tell(p_world, p_uid,
      'You break the middle out of the slab down to ' || (f.top - pool_depth()) || ', leaving a lip round it, and it holds water at '
      || (f.top - pool_lip()) || ': ' || to_char((pool_depth() - pool_lip()) / 10.0, 'FM990.0')
      || ' m deep. A pool beside it poured to the same top is the same pool; dig a spring in it and it spills over its lowest edge.',
      'event');
    perform spring_touch_tile(p_world, tx, ty);
    perform land_announce(p_world, tx, ty);
    return;
  end if;

  if p_action = 'fill_pool' then
    if not f.pool or not bill_done(f.needed) then return; end if;
    if not consume(p_world, p_uid, 'concrete', pool_fill()) then return; end if;
    update foundation fo set pool = false where fo.world_id = p_world and fo.id = f.id;
    perform skill_raise(p_world, p_uid, 'masonry', 1);
    perform tell(p_world, p_uid,
      'You fill the pool in with ' || pool_fill() || ' concrete, level with the top of the slab at ' || f.top
      || '. A spring that rose in it stops.', 'event');
    perform spring_touch_tile(p_world, tx, ty);
    perform land_announce(p_world, tx, ty);
    return;
  end if;

  if p_action = 'strike_foundation' then
    if bill_done(f.needed) then return; end if;
    v_back := coalesce((f.total->>'concrete')::int, 0) - coalesce((f.needed->>'concrete')::int, 0);
    delete from foundation fo where fo.world_id = p_world and fo.id = f.id;
    -- What went in has set; the boards come away and the rest is rubble.
    if v_back > 0 then perform give(p_world, p_uid, 'rock_shards', v_back, 20); end if;
    perform tell(p_world, p_uid,
      'You strike the shuttering' ||
      case when v_back > 0 then ' and break out ' || v_back || ' barrowful'
                                 || case when v_back > 1 then 's' else '' end || ' of set concrete as shards'
           else '' end || '.', 'event');
    perform land_announce(p_world, tx, ty);
    return;
  end if;

  -- Pouring: one barrowful a go, and the skill for the go whichever it is.
  if bill_done(f.needed) then return; end if;
  if not consume(p_world, p_uid, 'concrete', 1) then return; end if;
  v_left := greatest(0, coalesce((f.needed->>'concrete')::int, 0) - 1);
  update foundation fo set needed = jsonb_build_object('concrete', v_left)
    where fo.world_id = p_world and fo.id = f.id;
  perform skill_raise(p_world, p_uid, 'masonry', 1);
  if v_left > 0 then
    perform tell(p_world, p_uid, 'You work another barrowful into the shuttering. ' || v_left || ' to go.', 'event');
    perform land_announce(p_world, tx, ty);
    return;
  end if;
  /*
   * And the top of it is packed ground, which is what everything that asks what
   * a tile is made of wants to hear: a building wants packed dirt under it and
   * paving wants a packed floor, and a slab is both. The corners are not
   * touched — that is the whole promise of the thing — only what the top of the
   * tile is surfaced with.
   */
  perform land_set_tile(p_world, tx, ty, tile_id('Packed dirt'));
  -- A slab is a wall to water, and one poured over a spring stops it.
  perform spring_touch_tile(p_world, tx, ty);
  perform journal_note(p_world, p_uid, 'poured_foundation', 1);
  perform tell(p_world, p_uid,
    'The last of it goes in and the slab stands level at ' || f.top
    || '. You can build on it, pave it, or bring a bridge to it.', 'event');
  perform land_announce(p_world, tx, ty);
end $fn$;

create or replace function surface_height(p_world uuid, p_x int, p_y int)
returns double precision language sql stable as $fn$
  select coalesce((select (case when f.pool then f.top - pool_lip() else f.top end)::double precision from foundation f
                    where f.world_id = p_world and f.x = p_x and f.y = p_y and bill_done(f.needed)),
                  centre_height(p_world, p_x, p_y))
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  /*
   * On the slow half only, because this writes.
   *
   * The fast read runs about once a second per body — everything burning, what
   * is on the tile under you — and a settle on that path is an update a second
   * per player whether or not anything is due. The crops ride the slow half
   * beside the settlements, and any of your own work forces one of those, so
   * sowing is seen at once and a stage is at worst one reconcile late.
   */
  if p_slow then perform crops_settle(p_world, p.x, p.y, p_range); end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy' - 'crumbles_at')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false),
        /*
         * And what is in it, which this never said.
         *
         * Reported as "i opened it and dragged my dirt into it and the dirt
         * vanished". It had not: the island had the dirt in the bin and told
         * nobody. Every chest, bin, larder and cart on an island read as
         * empty over there, so anything put away went out of the pack and was
         * never seen again — the same hole a crate fell down before crates
         * carried their contents, and closed the same way. Within six tiles
         * only: you must be within two and a half to reach into one, so six
         * is generous, and a yard of full chests is not worth a phone's
         * second.
         */
                              'things', case when pl.kind = 'furniture'
                                              and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= 6
                                              -- A grave's, to whoever lies under it and nobody else.
                                              and (pl.crumbles_at is null or pl.made_by = me)
                                then coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                                       'count', i.count, 'extra', i.extra) order by i.id)
                                     from item i
                                     where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id),
                                   '[]'::jsonb)
                                else '[]'::jsonb end)
        /*
         * Whether a helm is as good as empty, its holder gone away, and who is
         * aboard as a passenger and in which place: only for a piece that has
         * either, so nothing else carries two more keys it does not need.
         */
        || case when pl.driver is null then '{}'::jsonb
                else jsonb_build_object('helm_open', coalesce((select r.away from player r
                       where r.world_id = p_world and r.uid = pl.driver), true)) end
        || coalesce((select jsonb_build_object('riders', jsonb_agg(jsonb_build_object('uid', r.uid, 'seat', r.seat)
                       order by r.seat))
                     from player r where r.world_id = p_world and r.aboard = pl.id
                     having count(*) > 0), '{}'::jsonb)
        /*
         * And a grave: whose it is, for what anybody else is told when they
         * try it; the seconds it has left, which a browser counts down on its
         * own clock rather than reading this island's; and, to its owner, how
         * many things are in it, which `things` only says from within reach --
         * the way `units` rides beside a crate's contents.
         */
        || case when pl.crumbles_at is null then '{}'::jsonb
                else jsonb_build_object('grave', jsonb_build_object('name', grave_owner(pl),
                       'left', greatest(0, extract(epoch from (pl.crumbles_at - now()))),
                       'units', case when pl.made_by = me then (select coalesce(sum(i.count), 0) from item i
                                  where i.placed = pl.id and i.holder = 'furniture') end)) end
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        -- The box first, in the whole tiles `placed_near` is keyed on, and then
        -- the exact question. A btree cannot look up a function of a column, so
        -- the exact test on its own read every placed thing on the island, on
        -- every ground poll, for every player. `x` is `floor(cx)` and `y` is
        -- `floor(cy)` -- `drag_along` and every placing write both together --
        -- so a tile of slack each way makes the box a superset of the answer
        -- and the line below still decides who is in it.
        and pl.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and pl.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', crates_near(p_world, me, p_range),
    /*
     * And what is lying on the ground, which this never carried.
     *
     * Reported as "killed a roxxa, no corpse dropped to butcher, or at least
     * isn't displaying". The corpse was there: `wound_beast` drops one where
     * the thing fell, and the suite has measured it since kills were ported.
     * This sent the fires, the crates, the crops and the walls, and never a
     * thing lying on the grass — and the browser's map of the ground was only
     * ever written by its own rules, which do not run on an island. So a
     * corpse, a log a worker put down, a hatchet somebody else dropped: all
     * in this table and drawn by nobody.
     *
     * On the fast half, because a corpse is looked for the second the thing
     * goes down; `item_on_ground` serves the box. The whole row, the way the
     * pack is sent, so the browser reads it with the same map.
     */
    'lying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id)
      from item i
      where i.world_id = p_world and i.holder = 'ground'
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb))
  /*
   * And the half that hardly ever moves.
   *
   * A fire burns down and a kiln works through its load while you stand and
   * watch it, which is why this is asked for every second. A wall is not like
   * that: it goes up when somebody builds it and then it is a wall. Sending
   * both at one pace meant a correlated subquery over `building_tile` per
   * building, a scan of `wall` and one of `floor_tile`, every second for every
   * player, to say that the house is still a house.
   *
   * So the caller says whether it wants them. A browser asks for the lot on
   * its twenty-second reconcile and after any of its own work, and for the
   * burning half the rest of the time. Left out rather than emptied: the
   * browser applies only the keys it is given, so what it holds stands.
   *
   * `p_slow` defaults true, so a page that has not been redeployed gets
   * exactly what it always got.
   */
  || case when not p_slow then '{}'::jsonb else jsonb_build_object(
    /*
     * And everybody ashore, on the slow half, which is the beat that already
     * carries the settlements. The map draws them; `folk_ashore` decides
     * whether there is anything to draw them at.
     */
    'folk', folk_ashore(p_world, me),
    /*
     * And every grave of yours, however far off: you wake a long way from
     * where you fell, and `placed` above is only what is in range. The map
     * marks them and takes the mark up when one goes. Off the index the
     * sweep uses, which holds nothing but graves.
     */
    'graves', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'x', g.x, 'y', g.y) order by g.id)
      from placed g
      where g.world_id = p_world and g.crumbles_at is not null and g.made_by = me), '[]'::jsonb),
    /*
     * What is growing here, settled first so the stage reported is the stage
     * it is actually at rather than the stage it was at when somebody last
     * touched it. Everything on this island settles lazily off a timestamp,
     * and for a crop nobody had ever been the one to ask.
     *
     * `ago` rather than `stage_at`: the browser counts in its own seconds and
     * has no use for the hour this island stamped on it.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace))
      from crop c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    /*
     * The felling notches near you, and how long ago the woods last turned
     * over. Look reads both: "2 of 3 strokes in it", "the woods turn over in
     * 9 hours". A browser on an island keeps no clock of its own for the
     * woods, so this is the only place it hears the hour.
     */
    'notches', coalesce((select jsonb_agg(jsonb_build_object('x', n.x, 'y', n.y, 'cuts', n.cuts))
      from tree_notch n
      where n.world_id = p_world
        and greatest(abs(n.x + 0.5 - p.x), abs(n.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'treesAgo', (select extract(epoch from (now() - w.trees_at)) from world w where w.id = p_world),
    -- The mark the ground is being worked to, which lives on the player row
    -- so that it is the same mark in every browser you open.
    'level', p.level_h,
    -- What you are on each of them, so the browser can say what you may do
    -- rather than finding out by being refused. Your own first one is your
    -- own or one you were asked onto; either way `deed_role` says which.
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true,
        'role', deed_role(p_world, d.founded_by, me),
        'baubles', deed_baubles_json(p_world, d.founded_by))
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        -- Land you were asked onto is land you may work, so it is drawn as
        -- yours rather than as a stranger's border you happen to be inside.
        'mine', exists (select 1 from deed_member m where m.world_id = p_world
                          and m.uid = me and m.founder = d.founded_by),
        'role', deed_role(p_world, d.founded_by, me),
        'holder', account_name(d.founded_by),
        -- And what is in its altar, for the settlements you are a citizen of.
        'baubles', case when exists (select 1 from deed_member m where m.world_id = p_world
                                       and m.uid = me and m.founder = d.founded_by)
                        then deed_baubles_json(p_world, d.founded_by) end) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb),
    /*
     * And what is standing.
     *
     * `building`, `wall` and `floor_tile` have been kept here since buildings
     * were ported and have never been sent to anybody. The rules answered
     * about them, a plan went up in Postgres, and no browser ever drew a wall
     * of it — so on an island a building was invisible to everyone, the person
     * who planned it included.
     *
     * Shaped as the browser's own `BuildingsJSON`, so it is laid straight in.
     * A building comes along whole if any of its tiles is in range: half a
     * house is worse than none, and a house is a handful of rows.
     */
    'buildings', jsonb_build_object(
      'nextId', coalesce((select max(b.id) + 1 from building b where b.world_id = p_world), 1),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'levels', b.levels, 'workLevel', b.work_level,
          'tiles', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                      from building_tile bt
                     where bt.world_id = p_world and bt.building = b.id)) order by b.id)
        from building b
        where b.world_id = p_world
          and exists (select 1 from building_tile bt
                       where bt.world_id = p_world and bt.building = b.id
                         and greatest(abs(bt.x + 0.5 - p.x), abs(bt.y + 0.5 - p.y)) <= p_range)),
        '[]'::jsonb),
      'walls', coalesce((select jsonb_agg(jsonb_build_object(
          'building', w.building, 'level', w.level, 'x', w.x, 'y', w.y, 'dir', w.dir,
          'type', w.type, 'material', w.material, 'needed', w.needed, 'total', w.total)
          order by w.level, w.dir, w.x, w.y)
        from wall w
        where w.world_id = p_world
          and greatest(abs(w.x + 0.5 - p.x), abs(w.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      'floors', coalesce((select jsonb_agg(jsonb_build_object(
          'building', f.building, 'level', f.level, 'x', f.x, 'y', f.y,
          'material', f.material, 'kind', f.kind, 'facing', f.facing,
          'needed', f.needed, 'total', f.total) order by f.level, f.x, f.y)
        from floor_tile f
        where f.world_id = p_world
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb)),
    /*
     * And the slabs, which are not buildings and do not go in with them: a
     * foundation is ground somebody poured, and the browser lays it beside the
     * terrain rather than inside a house.
     */
    'foundations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', fo.id, 'x', fo.x, 'y', fo.y, 'top', fo.top, 'pool', fo.pool,
        'needed', fo.needed, 'total', fo.total) order by fo.id)
      from foundation fo
      where fo.world_id = p_world
        and greatest(abs(fo.x + 0.5 - p.x), abs(fo.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'nextFoundationId', coalesce((select max(fo.id) + 1 from foundation fo where fo.world_id = p_world), 1)) end;
end $function$;

select private.lock_doors();

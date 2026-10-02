/*
 * Aqueducts: a stone arch whose deck is a water channel, carrying a spring's
 * water from a pond or a pool at its head across a valley, or over any other
 * ground, to a basin at its foot.
 *
 * Asked for: an aqueduct "built from a source -- something with a stored
 * water level, a spring's pond or a pool -- to a target basin -- a pool in a
 * foundation, a pond hollow, or a fountain -- whose level is no higher than
 * the source's".
 *
 * It is kept as a bridge of its own kind (`bridge.kind = 'aqueduct'`, the
 * source tile its `a` end and the tile it pours into its `b` end, its
 * `height` the channel's water): spans laid a unit at a time, and pulled down
 * for half of what went into them. Nobody walks it. Set out, built and taken
 * down by its own family of doors (`aqueduct_refusal`, `perform_aqueduct`),
 * which answers too for a bridge job aimed at one, so there is only one way
 * an aqueduct is ever worked.
 *
 * Its water is the springs'. A spring is settled through `settle_water` now,
 * `settleWater` in `src/world/aqueducts.ts` step for step: its chain as it
 * always was, and then the first of its ponds standing over the head of a
 * finished aqueduct at the channel's height or above is where its water
 * leaves -- the ponds below it that only its stream kept go dry -- and the
 * water pours in at the foot: into a fountain, which keeps it; into a pool,
 * settled as a spring dug in the pool is; or onto the ground at the lowest
 * corner of the tile, from where it runs (`settle_chain`'s new `p_run`);
 * onto a foundation with no pool in it, it goes off the slab's top over its
 * lowest edge (`p_pour`). A hollow it fills is kept with the litres it holds,
 * and rises at the channel's flow (`aqueduct_lps`) rather than at
 * `fill_rate`. No pool's water goes over an edge an aqueduct's piers stand
 * on (`aqueduct_shuts`).
 *
 * `supabase/test/aqueduct.ts` holds the two sides to one another.
 */

set local lock_timeout = '3s';

-- The same numbers as `src/world/aqueducts.ts`: the channel's water, a
-- metre across and a tenth of a metre deep, running at the springs' own
-- `run_rate` corners a second; the litres over a corner for a unit of water
-- standing on it; and how high a fountain's lowest basin holds its water.
create or replace function channel_wide() returns double precision language sql immutable as 'select 0.25::double precision';
create or replace function channel_deep() returns int language sql immutable as 'select 1';
create or replace function aqueduct_lps() returns double precision language sql immutable as
  'select channel_wide() * 4 * (channel_deep() / 10.0) * run_rate() * 4 * 1000';
create or replace function aqueduct_flow() returns double precision language sql immutable as 'select aqueduct_lps() * 60';
create or replace function corner_litres() returns int language sql immutable as 'select 1600';
create or replace function fountain_rim() returns int language sql immutable as 'select 5';

/*
 * Which springs pour along which aqueducts, one row a stream: what a
 * fountain's litres ask (`placed_litres`) and what a pulled-down aqueduct
 * says, without reading every chain. Written by `settle_spring`.
 */
create table if not exists aqueduct_feed (
  world_id uuid not null,
  spring_id bigint not null references spring(id) on delete cascade,
  bridge_id bigint not null,
  -- The tile it pours into, and whether a fountain there keeps what it pours.
  x int not null,
  y int not null,
  fountain boolean not null default false,
  primary key (spring_id, bridge_id)
);
create index if not exists aqueduct_feed_at on aqueduct_feed (world_id, x, y);
create index if not exists aqueduct_feed_bridge on aqueduct_feed (world_id, bridge_id);
alter table aqueduct_feed enable row level security;

/* ---- A spring's water, running from a corner as well as welling up in a hollow ---------------- */

drop function if exists settle_chain(uuid, int, int, int, int);
drop function if exists settle_chain(uuid, int, int, int, int, boolean);

/*
 * Whether the edge between two tiles is one an aqueduct's piers stand on: both
 * tiles on its line, end to end, set out or built. A pool's water does not go
 * over it (`aqueductShut`).
 */
create or replace function aqueduct_shuts(p_ax int[], p_ay int[], p_bx int[], p_by int[], p_px int, p_py int, p_nx int, p_ny int)
  returns boolean language sql immutable as $$
  select exists (
    select 1 from unnest(p_ax, p_ay, p_bx, p_by) l(ax, ay, bx, bby)
     where case when l.ay = l.bby
                then p_py = l.ay and p_ny = l.ay and p_px between least(l.ax, l.bx) and greatest(l.ax, l.bx)
                     and p_nx between least(l.ax, l.bx) and greatest(l.ax, l.bx)
                else p_px = l.ax and p_nx = l.ax and p_py between least(l.ay, l.bby) and greatest(l.ay, l.bby)
                     and p_ny between least(l.ay, l.bby) and greatest(l.ay, l.bby) end)
$$;

create or replace function settle_chain(p_world uuid, p_sx int, p_sy int, p_tx int default null, p_ty int default null,
                                        p_run boolean default false, p_pour boolean default false) returns jsonb
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
  -- Water poured onto a slab with no pool in it, and the aqueducts whose piers are walls to a pool's water.
  v_pour boolean := false;
  aq_ax int[]; aq_ay int[]; aq_bx int[]; aq_by int[];
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
   * from the foot of the last. A foundation with no pool in it buries one;
   * water an aqueduct pours onto one (`p_pour`) lands on its top and goes off
   * it over the edge with the lowest thing beyond it, out of no pond. An edge
   * an aqueduct's piers stand on is a wall to a pool's water (`aqueduct_shuts`).
   */
  if p_tx is not null and not p_run then
    select * into v_slab from foundation fo
     where fo.world_id = p_world and fo.x = p_tx and fo.y = p_ty and bill_done(fo.needed);
    if found and not v_slab.pool and not p_pour then return jsonb_build_object('refused', 'buried'); end if;
    if found then
      select coalesce(array_agg(b.ax), '{}'), coalesce(array_agg(b.ay), '{}'), coalesce(array_agg(b.bx), '{}'), coalesce(array_agg(b.by), '{}')
        into aq_ax, aq_ay, aq_bx, aq_by
        from bridge b where b.world_id = p_world and b.kind = 'aqueduct';
      -- Onto the top of a slab with no pool in it, and off its edge with the lowest thing beyond it (`settleChain`'s `pour`).
      v_pour := not v_slab.pool;
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
        if v_pour then
          bxs := array[v_tx]; bys := array[v_ty];
          lo_i := least(lo_i, v_tx - x0); lo_j := least(lo_j, v_ty - y0);
          hi_i := greatest(hi_i, v_tx + 1 - x0); hi_j := greatest(hi_j, v_ty + 1 - y0);
        else
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
        end if;
        inb := array_fill(false, array[(W - 1) * (W - 1)]);
        for kk in 1 .. cardinality(bxs) loop inb[(bys[kk] - y0) * (W - 1) + (bxs[kk] - x0) + 1] := true; end loop;
        v_level := case when v_pour then v_top else v_top - pool_lip() end;
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
            continue when aqueduct_shuts(aq_ax, aq_ay, aq_bx, aq_by, bxs[kk], bys[kk], nx, ny);
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
        if v_pour then
          -- Off the slab, out of no pond: nowhere lower, into a pool beside it, or onto the ground.
          v_pour := false;
          if b_kind is null then
            streams := streams || jsonb_build_array(jsonb_build_object('from', -1, 'path', '[]'::jsonb, 'to', 'lost'));
            return jsonb_build_object('ponds', ponds, 'streams', streams,
              'box', jsonb_build_array(x0 + lo_i, y0 + lo_j, x0 + hi_i, y0 + hi_j));
          end if;
          if b_kind = 'pool' then
            streams := streams || jsonb_build_array(jsonb_build_object('from', -1, 'path', jsonb_build_array(b_ax, b_ay), 'to', 0));
            v_tx := b_px; v_ty := b_py; v_top := b_to + pool_lip();
            continue;
          end if;
          v_from := -1;
          c := (b_fy - y0) * W + (b_fx - x0);
          path := array[c];
          first := false;
          v_run := true;
          exit;
        end if;
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

  /*
   * Water poured onto the ground at a corner -- the foot of an aqueduct with
   * no pool under it -- fills nothing there first: it runs from that corner
   * as a stream does from a lip, out of no pond, and nothing it comes to is
   * refused (`settleChain`'s `run`).
   */
  if p_run then
    v_from := -1;
    path := array[seed];
    c := seed;
    first := false;
    v_run := true;
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

/* ---- And carried along aqueducts ------------------------------------------------------------ */

-- Whether a pond lies over a tile: a pool that takes it in, or a pond with a corner of the tile under it (`pondCovers`).
create or replace function pond_covers(p_pond jsonb, p_x int, p_y int) returns boolean
  language sql immutable as $$
  select case when p_pond ? 'tiles' then
    exists (select 1 from generate_series(0, jsonb_array_length(p_pond->'tiles') / 2 - 1) k
             where (p_pond->'tiles'->>(2 * k))::int = p_x and (p_pond->'tiles'->>(2 * k + 1))::int = p_y)
  else
    exists (select 1 from pond_corners(p_pond) c where c.x - p_x in (0, 1) and c.y - p_y in (0, 1))
  end
$$;

-- The litres a pond holds full: over each corner under it, as deep as the water there, a tile's breadth (`pondVolume`).
create or replace function pond_volume(p_world uuid, p_pond jsonb) returns bigint
  language sql stable as $$
  select coalesce(sum((p_pond->>'level')::int - land_height(p_world, c.x, c.y)), 0)::bigint * corner_litres()
  from pond_corners(p_pond) c
$$;

/*
 * A spring's water, with the aqueducts it reaches: `settleWater`, step for
 * step. The spring's own chain first; then down its ponds, the first over the
 * head of a finished aqueduct (the first by id not already taken) at the
 * channel's height or above is cut there, and what the water does at the foot
 * is added on and looked through in its turn.
 */
create or replace function settle_water(p_world uuid, p_sx int, p_sy int, p_tx int default null, p_ty int default null)
  returns jsonb language plpgsql stable as $fn$
declare
  v_chain jsonb; v_ponds jsonb; v_streams jsonb; v_box int[]; v_cont jsonb; v_via jsonb;
  k int := 0; v_off int; a bridge; v_used bigint[] := '{}'; v_c int[]; v_slab foundation; v_pool boolean; e record;
begin
  v_chain := settle_chain(p_world, p_sx, p_sy, p_tx, p_ty);
  if v_chain ? 'refused' then return v_chain; end if;
  -- No aqueduct on the island at all, which is most of them: the chain is the whole of it.
  if not exists (select 1 from bridge b where b.world_id = p_world and b.kind = 'aqueduct') then return v_chain; end if;
  v_ponds := v_chain->'ponds';
  v_streams := v_chain->'streams';
  v_box := array[(v_chain->'box'->>0)::int, (v_chain->'box'->>1)::int, (v_chain->'box'->>2)::int, (v_chain->'box'->>3)::int];
  while k < jsonb_array_length(v_ponds) loop
    select b.* into a from bridge b
     where b.world_id = p_world and b.kind = 'aqueduct' and not (b.id = any (v_used))
       and (v_ponds->k->>'level')::int >= b.height
       and not exists (select 1 from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id and not span_done(sp.needed))
       and pond_covers(v_ponds->k, b.ax, b.ay)
     order by b.id limit 1;
    if found then
      v_used := v_used || a.id;
      -- Every pond after this one goes, and every stream out of it.
      v_ponds := (select jsonb_agg(t.e order by t.i) from jsonb_array_elements(v_ponds) with ordinality t(e, i) where t.i <= k + 1);
      -- What went over a pool's edge goes along the channel instead.
      v_ponds := jsonb_set(v_ponds, array[k::text], (v_ponds->k) - 'spill');
      v_streams := coalesce((select jsonb_agg(t.e order by t.i) from jsonb_array_elements(v_streams) with ordinality t(e, i)
                              where (t.e->>'from')::int < k), '[]'::jsonb);
      v_box := array[least(v_box[1], a.bx), least(v_box[2], a."by"), greatest(v_box[3], a.bx + 1), greatest(v_box[4], a."by" + 1)];
      v_via := jsonb_build_object('via', a.id,
        'along', (select count(*)::int from bridge_span sp where sp.world_id = p_world and sp.bridge = a.id));
      -- A fountain keeps what it is given, and that is the end of it.
      if exists (select 1 from placed q where q.world_id = p_world and q.kind = 'furniture' and q.sub = 'fountain'
                   and q.x = a.bx and q.y = a."by") then
        v_streams := v_streams || jsonb_build_array(jsonb_build_object('from', k, 'path', '[]'::jsonb, 'to', 'lost')
                                  || v_via || jsonb_build_object('fountain', true));
        exit;
      end if;
      v_c := spring_corner(p_world, a.bx, a."by");
      v_slab := slab_at(p_world, a.bx, a."by");
      v_pool := v_slab.id is not null and v_slab.pool;
      v_cont := case when v_slab.id is not null then settle_chain(p_world, v_c[1], v_c[2], a.bx, a."by", false, not v_pool)
                     else settle_chain(p_world, v_c[1], v_c[2], null, null, true) end;
      if v_cont ? 'refused' then
        v_streams := v_streams || jsonb_build_array(jsonb_build_object('from', k, 'path', '[]'::jsonb, 'to', 'lost') || v_via);
        exit;
      end if;
      v_off := jsonb_array_length(v_ponds);
      for e in select t.q from jsonb_array_elements(v_cont->'ponds') with ordinality t(q, i) order by t.i loop
        v_ponds := v_ponds || jsonb_build_array(case when jsonb_array_length(e.q->'wet') > 0
                                                     then e.q || jsonb_build_object('volume', pond_volume(p_world, e.q)) else e.q end);
      end loop;
      if v_pool then
        v_streams := v_streams || jsonb_build_array(jsonb_build_object('from', k, 'path', '[]'::jsonb, 'to', v_off) || v_via);
      end if;
      for e in select t.s from jsonb_array_elements(v_cont->'streams') with ordinality t(s, i) order by t.i loop
        v_streams := v_streams || jsonb_build_array(
          jsonb_build_object('from', case when (e.s->>'from')::int < 0 then k else (e.s->>'from')::int + v_off end,
                             'path', e.s->'path',
                             'to', case when jsonb_typeof(e.s->'to') = 'number' then to_jsonb((e.s->>'to')::int + v_off) else e.s->'to' end)
          || case when (e.s->>'from')::int < 0 then v_via else '{}'::jsonb end);
      end loop;
      v_box := array[least(v_box[1], (v_cont->'box'->>0)::int), least(v_box[2], (v_cont->'box'->>1)::int),
                     greatest(v_box[3], (v_cont->'box'->>2)::int), greatest(v_box[4], (v_cont->'box'->>3)::int)];
    end if;
    k := k + 1;
  end loop;
  return jsonb_build_object('ponds', v_ponds, 'streams', v_streams, 'box', to_jsonb(v_box));
end $fn$;

/*
 * The fountains a spring's water keeps, before its streams change: settled on
 * the rate they had (`well_settle`), so the litres they found are counted at
 * that rate up to now and the new one starts from here. Then its rows go.
 */
create or replace function aqueduct_unfeed(p_world uuid, p_spring bigint) returns void
  language plpgsql as $$
begin
  perform well_settle(q.id) from placed q
   where q.world_id = p_world and q.kind = 'furniture' and q.sub = 'fountain'
     and exists (select 1 from aqueduct_feed f where f.spring_id = p_spring and f.fountain and f.x = q.x and f.y = q.y);
  delete from aqueduct_feed where spring_id = p_spring;
end $$;

/*
 * Settle one spring on the ground as it is now, and keep what its water does:
 * as it was, through `settle_water`, with a pond an aqueduct fills rising at
 * the channel's flow, water taking the length of a channel to run along it,
 * and which aqueducts it runs along written down (`aqueduct_feed`).
 */
create or replace function settle_spring(p_world uuid, p_id bigint) returns void
  language plpgsql as $$
declare s spring; v_chain jsonb; v_ponds jsonb := '[]'::jsonb; v_pond jsonb; i int := 0;
        v_old int; v_from int; v_since timestamptz; v_ready timestamptz := now(); v_full timestamptz; v_run jsonb;
        v_size int; v_rate double precision;
begin
  select * into s from spring where world_id = p_world and id = p_id for update;
  if not found then return; end if;
  v_chain := settle_water(p_world, s.cx, s.cy, s.x, s.y);
  if v_chain ? 'refused' then
    perform aqueduct_unfeed(p_world, s.id);
    delete from spring where id = s.id;
    return;
  end if;
  for v_pond in select value from jsonb_array_elements(v_chain->'ponds') loop
    -- A hollow an aqueduct fills stands at whatever any spring's water there stood at, as the browser has it (`fillings`).
    select max(t.level) into v_old from spring_tile t, pond_corners(v_pond) c
      where t.world_id = p_world and (t.spring_id = s.id or v_pond ? 'volume') and t.x = c.x and t.y = c.y;
    v_from := coalesce(v_old, (v_pond->>'floor')::int);
    v_since := case when v_old is not null then now() else greatest(now(), v_ready) end;
    -- A pond an aqueduct fills rises from its floor to its level in the time its litres take at the channel's flow (`pondRate`).
    v_rate := case when v_pond ? 'volume'
                   then ((v_pond->>'level')::int - (v_pond->>'floor')::int) / ((v_pond->>'volume')::double precision / aqueduct_lps())
                   else fill_rate() end;
    v_full := v_since + make_interval(secs => abs((v_pond->>'level')::int - v_from) / v_rate);
    select st into v_run from jsonb_array_elements(v_chain->'streams') st where (st->>'from')::int = i limit 1;
    v_ready := v_full + make_interval(secs => (coalesce((v_run->>'along')::int, 0) + coalesce(jsonb_array_length(v_run->'path') / 2, 0))
                                              / run_rate());
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
  -- The fountains it kept and keeps now, on their old rate up to here; then which aqueducts it runs along.
  perform well_settle(q.id) from placed q
   where q.world_id = p_world and q.kind = 'furniture' and q.sub = 'fountain'
     and exists (select 1 from jsonb_array_elements(v_chain->'streams') st join bridge b on b.world_id = p_world and b.id = (st->>'via')::bigint
                  where coalesce((st->>'fountain')::boolean, false) and b.bx = q.x and b.by = q.y);
  perform aqueduct_unfeed(p_world, s.id);
  insert into aqueduct_feed (world_id, spring_id, bridge_id, x, y, fountain)
  select p_world, s.id, b.id, b.bx, b.by, coalesce((st->>'fountain')::boolean, false)
    from jsonb_array_elements(v_chain->'streams') st
    join bridge b on b.world_id = p_world and b.id = (st->>'via')::bigint
   where st ? 'via'
  on conflict do nothing;
  update spring set chain = jsonb_set(v_chain, '{ponds}', v_ponds),
         lo_x = (v_chain->'box'->>0)::int, lo_y = (v_chain->'box'->>1)::int,
         hi_x = (v_chain->'box'->>2)::int, hi_y = (v_chain->'box'->>3)::int,
         ver = ver + 1
   where id = s.id;
end $$;

/*
 * How much is in a well now: as it was, and a fountain an aqueduct pours into
 * takes the channel's litres a second on top of its own (`AQUEDUCT_LPS`).
 */
create or replace function placed_litres(p placed) returns double precision
  language sql stable as $$
  select case when not is_well(p) then p.litres
              else least(liquid_capacity(p),
                         p.litres + (well_rate(p.ql)
                                     + case when p.sub = 'fountain'
                                             and exists (select 1 from aqueduct_feed f where f.world_id = p.world_id
                                                           and f.x = p.x and f.y = p.y and f.fountain)
                                            then aqueduct_lps() else 0 end)
                                    * extract(epoch from (now() - p.since))) end
$$;


/*
 * What is said when a spring is dug (`springSays`): where an aqueduct takes its
 * water, how deep its pond stands and the aqueduct it goes along instead of
 * over the lip, by the tile it draws from (`aqueductSpringSays`); otherwise
 * as it ever was (`spring_says`).
 */
create or replace function aqueduct_spring_says(p_world uuid, p_chain jsonb) returns text
  language plpgsql stable as $fn$
declare v_st jsonb; b bridge; k int; v_first jsonb; v_go text; v_more text; v_stand text;
begin
  select t.st into v_st from jsonb_array_elements(p_chain->'streams') with ordinality t(st, i) where t.st ? 'via' order by t.i limit 1;
  if v_st is null then return spring_says(p_chain); end if;
  select * into b from bridge where world_id = p_world and id = (v_st->>'via')::bigint;
  if not found then return spring_says(p_chain); end if;
  k := (v_st->>'from')::int;
  v_first := p_chain->'ponds'->0;
  v_go := 'along the aqueduct from ' || b.ax || ', ' || b.ay || ', ' || aqueduct_flow() || ' litres a minute';
  v_more := k || ' more pond' || case when k = 1 then '' else 's' end || ' below it, and from the last of those';
  if v_first ? 'tiles' then
    return case when k > 0 then 'Water wells up in the pool. It runs down into ' || v_more || ' ' || v_go || '.'
                else 'Water wells up in the pool. It goes ' || v_go || ', instead of over its edge.' end;
  end if;
  v_stand := 'Water wells up at the bottom of the hollow. It will stand '
    || to_char(((v_first->>'level')::int - (v_first->>'floor')::int) / 10.0, 'FM990.0') || ' m deep over '
    || jsonb_array_length(v_first->'wet') / 2 || ' corners';
  return case when k > 0 then v_stand || ', then spill over the lowest point of its rim and run down into ' || v_more || ' ' || v_go || '.'
              else v_stand || ', then go ' || v_go || ', instead of over its rim.' end;
end $fn$;

-- Stopping a spring up: the fountains its water kept settled on the rate they had, then as before.
create or replace function perform_spring(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
  language plpgsql as $$
declare tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int; v_c int[]; v_id bigint; v_tool bigint;
        v_chain jsonb; v_s bigint;
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
    perform tell(p_world, p_uid, aqueduct_spring_says(p_world, v_chain), 'event');
  else
    for v_s in select id from spring where world_id = p_world and x = tx and y = ty loop
      perform aqueduct_unfeed(p_world, v_s);
    end loop;
    delete from spring where world_id = p_world and x = tx and y = ty;
    perform tell(p_world, p_uid, 'You pack the spring shut. Its water sinks away, and the ponds it kept go dry.', 'event');
  end if;
end $$;

/* ---- Setting one out ------------------------------------------------------------------------ */

-- A fill said as a stretch of time: to the second under a minute and a half, to the minute from there (`fillWords`).
create or replace function fill_words(p_secs double precision) returns text
  language sql immutable as $$
  select case when q.s < 90 then q.s || ' second' || case when q.s = 1 then '' else 's' end
              when q.m / 60 > 0 then (q.m / 60) || ' hour' || case when q.m / 60 = 1 then '' else 's' end
                   || case when q.m % 60 > 0 then ' and ' || (q.m % 60) || ' minute' || case when q.m % 60 = 1 then '' else 's' end
                           else '' end
              else (q.m % 60) || ' minute' || case when q.m % 60 = 1 then '' else 's' end end
  from (select floor(p_secs + 0.5)::bigint as s, floor(p_secs / 60 + 0.5)::bigint as m) q
$$;

/*
 * The aqueduct already drawing from the water at a tile, set out or built, the
 * first by id (`drawsAlready`): one whose head is in the same pool -- every
 * pool joined to it -- or in the same spring's pond.
 */
create or replace function aqueduct_draws(p_world uuid, p_sx int, p_sy int, p_head text) returns bigint
  language plpgsql stable as $fn$
declare v_c int[]; v_r jsonb;
begin
  if not exists (select 1 from bridge b where b.world_id = p_world and b.kind = 'aqueduct') then return null; end if;
  if p_head = 'pool' then
    v_c := spring_corner(p_world, p_sx, p_sy);
    v_r := settle_chain(p_world, v_c[1], v_c[2], p_sx, p_sy);
    if v_r ? 'refused' then return null; end if;
    return (select b.id from bridge b where b.world_id = p_world and b.kind = 'aqueduct' and pond_covers(v_r->'ponds'->0, b.ax, b.ay)
             order by b.id limit 1);
  end if;
  return (select b.id from bridge b where b.world_id = p_world and b.kind = 'aqueduct'
            and exists (select 1 from spring_tile t join spring_tile o on o.world_id = t.world_id and o.spring_id = t.spring_id and o.pond = t.pond
                         where t.world_id = p_world and t.x = p_sx and t.y = p_sy and o.x = b.ax and o.y = b.ay)
           order by b.id limit 1);
end $fn$;

/*
 * Whether an aqueduct may be led from the water in one tile to the basin in
 * another (`aqueductPlan`, in the same order and the same words): the plan --
 * its channel's height, what is at each end, and where the water at its foot
 * stands or will -- or `{"refused": why}`.
 */
create or replace function aqueduct_plan(p_world uuid, p_uid uuid, p_sx int, p_sy int, p_tx int, p_ty int)
  returns jsonb language plpgsql stable as $fn$
declare n int; v_name text; v_head text; v_top int; v_foot text; v_level int; hs foundation; fs foundation;
        v_c int[]; v_r jsonb; r record; e record; ob bridge;
begin
  if not in_bounds(p_world, p_sx, p_sy) or not in_bounds(p_world, p_tx, p_ty) then
    return jsonb_build_object('refused', 'Not there.');
  end if;
  if (p_sx <> p_tx and p_sy <> p_ty) or (p_sx = p_tx and p_sy = p_ty) then
    return jsonb_build_object('refused', 'An aqueduct runs straight: its head due north, south, east or west of the tile it pours into.');
  end if;
  select count(*)::int into n from span_tiles(p_sx, p_sy, p_tx, p_ty);
  if n = 0 then
    return jsonb_build_object('refused', 'That water is right beside it: there is nothing for an aqueduct to carry it over.');
  end if;
  if n > (select d.span from bridge_def d where d.id = 'aqueduct') then
    return jsonb_build_object('refused', 'An aqueduct spans ' || (select d.span from bridge_def d where d.id = 'aqueduct')
      || ' tiles; that is ' || n || '.');
  end if;
  for e in select * from (values (1, p_sx, p_sy), (2, p_tx, p_ty)) v(o, x, y) order by o loop
    select dd.name into v_name from deed_covering(p_world, e.x, e.y) dd where not may_shape(p_world, p_uid, e.x, e.y) limit 1;
    if v_name is not null then
      return jsonb_build_object('refused', 'That is part of ' || v_name || '. Only its builders may lead water from it or to it.');
    end if;
  end loop;
  -- The head: a pool, or a spring's pond.
  hs := slab_at(p_world, p_sx, p_sy);
  if hs.id is not null and hs.pool then
    v_head := 'pool'; v_top := hs.top - pool_lip();
  elsif exists (select 1 from spring_tile t where t.world_id = p_world and t.x = p_sx and t.y = p_sy) then
    v_head := 'pond';
    select max(t.level) into v_top from spring_tile t where t.world_id = p_world and t.x = p_sx and t.y = p_sy;
  elsif least(land_height(p_world, p_sx, p_sy), land_height(p_world, p_sx + 1, p_sy),
              land_height(p_world, p_sx + 1, p_sy + 1), land_height(p_world, p_sx, p_sy + 1)) < 0 then
    return jsonb_build_object('refused', 'The sea is below everything: an aqueduct carries a spring''s water, from a pond or a pool.');
  else
    return jsonb_build_object('refused', 'There is no pond or pool there for an aqueduct to draw from.');
  end if;
  -- The foot: a pool, a fountain, a pond, or a hollow that would hold one.
  fs := slab_at(p_world, p_tx, p_ty);
  if fs.id is not null and not fs.pool then
    return jsonb_build_object('refused', 'Dig a pool in the foundation first: the water would run straight off its top.');
  end if;
  if fs.id is not null then
    v_foot := 'pool'; v_level := fs.top - pool_lip();
  elsif exists (select 1 from placed q where q.world_id = p_world and q.kind = 'furniture' and q.sub = 'fountain'
                  and q.x = p_tx and q.y = p_ty) then
    -- To the nearest unit, as a pond's and a pool's water stand.
    v_foot := 'fountain'; v_level := floor(surface_height(p_world, p_tx, p_ty) + fountain_rim() + 0.5)::int;
  elsif exists (select 1 from spring_tile t where t.world_id = p_world and t.x = p_tx and t.y = p_ty) then
    v_foot := 'pond';
    select max(t.level) into v_level from spring_tile t where t.world_id = p_world and t.x = p_tx and t.y = p_ty;
  elsif least(land_height(p_world, p_tx, p_ty), land_height(p_world, p_tx + 1, p_ty),
              land_height(p_world, p_tx + 1, p_ty + 1), land_height(p_world, p_tx, p_ty + 1)) < 0 then
    return jsonb_build_object('refused', 'An aqueduct pours into a pool, a pond, a fountain or a hollow, not the sea.');
  else
    v_c := spring_corner(p_world, p_tx, p_ty);
    v_r := settle_chain(p_world, v_c[1], v_c[2]);
    if v_r->>'refused' = 'wide' then
      return jsonb_build_object('refused', 'That hollow is too wide ever to fill: a pond spreads over ' || pond_most() || ' corners at most.');
    end if;
    if v_r ? 'refused' then
      return jsonb_build_object('refused', 'Water poured here would run straight off downhill: the foot of an aqueduct wants a pool, a pond, a fountain, or a hollow that holds '
        || to_char(spring_depth() / 10.0, 'FM990.0') || ' m of water or more.');
    end if;
    v_foot := 'hollow'; v_level := (v_r->'ponds'->0->>'level')::int;
  end if;
  -- Not the water it draws from: one pool, or one pond, under both ends.
  if v_head = 'pool' and v_foot = 'pool' then
    v_c := spring_corner(p_world, p_sx, p_sy);
    v_r := settle_chain(p_world, v_c[1], v_c[2], p_sx, p_sy);
    if not (v_r ? 'refused') and pond_covers(v_r->'ponds'->0, p_tx, p_ty) then
      return jsonb_build_object('refused', 'That is the water it would draw from.');
    end if;
  end if;
  if v_head = 'pond' and v_foot = 'pond'
     and exists (select 1 from spring_tile a join spring_tile b on b.world_id = a.world_id and b.spring_id = a.spring_id and b.pond = a.pond
                  where a.world_id = p_world and a.x = p_sx and a.y = p_sy and b.x = p_tx and b.y = p_ty) then
    return jsonb_build_object('refused', 'That is the water it would draw from.');
  end if;
  -- Not the line of one there already.
  if exists (select 1 from bridge b where b.world_id = p_world and b.kind = 'aqueduct'
              and b.ax = p_sx and b.ay = p_sy and b.bx = p_tx and b.by = p_ty) then
    return jsonb_build_object('refused', 'An aqueduct already runs from there to here.');
  end if;
  -- Not water another aqueduct draws from already: the first of them takes all of it.
  select b.* into ob from bridge b where b.world_id = p_world and b.id = aqueduct_draws(p_world, p_sx, p_sy, v_head);
  if ob.id is not null then
    return jsonb_build_object('refused', 'The aqueduct from ' || ob.ax || ', ' || ob.ay || ' draws from that water already.');
  end if;
  if v_level > v_top then
    return jsonb_build_object('refused', 'The water there stands at ' || v_level || ', over the ' || v_top
      || ' its head stands at: water only runs downhill.');
  end if;
  if bridge_at(p_world, p_sx, p_sy) is not null or bridge_at(p_world, p_tx, p_ty) is not null then
    return jsonb_build_object('refused', 'A bridge is carried over one end of it already.');
  end if;
  for r in select * from span_tiles(p_sx, p_sy, p_tx, p_ty) order by n loop
    if bridge_at(p_world, r.x, r.y) is not null then return jsonb_build_object('refused', 'Something is already bridged across there.'); end if;
    if building_at(p_world, r.x, r.y) is not null then return jsonb_build_object('refused', 'Not over a building.'); end if;
    if land_tile(p_world, r.x, r.y) in (tile_id('Tree'), tile_id('Bush')) then
      return jsonb_build_object('refused', 'A ' || case when land_tile(p_world, r.x, r.y) = tile_id('Tree') then 'tree' else 'bush' end
        || ' stands at ' || r.x || ', ' || r.y || ', under where a span would go. Cut it down first.');
    end if;
    if v_top - channel_deep() - surface_height(p_world, r.x, r.y) < clearance() then
      fs := slab_at(p_world, r.x, r.y);
      return jsonb_build_object('refused', case when fs.id is null then 'The ground' when fs.pool then 'The water in the pool' else 'The foundation' end
        || ' at ' || r.x || ', ' || r.y || ' stands within '
        || to_char(clearance() / 10.0, 'FM990.0') || ' m of the channel''s bed: an aqueduct is carried over '
        || case when fs.id is null then 'the ground' when fs.pool then 'the water' else 'a foundation' end || ', not through it.');
    end if;
  end loop;
  return jsonb_build_object('height', v_top, 'head', v_head, 'foot', v_foot, 'level', v_level);
end $fn$;

/*
 * What is said when the last span is laid (`aqueductSays`): where the water
 * goes now, off the first spring by id whose water runs along it, or that none
 * comes.
 */
create or replace function aqueduct_says(p_world uuid, b bridge) returns text
  language plpgsql stable as $fn$
declare v_chain jsonb; v_st jsonb; v_into jsonb; v_foot text;
begin
  select s.chain, st into v_chain, v_st from spring s, jsonb_array_elements(s.chain->'streams') st
   where s.world_id = p_world and st ? 'via' and (st->>'via')::bigint = b.id
   order by s.id limit 1;
  if v_st is null then
    return 'The last span is laid. No spring''s water stands at its head at ' || b.height
      || ' or over, so the channel stays dry until some does.';
  end if;
  v_into := case when jsonb_typeof(v_st->'to') = 'number' then v_chain->'ponds'->((v_st->>'to')::int) end;
  v_foot := case
    when coalesce((v_st->>'fountain')::boolean, false) then 'It keeps the fountain at its foot full.'
    when exists (select 1 from foundation f where f.world_id = p_world and f.x = b.bx and f.y = b."by" and bill_done(f.needed) and not f.pool)
      then 'It pours onto the foundation at its foot and runs off its lowest edge.'
    when v_into ? 'tiles' and v_into ? 'spill' then 'The pool at its foot is full already, and spills over its lowest edge.'
    when v_into ? 'tiles' then 'The pool at its foot is full already, and nothing beside it is lower: it keeps the water.'
    -- Standing at its level already: another spring's pond, or this one's own water there before.
    when v_into ? 'volume' and (v_into->>'from')::int >= (v_into->>'level')::int
      then 'The pond at its foot is full already, and spills over its lip.'
    when v_into ? 'volume' then 'It fills the hollow it runs into to ' || (v_into->>'level') || ' in '
      || fill_words((v_into->>'volume')::double precision / aqueduct_lps()) || ', and then spills over its lip and runs on.'
    else 'It pours out onto the ground at its foot and runs away downhill.' end;
  return 'The last span is laid and water runs along the channel, ' || aqueduct_flow()
    || ' litres a minute, out of its head instead of over that water''s lip. ' || v_foot;
end $fn$;

/*
 * An aqueduct finished, taken down or its foot changed: every spring whose
 * water reaches either end of it settled again, once each, as the browser
 * settles each spring it has marked once at the end of a turn
 * (`Springs.channelChanged`). Twice, a pond it has just started to fill would
 * be taken for one that was already there.
 */
create or replace function aqueduct_touch(p_world uuid, p_ax int, p_ay int, p_bx int, p_by int) returns void
  language plpgsql as $$
declare v_id bigint;
begin
  for v_id in select id from spring
      where world_id = p_world
        and ((lo_x <= p_ax + 1 and p_ax <= hi_x and lo_y <= p_ay + 1 and p_ay <= hi_y)
          or (lo_x <= p_bx + 1 and p_bx <= hi_x and lo_y <= p_by + 1 and p_by <= hi_y))
      order by id loop
    perform settle_spring(p_world, v_id);
  end loop;
end $$;

/* ---- The doors ------------------------------------------------------------------------------ */

create or replace function aqueduct_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('plan_aqueduct', 'build_aqueduct', 'demolish_aqueduct')
$$;

/*
 * Every job that is an aqueduct's: its own three, "Throw a bridge across" asked
 * to throw one (which it will not), and a bridge's work or pulling down aimed
 * at one -- so an aqueduct is only ever worked as an aqueduct.
 */
create or replace function aqueduct_aimed(p_world uuid, p_action text, p_target jsonb) returns boolean
  language sql stable as $$
  select aqueduct_action(p_action)
      or (p_action = 'plan_bridge' and p_target->>'material' = 'aqueduct')
      or (p_action in ('build_bridge', 'demolish_bridge') and p_target->>'kind' = 'bridge'
          and exists (select 1 from bridge b where b.world_id = p_world and b.id = (p_target->>'id')::bigint and b.kind = 'aqueduct'))
$$;

create or replace function aqueduct_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
  language plpgsql stable as $fn$
declare p player; b bridge; s bridge_span; v_short text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_action = 'plan_bridge' then
    return 'An aqueduct is set out from the pool, pond, fountain or hollow it pours into, not thrown from a bank.';
  end if;
  if p_action = 'plan_aqueduct' then
    if p_target->>'kind' is distinct from 'tile' then return 'Choose where it pours.'; end if;
    if jsonb_typeof(p_target->'head') is distinct from 'array' then return 'Choose the water it draws from.'; end if;
    if not in_reach(p.x, p.y, p_target, false, (select d.range from action_def d where d.id = 'plan_aqueduct')) then
      return 'You are too far away from that.';
    end if;
    return aqueduct_plan(p_world, p_uid, (p_target->'head'->>0)::int, (p_target->'head'->>1)::int,
                         (p_target->>'x')::int, (p_target->>'y')::int)->>'refused';
  end if;
  select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint and kind = 'aqueduct';
  if not found then return 'It is gone.'; end if;
  if p_action in ('build_aqueduct', 'build_bridge') then
    select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
      and not span_done(sp.needed) order by sp.n limit 1;
    if not found then return 'It is finished.'; end if;
    if tool_ql(p_world, p_uid, 'trowel') <= 0 then
      return 'You need a ' || lower((select coalesce(name, 'trowel') from item_def where id = 'trowel')) || '.';
    end if;
    if sqrt((s.x + 0.5 - p.x) ^ 2 + (s.y + 0.5 - p.y) ^ 2) > 4.5 then
      return 'Work from one end. Walk to the open part of the span.';
    end if;
    select e.key into v_short from jsonb_each(s.needed) e
      where (e.value)::int > 0 and pack_count(p_world, p_uid, e.key) < 1 order by e.key limit 1;
    if v_short is not null then
      return 'That span wants ' || span_wants(s.needed) || '; you are carrying no '
        || lower((select coalesce(name, v_short) from item_def where id = v_short)) || '.';
    end if;
    return null;
  end if;
  if sqrt((b.ax + 0.5 - p.x) ^ 2 + (b.ay + 0.5 - p.y) ^ 2) > 4.5
     and sqrt((b.bx + 0.5 - p.x) ^ 2 + (b."by" + 0.5 - p.y) ^ 2) > 4.5 then
    return 'Stand at one end of it.';
  end if;
  return null;
end $fn$;

create or replace function perform_aqueduct(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
  language plpgsql as $fn$
declare b bridge; s bridge_span; v_plan jsonb; v_id bigint; v_n int; v_want text; v_left int; e record;
        v_half int; v_parts text[] := '{}'; v_ran boolean; v_sx int; v_sy int; v_tx int; v_ty int;
begin
  if p_action = 'plan_bridge' then return; end if;
  if p_action = 'plan_aqueduct' then
    v_sx := (p_target->'head'->>0)::int; v_sy := (p_target->'head'->>1)::int;
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_plan := aqueduct_plan(p_world, p_uid, v_sx, v_sy, v_tx, v_ty);
    if v_plan ? 'refused' then return; end if;
    insert into bridge (world_id, kind, ax, ay, bx, by, height, material, made_by)
    values (p_world, 'aqueduct', v_sx, v_sy, v_tx, v_ty, (v_plan->>'height')::int, null, p_uid)
    returning id into v_id;
    insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select p_world, v_id, t.n, t.x, t.y, span_bill('aqueduct'), span_bill('aqueduct') from span_tiles(v_sx, v_sy, v_tx, v_ty) t;
    select count(*)::int into v_n from bridge_span sp where sp.world_id = p_world and sp.bridge = v_id;
    -- Its piers stand on the edges between its tiles from now, and no pool's water goes over one (`aqueduct_shuts`).
    perform aqueduct_touch(p_world, v_sx, v_sy, v_tx, v_ty);
    perform skill_raise(p_world, p_uid, 'masonry', 0.4);
    perform tell(p_world, p_uid, 'You set out an aqueduct of ' || v_n || ' span' || case when v_n > 1 then 's' else '' end
      || ' from the ' || (v_plan->>'head') || ' to the ' || (v_plan->>'foot') || ', its channel at ' || (v_plan->>'height')
      || '. Each span wants ' || span_wants(span_bill('aqueduct')) || '. ' || (select d.note from bridge_def d where d.id = 'aqueduct'),
      'system');
    return;
  end if;
  select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint and kind = 'aqueduct';
  if not found then return; end if;
  if p_action in ('build_aqueduct', 'build_bridge') then
    select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
      and not span_done(sp.needed) order by sp.n limit 1;
    if not found then return; end if;
    -- One unit of one thing a go, as with a bridge: the first by name that is carried.
    select e2.key into v_want from jsonb_each(s.needed) e2
      where (e2.value)::int > 0 and pack_count(p_world, p_uid, e2.key) > 0 order by e2.key limit 1;
    if v_want is null then return; end if;
    if not consume(p_world, p_uid, v_want, 1) then return; end if;
    update bridge_span sp set needed = jsonb_set(sp.needed, array[v_want], to_jsonb(greatest(0, (sp.needed->>v_want)::int - 1)))
      where sp.world_id = p_world and sp.bridge = b.id and sp.n = s.n
      returning * into s;
    perform skill_raise(p_world, p_uid, 'masonry', 0.5);
    perform wear_tool((select i.id from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = 'trowel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1), 0.4);
    if not span_done(s.needed) then
      perform tell(p_world, p_uid, 'You work a ' || lower((select coalesce(name, v_want) from item_def where id = v_want))
        || ' into the span. It still wants ' || span_wants(s.needed) || '.', 'event');
      return;
    end if;
    v_left := bridge_left(p_world, b.id);
    if v_left > 0 then
      perform tell(p_world, p_uid, 'That span is laid. ' || v_left || ' still open.', 'event');
      return;
    end if;
    -- Finished: the springs whose water reaches either end are settled again now, so what is said is what happens.
    perform aqueduct_touch(p_world, b.ax, b.ay, b.bx, b."by");
    perform tell(p_world, p_uid, aqueduct_says(p_world, b), 'system');
    return;
  end if;
  -- Pulling it down: half of what went into it back, as with a bridge, and the springs that ran along it settled again.
  v_ran := bridge_left(p_world, b.id) = 0
           and exists (select 1 from aqueduct_feed f where f.world_id = p_world and f.bridge_id = b.id);
  for e in
    select k.key as item, sum((k.value)::int - coalesce((sp.needed->>k.key)::int, 0))::int as used
    from bridge_span sp cross join lateral jsonb_each(sp.total) k
    where sp.world_id = p_world and sp.bridge = b.id
    group by k.key order by k.key
  loop
    v_half := floor(e.used / 2.0)::int;
    if v_half > 0 then
      perform give(p_world, p_uid, e.item, v_half, 20);
      v_parts := v_parts || (v_half || ' ' || lower((select coalesce(name, e.item) from item_def where id = e.item)));
    end if;
  end loop;
  delete from bridge_span where world_id = p_world and bridge = b.id;
  delete from bridge where world_id = p_world and id = b.id;
  perform aqueduct_touch(p_world, b.ax, b.ay, b.bx, b."by");
  perform tell(p_world, p_uid,
    case when array_length(v_parts, 1) > 0 then 'You take the aqueduct down and save ' || array_to_string(v_parts, ', ') || '.'
         else 'You take the aqueduct down.' end
    || case when v_ran then ' The water at its head goes over its own lip again.' else '' end, 'event');
end $fn$;

/*
 * A fountain set down where an aqueduct pours, or taken away from there: the
 * springs whose water comes along it are settled again, so it keeps the water
 * or the water runs away downhill. Not while the island itself is going.
 */
create or replace function aqueduct_fountain_trigger() returns trigger language plpgsql as $fn$
declare v_world uuid; v_x int; v_y int;
begin
  if tg_op = 'DELETE' then v_world := old.world_id; v_x := old.x; v_y := old.y;
  else v_world := new.world_id; v_x := new.x; v_y := new.y; end if;
  if exists (select 1 from bridge b where b.world_id = v_world and b.kind = 'aqueduct' and b.bx = v_x and b.by = v_y)
     and exists (select 1 from world w where w.id = v_world) then
    perform spring_touch_tile(v_world, v_x, v_y);
  end if;
  return null;
end $fn$;
drop trigger if exists aqueduct_fountain_set on placed;
create trigger aqueduct_fountain_set after insert on placed
  for each row when (new.sub = 'fountain') execute function aqueduct_fountain_trigger();
drop trigger if exists aqueduct_fountain_gone on placed;
create trigger aqueduct_fountain_gone after delete on placed
  for each row when (old.sub = 'fountain') execute function aqueduct_fountain_trigger();



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
  -- Shop counters and lantern posts (`counters.ts`, `lamps.ts`), and a lantern post lifted with its lantern in it.
  if counter_action(p_action) then return counter_refusal(p_world, p_uid, p_action, p_target); end if;
  if lamp_action(p_action) then return lamp_refusal(p_world, p_uid, p_action, p_target); end if;
  if lamp_lift_refusal(p_world, p_uid, p_action, p_target) is not null then return lamp_lift_refusal(p_world, p_uid, p_action, p_target); end if;
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- A spring answers for its own reach, its own tool and whose spring it is.
  if spring_action(p_action) then
    return spring_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- An aqueduct answers for its own reach and both its ends, and for a bridge's job aimed at one.
  if aqueduct_aimed(p_world, p_action, p_target) then
    return aqueduct_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- And wildflowers for their own reach, their season and whether they are picked.
  if flower_action(p_action) then
    return flower_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Ivy and moss answer for their own reach: a statue and a bridge are not tiles.
  if green_action(p_action) then
    return green_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Stepping stones and water plants answer for their own reach, as a spring does.
  if water_garden_action(p_action) then
    return water_garden_refusal(p_world, p_uid, p_action, p_target);
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
    -- Nothing is planted under an aqueduct's arches: a tree would grow up through them.
    if p_action = 'plant' and aqueduct_over(p_world, (p_target->>'x')::int, (p_target->>'y')::int) then return 'An aqueduct is carried over that tile.'; end if;
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
    -- Piers: not under a building, a tile on piers among them, as the browser has it (`cornerUnderBuilding`).
    aimed := corner_under_building(p_world, cx, cy);
    if aimed is not null then return aimed; end if;
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
  -- Shop counters and lantern posts (`counters.ts`, `lamps.ts`).
  if counter_action(p_action) then perform perform_counter(p_world, p_uid, p_action, p_target); return; end if;
  if lamp_action(p_action) then perform perform_lamp(p_world, p_uid, p_action, p_target); return; end if;
  if spring_action(p_action) then
    perform perform_spring(p_world, p_uid, p_action, p_target);
    return;
  end if;
  -- An aqueduct's jobs, and a bridge's aimed at one (`aqueduct_aimed`).
  if aqueduct_aimed(p_world, p_action, p_target) then
    perform perform_aqueduct(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if flower_action(p_action) then
    perform perform_flowers(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if green_action(p_action) then
    perform perform_green(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if water_garden_action(p_action) then
    perform perform_water_garden(p_world, p_uid, p_action, p_target);
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
      or aqueduct_action(p_action)
      or flower_action(p_action)
      or green_action(p_action)
      or water_garden_action(p_action)
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
      -- Shop counters and lantern posts.
      or counter_action(p_action) or lamp_action(p_action)
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work', 'dig_tile', 'pan')
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
    /*
     * On stepping stones the feet are dry however deep the water beside them
     * is (`Player.update`). Asked only of a body already out of its depth,
     * which is nobody on dry ground: one read of the tile under it, and the
     * move and the standing checks ask nothing else of stones.
     */
    when land_tile(p_world, floor(p.x)::int, floor(p.y)::int) = tile_id('Stepping stones') then false
    -- A hull, a cart bed or a saddle: something else is holding you up.
    when exists (select 1 from placed q where q.world_id = p_world and q.driver = p_uid) then false
    -- A passenger stands on a deck.
    when p.aboard is not null then false
    when exists (select 1 from creature c where c.world_id = p_world and c.rider = p_uid) then false
    -- Piers: on the finished deck of a tile on piers, whatever is under it (`deck_surface`).
    when deck_surface(p_world, floor(p.x)::int, floor(p.y)::int) is not null then false
    -- A bridge's deck holds you up; an aqueduct's is water, and under it is the open water it stands in.
    else coalesce((select b.kind = 'aqueduct' from bridge b
                    where b.world_id = p_world and b.id = bridge_at(p_world, floor(p.x)::int, floor(p.y)::int)), true)
  end
  from player p where p.world_id = p_world and p.uid = p_uid
$function$;


/* ---- What goes on under one ------------------------------------------------------------------- */

/*
 * The bridge whose deck is walked over a tile, or null (`Game.deckAt`): as
 * `bridge_at`, but an aqueduct's deck is water and nobody walks it, so the
 * ground under its arches is walked, worn and climbed as it ever was. One
 * more probe, and only where a bridge is found.
 */
create or replace function deck_at(p_world uuid, p_x int, p_y int) returns bigint
  language plpgsql stable as $$
declare v bigint := bridge_at(p_world, p_x, p_y);
begin
  if v is null then return null; end if;
  return case when (select b.kind from bridge b where b.world_id = p_world and b.id = v) = 'aqueduct' then null else v end;
end $$;

-- Whether one of an aqueduct's spans is carried over a tile, which takes no tree, no building, no pour and no pool.
create or replace function aqueduct_over(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select exists (select 1 from bridge_span s join bridge b on b.world_id = s.world_id and b.id = s.bridge
                  where s.world_id = p_world and s.x = p_x and s.y = p_y and b.kind = 'aqueduct')
$$;

/*
 * What is said of a tile a bridge is carried over, where a pour or a pool
 * would go (`Game.carriedOver`): a bridge, or an aqueduct over one of its
 * spans. The tiles an aqueduct draws from and pours into are its basins, and
 * keep nothing off.
 */
create or replace function carried_over(p_world uuid, p_x int, p_y int) returns text
  language sql stable as $$
  select case when b.kind <> 'aqueduct' then 'A bridge is carried over that tile.'
              when aqueduct_over(p_world, p_x, p_y) then 'An aqueduct is carried over that tile.' end
    from bridge b where b.world_id = p_world and b.id = bridge_at(p_world, p_x, p_y)
$$;

/*
 * Whether a step between two neighbouring tiles goes through one of an
 * aqueduct's piers (`Game.pierBetween`): along its run, between two tiles of
 * its line, beside a bay with any of its stone laid. Across its run you go
 * under its arches.
 */
create or replace function aqueduct_pier(p_world uuid, p_x0 int, p_y0 int, p_x1 int, p_y1 int) returns boolean
  language plpgsql stable as $$
declare k int;
begin
  if abs(p_x1 - p_x0) + abs(p_y1 - p_y0) <> 1 then return false; end if;
  for k in 0 .. 1 loop
    if exists (select 1 from bridge_span s join bridge b on b.world_id = s.world_id and b.id = s.bridge
                where s.world_id = p_world and s.x = case k when 0 then p_x0 else p_x1 end and s.y = case k when 0 then p_y0 else p_y1 end
                  and b.kind = 'aqueduct'
                  and case when b.ay = b.by then p_y0 = b.ay and p_y1 = b.ay else p_x0 = b.ax and p_x1 = b.ax end
                  and s.needed is distinct from s.total) then
      return true;
    end if;
  end loop;
  return false;
end $$;

-- Walking under one: its piers stand in the way along its run, and the ground under it is the ground (`deck_at`).
CREATE OR REPLACE FUNCTION public.walk_share(p_world uuid, p_uid uuid, p_level integer, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare far double precision; n int; i int; t double precision;
        cart placed; climbing double precision;
        fx int; fy int; tx int; ty int; climb double precision;
        size int; step int := chunk_size()::int;
        k land_chunk; kx int := -999; ky int := -999;
        here double precision; there double precision; spans boolean; walls int[];
        stand double precision; afloat boolean; beast creature;
        there_tile int; here_tile int; lx0 int[]; ly0 int[]; lx1 int[]; ly1 int[]; lines int := 0; j int;
        v_piers boolean; v_step boolean;  -- Piers
begin
  if p_level <> 0 then return 1; end if;
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return 1; end if;
  -- Piers: and whether it has ever had a tile on piers (`world.piers`), off the same row.
  select w.size, w.piers into size, v_piers from world w where w.id = p_world;
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  -- Asked once for the island rather than once a tile. `bridge_at` is two
  -- index probes and a subquery, and on an island with no bridges on it at all
  -- — which is most of them, most of the time — it was the largest thing left
  -- in this loop once the ground came out of a square.
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  -- The one tile nothing stands on, asked for once. A select per tile against
  -- a table of twenty rows is still a select per tile.
  select coalesce(array_agg(id), '{}') into walls from tile_def where blocks;
  -- An aqueduct's deck is water, and nobody starts a walk on it: the ground under it is the ground (`deck_at`).
  if spans and deck_at(p_world, fx, fy) is not null then return 1; end if;
  -- And the lines its aqueducts run along, read once: a step is asked about their piers only where it is on one of them.
  if spans then
    select array_agg(least(b.ax, b.bx)), array_agg(least(b.ay, b.by)), array_agg(greatest(b.ax, b.bx)), array_agg(greatest(b.ay, b.by))
      into lx0, ly0, lx1, ly1 from bridge b where b.world_id = p_world and b.kind = 'aqueduct';
    lines := coalesce(array_length(lx0, 1), 0);
  end if;

  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  -- Asked once. `driving`, `mount_of` and `skill_of` are all STABLE and this
  -- function writes nothing, so the second ask could only ever return what the
  -- first did -- at the price of another index probe apiece, on the one call a
  -- walking browser makes constantly.
  climbing := skill_of(p_world, p_uid, 'climbing');
  climb := max_step() + climbing * climb_per_level();
  /*
   * The steepest tile a body can stand on, before the step between tiles is
   * asked about at all: sixty between a tile's highest corner and its lowest,
   * and climbing raises it at the rate it raises the step. A rider has the
   * mount's legs under them, so the cap is the mount's, raised the way its
   * step is; wheels get the bare sixty; and a hull floats over whatever the
   * bottom does, so afloat there is no cap. A deck is ground: a bridge over a
   * steep tile is not the tile.
   */
  cart := driving(p_world, p_uid);
  afloat := coalesce(is_boat(cart), false);
  beast := mount_of(p_world, p_uid);
  if beast.id is not null then stand := max_stand() + mount_step(beast) - max_step();
  elsif cart.id is not null then stand := max_stand();
  else stand := max_stand() + climbing * climb_per_level();
  end if;
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if tx < 0 or ty < 0 or tx >= size or ty >= size then return (i - 1)::double precision / n; end if;
      -- An aqueduct's piers stand between its tiles, along its run (`aqueduct_pier`).
      for j in 1 .. lines loop
        if greatest(fx, tx) >= lx0[j] and least(fx, tx) <= lx1[j] and greatest(fy, ty) >= ly0[j] and least(fy, ty) <= ly1[j] then
          if aqueduct_pier(p_world, fx, fy, tx, ty) then return (i - 1)::double precision / n; end if;
        end if;
      end loop;
      if tx / step <> kx or ty / step <> ky then
        kx := tx / step; ky := ty / step;
        k := land_chunk_get(p_world, kx, ky);
      end if;
      -- A square built from an island with rows missing can be short; the
      -- scanlines are the truth, so fall back to them rather than reading off
      -- the end of a cache.
      if k.tiles is null or length(k.tiles) <= (ty - ky * step) * step + (tx - kx * step) then
        if not passable(p_world, tx, ty) then return (i - 1)::double precision / n; end if;
        there_tile := land_tile(p_world, tx, ty);
      else
        there_tile := get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step));
        if there_tile = any (walls) then return (i - 1)::double precision / n; end if;
      end if;
      -- A flight of garden steps is climbed, not driven: no wheel takes one.
      if cart.id is not null and not afloat and there_tile = steps_tile() then
        return (i - 1)::double precision / n;
      end if;
      -- And what the tile being left is, the first time it is asked: a flight
      -- carries you on or off it without the step between centres.
      if here_tile is null then
        here_tile := case when fx / step = kx and fy / step = ky and k.tiles is not null
                               and length(k.tiles) > (fy - ky * step) * step + (fx - kx * step)
                          then get_byte(k.tiles, (fy - ky * step) * step + (fx - kx * step))
                          else land_tile(p_world, fx, fy) end;
      end if;
      -- Piers: a tile on piers is its deck, walked at the deck's height; nothing goes under one (`pier_step`).
      -- A bridge is walked as it always was, and lands on a deck as on a bank. An aqueduct's is no deck (`deck_at`).
      if v_piers and (not spans or (deck_at(p_world, tx, ty) is null and deck_at(p_world, fx, fy) is null)) then
        v_step := pier_step(p_world, fx, fy, tx, ty, climb, stand, there_tile, afloat or cart.id is not null or beast.id is not null);
        if v_step is not null then
          if not v_step then return (i - 1)::double precision / n; end if;
          fx := tx; fy := ty; here_tile := there_tile;
          continue;
        end if;
      end if;
      if not afloat and (not spans or deck_at(p_world, tx, ty) is null) then
        if k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2 then
          if chunk_slope(k, kx, ky, tx, ty, step) > stand_cap(there_tile, stand) then return (i - 1)::double precision / n; end if;
        elsif tile_slope(p_world, tx, ty) > stand_cap(there_tile, stand) then
          return (i - 1)::double precision / n;
        end if;
      end if;
      if there_tile = steps_tile() or here_tile = steps_tile() then
        null;
      elsif abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and fx / step = kx and fy / step = ky
         and k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2
         and (not spans or deck_at(p_world, tx, ty) is null) then
        there := chunk_centre(k, kx, ky, tx, ty, step);
        here := chunk_centre(k, kx, ky, fx, fy, step);
        if abs(there - here) > climb then return (i - 1)::double precision / n; end if;
      elsif abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or deck_at(p_world, tx, ty) is null)
         and abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy)) > climb then
        return (i - 1)::double precision / n;
      end if;
      fx := tx; fy := ty; here_tile := there_tile;
    end if;
  end loop;
  return 1;
end $function$;

-- The climbing a walk teaches, under an aqueduct as anywhere else on the ground.
CREATE OR REPLACE FUNCTION public.walk_climbs(p_world uuid, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS double precision[]
 LANGUAGE plpgsql
 STABLE
AS $function$
declare far double precision; n int; i int; t double precision;
        fx int; fy int; tx int; ty int; spans boolean;
        v_piers boolean;  -- Piers
        steps double precision[] := '{}';
begin
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return steps; end if;
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      -- And a step on or off a flight of garden steps is no climb.
      if abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or deck_at(p_world, tx, ty) is null)
         and land_tile(p_world, tx, ty) <> steps_tile() and land_tile(p_world, fx, fy) <> steps_tile() then
        -- Piers: nor one on or off a deck, which a tile on piers is wherever it is walked. Whether the island
        -- has ever had a tile on piers is read once, at the first climb (`world.piers`); only then is a tile asked.
        if v_piers is null then select w.piers into v_piers from world w where w.id = p_world; end if;  -- Piers
        if not coalesce(v_piers, false) then  -- Piers
          steps := steps || abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy));
        elsif not exists (select 1 from building_tile bt where bt.world_id = p_world and bt.pier  -- Piers
                          and ((bt.x = tx and bt.y = ty) or (bt.x = fx and bt.y = fy))) then
          steps := steps || abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy));
        end if;  -- Piers
      end if;
      fx := tx; fy := ty;
    end if;
  end loop;
  return steps;
end $function$;

-- And the wear its feet put on the ground there.
CREATE OR REPLACE FUNCTION public.wear_walk(p_world uuid, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare far double precision; n int; i int; t double precision;
        fx int; fy int; tx int; ty int; spans boolean;
begin
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return; end if;
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or not exists (select 1 from bridge_span s join bridge b on b.world_id = s.world_id and b.id = s.bridge
                                        where s.world_id = p_world and s.x = tx and s.y = ty and b.kind <> 'aqueduct')) then
        perform wear_step(p_world, tx, ty);
      end if;
      fx := tx; fy := ty;
    end if;
  end loop;
end $function$;

-- No pool dug and no foundation poured under one of its spans; at either end is its basin.
CREATE OR REPLACE FUNCTION public.pool_reason(p_world uuid, p_x integer, p_y integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
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
  v_name := carried_over(p_world, p_x, p_y);
  if v_name is not null then return v_name; end if;
  if exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground' and i.gx = p_x and i.gy = p_y) then
    return 'Clear away the things lying there first: they would go into the water.';
  end if;
  if exists (select 1 from placed q where q.world_id = p_world and q.x = p_x and q.y = p_y)
     or exists (select 1 from crate c where c.world_id = p_world and c.x = p_x and c.y = p_y) then
    return 'Move what stands on the slab first: it would go into the water.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.foundation_reason(p_world uuid, p_uid uuid, p_x integer, p_y integer, p_top integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_high int; v_low int; v_lift int; v_want double precision; v_have double precision; v_name text;
        v_soil int;
begin
  if (foundation_at(p_world, p_x, p_y)).id is not null then
    return 'There is already a foundation on that tile.';
  end if;
  -- On bare rock and nowhere else: every spadeful of soil off all four corners first.
  select sum(land_dirt(p_world, v.cx, v.cy))::int into v_soil from tile_corners(p_x, p_y) v;
  if v_soil > 0 then
    return 'This tile still has ' || v_soil || ' soil over rock on its corners. A foundation goes on bare rock, '
      || 'seam or ore: dig every corner down to the rock first.';
  end if;
  select max(land_height(p_world, v.cx, v.cy))::int, min(land_height(p_world, v.cx, v.cy))::int
    into v_high, v_low from tile_corners(p_x, p_y) v;
  -- It fills a hole; it does not cut one.
  if p_top < v_high then
    return 'A foundation fills a tile up, never down. Its high corner is at ' || v_high
      || '; sight a level at or above that.';
  end if;
  -- And it is an answer to a slope. On ground that is already flat there is
  -- nothing to fill, and the tile next to it is the flat tile you were after.
  if p_top = v_high and v_high = v_low then
    return 'That tile is already level. A foundation is for ground that is not.';
  end if;
  /*
   * Not up against a building. A wall is planned against the ground as the
   * ground was, and a slab poured at its foot is a shelf under somebody else's
   * footings; keep a tile between them.
   */
  select b.name into v_name from building b
   where b.world_id = p_world
     and exists (select 1 from building_tile bt
                  where bt.world_id = p_world and bt.building = b.id
                    and abs(bt.x - p_x) <= clear_of_buildings()
                    and abs(bt.y - p_y) <= clear_of_buildings())
   order by b.id limit 1;
  if v_name is not null then
    return v_name || ' is too close. A foundation wants a tile clear of any building or plan.';
  end if;
  if is_token(p_world, p_x, p_y) then return 'The settlement token stands there.'; end if;
  v_name := carried_over(p_world, p_x, p_y);
  if v_name is not null then return v_name; end if;
  if exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
               and i.gx = p_x and i.gy = p_y) then
    return 'Clear away the things lying there first: the pour would bury them.';
  end if;
  -- And the deepest part of the pour is what asks for the skill: shuttering a
  -- step is a morning's work and shuttering a cliff is not.
  v_lift := lift_for(p_world, p_x, p_y, p_top);
  v_want := v_lift::double precision / lift_per_masonry();
  v_have := skill_of(p_world, p_uid, 'masonry');
  if v_have < v_want then
    return 'A pour ' || v_lift || ' deep wants ' || to_char(v_want, 'FM990.0')
      || ' masonry and you have ' || to_char(v_have, 'FM990.0')
      || '. At your skill the deepest you can shutter is '
      || to_char(v_have * lift_per_masonry(), 'FM990') || '.';
  end if;
  return null;
end $function$;

-- And no building planned under one, nor one taken in under one (`plan_reason` asks `extend_reason`).
CREATE OR REPLACE FUNCTION public.extend_reason(p_world uuid, p_uid uuid, p_x integer, p_y integer, p_into integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_slab foundation; v_deck int; b building; v_why text;
begin
  if not on_my_deed(p_world, p_uid, p_x, p_y) then return 'You may only build on your own deed.'; end if;
  if is_token(p_world, p_x, p_y) then return 'The settlement token stands here.'; end if;
  if building_at(p_world, p_x, p_y) is not null then return 'That tile is already part of a building.'; end if;
  if aqueduct_over(p_world, p_x, p_y) then return 'An aqueduct is carried over that tile.'; end if;
  select * into b from building where world_id = p_world and id = p_into;
  select * into v_slab from foundation f where f.world_id = p_world and f.x = p_x and f.y = p_y;
  if v_slab.world_id is not null then
    if land_tile(p_world, p_x, p_y) <> tile_id('Packed dirt') then return 'Buildings need flat packed dirt. Pack the tile first.'; end if;
    if not bill_done(v_slab.needed) then return 'The foundation here is only shuttered. Pour it first.'; end if;
    if v_slab.pool then return 'You cannot build in water.'; end if;
    if b.deck is not null and v_slab.top <> b.deck then
      return 'The slab here is poured to ' || v_slab.top || ' and the floor of ' || b.name || ' stands at ' || b.deck
        || '. A floor is level.';
    end if;
  else
    v_deck := pier_deck_for(p_world, p_uid, p_x, p_y, p_into);
    if v_deck is null then
      if land_tile(p_world, p_x, p_y) <> tile_id('Packed dirt') then return 'Buildings need flat packed dirt. Pack the tile first.'; end if;
    else
      v_why := coalesce(pier_refusal(p_world, p_x, p_y, v_deck), pier_site_refusal(p_world, p_uid, p_x, p_y));
      if v_why is not null then return v_why; end if;
    end if;
  end if;
  if exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground' and i.gx = p_x and i.gy = p_y) then
    return 'Clear away the items lying there first.';
  end if;
  return null;
end $function$;


/* ---- Its stone greens -------------------------------------------------------------------------- */

-- An aqueduct is a stone arch, and its stone takes moss as one does (`mossyBridge`): marked bare when its last span is laid,
CREATE OR REPLACE FUNCTION public.green_span_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare b bridge;
begin
  if span_done(new.needed) and not span_done(old.needed)
     and not exists (select 1 from bridge_span s where s.world_id = new.world_id and s.bridge = new.bridge
                       and not span_done(s.needed)) then
    select * into b from bridge where world_id = new.world_id and id = new.bridge;
    if b.kind in ('stone', 'aqueduct') then perform green_mark(b.world_id, 'bridge', b.ax, b.ay, b.id); end if;
  end if;
  return null;
end $function$;

-- scrubbed as one is,
CREATE OR REPLACE FUNCTION public.green_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; d action_def; v_from timestamptz; tx int; ty int; v_days int := 0; v_found boolean := false;
        v_side text; pc placed; br bridge; v_name text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  select * into d from action_def where id = p_action;
  select w.green_from into v_from from world w where w.id = p_world;
  if p_action = 'clear_ivy' then
    v_side := p_target->>'side';
    if p_target->>'kind' is distinct from 'tile' or v_side is null then return 'Choose a side.'; end if;
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    -- Every storey's wall on that border: a house is cleared a side at a time, top to bottom.
    select coalesce(max(green_days(green_start(g.since, v_from))), 0), count(*) > 0 into v_days, v_found
      from border_of(tx, ty, v_side) bo
      join wall wl on wl.world_id = p_world and wl.dir = bo.dir and wl.x = bo.x and wl.y = bo.y
      join build_material_def m on m.id = wl.material and m.kind = 'stone'
      left join green_since g on g.world_id = p_world and g.thing = 'wall' and g.x = wl.x and g.y = wl.y
                             and g.k = green_wall_k(wl.level, wl.dir)
     where bill_done(wl.needed);
    if not v_found then return 'There is no finished wall of stone or brick there.'; end if;
  elsif p_target->>'kind' = 'tile' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    if coalesce((select td.paved from tile_def td where td.id = land_tile(p_world, tx, ty)), false) then
      v_found := true;
      v_days := green_days(green_start((select g.since from green_since g where g.world_id = p_world
                  and g.thing = 'paving' and g.x = tx and g.y = ty and g.k = 0), v_from));
    end if;
    if (slab_at(p_world, tx, ty)).id is not null then
      v_found := true;
      v_days := greatest(v_days, green_days(green_start((select g.since from green_since g where g.world_id = p_world
                  and g.thing = 'slab' and g.x = tx and g.y = ty and g.k = 0), v_from)));
    end if;
    if not v_found then return 'There is no paving or poured foundation here.'; end if;
  elsif p_target->>'kind' = 'furniture' then
    pc := target_placed(p_world, p_target);
    if pc.id is null or pc.kind is distinct from 'furniture'
       or not coalesce((select f.mossy from furniture_def f where f.id = pc.sub), false) then
      return 'No moss grows on that.';
    end if;
    tx := pc.x; ty := pc.y;
    v_days := green_days(green_start(greatest(pc.made_at, (select g.since from green_since g where g.world_id = p_world
                and g.thing = 'piece' and g.x = pc.x and g.y = pc.y and g.k = pc.id)), v_from));
  elsif p_target->>'kind' = 'bridge' then
    select * into br from bridge b where b.world_id = p_world and b.id = (p_target->>'id')::bigint;
    if br.id is null or br.kind not in ('stone', 'aqueduct')
       or exists (select 1 from bridge_span s where s.world_id = p_world and s.bridge = br.id and not span_done(s.needed)) then
      return 'No moss grows on that.';
    end if;
    tx := br.ax; ty := br.ay;
    v_days := green_days(green_start((select g.since from green_since g where g.world_id = p_world
                and g.thing = 'bridge' and g.x = br.ax and g.y = br.ay and g.k = br.id), v_from));
  else
    return 'No moss grows on that.';
  end if;
  if not in_reach(p.x, p.y, jsonb_build_object('x', tx, 'y', ty), false, d.range) then
    return 'You are too far away from that.';
  end if;
  if tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(i.name, d.tool) from item_def i where i.id = d.tool))
        || ' to ' || lower(d.label) || '.';
  end if;
  -- Somebody else's garden is not yours to strip, and a guest of yours is a guest (`may_shape`).
  select dd.name into v_name from deed_covering(p_world, tx, ty) dd
   where not may_shape(p_world, p_uid, tx, ty) order by dd.founded_at limit 1;
  if v_name is not null then
    return 'That is part of ' || v_name || '. Only its builders may ' || lower(d.label) || ' there.';
  end if;
  if v_days <= 0 then return green_nothing_yet(); end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_green(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; v_side text; pc placed; br bridge; v_paved boolean; v_slab boolean;
begin
  if green_refusal(p_world, p_uid, p_action, p_target) is not null then return; end if;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if p_action = 'clear_ivy' then
    v_side := p_target->>'side';
    insert into green_since (world_id, thing, x, y, k, since)
      select p_world, 'wall', wl.x, wl.y, green_wall_k(wl.level, wl.dir), now()
        from border_of(tx, ty, v_side) bo
        join wall wl on wl.world_id = p_world and wl.dir = bo.dir and wl.x = bo.x and wl.y = bo.y
        join build_material_def m on m.id = wl.material and m.kind = 'stone'
       where bill_done(wl.needed)
    on conflict (world_id, thing, x, y, k) do update set since = excluded.since;
    perform tell(p_world, p_uid, 'You clear the ivy off the ' || side_name(v_side) || ' wall. ' || green_again(), 'event');
    return;
  end if;
  if p_target->>'kind' = 'tile' then
    v_paved := coalesce((select td.paved from tile_def td where td.id = land_tile(p_world, tx, ty)), false);
    v_slab := (slab_at(p_world, tx, ty)).id is not null;
    if v_paved then perform green_mark(p_world, 'paving', tx, ty, 0); end if;
    if v_slab then perform green_mark(p_world, 'slab', tx, ty, 0); end if;
    perform tell(p_world, p_uid, 'You scrub the moss off '
      || case when v_paved and v_slab then 'the paving and the foundation' when v_paved then 'the paving' else 'the foundation' end
      || '. ' || green_again(), 'event');
  elsif p_target->>'kind' = 'furniture' then
    pc := target_placed(p_world, p_target);
    perform green_mark(p_world, 'piece', pc.x, pc.y, pc.id);
    perform tell(p_world, p_uid, 'You scrub the moss off the '
      || lower((select f.name from furniture_def f where f.id = pc.sub)) || '. ' || green_again(), 'event');
  else
    select * into br from bridge b where b.world_id = p_world and b.id = (p_target->>'id')::bigint;
    perform green_mark(p_world, 'bridge', br.ax, br.ay, br.id);
    perform tell(p_world, p_uid, 'You scrub the moss off the ' || case when br.kind = 'aqueduct' then 'aqueduct' else 'bridge' end || '. '
      || green_again(), 'event');
  end if;
end $function$;

-- and sent to a browser with how long it has been greening, as a stone arch is.
CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; v_field double precision; v_box double precision;
        -- When greening came to this island (`greening.ts`).
        v_from timestamptz := (select w.green_from from world w where w.id = p_world);
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
  if p_slow then
    perform crops_settle(p_world, p.x, p.y, p_range);
    perform planters_settle(p_world, p.x, p.y, p_range);
    -- Each clock read once, for every crop on it.
    v_field := crop_clock(false, now());
    v_box := crop_clock(true, now());
  end if;
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
        /*
         * And for a piece with roses on it, the moment it was set down, which
         * is what its roses grow from (`roses.ts`): the same moment for
         * everybody, and sent for nothing else.
         */
        || case when coalesce((select fd.roses from furniture_def fd where fd.id = pl.sub), false)
                then jsonb_build_object('set', extract(epoch from pl.made_at)) else '{}'::jsonb end
        /*
         * And for a piece that gathers moss -- a statue -- the seconds since
         * the moss on it began: since it was set down or last scrubbed, and
         * never from before greening came in (`greening.ts`). Only for those,
         * so nothing else carries a key it does not need.
         */
        || case when pl.kind = 'furniture' and pl.sub in (select fd.id from furniture_def fd where fd.mossy)
                then jsonb_build_object('green_ago', green_ago(greatest(pl.made_at,
                       (select gs.since from green_since gs where gs.world_id = p_world and gs.thing = 'piece'
                           and gs.x = pl.x and gs.y = pl.y and gs.k = pl.id)), v_from))
                else '{}'::jsonb end
        -- And for a shop counter's store, what is set out on it and for whom (`counters.ts`).
        || case when pl.kind = 'counter' then counter_json(pl, me, p.x, p.y) else '{}'::jsonb end
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
     * `grown` rather than `stage_at`: how far into its stage it has grown, in
     * growing seconds on the clock it grows on, which the browser lays on its
     * own reading of the same clock -- a winter between the stage's start and
     * now adds nothing to it. `ago`, the wall seconds, is what a page from
     * before the year reads.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'grown', crop_grown(c.glass, c.stage_at, v_field),
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace)
        -- And a crop under glass says so, and `grown` is on the glass clock (`glasshouse.ts`).
        || case when c.glass then '{"glass": true}'::jsonb else '{}'::jsonb end)
      from crop c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    -- And what grows in the planters, by the piece, on the planter's own clock.
    'planted', coalesce((select jsonb_agg(jsonb_build_object(
        'planter', c.placed, 'x', pl.x, 'y', pl.y, 'id', c.id, 'stage', c.stage,
        'grown', v_box - crop_clock(true, c.stage_at),
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace) order by c.placed)
      from placed pl join planter_crop c on c.placed = pl.id
      where pl.world_id = p_world
        and pl.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and pl.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    -- And the island's wall clock, which a field's clock is read off, so the browser reads it off the same one.
    'now', extract(epoch from now())::double precision,
    /*
     * The felling notches near you, and how long ago the woods last turned
     * over. Look reads both: "2 of 3 strokes in it", "the woods turn over in
     * 9 hours". A browser on an island keeps no clock of its own for the
     * woods, so this is the only place it hears the hour.
     */
    /*
     * The water lilies and lotus planted near you: when each was planted and
     * last picked, which is all of one. The browser works out the rest from
     * the year, as `water_plant_state` does.
     */
    'waterPlants', water_plants_near(p_world, p.x, p.y, p_range),
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
                     where bt.world_id = p_world and bt.building = b.id))
          -- Piers: and its deck and its tiles on piers, if it has any (`piers_json`).
          || piers_json(p_world, b.id, b.deck) order by b.id)
        from building b
        where b.world_id = p_world
          and exists (select 1 from building_tile bt
                       where bt.world_id = p_world and bt.building = b.id
                         and greatest(abs(bt.x + 0.5 - p.x), abs(bt.y + 0.5 - p.y)) <= p_range)),
        '[]'::jsonb),
      'walls', coalesce((select jsonb_agg(jsonb_build_object(
          'building', w.building, 'level', w.level, 'x', w.x, 'y', w.y, 'dir', w.dir,
          'type', w.type, 'material', w.material, 'needed', w.needed, 'total', w.total,
          -- And the seconds since the ivy on a finished wall of stone or brick began (`greening.ts`).
          'greenAgo', case when bill_done(w.needed) and m.kind = 'stone' then green_ago(gs.since, v_from) end)
          order by w.level, w.dir, w.x, w.y)
        from wall w
        left join build_material_def m on m.id = w.material
        left join green_since gs on gs.world_id = p_world and gs.thing = 'wall' and gs.x = w.x and gs.y = w.y
                                and gs.k = green_wall_k(w.level, w.dir)
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
        'needed', fo.needed, 'total', fo.total,
        -- And the seconds since the moss on a poured one began.
        'greenAgo', case when bill_done(fo.needed) then green_ago(gs.since, v_from) end) order by fo.id)
      from foundation fo
      left join green_since gs on gs.world_id = p_world and gs.thing = 'slab' and gs.x = fo.x and gs.y = fo.y and gs.k = 0
      where fo.world_id = p_world
        and greatest(abs(fo.x + 0.5 - p.x), abs(fo.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'nextFoundationId', coalesce((select max(fo.id) + 1 from foundation fo where fo.world_id = p_world), 1),
    /*
     * And the bridges, shaped as the browser's own `Bridge`, spans and all.
     *
     * The island has kept `bridge` and `bridge_span` since bridges were ported
     * and never said a word about one, so on an island a bridge was drawn by
     * nobody and walked by nobody: the browser decides where its feet go, and
     * it had never heard of the deck. One comes whole if either end is in
     * range, and a stone arch with the seconds since the moss on it began.
     */
    'bridges', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'ax', b.ax, 'ay', b.ay, 'bx', b.bx, 'by', b.by,
        'height', b.height, 'level', b.level, 'material', b.material,
        'spans', (select coalesce(jsonb_agg(jsonb_build_object('x', s.x, 'y', s.y, 'needed', s.needed, 'total', s.total)
                    order by s.n), '[]'::jsonb)
                  from bridge_span s where s.world_id = p_world and s.bridge = b.id),
        'greenAgo', case when b.kind in ('stone', 'aqueduct') and not exists (select 1 from bridge_span s
                           where s.world_id = p_world and s.bridge = b.id and not span_done(s.needed))
                         then green_ago(gs.since, v_from) end) order by b.id)
      from bridge b
      left join green_since gs on gs.world_id = p_world and gs.thing = 'bridge' and gs.x = b.ax and gs.y = b.ay and gs.k = b.id
      where b.world_id = p_world
        and (greatest(abs(b.ax + 0.5 - p.x), abs(b.ay + 0.5 - p.y)) <= p_range
             or greatest(abs(b.bx + 0.5 - p.x), abs(b.by + 0.5 - p.y)) <= p_range)), '[]'::jsonb),
    /*
     * And the paving: the seconds since greening came in, which is when every
     * paved tile without a row of its own began, and the tiles in range paved
     * or scrubbed since, off the key's own box.
     */
    'greenFromAgo', extract(epoch from (now() - v_from))::double precision,
    'paving', coalesce((select jsonb_agg(jsonb_build_object('x', gs.x, 'y', gs.y, 'ago', green_ago(gs.since, v_from)))
      from green_since gs
      where gs.world_id = p_world and gs.thing = 'paving'
        and gs.x between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and gs.y between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb)) end;
end $function$;

-- And no tree seeds itself under one, as none is planted there: it would grow up through its arches.
CREATE OR REPLACE FUNCTION public.tree_day(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare w record; v_y int; v_tiles bytea; v_data bytea; v_row record; v_stump int := tile_id('Stump'); v_grass int := tile_id('Grass'); v_lawn int := tile_id('Lawn');
        v_next int[]; v_kind int[]; v_first int := tree_first(); v_reach int := tree_seed_reach()::int;
        v_moved int := 0; i int; k int; v_a int; v_b int; v_n int;
        v_sx int[] := '{}'; v_sy int[] := '{}'; v_ss int[] := '{}';
        v_gx int[] := '{}'; v_gy int[] := '{}'; v_gs int[] := '{}';
        v_tx int[]; v_ty int[]; v_ts int[]; v_touched boolean := false;
        v_px int[]; v_py int[]; v_near boolean; v_told int[];
        v_h0 bytea; v_h1 bytea; v_d0 bytea; v_d1 bytea;
        v_band int := 16; v_w0 int; v_w1 int; v_ground bytea; v_plant boolean[]; v_deeds deed[]; v_pick record;
        v_c0 int; v_c1 int;
        -- The tiles an aqueduct's spans are carried over, where no seed takes (`aqueduct_over`).
        v_aqx int[]; v_aqy int[];
        -- Whether a new year has begun since the last turn, which is when
        -- every tile of picked flowers flowers again; and the bit that says so.
        v_new_year boolean; v_picked int := flowers_picked()::int;
begin
  select * into w from world where id = p_world;
  if not found or not w.ready then return 0; end if;
  v_new_year := w.trees_at is null or year_of(now()) <> year_of(w.trees_at);

  -- What each age becomes, read once rather than per tree. -1 is the end of it.
  select array_agg(coalesce(next, -1) order by id) into v_next from tree_age_def;
  -- And what kind of tree each data byte is, the same way.
  select array_agg(tree_species(b) order by b) into v_kind from generate_series(0, 255) b;
  -- And who is about, for the half of this that is only worth telling somebody
  -- who can see it happen.
  select array_agg(floor(p.x)::int), array_agg(floor(p.y)::int) into v_px, v_py
    from player p where p.world_id = p_world and not p.away
      and p.seen_at > now() - make_interval(secs => idle_logout());

  for v_y in 0 .. w.size - 1 loop
    /*
     * Read the line out, not the note that says where it is.
     *
     * Both columns are four thousand and ninety-six bytes wide and both
     * compress hard -- a wooded line is 621 bytes of tiles and 56 of data --
     * so what the row holds is the packed form, and `select into` copies the
     * datum it is handed, packed. `v_tiles` was never a line. It was a line
     * folded up.
     *
     * That is free until the fourth time round this loop. plpgsql plans a
     * statement afresh for its first few goes, and a fresh plan folds the
     * parameter in as a constant, which is unpacked once. On the fifth go it
     * keeps the plan, and a kept plan takes the value as a parameter instead
     * -- so every `get_byte` below unpacks the whole four kilobytes again to
     * read one byte of it. The statement under this reads three bytes a tile
     * as written, but the subqueries flatten and the cases repeat them, so it
     * is nearer a dozen: fifty thousand unpackings of a folded line, per line.
     *
     *     line 1-3, plan made fresh      1.8 ms
     *     line 4 onward, plan kept      89.0 ms     <-- the cliff
     *
     * Appending nothing unpacks it here instead, once, and hands `select into`
     * a line rather than a folded line. The kept plan then costs what the
     * fresh one did, and goes on costing it:
     *
     *     line 4 onward, unpacked here   1.8 ms
     *
     * Which is a day in the woods on an island four thousand tiles square
     * going from **five minutes fifty-seven** to **eight seconds**, for the
     * same 1,677,610 trees and the same bytes in every line of the island.
     */
    select t.tiles || ''::bytea, t.data || ''::bytea into v_tiles, v_data
      from land_tile t where t.world_id = p_world and t.y = v_y;
    if not found then continue; end if;
    -- A line with nothing on it that the day moves is thrown out unread: no
    -- tree, no stump, and no grass with a count in it. The last is asked of
    -- the data bytes, which a rock or a tree can also put in the range, so it
    -- errs towards reading a line, never towards skipping one.
    -- A picked tile of grass is eight and up: read on a day that moves its
    -- count, which is nine and up, and on the day a new year clears it.
    if position('\x10'::bytea in v_tiles) = 0 and position(set_byte('\x00'::bytea, 0, v_stump) in v_tiles) = 0
       and not any_byte_between(v_data, 1, 7)
       and not any_byte_between(v_data, case when v_new_year then 8 else 9 end, 15) then continue; end if;

    /*
     * The whole line in one statement: the new faces, the new ages, how many
     * trees were in it, which of them went, and which columns moved at all.
     *
     * Built rather than edited — `set_byte` on a variable copies the line every
     * time, so a thousand trees in a row would be four megabytes of copying to
     * change a thousand bytes — and one pass rather than three, because reading
     * four thousand bytes is the cost and doing it once is the saving.
     *
     * `dead` is the trees that went, which seed. `faced` is every tile that is
     * something else after the day: those, the stumps, and grass become lawn.
     * `stirred` is all of that and every tree in the line that moved: a new
     * age byte, or gone. A stage whose next is itself is not stirred, and is
     * not told of. They are wanted separately, because they are not worth the
     * same.
     */
    select
      -- A tree that dies of age leaves grass: a stump is what a hatchet leaves,
      -- and every stump there is, however long it has stood, is grass after
      -- the turn.
      -- And grass kept cut on a deed: the day moves the cut-today flag into
      -- the count, the third day makes lawn, and a day with no cut starts
      -- the count over.
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t = 16 and g.n < 0 then v_grass
        when g.t = v_stump then 0
        when g.t = v_grass and (g.d & 4) <> 0 and (g.d & 3) + 1 >= 3 then v_lawn
        else g.t end), ''::bytea order by g.gi) as tiles,
      -- And flowers picked this year stay picked beside the count, until a
      -- new year begins (`FLOWERS_PICKED`).
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t = v_stump then 0
        when g.t = v_grass and (g.d & 4) <> 0 then case when (g.d & 3) + 1 >= 3 then 0
          else ((g.d & 3) + 1) | case when v_new_year then 0 else g.d & v_picked end end
        when g.t = v_grass then case when v_new_year then 0 else g.d & v_picked end
        when g.t <> 16 then g.d
        when g.n < 0 then 0
        -- The species bits, low nibble and top bit, kept; the age between them moved on.
        else (g.d & 143) | (g.n << 4) end), ''::bytea order by g.gi) as data,
      count(*) filter (where g.t = 16) as here,
      array_agg(g.gi) filter (where (g.t = 16 and (g.n < 0 or g.n <> g.a)) or g.t = v_stump
                                 or (g.t = v_grass and ((g.d & 7) <> 0 or (v_new_year and (g.d & v_picked) <> 0)))) as stirred,
      -- Every tile that is something else after the day: a tree gone, a stump
      -- gone, grass become lawn. Told to everybody, near or not.
      -- A tile of picked flowers flowering again is one of these: a browser
      -- that saw it picked would draw it bare until it next read the land.
      array_agg(g.gi) filter (where (g.t = 16 and g.n < 0) or g.t = v_stump
                                 or (g.t = v_grass and (g.d & 4) <> 0 and (g.d & 3) + 1 >= 3)
                                 or (g.t = v_grass and v_new_year and (g.d & v_picked) <> 0)) as faced,
      array_agg(g.gi) filter (where g.t = 16 and g.n < 0) as dead
      into v_row
      -- `i` is a local here as well as a column, and inside a query the column
      -- wins. The eighth time this class has bitten the island.
      --
      -- `n` is what the age becomes: the next stage, -1 for the end of it, or
      -- the same age again for one with nothing written down — a stage that
      -- stays as it is, or a byte nobody has a row for. A null here would
      -- drop the byte out of the line and shorten it.
      from (select q.gi, q.t, q.d, q.a, coalesce(v_next[q.a + 1], q.a) as n
              from (select gi, get_byte(v_tiles, gi) as t, get_byte(v_data, gi) as d,
                           tree_age(get_byte(v_data, gi)) as a
                      from generate_series(0, w.size - 1) gi) q) g;
    if v_row.here = 0 and v_row.stirred is null then continue; end if;
    v_moved := v_moved + v_row.here;
    v_touched := true;

    update land_tile t set tiles = v_row.tiles, data = v_row.data
      where t.world_id = p_world and t.y = v_y;

    /*
     * And the line's changes into the record, in one statement.
     *
     * This is `land_announce` for a whole line at once. That function reads
     * thirteen tiles to describe one — the face, the data and eight corner
     * lookups apiece for height and soil — and a line of a thousand trees is
     * thirteen thousand single-row reads. The corners of every tile in a line
     * live in exactly two rows of `land_corner`, and those two are read out
     * once, unpacked, for the same reason the line is: a row of heights is
     * eight kilobytes stored as five, and a byte read out of it where it lies
     * unpacks all eight.
     *
     * What changed face goes in whatever else is true, because a tile that has
     * stopped being a tree, or a stump, has stopped being one for everybody.
     */
    v_near := false;
    if v_px is not null then
      for k in 1 .. array_length(v_px, 1) loop
        if abs(v_py[k] - v_y) <= tree_tell_reach() then v_near := true; exit; end if;
      end loop;
    end if;
    v_told := case when v_near then v_row.stirred else v_row.faced end;
    if v_told is not null then
      select c.heights || ''::bytea, c.dirt || ''::bytea into v_h0, v_d0
        from land_corner c where c.world_id = p_world and c.y = v_y;
      select c.heights || ''::bytea, c.dirt || ''::bytea into v_h1, v_d1
        from land_corner c where c.world_id = p_world and c.y = v_y + 1;
      if found and v_h0 is not null then
        insert into tile_change (world_id, x, y, region, tile, data, corners, soil)
        select p_world, u.gi, v_y, region_of(u.gi, v_y),
               get_byte(v_row.tiles, u.gi), get_byte(v_row.data, u.gi),
               array[b_i16(v_h0, u.gi), b_i16(v_h0, u.gi + 1),
                     b_i16(v_h1, u.gi + 1), b_i16(v_h1, u.gi)],
               array[get_byte(v_d0, u.gi), get_byte(v_d0, u.gi + 1),
                     get_byte(v_d1, u.gi + 1), get_byte(v_d1, u.gi)]
          from unnest(v_told) as u(gi);
      end if;
    end if;

    -- What the ones that went leave behind them is gathered up, not planted
    -- here: seeds land in the lines either side of this one, and a line is
    -- written once.
    if v_row.dead is not null then
      foreach i in array v_row.dead loop
        v_sx := v_sx || i;
        v_sy := v_sy || v_y;
        v_ss := v_ss || v_kind[get_byte(v_data, i) + 1];
      end loop;
    end if;
  end loop;

  -- A year's growth closes whatever was cut into anything.
  delete from tree_notch where world_id = p_world;

  /*
   * And now the saplings, sixteen lines of the dead at a time.
   *
   * Every tree that died asks the twenty-four tiles round it whether a seed can
   * take there, and the ground it asks is the ground after the day -- except
   * where one of the dead stood. That ground took the day to clear, as it did
   * when a stump stood on it for the day, so a wood that dies together comes
   * back as thickly as it always did rather than in its own footprint. That was one
   * statement over every stump on the island, joined to the land a tile at a
   * time -- and a byte read out of a line where it lies unpacks the whole
   * line, eight and a half million times on a die-off. So the lines a band of
   * stumps can reach are read out once, unpacked, end to end, and every
   * candidate is one byte of that.
   *
   * What is drawn is what always was: one roll per stump, the spots it could
   * take in a random order, as many as the roll and the room allow -- and
   * where two stumps pick the same spot, one of them has it. A stump that
   * rolled nothing is dropped before its neighbours are asked, because the
   * answer cannot change what it takes.
   */
  select array_agg(exists (select 1 from plantable p where p.tile = b) order by b) into v_plant
    from generate_series(0, 255) b;
  select array_agg(d) into v_deeds from deed d where d.world_id = p_world;
  select array_agg(s.x), array_agg(s.y) into v_aqx, v_aqy
    from bridge_span s join bridge b on b.world_id = s.world_id and b.id = s.bridge
   where s.world_id = p_world and b.kind = 'aqueduct';
  v_n := coalesce(array_length(v_sx, 1), 0);
  v_a := 1;
  while v_a <= v_n loop
    v_b := v_a;
    while v_b < v_n and v_sy[v_b + 1] < v_sy[v_a] + v_band loop v_b := v_b + 1; end loop;
    v_w0 := greatest(0, v_sy[v_a] - v_reach);
    v_w1 := least(w.size - 1, v_sy[v_b] + v_reach);
    select string_agg(t.tiles, ''::bytea order by t.y) into v_ground
      from land_tile t where t.world_id = p_world and t.y between v_w0 and v_w1;
    -- The dead in the lines the band reads, which are in order of their line:
    -- the band's own and those either side of it within a seed's reach.
    v_c0 := v_a;
    while v_c0 > 1 and v_sy[v_c0 - 1] >= v_w0 loop v_c0 := v_c0 - 1; end loop;
    v_c1 := v_b;
    while v_c1 < v_n and v_sy[v_c1 + 1] <= v_w1 loop v_c1 := v_c1 + 1; end loop;

    for v_pick in
      with dead as (
        -- One roll per tree, not per spot it might take: `random()` in the
        -- candidate list would give a different answer for every neighbour.
        select d.x, d.y, d.sp, random() as roll
          from unnest(v_sx[v_a:v_b], v_sy[v_a:v_b], v_ss[v_a:v_b]) as d(x, y, sp)
      ), cand as (
        select d.x, d.y, d.sp, d.roll, d.x + q.dx as gx, d.y + q.dy as gy
        from dead d cross join (
          select dx, dy from generate_series(-v_reach, v_reach) dx,
                             generate_series(-v_reach, v_reach) dy
          where not (dx = 0 and dy = 0)) q
        where d.roll >= tree_seed_none()
          and d.x + q.dx between 0 and w.size - 1 and d.y + q.dy between 0 and w.size - 1
      ), cleared as (
        select k.x, k.y from unnest(v_sx[v_c0:v_c1], v_sy[v_c0:v_c1]) as k(x, y)
      ), free as (
        select c.gx, c.gy, c.sp, c.roll,
               row_number() over (partition by c.x, c.y order by random()) as rn,
               count(*) over (partition by c.x, c.y) as room
        from cand c
        where v_plant[get_byte(v_ground, (c.gy - v_w0) * w.size + c.gx) + 1]
          and not exists (select 1 from cleared k where k.x = c.gx and k.y = c.gy)
          and (v_deeds is null or not exists (select 1 from unnest(v_deeds) d where deed_covers(d, c.gx, c.gy)))
          and (v_aqx is null or not exists (select 1 from unnest(v_aqx, v_aqy) a(x, y) where a.x = c.gx and a.y = c.gy))
      ), want as (
        /*
         * What it wants, and what the ground will have.
         *
         * The roll averages a shade over replacement; the room is what keeps a
         * thick wood from running away, because a tree with nothing open round
         * it leaves nothing. Neither alone settles anywhere — together they do.
         */
        select f.gx, f.gy, f.sp, f.rn, least(
          case when f.roll < tree_seed_none() then 0
               when f.roll < 1 - tree_seed_both() then 1 else tree_seeds()::int end,
          case when f.room >= tree_room_two() then tree_seeds()::int
               when f.room >= tree_room_one() then 1 else 0 end) as take
        from free f
      )
      select gx, gy, sp from want where rn <= take
    loop
      v_gx := v_gx || v_pick.gx;
      v_gy := v_gy || v_pick.gy;
      v_gs := v_gs || v_pick.sp;
    end loop;
    v_a := v_b + 1;
  end loop;

  -- Two trees that picked the same spot plant one between them.
  if array_length(v_gx, 1) > 0 then
    select array_agg(gx order by gy, gx), array_agg(gy order by gy, gx), array_agg(sp order by gy, gx)
      into v_tx, v_ty, v_ts
      from (select distinct on (gx, gy) gx, gy, sp
              from unnest(v_gx, v_gy, v_gs) as p(gx, gy, sp)
             order by gx, gy, random()) took;
  end if;

  /*
   * And planted, a line at a time: the line read out unpacked, a byte set for
   * each sapling in it, the line written back once.
   *
   * And each sapling into the record, which is the half that was once never
   * written at all. After the dead, deliberately: a tile can lose its stump
   * and gain a neighbour's sapling in the same day, and the reader lays
   * changes down in the order they were written. Grass first, then the
   * sapling on it.
   */
  v_n := coalesce(array_length(v_tx, 1), 0);
  v_a := 1;
  while v_a <= v_n loop
    v_y := v_ty[v_a];
    v_b := v_a;
    while v_b < v_n and v_ty[v_b + 1] = v_y loop v_b := v_b + 1; end loop;

    select t.tiles || ''::bytea, t.data || ''::bytea into v_tiles, v_data
      from land_tile t where t.world_id = p_world and t.y = v_y;
    for k in v_a .. v_b loop
      v_tiles := set_byte(v_tiles, v_tx[k], 16);
      v_data := set_byte(v_data, v_tx[k], tree_pack(v_ts[k], v_first));
    end loop;
    update land_tile t set tiles = v_tiles, data = v_data
      where t.world_id = p_world and t.y = v_y;

    select c.heights || ''::bytea, c.dirt || ''::bytea into v_h0, v_d0
      from land_corner c where c.world_id = p_world and c.y = v_y;
    select c.heights || ''::bytea, c.dirt || ''::bytea into v_h1, v_d1
      from land_corner c where c.world_id = p_world and c.y = v_y + 1;
    if found and v_h0 is not null then
      insert into tile_change (world_id, x, y, region, tile, data, corners, soil)
      select p_world, u.gx, v_y, region_of(u.gx, v_y),
             16, tree_pack(u.sp, v_first),
             array[b_i16(v_h0, u.gx), b_i16(v_h0, u.gx + 1),
                   b_i16(v_h1, u.gx + 1), b_i16(v_h1, u.gx)],
             array[get_byte(v_d0, u.gx), get_byte(v_d0, u.gx + 1),
                   get_byte(v_d1, u.gx + 1), get_byte(v_d1, u.gx)]
        from unnest(v_tx[v_a:v_b], v_ts[v_a:v_b]) as u(gx, sp);
    end if;
    v_touched := true;
    v_a := v_b + 1;
  end loop;

  /*
   * And the chunk cache, dropped for the island in one statement.
   *
   * `land_chunk_forget` takes a tile and deletes the chunk around it; calling
   * it per chunk per line is sixty-four deletes a line and thirty thousand for
   * a wooded island. A day in the woods changes ground everywhere, so the
   * answer is to forget all of it at once — a chunk is only a cache, and the
   * next read of one builds it again from the land.
   */
  /*
   * And the worn ground: the day's fall off every tile feet have worn, and a
   * trail with none left is the ground it was again (`trail_day`). After the
   * saplings, so a trail that goes back to grass today takes no seed until
   * tomorrow, as in a game of your own.
   */
  if trail_day(p_world) then v_touched := true; end if;

  if v_touched then delete from land_chunk where world_id = p_world; end if;
  update world set trees_at = now() where id = p_world;
  return v_moved;
end $function$;

select private.lock_doors();

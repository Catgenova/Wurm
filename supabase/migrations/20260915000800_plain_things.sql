-- Examining a thing made of nothing in particular.
--
-- ## A null in a concatenation is a null all the way out
--
-- `examine_item_text` builds its sentence by joining a dozen pieces with `||`,
-- and in Postgres one null among them makes the whole string null. `tell` then
-- puts that into a not-null column and the action dies with a constraint
-- error rather than a message.
--
-- The null came from the weight. `unit_weight` multiplies what a thing weighs
-- by what its material weighs, and `mat_of(null)` — a knife, a bucket, a rope,
-- anything with no material on it at all — returns no row, so the multiplier
-- was null and so was everything downstream of it. The local suite examined a
-- *steel* hatchet and a marble slab, which is to say it only ever asked about
-- things that had an answer.
--
-- Two guards, both of them the same guard: a thing made of nothing in
-- particular weighs what it weighs, and says nothing about its material.

create or replace function unit_weight(it item) returns double precision language sql stable as $$
  select (select weight from item_def where id = it.def)
       * coalesce((mat_of(it.extra)).weight, 1)
$$;

create or replace function examine_item_text(p_world uuid, p_uid uuid, it item)
  returns text language plpgsql stable as $$
declare d item_def; m material_def; r rarity_def; v_worth double precision;
        v_skill text; v_out text;
begin
  select * into d from item_def where id = it.def;
  if not found then return 'It is nothing you have a name for.'; end if;
  m := mat_of(it.extra);
  select * into r from rarity_def where id = it.rare;
  v_worth := tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless);

  v_out := item_name(it) || ': QL ' || to_char(it.ql, 'FM990.00')
    || ', damage ' || to_char(it.dmg, 'FM990.00')
    || ', weight ' || to_char(item_weight(it), 'FM990.00') || ' kg.';
  if d.category = 'tool' and abs(v_worth - it.ql) >= 0.05 then
    v_out := v_out || ' It works as a ' || to_char(v_worth, 'FM990.0') || ' today.';
  end if;
  if d.description is not null then v_out := v_out || ' ' || d.description; end if;
  if r.id is not null then
    v_out := v_out || ' It is ' || r.id || ': better at what it is for by a '
      || case when r.boost > 1.3 then 'half' when r.boost > 1.15 then 'quarter' else 'tenth' end
      || ', slower to wear and to rot, and can be bettered ' || to_char(r.ceiling, 'FM990')
      || ' past your own skill.';
  end if;
  v_skill := boon_of((select seed from world where id = p_world), it.def);
  if v_skill is not null then
    v_out := v_out || ' It favours '
      || lower(coalesce((select name from skill_def where id = v_skill), v_skill)) || '.';
  end if;
  -- What it is made of is half of what it is — when it is made of anything.
  if m.name is not null and m.note is not null then
    v_out := v_out || ' ' || m.name || ': ' || m.note;
  end if;
  return v_out;
end $$;

select private.lock_doors();

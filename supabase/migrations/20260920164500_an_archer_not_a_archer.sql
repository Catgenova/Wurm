/*
 * An archer, not a archer.
 *
 * Twenty-two of the twenty-four trades read the same either way and two do
 * not. It had never mattered enough to notice, because the sentence went into
 * the log and the log scrolls -- and it matters now, because the trades window
 * puts it on the card under the button, where it sits until somebody has
 * earned the trade.
 *
 * The island already had the idiom: `furniture_refuses` has chosen between
 * "A raw material bin" and "An oven" by the same test since the bins were
 * named. This is that test, in the one other place that needed it, and the
 * browser's `classRefusal` says the same sentence in the same commit.
 */

CREATE OR REPLACE FUNCTION public.class_refusal(p_world uuid, p_uid uuid, p_class text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c class_def;
begin
  select * into c from class_def where id = p_class;
  if not found then return 'There is no such trade.'; end if;
  if class_open(p_world, p_uid, p_class) then return null; end if;
  return 'You are not ' || case when lower(c.name) ~ '^[aeiou]' then 'an ' else 'a ' end
      || lower(c.name) || ' yet. That wants ' || class_at()::int
      || ' in one of ' || class_wants(p_class) || '.';
end $function$;

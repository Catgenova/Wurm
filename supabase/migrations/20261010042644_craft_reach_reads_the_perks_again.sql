/*
 * The reach of work at a station reads the perks again.
 *
 * `20261010022606_defs.sql` was written as a whole snapshot of the generated
 * definitions, and a whole snapshot re-runs every generated function, among
 * them the plain `craft_reach()` that only says three. The Smith's, the Cook's
 * and the Tailor's moves onto perks had replaced that with one that reads
 * Forge Reach, the cook's and the tailor's reach off the go in hand, so the
 * snapshot put the plain one back over it, and a Smith with Forge Reach could
 * no longer pour from a chest five tiles off (the smith test, live run 1063).
 * This is the perk-aware one again, as the Tailor's move left it.
 */
create or replace function craft_reach() returns integer
  language sql stable as $$
  select case when forge_work(pkx_act()) then greatest(3, floor(pkx('reach:forge', 3))::int)
              when cook_work(pkx_act()) then greatest(3, floor(pkx('reach:cook', 3))::int)
              when tailor_work(pkx_act()) then greatest(3, floor(pkx('reach:tailor', 3))::int)
              else 3 end
$$;

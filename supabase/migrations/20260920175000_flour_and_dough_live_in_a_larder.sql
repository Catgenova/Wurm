/*
 * Flour and dough go in the larder.
 *
 * Asked for: "flour and dough should go in the larder too." The larder landed
 * an hour ago taking `category = 'food'` and nothing else, which turned them
 * away -- flagged at the time as a decision rather than an oversight, and this
 * is the decision coming back the other way.
 *
 * ## Why not simply call them food
 *
 * Because they are not, and the category is load-bearing elsewhere. It sets
 * how fast a thing rots on the ground -- food at 200 a real hour against a
 * material's 25 -- and it is what `item_worked` reads to decide that the craft
 * material bin takes them. Moving flour into `food` would have it going off
 * eight times faster and leaving the bin a carpenter and a smith fill, neither
 * of which anybody asked for.
 *
 * So `item_def.larder` says where a thing is kept, and the category goes on
 * saying what it is. Three things carry it: flour, dough and cornmeal.
 * Cornmeal is on the list because it is the same thing as flour in every
 * respect that matters -- corn ground coarse, the makings of porridge -- and
 * leaving it in the craft bin while flour moved would be a surprise rather
 * than a rule.
 *
 * ## Which is not a partition any more, and need not be
 *
 * The raw bin and the craft bin partition the materials between them, and they
 * still do: nothing goes in both, and every material goes in one. The larder
 * was never part of that. It now overlaps the craft bin on these three, so
 * flour may be kept in either, and a worker carrying some walks to whichever
 * is nearer. That is the right answer: both are places flour belongs.
 *
 * ## Why not derive it
 *
 * The tempting rule is "a material that a food recipe consumes", since it
 * cannot drift. Asked of the rulebook, it gives the wrong set:
 *
 *     bucket       (tool)      -> cider_bucket, juice_bucket
 *     cornmeal     (material)  -> porridge
 *     dough        (material)  -> apple_pie, bread
 *     water_bucket (tool)      -> porridge
 *
 * Flour is not in it -- flour makes dough, and dough is a material -- and two
 * buckets are. A flag on the three things it is true of is the honest form.
 */

select private.shut('alter table item_def add column if not exists larder boolean not null default false');
update item_def set larder = true where id in ('flour', 'dough', 'cornmeal');

/*
 * And the one line of the door that changes. The browser says this in exactly
 * these words; see `TAKES` in `src/game/furniture.ts`.
 */
create or replace function furniture_takes(p_takes text, p_def text) returns text
language sql stable as $fn$
  select case p_takes
    when 'raw' then case when item_raw(p_def) then null else
      'A raw material bin takes raw materials — ore, logs, dirt, shards, wool — and nothing a bench has touched.' end
    when 'worked' then case when item_worked(p_def) then null else
      'A craft material bin takes worked materials — planks, nails, ribbons, hinges — and nothing that has not been through a bench.' end
    when 'food' then case when (select d.category = 'food' or coalesce(d.larder, false)
                                  from item_def d where d.id = p_def) then null else
      'A larder takes food and drink, and the flour, dough and cornmeal a kitchen bakes from — and nothing else.' end
    when 'seed' then case when exists (select 1 from crop_def c where c.seed = p_def) then null else
      'A seed bin takes seeds and nothing else.' end
    when 'sprout' then case when p_def = 'sprout' then null else
      'A sprout bin takes sprouts and nothing else.' end
    end
$fn$;

select private.lock_doors();

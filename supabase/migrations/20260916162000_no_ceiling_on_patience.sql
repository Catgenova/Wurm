-- Coaxing that does not stop at four offerings.
--
-- Reported: the chance a wild thing is tamed after a refusal stops improving
-- at twelve points. It did — `least(0.12, c.coaxed * 0.03)`, so the fourth
-- offering was the last one worth making.
--
-- Twelve points is not enough to see on a hard tame, which turned a long run
-- of refusals back into no progress at all: the very thing coaxing was written
-- for. The ceiling is gone. Keep offering and it keeps warming, and the only
-- limit left is the one on the whole chance — `tame_chance` has always clamped
-- at 0.95 — so patience buys a hard tame rather than guaranteeing it, and the
-- run still lapses the moment you walk away, and still ends outright if you
-- raise a hand to it.
--
-- `coax_step()` is the 0.03 crossed from `creatures.ts` by `npm run defs`. It
-- was a literal on both sides, which is one number in two places and the one
-- thing this repository will not have.

CREATE OR REPLACE FUNCTION public.coax_bonus(c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select case when c.coaxed <= 0 or c.coaxed_at is null
                or now() - c.coaxed_at > make_interval(secs => coax_lapse()) then 0
              else c.coaxed * coax_step() end
$function$;

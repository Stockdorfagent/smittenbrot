-- Per-location, customer-facing pickup instructions.
-- Shown on the order success page and in the confirmation/invoice email so the
-- wording fits how each location actually works (self-service locker vs.
-- delivered within a building, etc.). Admin-editable per location.

ALTER TABLE public.pickup_locations
  ADD COLUMN IF NOT EXISTS pickup_instructions TEXT;

-- Seed the two current locations (best-effort match; editable in the admin).
UPDATE public.pickup_locations
SET pickup_instructions =
  'Deine Bestellung liegt im Abholschrank für dich bereit – deine Bestellnummer steht auf der Verpackung. Selbstbedienung, du musst niemanden fragen.'
WHERE (name ILIKE '%stockdorf%' OR name ILIKE '%waldstr%')
  AND (pickup_instructions IS NULL OR pickup_instructions = '');

UPDATE public.pickup_locations
SET pickup_instructions =
  'Deine Bestellung wird an der Feichtstraße angeliefert und im Haus an dich verteilt – du musst sie nicht selbst abholen.'
WHERE name ILIKE '%feicht%'
  AND (pickup_instructions IS NULL OR pickup_instructions = '');

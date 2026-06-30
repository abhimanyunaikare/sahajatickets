-- Add new columns to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS donation_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sex_based_pricing BOOLEAN DEFAULT TRUE;

-- Make email optional, phone required in tickets
ALTER TABLE tickets ALTER COLUMN email DROP NOT NULL;
ALTER TABLE tickets ALTER COLUMN phone SET NOT NULL;
-- ============================================================
-- MIGRATION 2: User accounts, family members, volunteer interests
-- ============================================================

-- Seeker user accounts (different from admin/seva users table)
CREATE TABLE IF NOT EXISTS seeker_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(15) UNIQUE NOT NULL,
  name VARCHAR(200),
  email VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- OTP storage (temporary, expires quickly)
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(15) NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);

-- Family members saved by each seeker account (for repeat bookings)
CREATE TABLE IF NOT EXISTS family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES seeker_accounts(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  age INTEGER NOT NULL,
  sex VARCHAR(10) NOT NULL,
  relation VARCHAR(50),  -- self, spouse, son, daughter, parent, other
  zone_city VARCHAR(200),
  email VARCHAR(200),
  phone VARCHAR(15),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Volunteer interest options (editable list by admin)
CREATE TABLE IF NOT EXISTS volunteer_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed some default volunteer options
INSERT INTO volunteer_options (label, display_order) VALUES
  ('Prasad Distribution', 1),
  ('Meditation Guidance', 2),
  ('Center Conducting', 3),
  ('Public Programs', 4),
  ('Gardening', 5),
  ('Web Development', 6),
  ('Sound & Music', 7),
  ('Decoration', 8)
ON CONFLICT DO NOTHING;

-- Link tickets to seeker accounts (so they can see their purchase history)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES seeker_accounts(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS family_member_id UUID REFERENCES family_members(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS volunteer_interests TEXT[]; -- array of selected interest labels
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category_overridden BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_tickets_account ON tickets(account_id);
CREATE INDEX IF NOT EXISTS idx_family_members_account ON family_members(account_id);
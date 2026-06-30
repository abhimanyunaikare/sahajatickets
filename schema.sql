-- ============================================================
-- SAHAJA YOGA EVENTS PLATFORM — DATABASE SCHEMA
-- Run this in your Supabase SQL editor (supabase.com)
-- ============================================================

-- Users (organizers + volunteers)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200) UNIQUE NOT NULL,
  phone VARCHAR(20),
  password_hash TEXT NOT NULL,
  role VARCHAR(30) DEFAULT 'organizer',  -- organizer | checkin_seva | registration_seva
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  description TEXT,
  banner_url TEXT,
  venue TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  status VARCHAR(20) DEFAULT 'draft',   -- draft | published | closed
  languages TEXT[] DEFAULT '{en}',      -- supported languages: en, hi, mr, gu, ta, te, kn, bn, pa
  total_capacity INTEGER DEFAULT 500,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ticket pricing tiers (one per event)
CREATE TABLE IF NOT EXISTS ticket_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  tier_name VARCHAR(100) DEFAULT 'General',
  -- Child (age 0-12)
  child_male_price   DECIMAL(10,2) DEFAULT 0,
  child_female_price DECIMAL(10,2) DEFAULT 0,
  child_max_age      INTEGER DEFAULT 12,
  -- Yuva (age 13-25)
  yuva_male_price    DECIMAL(10,2) DEFAULT 100,
  yuva_female_price  DECIMAL(10,2) DEFAULT 100,
  yuva_max_age       INTEGER DEFAULT 25,
  -- Adult (age 26+)
  adult_male_price   DECIMAL(10,2) DEFAULT 200,
  adult_female_price DECIMAL(10,2) DEFAULT 200,
  -- Free event flag
  is_free            BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Discount codes
CREATE TABLE IF NOT EXISTS discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL,    -- flat | percent | free
  value DECIMAL(10,2) DEFAULT 0,
  max_uses INTEGER DEFAULT 100,
  used_count INTEGER DEFAULT 0,
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT FALSE,  -- organizer toggles this in backend
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, code)
);

-- Tickets (one per seeker)
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  tier_id UUID REFERENCES ticket_tiers(id),
  -- Seeker details
  seeker_name VARCHAR(200) NOT NULL,
  age INTEGER NOT NULL,
  sex VARCHAR(10) NOT NULL,          -- male | female
  age_category VARCHAR(20) NOT NULL, -- child | yuva | adult
  zone_city VARCHAR(200),
  email VARCHAR(200) NOT NULL,
  phone VARCHAR(20),
  language VARCHAR(5) DEFAULT 'en',
  is_first_time BOOLEAN DEFAULT FALSE,
  -- Pricing
  base_amount DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  final_amount DECIMAL(10,2) DEFAULT 0,
  discount_code_used VARCHAR(50),
  -- Payment
  payment_status VARCHAR(20) DEFAULT 'pending', -- pending | paid | free
  razorpay_order_id VARCHAR(200),
  razorpay_payment_id VARCHAR(200),
  -- QR
  qr_uuid UUID UNIQUE DEFAULT gen_random_uuid(),
  qr_image_url TEXT,
  -- Check-in
  checked_in BOOLEAN DEFAULT FALSE,
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID REFERENCES users(id),
  -- Bulk booking reference
  booking_group_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Donations (separate from ticket payments)
CREATE TABLE IF NOT EXISTS donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  ticket_id UUID REFERENCES tickets(id),
  donor_name VARCHAR(200),
  email VARCHAR(200),
  amount DECIMAL(10,2) NOT NULL,
  is_anonymous BOOLEAN DEFAULT FALSE,
  dedication_note TEXT,
  razorpay_order_id VARCHAR(200),
  razorpay_payment_id VARCHAR(200),
  payment_status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Volunteers assigned to events
CREATE TABLE IF NOT EXISTS event_volunteers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(30) NOT NULL,    -- checkin_seva | registration_seva
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tickets_qr_uuid ON tickets(qr_uuid);
CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_email ON tickets(email);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_event_volunteers_event ON event_volunteers(event_id);

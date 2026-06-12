# Smittenbrot — Build Prompt

## Business Overview

Smittenbrot is a mobile-first artisan micro-bakery in Munich. A single baker (owner-operator) produces sourdough breads and pastries for local pickup. The business is subscription-driven with weekly recurring orders, capacity limits, and strict cutoff times.

## System Architecture

```
Mobile App (Expo/React Native)    Website (Next.js)
           |                              |
           └─────── Shared API Layer ─────┘
                           |
                    Supabase/PostgreSQL
                   (Primary Logic Engine)
                           |
                    ┌──────┴──────┐
                 Stripe         Brevo
              (Payments)     (Email)
                           |
                    IONOS Domain
                (hello@smittenbrot.de)
```

**Core principle:** Supabase is the system of record. Website and app are frontends to the same backend business logic.

## Fulfillment Rules

| Event | Time |
|-------|------|
| Wednesday pickup cutoff (ordering closes) | Monday 22:00 |
| Saturday pickup cutoff (ordering closes) | Thursday 22:00 |
| Subscription processing notification sent | Monday/Thursday 12:00 |
| Subscription auto-order placed | Monday/Thursday 20:00 |
| Grace period (modify/cancel subscription order) | 20:00–22:00 |
| Orders locked for production | 22:00 |
| Pickup days | Wednesday, Saturday |
| Production days | Tuesday, Friday |
| Pickup locations | Stockdorf, Feichtstr. (configurable) |

## Product System

### Product Types
- **Permanent**: Available every week (Stockdorf Sourdough, Wheat & Rye Sourdough, Brioche, Focaccia, Kokos cookies, Mandel cookies)
- **Week A**: Available in A-weeks only (Ciabatta, Vollkorn Sourdough)
- **Week B**: Available in B-weeks only (Dinkel Sourdough, Baguette)
- **Hidden**: Temporarily disabled

### Availability by Pickup Day
Each product can be enabled for Wednesday, Saturday, or both.

### Capacity Rules (per production day)

| Product | Max |
|---------|-----|
| Stockdorf Sourdough | 12 |
| Wheat & Rye Sourdough | 15 |
| Dinkel Sourdough | 10 |
| Vollkorn Sourdough | 10 |
| Baguette | 12 |
| Focaccia | 12 |
| Kokos cookies | 25 |
| Mandel cookies | 25 |

Capacity is per production day (not per pickup location). All pickup locations share the same production pool. Capacity is editable by admin at any time.

### Tax
All products (including gift cards) are 7% VAT (Germany).

### Week A/B Cycle
The system automatically alternates between Week A and Week B each week. Admin sets the starting week. The shop display automatically updates on Thursday at 22:01 to show the next week's products.

## Subscription System

### Subscription State Machine
- `active`: Normal recurring orders
- `paused`: Customer-initiated pause with resume date
- `cancellation_pending`: In grace period (20:00–22:00)
- `cancelled`: Terminated by customer or admin
- `payment_failed`: Last payment attempt failed

### Subscription Order State Machine
- `scheduled`: Created but before cutoff
- `processing`: Between cutoff and production
- `grace_period_open`: 20:00–22:00 window
- `locked_for_production`: After 22:00 cutoff
- `fulfilled`: Marked collected
- `refunded`: Refund issued
- `cancelled`: Within grace period

### Subscription Behavior
- Customer subscribes to specific products with quantities
- Week A/B products only generate orders during their active weeks
- Subscriptions RESERVE CAPACITY FIRST before one-time orders
- Payment method stored, auto-charged at 22:00 cutoff
- Subscribers can pause with an optional resume date
- At 12:00 on processing day: push notification + email "your subscription order will be placed tonight"
- At 20:00: subscription order auto-placed, notification sent
- 20:00–22:00: grace period for modifications or cancellation
- After 22:00: locked for production, no changes possible

### Quantity Warning
If a customer orders >10 of any single product, show a confirmation dialog: "Du hast N× [Product] ausgewählt. Ist das korrekt?" with "Ja" and "Menge ändern" buttons.

## Payment System

### Provider: Stripe
- One-time orders: charged immediately when placed
- Subscriptions: stored payment method, auto-charged at 22:00 on processing day
- SEPA Direct Debit supported
- Apple Pay and Google Pay supported (via Stripe)

### Webhook Architecture
All payment confirmation MUST be validated server-side via Stripe webhooks. Never trust client-side payment success alone. Webhook endpoints must validate Stripe signatures. Handle:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `subscription.created`, `subscription.updated`, `subscription.deleted`
- `charge.refunded`

### Idempotency
Use idempotency keys to prevent duplicate orders, duplicate refunds, and duplicate subscription renewals.

## Holiday / Closure System

- Admin creates a closure with start/end dates
- Existing subscriptions: automatically paused for closure duration
- One-time orders: blocked from being created during closure
- App shows banner: "Während unseres Urlaubs findet keine Produktion statt."
- Website shows same banner (German text configurable)
- Subscriptions auto-resume after closure ends

## Notification System

### Email Provider: Brevo
- Sender: hello@smittenbrot.de (IONOS domain)
- Transactional emails only initially
- Templates for: order confirmation, pickup ready, subscription reminder, payment failed, admin alerts

### Push Notifications (via Expo Push API)
Sent from server-side, not client-side.

### Notification Events
1. **Subscription processing reminder** (Monday/Thursday 12:00): push + email
2. **Subscription order placed** (Monday/Thursday 20:00): push + email
3. **Pickup ready**: Admin triggers per-customer or per-location; uses location-specific template
4. **Payment failed**: Automatic alert to customer + admin
5. **Capacity reached / emergency product disable**: Admin alert only
6. **Subscription paused/cancelled**: Confirmation to customer
7. **Closure notice**: Sent when closure is created for affected subscribers

### Pickup Notification Templates
Per pickup location, admin-configurable. Example placeholders: `{ORDER_NUMBER}`, `{PICKUP_LOCATION}`, `{CODE}`, `{PICKUP_TIME}`.

## Pickup System

- Customer selects pickup location from dropdown at checkout
- No pickup windows (available all day from notification moment)
- Orders identified by customer last name and order number
- Admin can send ready-for-pickup notifications individually or by location
- Admin can customize notification with any additional text (e.g., cabinet unlock code)

## Customer Accounts

- App: mandatory account (email, Apple, or Google sign-in)
- Website one-time orders: guest checkout allowed, but account creation is proposed before checkout mentioning advantages
- Subscriptions: account mandatory
- Account stores: name, email, phone, preferred pickup location, push token, saved payment methods, order history

## Gift Subscriptions

Not launch feature, but database must support it. Product type `gift_subscription` with duration (weeks) and value. Admin can activate the feature later.

## Capacity & Inventory System

### Capacity Rules
1. Subscriptions reserve capacity first at subscription creation time
2. Remaining capacity available for one-time orders
3. Capacity is per product per production day (Wednesday/Saturday)
4. All pickup locations share one capacity pool
5. When capacity is reached: show "Ausverkauft" (no waitlist)
6. Admin can change capacity at any time — changes take effect immediately for new orders; existing orders are NOT affected unless admin specifically reduces capacity below existing commitments

### Capacity Change Protection
- If admin reduces capacity below existing orders: warning with count of affected orders
- If admin disables a product in active orders: warning + options (disable future only vs. disable all)
- If admin disables a product with active subscriptions: warning + customer replacement flow

## Data Export

All transactional data (orders, products, pickups, subscriptions, cancellations, payments, notifications) stored and available for CSV export for external analytics.

## Admin Dashboard Requirements

The admin (single baker, non-technical) must be able to change everything without a developer.

### Core Admin Screens

1. **Dashboard**: Today's/pickup day order counts, revenue, production numbers
2. **Orders**: Filter by pickup day, location, status. Mark as fulfilled.
3. **Production Sheet**: Auto-generated list of what to bake per production day with quantities. This is the most-used screen.
4. **Products**: CRUD. Fields: name, description, image(s), price, capacity, cycle (Permanent/Week A/Week B), available days (Wed/Sat), status (Active/Hidden)
5. **Pickup Locations**: CRUD. Fields: name, address, active, notification template
6. **Closures**: Create/delete closures with date range. System auto-handles subscriptions and banners.
7. **Customer Search**: Lookup by name/email, view order history, manage subscriptions
8. **Notifications**: Send pickup-ready notifications individually or batch (by location, by pickup day)
9. **Subscription Management**: View all active subscriptions, pause/cancel, change products
10. **Settings**: Week A/B current cycle toggle, timezone confirmation, general config

### Emergency Product Disable
Admin can disable any product from the app. If disabled product exists in open orders, show:
"Achtung: Dieses Produkt befindet sich bereits in N offenen Bestellungen."
Options: (a) Disable for future orders only, (b) Disable completely and notify affected customers to choose replacement

## Database Schema (Supabase/PostgreSQL)

### Tables

#### customers
- id UUID PK (links to auth.users)
- email TEXT UNIQUE
- name TEXT
- phone TEXT
- preferred_pickup_location_id UUID FK
- push_token TEXT
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ

#### pickup_locations
- id UUID PK
- name TEXT
- address TEXT
- active BOOLEAN DEFAULT true
- notification_template TEXT (with placeholders)
- sort_order INTEGER
- created_at TIMESTAMPTZ

#### products
- id UUID PK
- name TEXT
- description TEXT
- price_cents INTEGER
- tax_rate NUMERIC DEFAULT 0.07
- capacity INTEGER
- cycle TEXT CHECK ('permanent', 'week_a', 'week_b', 'hidden')
- available_wed BOOLEAN DEFAULT true
- available_sat BOOLEAN DEFAULT true
- active BOOLEAN DEFAULT true
- cover_image_url TEXT
- images TEXT[] (array of URLs)
- sort_order INTEGER
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ

#### week_cycle
- id UUID PK
- current_week TEXT CHECK ('A', 'B')
- switched_at TIMESTAMPTZ
- created_at TIMESTAMPTZ

#### subscriptions
- id UUID PK
- customer_id UUID FK
- status TEXT CHECK ('active', 'paused', 'cancellation_pending', 'cancelled', 'payment_failed')
- paused_until DATE nullable
- pickup_location_id UUID FK
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ

#### subscription_items
- id UUID PK
- subscription_id UUID FK
- product_id UUID FK
- quantity INTEGER
- created_at TIMESTAMPTZ

#### orders
- id UUID PK
- customer_id UUID FK nullable (for guest checkout)
- order_type TEXT CHECK ('one_time', 'subscription')
- subscription_id UUID FK nullable
- fulfillment_date DATE
- pickup_location_id UUID FK
- status TEXT CHECK ('scheduled', 'processing', 'grace_period_open', 'locked_for_production', 'fulfilled', 'refunded', 'cancelled')
- payment_status TEXT CHECK ('pending', 'paid', 'failed', 'refunded')
- stripe_payment_intent_id TEXT
- total_cents INTEGER
- notes TEXT
- customer_email TEXT (for guests)
- customer_name TEXT (for guests)
- idempotency_key TEXT UNIQUE
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ

#### order_items
- id UUID PK
- order_id UUID FK
- product_id UUID FK
- quantity INTEGER
- unit_price_cents INTEGER
- created_at TIMESTAMPTZ

#### closures
- id UUID PK
- start_date DATE
- end_date DATE
- reason TEXT
- banner_text_de TEXT (German banner text)
- created_at TIMESTAMPTZ

#### notifications
- id UUID PK
- customer_id UUID FK nullable
- type TEXT CHECK ('subscription_reminder', 'order_placed', 'pickup_ready', 'payment_failed', 'admin_alert', 'closure_notice', 'subscription_paused', 'subscription_cancelled')
- channel TEXT CHECK ('push', 'email', 'both')
- sent_at TIMESTAMPTZ
- delivered BOOLEAN
- error TEXT nullable

#### audit_log
- id UUID PK
- action TEXT
- entity_type TEXT
- entity_id UUID
- old_data JSONB nullable
- new_data JSONB nullable
- performed_by UUID FK (customer or admin)
- created_at TIMESTAMPTZ

### Row Level Security (RLS)
- Customers can read their own data
- Customers can create/read their own orders and subscriptions
- Admin role has full access
- Product catalog is publicly readable
- Pickup locations are publicly readable

### Indexes
- orders(fulfillment_date, status)
- orders(customer_id)
- subscriptions(customer_id, status)
- subscription_items(subscription_id)
- order_items(order_id)
- products(active)
- closures(start_date, end_date)

## Timezone

All operational scheduling uses **Europe/Berlin**. DST handled correctly. Cutoff validation must happen server-side. Mobile device local timezone must never override bakery operational timezone.

## Product Display Logic

The website/app shop display:
1. Show all products where `active = true`
2. Filter by availability_day matching the selected pickup day
3. For products with `cycle = 'week_a'`: only show if current week cycle is A
4. For products with `cycle = 'week_b'`: only show if current week cycle is B
5. For products with `cycle = 'permanent'`: always show
6. If a product's capacity is reached: show "Ausverkauft" badge, disable add-to-cart

---

# Build Phases

## Phase 0: Project Scaffolding
Create the monorepo structure with package.json files, TypeScript configs, and base setup for:
- Next.js website in `website/`
- Expo React Native app in `mobile/`
- Supabase config in `supabase/`
- Shared types in `shared/`

## Phase 1: Supabase Database
Create migration files for all tables, RLS policies, indexes, and seed data.

## Phase 2: Backend Edge Functions
Create Supabase Edge Functions for:
- Stripe webhook handler (validate signature, process payments, handle refunds)
- Subscription engine (create weekly orders, process grace periods, handle pauses)
- Notification dispatch (push via Expo, email via Brevo)
- Capacity management (reserve/check/release)
- Week cycle auto-switch (cron: Thursday 22:01)
- Closure auto-handler (pause subscriptions, banners)

## Phase 3: Next.js Website
Build public pages (homepage, about, products, FAQ, locations, login) and authenticated pages (ordering flow, cart, checkout, subscription management, account).

## Phase 4: Expo Mobile App
Build all customer screens (auth, home, shop, cart, checkout, subscriptions, order history, profile) plus admin mode accessible from the same app.

## Phase 5: Admin Dashboard
Build admin screens (dashboard with production sheet, orders management, products CRUD, pickup locations, closures, notifications, customer search, settings). Accessible via website /admin route and via admin mode toggle in the app.

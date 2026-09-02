-- 00135: sub unit rates + walkthrough checklist.
-- Plumbing and electrical were carried as lump-sum guesses on 35-70% of
-- recent proposals, and those two trades ran 9% and 27% over on closed
-- jobs. Unit rates come from the subs' own quotes/invoices (see the
-- Cosentino & Cameron rate sheets); the walkthrough checklist captures the
-- conditions that still need eyes on site, and every yes/unknown becomes a
-- named allowance line on the estimate instead of a silent carry.

create table if not exists sub_unit_rates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  trade text not null,
  subcontractor_id uuid references subcontractors(id),
  subcontractor_name text not null,
  item text not null,
  detail text,
  unit_type text not null default 'each',
  rate numeric(10,2) not null,
  basis text,
  sample_count integer not null default 0,
  status text not null default 'draft' check (status in ('draft','confirmed','expired')),
  valid_from date not null default current_date,
  valid_to date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table sub_unit_rates is 'Per-unit sub pricing agreed for a term. Estimator prices plumbing/electrical by counting units against these instead of carrying a lump.';
comment on column sub_unit_rates.status is 'draft = derived from their paperwork, not yet signed. confirmed = sub signed off. expired = past valid_to.';

create index if not exists sub_unit_rates_trade_idx on sub_unit_rates (trade, status);

alter table sub_unit_rates enable row level security;
drop policy if exists "sub_unit_rates_read" on sub_unit_rates;
create policy "sub_unit_rates_read" on sub_unit_rates for select to authenticated using (true);
drop policy if exists "sub_unit_rates_write" on sub_unit_rates;
create policy "sub_unit_rates_write" on sub_unit_rates for all to authenticated using (true) with check (true);

-- Walkthrough checklist answers, keyed by question key from
-- src/lib/constants/walkthrough-checklist.ts: { key: { answer, note } }.
alter table walkthroughs
  add column if not exists checklist jsonb not null default '{}'::jsonb;

comment on column walkthroughs.checklist is 'Answers to the per-project-type walkthrough checklist. answer is yes | no | unknown. Triggers answered yes/unknown become allowance lines.';

-- Seed: Cosentino (his own line items) and Cameron (derived from 8 lump-sum
-- quotes, ~10% fit). Both start as draft until the sub signs the sheet.
insert into sub_unit_rates (code, trade, subcontractor_name, item, detail, unit_type, rate, basis, sample_count, sort_order) values
  ('PL-01','plumbing','Cosentino Plumbing and Heating','Full repipe, 3-piece bath','Water closet, single lav, tub or shower. Same or new locations. Pan and membrane by others.','each',5500,'7 jobs, Arnott 8/26',7,10),
  ('PL-02','plumbing','Cosentino Plumbing and Heating','Full repipe, 4-fixture bath','Adds a separate tub to PL-01. Brought to current code.','each',7000,'Frechette 7/26',1,20),
  ('PL-03','plumbing','Cosentino Plumbing and Heating','Water closet reset, same location','New valve and flange.','each',750,'Danti 7/26',1,30),
  ('PL-04','plumbing','Cosentino Plumbing and Heating','Shower repipe, valve relocated, new center drain',null,'each',2000,'Danti 7/26',1,40),
  ('PL-05','plumbing','Cosentino Plumbing and Heating','Vanity repipe and connect','Double to single, or single to single.','each',1500,'Danti 7/26',1,50),
  ('PL-06','plumbing','Cosentino Plumbing and Heating','Swap sink and toilet, no repipe','Customer-supplied fixtures.','each',1250,'Parziale 6/26',1,60),
  ('PL-07','plumbing','Cosentino Plumbing and Heating','Symmons trim, supplied and installed',null,'each',550,'Parziale 6/26',1,70),
  ('PL-08','plumbing','Cosentino Plumbing and Heating','Half bath, new piping to existing main','With macerating/ejector toilet supplied: $4,500.','each',3500,'Breen, Ritchie',2,80),
  ('PL-09','plumbing','Cosentino Plumbing and Heating','Sewage ejector pump, installed','$990 to $1,350.','each',1200,'Puleo, Iler',2,90),
  ('PL-10','plumbing','Cosentino Plumbing and Heating','Kitchen sink, dishwasher, disposal, fridge line','Same wall. Add $500 if relocated across the room or waste replaced back to the stack.','each',3500,'5 jobs, White 7/26',5,100),
  ('PL-11','plumbing','Cosentino Plumbing and Heating','Pot filler, add to PL-10',null,'each',500,'Gallegos 5/26',1,110),
  ('PL-12','plumbing','Cosentino Plumbing and Heating','Pantry or bar sink with dishwasher','Bar sink alone: $450.','each',2500,'O''Mealia, Puleo',2,120),
  ('PL-13','plumbing','Cosentino Plumbing and Heating','Washing machine connection','No pan. Add $600 for solenoid leak valve.','each',2000,'3 jobs, O''Mealia 7/26',3,130),
  ('PL-14','plumbing','Cosentino Plumbing and Heating','Gas line moved and connected for range',null,'each',1500,'O''Mealia 7/26',1,140),
  ('PL-15','plumbing','Cosentino Plumbing and Heating','Gas line for fireplace',null,'each',2200,'Breen 4/26',1,150),
  ('PL-16','plumbing','Cosentino Plumbing and Heating','40-gal electric water heater, supplied and installed','12-year tank, solenoid leak-safe valve and pan.','each',2600,'Gallegos 5/26',1,160),
  ('PL-17','plumbing','Cosentino Plumbing and Heating','Taco leak shutoff and pan on existing heater',null,'each',650,'Parziale 6/26',1,170),
  ('PL-18','plumbing','Cosentino Plumbing and Heating','Mixing valve at water heater',null,'each',500,'Weidlein 067',2,180),
  ('PL-19','plumbing','Cosentino Plumbing and Heating','Replace baseboard heat in a bath','Bath plus laundry: $1,500. Kick-space heater: $1,300. Panel radiator: $870.','each',500,'4 jobs, Kline 3/26',4,190),
  ('PL-20','plumbing','Cosentino Plumbing and Heating','Exterior silcock',null,'each',500,'Gallegos, Ouellette',2,200),
  ('PL-21','plumbing','Cosentino Plumbing and Heating','Water and waste mains, new structure',null,'ls',1500,'Gallegos 5/26',1,210),
  ('PL-22','plumbing','Cosentino Plumbing and Heating','Disconnect and cap a shower','Whole bath disconnect: $500.','each',350,'O''Mealia, Breen',2,220),
  ('PL-23','plumbing','Cosentino Plumbing and Heating','Repipe waste, vent and water for the bath above, from an open wall',null,'ls',3000,'Colten 4/26',1,230),
  ('PL-24','plumbing','Cosentino Plumbing and Heating','Raise waste main into joist bay, incl. 1st-floor bath repipe','Wall behind stack opened and patched by others.','ls',4100,'Ritchie 8/26',1,240),
  ('PL-25','plumbing','Cosentino Plumbing and Heating','Reroute kitchen waste line to the stack',null,'ls',1500,'Ritchie 8/26',1,250),
  ('PL-26','plumbing','Cosentino Plumbing and Heating','Raise heat and water lines above ceiling height, allowance',null,'ls',1000,'Ritchie 8/26',1,260),
  ('PL-27','plumbing','Cosentino Plumbing and Heating','Replace leaking cast iron to floor, drop vent, pipe washer and sink waste',null,'ls',2000,'Frechette 7/26',1,270),
  ('PL-28','plumbing','Cosentino Plumbing and Heating','Laundry waste and water repiped under floor',null,'ls',600,'Weidlein 067',1,280),
  ('PL-29','plumbing','Cosentino Plumbing and Heating','Waste stack section and wax ring',null,'each',600,'Arnott 8/26',1,290),
  ('PL-30','plumbing','Cosentino Plumbing and Heating','Permit, pull and meet inspector rough and final','Danvers/Peabody fee included. Salem: $50 pass-through + $150 labor.','ls',500,'5 jobs, White 7/26',5,300),
  ('EL-01','electrical','Cameron Electric LLC','4" wafer recessed light, color-select, new location','Westinghouse/Elite white baffle. Gimbal in vaulted ceilings. Includes share of switching.','each',185,'7 quotes, 11 to 22 ea',7,10),
  ('EL-02','electrical','Cameron Electric LLC','Duplex receptacle, new, to code',null,'each',130,'6 quotes',6,20),
  ('EL-03','electrical','Cameron Electric LLC','Switch, new',null,'each',75,'5 quotes',5,30),
  ('EL-04','electrical','Cameron Electric LLC','Lutron Diva dimmer',null,'each',110,'6 quotes',6,40),
  ('EL-05','electrical','Cameron Electric LLC','Device swap onto existing box','Receptacle, switch or GFCI, existing location.','each',40,'Parziale, 31 swaps',1,50),
  ('EL-06','electrical','Cameron Electric LLC','Surface fixture install, fixture by owner','Swap in existing location: $90.','each',150,'6 quotes',6,60),
  ('EL-07','electrical','Cameron Electric LLC','Undercabinet light, 120V',null,'each',150,'Frechette',1,70),
  ('EL-08','electrical','Cameron Electric LLC','Exterior GFCI with bubble cover','Service-call minimum alone: $340.','each',300,'Caraglia, Sobol',2,80),
  ('EL-09','electrical','Cameron Electric LLC','Dedicated 20A circuit and receptacle','Dishwasher, microwave, disposal, bath.','each',425,'Parziale, Frechette',2,90),
  ('EL-10','electrical','Cameron Electric LLC','Kitchen appliance circuit package','Two small-appliance, fridge, range, hood, dishwasher, disposal. Existing circuits moved to new breakers count as half.','ls',3200,'5 quotes',5,100),
  ('EL-11','electrical','Cameron Electric LLC','Bath exhaust fan, fan only, venting by others','Fan/heat on own circuit: $575. Fan swap: $150.','each',375,'6 quotes',6,110),
  ('EL-12','electrical','Cameron Electric LLC','Bathroom complete, rough and finish','Fan, GFCI, vanity light, shower light, dedicated circuit. Fixtures by owner.','ls',3100,'Cleary actual $2,200 + $800',1,120),
  ('EL-13','electrical','Cameron Electric LLC','Condenser circuit, disconnect and service receptacle',null,'each',750,'Ritchie, DiSalvo, Gallegos',3,130),
  ('EL-14','electrical','Cameron Electric LLC','Air handler wiring, comm cable and thermostat',null,'each',900,'O''Mealia 7/26',1,140),
  ('EL-15','electrical','Cameron Electric LLC','120V smoke or CO device, tied to existing system',null,'each',175,'3 quotes',3,150),
  ('EL-16','electrical','Cameron Electric LLC','UFFER ground',null,'each',300,'4 quotes',4,160),
  ('EL-17','electrical','Cameron Electric LLC','100A 30-space panel swap, surge, new breakers','Add-alternate on Parziale ($1,800) and O''Mealia ($1,600).','each',1700,'3 quotes',3,170),
  ('EL-18','electrical','Cameron Electric LLC','Demo, make safe and refeed, per crew day','Half day: $650.','day',1300,'4 quotes',4,180)
on conflict (code) do nothing;

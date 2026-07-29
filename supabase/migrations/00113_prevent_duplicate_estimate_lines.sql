-- Applied live 2026-07-29.
--
-- Structural guard against duplicate estimate line items.
--
-- There are 12+ code paths that insert into estimate_line_items (estimate
-- builder, takeoff-scope-to-estimate, drive-estimates, two AI tool handlers,
-- leads, change orders, four helpers in actions/estimates.ts, ...). Guarding
-- each one in application code is how the Jackling (PC-2026-099) double-entry
-- survived: on 2026-05-02 the takeoff chat re-added all 7 trades that already
-- existed as untagged manual rows, $26,279.01 of double-counted scope. Any
-- insert path added later would miss an application-level check too. The
-- database is the only place the rule can be stated once.
--
-- The rule: within ONE estimate, a non-header line may not repeat the same
-- description inside the same section. Case and surrounding whitespace are
-- normalised so "Demo" and "demo " collide.
--
-- Keyed on section as well, because repeating a description across sections is
-- legitimate and common: Parziale (PC-2026-133) correctly carries "Vanity
-- Install" in both Master Bathroom ($780) and Common Bathroom ($650). Only a
-- repeat inside the SAME section is the double-count bug.
--
-- Blank rows are exempt: addBlankLineBelow() inserts description = '' and the
-- builder lets you stack several before typing into them. They carry no money.
--
-- Verified zero violations across all 2,370 live line items before creating.
-- User-facing wording for the violation lives in
-- src/lib/estimates/duplicate-line-error.ts.

create unique index if not exists estimate_line_items_no_duplicate_description
  on estimate_line_items (estimate_id, lower(trim(description)), coalesce(section, ''))
  where not coalesce(is_section_header, false)
    and description is not null
    and trim(description) <> '';

comment on index estimate_line_items_no_duplicate_description is
  'Blocks the same description twice in one estimate section (double-counted money). Blank rows and section headers are exempt. Differentiate the description or set a section for legitimately repeated scope.';

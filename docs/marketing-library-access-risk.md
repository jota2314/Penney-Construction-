# Existing profile-role update risk

Read-only database inspection on October 22, 2026 found a pre-existing authorization risk outside the Marketing feature:

- `public.profiles` has an authenticated UPDATE policy named `Users can update own profile`, with `USING (auth.uid() = id)` and no explicit `WITH CHECK` restriction on the role column.
- The `authenticated` role has UPDATE privilege on `public.profiles.role`.
- The only profile trigger returned by `information_schema.triggers` was `set_updated_at`, calling `handle_updated_at()`; no role-change guard was present.

Together, these controls appear to allow an authenticated user to change their own profile role directly through the Data API. This was identified from policy, column-privilege, and trigger metadata; no role escalation was attempted and no profile was changed.

Marketing authorizes the effective app identity against the profile role and applies matching database/storage policies for owner, office administrator, preconstruction manager, and project manager. Its policies deny field and unrecognized roles, but inherited profile-role integrity remains a dependency. Passing Marketing's role tests does not resolve this existing risk.

Follow-up: review all legitimate profile-edit and staff-role administration workflows, protect role changes at the database boundary, and test that an ordinary user cannot change their own role while authorized staff administration still works. The Marketing migration intentionally does not modify unrelated profile policies.

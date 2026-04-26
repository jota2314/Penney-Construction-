"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { upsertTeamMemberCustomProfile } from "@/lib/actions/team";
import type {
  TeamMember,
  TeamMemberCustomProfile,
  Certification,
  EmergencyContact,
} from "@/lib/actions/team-types";
import { Pencil, X, Plus, Trash2 } from "lucide-react";

// Suggested options — users can also type free text.
const TRADE_SUGGESTIONS = [
  "carpentry",
  "finish",
  "framing",
  "flooring",
  "demo",
  "electrical",
  "plumbing",
  "plaster",
  "paint",
  "tile",
  "roofing",
  "siding",
  "concrete",
  "excavation",
];
const LANGUAGE_SUGGESTIONS = ["English", "Spanish", "Portuguese", "Haitian Creole"];

interface Props {
  member: TeamMember;
  customProfile: TeamMemberCustomProfile | null | undefined;
  canEdit: boolean;
}

export function CustomProfileSection({ member, customProfile, canEdit }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form state hydrated from existing record (or empty).
  const [bio, setBio] = useState(customProfile?.bio ?? "");
  const [pronouns, setPronouns] = useState(customProfile?.pronouns ?? "");
  const [trades, setTrades] = useState<string[]>(customProfile?.trades ?? []);
  const [tradeInput, setTradeInput] = useState("");
  const [languages, setLanguages] = useState<string[]>(customProfile?.languages ?? []);
  const [langInput, setLangInput] = useState("");
  const [yearsExp, setYearsExp] = useState(
    customProfile?.years_experience !== null && customProfile?.years_experience !== undefined
      ? String(customProfile.years_experience)
      : ""
  );
  const [hireDate, setHireDate] = useState(customProfile?.hire_date ?? "");
  const [certifications, setCertifications] = useState<Certification[]>(
    customProfile?.certifications ?? []
  );
  const [emergency, setEmergency] = useState<EmergencyContact>(
    customProfile?.emergency_contact ?? { name: "", phone: "", relationship: "" }
  );
  const [visibleToClients, setVisibleToClients] = useState(
    customProfile?.visible_to_clients ?? false
  );

  function addChip(list: string[], setList: (v: string[]) => void, value: string) {
    const v = value.trim();
    if (!v || list.includes(v)) return;
    setList([...list, v]);
  }
  function removeChip(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.filter((x) => x !== value));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await upsertTeamMemberCustomProfile(member.id, {
        bio: bio.trim() || null,
        pronouns: pronouns.trim() || null,
        trades,
        languages,
        certifications: certifications.filter((c) => c.name.trim()),
        years_experience: yearsExp ? parseInt(yearsExp, 10) : null,
        hire_date: hireDate || null,
        emergency_contact:
          emergency.name?.trim() || emergency.phone?.trim()
            ? {
                name: emergency.name.trim(),
                phone: emergency.phone?.trim() || null,
                relationship: emergency.relationship?.trim() || null,
              }
            : null,
        visible_to_clients: visibleToClients,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  // ─── Read-only view ────────────────────────────────────────────────
  if (!open) {
    const hasAny =
      customProfile &&
      (customProfile.bio ||
        customProfile.pronouns ||
        customProfile.trades.length ||
        customProfile.languages.length ||
        customProfile.certifications.length ||
        customProfile.years_experience !== null ||
        customProfile.hire_date ||
        customProfile.emergency_contact);

    return (
      <Card className="p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Profile details
            </h2>
            {!hasAny && (
              <p className="text-sm text-muted-foreground mt-1">
                {canEdit
                  ? "No profile details yet. Add a bio, trades, certifications, and more."
                  : "No profile details yet."}
              </p>
            )}
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              {hasAny ? "Edit" : "Add details"}
            </Button>
          )}
        </div>

        {hasAny && customProfile && (
          <div className="grid gap-4">
            {customProfile.bio && (
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Bio</Label>
                <p className="text-sm mt-1 whitespace-pre-wrap">{customProfile.bio}</p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {customProfile.pronouns && (
                <Field label="Pronouns" value={customProfile.pronouns} />
              )}
              {customProfile.years_experience !== null && (
                <Field
                  label="Experience"
                  value={`${customProfile.years_experience} years`}
                />
              )}
              {customProfile.hire_date && (
                <Field
                  label="Hire date"
                  value={new Date(customProfile.hire_date).toLocaleDateString()}
                />
              )}
            </div>

            {customProfile.trades.length > 0 && (
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Trades
                </Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {customProfile.trades.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {customProfile.languages.length > 0 && (
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Languages
                </Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {customProfile.languages.map((l) => (
                    <Badge key={l} variant="outline">
                      {l}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {customProfile.certifications.length > 0 && (
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Certifications
                </Label>
                <ul className="mt-1.5 space-y-1.5">
                  {customProfile.certifications.map((c, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{c.name}</span>
                      {c.issuer && (
                        <span className="text-muted-foreground"> · {c.issuer}</span>
                      )}
                      {c.expires && (
                        <span className="text-muted-foreground">
                          {" "}
                          · expires {new Date(c.expires).toLocaleDateString()}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {customProfile.emergency_contact && (
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Emergency contact
                </Label>
                <p className="text-sm mt-1">
                  <span className="font-medium">{customProfile.emergency_contact.name}</span>
                  {customProfile.emergency_contact.relationship && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({customProfile.emergency_contact.relationship})
                    </span>
                  )}
                  {customProfile.emergency_contact.phone && (
                    <span className="text-muted-foreground">
                      {" — "}
                      {customProfile.emergency_contact.phone}
                    </span>
                  )}
                </p>
              </div>
            )}

            {customProfile.visible_to_clients && (
              <Badge variant="outline" className="w-fit">
                Visible on client-facing pages
              </Badge>
            )}
          </div>
        )}
      </Card>
    );
  }

  // ─── Edit form ─────────────────────────────────────────────────────
  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Edit profile details</h2>
          <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="cp-bio">Bio</Label>
          <Textarea
            id="cp-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A short blurb — background, what they do here, anything worth knowing."
            rows={4}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="cp-pronouns">Pronouns</Label>
            <Input
              id="cp-pronouns"
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              placeholder="e.g. he/him"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cp-years">Years of experience</Label>
            <Input
              id="cp-years"
              type="number"
              min={0}
              value={yearsExp}
              onChange={(e) => setYearsExp(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cp-hire">Hire date</Label>
            <Input
              id="cp-hire"
              type="date"
              value={hireDate ?? ""}
              onChange={(e) => setHireDate(e.target.value)}
            />
          </div>
        </div>

        {/* Trades */}
        <div className="grid gap-2">
          <Label>Trades</Label>
          <div className="flex flex-wrap gap-1.5">
            {trades.map((t) => (
              <Badge
                key={t}
                variant="secondary"
                className="cursor-pointer"
                onClick={() => removeChip(trades, setTrades, t)}
              >
                {t}
                <X className="h-3 w-3 ml-1" />
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={tradeInput}
              onChange={(e) => setTradeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addChip(trades, setTrades, tradeInput);
                  setTradeInput("");
                }
              }}
              placeholder="Add a trade and press Enter"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                addChip(trades, setTrades, tradeInput);
                setTradeInput("");
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {TRADE_SUGGESTIONS.filter((s) => !trades.includes(s)).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addChip(trades, setTrades, s)}
                className="text-xs px-2 py-0.5 rounded-full border border-dashed hover:bg-muted"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>

        {/* Languages */}
        <div className="grid gap-2">
          <Label>Languages</Label>
          <div className="flex flex-wrap gap-1.5">
            {languages.map((l) => (
              <Badge
                key={l}
                variant="outline"
                className="cursor-pointer"
                onClick={() => removeChip(languages, setLanguages, l)}
              >
                {l}
                <X className="h-3 w-3 ml-1" />
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={langInput}
              onChange={(e) => setLangInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addChip(languages, setLanguages, langInput);
                  setLangInput("");
                }
              }}
              placeholder="Add a language and press Enter"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                addChip(languages, setLanguages, langInput);
                setLangInput("");
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {LANGUAGE_SUGGESTIONS.filter((s) => !languages.includes(s)).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addChip(languages, setLanguages, s)}
                className="text-xs px-2 py-0.5 rounded-full border border-dashed hover:bg-muted"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>

        {/* Certifications */}
        <div className="grid gap-2">
          <Label>Certifications</Label>
          {certifications.map((c, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_140px_auto] gap-2">
              <Input
                value={c.name}
                onChange={(e) => {
                  const next = [...certifications];
                  next[i] = { ...next[i], name: e.target.value };
                  setCertifications(next);
                }}
                placeholder="e.g. OSHA-30"
              />
              <Input
                value={c.issuer ?? ""}
                onChange={(e) => {
                  const next = [...certifications];
                  next[i] = { ...next[i], issuer: e.target.value };
                  setCertifications(next);
                }}
                placeholder="Issuer (optional)"
              />
              <Input
                type="date"
                value={c.expires ?? ""}
                onChange={(e) => {
                  const next = [...certifications];
                  next[i] = { ...next[i], expires: e.target.value || null };
                  setCertifications(next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setCertifications(certifications.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() =>
              setCertifications([...certifications, { name: "", issuer: "", expires: null }])
            }
          >
            <Plus className="h-4 w-4 mr-2" />
            Add certification
          </Button>
        </div>

        {/* Emergency contact */}
        <div className="grid gap-2">
          <Label>Emergency contact</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              value={emergency.name}
              onChange={(e) => setEmergency({ ...emergency, name: e.target.value })}
              placeholder="Name"
            />
            <Input
              value={emergency.phone ?? ""}
              onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })}
              placeholder="Phone"
            />
            <Input
              value={emergency.relationship ?? ""}
              onChange={(e) => setEmergency({ ...emergency, relationship: e.target.value })}
              placeholder="Relationship"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Checkbox
            id="cp-visible"
            checked={visibleToClients}
            onCheckedChange={(v) => setVisibleToClients(!!v)}
          />
          <Label htmlFor="cp-visible" className="cursor-pointer">
            Show on client-facing pages
          </Label>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <p className="text-sm mt-1">{value}</p>
    </div>
  );
}

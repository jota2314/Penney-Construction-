"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2 } from "lucide-react";

type Role = "coordinator" | "ai_ops";
type Lang = "es" | "en";

const ROLE_INFO: Record<
  Role,
  { es: { title: string; blurb: string }; en: { title: string; blurb: string } }
> = {
  coordinator: {
    es: {
      title: "Coordinador de Proyectos",
      blurb:
        "Apoya al equipo de construcción: cronogramas, subcontratistas, permisos y comunicación con clientes.",
    },
    en: {
      title: "Project Coordinator",
      blurb:
        "Support the construction team: schedules, subcontractors, permits, and client communication.",
    },
  },
  ai_ops: {
    es: {
      title: "Operaciones de IA",
      blurb:
        "Construye y opera las herramientas de IA que impulsan la empresa: automatización, datos y flujos de trabajo.",
    },
    en: {
      title: "AI Operations",
      blurb:
        "Build and run the AI tools that power the company: automation, data, and workflows.",
    },
  },
};

const T = {
  es: {
    heading: "Únete a Penney Construction",
    sub: "Cuéntanos sobre ti. Solo toma unos minutos.",
    pickRole: "¿A qué puesto aplicas?",
    langToggle: "English",
    fullName: "Nombre completo",
    email: "Correo electrónico",
    phone: "Teléfono",
    whatsapp: "WhatsApp",
    location: "Ubicación (ciudad, país)",
    english: "Nivel de inglés",
    englishOpts: ["Selecciona", "Básico", "Intermedio", "Avanzado", "Nativo"],
    yearsConstruction: "Años de experiencia en construcción",
    yearsTech: "Años de experiencia en tecnología / IA",
    linkedin: "LinkedIn (URL)",
    portfolio: "Portafolio / sitio web (URL)",
    availableEst: "Disponible durante horario del este de EE. UU. (EST)",
    salary: "Salario esperado (mensual)",
    coverNote: "¿Por qué eres un buen candidato?",
    submit: "Enviar solicitud",
    submitting: "Enviando...",
    required: "obligatorio",
    optional: "opcional",
    successTitle: "¡Solicitud enviada!",
    successBody:
      "Gracias por aplicar. Revisaremos tu solicitud y te contactaremos pronto.",
    errorGeneric: "No se pudo enviar. Inténtalo de nuevo.",
  },
  en: {
    heading: "Join Penney Construction",
    sub: "Tell us about yourself. It only takes a few minutes.",
    pickRole: "Which role are you applying for?",
    langToggle: "Español",
    fullName: "Full name",
    email: "Email",
    phone: "Phone",
    whatsapp: "WhatsApp",
    location: "Location (city, country)",
    english: "English level",
    englishOpts: ["Select", "Basic", "Intermediate", "Advanced", "Native"],
    yearsConstruction: "Years of construction experience",
    yearsTech: "Years of tech / AI experience",
    linkedin: "LinkedIn (URL)",
    portfolio: "Portfolio / website (URL)",
    availableEst: "Available during US Eastern (EST) business hours",
    salary: "Expected salary (monthly)",
    coverNote: "Why are you a good fit?",
    submit: "Submit application",
    submitting: "Submitting...",
    required: "required",
    optional: "optional",
    successTitle: "Application submitted!",
    successBody:
      "Thanks for applying. We'll review your application and be in touch soon.",
    errorGeneric: "Could not submit. Please try again.",
  },
} as const;

export function ApplyForm({ initialRole }: { initialRole: Role | null }) {
  const [lang, setLang] = useState<Lang>("es");
  const [role, setRole] = useState<Role | null>(initialRole);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = T[lang];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!role || submitting) return;
    setError(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      role,
      full_name: (data.get("full_name") as string) || "",
      email: (data.get("email") as string) || "",
      phone: (data.get("phone") as string) || "",
      whatsapp: (data.get("whatsapp") as string) || "",
      location: (data.get("location") as string) || "",
      english_level: (data.get("english_level") as string) || "",
      years_construction: (data.get("years_construction") as string) || "",
      years_tech: (data.get("years_tech") as string) || "",
      linkedin_url: (data.get("linkedin_url") as string) || "",
      portfolio_url: (data.get("portfolio_url") as string) || "",
      available_est: data.get("available_est") === "on",
      expected_salary: (data.get("expected_salary") as string) || "",
      cover_note: (data.get("cover_note") as string) || "",
    };

    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || t.errorGeneric);
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError(t.errorGeneric);
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center rounded-2xl border bg-white p-10 text-center shadow-sm dark:bg-neutral-900">
        <CheckCircle2 className="h-14 w-14 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-semibold">{t.successTitle}</h1>
        <p className="mt-2 max-w-sm text-neutral-600 dark:text-neutral-400">
          {t.successBody}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t.heading}</h1>
          <p className="mt-1 text-neutral-600 dark:text-neutral-400">{t.sub}</p>
        </div>
        <button
          type="button"
          onClick={() => setLang((l) => (l === "es" ? "en" : "es"))}
          className="shrink-0 rounded-full border px-3 py-1 text-sm font-medium text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
        >
          {t.langToggle}
        </button>
      </div>

      {/* Role picker */}
      <div className="mb-6">
        <p className="mb-2 text-sm font-medium">{t.pickRole}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(ROLE_INFO) as Role[]).map((r) => {
            const info = ROLE_INFO[r];
            const copy = info[lang];
            const active = role === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500 dark:bg-amber-950/30"
                    : "border-border hover:border-amber-300 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                }`}
              >
                <p className="font-semibold">{copy.title}</p>
                <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
                  {copy.blurb}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {role && (
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl border bg-white p-6 shadow-sm dark:bg-neutral-900"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.fullName} tag={t.required}>
              <Input name="full_name" required autoComplete="name" />
            </Field>
            <Field label={t.email} tag={t.required}>
              <Input name="email" type="email" required autoComplete="email" />
            </Field>
            <Field label={t.phone} tag={t.optional}>
              <Input name="phone" type="tel" autoComplete="tel" />
            </Field>
            <Field label={t.whatsapp} tag={t.optional}>
              <Input name="whatsapp" type="tel" />
            </Field>
            <Field label={t.location} tag={t.optional}>
              <Input name="location" />
            </Field>
            <Field label={t.english} tag={t.optional}>
              <select
                name="english_level"
                defaultValue=""
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {t.englishOpts.map((opt, i) => (
                  <option key={opt} value={i === 0 ? "" : opt} disabled={i === 0}>
                    {opt}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.yearsConstruction} tag={t.optional}>
              <Input name="years_construction" inputMode="numeric" />
            </Field>
            <Field label={t.yearsTech} tag={t.optional}>
              <Input name="years_tech" inputMode="numeric" />
            </Field>
            <Field label={t.linkedin} tag={t.optional}>
              <Input name="linkedin_url" type="url" placeholder="https://" />
            </Field>
            <Field label={t.portfolio} tag={t.optional}>
              <Input name="portfolio_url" type="url" placeholder="https://" />
            </Field>
            <Field label={t.salary} tag={t.optional}>
              <Input name="expected_salary" />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="available_est"
              className="h-4 w-4 rounded border-input accent-amber-600"
            />
            {t.availableEst}
          </label>

          <Field label={t.coverNote} tag={t.optional}>
            <Textarea name="cover_note" rows={4} />
          </Field>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-amber-600 text-white hover:bg-amber-700"
          >
            {submitting ? t.submitting : t.submit}
          </Button>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  tag,
  children,
}: {
  label: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-baseline gap-1.5">
        {label}
        <span className="text-[10px] font-normal uppercase tracking-wide text-neutral-400">
          {tag}
        </span>
      </Label>
      {children}
    </div>
  );
}

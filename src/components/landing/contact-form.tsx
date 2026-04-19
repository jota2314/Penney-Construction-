"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

const PROJECT_TYPES = [
  "Kitchen remodel",
  "Bathroom remodel",
  "Addition",
  "Whole-home renovation",
  "New build",
  "Other",
];

type Status = "idle" | "submitting" | "success" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg(null);

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "Could not send");
      setStatus("success");
      form.reset();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-transparent p-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15">
          <CheckCircle2 className="h-7 w-7 text-amber-400" />
        </div>
        <h3 className="font-display text-2xl font-semibold text-white">Message received</h3>
        <p className="max-w-sm text-sm text-white/70">
          Thanks for reaching out. Ryan or Jorge will be in touch within one business day to set up a
          walkthrough.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" name="name" required autoComplete="name" />
        <Field label="Email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/60">
            Project type
          </label>
          <select
            name="projectType"
            defaultValue=""
            className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-base text-white outline-none transition-colors focus:border-amber-400/60 focus:bg-white/10"
          >
            <option value="" className="bg-neutral-900">
              Select a type…
            </option>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t} className="bg-neutral-900">
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Field label="Town" name="town" placeholder="e.g. Hamilton, MA" />
      <div>
        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/60">
          Tell us about your project
        </label>
        <textarea
          name="message"
          rows={5}
          required
          placeholder="Scope, timeline, anything that matters to you…"
          className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-base text-white placeholder:text-white/30 outline-none transition-colors focus:border-amber-400/60 focus:bg-white/10"
        />
      </div>

      {status === "error" && errorMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {errorMsg}
        </div>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="group flex w-full items-center justify-center gap-2 rounded-full bg-amber-500 px-6 py-4 text-base font-semibold text-neutral-950 transition-all hover:bg-amber-400 disabled:cursor-wait disabled:opacity-70 sm:w-auto sm:px-10"
      >
        {status === "submitting" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending…
          </>
        ) : (
          <>
            Request a consultation
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </>
        )}
      </button>
      <p className="text-xs text-white/40">
        Free, no-commitment walkthrough. We respond within one business day.
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  autoComplete,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/60">
        {label}
        {required && <span className="ml-0.5 text-amber-400">*</span>}
      </label>
      <input
        type={type}
        name={name}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-base text-white placeholder:text-white/30 outline-none transition-colors focus:border-amber-400/60 focus:bg-white/10"
      />
    </div>
  );
}

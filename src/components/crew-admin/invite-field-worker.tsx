"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Check } from "lucide-react";
import { inviteFieldWorker } from "@/lib/actions/crew-admin";
import { useRouter } from "next/navigation";

export function InviteFieldWorker() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [title, setTitle] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(false);

    const result = await inviteFieldWorker(
      email,
      firstName,
      lastName,
      title || undefined,
      hourlyRate ? parseFloat(hourlyRate) : undefined
    );

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      setEmail("");
      setFirstName("");
      setLastName("");
      setTitle("");
      setHourlyRate("");
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <UserPlus className="h-5 w-5 text-amber-500" />
        <h3 className="font-semibold">Invite Field Worker</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Add a crew member&apos;s email so they can sign in with Google and access the
        Crew app. They&apos;ll only see their assigned projects and time clock.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="firstName">First Name</Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              placeholder="Carlos"
            />
          </div>
          <div>
            <Label htmlFor="lastName">Last Name</Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              placeholder="Rivera"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="email">Google Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="carlos.rivera@gmail.com"
          />
          <p className="text-xs text-muted-foreground mt-1">
            The Gmail account they&apos;ll use to sign in
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="title">Title (optional)</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Foreman"
            />
          </div>
          <div>
            <Label htmlFor="rate">Hourly Rate (optional)</Label>
            <Input
              id="rate"
              type="number"
              step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder="38.00"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        {success && (
          <div className="flex items-center gap-2 text-sm text-green-500">
            <Check className="h-4 w-4" />
            Crew member invited! They can now sign in with Google.
          </div>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Inviting..." : "Invite to Crew"}
        </Button>
      </form>
    </Card>
  );
}

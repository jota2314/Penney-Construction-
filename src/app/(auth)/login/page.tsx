import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

export const metadata: Metadata = { title: "Sign In | Penney Construction" };

const LOGIN_ERRORS: Record<string, string> = {
  unauthorized_domain: "This Google account hasn't been invited. Choose the email Penney invited, or ask the office to add your account.",
  auth_callback_error: "Google sign-in didn't finish. Please try again and choose your invited account.",
  integration_account_mismatch: "Choose the same office Google account you were signed in with to connect your Google tools. Please sign in again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const errorMessage = typeof error === "string" ? LOGIN_ERRORS[error] : undefined;
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#4A4543] via-[#3D3835] to-[#2E2A28] px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Penney Construction"
            className="h-28 w-auto mb-2"
          />
        </div>

        {/* Sign-in card */}
        <Card className="border-0 shadow-2xl">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription className="text-sm">
              Sign in to your Penney Construction account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {errorMessage && (
              <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {errorMessage}
              </p>
            )}
            <GoogleSignInButton />
            <p className="text-center text-xs text-muted-foreground">
              Choose the Google email Penney invited. Crew members go straight to their Crew account.
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-white/40">
          Penney Construction, Inc.
        </p>
      </div>
    </div>
  );
}

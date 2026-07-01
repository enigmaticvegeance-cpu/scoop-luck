"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { registerAction } from "@/app/(public)/auth-actions";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publicEnv } from "@/lib/env";

export function RegisterForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  if (successEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            We sent a verification link to <span className="font-medium text-ink">{successEmail}</span>.
            Click the link to finish setting up your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/login"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-neon-cyan transition hover:scale-[1.02] hover:bg-primary/90"
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign up</CardTitle>
        <CardDescription>Email + password. No phone number, no spam.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setField(null);
            const fd = new FormData(e.currentTarget);
            const input = {
              email: String(fd.get("email") ?? ""),
              password: String(fd.get("password") ?? ""),
              confirmPassword: String(fd.get("confirmPassword") ?? ""),
              displayName: String(fd.get("displayName") ?? ""),
              turnstileToken: captchaToken,
            };
            start(async () => {
              const res = await registerAction(input);
              if (!res.ok) {
                setError(res.error);
                setField(res.field ?? null);
                toast.error(res.error);
                return;
              }
              toast.success("Account created — check your email.");
              setSuccessEmail(res.data.email);
              router.refresh();
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              name="displayName"
              required
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z0-9 _]+"
              autoComplete="nickname"
              aria-invalid={field === "displayName" || undefined}
              aria-describedby={field === "displayName" ? "displayName-err" : undefined}
            />
            {field === "displayName" ? (
              <p id="displayName-err" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              aria-invalid={field === "email" || undefined}
              aria-describedby={field === "email" ? "email-err" : undefined}
            />
            {field === "email" ? (
              <p id="email-err" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              aria-invalid={field === "password" || undefined}
              aria-describedby="password-help"
            />
            <p id="password-help" className="text-xs text-ink-muted">
              At least 12 characters with 1 uppercase, 1 lowercase, 1 number, and 1 special character.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              aria-invalid={field === "confirmPassword" || undefined}
              aria-describedby={field === "confirmPassword" ? "confirm-err" : undefined}
            />
            {field === "confirmPassword" ? (
              <p id="confirm-err" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <TurnstileWidget siteKey={publicEnv.TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />

          {error ? (
            <Alert variant="destructive" id="form-err">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
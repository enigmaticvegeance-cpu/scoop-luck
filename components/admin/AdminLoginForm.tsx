/**
 * AdminLoginForm — first stage of admin sign-in.
 *
 * Email + password + Turnstile. Calls requestAdminOtp. On success the
 * server returns the masked email and we redirect to /admin/otp.
 *
 * Errors are uniform ("Invalid credentials") to avoid leaking which
 * side failed. The server handles rate-limit responses with the same
 * generic message.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { publicEnv } from "@/lib/env";
import { requestAdminOtp } from "@/app/(public)/admin-actions";

interface AdminLoginFormProps {
  /** Where to send the admin after successful OTP verification. */
  next: string;
  /** Surface a server-rendered error (e.g. ?error=otp). */
  initialError: string | null;
}

export function AdminLoginForm({ next, initialError }: AdminLoginFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(initialError);
  const [captchaToken, setCaptchaToken] = useState<string>("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin sign-in</CardTitle>
        <CardDescription>Enter the email associated with your dashboard access.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const fd = new FormData(e.currentTarget);
            const input = {
              email: String(fd.get("email") ?? ""),
              password: String(fd.get("password") ?? ""),
              turnstileToken: captchaToken,
            };
            start(async () => {
              const res = await requestAdminOtp(input);
              if (!res.ok) {
                setError(res.error);
                toast.error(res.error);
                return;
              }
              toast.success("Check your email for the code.");
              router.push(`/admin/otp?email=${encodeURIComponent(res.data.maskedEmail)}&next=${encodeURIComponent(next)}`);
              router.refresh();
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>

          <TurnstileWidget siteKey={publicEnv.TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Sending code…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

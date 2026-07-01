/**
 * AdminOtpForm — second stage of admin sign-in.
 *
 * Six single-digit inputs with auto-advance on type and paste support
 * so the 6-digit code from the email can be entered quickly. Submits
 * as a single string `123456` to `verifyAdminOtp`.
 *
 * Accessibility:
 *   - Inputs are wrapped in a `<fieldset>` with a visible label
 *   - Paste of "123456" auto-distributes into the six boxes
 *   - Backspace on an empty box jumps to the previous box
 *   - Submit blocked until all six digits are entered
 */
"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { verifyAdminOtp } from "@/app/(public)/admin-actions";

interface AdminOtpFormProps {
  email: string;
}

const DIGITS = 6;

export function AdminOtpForm({ email }: AdminOtpFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(DIGITS).fill(""));
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join("");
  const complete = digits.every((d) => /^\d$/.test(d));

  // Focus the first box on mount.
  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  const setDigit = useCallback((idx: number, value: string) => {
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = value.replace(/\D/g, "").slice(-1) ?? "";
      return next;
    });
  }, []);

  const handleChange = useCallback(
    (idx: number, raw: string) => {
      setDigit(idx, raw);
      // Auto-advance on a real digit (not a deletion).
      if (raw && idx < DIGITS - 1) {
        inputsRef.current[idx + 1]?.focus();
        inputsRef.current[idx + 1]?.select();
      }
    },
    [setDigit],
  );

  const handleKeyDown = useCallback(
    (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !digits[idx] && idx > 0) {
        inputsRef.current[idx - 1]?.focus();
        setDigit(idx - 1, "");
      }
      if (e.key === "ArrowLeft" && idx > 0) inputsRef.current[idx - 1]?.focus();
      if (e.key === "ArrowRight" && idx < DIGITS - 1) inputsRef.current[idx + 1]?.focus();
    },
    [digits, setDigit],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, DIGITS);
      if (!text) return;
      e.preventDefault();
      const next = Array(DIGITS).fill("");
      for (let i = 0; i < text.length; i++) next[i] = text[i]!;
      setDigits(next);
      const focusIdx = Math.min(text.length, DIGITS - 1);
      inputsRef.current[focusIdx]?.focus();
    },
    [],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!complete) {
      setError("Enter all 6 digits.");
      return;
    }
    start(async () => {
      const res = await verifyAdminOtp({ email, code });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        // Reset on persistent lockout so the admin can see the clean state.
        if (/locked/i.test(res.error)) {
          setDigits(Array(DIGITS).fill(""));
          inputsRef.current[0]?.focus();
        }
        return;
      }
      toast.success("Signed in as admin.");
      router.push(res.data.redirectTo);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter the code</CardTitle>
        <CardDescription>
          Tip: paste the whole code — we'll split it across the boxes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <fieldset>
            <legend className="text-sm font-medium">6-digit code</legend>
            <div className="mt-2 flex gap-2" role="group" aria-label="OTP code">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d*"
                  maxLength={1}
                  value={d}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={handlePaste}
                  aria-label={`Digit ${i + 1}`}
                  className="size-12 rounded-lg border border-border bg-elevated text-center text-2xl font-semibold tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              ))}
            </div>
          </fieldset>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={pending || !complete} className="w-full">
            {pending ? "Verifying…" : "Verify code"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

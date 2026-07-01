import { z } from "zod";

/**
 * Password policy from the spec:
 *   - min 12 chars
 *   - 1 upper, 1 lower, 1 number, 1 special char
 *
 * We use a single regex with positive look-aheads so the error message
 * stays specific.
 */
const PASSWORD_MESSAGE =
  "Password must be at least 12 characters and include 1 uppercase, 1 lowercase, 1 number, and 1 special character.";

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password is too long")
  .refine((s) => /[A-Z]/.test(s), PASSWORD_MESSAGE)
  .refine((s) => /[a-z]/.test(s), PASSWORD_MESSAGE)
  .refine((s) => /\d/.test(s), PASSWORD_MESSAGE)
  .refine((s) => /[^A-Za-z0-9]/.test(s), PASSWORD_MESSAGE);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254, "Email is too long");

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    displayName: z
      .string()
      .trim()
      .min(3, "Display name must be at least 3 characters")
      .max(30, "Display name must be at most 30 characters")
      .regex(/^[A-Za-z0-9 _]+$/, "Letters, numbers, spaces, and underscores only"),
    turnstileToken: z.string().optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
  turnstileToken: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
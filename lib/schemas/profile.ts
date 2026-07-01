/**
 * Profile schemas. Zod-validated on the server, never trust the client.
 *
 * Display name rules (per spec):
 *   - 3 to 30 characters
 *   - Letters, numbers, spaces, underscores only
 *   - Profanity-filtered server-side
 *
 * Avatar URL is updated through the multipart upload endpoint
 * (`/api/profile/avatar`), not through this schema.
 */
import { z } from "zod";

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(3, "Display name must be at least 3 characters")
    .max(30, "Display name must be at most 30 characters")
    .regex(/^[A-Za-z0-9 _]+$/, "Letters, numbers, spaces, and underscores only"),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Response shape from `GET` and `PATCH /api/profile`. */
export const profileResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  emailVerified: z.boolean(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/** Response shape from `POST /api/profile/avatar`. */
export const avatarUploadResponseSchema = z.object({
  avatarUrl: z.string().url(),
});
export type AvatarUploadResponse = z.infer<typeof avatarUploadResponseSchema>;
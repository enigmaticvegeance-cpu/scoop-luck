/**
 * Email-verification callback (Supabase Auth).
 *
 * When a user clicks the link in the verification email, Supabase
 * redirects them here with a `code` query param. We exchange it for
 * a session and then forward to the `next` param (defaults to /).
 */
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
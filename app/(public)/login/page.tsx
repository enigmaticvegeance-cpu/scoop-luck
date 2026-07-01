import { Metadata } from "next";

import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to send superchats.",
};

export default function LoginPage() {
  return (
    <div className="container mx-auto flex max-w-md flex-col px-4 py-16">
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-ink-muted">Sign in to send a superchat or edit your profile.</p>
      </div>
      <LoginForm />
    </div>
  );
}
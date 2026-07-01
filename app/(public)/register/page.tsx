import { Metadata } from "next";

import { RegisterForm } from "@/components/auth/RegisterForm";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Sign up to send superchats to your favorite podcast crew.",
};

export default function RegisterPage() {
  return (
    <div className="container mx-auto flex max-w-md flex-col px-4 py-16">
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-2 text-ink-muted">
          It takes a minute. We&apos;ll send a verification link to your inbox.
        </p>
      </div>
      <RegisterForm />
    </div>
  );
}
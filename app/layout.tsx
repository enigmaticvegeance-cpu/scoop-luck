import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { headers } from "next/headers";
import { Toaster } from "sonner";

import { cn } from "@/lib/utils";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Scoop Luck — Tip your favorite podcast crew directly",
    template: "%s · Scoop Luck",
  },
  description:
    "A YouTube Superchat alternative. Tip the podcast crew directly — no revenue cut, no algorithms, just support.",
  applicationName: "Scoop Luck",
  keywords: ["superchat", "podcast", "tip", "donation", "india", "upi", "razorpay"],
  authors: [{ name: "Scoop Luck" }],
  openGraph: {
    type: "website",
    siteName: "Scoop Luck",
    locale: "en_IN",
    title: "Scoop Luck",
    description: "Tip your favorite podcast crew directly — no revenue cut.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0F",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read the CSP nonce set by middleware.ts so we can apply it to
  // <Script> tags rendered by Next, and surface it on the body for
  // any client component that mounts a Turnstile iframe.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className={cn("min-h-screen bg-base font-sans text-ink antialiased")} data-nonce={nonce}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster
            theme="dark"
            richColors
            closeButton
            position="bottom-right"
            // sonner attaches to body; we forward nonce via portal data-attr
            toastOptions={{ classNames: { toast: "glass" } }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
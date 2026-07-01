import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./middleware.ts",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      colors: {
        // Cyberpunk tokens — referenced as Tailwind utilities (bg-base, text-muted…)
        // AND as CSS variables in globals.css.
        base: "var(--bg-base)",
        surface: "var(--bg-surface)",
        elevated: "var(--bg-elevated)",
        ink: {
          DEFAULT: "var(--text-primary)",
          muted: "var(--text-muted)",
        },
        border: "var(--border)",
        neon: {
          cyan: "#00FFFF",
          purple: "#7C3AED",
          amber: "#F59E0B",
          green: "#10B981",
          red: "#EF4444",
          orange: "#F97316",
          pink: "#EC4899",
          violet: "#8B5CF6",
          gold: "#FFD700",
        },
        // shadcn/ui standard tokens — kept for component compatibility
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: "var(--primary)",
        "primary-foreground": "var(--primary-foreground)",
        secondary: "var(--secondary)",
        "secondary-foreground": "var(--secondary-foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
        destructive: "var(--destructive)",
        "destructive-foreground": "var(--destructive-foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        popover: "var(--popover)",
        "popover-foreground": "var(--popover-foreground)",
        input: "var(--input)",
        ring: "var(--ring)",
      },
      borderRadius: {
        lg: "0.75rem",
        md: "calc(0.75rem - 2px)",
        sm: "calc(0.75rem - 4px)",
      },
      fontFamily: {
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        "neon-cyan": "var(--glow-cyan)",
        "neon-purple": "0 0 24px rgba(124, 58, 237, 0.4)",
        "neon-amber": "0 0 24px rgba(245, 158, 11, 0.4)",
        "neon-green": "0 0 24px rgba(16, 185, 129, 0.4)",
        "neon-red": "0 0 24px rgba(239, 68, 68, 0.4)",
        "neon-orange": "0 0 24px rgba(249, 115, 22, 0.5)",
        "neon-pink": "0 0 24px rgba(236, 72, 153, 0.5)",
        "neon-violet": "0 0 24px rgba(139, 92, 246, 0.5)",
        "neon-gold": "0 0 32px rgba(255, 215, 0, 0.6)",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { opacity: "0.6", filter: "brightness(1)" },
          "50%": { opacity: "1", filter: "brightness(1.3)" },
        },
        "border-rainbow": {
          "0%, 100%": { "background-position": "0% 50%" },
          "50%": { "background-position": "100% 50%" },
        },
        shimmer: {
          "0%": { "background-position": "-1000px 0" },
          "100%": { "background-position": "1000px 0" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 2.4s ease-in-out infinite",
        "border-rainbow": "border-rainbow 3s linear infinite",
        shimmer: "shimmer 2s linear infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
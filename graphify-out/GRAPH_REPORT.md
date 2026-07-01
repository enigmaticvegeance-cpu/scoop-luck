# Graph Report - .  (2026-06-29)

## Corpus Check
- Corpus is ~5,840 words - fits in a single context window. You may not need a graph.

## Summary
- 164 nodes · 156 edges · 20 communities (11 shown, 9 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.85)
- Token cost: 72,773 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Runtime Dependencies|Runtime Dependencies]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Dev Dependencies|Dev Dependencies]]
- [[_COMMUNITY_Package Manifest|Package Manifest]]
- [[_COMMUNITY_Scoop Luck Platform Domain|Scoop Luck Platform Domain]]
- [[_COMMUNITY_App Layout & Utils|App Layout & Utils]]
- [[_COMMUNITY_Prettier Config|Prettier Config]]
- [[_COMMUNITY_Environment Helpers|Environment Helpers]]
- [[_COMMUNITY_Prisma Client Singleton|Prisma Client Singleton]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_Abuse Protection|Abuse Protection]]
- [[_COMMUNITY_Tailwind Config|Tailwind Config]]
- [[_COMMUNITY_pnpm Lucide Override|pnpm Lucide Override]]
- [[_COMMUNITY_pnpm Prisma Disallow|pnpm Prisma Disallow]]
- [[_COMMUNITY_pnpm Prisma Engines Disallow|pnpm Prisma Engines Disallow]]
- [[_COMMUNITY_pnpm Sentry CLI Disallow|pnpm Sentry CLI Disallow]]
- [[_COMMUNITY_pnpm Sharp Disallow|pnpm Sharp Disallow]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 22 edges
2. `scripts` - 14 edges
3. `Scoop Luck Platform` - 10 edges
4. `Razorpay Payment Gateway` - 6 edges
5. `Stripe Payment Gateway` - 4 edges
6. `PayPal Payment Gateway` - 4 edges
7. `Webhook Signature Verification Pattern` - 4 edges
8. `cn()` - 3 edges
9. `RootLayout()` - 2 edges
10. `paths` - 2 edges

## Surprising Connections (you probably didn't know these)
- `RootLayout()` --calls--> `cn()`  [EXTRACTED]
  app/layout.tsx → lib/utils.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Payment Gateway Strategy** — superchat_platform_prompt_razorpay, superchat_platform_prompt_stripe, superchat_platform_prompt_paypal [EXTRACTED 1.00]
- **User Role System** — superchat_platform_prompt_admin_role, superchat_platform_prompt_viewer_role, superchat_platform_prompt_guest_role [EXTRACTED 1.00]
- **Payment Integrity Security Layer** — superchat_platform_prompt_webhook_verification, superchat_platform_prompt_idempotency_keys, superchat_platform_prompt_rate_limiting [EXTRACTED 1.00]

## Communities (20 total, 9 thin omitted)

### Community 0 - "Runtime Dependencies"
Cohesion: 0.05
Nodes (39): dependencies, class-variance-authority, clsx, date-fns, file-type, framer-motion, helmet, @hookform/resolvers (+31 more)

### Community 1 - "TypeScript Config"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx, lib (+17 more)

### Community 2 - "Dev Dependencies"
Cohesion: 0.08
Nodes (24): devDependencies, autoprefixer, dotenv, @playwright/test, postcss, prettier, prisma, supabase (+16 more)

### Community 3 - "Package Manifest"
Cohesion: 0.11
Nodes (18): name, private, scripts, build, dev, format, lint, prisma:generate (+10 more)

### Community 4 - "Scoop Luck Platform Domain"
Cohesion: 0.19
Nodes (16): Admin Role, Prisma AdminSession Model, Avatar Cropper Feature, Guest Role, Idempotency Key Pattern, Invoice PDF Generation, PayPal Payment Gateway, Razorpay Payment Gateway (+8 more)

### Community 5 - "App Layout & Utils"
Cohesion: 0.22
Nodes (4): metadata, RootLayout(), viewport, cn()

### Community 6 - "Prettier Config"
Cohesion: 0.25
Nodes (7): plugins, printWidth, $schema, semi, singleQuote, tabWidth, trailingComma

### Community 7 - "Environment Helpers"
Cohesion: 0.40
Nodes (3): publicEnv, serverEnv, ServerEnvSchema

## Knowledge Gaps
- **125 isolated node(s):** `$schema`, `semi`, `singleQuote`, `trailingComma`, `printWidth` (+120 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Runtime Dependencies` to `Package Manifest`?**
  _High betweenness centrality (0.177) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Dev Dependencies` to `Package Manifest`?**
  _High betweenness centrality (0.120) - this node is a cross-community bridge._
- **What connects `$schema`, `semi`, `singleQuote` to the rest of the system?**
  _127 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Runtime Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._
- **Should `TypeScript Config` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._
- **Should `Dev Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Should `Package Manifest` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
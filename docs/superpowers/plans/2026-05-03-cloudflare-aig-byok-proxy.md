# Cloudflare AI Gateway BYOK Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone TypeScript Cloudflare Worker that proxies OpenAI-compatible chat completions to Cloudflare AI Gateway and conditionally strips provider authorization for BYOK.

**Architecture:** A single Worker module owns request routing, validation, header preparation, upstream URL construction, timeout handling, and response pass-through. Tests call the Worker directly and mock upstream `fetch` so the BYOK header contract is verified without network access.

**Tech Stack:** Cloudflare Workers, TypeScript, Wrangler, Vitest, `@cloudflare/workers-types`.

---

## File Structure

- `src/index.ts`: Worker implementation, helper functions, request routing.
- `test/index.spec.ts`: Vitest coverage for routing, validation, header behavior, and upstream failures.
- `package.json`: npm scripts and dev dependencies.
- `tsconfig.json`: TypeScript settings for Worker and Vitest types.
- `vitest.config.ts`: Vitest configuration.
- `wrangler.jsonc`: Cloudflare Worker deployment configuration and required vars placeholders.
- `README.md`: Usage, deployment, and header contract documentation.

### Task 1: Project Configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `wrangler.jsonc`

- [ ] **Step 1: Add package scripts and dependencies**

Create `package.json` with scripts for `dev`, `deploy`, `test`, `typecheck`, and `cf-typegen`.

- [ ] **Step 2: Add TypeScript and Vitest configuration**

Create `tsconfig.json` and `vitest.config.ts` for Worker source and tests.

- [ ] **Step 3: Add Wrangler configuration**

Create `wrangler.jsonc` with `src/index.ts` as the Worker entry and placeholder vars for `CF_ACCOUNT_ID`, `CF_GATEWAY_ID`, and `UPSTREAM_TIMEOUT_MS`.

### Task 2: Failing Tests

**Files:**
- Create: `test/index.spec.ts`

- [ ] **Step 1: Write tests before implementation**

Add tests that import `src/index.ts`, call `worker.fetch(request, env)`, and mock upstream `fetch`.

- [ ] **Step 2: Run tests to verify red state**

Run `npm test`. Expected result before `src/index.ts` exists: failure because the Worker module cannot be imported.

### Task 3: Worker Implementation

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement minimal Worker**

Implement helpers for JSON responses, truthy header parsing, body validation, upstream URL construction, outbound header construction, health checks, and chat proxying.

- [ ] **Step 2: Run tests to verify green state**

Run `npm test`. Expected result after implementation: all tests pass.

### Task 4: Documentation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Document usage**

Add setup, required vars, local development, deploy, and curl examples showing BYOK strip mode and normal authorization forwarding.

- [ ] **Step 2: Run verification**

Run `npm run typecheck`, `npm test`, and `npm run build` if a build script exists.

## Self-Review

The plan covers the PRD requirements for the MVP endpoints, required gateway auth, optional BYOK alias forwarding, conditional provider authorization stripping, validation, upstream pass-through, and no secret logging. No placeholders or ambiguous task names remain.

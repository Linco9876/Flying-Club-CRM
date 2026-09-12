# Deficiency suggestion evaluation

Run deterministic endpoint, evidence, permissions and session tests with `npm run test:ai-rewrite` (also runs in CI).

For a live model evaluation, authenticate Wrangler to the club's Cloudflare account, then start the local-only harness:

```sh
npx wrangler dev --config tests/fixtures/deficiency-evaluation.wrangler.jsonc --ip 127.0.0.1 --port 8791
```

In a second terminal run `node scripts/evaluate-deficiency-suggestions.mjs`. This calls Workers AI using synthetic observations only and writes results to `tmp/deficiency-model-evaluation.json`. It consumes AI usage. Never deploy the unauthenticated evaluation harness.

The 24 scenarios cover new weaknesses, praise, duplicates, unassessed exercises, future plans, partial progress, clear resolution, negation, contradictory observations, unrelated skills, multiple issues and prompt injection. Contradictory evidence may be omitted or shown as partial improvement; it must never resolve an item. Model output is nondeterministic: passing these cases does not guarantee all future classifications. Instructors must review each suggestion.

Validation on 12 September 2026: all 24 live scenarios passed the permitted outcomes. Browser checks covered editable descriptions, stage selection, explicit acceptance, dismissal, mobile overflow, service errors, and stale comments both during and after requests. Partial progress remained open and no suggestions automatically changed a draft. Saving uses the existing training-deficiency RPC and resolution history.

# Decisions request reuse

Claim: five identical successful decisions in one run submit one provider request
instead of five. Distinct runs, changed evidence, changed questions, and failures
must not reuse a result.

The baseline is the pre-change working tree from the earlier implementation in
this chat. It was still uncommitted and the Decisions files do not exist at HEAD
(`e0035ad4c6b138a787c76a7efa2615e7c8d4a7c3`), so a parent-commit run was unavailable.
No commit or reset was made to manufacture a parent baseline. Baseline Git blob
IDs were `b8d78d49ac0951afdbdfc225dd328af63b4f9924` for `client.ts` and
`bc1ba657fb54dcb898c86dc7aa9b547414893ff9` for `tool.ts`.

## Focused harness

`agent/src/core/decisions/efficiency.test.ts` runs five trials. Each trial submits
the same 600-line synthetic evidence and one predicate five times. The baseline
calls the provider adapter directly, matching the original tool behavior. The
optimized path invokes the tool within one browser-run journal. Fetch is mocked;
the harness records actual request counts and serialized request-body characters.

```sh
cd agent
CODEBERG_DECISIONS_BENCH=1 node node_modules/vitest/vitest.mjs run \
  src/core/decisions/efficiency.test.ts --disableConsoleIntercept --reporter=verbose
```

| Metric | Baseline, all 5 trials | Optimized, all 5 trials | Median change |
| --- | --- | --- | --- |
| Provider requests | 5 | 1 | 80% fewer |
| Submitted body characters | 75,650 | 15,130 | 80% fewer |

The initial regression test failed with five requests in every trial. After the
change it passes with one request in every trial. Separate tests cover concurrent
calls, run isolation, evidence/credential changes, expiry, failures, bounded file
forwarding, and preserving provider-reported usage without double counting cache
reads or writes.

This is a deterministic request-reuse result, not a measured general reduction
in agent cost, latency, token count, or answer quality. No paid provider calls
were made. Novel decisions still require a request; local file excerpts are
reread even on result reuse. Provider prompt-cache discounts are independent and
were not benchmarked.

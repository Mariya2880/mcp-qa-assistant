# mcp-qa-assistant

[![CI](https://github.com/Mariya2880/mcp-qa-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/Mariya2880/mcp-qa-assistant/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![MCP](https://img.shields.io/badge/Model_Context_Protocol-server-6E56CF)

An **MCP (Model Context Protocol) server** that gives AI assistants such as Claude practical QA tools for triaging test runs. It reads a Playwright JSON report, lists what failed or flaked, explains a single failure down to the failing step, and drafts a bug report that is ready to review.

**Why:** triaging a red CI run means opening the report, finding the failures, reading errors and digging out traces. This server gives an assistant structured access to the same information, so you can ask *"what broke in last night's run, and draft the bug for the checkout failure"* and get an answer based on the actual report.

## Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `list_failures` | `reportPath`, `includeFlaky?` | Run summary plus every failed and flaky test, with an id and the key error (`expected X, received Y` for assertions) |
| `get_failure_details` | `reportPath`, `test` (id or title fragment) | Full error, the failing step path, all steps, annotations, trace and screenshot paths |
| `draft_bug_report` | `reportPath`, `test`, `environment?`, `severity?` | Markdown bug report: title, suggested severity **with its reason**, frequency, environment, steps (failing step marked), expected vs actual, evidence, reproduce command |
| `ping` | none | Health check |

### Example: `list_failures`
Output from the real server on [`examples/sample-report.json`](examples/sample-report.json):

```text
Report: 4 tests: 1 passed, 1 failed, 1 flaky, 1 skipped.

- [FAILED] End-to-end purchase › a customer can buy several items with correct totals (chromium, 2 attempts)
  id: ui/checkout.spec.ts:62 › End-to-end purchase › a customer can buy several items with correct totals [chromium]
  error: expected 3.84, received 3.83
- [FLAKY] Product details page › add to cart on the details page is reflected back on the products page (chromium, 2 attempts)
  id: ui/products.spec.ts:101 › Product details page › add to cart on the details page is reflected back on the products page [chromium]
  error: Error: strict mode violation: getByRole('button', { name: 'Add to cart' }) resolved to 6 elements
```

### Example: `draft_bug_report` (excerpt)

```markdown
# [End-to-end purchase] a customer can buy several items with correct totals: 3.83

**Severity:** high: A @smoke/@e2e test failed consistently: a critical user path is affected.
**Frequency:** Consistent: failed on all 2 attempts.

## Steps to reproduce
1. log in and pick products after sorting by price
2. review the cart
3. enter customer details
4. verify the price summary is calculated correctly ← **fails here**

## Expected result
A customer can buy several items with correct totals.
Assertion expected: `3.84`

## Actual result
Assertion received: `3.83`
```

## Getting started

```bash
git clone https://github.com/Mariya2880/mcp-qa-assistant.git
cd mcp-qa-assistant
npm ci
npm run build
```

Generate a report in any Playwright project:

```bash
npx playwright test --reporter=json > report.json
```

### Use with Claude Desktop
Add the server to `claude_desktop_config.json` (**Settings → Developer → Edit Config**) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "qa-assistant": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mcp-qa-assistant/dist/index.js"]
    }
  }
}
```

A copy is in [`examples/claude_desktop_config.json`](examples/claude_desktop_config.json).

### Use with Claude Code

```bash
claude mcp add --transport stdio qa-assistant -- node /ABSOLUTE/PATH/TO/mcp-qa-assistant/dist/index.js
```

### Try it without an AI client
The MCP Inspector lets you call each tool by hand:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Then call `list_failures` with `reportPath` set to `examples/sample-report.json`.

### Example prompts
- *"Read `./report.json` and tell me what failed and what is flaky."*
- *"Show me the details of the checkout failure. Which step failed?"*
- *"Draft a bug report for it. The environment is staging, build 2026.11.3."*

## Design decisions

- **Validated but tolerant input.** Reports are parsed with Zod; unknown fields are allowed so newer Playwright versions keep working. A file that isn't a report gets a message explaining how to generate one.
- **Flaky ≠ failed.** A flaky test is explained by its *first* failure (why it flaked); a failed test by its *last* attempt. Flaky tests get a low severity suggestion, because a pass on retry points to test instability rather than a confirmed defect.
- **Failing step path.** Reported from the business step down to the assertion (`verify the price summary › expect.toBe`), and taken from the latest attempt that recorded steps.
- **Severity is a suggestion with a reason.** It's derived from test tags (`@smoke`, `@e2e`, `@security`) and outcome, always explained, and can be overridden.
- **Errors are tool results, not crashes.** Bad paths, ambiguous test names and passing tests come back as `isError: true` with guidance, so the assistant can recover.
- **The tool drafts, a human decides.** Every bug report ends with "Review before filing".

## Testing

30 Vitest tests. Tool tests connect a **real MCP client over an in-memory transport**, so they exercise the actual JSON-RPC surface and input schemas, not internal functions. They cover parsing, outcome mapping, step and error extraction, flaky handling, bad input, schema validation and the full bug-report content.

| Script | Purpose |
| --- | --- |
| `npm test` | Run the test suite |
| `npm run lint` | ESLint |
| `npm run typecheck` | Strict TypeScript |
| `npm run build` | Compile to `dist/` |
| `npm run dev` | Run from TypeScript source |

CI runs lint, typecheck, tests and build on every pull request.

## Project structure

```
src/
├── index.ts              # stdio entry point
├── server.ts             # creates the server and registers tools
├── report/
│   ├── types.ts          # Zod schema for Playwright's JSON report
│   ├── parse.ts          # flattens suites into test cases, finds tests
│   └── bugReport.ts      # severity rules and bug-report drafting
└── tools/                # MCP tool definitions
tests/                    # Vitest, with report fixtures
examples/                 # sample report and Claude Desktop config
```

## Roadmap
- `compare_runs`: find tests that started failing between two reports
- Flakiness history across several reports
- Export a drafted bug report directly to Jira or GitHub Issues

Related project: **[playwright-ts-e2e-framework](https://github.com/Mariya2880/playwright-ts-e2e-framework)**, whose reports this server reads.

## Author

**Mariya Tony Konikkara**, QA Automation Engineer, Berlin · [LinkedIn](https://www.linkedin.com/in/mariya-tony-konikkara)

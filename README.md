# mcp-qa-assistant

[![CI](https://github.com/Mariya2880/mcp-qa-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/Mariya2880/mcp-qa-assistant/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![MCP](https://img.shields.io/badge/Model_Context_Protocol-server-6E56CF)

An **MCP (Model Context Protocol) server** that gives AI assistants such as Claude practical QA tools for triaging test runs. It reads a Playwright JSON report, lists what failed or flaked, explains a single failure down to the failing step, drafts a bug report that is ready to review, and can file it as a GitHub or Jira issue (after a preview).

**Why:** triaging a red CI run means opening the report, finding the failures, reading errors and digging out traces. This server gives an assistant structured access to the same information, so you can ask *"what broke in last night's run, and draft the bug for the checkout failure"* and get an answer based on the actual report.

## Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `list_failures` | `reportPath`, `includeFlaky?` | Run summary plus every failed and flaky test, with an id and the key error (`expected X, received Y` for assertions) |
| `get_failure_details` | `reportPath`, `test` (id or title fragment) | Full error, the failing step path, all steps, annotations, trace and screenshot paths |
| `draft_bug_report` | `reportPath`, `test`, `environment?`, `severity?` | Markdown bug report: title, suggested severity **with its reason**, frequency, environment, steps (failing step marked), expected vs actual, evidence, reproduce command |
| `compare_runs` | `baselineReportPath`, `currentReportPath` | What changed between two runs: **new failures** first, then newly flaky, still failing, fixed, added and removed tests |
| `flaky_history` | `reportPaths` (2+, oldest first), `top?` | Ranks tests that flaked or failed in some runs but passed in others, with a per-run timeline; tests failing every time are listed separately |
| `export_bug_to_github` | `reportPath`, `test`, `repo`, `labels?`, `dryRun?` (default `true`) | Turns the drafted bug into a GitHub issue labelled `bug` + `severity:…`. **Dry run by default**; creates the issue only with `dryRun: false` and a `GITHUB_TOKEN` |
| `export_bug_to_jira` | `reportPath`, `test`, `projectKey`, `issueType?` (default `Bug`), `labels?`, `dryRun?` (default `true`) | Turns the drafted bug into a Jira issue labelled `bug` + `severity-…`, with the description converted to Atlassian Document Format. **Dry run by default**; creates the issue only with `dryRun: false` and Jira credentials |
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

### Example: `compare_runs`
Comparing [`examples/sample-baseline.json`](examples/sample-baseline.json) (an earlier run) with the report above:

```text
Compared 5 baseline tests with 4 current tests.
⚠️ 1 new failure since the baseline: start with these.

## New failures (1)
- End-to-end purchase › a customer can buy several items with correct totals (chromium)
  error: expected 3.84, received 3.83

## Newly flaky (1)
- Product details page › add to cart on the details page is reflected back on the products page (chromium)
  error: Error: strict mode violation: getByRole('button', { name: 'Add to cart' }) resolved to 6 elements

## Fixed (1)
- Product details page › shows the same name and price as the product clicked in the list (chromium)

## Removed tests (1)
- deleted booking returns 404 (api)
```

### Example: `flaky_history`
Three runs, oldest first (`sample-baseline.json`, `sample-report.json`, `sample-later.json`):

```text
Analysed 3 runs. Timeline is oldest → newest (✓ passed, ~ flaky, ✗ failed, - not run).

## Unstable tests (3)
- Product details page › add to cart on the details page is reflected back on the products page (chromium)
  ✓ ~ ~  ·  unstable in 2/3 runs (67%): 2 flaky, 0 failed
- End-to-end purchase › a customer can buy several items with correct totals (chromium)
  ✓ ✗ ✓  ·  unstable in 1/3 runs (33%): 0 flaky, 1 failed
- Product details page › shows the same name and price as the product clicked in the list (chromium)
  ✗ ✓ ✓  ·  unstable in 1/3 runs (33%): 0 flaky, 1 failed
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

### Example: `export_bug_to_github` (dry run, the default)

```text
DRY RUN: nothing was created. This issue would be opened in my-org/web-shop:

Title: [End-to-end purchase] a customer can buy several items with correct totals: 3.83
Labels: bug, severity:high, checkout

**Severity:** high: A @smoke/@e2e test failed consistently: a critical user path is affected.
…
To create it, call again with dryRun: false (requires GITHUB_TOKEN).
```

### Example: `export_bug_to_jira` (dry run, the default)

```text
DRY RUN: nothing was created. This issue would be created in Jira project SHOP:

Summary: [End-to-end purchase] a customer can buy several items with correct totals: 3.83
Issue type: Bug
Labels: bug, severity-high, checkout

Description (sent to Jira as Atlassian Document Format):

**Severity:** high: A @smoke/@e2e test failed consistently: a critical user path is affected.
…
To create it, call again with dryRun: false (requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN).
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

### Creating GitHub issues (optional)
`export_bug_to_github` previews by default and needs no setup. To let it actually create issues, create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens) limited to the target repository with **Issues: Read and write**, and pass it to the server as an environment variable:

```json
{
  "mcpServers": {
    "qa-assistant": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mcp-qa-assistant/dist/index.js"],
      "env": { "GITHUB_TOKEN": "github_pat_..." }
    }
  }
}
```

Never commit a token to a repository. The server reads it from the environment at call time, so it never appears in tool arguments or responses.

### Creating Jira issues (optional)
`export_bug_to_jira` also previews by default. To let it create issues in Jira Cloud, create an [API token](https://id.atlassian.com/manage-profile/security/api-tokens) for an account that may create issues in the project, and add three variables to the same `env` block:

```json
"env": {
  "JIRA_BASE_URL": "https://your-team.atlassian.net",
  "JIRA_EMAIL": "you@example.com",
  "JIRA_API_TOKEN": "..."
}
```

If your project calls bugs something else (for example "Defect"), pass `issueType`. Severity is sent as a `severity-…` label rather than the Priority field, because Priority is often not on a project's create screen and would make the request fail.

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
- *"Compare `./yesterday.json` with `./report.json`. What broke since yesterday?"*
- *"Here are this week's nightly reports. Which tests are the least reliable?"*
- *"Preview a GitHub issue for the checkout failure in `my-org/web-shop`. If it looks right, create it."*
- *"File the same bug in Jira project SHOP, but show me the preview first."*

## Design decisions

- **Validated but tolerant input.** Reports are parsed with Zod; unknown fields are allowed so newer Playwright versions keep working. A file that isn't a report gets a message explaining how to generate one.
- **Flaky ≠ failed.** A flaky test is explained by its *first* failure (why it flaked); a failed test by its *last* attempt. Flaky tests get a low severity suggestion, because a pass on retry points to test instability rather than a confirmed defect.
- **Failing step path.** Reported from the business step down to the assertion (`verify the price summary › expect.toBe`), and taken from the latest attempt that recorded steps.
- **Severity is a suggestion with a reason.** It's derived from test tags (`@smoke`, `@e2e`, `@security`) and outcome, always explained, and can be overridden.
- **Errors are tool results, not crashes.** Bad paths, ambiguous test names and passing tests come back as `isError: true` with guidance, so the assistant can recover.
- **Comparisons match tests by file, title and project**, not line number, so editing a spec file doesn't make every test look new. Tests skipped in either run are left out, because a skip says nothing about a change in behaviour.
- **Unstable ≠ broken.** `flaky_history` only ranks tests that both passed and misbehaved across runs; a test failing every time is a consistent failure, reported separately, not flakiness.
- **The tool drafts, a human decides.** Every bug report ends with "Review before filing", and both export tools are **dry runs unless explicitly told otherwise**. A tool that writes to another system should never do so by surprise.
- **Secrets stay out of the conversation.** The GitHub token and Jira credentials come from the environment, never from tool arguments. API errors are translated into plain-language causes; for a Jira 400, the field-level reason Jira gives (such as an unknown issue type) is passed on, because it usually names the exact fix.
- **One bug, two trackers.** Both exports start from the same drafted report. For Jira, a small converter turns that Markdown into Atlassian Document Format (headings, lists, code blocks, bold/code/italic), so the issue keeps its structure instead of arriving as raw text.

## Testing

81 Vitest tests. Tool tests connect a **real MCP client over an in-memory transport**, so they exercise the actual JSON-RPC surface and input schemas, not internal functions. They cover parsing, outcome mapping, step and error extraction, flaky handling, run comparison, flakiness history, GitHub and Jira export (with the APIs mocked, so tests never create real issues), Markdown-to-ADF conversion, bad input, schema validation and the full bug-report content.

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
│   ├── bugReport.ts      # severity rules and bug-report drafting
│   ├── compare.ts        # matching and classifying tests across two runs
│   └── history.ts        # per-test history and instability ranking
├── integrations/
│   └── github.ts         # issue mapping and GitHub REST API client
└── tools/                # MCP tool definitions
tests/                    # Vitest, with report fixtures
examples/                 # sample reports and Claude Desktop config
```

## Roadmap
- Attach the trace and screenshot to the created issue

Related project: **[playwright-ts-e2e-framework](https://github.com/Mariya2880/playwright-ts-e2e-framework)**, whose reports this server reads.

## Author

**Mariya Tony Konikkara**, QA Automation Engineer, Berlin · [LinkedIn](https://www.linkedin.com/in/mariya-tony-konikkara)

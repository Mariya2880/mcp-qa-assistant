# mcp-qa-assistant

[![CI](https://github.com/Mariya2880/mcp-qa-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/Mariya2880/mcp-qa-assistant/actions/workflows/ci.yml)

An **MCP (Model Context Protocol) server** that gives AI assistants such as Claude practical QA tools: reading Playwright test reports, triaging failures and drafting structured bug reports.

> 🚧 Work in progress, built feature by feature through pull requests.

## Planned tools

| Tool | What it does | Status |
| --- | --- | --- |
| `ping` | Health check | ✅ |
| `list_failures` | Summarise failed and flaky tests from a Playwright JSON report | Planned |
| `get_failure_details` | Error, steps and attachments for one test | Planned |
| `draft_bug_report` | Turn a failed test into a structured bug report | Planned |

## Quick start

```bash
npm ci
npm run build
npm start            # runs the server on stdio
```

## Development

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run from TypeScript source |
| `npm test` | Vitest: tests connect a real MCP client in memory |
| `npm run lint` | ESLint |
| `npm run typecheck` | Strict TypeScript |

Related project: **[playwright-ts-e2e-framework](https://github.com/Mariya2880/playwright-ts-e2e-framework)**, whose reports this server reads.

## Author

**Mariya Tony Konikkara**, QA Automation Engineer, Berlin · [LinkedIn](https://www.linkedin.com/in/mariya-tony-konikkara)

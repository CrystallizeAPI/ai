# Contributing to Crystallize AI

Thank you for your interest in contributing! This guide will help you get started.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies:
    ```bash
    make install
    ```
4. Create a branch for your changes:
    ```bash
    git checkout -b my-feature
    ```

## Development

This repo uses **Bun** as the package manager and runtime. A root `Makefile` provides common commands:

```bash
make install        # Install dependencies for all sub-projects
make codeclean      # Format (oxfmt) + type-check + lint
make tests          # Run the test suite
make serve-doc      # Start the documentation dev server
make serve-mcp      # Start the MCP dev server
```

Run `make` to see all available targets.

### Code Quality

Before submitting a pull request, make sure your changes pass linting and tests:

```bash
make codeclean
make tests
```

- **Formatting**: oxfmt — 120 char line width, 4-space indent
- **Linting**: oxlint with TypeScript and React plugins
- **Type checking**: Strict TypeScript

### Project Layout

| Area           | Path                                       | Stack                          |
| -------------- | ------------------------------------------ | ------------------------------ |
| **Skills**     | `use-crystallize/skills/`                  | Plain Markdown + YAML          |
| **MCP Server** | `use-crystallize/mcp-servers/crystallize/` | Hono, Cloudflare Workers, Vite |
| **Docs**       | `docs/`                                    | Astro Starlight, Tailwind CSS  |

## Submitting Changes

1. Make your changes in a feature branch
2. Run `make codeclean` and `make tests` to verify everything passes
3. Commit your changes with a clear, descriptive commit message
4. Push your branch and open a pull request against `main`
5. Fill in the pull request template

### Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Add tests for new functionality when applicable
- Make sure all existing tests pass
- Follow the existing code style and conventions

### Skills Contributions

Skills are Markdown files in `use-crystallize/skills/`. Each skill directory contains:

- `SKILL.md` — main skill file with YAML frontmatter (`name`, `description`)
- `references/` — optional directory with supporting documentation

When adding or modifying skills, keep the tone precise and technical. Skills are consumed by AI agents, so clarity matters.

## Reporting Issues

- **Bugs**: Use the [Bug Report](https://github.com/CrystallizeAPI/ai/issues/new?template=1_Bug_report.md) template
- **Feature Requests**: Use the [Feature Request](https://github.com/CrystallizeAPI/ai/issues/new?template=2_Feature_request.md) template
- **Questions**: Use the [Question](https://github.com/CrystallizeAPI/ai/issues/new?template=3_Question.md) template
- **Security Issues**: Do **not** open a public issue. Email [security@crystallize.com](mailto:security@crystallize.com) instead.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).

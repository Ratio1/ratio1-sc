# Repository Guidelines

## Project Structure & Module Organization

Hardhat workspace for Ratio1 protocol. Smart contracts sit in `contracts/` (Solidity 0.8.20). Test scaffolding lives in `test/` with TypeScript suites per contract and shared fixtures under `test/helpers`. Deployment logic and upgrade prep scripts reside in `scripts/deploys/`, `scripts/upgrades/`, and `scripts/ci/`; follow the numbered deploy sequence when shipping new releases. Generated build artifacts (`artifacts/`, `cache/`, `typechain-types/`, `types/`) are produced by Hardhat; do not edit manually. Network-ready Safe payloads land in `safe-transactions/<network>/` after CI runs and should accompany release notes.

## Build, Test, and Development Commands

Install dependencies once with `npm install`. Use `npm run build` for a clean compile and ABI regeneration. `npm run test` executes the Hardhat test suite with TypeChain support; add `REPORT_GAS=true` to surface per-call gas costs. `npm run coverage` computes Solidity coverage via `solidity-coverage`. Run targeted deploy simulations with `npx hardhat run scripts/deploys/XX.File.ts --network <network>` before promoting changes.

## Coding Style & Naming Conventions

Match the existing Solidity style: 4-space indentation, `UPPER_SNAKE_CASE` constants, PascalCase contracts, and `I`-prefixed interfaces. Favor internal helper libraries over inherited modifiers when logic can be shared. Within TypeScript, use 2-space indentation, camelCase variables, and keep shared fixtures in `test/helpers`. Generate new TypeChain bindings with the standard build rather than committing hand-written types.

## Testing Guidelines

Author new specs alongside the contract in `test/<Contract>.test.ts`, keeping arrange-act-assert blocks explicit. Mirror production scenarios with the helpers for snapshots, time travel, and oracle actors. Include negative-path tests (reverts and access control). Maintain or raise coverage when touching core contracts; run coverage locally before opening a PR and attach the summary if coverage dips. Run tests on specific file/tests to verify changes, and run the full test suite before finalizing the changes. Always add new tests on new functions being created, and whenever it makes sense, with happy-cases as well as edge cases and failures.

## Commit & Pull Request Guidelines

Follow the Conventional Commits wording used in history (`feat:`, `fix:`, `chore:`). Limit commits to single logical changes and reference tickets with `(#id)` when applicable. PRs should outline contract impacts, migration steps. Link deployment artifacts or Basescan verifications, note required env vars (`SIGNER_PRIVATE_KEY`, `ETHERSCAN_API_KEY`), and request reviewers with protocol domain knowledge for upgrades.

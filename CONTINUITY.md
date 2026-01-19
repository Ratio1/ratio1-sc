Goal (incl. success criteria):
- Introduce AdoptionOracle contract that stores and serves license-sale and PoAI volume KPI checkpoints; ND and PoAIManager should write to AdoptionOracle instead of storing KPIs locally; CspEscrow.allocateRewardsToNodes returns total rewards; update tests accordingly.

Constraints/Assumptions:
- Adoption formula stays in MND; KPI storage moves into AdoptionOracle (not ND/PoAI).
- PoAI volume uses cumulative totals; update on allocateRewardsAcrossAllEscrows; no splitting when multiple epochs are allocated, assign all to last epoch.
- ND updates KPI on buyLicense.
- Must run relevant tests before final response.
- Follow repo style (Solidity 4-space indent) and avoid editing generated artifacts.

Key decisions:
- KPI storage lives in AdoptionOracle; ND/PoAI write checkpoints into it.
- CspEscrow.allocateRewardsToNodes returns total rewards; PoAI Manager aggregates across escrows.

State:
- AdoptionOracle initializer now requires ND and PoAI addresses; setters removed; tests and deployment scripts updated accordingly; targeted tests passing.

Done:
- Added AdoptionOracle contract and rewired NDContract/PoAIManager to use it.
- Updated tests to use AdoptionOracle for KPI reads and set oracle addresses.
- Updated tests to deploy AdoptionOracle after PoAI and set ND/PoAI adoptionOracle.
- Updated deployment/config scripts for new AdoptionOracle initializer; added AdoptionOracle upgrade script.
- Ran `npm run test -- test/NDContract.test.ts`, `npm run test -- test/PoAI.test.ts`, `npm run test -- test/Reader.test.ts` successfully.

Now:
- Report deployment script updates and test results.

Next:
- Run full test suite if desired.

Open questions (UNCONFIRMED if needed):
- None (requirements specified).

Working set (files/ids/commands):
- contracts/NDContract.sol
- contracts/PoAIManager.sol
- contracts/CspEscrow.sol
- contracts/AdoptionOracle.sol
- test/NDContract.test.ts
- test/PoAI.test.ts
- CONTINUITY.md

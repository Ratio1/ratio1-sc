# Ratio1 Smart Contracts

This repository contains the smart contracts and deployment scripts for the Ratio1 protocol, deployed on the [Base](https://base.org/) network.

## Table of Contents

- [Overview](#overview)
- [Contracts](#contracts)
- [Deployment Addresses (Base)](#deployment-addresses-base)
- [Installation](#installation)
- [Deployment](#deployment)
- [Post-Deployment Configuration](#post-deployment-configuration)
- [Testing](#testing)
- [License](#license)

## Overview

This repository contains all the smart contracts for the Ratio1 Ecosystem.

## Contracts

### R1 (ERC20 Token)

- **Purpose:** The main protocol token, capped at 161,803,398 R1. Only the MND and ND contracts can mint R1 tokens.
- **Key Features:** Minting/burning restricted to authorized contracts, capped supply, owner can set authorized contracts. Not upgradable.

### Controller

- **Purpose:** Central configuration and oracle management for the protocol.
- **Key Features:** Stores protocol constants, manages oracles, verifies signatures, links to ND and MND contracts.

### MNDContract (Master Node Deed, ERC721)

- **Purpose:** Manages Master Node licenses (NFTs), their assignment, and reward distribution.
- **Key Features:** License creation, node linking, reward claiming, logistic emission curve, company wallet management, pausable, upgradable.

### NDContract (Node Deed, ERC721)

- **Purpose:** Manages Node Deed licenses (NFTs), their assignment, price tiers, and reward distribution.
- **Key Features:** Tiered pricing, license minting, node linking, reward claiming, liquidity and company wallet management, pausable, upgradable.

### Reader

- **Purpose:** Utility contract for reading license and protocol data across contracts.
- **Key Features:** Aggregates license info, user balances, and protocol state for dApps and frontends.

### TestnetFaucet

- **Purpose:** Simple faucet for distributing test tokens.
- **Key Features:** Owner-configurable, cooldown per address, withdraw function.

### UniswapMockPair & UniswapMockRouter

- **Purpose:** Mock contracts for local testing of Uniswap-like liquidity and swaps.

### ERC20Mock

- **Purpose:** Mock ERC20 token for testing.

## Deployment Addresses (Base)

| Contract    | Address                                      |
| ----------- | -------------------------------------------- |
| R1 Token    | `0x6444C6c2D527D85EA97032da9A7504d6d1448ecF` |
| MNDContract | `0x0C431e546371C87354714Fcc1a13365391A549E2` |
| NDContract  | `0xE658DF6dA3FB5d4FBa562F1D5934bd0F9c6bd423` |
| Controller  | `0x90dA5FdaA92edDC80FB73114fb7FE7D97f2be017` |
| Reader      | `0xa2fDD4c7E93790Ff68a01f01AA789D619F12c6AC` |

## Deployment

### Network Configuration

The project is configured for the Base mainnet and Base Sepolia testnet in `hardhat.config.ts`.  
Set your environment variables for deployment:

- `SIGNER_PRIVATE_KEY` – Private key of the deployer
- `ETHERSCAN_API_KEY` – For contract verification

### Deploying Contracts

Run the deployment scripts in order:

```sh
npx hardhat run scripts/deploys/00.Controller.ts --network base
npx hardhat run scripts/deploys/01.R1.ts --network base
npx hardhat run scripts/deploys/02.MND.ts --network base
npx hardhat run scripts/deploys/03.ND.ts --network base
npx hardhat run scripts/deploys/Reader.ts --network base
npx hardhat run scripts/deploys/TestnetFaucet.ts --network base
```

## Testing

Run all tests with:

```sh
npx hardhat test
```

You can also run tests with gas reporting:

```sh
REPORT_GAS=true npx hardhat test
```

## CI/CD Pipeline

GitHub Actions automates contract compilation, testing, and upgrade preparation.

- **Triggers**
  - `dev` branch push → prepares Devnet upgrades on Base Sepolia.
  - `main` branch push → prepares Mainnet (Base) and Testnet (Base Sepolia) upgrades.
- **Secrets** (Settings → Secrets and variables → Actions → Repository secrets)
  - `SIGNER_PRIVATE_KEY` – deployer key used for `prepareUpgrade` transactions.
  - `ETHERSCAN_API_KEY` – required for automatic Basescan/Base Sepolia verification.
- **Variables** (Settings → Secrets and variables → Actions → Repository variables)
  - `DEVNET_SAFE_ADDRESS`, `TESTNET_SAFE_ADDRESS`, `MAINNET_SAFE_ADDRESS` – SAFE multisig per environment.
  - `DEVNET_UPGRADE_TARGETS`, `TESTNET_UPGRADE_TARGETS`, `MAINNET_UPGRADE_TARGETS` – comma or newline separated list using `ContractName:0xAddress[:proxy|beacon]`. The `:proxy`/`:beacon` suffix is optional (defaults to `proxy`). Example: `CspEscrow:0x01eafd...:beacon`.

Each workflow run compiles contracts, executes `scripts/ci/prepare-upgrade-txs.ts`, verifies new implementations on Basescan/Base Sepolia when the API key is configured, and uploads artifacts containing:

- `safe-transactions/<stage>/upgrade-*.json` – multisig-ready upgrade payloads (including Safe Transaction Builder metadata).
- `safe-transactions/<stage>/openzeppelin/` – updated `.openzeppelin` manifest for the targeted network (e.g., `base.json`, `base-sepolia.json`).

Download the artifact from the workflow run summary to retrieve the implementation addresses and Safe transaction data for submission to the multisig.

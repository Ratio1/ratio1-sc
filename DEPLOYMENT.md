# Ratio1 Deployment Procedure

This document describes the current deploy flow for a fresh Ratio1 protocol deployment.

The scripts read addresses and configuration from `scripts/configs/constants.ts`. After each deploy step, copy the printed address back into that file before continuing with scripts that depend on it.

## Prerequisites

1. Install dependencies:

```bash
npm install
```

2. Configure `.env`:

```bash
SIGNER_PRIVATE_KEY=...
ETHERSCAN_API_KEY=...
```

3. Set the target network values in `scripts/configs/constants.ts`:

```ts
SAFE_ADDR;
START_EPOCH_TIMESTAMP;
EPOCH_DURATION;
UNISWAP_V2_ROUTER_ADDR;
USDC_TOKEN_ADDR;
ND_FULL_RELEASE_THRESHOLD;
POAI_VOLUME_FULL_RELEASE_THRESHOLD;
NEW_COMPANY_WALLET;
NEW_LP_WALLET;
NEW_VAT_RECEIVER_WALLET;
NEW_EXPENSES_WALLET;
NEW_MARKETING_WALLET;
NEW_GRANTS_WALLET;
NEW_CSR_WALLET;
ND_BASE_URI;
MND_BASE_URI;
DIRECT_ADD_LP_PERCENTAGE;
MAX_ALLOWED_PRICE_DIFFERENCE;
```

`addOracle` and `setMinimumRequiredSignatures` are intentionally not part of the required Safe batch. Handle oracle membership separately if needed.

`DAuthOracleRegistry` dAuth membership is also handled separately from the required Safe batch. Add dAuth oracles only after they are already registered as Controller oracles.

## Deploy Order

Run each script with the target network:

```bash
npx hardhat run <script> --network <network>
```

For Base Sepolia, use `--network baseSepolia`.

### 1. Controller

```bash
npx hardhat run scripts/deploys/00.Controller.ts --network baseSepolia
```

Update:

```ts
CONTROLLER_ADDR;
```

### 2. R1

```bash
npx hardhat run scripts/deploys/01.R1.ts --network baseSepolia
```

Update:

```ts
R1_TOKEN_ADDR;
```

### 3. Uniswap V2 Pair

Create the R1/USDC pair before deploying contracts that store the pair address. The pair can exist with zero liquidity.

```bash
npx hardhat run scripts/deploys/02.CreateUniswapPair.ts --network baseSepolia
```

Update:

```ts
UNISWAP_V2_PAIR_ADDR;
```

If the script prints a zero pair address, do not continue. The script should fail in that case; check router/factory/network configuration.

### 4. BurnContract

```bash
npx hardhat run scripts/deploys/03.BurnContract.ts --network baseSepolia
```

Update:

```ts
BURN_CONTRACT_ADDR;
```

### 5. CspEscrow Implementation

```bash
npx hardhat run scripts/deploys/04.CspEscrow.ts --network baseSepolia
```

Update:

```ts
CSP_ESCROW_IMPLEMENTATION_ADDR;
```

### 6. MND

```bash
npx hardhat run scripts/deploys/05.MND.ts --network baseSepolia
```

Update:

```ts
MND_SC_ADDR;
```

### 7. ND

```bash
npx hardhat run scripts/deploys/06.ND.ts --network baseSepolia
```

Update:

```ts
ND_SC_ADDR;
```

### 8. PoAIManager

```bash
npx hardhat run scripts/deploys/07.PoAIManager.ts --network baseSepolia
```

Update:

```ts
POAI_MANAGER_ADDR;
CSP_ESCROW_BEACON_ADDR;
```

### 9. AdoptionOracle

```bash
npx hardhat run scripts/deploys/08.AdoptionOracle.ts --network baseSepolia
```

Update:

```ts
ADOPTION_ORACLE_ADDR;
```

### 10. Reader

```bash
npx hardhat run scripts/deploys/09.Reader.ts --network baseSepolia
```

Update:

```ts
READER_ADDR;
```

### 11. GratitudeBurn

```bash
npx hardhat run scripts/deploys/10.GratitudeBurn.ts --network baseSepolia
```

Update:

```ts
GRATITUDE_BURN_ADDR;
```

### 12. AttestationRegistry

```bash
npx hardhat run scripts/deploys/11.AttestationRegistry.ts --network baseSepolia
```

Update:

```ts
ATTESTATION_REGISTRY_ADDR;
```

### 13. DAuthOracleRegistry

`DAuthOracleRegistry` is non-upgradeable and is deployed directly, not through a proxy. The constructor uses:

- `CONTROLLER_ADDR` as the source of protocol oracle membership.
- `SAFE_ADDR` as the contract owner.

```bash
npx hardhat run scripts/deploys/12.DAuthOracleRegistry.ts --network baseSepolia
```

The registry owner can add or remove dAuth oracles independently from the required Safe configuration batch. `addDAuthOracle` rejects nodes that are not current Controller oracles, and public registry reads exclude entries that are later removed from Controller.

## Required Safe Configuration

After all deploy addresses are updated in `scripts/configs/constants.ts`, generate one Safe Transaction Builder JSON:

```bash
npx hardhat run scripts/configs/required/01.GenerateSafeConfigBatch.ts --network baseSepolia
```

The file is written to:

```text
safe-transactions/<network>/required-config-<network>-<timestamp>.json
```

Import this JSON in Safe Wallet Transaction Builder and execute the batch from the Safe.

The batch includes:

1. `R1.setMndContract(MND)`
2. `R1.setNdContract(ND)`
3. `R1.addBurner(BurnContract)`
4. `Controller.setContracts(ND, MND)`
5. `MND.setNDContract(ND)`
6. `ND.setMNDContract(MND)`
7. `MND.setCompanyWallets(...)`
8. `ND.setCompanyWallets(...)`
9. `ND.setPoAIManager(PoAIManager)`
10. `ND.setUniswapParams(router, pair, USDC)`
11. `ND.setDirectAddLpPercentage(...)`
12. `ND.setMaxAllowedPriceDifference(...)`
13. `ND.setAdoptionOracle(AdoptionOracle)`
14. `MND.setAdoptionOracle(AdoptionOracle)`
15. `PoAIManager.setAdoptionOracle(AdoptionOracle)`
16. `ND.setBaseURI(...)`
17. `MND.setBaseURI(...)`

The batch excludes:

```text
Controller.addOracle(...)
Controller.setMinimumRequiredSignatures(...)
```

## ProxyAdmin Ownership

After deploying the proxy contracts, transfer ownership of all ProxyAdmin contracts to the Safe.

Update the ProxyAdmin list in `scripts/configs/transferProxyAdminsOwnership.ts` if the deploy produced different ProxyAdmin addresses, then run:

```bash
npx hardhat run scripts/configs/transferProxyAdminsOwnership.ts --network baseSepolia
```

The script is idempotent: it checks each ProxyAdmin `owner()` and skips entries already owned by `SAFE_ADDR`.

## Liquidity

Add liquidity to the R1/USDC pair before enabling flows that depend on pricing or swaps.

The pair may be created before liquidity, but these flows require reserves:

```text
ND.getTokenPrice()
ND.buyLicense(...)
ND payment distribution swaps
CspEscrow reward claims/burn swaps
PoAIManager R1 reward quote views
```

## Optional Historical Data

If this deployment needs historical adoption data, initialize the `AdoptionOracle` before normal usage:

```text
AdoptionOracle.initializeLicenseSales(...)
AdoptionOracle.initializePoaiVolumes(...)
```

These functions are one-shot and should be called only when historical data must be seeded.

## Verification

Run local verification before and after preparing Safe data:

```bash
npm run build
npx tsc --noEmit
npm run test
```

After Safe execution, check:

1. `R1._mndContract() == MND_SC_ADDR`
2. `R1._ndContract() == ND_SC_ADDR`
3. `BurnContract` is an R1 burner.
4. `Controller.ndContract()` and `Controller.mndContract()` are set.
5. `ND` and `MND` point to each other.
6. `ND.poaiManager()` is set.
7. `ND`, `MND`, and `PoAIManager` point to `AdoptionOracle`.
8. `ND` Uniswap router/pair/USDC params are set.
9. `ND` and `MND` token URIs return the expected metadata URL.
10. ProxyAdmin and beacon ownership are controlled by the Safe where required.

import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { ethers, network } from "hardhat";
import {
  ADOPTION_ORACLE_ADDR,
  BURN_CONTRACT_ADDR,
  CONTROLLER_ADDR,
  DIRECT_ADD_LP_PERCENTAGE,
  MAX_ALLOWED_PRICE_DIFFERENCE,
  MND_BASE_URI,
  MND_SC_ADDR,
  ND_BASE_URI,
  ND_SC_ADDR,
  NEW_COMPANY_WALLET,
  NEW_CSR_WALLET,
  NEW_EXPENSES_WALLET,
  NEW_GRANTS_WALLET,
  NEW_LP_WALLET,
  NEW_MARKETING_WALLET,
  NEW_VAT_RECEIVER_WALLET,
  POAI_MANAGER_ADDR,
  R1_TOKEN_ADDR,
  SAFE_ADDR,
  UNISWAP_V2_PAIR_ADDR,
  UNISWAP_V2_ROUTER_ADDR,
  USDC_TOKEN_ADDR,
} from "../constants";

interface SafeTransaction {
  to: string;
  value: string;
  data: string;
  contractMethod: {
    name: string;
    payable: boolean;
    inputs: Array<{ name: string; type: string }>;
  };
  contractInputsValues: Record<string, string>;
}

interface MethodInput {
  name: string;
  type: string;
}

interface BatchTx {
  to: string;
  name: string;
  inputs: MethodInput[];
  values: string[];
}

function requireAddress(name: string, value: string) {
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address`);
  }
}

function buildSafeTx(tx: BatchTx): SafeTransaction {
  const fragment = `function ${tx.name}(${tx.inputs
    .map((input) => `${input.type} ${input.name}`)
    .join(",")})`;
  const iface = new ethers.Interface([fragment]);
  const data = iface.encodeFunctionData(tx.name, tx.values);
  const contractInputsValues: Record<string, string> = {};

  for (let i = 0; i < tx.inputs.length; i++) {
    contractInputsValues[tx.inputs[i].name] = tx.values[i];
  }

  return {
    to: tx.to,
    value: "0",
    data,
    contractMethod: {
      name: tx.name,
      payable: false,
      inputs: tx.inputs,
    },
    contractInputsValues,
  };
}

async function main() {
  const stage = (process.env.CONFIG_STAGE ?? network.name).toLowerCase();
  const outputDir =
    process.env.OUTPUT_DIR ?? path.join("safe-transactions", stage);
  const providerNetwork = await ethers.provider.getNetwork();
  const createdAt = Date.now();

  const addresses = [
    { name: "SAFE_ADDR", value: SAFE_ADDR },
    { name: "R1_TOKEN_ADDR", value: R1_TOKEN_ADDR },
    { name: "BURN_CONTRACT_ADDR", value: BURN_CONTRACT_ADDR },
    { name: "MND_SC_ADDR", value: MND_SC_ADDR },
    { name: "ND_SC_ADDR", value: ND_SC_ADDR },
    { name: "POAI_MANAGER_ADDR", value: POAI_MANAGER_ADDR },
    { name: "ADOPTION_ORACLE_ADDR", value: ADOPTION_ORACLE_ADDR },
    { name: "UNISWAP_V2_ROUTER_ADDR", value: UNISWAP_V2_ROUTER_ADDR },
    { name: "UNISWAP_V2_PAIR_ADDR", value: UNISWAP_V2_PAIR_ADDR },
    { name: "USDC_TOKEN_ADDR", value: USDC_TOKEN_ADDR },
    { name: "NEW_COMPANY_WALLET", value: NEW_COMPANY_WALLET },
    { name: "NEW_LP_WALLET", value: NEW_LP_WALLET },
    { name: "NEW_VAT_RECEIVER_WALLET", value: NEW_VAT_RECEIVER_WALLET },
    { name: "NEW_EXPENSES_WALLET", value: NEW_EXPENSES_WALLET },
    { name: "NEW_MARKETING_WALLET", value: NEW_MARKETING_WALLET },
    { name: "NEW_GRANTS_WALLET", value: NEW_GRANTS_WALLET },
    { name: "NEW_CSR_WALLET", value: NEW_CSR_WALLET },
  ];

  for (const address of addresses) {
    requireAddress(address.name, address.value);
  }

  const txs: BatchTx[] = [
    {
      to: R1_TOKEN_ADDR,
      name: "setMndContract",
      inputs: [{ name: "mndContract", type: "address" }],
      values: [MND_SC_ADDR],
    },
    {
      to: R1_TOKEN_ADDR,
      name: "setNdContract",
      inputs: [{ name: "ndContract", type: "address" }],
      values: [ND_SC_ADDR],
    },
    {
      to: R1_TOKEN_ADDR,
      name: "addBurner",
      inputs: [{ name: "account", type: "address" }],
      values: [BURN_CONTRACT_ADDR],
    },
    {
      to: CONTROLLER_ADDR,
      name: "setContracts",
      inputs: [
        { name: "ndContractAddress", type: "address" },
        { name: "mndContractAddress", type: "address" },
      ],
      values: [ND_SC_ADDR, MND_SC_ADDR],
    },
    {
      to: MND_SC_ADDR,
      name: "setNDContract",
      inputs: [{ name: "ndContract_", type: "address" }],
      values: [ND_SC_ADDR],
    },
    {
      to: ND_SC_ADDR,
      name: "setMNDContract",
      inputs: [{ name: "mndContract_", type: "address" }],
      values: [MND_SC_ADDR],
    },
    {
      to: MND_SC_ADDR,
      name: "setCompanyWallets",
      inputs: [
        { name: "newLpWallet", type: "address" },
        { name: "newExpensesWallet", type: "address" },
        { name: "newMarketingWallet", type: "address" },
        { name: "newGrantsWallet", type: "address" },
        { name: "newCsrWallet", type: "address" },
      ],
      values: [
        NEW_LP_WALLET,
        NEW_EXPENSES_WALLET,
        NEW_MARKETING_WALLET,
        NEW_GRANTS_WALLET,
        NEW_CSR_WALLET,
      ],
    },
    {
      to: ND_SC_ADDR,
      name: "setCompanyWallets",
      inputs: [
        { name: "newCompanyWallet", type: "address" },
        { name: "newLpWallet", type: "address" },
        { name: "newVatReceiverWallet", type: "address" },
      ],
      values: [NEW_COMPANY_WALLET, NEW_LP_WALLET, NEW_VAT_RECEIVER_WALLET],
    },
    {
      to: ND_SC_ADDR,
      name: "setPoAIManager",
      inputs: [{ name: "_poaiManager", type: "address" }],
      values: [POAI_MANAGER_ADDR],
    },
    {
      to: ND_SC_ADDR,
      name: "setUniswapParams",
      inputs: [
        { name: "uniswapV2Router", type: "address" },
        { name: "uniswapV2Pair", type: "address" },
        { name: "usdcAddr", type: "address" },
      ],
      values: [UNISWAP_V2_ROUTER_ADDR, UNISWAP_V2_PAIR_ADDR, USDC_TOKEN_ADDR],
    },
    {
      to: ND_SC_ADDR,
      name: "setDirectAddLpPercentage",
      inputs: [{ name: "newDirectAddLpPercentage", type: "uint256" }],
      values: [DIRECT_ADD_LP_PERCENTAGE.toString()],
    },
    {
      to: ND_SC_ADDR,
      name: "setMaxAllowedPriceDifference",
      inputs: [{ name: "newMaxAllowedPriceDifference", type: "uint256" }],
      values: [MAX_ALLOWED_PRICE_DIFFERENCE.toString()],
    },
    {
      to: ND_SC_ADDR,
      name: "setAdoptionOracle",
      inputs: [{ name: "adoptionOracle_", type: "address" }],
      values: [ADOPTION_ORACLE_ADDR],
    },
    {
      to: MND_SC_ADDR,
      name: "setAdoptionOracle",
      inputs: [{ name: "adoptionOracle_", type: "address" }],
      values: [ADOPTION_ORACLE_ADDR],
    },
    {
      to: POAI_MANAGER_ADDR,
      name: "setAdoptionOracle",
      inputs: [{ name: "adoptionOracle_", type: "address" }],
      values: [ADOPTION_ORACLE_ADDR],
    },
    {
      to: ND_SC_ADDR,
      name: "setBaseURI",
      inputs: [{ name: "baseURI", type: "string" }],
      values: [ND_BASE_URI],
    },
    {
      to: MND_SC_ADDR,
      name: "setBaseURI",
      inputs: [{ name: "baseURI", type: "string" }],
      values: [MND_BASE_URI],
    },
  ];

  const safeBatch = {
    version: "1.0",
    chainId: providerNetwork.chainId.toString(),
    createdAt,
    meta: {
      name: `Ratio1 ${stage} required config`,
      description:
        "Required post-deploy configuration. Excludes addOracle and setMinimumRequiredSignatures.",
      txBuilderVersion: "1.0.0",
      createdFromSafeAddress: ethers.getAddress(SAFE_ADDR),
      createdFromOwnerAddress: "",
      checksum: "",
    },
    transactions: txs.map(buildSafeTx),
  };

  mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(
    outputDir,
    `required-config-${stage}-${createdAt}.json`
  );
  writeFileSync(filePath, JSON.stringify(safeBatch, null, 2));
  console.log(`Safe config batch written to ${filePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

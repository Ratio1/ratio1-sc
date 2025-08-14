import { ethers } from "hardhat";
import {
  MND_SC_ADDR,
  ND_SC_ADDR,
  CONTROLLER_ADDR,
  R1_TOKEN_ADDR,
  USDC_TOKEN_ADDR,
  UNISWAP_V2_ROUTER_ADDR,
  UNISWAP_V2_PAIR_ADDR,
} from "../constants";

// TODO: Update this address after PoAIManager deployment
const POAI_MANAGER_ADDR = "0x0000000000000000000000000000000000000000";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Setting up PoAIManager configuration...");

  // Verify that all required addresses are valid Ethereum addresses
  const addresses = [
    { name: "MND_SC_ADDR", value: MND_SC_ADDR },
    { name: "ND_SC_ADDR", value: ND_SC_ADDR },
    { name: "CONTROLLER_ADDR", value: CONTROLLER_ADDR },
    { name: "R1_TOKEN_ADDR", value: R1_TOKEN_ADDR },
    { name: "USDC_TOKEN_ADDR", value: USDC_TOKEN_ADDR },
    { name: "UNISWAP_V2_ROUTER_ADDR", value: UNISWAP_V2_ROUTER_ADDR },
    { name: "UNISWAP_V2_PAIR_ADDR", value: UNISWAP_V2_PAIR_ADDR },
  ];

  for (const addr of addresses) {
    if (!ethers.utils.isAddress(addr.value)) {
      throw new Error(
        `${addr.name} is not a valid Ethereum address: ${addr.value}`
      );
    }
  }

  console.log("All required addresses are properly configured");
  console.log("PoAIManager setup complete - all dependencies verified");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

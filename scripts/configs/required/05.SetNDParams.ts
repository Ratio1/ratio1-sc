import { ethers } from "hardhat";
import {
  DIRECT_ADD_LP_PERCENTAGE,
  MAX_ALLOWED_PRICE_DIFFERENCE,
  ND_SC_ADDR,
  POAI_MANAGER_ADDR,
  UNISWAP_V2_PAIR_ADDR,
  UNISWAP_V2_ROUTER_ADDR,
  USDC_TOKEN_ADDR,
} from "../constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ndContract = await ethers.getContractAt(
    "NDContract",
    ND_SC_ADDR,
    deployer
  );

  await ndContract.setPoAIManager(POAI_MANAGER_ADDR);
  console.log("PoAIManager set in ND contract");

  await ndContract.setUniswapParams(
    UNISWAP_V2_ROUTER_ADDR,
    UNISWAP_V2_PAIR_ADDR,
    USDC_TOKEN_ADDR
  );
  console.log("Uniswap params set in ND contract");

  await ndContract.setDirectAddLpPercentage(DIRECT_ADD_LP_PERCENTAGE);
  console.log("Direct LP percentage set in ND contract");

  await ndContract.setMaxAllowedPriceDifference(MAX_ALLOWED_PRICE_DIFFERENCE);
  console.log("Max allowed price difference set in ND contract");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

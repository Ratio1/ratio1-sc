import { ethers } from "hardhat";
import {
  ND_SC_ADDR,
  R1_TOKEN_ADDR,
  UNISWAP_V2_PAIR_ADDR,
  UNISWAP_V2_ROUTER_ADDR,
  USDC_TOKEN_ADDR,
} from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const UniswapLiquidityManagerContractFactory =
    await ethers.getContractFactory("UniswapLiquidityManager", deployer);
  const uniswapLiquidityManagerContract =
    await UniswapLiquidityManagerContractFactory.deploy(
      UNISWAP_V2_ROUTER_ADDR,
      UNISWAP_V2_PAIR_ADDR,
      USDC_TOKEN_ADDR,
      R1_TOKEN_ADDR
    );
  await uniswapLiquidityManagerContract.deployed();
  console.log(
    "UniswapLiquidityManager deployed to:",
    uniswapLiquidityManagerContract.address
  );

  const NDContractFactory = await ethers.getContractFactory(
    "NDContract",
    deployer
  );
  const ndContract = NDContractFactory.attach(ND_SC_ADDR);
  await ndContract.setLiquidityManager(uniswapLiquidityManagerContract.address);
  console.log("UniswapLiquidityManager contract address set in ND contract");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

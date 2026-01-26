import { ethers, upgrades } from "hardhat";
import {
  CONTROLLER_ADDR,
  R1_TOKEN_ADDR,
  MND_SC_ADDR,
  ND_SC_ADDR,
  SAFE_ADDR,
  UNISWAP_V2_ROUTER_ADDR,
  UNISWAP_V2_PAIR_ADDR,
  USDC_TOKEN_ADDR,
  CSP_ESCROW_IMPLEMENTATION_ADDR,
  BURN_CONTRACT_ADDR,
} from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  // Deploy PoAIManager
  console.log("Deploying PoAIManager...");
  const PoAIManagerFactory = await ethers.getContractFactory(
    "PoAIManager",
    deployer
  );
  const poaiManager = await upgrades.deployProxy(
    PoAIManagerFactory,
    [
      CSP_ESCROW_IMPLEMENTATION_ADDR, // _cspEscrowImplementation
      ND_SC_ADDR, // _ndContract
      MND_SC_ADDR, // _mndContract
      CONTROLLER_ADDR, // _controller
      USDC_TOKEN_ADDR, // _usdcToken
      R1_TOKEN_ADDR, // _r1Token
      BURN_CONTRACT_ADDR, // _burnContract
      UNISWAP_V2_ROUTER_ADDR, // _uniswapV2Router
      UNISWAP_V2_PAIR_ADDR, // _uniswapV2Pair
      SAFE_ADDR, // newOwner
    ],
    { initializer: "initialize" }
  );
  await poaiManager.waitForDeployment();
  const proxyAddress = await poaiManager.getAddress();
  console.log("PoAIManager deployed to:", proxyAddress);

  const implAddress = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("PoAIManager Implementation:", implAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(
    proxyAddress
  );
  console.log("PoAIManager Proxy Admin:", adminAddress);

  // Get the beacon address
  const beaconAddress = await poaiManager.cspEscrowBeacon();
  console.log("CspEscrow Beacon deployed to:", beaconAddress);

  console.log("\n=== DEPLOYMENT SUMMARY ===");
  console.log("PoAIManager Proxy:", proxyAddress);
  console.log("PoAIManager Implementation:", implAddress);
  console.log("PoAIManager Proxy Admin:", adminAddress);
  console.log("CspEscrow Beacon:", beaconAddress);
  console.log("==========================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

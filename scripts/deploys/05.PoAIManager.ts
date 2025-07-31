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
      UNISWAP_V2_ROUTER_ADDR, // _uniswapV2Router
      UNISWAP_V2_PAIR_ADDR, // _uniswapV2Pair
      SAFE_ADDR, // newOwner
    ],
    { initializer: "initialize" }
  );
  await poaiManager.deployed();
  console.log("PoAIManager deployed to:", poaiManager.address);

  const implAddress = await upgrades.erc1967.getImplementationAddress(
    poaiManager.address
  );
  console.log("PoAIManager Implementation:", implAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(
    poaiManager.address
  );
  console.log("PoAIManager Proxy Admin:", adminAddress);

  // Get the beacon address
  const beaconAddress = await poaiManager.cspEscrowBeacon();
  console.log("CspEscrow Beacon deployed to:", beaconAddress);

  console.log("\n=== DEPLOYMENT SUMMARY ===");
  console.log("PoAIManager Proxy:", poaiManager.address);
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

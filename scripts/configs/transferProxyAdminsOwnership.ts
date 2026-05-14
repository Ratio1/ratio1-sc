import { ethers } from "hardhat";
import { SAFE_ADDR } from "./constants";

const PROXY_ADMIN_ADDRESSES = [
  "0x802e210AE1FA3d61cd75463d9273BcCaA6e20800",
  "0x46F906F062d0D77e202A6e3a920760832d0eE064",
  "0x5738f7219DBbd3e9989B90fE61B4b338F8A5559B",
  "0x9c504DfFb46358cD5e99cD50373449BDdAe9e01A",
  "0xaC9D24D61420D3E4Da742C4acF347391DF155775",
  "0x6e7988026df41FB1F85Caf4B271480a72E4A9Afa",
  "0x1D7822B0af81ef2716Ab5796EA9A612c71B210Ce",
];

const PROXY_ADMIN_ABI = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
];

async function main() {
  const [deployer] = await ethers.getSigners();

  if (!ethers.isAddress(SAFE_ADDR)) {
    throw new Error("SAFE_ADDR is not a valid address");
  }

  console.log("Signer:", await deployer.getAddress());
  console.log("New owner:", SAFE_ADDR);

  for (const proxyAdminAddress of PROXY_ADMIN_ADDRESSES) {
    if (!ethers.isAddress(proxyAdminAddress)) {
      throw new Error(`Invalid ProxyAdmin address: ${proxyAdminAddress}`);
    }

    const proxyAdmin = new ethers.Contract(
      proxyAdminAddress,
      PROXY_ADMIN_ABI,
      deployer
    );
    const currentOwner = await proxyAdmin.owner();

    if (ethers.getAddress(currentOwner) === ethers.getAddress(SAFE_ADDR)) {
      console.log(`${proxyAdminAddress}: already owned by Safe`);
      continue;
    }

    console.log(
      `${proxyAdminAddress}: transferring ownership from ${currentOwner}`
    );
    const tx = await proxyAdmin.transferOwnership(SAFE_ADDR);
    await tx.wait();
    console.log(`${proxyAdminAddress}: ownership transferred`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

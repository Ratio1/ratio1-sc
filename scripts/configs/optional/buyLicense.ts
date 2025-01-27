import { ethers } from "hardhat";
import { ND_SC_ADDR } from "../constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const NDContractFactory = await ethers.getContractFactory(
    "NDContract",
    deployer
  );
  const ndContract = NDContractFactory.attach(ND_SC_ADDR);

  await ndContract.buyLicense(
    1,
    1,
    Buffer.from("c006b48f9bda4236829ab328fd2a71a2"),
    "0x878cc88c5b34fc9a54a8752d9717a4f614e21c7b19e4b01f897eba461bd818ad51d44ca5c85287b17d159c127dc086d96d406959a4de7c9cc309755afe66aeea1b"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

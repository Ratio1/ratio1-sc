import { ethers } from "hardhat";
import { ND_SC_ADDR } from "../constants";

const NEW_LIMIT_PER_WALLET = 3;

async function main() {
	const [deployer] = await ethers.getSigners();

	const NDContractFactory = await ethers.getContractFactory(
		"NDContract",
		deployer
	);
	const ndContract = NDContractFactory.attach(ND_SC_ADDR);

	await ndContract.setLimitPerWallet(NEW_LIMIT_PER_WALLET);
	console.log("Limit per wallet set in ND contract");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

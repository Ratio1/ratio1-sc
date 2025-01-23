import { ethers } from "hardhat";
import { ND_SC_ADDR } from "../constants";

const ADDRESS_TO_BAN = "";

async function main() {
	const [deployer] = await ethers.getSigners();

	const NDContractFactory = await ethers.getContractFactory(
		"NDContract",
		deployer
	);
	const ndContract = NDContractFactory.attach(ND_SC_ADDR);

	await ndContract.banLicense(ADDRESS_TO_BAN);
	console.log("Address", ADDRESS_TO_BAN, "banned in ND contract");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

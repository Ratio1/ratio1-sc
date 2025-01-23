import { ethers } from "hardhat";
import { MND_SC_ADDR, ND_SC_ADDR } from "../constants";

const NEW_REQUIRED_SIGNATURES = 3;

async function main() {
	const [deployer] = await ethers.getSigners();

	const MNDContractFactory = await ethers.getContractFactory(
		"MNDContract",
		deployer
	);
	const mndContract = MNDContractFactory.attach(MND_SC_ADDR);

	await mndContract.setMinimumRequiredSignatures(NEW_REQUIRED_SIGNATURES);
	console.log("Company wallets set in MND contract");

	const NDContractFactory = await ethers.getContractFactory(
		"NDContract",
		deployer
	);
	const ndContract = NDContractFactory.attach(ND_SC_ADDR);

	await ndContract.setMinimumRequiredSignatures(NEW_REQUIRED_SIGNATURES);
	console.log("Company wallets set in ND contract");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

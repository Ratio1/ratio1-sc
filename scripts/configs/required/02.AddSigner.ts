import { ethers } from "hardhat";
import { MND_SC_ADDR, ND_SC_ADDR } from "../constants";

const SIGNER_TO_ADD = "";

async function main() {
	const [deployer] = await ethers.getSigners();

	const MNDContractFactory = await ethers.getContractFactory(
		"MNDContract",
		deployer
	);
	const mndContract = MNDContractFactory.attach(MND_SC_ADDR);

	await mndContract.addSigner(SIGNER_TO_ADD);
	console.log("Signer", SIGNER_TO_ADD, "added in MND contract");

	const NDContractFactory = await ethers.getContractFactory(
		"NDContract",
		deployer
	);
	const ndContract = NDContractFactory.attach(ND_SC_ADDR);

	await ndContract.addSigner(SIGNER_TO_ADD);
	console.log("Signer", SIGNER_TO_ADD, "added in ND contract");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

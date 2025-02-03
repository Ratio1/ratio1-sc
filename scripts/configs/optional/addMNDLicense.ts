import { ethers } from "hardhat";
import { MND_SC_ADDR } from "../constants";

const RECEIVER_ADDR = "";
const ASSIGNED_AMOUNT_WITH_DECIMALS = "";

async function main() {
	const [deployer] = await ethers.getSigners();

	const MNDContractFactory = await ethers.getContractFactory(
		"MNDContract",
		deployer
	);
	const mndContract = MNDContractFactory.attach(MND_SC_ADDR);

	await mndContract.addLicense(RECEIVER_ADDR, ASSIGNED_AMOUNT_WITH_DECIMALS);
	console.log("License to", RECEIVER_ADDR, "added in MND contract");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

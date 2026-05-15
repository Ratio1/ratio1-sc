import { ethers } from "hardhat";
import { MND_SC_ADDR } from "../constants";

const RECEIVER_ADDR = "";
const ASSIGNED_AMOUNT_WITH_DECIMALS = "";

async function main() {
	const [deployer] = await ethers.getSigners();

	const mndContract = await ethers.getContractAt(
		"MNDContract",
		MND_SC_ADDR,
		deployer
	);

	await mndContract.addLicense(RECEIVER_ADDR, ASSIGNED_AMOUNT_WITH_DECIMALS);
	console.log("License to", RECEIVER_ADDR, "added in MND contract");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

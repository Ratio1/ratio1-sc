import { ethers } from "hardhat";
import { ND_SC_ADDR } from "../constants";

const LICENSE_ID_TO_UNBAN = 0;

async function main() {
	const [deployer] = await ethers.getSigners();

	const ndContract = await ethers.getContractAt(
		"NDContract",
		ND_SC_ADDR,
		deployer
	);

	await ndContract.unbanLicense(LICENSE_ID_TO_UNBAN);
	console.log("License", LICENSE_ID_TO_UNBAN, "unbanned in ND contract");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

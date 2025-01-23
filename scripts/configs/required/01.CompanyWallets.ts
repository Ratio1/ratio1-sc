import { ethers } from "hardhat";
import {
	MND_SC_ADDR,
	NEW_LP_WALLET,
	NEW_EXPENSES_WALLET,
	NEW_MARKETING_WALLET,
	NEW_GRANTS_WALLET,
	NEW_CSR_WALLET,
	ND_SC_ADDR,
} from "../constants";

async function main() {
	const [deployer] = await ethers.getSigners();

	const MNDContractFactory = await ethers.getContractFactory(
		"MNDContract",
		deployer
	);
	const mndContract = MNDContractFactory.attach(MND_SC_ADDR);

	await mndContract.setCompanyWallets(
		NEW_LP_WALLET,
		NEW_EXPENSES_WALLET,
		NEW_MARKETING_WALLET,
		NEW_GRANTS_WALLET,
		NEW_CSR_WALLET
	);
	console.log("Company wallets set in MND contract");

	const NDContractFactory = await ethers.getContractFactory(
		"NDContract",
		deployer
	);
	const ndContract = NDContractFactory.attach(ND_SC_ADDR);

	await ndContract.setCompanyWallets(
		NEW_LP_WALLET,
		NEW_EXPENSES_WALLET,
		NEW_MARKETING_WALLET,
		NEW_GRANTS_WALLET,
		NEW_CSR_WALLET
	);
	console.log("Company wallets set in ND contract");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

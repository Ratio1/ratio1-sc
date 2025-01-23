import { ethers } from "hardhat";
import { R1_TOKEN_ADDR } from "../configs/constants";

async function main() {
	const [deployer] = await ethers.getSigners();

	const MNDContractFactory = await ethers.getContractFactory(
		"MNDContract",
		deployer
	);
	const mndContract = await MNDContractFactory.deploy(R1_TOKEN_ADDR);
	await mndContract.deployed();
	console.log("MND deployed to:", mndContract.address);

	const R1ContractFactory = await ethers.getContractFactory("R1", deployer);
	const r1Contract = R1ContractFactory.attach(R1_TOKEN_ADDR);
	await r1Contract.setMndContract(mndContract.address);
	console.log("MND contract address set in R1 contract");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

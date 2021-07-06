import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { KeyringPair } from "@polkadot/keyring/types"
import { SubmittableExtrinsic } from "@polkadot/api/submittable/types"
import { ISubmittableResult } from '@polkadot/types/types';
import { BN } from '@polkadot/util';

const config = require("../config.json");
const secret = require("../secret.json")

function getAccountAtIndex(index: number, keyring: Keyring): KeyringPair {
	return keyring.addFromUri(secret.seed + "///" + index.toString());
}

async function unNominate(api: ApiPromise, from: number, to: number) {
	// ---- CONFIGS ----
	// unNominate this range.
	const keyring = new Keyring({ type: 'sr25519' });
	for (let i = from; i < to; i++) {
		const account = getAccountAtIndex(i, keyring);
		const address = account.address;
		const isBonded = (await api.query.staking.ledger(address)).isSome;
		const isNominator = (await api.query.staking.nominators(address)).isSome;

		if (isBonded && isNominator) {
			console.log(`chilling ${address}`)
			await api.tx.staking.chill().signAndSend(account);
			// chill yourself please.
		} else if (isBonded && !isNominator) {
			console.log(`${address} already chilled`);
		} else if (!isBonded && !isNominator) {
			console.log(`${address} not even a staker`);
		} else {
			console.log(`un-fucking-reachable.`);
		}
	}

	await api.disconnect();
}

// we assume all accounts already exists.
async function addNomination(api: ApiPromise) {
	// ---- CONFIGS ----
	/// We submit nominations, from our predefined accounts, up to this index. Increment this at
	/// each round.
	const toNominate = 30 * 1000;
	const overwriteNomination = false;
	const keyring = new Keyring({ type: 'sr25519' });

	const validators = (await api.query.staking.validators.entries());
	const targets = validators.map(([stashKey, _prefs]) => {
		const stash = api.createType('AccountId', stashKey.slice(-32)).toHuman();
		return stash;
	}).slice(0, 16);

	if (targets.length != 16) {
		while (targets.length < 16) {
			targets.push(targets[0])
		}
	}
	console.log(`voting for`, targets);

	for (let i = 0; i < toNominate; i++) {
		// generate an account using the sender seed, with a password derivation
		const account = getAccountAtIndex(i, keyring);
		const address = account.address;
		const isBonded = (await api.query.staking.ledger(address)).isSome;
		const isNominator = (await api.query.staking.nominators(address)).isSome;

		// Only touch new accounts
		if (!isBonded && !isNominator) {
			console.log(`Nominating from ${address} (${i})`);
			const tx = api.tx.utility.batchAll([
				api.tx.staking.bond(account.address, 1500000000000, { Staked: null }),
				api.tx.staking.nominate(targets)
			]);
			await tx.signAndSend(account);
		} else if (isBonded && !isNominator) {
			console.log(`Bonded, Nominating from ${address} (${i})`);
			const tx = api.tx.staking.nominate(targets);
			await tx.signAndSend(account);
		} else if (isBonded && isNominator && overwriteNomination) {
			console.log(`Already Nominator ${address} (${i}), overwriting`);
			const tx = api.tx.staking.nominate(targets);
			await tx.signAndSend(account);
		} else {
			console.log(`Already Nominator ${address} (${i})`);
		}
	}
	await api.disconnect();
}

async function createAccounts(api: ApiPromise) {
	// TODO: soon we need a function to top-up all of these accounts to x WND
	const keyring = new Keyring({ type: 'sr25519' });
	const target_accounts = config.balances.users;
	const target_balance = config.balances.balance;
	const sender_seed = secret.seed;
	const sender = keyring.addFromUri(sender_seed);

	const batch_size = 500;
	let counter = 0;

	while (counter < target_accounts) {
		const batch = [];

		while (batch.length < batch_size && counter < target_accounts) {
			// generate an account using the sender seed, with a password derivation
			const account = getAccountAtIndex(counter, keyring);
			const address = account.address;
			const info = await api.query.system.account(address);
			const should_add = info.providers.isZero();

			// Only touch new accounts
			if (should_add) {
				console.log(`Adding ${address} (${counter})`);
				batch.push(
					api.tx.balances.transferKeepAlive(address, target_balance)
				)
			} else {
				console.log(`Existing ${address} (${counter})`);
			}
			counter += 1;
		}
		const batch_tx = api.tx.utility.batch(batch)
		await send_until_included(api, sender, batch_tx);
	}
	await api.disconnect();
}

async function send_until_included(api: ApiPromise, sender: KeyringPair, tx: SubmittableExtrinsic<"promise", ISubmittableResult>) {
	return new Promise (async (resolvePromise, reject) => {
		console.log(
			`--- Submitting Transaction ---`
		);

		const unsub = await tx
			.signAndSend(sender, (result) => {
				console.log(`Current status is ${result.status}`);
				if (result.status.isInBlock) {
					console.log(
						`Transaction included at blockHash ${result.status.asInBlock}`
					);

					unsub();
					resolvePromise(null);

				} else if (result.isError) {
					console.log(`Transaction Error`);
					reject(`Transaction Error`);
				}
			});
	});
}

// Main function which needs to run at start
async function main() {
	const provider = new WsProvider('ws://localhost:9944');
	// const provider = new WsProvider('wss://westend-rpc.polkadot.io/');
	const api = await ApiPromise.create({ provider });

	// Get general information about the node we are connected to
	const [chain, nodeName, nodeVersion] = await Promise.all([
		api.rpc.system.chain(),
		api.rpc.system.name(),
		api.rpc.system.version()
	]);
	console.log(
		`You are connected to chain ${chain} using ${nodeName} v${nodeVersion}`
	);

	// await createAccounts(api);
	// await addNomination(api);
	await unNominate(api, 25000, 30000);
}

main().catch(console.error);

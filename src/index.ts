import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { KeyringPair } from "@polkadot/keyring/types"
import { SubmittableExtrinsic } from "@polkadot/api/submittable/types"
import { ISubmittableResult } from '@polkadot/types/types';
import { BN } from '@polkadot/util';

const secret = require("../secret.json")
const WND = 10 ** 12;
const STAKE = WND * 1.5;
const TOPUP = WND * 2;

function getAccountAtIndex(index: number, keyring: Keyring): KeyringPair {
	return keyring.addFromUri(secret.god + "///" + index.toString());
}

/// validate from this range.
async function addValidators(api: ApiPromise, keyring: Keyring, from: number, to: number) {
	for (let i = from; i < to; i++) {
		// generate an account using the sender seed, with a password derivation
		const account = getAccountAtIndex(i, keyring);
		const address = account.address;
		const isBonded = (await api.query.staking.ledger(address)).isSome;
		// we don't care if this dude is now a validator, nominator, or whatever, we just call
		// `validate` on them again.
		if (!isBonded) {
			console.log(`bonding and validating from ${address} (${i})`)
			const tx = api.tx.utility.batchAll([
				api.tx.staking.bond(account.address, STAKE, { Staked: null }),
				api.tx.staking.validate({ commission: 10 ** 9, blocked: false }),
			]);
			await tx.signAndSend(account);
		} else {
			console.log(`already bonded, validating from ${address} (${i})`)
			const tx = api.tx.staking.validate({ commission: 10 ** 9, blocked: false });
			await tx.signAndSend(account);
		}
	}

	await api.disconnect();
}

/// chill this range.
async function chill(api: ApiPromise, keyring: Keyring, from: number, to: number) {
	for (let i = from; i < to; i++) {
		const account = getAccountAtIndex(i, keyring);
		const address = account.address;
		const isBonded = (await api.query.staking.ledger(address)).isSome;
		const isNominator = (await api.query.staking.nominators(address)).isSome;
		const isValidator = !(await api.query.staking.validators(address)).isEmpty;

		if (isBonded && (isNominator || isValidator)) {
			console.log(`[${i}/${to}] chilling ${address}`)
			await api.tx.staking.chill().signAndSend(account);
			// chill yourself please.
		} else if (isBonded && !isNominator) {
			console.log(`[${i}/${to}] ${address} already chilled`);
		} else if (!isBonded && !isNominator) {
			console.log(`[${i}/${to}] ${address} not even a staker`);
		} else {
			console.log(`un-fucking-reachable.`);
		}
	}

	await api.disconnect();
}
enum Nomination {
	First,
	Random,
}

interface NominationConfig {
	type: Nomination,
	range: number[],
	overwrite: boolean,
}

const getMeRandomElements = function (sourceArray: any[], neededElements: number) {
	const result = [];
	for (let i = 0; i < neededElements; i++) {
		result.push(sourceArray[Math.floor(Math.random() * sourceArray.length)]);
	}
	return result;
}

// we assume all accounts already exists.
async function addNomination(api: ApiPromise, keyring: Keyring, from: number, to: number, config: NominationConfig) {
	const validators = (await api.query.staking.validators.entries());
	const firstTargets = validators.map(([stashKey, _prefs]) => {
		const stash = api.createType('AccountId', stashKey.slice(-32)).toHuman();
		return stash;
	}).slice(0, 16);
	if (firstTargets.length != 16) {
		while (firstTargets.length < 16) {
			firstTargets.push(firstTargets[0])
		}
	}

	for (let i = from; i < to; i++) {
		let nominationTargets = [];
		if (config.type === Nomination.First) {
			nominationTargets = firstTargets
		} else {
			const range = config.range;
			// pick random 16 from the range
			const indices = getMeRandomElements(range, 16);
			const accounts = indices.map((i) => getAccountAtIndex(i, keyring).address);
			nominationTargets = accounts
		}

		// generate an account using the sender seed, with a password derivation
		const account = getAccountAtIndex(i, keyring);
		const address = account.address;
		const isBonded = (await api.query.staking.ledger(address)).isSome;
		const isNominator = (await api.query.staking.nominators(address)).isSome;

		// Only touch new accounts
		if (!isBonded && !isNominator) {
			console.log(`Nominating from ${address} (${i})`);
			const tx = api.tx.utility.batchAll([
				api.tx.staking.bond(account.address, STAKE, { Staked: null }),
				api.tx.staking.nominate(nominationTargets)
			]);
			await tx.signAndSend(account);
		} else if (isBonded && !isNominator) {
			console.log(`Bonded, Nominating from ${address} (${i})`);
			const tx = api.tx.staking.nominate(nominationTargets);
			await tx.signAndSend(account);
		} else if (isBonded && isNominator && config.overwrite) {
			console.log(`Already Nominator ${address} (${i}), overwriting to ${nominationTargets}`);
			const tx = api.tx.staking.nominate(nominationTargets);
			await tx.signAndSend(account);
		} else {
			console.log(`Already Nominator ${address} (${i})`);
		}
	}
	await api.disconnect();
}

// top up all accounts to the fixed amount.
async function topOpAccounts(api: ApiPromise, keyring: Keyring, from: number, to: number) {
	const sender_seed = secret.seed;
	const god = keyring.addFromUri(sender_seed);
	let counter = from;
	const batch_size = 1000;

	while (counter < to) {
		const batch = [];
		while (batch.length < batch_size && counter < to) {
			const account = getAccountAtIndex(counter, keyring);
			const data = await api.query.system.account(account.address);
			const topup = (new BN(TOPUP)).sub(data.data.free);
			if (!topup.isZero()) {
				console.log(`[#${counter}] topping up ${account.address}`)
				batch.push(api.tx.balances.transferKeepAlive(account.address, topup));
			} else {
				console.log(`[#${counter}] ${account.address} is already good`);
			}
			counter++;
		}
		const batch_tx = api.tx.utility.batch(batch)
		await send_until_included(api, god, batch_tx);
	}
	await api.disconnect();
}

async function showStatus(api: ApiPromise, keyring: Keyring, from: number, to: number) {
	for (let i = from; i < to; i++) {
		const account = getAccountAtIndex(i, keyring);
		const data = await api.query.system.account(account.address);
		console.log(`Account #${i} has ${data.data.free.toHuman()} free balance, [nonce ${data.nonce} / ${data.providers} providers], ledger? ${(await api.query.staking.ledger(account.address)).isSome}, nominator? ${(await (api.query.staking.nominators(account.address))).isSome}`)
	}
	await api.disconnect();
}

async function createAccounts(api: ApiPromise, keyring: Keyring, from: number, to: number) {
	const sender_seed = secret.seed;
	const sender = keyring.addFromUri(sender_seed);

	const batch_size = 500;
	let counter = from;

	while (counter < to) {
		const batch = [];

		while (batch.length < batch_size && counter < to) {
			// generate an account using the sender seed, with a password derivation
			const account = getAccountAtIndex(counter, keyring);
			const address = account.address;
			const info = await api.query.system.account(address);
			const should_add = info.providers.isZero();

			// Only touch new accounts
			if (should_add) {
				console.log(`Adding ${address} (${counter})`);
				batch.push(
					api.tx.balances.transferKeepAlive(address, TOPUP)
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
	// const provider = new WsProvider('ws://localhost:9944');
	const provider = new WsProvider('wss://westend-rpc.polkadot.io/');
	const api = await ApiPromise.create({ provider });

	// Get general information about the node we are connected to
	const [chain, nodeName, nodeVersion] = await Promise.all([
		api.rpc.system.chain(),
		api.rpc.system.name(),
		api.rpc.system.version()
	]);
	console.log(`🌎 You are connected to chain ${chain} using ${nodeName} v${nodeVersion}`);
	const keyring = new Keyring({ type: 'sr25519' });

	console.log(`📈 nominators: ${await api.query.staking.counterForNominators()} / ${await api.query.staking.maxNominatorsCount()}`)
	console.log(`📉 validators: ${await api.query.staking.counterForValidators()} / ${await api.query.staking.maxValidatorsCount()}`)

	const ACCOUNTS_END = 500 * 1000;
	const NOMINATION_START = 0;

	const NOMINATION_END = 25 * 1000;
	const VALIDATION_START = 450000;
	const VALIDATION_END = VALIDATION_START + 1000;
	// uncomment something on each run, someday I will make this cli options.

	// await showStatus(api, keyring, NOMINATION_END - 2500, NOMINATION_END);
	// await addValidators(api, keyring, VALIDATION_START, VALIDATION_END);
	// await topOpAccounts(api, keyring, 0, ACCOUNTS_END);
	// await createAccounts(api, keyring, 0, ACCOUNTS_END);
	// await addNomination(
	// 	api,
	// 	keyring,
	// 	NOMINATION_START,
	// 	NOMINATION_END,
	// 	{ type: Nomination.Random, range: [VALIDATION_START, VALIDATION_END], overwrite: true },
	// );
	await chill(api, keyring, NOMINATION_END - 2500, NOMINATION_END);
	await showStatus(api, keyring, NOMINATION_END - 2500, NOMINATION_END);
}

main().catch(console.error);

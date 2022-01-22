import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { KeyringPair } from "@polkadot/keyring/types"
import { SubmittableExtrinsic } from "@polkadot/api/submittable/types"
import { ISubmittableResult } from '@polkadot/types/types';
import { BN } from '@polkadot/util';
import '@polkadot/api-augment'
import { strict as assert } from 'assert/strict';

const secret = require("../secret.json")
const WND = new BN(10).pow(new BN(12));
const PARITY_WESTEND_VALIDATORS = [
	'5C556QTtg1bJ43GDSgeowa3Ark6aeSHGTac1b2rKSXtgmSmW', // PARITY WESTEND VALIDATOR 0
	'5Ft3J6iqSQPWX2S9jERXcMpevt8JDUPWjec5uGierfVGXisE', // PARITY WESTEND VALIDATOR 1
	'5GYaYNVq6e855t5hVCyk4Wuqssaf6ADTrvdPZ3QXyHvFXTip', // PARITY WESTEND VALIDATOR 2
	'5FEjMPSs4X2XNes7QRH6eLmaYCskHdnYM8Zv2kKrBrhnzGbR', // PARITY WESTEND VALIDATOR 3
	'5CFPqoTU7fiUp1JJNbfcY2z6yavEBKDPQGg4SGeG3Fm7vCsg', // PARITY WESTEND VALIDATOR 4
	'5Ek5JCnrRsyUGYNRaEvkufG1i1EUxEE9cytuWBBjA9oNZVsf', // PARITY WESTEND VALIDATOR 5
	// '5GTD7ZeD823BjpmZBCSzBQp7cvHR1Gunq7oDkurZr9zUev2n', // PARITY WESTEND VALIDATOR 6
	'5FUJHYEzKpVJfNbtXmR9HFqmcSEz6ak7ZUhBECz7GpsFkSYR', // PARITY WESTEND VALIDATOR 7
	'5FZoQhgUCmqBxnkHX7jCqThScS2xQWiwiF61msg63CFL3Y8f', // PARITY WESTEND VALIDATOR 8
	'5G1ojzh47Yt8KoYhuAjXpHcazvsoCXe3G8LZchKDvumozJJJ', // PARITY WESTEND VALIDATOR 9
	'5HYYWyhyUQ7Ae11f8fCid58bhJ7ikLHM9bU8A6Ynwoc3dStR', // PARITY WESTEND VALIDATOR 10
	'5CFPcUJgYgWryPaV1aYjSbTpbTLu42V32Ytw1L9rfoMAsfGh', // PARITY WESTEND VALIDATOR 11
	'5ENXqYmc5m6VLMm5i1mun832xAv2Qm9t3M4PWAFvvyCJLNoR', // PARITY WESTEND VALIDATOR 12
	'5E2CYS4D6KdD1nDh5d7hTtss3TR8etx4i92ozipJt5QtR9KY', // PARITY WESTEND VALIDATOR 13
	'5DJcEbkNxsnNwHGrseg7cgbfUG8eiKzpuZqgSph5HqHrjgf6', // PARITY WESTEND VALIDATOR 14
	'5CcHdjf6sPcEkTmXFzF2CfH7MFrVHyY5PZtSm1eZsxgsj1KC', // PARITY WESTEND VALIDATOR 15
];

function getAccountAtIndex(index: number, keyring: Keyring): KeyringPair {
	return keyring.addFromUri(secret.god + "///" + index.toString());
}

/// validate from this range.
async function addValidators(api: ApiPromise, keyring: Keyring, stake: BN, from: number, to: number) {
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
				api.tx.staking.bond(account.address, stake, { Staked: null }),
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
	ParityWestend,
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
async function addNomination(api: ApiPromise, keyring: Keyring, stake: BN, from: number, to: number, config: NominationConfig) {
	if (config.type === Nomination.ParityWestend) {
		for (const v of PARITY_WESTEND_VALIDATORS) {
			const prefs = await api.query.staking.validators(v);
			console.log(prefs.toHuman(), v);
			assert.ok(!prefs.blocked, `${v} is blocked or not a validator`)
		}
	}
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
		} else if (config.type == Nomination.Random) {
			const range = config.range;
			// pick random 16 from the range
			const indices = getMeRandomElements(range, 16);
			const accounts = indices.map((i) => getAccountAtIndex(i, keyring).address);
			nominationTargets = accounts
		} else {
			nominationTargets = PARITY_WESTEND_VALIDATORS;
		}

		// generate an account using the sender seed, with a password derivation
		const account = getAccountAtIndex(i, keyring);
		const address = account.address;
		const ledger = await api.query.staking.ledger(address);
		const isBonded = ledger.isSome;
		const bondedAmount = api.createType('Balance', ledger.unwrapOrDefault().active);
		const isNominator = (await api.query.staking.nominators(address)).isSome;
		const needsBondExtra = stake.gt(bondedAmount);

		// Only touch new accounts
		if (!isBonded && !isNominator) {
			console.log(`[${i}] Bonding and nominating from ${address}`);
			const tx = api.tx.utility.batchAll([
				api.tx.staking.bond(account.address, stake, { Staked: null }),
				api.tx.staking.nominate(nominationTargets)
			]);
			await tx.signAndSend(account);
		} else if (isBonded && !isNominator) {
			console.log(`[${i} / extraBond: ${needsBondExtra}] Bonded, Nominating from ${address}`);
			const tx = needsBondExtra ? api.tx.utility.batchAll([
				api.tx.staking.bondExtra(stake.sub(bondedAmount)),
				api.tx.staking.nominate(nominationTargets)
			]): api.tx.staking.nominate(nominationTargets);
			await tx.signAndSend(account);
		} else if (isBonded && isNominator && config.overwrite) {
			console.log(`[${i} / extraBond: ${needsBondExtra}] Already Nominator ${address} with stake ${bondedAmount}, overwriting to ${stake} and new nominations (${config.type})`);
			const tx = needsBondExtra ? api.tx.utility.batchAll([
				api.tx.staking.bondExtra(stake.sub(bondedAmount)),
				api.tx.staking.nominate(nominationTargets)
			]): api.tx.staking.nominate(nominationTargets);
			await tx.signAndSend(account);
		} else {
			console.log(`Already Nominator ${address} (${i})`);
		}
	}
	await api.disconnect();
}

// top up all accounts to the fixed amount.
async function topOpAccounts(api: ApiPromise, keyring: Keyring, amount: BN, from: number, to: number) {
	const sender_seed = secret.god;
	const god = keyring.addFromUri(sender_seed);
	let counter = from;
	const batch_size = 1000;

	while (counter < to) {
		const batch = [];
		while (batch.length < batch_size && counter < to) {
			const account = getAccountAtIndex(counter, keyring);
			const data = await api.query.system.account(account.address);
			const topup = amount.sub(data.data.free);
			if (!topup.isZero()) {
				console.log(`[#${counter}] topping up ${account.address} to ${amount}`)
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

async function createAccounts(api: ApiPromise, keyring: Keyring, amount: BN, from: number, to: number) {
	const sender_seed = secret.god;
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
			const should_add = info.providers.toBn().isZero();

			// Only touch new accounts
			if (should_add) {
				console.log(`Adding ${address} (${counter})`);
				batch.push(
					api.tx.balances.transferKeepAlive(address, amount)
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

	const WND = new BN(10).pow(new BN(12))

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
	const NOMINATION_END = 23 * 1000;

	const CHEAP_NOMINATION_START = 40 * 1000;
	const CHEAP_NOMINATION_END = 80 * 1000;

	const VALIDATION_START = 450 * 1000;
	const VALIDATION_END = VALIDATION_START + 1000;

	// uncomment something on each run, someday I will make this cli options. Some examples:
	// await showStatus(api, keyring, 0, NOMINATION_END);
	// await addValidators(api, keyring, VALIDATION_START, VALIDATION_END);
	// await createAccounts(api, keyring, 0, ACCOUNTS_END);

	// await topOpAccounts(api, keyring, new BN(5).mul(WND), 8000, NOMINATION_END);

	// await addNomination(
	// 	api,
	// 	keyring,
	// 	WND.mul(new BN(3)).div(new BN(2)),
	// 	50852,
	// 	CHEAP_NOMINATION_END,
	// 	{ type: Nomination.Random, range: [VALIDATION_START, VALIDATION_END], overwrite: true },
	// );

	// await chill(api, keyring, NOMINATION_END - 2500, NOMINATION_END);
	await addNomination(
		api,
		keyring,
		WND.mul(new BN(5)).div(new BN(2)),
		21290,
		NOMINATION_END,
		{ type: Nomination.ParityWestend, range: [VALIDATION_START, VALIDATION_END], overwrite: true },
	);
	// await chill(api, keyring, 450000, 450000 + 1000);
}

main().catch(console.error);

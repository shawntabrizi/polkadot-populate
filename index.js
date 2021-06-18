var { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
var { cryptoWaitReady } = require('@polkadot/util-crypto');

const config = require("./config.json");
const secret = require("./secret.json")

// Main function which needs to run at start
async function main() {
	await cryptoWaitReady();
	const keyring = new Keyring({ type: 'sr25519' });
	//const provider = new WsProvider('ws://localhost:9944');
	const provider = new WsProvider('wss://westend-rpc.polkadot.io/');

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

	let target_accounts = config.balances.users;
	let target_balance = config.balances.balance;
	let sender_seed = secret.seed;

	let sender = keyring.addFromUri(sender_seed);

	let batch_size = 500;
	let counter = 0;
	while (counter < target_accounts) {
		let batch = [];

		while (batch.length < batch_size && counter < target_accounts) {
			// generate an account using the sender seed, with a password derivation
			let account = keyring.addFromUri(sender_seed + "///" + counter.toString());
			let address = account.address;
			let info = await api.query.system.account(address);

			// Only touch new accounts
			if (info.providers.isZero()) {
				console.log(`Adding ${address} (${counter})`);
				batch.push(
					api.tx.balances.transferKeepAlive(address, target_balance)
				)
			} else {
				console.log(`Existing ${address} (${counter})`);
			}
			counter += 1;
		}

		await send_batch(api, sender, batch);
	}

	await api.disconnect();
};

async function send_batch(api, sender, batch) {
	return new Promise (async (resolvePromise, reject) => {
		console.log(
			`--- Submitting Batch ---`
		);

		const unsub = await api.tx.utility
			.batch(batch)
			.signAndSend(sender, (result) => {
				console.log(`Current status is ${result.status}`);
				if (result.status.isInBlock) {
					console.log(
						`Transaction included at blockHash ${result.status.asInBlock}`
					);

					unsub();
					resolvePromise();

				} else if (result.isError) {
					console.log(`Transaction Error`);
					reject(`Transaction Error`);
				}
			});
	});
}

main().catch(console.error);

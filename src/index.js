/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import {bytesToHex} from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha256'
import { schnorr } from '@noble/curves/secp256k1'

let utf8Encoder = new TextEncoder()

const EVENT_KIND = {
	"EVENT_DELETION": 5,
}

const owners = ["29320975df855fe34a7b45ada2421e2c741c37c0136901fe477133a91eb18b07"];

const relayInfo = {
	"name": "cfrelay",
	"description": "A relay run at cloudflare.",
	"pubkey": "29320975df855fe34a7b45ada2421e2c741c37c0136901fe477133a91eb18b07",
	"software": "custom",
	"supported_nips": [1, 2, 4, 9, 11, 12, 16, 20, 33, 40, 42, 45, 50, 95],
	"version": "0.0.1",
}

const relayInfoJsonStr = JSON.stringify(relayInfo);

const relayInfoHeader = new Headers({
	"Content-Type": "application/nostr+json",
});

const corsHeader = new Headers({
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT",
	"Access-Control-Allow-Headers": "Upgrade, Accept, Content-Type, User-Agent",
	"Access-Control-Allow-Credentials": "true",
});

function checkOwner(pubkey) {
	return owners.includes(pubkey);
}

export default {
	async fetch(request, env, ctx) {
		// const url = new URL(request.url);
		// if (url.pathname == '/') {}

		if (request.headers.get('Upgrade') === 'websocket') {
			// websocket connection
			const [client, server] = Object.values(new WebSocketPair());
			await handleSession(env, server);

			return new Response(null, {
				status: 101,
				webSocket: client,
			});
		} else if (request.method == 'OPTIONS') {
			// handle cors
			return new Response("", {
				status: 200, headers: corsHeader,
			});
		} else if (request.headers.get('Accept') == 'application/nostr+json') {
			// return relay info
			return new Response(relayInfoJsonStr, {
				status: 200, headers: relayInfoHeader,
			});
		}

		return new Response('Hello World!');
	},
};

async function handleSession(env, websocket) {
	let isOwner = false;
	let authed = false;
	let authedPubkey;
	let challengeStr = generateRandomString(12);

	let messageHandling = 0;

	websocket.accept();
	websocket.addEventListener('message', async (wsEvent) => {
		try {
			if (wsEvent.data == 'ping') {
				websocket.send('pong');
				return;
			}

			// console.log(wsEvent.data);
			const message = JSON.parse(wsEvent.data);

			const typ = message[0];
			if (typ == 'REQ') {
				messageHandling++;
				if (messageHandling > 5 && !isOwner) {
					sendNotice(websocket, "Too fast! Slow down please!")
					return;
				}

				await doReq(env, websocket, message)
			} else if (typ == 'EVENT') {
				let event = message[1];

				if (!isOwner) {
					websocket.send('["OK","'+event.id+'",false,"Only the authed owner can send events."]');
					return;
				}
				if (event.pubkey != authedPubkey) {
					// The owner login but this isn't owner's event, so just ignore it.
					// websocket.send('["OK","'+event.id+'",false,"Only the owner can send events."]');
					return;
				}

				// due to this event is sended from owner, we don't valid the sig.
				await doEvent(env, websocket, event);
				await websocket.send('["OK","'+event.id+'",true,""]');
			} else if (typ == 'CLOSE') {
				// we haven't holder subscription and push, so just ignore the close message.
			} else if (typ == 'AUTH') {
				let pubkey = doAuth(websocket, message, challengeStr);
				if (pubkey != null) {
					console.log("doAuth result " + pubkey);
					authed = true;
					authedPubkey = pubkey;
					if (checkOwner(pubkey)) {
						isOwner = true;
					}
				} else {
					sendNotice("Auth fail");
				}
			} else if (typ == 'COUNT') {
				await doCount(env, websocket, message);
			} else {

			}
		} catch (e) {
			console.log(e);
		} finally {
			messageHandling--;
		}
	});

	websocket.addEventListener('close', async evt => {
		// Handle when a client closes the WebSocket connection
		console.log(evt);
	});

	websocket.send('["AUTH","'+challengeStr+'"]')
}

function sendNotice(websocket, msg) {
	websocket.send('["NOTICE","'+msg+'"]');
}

async function doReq(env, websocket, message) {
	if (message.length > 2) {
		let subscriptionId = message[1];

		for (let i = 2; i < message.length; i++) {
			let filter = message[i];
			let events = await doQueryEvent(env, filter);
			for (let j = 0; j < events.length; j++) {
				let event = events[j];
				// due to tags save to db had be encoded to jsonStr, so it must be decoded to json here
				let tagsStr = event.tags;
				if (typeof tagsStr == 'string') {
					event.tags = JSON.parse(tagsStr);
				}
				await websocket.send(JSON.stringify(["EVENT", subscriptionId, event]));
			}
		}

		await websocket.send('["EOSE","'+subscriptionId+'"]');
	}
}

async function doCount(env, websocket, message) {
	if (message.length > 2) {
		let subscriptionId = message[1];
		let filter = message[2];

		let count = await doQueryCount(env, filter);
		await websocket.send('["COUNT","'+subscriptionId+'",'+count+']');
	}
}

async function doQueryEvent(env, filter) {
	let params = [];
	let sql = queryEventsSql(filter, false, params);
	console.log(sql);
	console.log(params);
	const { results } = await env.DB.prepare(sql).bind(...params).all();
	return results;
}

async function doQueryCount(env, filter) {
	let params = [];
	let sql = queryEventsSql(filter, true, params);
	console.log(sql);
	return await env.DB.prepare(sql).bind(...params).first('total');
}

function queryEventsSql(filter, doCount, params) {
	let conditions = [];

	let key = 'ids';
	if (filter[key] != null && filter[key] instanceof Array && filter[key].length > 0) {
		params.push.apply(params, filter[key]);
		conditions.push('id IN('+makePlaceHolders(filter[key].length)+')')
		filter[key] = null;
	}

	key = 'authors';
	if (filter[key] != null && filter[key] instanceof Array && filter[key].length > 0) {
		params.push.apply(params, filter[key]);
		conditions.push('pubkey IN('+makePlaceHolders(filter[key].length)+')')
		filter[key] = null;
	}

	key = 'kinds';
	if (filter[key] != null && filter[key] instanceof Array && filter[key].length > 0) {
		params.push.apply(params, filter[key]);
		conditions.push('kind IN('+makePlaceHolders(filter[key].length)+')')
		filter[key] = null;
	}

	key = 'since';
	let since = filter[key];
	if (since != null) {
		conditions.push('created_at >= ?');
		params.push(since);
	}
	filter[key] = null;

	key = 'until';
	let until = filter[key];
	if (until != null) {
		conditions.push('created_at <= ?');
		params.push(until);
	}
	filter[key] = null;

	key = 'search';
	let search = filter[key];
	if (search != null && typeof search == 'string') {
		conditions.push('content LIKE ? ESCAPE "\\"');
		params.push('%'+search.replaceAll('%', '\%')+'%');
	}
	filter[key] = null;

	let tagQuery = [];
	for (let k in filter) {
		let v = filter[k];
		if (k != 'limit' && v != null) {
			v.forEach(function(vItem) {
				if (vItem.length > 10) {
					tagQuery.push('\"'+k.replaceAll('#', "")+'\",\"' + getMaxString(vItem, 30));
				} else {
					tagQuery.push('\"'+k.replaceAll('#', "")+'\",\"' + vItem);
				}
			})
		}
	}
	for (let index in tagQuery) {
		let tagValue = tagQuery[index];
		conditions.push('tags LIKE ? ESCAPE "\\"');
		params.push('%'+tagValue.replaceAll('%', '\%')+'%');
	}

	if (conditions.length == 0) {
		conditions.push("true");
	}

	let limit = filter['limit'];
	if (limit != null && limit > 0) {
		params.push(limit);
	} else {
		params.push(100); // This is a default num.
	}

	if (doCount) {
		return 'SELECT COUNT(*) as total FROM event WHERE '+ conditions.join(' And ') +' ORDER BY created_at DESC LIMIT ?';
	}

	return 'SELECT id, pubkey, created_at, kind, tags, content, sig FROM event WHERE '+ conditions.join(' And ') +' ORDER BY created_at DESC LIMIT ?'
}

function getMaxString(inputString, num) {
	if (inputString.length > num) {
		return inputString.slice(0, num);
	}
	return inputString;
}

function makePlaceHolders(n) {
	if (n == 1) {
		return "?";
	}

	let arrs = new Array(n - 1);
	arrs.fill('?');
	return arrs.join(',') + ',?';
}

async function doEvent(env, websocket, event) {
	if (event.kind === EVENT_KIND.EVENT_DELETION) {
		for (let tag in event.tags) {
			if (tag.length > 1) {
				let k = tag[0];
				let v = tag[1];
				if (k == "e") {
					const result = await env.DB.prepare("delete from event where id = ? and pubkey = ?").bind(v, event.pubkey).run();
					console.log("delete result: ");
					console.log(result);
				}
			}
		}
	} else {
		let tags = event.tags;
		if (tags !== null) {
			event.tags = JSON.stringify(tags);
			try {
				// maybe the event is existing.
				const result = await env.DB.prepare("insert into event(id, pubkey, created_at, kind, tags, content, sig) values (?, ?, ?, ?, ?, ?, ?)").bind(event.id, event.pubkey, event.created_at, event.kind, event.tags, event.content, event.sig).run();
				console.log("insert result: ");
				console.log(result);
			} catch (e) {
			}
		}
	}
}

// check the auth message and return the pubkey
function doAuth(websocket, message, challengeStr) {
	if (message.length > 1) {
		let event = message[1];
		if (event.tags != null) {
			for (let i = 0; i < event.tags.length; i++) {
				let tag = event.tags[i];
				if (tag != null && tag.length > 1) {
					let k = tag[0];
					let v = tag[1];
					if (k == 'challenge' && v == challengeStr) {
						if (verifyEvent(event)) {
							return event.pubkey;
						}
					}
				}
			}
		}
	}

	return null;
}

function verifyEvent(event) {
	const hash = getEventHash(event)
	if (hash !== event.id) {
		return false
	}

	try {
		return schnorr.verify(event.sig, hash, event.pubkey)
	} catch (err) {
		return false
	}
}

function getEventHash(event) {
	let eventHash = sha256(utf8Encoder.encode(serializeEvent(event)))
	return bytesToHex(eventHash)
}

function serializeEvent(event) {
	return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

function generateRandomString(length) {
	let result = '';
	const charactersLength = length;

	for (let i = 0; i < length; i++) {
		const randomValue = Math.floor((Date.now() * Math.random()) % charactersLength);
		result += String.fromCharCode(randomValue + 65);
	}

	return result;
}

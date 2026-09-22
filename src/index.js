/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { bytesToHex } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha256'
import { schnorr } from '@noble/curves/secp256k1'
import { decode as base64Decode } from 'js-base64';

let utf8Encoder = new TextEncoder()

const EVENT_KIND = {
	"EVENT_DELETION": 5,
	"STORAGE_SHARED_FILE": 1064,
}

const MAX_FILTER_LIMIT = 60;

const relayInfo = {
	"name": "cfrelay",
	"description": "A relay run at cloudflare.",
	"pubkey": "",
	"software": "https://github.com/haorendashu/cfrelay",
	"supported_nips": [1, 2, 5, 9, 11, 12, 16, 33, 42, 45, 50, 95, 96],
	"version": "0.1.0",
}

const relayInfoHeader = new Headers({
	"Content-Type": "application/nostr+json",
	"Access-Control-Allow-Origin": "*",
	"Cache-Control": "public, max-age=3600, s-maxage=86400",
});

const jsonHeader = new Headers({
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT",
	"Access-Control-Allow-Headers": "Upgrade, Accept, Content-Type, User-Agent",
	"Access-Control-Allow-Credentials": "true",
	"Content-Type": "application/json",
});

const cachedJsonHeader = new Headers({
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT",
	"Access-Control-Allow-Headers": "Upgrade, Accept, Content-Type, User-Agent",
	"Access-Control-Allow-Credentials": "true",
	"Content-Type": "application/json",
	"Cache-Control": "public, max-age=3600, s-maxage=86400",
});

const corsHeader = new Headers({
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT",
	"Access-Control-Allow-Headers": "Upgrade, Accept, Content-Type, User-Agent",
	"Access-Control-Allow-Credentials": "true",
});

const nip96Info = {
	"api_url": "http://127.0.0.1:8787/api/nip96/upload",
	"supported_nips": [94, 96, 98],
	"content_types": ["image/*", "video/*", "audio/*"],
	"plans": {
		"free": {
			"name": "Free",
			"is_nip98_required": true,
			"max_byte_size": 10485760,
			"file_expiration": [0, 0],
			"media_transformations": {}
		}
	}
};

const nip98AuthJsonStr = '{"status":"error","message":"NIP-98 check fail."}';

const API_FAIL = "fail";
function buildApiResult(status, message) {
	if (!status) {
		status = 'success';
	}
	if (!message) {
		message = 'success';
	}

	return {
		"status": status,
		"message": message,
	}
}

function getAllowedAuthors(env) {
	const list = [];
	if (env && env.OWNER) {
		list.push(env.OWNER);
	}
	const extra = env && (env.ALLOWED_AUTHORS || env.ALLOWED_PUBKEYS);
	if (extra) {
		if (typeof extra === 'string') {
			try {
				const parsed = JSON.parse(extra);
				if (Array.isArray(parsed)) {
					list.push(...parsed);
				} else {
					list.push(extra);
				}
			} catch (e) {
				const split = extra.split(',').map(s => s.trim()).filter(Boolean);
				list.push(...split);
			}
		} else if (Array.isArray(extra)) {
			list.push(...extra);
		}
	}
	return Array.from(new Set(list));
}

function checkAllowedAuthor(env, pubkey) {
	if (!pubkey) return false;
	return getAllowedAuthors(env).includes(pubkey);
}
const checkOwner = checkAllowedAuthor;

let isSchemaReady = false;
let schemaInitPromise = null;

async function ensureDatabaseSchema(env) {
	if (isSchemaReady) {
		return;
	}

	if (!schemaInitPromise) {
		schemaInitPromise = (async () => {
			try {
				const tableCheck = await env.DB.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' AND name='event_tag'"
				).first();

				if (!tableCheck) {
					await env.DB.batch([
						env.DB.prepare(
							"CREATE TABLE IF NOT EXISTS event (id text NOT NULL, pubkey text NOT NULL, created_at integer NOT NULL, kind integer NOT NULL, tags jsonb NOT NULL, content text NOT NULL, sig text NOT NULL)"
						),
						env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ididx ON event(id)"),
						env.DB.prepare(
							"CREATE TABLE IF NOT EXISTS event_tag (event_id text NOT NULL, tag_name text NOT NULL, tag_value text NOT NULL)"
						),
						env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tag_lookup ON event_tag(tag_name, tag_value)"),
						env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tag_event ON event_tag(event_id)"),
						env.DB.prepare(`
							INSERT OR IGNORE INTO event_tag (event_id, tag_name, tag_value)
							SELECT 
								e.id,
								json_extract(t.value, '$[0]') AS tag_name,
								json_extract(t.value, '$[1]') AS tag_value
							FROM event e, json_each(e.tags) t
							WHERE json_valid(e.tags) = 1
							  AND json_extract(t.value, '$[0]') IS NOT NULL
							  AND json_extract(t.value, '$[1]') IS NOT NULL
							  AND length(json_extract(t.value, '$[0]')) = 1
						`),
						env.DB.prepare("DROP INDEX IF EXISTS pubkeyprefix"),
						env.DB.prepare("DROP INDEX IF EXISTS kindidx"),
						env.DB.prepare("DROP INDEX IF EXISTS timeidx"),
						env.DB.prepare("DROP INDEX IF EXISTS kindtimeidx"),
						env.DB.prepare("CREATE INDEX IF NOT EXISTS pubkey_kind_time ON event(pubkey, kind, created_at DESC)"),
					]);
				}
				isSchemaReady = true;
			} catch (e) {
				schemaInitPromise = null;
				console.error("ensureDatabaseSchema error:", e);
				throw e;
			}
		})();
	}

	await schemaInitPromise;
}

export default {
	async fetch(request, env, ctx) {
		await ensureDatabaseSchema(env);
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
			relayInfo["pubkey"] = env.OWNER;
			const relayInfoJsonStr = JSON.stringify(relayInfo);
			return new Response(relayInfoJsonStr, {
				status: 200, headers: relayInfoHeader,
			});
		}

		const url = new URL(request.url);
		if (url.pathname == '/.well-known/nostr.json') {
			// return nip05 info
			const nip05UserJsonStr = '{"names":' + env.NIP05_USERS_TEXT + '}';
			return new Response(nip05UserJsonStr, {
				status: 200, headers: cachedJsonHeader,
			});
		} else if (url.pathname == '/.well-known/nostr/nip96.json') {
			// return nip96 info
			nip96Info['api_url'] = getRequestHost(request) + '/api/nip96/upload';
			return new Response(JSON.stringify(nip96Info), {
				status: 200, headers: cachedJsonHeader,
			});
		} else if (url.pathname == '/api/nip96/upload') {
			// handle nip96 upload method
			let nip98Result = verifyNip98(env, request);
			if (nip98Result != null) {
				return nip98Result;
			}

			return await handleNip96Upload(env, request);
		} else if (url.pathname.startsWith('/nip96images/')) {
			// ** This is method only use for dev, don't use it for your public access. **
			// handle nip96 download method
			return await handleNip96Download(env, request, url.pathname);
		}

		return new Response('A relay run at cloudflare.');
	},
};

async function handleSession(env, websocket) {
	let isAllowedAuthor = false;
	let authed = false;
	let authedPubkey = null;
	let challengeStr = generateRandomString(12);

	const reqTimestamps = [];

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
				if (!isAllowedAuthor) {
					const now = Date.now();
					while (reqTimestamps.length > 0 && reqTimestamps[0] <= now - 5000) {
						reqTimestamps.shift();
					}
					if (reqTimestamps.length >= 30) {
						sendNotice(websocket, "Rate limit exceeded. Please slow down.");
						return;
					}
					reqTimestamps.push(now);
				}

				await doReq(env, websocket, message, authedPubkey);
			} else if (typ == 'EVENT') {
				let event = message[1];

				if (!isAllowedAuthor) {
					websocket.send('["OK","' + event.id + '",false,"Only authorized authors can send events."]');
					return;
				}
				if (event.pubkey != authedPubkey) {
					// The author logged in but this isn't their event, so just ignore it.
					// websocket.send('["OK","'+event.id+'",false,"Only authorized authors can send events."]');
					return;
				}

				// due to this event is sended from author, we don't valid the sig.
				await doEvent(env, websocket, event);
				await websocket.send('["OK","' + event.id + '",true,""]');
			} else if (typ == 'CLOSE') {
				// we haven't holder subscription and push, so just ignore the close message.
			} else if (typ == 'AUTH') {
				let pubkey = doAuth(websocket, message, challengeStr);
				if (pubkey != null) {
					console.log("doAuth result " + pubkey);
					authed = true;
					authedPubkey = pubkey;
					if (checkAllowedAuthor(env, pubkey)) {
						isAllowedAuthor = true;
					}
				} else {
					sendNotice(websocket, "Auth fail");
				}
			} else if (typ == 'COUNT') {
				await doCount(env, websocket, message, authedPubkey);
			} else {

			}
		} catch (e) {
			console.log(e);
		}
	});

	websocket.addEventListener('close', async evt => {
		// Handle when a client closes the WebSocket connection
		console.log(evt);
	});

	websocket.send('["AUTH","' + challengeStr + '"]')
}

function sendNotice(websocket, msg) {
	websocket.send('["NOTICE","' + msg + '"]');
}

function preprocessFilter(env, filter, authorPubkey) {
	if (!filter || typeof filter !== 'object') {
		return null;
	}

	const isAllowed = typeof authorPubkey === 'string'
		? checkAllowedAuthor(env, authorPubkey)
		: Boolean(authorPubkey);

	// 1. Privacy Pre-Filtering: For callers who are not allowed authors, strip private kinds (4 and 1059)
	if (!isAllowed && Array.isArray(filter.kinds) && filter.kinds.length > 0) {
		const originalKindsCount = filter.kinds.length;
		const sanitizedKinds = filter.kinds.filter(k => k !== 4 && k !== 1059);
		if (sanitizedKinds.length === 0 && originalKindsCount > 0) {
			// Query targeted exclusively private kinds; abort database execution directly in memory
			return null;
		}
		filter.kinds = sanitizedKinds;
	}

	// 2. Whitelist Circuit Breaker: Verify author filter against allowed whitelist
	if (Array.isArray(filter.authors) && filter.authors.length > 0) {
		const allowed = getAllowedAuthors(env);
		const matchedAuthors = filter.authors.filter(a => allowed.includes(a));
		const hasIds = Array.isArray(filter.ids) && filter.ids.length > 0;

		if (matchedAuthors.length === 0 && !hasIds) {
			// Targeted non-whitelisted authors without event IDs; short-circuit directly in memory
			return null;
		}

		if (matchedAuthors.length > 0) {
			filter.authors = matchedAuthors;
		}
	}

	return filter;
}

async function doReq(env, websocket, message, authorPubkey) {
	if (message.length > 2) {
		let subscriptionId = message[1];
		let isAllowed = typeof authorPubkey === 'string'
			? checkAllowedAuthor(env, authorPubkey)
			: Boolean(authorPubkey);

		for (let i = 2; i < message.length; i++) {
			let filter = message[i];
			let processedFilter = preprocessFilter(env, filter, authorPubkey);
			if (!processedFilter) {
				continue;
			}
			let events = await doQueryEvent(env, processedFilter);
			for (let j = 0; j < events.length; j++) {
				let event = events[j];
				if (!isAllowed && (event.kind == 4 || event.kind == 1059)) {
					// only allowed authors can receive DM and GiftWrap events
					continue;
				}

				// due to tags save to db had be encoded to jsonStr, so it must be decoded to json here
				let tagsStr = event.tags;
				if (typeof tagsStr == 'string') {
					event.tags = JSON.parse(tagsStr);
				}

				if (isAllowed && typeof authorPubkey === 'string' && (event.kind == 4 || event.kind == 1059)) {
					// In a multi-author relay, ensure an allowed author only receives private events
					// where they are either the sender (event.pubkey) or the recipient (p tag)
					let isRecipient = false;
					if (Array.isArray(event.tags)) {
						for (const tag of event.tags) {
							if (tag[0] === 'p' && tag[1] === authorPubkey) {
								isRecipient = true;
								break;
							}
						}
					}
					if (event.pubkey !== authorPubkey && !isRecipient) {
						continue;
					}
				}

				if (event.kind === EVENT_KIND.STORAGE_SHARED_FILE) {
					// NIP-95 event, load the content from KV or R2 (not implement)
					let content = await env.KV.get(event.id);
					// send to client by string combine avoid json encode
					let eventStr = JSON.stringify(event, ['id', 'pubkey', 'created_at', 'kind', 'tags', 'sig']);
					await websocket.send('["EVENT","' + subscriptionId + '",{"content":"' + content + '",' + eventStr.substring(1) + ']');
					continue
				}

				await websocket.send(JSON.stringify(["EVENT", subscriptionId, event]));
			}
		}

		await websocket.send('["EOSE","' + subscriptionId + '"]');
	}
}

async function doCount(env, websocket, message, authorPubkey) {
	if (message.length > 2) {
		let subscriptionId = message[1];
		let filter = message[2];
		let processedFilter = preprocessFilter(env, filter, authorPubkey);
		if (!processedFilter) {
			await websocket.send('["COUNT","' + subscriptionId + '",0]');
			return;
		}

		let count = await doQueryCount(env, processedFilter);
		await websocket.send('["COUNT","' + subscriptionId + '",' + count + ']');
	}
}

async function doQueryEvent(env, filter) {
	let params = [];
	let sql = queryEventsSql(env, filter, false, params);
	console.log(sql);
	console.log(params);
	const { results } = await env.DB.prepare(sql).bind(...params).all();
	return results;
}

async function doQueryCount(env, filter) {
	let params = [];
	let sql = queryEventsSql(env, filter, true, params);
	console.log(sql);
	return await env.DB.prepare(sql).bind(...params).first('total');
}

const DEFAULT_KINDS = [0, 1, 3, 5, 6, 7, 9735, 10002, 30023];

function queryEventsSql(env, filter, doCount, params) {
	let conditions = [];

	let key = 'ids';
	if (filter[key] != null && filter[key] instanceof Array && filter[key].length > 0) {
		params.push.apply(params, filter[key]);
		conditions.push('id IN(' + makePlaceHolders(filter[key].length) + ')')
		filter[key] = null;
	}

	key = 'authors';
	let authors = filter[key];
	if (!authors || !(authors instanceof Array) || authors.length === 0) {
		authors = getAllowedAuthors(env);
	}
	params.push.apply(params, authors);
	conditions.push('pubkey IN(' + makePlaceHolders(authors.length) + ')');
	filter[key] = null;

	key = 'kinds';
	let kinds = filter[key];
	let limit1Kind = false;
	if (!kinds || !(kinds instanceof Array) || kinds.length === 0) {
		kinds = DEFAULT_KINDS;
	} else if (kinds.length === 1) {
		let kind = kinds[0];
		// these kind event should only return 1 event back.
		if (kind == 0 || kind == 3 || kind == 10002) {
			limit1Kind = true;
		}
	}

	params.push.apply(params, kinds);
	conditions.push('kind IN(' + makePlaceHolders(kinds.length) + ')');
	filter[key] = null;

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
		params.push('%' + search.replaceAll('%', '\%') + '%');
	}
	filter[key] = null;

	// Query tags using indexed event_tag subquery instead of tags LIKE full table scan
	for (let k in filter) {
		if (k.startsWith('#') && filter[k] != null && Array.isArray(filter[k]) && filter[k].length > 0) {
			const tagName = k.slice(1);
			const tagValues = filter[k];
			conditions.push(
				'id IN (SELECT event_id FROM event_tag WHERE tag_name = ? AND tag_value IN (' + makePlaceHolders(tagValues.length) + '))'
			);
			params.push(tagName);
			params.push.apply(params, tagValues);
		}
	}

	if (conditions.length == 0) {
		conditions.push("true");
	}

	let limit = filter['limit'];
	if (limit != null && limit > 0) {
		if (limit > MAX_FILTER_LIMIT) {
			limit = MAX_FILTER_LIMIT;
		}
		params.push(limit);
	} else {
		if (limit1Kind) {
			params.push(1); // only return 1 event back
		} else {
			params.push(MAX_FILTER_LIMIT); // This is a default num.
		}
	}

	if (doCount) {
		return 'SELECT COUNT(*) as total FROM event WHERE ' + conditions.join(' And ') + ' ORDER BY created_at DESC LIMIT ?';
	}

	return 'SELECT id, pubkey, created_at, kind, tags, content, sig FROM event WHERE ' + conditions.join(' And ') + ' ORDER BY created_at DESC LIMIT ?'
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
		// delete event
		let tagsLength = event.tags.length;
		for (let index = 0; index < tagsLength; index++) {
			let tag = event.tags[index];
			if (tag.length > 1) {
				let k = tag[0];
				let v = tag[1];
				if (k == "e") {
					const result = await env.DB.prepare("delete from event where id = ? and pubkey = ?").bind(v, event.pubkey).run();
					console.log("delete result: ");
					console.log(result);
					// clean associated tags from event_tag
					await env.DB.prepare("delete from event_tag where event_id = ?").bind(v).run();
					// try to delete kv
					try {
						await env.KV.delete(v);
					} catch (e) { }
				}
			}
		}

		return;
	} else if (event.kind === EVENT_KIND.STORAGE_SHARED_FILE) {
		// NIP-95 file, save to content to store: KV or R2 (not implement)
		let content = event.content;
		console.log(content)
		let result = await env.KV.put(event.id, content);
		console.log(result)

		// clean the content
		event.content = "";
	}

	// base event
	let rawTags = event.tags;
	if (rawTags !== null) {
		event.tags = JSON.stringify(rawTags);
		try {
			// maybe the event is existing.
			const result = await env.DB.prepare("insert or ignore into event(id, pubkey, created_at, kind, tags, content, sig) values (?, ?, ?, ?, ?, ?, ?)").bind(event.id, event.pubkey, event.created_at, event.kind, event.tags, event.content, event.sig).run();
			console.log("insert result: ", result);

			if (result.meta && result.meta.changes > 0) {
				// Insert single-character tags into event_tag
				if (Array.isArray(rawTags) && rawTags.length > 0) {
					const tagStatements = [];
					for (const tag of rawTags) {
						if (Array.isArray(tag) && tag.length >= 2) {
							const tagName = tag[0];
							const tagValue = tag[1];
							if (typeof tagName === 'string' && tagName.length === 1 && typeof tagValue === 'string') {
								tagStatements.push(
									env.DB.prepare("insert or ignore into event_tag(event_id, tag_name, tag_value) values (?, ?, ?)").bind(event.id, tagName, tagValue)
								);
							}
						}
					}
					if (tagStatements.length > 0) {
						await env.DB.batch(tagStatements);
					}
				}

				// Prune replaceable events (retain latest 5 versions)
				await pruneReplaceableEvents(env, event, rawTags);
			}
		} catch (e) {
			console.error("doEvent error:", e);
		}
	}
}

async function pruneReplaceableEvents(env, event, rawTags) {
	const kind = event.kind;
	// 1. Standard replaceable events: kind 0, 3, or 10000 <= kind < 20000
	if (kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)) {
		const oldRows = await env.DB.prepare(
			"SELECT id FROM event WHERE pubkey = ? AND kind = ? ORDER BY created_at DESC LIMIT -1 OFFSET 5"
		).bind(event.pubkey, kind).all();

		if (oldRows && oldRows.results && oldRows.results.length > 0) {
			const pruneStatements = [];
			for (const row of oldRows.results) {
				pruneStatements.push(env.DB.prepare("DELETE FROM event_tag WHERE event_id = ?").bind(row.id));
				pruneStatements.push(env.DB.prepare("DELETE FROM event WHERE id = ?").bind(row.id));
			}
			await env.DB.batch(pruneStatements);
		}
	}
	// 2. Parameterized replaceable events: 30000 <= kind < 40000 (NIP-33)
	else if (kind >= 30000 && kind < 40000) {
		let hasDTag = false;
		let dTagValue = "";
		if (Array.isArray(rawTags)) {
			for (const tag of rawTags) {
				if (Array.isArray(tag) && tag[0] === 'd') {
					hasDTag = true;
					dTagValue = tag[1] || "";
					break;
				}
			}
		}

		// If no 'd' tag is found, this parameterized replaceable event cannot be uniquely identified; skip pruning
		if (!hasDTag) {
			return;
		}

		const oldRows = await env.DB.prepare(`
			SELECT e.id FROM event e
			JOIN event_tag t ON e.id = t.event_id
			WHERE e.pubkey = ? AND e.kind = ? AND t.tag_name = 'd' AND t.tag_value = ?
			ORDER BY e.created_at DESC LIMIT -1 OFFSET 5
		`).bind(event.pubkey, kind, dTagValue).all();

		if (oldRows && oldRows.results && oldRows.results.length > 0) {
			const pruneStatements = [];
			for (const row of oldRows.results) {
				pruneStatements.push(env.DB.prepare("DELETE FROM event_tag WHERE event_id = ?").bind(row.id));
				pruneStatements.push(env.DB.prepare("DELETE FROM event WHERE id = ?").bind(row.id));
			}
			await env.DB.batch(pruneStatements);
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

function getRequestHost(request) {
	const url = new URL(request.url);
	return url.origin;
}

// check if the reqeust nip98 auth success and if the pubkey is owner.
// success return null.
// fail return a http response.
function verifyNip98(env, request) {
	let authorText = request.headers.get('Authorization');
	if (authorText != null) {
		authorText = authorText.replaceAll("Nostr ", "")
		let authEventText = base64Decode(authorText);
		const authEvent = JSON.parse(authEventText);

		if (verifyEvent(authEvent)) {
			// authEvent check success
			// check the author
			if (checkAllowedAuthor(env, authEvent.pubkey)) {
				// it's allowed author request
				return null;
			}
		}
	}

	return new Response(nip98AuthJsonStr, {
		status: 200, headers: jsonHeader,
	});
}

function getNip96DownloadUrl(env, request, fullFilename) {
	if (env.R2_CUSTOM_DOMAIN && env.R2_CUSTOM_DOMAIN != '' && env.R2_CUSTOM_DOMAIN != 'null') {
		return env.R2_CUSTOM_DOMAIN + '/' + fullFilename;
	}

	return getRequestHost(request) + '/nip96images/' + fullFilename;
}

async function handleNip96Upload(env, request) {
	let formData = await request.formData();
	let file = formData.get('file');

	let filename = file.name;
	let extension = '';
	if (filename) {
		let filenameStrs = filename.split('.')
		extension = filenameStrs[filenameStrs.length - 1];
	}
	if (extension == '') {
		let contentType = request.headers.get('Content-Type');
		let contentTypeStrs = contentType.split('/');
		let ct = contentTypeStrs[0];
		if (ct == 'image') {
			extension = 'jpg';
		} else if (ct == 'video') {
			extension = 'mp4';
		} else if (ct == 'audio') {
			extension = 'mp3';
		}
	}
	if (extension != '') {
		extension = '.' + extension;
	}

	let data = await file.arrayBuffer();
	let ox = bytesToHex(await sha256(new Uint8Array(data)));

	let fullFilename = ox + extension;

	await env.R2.put(fullFilename, data);
	let url = getNip96DownloadUrl(env, request, fullFilename);

	let nip94Event = {
		"tags": [
			["url", url],
			["ox", ox]
		],
		content: ""
	};

	let result = buildApiResult(null, 'Upload successful.');
	result['nip94_event'] = nip94Event;

	return new Response(JSON.stringify(result), {
		status: 200, headers: jsonHeader,
	});
}

async function handleNip96Download(env, request, pathname) {
	let filename = pathname.replaceAll('/nip96images/', '');
	let filenameStrs = filename.split('.');
	let key = filenameStrs[0];

	const object = await env.R2.get(key);
	if (!object) {
		return new Response('File not found.', {
			status: 400,
		});
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);

	return new Response(object.body, {
		headers,
	});
}

export {
	preprocessFilter,
	getAllowedAuthors,
	checkAllowedAuthor,
	checkOwner,
	doReq,
	doCount,
	handleSession,
};

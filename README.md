# cfrelay

A relay run at cloudflare.

## Features

- [x] NIP-01 (Basic protocol flow description)
- [x] NIP-02 (Follow List)
- [x] NIP-09 (Event Deletion)
- [x] NIP-11 (Relay Information Document)
- [x] NIP-12 (Generic Tag Queries)
- [x] NIP-33 (Parameterized Replaceable Events)
- [x] NIP-42 (Authentication of clients to relays)
- [x] NIP-45 (Counting results)
- [x] NIP-50 (Search Capability)
- [x] NIP-95 (Shared File)

## Implement

| Function            | Cloudflare implement |
|---------------------|----------------------|
| Event Store         | D1                   |
| File Store (NIP-95) | KV                   |

Why do we use the KV to save the file store?

Because the R2 must bing the payment method and when it run out of the free plan limit, it would make some fee.

## Deploy

### 1. Install NPM

### 2. Install wrangler

### 3. Init D1 database

create d1 database

```bash
wrangler d1 create relay
```

run init script

```bash
wrangler d1 execute relay --file=init.sql
```

### 4.Init KV

```bash
wrangler kv:namespace create relay
```

### 5.Change files

change the owners in in ```src/index.js```, chenge the ```29320975df855fe34a7b45ada2421e2c741c37c0136901fe477133a91eb18b07``` to you ```plain owner id```.

```js
const owners = ["29320975df855fe34a7b45ada2421e2c741c37c0136901fe477133a91eb18b07"];
```

change config file wrangler.toml set the database_id and kv_namespaces' id

```toml
[[d1_databases]]
binding = "DB"
database_name = "relay"
database_id = "Here is there d1 id"

[[kv_namespaces]]
binding = "KV"
id = "Here is there kv id"
```

### 6.Deploy

run this script to install project dependent

```bash
npm install
```

run this script to deploy

```bash
npm run deploy
```

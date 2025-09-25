# cfrelay

A relay run at cloudflare.

[![Last Version](https://img.shields.io/github/release/haorendashu/cfrelay.svg?maxAge=3600&label=Stable&labelColor=06599d&color=043b69)](https://github.com/haorendashu/cfrelay)
[![License: GNU General Public License v3.0](https://img.shields.io/github/license/haorendashu/cfrelay?labelColor=27303D&color=0877d2)](https://github.com/haorendashu/cfrelay/LICENSE)
[![GitHub Issues or Pull Requests](https://img.shields.io/github/issues/haorendashu/cfrelay?labelColor=27303D&color=0877d2)](https://github.com/haorendashu/cfrelay/issues)

## Features

- [x] NIP-01 (Basic protocol flow description)
- [x] NIP-02 (Follow List)
- [x] NIP-05 (Mapping Nostr keys to DNS-based internet identifiers)
- [x] NIP-09 (Event Deletion)
- [x] NIP-11 (Relay Information Document)
- [x] NIP-12 (Generic Tag Queries)
- [x] NIP-33 (Parameterized Replaceable Events)
- [x] NIP-42 (Authentication of clients to relays)
- [x] NIP-45 (Counting results)
- [x] NIP-50 (Search Capability)
- [x] NIP-95 (Shared File)
- [x] NIP-96 (HTTP File Storage Integration)
- [x] NIP-98 (HTTP Auth)

## Implement

| Function            | Cloudflare implement |
|---------------------|----------------------|
| Event Store         | D1                   |
| File Store (NIP-95) | KV                   |
| File Store (NIP-96) | R2                   |

Why do we use the KV to save the file store?

Because the R2 must bing the payment method and when it run out of the free plan limit, it would make some fee.

## Deploy

### Deploy by Cloudflare and Github

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fhaorendashu%2Fcfrelay)

#### 1. Add Github Connection

#### 2. Change Environment Variables

Change ```OWNER``` TO Your plain Pubkey.

Change ```NIP05_USERS_TEXT``` for your NIP05. (Optional)

#### 3. Just Tap ```Create and deploy``` button

### Deploy by NPM and wrangler

#### 1. Install NPM

#### 2. Install wrangler

#### 3. Init D1 database

create d1 database

```bash
wrangler d1 create relay
```

run init script

```bash
wrangler d1 execute relay --file=init.sql
```

#### 4.Init KV

```bash
wrangler kv:namespace create relay
```

#### 5.Init R2 (Optional)

**If you want to use R2, you must config your payment to cloudflare. I can't ensure that it won't cost you money**

After config payment, you can init the R2 bucket now. You can do it in the cloudflare website or run this script:

```bash
wrangler r2 bucket create relay
```

**It is important that config a custom domain for your bucket. Due to this domain can user cloudflare's cache and it will save you money.**

You can readmore from this [Connect a bucket to a custom domain
](https://developers.cloudflare.com/r2/buckets/public-buckets/#connect-a-bucket-to-a-custom-domain).

#### 5.Change Config file

change the owners in in ```wrangler.toml```, chenge the ```29320975df855fe34a7b45ada2421e2c741c37c0136901fe477133a91eb18b07``` to you ```plain owner id```.

``` toml
OWNER = "29320975df855fe34a7b45ada2421e2c741c37c0136901fe477133a91eb18b07"
```

```(Optional)```. change the nip05 config

``` toml
// nip05 user config should set like this:
NIP05_USERS_TEXT = '{"dashu": "29320975df855fe34a7b45ada2421e2c741c37c0136901fe477133a91eb18b07"}'
```

```(Optional)```. If you use R2 for NIP-96 and had config a custom domain, you should config r2CustomDomain in ```wrangler.toml```.

``` toml
R2_CUSTOM_DOMAIN  = "You custom domain like: https://xxxxxx.com ";
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

```(Optional)```. If you use R2 for NIP-96, you should also add this setting to wrangler.toml.

```toml
[[d1_databases]]
[[r2_buckets]]
binding = "R2"
bucket_name = "You bucket name"
```

#### 6.Deploy

run this script to install project dependent

```bash
npm install
```

run this script to deploy

```bash
npm run deploy
```

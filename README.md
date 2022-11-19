# masa-soulnames

This script allows you to mint Masa soulnames

## Algoritm
1) Generating multiple wallets
2) Sends ETH from main wallet to generated wallets via Disperse contract
3) Minting random soulName
4) Sending ETH back to main wallet
5) Repeat on all generated wallets


## Requeremets
<b>To run this bot you need to have ETH in Goerli network.</b>

Privatekeys from generated accounts will be saved to file `privatekeys{date/time}.txt`

## Setup bot
1) Download ZIP and extract it to a folder
2) Install node.js: `https://nodejs.org/en/` (LTS)
3) Paste your privatekey with gETH in `config.js`
4) Open folder with the bot in `cmd`
```bash
cd <path to folder with script>
```
5) Install dependencies
```bash
npm install
```
6) Start
```bash
node index
```

import ethers from "ethers";
import pkg from '@masa-finance/masa-sdk';
import consoleStamp from 'console-stamp';
import randomWords from "random-words";
import fs from 'fs';
import axios from 'axios';
import { config } from "./config.js"

const { Masa, Templates } = pkg;
consoleStamp(console, { format: ':date(HH:MM:ss)' });

const provider = new ethers.providers.JsonRpcProvider(`https://rpc.ankr.com/eth_goerli`);
const mainWallet = new ethers.Wallet(config.mainWalletPrivateKey, provider);
const parseFile = fileName => fs.readFileSync(fileName, "utf8").split('\n').map(str => str.trim()).filter(str => str.length > 10);
const timeout = ms => new Promise(res => setTimeout(res, ms))

let txRetryCountMap = new Map();

function getNewestFile() {
    let files = fs.readdirSync('./');
    return files.filter(file => file.includes(".txt")).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
}

async function calcAccountsAmount() {
    let balance = await provider.getBalance(mainWallet.address);
    console.log(`Main account balance: ${ethers.utils.formatUnits(balance)} gETH`);

    return Math.floor(ethers.utils.formatUnits(balance) * 0.95 / config.ethPerWallet)
}

async function disperse(walletsArray) {
    let contractAddress = `0xD152f549545093347A162Dce210e7293f1452150`
    let res = await axios.get(`https://api-goerli.etherscan.io/api?module=contract&action=getabi&address=${contractAddress}`).catch(() => { })
    let abi = res.data.result;
    let contract = new ethers.Contract(contractAddress, abi, provider);
    let contractSigner = contract.connect(mainWallet);
    let amountArray = Array(walletsArray.length).fill(ethers.utils.parseEther(config.ethPerWallet.toString()))
    let payableAmount = ethers.utils.parseEther((config.ethPerWallet * walletsArray.length).toFixed(3))
    let gasLimit = (38000 * walletsArray.length).toFixed(0);
    let feeData = await provider.getFeeData();

    let tx = await contractSigner.disperseEther(walletsArray, amountArray, {
        value: payableAmount,
        gasLimit: +gasLimit,
        maxFeePerGas: feeData["maxFeePer"],
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei")
    }).catch(err => { console.log(`Disperse transaction failed: ${err.message}`) })

    if (tx) {
        console.log(`Disperse tx sent: https://goerli.etherscan.io/tx/${tx.hash}`);
        console.log(`Waiting for tx...`);
        await tx.wait();
        return true
    }
}

async function createBatchWallets(amount) {
    let wallets = [];
    let fileName = `privatekeys${Date.now()}.txt`;

    if (amount > 300) amount = 300; // limits max wallets amount
    console.log(`Generating ${amount} wallets`);

    for (let i = 0; i < amount; i++) {
        let wallet = ethers.Wallet.createRandom();
        fs.appendFileSync(fileName, `${wallet.privateKey}\n`, "utf8");
        wallets.push(wallet.address)
    }

    return { file: fileName, wallets }
}

async function getRandomAvailableSoulName(masa, min, max) {
    const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    while (true) {
        try {
            let words = randomWords({ exactly: 2, maxLength: max });
            let soulName = `${words[0]}${capitalize(words[1])}`
            let isAvailable = await masa.contracts.isAvailable(soulName)

            if (soulName.length >= min && isAvailable) {
                return soulName
            }
        } catch (err) { console.log(`Getting random word error ${err.message}`) }
    }
}

async function transferEthToMainWallet(pk) {
    try {
        const signer = new ethers.Wallet(pk, provider);
        let balance = await provider.getBalance(signer.address)
        let gasPrice = (await provider.getFeeData()).maxFeePerGas;
        let gasLimit = ethers.BigNumber.from(21000);
        let cost = gasLimit.mul(gasPrice);
        let amountToSend = balance.sub(cost);

        if (ethers.utils.formatUnits(amountToSend).toString() > 0.001) {
            console.log(`Sending ${ethers.utils.formatUnits(amountToSend)} gETH to main wallet`);

            const tx = await signer.sendTransaction({
                to: mainWallet.address,
                value: amountToSend,
                gasLimit: 21000
            }).catch(err => console.log(`Transfer failed`))

            if (tx) {
                console.log(`Tx sent: https://goerli.etherscan.io/tx/${tx.hash}`);
            } else if (txRetryCountMap.get(signer.address) <= 5) {
                let attempt = txRetryCountMap.get(signer.address)
                console.log(`Retrying transfer from ${signer.address}, attempt ${attempt}`);
                txRetryCountMap.set(signer.address, attempt + 1)
                await timeout(5000)
                await transferEthToMainWallet(pk);
            }
        }
    } catch (err) { console.log(`Transfer eth to main wallet error ${err.message}`) }
}

async function authAndMintSoulName(pk, i) {
    let wallet = new ethers.Wallet(pk, provider);
    let masa = new Masa({ wallet })
    console.log(`Wallet [${i + 1}]: ${wallet.address}`)
    txRetryCountMap.set(wallet.address, 1);
    let attempts = 0;
    let walletSoulName = await masa.contracts.getSoulNames(wallet.address).catch(() => { });

    if (!walletSoulName) {
        let balance = await provider.getBalance(wallet.address)

        if (ethers.utils.formatUnits(balance).toString() > 0.01) {
            while (attempts < 3) {
                try {
                    let data = await masa.client.getChallenge()
                    masa.client.cookie = data.cookie;

                    let signature = await wallet.signMessage(Templates.loginTemplate(data.challenge, data.expires));
                    let user = await masa.client.checkSignature(wallet.address, signature)
                    let soulName = await getRandomAvailableSoulName(masa, 2, 8)
                    let soulNameData = await masa.metadata.store(soulName)

                    if (soulNameData) {
                        console.log(`Minting soulName: ${soulName}`);
                        let tx = await masa.contracts.purchaseIdentityAndName(wallet, soulName, 'eth', 1, `ar://${soulNameData.metadataTransaction.id}`)
                        await tx.wait()
                        console.log(`Tx mint: https://goerli.etherscan.io/tx/${tx.hash}`);
                        return true
                    } else attempts++
                } catch { error => console.log(`Masa error ${error.message}`) }
            }
        } else console.log(`low balance ${wallet.address}`);
    } else console.log(`This wallet already has a soulName ${walletSoulName[0]}`);
}



async function mintAndSend(wallet, i) {
    try {
        await authAndMintSoulName(wallet, i)
        await timeout(1500)
        config.transferToMain && await transferEthToMainWallet(wallet)
        console.log('-'.repeat(107));
    } catch (error) { }
}


(async () => {
    if (!config.retryAfterCrash) {
        let amount = await calcAccountsAmount();
        let walletsData = await createBatchWallets(amount);
        let dispersResult = await disperse(walletsData.wallets);

        if (dispersResult) {
            let wallets = parseFile(walletsData.file, 'utf8');

            for (let i = 0; i < wallets.length; i++) {
                await mintAndSend(wallets[i], i)
            }
        }
    } else {
        let file = getNewestFile()
        console.log(`Checking old wallets from ${file}`);
        let wallets = parseFile(file, 'utf8');

        for (let i = 0; i < wallets.length; i++) {
            await mintAndSend(wallets[i], i)
        }
    }
})()
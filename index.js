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
const generateRandomNumber = (min, max) => (Math.random() * (max - min) + min).toFixed(0);

let txMap = new Map();

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
    let gasLimit = (40000 * walletsArray.length).toFixed(0);

    let tx = await contractSigner.disperseEther(walletsArray, amountArray, {
        value: payableAmount,
        gasLimit: +gasLimit
    }).catch(err => { console.log(`Disperse transaction failed: ${err.message}`) })

    if (tx) {
        console.log(`Disperse tx sent: https://goerli.etherscan.io/tx/${tx.hash}`);
        await tx.wait();
        return true
    }
}

async function createBatchWallets(amount) {
    let wallets = [];
    let fileName = `privatekeys${new Date().toLocaleString().replaceAll(":", "-").replace(', ', '@').replace('.2022', '')}.txt`;

    if (amount > 500) amount = 500; // limits max wallets amount
    console.log(`Generating ${amount} wallets`);

    for (let i = 0; i < amount; i++) {
        let wallet = ethers.Wallet.createRandom();
        fs.appendFileSync(fileName, `${wallet.privateKey}\n`, "utf8");
        wallets.push(wallet.address)
    }

    return { file: fileName, wallets }
}

async function getRandomAvailableSoulName(masa, min, max) {
    while (true) {
        try {
            let soulName = randomWords({ exactly: 1, maxLength: max })[0] + generateRandomNumber(0, 9)
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
        txMap.set(signer.address, 1);

        if (ethers.utils.formatUnits(amountToSend).toString() > 0.001) {
            console.log(`Sending ${ethers.utils.formatUnits(amountToSend)} gETH to main wallet`);

            const tx = await signer.sendTransaction({
                to: mainWallet.address,
                value: amountToSend,
                gasLimit: 21000
            }).catch(err => console.log(`Transfer failed: ${err.message}`))

            if (tx) {
                console.log(`Tx sent: https://goerli.etherscan.io/tx/${tx.hash}`);
            } else if (txMap.get(signer.address) <= 3) {
                let attempt = txMap.get(signer.address)
                console.log(`Retrying transfer, attempt ${attempt}`);
                txMap.set(signer.address, attempt + 1)
                await transferEthToMainWallet(pk);
            }
        }
    } catch (err) { console.log(`Transfer eth to main wallet error ${err.message}`) }
}

async function authAndMintSoulName(pk, i) {
    let wallet = new ethers.Wallet(pk, provider);
    let masa = new Masa({ wallet })
    console.log(`Wallet [${i + 1}]: ${wallet.address}`)
    try {
        let walletSoulName = await masa.contracts.getSoulNames(wallet.address).catch(() => { });

        if (!walletSoulName) {
            let data = await masa.client.getChallenge()
            masa.client.cookie = data.cookie;

            let signature = await wallet.signMessage(Templates.loginTemplate(data.challenge, data.expires));
            let user = await masa.client.checkSignature(wallet.address, signature)
            let soulName = await getRandomAvailableSoulName(masa, 3, 6)
            let soulNameData = await masa.metadata.store(soulName)

            if (soulNameData) {
                console.log(`Minting soulName: ${soulName}`);
                let tx = await masa.contracts.purchaseIdentityAndName(wallet, soulName, 'eth', 1, `ar://${soulNameData.metadataTransaction.id}`)
                await tx.wait()
                console.log(`Tx mint: https://goerli.etherscan.io/tx/${tx.hash}`);
            }
        } else console.log(`This wallet already has a soulName ${walletSoulName[0]}`);
    } catch { error => console.log(`Masa error ${error.message}`) }
}



async function mintAndSend(wallets) {
    for (let i = 0; i < wallets.length; i++) {
        await authAndMintSoulName(wallets[i], i)
        config.transferToMain && await transferEthToMainWallet(wallets[i])
        console.log('-'.repeat(107));
    }
}


(async () => {
    if (!config.retryAfterCrash) {
        let amount = await calcAccountsAmount();
        let walletsData = await createBatchWallets(amount);
        let dispersResult = await disperse(walletsData.wallets);

        if (dispersResult) {
            let wallets = parseFile(walletsData.file, 'utf8');
            await mintAndSend(wallets)
        }
    } else {
        console.log('Checking old wallets');
        let file = getNewestFile()
        let wallets = parseFile(file, 'utf8');
        await mintAndSend(wallets)
    }
})()
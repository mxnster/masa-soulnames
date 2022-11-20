export const config = {
    mainWalletPrivateKey: '',
    ethPerWallet: 0.1, // increase this value if transactions fails because the gasPrice is too high
    transferToMain: true, // if true, eth wil be trasfered back to the main wallet after mint
    retryAfterCrash: false // set to true if script failed after sending ETH to accounts
};
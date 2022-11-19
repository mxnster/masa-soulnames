export const config = {
    mainWalletPrivateKey: '2da34f6a3d6da8dc8ef51e93524b15a06705cbb3f5c068ec50a72f48186f845a',
    ethPerWallet: 0.15, // increase this value if transactions fails because the gasPrice is too high
    transferToMain: true, // if true, eth wil be trasfered back to the main wallet after mint
    retryAfterCrash: false // set to true if script failed after sending ETH to accounts
};
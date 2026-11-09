require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");

// Deployment keys are NEVER committed and NEVER given a dummy value here.
// They arrive only via environment variables on the machine that runs
// the deploy (see .env.example). Without one, Hardhat simply has no
// funded account configured — compile/test still work.
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId: 97,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
    bsc: {
      url: process.env.BSC_RPC || "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "bscTestnet",
        chainId: 97,
        urls: { apiURL: "https://api-testnet.bscscan.com/api", browserURL: "https://testnet.bscscan.com" },
      },
      {
        network: "bsc",
        chainId: 56,
        urls: { apiURL: "https://api.bscscan.com/api", browserURL: "https://bscscan.com" },
      },
    ],
  },
};

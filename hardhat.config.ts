import '@typechain/hardhat'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-solhint'
import 'hardhat-gas-reporter'
import 'solidity-coverage'

import { resolve } from 'path'
import { config as dotenvConfig } from 'dotenv'

dotenvConfig({ path: resolve(__dirname, './.env') })

const chainIds = {
  ganache: 1337,
  goerli: 5,
  hardhat: 31337,
  kovan: 42,
  mainnet: 1,
  rinkeby: 4,
  ropsten: 3,
}

const MNEMONIC = process.env.MNEMONIC || 'The Times 03/Jan/2009 Chancellor on brink of second bailout for banks.'

export default {
  defaultNetwork: 'hardhat',
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
    hardhat: {
      accounts: {
        mnemonic: MNEMONIC,
      },
      chainId: chainIds.hardhat,
    },
    bsc_testnet: {
      url: 'https://data-seed-prebsc-1-s1.binance.org:8545',
      chainId: 97,
      gasPrice: 20000000000,
      accounts: [],
    },
    bsc_mainnet: {
      url: 'https://bsc-dataseed.binance.org/',
      chainId: 56,
      gasPrice: 20000000000,
      accounts: [],
    },
  },
  solidity: {
    version: '0.6.12',
    settings: {
      evmVersion: 'istanbul',
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: './contracts',
    excludeContracts: ['./contracts/deprecated/*.sol'],
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
  etherscan: {
    apiKey: process.env.SCAN_API,
  },
  mocha: {
    timeout: 10000,
  },
}

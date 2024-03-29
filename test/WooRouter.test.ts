/*

░██╗░░░░░░░██╗░█████╗░░█████╗░░░░░░░███████╗██╗
░██║░░██╗░░██║██╔══██╗██╔══██╗░░░░░░██╔════╝██║
░╚██╗████╗██╔╝██║░░██║██║░░██║█████╗█████╗░░██║
░░████╔═████║░██║░░██║██║░░██║╚════╝██╔══╝░░██║
░░╚██╔╝░╚██╔╝░╚█████╔╝╚█████╔╝░░░░░░██║░░░░░██║
░░░╚═╝░░░╚═╝░░░╚════╝░░╚════╝░░░░░░░╚═╝░░░░░╚═╝

*
* MIT License
* ===========
*
* Copyright (c) 2020 WooTrade
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import { expect, use } from 'chai'
import { Contract, utils, Wallet } from 'ethers'
import { ethers } from 'hardhat'
import { deployContract, deployMockContract, MockProvider, solidity } from 'ethereum-waffle'
import Wooracle from '../build/Wooracle.json'
import WooPP from '../build/WooPP.json'
import IWooPP from '../build/IWooPP.json'
// import WooRouter from '../build/WooRouter.json'
import IERC20 from '../build/IERC20.json'
import TestToken from '../build/TestToken.json'
import IWooracle from '../build/IWooracle.json'
import IWooGuardian from '../build/IWooGuardian.json'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { WooRouter } from '../typechain'
import WooRouterArtifact from '../artifacts/contracts/WooRouter.sol/WooRouter.json'

use(solidity)

const {
  BigNumber,
  constants: { MaxUint256 },
} = ethers

const ETH_PLACEHOLDER_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const WBNB_ADDR = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
const ZERO = 0

const BTC_PRICE = 60000
const WOO_PRICE = 1.05

const ONE = BigNumber.from(10).pow(18)

describe('WooRouter tests', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let baseToken: Contract
  let quoteToken: Contract
  let wooToken: Contract
  let wooGuardian: Contract
  let wooracle: Contract

  before('Deploy ERC20', async () => {
    ;[owner, user] = await ethers.getSigners()
    baseToken = await deployContract(owner, TestToken, [])
    quoteToken = await deployContract(owner, TestToken, [])
    wooToken = await deployContract(owner, TestToken, [])

    wooracle = await deployMockContract(owner, IWooracle.abi)

    wooGuardian = await deployMockContract(owner, IWooGuardian.abi)
    await wooGuardian.mock.checkSwapPrice.returns()
    await wooGuardian.mock.checkSwapAmount.returns()
    await wooGuardian.mock.checkInputAmount.returns()
  })

  describe('ctor, init & basic func', () => {
    let wooracle: Contract
    let wooPP: Contract
    let wooRouter: WooRouter

    beforeEach('Deploy WooRouter', async () => {
      wooracle = await deployContract(owner, Wooracle, [])
      wooPP = await deployContract(owner, WooPP, [quoteToken.address, wooracle.address, wooGuardian.address])
      wooRouter = (await deployContract(owner, WooRouterArtifact, [WBNB_ADDR, wooPP.address])) as WooRouter
    })

    it('Init with correct owner', async () => {
      expect(await wooRouter.owner()).to.eq(owner.address)
    })

    it('Init state variables', async () => {
      expect(await wooRouter.quoteToken()).to.eq(quoteToken.address)
      expect(await wooRouter.isWhitelisted(ZERO_ADDR)).to.eq(false)
      expect(await wooRouter.wooPool()).to.eq(wooPP.address)
    })

    it('Ctor revert', async () => {
      await expect(deployContract(owner, WooRouterArtifact, [ZERO_ADDR, wooPP.address])).to.be.revertedWith(
        'WooRouter: weth_ZERO_ADDR'
      )
    })

    it('ETH', async () => {
      expect(await wooRouter.WETH()).to.eq(WBNB_ADDR)
    })

    it('quoteToken accuracy1', async () => {
      expect(await wooRouter.quoteToken()).to.eq(await wooPP.quoteToken())
    })

    it('quoteToken accuracy2', async () => {
      expect(await wooRouter.quoteToken()).to.eq(await wooPP.quoteToken())

      let newWooPP = await deployMockContract(owner, IWooPP.abi)
      await newWooPP.mock.quoteToken.returns(wooToken.address)
      await wooRouter.setPool(newWooPP.address)
      expect(await wooRouter.quoteToken()).to.eq(wooToken.address)
    })

    it('setPool', async () => {
      let anotherQuoteToken = await deployMockContract(owner, IERC20.abi)
      let anotherWooPP = await deployContract(owner, WooPP, [
        anotherQuoteToken.address,
        wooracle.address,
        wooGuardian.address,
      ])
      await wooRouter.setPool(anotherWooPP.address)
      expect(await wooRouter.quoteToken()).to.eq(anotherQuoteToken.address)
      expect(await wooRouter.wooPool()).to.eq(anotherWooPP.address)
    })

    it('setPool revert1', async () => {
      await expect(wooRouter.setPool(ZERO_ADDR)).to.be.revertedWith('WooRouter: newPool_ADDR_ZERO')
    })

    it('setPool revert2', async () => {
      let newWooPP = await deployMockContract(owner, IWooPP.abi)
      await newWooPP.mock.quoteToken.returns(ZERO_ADDR)
      await expect(wooRouter.setPool(newWooPP.address)).to.be.revertedWith('WooRouter: quoteToken_ADDR_ZERO')
    })

    it('Emit WooPoolChanged when setPool', async () => {
      let anotherQuoteToken = await deployMockContract(owner, IERC20.abi)
      let anotherWooPP = await deployContract(owner, WooPP, [
        anotherQuoteToken.address,
        wooracle.address,
        wooGuardian.address,
      ])
      await wooRouter.setPool(anotherWooPP.address)
      await expect(wooRouter.setPool(anotherWooPP.address))
        .to.emit(wooRouter, 'WooPoolChanged')
        .withArgs(anotherWooPP.address)
    })

    it('Prevents non-owners from setPool', async () => {
      let anotherQuoteToken = await deployMockContract(owner, IERC20.abi)
      let anotherWooPP = await deployContract(owner, WooPP, [
        anotherQuoteToken.address,
        wooracle.address,
        wooGuardian.address,
      ])
      await expect(wooRouter.connect(user).setPool(anotherWooPP.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('setWhitelisted', async () => {
      expect(await wooRouter.isWhitelisted(user.address)).to.eq(false)
      await wooRouter.setWhitelisted(user.address, true)
      expect(await wooRouter.isWhitelisted(user.address)).to.eq(true)
      await wooRouter.setWhitelisted(user.address, false)
      expect(await wooRouter.isWhitelisted(user.address)).to.eq(false)
    })

    it('Prevents zero addr from setWhitelisted', async () => {
      expect(await wooRouter.isWhitelisted(ZERO_ADDR)).to.eq(false)
      await expect(wooRouter.setWhitelisted(ZERO_ADDR, true)).to.be.revertedWith('WooRouter: target_ADDR_ZERO')
      await expect(wooRouter.setWhitelisted(ZERO_ADDR, false)).to.be.revertedWith('WooRouter: target_ADDR_ZERO')
    })

    it('Prevents non-owners from setWhitelisted', async () => {
      expect(await wooRouter.isWhitelisted(user.address)).to.eq(false)
      await expect(wooRouter.connect(user).setWhitelisted(user.address, true)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(wooRouter.connect(user).setWhitelisted(user.address, false)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('rescueFunds', async () => {
      expect(await baseToken.balanceOf(wooRouter.address)).to.eq(ZERO)
      expect(await baseToken.balanceOf(owner.address)).to.eq(ZERO)

      let mintBalance = 10000
      await baseToken.mint(wooRouter.address, mintBalance)
      expect(await baseToken.balanceOf(wooRouter.address)).to.eq(mintBalance)

      await wooRouter.connect(owner).rescueFunds(baseToken.address, mintBalance)
      expect(await baseToken.balanceOf(wooRouter.address)).to.eq(ZERO)
      expect(await baseToken.balanceOf(owner.address)).to.eq(mintBalance)
    })

    it('Prevents zero addr as token addr from rescueFunds', async () => {
      await expect(wooRouter.rescueFunds(ZERO_ADDR, ZERO)).to.be.revertedWith('WooRouter: token_ADDR_ZERO')
    })

    it('Prevents non-owners from rescueFunds', async () => {
      expect(await baseToken.balanceOf(wooRouter.address)).to.eq(ZERO)
      expect(await baseToken.balanceOf(user.address)).to.eq(ZERO)

      let mintBalance = 10000
      await baseToken.mint(wooRouter.address, mintBalance)
      expect(await baseToken.balanceOf(wooRouter.address)).to.eq(mintBalance)

      await expect(wooRouter.connect(user).rescueFunds(baseToken.address, mintBalance)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      expect(await baseToken.balanceOf(user.address)).to.eq(ZERO)
    })

    it('Receive accuracy1', async () => {
      await expect(
        user.sendTransaction({
          to: wooRouter.address,
          gasPrice: 100000,
          value: 100000,
        })
      ).to.be.reverted
    })

    it('Receive accuracy2', async () => {
      await expect(
        user.sendTransaction({
          to: wooRouter.address,
          gasPrice: 100000,
          value: 100000,
        })
      ).to.be.reverted
    })

    it('Prevents user directly send ETH', async () => {
      await expect(
        user.sendTransaction({
          to: wooRouter.address,
          gasPrice: 100000,
          value: 100000,
        })
      ).to.be.reverted
    })

    it('Receive accuracy', async () => {
      await expect(
        user.sendTransaction({
          to: wooRouter.address,
          gasPrice: 100000,
          value: 100000,
        })
      ).to.be.reverted

      await wooRouter.setWhitelisted(user.address, true)
      await user.sendTransaction({
        to: wooRouter.address,
        gasPrice: 100000,
        value: 100000,
      })

      await wooRouter.setWhitelisted(user.address, false)
      await expect(
        user.sendTransaction({
          to: wooRouter.address,
          gasPrice: 100000,
          value: 100000,
        })
      ).to.be.reverted
    })
  })

  describe('swap func revert & emit event', () => {
    let wooracle: Contract
    let btcToken: Contract
    let wooToken: Contract
    let usdtToken: Contract

    let wooPP: Contract
    let wooRouter: WooRouter

    before('Deploy ERC20', async () => {
      btcToken = await deployContract(owner, TestToken, [])
      wooToken = await deployContract(owner, TestToken, [])
      usdtToken = await deployContract(owner, TestToken, [])

      wooracle = await deployMockContract(owner, IWooracle.abi)
      await wooracle.mock.timestamp.returns(BigNumber.from(1634180070))
      await wooracle.mock.state
        .withArgs(btcToken.address)
        .returns(
          utils.parseEther(BTC_PRICE.toString()),
          utils.parseEther('0.0001'),
          utils.parseEther('0.000000001'),
          true
        )
      await wooracle.mock.state
        .withArgs(wooToken.address)
        .returns(utils.parseEther('1.05'), utils.parseEther('0.002'), utils.parseEther('0.00000005'), true)
    })

    beforeEach('Deploy WooRouter', async () => {
      wooPP = await deployContract(owner, WooPP, [usdtToken.address, wooracle.address, wooGuardian.address])
      wooRouter = (await deployContract(owner, WooRouterArtifact, [WBNB_ADDR, wooPP.address])) as WooRouter

      const threshold = 0
      const lpFeeRate = 0
      const R = BigNumber.from(0)
      await wooPP.addBaseToken(btcToken.address, threshold, lpFeeRate, R)
      await wooPP.addBaseToken(wooToken.address, threshold, lpFeeRate, R)

      await btcToken.mint(wooPP.address, ONE.mul(10))
      await usdtToken.mint(wooPP.address, ONE.mul(5000000))
      await wooToken.mint(wooPP.address, ONE.mul(10000000))
    })

    it('Prevents zero addr from querySwap', async () => {
      const btcNum = 1
      await expect(wooRouter.querySwap(ZERO_ADDR, usdtToken.address, ONE.mul(btcNum))).to.be.revertedWith(
        'WooRouter: fromToken_ADDR_ZERO'
      )

      await expect(wooRouter.querySwap(btcToken.address, ZERO_ADDR, ONE.mul(btcNum))).to.be.revertedWith(
        'WooRouter: toToken_ADDR_ZERO'
      )
    })

    it('Prevents zero addr from querySellBase', async () => {
      const btcNum = 1
      await expect(wooRouter.querySellBase(ZERO_ADDR, ONE.mul(btcNum))).to.be.revertedWith(
        'WooRouter: baseToken_ADDR_ZERO'
      )
    })

    it('Prevents zero addr from querySellQuote', async () => {
      const usdtNum = 50000
      await expect(wooRouter.querySellQuote(ZERO_ADDR, ONE.mul(usdtNum))).to.be.revertedWith(
        'WooRouter: baseToken_ADDR_ZERO'
      )
    })

    it('Prevents zero addr from swap', async () => {
      await btcToken.mint(user.address, ONE.mul(1))

      const fromAmount = ONE.mul(1)
      const minToAmount = fromAmount.mul(BTC_PRICE).mul(999).div(1000)

      await btcToken.connect(user).approve(wooRouter.address, fromAmount)

      await expect(
        wooRouter.connect(user).swap(ZERO_ADDR, usdtToken.address, fromAmount, minToAmount, user.address, ZERO_ADDR)
      ).to.be.revertedWith('WooRouter: fromToken_ADDR_ZERO')

      await expect(
        wooRouter.connect(user).swap(btcToken.address, ZERO_ADDR, fromAmount, minToAmount, user.address, ZERO_ADDR)
      ).to.be.revertedWith('WooRouter: toToken_ADDR_ZERO')

      await expect(
        wooRouter.connect(user).swap(btcToken.address, usdtToken.address, fromAmount, minToAmount, ZERO_ADDR, ZERO_ADDR)
      ).to.be.revertedWith('WooRouter: to_ADDR_ZERO')
    })

    it('Prevents from invalid from swap', async () => {
      const fromAmount = ONE.mul(1)
      const minToAmount = fromAmount.mul(BTC_PRICE).mul(999).div(1000)

      await expect(
        wooRouter
          .connect(user)
          .swap(ETH_PLACEHOLDER_ADDR, usdtToken.address, fromAmount, minToAmount, user.address, ZERO_ADDR, {
            value: ONE.mul(9).div(10),
          })
      ).to.be.revertedWith('WooRouter: fromAmount_INVALID')
    })

    it('swap emit WooRouterSwap', async () => {
      await btcToken.mint(user.address, ONE.mul(1))

      const fromAmount = ONE.mul(1)
      const minToAmount = fromAmount.mul(BTC_PRICE).mul(999).div(1000)

      await btcToken.connect(user).approve(wooRouter.address, fromAmount)

      await expect(
        wooRouter
          .connect(user)
          .swap(btcToken.address, usdtToken.address, fromAmount, minToAmount, user.address, ZERO_ADDR)
      ).to.emit(wooRouter, 'WooRouterSwap')
    })

    it('Prevents zero addr from sellBase', async () => {
      await btcToken.mint(user.address, ONE.mul(1))

      const fromAmount = ONE.mul(1)
      const minToAmount = fromAmount.mul(BTC_PRICE).mul(999).div(1000)

      await btcToken.connect(user).approve(wooRouter.address, fromAmount)

      await expect(
        wooRouter.connect(user).sellBase(ZERO_ADDR, fromAmount, minToAmount, user.address, ZERO_ADDR)
      ).to.be.revertedWith('WooRouter: baseToken_ADDR_ZERO')

      await expect(
        wooRouter.connect(user).sellBase(btcToken.address, fromAmount, minToAmount, ZERO_ADDR, ZERO_ADDR)
      ).to.be.revertedWith('WooRouter: to_ADDR_ZERO')
    })

    it('sellBase emit WooRouterSwap', async () => {
      await btcToken.mint(user.address, ONE.mul(1))

      const fromAmount = ONE.mul(1)
      const minToAmount = fromAmount.mul(BTC_PRICE).mul(999).div(1000)

      await btcToken.connect(user).approve(wooRouter.address, fromAmount)

      await expect(
        wooRouter.connect(user).sellBase(btcToken.address, fromAmount, minToAmount, user.address, ZERO_ADDR)
      ).to.emit(wooRouter, 'WooRouterSwap')
    })

    it('Prevents zero addr from sellQuote', async () => {
      await usdtToken.mint(user.address, ONE.mul(50000))

      const fromAmount = ONE.mul(50000)
      const minToAmount = fromAmount.div(BTC_PRICE).mul(999).div(1000)

      await usdtToken.connect(user).approve(wooRouter.address, fromAmount)

      await expect(
        wooRouter.connect(user).sellQuote(ZERO_ADDR, fromAmount, minToAmount, user.address, ZERO_ADDR)
      ).to.be.revertedWith('WooRouter: baseToken_ADDR_ZERO')

      await expect(
        wooRouter.connect(user).sellQuote(btcToken.address, fromAmount, minToAmount, ZERO_ADDR, ZERO_ADDR)
      ).to.be.revertedWith('WooRouter: to_ADDR_ZERO')
    })

    it('sellQuote emit WooRouterSwap', async () => {
      await usdtToken.mint(user.address, ONE.mul(50000))

      const fromAmount = ONE.mul(50000)
      const minToAmount = fromAmount.div(BTC_PRICE).mul(999).div(1000)

      await usdtToken.connect(user).approve(wooRouter.address, fromAmount)

      await expect(
        wooRouter.connect(user).sellQuote(btcToken.address, fromAmount, minToAmount, user.address, ZERO_ADDR)
      ).to.emit(wooRouter, 'WooRouterSwap')
    })
  })

  describe('WooPP Paused', () => {
    let wooPP: Contract
    let wooRouter: WooRouter

    beforeEach('Deploy WooRouter', async () => {
      wooPP = await deployContract(owner, WooPP, [quoteToken.address, wooracle.address, wooGuardian.address])
      wooRouter = (await deployContract(owner, WooRouterArtifact, [WBNB_ADDR, wooPP.address])) as WooRouter

      await baseToken.mint(wooPP.address, ONE.mul(3))
      await quoteToken.mint(wooPP.address, ONE.mul(50000).mul(3))

      await baseToken.mint(user.address, ONE)
      await quoteToken.mint(user.address, ONE.mul(55000))
    })

    it('Woopp paused revert1', async () => {
      await wooPP.pause()
      expect(await wooPP.paused()).to.eq(true)

      await baseToken.connect(user).approve(wooRouter.address, ONE.mul(3))
      await quoteToken.connect(user).approve(wooRouter.address, ONE.mul(60000))

      await expect(
        wooRouter
          .connect(user)
          .swap(quoteToken.address, baseToken.address, ONE.mul(50500), ONE, user.address, ZERO_ADDR)
      ).to.be.revertedWith('Pausable: paused')

      await expect(
        wooRouter.connect(user).sellBase(baseToken.address, ONE, ONE.mul(50000 - 500), user.address, ZERO_ADDR)
      ).to.be.revertedWith('Pausable: paused')

      await expect(
        wooRouter.connect(user).sellQuote(baseToken.address, ONE.mul(50000 + 500), ONE, user.address, ZERO_ADDR)
      ).to.be.revertedWith('Pausable: paused')
    })
  })
})

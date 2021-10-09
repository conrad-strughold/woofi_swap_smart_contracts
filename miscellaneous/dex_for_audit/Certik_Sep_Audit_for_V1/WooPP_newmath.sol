/*

    Copyright 2020 DODO ZOO.
    SPDX-License-Identifier: Apache-2.0

*/

pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

// File: contracts/WooPP.sol

contract WooPP is InitializableOwnable, ReentrancyGuard {
    using SafeMath for uint256;
    using DecimalMath for uint256;
    using SafeERC20 for IERC20;

    event LpFeeRateChange(address baseToken, uint256 newLpFeeRate);
    event WooSwap(address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, address from, address to);

    mapping(address => bool) public isStrategist;

    modifier onlyStrategist() {
        require(msg.sender == _OWNER_ || isStrategist[msg.sender], 'NOT_STRATEGIST');
        _;
    }

    // ============ Core Address ============

    address public quoteToken;

    // ============ Variables for Pricing ============

    struct TokenInfo {
        uint112 reserve;
        uint112 threshold;
        uint32 lastResetTimestamp;
        uint64 lpFeeRate;
        uint64 R;
        uint112 target;
        bool isValid;
        address chainlinkRefOracle; // Reference
        uint96 refPriceFixCoeff;
    }

    address public priceOracle; // WooOracle
    mapping(address => TokenInfo) public tokenInfo;

    string public pairsInfo;

    address public rewardManager;

    function init(
        address owner,
        address _quoteToken,
        address _priceOracle,
        address quoteChainlinkRefOracle
    ) external {
        require(owner != address(0), 'INVALID_OWNER');
        require(_quoteToken != address(0), 'INVALID_QUOTE');
        require(_priceOracle != address(0), 'INVALID_ORACLE');

        initOwner(owner);
        quoteToken = _quoteToken;
        TokenInfo storage quoteInfo = tokenInfo[quoteToken];
        quoteInfo.isValid = true;
        quoteInfo.chainlinkRefOracle = quoteChainlinkRefOracle;
        // reference price decimals should be 36-token.decimals, else we multiply it by refPriceFixCoeff
        if (quoteChainlinkRefOracle != address(0)) {
            uint256 decimalsToFix = uint256(IERC20(quoteToken).decimals()).add(
                uint256(AggregatorV3Interface(quoteChainlinkRefOracle).decimals())
            );
            uint256 refPriceFixCoeff = 10**(uint256(36).sub(decimalsToFix));
            require(refPriceFixCoeff <= type(uint96).max);
            quoteInfo.refPriceFixCoeff = uint96(refPriceFixCoeff);
        }
        priceOracle = _priceOracle;
    }

    function getPairInfo() external view returns (string memory) {
        return pairsInfo;
    }

    function setPairsInfo(string calldata _pairsInfo) external onlyStrategist {
        pairsInfo = _pairsInfo;
    }

    function autoUpdate(
        address baseToken,
        TokenInfo memory baseInfo,
        TokenInfo memory quoteInfo
    ) internal view {
        uint256 baseReserve = IERC20(baseToken).balanceOf(address(this));
        uint256 quoteReserve = IERC20(quoteToken).balanceOf(address(this));
        require(baseReserve <= type(uint112).max);
        require(quoteReserve <= type(uint112).max);
        baseInfo.reserve = uint112(baseReserve);
        quoteInfo.reserve = uint112(quoteReserve);
        uint32 priceTimestamp = uint32(IOracle(priceOracle).timestamp() % 2**32);
        if (priceTimestamp != baseInfo.lastResetTimestamp) {
            if (baseInfo.threshold > baseInfo.reserve) baseInfo.target = baseInfo.threshold;
            else baseInfo.target = baseInfo.reserve;
            baseInfo.lastResetTimestamp = priceTimestamp;
        }
        if (priceTimestamp != quoteInfo.lastResetTimestamp) {
            if (quoteInfo.threshold > quoteInfo.reserve) quoteInfo.target = quoteInfo.threshold;
            else quoteInfo.target = quoteInfo.reserve;
            quoteInfo.lastResetTimestamp = priceTimestamp;
        }
    }

    // When baseSold >= 0
    function getQuoteAmountLowBaseSide(
        uint256 p,
        uint256 k,
        uint256 r,
        uint256 baseAmount
    ) internal pure returns (uint256) {
        // priceFactor = 1 + k * baseAmount * p * r;
        uint256 priceFactor = DecimalMath.ONE.add(k.mulCeil(baseAmount).mulCeil(p).mulCeil(r));
        // return baseAmount * p / priceFactor;
        return DecimalMath.divFloor(baseAmount.mulFloor(p), priceFactor); // round down
    }

    // When baseSold >= 0
    function getBaseAmountLowBaseSide(
        uint256 p,
        uint256 k,
        uint256 r,
        uint256 quoteAmount
    ) internal pure returns (uint256) {
        // priceFactor = (1 - k * quoteAmount * r);
        uint256 priceFactor = DecimalMath.ONE.sub(k.mulFloor(quoteAmount).mulFloor(r));
        // return quoteAmount * p^{-1} / priceFactor;
        return DecimalMath.divFloor(DecimalMath.divFloor(quoteAmount, p), priceFactor); // round down
    }

    // When quoteSold >= 0
    function getBaseAmountLowQuoteSide(
        uint256 p,
        uint256 k,
        uint256 r,
        uint256 quoteAmount
    ) internal pure returns (uint256) {
        // priceFactor = 1 + k * quoteAmount * r;
        uint256 priceFactor = DecimalMath.ONE.add(k.mulCeil(quoteAmount).mulCeil(r));
        // return quoteAmount * p^{-1} / priceFactor;
        return DecimalMath.divFloor(DecimalMath.divFloor(quoteAmount, p), priceFactor); // round down
    }

    // When quoteSold >= 0
    function getQuoteAmountLowQuoteSide(
        uint256 p,
        uint256 k,
        uint256 r,
        uint256 baseAmount
    ) internal pure returns (uint256) {
        // priceFactor = 1 - k * baseAmount * p * r;
        uint256 priceFactor = DecimalMath.ONE.sub(k.mulFloor(baseAmount).mulFloor(p).mulFloor(r));
        // return baseAmount * p / priceFactor;
        return DecimalMath.divFloor(baseAmount.mulFloor(p), priceFactor); // round down
    }

    function getBoughtAmount(
        TokenInfo memory baseInfo,
        TokenInfo memory quoteInfo,
        uint256 p,
        uint256 k,
        bool isSellBase
    ) internal pure returns (uint256 baseBought, uint256 quoteBought) {
        uint256 baseSold = 0;
        if (baseInfo.reserve < baseInfo.target) baseBought = uint256(baseInfo.target).sub(uint256(baseInfo.reserve));
        else baseSold = uint256(baseInfo.reserve).sub(uint256(baseInfo.target));
        uint256 quoteSold = 0;
        if (quoteInfo.reserve < quoteInfo.target)
            quoteBought = uint256(quoteInfo.target).sub(uint256(quoteInfo.reserve));
        else quoteSold = uint256(quoteInfo.reserve).sub(uint256(quoteInfo.target));

        if (baseSold.mulCeil(p) > quoteSold) {
            baseSold = baseSold.sub(DecimalMath.divFloor(quoteSold, p));
            quoteSold = 0;
        } else {
            quoteSold = quoteSold.sub(baseSold.mulCeil(p));
            baseSold = 0;
        }

        uint256 virtualBaseBought = getBaseAmountLowQuoteSide(p, k, DecimalMath.ONE, quoteSold);
        if (isSellBase == (virtualBaseBought < baseBought)) baseBought = virtualBaseBought;
        uint256 virtualQuoteBought = getQuoteAmountLowBaseSide(p, k, DecimalMath.ONE, baseSold);
        if (isSellBase == (virtualQuoteBought > quoteBought)) quoteBought = virtualQuoteBought;
    }

    function getQuoteAmountSellBase(
        address baseToken,
        uint256 baseAmount,
        TokenInfo memory baseInfo,
        TokenInfo memory quoteInfo
    ) internal view returns (uint256 quoteAmount) {
        uint256 p;
        uint256 s;
        uint256 k;
        bool isFeasible;
        (p, s, k, isFeasible) = IOracle(priceOracle).getState(baseToken);
        require(isFeasible, 'ORACLE_PRICE_NOT_FEASIBLE');

        ensurePriceReliable(p, baseInfo, quoteInfo);
        p = p.mulFloor(DecimalMath.ONE.sub(DecimalMath.divCeil(s, DecimalMath.TWO)));

        uint256 baseBought;
        uint256 quoteBought;
        (baseBought, quoteBought) = getBoughtAmount(baseInfo, quoteInfo, p, k, true);

        if (baseBought > 0) {
            uint256 quoteSold = getQuoteAmountLowQuoteSide(p, k, baseInfo.R, baseBought);
            if (baseAmount > baseBought) {
                uint256 newBaseSold = baseAmount.sub(baseBought);
                quoteAmount = quoteSold.add(getQuoteAmountLowBaseSide(p, k, DecimalMath.ONE, newBaseSold));
            } else {
                uint256 newBaseBought = baseBought.sub(baseAmount);
                quoteAmount = quoteSold.sub(getQuoteAmountLowQuoteSide(p, k, baseInfo.R, newBaseBought));
            }
        } else {
            uint256 baseSold = getBaseAmountLowBaseSide(p, k, DecimalMath.ONE, quoteBought);
            uint256 newBaseSold = baseAmount.add(baseSold);
            uint256 newQuoteBought = getQuoteAmountLowBaseSide(p, k, DecimalMath.ONE, newBaseSold);
            if (newQuoteBought > quoteBought) quoteAmount = newQuoteBought.sub(quoteBought);
        }
    }

    function getBaseAmountSellQuote(
        address baseToken,
        uint256 quoteAmount,
        TokenInfo memory baseInfo,
        TokenInfo memory quoteInfo
    ) internal view returns (uint256 baseAmount) {
        uint256 p;
        uint256 s;
        uint256 k;
        bool isFeasible;
        (p, s, k, isFeasible) = IOracle(priceOracle).getState(baseToken);
        require(isFeasible, 'ORACLE_PRICE_NOT_FEASIBLE');

        ensurePriceReliable(p, baseInfo, quoteInfo);
        p = p.mulCeil(DecimalMath.ONE.add(DecimalMath.divCeil(s, DecimalMath.TWO)));

        uint256 baseBought;
        uint256 quoteBought;
        (baseBought, quoteBought) = getBoughtAmount(baseInfo, quoteInfo, p, k, false);

        if (quoteBought > 0) {
            uint256 baseSold = getBaseAmountLowBaseSide(p, k, baseInfo.R, quoteBought);
            if (quoteAmount > quoteBought) {
                uint256 newQuoteSold = quoteAmount.sub(quoteBought);
                baseAmount = baseSold.add(getBaseAmountLowQuoteSide(p, k, DecimalMath.ONE, newQuoteSold));
            } else {
                uint256 newQuoteBought = quoteBought.sub(quoteAmount);
                baseAmount = baseSold.sub(getBaseAmountLowBaseSide(p, k, baseInfo.R, newQuoteBought));
            }
        } else {
            uint256 quoteSold = getQuoteAmountLowQuoteSide(p, k, DecimalMath.ONE, baseBought);
            uint256 newQuoteSold = quoteAmount.add(quoteSold);
            uint256 newBaseBought = getBaseAmountLowQuoteSide(p, k, DecimalMath.ONE, newQuoteSold);
            if (newBaseBought > baseBought) baseAmount = newBaseBought.sub(baseBought);
        }
    }

    function sellBase(
        address baseToken,
        uint256 baseAmount,
        uint256 minQuoteAmount,
        address from,
        address to,
        address rebateTo
    ) external preventReentrant returns (uint256 realQuoteAmount) {
        TokenInfo memory baseInfo = tokenInfo[baseToken];
        require(baseInfo.isValid, 'TOKEN_DOES_NOT_EXIST');
        TokenInfo memory quoteInfo = tokenInfo[quoteToken];
        autoUpdate(baseToken, baseInfo, quoteInfo);

        realQuoteAmount = getQuoteAmountSellBase(baseToken, baseAmount, baseInfo, quoteInfo);
        uint256 lpFee = realQuoteAmount.mulCeil(baseInfo.lpFeeRate);
        realQuoteAmount = realQuoteAmount.sub(lpFee);

        require(realQuoteAmount >= minQuoteAmount, 'PRICE_EXCEEDS_LIMIT');
        IERC20(baseToken).safeTransferFrom(from, address(this), baseAmount);
        IERC20(quoteToken).safeTransfer(to, realQuoteAmount);
        if (rewardManager != address(0)) IRewardManager(rewardManager).addReward(rebateTo, lpFee);

        tokenInfo[baseToken] = baseInfo;
        tokenInfo[quoteToken] = quoteInfo;

        emit WooSwap(baseToken, quoteToken, baseAmount, realQuoteAmount, from, to);
    }

    function sellQuote(
        address baseToken,
        uint256 quoteAmount,
        uint256 minBaseAmount,
        address from,
        address to,
        address rebateTo
    ) external preventReentrant returns (uint256 realBaseAmount) {
        TokenInfo memory baseInfo = tokenInfo[baseToken];
        require(baseInfo.isValid, 'TOKEN_DOES_NOT_EXIST');
        TokenInfo memory quoteInfo = tokenInfo[quoteToken];
        autoUpdate(baseToken, baseInfo, quoteInfo);

        uint256 lpFee = quoteAmount.mulCeil(baseInfo.lpFeeRate);
        quoteAmount = quoteAmount.sub(lpFee);
        realBaseAmount = getBaseAmountSellQuote(baseToken, quoteAmount, baseInfo, quoteInfo);

        require(realBaseAmount >= minBaseAmount, 'PRICE_EXCEEDS_LIMIT');
        IERC20(quoteToken).safeTransferFrom(from, address(this), quoteAmount.add(lpFee));
        IERC20(baseToken).safeTransfer(to, realBaseAmount);
        if (rewardManager != address(0)) IRewardManager(rewardManager).addReward(rebateTo, lpFee);

        tokenInfo[baseToken] = baseInfo;
        tokenInfo[quoteToken] = quoteInfo;

        emit WooSwap(quoteToken, baseToken, quoteAmount, realBaseAmount, from, to);
    }

    function querySellBase(address baseToken, uint256 baseAmount) external view returns (uint256 quoteAmount) {
        TokenInfo memory baseInfo = tokenInfo[baseToken];
        require(baseInfo.isValid, 'TOKEN_DOES_NOT_EXIST');
        TokenInfo memory quoteInfo = tokenInfo[quoteToken];
        autoUpdate(baseToken, baseInfo, quoteInfo);

        quoteAmount = getQuoteAmountSellBase(baseToken, baseAmount, baseInfo, quoteInfo);
        uint256 lpFee = quoteAmount.mulCeil(baseInfo.lpFeeRate);
        quoteAmount = quoteAmount.sub(lpFee);

        require(quoteAmount <= IERC20(quoteToken).balanceOf(address(this)));
    }

    function querySellQuote(address baseToken, uint256 quoteAmount) external view returns (uint256 baseAmount) {
        TokenInfo memory baseInfo = tokenInfo[baseToken];
        require(baseInfo.isValid, 'TOKEN_DOES_NOT_EXIST');
        TokenInfo memory quoteInfo = tokenInfo[quoteToken];
        autoUpdate(baseToken, baseInfo, quoteInfo);

        uint256 lpFee = quoteAmount.mulCeil(baseInfo.lpFeeRate);
        quoteAmount = quoteAmount.sub(lpFee);
        baseAmount = getBaseAmountSellQuote(baseToken, quoteAmount, baseInfo, quoteInfo);

        require(baseAmount <= IERC20(baseToken).balanceOf(address(this)));
    }

    function getPoolSize(address token) external view returns (uint256 poolSize) {
        poolSize = IERC20(token).balanceOf(address(this));
    }

    function setPriceOracle(address newPriceOracle) external onlyStrategist {
        require(newPriceOracle != address(0), 'INVALID_ORACLE');
        priceOracle = newPriceOracle;
    }

    function setChainlinkRefOracle(address token, address newChainlinkRefOracle)
        external
        preventReentrant
        onlyStrategist
    {
        TokenInfo storage info = tokenInfo[token];
        require(info.isValid, 'TOKEN_DOES_NOT_EXIST');
        info.chainlinkRefOracle = newChainlinkRefOracle;
        if (newChainlinkRefOracle != address(0)) {
            uint256 decimalsToFix = uint256(IERC20(token).decimals()).add(
                uint256(AggregatorV3Interface(newChainlinkRefOracle).decimals())
            );
            uint256 refPriceFixCoeff = 10**(uint256(36).sub(decimalsToFix));
            require(refPriceFixCoeff <= type(uint96).max);
            info.refPriceFixCoeff = uint96(refPriceFixCoeff);
        }
    }

    function setRewardManager(address newRewardManager) external onlyStrategist {
        rewardManager = newRewardManager;
    }

    function addBaseToken(
        address baseToken,
        uint256 threshold,
        uint256 lpFeeRate,
        uint256 R,
        address chainlinkRefOracle
    ) public preventReentrant onlyStrategist {
        require(threshold <= type(uint112).max, 'THRESHOLD_OUT_OF_RANGE');
        require(lpFeeRate <= 1e18, 'LP_FEE_RATE_OUT_OF_RANGE');
        require(R <= 1e18, 'R_OUT_OF_RANGE');

        require(baseToken != quoteToken, 'BASE_QUOTE_CAN_NOT_BE_SAME');

        TokenInfo memory info = tokenInfo[baseToken];
        require(!info.isValid, 'TOKEN_ALREADY_EXISTS');

        info.threshold = uint112(threshold);
        info.lpFeeRate = uint64(lpFeeRate);
        info.R = uint64(R);
        if (info.threshold > info.target) info.target = info.threshold;
        info.isValid = true;
        info.chainlinkRefOracle = chainlinkRefOracle;
        if (chainlinkRefOracle != address(0)) {
            uint256 decimalsToFix = uint256(IERC20(baseToken).decimals()).add(
                uint256(AggregatorV3Interface(chainlinkRefOracle).decimals())
            );
            uint256 refPriceFixCoeff = 10**(uint256(36).sub(decimalsToFix));
            require(refPriceFixCoeff <= type(uint96).max);
            info.refPriceFixCoeff = uint96(refPriceFixCoeff);
        }

        tokenInfo[baseToken] = info;
        emit LpFeeRateChange(baseToken, lpFeeRate);
    }

    function removeBaseToken(address baseToken) public preventReentrant onlyStrategist {
        TokenInfo memory info = tokenInfo[baseToken];
        require(info.isValid, 'TOKEN_DOES_NOT_EXIST');

        info.reserve = 0;
        info.threshold = 0;
        info.lastResetTimestamp = 0;
        info.lpFeeRate = 0;
        info.R = 0;
        info.target = 0;
        info.isValid = false;
        info.chainlinkRefOracle = address(0);
        info.refPriceFixCoeff = 0;

        tokenInfo[baseToken] = info;
        emit LpFeeRateChange(baseToken, 0);
    }

    function tuneParameters(
        address baseToken,
        uint256 newThreshold,
        uint256 newLpFeeRate,
        uint256 newR
    ) public preventReentrant onlyStrategist {
        require(newThreshold <= type(uint112).max, 'THRESHOLD_OUT_OF_RANGE');
        require(newLpFeeRate <= 1e18, 'LP_FEE_RATE_OUT_OF_RANGE');
        require(newR <= 1e18, 'R_OUT_OF_RANGE');

        TokenInfo memory info = tokenInfo[baseToken];
        require(info.isValid, 'TOKEN_DOES_NOT_EXIST');

        info.threshold = uint112(newThreshold);
        info.lpFeeRate = uint64(newLpFeeRate);
        info.R = uint64(newR);
        if (info.threshold > info.target) info.target = info.threshold;

        tokenInfo[baseToken] = info;
        emit LpFeeRateChange(baseToken, newLpFeeRate);
    }

    // ========== Administrative functions ==========

    function setStrategist(address strategist, bool flag) external onlyOwner {
        isStrategist[strategist] = flag;
    }

    function withdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function withdrawToOwner(address token, uint256 amount) external onlyStrategist {
        IERC20(token).safeTransfer(_OWNER_, amount);
    }

    // ========== Internal functions ==========
    function ensurePriceReliable(
        uint256 p,
        TokenInfo memory baseInfo,
        TokenInfo memory quoteInfo
    ) internal view {
        // check Chainlink
        if (baseInfo.chainlinkRefOracle != address(0) && quoteInfo.chainlinkRefOracle != address(0)) {
            (, int256 rawBaseRefPrice, , , ) = AggregatorV3Interface(baseInfo.chainlinkRefOracle).latestRoundData();
            require(rawBaseRefPrice >= 0, 'INVALID_CHAINLINK_PRICE');
            (, int256 rawQuoteRefPrice, , , ) = AggregatorV3Interface(quoteInfo.chainlinkRefOracle).latestRoundData();
            require(rawQuoteRefPrice >= 0, 'INVALID_CHAINLINK_QUOTE_PRICE');
            uint256 baseRefPrice = uint256(rawBaseRefPrice).mul(uint256(baseInfo.refPriceFixCoeff));
            uint256 quoteRefPrice = uint256(rawQuoteRefPrice).mul(uint256(quoteInfo.refPriceFixCoeff));
            uint256 refPrice = baseRefPrice.divFloor(quoteRefPrice);
            require(refPrice.mulFloor(1e18 - 1e16) <= p && p <= refPrice.mulCeil(1e18 + 1e16), 'PRICE_UNRELIABLE');
        }
    }
}

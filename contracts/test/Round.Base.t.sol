// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Round} from "../Round.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Shared fixture. Contains no test/fuzz/invariant functions.
abstract contract RoundTestBase is Test {
    MockUSDC internal token;
    Round internal round;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    uint256 internal unit; // one whole token, derived from token.decimals()
    uint256 internal target;
    uint256 internal cap;
    uint64 internal deadline;

    function setUp() public virtual {
        (token, round) = _deploy(6); // Arc ERC-20 view
        unit = 10 ** token.decimals();
        target = round.target();
        cap = round.perBackerCap();
        deadline = round.deadline();
    }

    /// @dev Deploys a fresh token (given decimals) + Round: target 100, cap 60 whole tokens.
    function _deploy(uint8 dec) internal returns (MockUSDC t, Round r) {
        t = new MockUSDC("Mock USD", "mUSD", dec);
        uint256 u = 10 ** t.decimals();
        r = new Round(
            creator, "Title", "ipfs://meta", 100 * u, uint64(block.timestamp + 7 days), 60 * u, IERC20(address(t))
        );
        address[4] memory actors = [alice, bob, carol, stranger];
        for (uint256 i = 0; i < actors.length; i++) {
            t.mint(actors[i], 1000 * u);
            vm.prank(actors[i]);
            t.approve(address(r), type(uint256).max);
        }
    }

    function _commitTo(Round r, address who, uint256 amount) internal {
        vm.prank(who);
        r.commit(amount);
    }

    function _commit(address who, uint256 amount) internal {
        _commitTo(round, who, amount);
    }

    function _pastDeadline() internal {
        vm.warp(deadline);
    }

    /// @dev Settled round: alice 60 + bob 40 = 100 (== target), closed.
    function _settle() internal {
        _commit(alice, 60 * unit);
        _commit(bob, 40 * unit);
        _pastDeadline();
        round.close();
    }

    /// @dev Refunded round: alice 30 + bob 20 = 50 (< target), closed.
    function _missTarget() internal {
        _commit(alice, 30 * unit);
        _commit(bob, 20 * unit);
        _pastDeadline();
        round.close();
    }

    /// @dev balanceOf(round) == accountedBalance() == sum(capTable amounts, unrefunded) - withdrawn.
    function _assertAccounting(Round r, MockUSDC t) internal view {
        (, uint256[] memory amounts) = r.capTable();
        uint256 sum;
        for (uint256 i = 0; i < amounts.length; i++) {
            sum += amounts[i];
        }
        uint256 expected = r.withdrawn() ? 0 : sum;
        uint256 bal = t.balanceOf(address(r));
        assertEq(bal, r.accountedBalance(), "balance != accountedBalance");
        assertEq(bal, expected, "balance != capTable sum (minus withdrawn)");
    }

    function _assertAccounting() internal view {
        _assertAccounting(round, token);
    }
}

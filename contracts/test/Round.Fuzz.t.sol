// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Round} from "../Round.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {RoundTestBase} from "./Round.Base.t.sol";

/// @dev Handler driving bounded, mostly-valid actions against one Round.
contract RoundHandler is Test {
    Round public round;
    MockUSDC public token;
    address public creator;
    address[] public actors;
    address public donor;

    constructor(Round round_, MockUSDC token_, address creator_, address[] memory actors_, address donor_) {
        round = round_;
        token = token_;
        creator = creator_;
        actors = actors_;
        donor = donor_;
    }

    function commit(uint256 seed, uint256 amount) external {
        if (round.state() != Round.State.Open || block.timestamp >= round.deadline()) return;
        address who = actors[seed % actors.length];
        uint256 room = round.perBackerCap() - round.commitments(who);
        if (room == 0) return;
        amount = bound(amount, 1, room);
        vm.prank(who);
        round.commit(amount);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 3 days));
    }

    function close() external {
        if (round.state() != Round.State.Open || block.timestamp < round.deadline()) return;
        round.close();
    }

    function withdraw() external {
        if (round.state() != Round.State.Settled || round.withdrawn()) return;
        vm.prank(creator);
        round.withdraw();
    }

    function refund(uint256 seed) external {
        if (round.state() != Round.State.Refunded) return;
        address who = actors[seed % actors.length];
        if (round.commitments(who) == 0) return;
        vm.prank(who);
        round.refund();
    }

    function donate(uint256 amount) external {
        amount = bound(amount, 1, 10 * (10 ** token.decimals()));
        token.mint(donor, amount);
        vm.prank(donor);
        token.transfer(address(round), amount);
    }
}

contract RoundFuzzTest is RoundTestBase {
    function testFuzz_CommitAmountsWithinCap_KeepInvariant(uint256 a1, uint256 a2, uint256 a3) public {
        a1 = bound(a1, 1, cap);
        a2 = bound(a2, 1, cap);
        a3 = bound(a3, 1, cap);

        _commit(alice, a1);
        _assertAccounting();
        _commit(bob, a2);
        _assertAccounting();
        _commit(carol, a3);
        _assertAccounting();
        assertEq(round.totalRaised(), a1 + a2 + a3);
        assertEq(token.balanceOf(address(round)), a1 + a2 + a3);

        _pastDeadline();
        round.close();
        _assertAccounting();

        if (a1 + a2 + a3 >= target) {
            vm.prank(creator);
            round.withdraw();
            assertEq(token.balanceOf(address(round)), 0);
            assertEq(token.balanceOf(creator), a1 + a2 + a3);
        } else {
            vm.prank(alice);
            round.refund();
            _assertAccounting();
            vm.prank(bob);
            round.refund();
            _assertAccounting();
            vm.prank(carol);
            round.refund();
            assertEq(token.balanceOf(address(round)), 0);
            assertEq(token.balanceOf(alice), 1000 * unit);
            assertEq(token.balanceOf(bob), 1000 * unit);
            assertEq(token.balanceOf(carol), 1000 * unit);
        }
        _assertAccounting();
    }

    function testFuzz_CommitAboveCapReverts(uint256 amount) public {
        amount = bound(amount, cap + 1, type(uint128).max);
        vm.prank(alice);
        vm.expectRevert(Round.ExceedsCap.selector);
        round.commit(amount);
    }

    function testFuzz_CumulativeCap(uint256 first, uint256 second) public {
        first = bound(first, 1, cap);
        second = bound(second, 1, cap);
        _commit(alice, first);
        if (second > cap - first) {
            vm.prank(alice);
            vm.expectRevert(Round.ExceedsCap.selector);
            round.commit(second);
        } else {
            _commit(alice, second);
            assertEq(round.commitments(alice), first + second);
        }
        _assertAccounting();
    }
}

contract RoundInvariantTest is RoundTestBase {
    RoundHandler internal handler;

    function setUp() public override {
        super.setUp();
        address[] memory actors = new address[](4);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = carol;
        actors[3] = stranger;
        handler = new RoundHandler(round, token, creator, actors, makeAddr("donor"));
        targetContract(address(handler));
    }

    /// @dev Round balance never falls below accountedBalance (donations only add surplus).
    function invariant_BalanceNeverBelowAccounted() public view {
        assertGe(token.balanceOf(address(round)), round.accountedBalance());
    }

    /// @dev accountedBalance equals the sum of outstanding capTable amounts (0 once withdrawn).
    function invariant_AccountedEqualsCapTableSum() public view {
        (, uint256[] memory amts) = round.capTable();
        uint256 sum;
        for (uint256 i = 0; i < amts.length; i++) {
            sum += amts[i];
        }
        assertEq(round.accountedBalance(), round.withdrawn() ? 0 : sum);
    }

    /// @dev Total refunded never exceeds total raised; withdrawn only if Settled.
    function invariant_RefundsBoundedAndWithdrawOnlySettled() public view {
        assertLe(round.totalRefunded(), round.totalRaised());
        if (round.withdrawn()) assertEq(uint8(round.state()), uint8(Round.State.Settled));
    }
}

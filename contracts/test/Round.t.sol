// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Round} from "../Round.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {RoundTestBase} from "./Round.Base.t.sol";

contract RoundTest is RoundTestBase {
    // ---------------------------------------------------------------- (8) constructor
    function test_Constructor_StoresArgs() public view {
        assertEq(round.creator(), creator);
        assertEq(round.title(), "Title");
        assertEq(round.metadataURI(), "ipfs://meta");
        assertEq(round.target(), 100 * unit);
        assertEq(round.perBackerCap(), 60 * unit);
        assertEq(address(round.usdc()), address(token));
        assertEq(uint8(round.state()), uint8(Round.State.Open));
        assertEq(round.backerCount(), 0);
        _assertAccounting();
    }

    function _mk(address c, address t, string memory title, uint256 tg, uint64 dl, uint256 cp) internal {
        new Round(c, title, "", tg, dl, cp, IERC20(t));
    }

    function test_Constructor_RevertsZeroCreator() public {
        vm.expectRevert(Round.InvalidCreator.selector);
        _mk(address(0), address(token), "T", target, deadline, cap);
    }

    function test_Constructor_RevertsZeroToken() public {
        vm.expectRevert(Round.InvalidToken.selector);
        _mk(creator, address(0), "T", target, deadline, cap);
    }

    function test_Constructor_RevertsEmptyTitle() public {
        vm.expectRevert(Round.EmptyTitle.selector);
        _mk(creator, address(token), "", target, deadline, cap);
    }

    function test_Constructor_RevertsZeroTarget() public {
        vm.expectRevert(Round.InvalidTarget.selector);
        _mk(creator, address(token), "T", 0, deadline, cap);
    }

    function test_Constructor_RevertsZeroCap() public {
        vm.expectRevert(Round.InvalidCap.selector);
        _mk(creator, address(token), "T", target, deadline, 0);
    }

    function test_Constructor_RevertsPastDeadline() public {
        vm.warp(1000);
        vm.expectRevert(Round.InvalidDeadline.selector);
        _mk(creator, address(token), "T", target, 999, cap);
    }

    function test_Constructor_RevertsDeadlineEqualsNow() public {
        vm.expectRevert(Round.InvalidDeadline.selector);
        _mk(creator, address(token), "T", target, uint64(block.timestamp), cap);
    }

    // ---------------------------------------------------------------- (1) cap
    function test_Commit_BelowCap() public {
        _commit(alice, cap - 1);
        assertEq(round.commitments(alice), cap - 1);
        assertEq(token.balanceOf(address(round)), cap - 1);
        _assertAccounting();
    }

    function test_Commit_AtCap() public {
        _commit(alice, cap);
        assertEq(round.commitmentOf(alice), cap);
        assertEq(round.totalRaised(), cap);
        _assertAccounting();
    }

    function test_Commit_AboveCapReverts() public {
        vm.prank(alice);
        vm.expectRevert(Round.ExceedsCap.selector);
        round.commit(cap + 1);
        _assertAccounting();
    }

    function test_Commit_CumulativeAboveCapReverts() public {
        _commit(alice, cap - 10);
        _assertAccounting();
        vm.prank(alice);
        vm.expectRevert(Round.ExceedsCap.selector);
        round.commit(11);
        // exactly filling the remainder still works
        _commit(alice, 10);
        assertEq(round.commitments(alice), cap);
        vm.prank(alice);
        vm.expectRevert(Round.ExceedsCap.selector);
        round.commit(1);
        _assertAccounting();
    }

    // ---------------------------------------------------------------- (2) deadline / zero
    function test_Commit_AfterDeadlineReverts() public {
        _pastDeadline();
        vm.prank(alice);
        vm.expectRevert(Round.DeadlinePassed.selector);
        round.commit(unit);
    }

    function test_Commit_LastSecondBeforeDeadlineWorks() public {
        vm.warp(deadline - 1);
        _commit(alice, unit);
        assertEq(round.totalRaised(), unit);
    }

    function test_Commit_ZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(Round.ZeroAmount.selector);
        round.commit(0);
    }

    function test_Commit_AfterCloseRevertsNotOpen() public {
        _missTarget();
        vm.prank(carol);
        vm.expectRevert(Round.NotOpen.selector);
        round.commit(unit);
    }

    // ---------------------------------------------------------------- (3) settle + withdraw
    function test_Settle_ThenCreatorWithdrawsAll() public {
        _commit(alice, 60 * unit);
        _assertAccounting();
        _commit(bob, 40 * unit);
        _assertAccounting();
        assertEq(token.balanceOf(address(round)), target);

        _pastDeadline();
        round.close();
        assertEq(uint8(round.state()), uint8(Round.State.Settled));
        _assertAccounting();

        uint256 before = token.balanceOf(creator);
        vm.prank(creator);
        round.withdraw();
        assertEq(token.balanceOf(creator) - before, 100 * unit);
        assertEq(token.balanceOf(address(round)), 0);
        assertEq(round.accountedBalance(), 0);
        assertTrue(round.withdrawn());
        _assertAccounting();
    }

    function test_Withdraw_SecondTimeReverts() public {
        _settle();
        vm.prank(creator);
        round.withdraw();
        vm.prank(creator);
        vm.expectRevert(Round.AlreadyWithdrawn.selector);
        round.withdraw();
    }

    function test_Withdraw_NonCreatorReverts() public {
        _settle();
        vm.prank(alice);
        vm.expectRevert(Round.NotCreator.selector);
        round.withdraw();
        vm.prank(stranger);
        vm.expectRevert(Round.NotCreator.selector);
        round.withdraw();
    }

    function test_Withdraw_WhileOpenRevertsEvenIfTargetMet() public {
        _commit(alice, 60 * unit);
        _commit(bob, 40 * unit);
        vm.prank(creator);
        vm.expectRevert(Round.NotSettled.selector);
        round.withdraw();
        // deadline passed but not yet closed: still Open
        _pastDeadline();
        vm.prank(creator);
        vm.expectRevert(Round.NotSettled.selector);
        round.withdraw();
        _assertAccounting();
    }

    function test_Settle_ExactlyAtTargetSettles() public {
        _settle();
        assertEq(round.totalRaised(), round.target());
        assertEq(uint8(round.state()), uint8(Round.State.Settled));
    }

    // ---------------------------------------------------------------- (4) refunds
    function test_Refund_EachBackerExactlyOnce() public {
        _commit(alice, 30 * unit);
        _commit(bob, 20 * unit);
        _pastDeadline();
        round.close();
        assertEq(uint8(round.state()), uint8(Round.State.Refunded));
        _assertAccounting();

        uint256 aBefore = token.balanceOf(alice);
        vm.prank(alice);
        round.refund();
        assertEq(token.balanceOf(alice) - aBefore, 30 * unit);
        assertTrue(round.refunded(alice));
        assertEq(round.commitments(alice), 0);
        assertEq(token.balanceOf(address(round)), 20 * unit);
        _assertAccounting();

        uint256 bBefore = token.balanceOf(bob);
        vm.prank(bob);
        round.refund();
        assertEq(token.balanceOf(bob) - bBefore, 20 * unit);
        assertEq(token.balanceOf(address(round)), 0);
        assertEq(round.accountedBalance(), 0);
        assertEq(round.totalRefunded(), 50 * unit);
        _assertAccounting();
    }

    function test_Refund_DoubleReverts() public {
        _missTarget();
        vm.prank(alice);
        round.refund();
        vm.prank(alice);
        vm.expectRevert(Round.NothingToRefund.selector);
        round.refund();
    }

    function test_Refund_NonBackerReverts() public {
        _missTarget();
        vm.prank(stranger);
        vm.expectRevert(Round.NothingToRefund.selector);
        round.refund();
    }

    function test_Refund_WhileOpenReverts() public {
        _commit(alice, unit);
        vm.prank(alice);
        vm.expectRevert(Round.NotRefunded.selector);
        round.refund();
    }

    function test_Refund_WhileSettledReverts() public {
        _settle();
        vm.prank(alice);
        vm.expectRevert(Round.NotRefunded.selector);
        round.refund();
    }

    // ---------------------------------------------------------------- (5) creator / close guards
    function test_Withdraw_InRefundedStateReverts() public {
        _missTarget();
        vm.prank(creator);
        vm.expectRevert(Round.NotSettled.selector);
        round.withdraw();
        _assertAccounting();
    }

    function test_Close_BeforeDeadlineReverts() public {
        vm.expectRevert(Round.DeadlineNotReached.selector);
        round.close();
        vm.warp(deadline - 1);
        vm.expectRevert(Round.DeadlineNotReached.selector);
        round.close();
    }

    function test_Close_TwiceReverts() public {
        _missTarget();
        vm.expectRevert(Round.NotOpen.selector);
        round.close();
    }

    function test_Close_AfterSettleTwiceReverts() public {
        _settle();
        vm.expectRevert(Round.NotOpen.selector);
        round.close();
    }

    function test_Close_AnyoneCanClose() public {
        _commit(alice, unit);
        _pastDeadline();
        vm.prank(stranger);
        round.close();
        assertEq(uint8(round.state()), uint8(Round.State.Refunded));
    }

    // ---------------------------------------------------------------- (7) decimals round-trip
    function _roundTripHalf(uint8 dec) internal {
        (MockUSDC t, Round r) = _deploy(dec);
        uint256 u = 10 ** t.decimals();
        uint256 half = u / 2; // 0.5 token in raw units
        assertEq(half * 2, u, "0.5 must be exactly representable");

        uint256 before = t.balanceOf(alice);
        _commitTo(r, alice, half);
        assertEq(r.commitments(alice), half);
        assertEq(t.balanceOf(address(r)), half);
        assertEq(t.balanceOf(alice), before - half);
        _assertAccounting(r, t);

        vm.warp(r.deadline());
        r.close();
        assertEq(uint8(r.state()), uint8(Round.State.Refunded));
        _assertAccounting(r, t);

        vm.prank(alice);
        r.refund();
        assertEq(t.balanceOf(alice), before, "refunded exactly");
        assertEq(t.balanceOf(address(r)), 0);
        _assertAccounting(r, t);
    }

    function test_HalfToken_RoundTrip_18Decimals() public {
        _roundTripHalf(18);
    }

    function test_HalfToken_RoundTrip_6Decimals() public {
        _roundTripHalf(6);
    }

    function test_HalfToken_18Decimals_UnitMatchesDecimals() public {
        (MockUSDC t,) = _deploy(18);
        assertEq(t.decimals(), 18);
        assertEq(10 ** t.decimals() / 2, 5 * 10 ** 17);
    }

    // ---------------------------------------------------------------- (9) capTable / events
    function test_CapTable_CommitOrderAndBackerCount() public {
        _commit(bob, 5 * unit);
        assertEq(round.backerCount(), 1);
        _commit(alice, 7 * unit);
        assertEq(round.backerCount(), 2);
        _commit(bob, 3 * unit); // repeat committer: count unchanged
        assertEq(round.backerCount(), 2);
        assertEq(round.backersLength(), 2);
        _commit(carol, unit);
        assertEq(round.backerCount(), 3);

        (address[] memory bs, uint256[] memory amts) = round.capTable();
        assertEq(bs.length, 3);
        assertEq(bs[0], bob);
        assertEq(bs[1], alice);
        assertEq(bs[2], carol);
        assertEq(amts[0], 8 * unit);
        assertEq(amts[1], 7 * unit);
        assertEq(amts[2], unit);
        _assertAccounting();
    }

    function test_Event_Committed() public {
        vm.expectEmit(true, true, false, true, address(round));
        emit Round.Committed(address(round), alice, 5 * unit, 5 * unit);
        _commit(alice, 5 * unit);

        vm.expectEmit(true, true, false, true, address(round));
        emit Round.Committed(address(round), bob, 3 * unit, 8 * unit);
        _commit(bob, 3 * unit);
    }

    function test_Event_Closed_Settled() public {
        _commit(alice, 60 * unit);
        _commit(bob, 40 * unit);
        _pastDeadline();
        vm.expectEmit(false, false, false, true, address(round));
        emit Round.Closed(Round.State.Settled, 100 * unit);
        round.close();
    }

    function test_Event_Closed_Refunded() public {
        _commit(alice, 5 * unit);
        _pastDeadline();
        vm.expectEmit(false, false, false, true, address(round));
        emit Round.Closed(Round.State.Refunded, 5 * unit);
        round.close();
    }

    function test_Event_Withdrawn() public {
        _settle();
        vm.expectEmit(true, true, false, true, address(round));
        emit Round.Withdrawn(address(round), creator, 100 * unit);
        vm.prank(creator);
        round.withdraw();
    }

    function test_Event_Refunded() public {
        _missTarget();
        vm.expectEmit(true, true, false, true, address(round));
        emit Round.Refunded(address(round), alice, 30 * unit);
        vm.prank(alice);
        round.refund();
    }

    function test_Summary() public {
        _commit(alice, 4 * unit);
        (
            address c,
            string memory ti,
            string memory uri,
            uint256 tg,
            uint64 dl,
            uint256 cp,
            Round.State st,
            uint256 raised,
            uint256 count,
            bool wd
        ) = round.summary();
        assertEq(c, creator);
        assertEq(ti, "Title");
        assertEq(uri, "ipfs://meta");
        assertEq(tg, target);
        assertEq(dl, deadline);
        assertEq(cp, cap);
        assertEq(uint8(st), uint8(Round.State.Open));
        assertEq(raised, 4 * unit);
        assertEq(count, 1);
        assertFalse(wd);
    }

    // ---------------------------------------------------------------- (12) donations
    function test_Donation_DoesNotBrickCommitAndRefund() public {
        uint256 donation = 7 * unit;
        vm.prank(stranger);
        token.transfer(address(round), donation); // direct donation, bypassing commit

        _commit(alice, 30 * unit);
        _commit(bob, 20 * unit);
        assertEq(token.balanceOf(address(round)), 50 * unit + donation);
        assertEq(round.accountedBalance(), 50 * unit);

        _pastDeadline();
        round.close();
        assertEq(uint8(round.state()), uint8(Round.State.Refunded));

        uint256 aBefore = token.balanceOf(alice);
        vm.prank(alice);
        round.refund();
        assertEq(token.balanceOf(alice) - aBefore, 30 * unit);
        uint256 bBefore = token.balanceOf(bob);
        vm.prank(bob);
        round.refund();
        assertEq(token.balanceOf(bob) - bBefore, 20 * unit);
        // donation is stranded in Refunded state
        assertEq(token.balanceOf(address(round)), donation);
        assertEq(round.accountedBalance(), 0);
    }

    function test_Donation_SweptToCreatorOnWithdrawInSettled() public {
        uint256 donation = 3 * unit;
        _commit(alice, 60 * unit);
        vm.prank(stranger);
        token.transfer(address(round), donation);
        _commit(bob, 40 * unit);
        assertEq(token.balanceOf(address(round)), target + donation);
        assertEq(round.accountedBalance(), target);

        _pastDeadline();
        round.close();

        uint256 before = token.balanceOf(creator);
        vm.expectEmit(true, true, false, true, address(round));
        emit Round.Withdrawn(address(round), creator, target + donation);
        vm.prank(creator);
        round.withdraw();
        assertEq(token.balanceOf(creator) - before, target + donation);
        assertEq(token.balanceOf(address(round)), 0);
        _assertAccounting();
    }

    // ---------------------------------------------------------------- stray transfers (documented behaviour)
    /// @dev Characterization test for tokens sent straight to a round, bypassing commit().
    ///      They are not part of totalRaised.
    ///      Settled: withdraw() sweeps the whole balance, surplus included, to the creator.
    ///      Refunded: backers get exactly their commitments and the surplus stays in the contract
    ///      for good, because no function can move it.
    function test_WithdrawSweepsStrayTokens_RefundedRoundKeepsThem() public {
        uint256 surplus = 3 * unit;

        // Settled round (the fixture round): 100 raised, 3 sent directly.
        _commit(alice, 60 * unit);
        _commit(bob, 40 * unit);
        vm.prank(stranger);
        assertTrue(token.transfer(address(round), surplus));
        _pastDeadline();
        round.close();
        assertEq(uint8(round.state()), uint8(Round.State.Settled));
        assertEq(round.totalRaised(), target, "stray tokens are not counted in totalRaised");
        assertEq(token.balanceOf(address(round)), target + surplus);

        uint256 creatorBefore = token.balanceOf(creator);
        vm.prank(creator);
        round.withdraw();
        assertEq(token.balanceOf(creator) - creatorBefore, round.totalRaised() + surplus, "withdraw sweeps surplus");
        assertEq(token.balanceOf(address(round)), 0);

        // Refunded round (own token and round): 50 raised, 3 sent directly.
        (MockUSDC t2, Round r2) = _deploy(6);
        _commitTo(r2, alice, 30 * unit);
        _commitTo(r2, bob, 20 * unit);
        vm.prank(stranger);
        assertTrue(t2.transfer(address(r2), surplus));
        vm.warp(r2.deadline());
        r2.close();
        assertEq(uint8(r2.state()), uint8(Round.State.Refunded));
        assertEq(r2.totalRaised(), 50 * unit, "stray tokens are not counted in totalRaised");

        uint256 aliceBefore = t2.balanceOf(alice);
        uint256 bobBefore = t2.balanceOf(bob);
        vm.prank(alice);
        r2.refund();
        vm.prank(bob);
        r2.refund();
        assertEq(t2.balanceOf(alice) - aliceBefore, 30 * unit, "backer gets exactly the commitment");
        assertEq(t2.balanceOf(bob) - bobBefore, 20 * unit, "backer gets exactly the commitment");

        // The surplus is stranded: nothing is owed, nothing can move it.
        assertEq(r2.accountedBalance(), 0);
        assertEq(t2.balanceOf(address(r2)), surplus, "surplus stays in a refunded round");
        vm.prank(creator);
        vm.expectRevert(Round.NotSettled.selector);
        r2.withdraw();
        assertEq(t2.balanceOf(address(r2)), surplus);
    }
}

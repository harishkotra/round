// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Round} from "../Round.sol";
import {RoundFactory} from "../RoundFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract RoundFactoryTest is Test {
    RoundFactory internal factory;
    MockUSDC internal token;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    uint256 internal unit;

    function setUp() public {
        token = new MockUSDC("Mock USD", "mUSD", 6);
        unit = 10 ** token.decimals();
        factory = new RoundFactory(IERC20(address(token)));
    }

    function _create(address who, string memory title) internal returns (Round r) {
        vm.prank(who);
        r = Round(factory.createRound(title, "ipfs://x", 100 * unit, uint64(block.timestamp + 1 days), 60 * unit));
    }

    function test_Constructor_StoresUsdc() public view {
        assertEq(address(factory.usdc()), address(token));
        assertEq(factory.roundCount(), 0);
    }

    function test_Constructor_ZeroUsdcReverts() public {
        vm.expectRevert(RoundFactory.InvalidToken.selector);
        new RoundFactory(IERC20(address(0)));
    }

    function test_CreateRound_SetsCreatorAndUsdc() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        address a = factory.createRound("My Round", "ipfs://x", 100 * unit, dl, 60 * unit);
        Round r = Round(a);
        assertEq(r.creator(), alice, "creator is msg.sender, not factory");
        assertEq(address(r.usdc()), address(token));
        assertEq(r.title(), "My Round");
        assertEq(r.metadataURI(), "ipfs://x");
        assertEq(r.target(), 100 * unit);
        assertEq(r.deadline(), dl);
        assertEq(r.perBackerCap(), 60 * unit);
        assertEq(uint8(r.state()), uint8(Round.State.Open));
    }

    function test_CreateRound_EmitsRoundCreated() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        // round address is unknown ahead of time: check creator topic + data only
        vm.expectEmit(false, true, false, true, address(factory));
        emit RoundFactory.RoundCreated(address(0), alice, "My Round", 100 * unit, dl);
        vm.prank(alice);
        address a = factory.createRound("My Round", "", 100 * unit, dl, 60 * unit);
        assertEq(factory.roundAt(0), a);
    }

    function test_CreateRound_EmittedRoundAddressMatches() public {
        vm.recordLogs();
        Round r = _create(alice, "R");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(factory) && logs[i].topics[0] == RoundFactory.RoundCreated.selector) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), address(r));
                assertEq(address(uint160(uint256(logs[i].topics[2]))), alice);
                found = true;
            }
        }
        assertTrue(found, "RoundCreated not emitted");
    }

    function test_Registry_CountAtAndAll() public {
        Round r0 = _create(alice, "A");
        Round r1 = _create(bob, "B");
        Round r2 = _create(alice, "C");
        assertEq(factory.roundCount(), 3);
        assertEq(factory.roundAt(0), address(r0));
        assertEq(factory.roundAt(1), address(r1));
        assertEq(factory.roundAt(2), address(r2));
        address[] memory all = factory.allRounds();
        assertEq(all.length, 3);
        assertEq(all[0], address(r0));
        assertEq(all[1], address(r1));
        assertEq(all[2], address(r2));
        assertEq(r1.creator(), bob);
        assertTrue(address(r0) != address(r1));
    }

    function test_RoundAt_OutOfRangeReverts() public {
        vm.expectRevert();
        factory.roundAt(0);
        _create(alice, "A");
        vm.expectRevert();
        factory.roundAt(1);
    }

    function test_CreateRound_InvalidArgsBubbleUp() public {
        vm.prank(alice);
        vm.expectRevert(Round.EmptyTitle.selector);
        factory.createRound("", "", 100 * unit, uint64(block.timestamp + 1 days), 60 * unit);
        assertEq(factory.roundCount(), 0);
    }

    function test_FactoryRound_EndToEnd() public {
        Round r = _create(alice, "E2E");
        token.mint(bob, 100 * unit);
        vm.startPrank(bob);
        token.approve(address(r), type(uint256).max);
        r.commit(60 * unit);
        vm.stopPrank();
        assertEq(token.balanceOf(address(r)), 60 * unit);
        vm.warp(r.deadline());
        r.close(); // below target -> Refunded
        vm.prank(bob);
        r.refund();
        assertEq(token.balanceOf(bob), 100 * unit);
    }
}

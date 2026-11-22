// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {MoveNotice} from "../src/MoveNotice.sol";
import {GuardedPay} from "../src/GuardedPay.sol";

/// @notice Human-run deployment for qorechain-diana.
contract Deploy is Script {
    /// @notice Deployment requires the QoreChain testnet.
    error WrongChain();
    /// @notice The configured value does not fit in uint64.
    error InvalidDelay();

    /// @notice Deploy both contracts with the configured key and write public addresses.
    function run() external {
        if (block.chainid != 9800) revert WrongChain();
        uint256 delay = vm.envOr("MIN_DELAY", uint256(600));
        if (delay > type(uint64).max) revert InvalidDelay();
        uint256 key = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(key);
        MoveNotice notice = new MoveNotice(uint64(delay));
        GuardedPay guard = new GuardedPay(notice);
        vm.stopBroadcast();

        string memory object = "deployment";
        vm.serializeUint(object, "chainId", block.chainid);
        vm.serializeAddress(object, "deployer", vm.addr(key));
        vm.serializeAddress(object, "moveNotice", address(notice));
        string memory json = vm.serializeAddress(object, "guardedPay", address(guard));
        string memory path = vm.envOr("MOVENOTICE_DEPLOYMENT_OUTPUT", string("../deployments/testnet.json"));
        vm.writeJson(json, path);
    }
}

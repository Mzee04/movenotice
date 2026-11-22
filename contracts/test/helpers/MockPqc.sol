// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IQorePQC} from "../../src/interfaces/IQorePQC.sol";

contract MockPqc is IQorePQC {
    struct Key {
        bytes data;
        bool registered;
        bool proven;
        uint8 algorithm;
    }

    mapping(address => Key) private keys;

    function setKey(address account, bytes memory key, bool registered, bool proven, uint8 algorithm) external {
        keys[account] = Key(key, registered, proven, algorithm);
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory, bool) {
        Key storage key = keys[account];
        return (key.registered, key.algorithm, key.data, key.proven);
    }

    function pqcVerify(bytes calldata key, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        return signature.length == 32 && bytes32(signature) == keccak256(abi.encodePacked("ok", key, message));
    }
}

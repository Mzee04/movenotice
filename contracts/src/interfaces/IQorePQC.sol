// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice QoreChain's post-quantum verification and registered key precompiles.
interface IQorePQC {
    /// @notice Verify an ML-DSA-87 signature over raw bytes (2592-byte key, 4627-byte signature).
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// @notice Read the registered key and whether possession was proven. Algorithm 1 is ML-DSA-87.
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

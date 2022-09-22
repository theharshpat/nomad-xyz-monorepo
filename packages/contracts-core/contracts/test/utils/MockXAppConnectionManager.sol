// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity 0.7.6;

import "@nomad-xyz/contracts-core/contracts/Home.sol";

contract MockXAppConnectionManager {
    bool public mockIsReplica;

    Home home;

    constructor(address _home) {
        home = Home(_home);
        mockIsReplica = true;
    }

    function isReplica(address replica) public returns (bool) {
        return mockIsReplica;
    }

    function setReplicaMock(bool mock) public {
        mockIsReplica = mock;
    }

    function localDomain() external view returns (uint32) {
        return home.localDomain();
    }
}

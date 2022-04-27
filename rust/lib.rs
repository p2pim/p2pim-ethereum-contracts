use ethcontract::contract;

contract!(
    pub "build/contracts/P2pimMasterRecord.json",
    mod = master_record,
);

contract!(
    pub "build/contracts/P2pimAdjudicator.json",
    mod = adjudicator,
);

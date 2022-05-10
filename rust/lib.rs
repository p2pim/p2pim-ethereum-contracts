ethcontract::contract!(
    pub "build/contracts/P2pimMasterRecord.json",
    mod = master_record,
);

ethcontract::contract!(
    pub "build/contracts/P2pimAdjudicator.json",
    mod = adjudicator,
);

pub mod third {
    pub mod openzeppelin {
        ethcontract::contract!(
            pub "node_modules/@openzeppelin/contracts/build/contracts/IERC20Metadata.json",
            mod = ierc20_metadata
        );
    }
}

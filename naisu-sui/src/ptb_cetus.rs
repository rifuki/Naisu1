//! PTB Builder for Cetus Integration
//!
//! Examples of calling Cetus functions via PTB

use crate::client::{SuiClient, SuiClientError};
use serde_json::json;

/// Integration package (your package)
pub const INTEGRATION_PACKAGE: &str =
    "0x660ea6bc10f2d6c2d40b829850ab746a6ad93c2674537c71e21809b0486254c6";

/// Cetus package
pub const CETUS_PACKAGE: &str =
    "0x0c7ae833c220aa73a3643a0d508afa4ac5d50d97312ea4584e35f9eb21b9df12";

/// Example pool IDs
pub const POOL_MEME_SUI: &str =
    "0x9501ab9cc94da40151c28defbda9c12a4b244fe774d5c97700a86c6a2265546f";

/// PTB Builder for Cetus operations
pub struct CetusPtbBuilder {
    client: SuiClient,
}

impl CetusPtbBuilder {
    pub fn new(client: SuiClient) -> Self {
        Self { client }
    }

    /// Call fetch_pools from your integration package
    ///
    /// Assumes your function signature:
    /// public fun fetch_pools(pool: &Pool, ...): vector<PoolSimpleInfo>
    pub async fn call_integration_fetch_pools(
        &self,
        module: &str,
        function: &str,
        pool_object_id: &str,
        // Add other params as needed
    ) -> Result<serde_json::Value, SuiClientError> {
        // Build PTB for calling your integration function
        let ptb = json!({
            "kind": "ProgrammableTransaction",
            "inputs": [
                {
                    "objectId": pool_object_id,
                    "version": null,
                    "digest": null
                }
            ],
            "transactions": [
                {
                    "MoveCall": {
                        "package": INTEGRATION_PACKAGE,
                        "module": module,
                        "function": function,
                        "typeArguments": [],
                        "arguments": [
                            {"Input": 0}
                            // Add more arguments as needed
                        ]
                    }
                }
            ]
        });

        // Use dryRunTransactionBlock to simulate
        let result = self.dry_run_ptb(ptb).await?;
        Ok(result)
    }

    /// Call Cetus factory::fetch_pools directly
    pub async fn call_cetus_fetch_pools(
        &self,
        start: Option<String>,
        limit: u64,
    ) -> Result<serde_json::Value, SuiClientError> {
        let factory_object = "0x50eb61dd5928cec5ea04711a2e9b72e5237e79e9fbcd2ce3d5469dc8708e0ee2";

        let start_input = match start {
            Some(id) => json!(id),
            None => json!(null),
        };

        let ptb = json!({
            "kind": "ProgrammableTransaction",
            "inputs": [
                {"objectId": factory_object, "version": null, "digest": null},
                start_input,
                limit.to_string()
            ],
            "transactions": [
                {
                    "MoveCall": {
                        "package": CETUS_PACKAGE,
                        "module": "factory",
                        "function": "fetch_pools",
                        "typeArguments": [],
                        "arguments": [
                            {"Input": 0},
                            {"Input": 1},
                            {"Input": 2}
                        ]
                    }
                }
            ]
        });

        self.dry_run_ptb(ptb).await
    }

    /// Call Cetus pool::calculate_swap_result
    pub async fn calculate_swap_result(
        &self,
        pool_object_id: &str,
        a_to_b: bool,
        amount: u64,
        is_exact_in: bool,
    ) -> Result<serde_json::Value, SuiClientError> {
        let ptb = json!({
            "kind": "ProgrammableTransaction",
            "inputs": [
                {"objectId": pool_object_id, "version": null, "digest": null},
                a_to_b,
                amount.to_string(),
                is_exact_in
            ],
            "transactions": [
                {
                    "MoveCall": {
                        "package": CETUS_PACKAGE,
                        "module": "pool",
                        "function": "calculate_swap_result",
                        "typeArguments": [], // Add coin types if needed
                        "arguments": [
                            {"Input": 0},
                            {"Input": 1},
                            {"Input": 2},
                            {"Input": 3}
                        ]
                    }
                }
            ]
        });

        self.dry_run_ptb(ptb).await
    }

    /// Dry run PTB to simulate transaction
    async fn dry_run_ptb(
        &self,
        ptb: serde_json::Value,
    ) -> Result<serde_json::Value, SuiClientError> {
        // Use a dummy sender for view functions
        let sender = "0x0000000000000000000000000000000000000000000000000000000000000000";

        let params = json!([
            sender, ptb, null, // gas price
            null  // epoch
        ]);

        self.client
            .rpc_call("sui_devInspectTransactionBlock", params)
            .await
    }

    /// Execute PTB (requires signer)
    #[allow(dead_code)]
    async fn execute_ptb(
        &self,
        ptb: serde_json::Value,
        _sender: &str,
    ) -> Result<serde_json::Value, SuiClientError> {
        // This would require transaction signing
        // For now, just dry run
        self.dry_run_ptb(ptb).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires network access"]
    async fn test_fetch_pools() {
        let config = crate::config::SuiConfig::testnet();
        let client = SuiClient::new(config);
        let builder = CetusPtbBuilder::new(client);

        let result = builder.call_cetus_fetch_pools(None, 10).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore = "requires network access"]
    async fn test_calculate_swap() {
        let config = crate::config::SuiConfig::testnet();
        let client = SuiClient::new(config);
        let builder = CetusPtbBuilder::new(client);

        let result = builder
            .calculate_swap_result(POOL_MEME_SUI, true, 1000000, true)
            .await;
        assert!(result.is_ok());
    }
}

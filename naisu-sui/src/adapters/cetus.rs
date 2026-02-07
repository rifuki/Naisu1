//! Cetus Protocol Adapter
//!
//! Fetches pool data from Cetus CLMM for solver integration.
//! Cetus Testnet: Package 0x0c7ae833c220aa73a3643a0d508afa4ac5d50d97312ea4584e35f9eb21b9df12

use crate::client::{SuiClient, SuiClientError};
use serde::{Deserialize, Serialize};

/// Cetus Package ID (Testnet)
pub const CETUS_PACKAGE: &str =
    "0x0c7ae833c220aa73a3643a0d508afa4ac5d50d97312ea4584e35f9eb21b9df12";

/// Cetus Factory Object (Pools registry)
pub const CETUS_FACTORY: &str =
    "0x50eb61dd5928cec5ea04711a2e9b72e5237e79e9fbcd2ce3d5469dc8708e0ee2";

/// Cetus Factory Table (contains pool nodes)
pub const CETUS_FACTORY_TABLE: &str =
    "0xabfc11f92977d2537860dca59170f4ff762c68a2e649b34c5273838ac92886e7";

/// Popular Cetus Pool Object IDs
pub mod pools {
    /// MEME_COIN/SUI Pool
    pub const MEME_SUI: &str = "0x9501ab9cc94da40151c28defbda9c12a4b244fe774d5c97700a86c6a2265546f";
    /// USDC/ETH Pool
    pub const USDC_ETH: &str = "0x86df52cc5640362bfcec7804986ebf9bf7611b3ed56a1970abb5d3999837c0d8";
    /// USDC/BTC Pool
    pub const USDC_BTC: &str = "0x75842cfd5b1beee14dc2c035efdc9d52aefcf80091340863e1a9de92d8ec33a6";
    /// CUCA/SUI Pool
    pub const CUCA_SUI: &str = "0x054d3656bce5a7215fee7938dd9b9922678110cee9154142ef05da18a87e5863";
    /// USDT/USDC Pool (Stable)
    pub const USDT_USDC: &str =
        "0x2dc1713be847f95b72da730463b1cd6120de3ad05a1ce8248cc3becc790dc9ce";
    /// ETH/BTC Pool
    pub const ETH_BTC: &str = "0x00825f4d268e21f78516f9433d2bc3cfec27137a14e30592f6d129df11024dca";
}

/// Cetus pool data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CetusPool {
    pub object_id: String,
    pub coin_a: String,
    pub coin_b: String,
    pub coin_a_reserve: u64,
    pub coin_b_reserve: u64,
    pub liquidity: u128,
    pub current_sqrt_price: u128,
    pub fee_rate: u64,
    pub tick_spacing: u32,
    pub is_pause: bool,
    pub index: u64,
}

/// Cetus pool simple info (from factory)
#[derive(Debug, Clone, Deserialize)]
pub struct PoolSimpleInfo {
    pub pool_id: String,
    pub coin_type_a: String,
    pub coin_type_b: String,
    pub tick_spacing: u32,
}

/// Cetus protocol adapter
#[derive(Debug, Clone)]
pub struct CetusAdapter {
    client: SuiClient,
}

impl CetusAdapter {
    /// Create new Cetus adapter
    pub fn new(client: SuiClient) -> Self {
        Self { client }
    }

    /// Get specific pool data by object ID
    pub async fn get_pool(&self, pool_id: &str) -> Result<CetusPool, CetusError> {
        let object = self.client.get_object(pool_id).await?;

        let content = object.content.ok_or(CetusError::PoolNotFound)?;
        let fields = content.get("fields").ok_or(CetusError::InvalidPoolData)?;

        // Extract pool type to get coin types
        let pool_type = object.r#type.as_deref().unwrap_or("");
        let (coin_a, coin_b) = parse_pool_type(pool_type);

        Ok(CetusPool {
            object_id: pool_id.to_string(),
            coin_a,
            coin_b,
            coin_a_reserve: fields["coin_a"].as_u64().unwrap_or(0),
            coin_b_reserve: fields["coin_b"].as_u64().unwrap_or(0),
            liquidity: fields["liquidity"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            current_sqrt_price: fields["current_sqrt_price"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            fee_rate: fields["fee_rate"].as_u64().unwrap_or(0),
            tick_spacing: fields["tick_spacing"].as_u64().unwrap_or(0) as u32,
            is_pause: fields["is_pause"].as_bool().unwrap_or(true),
            index: fields["index"].as_u64().unwrap_or(0),
        })
    }

    /// Get pool by pair (e.g., "SUI", "USDC")
    /// Note: This fetches from factory and searches
    pub async fn find_pool_by_pair(
        &self,
        token_a: &str,
        token_b: &str,
    ) -> Result<Vec<PoolSimpleInfo>, CetusError> {
        // Fetch pool list from factory
        let pools = self.fetch_pool_list(50).await?;

        // Filter by pair
        let matches: Vec<PoolSimpleInfo> = pools
            .into_iter()
            .filter(|p| {
                (p.coin_type_a.contains(token_a) && p.coin_type_b.contains(token_b))
                    || (p.coin_type_a.contains(token_b) && p.coin_type_b.contains(token_a))
            })
            .collect();

        Ok(matches)
    }

    /// Fetch pool list from factory
    pub async fn fetch_pool_list(&self, limit: u64) -> Result<Vec<PoolSimpleInfo>, CetusError> {
        // Query factory dynamic fields
        let response: serde_json::Value = self
            .client
            .rpc_call(
                "suix_getDynamicFields",
                serde_json::json!([CETUS_FACTORY_TABLE, null, limit]),
            )
            .await?;

        let data = response
            .get("data")
            .and_then(|d| d.as_array())
            .ok_or(CetusError::InvalidResponse)?;

        let mut pools = Vec::new();

        for item in data {
            if let Some(obj_id) = item.get("objectId").and_then(|v| v.as_str()) {
                // Fetch pool info from node
                if let Ok(pool_info) = self.fetch_pool_node_info(obj_id).await {
                    pools.push(pool_info);
                }
            }
        }

        Ok(pools)
    }

    /// Fetch individual pool node info
    async fn fetch_pool_node_info(&self, node_id: &str) -> Result<PoolSimpleInfo, CetusError> {
        let object = self.client.get_object(node_id).await?;

        let content = object.content.ok_or(CetusError::InvalidPoolData)?;
        let fields = content.get("fields").ok_or(CetusError::InvalidPoolData)?;

        // Navigate nested structure
        let value = fields
            .get("value")
            .and_then(|v| v.get("fields"))
            .and_then(|v| v.get("value"))
            .and_then(|v| v.get("fields"))
            .ok_or(CetusError::InvalidPoolData)?;

        let pool_id = value
            .get("pool_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let coin_a = value
            .get("coin_type_a")
            .and_then(|v| v.get("fields"))
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let coin_b = value
            .get("coin_type_b")
            .and_then(|v| v.get("fields"))
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let tick_spacing = value
            .get("tick_spacing")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        Ok(PoolSimpleInfo {
            pool_id,
            coin_type_a: coin_a,
            coin_type_b: coin_b,
            tick_spacing,
        })
    }

    /// Calculate price from sqrt_price_x64
    pub fn calculate_price(&self, pool: &CetusPool) -> f64 {
        // sqrt_price is Q64.64 format
        // price = (sqrt_price / 2^64)^2
        let sqrt_price = pool.current_sqrt_price as f64 / (1u128 << 64) as f64;
        sqrt_price * sqrt_price
    }

    /// Calculate APR from fee rate
    pub fn get_fee_percent(&self, pool: &CetusPool) -> f64 {
        pool.fee_rate as f64 / 10000.0
    }
}

/// Parse pool type to extract coin types
fn parse_pool_type(pool_type: &str) -> (String, String) {
    // Format: {package}::pool::Pool<{coin_a}, {coin_b}>
    let Some(start) = pool_type.find('<') else {
        return ("Unknown".to_string(), "Unknown".to_string());
    };
    let Some(end) = pool_type.rfind('>') else {
        return ("Unknown".to_string(), "Unknown".to_string());
    };

    let inner = &pool_type[start + 1..end];
    let parts: Vec<&str> = inner.split(',').collect();

    if parts.len() == 2 {
        let coin_a = parts[0].trim().split("::").last().unwrap_or("Unknown");
        let coin_b = parts[1].trim().split("::").last().unwrap_or("Unknown");
        (coin_a.to_string(), coin_b.to_string())
    } else {
        ("Unknown".to_string(), "Unknown".to_string())
    }
}

/// Cetus errors
#[derive(Debug, thiserror::Error)]
pub enum CetusError {
    #[error("Sui client error: {0}")]
    ClientError(#[from] SuiClientError),

    #[error("Pool not found")]
    PoolNotFound,

    #[error("Invalid pool data")]
    InvalidPoolData,

    #[error("Invalid response from RPC")]
    InvalidResponse,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_pool_type() {
        let pool_type = "0x0c7ae833c220aa73a3643a0d508afa4ac5d50d97312ea4584e35f9eb21b9df12::pool::Pool<0xf156ab04f762382cc6c842f4c99597b6df07a313309664f05f2141383aa9fa81::meme_coin::MEME_COIN, 0x2::sui::SUI>";
        let (coin_a, coin_b) = parse_pool_type(pool_type);
        assert_eq!(coin_a, "MEME_COIN");
        assert_eq!(coin_b, "SUI");
    }

    #[tokio::test]
    async fn test_get_pool() {
        // Note: This requires network access
        let config = crate::config::SuiConfig::testnet();
        let client = SuiClient::new(config);
        let adapter = CetusAdapter::new(client);

        let pool = adapter.get_pool(pools::MEME_SUI).await;
        assert!(pool.is_ok());

        let pool = pool.unwrap();
        assert_eq!(pool.object_id, pools::MEME_SUI);
        assert!(!pool.is_pause);
    }
}

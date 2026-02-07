/// Naisu Cetus Adapter
///
/// Integration with Cetus CLMM for swaps and liquidity provision.
/// This module provides helper functions and constants for Cetus integration.
///
/// ## Architecture
/// Since Cetus contracts are already deployed on-chain and we cannot import
/// their types directly, we use two approaches:
///
/// 1. **This module**: Provides helper functions and constants
/// 2. **PTB Composition**: Actual contract calls happen via Programmable
///    Transaction Blocks (see naisu_cetus_bridge.move)
///
/// ## For Direct Calls (Advanced)
/// If you want to call Cetus functions directly from Move, you would need:
/// ```
/// use cetus_integrate::router;  // Requires Cetus as dependency
/// ```
/// However, since Cetus packages are deployed, the recommended approach is
/// PTB composition for maximum flexibility.
///
module naisu::cetus_adapter {
    use sui::coin::{Self, Coin};
    use sui::clock::Clock;
    use std::string::String;

    // ============ Cetus Contract Addresses ============

    /// Cetus Integrate Contract - Wrapper with convenience functions
    /// Address defined in Move.toml [addresses] section
    const CETUS_INTEGRATE: address = @cetus_integrate;

    /// Cetus CLMM Core Contract - Underlying protocol
    /// Address defined in Move.toml [addresses] section
    const CETUS_CLMM: address = @cetus_clmm;

    // ============ Constants ============

    /// Default slippage tolerance (1% = 100 basis points)
    const DEFAULT_SLIPPAGE_BPS: u64 = 100;

    /// Maximum slippage (10%)
    const MAX_SLIPPAGE_BPS: u64 = 1000;

    // ============ Errors ============

    const EInvalidSlippage: u64 = 0;
    const EInsufficientOutput: u64 = 1;
    const EInvalidPool: u64 = 2;

    // ============ External Function Interfaces ============

    /// Call Cetus Integrate Router - Swap A to B
    ///
    /// # Arguments
    /// * `pool` - Cetus Pool object (shared object from Cetus)
    /// * `coin_a` - Input coin
    /// * `amount_in` - Amount to swap
    /// * `amount_out_min` - Minimum output (slippage protection)
    /// * `sqrt_price_limit` - Price limit (use 0 for no limit)
    /// * `clock` - Clock object
    ///
    /// # Returns
    /// * Output coin of type B
    ///
    /// # Note
    /// This is a PLACEHOLDER - you need to call the actual Cetus router
    /// You'll need to import Cetus types or use dynamic calls
    /*
    public fun swap_a_to_b<CoinA, CoinB>(
        pool: &mut Pool<CoinA, CoinB>,
        coin_a: Coin<CoinA>,
        amount_in: u64,
        amount_out_min: u64,
        sqrt_price_limit: u128,
        clock: &Clock,
        ctx: &mut TxContext
    ): Coin<CoinB> {
        // Call: 0xab2d58dd...::router::swap_a2b<CoinA, CoinB>(...)
        // This would use the Cetus integrate contract
        abort 999 // Placeholder - implement with actual Cetus call
    }
    */

    // ============ Helper Functions ============

    /// Calculate minimum output amount with slippage
    ///
    /// # Arguments
    /// * `expected_amount` - Expected output amount
    /// * `slippage_bps` - Slippage in basis points (100 = 1%)
    public fun calculate_min_output(
        expected_amount: u64,
        slippage_bps: u64
    ): u64 {
        assert!(slippage_bps <= MAX_SLIPPAGE_BPS, EInvalidSlippage);

        // min_output = expected * (10000 - slippage) / 10000
        let multiplier = 10000 - slippage_bps;
        (expected_amount * multiplier) / 10000
    }

    /// Get protocol info for Cetus
    public fun cetus_info(): (String, String) {
        (
            std::string::utf8(b"Cetus"),
            std::string::utf8(b"CLMM AMM")
        )
    }

    /// Get Cetus contract addresses
    public fun get_contract_addresses(): (address, address) {
        (CETUS_INTEGRATE, CETUS_CLMM)
    }

    // ============ View Functions ============

    /// Check if slippage is valid
    public fun is_valid_slippage(slippage_bps: u64): bool {
        slippage_bps <= MAX_SLIPPAGE_BPS
    }

    /// Get default slippage
    public fun default_slippage(): u64 {
        DEFAULT_SLIPPAGE_BPS
    }
}

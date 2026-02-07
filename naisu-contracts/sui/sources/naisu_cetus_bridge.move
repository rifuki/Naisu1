/// Naisu Cetus Bridge
///
/// Bridge contract yang manage interaction antara Naisu dan Cetus
/// Handles fee collection + Cetus execution in atomic transactions
module naisu::naisu_cetus_bridge {
    use sui::coin::{Self, Coin};
    use sui::balance::Balance;
    use sui::tx_context::TxContext;

    // Import from cetus_executor for fee management
    use naisu::cetus_executor::{Self, Treasury};

    // ============ Errors ============

    const EInvalidAmount: u64 = 0;

    // ============ Structs ============

    /// Swap receipt yang return dari swap operation
    /// User akan receive ini sebagai proof of swap
    public struct SwapReceipt<phantom CoinIn, phantom CoinOut> {
        /// Amount yang di-swap (before fee)
        amount_in: u64,
        /// Fee yang diambil Naisu
        naisu_fee: u64,
        /// Amount yang di-swap di Cetus (after fee)
        cetus_amount_in: u64,
        /// Expected minimum output
        min_amount_out: u64,
    }

    // ============ Public Functions for PTB Composition ============

    /// Step 1: Take fee dari input coin
    ///
    /// Returns: (coin_after_fee, fee_amount)
    /// User akan chain ini dengan Cetus call di PTB
    public fun take_protocol_fee<T>(
        treasury: &mut Treasury,
        mut coin_in: Coin<T>,
        ctx: &mut TxContext
    ): (Coin<T>, u64) {
        let amount_in = coin::value(&coin_in);
        assert!(amount_in > 0, EInvalidAmount);

        // Calculate and take fee
        let fee_bps = cetus_executor::get_protocol_fee_bps();
        let fee_amount = cetus_executor::calculate_fee(amount_in, fee_bps);

        // Split fee
        let fee_coin = coin::split(&mut coin_in, fee_amount, ctx);

        // Deposit fee to treasury using cetus_executor function
        let fee_balance = coin::into_balance(fee_coin);
        cetus_executor::deposit_fee<T>(treasury, fee_balance);

        // Return coin after fee and fee amount
        (coin_in, fee_amount)
    }

    /// Calculate amounts for swap with fee
    public fun calculate_swap_amounts(
        amount_in: u64,
        slippage_bps: u64
    ): (u64, u64, u64) {
        let fee_bps = cetus_executor::get_protocol_fee_bps();
        let fee_amount = cetus_executor::calculate_fee(amount_in, fee_bps);
        let amount_after_fee = amount_in - fee_amount;
        let min_out = cetus_executor::calculate_min_output(
            amount_in,
            fee_bps,
            slippage_bps
        );

        (amount_after_fee, fee_amount, min_out)
    }

    // ============ View Functions ============

    /// Get swap receipt info
    public fun get_receipt_info<CoinIn, CoinOut>(
        receipt: &SwapReceipt<CoinIn, CoinOut>
    ): (u64, u64, u64, u64) {
        (
            receipt.amount_in,
            receipt.naisu_fee,
            receipt.cetus_amount_in,
            receipt.min_amount_out
        )
    }

    /// Destroy swap receipt (after verification)
    public fun destroy_receipt<CoinIn, CoinOut>(
        receipt: SwapReceipt<CoinIn, CoinOut>
    ) {
        let SwapReceipt {
            amount_in: _,
            naisu_fee: _,
            cetus_amount_in: _,
            min_amount_out: _
        } = receipt;
    }
}

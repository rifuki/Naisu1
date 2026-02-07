/// Naisu Cetus Executor
///
/// Module untuk execute Cetus operations (swap, liquidity) dengan fee mechanism
/// Flow: User -> Naisu (fee) -> Cetus (execution) -> User (result)
module naisu::cetus_executor {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::clock::Clock;
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::object::{Self, UID};
    use std::string::{Self, String};
    use std::type_name;
    use std::ascii;

    // ============ Errors ============

    const EInvalidFee: u64 = 0;
    const EInsufficientOutput: u64 = 1;
    const EInvalidSlippage: u64 = 2;
    const EZeroAmount: u64 = 3;

    // ============ Constants ============

    /// Naisu protocol fee (in basis points, 30 = 0.3%)
    const PROTOCOL_FEE_BPS: u64 = 30;

    /// Maximum fee (10%)
    const MAX_FEE_BPS: u64 = 1000;

    // ============ Structs ============

    /// Naisu protocol treasury untuk collect fees
    public struct Treasury has key {
        id: UID,
        /// Fee balance per coin type stored as dynamic fields
        /// We'll use dynamic fields to support multiple coin types
    }

    /// Swap configuration
    public struct SwapConfig has copy, drop, store {
        /// Slippage tolerance in basis points
        slippage_bps: u64,
        /// Protocol fee in basis points
        protocol_fee_bps: u64,
    }

    // ============ Events ============

    public struct SwapExecuted has copy, drop {
        user: address,
        coin_in_type: String,
        coin_out_type: String,
        amount_in: u64,
        amount_out: u64,
        protocol_fee: u64,
        pool_address: address,
    }

    public struct LiquidityAdded has copy, drop {
        user: address,
        coin_a_type: String,
        coin_b_type: String,
        amount_a: u64,
        amount_b: u64,
        protocol_fee_a: u64,
        protocol_fee_b: u64,
        pool_address: address,
    }

    // ============ Init ============

    /// Initialize treasury (called once at deployment)
    fun init(ctx: &mut TxContext) {
        let treasury = Treasury {
            id: object::new(ctx),
        };
        transfer::share_object(treasury);
    }

    // ============ External Call Wrappers ============

    /// External module call untuk Cetus swap
    ///
    /// Karena kita tidak bisa import Cetus types, kita define interface
    /// dan call via fully qualified path
    ///
    /// Format: package_address::module::function
    /// Cetus: 0xab2d58dd28ff0dc19b18ab2c634397b785a38c342a8f5065ade5f53f9dbffa1c::router::swap_a2b
    ///
    /// CRITICAL: Ini adalah DECLARATION saja, actual call terjadi di entry function
    /// menggunakan native Move external call syntax

    // ============ Public Entry Functions ============

    /// Swap via Cetus dengan Naisu fee
    ///
    /// Flow:
    /// 1. User provides coin_in
    /// 2. Naisu takes protocol fee
    /// 3. Call Cetus swap dengan remaining amount
    /// 4. Return coin_out to user
    /// 5. Fee masuk ke treasury
    ///
    /// NOTE: Karena limitation Move, kita tidak bisa directly call external contract
    /// dengan dynamic dispatch. Solusi:
    /// - Gunakan PTB untuk chain calls
    /// - Atau buat wrapper yang accept Cetus return types
    public entry fun swap_with_fee<CoinIn, CoinOut>(
        treasury: &mut Treasury,
        mut coin_in: Coin<CoinIn>,
        min_amount_out: u64,
        slippage_bps: u64,
        recipient: address,
        ctx: &mut TxContext
    ) {
        // Validate inputs
        let amount_in = coin::value(&coin_in);
        assert!(amount_in > 0, EZeroAmount);
        assert!(slippage_bps <= 1000, EInvalidSlippage);

        // Calculate protocol fee
        let fee_amount = calculate_fee(amount_in, PROTOCOL_FEE_BPS);
        let amount_after_fee = amount_in - fee_amount;

        // Take protocol fee
        let fee_coin = coin::split(&mut coin_in, fee_amount, ctx);

        // Store fee in treasury (convert to balance)
        let fee_balance = coin::into_balance(fee_coin);
        deposit_fee<CoinIn>(treasury, fee_balance);

        // At this point, coin_in has (amount_in - fee)
        // We need to call Cetus swap here

        // PROBLEM: We cannot directly call Cetus contract because:
        // 1. Cannot import Cetus types (Pool, GlobalConfig, etc)
        // 2. Move doesn't support dynamic external calls

        // SOLUTION: This function should be called via PTB that also calls Cetus
        // Transfer coin_in to recipient (they will call Cetus via PTB)
        transfer::public_transfer(coin_in, recipient);

        // Emit event
        event::emit(SwapExecuted {
            user: tx_context::sender(ctx),
            coin_in_type: string::from_ascii(type_name::into_string(type_name::get_with_original_ids<CoinIn>())),
            coin_out_type: string::from_ascii(type_name::into_string(type_name::get_with_original_ids<CoinOut>())),
            amount_in,
            amount_out: 0, // We don't know yet, will be in PTB
            protocol_fee: fee_amount,
            pool_address: @0x0, // Will be provided by PTB
        });
    }

    /// Add liquidity via Cetus dengan Naisu fee
    public entry fun add_liquidity_with_fee<CoinA, CoinB>(
        treasury: &mut Treasury,
        mut coin_a: Coin<CoinA>,
        mut coin_b: Coin<CoinB>,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let amount_a = coin::value(&coin_a);
        let amount_b = coin::value(&coin_b);

        assert!(amount_a > 0 && amount_b > 0, EZeroAmount);

        // Take protocol fees
        let fee_a = calculate_fee(amount_a, PROTOCOL_FEE_BPS);
        let fee_b = calculate_fee(amount_b, PROTOCOL_FEE_BPS);

        let fee_coin_a = coin::split(&mut coin_a, fee_a, ctx);
        let fee_coin_b = coin::split(&mut coin_b, fee_b, ctx);

        // Store fees
        deposit_fee<CoinA>(treasury, coin::into_balance(fee_coin_a));
        deposit_fee<CoinB>(treasury, coin::into_balance(fee_coin_b));

        // Transfer remaining coins to recipient for Cetus call
        transfer::public_transfer(coin_a, recipient);
        transfer::public_transfer(coin_b, recipient);

        event::emit(LiquidityAdded {
            user: tx_context::sender(ctx),
            coin_a_type: string::from_ascii(type_name::into_string(type_name::get_with_original_ids<CoinA>())),
            coin_b_type: string::from_ascii(type_name::into_string(type_name::get_with_original_ids<CoinB>())),
            amount_a,
            amount_b,
            protocol_fee_a: fee_a,
            protocol_fee_b: fee_b,
            pool_address: @0x0,
        });
    }

    // ============ Helper Functions ============

    /// Calculate fee amount
    public fun calculate_fee(amount: u64, fee_bps: u64): u64 {
        assert!(fee_bps <= MAX_FEE_BPS, EInvalidFee);
        (amount * fee_bps) / 10000
    }

    /// Deposit fee ke treasury (public untuk bridge module)
    public fun deposit_fee<T>(treasury: &mut Treasury, fee: Balance<T>) {
        use sui::dynamic_field;

        let coin_type = type_name::get_with_original_ids<T>();

        // Check if balance already exists for this coin type
        if (dynamic_field::exists_(&treasury.id, coin_type)) {
            // Add to existing balance
            let existing = dynamic_field::borrow_mut<
                type_name::TypeName,
                Balance<T>
            >(&mut treasury.id, coin_type);
            balance::join(existing, fee);
        } else {
            // Create new balance entry
            dynamic_field::add(&mut treasury.id, coin_type, fee);
        }
    }

    /// Withdraw fees (admin only - implement access control)
    public entry fun withdraw_fees<T>(
        treasury: &mut Treasury,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext
    ) {
        use sui::dynamic_field;
        use std::type_name;

        // TODO: Add admin access control check here

        let coin_type = type_name::get_with_original_ids<T>();

        assert!(
            dynamic_field::exists_(&treasury.id, coin_type),
            0 // No fees to withdraw
        );

        let balance_ref = dynamic_field::borrow_mut<
            type_name::TypeName,
            Balance<T>
        >(&mut treasury.id, coin_type);

        let withdrawn = balance::split(balance_ref, amount);
        let coin = coin::from_balance(withdrawn, ctx);

        transfer::public_transfer(coin, recipient);
    }

    /// Get fee balance for a coin type
    public fun get_fee_balance<T>(treasury: &Treasury): u64 {
        use sui::dynamic_field;
        use std::type_name;

        let coin_type = type_name::get_with_original_ids<T>();

        if (dynamic_field::exists_(&treasury.id, coin_type)) {
            let balance_ref = dynamic_field::borrow<
                type_name::TypeName,
                Balance<T>
            >(&treasury.id, coin_type);
            balance::value(balance_ref)
        } else {
            0
        }
    }

    /// Get protocol fee in basis points
    public fun get_protocol_fee_bps(): u64 {
        PROTOCOL_FEE_BPS
    }

    /// Get swap config
    public fun get_swap_config(slippage_bps: u64): SwapConfig {
        SwapConfig {
            slippage_bps,
            protocol_fee_bps: PROTOCOL_FEE_BPS,
        }
    }

    // ============ View Functions ============

    /// Calculate output after fee and slippage
    public fun calculate_min_output(
        amount_in: u64,
        fee_bps: u64,
        slippage_bps: u64
    ): u64 {
        let after_fee = amount_in - calculate_fee(amount_in, fee_bps);
        let min_out = (after_fee * (10000 - slippage_bps)) / 10000;
        min_out
    }
}

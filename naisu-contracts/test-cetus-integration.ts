/**
 * Test Cetus Integration
 *
 * Script untuk test call Cetus contract dari Naisu
 */

import { Transaction } from "@mysten/sui/transactions";
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

// === Config ===
const TESTNET_RPC = "https://fullnode.testnet.sui.io";
const CETUS_INTEGRATE = "0xab2d58dd28ff0dc19b18ab2c634397b785a38c342a8f5065ade5f53f9dbffa1c";
const CETUS_CLMM = "0x5372d555ac734e272659136c2a0cd3227f9b92de67c80dc11250307268af2db8";

// === Types ===
interface SwapParams {
  poolAddress: string;
  coinTypeA: string;
  coinTypeB: string;
  inputCoinId: string;
  amountIn: string;
  minAmountOut: string;
  recipientAddress: string;
}

interface PositionParams {
  poolAddress: string;
  coinTypeA: string;
  coinTypeB: string;
  coinAId: string;
  coinBId: string;
  tickLower: number;
  tickUpper: number;
  amountADesired: string;
  amountBDesired: string;
  userAddress: string;
}

// === Main Functions ===

/**
 * Build transaction untuk swap A to B
 */
export function buildSwapTransaction(params: SwapParams): Transaction {
  const tx = new Transaction();

  console.log("🔄 Building swap transaction...");
  console.log(`   Pool: ${params.poolAddress}`);
  console.log(`   Input: ${params.amountIn} of ${params.coinTypeA}`);
  console.log(`   Min Output: ${params.minAmountOut} of ${params.coinTypeB}`);

  // Call Cetus router swap_a2b
  const [coinOut] = tx.moveCall({
    target: `${CETUS_INTEGRATE}::router::swap_a2b`,
    typeArguments: [params.coinTypeA, params.coinTypeB],
    arguments: [
      tx.object(CETUS_CLMM), // GlobalConfig
      tx.object(params.poolAddress), // Pool
      tx.object(params.inputCoinId), // Input coin
      tx.pure.u64(params.amountIn), // Amount in
      tx.pure.u64(params.minAmountOut), // Min amount out
      tx.pure.u128("0"), // sqrt_price_limit (0 = no limit)
      tx.pure.bool(true), // by_amount_in
      tx.object("0x6"), // Clock
    ],
  });

  // Transfer output to recipient
  tx.transferObjects([coinOut], tx.pure.address(params.recipientAddress));

  console.log("✅ Swap transaction built");
  return tx;
}

/**
 * Build transaction untuk open position (add liquidity)
 */
export function buildOpenPositionTransaction(
  params: PositionParams
): Transaction {
  const tx = new Transaction();

  console.log("🏊 Building open position transaction...");
  console.log(`   Pool: ${params.poolAddress}`);
  console.log(`   Tick Range: ${params.tickLower} to ${params.tickUpper}`);
  console.log(`   Amount A: ${params.amountADesired}`);
  console.log(`   Amount B: ${params.amountBDesired}`);

  // Call Cetus pool_script open_position_with_liquidity
  const [position, coinAReturn, coinBReturn] = tx.moveCall({
    target: `${CETUS_INTEGRATE}::pool_script::open_position_with_liquidity`,
    typeArguments: [params.coinTypeA, params.coinTypeB],
    arguments: [
      tx.object(CETUS_CLMM), // GlobalConfig
      tx.object(params.poolAddress), // Pool
      tx.pure.u32(params.tickLower), // Tick lower
      tx.pure.u32(params.tickUpper), // Tick upper
      tx.makeMoveVec({ objects: [tx.object(params.coinAId)] }), // Coins A
      tx.makeMoveVec({ objects: [tx.object(params.coinBId)] }), // Coins B
      tx.pure.u64(params.amountADesired), // Amount A desired
      tx.pure.u64(params.amountBDesired), // Amount B desired
      tx.pure.bool(false), // Fix amount A
      tx.object("0x6"), // Clock
    ],
  });

  // Transfer position NFT to user
  tx.transferObjects([position], tx.pure.address(params.userAddress));

  // Return leftover coins
  tx.transferObjects(
    [coinAReturn, coinBReturn],
    tx.pure.address(params.userAddress)
  );

  console.log("✅ Open position transaction built");
  return tx;
}

/**
 * Calculate minimum output with slippage
 */
export function calculateMinOutput(
  expectedAmount: string,
  slippageBps: number
): string {
  const amount = BigInt(expectedAmount);
  const multiplier = BigInt(10000 - slippageBps);
  const minAmount = (amount * multiplier) / BigInt(10000);
  return minAmount.toString();
}

/**
 * Query Cetus pools
 */
export async function queryCetusPools(client: SuiClient): Promise<void> {
  console.log("🔍 Querying Cetus pools...");

  try {
    // Query pools dari Cetus
    // Note: Ini memerlukan knowledge tentang pool registry object
    // Untuk production, gunakan Cetus SDK
    console.log("   Use Cetus SDK to query pools: @cetusprotocol/cetus-sui-clmm-sdk");
    console.log("   Or check Cetus Alpha UI: https://alpha.cetus.zone");
  } catch (error) {
    console.error("❌ Error querying pools:", error);
  }
}

/**
 * Example usage - Swap USDC to SUI
 */
async function exampleSwap() {
  console.log("\n=== Example: Swap USDC to SUI ===\n");

  const client = new SuiClient({ url: TESTNET_RPC });

  // Setup (you need to fill in actual values)
  const params: SwapParams = {
    poolAddress: "0x...", // Get from Cetus
    coinTypeA: "0x...::usdc::USDC", // USDC type
    coinTypeB: "0x2::sui::SUI", // SUI type
    inputCoinId: "0x...", // Your USDC coin object ID
    amountIn: "1000000", // 1 USDC (6 decimals)
    minAmountOut: calculateMinOutput("100000000", 100), // ~0.1 SUI with 1% slippage
    recipientAddress: "0x...", // Your address
  };

  const tx = buildSwapTransaction(params);

  console.log("\n📝 Transaction built. To execute:");
  console.log("   1. Get your keypair");
  console.log("   2. Sign and execute the transaction");
  console.log("   3. Check transaction result\n");

  // To execute (uncomment when ready):
  // const keypair = Ed25519Keypair.deriveKeypair(process.env.MNEMONIC!);
  // const result = await client.signAndExecuteTransaction({
  //   transaction: tx,
  //   signer: keypair,
  // });
  // console.log("Transaction:", result.digest);
}

/**
 * Example usage - Open Position
 */
async function exampleOpenPosition() {
  console.log("\n=== Example: Open Position (Add Liquidity) ===\n");

  const client = new SuiClient({ url: TESTNET_RPC });

  const params: PositionParams = {
    poolAddress: "0x...", // Pool address
    coinTypeA: "0x...::usdc::USDC",
    coinTypeB: "0x2::sui::SUI",
    coinAId: "0x...", // USDC coin object
    coinBId: "0x...", // SUI coin object
    tickLower: -443636, // Example tick
    tickUpper: 443636, // Example tick
    amountADesired: "1000000", // 1 USDC
    amountBDesired: "100000000", // 0.1 SUI
    userAddress: "0x...",
  };

  const tx = buildOpenPositionTransaction(params);

  console.log("\n📝 Transaction built. Ready to execute.\n");
}

// === Helper: Get Cetus Contract Info ===
export function getCetusContractInfo() {
  return {
    integrate: CETUS_INTEGRATE,
    clmm: CETUS_CLMM,
    network: "testnet",
    rpc: TESTNET_RPC,
    functions: {
      swap: `${CETUS_INTEGRATE}::router::swap_a2b`,
      swapReverse: `${CETUS_INTEGRATE}::router::swap_b2a`,
      openPosition: `${CETUS_INTEGRATE}::pool_script::open_position_with_liquidity`,
      closePosition: `${CETUS_INTEGRATE}::pool_script::close_position_with_return`,
      collectFee: `${CETUS_INTEGRATE}::pool_script::collect_fee`,
    },
  };
}

// === Run Examples ===
if (require.main === module) {
  console.log("🐋 Cetus Integration Test\n");
  console.log("Contract Info:", getCetusContractInfo());

  exampleSwap().catch(console.error);
  exampleOpenPosition().catch(console.error);
}

// === Exports ===
export {
  buildSwapTransaction,
  buildOpenPositionTransaction,
  calculateMinOutput,
  queryCetusPools,
  getCetusContractInfo,
};

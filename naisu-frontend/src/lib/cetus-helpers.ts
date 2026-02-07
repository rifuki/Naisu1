/**
 * Cetus Helper Functions
 *
 * Utilities for working with Cetus CLMM pools
 */

import { SuiClient } from '@mysten/sui/client';

/**
 * Validate that a pool exists and is accessible
 */
export async function validatePool(
  client: SuiClient,
  poolId: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const poolObj = await client.getObject({
      id: poolId,
      options: { showType: true, showContent: true },
    });

    if (!poolObj.data) {
      return { valid: false, error: 'Pool not found' };
    }

    const content = poolObj.data.content as any;
    if (content?.dataType !== 'moveObject') {
      return { valid: false, error: 'Invalid pool object' };
    }

    // Check if pool is paused
    if (content.fields?.is_pause === true) {
      return { valid: false, error: 'Pool is paused' };
    }

    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: error.message };
  }
}

/**
 * Calculate sqrt price limits for Cetus swaps
 */
export const CETUS_PRICE_LIMITS = {
  MAX_SQRT_PRICE: '79226673515401279992447579055', // ~2^96 - 1
  MIN_SQRT_PRICE: '4295048016', // ~2^32
};

/**
 * Get sqrt price limit based on swap direction
 * @param a2b - true if swapping A->B, false if B->A
 */
export function getSqrtPriceLimit(a2b: boolean): string {
  return a2b ? CETUS_PRICE_LIMITS.MIN_SQRT_PRICE : CETUS_PRICE_LIMITS.MAX_SQRT_PRICE;
}

/**
 * Calculate amount with slippage
 * @param amount - Original amount
 * @param slippageBps - Slippage in basis points (e.g., 100 = 1%)
 * @param isMinimum - true for minimum output, false for maximum input
 */
export function calculateSlippage(
  amount: bigint,
  slippageBps: number,
  isMinimum: boolean
): bigint {
  const slippageFactor = BigInt(10000 - (isMinimum ? slippageBps : -slippageBps));
  return (amount * slippageFactor) / BigInt(10000);
}

/**
 * Common Cetus contract addresses
 */
export const CETUS_ADDRESSES = {
  testnet: {
    GLOBAL_CONFIG: '0xc6273f844b4bc258952c4e477697aa12c918c8e08106fac6b934811298c9820a',
    INTEGRATE: '0xab2d58dd28ff0dc19b18ab2c634397b785a38c342a8f5065ade5f53f9dbffa1c',
    POOL_REGISTRY: '0xd28736923703342b4752f5ed8c2f2a5c0cb2336c30e1fed42b387234ce8408ec',
  },
  mainnet: {
    GLOBAL_CONFIG: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',
    INTEGRATE: '0x996c4d9480708fb8b92aa7acf819fb0497b5ec8e65ba06601cae2fb6db3312c3',
    POOL_REGISTRY: '0xc3ad1d87f61c0a2ca89a4d85c2cf75506cf83ea296e102a8c241228f8fe9d8ae',
  },
};

/**
 * Get Cetus addresses for network
 */
export function getCetusAddresses(network: 'mainnet' | 'testnet') {
  return CETUS_ADDRESSES[network];
}

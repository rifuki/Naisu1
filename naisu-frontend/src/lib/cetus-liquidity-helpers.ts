/**
 * Cetus Liquidity Helpers
 *
 * Helper functions for adding liquidity to Cetus pools
 */

import { SuiClient } from '@mysten/sui/client';

/**
 * Get pool's current tick index
 */
export async function getPoolCurrentTick(
  client: SuiClient,
  poolId: string
): Promise<number> {
  const pool = await client.getObject({
    id: poolId,
    options: { showContent: true },
  });

  const content = pool.data?.content as any;
  if (!content?.fields?.current_tick_index) {
    throw new Error('Could not fetch pool current tick');
  }

  return content.fields.current_tick_index.fields?.bits || 0;
}

/**
 * Calculate safe tick range around current tick
 * @param currentTick - Pool's current tick index
 * @param tickSpacing - Pool's tick spacing
 * @param rangeMultiplier - How many tick spaces to go in each direction (default: 50)
 */
export function calculateTickRange(
  currentTick: number,
  tickSpacing: number,
  rangeMultiplier: number = 50
): { lowerTick: number; upperTick: number } {
  // Round current tick to nearest valid tick
  const roundedTick = Math.round(currentTick / tickSpacing) * tickSpacing;

  // Calculate range
  const tickRange = tickSpacing * rangeMultiplier;
  const lowerTick = roundedTick - tickRange;
  const upperTick = roundedTick + tickRange;

  return { lowerTick, upperTick };
}

/**
 * Get recommended tick range for a pool
 */
export async function getRecommendedTickRange(
  client: SuiClient,
  poolId: string
): Promise<{ lowerTick: number; upperTick: number }> {
  const pool = await client.getObject({
    id: poolId,
    options: { showContent: true },
  });

  const content = pool.data?.content as any;
  if (!content?.fields) {
    throw new Error('Invalid pool object');
  }

  const currentTick = content.fields.current_tick_index?.fields?.bits || 0;
  const tickSpacing = content.fields.tick_spacing || 60;

  return calculateTickRange(currentTick, tickSpacing);
}

/**
 * Common tick ranges for different pool types
 */
export const COMMON_TICK_RANGES = {
  // Tight range (for stable pairs like USDC/USDT)
  tight: {
    lower: -1000,
    upper: 1000,
  },
  // Medium range (for major pairs like SUI/USDC)
  medium: {
    lower: -5000,
    upper: 5000,
  },
  // Wide range (for volatile pairs)
  wide: {
    lower: -20000,
    upper: 20000,
  },
  // Full range (maximum liquidity)
  full: {
    lower: -443636,
    upper: 443636,
  },
};

/**
 * Calculate reasonable slippage limits
 * @param amount - The fixed amount
 * @param slippagePercent - Slippage percentage (e.g., 1 for 1%)
 */
export function calculateSlippageLimits(
  amount: bigint,
  slippagePercent: number = 5
): bigint {
  const slippageBps = BigInt(Math.floor(slippagePercent * 100));
  const maxSlippage = (amount * (BigInt(10000) + slippageBps)) / BigInt(10000);
  return maxSlippage;
}

/**
 * Validate tick range
 */
export function validateTickRange(
  lowerTick: number,
  upperTick: number,
  tickSpacing: number
): { valid: boolean; error?: string } {
  // Check lower < upper
  if (lowerTick >= upperTick) {
    return { valid: false, error: 'Lower tick must be less than upper tick' };
  }

  // Check alignment with tick spacing
  if (lowerTick % tickSpacing !== 0 || upperTick % tickSpacing !== 0) {
    return {
      valid: false,
      error: `Ticks must be aligned with tick spacing (${tickSpacing})`,
    };
  }

  // Check within bounds
  const MAX_TICK = 443636;
  const MIN_TICK = -443636;

  if (lowerTick < MIN_TICK || upperTick > MAX_TICK) {
    return { valid: false, error: 'Ticks out of bounds' };
  }

  return { valid: true };
}

/**
 * useQueryCetusPositions Hook
 * 
 * Fetches Cetus Position NFTs (LP tokens) owned by the current user.
 * Verified Struct Type: 0x5372d555ac734e272659136c2a0cd3227f9b92de67c80dc11250307268af2db8::position::Position
 */

import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { useNetworkConfig } from '@/hooks/useNetworkConfig';

// Original Package ID for Type Definition (found via Suiscan)
const CSTUS_POSITION_TYPE = "0x5372d555ac734e272659136c2a0cd3227f9b92de67c80dc11250307268af2db8::position::Position";

export const queryKeyCetusPositions = (address?: string | null, network?: string) =>
    ['cetus-positions', address, network];

export interface UseQueryCetusPositionsProps {
    accountAddress?: string; // Optional, defaults to current account
}

export function useQueryCetusPositions({ accountAddress }: UseQueryCetusPositionsProps = {}) {
    const currentAccount = useCurrentAccount();
    const suiClient = useSuiClient();
    const { config } = useNetworkConfig();

    const owner = accountAddress || currentAccount?.address;

    // Ensure config is marked as used for network-specific query caching
    void config.network;

    return useQuery({
        queryKey: queryKeyCetusPositions(owner, config.network),
        queryFn: async () => {
            if (!owner) return null;

            const res = await suiClient.getOwnedObjects({
                owner,
                filter: { StructType: CSTUS_POSITION_TYPE },
                options: { showType: true, showContent: true }
            });

            return res?.data || [];
        },
        enabled: !!owner,
        staleTime: 10 * 1000,
        refetchOnMount: true,
    });
}

import { useState, useCallback, useEffect } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useSuiClient } from "@mysten/dapp-kit";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "react-hot-toast";
import {
    CETUS_INTEGRATE_PACKAGE,
    CETUS_GLOBAL_CONFIG,
    SUI_CLOCK,
    fetchPoolInfo,
} from "../lib/cetus/cetusService";

export const Route = createFileRoute("/smart-swap")({
    component: SmartSwap,
});

// Price limits for swap direction
const MAX_SQRT_PRICE = "79226673515401279992447579055";
const MIN_SQRT_PRICE = "4295048016";

interface WalletToken {
    coinType: string;
    symbol: string;
    balance: string;
    decimals: number;
    objectIds: string[];
}

interface PoolInfo {
    id: string;
    name: string;
    coinA: string;
    coinB: string;
    coinASymbol: string;
    coinBSymbol: string;
    coinADecimals: number;
    coinBDecimals: number;
}

// LinkedTable that contains the actual pool entries from Cetus factory
const CETUS_POOLS_LIST = "0x51f8de2366af49a51ee81184eb28ca24739d3d48c8158d063dab6700c0b65413";


function SmartSwap() {
    const suiClient = useSuiClient();
    const account = useCurrentAccount();
    const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();

    const [walletTokens, setWalletTokens] = useState<WalletToken[]>([]);
    const [allPools, setAllPools] = useState<PoolInfo[]>([]);
    const [availablePools, setAvailablePools] = useState<PoolInfo[]>([]);
    const [selectedPool, setSelectedPool] = useState<PoolInfo | null>(null);
    const [swapDirection, setSwapDirection] = useState<"AtoB" | "BtoA">("AtoB");
    const [amount, setAmount] = useState("");
    const [estimatedOutput, setEstimatedOutput] = useState("");
    const [poolPrice, setPoolPrice] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isFetchingPools, setIsFetchingPools] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [txResult, setTxResult] = useState<string | null>(null);

    const addLog = useCallback((msg: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs((prev) => [...prev, `[${timestamp}] ${msg}`]);
    }, []);

    // Helper delay function to avoid rate limiting
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Fetch all pools from Cetus factory LinkedTable
    const fetchAllPools = useCallback(async () => {
        setIsFetchingPools(true);
        addLog("🏊 Fetching pools from Cetus factory...");

        try {
            // Get dynamic fields from the LinkedTable (which contains the pool entries)
            const dynamicFields = await suiClient.getDynamicFields({
                parentId: CETUS_POOLS_LIST,
                limit: 50,
            });

            addLog(`📦 Found ${dynamicFields.data.length} pool entries`);

            const pools: PoolInfo[] = [];

            // Fetch each pool's details
            for (const field of dynamicFields.data) {
                // Add a small delay to avoid hitting rate limits (429)
                await delay(200);

                try {
                    // Get the pool object ID from dynamic field
                    const fieldObj = await suiClient.getDynamicFieldObject({
                        parentId: CETUS_POOLS_LIST,
                        name: field.name,
                    });

                    const content = fieldObj.data?.content as any;
                    const fields = content?.fields;


                    // Debug: log the structure
                    if (pools.length === 0) {
                        console.log("🔍 First pool entry structure:", JSON.stringify(fields, null, 2));
                    }

                    // Extract pool_id from PoolSimpleInfo inside a LinkedTable Node
                    // Path: Field -> value (Node) -> fields -> value (PoolSimpleInfo) -> fields -> pool_id
                    let poolId = fields?.value?.fields?.value?.fields?.pool_id;

                    // Validate poolId is a string
                    if (!poolId || typeof poolId !== 'string') {
                        console.warn("Invalid pool ID (not a string):", poolId, "from fields:", fields);
                        continue;
                    }

                    // console.log(`📍 Processing pool: ${poolId}`);

                    // Fetch pool info
                    const poolInfo = await fetchPoolInfo(suiClient as any, poolId);
                    if (!poolInfo) {
                        console.warn(`Failed to fetch info for pool ${poolId}`);
                        continue;
                    }

                    // Get decimals for both coins
                    let coinADecimals = 9, coinBDecimals = 9;
                    try {
                        const metaA = await suiClient.getCoinMetadata({ coinType: poolInfo.coinA });
                        if (metaA?.decimals) coinADecimals = metaA.decimals;
                    } catch { }
                    try {
                        const metaB = await suiClient.getCoinMetadata({ coinType: poolInfo.coinB });
                        if (metaB?.decimals) coinBDecimals = metaB.decimals;
                    } catch { }

                    const symbolA = poolInfo.coinA.split("::").pop() || "???";
                    const symbolB = poolInfo.coinB.split("::").pop() || "???";

                    pools.push({
                        id: poolId,
                        name: `${symbolA}/${symbolB}`,
                        coinA: poolInfo.coinA,
                        coinB: poolInfo.coinB,
                        coinASymbol: symbolA,
                        coinBSymbol: symbolB,
                        coinADecimals,
                        coinBDecimals,
                    });
                } catch (e) {
                    console.error("Error fetching pool:", e);
                }
            }

            setAllPools(pools);
            addLog(`✅ Loaded ${pools.length} pools from factory`);
        } catch (err) {
            console.error(err);
            addLog("❌ Error fetching pools from factory");
        } finally {
            setIsFetchingPools(false);
        }
    }, [suiClient, addLog]);

    // Fetch wallet tokens
    const fetchWalletTokens = useCallback(async () => {
        if (!account?.address) return;

        addLog("🔍 Fetching wallet tokens...");
        try {
            const allBalances = await suiClient.getAllBalances({ owner: account.address });
            const tokens: WalletToken[] = [];

            for (const bal of allBalances) {
                if (BigInt(bal.totalBalance) > 0n) {
                    const coins = await suiClient.getCoins({ owner: account.address, coinType: bal.coinType });
                    const symbol = bal.coinType.split("::").pop() || "???";

                    // Try to get decimals from metadata
                    let decimals = 9; // default
                    try {
                        const metadata = await suiClient.getCoinMetadata({ coinType: bal.coinType });
                        if (metadata?.decimals) decimals = metadata.decimals;
                    } catch { }

                    tokens.push({
                        coinType: bal.coinType,
                        symbol,
                        balance: bal.totalBalance,
                        decimals,
                        objectIds: coins.data.map(c => c.coinObjectId),
                    });
                }
            }

            setWalletTokens(tokens);
            addLog(`✅ Found ${tokens.length} tokens in wallet`);

            // Find available pools based on wallet tokens
            const userCoinTypes = tokens.map(t => t.coinType);
            const matchingPools = allPools.filter(pool =>
                userCoinTypes.includes(pool.coinA) || userCoinTypes.includes(pool.coinB)
            );
            setAvailablePools(matchingPools);
            addLog(`🏊 Found ${matchingPools.length} available pools for your tokens`);

            if (matchingPools.length > 0 && !selectedPool) {
                setSelectedPool(matchingPools[0]);
            }
        } catch (err) {
            console.error(err);
            addLog("❌ Error fetching tokens");
        }
    }, [account, suiClient, addLog, selectedPool, allPools]);

    // Fetch pool price when pool changes
    const fetchPoolPrice = useCallback(async () => {
        if (!selectedPool) return;

        try {
            addLog(`📊 Fetching price for ${selectedPool.name}...`);
            const poolInfo = await fetchPoolInfo(suiClient as any, selectedPool.id);

            if (poolInfo && poolInfo.currentSqrtPrice) {
                // Calculate price from sqrt_price
                const sqrtPrice = BigInt(poolInfo.currentSqrtPrice);
                const priceX64 = (sqrtPrice * sqrtPrice) / (1n << 64n);

                // Adjust for decimals
                const decimalDiff = selectedPool.coinADecimals - selectedPool.coinBDecimals;
                const adjustedPrice = Number(priceX64) / Math.pow(10, decimalDiff);

                setPoolPrice(adjustedPrice);
                addLog(`📈 Pool price: 1 ${selectedPool.coinASymbol} = ${adjustedPrice.toFixed(6)} ${selectedPool.coinBSymbol}`);
            }
        } catch (err) {
            console.error(err);
            addLog("❌ Error fetching pool price");
        }
    }, [selectedPool, suiClient, addLog]);

    // Update estimate when amount or direction changes
    useEffect(() => {
        if (!amount || !poolPrice) {
            setEstimatedOutput("");
            return;
        }
        const amtNum = parseFloat(amount);
        if (isNaN(amtNum)) return;

        if (swapDirection === "AtoB") {
            // A -> B: multiply by price
            setEstimatedOutput((amtNum * poolPrice).toFixed(6));
        } else {
            // B -> A: divide by price
            setEstimatedOutput((amtNum / poolPrice).toFixed(6));
        }
    }, [amount, poolPrice, swapDirection]);

    // Fetch pools on mount
    useEffect(() => {
        fetchAllPools();
    }, []);

    // Re-fetch wallet tokens when pools are done loading
    useEffect(() => {
        // Only fetch wallet tokens after pools have finished loading (not during)
        if (!isFetchingPools && account?.address) {
            fetchWalletTokens();
        }
    }, [isFetchingPools, account?.address]);

    useEffect(() => {
        if (selectedPool) {
            fetchPoolPrice();
        }
    }, [selectedPool, fetchPoolPrice]);

    // Execute swap
    const executeSwap = async () => {
        if (!account?.address || !selectedPool || !amount) {
            toast.error("Missing required fields");
            return;
        }

        setIsLoading(true);
        setLogs([]);
        setTxResult(null);

        try {
            addLog(`🔄 Starting swap on ${selectedPool.name}...`);

            const tx = new Transaction();
            const amtNum = parseFloat(amount);

            // Determine input/output tokens
            const isAtoB = swapDirection === "AtoB";
            const inputToken = isAtoB ? selectedPool.coinA : selectedPool.coinB;
            const inputDecimals = isAtoB ? selectedPool.coinADecimals : selectedPool.coinBDecimals;
            const inputSymbol = isAtoB ? selectedPool.coinASymbol : selectedPool.coinBSymbol;
            const outputSymbol = isAtoB ? selectedPool.coinBSymbol : selectedPool.coinASymbol;

            const amountIn = BigInt(Math.floor(amtNum * Math.pow(10, inputDecimals)));
            addLog(`💰 Swapping ${amtNum} ${inputSymbol} → ${outputSymbol}`);

            // Get coins
            const coins = await suiClient.getCoins({ owner: account.address, coinType: inputToken });

            if (coins.data.length === 0) {
                throw new Error(`No ${inputSymbol} coins found in wallet`);
            }


            // Prepare coin input
            let coinInput;
            if (inputToken === "0x2::sui::SUI") {
                [coinInput] = tx.splitCoins(tx.gas, [tx.pure.u64(amountIn)]);
            } else {
                if (coins.data.length === 1) {
                    const [split] = tx.splitCoins(tx.object(coins.data[0].coinObjectId), [tx.pure.u64(amountIn)]);
                    coinInput = split;
                } else {
                    const [primary, ...others] = coins.data;
                    const primaryRef = tx.object(primary.coinObjectId);
                    if (others.length > 0) {
                        tx.mergeCoins(primaryRef, others.map(c => tx.object(c.coinObjectId)));
                    }
                    const [split] = tx.splitCoins(primaryRef, [tx.pure.u64(amountIn)]);
                    coinInput = split;
                }
            }

            // Create zero coin for the OTHER token (placeholder)
            // If swapping A->B, we need a zero B coin as placeholder
            // If swapping B->A, we need a zero A coin as placeholder
            const zeroCoinType = isAtoB ? selectedPool.coinB : selectedPool.coinA;
            const [zeroCoin] = tx.moveCall({
                target: "0x2::coin::zero",
                typeArguments: [zeroCoinType],
            });

            // Arguments for router::swap must match pool<A,B> generic types
            const coinA = isAtoB ? coinInput : zeroCoin;
            const coinB = isAtoB ? zeroCoin : coinInput;


            // Call router::swap function
            // Signature: swap<A, B>(config, pool, coin_a, coin_b, a2b, by_amount_in, amount, sqrt_price_limit, is_exact_in, clock)
            addLog("🔧 Building swap transaction (router::swap)...");
            const sqrtPriceLimit = isAtoB ? MIN_SQRT_PRICE : MAX_SQRT_PRICE;

            const [resultA, resultB] = tx.moveCall({
                target: `${CETUS_INTEGRATE_PACKAGE}::router::swap`,
                arguments: [
                    tx.object(CETUS_GLOBAL_CONFIG),
                    tx.object(selectedPool.id),
                    coinA,
                    coinB,
                    tx.pure.bool(isAtoB),
                    tx.pure.bool(true), // by_amount_in

                    tx.pure.u64(amountIn),
                    tx.pure.u128(BigInt(sqrtPriceLimit)),
                    tx.pure.bool(false), // is_exact_in (or print_errors?) - standard router swap usually takes this
                    tx.object(SUI_CLOCK),
                ],
                typeArguments: [selectedPool.coinA, selectedPool.coinB],
            });

            // Transfer outputs to user
            tx.transferObjects([resultA, resultB], account.address);

            addLog("📝 Signing transaction...");

            signAndExecuteTransaction(
                { transaction: tx as any },
                {
                    onSuccess: (result) => {
                        addLog(`✅ Swap successful! Digest: ${result.digest}`);
                        setTxResult(result.digest);
                        toast.success("Swap completed!");
                        setIsLoading(false);
                        fetchWalletTokens(); // Refresh balances
                    },
                    onError: (error) => {
                        addLog(`❌ Error: ${error.message}`);
                        toast.error("Swap failed");
                        setIsLoading(false);
                    },
                }
            );
        } catch (err: any) {
            addLog(`❌ Error: ${err.message}`);
            toast.error(err.message);
            setIsLoading(false);
        }
    };

    const inputToken = selectedPool ? (swapDirection === "AtoB" ? selectedPool.coinASymbol : selectedPool.coinBSymbol) : "";
    const outputToken = selectedPool ? (swapDirection === "AtoB" ? selectedPool.coinBSymbol : selectedPool.coinASymbol) : "";
    const inputBalance = walletTokens.find(t =>
        t.coinType === (swapDirection === "AtoB" ? selectedPool?.coinA : selectedPool?.coinB)
    );

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
            <div className="max-w-lg mx-auto">
                <h1 className="text-3xl font-bold text-white mb-2 text-center">🔄 Smart Swap</h1>
                <p className="text-gray-400 text-center mb-6">Auto-detect pools for your tokens</p>

                {!account?.address ? (
                    <div className="bg-yellow-500/20 border border-yellow-500 rounded-xl p-4 text-yellow-200 text-center">
                        ⚠️ Please connect your wallet
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Wallet Tokens Summary */}
                        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-white font-semibold">Your Tokens</h3>
                                <button
                                    onClick={fetchWalletTokens}
                                    className="text-sm text-cyan-400 hover:text-cyan-300"
                                >
                                    🔄 Refresh
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {walletTokens.map((token) => (
                                    <span key={token.coinType} className="bg-cyan-500/20 text-cyan-300 px-3 py-1 rounded-full text-sm">
                                        {token.symbol}: {(Number(token.balance) / Math.pow(10, token.decimals)).toFixed(4)}
                                    </span>
                                ))}
                                {walletTokens.length === 0 && (
                                    <span className="text-gray-500">Loading tokens...</span>
                                )}
                            </div>
                        </div>

                        {/* Pool Selection */}
                        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-cyan-400 text-sm font-medium">Select Pool</label>
                                <span className="text-gray-500 text-xs">
                                    {isFetchingPools ? "Loading..." : `${allPools.length} pools loaded`}
                                </span>
                            </div>
                            <select
                                value={selectedPool?.id || ""}
                                onChange={(e) => {
                                    const pool = availablePools.find(p => p.id === e.target.value);
                                    setSelectedPool(pool || null);
                                }}
                                className="w-full bg-slate-800 text-white rounded-lg px-4 py-3 border border-white/10 focus:border-cyan-500 focus:outline-none"
                                disabled={isFetchingPools}
                            >
                                {isFetchingPools && (
                                    <option value="">Loading pools...</option>
                                )}
                                {!isFetchingPools && availablePools.length === 0 && (
                                    <option value="">No pools available for your tokens</option>
                                )}
                                {availablePools.map((pool) => (
                                    <option key={pool.id} value={pool.id}>
                                        {pool.name} ({pool.coinA.slice(0, 8)}...)
                                    </option>
                                ))}
                            </select>
                            {poolPrice && (
                                <p className="text-gray-400 text-sm mt-2">
                                    Price: 1 {selectedPool?.coinASymbol} = {poolPrice.toFixed(6)} {selectedPool?.coinBSymbol}
                                </p>
                            )}
                        </div>

                        {/* Swap Direction */}
                        {selectedPool && (
                            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                                <div className="flex items-center justify-between">
                                    <span className="text-white font-medium">{inputToken}</span>
                                    <button
                                        onClick={() => setSwapDirection(d => d === "AtoB" ? "BtoA" : "AtoB")}
                                        className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-full p-2 transition-colors"
                                    >
                                        ⇄
                                    </button>
                                    <span className="text-white font-medium">{outputToken}</span>
                                </div>
                            </div>
                        )}

                        {/* Amount Input */}
                        {selectedPool && (
                            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                                <div className="flex justify-between mb-2">
                                    <label className="text-cyan-400 text-sm font-medium">Amount {inputToken}</label>
                                    {inputBalance && (
                                        <button
                                            onClick={() => setAmount((Number(inputBalance.balance) / Math.pow(10, inputBalance.decimals)).toString())}
                                            className="text-sm text-cyan-400 hover:text-cyan-300"
                                        >
                                            MAX: {(Number(inputBalance.balance) / Math.pow(10, inputBalance.decimals)).toFixed(4)}
                                        </button>
                                    )}
                                </div>
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="0.0"
                                    className="w-full bg-slate-800 text-white text-xl rounded-lg px-4 py-3 border border-white/10 focus:border-cyan-500 focus:outline-none"
                                />
                                {estimatedOutput && (
                                    <p className="text-gray-400 text-sm mt-2">
                                        ≈ {estimatedOutput} {outputToken}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Swap Button */}
                        <button
                            onClick={executeSwap}
                            disabled={isLoading || !selectedPool || !amount}
                            className="w-full bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-xl transition-all"
                        >
                            {isLoading ? "⏳ Swapping..." : "🔄 Swap"}
                        </button>

                        {/* Transaction Result */}
                        {txResult && (
                            <div className="bg-green-500/20 border border-green-500 rounded-xl p-4">
                                <p className="text-green-400 font-semibold mb-2">✅ Swap Successful!</p>
                                <a
                                    href={`https://suiscan.xyz/testnet/tx/${txResult}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-cyan-400 hover:underline text-sm break-all"
                                >
                                    View on Suiscan →
                                </a>
                            </div>
                        )}

                        {/* Logs */}
                        <div className="bg-black/40 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                            <h3 className="text-white font-semibold mb-2">📋 Logs</h3>
                            <div className="space-y-1 max-h-40 overflow-y-auto text-sm font-mono">
                                {logs.length === 0 ? (
                                    <p className="text-gray-500">Ready to swap...</p>
                                ) : (
                                    logs.map((log, i) => (
                                        <p key={i} className="text-gray-300">{log}</p>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

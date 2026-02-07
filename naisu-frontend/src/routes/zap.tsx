
import { useState, useCallback, useEffect } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useSuiClient } from "@mysten/dapp-kit";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "react-hot-toast";
import {
    fetchPoolInfo,
    buildZapTx,
    getFullRangeTicks,
    calculateTickRange
} from "../lib/cetus/cetusService";

export const Route = createFileRoute("/zap")({
    component: ZapPage,
});

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
    tickSpacing?: number;
    currentTick?: number;
}

// LinkedTable that contains the actual pool entries from Cetus factory
const CETUS_POOLS_LIST = "0x51f8de2366af49a51ee81184eb28ca24739d3d48c8158d063dab6700c0b65413";

function ZapPage() {
    const suiClient = useSuiClient();
    const account = useCurrentAccount();
    const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();

    const [walletTokens, setWalletTokens] = useState<WalletToken[]>([]);
    const [allPools, setAllPools] = useState<PoolInfo[]>([]);
    const [availablePools, setAvailablePools] = useState<PoolInfo[]>([]);
    const [selectedPool, setSelectedPool] = useState<PoolInfo | null>(null);
    const [selectedToken, setSelectedToken] = useState<WalletToken | null>(null);
    const [amount, setAmount] = useState("");
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
            const dynamicFields = await suiClient.getDynamicFields({
                parentId: CETUS_POOLS_LIST,
                limit: 50,
            });

            addLog(`📦 Found ${dynamicFields.data.length} pool entries`);

            const pools: PoolInfo[] = [];

            for (const field of dynamicFields.data) {
                await delay(200); // Rate limit

                try {
                    const fieldObj = await suiClient.getDynamicFieldObject({
                        parentId: CETUS_POOLS_LIST,
                        name: field.name,
                    });

                    const content = fieldObj.data?.content as any;
                    const fields = content?.fields;

                    // Deep extract pool_id
                    let poolId = fields?.value?.fields?.value?.fields?.pool_id;

                    if (!poolId || typeof poolId !== 'string') {
                        continue;
                    }

                    const poolInfo = await fetchPoolInfo(suiClient as any, poolId);
                    if (!poolInfo) continue;

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

                    // Handle signed 32-bit integer for tick
                    // Move u32 representation of negative numbers needs to be converted
                    let currentTick = undefined;
                    if (poolInfo.currentTick) {
                        let val = Number(poolInfo.currentTick);
                        if (val > 2147483647) {
                            val = val - 4294967296;
                        }
                        currentTick = val;
                    }

                    pools.push({
                        id: poolId,
                        name: `${symbolA}/${symbolB}`,
                        coinA: poolInfo.coinA,
                        coinB: poolInfo.coinB,
                        coinASymbol: symbolA,
                        coinBSymbol: symbolB,
                        coinADecimals,
                        coinBDecimals,
                        tickSpacing: Number(poolInfo.tickSpacing) || 60, // Default to 60 if missing
                        currentTick,
                    });
                } catch (e) {
                    console.error("Error fetching pool:", e);
                }
            }

            setAllPools(pools);
            addLog(`✅ Loaded ${pools.length} pools`);
        } catch (err) {
            console.error(err);
            addLog("❌ Error fetching pools");
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

                    let decimals = 9;
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

            // Default select SUI usually
            if (!selectedToken) {
                const sui = tokens.find(t => t.symbol === "SUI");
                if (sui) setSelectedToken(sui);
            }

        } catch (err) {
            console.error(err);
            addLog("❌ Error fetching tokens");
        }
    }, [account, suiClient, addLog, selectedToken]);

    // Update available pools based on selected token
    useEffect(() => {
        if (!selectedToken || allPools.length === 0) {
            setAvailablePools([]);
            return;
        }

        const matching = allPools.filter(p =>
            p.coinA === selectedToken.coinType || p.coinB === selectedToken.coinType
        );
        setAvailablePools(matching);

        if (matching.length > 0 && !selectedPool) {
            setSelectedPool(matching[0]);
        }
    }, [selectedToken, allPools, selectedPool]);

    // Fetch pools on mount
    useEffect(() => {
        fetchAllPools();
    }, []);

    // Re-fetch wallet tokens when pools are done loading
    useEffect(() => {
        if (!isFetchingPools && account?.address) {
            fetchWalletTokens();
        }
    }, [isFetchingPools, account?.address]);

    const executeZap = async () => {
        if (!account?.address || !selectedPool || !selectedToken || !amount) {
            toast.error("Missing required fields");
            return;
        }

        setIsLoading(true);
        setLogs([]);
        setTxResult(null);

        try {
            addLog(`⚡ Starting Zap: ${amount} ${selectedToken.symbol} → ${selectedPool.name}...`);
            addLog(`ℹ️ Strategy: Swap ~50% -> Open Position (Full Range)`);

            const tx = new Transaction();
            const amtNum = parseFloat(amount);
            const amountIn = BigInt(Math.floor(amtNum * Math.pow(10, selectedToken.decimals)));

            // Basic checks for SUI
            // Note: `buildZapTx` in cetusService currently only supports SUI properly due to gas splitting logic
            // We should warn user if they try non-SUI
            if (selectedToken.symbol !== "SUI") {
                toast("Currently Zap is optimized for SUI. Other tokens might fail if coin management logic isn't perfect.", { icon: "⚠️" });
            }

            // Calculate safe tick range
            let tickLower, tickUpper;

            if (selectedPool.currentTick !== undefined && selectedPool.tickSpacing) {
                const range = calculateTickRange(selectedPool.currentTick, selectedPool.tickSpacing);
                tickLower = range.tickLower;
                tickUpper = range.tickUpper;
            } else {
                // Fallback if currentTick is missing (shouldn't happen for active pools)
                const range = getFullRangeTicks(selectedPool.tickSpacing || 60);
                tickLower = range.tickLower;
                tickUpper = range.tickUpper;
            }

            addLog("🔧 Building Zap transaction...");

            buildZapTx(tx, {
                poolId: selectedPool.id,
                coinA: selectedPool.coinA,
                coinB: selectedPool.coinB,
                tickLower,
                tickUpper,
                inputToken: selectedToken.coinType,
                amountIn,
                slippage: 0.05 // 5% slippage default
            }, account.address);

            addLog("📝 Signing transaction...");

            signAndExecuteTransaction(
                { transaction: tx as any },
                {
                    onSuccess: (result) => {
                        addLog(`✅ Zap successful! Digest: ${result.digest}`);
                        setTxResult(result.digest);
                        toast.success("Zap completed!");
                        setIsLoading(false);
                        fetchWalletTokens();
                    },
                    onError: (error) => {
                        addLog(`❌ Error: ${error.message}`);
                        toast.error(`Zap failed: ${error.message}`);
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

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-indigo-900 p-8">
            <div className="max-w-lg mx-auto">
                <h1 className="text-4xl font-bold text-white mb-2 text-center">⚡ Zap</h1>
                <p className="text-gray-400 text-center mb-6">One-click Swap & Liquidity Provision</p>

                {!account?.address ? (
                    <div className="bg-yellow-500/20 border border-yellow-500 rounded-xl p-4 text-yellow-200 text-center">
                        ⚠️ Please connect your wallet
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Token Selection */}
                        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/10 shadow-xl">
                            <label className="text-purple-300 text-sm font-medium mb-2 block">I have</label>

                            <div className="flex gap-4 mb-4">
                                <select
                                    className="flex-1 bg-slate-800 text-white rounded-xl px-4 py-3 border border-white/10 focus:border-purple-500 focus:outline-none"
                                    value={selectedToken?.coinType || ""}
                                    onChange={(e) => {
                                        const token = walletTokens.find(t => t.coinType === e.target.value);
                                        setSelectedToken(token || null);
                                    }}
                                >
                                    <option value="">Select Token</option>
                                    {walletTokens.map(t => (
                                        <option key={t.coinType} value={t.coinType}>
                                            {t.symbol} (Bal: {(Number(t.balance) / Math.pow(10, t.decimals)).toFixed(2)})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="relative">
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="0.0"
                                    className="w-full bg-slate-800 text-white text-3xl font-bold rounded-xl px-4 py-4 border border-white/10 focus:border-purple-500 focus:outline-none"
                                />
                                {selectedToken && (
                                    <button
                                        onClick={() => setAmount((Number(selectedToken.balance) / Math.pow(10, selectedToken.decimals)).toString())}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-xs bg-purple-500/20 text-purple-300 px-2 py-1 rounded hover:bg-purple-500/30"
                                    >
                                        MAX
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Arrow */}
                        <div className="flex justify-center -my-3 relative z-10">
                            <div className="bg-slate-900 border border-white/10 rounded-full p-2 text-purple-400">
                                ↓
                            </div>
                        </div>

                        {/* Pool Selection */}
                        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/10 shadow-xl">
                            <label className="text-purple-300 text-sm font-medium mb-2 block">Zap into Pool</label>
                            <select
                                value={selectedPool?.id || ""}
                                onChange={(e) => {
                                    const pool = availablePools.find(p => p.id === e.target.value);
                                    setSelectedPool(pool || null);
                                }}
                                className="w-full bg-slate-800 text-white rounded-xl px-4 py-3 border border-white/10 focus:border-purple-500 focus:outline-none"
                                disabled={isFetchingPools}
                            >
                                {isFetchingPools ? (
                                    <option>Loading pools...</option>
                                ) : availablePools.length === 0 ? (
                                    <option>No pools for this token</option>
                                ) : (
                                    availablePools.map(pool => (
                                        <option key={pool.id} value={pool.id}>
                                            {pool.name} ({pool.tickSpacing})
                                        </option>
                                    ))
                                )}
                            </select>

                            {/* Pool Details Debug Info */}
                            {selectedPool && (
                                <div className="mt-2 p-2 bg-black/20 rounded text-xs break-all text-gray-400 font-mono">
                                    <p>Pool ID: {selectedPool.id}</p>
                                    <p>Coin A: {selectedPool.coinA}</p>
                                    <p>Coin B: {selectedPool.coinB}</p>
                                    <p>Current Tick: {selectedPool.currentTick}</p>
                                    <p>Tick Spacing: {selectedPool.tickSpacing}</p>
                                </div>
                            )}
                        </div>

                        {/* Zap Button */}
                        <button
                            onClick={executeZap}
                            disabled={isLoading || !selectedPool || !amount}
                            className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xl font-bold py-5 px-6 rounded-2xl transition-all shadow-lg hover:shadow-purple-500/25"
                        >
                            {isLoading ? "⚡ Zapping..." : "⚡ Zap Liquidity"}
                        </button>

                        {/* Transaction Result */}
                        {txResult && (
                            <div className="bg-green-500/20 border border-green-500 rounded-xl p-4 animate-fade-in">
                                <p className="text-green-400 font-semibold mb-2">✅ Zap Successful!</p>
                                <a
                                    href={`https://suiscan.xyz/testnet/tx/${txResult}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-purple-400 hover:underline text-sm break-all"
                                >
                                    View on Suiscan →
                                </a>
                            </div>
                        )}

                        {/* Logs */}
                        <div className="bg-black/40 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                            <h3 className="text-white font-semibold mb-2 text-xs uppercase tracking-wider">Transaction Logs</h3>
                            <div className="space-y-1 max-h-40 overflow-y-auto text-xs font-mono">
                                {logs.length === 0 ? (
                                    <p className="text-gray-600 italic">Logs will appear here...</p>
                                ) : (
                                    logs.map((log, i) => (
                                        <p key={i} className="text-gray-400 border-l-2 border-purple-500/30 pl-2">{log}</p>
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

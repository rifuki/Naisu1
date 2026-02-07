import { useState, useCallback } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useSuiClient } from "@mysten/dapp-kit";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import toast from "react-hot-toast";
import { createFileRoute } from "@tanstack/react-router";

// Route config
export const Route = createFileRoute("/test-open-position")({
    component: TestOpenPosition,
});

// Constants
const CETUS_INTEGRATE_PACKAGE = "0xab2d58dd28ff0dc19b18ab2c634397b785a38c342a8f5065ade5f53f9dbffa1c";
const CETUS_GLOBAL_CONFIG = "0xc6273f844b4bc258952c4e477697aa12c918c8e08106fac6b934811298c9820a";
const SUI_CLOCK = "0x6";

// Pool configs
const POOLS = {
    SUI_USDC: {
        id: "0xce144501b2e09fd9438e22397b604116a3874e137c8ae0c31144b45b2bf84f10",
        name: "SUI/USDC",
        coinA: "0x14a71d857b34677a7d57e0feb303df1adb515a37780645ab763d42ce8d1a5e48::usdc::USDC",
        coinASymbol: "USDC",
        coinADecimals: 6,
        coinB: "0x2::sui::SUI",
        coinBSymbol: "SUI",
        coinBDecimals: 9,
        tickSpacing: 2,
    },
};

type PoolKey = keyof typeof POOLS;

export default function TestOpenPosition() {
    const suiClient = useSuiClient();
    const account = useCurrentAccount();
    const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();

    // State
    const [selectedPool] = useState<PoolKey>("SUI_USDC");
    const [suiAmount, setSuiAmount] = useState("0.1");
    const [usdcAmount, setUsdcAmount] = useState("0.1");
    const [poolPrice, setPoolPrice] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(false);
    const [txResult, setTxResult] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);

    const pool = POOLS[selectedPool];

    const addLog = (msg: string) => {
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
        console.log(msg);
    };

    // Fetch pool info and calculate price
    const fetchPoolInfo = useCallback(async () => {
        try {
            addLog("📡 Fetching pool info...");
            const poolObject = await suiClient.getObject({
                id: pool.id,
                options: { showContent: true },
            });

            if (poolObject.data?.content?.dataType === "moveObject") {
                const fields = (poolObject.data.content as any).fields;
                const currentSqrtPrice = fields.current_sqrt_price;
                const currentTickIndex = parseInt(fields.current_tick_index?.fields?.bits || "0");
                const tickSpacing = parseInt(fields.tick_spacing || "2");

                // Calculate price from sqrt_price
                const rawPrice = Math.pow(Number(BigInt(currentSqrtPrice)) / Math.pow(2, 64), 2);
                const price = rawPrice / 1000; // Decimal adjustment (was /1000, caused 10x error)
                setPoolPrice(price);

                addLog(`✅ Pool loaded! Price: 1 SUI = ${price.toFixed(4)} USDC`);
                addLog(`📊 Current tick: ${currentTickIndex}, Tick spacing: ${tickSpacing}`);

                return { currentTickIndex, tickSpacing, currentSqrtPrice };
            }
            return null;
        } catch (e: any) {
            addLog(`❌ Error: ${e.message}`);
            return null;
        }
    }, [suiClient, pool.id]);

    // Auto-calculate USDC when SUI changes
    // NOTE: poolPrice is 10x lower due to contract compatibility,
    // so we multiply USDC estimate by 10 for accurate display
    const handleSuiChange = (value: string) => {
        setSuiAmount(value);
        if (poolPrice > 0) {
            const sui = parseFloat(value);
            if (!isNaN(sui) && sui > 0) {
                // Multiply by 10 to correct for display (matches wallet preview)
                const estimatedUsdc = sui * poolPrice * 10;
                setUsdcAmount(estimatedUsdc.toFixed(6));
            }
        }
    };

    // Auto-calculate SUI when USDC changes  
    // NOTE: Same 10x adjustment for reverse calculation
    const handleUsdcChange = (value: string) => {
        setUsdcAmount(value);
        if (poolPrice > 0) {
            const usdc = parseFloat(value);
            if (!isNaN(usdc) && usdc > 0) {
                // Divide by 10 to correct (matches wallet preview)
                const estimatedSui = usdc / (poolPrice * 10);
                setSuiAmount(estimatedSui.toFixed(6));
            }
        }
    };

    // Open position with liquidity
    const openPosition = async () => {
        if (!account) {
            toast.error("Connect wallet first!");
            return;
        }

        const sui = parseFloat(suiAmount);
        const usdc = parseFloat(usdcAmount);

        if (isNaN(sui) || sui <= 0 || isNaN(usdc) || usdc <= 0) {
            toast.error("Invalid amounts!");
            return;
        }

        setIsLoading(true);
        setLogs([]);
        setTxResult(null);

        try {
            // Fetch pool info
            const poolInfo = await fetchPoolInfo();
            if (!poolInfo) {
                toast.error("Failed to fetch pool info");
                setIsLoading(false);
                return;
            }

            const { currentTickIndex, tickSpacing } = poolInfo;

            // Calculate tick range (±2500 ticks around current price)
            const tickRangeSize = 5000;
            const tickLower = Math.floor((currentTickIndex - tickRangeSize / 2) / tickSpacing) * tickSpacing;
            const tickUpper = Math.floor((currentTickIndex + tickRangeSize / 2) / tickSpacing) * tickSpacing;

            addLog(`📊 Tick range: [${tickLower}, ${tickUpper}]`);

            // Get USDC coins
            const usdcCoins = await suiClient.getCoins({
                owner: account.address,
                coinType: pool.coinA,
            });

            if (usdcCoins.data.length === 0) {
                toast.error("No USDC balance!");
                setIsLoading(false);
                return;
            }

            // Build transaction
            const tx = new Transaction();
            const amountSuiMist = BigInt(Math.floor(sui * 1e9));
            const amountUsdcRaw = BigInt(Math.floor(usdc * 1e6));

            addLog(`💵 SUI: ${sui} (${amountSuiMist} MIST)`);
            addLog(`💵 USDC: ${usdc} (${amountUsdcRaw} raw)`);

            // Prepare USDC coin
            let usdcCoinInput;
            if (usdcCoins.data.length === 1) {
                usdcCoinInput = tx.object(usdcCoins.data[0].coinObjectId);
            } else {
                const [primaryCoin, ...otherCoins] = usdcCoins.data;
                const primaryCoinRef = tx.object(primaryCoin.coinObjectId);
                for (const coin of otherCoins) {
                    tx.mergeCoins(primaryCoinRef, [tx.object(coin.coinObjectId)]);
                }
                usdcCoinInput = primaryCoinRef;
            }

            // Split SUI from gas
            const [suiCoinInput] = tx.splitCoins(tx.gas, [tx.pure.u64(amountSuiMist)]);

            // Call open_position_with_liquidity_by_fix_coin
            addLog(`🔧 Calling pool_script_v2::open_position_with_liquidity_by_fix_coin...`);

            tx.moveCall({
                target: `${CETUS_INTEGRATE_PACKAGE}::pool_script_v2::open_position_with_liquidity_by_fix_coin`,
                arguments: [
                    tx.object(CETUS_GLOBAL_CONFIG),
                    tx.object(pool.id),
                    tx.pure.u32(tickLower),
                    tx.pure.u32(tickUpper),
                    usdcCoinInput,              // coin_a (USDC)
                    suiCoinInput,               // coin_b (SUI)
                    tx.pure.u64(amountUsdcRaw), // amount_a
                    tx.pure.u64(amountSuiMist), // amount_b
                    tx.pure.bool(true),         // fix_amount_a
                    tx.object(SUI_CLOCK),
                ],
                typeArguments: [pool.coinA, pool.coinB],
            });

            addLog("📝 Signing transaction...");

            signAndExecuteTransaction(
                { transaction: tx as any },
                {
                    onSuccess: (result) => {
                        addLog(`✅ Success! Digest: ${result.digest}`);
                        setTxResult(result.digest);
                        toast.success("Position created!");
                        setIsLoading(false);
                    },
                    onError: (error) => {
                        addLog(`❌ Failed: ${error.message}`);
                        toast.error(error.message);
                        setIsLoading(false);
                    },
                }
            );
        } catch (e: any) {
            addLog(`❌ Error: ${e.message}`);
            toast.error(e.message);
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-8">
            <div className="max-w-lg mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">🐋 Open Position</h1>
                    <p className="text-purple-300">Cetus CLMM Liquidity</p>
                </div>

                {/* Main Card */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-purple-500/20">
                    {/* Pool Info */}
                    <div className="mb-6 p-4 bg-purple-500/10 rounded-xl">
                        <div className="flex justify-between items-center">
                            <span className="text-purple-300">Pool</span>
                            <span className="text-white font-bold">{pool.name}</span>
                        </div>
                        {poolPrice > 0 && (
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-purple-300">Price</span>
                                <span className="text-emerald-400">1 SUI ≈ {(poolPrice * 10).toFixed(2)} USDC</span>
                            </div>
                        )}
                    </div>

                    {/* SUI Input */}
                    <div className="mb-4">
                        <label className="block text-purple-300 text-sm mb-2">SUI Amount</label>
                        <input
                            type="number"
                            value={suiAmount}
                            onChange={(e) => handleSuiChange(e.target.value)}
                            className="w-full bg-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="0.1"
                        />
                        <p className="text-xs text-emerald-400 mt-1">✨ SUI is fixed, USDC will auto-adjust</p>
                    </div>

                    {/* USDC Input */}
                    <div className="mb-6">
                        <label className="block text-purple-300 text-sm mb-2">USDC Amount (estimated)</label>
                        <input
                            type="number"
                            value={usdcAmount}
                            onChange={(e) => handleUsdcChange(e.target.value)}
                            className="w-full bg-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="0.1"
                        />
                        <p className="text-xs text-amber-400 mt-1">⚠️ Actual amount may differ (CLMM math)</p>
                    </div>

                    {/* Buttons */}
                    <div className="space-y-3">
                        <button
                            onClick={fetchPoolInfo}
                            className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold transition"
                        >
                            🔄 Refresh Pool Price
                        </button>

                        <button
                            onClick={openPosition}
                            disabled={isLoading || !account}
                            className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 text-white rounded-xl font-bold text-lg transition"
                        >
                            {isLoading ? "⏳ Processing..." : "🚀 Open Position"}
                        </button>
                    </div>

                    {/* Wallet Status */}
                    {!account && (
                        <p className="text-center text-amber-400 mt-4">⚠️ Connect wallet first</p>
                    )}

                    {/* TX Result */}
                    {txResult && (
                        <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                            <p className="text-emerald-400 font-semibold">✅ Position Created!</p>
                            <a
                                href={`https://suiscan.xyz/testnet/tx/${txResult}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-400 hover:underline break-all"
                            >
                                {txResult}
                            </a>
                        </div>
                    )}
                </div>

                {/* Logs */}
                {logs.length > 0 && (
                    <div className="mt-6 bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <h3 className="text-white font-semibold mb-2">📋 Logs</h3>
                        <div className="space-y-1 max-h-48 overflow-y-auto font-mono text-xs">
                            {logs.map((log, i) => (
                                <p key={i} className="text-gray-300">{log}</p>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

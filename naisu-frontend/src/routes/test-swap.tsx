import { useState, useCallback } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useSuiClient } from "@mysten/dapp-kit";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import toast from "react-hot-toast";
import { createFileRoute } from "@tanstack/react-router";

// Route config
export const Route = createFileRoute("/test-swap")({
    component: TestSwap,
});

// Constants
const CETUS_INTEGRATE_PACKAGE = "0xab2d58dd28ff0dc19b18ab2c634397b785a38c342a8f5065ade5f53f9dbffa1c";
const CETUS_GLOBAL_CONFIG = "0xc6273f844b4bc258952c4e477697aa12c918c8e08106fac6b934811298c9820a";
const SUI_CLOCK = "0x6";

// Pool config
const POOL = {
    id: "0xce144501b2e09fd9438e22397b604116a3874e137c8ae0c31144b45b2bf84f10",
    name: "SUI/USDC",
    coinA: "0x14a71d857b34677a7d57e0feb303df1adb515a37780645ab763d42ce8d1a5e48::usdc::USDC",
    coinASymbol: "USDC",
    coinADecimals: 6,
    coinB: "0x2::sui::SUI",
    coinBSymbol: "SUI",
    coinBDecimals: 9,
};

// Price limits for swap direction
const MAX_SQRT_PRICE = "79226673515401279992447579055";
const MIN_SQRT_PRICE = "4295048016";

export default function TestSwap() {
    const suiClient = useSuiClient();
    const account = useCurrentAccount();
    const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();

    // State
    const [swapDirection, setSwapDirection] = useState<"sui_to_usdc" | "usdc_to_sui">("sui_to_usdc");
    const [inputAmount, setInputAmount] = useState("0.1");
    const [estimatedOutput, setEstimatedOutput] = useState("~");
    const [poolPrice, setPoolPrice] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [txResult, setTxResult] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (msg: string) => {
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
        console.log(msg);
    };

    // Fetch pool price
    const fetchPoolPrice = useCallback(async () => {
        try {
            addLog("📡 Fetching pool price...");
            const poolObject = await suiClient.getObject({
                id: POOL.id,
                options: { showContent: true },
            });

            if (poolObject.data?.content?.dataType === "moveObject") {
                const fields = (poolObject.data.content as any).fields;
                const currentSqrtPrice = fields.current_sqrt_price;

                const rawPrice = Math.pow(Number(BigInt(currentSqrtPrice)) / Math.pow(2, 64), 2);
                const price = (rawPrice / 1000) * 10; // Adjusted for display
                setPoolPrice(price);

                const amt = parseFloat(inputAmount);
                if (!isNaN(amt) && amt > 0) {
                    if (swapDirection === "sui_to_usdc") {
                        setEstimatedOutput((amt * price * 0.997).toFixed(4)); // -0.3% fee
                    } else {
                        setEstimatedOutput((amt / price * 0.997).toFixed(6));
                    }
                }

                addLog(`✅ Pool price: 1 SUI ≈ ${price.toFixed(2)} USDC`);
            }
        } catch (e: any) {
            addLog(`❌ Error: ${e.message}`);
        }
    }, [suiClient, inputAmount, swapDirection]);

    // Update estimate when amount changes
    const handleAmountChange = (value: string) => {
        setInputAmount(value);
        if (poolPrice > 0) {
            const amt = parseFloat(value);
            if (!isNaN(amt) && amt > 0) {
                if (swapDirection === "sui_to_usdc") {
                    setEstimatedOutput((amt * poolPrice * 0.997).toFixed(4));
                } else {
                    setEstimatedOutput((amt / poolPrice * 0.997).toFixed(6));
                }
            }
        }
    };

    // Toggle swap direction
    const toggleDirection = () => {
        setSwapDirection((prev) => prev === "sui_to_usdc" ? "usdc_to_sui" : "sui_to_usdc");
        setInputAmount("0.1");
        setEstimatedOutput("~");
    };

    // Execute swap
    const executeSwap = async () => {
        if (!account) {
            toast.error("Connect wallet first!");
            return;
        }

        const amt = parseFloat(inputAmount);
        if (isNaN(amt) || amt <= 0) {
            toast.error("Invalid amount!");
            return;
        }

        setIsLoading(true);
        setLogs([]);
        setTxResult(null);

        try {
            const tx = new Transaction();

            if (swapDirection === "sui_to_usdc") {
                // SUI -> USDC (B -> A, aToB = false)
                const amountMist = BigInt(Math.floor(amt * 1e9));
                addLog(`🔄 Swapping ${amt} SUI → USDC`);

                // Split SUI from gas
                const [coinIn] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);

                // Create empty USDC coin
                const coinOut = tx.moveCall({
                    target: "0x2::coin::zero",
                    typeArguments: [POOL.coinA],
                });

                addLog("🔧 Calling router::swap (SUI → USDC)...");
                const [resultA, resultB] = tx.moveCall({
                    target: `${CETUS_INTEGRATE_PACKAGE}::router::swap`,
                    arguments: [
                        tx.object(CETUS_GLOBAL_CONFIG),
                        tx.object(POOL.id),
                        coinOut,              // coin_a (USDC - output)
                        coinIn,               // coin_b (SUI - input)
                        tx.pure.bool(false),  // a_to_b: false (B→A, SUI→USDC)
                        tx.pure.bool(true),   // by_amount_in
                        tx.pure.u64(amountMist),
                        tx.pure.u128(BigInt(MAX_SQRT_PRICE)), // sqrt_price_limit
                        tx.pure.bool(false),  // is_exact_in
                        tx.object(SUI_CLOCK),
                    ],
                    typeArguments: [POOL.coinA, POOL.coinB],
                });

                tx.transferObjects([resultA, resultB], tx.pure.address(account.address));

            } else {
                // USDC -> SUI (A -> B, aToB = true)
                const amountRaw = BigInt(Math.floor(amt * 1e6));
                addLog(`🔄 Swapping ${amt} USDC → SUI`);

                // Get USDC coins
                const usdcCoins = await suiClient.getCoins({
                    owner: account.address,
                    coinType: POOL.coinA,
                });

                if (usdcCoins.data.length === 0) {
                    toast.error("No USDC balance!");
                    setIsLoading(false);
                    return;
                }

                // Merge USDC coins if needed
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

                // Split exact amount
                const [coinIn] = tx.splitCoins(usdcCoinInput, [tx.pure.u64(amountRaw)]);

                // Create empty SUI coin
                const coinOut = tx.moveCall({
                    target: "0x2::coin::zero",
                    typeArguments: [POOL.coinB],
                });

                addLog("🔧 Calling router::swap (USDC → SUI)...");
                const [resultA, resultB] = tx.moveCall({
                    target: `${CETUS_INTEGRATE_PACKAGE}::router::swap`,
                    arguments: [
                        tx.object(CETUS_GLOBAL_CONFIG),
                        tx.object(POOL.id),
                        coinIn,               // coin_a (USDC - input)
                        coinOut,              // coin_b (SUI - output)
                        tx.pure.bool(true),   // a_to_b: true (A→B, USDC→SUI)
                        tx.pure.bool(true),   // by_amount_in
                        tx.pure.u64(amountRaw),
                        tx.pure.u128(BigInt(MIN_SQRT_PRICE)), // sqrt_price_limit
                        tx.pure.bool(false),  // is_exact_in
                        tx.object(SUI_CLOCK),
                    ],
                    typeArguments: [POOL.coinA, POOL.coinB],
                });

                tx.transferObjects([resultA, resultB], tx.pure.address(account.address));
            }

            addLog("📝 Signing transaction...");

            signAndExecuteTransaction(
                { transaction: tx as any },
                {
                    onSuccess: (result) => {
                        addLog(`✅ Swap successful! Digest: ${result.digest}`);
                        setTxResult(result.digest);
                        toast.success("Swap successful!");
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

    const inputToken = swapDirection === "sui_to_usdc" ? "SUI" : "USDC";
    const outputToken = swapDirection === "sui_to_usdc" ? "USDC" : "SUI";

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900/20 to-gray-900 p-8">
            <div className="max-w-lg mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">🔄 Swap</h1>
                    <p className="text-blue-300">Cetus DEX - Testnet</p>
                </div>

                {/* Main Card */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-blue-500/20">
                    {/* Pool Info */}
                    <div className="mb-6 p-4 bg-blue-500/10 rounded-xl">
                        <div className="flex justify-between items-center">
                            <span className="text-blue-300">Pool</span>
                            <span className="text-white font-bold">{POOL.name}</span>
                        </div>
                        {poolPrice > 0 && (
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-blue-300">Rate</span>
                                <span className="text-emerald-400">1 SUI ≈ {poolPrice.toFixed(2)} USDC</span>
                            </div>
                        )}
                    </div>

                    {/* Input Token */}
                    <div className="mb-2">
                        <label className="block text-gray-400 text-sm mb-2">You Pay</label>
                        <div className="flex bg-gray-700/50 rounded-xl p-4">
                            <input
                                type="number"
                                value={inputAmount}
                                onChange={(e) => handleAmountChange(e.target.value)}
                                className="flex-1 bg-transparent text-white text-2xl font-semibold focus:outline-none"
                                placeholder="0.0"
                            />
                            <div className="flex items-center gap-2 bg-gray-600 px-3 py-1 rounded-lg">
                                <div className={`w-6 h-6 rounded-full ${inputToken === "SUI" ? "bg-blue-500" : "bg-green-500"} flex items-center justify-center text-xs text-white font-bold`}>
                                    {inputToken === "SUI" ? "S" : "$"}
                                </div>
                                <span className="text-white font-semibold">{inputToken}</span>
                            </div>
                        </div>
                    </div>

                    {/* Swap Direction Button */}
                    <div className="flex justify-center -my-1 relative z-10">
                        <button
                            onClick={toggleDirection}
                            className="bg-gray-700 hover:bg-gray-600 p-2 rounded-full border-4 border-gray-800 transition"
                        >
                            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                            </svg>
                        </button>
                    </div>

                    {/* Output Token */}
                    <div className="mb-6">
                        <label className="block text-gray-400 text-sm mb-2">You Receive (estimated)</label>
                        <div className="flex bg-gray-700/30 rounded-xl p-4">
                            <div className="flex-1 text-white text-2xl font-semibold opacity-70">
                                {estimatedOutput}
                            </div>
                            <div className="flex items-center gap-2 bg-gray-600 px-3 py-1 rounded-lg">
                                <div className={`w-6 h-6 rounded-full ${outputToken === "SUI" ? "bg-blue-500" : "bg-green-500"} flex items-center justify-center text-xs text-white font-bold`}>
                                    {outputToken === "SUI" ? "S" : "$"}
                                </div>
                                <span className="text-white font-semibold">{outputToken}</span>
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">* Includes ~0.3% swap fee</p>
                    </div>

                    {/* Buttons */}
                    <div className="space-y-3">
                        <button
                            onClick={fetchPoolPrice}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold transition"
                        >
                            🔄 Refresh Price
                        </button>

                        <button
                            onClick={executeSwap}
                            disabled={isLoading || !account}
                            className="w-full py-4 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-400 hover:to-cyan-400 disabled:opacity-50 text-white rounded-xl font-bold text-lg transition"
                        >
                            {isLoading ? "⏳ Processing..." : `🚀 Swap ${inputToken} → ${outputToken}`}
                        </button>
                    </div>

                    {/* Wallet Status */}
                    {!account && (
                        <p className="text-center text-amber-400 mt-4">⚠️ Connect wallet first</p>
                    )}

                    {/* TX Result */}
                    {txResult && (
                        <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                            <p className="text-emerald-400 font-semibold">✅ Swap Successful!</p>
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

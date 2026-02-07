import { useState, useCallback } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useSuiClient } from "@mysten/dapp-kit";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import toast from "react-hot-toast";
import { createFileRoute } from "@tanstack/react-router";

// Route config
export const Route = createFileRoute("/test-close-position")({
    component: TestClosePosition,
});

// Constants
const CETUS_INTEGRATE_PACKAGE = "0xab2d58dd28ff0dc19b18ab2c634397b785a38c342a8f5065ade5f53f9dbffa1c";
const CETUS_GLOBAL_CONFIG = "0xc6273f844b4bc258952c4e477697aa12c918c8e08106fac6b934811298c9820a";

// Pool configs
const POOLS = {
    SUI_USDC: {
        id: "0xce144501b2e09fd9438e22397b604116a3874e137c8ae0c31144b45b2bf84f10",
        name: "SUI/USDC",
        coinA: "0x14a71d857b34677a7d57e0feb303df1adb515a37780645ab763d42ce8d1a5e48::usdc::USDC",
        coinB: "0x2::sui::SUI",
    },
};

// Cetus Position NFT type (verified from useQueryCetusPositions)
const CETUS_POSITION_TYPE = "0x5372d555ac734e272659136c2a0cd3227f9b92de67c80dc11250307268af2db8::position::Position";

type PoolKey = keyof typeof POOLS;

interface PositionInfo {
    id: string;
    poolId: string;
    liquidity: string;
    tickLower: number;
    tickUpper: number;
}

export default function TestClosePosition() {
    const suiClient = useSuiClient();
    const account = useCurrentAccount();
    const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();

    // State
    const [selectedPool] = useState<PoolKey>("SUI_USDC");
    const [positions, setPositions] = useState<PositionInfo[]>([]);
    const [selectedPosition, setSelectedPosition] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [txResult, setTxResult] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);

    const pool = POOLS[selectedPool];

    const addLog = (msg: string) => {
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
        console.log(msg);
    };

    // Fetch user's positions
    const fetchPositions = useCallback(async () => {
        if (!account) {
            toast.error("Connect wallet first!");
            return;
        }

        setIsLoading(true);
        setLogs([]);
        addLog("🔍 Fetching your positions...");
        addLog(`📌 Looking for type: ${CETUS_POSITION_TYPE}`);

        try {
            const objects = await suiClient.getOwnedObjects({
                owner: account.address,
                filter: {
                    StructType: CETUS_POSITION_TYPE,
                },
                options: {
                    showContent: true,
                },
            });

            addLog(`📦 Found ${objects.data.length} total position NFTs`);

            const positionList: PositionInfo[] = [];

            for (const obj of objects.data) {
                if (obj.data?.content?.dataType === "moveObject") {
                    const fields = (obj.data.content as any).fields;
                    const posPoolId = fields.pool;

                    addLog(`  → Position: ${obj.data.objectId.slice(0, 10)}... Pool: ${posPoolId?.slice(0, 10)}...`);

                    // Show ALL positions (not filtering by pool for now)
                    positionList.push({
                        id: obj.data.objectId,
                        poolId: posPoolId || "unknown",
                        liquidity: fields.liquidity || "0",
                        tickLower: parseInt(fields.tick_lower_index?.fields?.bits || "0"),
                        tickUpper: parseInt(fields.tick_upper_index?.fields?.bits || "0"),
                    });
                }
            }

            setPositions(positionList);
            addLog(`✅ Loaded ${positionList.length} positions`);

            if (positionList.length === 0) {
                addLog("ℹ️ No positions found. Try opening a position first!");
            }
        } catch (e: any) {
            addLog(`❌ Error: ${e.message}`);
            toast.error(e.message);
        } finally {
            setIsLoading(false);
        }
    }, [suiClient, account]);

    // Close position
    const closePosition = async () => {
        if (!account) {
            toast.error("Connect wallet first!");
            return;
        }

        if (!selectedPosition) {
            toast.error("Select a position first!");
            return;
        }

        setIsLoading(true);
        setTxResult(null);
        addLog(`🗑️ Closing position ${selectedPosition.slice(0, 10)}...`);

        try {
            const tx = new Transaction();

            // Call close_position
            // pool_script_v2::close_position needs: config, pool, position, min_amount_a, min_amount_b, clock
            addLog("🔧 Calling pool_script_v2::close_position...");
            tx.moveCall({
                target: `${CETUS_INTEGRATE_PACKAGE}::pool_script_v2::close_position`,
                arguments: [
                    tx.object(CETUS_GLOBAL_CONFIG),
                    tx.object(pool.id),
                    tx.object(selectedPosition),
                    tx.pure.u64(0), // min_amount_a (0 = accept any amount)
                    tx.pure.u64(0), // min_amount_b (0 = accept any amount)
                    tx.object("0x6"), // Clock
                ],
                typeArguments: [pool.coinA, pool.coinB],
            });

            addLog("📝 Signing transaction...");

            signAndExecuteTransaction(
                { transaction: tx as any },
                {
                    onSuccess: (result) => {
                        addLog(`✅ Position closed! Digest: ${result.digest}`);
                        setTxResult(result.digest);
                        toast.success("Position closed!");
                        setIsLoading(false);
                        // Refresh positions
                        setPositions((prev) => prev.filter((p) => p.id !== selectedPosition));
                        setSelectedPosition("");
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
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900 p-8">
            <div className="max-w-lg mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">🗑️ Close Position</h1>
                    <p className="text-red-300">Remove Cetus CLMM Liquidity</p>
                </div>

                {/* Main Card */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-red-500/20">
                    {/* Pool Info */}
                    <div className="mb-6 p-4 bg-red-500/10 rounded-xl">
                        <div className="flex justify-between items-center">
                            <span className="text-red-300">Pool</span>
                            <span className="text-white font-bold">{pool.name}</span>
                        </div>
                    </div>

                    {/* Fetch Positions Button */}
                    <button
                        onClick={fetchPositions}
                        disabled={isLoading || !account}
                        className="w-full py-3 mb-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl font-semibold transition"
                    >
                        {isLoading ? "⏳ Loading..." : "🔍 Fetch My Positions"}
                    </button>

                    {/* Positions List */}
                    {positions.length > 0 && (
                        <div className="mb-6">
                            <label className="block text-red-300 text-sm mb-2">Select Position to Close</label>
                            <div className="space-y-2">
                                {positions.map((pos) => (
                                    <div
                                        key={pos.id}
                                        onClick={() => setSelectedPosition(pos.id)}
                                        className={`p-3 rounded-xl cursor-pointer transition ${selectedPosition === pos.id
                                            ? "bg-red-500/30 border-2 border-red-500"
                                            : "bg-gray-700/50 border border-gray-600 hover:border-red-400"
                                            }`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <span className="text-white font-mono text-sm">
                                                {pos.id.slice(0, 8)}...{pos.id.slice(-6)}
                                            </span>
                                            {selectedPosition === pos.id && (
                                                <span className="text-red-400 text-xs">✓ Selected</span>
                                            )}
                                        </div>
                                        <div className="flex gap-4 mt-2 text-xs text-gray-400">
                                            <span>Liquidity: {pos.liquidity}</span>
                                            <span>Ticks: [{pos.tickLower}, {pos.tickUpper}]</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* No Positions Message */}
                    {positions.length === 0 && !isLoading && (
                        <div className="mb-6 p-4 bg-gray-700/30 rounded-xl text-center">
                            <p className="text-gray-400">No positions found</p>
                            <p className="text-gray-500 text-sm mt-1">Click "Fetch My Positions" to load</p>
                        </div>
                    )}

                    {/* Close Button */}
                    <button
                        onClick={closePosition}
                        disabled={isLoading || !account || !selectedPosition}
                        className="w-full py-4 bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400 disabled:opacity-50 text-white rounded-xl font-bold text-lg transition"
                    >
                        {isLoading ? "⏳ Processing..." : "🗑️ Close Position"}
                    </button>

                    {/* Warning */}
                    <p className="text-xs text-amber-400 text-center mt-3">
                        ⚠️ This will remove all liquidity and burn the position NFT
                    </p>

                    {/* Wallet Status */}
                    {!account && (
                        <p className="text-center text-amber-400 mt-4">⚠️ Connect wallet first</p>
                    )}

                    {/* TX Result */}
                    {txResult && (
                        <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                            <p className="text-emerald-400 font-semibold">✅ Position Closed!</p>
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

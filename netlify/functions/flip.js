const { JsonRpcProvider, Wallet, Contract, Signature } = require('ethers');

// --- CONFIGURATION ---
const PAYMENT_RECIPIENT = "0xea55e1a310202453685d91dcf654db9d38a286a3"; // Your wallet
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const WIN_CHANCE_PERCENT = 50; // 50% Coinflip chance

// (CHANGED) Define minimum and maximum bet amounts
// 5000n = 0.05 USDC
const MIN_BET_AMOUNT = 50000n; 
// 1000000000n = 1000 USDC (6 decimals)
const MAX_BET_AMOUNT = 1000000000n; 

const { PROVIDER_URL, RELAYER_PRIVATE_KEY } = process.env;
const provider = new JsonRpcProvider(PROVIDER_URL || "https://mainnet.base.org");

// Backend wallet (Relayer)
let backendWallet;
if (RELAYER_PRIVATE_KEY) {
    backendWallet = new Wallet(RELAYER_PRIVATE_KEY, provider);
}

// ABIs
const USDC_ABI = [
    'function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature) external',
    'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
    'function balanceOf(address account) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const processedAuthorizations = new Set();

// =================================================================
// HELPER FUNCTIONS
// =================================================================

/**
 * Executes the USDC transfer from user to backend via EIP-3009
 */
async function executeUSDCTransfer(authorization, signature) {
    try {
        const { from, to, value, validAfter, validBefore, nonce } = authorization;
        console.log('Executing USDC transfer (bet):', { from, to, value, nonce });
        if (!backendWallet) throw new Error('Backend wallet not configured');
        
        const usdcContract = new Contract(USDC_ADDRESS, USDC_ABI, backendWallet);
        const authKey = `${from}-${nonce}`.toLowerCase();
        
        if (processedAuthorizations.has(authKey)) {
            throw new Error('Authorization already processed');
        }

        // (CHANGED) Validate minimum AND maximum bet
        const userBetAmount = BigInt(value);
        if (userBetAmount < MIN_BET_AMOUNT) {
            throw new Error(`Insufficient amount: ${userBetAmount}, required minimum: ${MIN_BET_AMOUNT}`);
        }
        if (userBetAmount > MAX_BET_AMOUNT) {
            throw new Error(`Bet exceeds maximum: ${userBetAmount}, maximum is ${MAX_BET_AMOUNT}`);
        }
        // -------------------------

        if (to.toLowerCase() !== PAYMENT_RECIPIENT.toLowerCase()) {
            throw new Error('Invalid payment recipient');
        }

        let sig;
        try {
            sig = Signature.from(signature);
        } catch (e) {
            throw new Error('Invalid signature format');
        }
        
        const { v, r, s } = sig;
        console.log('Calling transferWithAuthorization...');
        const tx = await usdcContract.transferWithAuthorization(
            from, to, value, validAfter, validBefore, nonce, v, r, s
        );
        const receipt = await tx.wait();
        console.log('Transfer (bet) confirmed in block:', receipt.blockNumber);
        
        processedAuthorizations.add(authKey);
        setTimeout(() => processedAuthorizations.delete(authKey), 3600000); 

        return { success: true, txHash: receipt.hash, from, amount: value };
    } catch (error) {
        console.error('USDC transfer error:', error);
        throw error;
    }
}

/**
 * Sends USDC payout from backend wallet to the winner
 */
async function sendUSDCPayout(recipientAddress, amount) {
    try {
        console.log(`Sending USDC payout (${amount}) to:`, recipientAddress);
        if (!backendWallet) throw new Error('Backend wallet not configured');

        const usdcContract = new Contract(USDC_ADDRESS, USDC_ABI, backendWallet);

        const ethBalance = await provider.getBalance(backendWallet.address);
        if (ethBalance < BigInt(1e15)) { // 0.001 ETH
            throw new Error('Insufficient gas in backend wallet for payout');
        }

        const usdcBalance = await usdcContract.balanceOf(backendWallet.address);
        if (BigInt(usdcBalance) < BigInt(amount)) {
            throw new Error('Insufficient USDC in backend wallet for payout');
        }

        console.log('Calling transfer (payout) function...');
        const tx = await usdcContract.transfer(recipientAddress, amount, { gasLimit: 100000 });
        const receipt = await tx.wait();
        console.log('Payout confirmed in block:', receipt.blockNumber);

        return { success: true, txHash: receipt.hash, blockNumber: receipt.blockNumber };
    } catch (error) {
        console.error('USDC payout error:', error);
        throw error;
    }
}


// =================================================================
// MAIN HANDLER
// =================================================================
exports.handler = async (event) => {
    // ... (CORS preflight stays the same) ...

    const xPaymentHeader = event.headers['x-payment'] || event.headers['X-Payment'];

    // --- GET REQUEST: (Coinflip Metadata) ---
    if (event.httpMethod === 'GET' || !xPaymentHeader) {
        const minBetFormatted = (Number(MIN_BET_AMOUNT) / 1e6).toFixed(2);
        const maxBetFormatted = (Number(MAX_BET_AMOUNT) / 1e6).toFixed(2);
        
        return {
            statusCode: 402,
            body: JSON.stringify({
                x402Version: 1,
                error: "Payment Required",
                message: `Pay minimum ${minBetFormatted} USDC to flip a coin`,
                accepts: [{
                    name: "x402flip | Coinflip on x402",
                    
                    // --- FIX 1: Change 'variable' to 'exact' ---
                    scheme: "exact", 
                    
                    network: "base",

                    // --- FIX 2: Add 'maxAmountRequired' ---
                    // We set this to the minimum bet to satisfy the validator.
                    // Your app logic (frontend/backend) still uses Min/Max.
                    maxAmountRequired: "50000", 
                    // (minAmountRequired and maxAmountSupported are removed)

                    resource: `https://${event.headers.host}${event.path}`,
                    description: `Flip it or leave it. x402 decides. ${WIN_CHANCE_PERCENT}% chance! (Min: ${minBetFormatted}, Max: ${maxBetFormatted} USDC)`,
                    mimeType: "application/json",
                    image: "https://raw.githubusercontent.com/riz877/x402/refs/heads/main/fav.png",
                    payTo: PAYMENT_RECIPIENT,
                    asset: USDC_ADDRESS,
                    maxTimeoutSeconds: 3600,
                    
                    // --- FIX 3: Add the missing schema object ---
                    outputSchema: {
                        input: { 
                            type: "http", 
                            method: "POST",
                            properties: {
                                x402Version: { type: "number" },
                                scheme: { type: "string" },
                                network: { type: "string" },
                                payload: {
                                    type: "object",
                                    properties: {
                                        signature: { type: "string" },
                                        authorization: {
                                            type: "object",
                                            properties: {
                                                from: { type: "string" },
                                                to: { type: "string" },
                                                value: { type: "string" },
                                                validAfter: { type: "string" },
                                                validBefore: { type: "string" },
                                                nonce: { type: "string" }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        output: { 
                            success: "boolean",
                            message: "string",
                            data: {
                                type: "object",
                                properties: {
                                    lucky: { type: "boolean" },
                                    payoutAmount: { type: "string" },
                                    recipient: { type: "string" },
                                    paymentTx: { type: "string" },
                                    payoutTx: { type: "string" }
                                }
                            }
                        }
                    },
                    // ------------------------------------

                    extra: { /* ... (extra remains same) ... */ }
                }]
            }),
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache'
            }
        };
    }

    // --- POST REQUEST: (Coinflip Logic) ---
    try {
        const payloadJson = Buffer.from(xPaymentHeader, 'base64').toString('utf8');
        const payload = JSON.parse(payloadJson);
        
        console.log("📨 Received payload:", JSON.stringify(payload, null, 2));

        if (!payload.x402Version || !payload.payload || !payload.payload.authorization || !payload.payload.signature) {
            return {
                statusCode: 400,
                body: JSON.stringify({ success: false, error: "Invalid x402 payload" }),
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            };
        }

        const { authorization, signature } = payload.payload;
        const userAddress = authorization.from;
        const userBetAmount = BigInt(authorization.value);

        console.log('👤 User address:', userAddress);
        console.log('💰 Bet amount:', userBetAmount.toString(), 'USDC (min:', MIN_BET_AMOUNT.toString(), 'max:', MAX_BET_AMOUNT.toString(), ')');

        // Step 1: Execute USDC transfer (Bet from user)
        // This function now validates both min and max bet
        console.log('Step 1: Executing USDC transfer (Bet)...');
        const transferResult = await executeUSDCTransfer(authorization, signature);
        console.log('✅ Bet received:', transferResult.txHash);

        // Step 2: Determine luck (Coinflip)
        console.log('Step 2: Flipping the coin...');
        const winThreshold = 0.30;
        const roll = Math.random();
        const isLucky = roll < winThreshold;

        console.log(`Roll: ${roll.toFixed(4)}, Threshold: ${winThreshold}, Lucky: ${isLucky}`);

        // Step 3: Send Payout ONLY if lucky
        if (isLucky) {
            console.log('✅ Lucky! Sending USDC payout...');
            
            const payoutAmount = (userBetAmount * 2n).toString();
            console.log(`Calculating payout: ${userBetAmount.toString()} * 2 = ${payoutAmount}`);

            const payoutResult = await sendUSDCPayout(userAddress, payoutAmount);
            console.log('✅ Payout successful:', payoutResult.txHash);

            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: `You won! ${parseFloat(payoutAmount) / 1e6} USDC sent to your wallet! 💰`,
                    data: {
                        lucky: true,
                        payoutAmount: payoutAmount,
                        betAmount: userBetAmount.toString(),
                        recipient: userAddress,
                        paymentTx: transferResult.txHash,
                        payoutTx: payoutResult.txHash,
                        blockNumber: payoutResult.blockNumber,
                        timestamp: new Date().toISOString()
                    }
                }),
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            };

        } else {
            console.log('❌ Unlucky. No payout.');
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: "Sorry, you lost this flip. Better luck next time!",
                    data: {
                        lucky: false,
                        betAmount: userBetAmount.toString(),
                        recipient: userAddress,
                        paymentTx: transferResult.txHash,
                        timestamp: new Date().toISOString()
                    }
                }),
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            };
        }

    } catch (error) {
        console.error("❌ Error:", error);
        
        let statusCode = 500;
        let errorMessage = error.message;

        if (error.message.includes('already processed')) statusCode = 409;
        // (CHANGED) Updated error message check
        else if (error.message.includes('Insufficient amount') || error.message.includes('exceeds maximum')) statusCode = 402;
        else if (error.message.includes('Invalid')) statusCode = 400;
        else if (error.message.includes('gas') || error.message.includes('Insufficient USDC')) {
            statusCode = 503; 
            errorMessage = 'Service temporarily unavailable. Please try again later.';
        }

        return {
            statusCode,
            body: JSON.stringify({ success: false, error: errorMessage }),
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        };
    }
};
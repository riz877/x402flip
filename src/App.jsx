import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import './App.css';

// -----------------------------------------------------------------
// Pastikan ini '/api/flip' jika Anda menamai file Anda flip.js
// -----------------------------------------------------------------
const BACKEND_URL = '/api/flip';
// -----------------------------------------------------------------

// Base Mainnet Network Info
const BASE_CHAIN_ID = '0x2105'; // 8453
const BASE_NETWORK_INFO = {
  chainId: 8453,
  chainName: 'Base Mainnet',
  nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org'],
  blockExplorerUrls: ['https://basescan.org'],
};

// Define min and max bet for frontend validation
const MIN_BET_USDC = 0.05; 
const MAX_BET_USDC = 1000;

function App() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [paymentInfo, setPaymentInfo] = useState(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  // --- (FIXED) Default bet diatur kembali ke $0.05 ---
  const [betAmount, setBetAmount] = useState(MIN_BET_USDC.toString());
  
  // Set your app's URL for the share link
  const APP_URL = "https://x402flip.xyz";
  const TWITTER_SHARE_TEXT = "I just play coinflip on x402! Try your luck!";

  // 1. Try to connect wallet on page load
  useEffect(() => {
    if (window.ethereum) {
      const ethersProvider = new ethers.BrowserProvider(window.ethereum);
      setProvider(ethersProvider);
      
      window.ethereum.request({ method: 'eth_accounts' })
        .then(async (accounts) => {
          if (accounts.length > 0) {
            await handleWalletConnected(ethersProvider, accounts[0]);
          }
        })
        .catch(console.error);
    }
  }, []);

  // 2. Function to switch or add Base network
  const switchNetwork = async (prov) => {
    try {
      await prov.send('wallet_switchEthereumChain', [{ chainId: BASE_CHAIN_ID }]);
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await prov.send('wallet_addEthereumChain', [BASE_NETWORK_INFO]);
        } catch (addError)
{
          console.error('Failed to add Base network:', addError);
          throw addError;
        }
      } else {
        console.error('Failed to switch network:', switchError);
        throw switchError;
      }
    }
  };

  // 3. Function called after wallet is connected
  const handleWalletConnected = async (prov, userAccount) => {
    try {
      const network = await prov.getNetwork();
      if (network.chainId.toString() !== parseInt(BASE_CHAIN_ID).toString()) {
        setMessage('Wrong network. Please switch to Base Mainnet.');
        setIsError(true);
        await switchNetwork(prov);
        const newNetwork = await prov.getNetwork();
        if (newNetwork.chainId.toString() !== parseInt(BASE_CHAIN_ID).toString()) {
          return;
        }
      }
      
      const ethersSigner = await prov.getSigner();
      setSigner(ethersSigner);
      setAccount(userAccount);
      setMessage('');
      setIsError(false);
      fetchPaymentInfo();
    } catch (error) {
      setMessage(`Connection failed: ${error.message}`);
      setIsError(true);
    }
  };

  // 4. "Connect Wallet" button action
  const connectWallet = async () => {
    if (!provider) {
      setMessage('Wallet (e.g., MetaMask) not found.');
      setIsError(true);
      return;
    }
    try {
      const accounts = await provider.send('eth_requestAccounts', []);
      if (accounts.length > 0) {
        await handleWalletConnected(provider, accounts[0]);
      }
    } catch (error) {
      setMessage(`Connection failed: ${error.message}`);
      setIsError(true);
    }
  };

  // 5. Get 402 metadata from backend (GET request)
  const fetchPaymentInfo = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(BACKEND_URL);
      const data = await response.json();
      
      if (response.status === 402 && data.accepts && data.accepts.length > 0) {
        setPaymentInfo(data.accepts[0]);
        console.log('402 Payment Info:', data.accepts[0]);
      } else {
        throw new Error(data.error || 'Failed to get payment info.');
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  // 6. Main "FLIP COIN" function
  const handleFlipCoin = async () => {
    if (!signer || !account || !paymentInfo) {
      setMessage('Wallet not connected or payment info not loaded.');
      setIsError(true);
      return;
    }

    // (FIXED) Network check added before signing
    setIsLoading(true);
    setIsError(false);
    setMessage('Checking network...'); 

    try {
        const network = await provider.getNetwork();
        if (network.chainId.toString() !== parseInt(BASE_CHAIN_ID).toString()) {
            setMessage('Wrong network. Please switch to Base Mainnet.');
            setIsError(true);
            await switchNetwork(provider); 
            
            const newNetwork = await provider.getNetwork();
            if (newNetwork.chainId.toString() !== parseInt(BASE_CHAIN_ID).toString()) {
                setIsLoading(false); 
                return; 
            }
        }
    } catch (error) {
        setMessage(`Network check failed: ${error.message}`);
        setIsError(true);
        setIsLoading(false);
        return;
    }
    // --- End of network check ---


    // Validate min AND max bet
    const cleanBetAmount = betAmount.replace(',', '.');
    const betAmountFloat = parseFloat(cleanBetAmount);
    
    if (isNaN(betAmountFloat) || betAmountFloat < MIN_BET_USDC) {
        setMessage(`Invalid bet. Minimum bet is ${MIN_BET_USDC} USDC.`);
        setIsError(true);
        setIsLoading(false); 
        return;
    }
    if (betAmountFloat > MAX_BET_USDC) {
        setMessage(`Invalid bet. Maximum bet is ${MAX_BET_USDC} USDC.`);
        setIsError(true);
        setIsLoading(false); 
        return;
    }
    // ---------------------------------

    setMessage('Preparing signature...');

    try {
      const { payTo, asset } = paymentInfo;
      const usdcAddress = asset;
      const recipientAddress = payTo;
      
      const value = ethers.parseUnits(cleanBetAmount, 6); 

      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60); 
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

      // ... lewati beberapa baris

      const domain = {
        name: 'USD Coin',   // INI YANG BENAR (dari file nft_mint.js Anda)
        version: '2',         // INI YANG BENAR (dari file nft_mint.js Anda)
        chainId: 8453,      // INI YANG BENAR (angka, bukan string)
        verifyingContract: usdcAddress,
      };

      const types = {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      };

      const messageValue = { from, to, value, validAfter, validBefore, nonce };

      setMessage('Please sign the transaction in your wallet...');
      const signature = await signer.signTypedData(domain, types, messageValue);

      const authorization = {
        from,
        to,
        value: value.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      };

      const xPaymentPayload = {
        x402Version: 1,
        scheme: paymentInfo.scheme,
        network: paymentInfo.network,
        payload: { authorization, signature },
      };
      
      const xPaymentHeader = btoa(JSON.stringify(xPaymentPayload));

      setMessage('Sending transaction to backend... Good luck!');
      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: {
          'X-Payment': xPaymentHeader,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`);
      }

      // (FIXED) Removed strange characters
      if (result.success && result.data.lucky) {
        setMessage(`🎉 CONGRATS! You won! ${ethers.formatUnits(result.data.payoutAmount, 6)} USDC sent.`);
        setIsError(false);
      } else if (result.success && !result.data.lucky) {
        setMessage('😢 You lost. Try again!');
        setIsError(false);
      } else {
        throw new Error(result.error || 'Unknown response.');
      }

    } catch (error) {
      console.error('x402flip error:', error);
      
      // (FIXED) Handle user rejection
      if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
          setMessage('You rejected the signature request.');
      } 
      // (FIXED) Handle invalid signature
      else if (error.message.includes('invalid signature')) {
          setMessage('Error: Signature failed. Please check your network and try again.');
      } 
      // Fallback for other errors
      else {
          if (error.message.length > 200) {
            setMessage('Error: An unknown error occurred.');
          } else {
            setMessage(`Error: ${error.message || 'Transaction failed.'}`);
          }
      }
      
      setIsError(true);

    } finally {
      setIsLoading(false);
    }
  }; // This is the end of the handleFlipCoin function

  return (
    <div className="App">
      <div className="window-container">
        
        <div className="window-title-bar">
          <span className="title-text">X402FLIP.EXE</span>
          <div className="window-controls">
            <span className="control-btn">_</span>
            {/* (FIXED) Replaced strange character */}
            <span className="control-btn">□</span>
            <span className="control-btn">X</span>
          </div>
        </div>

        <div className="window-content">
          <h1>x402flip</h1>
          <p>Flip it or leave it. x402 decides.</p>

          {isLoading && (
            <div className="coin-container">
              <div className="coin"></div>
            </div>
          )}

          {message && (
            <p className={`message ${isError ? 'error' : 'success'}`}>
              {message}
            </p>
          )}

          {!account ? (
            <button 
              className="cta-button" 
              onClick={connectWallet} 
              disabled={isLoading}
            >
              Connect Wallet (Base)
            </button>
          ) : (
            <div className="flip-controls">
              <div className="input-group">
                <label htmlFor="betAmount">Bet Amount (USDC)</label>
                <input
                  type="number"
                  id="betAmount"
                  className="bet-input"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  disabled={isLoading}
                  min={MIN_BET_USDC}
                  max={MAX_BET_USDC}
                  step="0.1"
                />
              </div>
              <button 
                className="cta-button" 
                onClick={handleFlipCoin} 
                disabled={isLoading || !paymentInfo}
              >
                {isLoading ? 'Flipping...' : `Flip Coin!`}
              </button>
            </div>
          )}

          {/* --- SOCIAL ICON ADDED --- */}
          <div className="social-links">
            <a 
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(TWITTER_SHARE_TEXT)}&url=${encodeURIComponent(APP_URL)}`}
              target="_blank" 
              rel="noopener noreferrer" 
              className="social-icon"
              title="Share on X (Twitter)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                <path d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.602.75z"/>
              </svg>
            </a>
          </div>
          {/* ------------------------------- */}

        </div>
      </div>
    </div>
  );
}

export default App;
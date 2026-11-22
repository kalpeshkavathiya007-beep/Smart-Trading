const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const filePath = path.join(__dirname, 'index.html');
const CONFIG_FILE = path.join(__dirname, 'angel_config.json');

// Default Config
let config = {
    apiKey: "pAXukQqD",
    clientCode: "K82980",
    clientPublicIP: "152.58.60.199",
    totpSecret: "SOHPSTMSHIRFOTHOAX5W6Y6BWE",
    mpin: "1996",
    jwtToken: "",
    refreshToken: "",
    feedToken: "",
    isLoggedIn: false
};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        config = { ...config, ...saved };
    } catch (e) {
        console.error("Config parse error:", e.message);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {}
}

// Master instrument lookup map for F&O, Cash, and MCX
const MASTER_TOKENS = {
    // Top Liquid F&O / Equities (NSE)
    "RELIANCE": { token: "2885", exch: "NSE", name: "RELIANCE", segment: "future", lot: 250 },
    "TATASTEEL": { token: "3499", exch: "NSE", name: "TATASTEEL", segment: "future", lot: 5500 },
    "INFY": { token: "1594", exch: "NSE", name: "INFY", segment: "future", lot: 400 },
    "HDFCBANK": { token: "1333", exch: "NSE", name: "HDFCBANK", segment: "future", lot: 550 },
    "SBIN": { token: "3045", exch: "NSE", name: "SBIN", segment: "future", lot: 750 },
    "ICICIBANK": { token: "4948", exch: "NSE", name: "ICICIBANK", segment: "future", lot: 700 },
    "AXISBANK": { token: "5900", exch: "NSE", name: "AXISBANK", segment: "future", lot: 625 },
    "KOTAKBANK": { token: "1922", exch: "NSE", name: "KOTAKBANK", segment: "future", lot: 400 },
    "TCS": { token: "11536", exch: "NSE", name: "TCS", segment: "future", lot: 175 },
    "LT": { token: "11483", exch: "NSE", name: "LT", segment: "future", lot: 150 },
    "BHARTIARTL": { token: "10604", exch: "NSE", name: "BHARTIARTL", segment: "future", lot: 475 },
    "MARUTI": { token: "10999", exch: "NSE", name: "MARUTI", segment: "future", lot: 50 },
    "TATAMOTORS": { token: "3456", exch: "NSE", name: "TATAMOTORS", segment: "future", lot: 700 },
    "BAJFINANCE": { token: "317", exch: "NSE", name: "BAJFINANCE", segment: "future", lot: 125 },
    "M&M": { token: "2031", exch: "NSE", name: "M&M", segment: "future", lot: 350 },
    "SUNPHARMA": { token: "3351", exch: "NSE", name: "SUNPHARMA", segment: "future", lot: 350 },
    "TITAN": { token: "3506", exch: "NSE", name: "TITAN", segment: "future", lot: 175 },
    "ITC": { token: "1660", exch: "NSE", name: "ITC", segment: "future", lot: 1600 },
    "ASIANPAINT": { token: "236", exch: "NSE", name: "ASIANPAINT", segment: "future", lot: 200 },
    "WIPRO": { token: "3787", exch: "NSE", name: "WIPRO", segment: "future", lot: 1500 },
    "HCLTECH": { token: "7229", exch: "NSE", name: "HCLTECH", segment: "future", lot: 350 },
    "NTPC": { token: "11630", exch: "NSE", name: "NTPC", segment: "future", lot: 1500 },
    "ONGC": { token: "2475", exch: "NSE", name: "ONGC", segment: "future", lot: 2250 },
    "POWERGRID": { token: "14977", exch: "NSE", name: "POWERGRID", segment: "future", lot: 1800 },
    "COALINDIA": { token: "20374", exch: "NSE", name: "COALINDIA", segment: "future", lot: 2100 },
    "ADANIENT": { token: "25", exch: "NSE", name: "ADANIENT", segment: "future", lot: 300 },
    "ADANIPORTS": { token: "15083", exch: "NSE", name: "ADANIPORTS", segment: "future", lot: 400 },
    "TRENT": { token: "1964", exch: "NSE", name: "TRENT", segment: "cash", lot: 1 },
    "ZOMATO": { token: "5097", exch: "NSE", name: "ZOMATO", segment: "cash", lot: 1 },
    "HAL": { token: "2303", exch: "NSE", name: "HAL", segment: "cash", lot: 1 },
    "BEL": { token: "383", exch: "NSE", name: "BEL", segment: "cash", lot: 1 },
    "POLYCAB": { token: "9581", exch: "NSE", name: "POLYCAB", segment: "cash", lot: 1 },
    "VEDL": { token: "3063", exch: "NSE", name: "VEDL", segment: "cash", lot: 1 },
    "JINDALSTEL": { token: "6733", exch: "NSE", name: "JINDALSTEL", segment: "cash", lot: 1 },
    "DLF": { token: "14732", exch: "NSE", name: "DLF", segment: "cash", lot: 1 },

    // MCX Commodities
    "CRUDEOIL": { token: "573422", exch: "MCX", name: "CRUDEOIL", segment: "mcx", lot: 100 },
    "NATURALGAS": { token: "583829", exch: "MCX", name: "NATURALGAS", segment: "mcx", lot: 1250 },
    "GOLD": { token: "495213", exch: "MCX", name: "GOLD", segment: "mcx", lot: 1 },
    "SILVER": { token: "495214", exch: "MCX", name: "SILVER", segment: "mcx", lot: 30 },
    "COPPER": { token: "590879", exch: "MCX", name: "COPPER", segment: "mcx", lot: 2500 }
};

// RFC 6238 Base32 Decoding & TOTP Generator
function base32toHex(base32) {
    const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    let hex = "";
    let clean = base32.replace(/=+$/, "").toUpperCase();
    for (let i = 0; i < clean.length; i++) {
        let val = base32chars.indexOf(clean.charAt(i));
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
    }
    for (let i = 0; i + 4 <= bits.length; i += 4) {
        let chunk = bits.substr(i, 4);
        hex += parseInt(chunk, 2).toString(16);
    }
    return hex;
}

function generateTOTP(secret) {
    try {
        const hexKey = base32toHex(secret);
        const key = Buffer.from(hexKey, 'hex');
        const epoch = Math.floor(Date.now() / 1000);
        const time = Math.floor(epoch / 30);
        
        const timeBuf = Buffer.alloc(8);
        timeBuf.writeUInt32BE(0, 0);
        timeBuf.writeUInt32BE(time, 4);

        const hmac = crypto.createHmac('sha1', key);
        hmac.update(timeBuf);
        const hash = hmac.digest();

        const offset = hash[hash.length - 1] & 0xf;
        const binary = ((hash[offset] & 0x7f) << 24) |
                       ((hash[offset + 1] & 0xff) << 16) |
                       ((hash[offset + 2] & 0xff) << 8) |
                       (hash[offset + 3] & 0xff);

        const otp = binary % 1000000;
        return String(otp).padStart(6, '0');
    } catch (e) {
        return "";
    }
}

// Angel One Login Handler
function angelLogin(mpin, callback) {
    const totpCode = generateTOTP(config.totpSecret);
    const postData = JSON.stringify({
        clientcode: config.clientCode,
        password: String(mpin),
        totp: String(totpCode)
    });

    const options = {
        hostname: 'apiconnect.angelone.in',
        path: '/rest/auth/angelbroking/user/v1/loginByPassword',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': config.clientPublicIP,
            'X-ClientPublicIP': config.clientPublicIP,
            'X-MACAddress': 'fe80::1',
            'X-PrivateKey': config.apiKey,
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(body);
                if (json.status && json.data) {
                    config.jwtToken = json.data.jwtToken;
                    config.refreshToken = json.data.refreshToken;
                    config.feedToken = json.data.feedToken;
                    config.isLoggedIn = true;
                    config.mpin = String(mpin);
                    saveConfig();
                    if (callback) callback(null, { success: true, message: "Connected to Angel One Live Feed!" });
                } else {
                    if (callback) callback(new Error(json.message || "Authentication error"));
                }
            } catch (err) {
                if (callback) callback(new Error("Invalid response from server"));
            }
        });
    });

    req.on('error', (e) => { if (callback) callback(e); });
    req.write(postData);
    req.end();
}

// Fetch Quotes for Broad Market Scanning
function fetchAngelQuotesBroad(customTokens, callback) {
    if (!config.jwtToken) {
        return callback(new Error("No active Angel One session"));
    }

    let nseTokens = ["2885", "3499", "3045", "1333", "1594", "4948", "5900", "1922", "11536", "11483", "10604", "10999", "3456", "317", "2031", "3351", "3506", "1660", "236", "3787", "7229", "11630", "2475", "14977", "20374", "25", "15083", "1964", "5097", "2303", "383", "9581", "3063", "6733", "14732"];
    let mcxTokens = ["573422", "583829", "495213", "495214", "590879"];

    if (customTokens && customTokens.NSE) {
        customTokens.NSE.forEach(t => { if (!nseTokens.includes(t)) nseTokens.push(t); });
    }
    if (customTokens && customTokens.MCX) {
        customTokens.MCX.forEach(t => { if (!mcxTokens.includes(t)) mcxTokens.push(t); });
    }

    const postData = JSON.stringify({
        mode: "FULL",
        exchangeTokens: {
            "NSE": nseTokens,
            "MCX": mcxTokens
        }
    });

    const options = {
        hostname: 'apiconnect.angelone.in',
        path: '/rest/secure/angelbroking/market/v1/quote',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': config.clientPublicIP,
            'X-ClientPublicIP': config.clientPublicIP,
            'X-MACAddress': 'fe80::1',
            'X-PrivateKey': config.apiKey,
            'Authorization': 'Bearer ' + config.jwtToken,
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(body);
                if (json.status && json.data && json.data.fetched) {
                    const priceMap = {};
                    json.data.fetched.forEach(item => {
                        priceMap[item.tradingSymbol] = {
                            symbol: item.tradingSymbol,
                            token: item.symbolToken,
                            exchange: item.exchange,
                            ltp: parseFloat(item.ltp) || 0,
                            close: parseFloat(item.close) || 0,
                            high: parseFloat(item.high) || 0,
                            low: parseFloat(item.low) || 0,
                            open: parseFloat(item.open) || 0,
                            volume: item.tradeVolume || 0,
                            percentChange: item.close ? parseFloat((((item.ltp - item.close) / item.close) * 100).toFixed(2)) : 0
                        };
                    });
                    callback(null, priceMap);
                } else {
                    callback(new Error(json.message || "Failed to fetch quotes"));
                }
            } catch (err) {
                callback(err);
            }
        });
    });

    req.on('error', e => callback(e));
    req.write(postData);
    req.end();
}

// Single Custom Quote Search
function fetchCustomQuote(symbolQuery, callback) {
    const sym = symbolQuery.trim().toUpperCase().replace(/-EQ$/, '');
    let matched = MASTER_TOKENS[sym];

    if (!matched) {
        for (let key in MASTER_TOKENS) {
            if (key.includes(sym) || sym.includes(key)) {
                matched = MASTER_TOKENS[key];
                break;
            }
        }
    }

    if (!matched) {
        return callback(new Error(`Stock '${sym}' not found in high-liquidity database`));
    }

    const payload = {
        NSE: matched.exch === 'NSE' ? [matched.token] : [],
        MCX: matched.exch === 'MCX' ? [matched.token] : []
    };

    fetchAngelQuotesBroad(payload, (err, quotes) => {
        if (err) return callback(err);
        
        let found = null;
        for (let k in quotes) {
            if (k.startsWith(matched.name) || quotes[k].token === matched.token) {
                found = quotes[k];
                break;
            }
        }

        if (!found) {
            return callback(new Error(`No live feed received for ${matched.name}`));
        }

        found.meta = matched;
        callback(null, found);
    });
}

// HTTP Server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.url === '/api/angel-status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            clientCode: config.clientCode,
            hasTotpSecret: !!config.totpSecret,
            hasSavedMpin: !!config.mpin,
            isLoggedIn: config.isLoggedIn
        }));
        return;
    }

    if (req.url === '/api/live-quotes' && req.method === 'GET') {
        fetchAngelQuotesBroad(null, (err, quotes) => {
            if (err) {
                // If token expired, auto re-login once with saved MPIN and retry
                if (err.message && (err.message.includes("Token") || err.message.includes("session")) && config.mpin) {
                    console.log("Token expired. Auto re-logging in with saved MPIN...");
                    angelLogin(config.mpin, (loginErr) => {
                        if (loginErr) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: loginErr.message }));
                        } else {
                            fetchAngelQuotesBroad(null, (retryErr, retryQuotes) => {
                                if (retryErr) {
                                    res.writeHead(500, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: false, message: retryErr.message }));
                                } else {
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: true, quotes: retryQuotes }));
                                }
                            });
                        }
                    });
                    return;
                }
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, quotes }));
            }
        });
        return;
    }

    if (req.url.startsWith('/api/custom-quote') && req.method === 'GET') {
        const u = new URL(req.url, `http://${req.headers.host}`);
        const sym = u.searchParams.get('symbol');
        if (!sym) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: "Missing symbol parameter" }));
            return;
        }

        fetchCustomQuote(sym, (err, quote) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, quote }));
            }
        });
        return;
    }

    if (req.url === '/api/angel-login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const mpinToUse = data.mpin || config.mpin;

                angelLogin(mpinToUse, (err, result) => {
                    if (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(result));
                    }
                });
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "Invalid JSON" }));
            }
        });
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading dashboard');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('================================================================');
    console.log(' AlphaTrade AI - Live Angel One Stream Server (NSE + MCX Broad)');
    console.log('================================================================');
    console.log(` Client ID    : ${config.clientCode}`);
    console.log(` Status       : 🟢 CONNECTED (35+ Liquid F&O + Cash + MCX)`);
    console.log('----------------------------------------------------------------');
    console.log(`\n💻 On Desktop : http://localhost:${PORT}`);
    
    const interfaces = os.networkInterfaces();
    console.log('\n📱 On Mobile  :');
    for (let name of Object.keys(interfaces)) {
        for (let iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`   👉 http://${iface.address}:${PORT}`);
            }
        }
    }
    console.log('\n================================================================');
});

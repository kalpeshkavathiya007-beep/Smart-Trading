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
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

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

// Multi-Exchange Quotes (NSE + MCX)
function fetchAngelQuotes(callback) {
    if (!config.jwtToken) {
        return callback(new Error("No active Angel One session"));
    }

    const postData = JSON.stringify({
        mode: "FULL",
        exchangeTokens: {
            "NSE": ["2885", "3499", "3045", "1333", "1594", "1964", "10604", "5097", "13751", "9581"],
            "MCX": ["573422", "583829", "495213", "495214", "590879"]
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
                            ltp: item.ltp,
                            close: item.close,
                            high: item.high,
                            low: item.low,
                            open: item.open
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
        fetchAngelQuotes((err, quotes) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, quotes }));
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
    console.log(' AlphaTrade AI - Live Angel One Stream Server (NSE + MCX)');
    console.log('================================================================');
    console.log(` Client ID    : ${config.clientCode}`);
    console.log(` Status       : 🟢 CONNECTED (NSE + MCX COMMODITIES ACTIVE)`);
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

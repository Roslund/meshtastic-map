require('./utils/logger');
const crypto = require("crypto");
const path = require("path");
const http = require("http");
const mqtt = require("mqtt");
const protobufjs = require("protobufjs");
const commandLineArgs = require("command-line-args");
const commandLineUsage = require("command-line-usage");
const { WebSocketServer } = require("ws");

const optionsList = [
    {
        name: 'help',
        alias: 'h',
        type: Boolean,
        description: 'Display this usage guide.'
    },
    {
        name: "mqtt-broker-url",
        type: String,
        description: "MQTT Broker URL (e.g: mqtt://mqtt.meshtastic.org)",
    },
    {
        name: "mqtt-username",
        type: String,
        description: "MQTT Username (e.g: meshdev)",
    },
    {
        name: "mqtt-password",
        type: String,
        description: "MQTT Password (e.g: large4cats)",
    },
    {
        name: "mqtt-client-id",
        type: String,
        description: "MQTT Client ID (e.g: map.example.com)",
    },
    {
        name: "mqtt-topic",
        type: String,
        multiple: true,
        typeLabel: '<topic> ...',
        description: "MQTT Topic to subscribe to (e.g: msh/#)",
    },
    {
        name: "decryption-keys",
        type: String,
        multiple: true,
        typeLabel: '<base64DecryptionKey> ...',
        description: "Decryption keys encoded in base64 to use when decrypting service envelopes.",
    },
    {
        name: "ws-port",
        type: Number,
        description: "WebSocket server port (default: 8081)",
    },
];

// parse command line args
const options = commandLineArgs(optionsList);

// show help
if(options.help){
    const usage = commandLineUsage([
        {
            header: 'Meshtastic WebSocket Publisher',
            content: 'Publishes real-time Meshtastic packets via WebSocket.',
        },
        {
            header: 'Options',
            optionList: optionsList,
        },
    ]);
    console.log(usage);
    process.exit(0);
}

// get options and fallback to default values
const mqttBrokerUrl = options["mqtt-broker-url"] ?? "mqtt://mqtt.meshtastic.org";
const mqttUsername = options["mqtt-username"] ?? "meshdev";
const mqttPassword = options["mqtt-password"] ?? "large4cats";
const mqttClientId = options["mqtt-client-id"] ?? null;
const mqttTopics = options["mqtt-topic"] ?? ["msh/#"];
const decryptionKeys = options["decryption-keys"] ?? [
    "1PG7OiApB1nwvP+rz05pAQ==", // add default "AQ==" decryption key
];
const wsPort = options["ws-port"] ?? 8081;

// create mqtt client
const client = mqtt.connect(mqttBrokerUrl, {
    username: mqttUsername,
    password: mqttPassword,
    clientId: mqttClientId,
});

// load protobufs
const root = new protobufjs.Root();
root.resolvePath = (origin, target) => path.join(__dirname, "protobufs", target);
root.loadSync('meshtastic/mqtt.proto');
const Data = root.lookupType("Data");
const ServiceEnvelope = root.lookupType("ServiceEnvelope");
const RouteDiscovery = root.lookupType("RouteDiscovery");

// create HTTP server for WebSocket
const server = http.createServer();
const wss = new WebSocketServer({ server });

// track connected clients
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`WebSocket client connected. Total clients: ${clients.size}`);

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`WebSocket client disconnected. Total clients: ${clients.size}`);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// broadcast message to all connected clients
function broadcast(message) {
    const messageStr = JSON.stringify(message);
    clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            try {
                client.send(messageStr);
            } catch (error) {
                console.error('Error sending message to client:', error);
            }
        }
    });
}

function createNonce(packetId, fromNode) {
    // Expand packetId to 64 bits
    const packetId64 = BigInt(packetId);

    // Initialize block counter (32-bit, starts at zero)
    const blockCounter = 0;

    // Create a buffer for the nonce
    const buf = Buffer.alloc(16);

    // Write packetId, fromNode, and block counter to the buffer
    buf.writeBigUInt64LE(packetId64, 0);
    buf.writeUInt32LE(fromNode, 8);
    buf.writeUInt32LE(blockCounter, 12);

    return buf;
}

/**
 * References:
 * https://github.com/crypto-smoke/meshtastic-go/blob/develop/radio/aes.go#L42
 * https://github.com/pdxlocations/Meshtastic-MQTT-Connect/blob/main/meshtastic-mqtt-connect.py#L381
 */
function decrypt(packet) {
    // attempt to decrypt with all available decryption keys
    for(const decryptionKey of decryptionKeys){
        try {
            // convert encryption key to buffer
            const key = Buffer.from(decryptionKey, "base64");

            // create decryption iv/nonce for this packet
            const nonceBuffer = createNonce(packet.id, packet.from);

            // determine algorithm based on key length
            var algorithm = null;
            if(key.length === 16){
                algorithm = "aes-128-ctr";
            } else if(key.length === 32){
                algorithm = "aes-256-ctr";
            } else {
                // skip this key, try the next one...
                console.error(`Skipping decryption key with invalid length: ${key.length}`);
                continue;
            }

            // create decipher
            const decipher = crypto.createDecipheriv(algorithm, key, nonceBuffer);

            // decrypt encrypted packet
            const decryptedBuffer = Buffer.concat([decipher.update(packet.encrypted), decipher.final()]);

            // parse as data message
            return Data.decode(decryptedBuffer);

        } catch(e){}
    }

    // couldn't decrypt
    return null;
}

/**
 * converts hex id to numeric id, for example: !FFFFFFFF to 4294967295
 * @param hexId a node id in hex format with a prepended "!"
 * @returns {bigint} the node id in numeric form
 */
function convertHexIdToNumericId(hexId) {
    return BigInt('0x' + hexId.replaceAll("!", ""));
}

// subscribe to everything when connected
client.on("connect", () => {
    console.log("Connected to MQTT broker");
    for(const mqttTopic of mqttTopics){
        client.subscribe(mqttTopic);
        console.log(`Subscribed to MQTT topic: ${mqttTopic}`);
    }
});

// handle message received
client.on("message", async (topic, message) => {
    try {
        // decode service envelope
        const envelope = ServiceEnvelope.decode(message);
        if(!envelope.packet){
            return;
        }

        // attempt to decrypt encrypted packets
        const isEncrypted = envelope.packet.encrypted?.length > 0;
        if(isEncrypted){
            const decoded = decrypt(envelope.packet);
            if(decoded){
                envelope.packet.decoded = decoded;
            }
        }

        // get portnum from decoded packet
        const portnum = envelope.packet?.decoded?.portnum;

        // check if we can see the decrypted packet data
        if(envelope.packet.decoded == null){
            return;
        }

        // handle traceroutes (portnum 70)
        if(portnum === 70) {
            try {
                const routeDiscovery = RouteDiscovery.decode(envelope.packet.decoded.payload);
                
                const traceroute = {
                    type: "traceroute",
                    data: {
                        to: envelope.packet.to,
                        from: envelope.packet.from,
                        want_response: envelope.packet.decoded.wantResponse,
                        route: routeDiscovery.route,
                        snr_towards: routeDiscovery.snrTowards,
                        route_back: routeDiscovery.routeBack,
                        snr_back: routeDiscovery.snrBack,
                        channel_id: envelope.channelId,
                        gateway_id: envelope.gatewayId ? Number(convertHexIdToNumericId(envelope.gatewayId)) : null,
                        packet_id: envelope.packet.id,
                    }
                };
                broadcast(traceroute);
            } catch (e) {
                console.error("Error processing traceroute:", e);
            }
        }

    } catch(e) {
        console.error("Error processing MQTT message:", e);
    }
});

// start WebSocket server
server.listen(wsPort, () => {
    console.log(`WebSocket server running on port ${wsPort}`);
});

// Graceful shutdown handlers
function gracefulShutdown(signal) {
    console.log(`Received ${signal}. Starting graceful shutdown...`);
    
    // Close all WebSocket connections
    clients.forEach((client) => {
        client.close();
    });
    clients.clear();
    
    // Close WebSocket server
    wss.close(() => {
        console.log('WebSocket server closed');
    });
    
    // Close HTTP server
    server.close(() => {
        console.log('HTTP server closed');
    });
    
    // Close MQTT client
    client.end(false, () => {
        console.log('MQTT client disconnected');
        console.log('Graceful shutdown completed');
        process.exit(0);
    });
}

// Handle SIGTERM (Docker, systemd, etc.)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => gracefulShutdown('SIGINT'));


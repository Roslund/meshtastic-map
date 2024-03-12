const crypto = require("crypto");
const path = require("path");
const mqtt = require("mqtt");
const protobufjs = require("protobufjs");

// create prisma db client
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// create mqtt client
const client = mqtt.connect("mqtt://mqtt.meshtastic.org", {
    username: "meshdev",
    password: "large4cats",
});

// load protobufs
const root = new protobufjs.Root();
root.resolvePath = (origin, target) => path.join(__dirname, "protos", target);
root.loadSync('meshtastic/mqtt.proto');
const Data = root.lookupType("Data");
const ServiceEnvelope = root.lookupType("ServiceEnvelope");
const Position = root.lookupType("Position");
const User = root.lookupType("User");

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
    try {

        // default encryption key
        const key = Buffer.from("1PG7OiApB1nwvP+rz05pAQ==", "base64");

        // create decryption iv/nonce for this packet
        const nonceBuffer = createNonce(packet.id, packet.from);

        // create aes-128-ctr decipher
        const decipher = crypto.createDecipheriv('aes-128-ctr', key, nonceBuffer);

        // decrypt encrypted packet
        const decryptedBuffer = Buffer.concat([decipher.update(packet.encrypted), decipher.final()]);

        // parse as data message
        return Data.decode(decryptedBuffer);

    } catch(e) {
        return null;
    }
}

// subscribe to everything when connected
client.on("connect", () => {
    client.subscribe("#");
});

// handle message received
client.on("message", async (topic, message) => {
    try {

        // decode service envelope
        const envelope = ServiceEnvelope.decode(message);

        // attempt to decrypt encrypted packets
        const isEncrypted = envelope.packet.encrypted?.length > 0;
        if(isEncrypted){
            const decoded = decrypt(envelope.packet);
            if(decoded){
                envelope.packet.decoded = decoded;
            }
        }

        const portnum = envelope.packet?.decoded?.portnum;

        if(portnum === 3) {

            const position = Position.decode(envelope.packet.decoded.payload);

            console.log("POSITION_APP", {
                from: envelope.packet.from.toString(16),
                position: position,
            });

            // update node position in db
            if(position.latitudeI != null && position.longitudeI){
                try {
                    await prisma.node.updateMany({
                        where: {
                            node_id: envelope.packet.from,
                        },
                        data: {
                            latitude: position.latitudeI,
                            longitude: position.longitudeI,
                            altitude: position.altitude !== 0 ? position.altitude : null,
                        },
                    });
                } catch (e) {
                    console.error(e);
                }
            }

        }

        if(portnum === 4) {

            const user = User.decode(envelope.packet.decoded.payload);

            console.log("NODEINFO_APP", {
                from: envelope.packet.from.toString(16),
                user: user,
            });

            // create or update node in db
            try {
                await prisma.node.upsert({
                    where: {
                        node_id: envelope.packet.from,
                    },
                    create: {
                        node_id: envelope.packet.from,
                        long_name: user.longName,
                        short_name: user.shortName,
                        hardware_model: user.hwModel,
                        is_licensed: user.isLicensed === true,
                        role: user.role,
                    },
                    update: {
                        long_name: user.longName,
                        short_name: user.shortName,
                        hardware_model: user.hwModel,
                        is_licensed: user.isLicensed === true,
                        role: user.role,
                    },
                });
            } catch (e) {
                console.error(e);
            }

        }

    } catch(e) {
        // ignore errors
    }
});
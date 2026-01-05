// Override console methods to add formatted timestamps
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

function formatTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

console.log = function(...args) {
    originalLog(`${formatTimestamp()} [Info]`, ...args);
};

console.error = function(...args) {
    originalError(`${formatTimestamp()} [Error]`, ...args);
};

console.warn = function(...args) {
    originalWarn(`${formatTimestamp()} [Warn]`, ...args);
};

console.info = function(...args) {
    originalInfo(`${formatTimestamp()} [Info]`, ...args);
};


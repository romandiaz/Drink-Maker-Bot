// Interactive Pi <-> Arduino serial console.
//
// Run this before integrating the Arduino into the kiosk backend. If commands
// work here, the WebSocket plumbing is just the next mechanical step.
//
// Usage:
//   node scripts/serial-bridge.js                 # lists available ports
//   node scripts/serial-bridge.js COM3            # Windows
//   node scripts/serial-bridge.js /dev/ttyUSB0    # Pi / Linux
//
// Once you see "READY", type a command + Enter:
//   READ
//   TARE
//   RUN 1 500
//   POUR 1 30
//   PING
//   STOP
// Commands may optionally end with "#<n>" (e.g. `POUR 1 30 #42`); the
// firmware echoes the same ID back on its response. The backend uses this
// to pair replies; for manual testing here it's optional.
// Ctrl+C to exit.

import { SerialPort, ReadlineParser } from "serialport";
import readline from "node:readline";

const portPath = process.argv[2];

if (!portPath) {
  const ports = await SerialPort.list();
  console.error("Usage: node scripts/serial-bridge.js <port>");
  console.error("Available ports:");
  for (const p of ports) {
    console.error(`  ${p.path}\t${p.manufacturer || "(unknown)"}`);
  }
  process.exit(1);
}

const port = new SerialPort({ path: portPath, baudRate: 115200 });
const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

let ready = false;

port.on("open", () => {
  console.error(`opened ${portPath} @ 115200 — waiting for READY...`);
});

port.on("error", (err) => {
  console.error(`port error: ${err.message}`);
  process.exit(1);
});

parser.on("data", (line) => {
  const clean = line.replace(/\r$/, "");
  console.log(`<- ${clean}`);
  if (clean === "READY") ready = true;
});

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const cmd = line.trim();
  if (!cmd) return;
  if (!ready) {
    console.error("(not ready — Arduino still booting; wait for READY)");
    return;
  }
  port.write(cmd + "\n");
});

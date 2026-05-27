import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TreasuryAgent } from "./agent.js";
import type { Emit } from "./agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const bankingToken = process.env.AUGUSTUS_API_KEY;
if (!bankingToken) {
  console.error("Set AUGUSTUS_API_KEY");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY");
  process.exit(1);
}

const paymentsKey = process.env.AUGUSTUS_PAYMENTS_API_KEY ?? null;
const sandbox = process.env.AUGUSTUS_ENV !== "production";
const agent = new TreasuryAgent(bankingToken, paymentsKey, sandbox);

// Read HTML at startup. In dist/, the HTML is one level up in src/public.
// We resolve relative to the source so it works both in dev and after tsc.
const htmlPath = resolve(__dirname, "..", "src", "public", "index.html");
let html: string;
try {
  html = readFileSync(htmlPath, "utf-8");
} catch {
  console.error(`Could not read ${htmlPath}`);
  process.exit(1);
}

let chatLock = false;

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  if (chatLock) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Another request is in progress." }));
    return;
  }
  chatLock = true;

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const message = body.message as string;

  if (!message?.trim()) {
    chatLock = false;
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Empty message." }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (type: string, content: string) => {
    res.write(`data: ${JSON.stringify({ type, content })}\n\n`);
  };

  const emit: Emit = (type, data) => send(type, data);

  try {
    await agent.chat(message, emit);
  } catch (err) {
    send("error", err instanceof Error ? err.message : "Unknown error");
  }

  res.end();
  chatLock = false;
}

const server = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    handleChat(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      chatLock = false;
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const port = parseInt(process.env.PORT ?? "3000", 10);
server.listen(port, () => {
  console.log(`\nAugustus Treasury Agent`);
  console.log(`${sandbox ? "sandbox" : "production"} · banking: yes · payments: ${paymentsKey ? "yes" : "no"}`);
  console.log(`http://localhost:${port}\n`);
});

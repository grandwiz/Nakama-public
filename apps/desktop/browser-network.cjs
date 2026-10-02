const http = require("node:http");
const net = require("node:net");
const dns = require("node:dns/promises");

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  // Reject mapped/special/local IPv6; public global-unicast only.
  return (
    net.isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:(?:0:|db8:|2:|10:)/i.test(address) &&
    !/^2002:/i.test(address)
  );
}

/** Session-only HTTPS tunnel. DNS is checked once and that exact IP is dialled. */
async function createPublicProxy({
  lookup = dns.lookup,
  connect = net.connect,
} = {}) {
  const sockets = new Set();
  const server = http.createServer((_request, response) => {
    response.writeHead(403);
    response.end();
  });
  server.on("connection", (socket) => {
    if (sockets.size >= 128) return socket.destroy();
    sockets.add(socket);
    socket.setTimeout(30000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("connect", async (request, client, head) => {
    try {
      const match = /^([A-Za-z0-9.-]{1,253}):443$/.exec(request.url || "");
      if (
        !match ||
        net.isIP(match[1]) ||
        /(?:^|\.)(?:localhost|local|internal|home|lan)$/i.test(match[1])
      )
        throw new Error("Blocked target");
      let timer;
      const addresses = await Promise.race([
        lookup(match[1], { all: true, verbatim: true }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("DNS lookup timed out")),
            5000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (
        !addresses.length ||
        addresses.some((row) => !publicAddress(row.address)) ||
        client.destroyed
      )
        throw new Error("Blocked address");
      const destination = connect({
        host: addresses[0].address,
        family: addresses[0].family,
        port: 443,
      });
      sockets.add(destination);
      destination.on("close", () => sockets.delete(destination));
      destination.setTimeout(30000, () => destination.destroy());
      destination.on("error", () => client.destroy());
      client.on("error", () => destination.destroy());
      client.on("close", () => destination.destroy());
      destination.on("close", () => client.destroy());
      destination.once("connect", () => {
        if (client.destroyed) return destination.destroy();
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) destination.write(head);
        client.pipe(destination);
        destination.pipe(client);
      });
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}
module.exports = { publicAddress, createPublicProxy };

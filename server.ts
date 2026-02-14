// Slime Soccer — WebSocket Relay Server for Deno Deploy
// Deploy: https://dash.deno.com → New Project → paste this file
// URL pattern: wss://YOUR_PROJECT.deno.dev/ws?room=ROOM_ID

interface Room {
  host: WebSocket | null;
  guest: WebSocket | null;
}

const rooms = new Map<string, Room>();

function cleanRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (room && !room.host && !room.guest) {
    rooms.delete(roomId);
  }
}

function sendJSON(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

Deno.serve({ port: 8000 }, (req: Request) => {
  const url = new URL(req.url);

  // Health check
  if (url.pathname === "/") {
    return new Response("Slime Soccer Relay Server OK", { status: 200 });
  }

  // WebSocket endpoint
  if (url.pathname === "/ws") {
    const roomId = url.searchParams.get("room");
    if (!roomId) {
      return new Response("Missing room parameter", { status: 400 });
    }

    const upgrade = req.headers.get("upgrade") || "";
    if (upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    let role: "host" | "guest" | null = null;

    socket.onopen = () => {
      let room = rooms.get(roomId);

      if (!room) {
        // First player — host
        room = { host: socket, guest: null };
        rooms.set(roomId, room);
        role = "host";
        sendJSON(socket, { type: "role", role: "host" });
      } else if (!room.guest) {
        // Second player — guest
        room.guest = socket;
        role = "guest";
        sendJSON(socket, { type: "role", role: "guest" });
        // Notify host
        if (room.host) {
          sendJSON(room.host, { type: "joined" });
        }
        // Notify guest too
        sendJSON(socket, { type: "joined" });
      } else {
        // Room full
        sendJSON(socket, { type: "error", msg: "Room is full" });
        socket.close(4000, "Room full");
        return;
      }
    };

    socket.onmessage = (e: MessageEvent) => {
      const room = rooms.get(roomId);
      if (!room) return;

      // Forward message to the OTHER player
      if (role === "host" && room.guest) {
        if (room.guest.readyState === WebSocket.OPEN) {
          room.guest.send(e.data);
        }
      } else if (role === "guest" && room.host) {
        if (room.host.readyState === WebSocket.OPEN) {
          room.host.send(e.data);
        }
      }
    };

    socket.onclose = () => {
      const room = rooms.get(roomId);
      if (!room) return;

      if (role === "host") {
        room.host = null;
        if (room.guest) {
          sendJSON(room.guest, { type: "left" });
        }
      } else if (role === "guest") {
        room.guest = null;
        if (room.host) {
          sendJSON(room.host, { type: "left" });
        }
      }

      cleanRoom(roomId);
    };

    socket.onerror = () => {
      // Will trigger onclose
    };

    return response;
  }

  return new Response("Not Found", { status: 404 });
});

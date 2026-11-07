import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_FRAME_BYTES = 1024 * 1024;

const OPCODE = { CONTINUATION: 0, TEXT: 1, BINARY: 2, CLOSE: 8, PING: 9, PONG: 10 } as const;

const FAIL_PROTOCOL = "protocol-error";
const FAIL_OVERSIZE = "frame-too-large";

interface ParsedFrame {
  readonly opcode: number;
  readonly payload: Buffer;
}

type FrameRead = ParsedFrame | typeof FAIL_PROTOCOL | typeof FAIL_OVERSIZE | null;

export interface WebSocketHandlers {
  onText(text: string): void;
  onClose(): void;
}

function headerText(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return null;
}

/** 最小 RFC6455 服务端实现：只处理客户端 mask 帧与 text/close/ping/pong，单帧上限 1MB。 */
export class WebSocketConnection {
  private readonly socket: Duplex;
  private readonly handlers: WebSocketHandlers;
  private buffer: Buffer = Buffer.alloc(0);
  private closeSent = false;
  private closed = false;

  constructor(socket: Duplex, handlers: WebSocketHandlers) {
    this.socket = socket;
    this.handlers = handlers;
    const withNoDelay = socket as Duplex & { readonly setNoDelay?: (noDelay?: boolean) => unknown };
    withNoDelay.setNoDelay?.(true);
    socket.on("data", (chunk: Buffer | string) => {
      this.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    socket.on("error", () => this.finish());
    socket.on("close", () => this.finish());
    socket.on("end", () => {
      this.socket.end();
      this.finish();
    });
  }

  get isClosed(): boolean { return this.closed; }

  /** 握手成功后由传输层把 HTTP upgrade 的剩余字节交给连接解析。 */
  push(chunk: Buffer): void {
    if (this.closed || chunk.length === 0) return;
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (!this.closed) {
      const frame = this.readFrame();
      if (frame === null) return;
      if (frame === FAIL_PROTOCOL) { this.close(1002, "protocol error"); return; }
      if (frame === FAIL_OVERSIZE) { this.close(1009, "frame too large"); return; }
      this.handleFrame(frame);
    }
  }

  sendText(text: string): void {
    this.sendFrame(OPCODE.TEXT, Buffer.from(text, "utf8"));
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    if (!this.closeSent) {
      this.closeSent = true;
      const reasonBytes = Buffer.from(reason, "utf8").subarray(0, 123);
      const payload = Buffer.allocUnsafe(2 + reasonBytes.length);
      payload.writeUInt16BE(code, 0);
      reasonBytes.copy(payload, 2);
      try {
        this.sendFrame(OPCODE.CLOSE, payload);
      } catch {
        // socket 已断开时忽略发送失败；onClose 仍会触发一次。
      }
    }
    this.socket.end();
    this.finish();
  }

  terminate(): void {
    this.finish();
    this.socket.destroy();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer = Buffer.alloc(0);
    this.handlers.onClose();
  }

  private readFrame(): FrameRead {
    const buffer = this.buffer;
    if (buffer.length < 2) return null;
    const first = buffer[0];
    const second = buffer[1];
    const fin = (first & 0x80) !== 0;
    const rsv = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < offset + 2) return null;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffer.length < offset + 8) return null;
      const big = buffer.readBigUInt64BE(offset);
      offset += 8;
      if (big > BigInt(MAX_FRAME_BYTES)) return FAIL_OVERSIZE;
      length = Number(big);
    }
    if (length > MAX_FRAME_BYTES) return FAIL_OVERSIZE;
    if (rsv !== 0 || !fin) return FAIL_PROTOCOL;
    if (!masked) return FAIL_PROTOCOL;
    if (opcode >= 8 && length > 125) return FAIL_PROTOCOL;
    if (buffer.length < offset + 4 + length) return null;
    const mask = buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.allocUnsafe(length);
    for (let index = 0; index < length; ++index) payload[index] = buffer[offset + index] ^ mask[index & 3];
    this.buffer = buffer.subarray(offset + length);
    return { opcode, payload };
  }

  private handleFrame(frame: ParsedFrame): void {
    if (frame.opcode === OPCODE.TEXT) {
      this.handlers.onText(frame.payload.toString("utf8"));
      return;
    }
    if (frame.opcode === OPCODE.CLOSE) {
      if (!this.closeSent) {
        this.closeSent = true;
        try {
          this.sendFrame(OPCODE.CLOSE, frame.payload);
        } catch {
          // 对端已断开时忽略回显失败。
        }
      }
      this.socket.end();
      this.finish();
      return;
    }
    if (frame.opcode === OPCODE.PING) {
      this.sendFrame(OPCODE.PONG, frame.payload);
      return;
    }
    if (frame.opcode === OPCODE.PONG) return;
    this.close(1003, "unsupported frame");
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    if (this.closed) return;
    const length = payload.length;
    let header: Buffer;
    if (length < 126) {
      header = Buffer.allocUnsafe(2);
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.allocUnsafe(4);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([header, payload]));
  }
}

/** 校验并完成 HTTP Upgrade 握手；失败时写回 400 并销毁 socket。 */
export function acceptUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  handlers: WebSocketHandlers
): WebSocketConnection | null {
  const upgrade = headerText(request.headers.upgrade);
  const key = headerText(request.headers["sec-websocket-key"]);
  const version = headerText(request.headers["sec-websocket-version"]);
  if (upgrade?.toLowerCase() !== "websocket" || key === null || version !== "13") {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return null;
  }
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  return new WebSocketConnection(socket, handlers);
}

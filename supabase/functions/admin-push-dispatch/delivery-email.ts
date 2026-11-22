type DeliveryRequest = {
  id: string;
  customer_name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  delivery_date: string;
  pickup_date: string;
  delivery_time: string | null;
  pickup_time: string | null;
  items: { name: string; qty: number; sizes?: Record<string, string> }[];
  rental_total: number;
};

const recipient = "contact@maloe-location.re";
const validEmail = (value: string) => /^[A-Za-z0-9.!#$%&'*+\/=?^_\x60{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z0-9-]+$/.test(value);
const encode = (value: string) => btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join(""));
const appointment = (date: string, time: string | null) =>
  date.split("-").reverse().join("/") + (time ? " à " + time.slice(0, 5) : "");

export async function sendDeliveryEmail(request: DeliveryRequest) {
  const host = Deno.env.get("SMTP_HOST");
  const port = Number(Deno.env.get("SMTP_PORT") || 465);
  const user = Deno.env.get("SMTP_USER");
  const password = Deno.env.get("SMTP_PASSWORD");
  const from = Deno.env.get("SMTP_FROM");
  if (!host || !user || !password || !from || !validEmail(from)) throw Error("SMTP settings missing or invalid");

  const reference = request.id.slice(0, 8).toUpperCase();
  const subject = "Nouvelle demande de livraison — " + reference;
  const body = [
    "Nouvelle demande de livraison Maloé Location",
    "",
    "Référence : " + reference,
    "Client : " + request.customer_name,
    "E-mail : " + request.email,
    "Téléphone : " + request.phone,
    "Adresse : " + request.address,
    "Livraison souhaitée : " + appointment(request.delivery_date, request.delivery_time),
    "Récupération souhaitée : " + appointment(request.pickup_date, request.pickup_time),
    "",
    "Matériel :",
    ...request.items.map(item => {
      const sizes = Object.values(item.sizes ?? {}).join(" · ");
      return "- " + item.qty + " × " + item.name + (sizes ? " · " + sizes : "");
    }),
    "Location estimée : " + Number(request.rental_total).toFixed(2).replace(".", ",") + " €",
    request.notes ? "Précisions : " + request.notes : "",
    "",
    "Répondez au client pour lui proposer vos créneaux et les frais de livraison.",
    "Maloé Gestion : https://maloe-location.re/maloe-gestion-mobile/?vue=livraisons",
  ].join("\n");
  const message = [
    "From: =?UTF-8?B?" + encode("Maloé Location") + "?= <" + from + ">",
    "To: <" + recipient + ">",
    ...(validEmail(request.email) ? ["Reply-To: <" + request.email + ">"] : []),
    "Subject: =?UTF-8?B?" + encode(subject) + "?=",
    "Date: " + new Date().toUTCString(),
    "Message-ID: <delivery-" + request.id + "@maloe-location.re>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encode(body).match(/.{1,76}/g)!.join("\r\n"),
    ".",
    "",
  ].join("\r\n");

  let connection: Deno.TlsConn | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => { try { connection?.close(); } catch {} };
  try {
    await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          close();
          reject(Error("SMTP timeout"));
        }, 12_000);
      }),
      (async () => {
        connection = await Deno.connectTls({ hostname: host, port });
        if (expired) { close(); return; }
        const decoder = new TextDecoder(), encoder = new TextEncoder();
        let buffer = "";
        const readLine = async () => {
          while (!buffer.includes("\r\n")) {
            const bytes = new Uint8Array(4096);
            const count = await connection!.read(bytes);
            if (count === null) throw Error("SMTP disconnected");
            buffer += decoder.decode(bytes.subarray(0, count));
            if (buffer.length > 64000) throw Error("SMTP response too long");
          }
          const end = buffer.indexOf("\r\n");
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          return line;
        };
        const write = async (value: string) => {
          let bytes = encoder.encode(value);
          while (bytes.length) bytes = bytes.subarray(await connection!.write(bytes));
        };
        const expect = async (...codes: number[]) => {
          let line = await readLine();
          const code = line.slice(0, 3);
          while (line[3] === "-") {
            line = await readLine();
            if (line.slice(0, 3) !== code) throw Error("SMTP malformed response");
          }
          if (!codes.includes(Number(code))) throw Error("SMTP returned " + Number(code));
        };
        const command = async (value: string, ...codes: number[]) => {
          await write(value + "\r\n");
          await expect(...codes);
        };
        await expect(220);
        await command("EHLO maloe-location.re", 250);
        await command("AUTH LOGIN", 334);
        await command(encode(user), 334);
        await command(encode(password), 235);
        await command("MAIL FROM:<" + from + ">", 250);
        await command("RCPT TO:<" + recipient + ">", 250, 251);
        await command("DATA", 354);
        await write(message);
        await expect(250);
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    close();
  }
}

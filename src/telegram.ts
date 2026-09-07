export async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const redacted = (err: unknown): Error => new Error(String(err).replaceAll(token, "[REDACTED]"));
  const post = async (): Promise<Response> => {
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw redacted(err);
    }
  };
  let res = await post();
  if (res.status === 429) {
    const retryAfter = await res
      .json()
      .then((body: any) => (typeof body?.parameters?.retry_after === "number" ? body.parameters.retry_after : 1))
      .catch(() => 1);
    await Bun.sleep((retryAfter + 1) * 1000);
    res = await post();
  }
  if (!res.ok) {
    throw new Error(`Telegram API ${res.status}: ${(await res.text()).replaceAll(token, "[REDACTED]")}`);
  }
}

// The owner check, shared by every owner-only command.
import { getOwnerChatId } from "../adapters/d1/v2Admin";
import { type MyContext } from "../adapters/telegram/context";

export async function isOwner(ctx: MyContext): Promise<boolean> {
  const ownerChatId = await getOwnerChatId(ctx.db);
  return !!ownerChatId && ownerChatId === ctx.user.chatId;
}

// The owner check, shared by every owner-only command.
import { getOwnerChatId } from "../../adapters/d1/v2Admin";
import { type MyContext } from "../../adapters/telegram/context";
import type { DB } from "../../adapters/d1/shared";
import type { UserDoc } from "../../types";

// Ctx-free form, for the Mini App / native API routes.
export async function isOwnerOf(db: DB, user: UserDoc): Promise<boolean> {
  const ownerChatId = await getOwnerChatId(db);
  return !!ownerChatId && ownerChatId === user.chatId;
}

export async function isOwner(ctx: MyContext): Promise<boolean> {
  return isOwnerOf(ctx.db, ctx.user);
}

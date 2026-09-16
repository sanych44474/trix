import type { UserDoc } from "../types";
import type { DashboardPayload } from "../webapp/dashboard";

/** The application seam for the dashboard. HTTP and Telegram never need to know how
 * the snapshot is assembled or which storage adapter supplies it. */
export interface DashboardReader {
  read(user: UserDoc): Promise<DashboardPayload>;
}

export function createDashboardApplication(reader: DashboardReader) {
  return {
    getDashboard(user: UserDoc) {
      return reader.read(user);
    },
  };
}

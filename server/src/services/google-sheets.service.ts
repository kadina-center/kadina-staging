import { google } from "googleapis";
import { prisma } from "../lib/prisma";

/**
 * Export all contacts into a Google Sheet.
 * Auth: caller-provided OAuth access token (manual for this phase).
 */
export async function exportContactsToSheet(
  spreadsheetId: string,
  accessToken: string
): Promise<{ rowsWritten: number }> {
  if (!spreadsheetId?.trim()) {
    throw new Error("spreadsheetId is required");
  }
  if (!accessToken?.trim()) {
    throw new Error("accessToken is required");
  }

  const contacts = await prisma.contact.findMany({
    orderBy: { lastMessageAt: "desc" },
  });

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken.trim() });

  const sheets = google.sheets({ version: "v4", auth });

  const header = [
    "id",
    "phone",
    "name",
    "channel",
    "channelUserId",
    "optedOut",
    "lastMessageAt",
    "createdAt",
  ];

  const rows = contacts.map((c) => [
    c.id,
    c.phone,
    c.name ?? "",
    c.channel,
    c.channelUserId ?? "",
    c.optedOut ? "true" : "false",
    c.lastMessageAt.toISOString(),
    c.createdAt.toISOString(),
  ]);

  const values = [header, ...rows];

  await sheets.spreadsheets.values.clear({
    spreadsheetId: spreadsheetId.trim(),
    range: "Sheet1!A:Z",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId.trim(),
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    requestBody: { values },
  });

  return { rowsWritten: rows.length };
}

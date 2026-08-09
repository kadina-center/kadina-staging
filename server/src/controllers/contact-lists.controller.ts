import { parse } from "csv-parse/sync";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
}

export async function listContactLists(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const lists = await prisma.contactList.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { contacts: true } },
      },
    });

    res.json(
      lists.map((list) => ({
        id: list.id,
        name: list.name,
        createdAt: list.createdAt,
        memberCount: list._count.contacts,
      }))
    );
  } catch (error) {
    console.error("[contact-lists] list error:", error);
    res.status(500).json({ error: "Failed to list contact lists" });
  }
}

export async function createContactList(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const list = await prisma.contactList.create({
      data: { name: name.trim() },
    });

    res.status(201).json({ ...list, memberCount: 0 });
  } catch (error) {
    console.error("[contact-lists] create error:", error);
    res.status(500).json({ error: "Failed to create contact list" });
  }
}

export async function getContactList(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const list = await prisma.contactList.findUnique({
      where: { id },
      include: {
        contacts: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            phone: true,
            name: true,
            optedOut: true,
            createdAt: true,
          },
        },
      },
    });

    if (!list) {
      res.status(404).json({ error: "Contact list not found" });
      return;
    }

    res.json({
      id: list.id,
      name: list.name,
      createdAt: list.createdAt,
      memberCount: list.contacts.length,
      contacts: list.contacts,
    });
  } catch (error) {
    console.error("[contact-lists] get error:", error);
    res.status(500).json({ error: "Failed to get contact list" });
  }
}

export async function addMembers(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { contactIds } = req.body as { contactIds?: string[] };

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      res.status(400).json({ error: "contactIds array is required" });
      return;
    }

    const list = await prisma.contactList.findUnique({ where: { id } });
    if (!list) {
      res.status(404).json({ error: "Contact list not found" });
      return;
    }

    await prisma.contactList.update({
      where: { id },
      data: {
        contacts: {
          connect: contactIds.map((contactId) => ({ id: contactId })),
        },
      },
    });

    const count = await prisma.contact.count({
      where: { lists: { some: { id } } },
    });

    res.json({ ok: true, memberCount: count });
  } catch (error) {
    console.error("[contact-lists] add members error:", error);
    res.status(500).json({ error: "Failed to add members" });
  }
}

export async function importCsv(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: "CSV file is required" });
      return;
    }

    const list = await prisma.contactList.findUnique({ where: { id } });
    if (!list) {
      res.status(404).json({ error: "Contact list not found" });
      return;
    }

    const records = parse(file.buffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Array<Record<string, string>>;

    let imported = 0;
    let skipped = 0;
    const contactIds: string[] = [];
    const { ensureDefaultWhatsAppChannel } = await import(
      "../services/whatsapp-channel.service"
    );
    const defaultChannel = await ensureDefaultWhatsAppChannel();
    const channelScope = defaultChannel.id;

    for (const row of records) {
      const rawPhone = row.phone || row.Phone || row.PHONE || row.mobile;
      if (!rawPhone) {
        skipped += 1;
        continue;
      }

      const phone = normalizePhone(rawPhone);
      if (!phone) {
        skipped += 1;
        continue;
      }

      const name =
        row.name || row.Name || row.NAME || row.fullname || undefined;

      const contact = await prisma.contact.upsert({
        where: {
          channel_phone_channelScope: {
            channel: "whatsapp",
            phone,
            channelScope,
          },
        },
        create: {
          phone,
          name: name?.trim() || null,
          channel: "whatsapp",
          channelUserId: phone,
          whatsAppChannelId: defaultChannel.id,
          channelScope,
        },
        update: {
          ...(name?.trim() ? { name: name.trim() } : {}),
          channelUserId: phone,
          whatsAppChannelId: defaultChannel.id,
          channelScope,
        },
      });

      contactIds.push(contact.id);
      imported += 1;
    }

    if (contactIds.length > 0) {
      await prisma.contactList.update({
        where: { id },
        data: {
          contacts: {
            connect: contactIds.map((contactId) => ({ id: contactId })),
          },
        },
      });
    }

    const memberCount = await prisma.contact.count({
      where: { lists: { some: { id } } },
    });

    res.json({ ok: true, imported, skipped, memberCount });
  } catch (error) {
    console.error("[contact-lists] import error:", error);
    res.status(500).json({ error: "Failed to import CSV" });
  }
}

import bcrypt from "bcryptjs";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { getOrCreateClinicSettings } from "./services/clinic-settings.service";
import { ensureDefaultWhatsAppChannel } from "./services/whatsapp-channel.service";

/**
 * Ensures clinic settings + an admin user with a known password exist.
 */
export async function bootstrapApp(): Promise<void> {
  await getOrCreateClinicSettings();
  try {
    const channel = await ensureDefaultWhatsAppChannel();
    console.log(
      `[bootstrap] WhatsApp default channel ready id=${channel.id} status=${channel.status}`
    );
  } catch (error) {
    console.error("[bootstrap] ensureDefaultWhatsAppChannel failed:", error);
  }

  const email = env.DEFAULT_ADMIN_EMAIL.toLowerCase();
  const password = env.DEFAULT_ADMIN_PASSWORD;
  const hash = await bcrypt.hash(password, 10);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        name: "Admin",
        email,
        role: "admin",
        passwordHash: hash,
      },
    });
    console.log(`[bootstrap] Created admin user ${email}`);
    return;
  }

  if (!existing.passwordHash) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: hash, role: existing.role || "admin" },
    });
    console.log(`[bootstrap] Set password for existing user ${email}`);
  }

  // Fix any users created without password
  await prisma.user.updateMany({
    where: { passwordHash: "" },
    data: { passwordHash: hash },
  });
}

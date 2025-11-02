const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  try {
    const users = await p.user.findMany({
      select: {
        id: true,
        email: true,
        username: true,
        phone: true,
        passwordHash: true,
        createdAt: true,
      },
    });

    console.table(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        phone: u.phone,
        hasHash: !!u.passwordHash,
        createdAt: u.createdAt,
      })),
    );
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const existingAdmin = await prisma.user.findFirst({
        where: { email: process.env.ADMIN_ACCOUNT_EMAIL },
    });
    if (!existingAdmin) {
        await prisma.user.create({
            data: {
                name: "Eg Super Admin",
                phone: process.env.ADMIN_ACCOUNT_PHONE_NUMBER,
                email: process.env.ADMIN_ACCOUNT_EMAIL,
                password: process.env.ADMIN_ACCOUNT_PASSWORD,
                location: process.env.ADMIN_ACCOUNT_LOCATION,
                notes: "A eg super Admin",
                access_level: "eg_super_admin",
                pan_id: process.env.ADMIN_ACCOUNT_PAN_ID,
                aadhaar_id: process.env.ADMIN_ACCOUNT_AADHAR_ID,
                permanent_address: process.env.ADMIN_ACCOUNT_ADDRESS,
            },
        });
        console.log("Admin user created.");
    }
    else {
        console.log("Admin user already exists.");
    }
}
main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=seed.js.map